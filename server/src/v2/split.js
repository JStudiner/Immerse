/**
 * Immersion v2 - Split Module (Replicate API)
 *
 * Separates audio into vocals and background using Demucs via Replicate
 * Supports PARALLEL CHUNKING for faster processing of long audio
 *
 * Features:
 * - Automatic compression for faster uploads
 * - Parallel processing of chunks for 3-5x speedup
 * - Crossfade stitching for seamless audio
 *
 * Cost: ~$0.034 per chunk (5 min)
 */

const Replicate = require("replicate");
const { execSync } = require("child_process");
const path = require("path");
const fs = require("fs");
const https = require("https");
const http = require("http");
const crypto = require("crypto");
const { TPSLimiter, ConcurrentRateLimiter } = require("./rate-limiter");

// Demucs cache directory - stores separated audio by source hash
const DEMUCS_CACHE_DIR = path.join(__dirname, "..", "..", "cache", "demucs");

// Initialize Replicate client
const replicate = new Replicate({
  auth: process.env.REPLICATE_API_TOKEN || process.env.REPLICATE_API_KEY,
});

// Demucs model on Replicate
const DEMUCS_MODEL =
  "ryan5453/demucs:5a7041cc9b82e5a558fea6b3d7b12dea89625e89da33f0447bd727c2d0ab9e77";

// Spleeter model on Replicate (136x cheaper, 15x faster than Demucs)
// ~$0.00025/run, ~2 seconds, T4 GPU
const SPLEETER_MODEL = "soykertje/spleeter:cd128044253523c86abfd743dea680c88559ad975ccd72378c8433f067ab5d0a";

// Parallel processing config
const PARALLEL_CONFIG = {
  chunkDuration: 60, // 60 seconds per chunk (10x parallel = 10min video in ~20s)
  overlap: 2, // 2 seconds overlap for crossfade
  maxTPS: 10, // 10 transactions per second max for Replicate
  minDurationForParallel: 120, // Parallelize if > 2 minutes
};

/**
 * Separation model presets
 * Different models trade off quality vs speed
 */
const SEPARATION_MODELS = {
  // Cheap: Spleeter - 136x cheaper, 15x faster than Demucs. Good for voice extraction.
  cheap: {
    model: "spleeter",
    shifts: 0,
    engine: "spleeter",
    description: "Spleeter — ~$0.00025/run, ~2s, decent quality (great for voice extraction)",
  },
  // Fast: For Learner tier - speed over quality
  fast: {
    model: "htdemucs",
    shifts: 0,
    engine: "demucs",
    description: "Fast separation (shifts=0) — 2-4x faster, minor quality loss",
  },
  // Standard: For Immerser tier - good balance
  standard: {
    model: "htdemucs",
    shifts: 1,
    engine: "demucs",
    description: "Standard separation (shifts=1) — best speed/quality balance",
  },
  // Quality: For Pro tier - best quality
  quality: {
    model: "htdemucs_ft",
    shifts: 2,
    engine: "demucs",
    description: "High quality separation (htdemucs_ft, shifts=2) — best fidelity, 4x slower",
  },
};

// Max file size for Replicate (100MB)
const MAX_UPLOAD_SIZE = 100 * 1024 * 1024;

/**
 * Generate cache key for audio file
 * Uses file size + first 64KB hash for fast identification
 */
function getDemucsKey(audioPath, model = "htdemucs") {
  const stats = fs.statSync(audioPath);
  const fileSize = stats.size;
  
  // Read first 64KB for hash (fast)
  const fd = fs.openSync(audioPath, 'r');
  const buffer = Buffer.alloc(Math.min(65536, fileSize));
  fs.readSync(fd, buffer, 0, buffer.length, 0);
  fs.closeSync(fd);
  
  const hash = crypto.createHash("md5").update(buffer).digest("hex").substring(0, 12);
  return `${model}_${fileSize}_${hash}`;
}

/**
 * Check if separated audio is in cache
 * @returns {object|null} Cached paths or null
 */
function getCachedDemucs(cacheKey) {
  const cacheDir = path.join(DEMUCS_CACHE_DIR, cacheKey);
  const vocalsPath = path.join(cacheDir, "vocals.mp3");
  const backgroundPath = path.join(cacheDir, "background.mp3");
  
  if (fs.existsSync(vocalsPath) && fs.existsSync(backgroundPath)) {
    const vocalsSize = fs.statSync(vocalsPath).size;
    const bgSize = fs.statSync(backgroundPath).size;
    
    // Verify files are valid (at least 100KB each)
    if (vocalsSize > 100 * 1024 && bgSize > 100 * 1024) {
      return { vocals: vocalsPath, background: backgroundPath };
    }
  }
  return null;
}

/**
 * Save separated audio to cache
 */
