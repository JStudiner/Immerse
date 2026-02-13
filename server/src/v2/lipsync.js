/**
 * Immersion v2 - Lip Sync Module
 *
 * Instead of trying to fit audio to video timing (which sounds unnatural),
 * we generate natural-paced audio and use AI to sync the video's lips to match.
 *
 * Supported providers:
 * - Sync Labs (sync.so) - High quality lip-sync API
 * - (Future: Wav2Lip local, HeyGen, etc.)
 *
 * Flow:
 * 1. Generate TTS at natural pace (no timing constraints)
 * 2. Concatenate all TTS segments with natural pauses
 * 3. Send video + dubbed audio to lip-sync API
 * 4. Get back video with lips matching the audio
 */

const fs = require("fs");
const path = require("path");
const https = require("https");
const { execSync } = require("child_process");

const SYNCLABS_API_KEY = process.env.SYNCLABS_API_KEY;
const SYNCLABS_ENDPOINT = "https://api.sync.so/v2/generate";
const SYNCLABS_HOST = "api.sync.so";
const SYNCLABS_PATH = "/v2/generate";

/**
 * Lip sync providers
 */
const LIPSYNC_PROVIDERS = {
  synclabs: "synclabs",
  // Future: wav2lip, heygen, etc.
};

/**
 * Sync Labs model options
 * From docs: https://docs.synclabs.so/
 */
const SYNCLABS_MODELS = {
  cheap: "lipsync-1.9.0-beta",   // Fast & cheap, $0.02-0.025/sec (DEFAULT)
  legacy: "lipsync-1.9.0-beta",  // Alias for cheap
  standard: "lipsync-2",         // Best balance, $0.04-0.05/sec  
  pro: "lipsync-2-pro",          // Highest quality (paid only), $0.067-0.083/sec
};

/**
 * Check if Sync Labs API key is set
 */
function checkApiKey() {
  return !!SYNCLABS_API_KEY;
}

/**
 * Concatenate TTS segments into a single audio file with natural timing
 * Uses segment start times to place audio, filling gaps with silence
 *
 * @param {array} segments - TTS segments with alignedFile and start times
 * @param {string} outputPath - Output audio file path
 * @param {object} options - Options
 * @returns {Promise<object>} Result with duration and path
 */
async function concatenateSegments(segments, outputPath, options = {}) {
  const {
    sampleRate = 44100,
    naturalPause = 0.3, // Minimum pause between segments (seconds)
  } = options;

  // Sort segments by start time
  const sorted = [...segments]
    .filter((s) => s.alignedFile && fs.existsSync(s.alignedFile))
    .sort((a, b) => a.start - b.start);

  if (sorted.length === 0) {
    throw new Error("No valid TTS segments to concatenate");
  }

  console.log(`   📼 Concatenating ${sorted.length} TTS segments...`);

  // Build FFmpeg filter for concatenation with gaps
  // We'll create a complex filter that:
  // 1. Pads each segment with silence to match its start time
  // 2. Concatenates everything

  // Calculate total duration needed (last segment end + its duration)
  const lastSeg = sorted[sorted.length - 1];
  const lastDuration = lastSeg.alignedDuration || lastSeg.actualDuration || 3;
  const totalDuration = lastSeg.start + lastDuration + 1; // +1 buffer

  // Create input list for FFmpeg
  const inputFiles = sorted.map((s) => `-i "${s.alignedFile}"`).join(" ");

  // Build adelay filter - delay each input to its start time
  const filterParts = sorted.map((seg, i) => {
    const delayMs = Math.round(seg.start * 1000);
    return `[${i}:a]adelay=${delayMs}|${delayMs}[a${i}]`;
  });

  // Mix all delayed streams
  const mixInputs = sorted.map((_, i) => `[a${i}]`).join("");
  const filterComplex = `${filterParts.join(";")};${mixInputs}amix=inputs=${sorted.length}:duration=longest:dropout_transition=0[out]`;

  const cmd = `ffmpeg -y ${inputFiles} -filter_complex "${filterComplex}" -map "[out]" -ar ${sampleRate} -ac 2 "${outputPath}"`;

  try {
    execSync(cmd, { stdio: "pipe", timeout: 120000 });

    const stats = fs.statSync(outputPath);
    const duration = getAudioDuration(outputPath);

    console.log(`   ✅ Concatenated: ${duration.toFixed(1)}s, ${(stats.size / 1024 / 1024).toFixed(1)}MB`);

    return {
      path: outputPath,
      duration,
      size: stats.size,
      segmentCount: sorted.length,
    };
  } catch (error) {
    throw new Error(`Failed to concatenate segments: ${error.message}`);
  }
}

/**
 * Get audio duration using ffprobe
 */
function getAudioDuration(filePath) {
  try {
    const result = execSync(
      `ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "${filePath}"`,
      { encoding: "utf-8", timeout: 10000 }
    );
    return parseFloat(result.trim());
  } catch {
    return 0;
  }
}

