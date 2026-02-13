/**
 * Immersion v2 - ElevenLabs TTS Module (Premium)
 *
 * High-quality TTS using ElevenLabs API
 * Premium option with superior voice quality and naturalness
 *
 * Features:
 * - Multiple high-quality voices with Spanish support
 * - Adjustable stability, similarity, and style settings
 * - Support for multilingual v2 model (best for non-English)
 */

const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

const ELEVENLABS_API_KEY = process.env.ELEVENLABS_API_KEY;
const TTS_ENDPOINT = "https://api.elevenlabs.io/v1/text-to-speech";

/**
 * ElevenLabs voice IDs for multilingual support
 * Using voices optimized for Spanish/multilingual content
 */
const ELEVENLABS_VOICES = {
  // Custom/Premium voices
  meraki: "OKanSStS6li6xyU1WdXa", // Meraki - female, Indonesian
  veronica: "5N1BjZ10t6GcJUhZCP40", // Veronica - female, Spanish
  adaline: "5N1BjZ10t6GcJUhZCP40", // Adaline - female, English
  firman: "i8CJLmX03JoyL7Dl2LaT", // Firman - male, Indonesian
  bian: "1k39YpzqXZn52BgyLyGO", // Bian - male, Indonesian
  matt: "pwMBn0SsmN1220Aorv15", // Matt - male, custom
  
  // Multilingual voices (best for Spanish)
  rachel: "21m00Tcm4TlvDq8ikWAM", // Female - warm, conversational
  drew: "29vD33N1CtxCmqQRPOHJ", // Male - well-rounded
  clyde: "2EiwWnXFnvU5JabPnv8n", // Male - war veteran character
  paul: "5Q0t7uMcjvnagumLfvZi", // Male - ground reporter
  domi: "AZnzlk1XvdvUeBnXmlld", // Female - strong, assertive
  dave: "CYw3kZ02Hs0563khs1Fj", // Male - British conversational
  fin: "D38z5RcWu1voky8WS1ja", // Male - Irish sailor
  sarah: "EXAVITQu4vr4xnSDxMaL", // Female - soft, news reporter
  antoni: "ErXwobaYiN019PkySvjV", // Male - well-rounded
  thomas: "GBv7mTt0atIp3Br8iCZE", // Male - calm American
  charlie: "IKne3meq5aSn9XLyUdCD", // Male - casual Australian
  george: "JBFqnCBsd6RMkjVDRZzb", // Male - British raconteur
  emily: "LcfcDJNUP1GQjkzn1xUU", // Female - calm
  elli: "MF3mGyEYCl7XYWbV9V6O", // Female - emotional range
  callum: "N2lVS1w4EtoT3dr4eOWO", // Male - hoarse character
  patrick: "ODq5zmih8GrVes37Dizd", // Male - shouty character
  harry: "SOYHLrjzK2X1ezoPC6cr", // Male - anxious character
  liam: "TX3LPaxmHKxFdv7VOQHJ", // Male - articulate narrator
  dorothy: "ThT5KcBeYPX3keUQqHPh", // Female - pleasant British
  josh: "TxGEqnHWrfWFTfGW9XjX", // Male - deep, narrator
  arnold: "VR6AewLTigWG4xSOukaG", // Male - crisp narrator
  charlotte: "XB0fDUnXU5powFXDhCwa", // Female - Swedish seductive
  matilda: "XrExE9yKIg1WjnnlVkGX", // Female - warm, mature
  matthew: "Yko7PKs6WkxO6YstNZjv", // Male - audiobook narrator
  james: "ZQe5CZNOzWyzPSCn5a3c", // Male - calm Australian
  joseph: "Zlb1dXrM653N07WRdFW3", // Male - British narrator
  jessica: "cgSgspJ2msm6clMCkdW9", // Female - expressive American
  michael: "flq6f7yk4E4fJM5XTYuZ", // Male - audiobook narrator
  ethan: "g5CIjZEefAph4nQFvHAz", // Male - ASMR narrator
  gigi: "jBpfuIE2acCO8z3wKNLl", // Female - childish
  freya: "jsCqWAovK2LkecY7zXl4", // Female - German American
  grace: "oWAxZDx7w5VEj9dCyTzz", // Female - Southern American
  daniel: "onwK4e9ZLuTAKqWW03F9", // Male - deep British
  serena: "pMsXgVXv3BLzUgSXRplE", // Female - soft American
  adam: "pNInz6obpgDQGcFmaJgB", // Male - deep, narrator
  nicole: "piTKgcLEGmPE4e6mEKli", // Female - soft whisper
  glinda: "z9fAnlkpzviPz146aGWa", // Female - witch character
  giovanni: "zcAOhNBS3c14rBihAFp1", // Male - Italian foreigner
  mimi: "zrHiDhphv9ZnVXBqCLjz", // Female - childish Swedish
};

