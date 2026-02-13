/**
 * Test script for Immersion v2 - TTS + Alignment
 * 
 * Uses the translation.json from a previous test
 * Generates TTS and aligns to match original timing
 * 
 * Usage:
 *   node test-v2-tts.js [job_id] [voice]
 *   node test-v2-tts.js test_07b6f21f male
 */

require("dotenv").config();
const fs = require("fs");
const path = require("path");
const { generateAndAlign, VOICES } = require("./src/v2");

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
    const translationPath = path.join(dir.path, "translation.json");
    if (fs.existsSync(translationPath)) {
      return dir;
    }
  }
  
  return null;
}

async function runTest(jobId, voiceType = "male") {
  console.log(`╔${"═".repeat(62)}╗`);
  console.log(`║  🧪 IMMERSION v2 TEST - TTS + Alignment                       ║`);
  console.log(`╚${"═".repeat(62)}╝`);
  console.log("");

  // Check API key
  if (!process.env.LEMONFOX_API_KEY) {
    console.error("❌ LEMONFOX_API_KEY not set in environment!");
    process.exit(1);
  }
  console.log("📋 Lemonfox API key: ✅ Set");

  // Get voice
  const voice = VOICES[voiceType] || VOICES.male;
  console.log(`🎤 Voice: ${voice} (${voiceType})`);

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
      console.error("❌ No test directory with translation.json found!");
      console.error("   Run test-v2-translate.js first");
      process.exit(1);
    }
  }

  console.log(`📁 Using job: ${testDir.name}`);
  console.log(`   Path: ${testDir.path}`);

  // Load translation
  const translationPath = path.join(testDir.path, "translation.json");
  if (!fs.existsSync(translationPath)) {
    console.error(`❌ Translation not found: ${translationPath}`);
    console.error("   Run test-v2-translate.js first");
    process.exit(1);
  }

  const translation = JSON.parse(fs.readFileSync(translationPath, "utf8"));
  console.log(`\n📝 Loaded translation:`);
  console.log(`   Segments: ${translation.segments.length}`);
  console.log(`   Level: ${translation.level}`);
  console.log(`   Gender: ${translation.gender}`);

  // Filter valid segments
  const validSegments = translation.segments.filter(s => 
    s && !s.error && s.translatedText && s.translatedText !== "[ERROR: Translation failed]"
  );
  console.log(`   Valid: ${validSegments.length}`);

  // Estimate cost
  const totalChars = validSegments.reduce((sum, s) => sum + s.translatedText.length, 0);
  const estimatedCost = (totalChars / 1000000) * 2.50;
  console.log(`\n💰 Estimated cost: ~$${estimatedCost.toFixed(4)}`);
  console.log(`   Characters: ${totalChars}`);

  const startTime = Date.now();

  try {
    // Run TTS (native speed control, no tempo stretching)
    const result = await generateAndAlign(validSegments, testDir.path, {
      voice,
      concurrency: 25,
      durationTolerance: 0.15,
      maxRetries: 2,
    });

    // Save results
    const outputPath = path.join(testDir.path, "tts_result.json");
    fs.writeFileSync(outputPath, JSON.stringify({
      voice,
      method: "native_speed_control",
      stats: result.stats,
      syncStats: result.syncStats,
      segments: result.segments.map(s => ({
        index: s.index,
        start: s.start,
        end: s.end,
        targetDuration: s.targetDuration,
        actualDuration: s.actualDuration,
        durationError: s.durationError,
        withinTolerance: s.withinTolerance,
        ttsSpeed: s.ttsSpeed,
        attempts: s.attempts,
        ttsFile: s.ttsFile ? path.basename(s.ttsFile) : null,
      })),
      generatedAt: new Date().toISOString(),
    }, null, 2));

    const totalTime = ((Date.now() - startTime) / 1000).toFixed(1);

    // Print summary
    console.log(`\n╔${"═".repeat(62)}╗`);
    console.log(`║  ✅ TTS COMPLETE (Native Speed Control)                       ║`);
    console.log(`╠${"═".repeat(62)}╣`);
    console.log(`║  Time: ${totalTime}s`);
    console.log(`║`);
    console.log(`║  📊 Statistics:`);
    console.log(`║     Generated: ${result.stats.success}/${result.stats.total}`);
    console.log(`║     Within tolerance: ${result.stats.withinTolerance}/${result.stats.success}`);
    console.log(`║     Skipped: ${result.stats.skipped}`);
    console.log(`║     Failed: ${result.stats.failed}`);
    
    if (result.syncStats) {
      console.log(`║`);
      console.log(`║  📏 Sync Analysis:`);
      console.log(`║     Avg ratio: ${result.syncStats.avgRatio.toFixed(3)}x`);
      console.log(`║     Ratio range: ${result.syncStats.minRatio.toFixed(2)}x - ${result.syncStats.maxRatio.toFixed(2)}x`);
      console.log(`║     Avg sync error: ${(result.syncStats.avgError * 1000).toFixed(0)}ms`);
      console.log(`║     Max sync error: ${(result.syncStats.maxError * 1000).toFixed(0)}ms`);
      console.log(`║`);
      console.log(`║  💡 Learning:`);
      console.log(`║     ${result.syncStats.speedSuggestion.recommendation}`);
    }
    
    console.log(`║`);
    console.log(`║  📁 Output:`);
    console.log(`║     Raw TTS: ${result.ttsDir}`);
    console.log(`║     Aligned: ${result.alignedDir}`);
    console.log(`║`);
    console.log(`║  💾 Saved: tts_result.json`);
    console.log(`╚${"═".repeat(62)}╝`);

    // Show sample results
    const validResults = result.segments.filter(s => !s.error && !s.skipped).slice(0, 5);
    if (validResults.length > 0) {
      console.log(`\n📝 Sample alignments:`);
      validResults.forEach((seg, i) => {
        const syncError = Math.abs(seg.alignedDuration - seg.targetDuration) * 1000;
        console.log(`   ${i + 1}. Segment ${seg.index}:`);
        console.log(`      Target: ${seg.targetDuration.toFixed(2)}s → TTS: ${seg.ttsDuration.toFixed(2)}s → Aligned: ${seg.alignedDuration?.toFixed(2) || "?"}s`);
        console.log(`      Ratio: ${seg.ratio.toFixed(2)}x | Sync error: ${syncError.toFixed(0)}ms | ${seg.method}`);
      });
    }

    console.log(`\n📝 Next steps:`);
    console.log(`   1. Review tts_result.json for sync quality`);
    console.log(`   2. Merge aligned TTS with background audio`);
    console.log(`   3. Render final video`);

  } catch (error) {
    console.error(`\n❌ Test failed: ${error.message}`);
    console.error(error);
    process.exit(1);
  }
}

// Run test
const jobId = process.argv[2];
const voiceType = process.argv[3] || "male";
runTest(jobId, voiceType);
