/**
 * Immersion v2 - TTS Module (Lemonfox + ElevenLabs Premium)
 *
 * Generates Spanish audio for each translated segment
 * Uses NATIVE TTS speed control - NO tempo stretching!
 *
 * Providers:
 * - Lemonfox: Default, affordable, good quality
 * - ElevenLabs: Premium, superior quality, higher cost
 *
 * Strategy:
 * 1. Translation module produces duration-aware text
 * 2. TTS generates at suggested speed (0.85-1.15)
 * 3. If segment won't fit naturally, COMPRESS translation (shorter)
 * 4. NO FFmpeg atempo = natural sounding audio
 */

const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");
const { GoogleGenerativeAI } = require("@google/generative-ai");
const elevenlabs = require("./elevenlabs");

const LEMONFOX_API_KEY = process.env.LEMONFOX_API_KEY;
const TTS_ENDPOINT = "https://api.lemonfox.ai/v1/audio/speech";

/**
 * Native Spanish voices - USE THESE FIRST!
 * These are trained specifically for Spanish and sound most natural
 */
const SPANISH_NATIVE_VOICES = {
  male: ["noel", "alex"], // Spanish-native male voices
  female: ["dora"], // Spanish-native female voices
  neutral: ["alex", "noel", "dora"], // Mixed Spanish-native pool
};

/**
 * English voices (fallback for 4+ speakers)
 * These work well with Spanish text but have English accent
 */
const ENGLISH_VOICES = {
  male: ["adam", "onyx", "echo", "eric", "michael", "fenrir", "liam", "puck"],
  female: [
    "nova",
    "alloy",
    "jessica",
    "bella",
    "heart",
    "aoede",
    "kore",
    "nicole",
    "river",
    "sarah",
    "sky",
  ],
  neutral: ["adam", "nova", "onyx", "alloy", "echo", "jessica"],
};

/**
 * Default voices by gender (Spanish-native first!)
 */
const VOICES = {
  male: "noel", // Spanish-native male - most natural for Spanish
  female: "dora", // Spanish-native female - most natural for Spanish
  neutral: "alex", // Spanish-native neutral
};

/**
 * Combined voice pool - Spanish first, then English
 * For 1-3 speakers: use only Spanish voices
 * For 4+ speakers: add English voices to the pool
 */
const VOICE_POOL = {
  male: [...SPANISH_NATIVE_VOICES.male, ...ENGLISH_VOICES.male],
  female: [...SPANISH_NATIVE_VOICES.female, ...ENGLISH_VOICES.female],
  neutral: [...SPANISH_NATIVE_VOICES.neutral, ...ENGLISH_VOICES.neutral],
};

// Threshold for adding English voices
const SPANISH_VOICE_LIMIT = 3; // Use only Spanish for up to 3 speakers

// TTS speaking rate for overlap prediction
const TTS_CHARS_PER_SECOND = 14; // Spanish TTS at normal speed

/**
 * Compress a Spanish translation to fit within a time slot
 * Uses Gemini to create a shorter version that preserves core meaning
 *
 * @param {string} text - Original Spanish translation
 * @param {number} maxChars - Maximum characters allowed
 * @param {string} originalEnglish - Original English for context
 * @returns {Promise<string>} Compressed Spanish translation
 */
async function compressTranslation(text, maxChars, originalEnglish = "") {
  if (!process.env.GEMINI_API_KEY) {
    console.warn("   ⚠️ No GEMINI_API_KEY - cannot compress translation");
    return text; // Return original if no API key
  }

  const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
  const model = genAI.getGenerativeModel({
    model: "gemini-2.0-flash",
    generationConfig: {
      temperature: 0.2,
      maxOutputTokens: 256,
    },
  });

  const prompt = `Shorten this Spanish text to fit in ${maxChars} characters. Keep as much meaning as possible.
Rules:
- Remove filler words (bueno, pues, entonces, como que)
- Use contractions where natural
- Keep all key information
- Must sound complete and natural, not cut off

Original (${text.length} chars): "${text}"

Return ONLY the shortened Spanish (max ${maxChars} chars):`;

  try {
    const result = await model.generateContent(prompt);
    const compressed = result.response.text().trim();

    // Validate it's actually shorter
    if (compressed.length <= maxChars && compressed.length > 0) {
      return compressed;
    }

    // If still too long, truncate at last complete word
    if (compressed.length > maxChars) {
      const truncated = compressed.substring(0, maxChars);
      const lastSpace = truncated.lastIndexOf(" ");
      return lastSpace > maxChars * 0.5
        ? truncated.substring(0, lastSpace)
        : truncated;
    }

    return text; // Return original if compression failed
  } catch (error) {
    console.warn(`   ⚠️ Compression failed: ${error.message}`);
    return text; // Return original on error
  }
}

/**
 * Post-process speed adjustment using ffmpeg atempo
 * Used as a fallback when TTS speed parameter can't achieve perfect sync
 * 
 * For segments that are too long: speed up with atempo
 * For segments that are too short: mild slowdown + pad with silence to fill the slot
 * (centering the speech within the time slot for natural timing)
 * 
 * @param {string} inputPath - Input audio file
 * @param {string} outputPath - Output audio file
 * @param {number} targetDuration - Desired duration in seconds
 * @param {number} currentDuration - Current audio duration
 * @returns {Promise<object>} Result with adjusted file path and duration
 */