function cacheDemucs(vocalsPath, backgroundPath, cacheKey) {
  const cacheDir = path.join(DEMUCS_CACHE_DIR, cacheKey);
  fs.mkdirSync(cacheDir, { recursive: true });
  
  const cachedVocals = path.join(cacheDir, "vocals.mp3");
  const cachedBackground = path.join(cacheDir, "background.mp3");
  
  fs.copyFileSync(vocalsPath, cachedVocals);
  fs.copyFileSync(backgroundPath, cachedBackground);
  
  console.log(`   💾 Cached Demucs results for future use`);
}

/**
 * Get audio duration using ffprobe
 */
function getDuration(filePath) {
  try {
    const result = execSync(
      `ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "${filePath}"`,
      { encoding: "utf-8", timeout: 10000 }
    );
    return parseFloat(result.trim());
  } catch {
    return null;
  }
}

/**
 * Analyze audio levels for validation
 */
function analyzeAudioLevels(filePath) {
  try {
    const result = execSync(
      `ffmpeg -i "${filePath}" -af "volumedetect" -f null - 2>&1`,
      { encoding: "utf-8" }
    );
    const meanMatch = result.match(/mean_volume:\s*(-?[\d.]+)/);
    const maxMatch = result.match(/max_volume:\s*(-?[\d.]+)/);
    return {
      meanVolume: meanMatch ? parseFloat(meanMatch[1]) : null,
      maxVolume: maxMatch ? parseFloat(maxMatch[1]) : null,
    };
  } catch {
    return { meanVolume: null, maxVolume: null };
  }
}

/**
 * Download file from URL (handles Replicate FileOutput objects)
 */
async function downloadFile(urlOrObj, destPath, silent = false) {
  let url;

  if (typeof urlOrObj === "string") {
    url = urlOrObj;
  } else if (urlOrObj && typeof urlOrObj === "object") {
    const strValue = String(urlOrObj);
    if (strValue.startsWith("http")) {
      url = strValue;
    } else if (typeof urlOrObj.url === "function") {
      url = await urlOrObj.url();
    } else if (urlOrObj.url) {
      url = urlOrObj.url;
    }
  }

  if (typeof url !== "string" || !url.startsWith("http")) {
    throw new Error(
      `Invalid URL: ${JSON.stringify(urlOrObj).substring(0, 200)}`
    );
  }

  if (!silent) {
    console.log(`      -> downloading from ${url.substring(0, 50)}...`);
  }

  return new Promise((resolve, reject) => {
    const protocol = url.startsWith("https") ? https : http;
    const file = fs.createWriteStream(destPath);

    protocol
      .get(url, (response) => {
        if (response.statusCode === 301 || response.statusCode === 302) {
          file.close();
          if (fs.existsSync(destPath)) fs.unlinkSync(destPath);
          downloadFile(response.headers.location, destPath, true)
            .then(resolve)
            .catch(reject);
          return;
        }

        if (response.statusCode !== 200) {
          file.close();
          if (fs.existsSync(destPath)) fs.unlinkSync(destPath);
          reject(new Error(`HTTP ${response.statusCode}`));
          return;
        }

        response.pipe(file);
        file.on("finish", () => {
          file.close();
          resolve();
        });
        file.on("error", (err) => {
          if (fs.existsSync(destPath)) fs.unlinkSync(destPath);
          reject(err);
        });
      })
      .on("error", (err) => {
        if (fs.existsSync(destPath)) fs.unlinkSync(destPath);
        reject(err);
      });
  });
}

/**
 * Compress audio to MP3 for faster upload
 */
function compressToMp3(inputPath, outputPath) {
  execSync(
    `ffmpeg -y -i "${inputPath}" -codec:a libmp3lame -b:a 192k "${outputPath}"`,
    { stdio: "pipe", timeout: 120000 }
  );
  return outputPath;
}

/**
 * Split audio file into chunks with overlap - PARALLEL version
 * Runs all FFmpeg chunk extractions simultaneously for speed
 */
async function splitIntoChunks(audioPath, outputDir, chunkDuration, overlap) {
  const duration = getDuration(audioPath);
  const chunkSpecs = [];

  // Calculate all chunk specs first
  let start = 0;
  let chunkIdx = 0;

  while (start < duration) {
    const end = Math.min(start + chunkDuration + overlap, duration);
    chunkSpecs.push({
      index: chunkIdx,
      path: path.join(
        outputDir,
        `chunk_${chunkIdx.toString().padStart(3, "0")}.mp3`
      ),
      start,
      end,
      duration: end - start,
    });
    start += chunkDuration;
    chunkIdx++;
  }

  // Run all FFmpeg extractions in parallel
  const { exec } = require("child_process");
  const { promisify } = require("util");
  const execAsync = promisify(exec);

  await Promise.all(
    chunkSpecs.map(async (chunk) => {
      await execAsync(
        `ffmpeg -y -i "${audioPath}" -ss ${chunk.start} -t ${chunk.duration} -codec:a libmp3lame -b:a 192k "${chunk.path}"`,
        { timeout: 60000 }
      );
    })
  );

  return chunkSpecs;
}