/**
 * Upload file and get URL for Sync Labs
 * Sync Labs needs publicly accessible URLs, so we need to either:
 * 1. Use a file hosting service
 * 2. Use their upload endpoint
 *
 * For now, we'll use base64 encoding which some APIs support
 */
async function uploadForSyncLabs(filePath) {
  // Read file as base64
  const buffer = fs.readFileSync(filePath);
  const base64 = buffer.toString("base64");
  const mimeType = filePath.endsWith(".mp4")
    ? "video/mp4"
    : filePath.endsWith(".mp3")
      ? "audio/mpeg"
      : "audio/wav";

  return `data:${mimeType};base64,${base64}`;
}

/**
 * Submit lip-sync job to Sync Labs
 *
 * @param {string} videoPath - Path to input video
 * @param {string} audioPath - Path to dubbed audio
 * @param {object} options - Options
 * @returns {Promise<object>} Job info with ID
 */
async function submitLipsyncJob(videoPath, audioPath, options = {}) {
  const { 
    model = SYNCLABS_MODELS.standard, // lipsync-2 by default
    webhookUrl = null,
    maxCredits = null, // Optional credit limit
  } = options;

  if (!SYNCLABS_API_KEY) {
    throw new Error(
      "SYNCLABS_API_KEY not set!\n" +
        "Add to .env: SYNCLABS_API_KEY=your_key_here\n" +
        "Get your API key at: https://sync.so"
    );
  }

  console.log(`\n${"═".repeat(60)}`);
  console.log(`👄 LIPSYNC: Submitting to Sync Labs`);
  console.log(`${"═".repeat(60)}`);
  console.log(`   Video: ${path.basename(videoPath)}`);
  console.log(`   Audio: ${path.basename(audioPath)}`);
  console.log(`   Model: ${model}`);

  const videoSize = fs.statSync(videoPath).size;
  const audioSize = fs.statSync(audioPath).size;
  console.log(`   📤 Uploading ${(videoSize / 1024 / 1024).toFixed(1)}MB video + ${(audioSize / 1024 / 1024).toFixed(1)}MB audio...`);

  // Use FormData for multipart upload with https module (more reliable)
  const FormData = require("form-data");
  const form = new FormData();

  // Add model
  form.append("model", model);
  
  // Add video file
  form.append("video", fs.createReadStream(videoPath), {
    filename: path.basename(videoPath),
    contentType: "video/mp4",
  });
  
  // Add audio file  
  form.append("audio", fs.createReadStream(audioPath), {
    filename: path.basename(audioPath),
    contentType: "audio/mp4",
  });

  if (webhookUrl) {
    form.append("webhookUrl", webhookUrl);
  }

  if (maxCredits) {
    form.append("maxCredits", maxCredits.toString());
  }

  // Use https module for reliable form-data upload
  return new Promise((resolve, reject) => {
    const options = {
      hostname: SYNCLABS_HOST,
      path: SYNCLABS_PATH,
      method: "POST",
      headers: {
        "x-api-key": SYNCLABS_API_KEY,
        ...form.getHeaders(),
      },
    };

    const req = https.request(options, (res) => {
      let data = "";
      res.on("data", (chunk) => (data += chunk));
      res.on("end", () => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          try {
            const result = JSON.parse(data);
            console.log(`   ✅ Job submitted: ${result.id}`);
            resolve({
              id: result.id,
              status: result.status,
              provider: "synclabs",
            });
          } catch (e) {
            reject(new Error(`Failed to parse response: ${data}`));
          }
        } else {
          console.error(`   ❌ API Response (${res.statusCode}): ${data}`);
          reject(new Error(`Sync Labs API error: ${res.statusCode} ${data}`));
        }
      });
    });

    req.on("error", (error) => {
      console.error(`   ❌ Request error: ${error.message}`);
      reject(new Error(`Failed to submit lipsync job: ${error.message}`));
    });

    // Pipe form data to request
    form.pipe(req);
  });
}

/**
 * Poll for lip-sync job completion
 *
 * @param {string} jobId - Job ID from submitLipsyncJob
 * @param {object} options - Options
 * @returns {Promise<object>} Completed job with output URL
 */
