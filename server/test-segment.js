#!/usr/bin/env node
/**
 * Test the segment-level processing pipeline
 * Usage: node test-segment.js <youtube-url> [level] [voice] [--video]
 * 
 * This uses fine-grained segment timing instead of 20-second chunks
 * for much better audio sync with the video.
 */

require("dotenv").config();

const { processVideoSegmentLevel } = require("./src/immersionLogic");
const { stitchAudio, createStreamableAudio } = require("./src/stitch");
const { createDubbedVideo } = require("./src/video");
const path = require("path");

async function main() {
  const args = process.argv.slice(2);
  
  // Check for flags
  const createVideo = args.includes("--video");
  const mixAudio = args.includes("--mix");
  const filteredArgs = args.filter(a => !a.startsWith("--"));
  
  if (filteredArgs.length === 0 || args.includes("--help")) {
    console.log(`
🎬 Immersion - Segment-Level Processing

This mode processes individual transcript segments (2-5 seconds each)
instead of chunks (20 seconds), giving much better audio sync.

Usage:
  node test-segment.js <youtube-url> [level] [voice] [options]

Arguments:
  level   - A1, A2, B1, B2, C1 (default: B2)
  voice   - noel (male), dora (female) (default: noel)

Options:
  --video - Download video and sync dubbed audio (outputs .mp4)
  --mix   - Keep original audio at low volume (use with --video)
  --help  - Show this help message

Examples:
  node test-segment.js "https://youtube.com/watch?v=VIDEO_ID"
  node test-segment.js "https://youtube.com/watch?v=VIDEO_ID" A2
  node test-segment.js "https://youtube.com/watch?v=VIDEO_ID" B2 dora
  node test-segment.js "https://youtube.com/watch?v=VIDEO_ID" B2 noel --video
  node test-segment.js "https://youtube.com/watch?v=VIDEO_ID" B2 noel --video --mix

Environment variables required:
  GEMINI_API_KEY    - Google AI API key
  LEMONFOX_API_KEY  - Lemonfox TTS API key

Requirements for --video:
  yt-dlp  - Install with: pip install yt-dlp
`);
    return;
  }

  const url = filteredArgs[0];
  const level = filteredArgs[1] || "B2";
  const voice = filteredArgs[2] || "noel";

  console.log(`\n🚀 Starting segment-level processing...`);
  console.log(`   URL: ${url}`);
  console.log(`   Level: ${level}`);
  console.log(`   Voice: ${voice}`);
  if (createVideo) console.log(`   📹 Video output enabled`);
  if (mixAudio) console.log(`   🔊 Will mix with original audio`);
  console.log();

  try {
    // Process the video with segment-level timing
    const result = await processVideoSegmentLevel(url, level, voice);
    
    console.log(`\n📊 Processing complete!`);
    console.log(`   Job ID: ${result.jobId}`);
    console.log(`   Tracks: ${result.tracks}`);
    console.log(`   Mode: ${result.mode}`);
    
    // Stitch the audio
    console.log(`\n🎬 Stitching audio (flow mode)...`);
    const outputDir = path.join(__dirname, "output", result.jobId);
    const manifestPath = path.join(outputDir, "manifest.json");
    
    const stitchResult = await stitchAudio(manifestPath, "dubbed_audio.mp3", {
      mode: "flow",
    });
    
    console.log(`\n✅ Audio stitched!`);
    console.log(`   Duration: ${stitchResult.duration.toFixed(2)}s (target: ${stitchResult.targetDuration.toFixed(2)}s)`);
    console.log(`   Drift: ${stitchResult.drift.toFixed(3)}s`);

    // Create streamable audio (optimized for serving)
    const streamableResult = createStreamableAudio(
      path.join(outputDir, "dubbed_audio.mp3"),
      path.join(outputDir, "audio.mp3"),
      {
        title: `Spanish ${level} - ${result.videoId}`,
        artist: "Immersion",
        album: "Spanish Learning",
        level: level,
        videoId: result.videoId,
      }
    );

    console.log(`\n🎧 Streamable audio ready!`);
    console.log(`   File: output/${result.jobId}/audio.mp3`);

    // Create video if requested
    if (createVideo) {
      console.log(`\n📹 Creating dubbed video...`);
      
      const videoResult = await createDubbedVideo(
        result.videoId,
        path.join(outputDir, "dubbed_audio.mp3"),
        outputDir,
        {
          keepOriginalAudio: mixAudio,
          originalVolume: 0.08, // 8% original audio for ambience
          outputFileName: "dubbed_video.mp4",
        }
      );
      
      console.log(`\n🎉 Video complete!`);
      console.log(`   File: output/${result.jobId}/dubbed_video.mp4`);
      console.log(`   Size: ${(videoResult.size / 1024 / 1024).toFixed(1)} MB`);
    }
    
    console.log(`\n✨ All done!`);
    console.log(`   Output folder: output/${result.jobId}/`);
    console.log(`   Original video: https://youtube.com/watch?v=${result.videoId}`);
    
  } catch (error) {
    console.error(`\n❌ Error: ${error.message}`);
    console.error(error.stack);
    process.exit(1);
  }
}

main();