/**
 * Voice presets by gender and style for different languages
 */
const VOICE_PRESETS = {
  // Best voices for Spanish dubbed content
  spanish: {
    male: ["adam", "josh", "daniel", "matthew", "liam"],
    female: ["veronica", "rachel", "sarah", "matilda", "charlotte", "grace"],
    neutral: ["veronica", "adam", "rachel", "josh", "sarah"],
  },
  // Indonesian content
  indonesian: {
    male: ["firman", "bian", "adam", "josh", "daniel", "matthew", "liam"],
    female: ["meraki", "rachel", "sarah", "matilda", "charlotte"],
    neutral: ["firman", "meraki", "bian", "adam"],
  },
  // English content
  english: {
    male: ["adam", "josh", "daniel", "matthew", "liam"],
    female: ["adaline", "rachel", "sarah", "matilda", "charlotte", "grace"],
    neutral: ["adaline", "adam", "rachel", "josh", "sarah"],
  },
  // For narration/educational content
  narrator: {
    male: ["josh", "matthew", "arnold", "michael"],
    female: ["matilda", "sarah", "dorothy", "emily"],
  },
  // For conversational/casual content
  conversational: {
    male: ["drew", "dave", "charlie", "james"],
    female: ["rachel", "jessica", "freya", "serena"],
  },
};

/**
 * Default voices by gender (Spanish)
 */
const VOICES = {
  male: "adam",
  female: "veronica",
  neutral: "veronica",
};

/**
 * Language-specific default voices
 */
const LANGUAGE_VOICES = {
  spanish: { male: "adam", female: "veronica", neutral: "veronica" },
  indonesian: { male: "firman", female: "meraki", neutral: "firman" },
  english: { male: "adam", female: "adaline", neutral: "adaline" },
};

/**
 * ElevenLabs models
 */
const MODELS = {
  multilingual_v2: "eleven_multilingual_v2", // Best for non-English
  turbo_v2_5: "eleven_turbo_v2_5", // Fast, good quality
  multilingual_v1: "eleven_multilingual_v1", // Legacy
  english_v1: "eleven_monolingual_v1", // English only
};

/**
 * Default voice settings for natural Spanish speech
 */
const DEFAULT_VOICE_SETTINGS = {
  stability: 0.5, // 0-1, lower = more expressive/variable
  similarity_boost: 0.75, // 0-1, higher = more similar to original voice
  style: 0.0, // 0-1, higher = more exaggerated style (can sound less natural)
  use_speaker_boost: true, // Enhance voice clarity
};

/**
 * Speed-optimized settings for different modes
 */