async function postProcessSpeedAdjust(inputPath, outputPath, targetDuration, currentDuration) {
  const MAX_SPEEDUP = 1.35; // Max 35% speedup for synced mode
  const MIN_STRETCH = 0.80; // Max stretch: ~1.25x slower — mild slowdown only, never sounds draggy
  
  if (!currentDuration || currentDuration <= 0) {
    return { path: inputPath, duration: currentDuration, adjusted: false };
  }
  
  const ratio = currentDuration / targetDuration;
  
  // If within 5% tolerance, don't adjust
  if (ratio >= 0.95 && ratio <= 1.05) {
    return { path: inputPath, duration: currentDuration, adjusted: false };
  }
  
  // ── TOO SHORT: mild stretch to partially fill the slot ──
  // Only do a gentle slowdown (down to 0.8x atempo = 1.25x slower).
  // If the gap is bigger than that, leave it — a brief silence is better
  // than unnaturally slow speech, especially at higher CEFR levels.
  if (ratio < 0.95) {
    // If ratio is already above MIN_STRETCH, stretch to fill.
    // If below, only stretch to MIN_STRETCH (leave remaining gap as silence).
    if (ratio >= MIN_STRETCH) {
      // Mild stretch — will sound natural
    } else {
      // Gap too large for stretching alone — skip the stretch entirely,
      // just return the audio as-is (natural speed with a silence gap)
      return { path: inputPath, duration: currentDuration, adjusted: false };
    }
    
    try {
      // Calculate atempo factor needed to stretch toward target duration
      // atempo < 1.0 = slower playback = stretches audio
      let atempo = Math.max(MIN_STRETCH, ratio);
      
      // Build atempo filter chain (atempo range per filter: 0.5 - 2.0)
      let atempoFilters = [];
      let remaining = atempo;
      
      while (remaining < 0.5) {
        atempoFilters.push("atempo=0.5");
        remaining /= 0.5; // e.g. 0.3 → 0.5 * 0.6
      }
      atempoFilters.push(`atempo=${remaining.toFixed(4)}`);
      
      const filterChain = atempoFilters.join(",");
      
      execSync(
        `ffmpeg -y -i "${inputPath}" -filter:a "${filterChain}" "${outputPath}" 2>/dev/null`,
        { encoding: "utf-8", timeout: 30000 }
      );
      
      if (fs.existsSync(outputPath)) {
        const newDuration = getAudioDuration(outputPath) || targetDuration;
        return { 
          path: outputPath, 
          duration: newDuration, 
          adjusted: true,
          stretched: true,
          atempo: atempo,
        };
      }
    } catch (err) {
      // Fall through to return unadjusted
    }
    return { path: inputPath, duration: currentDuration, adjusted: false };
  }
  
  // ── TOO LONG: speed up with atempo ──
  let atempo = Math.min(MAX_SPEEDUP, ratio);
  
  // Build atempo filter chain (atempo range per filter: 0.5 - 2.0)
  let atempoFilters = [];
  let remaining = atempo;
  
  while (remaining > 2.0) {
    atempoFilters.push("atempo=2.0");
    remaining /= 2.0;
  }
  atempoFilters.push(`atempo=${remaining.toFixed(4)}`);
  
  const filterChain = atempoFilters.join(",");
  
  try {
    execSync(
      `ffmpeg -y -i "${inputPath}" -filter:a "${filterChain}" "${outputPath}" 2>/dev/null`,
      { encoding: "utf-8", timeout: 30000 }
    );
    const newDuration = getAudioDuration(outputPath);
    return { 
      path: outputPath, 
      duration: newDuration, 
      adjusted: true,
      atempo: atempo,
    };
  } catch (err) {
    return { path: inputPath, duration: currentDuration, adjusted: false };
  }
}

/**
 * Merge consecutive segments that would overlap into continuous TTS sections
 * This produces more natural speech instead of cutting segments short
 *
 * @param {array} segments - Translated segments with start times and text
 * @param {object} options - Merge options
 * @returns {object} - { segments: merged segments, stats: merge statistics }
 */
function mergeOverlappingSegments(segments, options = {}) {
  const {
    minGap = 0.15, // Minimum gap between segments (150ms)
    charsPerSecond = TTS_CHARS_PER_SECOND,
  } = options;

  if (!segments || segments.length === 0)
    return { segments: [], stats: { merged: 0, original: 0 } };

  // Sort by start time
  const sorted = [...segments].sort((a, b) => a.start - b.start);
  const merged = [];
  let current = { ...sorted[0] };
  let mergeCount = 0;

  for (let i = 1; i < sorted.length; i++) {
    const next = sorted[i];

    // Estimate when current segment's TTS would end
    const currentText = current.translatedText || current.text || "";
    const estimatedDuration = currentText.length / charsPerSecond;
    const estimatedEnd = current.start + estimatedDuration;

    // Check if we should merge:
    // 1. Same speaker (or no speaker info)
    // 2. Estimated TTS end would overlap with next segment start
    const sameSpeaker =
      !current.speaker || !next.speaker || current.speaker === next.speaker;
    const wouldOverlap = estimatedEnd + minGap > next.start;

    if (sameSpeaker && wouldOverlap) {
      // Merge: combine text, extend duration
      const nextText = next.translatedText || next.text || "";
      const gap = next.start - current.start - estimatedDuration;

      // Add a small pause between merged segments (represented by "...")
      // Only if there was some gap in the original
      const connector = gap > 0.3 ? "... " : " ";

      current.translatedText = currentText + connector + nextText;
      current.text = (current.text || "") + connector + (next.text || "");
      current.end = next.end;
      current.duration = next.end - current.start;
      current.mergedCount = (current.mergedCount || 1) + 1;
      current.originalIndices = [
        ...(current.originalIndices || [current.index]),
        next.index,
      ];
      mergeCount++;
    } else {
      // No merge: push current and start new
      merged.push(current);
      current = { ...next };
    }
  }

  // Don't forget the last segment
  merged.push(current);

  // Re-index merged segments
  merged.forEach((seg, i) => {
    seg.index = i;
  });

  return {
    segments: merged,
    stats: {
      original: segments.length,
      merged: merged.length,
      combinedCount: mergeCount,
    },
  };
}

/**
 * Map speakers to voices
 * PRIORITY: Spanish-native voices first, English only for 4+ speakers
 * Uses per-speaker gender detection when available for better voice matching
 *
 * @param {array} segments - Segments with speaker labels
 * @param {string} defaultGender - Default gender for voice pool selection
 * @param {object} speakerGenders - Optional map of speaker ID -> gender from diarization
 * @returns {object} Map of speaker ID to voice name
 */
function createSpeakerVoiceMap(
  segments,
  defaultGender = "neutral",
  speakerGenders = null,
  language = "spanish"
) {
  const speakers = [...new Set(segments.map((s) => s.speaker).filter(Boolean))];
  const numSpeakers = speakers.length;

  console.log(
    `   🎭 Creating voice map for ${numSpeakers} speakers (${language})`
  );

  // Track how many times each voice is used (for round-robin recycling)
  const voiceUseCounts = new Map();
  const speakerVoiceMap = {};

  for (const speaker of speakers) {
    // Determine this speaker's gender
    let speakerGender = defaultGender;
    if (speakerGenders && speakerGenders[speaker]) {
      speakerGender = speakerGenders[speaker];
      console.log(`      ${speaker}: detected as ${speakerGender}`);
    }

    // Build voice pool for this speaker's gender
    let voicePool;

    // For non-Spanish languages (like Indonesian), use English voices
    if (language.toLowerCase() !== "spanish") {
      voicePool = ENGLISH_VOICES[speakerGender] || ENGLISH_VOICES.neutral;
      console.log(`      Using English voice pool for ${language}`);
    } else {
      // Always use Spanish-native voices — recycle them for 4+ speakers
      voicePool =
        SPANISH_NATIVE_VOICES[speakerGender] || SPANISH_NATIVE_VOICES.neutral;
    }

    // Round-robin: pick the voice used the fewest times so far
    // (spreads speakers evenly across the available Spanish voices)
    let selectedVoice = voicePool[0];
    let minUseCount = Infinity;
    for (const voice of voicePool) {
      const useCount = voiceUseCounts.get(voice) || 0;
      if (useCount < minUseCount) {
        minUseCount = useCount;
        selectedVoice = voice;
      }
    }

    speakerVoiceMap[speaker] = selectedVoice;
    voiceUseCounts.set(selectedVoice, (voiceUseCounts.get(selectedVoice) || 0) + 1);
  }

  console.log(
    `   🇪🇸 Using Spanish-native voices (${numSpeakers} speakers, recycling as needed)`
  );

  console.log(`   🎭 Speaker voice mapping:`);
  for (const [speaker, voice] of Object.entries(speakerVoiceMap)) {
    const gender = speakerGenders?.[speaker] || defaultGender;
    console.log(`      ${speaker} (${gender}) → ${voice} 🇪🇸`);
  }

  return speakerVoiceMap;
}

