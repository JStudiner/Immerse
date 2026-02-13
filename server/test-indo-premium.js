#!/usr/bin/env node
/**
 * Test script for Indonesian Premium Dubbing (ElevenLabs)
 * 
 * Features:
 * - Indonesian translation with timing-aware word count
 * - Premium ElevenLabs voices (Firman, Bian, Meraki)
 * - Dynamic word count based on level + segment duration
 * 
 * Usage:
 *   node test-indo-premium.js <youtube-id-or-url> [level]
 *   node test-indo-premium.js PXAOZwvv04 A2
 *   node test-indo-premium.js https://youtube.com/watch?v=PXAOZwvv04 B1
 */

require("dotenv").config();
const path = require("path");
const fs = require("fs");
const { v4: uuidv4 } = require("uuid");

// Import v2 modules
const { ingest } = require("./src/v2/ingest");
const { split } = require("./src/v2/split");
const { transcribe, mergeCloseSegments, calculatePauses, detectAndHandleOverlaps } = require("./src/v2/transcribe");
const { translateNarrator, detectGender, LEVEL_GUIDES } = require("./src/v2/translate");
const { generateTTS, elevenlabs } = require("./src/v2/tts");
const { merge, renderVideo } = require("./src/v2/merge");

const OUTPUT_DIR = path.join(__dirname, "output");

/**
 * Indonesian male voice assignment for 2 speakers
 */
const INDO_MALE_VOICES = {
  SPEAKER_00: "firman",
  SPEAKER_01: "bian",
  // Fallbacks
  SPEAKER_02: "adam",
  SPEAKER_03: "josh",
};

/**
 * Create speaker-voice map for Indonesian male speakers
 */
function createIndoSpeakerMap(segments) {
  const speakers = [...new Set(segments.map(s => s.speaker).filter(Boolean))];
  const map = {};
  
  speakers.forEach((speaker, i) => {
    map[speaker] = INDO_MALE_VOICES[speaker] || INDO_MALE_VOICES[`SPEAKER_0${i}`] || "firman";
  });
  
  console.log(`\n🎭 Indonesian Speaker Voice Map:`);
  for (const [speaker, voice] of Object.entries(map)) {
    console.log(`   ${speaker} → ${voice}`);
  }
  
  return map;
}

