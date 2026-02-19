/**
 * Qwen3-TTS via Replicate API
 *
 * Next-gen TTS with three powerful modes:
 *   - voice_clone:  Clone any voice from 3+ seconds of audio
 *   - voice_design: Create a voice from a text description (no sample needed!)
 *   - custom_voice: Use preset speakers with style instructions
 *
 * Replaces XTTS-v2 with better quality, lower latency, and voice design.
 *
 * Key advantages over XTTS:
 *   - voice_design mode: describe the voice you want in plain text
 *   - style_instruction: control prosody/emotion on any mode
 *   - 97ms first-packet latency (vs XTTS cold starts)
 *   - Better speaker similarity (0.789 across 10 languages)
 *   - Only needs 3s of reference audio (XTTS needed 6-10s)
 */

require("dotenv").config();
const Replicate = require("replicate");
const fs = require("fs");
const path = require("path");
const { promisify } = require("util");
const { exec, execSync } = require("child_process");
const { ConcurrentRateLimiter } = require("./rate-limiter");
const writeFile = promisify(fs.writeFile);
const readFile = promisify(fs.readFile);
const execAsync = promisify(exec);

// Reuse audio post-processing from xtts.js (speed adjustment, silence padding)
const {
  adjustAudioSpeed,
  padWithSilence,
  MAX_SPEEDUP,
} = require("./xtts");

// ════════════════════════════════════════════════════════════════════════════
// Configuration
// ════════════════════════════════════════════════════════════════════════════

const QWEN_TTS_MODEL = "qwen/qwen3-tts";

// Qwen3-TTS natively supported languages (only these 10)
const QWEN_LANGUAGES = {
  en: "English",
  english: "English",
  zh: "Chinese",
  chinese: "Chinese",
  mandarin: "Chinese",
  ja: "Japanese",
  japanese: "Japanese",
  ko: "Korean",
  korean: "Korean",
  de: "German",
  german: "German",
  fr: "French",
  french: "French",
  ru: "Russian",
  russian: "Russian",
  pt: "Portuguese",
  portuguese: "Portuguese",
  es: "Spanish",
  spanish: "Spanish",
  it: "Italian",
  italian: "Italian",
  auto: "auto",
};

// Set of supported language names for quick validation
const SUPPORTED_LANGUAGE_NAMES = new Set([
  "english", "chinese", "mandarin", "japanese", "korean",
  "german", "french", "russian", "portuguese", "spanish", "italian",
]);

/**
 * Check if a language name is natively supported by Qwen3-TTS.
 */
function isLanguageSupported(lang) {
  if (!lang || lang === "auto") return true;
  return SUPPORTED_LANGUAGE_NAMES.has(lang.toLowerCase());
}

/**
 * Normalize a language input to the API-expected format.
 * Accepts: "en", "english", "English", "auto", etc.
 * Returns "auto" for unsupported languages.
 */
function normalizeLanguage(lang) {
  if (!lang || lang === "auto") return "auto";
  const lower = lang.toLowerCase();
  if (QWEN_LANGUAGES[lower]) {
    const val = QWEN_LANGUAGES[lower];
    return val === "auto" ? "auto" : val;
  }
  return "auto";
}

// Preset speaker voices available in custom_voice mode
const PRESET_SPEAKERS = [
  "aiden",
  "dylan",
  "eric",
  "ryan",
  "serena",
  "vivian",
  "one_anna",
  "sohee",
  "uncle_fu",
];

// TTS modes
const QWEN_MODES = {
  VOICE_CLONE: "voice_clone",
  VOICE_DESIGN: "voice_design",
  CUSTOM_VOICE: "custom_voice",
};

// ════════════════════════════════════════════════════════════════════════════
// Utilities
// ════════════════════════════════════════════════════════════════════════════

function getAudioDuration(filePath) {
  try {
    const result = execSync(
      `ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "${filePath}"`,
      { encoding: "utf-8", timeout: 10000 },
    );
    return parseFloat(result.trim());
  } catch {
    return 0;
  }
}