/**
 * TTS speed constraints
 * Going outside this range sounds unnatural
 */
const SPEED_LIMITS = {
  min: 0.8,
  max: 1.3, // 1.3x is fast but still understandable
  default: 1.0,
};

/**
 * Get audio duration using ffprobe
 */
function getAudioDuration(filePath) {
  try {
    const result = execSync(
      `ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "${filePath}"`,
      { encoding: "utf-8", timeout: 10000 }
    );
    return parseFloat(result.trim());
  } catch {
    return null;
  }
}

/**
 * Language codes for Lemonfox TTS
 */
const LANGUAGE_CODES = {
  spanish: "es",
  indonesian: "id",
  english: "en",
};

/**
 * Generate TTS for a single segment
 * Uses native TTS speed parameter - no tempo stretching!
 */
async function generateSegmentTTS(text, index, outputDir, options = {}) {
  const {
    voice = "noel",
    speed = 1.0,
    timeout = 30000,
    language = "spanish",
  } = options;

  // Clamp speed to safe range
  const safeSpeed = Math.max(
    SPEED_LIMITS.min,
    Math.min(SPEED_LIMITS.max, speed)
  );

  // Get language code
  const langCode = LANGUAGE_CODES[language.toLowerCase()] || "es";

  const fileName = `tts_${String(index).padStart(4, "0")}.mp3`;
  const filePath = path.join(outputDir, fileName);

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeout);

  try {
    const response = await fetch(TTS_ENDPOINT, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LEMONFOX_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        input: text,
        voice: voice,
        language: langCode,
        response_format: "mp3",
        speed: safeSpeed,
      }),
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`TTS failed: ${response.status} ${errorText}`);
    }

    const audioBuffer = Buffer.from(await response.arrayBuffer());

    // Validate response is actual audio (not an error page or truncated response)
    const MIN_AUDIO_SIZE = 2048; // 2KB minimum for any real audio
    if (audioBuffer.length < MIN_AUDIO_SIZE) {
      throw new Error(
        `TTS returned suspiciously small response (${audioBuffer.length} bytes) — likely corrupt or rate-limited`
      );
    }

    // Check MP3 header: should start with FF FB, FF F3, FF F2 (MPEG frames) or ID3 tag
    const hasMP3Header =
      (audioBuffer[0] === 0xff && (audioBuffer[1] & 0xe0) === 0xe0) || // MPEG sync word
      (audioBuffer[0] === 0x49 && audioBuffer[1] === 0x44 && audioBuffer[2] === 0x33); // ID3 tag
    if (!hasMP3Header) {
      throw new Error(
        `TTS returned non-MP3 data (starts with 0x${audioBuffer.slice(0, 4).toString("hex")}, ${audioBuffer.length} bytes)`
      );
    }

    fs.writeFileSync(filePath, audioBuffer);

    const duration = getAudioDuration(filePath);

    return {
      fileName,
      filePath,
      duration,
      size: audioBuffer.length,
      speed: safeSpeed,
    };
  } catch (error) {
    clearTimeout(timeoutId);
    if (error.name === "AbortError") {
      throw new Error(`TTS request timed out after ${timeout / 1000}s`);
    }
    throw error;
  }
}

/**
 * Calculate the TTS speed needed to match target duration
 * Based on: actualDuration * newSpeed = targetDuration * currentSpeed
 */
function calculateRequiredSpeed(actualDuration, targetDuration, currentSpeed) {
  const requiredSpeed = (actualDuration / targetDuration) * currentSpeed;
  return Math.max(SPEED_LIMITS.min, Math.min(SPEED_LIMITS.max, requiredSpeed));
}

/**
 * Generate TTS for all segments with duration matching
 * Uses native TTS speed - NO tempo stretching!
 * Supports multi-speaker with different voices per speaker
 *
 * @param {array} segments - Translated segments with timing info and suggestedTTSSpeed
 * @param {string} outputDir - Output directory
 * @param {object} options - TTS options
 * @returns {Promise<object>} Results with duration stats
 */
/**
 * Output modes for different learning/viewing experiences
 * All modes support any CEFR level (A1-C1) - user chooses translation complexity
 *
 * V1 - SYNCED: Normal TTS speed, original video timing
 *      Segments that can't fit naturally are SKIPPED
 *      Best for: Native-like viewing experience
 *
 * V2 - LEARNER: Slower TTS (0.8x) for comprehension
 *      Audio-only output, easier to follow
 *      Best for: Language learners practicing listening
 *
 * V3 - EXTENDED: Normal TTS, video stretched to fit all audio
 *      No segments skipped, video adapts to audio
 *      Best for: Complete understanding with visual context
 */
const OUTPUT_MODES = {
  synced: {
    speedMultiplier: 1.0,
    mergeOverlaps: false,
    skipUnfittable: false, // Never skip — include all segments, even if slightly off-duration
    description: "Synced audio with original video timing",
  },
  learner: {
    speedMultiplier: 0.8,
    mergeOverlaps: false,
    skipUnfittable: false,
    description: "Slower audio for comprehension practice",
  },
  extended: {
    speedMultiplier: 1.0,
    mergeOverlaps: false,
    skipUnfittable: false, // Never skip - video stretches instead
    description: "Full translation with video stretched to fit",
  },
  narrator: {
    // Speed comes from segment.suggestedTTSSpeed (set by translateNarrator based on level)
    // A1=0.70, A2=0.75, B1=0.85, B2=0.95, C1=1.0
    speedMultiplier: null, // Use per-segment speed from translation
    useLevelSpeed: true,   // Flag to use segment.suggestedTTSSpeed
    mergeOverlaps: false,
    skipUnfittable: false, // Time-filling text should fit
    singleNarrator: false, // Can still use multi-speaker
    description: "Time-filling: MORE simple words at lower levels + slower speech",
  },
  brainrot: {
    speedMultiplier: 0.75, // Extra slow for TikTok narration style
    mergeOverlaps: false,
    skipUnfittable: false, // Narration controls pacing, no skipping
    singleNarrator: true, // Use one consistent voice
    narratorVoice: "nova", // Clear, engaging voice for narration
    description: "TikTok-style third-person narration with sped-up video",
  },
};

