#!/usr/bin/env node
/**
 * Test script for Lip-Sync Mode (with Caching)
 *
 * This mode generates natural-paced TTS (no timing constraints)
 * and uses AI lip-sync to make the video match the audio.
 *
 * CACHING: Each step is cached, so you can:
 * - Resume from any point if something fails
 * - Re-run lip-sync with different settings without redoing TTS
 * - Skip expensive steps (split, transcribe) on re-runs
 *
 * Usage:
 *   node test-lipsync.js <youtube-id-or-url> [level] [language] [--job=existing_job_id]
 *   node test-lipsync.js PXAOZwvv04 A2 indonesian
 *   node test-lipsync.js --job=lipsync_abc123  # Resume existing job
 *   node test-lipsync.js --job=lipsync_abc123 --lipsync-only  # Just re-run lipsync
 *
 * Requirements:
 *   - SYNCLABS_API_KEY in .env (get at sync.so)
 *   - ELEVENLABS_API_KEY in .env (for premium voices)
 */

require("dotenv").config();
const path = require("path");
const fs = require("fs");
const { v4: uuidv4 } = require("uuid");

// Import v2 modules
const { ingest } = require("./src/v2/ingest");
const { split } = require("./src/v2/split");
const {
  transcribe,
  mergeCloseSegments,
  calculatePauses,
  detectAndHandleOverlaps,
} = require("./src/v2/transcribe");
const { translate, detectGender, LEVEL_GUIDES } = require("./src/v2/translate");
const { generateTTS, elevenlabs } = require("./src/v2/tts");
const { merge } = require("./src/v2/merge");
const {
  lipsync,
  concatenateSegments,
  checkApiKey: checkLipsyncApiKey,
  SYNCLABS_MODELS,
} = require("./src/v2/lipsync");

const OUTPUT_DIR = path.join(__dirname, "output");

/**
 * Indonesian speaker voices
 */
const INDO_VOICES = {
  SPEAKER_00: "firman",
  SPEAKER_01: "bian",
  SPEAKER_02: "adam",
};

/**
 * Spanish speaker voices (ElevenLabs)
 */
const SPANISH_VOICES = {
  male: ["adam", "josh", "daniel", "matthew", "liam"],
  female: ["veronica", "rachel", "sarah"],
};

/**
 * Cache file names for each step
 */
const CACHE_FILES = {
  ingest: "cache_ingest.json",
  split: "cache_split.json",
  transcription: "transcription.json",
  translation: "translation.json",
  tts: "tts_result.json",
  merge: "cache_merge.json",
  lipsync: "cache_lipsync.json",
};

/**
 * Load cached step data if it exists
 */
function loadCache(jobDir, step) {
  const cachePath = path.join(jobDir, CACHE_FILES[step]);
  if (fs.existsSync(cachePath)) {
    try {
      const data = JSON.parse(fs.readFileSync(cachePath, "utf8"));
      console.log(`   📦 Loaded cached ${step}`);
      return data;
    } catch (e) {
      console.log(`   ⚠️ Cache corrupted for ${step}, will regenerate`);
      return null;
    }
  }
  return null;
}

/**
 * Save step data to cache
 */
function saveCache(jobDir, step, data) {
  const cachePath = path.join(jobDir, CACHE_FILES[step]);
  fs.writeFileSync(cachePath, JSON.stringify(data, null, 2));
  console.log(`   💾 Cached ${step}`);
}

/**
 * Check what steps are already cached
 */
function checkCachedSteps(jobDir) {
  const cached = {};
  for (const [step, file] of Object.entries(CACHE_FILES)) {
    cached[step] = fs.existsSync(path.join(jobDir, file));
  }
  return cached;
}