async function runTest(source, level = "A2") {
  console.log(`
╔══════════════════════════════════════════════════════════════╗
║  🇮🇩 INDONESIAN PREMIUM DUBBING TEST (ElevenLabs)            ║
║                                                              ║
║  Voices: Firman & Bian (Indonesian males)                    ║
║  Mode: Narrator (timing-matched word count)                  ║
╚══════════════════════════════════════════════════════════════╝
  `);

  // Check API keys
  if (!process.env.ELEVENLABS_API_KEY) {
    console.error("❌ ELEVENLABS_API_KEY not set!");
    console.error("   Add to .env: ELEVENLABS_API_KEY=your_key_here");
    process.exit(1);
  }
  console.log("✅ ElevenLabs API key set");

  if (!process.env.GEMINI_API_KEY) {
    console.error("❌ GEMINI_API_KEY not set!");
    process.exit(1);
  }
  console.log("✅ Gemini API key set");

  if (!process.env.LEMONFOX_API_KEY) {
    console.error("❌ LEMONFOX_API_KEY not set (needed for transcription)!");
    process.exit(1);
  }
  console.log("✅ Lemonfox API key set");

  // Normalize source URL
  if (!source.includes("http") && !source.includes("/")) {
    source = `https://www.youtube.com/watch?v=${source}`;
  }

  // Create job directory
  const jobId = `indo_${uuidv4().substring(0, 8)}`;
  const jobDir = path.join(OUTPUT_DIR, jobId);
  fs.mkdirSync(jobDir, { recursive: true });

  console.log(`\n📁 Job: ${jobId}`);
  console.log(`   Output: ${jobDir}`);
  console.log(`   Level: ${level} (${LEVEL_GUIDES[level]?.name || "Unknown"})`);
  console.log(`   Language: Indonesian`);
  console.log(`   Mode: Narrator (timing-matched)`);

  const startTime = Date.now();

  try {
    // ═══════════════════════════════════════════════════════════
    // STEP 1: INGEST
    // ═══════════════════════════════════════════════════════════
    console.log(`\n${"═".repeat(60)}`);
    console.log(`📥 STEP 1: Ingest Video`);
    console.log(`${"═".repeat(60)}`);
    
    const ingestResult = await ingest(source, jobDir);
    console.log(`   ✅ Duration: ${(ingestResult.media.duration / 60).toFixed(1)} minutes`);

    // ═══════════════════════════════════════════════════════════
    // STEP 2: SPLIT (background) + TRANSCRIBE (parallel)
    // ═══════════════════════════════════════════════════════════
    console.log(`\n${"═".repeat(60)}`);
    console.log(`⚡ STEP 2: Split + Transcribe (parallel)`);
    console.log(`${"═".repeat(60)}`);
    
    const splitPromise = split(ingestResult.audioPath, jobDir, { model: "htdemucs" });
    
    const transcribeResult = await transcribe(ingestResult.audioPath, {
      language: "english", // Source language
      speakerLabels: true,
    });
    console.log(`   ✅ Transcribed: ${transcribeResult.segments.length} segments`);

    // Merge close segments
    const mergedSegments = mergeCloseSegments(transcribeResult.segments, {
      maxGap: 0.5,
      maxDuration: 12,
    });

    // Handle overlaps
    const { segments: cleanSegments } = detectAndHandleOverlaps(mergedSegments, {
      strategy: "truncate",
    });

    // Add pause info
    const segmentsWithPauses = calculatePauses(cleanSegments);

    // Save transcription
    fs.writeFileSync(
      path.join(jobDir, "transcription.json"),
      JSON.stringify({ segments: segmentsWithPauses }, null, 2)
    );

    // ═══════════════════════════════════════════════════════════
    // STEP 3: TRANSLATE (Indonesian, narrator mode)
    // ═══════════════════════════════════════════════════════════
    console.log(`\n${"═".repeat(60)}`);
    console.log(`🌏 STEP 3: Translate to Indonesian (Narrator Mode)`);
    console.log(`${"═".repeat(60)}`);
    console.log(`   📋 Mode: Dynamic word count based on level + timing`);
    console.log(`   📋 Level ${level}: TTS speed ${LEVEL_GUIDES[level]?.ttsSpeed || 0.85}x`);

    const translatedSegments = await translateNarrator(segmentsWithPauses, {
      level,
      batchSize: 10,
      concurrency: 10,
      targetLanguage: "indonesian",
    });
    console.log(`   ✅ Translated: ${translatedSegments.length} segments`);

    // Save translation
    fs.writeFileSync(
      path.join(jobDir, "translation.json"),
      JSON.stringify({
        level,
        language: "indonesian",
        mode: "narrator",
        segments: translatedSegments,
      }, null, 2)
    );

    // ═══════════════════════════════════════════════════════════
    // STEP 4: PREMIUM TTS (ElevenLabs - Firman & Bian)
    // ═══════════════════════════════════════════════════════════
    console.log(`\n${"═".repeat(60)}`);
    console.log(`🎙️ STEP 4: Premium TTS (ElevenLabs)`);
    console.log(`${"═".repeat(60)}`);

    // Create speaker-voice mapping
    const speakerVoiceMap = createIndoSpeakerMap(translatedSegments);

    // Filter valid segments
    const validSegments = translatedSegments.filter(
      s => s && !s.error && s.translatedText && s.translatedText !== "[ERROR: Translation failed]"
    );
    console.log(`   📋 Valid segments: ${validSegments.length}`);

    // Estimate cost
    const totalChars = validSegments.reduce((sum, s) => sum + (s.translatedText || "").length, 0);
    console.log(`   💰 Estimated credits: ~${totalChars}`);

    // Generate TTS with ElevenLabs premium
    const ttsResult = await generateTTS(validSegments, jobDir, {
      premium: true, // Use ElevenLabs
      voice: "firman", // Default voice
      concurrency: 3, // ElevenLabs rate limit
      mode: "narrator",
      language: "indonesian",
      multiSpeaker: true,
      speakerVoices: speakerVoiceMap, // Pre-assigned Firman & Bian
      speakerGenders: Object.fromEntries(
        Object.keys(speakerVoiceMap).map(k => [k, "male"])
      ),
    });

    console.log(`   ✅ Generated: ${ttsResult.stats.success}/${ttsResult.stats.total} segments`);

    // Save TTS result
    fs.writeFileSync(
      path.join(jobDir, "tts_result.json"),
      JSON.stringify({
        provider: "elevenlabs",
        voices: speakerVoiceMap,
        stats: ttsResult.stats,
        segments: ttsResult.segments,
      }, null, 2)
    );

    // ═══════════════════════════════════════════════════════════
    // STEP 5: MERGE + RENDER
    // ═══════════════════════════════════════════════════════════
    console.log(`\n${"═".repeat(60)}`);
    console.log(`🎬 STEP 5: Merge + Render`);
    console.log(`${"═".repeat(60)}`);

    // Wait for split to complete
    console.log(`   ⏳ Waiting for audio split...`);
    const splitResult = await splitPromise;
    console.log(`   ✅ Split complete`);

    const dubbedAudioPath = path.join(jobDir, "dubbed_audio_indo.m4a");
    const segmentsForMerge = ttsResult.segments
      .filter(s => s.alignedFile && !s.error && !s.skipped)
      .map(s => ({ ...s, alignedFile: s.alignedFile }));

    const mergeResult = await merge(
      splitResult.background,
      segmentsForMerge,
      dubbedAudioPath,
      { backgroundVolume: 0.5, ttsVolume: 1.8 }
    );
    console.log(`   ✅ Audio merged: ${(mergeResult.size / 1024 / 1024).toFixed(1)} MB`);

    // Render video
    const dubbedVideoPath = path.join(jobDir, "dubbed_video_indo.mp4");
    const renderResult = await renderVideo(
      ingestResult.videoPath,
      dubbedAudioPath,
      dubbedVideoPath
    );
    console.log(`   ✅ Video rendered: ${(renderResult.size / 1024 / 1024).toFixed(1)} MB`);

    // ═══════════════════════════════════════════════════════════
    // DONE
    // ═══════════════════════════════════════════════════════════
    const totalTime = ((Date.now() - startTime) / 1000 / 60).toFixed(1);

    console.log(`
╔══════════════════════════════════════════════════════════════╗
║  ✅ INDONESIAN PREMIUM DUBBING COMPLETE!                     ║
╠══════════════════════════════════════════════════════════════╣
║                                                              ║
║  📁 Job: ${jobId.padEnd(50)}║
║  ⏱️  Time: ${totalTime} minutes                                     ║
║                                                              ║
║  🎙️ Voices Used:                                             ║
${Object.entries(speakerVoiceMap).map(([s, v]) => 
`║     ${s}: ${v.padEnd(46)}║`).join('\n')}
║                                                              ║
║  📦 Outputs:                                                 ║
║     🎬 ${dubbedVideoPath.split('/').pop().padEnd(50)}║
║     🎵 ${dubbedAudioPath.split('/').pop().padEnd(50)}║
║                                                              ║
╚══════════════════════════════════════════════════════════════╝

🎧 Play it:
   mpv "${dubbedVideoPath}"
   # or
   vlc "${dubbedVideoPath}"
    `);

    return { success: true, jobDir, dubbedVideoPath };

  } catch (error) {
    console.error(`\n❌ Error: ${error.message}`);
    console.error(error.stack);
    return { success: false, error: error.message };
  }
}

// CLI
const args = process.argv.slice(2);
const source = args[0];
const level = args[1] || "A2";

if (!source) {
  console.log(`
🇮🇩 Indonesian Premium Dubbing Test

Usage:
  node test-indo-premium.js <youtube-id-or-url> [level]

Examples:
  node test-indo-premium.js PXAOZwvv04 A2
  node test-indo-premium.js https://youtube.com/watch?v=VIDEO_ID B1

Levels: A1, A2 (default), B1, B2, C1

Voices:
  Firman - Indonesian male (i8CJLmX03JoyL7Dl2LaT)
  Bian   - Indonesian male (1k39YpzqXZn52BgyLyGO)
  Meraki - Indonesian female (OKanSStS6li6xyU1WdXa)
  `);
  process.exit(0);
}

runTest(source, level)
  .then(result => process.exit(result.success ? 0 : 1))
  .catch(err => {
    console.error("Fatal:", err);
    process.exit(1);
  });