async function generateAndAlign(segments, outputDir, options = {}) {
  const {
    voice = "noel", // Default voice (used if no speaker mapping)
    concurrency = 15, // Balanced: fast enough solo, safe with concurrent jobs
    minDuration = 0.3,
    maxRetries = 2, // Retry with adjusted speed if duration is off
    durationTolerance = 0.15, // Accept if within 15% of target
    multiSpeaker = true, // Enable multi-speaker voice mapping
    defaultGender = "neutral", // Gender for voice pool selection
    speakerGenders = null, // Per-speaker gender map from diarization + Gemini
    mode = "synced", // Output mode: synced, learner, extended
    mergeOverlaps = false, // Merge overlapping segments (usually false)
    language = "spanish", // Target language: spanish, indonesian
  } = options;

  const modeConfig = OUTPUT_MODES[mode] || OUTPUT_MODES.synced;
  const baseSpeedMultiplier = modeConfig.speedMultiplier;
  const shouldMerge = mergeOverlaps || modeConfig.mergeOverlaps;

  console.log(`\n${"═".repeat(60)}`);
  console.log(`🎤 TTS: Generate Audio (Mode: ${mode.toUpperCase()})`);
  console.log(`${"═".repeat(60)}`);

  if (!LEMONFOX_API_KEY) {
    throw new Error(
      "LEMONFOX_API_KEY not set!\n" +
        "Add to .env: LEMONFOX_API_KEY=your_key_here"
    );
  }

  // Create output dir
  const ttsDir = path.join(outputDir, "tts");
  fs.mkdirSync(ttsDir, { recursive: true });

  // Optionally merge overlapping segments (disabled by default for precise sync)
  let processedSegments = segments;
  let mergeStats = {
    original: segments.length,
    merged: segments.length,
    combinedCount: 0,
  };

  if (shouldMerge) {
    const result = mergeOverlappingSegments(segments);
    processedSegments = result.segments;
    mergeStats = result.stats;

    if (mergeStats.combinedCount > 0) {
      console.log(
        `   🔗 Merged ${mergeStats.combinedCount} overlapping segments:`
      );
      console.log(
        `      ${mergeStats.original} → ${mergeStats.merged} segments`
      );
    }
  }

  console.log(`   📋 Mode: ${mode} (speed: ${baseSpeedMultiplier}x)`);
  if (mode === "learner") {
    console.log(`   🎓 Learner mode: Slower speech for better comprehension`);
  } else if (mode === "extended") {
    console.log(
      `   📺 Extended mode: Will flag segments needing video stretch`
    );
  } else if (mode === "narrator") {
    console.log(`   🎙️ Narrator mode: Time-filling with level-adaptive speed`);
    console.log(`   📊 Fills time with simple words at lower levels`);
  } else if (mode === "brainrot") {
    console.log(`   🧠 Brainrot mode: TikTok-style narration, single voice`);
    console.log(`   🎙️ Narrator voice: ${modeConfig.narratorVoice}`);
  }

  // Create speaker-to-voice mapping if multi-speaker enabled
  let speakerVoiceMap = null;
  const uniqueSpeakers = [
    ...new Set(processedSegments.map((s) => s.speaker).filter(Boolean)),
  ];

  if (multiSpeaker && uniqueSpeakers.length > 1) {
    // Pass speaker genders from diarization for per-speaker voice matching
    speakerVoiceMap = createSpeakerVoiceMap(
      processedSegments,
      defaultGender,
      speakerGenders,
      language
    );
  }

  console.log(`   Segments: ${processedSegments.length}`);
  console.log(
    `   Speakers: ${uniqueSpeakers.length} (${
      uniqueSpeakers.join(", ") || "none"
    })`
  );
  console.log(`   Default voice: ${voice}`);
  console.log(
    `   Multi-speaker: ${
      speakerVoiceMap ? "enabled" : "disabled (single speaker)"
    }`
  );
  console.log(`   Concurrency: ${concurrency}`);
  console.log(
    `   Duration tolerance: ±${(durationTolerance * 100).toFixed(0)}%`
  );
  console.log(`   Output: ${ttsDir}`);

  const startTime = Date.now();
  const results = [];
  let successCount = 0;
  let withinToleranceCount = 0;

  // Process in batches (using merged segments)
  const totalBatches = Math.ceil(processedSegments.length / concurrency);

  for (let i = 0; i < processedSegments.length; i += concurrency) {
    const batch = processedSegments.slice(i, i + concurrency);
    const batchNum = Math.floor(i / concurrency) + 1;

    process.stdout.write(`\r   🔄 Batch ${batchNum}/${totalBatches}...`);

    const batchResults = await Promise.all(
      batch.map(async (seg) => {
        try {
          // Skip very short segments
          if (seg.duration < minDuration) {
            return {
              index: seg.index,
              skipped: true,
              reason: "too short",
            };
          }

          // ═══════════════════════════════════════════════════════════
          // V1 SYNCED MODE: Minimal compression - prefer faster speech over cutting
          // Only compress extreme cases (would need >1.3x speed)
          // TTS at 1.2-1.25x still sounds natural
          // ═══════════════════════════════════════════════════════════
          const shouldCompress = modeConfig.skipUnfittable || false;
          let textToSpeak = seg.translatedText;
          let wasCompressed = false;

          if (shouldCompress && textToSpeak) {
            // Allow up to 1.3x TTS speed before compression (1.2x is natural, 1.3x is fast but ok)
            const maxSpeedBeforeCompression = 1.3;
            const maxCharsAtFastSpeed = Math.floor(
              seg.duration * TTS_CHARS_PER_SECOND * maxSpeedBeforeCompression
            );

            if (textToSpeak.length > maxCharsAtFastSpeed) {
              // Translation REALLY too long - compress minimally (90% of original)
              const originalLength = textToSpeak.length;
              const targetLength = Math.max(
                maxCharsAtFastSpeed,
                Math.floor(originalLength * 0.9) // Never compress below 90% of original
              );

              textToSpeak = await compressTranslation(
                textToSpeak,
                targetLength,
                seg.originalText || seg.text
              );
              wasCompressed = true;

              // Only skip if segment is extremely short AND compression totally failed
              if (
                textToSpeak.length > maxCharsAtFastSpeed * 1.5 &&
                seg.duration < 0.5
              ) {
                return {
                  index: seg.index,
                  start: seg.start,
                  end: seg.end,
                  skipped: true,
                  reason: "unfittable",
                  details: `Cannot compress enough: ${textToSpeak.length}/${maxCharsAtFastSpeed} chars`,
                  originalLength,
                  compressedLength: textToSpeak.length,
                  availableDuration: seg.duration,
                };
              }
            }
          }

          // Get suggested speed from translation (or default)
          // For narrator mode: use per-segment speed from translation (level-based)
          // For other modes: apply mode speed multiplier
          let baseSpeed = seg.suggestedTTSSpeed || SPEED_LIMITS.default;
          let speed;
          if (modeConfig.useLevelSpeed && seg.suggestedTTSSpeed) {
            // Narrator mode: use the level-based speed directly
            speed = seg.suggestedTTSSpeed;
          } else {
            // Other modes: apply multiplier
            speed = baseSpeed * (baseSpeedMultiplier || 1.0);
          }
          speed = Math.max(SPEED_LIMITS.min, Math.min(SPEED_LIMITS.max, speed));

          let attempt = 0;
          let ttsResult = null;
          let durationError = Infinity;

          // Get voice for this speaker (or use default)
          // Brainrot mode: use single narrator voice regardless of speaker
          const segmentVoice = modeConfig.singleNarrator
            ? modeConfig.narratorVoice
            : speakerVoiceMap && seg.speaker
              ? speakerVoiceMap[seg.speaker] || voice
              : voice;

          // For synced/extended modes: try to match duration
          // For learner/brainrot/narrator modes: just generate at configured speed (duration match less critical)
          const shouldMatchDuration = mode !== "learner" && mode !== "brainrot" && mode !== "narrator";
          const effectiveMaxRetries = shouldMatchDuration ? maxRetries : 1;

          // Try generating, retry with adjusted speed if needed
          while (
            attempt < effectiveMaxRetries &&
            durationError > durationTolerance
          ) {
            attempt++;

            // Retry loop for corrupt/rate-limited responses
            let corruptRetries = 0;
            const MAX_CORRUPT_RETRIES = 3;
            while (true) {
              try {
                ttsResult = await generateSegmentTTS(
                  textToSpeak, // Use potentially compressed text
                  seg.index,
                  ttsDir,
                  { voice: segmentVoice, speed, language }
                );
                break; // Success — exit retry loop
              } catch (retryErr) {
                corruptRetries++;
                if (
                  corruptRetries < MAX_CORRUPT_RETRIES &&
                  (retryErr.message.includes("corrupt") ||
                   retryErr.message.includes("rate-limited") ||
                   retryErr.message.includes("non-MP3") ||
                   retryErr.message.includes("suspiciously small"))
                ) {
                  // Exponential backoff: 1s, 2s, 4s
                  const delay = 1000 * Math.pow(2, corruptRetries - 1);
                  console.error(
                    `\n      ⚠️ Seg ${seg.index}: corrupt response (attempt ${corruptRetries}/${MAX_CORRUPT_RETRIES}), retrying in ${delay / 1000}s...`
                  );
                  await new Promise((r) => setTimeout(r, delay));
                } else {
                  throw retryErr; // Non-retryable error or max retries exhausted
                }
              }
            }

            // Check duration accuracy
            durationError =
              Math.abs(ttsResult.duration - seg.duration) / seg.duration;

            if (
              shouldMatchDuration &&
              durationError > durationTolerance &&
              attempt < effectiveMaxRetries
            ) {
              // Calculate better speed for retry
              speed = calculateRequiredSpeed(
                ttsResult.duration,
                seg.duration,
                speed
              );
              // Apply mode multiplier again
              speed = speed * baseSpeedMultiplier;
              speed = Math.max(
                SPEED_LIMITS.min,
                Math.min(SPEED_LIMITS.max, speed)
              );
            }
          }

          successCount++;
          
          // SYNCED MODE: Post-process speed adjustment if still outside tolerance
          // This is a fallback for when TTS speed parameter alone can't achieve perfect sync
          let finalFilePath = ttsResult.filePath;
          let finalDuration = ttsResult.duration;
          let postProcessSpeedAdjusted = false;
          
          if (shouldMatchDuration && durationError > durationTolerance) {
            const slotDuration = seg.duration;
            const rawDuration = ttsResult.duration;
            const ratio = rawDuration / slotDuration;
            
            // Only post-process if more than 15% off (TTS already tried its best)
            if (ratio > 1.15 || ratio < 0.85) {
              const adjustedPath = ttsResult.filePath.replace(/\.mp3$/, "_synced.mp3");
              const atempoResult = await postProcessSpeedAdjust(
                ttsResult.filePath,
                adjustedPath,
                slotDuration,
                rawDuration
              );
              
              if (atempoResult.adjusted) {
                finalFilePath = atempoResult.path;
                finalDuration = atempoResult.duration;
                postProcessSpeedAdjusted = true;
                durationError = Math.abs(finalDuration - slotDuration) / slotDuration;
              }
            }
          }
          
          if (durationError <= durationTolerance) {
            withinToleranceCount++;
          }

          // Track overflow info for extended mode (video stretching)
          const overflow = finalDuration - seg.duration;
          const needsVideoStretch = overflow > 0.1; // >100ms overflow

          return {
            index: seg.index,
            start: seg.start,
            end: seg.end,
            targetDuration: seg.duration,
            actualDuration: ttsResult.duration,
            finalDuration: finalDuration,
            durationError: durationError,
            withinTolerance: durationError <= durationTolerance,
            ttsSpeed: ttsResult.speed,
            attempts: attempt,
            ttsFile: ttsResult.filePath,
            // For merge module compatibility
            alignedFile: finalFilePath,
            alignedDuration: finalDuration,
            originalText: seg.originalText || seg.text,
            translatedText: textToSpeak, // May be compressed
            originalTranslation: seg.translatedText, // Original before compression
            // Compression info
            wasCompressed: wasCompressed,
            compressionRatio: wasCompressed
              ? textToSpeak.length / seg.translatedText.length
              : 1.0,
            // Speed adjustment info
            postProcessSpeedAdjusted,
            // Speaker info
            speaker: seg.speaker,
            voice: segmentVoice,
            // Overflow tracking for video stretching (extended mode)
            overflow: overflow,
            needsVideoStretch: needsVideoStretch,
            stretchAmount: needsVideoStretch ? overflow : 0,
          };
        } catch (error) {
          return {
            index: seg.index,
            error: error.message,
          };
        }
      })
    );

    results.push(...batchResults);
  }

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);

  // Calculate stats
  const validResults = results.filter((r) => !r.error && !r.skipped);
  const durationErrors = validResults
    .map((r) => r.durationError)
    .filter((e) => !isNaN(e));
  const avgError =
    durationErrors.reduce((a, b) => a + b, 0) / durationErrors.length;
  const maxError = Math.max(...durationErrors);

  // Calculate overflow stats for extended mode
  const overflowSegments = validResults.filter((r) => r.needsVideoStretch);
  const totalOverflow = overflowSegments.reduce(
    (sum, r) => sum + r.stretchAmount,
    0
  );

  console.log(`\n\n   ✅ TTS COMPLETE in ${elapsed}s (Mode: ${mode})`);
  console.log(`   📊 Generated: ${successCount}/${processedSegments.length}`);
  console.log(`   📏 Duration accuracy:`);
  console.log(
    `      Within tolerance: ${withinToleranceCount}/${successCount} (${(
      (withinToleranceCount / successCount) *
      100
    ).toFixed(0)}%)`
  );
  console.log(`      Avg error: ${(avgError * 100).toFixed(1)}%`);
  console.log(`      Max error: ${(maxError * 100).toFixed(1)}%`);

  // Count different skip reasons and compressions
  const skippedResults = results.filter((r) => r.skipped);
  const skippedUnfittable = skippedResults.filter(
    (r) => r.reason === "unfittable"
  );
  const skippedTooShort = skippedResults.filter(
    (r) => r.reason === "too short"
  );
  const compressedResults = validResults.filter((r) => r.wasCompressed);

  if (compressedResults.length > 0) {
    const avgCompression =
      compressedResults.reduce((sum, r) => sum + r.compressionRatio, 0) /
      compressedResults.length;
    console.log(
      `   🗜️  Compressed ${compressedResults.length} segments to fit (avg ${(
        avgCompression * 100
      ).toFixed(0)}% of original)`
    );
  }
  
  // Count post-process speed adjusted segments
  const postProcessAdjusted = validResults.filter((r) => r.postProcessSpeedAdjusted);
  if (postProcessAdjusted.length > 0) {
    console.log(
      `   🎚️  Speed-adjusted ${postProcessAdjusted.length} segments (synced mode atempo)`
    );
  }

  if (skippedUnfittable.length > 0) {
    console.log(
      `   ⏭️  Skipped ${skippedUnfittable.length} unfittable segments (couldn't compress enough)`
    );
  }

  if (overflowSegments.length > 0) {
    console.log(
      `   ⚠️  Overflow segments: ${
        overflowSegments.length
      } (need ${totalOverflow.toFixed(1)}s video stretch)`
    );
  }

  if (mode === "learner") {
    console.log(
      `   🎓 Learner mode: ${baseSpeedMultiplier}x speed for better comprehension`
    );
  } else if (mode === "synced") {
    console.log(
      `   🎯 Synced mode: Natural speed, unfittable segments removed`
    );
  } else {
    console.log(`   🎵 NO tempo stretching used - all natural TTS speed!`);
  }

  return {
    outputDir,
    ttsDir,
    alignedDir: ttsDir, // Same as ttsDir since we don't use atempo
    segments: results,
    mode: mode,
    modeConfig: modeConfig,
    stats: {
      total: processedSegments.length,
      originalTotal: mergeStats.original, // Original segment count before merging
      merged: mergeStats.combinedCount, // How many segments were merged
      success: successCount,
      withinTolerance: withinToleranceCount,
      compressed: compressedResults.length, // Segments that needed compression
      skipped: skippedResults.length,
      skippedUnfittable: skippedUnfittable.length,
      skippedTooShort: skippedTooShort.length,
      failed: results.filter((r) => r.error).length,
    },
    syncStats: {
      avgError: avgError,
      maxError: maxError,
      toleranceRate: withinToleranceCount / successCount,
    },
    // Overflow info for video stretching (extended mode)
    overflowStats: {
      segmentsNeedingStretch: overflowSegments.length,
      totalStretchNeeded: totalOverflow,
      segments: overflowSegments.map((s) => ({
        index: s.index,
        start: s.start,
        end: s.end,
        stretchAmount: s.stretchAmount,
      })),
    },
    processingTime: parseFloat(elapsed),
  };
}

