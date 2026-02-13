/**
 * Voice Extraction Module
 * 
 * Extract voice samples from various sources for voice cloning:
 * 1. From the input video itself (default - clone speaker's voice)
 * 2. From an external audio file (custom narrator voice)
 * 3. From a YouTube video (extract a specific person's voice)
 * 
 * Used for XTTS voice cloning
 */

const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");
const crypto = require("crypto");
const youtubedl = require("youtube-dl-exec");

// Voice sample requirements for XTTS
const VOICE_SAMPLE_CONFIG = {
  minDuration: 6,      // Minimum 6 seconds of clean audio
  maxDuration: 30,     // XTTS works best with ~6-30s samples
  targetDuration: 15,  // Ideal sample length
  sampleRate: 22050,   // XTTS expected sample rate
  channels: 1,         // Mono
};

// Cache directory for extracted voice samples
const VOICE_CACHE_DIR = path.join(__dirname, "..", "..", "cache", "voices");

// Cache directory for raw YouTube audio downloads (avoid re-downloading the same video)
const YT_AUDIO_CACHE_DIR = path.join(__dirname, "..", "..", "cache", "youtube_audio");

/**
 * Get audio duration in seconds
 */
function getAudioDuration(filePath) {
  try {
    const result = execSync(
      `ffprobe -v quiet -show_entries format=duration -of csv=p=0 "${filePath}"`,
      { encoding: "utf-8" }
    );
    return parseFloat(result.trim()) || 0;
  } catch (error) {
    return 0;
  }
}

/**
 * Generate hash for caching
 */
function generateHash(input) {
  return crypto.createHash("md5").update(input).digest("hex").substring(0, 12);
}

/**
 * Extract voice sample from a video's vocal track
 * 
 * @param {string} vocalsPath - Path to isolated vocals (from Demucs)
 * @param {string} outputDir - Output directory
 * @param {object} options - Extraction options
 */
async function extractFromVocals(vocalsPath, outputDir, options = {}) {
  const {
    startTime = 10,           // Start 10s in (skip intro)
    duration = VOICE_SAMPLE_CONFIG.targetDuration,
    speakerLabel = "narrator",
  } = options;

  console.log(`\n🎤 VOICE EXTRACTION: From video vocals`);
  console.log(`   Source: ${path.basename(vocalsPath)}`);
  console.log(`   Start: ${startTime}s, Duration: ${duration}s`);

  // Create output directory
  const voiceDir = path.join(outputDir, "voice_samples");
  fs.mkdirSync(voiceDir, { recursive: true });

  const outputPath = path.join(voiceDir, `${speakerLabel}_sample.wav`);

  // Get total duration
  const totalDuration = getAudioDuration(vocalsPath);
  
  // Validate start time
  const actualStart = Math.min(startTime, Math.max(0, totalDuration - duration - 5));
  
  // Extract and process the sample
  const cmd = `ffmpeg -y -i "${vocalsPath}" -ss ${actualStart} -t ${duration} ` +
    `-ar ${VOICE_SAMPLE_CONFIG.sampleRate} -ac ${VOICE_SAMPLE_CONFIG.channels} ` +
    `-af "loudnorm=I=-16:TP=-1.5:LRA=11,highpass=f=80,lowpass=f=8000" ` +
    `"${outputPath}" 2>/dev/null`;

  try {
    execSync(cmd);
    const sampleDuration = getAudioDuration(outputPath);
    
    console.log(`   ✅ Extracted ${sampleDuration.toFixed(1)}s sample`);
    console.log(`   📁 Output: ${outputPath}`);

    return {
      success: true,
      samplePath: outputPath,
      duration: sampleDuration,
      speaker: speakerLabel,
      source: "video_vocals",
    };
  } catch (error) {
    console.error(`   ❌ Extraction failed: ${error.message}`);
    return { success: false, error: error.message };
  }
}