/**
 * Sleep helper
 */
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Run Demucs on a single chunk with retry logic for rate limits
 */
async function processChunk(chunk, outputDir, options = {}) {
  const { maxRetries = 5, model = "htdemucs", shifts = 1 } = options;
  const audioBuffer = fs.readFileSync(chunk.path);

  let lastError;
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const output = await replicate.run(DEMUCS_MODEL, {
        input: {
          audio: audioBuffer,
          model: model,
          stem: "none",
          split: true,
          jobs: 0,
          shifts: shifts,
          overlap: 0.25,
          clip_mode: "rescale",
          output_format: "mp3",
          mp3_bitrate: 320,
          mp3_preset: 2,
        },
      });

      // Success - continue to download stems
      return await downloadChunkStems(chunk, output, outputDir);
    } catch (error) {
      lastError = error;

      // Check if it's a rate limit error
      if (
        error.message?.includes("429") ||
        error.message?.includes("rate limit")
      ) {
        const retryAfter =
          error.message.match(/retry_after[":]\s*(\d+)/)?.[1] || 15;
        const waitTime = Math.max(parseInt(retryAfter) * 1000, 10000 * attempt);
        console.log(
          `\n      ⏳ Chunk ${chunk.index}: Rate limited, waiting ${
            waitTime / 1000
          }s (attempt ${attempt}/${maxRetries})...`
        );
        await sleep(waitTime);
        continue;
      }

      // Other error - still retry but with shorter backoff
      if (attempt < maxRetries) {
        console.log(
          `\n      ⚠️ Chunk ${chunk.index}: ${error.message}, retrying in ${
            attempt * 2
          }s...`
        );
        await sleep(attempt * 2000);
        continue;
      }
    }
  }

  throw (
    lastError ||
    new Error(`Chunk ${chunk.index} failed after ${maxRetries} attempts`)
  );
}

/**
 * Download and process stems after successful Demucs run
 */
async function downloadChunkStems(chunk, output, outputDir) {
  const vocalsPath = path.join(
    outputDir,
    `vocals_chunk_${chunk.index.toString().padStart(3, "0")}.mp3`
  );

  if (output.vocals) {
    await downloadFile(output.vocals, vocalsPath, true);
  }

  // Download and merge non-vocal stems
  const bgStems = [];
  for (const [stemName, stemUrl] of Object.entries(output)) {
    if (stemName !== "vocals" && stemUrl) {
      const stemPath = path.join(
        outputDir,
        `_${stemName}_chunk_${chunk.index}.mp3`
      );
      await downloadFile(stemUrl, stemPath, true);
      bgStems.push(stemPath);
    }
  }

  // Merge background stems
  const bgPath = path.join(
    outputDir,
    `bg_chunk_${chunk.index.toString().padStart(3, "0")}.mp3`
  );
  if (bgStems.length === 1) {
    fs.renameSync(bgStems[0], bgPath);
  } else if (bgStems.length > 1) {
    const inputs = bgStems.map((f) => `-i "${f}"`).join(" ");
    execSync(
      `ffmpeg -y ${inputs} -filter_complex "amix=inputs=${bgStems.length}:duration=longest:normalize=0" "${bgPath}"`,
      { stdio: "pipe", timeout: 60000 }
    );
    bgStems.forEach((f) => {
      try {
        fs.unlinkSync(f);
      } catch {}
    });
  }

  return {
    index: chunk.index,
    start: chunk.start,
    duration: chunk.duration,
    vocals: vocalsPath,
    background: bgPath,
  };
}

/**
 * Stitch audio chunks together with crossfade - FAST single-pass version
 */
function stitchChunks(chunks, outputPath, overlap) {
  if (chunks.length === 0) {
    throw new Error("No chunks to stitch");
  }

  if (chunks.length === 1) {
    fs.copyFileSync(chunks[0], outputPath);
    return;
  }

  if (chunks.length === 2) {
    // Simple case: just one crossfade (with multi-threading)
    execSync(
      `ffmpeg -y -threads 0 -i "${chunks[0]}" -i "${chunks[1]}" -filter_complex "acrossfade=d=${overlap}:c1=tri:c2=tri" "${outputPath}"`,
      { stdio: "pipe", timeout: 120000 }
    );
    return;
  }

  // For 3+ chunks: build a single-pass filter chain with multi-threading
  // [0][1]acrossfade -> [a01], [a01][2]acrossfade -> [a012], etc.
  const inputs = chunks.map((c) => `-i "${c}"`).join(" ");

  let filterComplex = "";
  let prevLabel = "0:a";

  for (let i = 1; i < chunks.length; i++) {
    const outLabel = i === chunks.length - 1 ? "out" : `a${i}`;
    filterComplex += `[${prevLabel}][${i}:a]acrossfade=d=${overlap}:c1=tri:c2=tri[${outLabel}]`;
    if (i < chunks.length - 1) filterComplex += ";";
    prevLabel = outLabel;
  }

  execSync(
    `ffmpeg -y -threads 0 ${inputs} -filter_complex "${filterComplex}" -map "[out]" "${outputPath}"`,
    { stdio: "pipe", timeout: 300000, maxBuffer: 50 * 1024 * 1024 }
  );
}

