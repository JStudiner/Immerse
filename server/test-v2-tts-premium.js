/**
 * Test script for Immersion v2 - Premium TTS (ElevenLabs)
 * 
 * Uses the translation.json from a previous test
 * Generates premium TTS using ElevenLabs
 * 
 * Usage:
 *   node test-v2-tts-premium.js [job_id] [voice]
 *   node test-v2-tts-premium.js test_07b6f21f adam
 *   node test-v2-tts-premium.js test_07b6f21f rachel
 * 
 * Available voices: adam, rachel, josh, sarah, matilda, matthew, daniel, etc.
 * See elevenlabs.js for full voice list
 */

require("dotenv").config();
const fs = require("fs");
const path = require("path");
const { generateTTS, elevenlabs } = require("./src/v2");

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

async function runTest(jobId, voiceType = "adam") {
  console.log(`╔${"═".repeat(62)}╗`);
  console.log(`║  🎙️ IMMERSION v2 TEST - Premium TTS (ElevenLabs)               ║`);
  console.log(`╚${"═".repeat(62)}╝`);
  console.log("");

  // Check API key
  if (!process.env.ELEVENLABS_API_KEY) {
    console.error("❌ ELEVENLABS_API_KEY not set in environment!");
    console.error("");
    console.error("   To get an API key:");
    console.error("   1. Sign up at https://elevenlabs.io");
    console.error("   2. Go to Settings → API Keys");
    console.error("   3. Create a new API key");
    console.error("   4. Add to .env: ELEVENLABS_API_KEY=your_key_here");
    process.exit(1);
  }
  console.log("📋 ElevenLabs API key: ✅ Set");

  // Get voice
  const voice = elevenlabs.ELEVENLABS_VOICES[voiceType] ? voiceType : "adam";
  console.log(`🎤 Voice: ${voice}`);

  // Show available voices
  console.log(`\n📜 Popular voices for Spanish content:`);
  console.log(`   Male: adam, josh, daniel, matthew, liam`);
  console.log(`   Female: rachel, sarah, matilda, charlotte, grace`);

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

  console.log(`\n📁 Using job: ${testDir.name}`);
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

  // Estimate cost (ElevenLabs charges per character)
  const totalChars = validSegments.reduce((sum, s) => sum + s.translatedText.length, 0);
  console.log(`\n💰 Estimated cost:`);
  console.log(`   Characters: ${totalChars}`);
  console.log(`   Credits: ~${totalChars} (1 credit per character)`);
  console.log(`   Free tier: 10,000 credits/month`);

  const startTime = Date.now();

  try {
    // Run Premium TTS with ElevenLabs
    const result = await generateTTS(validSegments, testDir.path, {
      premium: true, // Use ElevenLabs
      voice,
      concurrency: 3, // ElevenLabs rate limit
      mode: "synced",
    });

    // Save results
    const outputPath = path.join(testDir.path, "tts_premium_result.json");
    fs.writeFileSync(outputPath, JSON.stringify({
      provider: "elevenlabs",
      voice,
      model: result.model,
      stats: result.stats,
      segments: result.segments.map(s => ({
        index: s.index,
        start: s.start,
        end: s.end,
        targetDuration: s.targetDuration,
        actualDuration: s.actualDuration,
        ttsFile: s.ttsFile ? path.basename(s.ttsFile) : null,
        voice: s.voice,
      })),
      generatedAt: new Date().toISOString(),
    }, null, 2));

    const totalTime = ((Date.now() - startTime) / 1000).toFixed(1);

    // Print summary
    console.log(`\n╔${"═".repeat(62)}╗`);
    console.log(`║  ✅ PREMIUM TTS COMPLETE (ElevenLabs)                         ║`);
    console.log(`╠${"═".repeat(62)}╣`);
    console.log(`║  Time: ${totalTime}s`);
    console.log(`║  Provider: ElevenLabs`);
    console.log(`║  Voice: ${voice}`);
    console.log(`║`);
    console.log(`║  📊 Statistics:`);
    console.log(`║     Generated: ${result.stats.success}/${result.stats.total}`);
    console.log(`║     Skipped: ${result.stats.skipped}`);
    console.log(`║     Failed: ${result.stats.failed}`);
    console.log(`║`);
    console.log(`║  📁 Output:`);
    console.log(`║     TTS files: ${result.ttsDir}`);
    console.log(`║`);
    console.log(`║  💾 Saved: tts_premium_result.json`);
    console.log(`╚${"═".repeat(62)}╝`);

    // Show sample results
    const validResults = result.segments.filter(s => !s.error && !s.skipped).slice(0, 3);
    if (validResults.length > 0) {
      console.log(`\n📝 Sample generations:`);
      validResults.forEach((seg, i) => {
        console.log(`   ${i + 1}. Segment ${seg.index}:`);
        console.log(`      Voice: ${seg.voice}`);
        console.log(`      Duration: ${seg.actualDuration?.toFixed(2) || "?"}s`);
        console.log(`      File: ${seg.ttsFile ? path.basename(seg.ttsFile) : "N/A"}`);
      });
    }

    console.log(`\n📝 Next steps:`);
    console.log(`   1. Compare with regular TTS (test-v2-tts.js)`);
    console.log(`   2. Merge premium TTS with background audio`);
    console.log(`   3. Render final video`);

  } catch (error) {
    console.error(`\n❌ Test failed: ${error.message}`);
    console.error(error);
    process.exit(1);
  }
}

// Run test
const jobId = process.argv[2];
const voiceType = process.argv[3] || "adam";
runTest(jobId, voiceType);