/**
 * Check if Lemonfox API key is set
 */
function checkApiKey() {
  return !!LEMONFOX_API_KEY;
}

/**
 * TTS Provider types
 */
const TTS_PROVIDERS = {
  lemonfox: "lemonfox", // Default, affordable
  elevenlabs: "elevenlabs", // Premium, superior quality
};

/**
 * Unified TTS generation with provider selection
 *
 * @param {array} segments - Translated segments with timing info
 * @param {string} outputDir - Output directory
 * @param {object} options - TTS options including provider selection
 * @returns {Promise<object>} Results with all generated audio
 */
async function generateTTS(segments, outputDir, options = {}) {
  const { premium = false, provider = null, ...restOptions } = options;

  // Determine provider: explicit provider > premium flag > default
  let selectedProvider = TTS_PROVIDERS.lemonfox;
  if (provider) {
    selectedProvider = provider;
  } else if (premium) {
    selectedProvider = TTS_PROVIDERS.elevenlabs;
  }

  console.log(
    `\n🎤 TTS Provider: ${selectedProvider.toUpperCase()}${
      premium ? " (Premium)" : ""
    }`
  );

  if (selectedProvider === TTS_PROVIDERS.elevenlabs) {
    // Check ElevenLabs API key
    if (!elevenlabs.checkApiKey()) {
      throw new Error(
        "ELEVENLABS_API_KEY not set for premium mode!\n" +
          "Add to .env: ELEVENLABS_API_KEY=your_key_here\n" +
          "Get your API key at: https://elevenlabs.io/app/settings/api-keys"
      );
    }

    // Map voice names if using Lemonfox voice names
    const voiceMapping = {
      noel: "adam", // Male Spanish → Male narrator
      dora: "veronica", // Female Spanish → Veronica (premium Spanish female)
      alex: "veronica", // Neutral → Veronica (premium)
    };

    const mappedOptions = { ...restOptions };
    if (mappedOptions.voice && voiceMapping[mappedOptions.voice]) {
      console.log(
        `   📎 Mapping voice: ${mappedOptions.voice} → ${
          voiceMapping[mappedOptions.voice]
        }`
      );
      mappedOptions.voice = voiceMapping[mappedOptions.voice];
    }

    return elevenlabs.generateAndAlign(segments, outputDir, mappedOptions);
  }

  // Default: Lemonfox
  return generateAndAlign(segments, outputDir, restOptions);
}