/**
 * PARALLEL Split - Process long audio in parallel chunks
 *
 * @param {string} audioPath - Path to source audio
 * @param {string} outputDir - Output directory
 * @param {object} options - Split options
 * @param {number} options.chunkDuration - Duration of each chunk in seconds
 * @param {number} options.overlap - Overlap between chunks for crossfade
 * @param {number} options.maxParallel - Max concurrent Replicate calls
 * @param {string} options.model - Demucs model: "htdemucs" (default) or "htdemucs_ft" (better quality)
 * @param {number} options.shifts - Number of random shifts (1=fast, 2=better quality)
 */
async function splitParallel(audioPath, outputDir, options = {}) {
  const {
    chunkDuration = PARALLEL_CONFIG.chunkDuration,
    overlap = PARALLEL_CONFIG.overlap,
    maxTPS = PARALLEL_CONFIG.maxTPS,
    model = "htdemucs", // htdemucs_ft for better quality
    shifts = 1, // 2 for better quality (slower)
    useCache = true, // Enable caching by default
  } = options;

  const duration = getDuration(audioPath);
  const numChunks = Math.ceil(duration / chunkDuration);
  const estimatedCost = numChunks * 0.034;

  console.log(`\n${"═".repeat(60)}`);
  console.log(`🎭 SPLIT: Parallel Audio Separation (${numChunks} chunks)`);
  console.log(`${"═".repeat(60)}`);
  
  // ═══════════════════════════════════════════════════════════════
  // CHECK CACHE FIRST - Skip expensive Demucs if already processed
  // ═══════════════════════════════════════════════════════════════
  if (useCache) {
    const cacheKey = getDemucsKey(audioPath, model);
    const cached = getCachedDemucs(cacheKey);
    
    if (cached) {
      console.log(`   ⚡ Found in cache! Copying...`);
      
      const vocalsPath = path.join(outputDir, "vocals.mp3");
      const backgroundPath = path.join(outputDir, "background.mp3");
      
      fs.copyFileSync(cached.vocals, vocalsPath);
      fs.copyFileSync(cached.background, backgroundPath);
      
      const vocalsSize = fs.statSync(vocalsPath).size;
      const bgSize = fs.statSync(backgroundPath).size;
      
      console.log(`   ✅ Loaded from cache!`);
      console.log(`   📁 Vocals: ${(vocalsSize / 1024 / 1024).toFixed(1)} MB`);
      console.log(`   📁 Background: ${(bgSize / 1024 / 1024).toFixed(1)} MB`);
      console.log(`   💰 Saved ~$${estimatedCost.toFixed(2)} and ~3 minutes!`);
      
      return {
        vocals: vocalsPath,
        background: backgroundPath,
        fromCache: true,
        cacheKey,
        duration: getDuration(vocalsPath),
        processingTime: 0,
      };
    }
    
    // Store cache key for later
    options._cacheKey = cacheKey;
  }
  
  console.log(`   Input: ${path.basename(audioPath)}`);
  console.log(`   Duration: ${(duration / 60).toFixed(1)} min`);
  console.log(
    `   Chunks: ${numChunks} × ${(chunkDuration / 60).toFixed(0)} min`
  );
  console.log(`   Overlap: ${overlap}s (for crossfade)`);
  console.log(`   TPS Limit: ${maxTPS} requests/second`);
  console.log(`   Model: ${model}${shifts > 1 ? ` (shifts=${shifts})` : ""}`);
  console.log(`   Estimated cost: ~$${estimatedCost.toFixed(2)}`);

  const startTime = Date.now();
  const tempDir = path.join(outputDir, "_split_temp");
  fs.mkdirSync(tempDir, { recursive: true });

  // Internal timing for substeps
  const substepTimings = {};

  // Step 1: Split into chunks (PARALLEL - all at once!)
  console.log(`\n   📦 Splitting audio into ${numChunks} chunks (parallel)...`);
  const splitStart = Date.now();
  const chunks = await splitIntoChunks(
    audioPath,
    tempDir,
    chunkDuration,
    overlap
  );
  substepTimings.chunking = (Date.now() - splitStart) / 1000;
  console.log(
    `      Created ${chunks.length} chunks in ${substepTimings.chunking.toFixed(
      1
    )}s`
  );

  // Step 2: Process chunks TRULY in parallel with rate-limited launches
  // ConcurrentRateLimiter launches at TPS rate but runs all concurrently on Replicate
  // (TPSLimiter was sequential - awaited each task before starting next!)
  console.log(`\n   🚀 Processing ${chunks.length} chunks in PARALLEL (${maxTPS} TPS launch rate, all concurrent)...`);
  const demucsStart = Date.now();
  const results = [];
  const failed = [];

  const concurrentLimiter = new ConcurrentRateLimiter(maxTPS, chunks.length);

  const allResults = await concurrentLimiter.processAll(
    chunks,
    async (chunk, idx) => {
      try {
        const result = await processChunk(chunk, tempDir, { model, shifts });
        console.log(`      ✅ Chunk ${chunk.index} complete`);
        return { success: true, result, chunk };
      } catch (err) {
        console.log(`      ❌ Chunk ${chunk.index} failed: ${err.message}`);
        return { success: false, chunk, error: err };
      }
    },
    (completed, total) => {
      if (completed % 3 === 0 || completed === total) {
        console.log(`      ⏳ ${completed}/${total} chunks done`);
      }
    }
  );

  // Separate successes and failures
  for (const item of allResults) {
    if (item && item.success) {
      results.push(item.result);
    } else if (item && item.chunk) {
      failed.push(item.chunk.index);
    } else if (item && item.error) {
      // ConcurrentRateLimiter internal error format
      failed.push(item.idx ?? -1);
    }
  }

  substepTimings.demucs_api = (Date.now() - demucsStart) / 1000;
  console.log(
    `\n      📊 Results: ${results.length}/${chunks.length} chunks succeeded`
  );
  console.log(
    `      ⏱️ Demucs API time: ${substepTimings.demucs_api.toFixed(1)}s`
  );

  // CRITICAL: Validate we got all chunks
  if (results.length < chunks.length) {
    console.log(`      ⚠️ Missing chunks: ${failed.join(", ")}`);

    // If we're missing too many chunks, abort
    if (results.length < chunks.length * 0.8) {
      throw new Error(
        `Too many chunks failed (${failed.length}/${chunks.length}). Aborting parallel split.`
      );
    }

    console.log(
      `      ⚠️ Continuing with ${results.length} chunks (some audio will be missing)`
    );
  }

  // Step 3: Stitch vocals together
  const stitchStart = Date.now();
  process.stdout.write(
    `\n   🧵 Stitching vocals (${results.length} chunks)...`
  );
  const vocalsPath = path.join(outputDir, "vocals.mp3");
  const vocalChunks = results
    .sort((a, b) => a.index - b.index)
    .map((r) => r.vocals);
  stitchChunks(vocalChunks, vocalsPath, overlap);
  console.log(` done`);

  // Step 4: Stitch background together
  process.stdout.write(`   🧵 Stitching background...`);
  const backgroundPath = path.join(outputDir, "background.mp3");
  const bgChunks = results
    .sort((a, b) => a.index - b.index)
    .map((r) => r.background);
  stitchChunks(bgChunks, backgroundPath, overlap);
  substepTimings.stitching = (Date.now() - stitchStart) / 1000;
  console.log(` done (${substepTimings.stitching.toFixed(1)}s total)`);

  // Cleanup temp files
  console.log(`   🧹 Cleaning up temp files...`);
  try {
    fs.rmSync(tempDir, { recursive: true, force: true });
  } catch {}

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  const vocalsDuration = getDuration(vocalsPath);
  const vocalsSize = fs.statSync(vocalsPath).size;
  const backgroundSize = fs.statSync(backgroundPath).size;

  console.log(`\n   ✅ PARALLEL SEPARATION COMPLETE in ${elapsed}s`);
  console.log(`   📁 Vocals: vocals.mp3`);
  console.log(`      Duration: ${vocalsDuration?.toFixed(2)}s`);
  console.log(`      Size: ${(vocalsSize / 1024 / 1024).toFixed(1)} MB`);
  console.log(`   📁 Background: background.mp3`);
  console.log(`      Size: ${(backgroundSize / 1024 / 1024).toFixed(1)} MB`);

  // Print substep timing breakdown
  console.log(`   ⏱️ Substep breakdown:`);
  console.log(
    `      Chunking:   ${substepTimings.chunking.toFixed(1)}s (${(
      (substepTimings.chunking / parseFloat(elapsed)) *
      100
    ).toFixed(0)}%)`
  );
  console.log(
    `      Demucs API: ${substepTimings.demucs_api.toFixed(1)}s (${(
      (substepTimings.demucs_api / parseFloat(elapsed)) *
      100
    ).toFixed(0)}%)`
  );
  console.log(
    `      Stitching:  ${substepTimings.stitching.toFixed(1)}s (${(
      (substepTimings.stitching / parseFloat(elapsed)) *
      100
    ).toFixed(0)}%)`
  );

  // Cache the results for future use
  if (useCache && options._cacheKey) {
    cacheDemucs(vocalsPath, backgroundPath, options._cacheKey);
  }

  return {
    vocals: vocalsPath,
    background: backgroundPath,
    vocalsDuration,
    backgroundDuration: getDuration(backgroundPath),
    processingTime: parseFloat(elapsed),
    provider: "replicate-parallel",
    chunks: numChunks,
    substepTimings,
    fromCache: false,
    cacheKey: options._cacheKey,
  };
}