const MODE_SETTINGS = {
  synced: {
    ...DEFAULT_VOICE_SETTINGS,
    stability: 0.6, // Slightly more consistent for lip-sync
  },
  learner: {
    ...DEFAULT_VOICE_SETTINGS,
    stability: 0.7, // More consistent for learning
    similarity_boost: 0.8,
  },
  narrator: {
    ...DEFAULT_VOICE_SETTINGS,
    stability: 0.65,
    style: 0.1, // Slight storytelling emphasis
  },
  brainrot: {
    ...DEFAULT_VOICE_SETTINGS,
    stability: 0.5,
    style: 0.2, // More engaging for TikTok style
  },
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
 * Adjust audio speed using ffmpeg atempo filter
 * For synced mode - ensures TTS fits time slots for perfect lip-sync
 * 
 * @param {string} inputPath - Input audio file
 * @param {string} outputPath - Output audio file  
 * @param {number} targetDuration - Desired duration in seconds
 * @param {number} currentDuration - Current audio duration
 * @param {object} options - Speed adjustment options
 * @returns {Promise<object>} Result with adjusted file path and duration
 */
async function adjustAudioSpeed(inputPath, outputPath, targetDuration, currentDuration, options = {}) {
  const {
    maxSpeedup = 1.4, // Max 40% speedup for natural sound
    maxSlowdown = 0.85, // Max 15% slowdown  
    tolerance = 0.1, // 10% tolerance before adjusting
  } = options;
  
  if (!currentDuration || currentDuration <= 0) {
    return { path: inputPath, duration: currentDuration, adjusted: false };
  }
  
  const ratio = currentDuration / targetDuration;
  
  // If within tolerance, don't adjust
  if (ratio >= (1 - tolerance) && ratio <= (1 + tolerance)) {
    return { path: inputPath, duration: currentDuration, adjusted: false };
  }
  
  // Calculate atempo (>1 = faster, <1 = slower)
  let atempo = ratio;
  
  // Clamp to natural-sounding range
  atempo = Math.max(maxSlowdown, Math.min(maxSpeedup, atempo));
  
  // Build atempo filter chain (atempo only accepts 0.5-2.0)
  let atempoFilters = [];
  let remaining = atempo;
  
  while (remaining > 2.0) {
    atempoFilters.push("atempo=2.0");
    remaining /= 2.0;
  }
  while (remaining < 0.5) {
    atempoFilters.push("atempo=0.5");
    remaining /= 0.5;
  }
  atempoFilters.push(`atempo=${remaining.toFixed(4)}`);
  
  const filterChain = atempoFilters.join(",");
  
  const cmd = `ffmpeg -y -i "${inputPath}" -filter:a "${filterChain}" "${outputPath}" 2>/dev/null`;
  
  try {
    execSync(cmd, { encoding: "utf-8", timeout: 30000 });
    const newDuration = getAudioDuration(outputPath);
    return { 
      path: outputPath, 
      duration: newDuration, 
      adjusted: true,
      originalDuration: currentDuration,
      atempo: atempo,
    };
  } catch (err) {
    console.log(`   ⚠️ Speed adjustment failed: ${err.message}`);
    return { path: inputPath, duration: currentDuration, adjusted: false };
  }
}

/**
 * Generate TTS for a single segment using ElevenLabs
 *
 * @param {string} text - Text to synthesize
 * @param {number} index - Segment index for filename
 * @param {string} outputDir - Output directory
 * @param {object} options - TTS options
 * @returns {Promise<object>} Result with file path and duration
 */
async function generateSegmentTTS(text, index, outputDir, options = {}) {
  const {
    voice = "adam",
    timeout = 60000,
    model = MODELS.multilingual_v2,
    voiceSettings = DEFAULT_VOICE_SETTINGS,
    outputFormat = "mp3_44100_128", // High quality MP3
  } = options;

  // Get voice ID (support both name and direct ID)
  const voiceId = ELEVENLABS_VOICES[voice] || voice;

  const fileName = `tts_${String(index).padStart(4, "0")}.mp3`;
  const filePath = path.join(outputDir, fileName);

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeout);

  try {
    const response = await fetch(`${TTS_ENDPOINT}/${voiceId}`, {
      method: "POST",
      headers: {
        "xi-api-key": ELEVENLABS_API_KEY,
        "Content-Type": "application/json",
        Accept: "audio/mpeg",
      },
      body: JSON.stringify({
        text: text,
        model_id: model,
        voice_settings: {
          stability: voiceSettings.stability,
          similarity_boost: voiceSettings.similarity_boost,
          style: voiceSettings.style,
          use_speaker_boost: voiceSettings.use_speaker_boost,
        },
        output_format: outputFormat,
      }),
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`ElevenLabs TTS failed: ${response.status} ${errorText}`);
    }

    const audioBuffer = Buffer.from(await response.arrayBuffer());
    fs.writeFileSync(filePath, audioBuffer);

    const duration = getAudioDuration(filePath);

    return {
      fileName,
      filePath,
      duration,
      size: audioBuffer.length,
      voice,
      model,
    };
  } catch (error) {
    clearTimeout(timeoutId);
    if (error.name === "AbortError") {
      throw new Error(`ElevenLabs TTS request timed out after ${timeout / 1000}s`);
    }
    throw error;
  }
}

/**
 * Create speaker-to-voice mapping for ElevenLabs
 *
 * @param {array} segments - Segments with speaker labels
 * @param {string} defaultGender - Default gender for voice selection
 * @param {object} speakerGenders - Per-speaker gender map
 * @param {string} language - Target language (spanish, indonesian, english)
 * @returns {object} Map of speaker ID to voice name
 */
