#!/usr/bin/env node
/**
 * Test script for Immersion v2 - Ingest + Demucs Split (via Replicate)
 *
 * Usage:
 *   node test-v2-split.js <youtube-url-or-local-file>
 *
 * Examples:
 *   node test-v2-split.js https://www.youtube.com/watch?v=dQw4w9WgXcQ
 *   node test-v2-split.js ./my-video.mp4
 *
 * Cost: ~$0.07-0.15 per run (Replicate Demucs)
 */

require("dotenv").config();

const path = require("path");
const fs = require("fs");
const { v4: uuidv4 } = require("uuid");

const { ingest } = require("./src/v2/ingest");
const {
  split,
  checkSystemRequirements,
  validateSeparation,
} = require("./src/v2/split");

async function runTest(source) {
  console.log(`
╔══════════════════════════════════════════════════════════════╗
║  🧪 IMMERSION v2 TEST - Ingest + Split (Replicate)           ║
╚══════════════════════════════════════════════════════════════╝
  `);

  // Check system requirements
  console.log("📋 Checking system requirements...\n");
  const sysReqs = checkSystemRequirements();

  console.log(
    `   Replicate API key: ${sysReqs.replicateKeySet ? "✅ Set" : "❌ Missing"}`
  );
  console.log(`   FFmpeg installed: ${sysReqs.ffmpegInstalled ? "✅" : "❌"}`);

  if (!sysReqs.replicateKeySet) {
    console.error(`
❌ REPLICATE_API_TOKEN not set!

1. Get your token at: https://replicate.com/account/api-tokens
2. Add to your .env file:
   REPLICATE_API_TOKEN=r8_xxx...
    `);
    process.exit(1);
  }

  if (!sysReqs.ffmpegInstalled) {
    console.error(`
❌ FFmpeg is not installed!

To install FFmpeg:
  Ubuntu/Debian: sudo apt install ffmpeg
  macOS: brew install ffmpeg
  Windows: choco install ffmpeg
    `);
    process.exit(1);
  }

  // Create test job directory
  const jobId = `test_${uuidv4().substring(0, 8)}`;
  const jobDir = path.join(__dirname, "output", jobId);
  fs.mkdirSync(jobDir, { recursive: true });

  console.log(`\n📁 Job ID: ${jobId}`);
  console.log(`   Output: ${jobDir}`);
  console.log(`\n💰 Estimated cost: ~$0.07-0.15 (Replicate Demucs)\n`);

  const timings = {};
  let stepStart;

  try {
    // ═══════════════════════════════════════════════════════════════
    // STEP 1: INGEST
    // ═══════════════════════════════════════════════════════════════
    stepStart = Date.now();
    const ingestResult = await ingest(source, jobDir);
    timings.ingest = (Date.now() - stepStart) / 1000;

    // ═══════════════════════════════════════════════════════════════
    // STEP 2: SPLIT (Replicate Demucs)
    // ═══════════════════════════════════════════════════════════════
    stepStart = Date.now();
    const splitResult = await split(ingestResult.audioPath, jobDir);
    timings.split = (Date.now() - stepStart) / 1000;

    // ═══════════════════════════════════════════════════════════════
    // STEP 3: VALIDATE
    // ═══════════════════════════════════════════════════════════════
    const validation = validateSeparation(
      splitResult.vocals,
      splitResult.background
    );

    // ═══════════════════════════════════════════════════════════════
    // RESULTS
    // ═══════════════════════════════════════════════════════════════
    const totalTime = Object.values(timings).reduce((a, b) => a + b, 0);

    console.log(`
╔══════════════════════════════════════════════════════════════╗
║  ✅ TEST COMPLETE                                            ║
╠══════════════════════════════════════════════════════════════╣
║  Total time: ${totalTime.toFixed(1)}s
║  ├─ Ingest: ${timings.ingest.toFixed(1)}s
║  └─ Split:  ${timings.split.toFixed(1)}s (Replicate Demucs)
║
║  Source: ${ingestResult.source.type}
║  Duration: ${ingestResult.media.duration?.toFixed(2)}s
║  Resolution: ${ingestResult.media.width}x${ingestResult.media.height}
║
║  Output files:
║  📁 ${jobDir}
║     ├─ source_video.mp4
║     ├─ source_audio.wav
║     ├─ vocals.wav      ← Speech only (for transcription)
║     └─ background.wav  ← Music/ambient (preserved in final)
║
║  Separation quality: ${validation.valid ? "✅ Good" : "⚠️ Check manually"}
╚══════════════════════════════════════════════════════════════╝

🎧 Listen to the output files to verify quality:
   - vocals.wav should contain only speech
   - background.wav should contain music/ambient sounds

📝 Next steps:
   1. Run Deepgram on vocals.wav to get speech segments
   2. Translate segments with Gemini
   3. Generate TTS for each segment
   4. Align TTS to match original timing
   5. Merge aligned TTS with background.wav
    `);

    return {
      success: true,
      jobId,
      jobDir,
      ingestResult,
      splitResult,
      validation,
      timings,
    };
  } catch (error) {
    console.error(`\n❌ Test failed: ${error.message}`);
    console.error(error.stack);

    return {
      success: false,
      error: error.message,
      jobDir,
    };
  }
}

// ═══════════════════════════════════════════════════════════════
// CLI Entry Point
// ═══════════════════════════════════════════════════════════════
const source = process.argv[2];

if (!source) {
  console.log(`
Usage: node test-v2-split.js <source>

Source can be:
  - YouTube URL:  https://youtube.com/watch?v=VIDEO_ID
  - TikTok URL:   https://tiktok.com/@user/video/VIDEO_ID
  - Local file:   ./path/to/video.mp4

Examples:
  node test-v2-split.js https://www.youtube.com/watch?v=jNQXAC9IVRw
  node test-v2-split.js ./test-video.mp4

Cost: ~$0.07-0.15 per run (Replicate Demucs API)
  `);
  process.exit(1);
}

runTest(source)
  .then((result) => {
    process.exit(result.success ? 0 : 1);
  })
  .catch((error) => {
    console.error("Fatal error:", error);
    process.exit(1);
  });
