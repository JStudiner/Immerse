/**
 * Test script for Immersion v2 - Merge + Render
 * 
 * Final step: combines aligned TTS with background audio,
 * then renders the final dubbed video
 * 
 * Usage:
 *   node test-v2-merge.js [job_id]
 *   node test-v2-merge.js test_07b6f21f
 */

require("dotenv").config();
const fs = require("fs");
const path = require("path");
const { merge, renderVideo } = require("./src/v2");

const OUTPUT_DIR = path.join(__dirname, "output");

async function findRecentTestDir() {
  const dirs = fs.readdirSync(OUTPUT_DIR)
    .filter(d => d.startsWith("test_"))
    .map(d => ({
      name: d,
      path: path.join(OUTPUT_DIR, d),
      mtime: fs.statSync(path.join(OUTPUT_DIR, d)).mtimeMs,
    }))
    .sort((a, b) => b.mtime - a.mtime);

  for (const dir of dirs) {
    const ttsResultPath = path.join(dir.path, "tts_result.json");
    if (fs.existsSync(ttsResultPath)) {
      return dir;
    }
  }
  
  return null;
}

async function runTest(jobId) {
  console.log(`╔${"═".repeat(62)}╗`);
  console.log(`║  🧪 IMMERSION v2 TEST - Merge + Render (Final Step!)          ║`);
  console.log(`╚${"═".repeat(62)}╝`);
  console.log("");

  // Find test directory
  let testDir;
  if (jobId) {
    testDir = { name: jobId, path: path.join(OUTPUT_DIR, jobId) };
    if (!fs.existsSync(testDir.path)) {
      console.error(`❌ Job directory not found: ${testDir.path}`);
      process.exit(1);
    }
  } else {
    testDir = await findRecentTestDir();
    if (!testDir) {
      console.error("❌ No test directory with tts_result.json found!");
      console.error("   Run test-v2-tts.js first");
      process.exit(1);
    }
  }

  console.log(`📁 Using job: ${testDir.name}`);
  console.log(`   Path: ${testDir.path}`);

  // Check required files
  const backgroundPath = path.join(testDir.path, "background.mp3");
  const videoPath = path.join(testDir.path, "source_video.mp4");
  const ttsResultPath = path.join(testDir.path, "tts_result.json");
  const alignedDir = path.join(testDir.path, "tts_aligned");

  const checks = [
    { path: backgroundPath, name: "background.mp3" },
    { path: videoPath, name: "source_video.mp4" },
    { path: ttsResultPath, name: "tts_result.json" },
    { path: alignedDir, name: "tts_aligned/" },
  ];

  console.log(`\n📋 Checking required files:`);
  let allGood = true;
  for (const check of checks) {
    const exists = fs.existsSync(check.path);
    console.log(`   ${exists ? "✅" : "❌"} ${check.name}`);
    if (!exists) allGood = false;
  }

  if (!allGood) {
    console.error("\n❌ Missing required files. Run previous steps first.");
    process.exit(1);
  }

  // Load TTS results
  const ttsResult = JSON.parse(fs.readFileSync(ttsResultPath, "utf8"));
  
  // Build segment list with full paths
  const segments = ttsResult.segments
    .filter(s => s.alignedFile)
    .map(s => ({
      ...s,
      alignedFile: path.join(alignedDir, s.alignedFile),
    }));

  console.log(`\n📊 Ready to merge:`);
  console.log(`   Background: background.mp3`);
  console.log(`   TTS segments: ${segments.length}`);
  console.log(`   Video: source_video.mp4`);

  const startTime = Date.now();

  try {
    // Step 1: Merge TTS with background
    const dubbedAudioPath = path.join(testDir.path, "dubbed_audio.mp3");
    console.log(`\n`);
    
    const mergeResult = await merge(
      backgroundPath,
      segments,
      dubbedAudioPath,
      {
        backgroundVolume: 0.25,  // Background low (25%)
        ttsVolume: 1.8,          // Voice boosted (180%)
      }
    );

    // Step 2: Render final video
    const dubbedVideoPath = path.join(testDir.path, "dubbed_video.mp4");
    
    const renderResult = await renderVideo(
      videoPath,
      dubbedAudioPath,
      dubbedVideoPath
    );

    const totalTime = ((Date.now() - startTime) / 1000).toFixed(1);

    // Print summary
    console.log(`\n╔${"═".repeat(62)}╗`);
    console.log(`║  🎉 IMMERSION v2 COMPLETE!                                    ║`);
    console.log(`╠${"═".repeat(62)}╣`);
    console.log(`║  Total time: ${totalTime}s`);
    console.log(`║`);
    console.log(`║  📁 Output files:`);
    console.log(`║     🎵 dubbed_audio.mp3`);
    console.log(`║        Duration: ${mergeResult.duration?.toFixed(1)}s`);
    console.log(`║        Size: ${(mergeResult.size / 1024 / 1024).toFixed(1)} MB`);
    console.log(`║`);
    console.log(`║     🎬 dubbed_video.mp4`);
    console.log(`║        Duration: ${renderResult.duration?.toFixed(1)}s`);
    console.log(`║        Size: ${(renderResult.size / 1024 / 1024).toFixed(1)} MB`);
    console.log(`║`);
    console.log(`║  📂 Full path:`);
    console.log(`║     ${dubbedVideoPath}`);
    console.log(`╚${"═".repeat(62)}╝`);

    console.log(`\n🎧 Play the output to verify quality:`);
    console.log(`   mpv "${dubbedVideoPath}"`);
    console.log(`   # or`);
    console.log(`   vlc "${dubbedVideoPath}"`);

    // Save final manifest
    const manifestPath = path.join(testDir.path, "manifest.json");
    fs.writeFileSync(manifestPath, JSON.stringify({
      jobId: testDir.name,
      completedAt: new Date().toISOString(),
      pipeline: "v2",
      source: {
        video: "source_video.mp4",
        audio: "source_audio.wav",
      },
      separation: {
        vocals: "vocals.mp3",
        background: "background.mp3",
      },
      output: {
        dubbedAudio: "dubbed_audio.mp3",
        dubbedVideo: "dubbed_video.mp4",
        duration: renderResult.duration,
      },
      stats: {
        segments: segments.length,
        mergeTime: mergeResult.processingTime,
        renderTime: renderResult.processingTime,
        totalTime: parseFloat(totalTime),
      },
    }, null, 2));

    console.log(`\n📋 Manifest saved: manifest.json`);

  } catch (error) {
    console.error(`\n❌ Test failed: ${error.message}`);
    console.error(error);
    process.exit(1);
  }
}

// Run test
const jobId = process.argv[2];
runTest(jobId);