function createSpeakerVoiceMap(segments, defaultGender = "neutral", speakerGenders = null, language = "spanish") {
  const speakers = [...new Set(segments.map((s) => s.speaker).filter(Boolean))];
  const numSpeakers = speakers.length;

  console.log(`   🎭 Creating ElevenLabs voice map for ${numSpeakers} speakers (${language})`);

  const usedVoices = new Set();
  const speakerVoiceMap = {};

  // Get language-specific voice presets
  const langPresets = VOICE_PRESETS[language.toLowerCase()] || VOICE_PRESETS.spanish;

  for (const speaker of speakers) {
    // Determine this speaker's gender
    let speakerGender = defaultGender;
    if (speakerGenders && speakerGenders[speaker]) {
      speakerGender = speakerGenders[speaker];
      console.log(`      ${speaker}: detected as ${speakerGender}`);
    }

    // Get voice pool for this gender
    const voicePool = langPresets[speakerGender] || langPresets.neutral;

    // Find an unused voice if possible
    let selectedVoice = voicePool[0];
    for (const voice of voicePool) {
      if (!usedVoices.has(voice)) {
        selectedVoice = voice;
        break;
      }
    }

    speakerVoiceMap[speaker] = selectedVoice;
    usedVoices.add(selectedVoice);
  }

  console.log(`   🎭 ElevenLabs speaker voice mapping:`);
  for (const [speaker, voice] of Object.entries(speakerVoiceMap)) {
    const gender = speakerGenders?.[speaker] || defaultGender;
    console.log(`      ${speaker} (${gender}) → ${voice} 🎙️`);
  }

  return speakerVoiceMap;
}

/**
 * Generate and align TTS for all segments using ElevenLabs
 *
 * @param {array} segments - Translated segments with timing info
 * @param {string} outputDir - Output directory
 * @param {object} options - TTS options
 * @returns {Promise<object>} Results with all generated audio
 */
