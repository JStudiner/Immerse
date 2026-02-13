/**
 * Test script for Immersion v2 - Translation
 * 
 * Uses the transcription.json from a previous test
 * to verify translation with Gemini
 * 
 * Usage:
 *   node test-v2-translate.js [job_id] [level]
 *   node test-v2-translate.js test_07b6f21f B1
 */

require("dotenv").config();
const fs = require("fs");
const path = require("path");
const { translate, detectGender, LEVEL_GUIDES } = require("./src/v2");

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
    const transcriptionPath = path.join(dir.path, "transcription.json");
    if (fs.existsSync(transcriptionPath)) {
      return dir;
    }
  }
  
  return null;
}

async function runTest(jobId, level = "B1") {
  console.log(`╔${"═".repeat(62)}╗`);
  console.log(`║  🧪 IMMERSION v2 TEST - Translation (Gemini)                  ║`);
  console.log(`╚${"═".repeat(62)}╝`);
  console.log("");

  // Check API key
  if (!process.env.GEMINI_API_KEY) {
    console.error("❌ GEMINI_API_KEY not set in environment!");
    console.error("   Add to .env: GEMINI_API_KEY=your_key_here");
    process.exit(1);
  }
  console.log("📋 Gemini API key: ✅ Set");

  // Validate level
  if (!LEVEL_GUIDES[level]) {
    console.error(`❌ Invalid level: ${level}`);
    console.error(`   Valid levels: ${Object.keys(LEVEL_GUIDES).join(", ")}`);
    process.exit(1);
  }

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
      console.error("❌ No test directory with transcription.json found!");
      console.error("   Run test-v2-transcribe.js first");
      process.exit(1);
    }
  }

  console.log(`📁 Using job: ${testDir.name}`);
  console.log(`   Path: ${testDir.path}`);

  // Load transcription
  const transcriptionPath = path.join(testDir.path, "transcription.json");
  if (!fs.existsSync(transcriptionPath)) {
    console.error(`❌ Transcription not found: ${transcriptionPath}`);
    console.error("   Run test-v2-transcribe.js first");
    process.exit(1);
  }

  const transcription = JSON.parse(fs.readFileSync(transcriptionPath, "utf8"));
  console.log(`\n📝 Loaded transcription:`);
  console.log(`   Segments: ${transcription.segments.length}`);
  console.log(`   Language: ${transcription.language}`);

  // Detect speaker gender
  const gender = await detectGender(transcription.text);

  // Estimate cost (Gemini is essentially free for this)
  const totalChars = transcription.segments.reduce((sum, s) => sum + s.text.length, 0);
  console.log(`\n💰 Estimated cost: ~$0.00 (Gemini free tier)`);
  console.log(`   Characters: ${totalChars}`);

  const startTime = Date.now();

  try {
    // Run translation
    const translatedSegments = await translate(transcription.segments, {
      level,
      batchSize: 15,
      concurrency: 3,
    });

    // Save results
    const outputPath = path.join(testDir.path, "translation.json");
    fs.writeFileSync(outputPath, JSON.stringify({
      level,
      gender,
      originalLanguage: transcription.language,
      targetLanguage: "Spanish",
      segments: translatedSegments,
      translatedAt: new Date().toISOString(),
    }, null, 2));

    const totalTime = ((Date.now() - startTime) / 1000).toFixed(1);

    // Print summary
    console.log(`\n╔${"═".repeat(62)}╗`);
    console.log(`║  ✅ TRANSLATION COMPLETE                                      ║`);
    console.log(`╠${"═".repeat(62)}╣`);
    console.log(`║  Time: ${totalTime}s`);
    console.log(`║  Level: ${level} (${LEVEL_GUIDES[level].name})`);
    console.log(`║  Gender: ${gender}`);
    console.log(`║`);
    console.log(`║  📊 Statistics:`);
    
    const validSegments = translatedSegments.filter(s => !s.error);
    const failedSegments = translatedSegments.filter(s => s.error);
    console.log(`║     Translated: ${validSegments.length}/${translatedSegments.length}`);
    if (failedSegments.length > 0) {
      console.log(`║     Failed: ${failedSegments.length}`);
    }
    
    const totalOriginal = validSegments.reduce((sum, s) => sum + s.originalWords, 0);
    const totalTranslated = validSegments.reduce((sum, s) => sum + s.translatedWords, 0);
    console.log(`║     Original words: ${totalOriginal}`);
    console.log(`║     Spanish words: ${totalTranslated} (${((totalTranslated/totalOriginal)*100).toFixed(0)}%)`);
    
    console.log(`║`);
    console.log(`║  💾 Saved: translation.json`);
    console.log(`╚${"═".repeat(62)}╝`);

    // Show sample translations
    console.log(`\n📝 Sample translations:`);
    validSegments.slice(0, 5).forEach((seg, i) => {
      console.log(`\n   ${i + 1}. [${seg.start.toFixed(1)}s-${seg.end.toFixed(1)}s]`);
      console.log(`      EN: "${seg.originalText.substring(0, 60)}${seg.originalText.length > 60 ? "..." : ""}"`);
      console.log(`      ES: "${seg.translatedText.substring(0, 60)}${seg.translatedText.length > 60 ? "..." : ""}"`);
    });
    
    if (validSegments.length > 5) {
      console.log(`\n   ... and ${validSegments.length - 5} more segments`);
    }

    console.log(`\n📝 Next steps:`);
    console.log(`   1. Review translation.json`);
    console.log(`   2. Generate TTS for each segment`);
    console.log(`   3. Align TTS to match original timing`);
    console.log(`   4. Merge aligned TTS with background audio`);

  } catch (error) {
    console.error(`\n❌ Test failed: ${error.message}`);
    console.error(error);
    process.exit(1);
  }
}

// Run test
const jobId = process.argv[2];
const level = process.argv[3] || "B1";
runTest(jobId, level);