// ════════════════════════════════════════════════════════════════════════════
// Core TTS Generation
// ════════════════════════════════════════════════════════════════════════════

/**
 * Generate TTS for a single text using Qwen3-TTS on Replicate.
 *
 * @param {string} text - Text to synthesize
 * @param {string} outputPath - Where to save the audio file
 * @param {object} options - Mode-specific options
 * @param {string} options.mode - "voice_clone" | "voice_design" | "custom_voice"
 * @param {string} [options.referenceAudio] - URL to reference audio (voice_clone mode)
 * @param {string} [options.referenceText] - Transcript of reference audio (improves clone quality)
 * @param {string} [options.voiceDescription] - Natural language voice description (voice_design mode)
 * @param {string} [options.speaker] - Preset speaker name (custom_voice mode)
 * @param {string} [options.styleInstruction] - Prosody/emotion control (all modes)
 * @param {string} [options.language] - Language code or "auto"
 * @returns {Promise<{success: boolean, outputPath?: string, error?: string}>}
 */
async function generateQwenTTS(text, outputPath, options = {}) {
  const {
    mode = QWEN_MODES.CUSTOM_VOICE,
    referenceAudio = null,
    referenceText = null,
    voiceDescription = null,
    speaker = "Aiden",
    styleInstruction = null,
    language = "auto",
  } = options;

  const apiToken =
    process.env.REPLICATE_API_TOKEN || process.env.REPLICATE_API_KEY;
  const replicate = new Replicate({ auth: apiToken });

  // Build input based on mode
  const input = {
    text,
    mode,
    language: normalizeLanguage(language),
  };

  if (mode === QWEN_MODES.VOICE_CLONE) {
    if (!referenceAudio) {
      return {
        success: false,
        error: "voice_clone mode requires referenceAudio",
      };
    }
    input.reference_audio = referenceAudio;
    if (referenceText) {
      input.reference_text = referenceText;
    }
  } else if (mode === QWEN_MODES.VOICE_DESIGN) {
    if (!voiceDescription) {
      return {
        success: false,
        error: "voice_design mode requires voiceDescription",
      };
    }
    input.voice_description = voiceDescription;
  } else {
    // custom_voice
    input.speaker = speaker;
  }

  if (styleInstruction) {
    input.style_instruction = styleInstruction;
  }

  try {
    const output = await replicate.run(QWEN_TTS_MODEL, { input });

    // Handle Replicate output formats
    if (output && typeof output.url === "function") {
      const url = output.url();
      const response = await fetch(url);
      const buffer = Buffer.from(await response.arrayBuffer());
      await writeFile(outputPath, buffer);
    } else if (typeof output === "string") {
      const response = await fetch(output);
      const buffer = Buffer.from(await response.arrayBuffer());
      await writeFile(outputPath, buffer);
    } else {
      await writeFile(outputPath, output);
    }

    return { success: true, outputPath };
  } catch (err) {
    console.error(`   ❌ Qwen TTS error: ${err.message}`);
    return { success: false, error: err.message };
  }
}

// ════════════════════════════════════════════════════════════════════════════
// Voice Sample Upload (for voice_clone mode)
// ════════════════════════════════════════════════════════════════════════════

/**
 * Preprocess and upload a voice sample to Replicate for reuse across segments.
 * Qwen3-TTS only needs 3 seconds but quality improves with up to 10-15s.
 *
 * @param {string} samplePath - Local path to voice sample
 * @param {string} workDir - Directory for temp files
 * @returns {Promise<{url: string, duration: number}>}
 */