async function runLipsyncTest(source, level = "B1", language = "spanish", options = {}) {
  const { existingJobId = null, lipsyncOnly = false, skipLipsync = false } = options;
  console.log(`
╔══════════════════════════════════════════════════════════════╗
║  👄 LIP-SYNC MODE TEST                                       ║
║                                                              ║
║  Natural TTS + AI Lip-Sync = Perfect Dubbing                 ║
╚══════════════════════════════════════════════════════════════╝
  `);

  // Check API keys
  const checks = {
    elevenlabs: !!process.env.ELEVENLABS_API_KEY,
    synclabs: checkLipsyncApiKey(),
    gemini: !!process.env.GEMINI_API_KEY,
    lemonfox: !!process.env.LEMONFOX_API_KEY,
  };

  console.log("📋 API Keys:");
  console.log(`   ElevenLabs: ${checks.elevenlabs ? "✅" : "❌"}`);
  console.log(`   Sync Labs:  ${checks.synclabs ? "✅" : "❌ (needed for lip-sync)"}`);
  console.log(`   Gemini:     ${checks.gemini ? "✅" : "❌"}`);
  console.log(`   Lemonfox:   ${checks.lemonfox ? "✅" : "❌"}`);

  if (!checks.synclabs) {
    console.log(`
⚠️  SYNCLABS_API_KEY not set!

To use lip-sync mode:
1. Sign up at https://sync.so
2. Get your API key
3. Add to .env: SYNCLABS_API_KEY=your_key_here

For now, I'll generate the dubbed audio without lip-sync.
You can manually submit to Sync Labs later.
    `);
  }

  // Use existing job or create new one
  let jobId, jobDir;
  if (existingJobId) {
    jobId = existingJobId;
    jobDir = path.join(OUTPUT_DIR, jobId);
    if (!fs.existsSync(jobDir)) {
      console.error(`❌ Job directory not found: ${jobDir}`);
      process.exit(1);
    }
    console.log(`\n📂 Resuming existing job: ${jobId}`);
  } else {
    // Normalize source
    if (!source.includes("http") && !source.includes("/")) {
      source = `https://www.youtube.com/watch?v=${source}`;
    }
    jobId = `lipsync_${uuidv4().substring(0, 8)}`;
    jobDir = path.join(OUTPUT_DIR, jobId);
    fs.mkdirSync(jobDir, { recursive: true });
    console.log(`\n📁 New job: ${jobId}`);
  }

  // Check what's already cached
  const cached = checkCachedSteps(jobDir);
  const cachedSteps = Object.entries(cached).filter(([_, v]) => v).map(([k]) => k);
  if (cachedSteps.length > 0) {
    console.log(`   📦 Cached steps: ${cachedSteps.join(", ")}`);
  }

  console.log(`   Output: ${jobDir}`);
  console.log(`   Level: ${level}`);
  console.log(`   Language: ${language}`);
  console.log(`   Mode: LIPSYNC (natural pace + AI lip-sync)`);
  if (lipsyncOnly) {
    console.log(`   ⚡ Lip-sync only mode (skipping to final step)`);
  }

  const startTime = Date.now();

  try {
    let ingestResult, splitResult, segmentsWithPauses, translatedSegments, ttsResult, mergeResult;
    let splitPromise = null;
    const dubbedAudioPath = path.join(jobDir, "dubbed_audio_lipsync.m4a");

    // ═══════════════════════════════════════════════════════════
    // STEP 1: INGEST (with caching)
    // ═══════════════════════════════════════════════════════════
    if (!lipsyncOnly) {
      console.log(`\n${"═".repeat(60)}`);
      console.log(`📥 STEP 1: Ingest Video`);
      console.log(`${"═".repeat(60)}`);

      ingestResult = loadCache(jobDir, "ingest");
      if (!ingestResult) {
        ingestResult = await ingest(source, jobDir);
        saveCache(jobDir, "ingest", {
          videoPath: ingestResult.videoPath,
          audioPath: ingestResult.audioPath,
          media: ingestResult.media,
          source: ingestResult.source,
        });
        console.log(`   ✅ Duration: ${(ingestResult.media.duration / 60).toFixed(1)} minutes`);
      } else {
        console.log(`   ✅ Using cached ingest (${(ingestResult.media.duration / 60).toFixed(1)} min)`);
      }
    } else {
      // Lip-sync only mode - load from cache
      ingestResult = loadCache(jobDir, "ingest");
      if (!ingestResult) {
        throw new Error("No cached ingest data. Run without --lipsync-only first.");
      }
    }

    // ═══════════════════════════════════════════════════════════
    // STEP 2: SPLIT + TRANSCRIBE (with caching)
    // ═══════════════════════════════════════════════════════════
    if (!lipsyncOnly) {
      console.log(`\n${"═".repeat(60)}`);
      console.log(`⚡ STEP 2: Split + Transcribe`);
      console.log(`${"═".repeat(60)}`);

      // Check split cache
      splitResult = loadCache(jobDir, "split");
      if (!splitResult) {
        splitPromise = split(ingestResult.audioPath, jobDir, { model: "htdemucs" });
      } else {
        console.log(`   ✅ Using cached split`);
      }

      // Check transcription cache
      const transcriptionCache = loadCache(jobDir, "transcription");
      if (transcriptionCache && transcriptionCache.segments) {
        segmentsWithPauses = transcriptionCache.segments;
        console.log(`   ✅ Using cached transcription (${segmentsWithPauses.length} segments)`);
      } else {
        const transcribeResult = await transcribe(ingestResult.audioPath, {
          language: "english",
          speakerLabels: true,
        });
        console.log(`   ✅ Transcribed: ${transcribeResult.segments.length} segments`);

        // Process segments
        const mergedSegments = mergeCloseSegments(transcribeResult.segments, {
          maxGap: 0.5,
          maxDuration: 15,
        });

        const { segments: cleanSegments } = detectAndHandleOverlaps(mergedSegments, {
          strategy: "truncate",
        });

        segmentsWithPauses = calculatePauses(cleanSegments);

        saveCache(jobDir, "transcription", { 
          text: transcribeResult.text,
          segments: segmentsWithPauses 
        });
      }
    } else {
      // Load from cache
      splitResult = loadCache(jobDir, "split");
      const transcriptionCache = loadCache(jobDir, "transcription");
      if (!splitResult || !transcriptionCache) {
        throw new Error("Missing cached data. Run without --lipsync-only first.");
      }
      segmentsWithPauses = transcriptionCache.segments;
    }

    // ═══════════════════════════════════════════════════════════
    // STEP 3: TRANSLATE (with caching)
    // ═══════════════════════════════════════════════════════════
    if (!lipsyncOnly) {
      console.log(`\n${"═".repeat(60)}`);
      console.log(`🌏 STEP 3: Translate (${language})`);
      console.log(`${"═".repeat(60)}`);

      const translationCache = loadCache(jobDir, "translation");
      if (translationCache && translationCache.segments && translationCache.language === language && translationCache.level === level) {
        translatedSegments = translationCache.segments;
        console.log(`   ✅ Using cached translation (${translatedSegments.length} segments)`);
      } else {
        console.log(`   ℹ️  Full translation - no timing constraints!`);
        translatedSegments = await translate(segmentsWithPauses, {
          level,
          batchSize: 60,
          concurrency: 15,
          targetLanguage: language,
        });
        console.log(`   ✅ Translated: ${translatedSegments.length} segments`);

        saveCache(jobDir, "translation", {
          level,
          language,
          mode: "lipsync",
          segments: translatedSegments,
        });
      }
    } else {
      const translationCache = loadCache(jobDir, "translation");
      if (!translationCache) {
        throw new Error("Missing cached translation. Run without --lipsync-only first.");
      }
      translatedSegments = translationCache.segments;
    }

    // ═══════════════════════════════════════════════════════════
    // STEP 4: TTS (with caching)
    // ═══════════════════════════════════════════════════════════
    if (!lipsyncOnly) {
      console.log(`\n${"═".repeat(60)}`);
      console.log(`🎙️ STEP 4: Generate TTS (Natural Pace)`);
      console.log(`${"═".repeat(60)}`);

      // Check if TTS files exist
      const ttsCache = loadCache(jobDir, "tts");
      const ttsDir = path.join(jobDir, "tts_elevenlabs");
      const ttsFilesExist = ttsCache && fs.existsSync(ttsDir) && fs.readdirSync(ttsDir).length > 0;

      if (ttsFilesExist) {
        console.log(`   ✅ Using cached TTS (${ttsCache.stats?.success || "?"} segments)`);
        // Reconstruct ttsResult from cache
        ttsResult = {
          stats: ttsCache.stats,
          segments: translatedSegments.map((seg, i) => {
            const ttsFile = path.join(ttsDir, `tts_${String(i).padStart(4, "0")}.mp3`);
            return {
              ...seg,
              alignedFile: fs.existsSync(ttsFile) ? ttsFile : null,
            };
          }).filter(s => s.alignedFile),
        };
      } else {
        console.log(`   ℹ️  No speed adjustments - natural speech`);
        console.log(`   ℹ️  Using ElevenLabs premium voices`);

        // Create speaker voice map
        const speakers = [...new Set(translatedSegments.map((s) => s.speaker).filter(Boolean))];
        const speakerVoices = {};
        speakers.forEach((speaker, i) => {
          if (language === "indonesian") {
            speakerVoices[speaker] = INDO_VOICES[speaker] || INDO_VOICES[`SPEAKER_0${i}`] || "firman";
          } else {
            // Spanish - use male voices by default, cycle through them for multiple speakers
            const maleVoices = SPANISH_VOICES.male;
            speakerVoices[speaker] = maleVoices[i % maleVoices.length];
          }
        });

        console.log(`   🎭 Speaker voices:`);
        for (const [speaker, voice] of Object.entries(speakerVoices)) {
          console.log(`      ${speaker} → ${voice}`);
        }

        // Filter valid segments
        const validSegments = translatedSegments.filter(
          (s) => s && !s.error && s.translatedText && s.translatedText !== "[ERROR: Translation failed]"
        );

        // Generate TTS
        ttsResult = await generateTTS(validSegments, jobDir, {
          premium: true,
          voice: language === "indonesian" ? "firman" : "adam", // Male voice for Spanish
          concurrency: 3,
          mode: "synced",
          language,
          multiSpeaker: true,
          speakerVoices,
          durationTolerance: 1.0,
          maxRetries: 0,
        });

        console.log(`   ✅ Generated: ${ttsResult.stats.success}/${ttsResult.stats.total} segments`);

        saveCache(jobDir, "tts", {
          provider: "elevenlabs",
          mode: "lipsync",
          voices: speakerVoices,
          stats: ttsResult.stats,
          ttsDir: ttsDir,
        });
      }
    } else {
      // Load TTS from cache
      const ttsCache = loadCache(jobDir, "tts");
      const ttsDir = path.join(jobDir, "tts_elevenlabs");
      if (!ttsCache || !fs.existsSync(ttsDir)) {
        throw new Error("Missing cached TTS. Run without --lipsync-only first.");
      }
      ttsResult = {
        stats: ttsCache.stats,
        segments: translatedSegments.map((seg, i) => {
          const ttsFile = path.join(ttsDir, `tts_${String(i).padStart(4, "0")}.mp3`);
          return {
            ...seg,
            alignedFile: fs.existsSync(ttsFile) ? ttsFile : null,
          };
        }).filter(s => s.alignedFile),
      };
      console.log(`   📦 Loaded ${ttsResult.segments.length} cached TTS segments`);
    }

    // ═══════════════════════════════════════════════════════════
    // STEP 5: MERGE AUDIO (with caching)
    // ═══════════════════════════════════════════════════════════
    console.log(`\n${"═".repeat(60)}`);
    console.log(`🎵 STEP 5: Merge Audio`);
    console.log(`${"═".repeat(60)}`);

    // Check if merged audio exists
    if (fs.existsSync(dubbedAudioPath) && !lipsyncOnly) {
      const stats = fs.statSync(dubbedAudioPath);
      console.log(`   ✅ Using cached merged audio (${(stats.size / 1024 / 1024).toFixed(1)}MB)`);
      mergeResult = { size: stats.size, path: dubbedAudioPath };
    } else if (fs.existsSync(dubbedAudioPath) && lipsyncOnly) {
      const stats = fs.statSync(dubbedAudioPath);
      console.log(`   📦 Using existing merged audio (${(stats.size / 1024 / 1024).toFixed(1)}MB)`);
      mergeResult = { size: stats.size, path: dubbedAudioPath };
    } else {
      // Wait for split if needed
      if (splitPromise) {
        splitResult = await splitPromise;
        saveCache(jobDir, "split", {
          vocals: splitResult.vocals,
          background: splitResult.background,
          processingTime: splitResult.processingTime,
        });
        console.log(`   ✅ Split complete`);
      } else if (!splitResult) {
        splitResult = loadCache(jobDir, "split");
      }

      const segmentsForMerge = ttsResult.segments
        .filter((s) => s.alignedFile && !s.error && !s.skipped)
        .map((s) => ({ ...s }));

      mergeResult = await merge(
        splitResult.background,
        segmentsForMerge,
        dubbedAudioPath,
        { backgroundVolume: 0.4, ttsVolume: 1.8 }
      );
      console.log(`   ✅ Audio merged: ${(mergeResult.size / 1024 / 1024).toFixed(1)}MB`);

      saveCache(jobDir, "merge", {
        path: dubbedAudioPath,
        size: mergeResult.size,
      });
    }

    // ═══════════════════════════════════════════════════════════
    // STEP 6: LIP-SYNC (if API key available)
    // ═══════════════════════════════════════════════════════════
    let lipsyncResult = null;
    const lipsyncVideoPath = path.join(jobDir, "dubbed_video_lipsync.mp4");

    if (skipLipsync) {
      console.log(`\n${"═".repeat(60)}`);
      console.log(`⏭️  STEP 6: Skipped (--no-lipsync flag)`);
      console.log(`${"═".repeat(60)}`);
      console.log(`   ✅ All steps cached! Ready for lip-sync later.`);
      console.log(`   📋 Run lip-sync with:`);
      console.log(`      node test-lipsync.js --job=${jobId} --lipsync-only`);
    } else if (checks.synclabs) {
      console.log(`\n${"═".repeat(60)}`);
      console.log(`👄 STEP 6: AI Lip-Sync (Sync Labs)`);
      console.log(`${"═".repeat(60)}`);
      console.log(`   Model: ${SYNCLABS_MODELS.cheap} (lipsync-1.9.0-beta - CHEAP)`);
      console.log(`   💰 Price: $0.02-0.025/sec (half of lipsync-2)`);

      lipsyncResult = await lipsync(
        ingestResult.videoPath,
        dubbedAudioPath,
        lipsyncVideoPath,
        { model: SYNCLABS_MODELS.cheap } // Cheaper model!
      );
      console.log(`   ✅ Lip-sync complete! Processing time: ${lipsyncResult.processingTime.toFixed(0)}s`);
      if (lipsyncResult.creditsUsed) {
        console.log(`   💰 Credits used: ${lipsyncResult.creditsUsed}`);
      }
    } else {
      console.log(`\n${"═".repeat(60)}`);
      console.log(`⏭️  STEP 6: Skipped (no SYNCLABS_API_KEY)`);
      console.log(`${"═".repeat(60)}`);
      console.log(`   📋 Dubbed audio is ready for manual lip-sync`);
      console.log(`   📋 Upload to sync.so with:`);
      console.log(`      Video: ${ingestResult.videoPath}`);
      console.log(`      Audio: ${dubbedAudioPath}`);
    }

    // ═══════════════════════════════════════════════════════════
    // DONE
    // ═══════════════════════════════════════════════════════════
    const totalTime = ((Date.now() - startTime) / 1000 / 60).toFixed(1);

    console.log(`
╔══════════════════════════════════════════════════════════════╗
║  ✅ LIP-SYNC MODE COMPLETE!                                  ║
╠══════════════════════════════════════════════════════════════╣
║                                                              ║
║  📁 Job: ${jobId.padEnd(50)}║
║  ⏱️  Time: ${totalTime} minutes                                     ║
║                                                              ║
║  📦 Outputs:                                                 ║
║     🎵 ${path.basename(dubbedAudioPath).padEnd(50)}║${
      lipsyncResult
        ? `
║     🎬 ${path.basename(lipsyncVideoPath).padEnd(50)}║`
        : `
║     ⚠️  No lip-synced video (add SYNCLABS_API_KEY)           ║`
    }
║                                                              ║
║  🎯 Benefits of lip-sync mode:                               ║
║     • Natural speech pace                                    ║
║     • No skipped segments                                    ║
║     • Full translation                                       ║
║     • Lips match the audio!                                  ║
║                                                              ║
╚══════════════════════════════════════════════════════════════╝

🎧 Play it:
   ${lipsyncResult ? `mpv "${lipsyncVideoPath}"` : `mpv "${dubbedAudioPath}"`}
    `);

    return { success: true, jobDir, dubbedAudioPath, lipsyncVideoPath: lipsyncResult ? lipsyncVideoPath : null };
  } catch (error) {
    console.error(`\n❌ Error: ${error.message}`);
    console.error(error.stack);
    return { success: false, error: error.message };
  }
}