/**
 * Extract voice sample from an external audio file
 * 
 * @param {string} audioPath - Path to audio file (mp3, wav, m4a, etc.)
 * @param {string} outputDir - Output directory
 * @param {object} options - Extraction options
 */
async function extractFromAudioFile(audioPath, outputDir, options = {}) {
  const {
    startTime = 0,
    duration = VOICE_SAMPLE_CONFIG.targetDuration,
    speakerLabel = "external",
    cleanAudio = true,  // Apply noise reduction
  } = options;

  console.log(`\n🎤 VOICE EXTRACTION: From audio file`);
  console.log(`   Source: ${path.basename(audioPath)}`);

  if (!fs.existsSync(audioPath)) {
    return { success: false, error: `File not found: ${audioPath}` };
  }

  // Check cache
  const hash = generateHash(audioPath + startTime + duration);
  fs.mkdirSync(VOICE_CACHE_DIR, { recursive: true });
  const cachedPath = path.join(VOICE_CACHE_DIR, `${hash}_${speakerLabel}.wav`);

  if (fs.existsSync(cachedPath)) {
    console.log(`   ⚡ Found in cache!`);
    return {
      success: true,
      samplePath: cachedPath,
      duration: getAudioDuration(cachedPath),
      speaker: speakerLabel,
      source: "audio_file",
      cached: true,
    };
  }

  const voiceDir = path.join(outputDir, "voice_samples");
  fs.mkdirSync(voiceDir, { recursive: true });
  const outputPath = path.join(voiceDir, `${speakerLabel}_sample.wav`);

  // Build filter chain
  let filters = [
    `loudnorm=I=-16:TP=-1.5:LRA=11`,
  ];

  if (cleanAudio) {
    filters.push(`highpass=f=80`, `lowpass=f=8000`);
  }

  const filterStr = filters.join(",");
  
  const cmd = `ffmpeg -y -i "${audioPath}" -ss ${startTime} -t ${duration} ` +
    `-ar ${VOICE_SAMPLE_CONFIG.sampleRate} -ac ${VOICE_SAMPLE_CONFIG.channels} ` +
    `-af "${filterStr}" "${outputPath}" 2>/dev/null`;

  try {
    execSync(cmd);
    const sampleDuration = getAudioDuration(outputPath);

    if (sampleDuration < VOICE_SAMPLE_CONFIG.minDuration) {
      console.log(`   ⚠️ Sample too short (${sampleDuration.toFixed(1)}s < ${VOICE_SAMPLE_CONFIG.minDuration}s)`);
    }

    // Cache the result
    fs.copyFileSync(outputPath, cachedPath);

    console.log(`   ✅ Extracted ${sampleDuration.toFixed(1)}s sample`);
    console.log(`   📁 Output: ${outputPath}`);

    return {
      success: true,
      samplePath: outputPath,
      duration: sampleDuration,
      speaker: speakerLabel,
      source: "audio_file",
    };
  } catch (error) {
    console.error(`   ❌ Extraction failed: ${error.message}`);
    return { success: false, error: error.message };
  }
}

/**
 * Extract voice sample from a YouTube video
 * 
 * @param {string} youtubeUrl - YouTube video URL
 * @param {string} outputDir - Output directory
 * @param {object} options - Extraction options
 */
