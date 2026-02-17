#!/usr/bin/env node
/**
 * Remix Pipeline - Voice Restyling
 *
 * Simplified pipeline for the "Voice Remix" feature:
 * Ingest → Split → Transcribe → Restyle (Gemini) → TTS → Output separate tracks
 *
 * Returns separate audio tracks for the frontend toggle switches:
 *   - Original vocals (isolated)
 *   - Restyled vocals (TTS)
 *   - Background audio (music/instruments)
 *   - Video (muted, for visual playback)
 *
 * Usage:
 *   node pipeline-remix.js <source> <style> [voice] [--clone] [--premium] [--custom-prompt "..."]
 *
 * Examples:
 *   node pipeline-remix.js https://youtube.com/watch?v=... valley_girl
 *   node pipeline-remix.js ./video.mp4 gay_bestie --premium
 *   node pipeline-remix.js ./video.mp4 custom --custom-prompt "Talk like a pirate"
 */

require("dotenv").config();

const path = require("path");
const fs = require("fs");
const { v4: uuidv4 } = require("uuid");

// Import v2 modules
const { ingest } = require("./src/v2/ingest");
const {
  split,
  checkSystemRequirements,
  validateSeparation,
} = require("./src/v2/split");
const {
  transcribe,
  mergeCloseSegments,
  detectAndHandleOverlaps,
} = require("./src/v2/transcribe");
const {
  restyleTranscript,
  getSuggestedVoice,
  VOICE_STYLES,
} = require("./src/v2/restyle");
const { generateTTS, VOICES, TTS_PROVIDERS } = require("./src/v2/tts");
const {
  voiceCloneTTS,
  extractAllVoiceSamples,
  generateAndAlignXTTS,
  LANGUAGE_CODES: XTTS_LANGUAGES,
} = require("./src/v2/xtts");
const {
  generateQwenTTS,
  generateAndAlignQwen,
  uploadVoiceSample,
  QWEN_LANGUAGES,
  QWEN_MODES,
} = require("./src/v2/qwen-tts");
const { renderVideo } = require("./src/v2/merge");
const { GoogleGenerativeAI } = require("@google/generative-ai");
const geminiAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

const OUTPUT_DIR = path.join(__dirname, "output");

/**
 * Format duration in mm:ss
 */
function formatDuration(seconds) {
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs.toString().padStart(2, "0")}`;
}

/**
 * Main remix pipeline function
 */
async function runRemixPipeline(source, options = {}) {
  const {
    style = "valley_girl",
    customPrompt = null,
    voicePrompt = null, // Custom voice description for Qwen3-TTS voice_design
    voiceOverride = null, // Specific voice name to use
    premium = false,
    clone = false,
    qwen = false,
    start = null,
    clipDuration = null,
    voiceFilePath = null,
  } = options;

  const styleConfig = VOICE_STYLES[style] || {
    id: "custom",
    name: "Custom",
    emoji: "✨",
    description: "Custom prompt",
    prompt: customPrompt || "Repeat the transcript exactly as-is, preserving all meaning and tone.",
    voiceDescription: null,
    styleInstruction: null,
    isTranslation: false,
  };

  // ── Auto-derive text restyle + gender from voice prompt via Gemini ──
  let derivedCustomPrompt = customPrompt;
  let derivedGender = "male";

  if (voicePrompt && !customPrompt) {
    try {
      console.log(`   🤖 Analyzing voice prompt with Gemini...`);
      const model = geminiAI.getGenerativeModel({ model: "gemini-2.0-flash" });
      const analysisResult = await model.generateContent({
        contents: [
          {
            role: "user",
            parts: [
              {
                text: `You are analyzing a voice description prompt for a text-to-speech system. The user wants to change how a video sounds.

Voice prompt: "${voicePrompt}"

Analyze this prompt and return a JSON object with exactly these fields:
{
  "gender": "male" or "female" — the gender of the voice being described. Default to "male" if unclear.
  "language": null or a language name (e.g. "Spanish", "Japanese", "Swahili") — if the prompt implies the output should be in a non-English language. Only set this if there's a clear language intent (nationality, language name, accent that implies translation). A "British accent" or "Southern drawl" is still English — set null.
  "level": null or a proficiency level (e.g. "B1", "A2", "beginner") — if mentioned.
  "textRestyle": null or a short instruction for rewriting transcript text to match the persona/character. Examples: for a pirate → "Rewrite using pirate slang and nautical terms", for a sports announcer → "Rewrite as excited sports commentary". Only set this if the voice persona implies the WORDS should change, not just the voice. A "deep voice" or "old man" does NOT need text restyle. A "pirate" or "anime villain" DOES.
}