async function generateAndAlign(segments, outputDir, options = {}) {
  const {
    voice = "adam",
    concurrency = 3, // ElevenLabs has strict rate limits
    minDuration = 0.3,
    multiSpeaker = true,
    defaultGender = "neutral",
    speakerGenders = null,
    speakerVoices = null, // Pre-assigned speaker-to-voice map (overrides auto)
    mode = "synced",
    model = MODELS.multilingual_v2,
    language = "spanish",
  } = options;

  const modeSettings = MODE_SETTINGS[mode] || MODE_SETTINGS.synced;

  console.log(`\n${"═".repeat(60)}`);
  console.log(`🎙️ ELEVENLABS TTS: Premium Audio Generation (Mode: ${mode.toUpperCase()})`);
  console.log(`${"═".repeat(60)}`);

  if (!ELEVENLABS_API_KEY) {
    throw new Error(
      "ELEVENLABS_API_KEY not set!\n" +
        "Add to .env: ELEVENLABS_API_KEY=your_key_here\n" +
        "Get your API key at: https://elevenlabs.io/app/settings/api-keys"
    );
  }

  // Create output dir
  const ttsDir = path.join(outputDir, "tts_elevenlabs");
  fs.mkdirSync(ttsDir, { recursive: true });

  // Create speaker-to-voice mapping
  let speakerVoiceMap = null;
  const uniqueSpeakers = [...new Set(segments.map((s) => s.speaker).filter(Boolean))];

  // Select default voice based on language if not explicitly provided
  const langPresets = VOICE_PRESETS[language.toLowerCase()] || VOICE_PRESETS.spanish;
  const langDefaultVoice = langPresets[defaultGender]?.[0] || langPresets.neutral?.[0] || voice;
  const effectiveVoice = voice === "adam" ? langDefaultVoice : voice; // Only override if using default

  if (speakerVoices) {
    // Use pre-assigned speaker-voice mapping
    speakerVoiceMap = speakerVoices;
    console.log(`   🎭 Using pre-assigned speaker voices:`);
    for (const [speaker, v] of Object.entries(speakerVoiceMap)) {
      console.log(`      ${speaker} → ${v}`);
    }
  } else if (multiSpeaker && uniqueSpeakers.length > 1) {
    speakerVoiceMap = createSpeakerVoiceMap(segments, defaultGender, speakerGenders, language);
  } else if (uniqueSpeakers.length === 1) {
    // Single speaker - use language-appropriate voice
    speakerVoiceMap = { [uniqueSpeakers[0]]: effectiveVoice };
    console.log(`   🎭 Single speaker using ${language} voice: ${effectiveVoice}`);
  }

  console.log(`   Segments: ${segments.length}`);
  console.log(`   Speakers: ${uniqueSpeakers.length} (${uniqueSpeakers.join(", ") || "none"})`);
  console.log(`   Language: ${language}`);
  console.log(`   Default voice: ${effectiveVoice}`);
  console.log(`   Model: ${model}`);
  console.log(`   Concurrency: ${concurrency}`);
  console.log(`   Output: ${ttsDir}`);

  const startTime = Date.now();
  const results = [];
  let successCount = 0;

  // Estimate cost
  const totalChars = segments.reduce(
    (sum, s) => sum + (s.translatedText || "").length,
    0
  );
  console.log(`   Total characters: ${totalChars}`);
  console.log(`   Estimated credits: ~${totalChars} (1 credit per character)`);

  // Process in batches
  const totalBatches = Math.ceil(segments.length / concurrency);

  for (let i = 0; i < segments.length; i += concurrency) {
    const batch = segments.slice(i, i + concurrency);
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

          const textToSpeak = seg.translatedText;
          if (!textToSpeak || textToSpeak.trim().length === 0) {
            return {
              index: seg.index,
              skipped: true,
              reason: "no text",
            };
          }

          // Get voice for this speaker
          const segmentVoice =
            speakerVoiceMap && seg.speaker
              ? speakerVoiceMap[seg.speaker] || voice
              : voice;

          const ttsResult = await generateSegmentTTS(
            textToSpeak,
            seg.index,
            ttsDir,
            {
              voice: segmentVoice,
              model,
              voiceSettings: modeSettings,
            }
          );

          successCount++;
          
          // SYNCED MODE: Adjust speed to fit time slot for perfect sync
          let finalFilePath = ttsResult.filePath;
          let finalDuration = ttsResult.duration;
          let speedAdjusted = false;
          let atempoUsed = null;
          
          if (mode === "synced" && seg.duration && ttsResult.duration) {
            const slotDuration = seg.duration;
            const rawDuration = ttsResult.duration;
            const ratio = rawDuration / slotDuration;
            
            // If TTS is more than 10% off from slot, adjust speed
            if (ratio > 1.1 || ratio < 0.9) {
              const adjustedPath = ttsResult.filePath.replace(/\.mp3$/, "_synced.mp3");
              const adjustResult = await adjustAudioSpeed(
                ttsResult.filePath,
                adjustedPath,
                slotDuration,
                rawDuration,
                { maxSpeedup: 1.4, maxSlowdown: 0.85, tolerance: 0.1 }
              );
              
              if (adjustResult.adjusted) {
                finalFilePath = adjustResult.path;
                finalDuration = adjustResult.duration;
                speedAdjusted = true;
                atempoUsed = adjustResult.atempo;
              }
            }
          }

          return {
            index: seg.index,
            start: seg.start,
            end: seg.end,
            targetDuration: seg.duration,
            actualDuration: ttsResult.duration,
            ttsFile: ttsResult.filePath,
            alignedFile: finalFilePath,
            alignedDuration: finalDuration,
            originalText: seg.originalText || seg.text,
            translatedText: textToSpeak,
            speaker: seg.speaker,
            voice: segmentVoice,
            model: ttsResult.model,
            speedAdjusted,
            atempoUsed,
          };
        } catch (error) {
          console.error(`\n   ❌ Segment ${seg.index} failed: ${error.message}`);
          return {
            index: seg.index,
            error: error.message,
          };
        }
      })
    );

    results.push(...batchResults);

    // Add delay between batches to respect rate limits
    if (i + concurrency < segments.length) {
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
  }

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  const skipped = results.filter((r) => r.skipped).length;
  const failed = results.filter((r) => r.error).length;
  const speedAdjustedCount = results.filter((r) => r.speedAdjusted).length;

  console.log(`\n\n   ✅ ELEVENLABS TTS COMPLETE in ${elapsed}s`);
  console.log(`   📊 Generated: ${successCount}/${segments.length}`);
  if (speedAdjustedCount > 0) {
    console.log(`   🎚️ Speed-adjusted: ${speedAdjustedCount} segments (synced mode)`);
  }
  console.log(`   ⏭️  Skipped: ${skipped}`);
  console.log(`   ❌ Failed: ${failed}`);

  return {
    outputDir,
    ttsDir,
    alignedDir: ttsDir,
    segments: results,
    mode,
    provider: "elevenlabs",
    model,
    stats: {
      total: segments.length,
      success: successCount,
      speedAdjusted: speedAdjustedCount,
      skipped,
      failed,
    },
    processingTime: parseFloat(elapsed),
  };
}

/**
 * Check if ElevenLabs API key is set
 */
function checkApiKey() {
  return !!ELEVENLABS_API_KEY;
}

/**
 * Get available voices for a gender
 */
function getVoicesForGender(gender, style = "spanish") {
  const presets = VOICE_PRESETS[style] || VOICE_PRESETS.spanish;
  return presets[gender] || presets.neutral;
}

module.exports = {
  generateAndAlign,
  generateSegmentTTS,
  createSpeakerVoiceMap,
  adjustAudioSpeed,
  getAudioDuration,
  checkApiKey,
  getVoicesForGender,
  VOICES,
  VOICE_PRESETS,
  ELEVENLABS_VOICES,
  LANGUAGE_VOICES,
  MODELS,
  DEFAULT_VOICE_SETTINGS,
  MODE_SETTINGS,
};