/**
 * Split audio using Spleeter (cheap & fast alternative)
 * ~$0.00025/run, ~2 seconds, decent quality
 * No chunking needed - Spleeter handles any length
 */
async function splitSpleeter(audioPath, outputDir, options = {}) {
  const { useCache = true, verbose = true } = options;

  console.log(`\n${"═".repeat(60)}`);
  console.log(`🎭 SPLIT: Audio Separation (Spleeter - Fast/Cheap)`);
  console.log(`${"═".repeat(60)}`);

  // Check cache (use "spleeter" as model in cache key)
  if (useCache) {
    const cacheKey = getDemucsKey(audioPath, "spleeter");
    const cached = getCachedDemucs(cacheKey);
    
    if (cached) {
      console.log(`   ⚡ Found in cache! Copying...`);
      
      const vocalsPath = path.join(outputDir, "vocals.mp3");
      const backgroundPath = path.join(outputDir, "background.mp3");
      
      fs.copyFileSync(cached.vocals, vocalsPath);
      fs.copyFileSync(cached.background, backgroundPath);
      
      console.log(`   ✅ Loaded from cache!`);
      console.log(`   💰 Saved ~$0.00025 and processing time!`);
      
      return {
        vocals: vocalsPath,
        background: backgroundPath,
        fromCache: true,
        cacheKey,
        duration: getDuration(vocalsPath),
        processingTime: 0,
        engine: "spleeter",
      };
    }
    
    options._cacheKey = cacheKey;
  }

  const startTime = Date.now();
  const duration = getDuration(audioPath);
  console.log(`   Duration: ${(duration / 60).toFixed(1)} min`);
  console.log(`   Estimated cost: ~$0.00025`);
  console.log(`   Expected time: ~2-5 seconds`);

  // Spleeter can handle full audio files directly
  const audioBuffer = fs.readFileSync(audioPath);

  console.log(`\n   📤 Uploading to Spleeter...`);
  const output = await replicate.run(SPLEETER_MODEL, {
    input: {
      audio: audioBuffer,
    },
  });

  // Spleeter returns { vocals: FileOutput/URL, accompaniment: FileOutput/URL }
  const vocalsUrl = output.vocals;
  const bgUrl = output.accompaniment;

  if (!vocalsUrl) {
    throw new Error("Spleeter returned no vocals output");
  }

  // Spleeter outputs WAV, we'll convert to mp3 for consistency
  const vocalsWav = path.join(outputDir, "vocals_spleeter.wav");
  const bgWav = path.join(outputDir, "background_spleeter.wav");
  const vocalsPath = path.join(outputDir, "vocals.mp3");
  const backgroundPath = path.join(outputDir, "background.mp3");

  // Download outputs
  console.log(`   📥 Downloading separated stems...`);
  await Promise.all([
    downloadFile(vocalsUrl, vocalsWav),
    bgUrl ? downloadFile(bgUrl, bgWav) : Promise.resolve(),
  ]);

  // Convert to mp3 for consistency with Demucs output
  console.log(`   🔄 Converting to mp3...`);
  try {
    execSync(`ffmpeg -y -i "${vocalsWav}" -codec:a libmp3lame -b:a 320k "${vocalsPath}" 2>/dev/null`, { stdio: 'pipe' });
    if (fs.existsSync(bgWav)) {
      execSync(`ffmpeg -y -i "${bgWav}" -codec:a libmp3lame -b:a 320k "${backgroundPath}" 2>/dev/null`, { stdio: 'pipe' });
    }
    // Clean up WAV files
    try { fs.unlinkSync(vocalsWav); } catch {}
    try { fs.unlinkSync(bgWav); } catch {}
  } catch {
    // If conversion fails, just rename
    if (fs.existsSync(vocalsWav)) fs.renameSync(vocalsWav, vocalsPath);
    if (fs.existsSync(bgWav)) fs.renameSync(bgWav, backgroundPath);
  }

  // If no background exists, use original audio as fallback
  if (!fs.existsSync(backgroundPath)) {
    console.log(`   ⚠️ No accompaniment from Spleeter, using original audio as background`);
    fs.copyFileSync(audioPath, backgroundPath);
  }

  const processingTime = (Date.now() - startTime) / 1000;
  console.log(`\n   ✅ Spleeter separation complete in ${processingTime.toFixed(1)}s`);
  console.log(`   💰 Cost: ~$0.00025`);

  // Cache the result
  if (useCache && options._cacheKey) {
    cacheDemucs(vocalsPath, backgroundPath, options._cacheKey);
    console.log(`   💾 Cached for future use`);
  }

  return {
    vocals: vocalsPath,
    background: backgroundPath,
    fromCache: false,
    cacheKey: options._cacheKey,
    duration: getDuration(vocalsPath),
    processingTime,
    engine: "spleeter",
  };
}