async function uploadVoiceSample(samplePath, workDir) {
  const apiToken =
    process.env.REPLICATE_API_TOKEN || process.env.REPLICATE_API_KEY;
  const replicate = new Replicate({ auth: apiToken });

  // Preprocess: convert to clean WAV for best clone quality
  const processedPath = path.join(workDir, "qwen_voice_sample.wav");

  try {
    // Check input duration
    const inputDuration = getAudioDuration(samplePath);
    const MAX_SAMPLE = 15;
    const timeArgs =
      inputDuration > MAX_SAMPLE + 2
        ? `-ss 2 -t ${MAX_SAMPLE}`
        : "";

    execSync(
      `ffmpeg -y -i "${samplePath}" ${timeArgs} -af "highpass=f=80,lowpass=f=8000,loudnorm=I=-16:TP=-1.5:LRA=11,silenceremove=start_periods=1:start_silence=0.1:start_threshold=-40dB,areverse,silenceremove=start_periods=1:start_silence=0.1:start_threshold=-40dB,areverse" -ar 24000 -ac 1 "${processedPath}"`,
      { stdio: ["pipe", "pipe", "pipe"], timeout: 30000 },
    );

    const duration = getAudioDuration(processedPath);
    if (duration < 3) {
      console.warn(
        `   ⚠️ Voice sample too short after processing (${duration.toFixed(1)}s). Using original.`,
      );
      // Fall through to upload original
    }
  } catch (err) {
    console.warn(`   ⚠️ Voice preprocessing failed: ${err.message}`);
  }

  // Upload whichever file we have
  const uploadPath = fs.existsSync(processedPath) ? processedPath : samplePath;
  const buffer = await readFile(uploadPath);

  console.log(
    `   📤 Uploading voice sample (${(buffer.length / 1024).toFixed(1)} KB)...`,
  );

  const file = await replicate.files.create(buffer, {
    filename: path.basename(uploadPath),
  });

  const duration = getAudioDuration(uploadPath);
  console.log(
    `   ✅ Voice sample uploaded: ${duration.toFixed(1)}s`,
  );

  return { url: file.urls.get, duration };
}

// ════════════════════════════════════════════════════════════════════════════
// Batch TTS with Timing Alignment
// ════════════════════════════════════════════════════════════════════════════

/**
 * Generate TTS for all segments with timing alignment.
 * Supports all three Qwen3-TTS modes.
 *
 * For remix pipeline:
 *   - voice_design mode: each segment uses the style's voiceDescription
 *   - voice_clone mode: clones from reference audio (like XTTS but better)
 *   - custom_voice mode: uses preset Qwen speakers
 *
 * @param {array} segments - Array of segments with text fields
 * @param {string} outputDir - Output directory
 * @param {object} options - Generation options
 * @returns {Promise<object>} Results with stats and aligned segments
 */
