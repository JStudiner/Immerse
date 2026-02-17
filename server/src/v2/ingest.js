/**
 * Immersion v2 - Ingest Module
 *
 * Handles downloading videos from various sources and extracting audio
 * Supports: YouTube, TikTok, Instagram, local files, and 1000+ sites via yt-dlp
 */

const { execSync } = require("child_process");
const { pipeline } = require("stream/promises");
const { Readable } = require("stream");
const path = require("path");
const fs = require("fs");
const crypto = require("crypto");
const youtubedl = require("youtube-dl-exec");

// Video cache directory - stores downloaded videos by URL hash
const CACHE_DIR = path.join(__dirname, "..", "..", "cache", "videos");

/**
 * Get media duration using ffprobe
 * @param {string} filePath - Path to audio or video file
 * @returns {number|null} Duration in seconds
 */
function getDuration(filePath) {
  try {
    const result = execSync(
      `ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "${filePath}"`,
      { encoding: "utf-8" }
    );
    return parseFloat(result.trim());
  } catch {
    return null;
  }
}

/**
 * Get detailed media info using ffprobe
 * @param {string} filePath - Path to media file
 * @returns {object} Media information
 */
function getMediaInfo(filePath) {
  try {
    const result = execSync(
      `ffprobe -v quiet -print_format json -show_format -show_streams "${filePath}"`,
      { encoding: "utf-8" }
    );

    const info = JSON.parse(result);
    const videoStream = info.streams?.find((s) => s.codec_type === "video");
    const audioStream = info.streams?.find((s) => s.codec_type === "audio");

    return {
      duration: parseFloat(info.format?.duration || 0),
      size: parseInt(info.format?.size || 0),
      bitrate: parseInt(info.format?.bit_rate || 0),
      // Video info
      width: videoStream?.width || null,
      height: videoStream?.height || null,
      fps: videoStream?.r_frame_rate || null,
      videoCodec: videoStream?.codec_name || null,
      // Audio info
      audioCodec: audioStream?.codec_name || null,
      sampleRate: parseInt(audioStream?.sample_rate || 0),
      channels: audioStream?.channels || null,
    };
  } catch (error) {
    // Fallback to just duration
    return { duration: getDuration(filePath) };
  }
}

/**
 * Detect source type from URL or path
 * @param {string} source - URL or file path
 * @returns {string} Source type identifier
 */