Return ONLY the JSON object, no markdown, no explanation.`,
              },
            ],
          },
        ],
      });

      const raw = analysisResult.response.text().trim();
      const jsonStr = raw.replace(/^```json?\s*/i, "").replace(/```\s*$/, "");
      const analysis = JSON.parse(jsonStr);

      derivedGender = analysis.gender === "female" ? "female" : "male";

      if (analysis.language) {
        const levelStr = analysis.level
          ? ` at ${analysis.level} proficiency level. Use vocabulary and grammar appropriate for ${analysis.level} learners.`
          : "";
        derivedCustomPrompt = `Translate the transcript to ${analysis.language}${levelStr} Keep the same meaning and emotional tone.`;
        console.log(`   🌍 Gemini detected language: ${analysis.language}${analysis.level ? ` (${analysis.level})` : ""}`);
      } else if (analysis.textRestyle) {
        derivedCustomPrompt = analysis.textRestyle;
        console.log(`   🎭 Gemini detected persona restyle: "${analysis.textRestyle.substring(0, 60)}..."`);
      }

      console.log(`   👤 Gemini inferred gender: ${derivedGender}`);
    } catch (err) {
      console.log(`   ⚠️ Gemini analysis failed, using defaults: ${err.message}`);
    }
  }

  // Determine TTS engine: Qwen3-TTS is the default
  // --voice-prompt always forces Qwen voice_design mode
  const useQwen =
    voicePrompt || qwen || (!premium && !clone && styleConfig.voiceDescription);

  console.log(`
╔══════════════════════════════════════════════════════════════╗
║                                                              ║
║   🎨  V O I C E   R E M I X   P I P E L I N E               ║
║                                                              ║
╚══════════════════════════════════════════════════════════════╝
`);

  if (derivedCustomPrompt) {
    console.log(`   ✍️ Text Restyle: "${derivedCustomPrompt.substring(0, 60)}${derivedCustomPrompt.length > 60 ? "..." : ""}"`);
    if (derivedCustomPrompt !== customPrompt) console.log(`   📝 (auto-derived from voice prompt)`);
  } else if (style !== "custom") {
    console.log(`   Style: ${styleConfig.emoji || "✨"} ${styleConfig.name || "Custom"}`);
  } else {
    console.log(`   ✍️ Text Restyle: none (keeping original words)`);
  }
  if (voicePrompt) console.log(`   👤 Inferred gender: ${derivedGender}`);
  console.log(`   Source: ${source}`);
  if (voicePrompt) console.log(`   🧠 Voice Prompt: "${voicePrompt}"`);
  if (useQwen) console.log(`   🧠 TTS Engine: Qwen3-TTS (${clone ? "voice_clone" : "voice_design"})`);
  else if (premium) console.log(`   🎙️ Premium TTS: ON (ElevenLabs)`);
  else if (clone) console.log(`   🎤 Voice Clone: ON (XTTS)`);

  // Create job directory
  const jobId = `remix_${uuidv4().substring(0, 8)}`;
  const jobDir = path.join(OUTPUT_DIR, jobId);
  fs.mkdirSync(jobDir, { recursive: true });

  console.log(`\n   📁 Job: ${jobId}`);
  console.log(`   📂 Output: ${jobDir}\n`);

  const pipelineStart = Date.now();
  const timings = {};

  try {
    // ═══════════════════════════════════════════════════════════════
    // STEP 1: INGEST - Download/load video
    // ═══════════════════════════════════════════════════════════════
    console.log(`${"═".repeat(60)}`);
    console.log(`📥 STEP 1: INGEST`);
    console.log(`${"═".repeat(60)}`);

    let stepStart = Date.now();
    const ingestResult = await ingest(source, jobDir, {
      start,
      duration: clipDuration,
    });
    timings.ingest = (Date.now() - stepStart) / 1000;

    console.log(
      `   ✅ Ingested: ${formatDuration(ingestResult.media.duration)} video`,
    );

    // ═══════════════════════════════════════════════════════════════
    // STEP 2 & 3: PARALLEL - Split + Transcribe
    // ═══════════════════════════════════════════════════════════════
    console.log(`\n${"═".repeat(60)}`);
    console.log(`⚡ STEP 2+3: SPLIT + TRANSCRIBE (parallel)`);
    console.log(`${"═".repeat(60)}`);

    stepStart = Date.now();

    // Run split and transcribe in parallel
    const splitPromise = split(ingestResult.audioPath, jobDir, {
      model: "htdemucs",
      shifts: 1,
    });

    const transcribePromise = transcribe(ingestResult.audioPath, {
      language: "english",
      speakerLabels: true,
    });

    // Transcribe finishes first
    const transcribeResult = await transcribePromise;
    timings.transcribe = (Date.now() - stepStart) / 1000;

    console.log(
      `   ✅ Transcribed: ${transcribeResult.segments.length} segments`,
    );

    // Merge close segments
    const mergedSegments = mergeCloseSegments(transcribeResult.segments, {
      maxGap: 0.5,
      maxDuration: 12,
    });

    // Handle overlaps
    const { segments: cleanSegments } = detectAndHandleOverlaps(
      mergedSegments,
      {
        strategy: "truncate",
        minOverlap: 0.1,
      },
    );

    console.log(`   📝 Clean segments: ${cleanSegments.length}`);

    // Save transcription
    fs.writeFileSync(
      path.join(jobDir, "transcription.json"),
      JSON.stringify(
        {
          text: transcribeResult.text,
          segments: cleanSegments,
          transcribedAt: new Date().toISOString(),
        },
        null,
        2,
      ),
    );

    // ═══════════════════════════════════════════════════════════════
    // STEP 4: RESTYLE - Gemini text transformation
    // ═══════════════════════════════════════════════════════════════
    console.log(`\n${"═".repeat(60)}`);
    console.log(`🎨 STEP 4: RESTYLE`);
    console.log(`${"═".repeat(60)}`);

    stepStart = Date.now();

    // Skip restyle if no prompt provided (style=custom with no customPrompt/derivedPrompt)
    const hasRestylePrompt = derivedCustomPrompt || (style !== "custom" && VOICE_STYLES[style]);
    let restyledSegments;

    if (hasRestylePrompt) {
      restyledSegments = await restyleTranscript(cleanSegments, {
        style,
        customPrompt: derivedCustomPrompt,
        batchSize: 30,
        concurrency: 5,
      });
    } else {
      console.log(`\n   ⏭️ No text restyle prompt — keeping original words\n`);
      restyledSegments = cleanSegments.map((seg) => ({
        ...seg,
        restyledText: seg.text,
      }));
    }

    timings.restyle = (Date.now() - stepStart) / 1000;

    // Save restyled text
    fs.writeFileSync(
      path.join(jobDir, "restyled.json"),
      JSON.stringify(
        {
          style: styleConfig.name || "Custom",
          segments: restyledSegments,
          restyledAt: new Date().toISOString(),
        },
        null,
        2,
      ),
    );

    // ═══════════════════════════════════════════════════════════════
    // STEP 5: TTS - Generate restyled voice audio
    // ═══════════════════════════════════════════════════════════════
    console.log(`\n${"═".repeat(60)}`);
    console.log(`🎤 STEP 5: TTS`);
    console.log(`${"═".repeat(60)}`);

    stepStart = Date.now();

    // Filter valid segments
    const validSegments = restyledSegments.filter(
      (s) => s && s.restyledText && s.restyledText.trim().length > 0,
    );

    // Gender is inferred from voice prompt (derivedGender) — no Gemini call needed
    const detectedGender = derivedGender;

    // Determine voice
    let voice;
    if (voiceOverride) {
      voice = voiceOverride;
    } else if (clone) {
      voice = "auto";
    } else {
      voice = getSuggestedVoice(style, premium);
    }

    // For preset translation styles, use the target language
    // For custom prompts, use "auto" so Qwen detects from the text (handles translations)
    const ttsLanguage = styleConfig.isTranslation
      ? style.replace("_translation", "")
      : style === "custom"
        ? "auto"
        : "english";

    let ttsResult;

    if (useQwen && clone) {
      // ── Qwen3-TTS: Voice Clone mode ──
      // Clone each speaker's voice, speak the restyled words
      console.log(`   🧠 Qwen3-TTS Voice Clone mode`);

      let speakerReferenceUrls = {};
      let fallbackReferenceUrl = null;

      if (voiceFilePath && fs.existsSync(voiceFilePath)) {
        // User provided a single voice file — use it for all speakers
        console.log(
          `   📎 Using provided voice sample: ${path.basename(voiceFilePath)}`,
        );
        const uploaded = await uploadVoiceSample(voiceFilePath, jobDir);
        fallbackReferenceUrl = uploaded.url;
      } else {
        // Extract and upload voice samples per speaker
        console.log(`   🎤 Extracting voice sample from video...`);
        const voiceSamples = await extractAllVoiceSamples(
          ingestResult.videoPath,
          transcribeResult.segments,
          jobDir,
          { narratorMode: false },
        );

        for (const [speakerId, sample] of Object.entries(voiceSamples)) {
          const samplePath = sample.samplePath || sample;
          if (samplePath && fs.existsSync(samplePath)) {
            try {
              const uploaded = await uploadVoiceSample(samplePath, jobDir);
              speakerReferenceUrls[speakerId] = uploaded.url;
            } catch (err) {
              console.log(`   ⚠️ Failed to upload sample for ${speakerId}: ${err.message}`);
            }
          }
        }

        // Use first uploaded as fallback for speakers without samples
        fallbackReferenceUrl = Object.values(speakerReferenceUrls)[0] || null;
      }

      const hasAnySample = fallbackReferenceUrl || Object.keys(speakerReferenceUrls).length > 0;

      if (hasAnySample) {
        const qwenResult = await generateAndAlignQwen(validSegments, jobDir, {
          mode: QWEN_MODES.VOICE_CLONE,
          referenceAudioUrl: fallbackReferenceUrl,
          speakerReferenceUrls: Object.keys(speakerReferenceUrls).length > 0
            ? speakerReferenceUrls
            : null,
          styleInstruction: styleConfig.styleInstruction || null,
          language: QWEN_LANGUAGES[ttsLanguage] || "auto",
          concurrency: 10,
        });

        ttsResult = {
          stats: {
            success: qwenResult.stats.successful,
            failed: qwenResult.stats.failed,
            total: qwenResult.stats.total,
          },
          segments: qwenResult.segments,
        };
      } else {
        console.log(`   ⚠️ Voice extraction failed, falling back to voice_design`);
        const qwenResult = await generateAndAlignQwen(validSegments, jobDir, {
          mode: QWEN_MODES.VOICE_DESIGN,
          voiceDescription: styleConfig.voiceDescription || "A clear, natural speaking voice",
          styleInstruction: styleConfig.styleInstruction || null,
          language: QWEN_LANGUAGES[ttsLanguage] || "auto",
          concurrency: 10,
        });

        ttsResult = {
          stats: {
            success: qwenResult.stats.successful,
            failed: qwenResult.stats.failed,
            total: qwenResult.stats.total,
          },
          segments: qwenResult.segments,
        };
      }
    } else if (useQwen) {
      // ── Qwen3-TTS: Voice Design mode ──
      // Create a voice from a description — no reference audio needed!
      console.log(`   🧠 Qwen3-TTS Voice Design mode`);

      // Priority: --voice-prompt > --custom-prompt derived > style preset
      const rawVoiceDesc =
        voicePrompt ||
        (customPrompt
          ? `A voice that matches this personality: ${customPrompt}`
          : styleConfig.voiceDescription);

      // ── Expand short prompts into rich Qwen voice descriptions ──
      // Qwen3-TTS responds much better to detailed descriptions with
      // specific vocal qualities rather than short labels like "Spanish guy"
      const expandVoiceDescription = (desc, gender) => {
        if (!desc) return null;
        // If the user already wrote a detailed description (50+ chars), use it as-is
        if (desc.length >= 50) return desc;

        const g = gender || "male";
        const genderWord = g === "female" ? "woman" : "man";
        const pitchHint = g === "female"
          ? "with a warm, mid-to-high pitched voice"
          : "with a clear, mid-to-low pitched voice";

        // Detect language for accent hint
        const langAccents = {
          spanish: "a native Spanish accent, rolling Rs",
          french: "a smooth native French accent",
          german: "a crisp native German accent",
          japanese: "a native Japanese speaker's rhythm and intonation",
          chinese: "a native Mandarin Chinese speaker's tones and rhythm",
          korean: "a native Korean speaker's rhythm and intonation",
          portuguese: "a warm native Brazilian Portuguese accent",
          italian: "a melodic native Italian accent",
          russian: "a deep native Russian accent",
          arabic: "a native Arabic speaker's intonation",
        };
        const lower = desc.toLowerCase();
        const accentMatch = Object.entries(langAccents).find(([k]) => lower.includes(k));
        const accentHint = accentMatch ? `, ${accentMatch[1]}` : "";

        return `A ${genderWord} ${pitchHint}${accentHint}. ${desc}. Speaks clearly and naturally with a conversational, confident tone and expressive delivery.`;
      };

      const voiceDesc = expandVoiceDescription(rawVoiceDesc, derivedGender);

      // Build a style instruction that reinforces the prompt
      const effectiveStyleInstruction =
        voicePrompt
          ? `Speak exactly as described: ${voicePrompt}. Be expressive, natural, and fully committed to this voice character.`
          : styleConfig.styleInstruction || null;

      if (voiceDesc) {
        console.log(
          `   🎨 Voice: "${voiceDesc.substring(0, 100)}${voiceDesc.length > 100 ? "..." : ""}"`,
        );
      }

      // ── Speaker handling ──
      // Count unique speakers from diarization
      const speakerIds = [...new Set(validSegments.map((s) => s.speaker).filter(Boolean))];
      let speakerVoiceMap = null;

      // If diarization found multiple speakers but user described a single voice,
      // collapse them all to the same voice (diarization often over-segments)
      const userImpliesMultipleSpeakers = voicePrompt &&
        /\b(speakers?|voices?|people|characters?|duo|conversation)\b/i.test(voicePrompt);

      if (speakerIds.length > 1 && !userImpliesMultipleSpeakers) {
        // User described ONE voice — force all speakers to use it
        console.log(`   👤 Diarization found ${speakerIds.length} speakers, but prompt describes one voice — collapsing to single voice`);
        // No speakerVoiceMap needed — all segments use the same voiceDesc
      } else if (speakerIds.length > 1 && userImpliesMultipleSpeakers) {
        // User explicitly wants multiple voices
        const MALE_PRESETS = ["Aiden", "Dylan", "Eric", "Ryan"];
        const FEMALE_PRESETS = ["Serena", "Vivian", "Sohee", "One_anna"];
        let presetIdx = 0;
        const isFemale = derivedGender === "female";

        speakerVoiceMap = {};
        for (const spk of speakerIds) {
          if (voiceDesc) {
            speakerVoiceMap[spk] = {
              mode: QWEN_MODES.VOICE_DESIGN,
              voiceDescription: `${voiceDesc} This is a distinct speaker ${speakerIds.indexOf(spk) + 1} of ${speakerIds.length}.`,
            };
          } else {
            const presets = isFemale ? FEMALE_PRESETS : MALE_PRESETS;
            const preset = presets[presetIdx++ % presets.length];
            speakerVoiceMap[spk] = {
              mode: QWEN_MODES.CUSTOM_VOICE,
              speaker: preset,
            };
          }
        }

        console.log(`   👥 Multi-speaker: ${speakerIds.length} voices`);
        for (const [spk, cfg] of Object.entries(speakerVoiceMap)) {
          console.log(`      ${spk}: ${cfg.speaker || "voice_design"}`);
        }
      }

      const qwenResult = await generateAndAlignQwen(validSegments, jobDir, {
        mode: QWEN_MODES.VOICE_DESIGN,
        voiceDescription: voiceDesc || "A clear, natural, expressive speaking voice with confident delivery",
        styleInstruction: effectiveStyleInstruction,
        language: QWEN_LANGUAGES[ttsLanguage] || "auto",
        concurrency: 10,
        speakerVoiceMap,
      });

      ttsResult = {
        stats: {
          success: qwenResult.stats.successful,
          failed: qwenResult.stats.failed,
          total: qwenResult.stats.total,
        },
        segments: qwenResult.segments,
      };
    } else if (clone) {
      // ── Legacy XTTS Voice Clone ──
      console.log(`   🎤 XTTS Voice cloning mode`);

      let voiceSamples = {};

      if (voiceFilePath && fs.existsSync(voiceFilePath)) {
        console.log(
          `   📎 Using provided voice sample: ${path.basename(voiceFilePath)}`,
        );
        const speakerIds = [
          ...new Set(cleanSegments.map((s) => s.speaker).filter(Boolean)),
        ];
        if (speakerIds.length === 0) speakerIds.push("SPEAKER_00");
        for (const speakerId of speakerIds) {
          voiceSamples[speakerId] = voiceFilePath;
        }
      } else {
        console.log(`   🎤 Extracting voice samples from video...`);
        voiceSamples = await extractAllVoiceSamples(
          ingestResult.videoPath,
          transcribeResult.segments,
          jobDir,
          { narratorMode: false },
        );
      }

      if (Object.keys(voiceSamples).length > 0) {
        const xttsResult = await generateAndAlignXTTS(
          validSegments,
          voiceSamples,
          jobDir,
          {
            language: "en",
            concurrency: 10,
            mergeOverlaps: false,
            adjustSpeed: true,
            skipExtreme: true,
          },
        );

        ttsResult = {
          stats: {
            success: xttsResult.stats.successful,
            failed: xttsResult.stats.failed,
            total: xttsResult.stats.total,
          },
          segments: xttsResult.results
            .filter((r) => r.audioPath)
            .map((r) => ({
              ...r.segment,
              alignedFile: r.audioPath,
              alignedDuration: r.duration,
              index: r.idx,
              start: r.start,
              end: r.end,
            })),
        };
      } else {
        console.log(
          `   ⚠️ Voice extraction failed, falling back to standard TTS`,
        );
        ttsResult = await generateTTS(validSegments, jobDir, {
          premium,
          voice,
          concurrency: premium ? 3 : 40,
          mode: "synced",
          language: "english",
        });
      }
    } else {
      // ── Standard TTS (Lemonfox / ElevenLabs) ──
      console.log(
        `   Voice: ${voice} (${premium ? "ElevenLabs" : "Lemonfox"})`,
      );
      ttsResult = await generateTTS(validSegments, jobDir, {
        premium,
        voice,
        concurrency: premium ? 3 : 40,
        durationTolerance: 0.2,
        maxRetries: 1,
        multiSpeaker: false,
        defaultGender: detectedGender,
        mode: "synced",
        language: ttsLanguage,
      });
    }

    timings.tts = (Date.now() - stepStart) / 1000;
    console.log(
      `   ✅ Generated ${ttsResult.stats?.success || 0} TTS segments`,
    );

    // ═══════════════════════════════════════════════════════════════
    // STEP 6: WAIT FOR SPLIT + OUTPUT
    // ═══════════════════════════════════════════════════════════════
    console.log(`\n${"═".repeat(60)}`);
    console.log(`📦 STEP 6: FINALIZE`);
    console.log(`${"═".repeat(60)}`);

    stepStart = Date.now();

    // Wait for split to complete
    console.log(`   ⏳ Waiting for audio split to complete...`);
    const splitResult = await splitPromise;
    timings.split = splitResult.processingTime || 0;

    console.log(`   ✅ Audio split complete`);

    const backgroundPath = splitResult.background;
    const vocalsPath = splitResult.vocals;

    // Validate separation
    validateSeparation(vocalsPath, backgroundPath);

    // Build TTS-only audio (restyled voice)
    // Merge TTS segments into a continuous audio track aligned with video timeline
    const { merge } = require("./src/v2/merge");

    const segmentsForMerge = ttsResult.segments
      .filter((s) => s.alignedFile && !s.error && !s.skipped)
      .map((s) => ({ ...s, alignedFile: s.alignedFile }));

    // Create a voice-only TTS track (no background mixed in)
    const ttsOnlyPath = path.join(jobDir, "voice_restyled.m4a");
    const mergeResult = await merge(
      backgroundPath,
      segmentsForMerge,
      ttsOnlyPath,
      {
        backgroundVolume: 0, // No background in this track
        ttsVolume: 1.0, // Full TTS volume
      },
    );

    // Also create a mixed version for convenience (dubbed_audio)
    const mixedPath = path.join(jobDir, "dubbed_audio.m4a");
    const mixedResult = await merge(
      backgroundPath,
      segmentsForMerge,
      mixedPath,
      {
        backgroundVolume: 0.35,
        ttsVolume: 2.8,
      },
    );

    // Copy background to a consistent location
    const bgOutputPath = path.join(jobDir, "background.mp3");
    if (!fs.existsSync(bgOutputPath) && fs.existsSync(backgroundPath)) {
      fs.copyFileSync(backgroundPath, bgOutputPath);
    }

    // Copy vocals to a consistent location
    const vocalsOutputPath = path.join(jobDir, "vocals_original.mp3");
    if (!fs.existsSync(vocalsOutputPath) && fs.existsSync(vocalsPath)) {
      fs.copyFileSync(vocalsPath, vocalsOutputPath);
    }

    // Render video with mixed audio
    let videoOutputPath = null;
    if (ingestResult.videoPath && fs.existsSync(ingestResult.videoPath)) {
      console.log(`   🎬 Rendering video...`);
      const dubbedVideoPath = path.join(jobDir, "dubbed_video.mp4");
      const mixedAudioPath = mixedResult.outputPath || mixedPath;

      try {
        await renderVideo(
          ingestResult.videoPath,
          mixedAudioPath,
          dubbedVideoPath,
        );
        videoOutputPath = dubbedVideoPath;
        console.log(`   ✅ Video rendered`);
      } catch (err) {
        console.log(
          `   ⚠️ Video render failed: ${err.message} (audio tracks still available)`,
        );
      }
    }

    timings.finalize = (Date.now() - stepStart) / 1000;

    // ═══════════════════════════════════════════════════════════════
    // DONE
    // ═══════════════════════════════════════════════════════════════
    const totalTime = (Date.now() - pipelineStart) / 1000;

    // Save manifest
    const manifest = {
      jobId,
      type: "remix",
      completedAt: new Date().toISOString(),
      style: {
        id: style,
        name: styleConfig.name || "Custom",
        customPrompt: customPrompt || null,
        voicePrompt: voicePrompt || styleConfig.voiceDescription || null,
      },
      source: {
        type: ingestResult.source.type,
        url: ingestResult.source.url,
        title: ingestResult.title,
      },
      settings: {
        premium,
        clone,
        qwen: useQwen,
        voice,
        ttsProvider: useQwen
          ? `qwen3-tts (${clone ? "voice_clone" : "voice_design"})`
          : clone
            ? "xtts"
            : premium
              ? "elevenlabs"
              : "lemonfox",
      },
      media: {
        duration: ingestResult.media.duration,
        width: ingestResult.media.width,
        height: ingestResult.media.height,
      },
      stats: {
        segments: validSegments.length,
        timings,
        totalTime,
      },
      outputs: {
        video: videoOutputPath ? "dubbed_video.mp4" : null,
        mixedAudio: "dubbed_audio.m4a",
        restyledVoice: fs.existsSync(ttsOnlyPath)
          ? "voice_restyled.m4a"
          : mergeResult.ttsOnlyPath
            ? path.basename(mergeResult.ttsOnlyPath)
            : null,
        originalVocals: "vocals_original.mp3",
        background: "background.mp3",
        transcription: "transcription.json",
        restyled: "restyled.json",
      },
    };

    fs.writeFileSync(
      path.join(jobDir, "manifest.json"),
      JSON.stringify(manifest, null, 2),
    );

    console.log(`
╔══════════════════════════════════════════════════════════════╗
║                                                              ║
║   🎉  R E M I X   C O M P L E T E !                         ║
║                                                              ║
╠══════════════════════════════════════════════════════════════╣
║                                                              ║
║   📁 Job: ${jobId.padEnd(48)}║
║   ⏱️  Total: ${formatDuration(totalTime).padEnd(44)}║
║   🎨 ${(customPrompt ? `Restyle: "${customPrompt.substring(0, 40)}${customPrompt.length > 40 ? "..." : ""}"` : style !== "custom" ? `Style: ${styleConfig.emoji} ${styleConfig.name}` : "No text restyle").padEnd(45)}║
║                                                              ║
║   📦 Output tracks:                                          ║
║      🎤 vocals_original.mp3  (isolated singer/speaker)       ║
║      🎨 voice_restyled.m4a   (restyled TTS)                  ║
║      🎵 background.mp3       (music/instruments)             ║${
      videoOutputPath
        ? `
║      🎬 dubbed_video.mp4     (video + mixed audio)           ║`
        : ""
    }
║                                                              ║
╚══════════════════════════════════════════════════════════════╝
`);

    return {
      success: true,
      jobId,
      manifest,
    };
  } catch (error) {
    console.error(`\n❌ Remix pipeline failed: ${error.message}`);
    console.error(error.stack);
    return {
      success: false,
      error: error.message,
    };
  }
}

// ============================================
// CLI
// ============================================

if (require.main === module) {
  const args = process.argv.slice(2);

  // Parse flags
  const premium = args.includes("--premium") || args.includes("-p");
  const clone = args.includes("--clone") || args.includes("-c");
  const qwen = args.includes("--qwen") || args.includes("-q");

  let customPrompt = null;
  if (args.includes("--custom-prompt")) {
    const idx = args.indexOf("--custom-prompt");
    customPrompt = args[idx + 1];
  }

  let voicePrompt = null;
  if (args.includes("--voice-prompt")) {
    const idx = args.indexOf("--voice-prompt");
    voicePrompt = args[idx + 1];
  }

  let voiceOverride = null;
  if (args.includes("--voice")) {
    const idx = args.indexOf("--voice");
    voiceOverride = args[idx + 1];
  }

  let voiceFilePath = null;
  if (args.includes("--voice-file")) {
    const idx = args.indexOf("--voice-file");
    voiceFilePath = args[idx + 1];
    if (voiceFilePath && !voiceFilePath.startsWith("/")) {
      voiceFilePath = path.resolve(voiceFilePath);
    }
  }

  let startTime = null;
  if (args.includes("--start")) {
    const idx = args.indexOf("--start");
    startTime = parseFloat(args[idx + 1]);
  }

  let clipDuration = null;
  if (args.includes("--duration")) {
    const idx = args.indexOf("--duration");
    clipDuration = parseFloat(args[idx + 1]);
  }

  // Clean args (remove flags)
  const cleanArgs = args.filter(
    (a) =>
      !a.startsWith("-") &&
      a !== customPrompt &&
      a !== voicePrompt &&
      a !== voiceOverride &&
      a !== voiceFilePath &&
      a !== startTime?.toString() &&
      a !== clipDuration?.toString(),
  );

  const source = cleanArgs[0];
  const style = cleanArgs[1] || "valley_girl";

  if (!source) {
    console.log(`
🎨 Voice Remix Pipeline

Usage:
  node pipeline-remix.js <source> <style> [flags]

Styles:
${Object.entries(VOICE_STYLES)
  .map(
    ([id, s]) => `  ${id.padEnd(22)} ${s.emoji} ${s.name} - ${s.description}`,
  )
  .join("\n")}
  custom                 ✨ Custom prompt (use --custom-prompt)

Flags:
  --voice-prompt TEXT    🧠 Describe ANY voice you want! (Qwen3-TTS creates it from text)
                         Example: "A deep gravelly Batman voice, dark and brooding"
  --custom-prompt TEXT   ✍️ Custom text restyle prompt (changes WHAT is said)
  --clone                🎤 Clone original speaker's voice + restyle words
  --voice-file PATH      Custom voice sample for cloning
  --premium              Use ElevenLabs premium TTS (legacy)
  --voice NAME           Override voice selection (legacy)
  --start SECONDS        Start time for clipping
  --duration SECONDS     Duration for clipping

Examples:
  # Use a preset style (Qwen3-TTS creates a matching voice automatically)
  node pipeline-remix.js ./video.mp4 valley_girl
  node pipeline-remix.js ./video.mp4 gay_bestie
  node pipeline-remix.js ./video.mp4 news_anchor

  # Describe ANY voice you want (no preset needed!)
  node pipeline-remix.js ./video.mp4 custom --voice-prompt "A deep gravelly Batman voice"
  node pipeline-remix.js ./video.mp4 custom --voice-prompt "An old wise wizard, slow and mystical"
  node pipeline-remix.js ./video.mp4 custom --voice-prompt "A hyperactive anime narrator"

  # Combine voice + text restyle
  node pipeline-remix.js ./video.mp4 custom \\
    --voice-prompt "A sarcastic robot with a monotone delivery" \\
    --custom-prompt "Rewrite everything as if a bored AI is commenting on humans"

  # Clone the original speaker's voice but restyle the words
  node pipeline-remix.js ./video.mp4 british_posh --clone

  # Clone + custom voice sample
  node pipeline-remix.js ./video.mp4 valley_girl --clone --voice-file morgan_freeman.wav
`);
    process.exit(0);
  }

  // Validate style
  if (style !== "custom" && !VOICE_STYLES[style]) {
    console.error(`❌ Unknown style: ${style}`);
    console.error(
      `   Available: ${Object.keys(VOICE_STYLES).join(", ")}, custom`,
    );
    process.exit(1);
  }

  runRemixPipeline(source, {
    style,
    customPrompt,
    voicePrompt,
    voiceOverride,
    premium,
    clone,
    qwen,
    start: startTime,
    clipDuration,
    voiceFilePath,
  })
    .then((result) => {
      process.exit(result.success ? 0 : 1);
    })
    .catch((error) => {
      console.error("Fatal error:", error);
      process.exit(1);
    });
}

module.exports = { runRemixPipeline, VOICE_STYLES };