// CLI
const args = process.argv.slice(2);

// Parse flags
const jobFlag = args.find(a => a.startsWith("--job="));
const existingJobId = jobFlag ? jobFlag.split("=")[1] : null;
const lipsyncOnly = args.includes("--lipsync-only");
const skipLipsync = args.includes("--no-lipsync") || args.includes("--cache-only");

// Get positional args (filter out flags)
const positionalArgs = args.filter(a => !a.startsWith("--"));
const source = positionalArgs[0];
const level = positionalArgs[1] || "B1";
const language = positionalArgs[2] || "spanish";

if (!source && !existingJobId) {
  console.log(`
👄 Lip-Sync Mode Test (with Caching)

Usage:
  node test-lipsync.js <youtube-id-or-url> [level] [language] [flags]

New Job (cache everything first, skip lip-sync):
  node test-lipsync.js PXAOZwvv04 A2 indonesian --no-lipsync
  node test-lipsync.js dQw4w9WgXcQ B1 spanish --no-lipsync

Then run lip-sync on cached data:
  node test-lipsync.js --job=lipsync_abc123 --lipsync-only

Full run (everything including lip-sync):
  node test-lipsync.js PXAOZwvv04 A2 indonesian

Resume interrupted job:
  node test-lipsync.js --job=lipsync_abc123

Flags:
  --no-lipsync    Skip the lip-sync step (just cache everything else)
  --cache-only    Same as --no-lipsync
  --lipsync-only  Only run lip-sync (requires cached data)
  --job=ID        Use existing job directory

Levels: A1, A2, B1 (default), B2, C1
Languages: spanish (default), indonesian

Caching:
  Each step is cached automatically:
  ✅ ingest      - Video download
  ✅ split       - Demucs audio separation  
  ✅ transcribe  - Whisper transcription
  ✅ translate   - Gemini translation
  ✅ tts         - ElevenLabs TTS audio files
  ✅ merge       - Final dubbed audio
  
  Re-running will skip completed steps!

Requirements:
  SYNCLABS_API_KEY - Get at https://sync.so (only for lip-sync step)
  ELEVENLABS_API_KEY - For premium voices
  `);
  process.exit(0);
}

runLipsyncTest(source, level, language, { existingJobId, lipsyncOnly, skipLipsync })
  .then((result) => process.exit(result.success ? 0 : 1))
  .catch((err) => {
    console.error("Fatal:", err);
    process.exit(1);
  });
