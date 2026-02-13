/**
 * Test script for Immersion v2 - Transcription
 *
 * Uses the vocals.mp3 from a previous split test
 * to verify transcription with speaker diarization
 *
 * Usage:
 *   node test-v2-transcribe.js [job_id]
 *   node test-v2-transcribe.js test_07b6f21f
 *
 * If no job_id provided, uses the most recent test folder
 */

require("dotenv").config();
const fs = require("fs");
const path = require("path");
const { transcribe, calculatePauses, mergeShortSegments } = require("./src/v2");

const OUTPUT_DIR = path.join(__dirname, "output");

async function findRecentTestDir() {
  const dirs = fs
    .readdirSync(OUTPUT_DIR)
    .filter((d) => d.startsWith("test_"))
    .map((d) => ({
      name: d,
      path: path.join(OUTPUT_DIR, d),
      mtime: fs.statSync(path.join(OUTPUT_DIR, d)).mtimeMs,
    }))
    .sort((a, b) => b.mtime - a.mtime);

  // Find one with vocals file
  for (const dir of dirs) {
    const vocalsPath = path.join(dir.path, "vocals.mp3");
    if (fs.existsSync(vocalsPath)) {
      return dir;
    }
  }

  return null;
}

async function runTest(jobId) {
  console.log(`╔${"═".repeat(62)}╗`);
  console.log(
    `║  🧪 IMMERSION v2 TEST - Transcription (Lemonfox Whisper)      ║`
  );
  console.log(`╚${"═".repeat(62)}╝`);
  console.log("");

  // Check API key
  if (!process.env.LEMONFOX_API_KEY) {
    console.error("❌ LEMONFOX_API_KEY not set in environment!");
    console.error("   Add to .env: LEMONFOX_API_KEY=your_key_here");
    process.exit(1);
  }
  console.log("📋 Lemonfox API key: ✅ Set");

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
      console.error("❌ No test directory with vocals.mp3 found!");
      console.error("   Run test-v2-split.js first to generate audio");
      process.exit(1);
    }
  }

  console.log(`📁 Using job: ${testDir.name}`);
  console.log(`   Path: ${testDir.path}`);

  // Check for vocals file
  const vocalsPath = path.join(testDir.path, "vocals.mp3");
  if (!fs.existsSync(vocalsPath)) {
    console.error(`❌ Vocals file not found: ${vocalsPath}`);
    console.error("   Run test-v2-split.js first");
    process.exit(1);
  }

  const vocalsSize = fs.statSync(vocalsPath).size;
  console.log(
    `\n🎤 Input: vocals.mp3 (${(vocalsSize / 1024 / 1024).toFixed(1)} MB)`
  );

  // Estimate cost
  // Get duration from manifest if available
  let duration = null;
  const manifestPath = path.join(testDir.path, "manifest.json");
  if (fs.existsSync(manifestPath)) {
    const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
    duration = manifest.duration || manifest.ingest?.duration;
  }

  if (duration) {
    const cost = (duration / 60 / 180) * 0.5; // $0.50 per 3 hours
    console.log(
      `💰 Estimated cost: ~$${cost.toFixed(4)} (${(duration / 60).toFixed(
        1
      )} min)`
    );
  }

  const startTime = Date.now();

  try {
    // Run transcription
    const result = await transcribe(vocalsPath, {
      language: "english",
      speakerLabels: true,
    });

    // Process segments
    let segments = calculatePauses(result.segments);

    // Optionally merge short segments
    // segments = mergeShortSegments(segments, 1.0);

    // Save results
    const outputPath = path.join(testDir.path, "transcription.json");
    fs.writeFileSync(
      outputPath,
      JSON.stringify(
        {
          text: result.text,
          language: result.language,
          segments: segments,
          words: result.words,
          processingTime: result.processingTime,
          transcribedAt: new Date().toISOString(),
        },
        null,
        2
      )
    );

    const totalTime = ((Date.now() - startTime) / 1000).toFixed(1);

    // Print summary
    console.log(`\n╔${"═".repeat(62)}╗`);
    console.log(
      `║  ✅ TRANSCRIPTION COMPLETE                                    ║`
    );
    console.log(`╠${"═".repeat(62)}╣`);
    console.log(`║  Time: ${totalTime}s`);
    console.log(`║`);
    console.log(`║  📝 Full transcript:`);

    // Wrap text for display
    const wrapped = result.text.match(/.{1,55}/g) || [];
    wrapped.slice(0, 5).forEach((line) => {
      console.log(`║     "${line}"`);
    });
    if (wrapped.length > 5) {
      console.log(`║     ...`);
    }

    console.log(`║`);
    console.log(`║  📊 Statistics:`);
    console.log(`║     Segments: ${segments.length}`);

    if (segments.length > 0) {
      const speakers = [
        ...new Set(segments.map((s) => s.speaker).filter(Boolean)),
      ];
      console.log(
        `║     Speakers: ${
          speakers.length > 0 ? speakers.join(", ") : "1 (default)"
        }`
      );

      const totalSpeech = segments.reduce((sum, s) => sum + s.duration, 0);
      console.log(`║     Total speech: ${totalSpeech.toFixed(1)}s`);

      const avgSegLen = totalSpeech / segments.length;
      console.log(`║     Avg segment: ${avgSegLen.toFixed(1)}s`);

      const pauses = segments.filter((s) => s.pauseBefore > 0.3);
      console.log(`║     Significant pauses: ${pauses.length}`);
    }

    console.log(`║`);
    console.log(`║  💾 Saved: transcription.json`);
    console.log(`╚${"═".repeat(62)}╝`);

    // Show first few segments
    console.log(`\n📝 Sample segments:`);
    segments.slice(0, 5).forEach((seg, i) => {
      const pause =
        seg.pauseBefore > 0.1 ? ` [pause ${seg.pauseBefore.toFixed(1)}s]` : "";
      console.log(
        `   ${i + 1}. [${seg.start.toFixed(1)}s-${seg.end.toFixed(1)}s]${pause}`
      );
      console.log(
        `      ${seg.speaker || "SPEAKER"}: "${seg.text.substring(0, 60)}${
          seg.text.length > 60 ? "..." : ""
        }"`
      );
    });

    if (segments.length > 5) {
      console.log(`   ... and ${segments.length - 5} more segments`);
    }

    console.log(`\n📝 Next steps:`);
    console.log(`   1. Review transcription.json`);
    console.log(`   2. Translate segments with Gemini`);
    console.log(`   3. Generate TTS for each segment`);
    console.log(`   4. Align TTS to match original timing`);
  } catch (error) {
    console.error(`\n❌ Test failed: ${error.message}`);
    console.error(error);
    process.exit(1);
  }
}

// Run test
const jobId = process.argv[2];
runTest(jobId);