/**
 * Main split function - automatically uses parallel for long audio
 * Supports engine selection: "demucs" (default) or "spleeter" (cheap)
 */
async function split(audioPath, outputDir, options = {}) {
  const duration = getDuration(audioPath);

  // Check if Spleeter engine requested (cheap/fast option)
  const engine = options.engine || (options.model === "spleeter" ? "spleeter" : "demucs");
  if (engine === "spleeter") {
    return splitSpleeter(audioPath, outputDir, options);
  }

  // Use parallel processing for audio longer than threshold
  if (duration > PARALLEL_CONFIG.minDurationForParallel) {
    return splitParallel(audioPath, outputDir, options);
  }

  // Original sequential processing for short audio
  const { stem = "vocals", verbose = true, useCache = true, model = "htdemucs" } = options;

  console.log(`\n${"═".repeat(60)}`);
  console.log(`🎭 SPLIT: Audio Separation (Replicate Demucs)`);
  console.log(`${"═".repeat(60)}`);
  
  // Check cache first for short audio too
  if (useCache) {
    const cacheKey = getDemucsKey(audioPath, model);
    const cached = getCachedDemucs(cacheKey);
    
    if (cached) {
      console.log(`   ⚡ Found in cache! Copying...`);
      
      const vocalsPath = path.join(outputDir, "vocals.mp3");
      const backgroundPath = path.join(outputDir, "background.mp3");
      
      fs.copyFileSync(cached.vocals, vocalsPath);
      fs.copyFileSync(cached.background, backgroundPath);
      
      console.log(`   ✅ Loaded from cache!`);
      console.log(`   💰 Saved ~$0.03 and processing time!`);
      
      return {
        vocals: vocalsPath,
        background: backgroundPath,
        fromCache: true,
        cacheKey,
        duration: getDuration(vocalsPath),
        processingTime: 0,
      };
    }
    
    options._cacheKey = cacheKey;
  }

  if (!process.env.REPLICATE_API_TOKEN && !process.env.REPLICATE_API_KEY) {
    throw new Error(
      "REPLICATE_API_TOKEN not set!\n" +
        "Get your token at: https://replicate.com/account/api-tokens"
    );
  }

  const inputSize = fs.statSync(audioPath).size;

  console.log(`   Input: ${path.basename(audioPath)}`);
  console.log(`   Duration: ${duration?.toFixed(2)}s`);
  console.log(`   Size: ${(inputSize / 1024 / 1024).toFixed(1)} MB`);
  console.log(`   Estimated cost: ~$0.034`);

  const startTime = Date.now();

  // Always compress for faster upload
  let uploadPath = audioPath;
  const ext = path.extname(audioPath).toLowerCase();

  if (ext === ".wav" || inputSize > MAX_UPLOAD_SIZE) {
    console.log(`\n   🗜️ Compressing for faster upload...`);
    const compressedPath = path.join(outputDir, "source_audio_compressed.mp3");
    compressToMp3(audioPath, compressedPath);
    const compressedSize = fs.statSync(compressedPath).size;
    console.log(
      `      ${(inputSize / 1024 / 1024).toFixed(1)} MB → ${(
        compressedSize /
        1024 /
        1024
      ).toFixed(1)} MB`
    );
    uploadPath = compressedPath;
  }

  console.log(`\n   📤 Uploading to Replicate...`);
  const audioBuffer = fs.readFileSync(uploadPath);

  console.log(`   🔄 Running Demucs separation...`);

  let output;
  try {
    output = await replicate.run(DEMUCS_MODEL, {
      input: {
        audio: audioBuffer,
        model: "htdemucs",
        stem: "none",
        split: true,
        jobs: 0,
        shifts: 1,
        overlap: 0.25,
        clip_mode: "rescale",
        output_format: "mp3",
        mp3_bitrate: 320,
        mp3_preset: 2,
      },
    });
  } catch (error) {
    if (error.message?.includes("Invalid token")) {
      throw new Error("Invalid Replicate API token!");
    }
    throw error;
  }

  console.log(`   ✅ Separation complete`);
  console.log(`   📥 Downloading stems...`);

  const vocalsDest = path.join(outputDir, "vocals.mp3");
  const backgroundDest = path.join(outputDir, "background.mp3");

  // Download vocals
  if (output.vocals) {
    console.log(`   Downloading vocals...`);
    await downloadFile(output.vocals, vocalsDest);
  }

  // Download and merge background stems
  const bgStems = [];
  const tempFiles = [];

  for (const [stemName, stemUrl] of Object.entries(output)) {
    if (stemName !== "vocals" && stemUrl) {
      const tempPath = path.join(outputDir, `_${stemName}.mp3`);
      console.log(`   Downloading ${stemName}...`);
      await downloadFile(stemUrl, tempPath);
      bgStems.push(tempPath);
      tempFiles.push(tempPath);
    }
  }

  if (bgStems.length > 0) {
    console.log(`   🔧 Merging ${bgStems.length} stems into background...`);
    if (bgStems.length === 1) {
      fs.renameSync(bgStems[0], backgroundDest);
      tempFiles.splice(tempFiles.indexOf(bgStems[0]), 1);
    } else {
      const inputs = bgStems.map((f) => `-i "${f}"`).join(" ");
      execSync(
        `ffmpeg -y ${inputs} -filter_complex "amix=inputs=${bgStems.length}:duration=longest:normalize=0" "${backgroundDest}"`,
        { stdio: "pipe" }
      );
    }
    tempFiles.forEach((f) => {
      try {
        fs.unlinkSync(f);
      } catch {}
    });
  }

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  const vocalsDuration = getDuration(vocalsDest);
  const vocalsSize = fs.statSync(vocalsDest).size;
  const backgroundSize = fs.statSync(backgroundDest).size;

  console.log(`\n   ✅ SEPARATION COMPLETE in ${elapsed}s`);
  console.log(`   📁 Vocals: vocals.mp3`);
  console.log(`      Duration: ${vocalsDuration?.toFixed(2)}s`);
  console.log(`      Size: ${(vocalsSize / 1024 / 1024).toFixed(1)} MB`);
  console.log(`   📁 Background: background.mp3`);
  console.log(`      Size: ${(backgroundSize / 1024 / 1024).toFixed(1)} MB`);

  // Cache results for future use
  if (useCache && options._cacheKey) {
    cacheDemucs(vocalsDest, backgroundDest, options._cacheKey);
  }

  return {
    vocals: vocalsDest,
    background: backgroundDest,
    vocalsDuration,
    backgroundDuration: getDuration(backgroundDest),
    processingTime: parseFloat(elapsed),
    provider: "replicate",
    fromCache: false,
    cacheKey: options._cacheKey,
  };
}