/**
 * Check if a specific provider's API key is set
 */
function checkProviderApiKey(provider) {
  if (provider === TTS_PROVIDERS.elevenlabs) {
    return elevenlabs.checkApiKey();
  }
  return checkApiKey(); // Lemonfox
}

/**
 * CONVERSATION TTS: Generate pre-mixed multi-speaker audio for conversation blocks
 * 
 * For rapid dialogue, this generates all speaker turns and mixes them together
 * with proper timing and crossfades, producing one audio file per conversation block.
 * 
 * Benefits:
 * - Natural flow: speakers' voices blend at turn boundaries
 * - No gaps: continuous conversation feel
 * - Crossfade: smooth transitions instead of hard cuts
 * 
 * @param {object} conversationData - Output from translateConversation()
 * @param {string} outputDir - Output directory for audio files
 * @param {object} options - TTS options
 * @returns {Promise<object>} Results with conversation block audio + monologue segments
 */
async function generateConversationTTS(conversationData, outputDir, options = {}) {
  const {
    premium = false,
    voice = VOICES.neutral,
    concurrency = 5,
    multiSpeaker = true,
    defaultGender = "male",
    speakerGenders = null,
    language = "spanish",
    crossfadeDuration = 0.15, // 150ms crossfade between speakers
  } = options;

  const { blocks, monologues, stats: inputStats } = conversationData;

  console.log(`\n${"═".repeat(60)}`);
  console.log(`🗣️ CONVERSATION TTS: Pre-mixed Multi-Speaker Audio`);
  console.log(`${"═".repeat(60)}`);
  console.log(`   Conversation blocks: ${blocks.length}`);
  console.log(`   Monologue segments: ${monologues.length}`);
  console.log(`   Premium TTS: ${premium ? 'ElevenLabs' : 'Lemonfox'}`);
  console.log(`   Crossfade duration: ${crossfadeDuration}s`);

  const startTime = Date.now();
  const conversationDir = path.join(outputDir, "conversations");
  fs.mkdirSync(conversationDir, { recursive: true });

  // Create speaker voice map
  const allSpeakers = new Set();
  blocks.forEach(b => b.speakers.forEach(s => allSpeakers.add(s)));
  monologues.forEach(m => { if (m.speaker) allSpeakers.add(m.speaker); });

  const speakerVoiceMap = createSpeakerVoiceMap(
    [...allSpeakers],
    multiSpeaker,
    defaultGender,
    speakerGenders
  );

  console.log(`\n   🎭 Speaker Voice Assignment:`);
  for (const [speaker, voiceName] of Object.entries(speakerVoiceMap)) {
    console.log(`      ${speaker} → ${voiceName}`);
  }

  const results = {
    conversationBlocks: [],
    monologueSegments: [],
    allSegments: [],
    stats: {
      blocksGenerated: 0,
      monologuesGenerated: 0,
      totalTurns: 0,
      errors: 0,
    },
  };

  // ═══════════════════════════════════════════════════════════════
  // STEP 1: Generate TTS for each turn in conversation blocks
  // ═══════════════════════════════════════════════════════════════
  if (blocks.length > 0) {
    console.log(`\n   📦 Processing ${blocks.length} conversation blocks...`);

    for (const block of blocks) {
      const blockDir = path.join(conversationDir, `block_${block.index}`);
      fs.mkdirSync(blockDir, { recursive: true });

      const turnAudioFiles = [];
      let blockSuccess = true;

      // Generate TTS for each turn in the block
      for (let i = 0; i < block.segments.length; i++) {
        const seg = block.segments[i];
        const turnFile = path.join(blockDir, `turn_${i}.mp3`);
        const voiceName = speakerVoiceMap[seg.speaker] || voice;

        try {
          // Calculate target duration for this turn
          const targetDuration = seg.end - seg.start;
          const speed = calculateRequiredSpeed(
            seg.translatedText?.length || 0,
            targetDuration,
            TTS_CHARS_PER_SECOND
          );

          // Generate TTS for this turn
          const ttsResult = await generateSegmentTTS(
            seg.translatedText || seg.text,
            turnFile,
            {
              voice: voiceName,
              speed: Math.max(0.8, Math.min(1.2, speed)),
              language,
            }
          );

          if (ttsResult.success && fs.existsSync(turnFile)) {
            const duration = getAudioDuration(turnFile);
            turnAudioFiles.push({
              idx: i,
              file: turnFile,
              duration,
              targetStart: seg.start - block.start, // Relative to block start
              speaker: seg.speaker,
              segment: seg,
            });
          } else {
            console.log(`      ⚠️ Block ${block.index} turn ${i}: TTS failed`);
            blockSuccess = false;
          }
        } catch (err) {
          console.log(`      ❌ Block ${block.index} turn ${i}: ${err.message}`);
          blockSuccess = false;
        }
      }

      // Mix all turns into a single conversation audio file
      if (turnAudioFiles.length > 0) {
        const mixedFile = path.join(conversationDir, `conversation_${block.index}.mp3`);
        
        try {
          await mixConversationTurns(turnAudioFiles, mixedFile, {
            crossfadeDuration,
            blockDuration: block.duration,
          });

          const mixedDuration = getAudioDuration(mixedFile);
          
          results.conversationBlocks.push({
            blockIndex: block.index,
            audioFile: mixedFile,
            duration: mixedDuration,
            targetDuration: block.duration,
            turns: turnAudioFiles.length,
            speakers: block.speakers,
            start: block.start,
            end: block.end,
            segments: block.segments.map((seg, i) => ({
              ...seg,
              alignedFile: turnAudioFiles[i]?.file || null,
              alignedDuration: turnAudioFiles[i]?.duration || 0,
            })),
          });

          results.stats.blocksGenerated++;
          results.stats.totalTurns += turnAudioFiles.length;
          console.log(`      ✅ Block ${block.index}: ${turnAudioFiles.length} turns → ${mixedDuration.toFixed(1)}s (target: ${block.duration.toFixed(1)}s)`);

        } catch (mixErr) {
          console.log(`      ❌ Block ${block.index} mix failed: ${mixErr.message}`);
          results.stats.errors++;
          
          // Fall back to individual turns
          block.segments.forEach((seg, i) => {
            if (turnAudioFiles[i]) {
              results.allSegments.push({
                ...seg,
                alignedFile: turnAudioFiles[i].file,
                alignedDuration: turnAudioFiles[i].duration,
                isConversation: true,
                conversationBlockIndex: block.index,
              });
            }
          });
        }
      } else {
        results.stats.errors++;
      }
    }
  }

  // ═══════════════════════════════════════════════════════════════
  // STEP 2: Generate TTS for monologue segments (standard)
  // ═══════════════════════════════════════════════════════════════
  if (monologues.length > 0) {
    console.log(`\n   📝 Generating TTS for ${monologues.length} monologue segments...`);

    const monoResult = await generateTTS(monologues, outputDir, {
      premium,
      voice,
      concurrency,
      multiSpeaker,
      defaultGender,
      speakerGenders,
      language,
    });

    results.monologueSegments = monoResult.segments.map(seg => ({
      ...seg,
      isMonologue: true,
      isConversation: false,
    }));
    results.stats.monologuesGenerated = monoResult.stats?.success || monoResult.segments.length;
  }

  // ═══════════════════════════════════════════════════════════════
  // STEP 3: Combine all segments for final output
  // ═══════════════════════════════════════════════════════════════
  
  // Flatten conversation block segments and add monologues
  const allSegments = [
    ...results.conversationBlocks.flatMap(cb => cb.segments),
    ...results.monologueSegments,
  ].sort((a, b) => a.start - b.start);

  // Re-index
  allSegments.forEach((seg, i) => {
    seg.index = i;
  });

  results.allSegments = allSegments;

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);

  console.log(`\n   ✅ CONVERSATION TTS COMPLETE in ${elapsed}s`);
  console.log(`   📊 Results:`);
  console.log(`      Conversation blocks: ${results.stats.blocksGenerated}`);
  console.log(`      Conversation turns: ${results.stats.totalTurns}`);
  console.log(`      Monologue segments: ${results.stats.monologuesGenerated}`);
  console.log(`      Total segments: ${allSegments.length}`);
  if (results.stats.errors > 0) {
    console.log(`      ⚠️ Errors: ${results.stats.errors}`);
  }

  return {
    segments: allSegments,
    conversationBlocks: results.conversationBlocks,
    monologueSegments: results.monologueSegments,
    stats: {
      ...results.stats,
      success: allSegments.filter(s => s.alignedFile).length,
      failed: allSegments.filter(s => !s.alignedFile).length,
      total: allSegments.length,
      processingTime: parseFloat(elapsed),
    },
  };
}