async function extractFromYouTube(youtubeUrl, outputDir, options = {}) {
  const {
    startTime = 30,    // Skip intro (usually ads/music)
    duration = VOICE_SAMPLE_CONFIG.targetDuration,
    speakerLabel = "youtube",
    separateVocals = true, // Use Demucs to isolate vocals
  } = options;

  console.log(`\n🎤 VOICE EXTRACTION: From YouTube`);
  console.log(`   URL: ${youtubeUrl}`);
  console.log(`   Start: ${startTime}s, Duration: ${duration}s`);

  // Check cache (include startTime + duration in key so different clips don't collide)
  const urlHash = generateHash(youtubeUrl + `_${startTime}_${duration}`);
  fs.mkdirSync(VOICE_CACHE_DIR, { recursive: true });
  const cachedPath = path.join(VOICE_CACHE_DIR, `yt_${urlHash}_${speakerLabel}.wav`);

  if (fs.existsSync(cachedPath)) {
    console.log(`   ⚡ Found in cache!`);
    return {
      success: true,
      samplePath: cachedPath,
      duration: getAudioDuration(cachedPath),
      speaker: speakerLabel,
      source: "youtube",
      cached: true,
    };
  }

  const voiceDir = path.join(outputDir, "voice_samples");
  fs.mkdirSync(voiceDir, { recursive: true });

  // Download audio using youtube-dl-exec (same as pipeline ingest)
  // This uses the android player client to bypass 403 errors
  // 
  // Caching strategy:
  //   1. Cache the RAW YouTube audio download (by URL hash only, so different clips reuse it)
  //   2. Cache the final processed voice sample (by URL + startTime + duration)
  const tempAudio = path.join(voiceDir, `${urlHash}_temp.mp3`);
  const rawUrlHash = generateHash(youtubeUrl); // URL-only hash for raw download cache
  
  try {
    // Check if we have the raw YouTube audio cached
    fs.mkdirSync(YT_AUDIO_CACHE_DIR, { recursive: true });
    const cachedRawAudio = path.join(YT_AUDIO_CACHE_DIR, `${rawUrlHash}.m4a`);
    let downloadedFile;
    
    if (fs.existsSync(cachedRawAudio)) {
      console.log(`   ⚡ Found YouTube audio in download cache!`);
      downloadedFile = cachedRawAudio;
    } else {
      console.log(`   📥 Downloading audio from YouTube (youtube-dl-exec)...`);
      
      const fullAudioPath = path.join(voiceDir, `${rawUrlHash}_full.m4a`);
      
      try {
        // Use youtube-dl-exec with android client (same as ingest.js) to bypass 403
        await youtubedl(youtubeUrl, {
          format: 'bestaudio[ext=m4a]/bestaudio/best',
          output: fullAudioPath,
          noCheckCertificates: true,
          noWarnings: true,
          extractorArgs: 'youtube:player_client=android',
        });
      } catch (dlErr) {
        console.log(`   ⚠️ First download attempt failed: ${dlErr.message}`);
        console.log(`   🔄 Retrying with simpler format...`);
        await youtubedl(youtubeUrl, {
          format: 'best',
          output: fullAudioPath,
          noCheckCertificates: true,
          extractorArgs: 'youtube:player_client=android',
        });
      }
      
      // Find the downloaded file (yt-dlp may use different extensions)
      downloadedFile = fullAudioPath;
      if (!fs.existsSync(downloadedFile)) {
        const files = fs.readdirSync(voiceDir).filter(f => f.startsWith(`${rawUrlHash}_full.`));
        if (files.length > 0) {
          downloadedFile = path.join(voiceDir, files[0]);
        } else {
          throw new Error("youtube-dl-exec download produced no output file");
        }
      }
      
      console.log(`   ✅ Downloaded: ${path.basename(downloadedFile)}`);
      
      // Cache the raw download for future extractions from the same video
      try {
        fs.copyFileSync(downloadedFile, cachedRawAudio);
        console.log(`   💾 Cached raw YouTube audio for future use`);
      } catch {}
    }
    
    // Extract the specific segment with ffmpeg
    console.log(`   ✂️ Extracting ${duration}s starting at ${startTime}s...`);
    execSync(
      `ffmpeg -y -i "${downloadedFile}" -ss ${startTime} -t ${duration + 5} -vn "${tempAudio}"`,
      { timeout: 30000, stdio: ['pipe', 'pipe', 'pipe'] }
    );
    
    // Cleanup working copy (but NOT the cached raw audio)
    const workingCopy = path.join(voiceDir, `${rawUrlHash}_full.m4a`);
    if (fs.existsSync(workingCopy) && workingCopy !== cachedRawAudio) {
      try { fs.unlinkSync(workingCopy); } catch {}
    }

    console.log(`   ✅ Extracted voice segment`);

    // Extract voice sample from downloaded audio
    const result = await extractFromAudioFile(tempAudio, outputDir, {
      startTime: 0,  // Already at correct position
      duration,
      speakerLabel,
      cleanAudio: true,
    });

    // Clean up temp file
    if (fs.existsSync(tempAudio)) {
      fs.unlinkSync(tempAudio);
    }

    // Cache the result
    if (result.success) {
      fs.copyFileSync(result.samplePath, cachedPath);
      result.cached = false;
      result.source = "youtube";
    }

    return result;
  } catch (error) {
    console.error(`   ❌ YouTube extraction failed: ${error.message}`);
    return { success: false, error: error.message };
  }
}