async function pollLipsyncJob(jobId, options = {}) {
  const {
    pollInterval = 15000, // 15 seconds
    maxWait = 1800000, // 30 minutes (lip-sync can take a while for longer videos)
  } = options;

  const statusEndpoint = `https://api.sync.so/v2/generate/${jobId}`;
  const startTime = Date.now();

  console.log(`   ⏳ Waiting for lip-sync processing...`);

  while (Date.now() - startTime < maxWait) {
    try {
      const response = await fetch(statusEndpoint, {
        headers: {
          "x-api-key": SYNCLABS_API_KEY,
        },
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Status check failed: ${response.status} ${errorText}`);
      }

      const result = await response.json();

      // Check various completion states
      const status = result.status?.toUpperCase() || result.state?.toUpperCase();
      
      if (status === "COMPLETED" || status === "SUCCEEDED" || status === "SUCCESS") {
        console.log(`\n   ✅ Lip-sync complete!`);
        return {
          id: jobId,
          status: "completed",
          outputUrl: result.output_url || result.outputUrl || result.video_url || result.result?.url,
          duration: (Date.now() - startTime) / 1000,
          credits: result.credits_used || result.credits,
        };
      } else if (status === "FAILED" || status === "ERROR") {
        throw new Error(`Lip-sync job failed: ${result.error || result.message || "Unknown error"}`);
      }

      // Still processing
      const elapsed = ((Date.now() - startTime) / 1000).toFixed(0);
      const progress = result.progress ? ` ${(result.progress * 100).toFixed(0)}%` : "";
      process.stdout.write(`\r   ⏳ Processing... ${elapsed}s (${status || "processing"})${progress}    `);

      await new Promise((resolve) => setTimeout(resolve, pollInterval));
    } catch (error) {
      if (error.message.includes("Status check failed")) {
        throw error;
      }
      throw new Error(`Failed to poll lipsync job: ${error.message}`);
    }
  }

  throw new Error(`Lip-sync job timed out after ${maxWait / 1000}s`);
}

/**
 * Download lip-synced video
 *
 * @param {string} url - URL of the lip-synced video
 * @param {string} outputPath - Where to save the video
 * @returns {Promise<object>} Result with path and size
 */
async function downloadLipsyncResult(url, outputPath) {
  console.log(`   📥 Downloading lip-synced video...`);

  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to download: ${response.status}`);
  }

  const buffer = Buffer.from(await response.arrayBuffer());
  fs.writeFileSync(outputPath, buffer);

  const stats = fs.statSync(outputPath);
  console.log(`   ✅ Downloaded: ${(stats.size / 1024 / 1024).toFixed(1)}MB`);

  return {
    path: outputPath,
    size: stats.size,
  };
}

/**
 * Full lip-sync pipeline
 *
 * @param {string} videoPath - Original video
 * @param {string} audioPath - Dubbed audio
 * @param {string} outputPath - Output video path
 * @param {object} options - Options
 * @returns {Promise<object>} Result with output path
 */
async function lipsync(videoPath, audioPath, outputPath, options = {}) {
  const { 
    provider = "synclabs",
    model = SYNCLABS_MODELS.standard, // lipsync-2 by default
  } = options;

  console.log(`\n${"═".repeat(60)}`);
  console.log(`👄 LIPSYNC: Full Pipeline`);
  console.log(`${"═".repeat(60)}`);

  if (provider === "synclabs") {
    // Submit job
    const job = await submitLipsyncJob(videoPath, audioPath, { ...options, model });

    // Poll for completion
    const result = await pollLipsyncJob(job.id, options);

    if (!result.outputUrl) {
      throw new Error("No output URL returned from Sync Labs");
    }

    // Download result
    const download = await downloadLipsyncResult(result.outputUrl, outputPath);

    return {
      success: true,
      provider: "synclabs",
      model,
      jobId: job.id,
      processingTime: result.duration,
      creditsUsed: result.credits,
      output: {
        path: outputPath,
        size: download.size,
      },
    };
  }

  throw new Error(`Unknown lipsync provider: ${provider}`);
}

/**
 * Generate TTS without timing constraints (for lipsync mode)
 * Just generates natural-paced audio, doesn't try to match video timing
 *
 * @param {array} segments - Translated segments
 * @param {string} outputDir - Output directory
 * @param {object} ttsOptions - TTS generation options
 * @returns {Promise<object>} TTS result with natural-paced audio
 */
async function generateNaturalTTS(segments, outputDir, ttsOptions = {}) {
  // Import TTS module
  const { generateTTS } = require("./tts");

  console.log(`\n${"═".repeat(60)}`);
  console.log(`🎙️ LIPSYNC MODE: Generating Natural-Paced TTS`);
  console.log(`${"═".repeat(60)}`);
  console.log(`   ℹ️  No timing constraints - natural speech pace`);
  console.log(`   ℹ️  Video lips will be synced to match audio`);

  // Generate TTS with relaxed settings
  const result = await generateTTS(segments, outputDir, {
    ...ttsOptions,
    mode: "synced", // Use synced mode but we won't enforce timing
    durationTolerance: 1.0, // Accept any duration (100% tolerance)
    maxRetries: 0, // No retries for timing
  });

  return result;
}

module.exports = {
  // Main functions
  lipsync,
  generateNaturalTTS,
  concatenateSegments,

  // Sync Labs specific
  submitLipsyncJob,
  pollLipsyncJob,
  downloadLipsyncResult,

  // Utilities
  checkApiKey,
  getAudioDuration,
  uploadForSyncLabs,

  // Constants
  LIPSYNC_PROVIDERS,
  SYNCLABS_MODELS,
};