/**
 * Mix multiple conversation turns into a single audio file
 * Uses FFmpeg to position each turn at its target time with crossfades
 * 
 * @param {array} turns - Array of { file, targetStart, duration, speaker }
 * @param {string} outputFile - Output file path
 * @param {object} options - Mix options
 */
async function mixConversationTurns(turns, outputFile, options = {}) {
  const {
    crossfadeDuration = 0.15,
    blockDuration = null,
  } = options;

  if (turns.length === 0) {
    throw new Error("No turns to mix");
  }

  if (turns.length === 1) {
    // Just copy the single file
    fs.copyFileSync(turns[0].file, outputFile);
    return;
  }

  // Sort by target start time
  const sortedTurns = [...turns].sort((a, b) => a.targetStart - b.targetStart);

  // Build FFmpeg complex filter for mixing with delays
  // Each turn gets delayed to its target position, then all are mixed together
  const inputs = sortedTurns.map((t, i) => `-i "${t.file}"`).join(" ");
  
  // Build filter chain
  const filterParts = [];
  const mixInputs = [];

  sortedTurns.forEach((turn, i) => {
    // Calculate delay in milliseconds
    const delayMs = Math.max(0, Math.round(turn.targetStart * 1000));
    
    // Apply fade in/out for smooth transitions
    const fadeIn = i > 0 ? crossfadeDuration : 0.02;
    const fadeOut = i < sortedTurns.length - 1 ? crossfadeDuration : 0.02;
    
    // Delay and fade the audio
    filterParts.push(
      `[${i}:a]adelay=${delayMs}|${delayMs},afade=t=in:st=0:d=${fadeIn},afade=t=out:st=${turn.duration - fadeOut}:d=${fadeOut}[a${i}]`
    );
    mixInputs.push(`[a${i}]`);
  });

  // Mix all together
  const mixFilter = `${mixInputs.join("")}amix=inputs=${sortedTurns.length}:duration=longest:normalize=0[out]`;
  filterParts.push(mixFilter);

  const filterComplex = filterParts.join(";");
  const cmd = `ffmpeg -y ${inputs} -filter_complex "${filterComplex}" -map "[out]" -ar 44100 -b:a 192k "${outputFile}"`;

  try {
    execSync(cmd, { 
      encoding: "utf-8", 
      stdio: ["pipe", "pipe", "pipe"],
      timeout: 60000 
    });
  } catch (err) {
    // Fallback: simple concatenation if complex mixing fails
    console.log(`      ⚠️ Complex mix failed, using simple concat`);
    
    const concatList = path.join(path.dirname(outputFile), "concat_list.txt");
    const listContent = sortedTurns.map(t => `file '${t.file}'`).join("\n");
    fs.writeFileSync(concatList, listContent);
    
    execSync(
      `ffmpeg -y -f concat -safe 0 -i "${concatList}" -ar 44100 -b:a 192k "${outputFile}"`,
      { encoding: "utf-8", stdio: ["pipe", "pipe", "pipe"], timeout: 60000 }
    );
    
    // Cleanup
    try { fs.unlinkSync(concatList); } catch {}
  }
}