function detectSourceType(source) {
  // Check if local file
  if (fs.existsSync(source)) {
    return "local";
  }

  // URL pattern matching
  if (/youtube\.com|youtu\.be/i.test(source)) return "youtube";
  if (/tiktok\.com/i.test(source)) return "tiktok";
  if (/instagram\.com|instagr\.am/i.test(source)) return "instagram";
  if (/twitter\.com|x\.com/i.test(source)) return "twitter";
  if (/vimeo\.com/i.test(source)) return "vimeo";
  if (/facebook\.com|fb\.watch/i.test(source)) return "facebook";
  if (/twitch\.tv/i.test(source)) return "twitch";

  // If it looks like a URL, let yt-dlp try to handle it
  if (/^https?:\/\//i.test(source)) return "url";

  return "unknown";
}

/**
 * Extract video ID from known platforms
 * @param {string} source - URL
 * @param {string} sourceType - Detected source type
 * @returns {string|null} Video ID if extractable
 */
function extractVideoId(source, sourceType) {
  switch (sourceType) {
    case "youtube": {
      const patterns = [
        /(?:youtube\.com\/watch\?v=)([^&\n?#]+)/,
        /(?:youtu\.be\/)([^&\n?#]+)/,
        /(?:youtube\.com\/embed\/)([^&\n?#]+)/,
        /(?:youtube\.com\/shorts\/)([^&\n?#]+)/,
      ];
      for (const pattern of patterns) {
        const match = source.match(pattern);
        if (match) return match[1];
      }
      return null;
    }
    case "tiktok": {
      const match = source.match(/video\/(\d+)/);
      return match ? match[1] : null;
    }
    case "local": {
      return path.basename(source, path.extname(source));
    }
    default:
      return null;
  }
}

/**
 * Generate a cache key for a URL
 * Uses video ID if available, otherwise hashes the URL
 */
function getCacheKey(url, sourceType) {
  const videoId = extractVideoId(url, sourceType);
  if (videoId) {
    return `${sourceType}_${videoId}`;
  }
  // Fallback: hash the URL
  return crypto.createHash("md5").update(url).digest("hex").substring(0, 16);
}

/**
 * Check if video is in cache
 * @param {string} cacheKey - Cache key for the video
 * @returns {string|null} Path to cached video or null
 */
function getCachedVideo(cacheKey) {
  const cachedPath = path.join(CACHE_DIR, `${cacheKey}.mp4`);
  if (fs.existsSync(cachedPath)) {
    const stats = fs.statSync(cachedPath);
    // Verify file is valid (not empty, at least 100KB)
    if (stats.size > 100 * 1024) {
      return cachedPath;
    }
  }
  return null;
}

/**
 * Save video to cache
 * @param {string} videoPath - Path to video file
 * @param {string} cacheKey - Cache key
 */
function cacheVideo(videoPath, cacheKey) {
  fs.mkdirSync(CACHE_DIR, { recursive: true });
  const cachedPath = path.join(CACHE_DIR, `${cacheKey}.mp4`);
  fs.copyFileSync(videoPath, cachedPath);
  console.log(`   💾 Cached video for future use`);
}

/**
 * Get video metadata (title, description, etc.) without downloading
 * @param {string} url - Video URL
 * @returns {Promise<object>} Video metadata
 */
async function getVideoMetadata(url) {
  try {
    const info = await youtubedl(url, {
      dumpSingleJson: true,
      noCheckCertificates: true,
      noWarnings: true,
      extractorArgs: "youtube:player_client=android",
    });
    return {
      title: info.title || null,
      description: info.description || null,
      uploader: info.uploader || info.channel || null,
      duration: info.duration || null,
      uploadDate: info.upload_date || null,
    };
  } catch (error) {
    console.log(`   ⚠️ Could not fetch metadata: ${error.message}`);
    return { title: null };
  }
}

/**
 * Sanitize filename by removing invalid characters
 * @param {string} filename - Original filename
 * @returns {string} Sanitized filename
 */
function sanitizeFilename(filename) {
  if (!filename) return null;
  return filename
    .replace(/[<>:"/\\|?*]/g, '') // Remove invalid chars
    .replace(/\s+/g, '_')          // Replace spaces with underscores
    .replace(/_+/g, '_')           // Collapse multiple underscores
    .substring(0, 100);            // Limit length
}

/**
 * Download media using a self-hosted Cobalt instance
 * Requires COBALT_API_URL env var (e.g. "http://cobalt:9000/" in Docker)
 * Supports: YouTube, TikTok, Twitter/X, Instagram, Reddit, and more
 *
 * @param {string} url - Video/audio URL
 * @param {string} outputPath - Path to save the downloaded file
 * @param {object} options - Cobalt options
 * @param {string} options.downloadMode - "auto", "audio", or "mute" (default: "auto")
 * @param {string} options.videoQuality - "max","2160","1440","1080","720","480","360" (default: "1080")
 * @returns {Promise<boolean>} True if download succeeded, false if skipped or failed
 */
async function downloadWithCobalt(url, outputPath, options = {}) {
  const cobaltUrl = process.env.COBALT_API_URL;
  if (!cobaltUrl) {
    // Cobalt not configured — skip silently
    return false;
  }

  const { downloadMode = "auto", videoQuality = "1080" } = options;
  const apiEndpoint = cobaltUrl.replace(/\/$/, "") + "/";

  console.log(`   🔷 Trying Cobalt (${apiEndpoint})...`);

  try {
    // Build request headers
    const headers = {
      "Content-Type": "application/json",
      Accept: "application/json",
    };

    // Optional API key auth for protected instances
    const apiKey = process.env.COBALT_API_KEY;
    if (apiKey) {
      headers["Authorization"] = `Api-Key ${apiKey}`;
    }

    // Step 1: Request download URL from Cobalt
    const response = await fetch(apiEndpoint, {
      method: "POST",
      headers,
      body: JSON.stringify({
        url,
        videoQuality,
        audioFormat: "best",
        filenameStyle: "classic",
        downloadMode,
      }),
    });

    if (!response.ok) {
      const text = await response.text().catch(() => "");
      throw new Error(`Cobalt returned HTTP ${response.status}: ${text.substring(0, 200)}`);
    }

    const data = await response.json();

    // Handle Cobalt response statuses
    let downloadUrl;
    if (data.status === "redirect" || data.status === "tunnel") {
      downloadUrl = data.url;
    } else if (data.status === "picker" && data.picker?.length > 0) {
      // Multiple options — pick the first (best) one
      downloadUrl = data.picker[0].url;
    } else if (data.status === "error") {
      throw new Error(
        `Cobalt error: ${data.error?.code || JSON.stringify(data).substring(0, 200)}`
      );
    } else {
      throw new Error(`Unexpected Cobalt status: ${data.status}`);
    }

    if (!downloadUrl) {
      throw new Error("No download URL in Cobalt response");
    }

    console.log(`   🔷 Got Cobalt URL, downloading file...`);

    // Step 2: Stream the media file to disk (Cobalt tunnels are streamed responses)
    const fileResponse = await fetch(downloadUrl);
    if (!fileResponse.ok) {
      throw new Error(`File download failed: HTTP ${fileResponse.status}`);
    }

    if (!fileResponse.body) {
      throw new Error("No response body from Cobalt download URL");
    }

    const fileStream = fs.createWriteStream(outputPath);
    await pipeline(Readable.fromWeb(fileResponse.body), fileStream);

    const size = fs.statSync(outputPath).size;
    if (size < 10 * 1024) {
      throw new Error(`Downloaded file too small (${size} bytes), likely invalid`);
    }

    console.log(`   🔷 Cobalt download complete (${(size / 1024 / 1024).toFixed(1)} MB)`);
    return true;
  } catch (error) {
    console.log(`   ⚠️ Cobalt failed: ${error.message}`);
    // Clean up any partial/bad download
    if (fs.existsSync(outputPath)) {
      try {
        fs.unlinkSync(outputPath);
      } catch {}
    }
    return false;
  }
}

/**
 * Download video from URL (Cobalt API → yt-dlp fallback, with caching)
 * @param {string} url - Video URL
 * @param {string} outputDir - Output directory
 * @param {string} sourceType - Source type (youtube, tiktok, etc.)
 * @returns {Promise<object>} Path to video, cache info, and metadata
 */
async function downloadVideo(url, outputDir, sourceType = "url") {
  const videoPath = path.join(outputDir, "source_video.mp4");
  const cacheKey = getCacheKey(url, sourceType);
  
  // Fetch video metadata (title, etc.)
  console.log(`   📋 Fetching video metadata...`);
  const metadata = await getVideoMetadata(url);
  if (metadata.title) {
    console.log(`   📺 Title: ${metadata.title.substring(0, 60)}${metadata.title.length > 60 ? '...' : ''}`);
  }
  
  // Check cache first
  const cachedPath = getCachedVideo(cacheKey);
  if (cachedPath) {
    console.log(`   ⚡ Found in cache! Copying...`);
    fs.copyFileSync(cachedPath, videoPath);
    const size = fs.statSync(videoPath).size;
    console.log(`   ✅ Loaded from cache (${(size / 1024 / 1024).toFixed(1)} MB)`);
    return { path: videoPath, fromCache: true, cacheKey, ...metadata };
  }

  console.log(`   📥 Downloading video...`);
  const startTime = Date.now();

  // Try Cobalt API first (fast, no auth, no system dependencies)
  const cobaltOk = await downloadWithCobalt(url, videoPath, {
    downloadMode: "auto",
    videoQuality: "1080",
  });

  if (!cobaltOk) {
    // Fallback: yt-dlp
    console.log(`   📥 Falling back to yt-dlp...`);
    try {
      await youtubedl(url, {
        format:
          "bestvideo[height<=1080][ext=mp4]+bestaudio[ext=m4a]/best[height<=1080][ext=mp4]/best",
        mergeOutputFormat: "mp4",
        output: videoPath,
        noCheckCertificates: true,
        noWarnings: true,
        extractorArgs: "youtube:player_client=android",
      });
    } catch (error) {
      // Last resort: simplest yt-dlp format
      console.log(`   ⚠️ Retrying with simpler format...`);
      await youtubedl(url, {
        format: "best",
        output: videoPath,
        noCheckCertificates: true,
        extractorArgs: "youtube:player_client=android",
      });
    }
  }

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  const size = fs.statSync(videoPath).size;
  console.log(
    `   ✅ Downloaded in ${elapsed}s (${(size / 1024 / 1024).toFixed(1)} MB)`
  );
  
  // Cache the video for future use
  cacheVideo(videoPath, cacheKey);

  return { path: videoPath, fromCache: false, cacheKey, ...metadata };
}

/**
 * Copy local file to job directory
 * @param {string} sourcePath - Original file path
 * @param {string} outputDir - Output directory
 * @returns {string} Path to copied file
 */
function copyLocalFile(sourcePath, outputDir) {
  const ext = path.extname(sourcePath).toLowerCase();
  const destPath = path.join(outputDir, `source_video${ext}`);

  console.log(`   📁 Copying local file...`);
  fs.copyFileSync(sourcePath, destPath);

  const size = fs.statSync(destPath).size;
  console.log(`   ✅ Copied (${(size / 1024 / 1024).toFixed(1)} MB)`);

  return destPath;
}

/**
 * Extract audio from video file as high-quality WAV
 * WAV is preferred for Demucs processing (44.1kHz, 16-bit, stereo)
 *
 * @param {string} videoPath - Path to video file
 * @param {string} outputDir - Output directory
 * @param {object} options - Extraction options
 * @param {number} options.start - Start time in seconds (optional)
 * @param {number} options.duration - Duration in seconds (optional)
 * @returns {string} Path to extracted audio
 */
function extractAudio(videoPath, outputDir, options = {}) {
  const { start, duration } = options;
  const audioPath = path.join(outputDir, "source_audio.wav");

  console.log(`   🎵 Extracting audio...`);
  if (start !== undefined && start !== null) {
    console.log(`      Start: ${start}s`);
  }
  if (duration && duration > 0) {
    console.log(`      Duration: ${duration}s`);
  }
  
  const startTime = Date.now();

  // Build ffmpeg command with optional trimming
  let ffmpegCmd = `ffmpeg -y`;
  
  // Add start time if specified (input seeking is faster)
  if (start !== undefined && start !== null) {
    ffmpegCmd += ` -ss ${start}`;
  }
  
  ffmpegCmd += ` -i "${videoPath}"`;
  
  // Add duration if specified (0 or falsy = full video, no clipping)
  if (duration && duration > 0) {
    ffmpegCmd += ` -t ${duration}`;
  }
  
  // Extract as 44.1kHz stereo WAV (Demucs optimal format)
  ffmpegCmd += ` -vn -acodec pcm_s16le -ar 44100 -ac 2 "${audioPath}"`;
  
  execSync(ffmpegCmd, { stdio: "pipe" });

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  const audioDuration = getDuration(audioPath);
  const size = fs.statSync(audioPath).size;

  console.log(`   ✅ Extracted in ${elapsed}s`);
  console.log(`      Duration: ${audioDuration?.toFixed(2)}s`);
  console.log(`      Size: ${(size / 1024 / 1024).toFixed(1)} MB`);

  return audioPath;
}

/**
 * Main ingest function - downloads source and extracts audio
 *
 * @param {string} source - URL or local file path
 * @param {string} outputDir - Job output directory
 * @param {object} options - Ingest options
 * @param {number} options.start - Start time in seconds (optional)
 * @param {number} options.duration - Duration in seconds (optional)
 * @returns {Promise<object>} Ingest result with paths and metadata
 */
async function ingest(source, outputDir, options = {}) {
  const { start, duration } = options;
  
  console.log(`\n${"═".repeat(60)}`);
  console.log(`📥 INGEST: Processing source`);
  console.log(`${"═".repeat(60)}`);

  // Detect source type
  const sourceType = detectSourceType(source);
  const sourceId = extractVideoId(source, sourceType);

  console.log(
    `   Source: ${source.substring(0, 60)}${source.length > 60 ? "..." : ""}`
  );
  console.log(`   Type: ${sourceType}`);
  if (sourceId) console.log(`   ID: ${sourceId}`);

  // Show clip info if trimming
  if (start || (duration && duration > 0)) {
    console.log(`   ✂️  Clipping:`);
    if (start) {
      console.log(`      Start: ${start}s (${(start / 60).toFixed(1)} min)`);
    }
    if (duration && duration > 0) {
      console.log(`      Duration: ${duration}s (${(duration / 60).toFixed(1)} min)`);
    }
  }

  // Validate
  if (sourceType === "unknown") {
    throw new Error(`Unknown source type: ${source}`);
  }

  // Ensure output directory exists
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  // Get video
  let videoPath;
  let fromCache = false;
  let cacheKey = null;
  let title = null;
  let uploader = null;
  
  if (sourceType === "local") {
    videoPath = copyLocalFile(source, outputDir);
    // Use filename as title for local files
    title = path.basename(source, path.extname(source));
  } else {
    const downloadResult = await downloadVideo(source, outputDir, sourceType);
    videoPath = downloadResult.path;
    fromCache = downloadResult.fromCache;
    cacheKey = downloadResult.cacheKey;
    title = downloadResult.title;
    uploader = downloadResult.uploader;
  }

  // Get video info
  const mediaInfo = getMediaInfo(videoPath);
  console.log(
    `   📊 Video: ${mediaInfo.width}x${
      mediaInfo.height
    }, ${mediaInfo.duration?.toFixed(2)}s`
  );

  // Extract audio with optional trimming
  const audioPath = extractAudio(videoPath, outputDir, { start, duration });

  console.log(`\n   ✅ INGEST COMPLETE${fromCache ? " (from cache)" : ""}`);

  return {
    videoPath,
    audioPath,
    fromCache,
    cacheKey,
    title,           // Video title for naming outputs
    titleSanitized: sanitizeFilename(title), // Safe for filenames
    uploader,        // Channel/creator name
    source: {
      type: sourceType,
      id: sourceId,
      url: sourceType !== "local" ? source : null,
      localPath: sourceType === "local" ? source : null,
    },
    media: {
      duration: mediaInfo.duration,
      width: mediaInfo.width,
      height: mediaInfo.height,
      fps: mediaInfo.fps,
    },
    trim: {
      start: start || 0,
      duration: duration || null,
    },
  };
}

module.exports = {
  ingest,
  getDuration,
  getMediaInfo,
  getVideoMetadata,
  detectSourceType,
  extractVideoId,
  extractAudio,
  getCachedVideo,
  getCacheKey,
  downloadWithCobalt,
  sanitizeFilename,
  CACHE_DIR,
};