/**
 * Preprocess voice sample for XTTS
 * Ensures optimal format and quality
 */
async function preprocessForXTTS(inputPath, outputDir, options = {}) {
  const { label = "processed" } = options;

  console.log(`   🔧 Preprocessing for XTTS...`);

  const outputPath = path.join(outputDir, `${label}_xtts_ready.wav`);

  // XTTS optimal format: 22050Hz, mono, normalized
  const cmd = `ffmpeg -y -i "${inputPath}" ` +
    `-ar ${VOICE_SAMPLE_CONFIG.sampleRate} -ac ${VOICE_SAMPLE_CONFIG.channels} ` +
    `-af "loudnorm=I=-16:TP=-1.5:LRA=11" ` +
    `"${outputPath}" 2>/dev/null`;

  try {
    execSync(cmd);
    const duration = getAudioDuration(outputPath);
    console.log(`   ✅ Preprocessed: ${duration.toFixed(1)}s @ 22050Hz mono`);
    return outputPath;
  } catch (error) {
    console.log(`   ⚠️ Preprocessing failed, using original`);
    return inputPath;
  }
}

/**
 * Main voice extraction function
 * Automatically detects source type and extracts voice sample
 */
async function extractVoice(source, outputDir, options = {}) {
  const { type = "auto", ...extractOptions } = options;

  // Auto-detect source type
  let sourceType = type;
  if (type === "auto") {
    if (source.includes("youtube.com") || source.includes("youtu.be")) {
      sourceType = "youtube";
    } else if (fs.existsSync(source)) {
      const ext = path.extname(source).toLowerCase();
      if ([".mp3", ".wav", ".m4a", ".aac", ".ogg", ".flac"].includes(ext)) {
        sourceType = "audio";
      } else if ([".mp4", ".mkv", ".webm", ".mov"].includes(ext)) {
        sourceType = "video";
      }
    }
  }

  console.log(`\n${"═".repeat(60)}`);
  console.log(`🎤 VOICE EXTRACTION`);
  console.log(`${"═".repeat(60)}`);
  console.log(`   Source: ${source}`);
  console.log(`   Type: ${sourceType}`);

  let result;
  switch (sourceType) {
    case "youtube":
      result = await extractFromYouTube(source, outputDir, extractOptions);
      break;
    case "audio":
      result = await extractFromAudioFile(source, outputDir, extractOptions);
      break;
    case "video":
      // For video, we need vocals first (from Demucs)
      console.log(`   ⚠️ Video source requires Demucs separation first`);
      console.log(`   Use extractFromVocals() with the separated vocals path`);
      result = { success: false, error: "Video requires pre-separated vocals" };
      break;
    default:
      result = { success: false, error: `Unknown source type: ${sourceType}` };
  }

  if (result.success) {
    console.log(`\n   ✅ Voice extraction complete!`);
    console.log(`   📁 Sample: ${result.samplePath}`);
    console.log(`   ⏱️ Duration: ${result.duration?.toFixed(1)}s`);
  }

  return result;
}

module.exports = {
  extractVoice,
  extractFromVocals,
  extractFromAudioFile,
  extractFromYouTube,
  preprocessForXTTS,
  VOICE_SAMPLE_CONFIG,
};