module.exports = {
  // Main unified function (supports premium)
  generateTTS,
  
  // Conversation mode (pre-mixed multi-speaker)
  generateConversationTTS,
  mixConversationTurns,
  
  // Lemonfox (default)
  generateAndAlign,
  generateSegmentTTS,
  getAudioDuration,
  calculateRequiredSpeed,
  createSpeakerVoiceMap,
  mergeOverlappingSegments,
  compressTranslation,
  postProcessSpeedAdjust, // For synced mode speed adjustment
  checkApiKey,
  checkProviderApiKey,
  
  // Voice configs
  VOICES,
  VOICE_POOL,
  SPANISH_NATIVE_VOICES,
  ENGLISH_VOICES,
  SPANISH_VOICE_LIMIT,
  SPEED_LIMITS,
  OUTPUT_MODES,
  TTS_CHARS_PER_SECOND,
  LANGUAGE_CODES,
  TTS_PROVIDERS,
  
  // ElevenLabs (premium) - re-export for direct access
  elevenlabs: {
    generateAndAlign: elevenlabs.generateAndAlign,
    generateSegmentTTS: elevenlabs.generateSegmentTTS,
    checkApiKey: elevenlabs.checkApiKey,
    VOICES: elevenlabs.VOICES,
    VOICE_PRESETS: elevenlabs.VOICE_PRESETS,
    ELEVENLABS_VOICES: elevenlabs.ELEVENLABS_VOICES,
    MODELS: elevenlabs.MODELS,
  },
};
