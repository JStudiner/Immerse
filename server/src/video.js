const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");
const youtubedl = require("youtube-dl-exec");

/**
 * Download video from YouTube using yt-dlp via Node wrapper
 */
async function downloadVideo(videoId, outputDir) {
  const outputPath = path.join(outputDir, "original_video.mp4");

  if (fs.existsSync(outputPath)) {
    console.log(`   Video already downloaded: ${outputPath}`);
    return outputPath;
  }

  console.log(`   📥 Downloading video...`);

  try {
    // Download best quality video + audio, merge to mp4
    await youtubedl(`https://youtube.com/watch?v=${videoId}`, {
      format: "bestvideo[height<=1080][ext=mp4]+bestaudio[ext=m4a]/best[height<=1080][ext=mp4]/best",
      mergeOutputFormat: "mp4",
      output: outputPath,
      noCheckCertificates: true,
      noWarnings: true,
    });

    console.log(`   ✅ Downloaded: ${outputPath}`);
    return outputPath;
  } catch (error) {
    // Try simpler format if first attempt fails
    try {
      console.log(`   ⚠️ Retrying with simpler format...`);
      await youtubedl(`https://youtube.com/watch?v=${videoId}`, {
        format: "best[height<=1080]",
        output: outputPath,
        noCheckCertificates: true,
        noWarnings: true,
      });
      return outputPath;
    } catch (e) {
      throw new Error(`Failed to download video: ${e.message}`);
    }
  }
}

/**
 * Get video duration using ffprobe
 */
function getVideoDuration(videoPath) {
  try {
    const result = execSync(
      `ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "${videoPath}"`,
      { encoding: "utf-8" }
    );
    return parseFloat(result.trim());
  } catch {
    return null;
  }
}

/**
 * Replace video audio with dubbed audio
 * Keeps original video, replaces audio track
 */
function replaceAudio(videoPath, audioPath, outputPath, options = {}) {
  const {
    keepOriginalAudio = false, // Mix original audio at low volume
    originalVolume = 0.1, // 10% original audio volume if mixing
  } = options;

  console.log(`\n🎬 Syncing audio to video...`);
  console.log(`   Video: ${path.basename(videoPath)}`);
  console.log(`   Audio: ${path.basename(audioPath)}`);

  const videoDuration = getVideoDuration(videoPath);
  const audioDuration = getAudioDuration(audioPath);

  console.log(`   Video duration: ${videoDuration?.toFixed(2)}s`);
  console.log(`   Audio duration: ${audioDuration?.toFixed(2)}s`);

  try {
    if (keepOriginalAudio) {
      // Mix dubbed audio with original (original at low volume for ambience)
      console.log(`   Mixing with original audio at ${originalVolume * 100}% volume...`);
      execSync(
        `ffmpeg -y -i "${videoPath}" -i "${audioPath}" -filter_complex "[0:a]volume=${originalVolume}[orig];[1:a]volume=1.0[dub];[orig][dub]amix=inputs=2:duration=first[aout]" -map 0:v -map "[aout]" -c:v copy -c:a aac -b:a 192k -shortest "${outputPath}"`,
        { stdio: "pipe", maxBuffer: 500 * 1024 * 1024 }
      );
    } else {
      // Replace audio completely
      console.log(`   Replacing audio track...`);
      execSync(
        `ffmpeg -y -i "${videoPath}" -i "${audioPath}" -map 0:v -map 1:a -c:v copy -c:a aac -b:a 192k -shortest "${outputPath}"`,
        { stdio: "pipe", maxBuffer: 500 * 1024 * 1024 }
      );
    }

    const stats = fs.statSync(outputPath);
    console.log(`\n✅ Synced video saved: ${outputPath}`);
    console.log(`   Size: ${(stats.size / 1024 / 1024).toFixed(1)} MB`);

    return {
      outputPath,
      size: stats.size,
      videoDuration,
      audioDuration,
    };
  } catch (error) {
    throw new Error(`Failed to sync audio: ${error.message}`);
  }
}

/**
 * Get audio duration using ffprobe
 */
function getAudioDuration(filePath) {
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
 * Full pipeline: Download video + sync dubbed audio
 */
async function createDubbedVideo(videoId, dubbedAudioPath, outputDir, options = {}) {
  const {
    keepOriginalAudio = false,
    originalVolume = 0.1,
    outputFileName = "dubbed_video.mp4",
  } = options;

  console.log(`\n🎬 Creating dubbed video for: ${videoId}\n`);

  // Step 1: Download original video
  const videoPath = await downloadVideo(videoId, outputDir);

  // Step 2: Sync audio
  const outputPath = path.join(outputDir, outputFileName);
  const result = replaceAudio(videoPath, dubbedAudioPath, outputPath, {
    keepOriginalAudio,
    originalVolume,
  });

  return result;
}

module.exports = {
  downloadVideo,
  getVideoDuration,
  replaceAudio,
  createDubbedVideo,
};