async function generateAndAlignQwen(segments, outputDir, options = {}) {
  const {
    mode = QWEN_MODES.CUSTOM_VOICE,
    voiceDescription = null,
    styleInstruction = null,
    speaker = "Aiden",
    referenceAudioUrl = null,
    referenceText = null,
    language = "auto",
    concurrency = 10,
    maxTPS = 10,
    // Per-speaker overrides (maps speakerId -> config)
    speakerReferenceUrls = null, // { SPEAKER_00: "https://...", SPEAKER_01: "https://..." }
    speakerReferenceTexts = null, // { SPEAKER_00: "text of sample", SPEAKER_01: "text of sample" }
    speakerVoiceMap = null, // { SPEAKER_00: { speaker: "aiden" }, SPEAKER_01: { speaker: "serena" } }
  } = options;

  const speakerCount = speakerReferenceUrls
    ? Object.keys(speakerReferenceUrls).length
    : speakerVoiceMap
      ? Object.keys(speakerVoiceMap).length
      : 0;

  const modeLabel =
    mode === QWEN_MODES.VOICE_DESIGN
      ? "Voice Design"
      : mode === QWEN_MODES.VOICE_CLONE
        ? "Voice Clone"
        : "Custom Voice";

  console.log(`\n${"═".repeat(60)}`);
  console.log(`🎙️ QWEN3-TTS: ${modeLabel}`);
  console.log(`${"═".repeat(60)}`);
  console.log(`   Mode: ${mode}`);
  console.log(`   Language: ${language}`);
  console.log(`   Segments: ${segments.length}`);
  console.log(`   Concurrency: ${concurrency}`);

  if (mode === QWEN_MODES.VOICE_DESIGN && voiceDescription) {
    console.log(
      `   Voice: "${voiceDescription.substring(0, 80)}${voiceDescription.length > 80 ? "..." : ""}"`,
    );
  } else if (mode === QWEN_MODES.VOICE_CLONE) {
    if (speakerReferenceUrls && speakerCount > 1) {
      console.log(`   References: ${speakerCount} speakers`);
      for (const [spk, url] of Object.entries(speakerReferenceUrls)) {
        console.log(`      ${spk}: ${url ? "uploaded" : "missing"}`);
      }
    } else {
      console.log(`   Reference: ${referenceAudioUrl ? "uploaded" : "none"}`);
    }
  } else {
    if (speakerVoiceMap && speakerCount > 1) {
      console.log(`   Speakers: ${speakerCount} voices`);
      for (const [spk, cfg] of Object.entries(speakerVoiceMap)) {
        console.log(`      ${spk}: ${cfg.speaker || cfg.voiceDescription || "default"}`);
      }
    } else {
      console.log(`   Speaker: ${speaker}`);
    }
  }

  if (styleInstruction) {
    console.log(
      `   Style: "${styleInstruction.substring(0, 60)}${styleInstruction.length > 60 ? "..." : ""}"`,
    );
  }

  // Create tts subdir
  const ttsDir = path.join(outputDir, "tts_qwen");
  fs.mkdirSync(ttsDir, { recursive: true });

  // ── Voice Anchoring ──
  // In voice_design mode, each API call generates a slightly different voice.
  // To fix this, we generate the first segment with voice_design to create the
  // voice, then upload that audio and use voice_clone for all remaining segments.
  // This locks in a consistent voice across all segments.
  let anchorReferenceUrl = null;
  // Per-speaker anchors for multi-speaker voice_design
  const speakerAnchorUrls = {};

  if (mode === QWEN_MODES.VOICE_DESIGN && segments.length > 1 && !speakerVoiceMap) {
    console.log(`   🔒 Voice anchoring: will lock voice from first segment`);

    // Find a segment with enough text for a good voice sample
    const anchorIdx = segments.findIndex(s => {
      const t = s?.restyledText || s?.translatedText || s?.translated || s?.text;
      return t && t.trim().length >= 10;
    });

    if (anchorIdx >= 0) {
      const anchorSeg = segments[anchorIdx];
      const anchorText = anchorSeg?.restyledText || anchorSeg?.translatedText || anchorSeg?.translated || anchorSeg?.text;
      const anchorPath = path.join(ttsDir, "anchor_voice.wav");

      console.log(`   🎤 Generating anchor voice (segment ${anchorIdx})...`);
      const anchorResult = await generateQwenTTS(anchorText, anchorPath, {
        mode: QWEN_MODES.VOICE_DESIGN,
        voiceDescription,
        styleInstruction,
        language,
      });

      if (anchorResult.success && fs.existsSync(anchorPath)) {
        const anchorDuration = getAudioDuration(anchorPath);
        if (anchorDuration >= 1) {
          try {
            const uploaded = await uploadVoiceSample(anchorPath, outputDir);
            anchorReferenceUrl = uploaded.url;
            console.log(`   ✅ Voice anchor locked (${anchorDuration.toFixed(1)}s sample)`);
          } catch (err) {
            console.log(`   ⚠️ Anchor upload failed, falling back to per-segment design: ${err.message}`);
          }
        }
      }
    }
  }

  const limiter = new ConcurrentRateLimiter(maxTPS, concurrency);
  let completedCount = 0;
  let speedAdjusted = 0;
  let silencePadded = 0;

  const allResults = await limiter.processAll(
    segments,
    async (segment, idx) => {
      // Get the text to synthesize - support both remix and translation fields
      const text =
        segment?.restyledText ||
        segment?.translatedText ||
        segment?.translated ||
        segment?.text;

      if (!text || text.trim().length === 0) {
        return { idx, segment, skipped: true };
      }

      const rawPath = path.join(
        ttsDir,
        `seg_${String(idx).padStart(4, "0")}_raw.wav`,
      );
      const finalPath = path.join(
        ttsDir,
        `seg_${String(idx).padStart(4, "0")}.wav`,
      );

      // Resolve per-speaker options
      const segSpeaker = segment?.speaker;
      let segMode = mode;
      let segReferenceAudio = referenceAudioUrl;
      let segReferenceText = referenceText;
      let segVoiceDescription = voiceDescription;
      let segSpeakerName = speaker;
      let segStyleInstruction = styleInstruction;

      if (mode === QWEN_MODES.VOICE_CLONE && speakerReferenceUrls && segSpeaker) {
        segReferenceAudio = speakerReferenceUrls[segSpeaker] || referenceAudioUrl;
      }
      if (mode === QWEN_MODES.VOICE_CLONE && speakerReferenceTexts && segSpeaker) {
        segReferenceText = speakerReferenceTexts[segSpeaker] || referenceText;
      }

      if (speakerVoiceMap && segSpeaker && speakerVoiceMap[segSpeaker]) {
        const cfg = speakerVoiceMap[segSpeaker];
        if (cfg.mode) segMode = cfg.mode;
        if (cfg.speaker) segSpeakerName = cfg.speaker;
        if (cfg.voiceDescription) segVoiceDescription = cfg.voiceDescription;
        if (cfg.styleInstruction) segStyleInstruction = cfg.styleInstruction;
      }

      // Voice anchoring: use clone mode with the anchor reference instead of
      // voice_design for all segments after anchor is established
      const effectiveAnchor = segSpeaker && speakerAnchorUrls[segSpeaker]
        ? speakerAnchorUrls[segSpeaker]
        : anchorReferenceUrl;

      if (effectiveAnchor && segMode === QWEN_MODES.VOICE_DESIGN) {
        segMode = QWEN_MODES.VOICE_CLONE;
        segReferenceAudio = effectiveAnchor;
      }

      // Generate TTS
      const result = await generateQwenTTS(text, rawPath, {
        mode: segMode,
        referenceAudio: segReferenceAudio,
        referenceText: segReferenceText,
        voiceDescription: segVoiceDescription,
        speaker: segSpeakerName,
        styleInstruction: segStyleInstruction,
        language,
      });

      completedCount++;
      if (completedCount % 10 === 0 || completedCount === segments.length) {
        process.stdout.write(
          `\r   ⏳ Progress: ${completedCount}/${segments.length}`,
        );
      }

      if (!result.success) {
        return { idx, segment, error: result.error };
      }

      // ── Timing alignment ──
      const segmentDuration = segment.end - segment.start;
      const rawDuration = getAudioDuration(rawPath);

      if (rawDuration <= 0) {
        return { idx, segment, error: "Generated audio has zero duration" };
      }

      const ratio = rawDuration / segmentDuration;
      let audioPath = rawPath;
      let audioDuration = rawDuration;
      let timingAction = "none";

      if (ratio >= 0.95 && ratio <= 1.05) {
        // Perfect fit
        fs.copyFileSync(rawPath, finalPath);
        audioPath = finalPath;
        timingAction = "perfect";
      } else if (ratio > 1.05 && ratio <= MAX_SPEEDUP) {
        // Too long - gentle speedup
        const adjusted = await adjustAudioSpeed(
          rawPath,
          finalPath,
          segmentDuration,
          rawDuration,
        );
        if (adjusted === finalPath) {
          audioPath = finalPath;
          audioDuration = getAudioDuration(finalPath);
          speedAdjusted++;
          timingAction = `atempo ${ratio.toFixed(2)}x`;
        }
      } else if (ratio > MAX_SPEEDUP) {
        // Way too long - apply max speedup, accept overrun
        const adjusted = await adjustAudioSpeed(
          rawPath,
          finalPath,
          rawDuration / MAX_SPEEDUP,
          rawDuration,
        );
        if (adjusted === finalPath) {
          audioPath = finalPath;
          audioDuration = getAudioDuration(finalPath);
          speedAdjusted++;
          timingAction = `atempo ${MAX_SPEEDUP}x (clamped)`;
        }
      } else if (ratio < 0.95) {
        // Too short - pad with silence
        const padded = await padWithSilence(
          rawPath,
          finalPath,
          segmentDuration,
          rawDuration,
        );
        if (padded === finalPath) {
          audioPath = finalPath;
          audioDuration = getAudioDuration(finalPath) || segmentDuration;
          silencePadded++;
          timingAction = `padded (${rawDuration.toFixed(1)}s → ${segmentDuration.toFixed(1)}s)`;
        }
      }

      // Anti-overlap trim
      const nextSeg = segments[idx + 1];
      if (nextSeg && audioDuration > 0) {
        const maxAllowed = nextSeg.start - segment.start - 0.05;
        if (audioDuration > maxAllowed && maxAllowed > 0.5) {
          const trimPath = audioPath.replace(".wav", "_trimmed.wav");
          try {
            const fadeStart = Math.max(0, maxAllowed - 0.15);
            execSync(
              `ffmpeg -y -i "${audioPath}" -t ${maxAllowed.toFixed(3)} -af "afade=t=out:st=${fadeStart.toFixed(3)}:d=0.15" "${trimPath}" 2>/dev/null`,
              { encoding: "utf-8", timeout: 10000 },
            );
            if (fs.existsSync(trimPath)) {
              audioPath = trimPath;
              audioDuration = getAudioDuration(trimPath) || maxAllowed;
              timingAction += ` + trimmed`;
            }
          } catch {
            /* keep untrimmed */
          }
        }
      }

      return {
        idx,
        segment,
        audioPath,
        alignedFile: audioPath,
        duration: audioDuration,
        rawDuration,
        start: segment.start,
        end: segment.end,
        translatedText: text,
        timingAction,
      };
    },
  );

  // Stats
  const successful = allResults.filter((r) => r?.audioPath);
  const failed = allResults.filter((r) => r?.error);
  const skipped = allResults.filter((r) => r?.skipped);

  console.log(
    `\n\n   ✅ Generated ${successful.length}/${segments.length} segments`,
  );
  if (speedAdjusted > 0) {
    console.log(`   🎚️ Speed adjusted: ${speedAdjusted} segments`);
  }
  if (silencePadded > 0) {
    console.log(`   🔇 Silence padded: ${silencePadded} segments`);
  }
  if (failed.length > 0) {
    console.log(`   ❌ Failed: ${failed.length} segments`);
  }

  return {
    results: allResults.filter(Boolean).sort((a, b) => a.idx - b.idx),
    stats: {
      total: segments.length,
      successful: successful.length,
      failed: failed.length,
      skipped: skipped.length,
      speedAdjusted,
      silencePadded,
    },
    segments: successful.map((r) => ({
      ...r.segment,
      alignedFile: r.audioPath,
      alignedDuration: r.duration,
      index: r.idx,
      start: r.start,
      end: r.end,
    })),
  };
}

// ════════════════════════════════════════════════════════════════════════════
// Exports
// ════════════════════════════════════════════════════════════════════════════

module.exports = {
  // Core generation
  generateQwenTTS,
  generateAndAlignQwen,

  // Voice sample management
  uploadVoiceSample,

  // Config & utils
  QWEN_TTS_MODEL,
  QWEN_LANGUAGES,
  QWEN_MODES,
  PRESET_SPEAKERS,
  SUPPORTED_LANGUAGE_NAMES,
  normalizeLanguage,
  isLanguageSupported,
};