/**
 * Validate separation quality
 */
function validateSeparation(vocalsPath, backgroundPath) {
  console.log(`\n   🔍 Validating separation quality...`);

  const vocalsLevels = analyzeAudioLevels(vocalsPath);
  const backgroundLevels = analyzeAudioLevels(backgroundPath);

  console.log(
    `   Vocals: mean=${vocalsLevels.meanVolume?.toFixed(
      1
    )}dB, peak=${vocalsLevels.maxVolume?.toFixed(1)}dB`
  );
  console.log(
    `   Background: mean=${backgroundLevels.meanVolume?.toFixed(
      1
    )}dB, peak=${backgroundLevels.maxVolume?.toFixed(1)}dB`
  );

  const issues = [];

  if (vocalsLevels.meanVolume && vocalsLevels.meanVolume < -50) {
    issues.push("Vocals track is very quiet - source may have no speech");
  }

  if (vocalsLevels.meanVolume && backgroundLevels.meanVolume) {
    const diff = vocalsLevels.meanVolume - backgroundLevels.meanVolume;
    if (diff < -10) {
      issues.push(
        "Background is louder than vocals - source may be music-heavy"
      );
    }
  }

  const isValid = issues.length === 0;

  if (isValid) {
    console.log(`   ✅ Separation looks good!`);
  } else {
    console.log(`   ⚠️ Potential issues:`);
    issues.forEach((issue) => console.log(`      - ${issue}`));
  }

  return { valid: isValid, issues, vocalsLevels, backgroundLevels };
}

/**
 * Check system requirements
 */
function checkSystemRequirements() {
  const results = {
    replicateKeySet: !!(
      process.env.REPLICATE_API_TOKEN || process.env.REPLICATE_API_KEY
    ),
    ffmpegInstalled: false,
  };

  try {
    execSync("ffmpeg -version", { stdio: "pipe" });
    results.ffmpegInstalled = true;
  } catch {}

  return results;
}

module.exports = {
  split,
  splitParallel,
  splitSpleeter,
  validateSeparation,
  checkSystemRequirements,
  analyzeAudioLevels,
  getDuration,
  PARALLEL_CONFIG,
  SEPARATION_MODELS,
  // Cache functions
  getDemucsKey,
  getCachedDemucs,
  cacheDemucs,
  DEMUCS_CACHE_DIR,
};
