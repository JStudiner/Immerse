/**
 * Immersion v2 - Translate Module (Gemini)
 *
 * Translates transcribed segments from English to Spanish
 * Uses Google Gemini 2.5 Flash for fast, accurate translation
 *
 * Features:
 * - CEFR level-based simplification (A1-C1)
 * - DURATION-AWARE translation (produces text that fits time slot naturally)
 * - Batch processing for efficiency
 * - Speaker-aware context preservation
 */

const { GoogleGenerativeAI } = require("@google/generative-ai");
const fs = require("fs");
const path = require("path");

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

/**
 * Attempt to repair truncated/malformed JSON from Gemini
 * This handles cases where Gemini cuts off mid-response
 */
function repairTruncatedJSON(jsonStr) {
  // Track if we need to close brackets/braces
  let needsClosingBracket = 0;
  let needsClosingBrace = 0;
  let inString = false;
  let prevChar = '';
  
  for (const char of jsonStr) {
    if (char === '"' && prevChar !== '\\') {
      inString = !inString;
    } else if (!inString) {
      if (char === '[') needsClosingBracket++;
      else if (char === ']') needsClosingBracket--;
      else if (char === '{') needsClosingBrace++;
      else if (char === '}') needsClosingBrace--;
    }
    prevChar = char;
  }
  
  let repaired = jsonStr;
  
  // If we're inside a string, close it
  if (inString) {
    repaired += '"';
  }
  
  // Close any open braces
  for (let i = 0; i < needsClosingBrace; i++) {
    repaired += '}';
  }
  
  // Close any open brackets
  for (let i = 0; i < needsClosingBracket; i++) {
    repaired += ']';
  }
  
  return repaired;
}

/**
 * Safe JSON parse with repair attempt
 */
function safeJSONParse(jsonStr, context = '') {
  // First try normal parse
  try {
    return JSON.parse(jsonStr);
  } catch (originalError) {
    // Try to repair truncated JSON
    console.log(`      ⚠️ JSON parse failed, attempting repair...`);
    
    try {
      const repaired = repairTruncatedJSON(jsonStr);
      const result = JSON.parse(repaired);
      console.log(`      ✅ JSON repair successful!`);
      return result;
    } catch (repairError) {
      // Try extracting just the array portion
      const arrayMatch = jsonStr.match(/\[\s*\{[\s\S]*?\}\s*(?:,\s*\{[\s\S]*?\}\s*)*\]/);
      if (arrayMatch) {
        try {
          const result = JSON.parse(arrayMatch[0]);
          console.log(`      ✅ Extracted partial JSON array (${result.length} items)`);
          return result;
        } catch (e) {
          // Fall through
        }
      }
      
      // Re-throw original error with more context
      throw new Error(`${originalError.message} (repair failed: ${repairError.message})`);
    }
  }
}

/**
 * TTS speaking rate calibration per language
 * Based on Lemonfox TTS at speed 1.0
 * These values are used to calculate target text length
 * 
 * ⚠️ IMPORTANT: XTTS voice cloning speaks at natural human rate (~13-15 c/s).
 * It does NOT have a "speed" setting - it generates what it thinks is natural.
 * Target ~14 chars/sec, then handle timing with silence padding or gentle atempo.
 */
const TTS_RATES = {
  spanish: {
    code: "es",
    charsPerSecond: 14.2,  // Lemonfox preset voices (~14 c/s)
    wordsPerSecond: 2.5,
    minSpeed: 0.60,
    maxSpeed: 1.25,  // Allow 25% over target - TTS speedup (1.35x max) handles timing
                     // Complete sentences > perfect duration match
  },
  indonesian: {
    code: "id",
    charsPerSecond: 13.0,   // Lemonfox preset voices
    wordsPerSecond: 2.0,
    minSpeed: 0.60,
    maxSpeed: 1.25,  // Allow 25% over target - TTS speedup handles timing
                     // Complete sentences > perfect duration match
  },
};

// Default for backwards compatibility
const SPANISH_TTS_RATE = TTS_RATES.spanish;

// XTTS-specific rate - use this when --clone flag is set
// XTTS naturally speaks at ~13-15 chars/sec (similar to human speech)
// It doesn't have a "speed" knob - it generates natural-sounding audio
// Strategy: give it ~14 c/s of text, then handle timing with:
//   - ±10% off: use as-is (perfect)
//   - Too short: pad with silence (sounds natural)
//   - Too long: gentle atempo up to 1.5x (barely noticeable)
const XTTS_TTS_RATE = {
  charsPerSecond: 14.0,  // Target: natural XTTS speaking rate
  minSpeed: 0.85,        // Allow translations down to 85% of target
  maxSpeed: 1.20,        // Allow translations up to 120% of target
                         // XTTS generates at ~7 c/s, atempo 1.75x handles the rest
                         // Was 1.10 which truncated translations unnecessarily
};

/**
 * CEFR level guides for translation complexity
 * 
 * For "narrator" mode, each level has:
 * - ttsSpeed: TTS speed multiplier (lower = slower speech)
 * - targetFillRate: How much of the time slot to fill with speech (0.80 = 80%)
 * - narratorStyle: How to narrate (guides content simplification vs expansion)
 * 
 * KEY INSIGHT: At lower levels, we speak SLOWER but need to FILL THE TIME.
 * This means using MORE simple words, not fewer! Repetition, explanation, etc.
 */
const LEVEL_GUIDES = {
  A1: {
    name: "Superbeginner",
    vocab: "Only the 500 most common words",
    grammar: 'Present tense only. No subjunctive. "Yo tengo", "Él va".',
    style: "Extremely simple. Short sentences (5-8 words). Repeat key words.",
    // Narrator mode settings - FILL TIME with simple words
    ttsSpeed: 0.70,        // Very slow for beginners
    targetFillRate: 0.80,  // Fill 80% of time with speech
    narratorStyle: "Use MANY simple words to explain. Repeat important ideas. Add helpful context. Short sentences but MORE of them.",
  },
  A2: {
    name: "Beginner",
    vocab: "Top 1500 common words",
    grammar:
      "Present tense, simple past (pretérito). Basic connectors (y, pero, porque).",
    style:
      "Simple sentences. 5-8 words each. Clear and direct.",
    ttsSpeed: 0.85,
    targetFillRate: 0.80,  // 80% fill - natural pacing with some breathing room
    narratorStyle: "Simple but complete narration. Use basic words to explain clearly.",
  },
  B1: {
    name: "Intermediate",
    vocab: "Top 3000 words. Can use some technical terms if explained.",
    grammar: "All indicative tenses. Simple subjunctive in common phrases.",
    style: "Clear sentences with good detail. 8-12 word sentences.",
    ttsSpeed: 1.0,  // Full speed - let XTTS handle it naturally
    targetFillRate: 0.85,  // 85% fill - natural narration with some breathing room
    narratorStyle: "Detailed narration. Include important context.",
  },
  B2: {
    name: "Upper Intermediate",
    vocab: "Wide vocabulary. Technical terms okay with brief context.",
    grammar: "Full grammar including subjunctive, conditionals.",
    style: "Natural flow. Rich detail. 10-15 word sentences.",
    ttsSpeed: 1.0,  // Full speed
    targetFillRate: 0.85,  // 85% fill - detailed narration
    narratorStyle: "Rich narration with full context.",
  },
  C1: {
    name: "Advanced",
    vocab: "Full vocabulary including idioms and colloquialisms.",
    grammar: "Complete grammar. Regional variations okay.",
    style: "Natural native speech. Complex sentences with nuance.",
    ttsSpeed: 1.0,  // Full speed
    targetFillRate: 0.85,  // 85% fill
    narratorStyle: "Full meaning, minimal words.",
  },
};

/**
 * Calculate target character count for a segment duration
 * This is the key to duration-aware translation
 */
function calculateTargetLength(durationSeconds, ttsRate = SPANISH_TTS_RATE) {
  // Target chars at base TTS speed (1.0)
  const baseChars = Math.round(durationSeconds * ttsRate.charsPerSecond);

  // Allow some flexibility (TTS speed can adjust ±15%)
  const minChars = Math.round(baseChars * ttsRate.minSpeed);
  const maxChars = Math.round(baseChars * ttsRate.maxSpeed);

  return { target: baseChars, min: minChars, max: maxChars };
}

/**
 * Build system prompt for duration-aware translation
 * OPTIMIZED: Shorter prompt = faster API response
 */
function buildSystemPrompt(level, targetLanguage = "Spanish") {
  const guide = LEVEL_GUIDES[level] || LEVEL_GUIDES.B1;

  return `Translate English to ${targetLanguage} for ${level} learners.

CRITICAL RULES:
1. Match targetChars (±15%) - this controls audio duration
2. IMPORTANT: ${targetLanguage} uses ~20% more syllables than English. To ensure the dub remains comprehensible, your translation MUST be 15-20% shorter in character count than the English source. Be CONCISE — convey the same meaning in fewer words.
3. Translate DIRECTLY - do NOT add explanations, context, or extra content
4. If text mentions a game/movie/reference, just translate the name, don't explain what it is
5. Keep same meaning and tone, just in ${targetLanguage}
6. Vocabulary: ${guide.vocab}
7. Style: ${guide.style}

Return JSON: [{"idx": N, "spanish": "...", "chars": N}, ...]`;
}

/**
 * CONTINUOUS NARRATOR MODE: Merge segments into large blocks and translate as a whole
 * This creates the "YouTube dubbed video" effect - constant talking, no gaps
 * 
 * @param {array} segments - Transcription segments  
 * @param {object} options - Translation options
 * @returns {Promise<array>} Array of block translations
 */
async function translateNarratorContinuous(segments, options = {}) {
  const {
    level = "B1",
    targetLanguage = "spanish",
    blockDurationTarget = 20, // Shorter blocks (20s) for tighter visual sync
    thirdPerson = true,
    isXTTS = false, // When true, use slower XTTS rate for shorter translations
  } = options;

  const guide = LEVEL_GUIDES[level] || LEVEL_GUIDES.B1;
  // XTTS speaks much slower, so use shorter translations
  const ttsRate = isXTTS 
    ? XTTS_TTS_RATE 
    : (TTS_RATES[targetLanguage.toLowerCase()] || TTS_RATES.spanish);
  const langDisplay = targetLanguage.charAt(0).toUpperCase() + targetLanguage.slice(1);

  console.log(`\n${"═".repeat(60)}`);
  console.log(`🎙️ CONTINUOUS NARRATOR MODE: ${langDisplay}`);
  console.log(`${"═".repeat(60)}`);
  console.log(`   Level: ${level} (${guide.name})`);
  console.log(`   Style: Third-person continuous narration`);
  console.log(`   Block target: ~${blockDurationTarget}s each (tighter visual sync)`);
  console.log(`   Input segments: ${segments.length}`);
  console.log(`   TTS rate: ${ttsRate.charsPerSecond} chars/sec${isXTTS ? " (XTTS - uses atempo to fit timing)" : ""}`);

  // Step 1: Merge segments into blocks that follow original talking pattern
  // Use natural pauses (>1s gaps) to create block boundaries
  // This keeps narration synced to when people were actually talking
  const blocks = [];
  let currentBlock = {
    segments: [],
    text: "",
    start: null,
    end: null,
    duration: 0,
  };

  for (const seg of segments) {
    // Skip very short segments (< 0.5s) or empty text
    if (!seg.text || seg.text.trim().length < 3 || (seg.end - seg.start) < 0.5) {
      continue;
    }

    if (currentBlock.start === null) {
      currentBlock.start = seg.start;
    }

    // Add segment to current block
    currentBlock.segments.push(seg);
    currentBlock.text += (currentBlock.text ? " " : "") + seg.text.trim();
    currentBlock.end = seg.end;
    currentBlock.duration = currentBlock.end - currentBlock.start;

    // Check if we should end this block
    const nextSeg = segments[segments.indexOf(seg) + 1];
    const gapToNext = nextSeg ? (nextSeg.start - seg.end) : Infinity;
    
    // Create block boundary if:
    // 1. Natural pause (>1s gap) AND block is at least 10s long
    // 2. Block reached target duration
    // 3. No next segment
    const hasNaturalPause = gapToNext > 1.0; // 1s+ gap = natural pause
    const isMinimumLength = currentBlock.duration >= 10; // At least 10s
    const reachedTarget = currentBlock.duration >= blockDurationTarget;
    const isLast = !nextSeg;
    
    if ((hasNaturalPause && isMinimumLength) || reachedTarget || isLast) {
      if (currentBlock.text.trim()) {
        blocks.push({ ...currentBlock, index: blocks.length, gapAfter: gapToNext === Infinity ? 0 : gapToNext });
      }
      currentBlock = { segments: [], text: "", start: null, end: null, duration: 0 };
    }
  }

  console.log(`   Merged into ${blocks.length} blocks (avg ${(segments.reduce((a, s) => a + (s.end - s.start), 0) / blocks.length).toFixed(1)}s each)`);

  if (!process.env.GEMINI_API_KEY) {
    throw new Error("GEMINI_API_KEY not set!");
  }

  const model = genAI.getGenerativeModel({
    model: "gemini-2.0-flash",
    generationConfig: {
      temperature: 0.3,
      maxOutputTokens: 8192,
      responseMimeType: "application/json",
    },
  });

  // Build system prompt for continuous narration
  const systemPrompt = `You are a professional ${langDisplay} narrator dubbing a video for ${level} language learners.

YOUR TASK: Create smooth, continuous ${langDisplay} narration that matches the original speech duration.

NARRATION STYLE:
- Third person: "He explains that...", "They discuss...", "The speaker mentions..."
- Describe what's happening on screen at that moment
- ${guide.vocab}
- ${guide.grammar}
- IMPORTANT: ${langDisplay} uses ~20% more syllables than English. Keep narration CONCISE — 15-20% shorter in character count than the English source to avoid speed-up artifacts.
- Fill 85-95% of the available time with natural narration

CHARACTER TARGETS:
- Each block has a TARGET (targetChars) - AIM for 90-100% of this
- At ${level} level, TTS speaks at ~${ttsRate.charsPerSecond} chars/second
- maxChars is the absolute limit - NEVER exceed it
- Get close to targetChars, but prioritize natural-sounding sentences

GOAL: Natural, engaging narration that matches the video's pace.

Return JSON array: [{"idx": 0, "spanish": "narration text...", "chars": 123}, ...]`;

  const startTime = Date.now();
  const results = [];

  // Process blocks (can do in parallel for speed)
  const batchSize = 3; // Process 3 blocks at a time
  for (let i = 0; i < blocks.length; i += batchSize) {
    const batchBlocks = blocks.slice(i, i + batchSize);
    
    await Promise.all(batchBlocks.map(async (block) => {
      // Calculate target chars for this block's duration
      // PERFECTION MODE: Match original speech time!
      // Target: 95% (with correct 13.5 c/s rate, this should fill properly)
      // Max: 105% (allow slight overrun, adaptive retry will fix)
      const effectiveSpeed = guide.ttsSpeed || 0.85;
      const fillRate = 0.95; // Target 95% to actually get ~90-95% fill
      const targetChars = Math.round(block.duration * ttsRate.charsPerSecond * effectiveSpeed * fillRate);
      const maxChars = Math.round(block.duration * ttsRate.charsPerSecond * effectiveSpeed * 1.05); // Allow 105%, retry fixes overlaps
      
      const userPrompt = `Translate this block into continuous ${langDisplay} narration.

Block ${block.index + 1}/${blocks.length}:
- Duration: ${block.duration.toFixed(1)} seconds
- Target: ${targetChars} chars (aim for 90-100% of this!)
- MAX: ${maxChars} chars (absolute limit)
- Original text: "${block.text}"

Create detailed third-person narration. Fill most of the time - aim close to ${targetChars} chars!`;

      for (let attempt = 1; attempt <= 3; attempt++) {
        try {
          const result = await model.generateContent([
            { text: systemPrompt },
            { text: userPrompt },
          ]);

          const responseText = result.response.text().trim();
          let jsonStr = responseText;
          if (responseText.includes("```")) {
            const match = responseText.match(/```(?:json)?\s*([\s\S]*?)```/);
            if (match) jsonStr = match[1].trim();
          }

          const parsed = JSON.parse(jsonStr);
          const blockResult = Array.isArray(parsed) ? parsed[0] : parsed;
          
          let translatedText = blockResult.spanish || blockResult.translation || "";
          const originalChars = translatedText.length;
          
          // FORCE truncate if exceeds maxChars (Gemini often ignores our limit!)
          if (translatedText.length > maxChars) {
            // Truncate at last complete word before maxChars
            let truncated = translatedText.substring(0, maxChars);
            const lastSpace = truncated.lastIndexOf(' ');
            const lastPunctuation = Math.max(
              truncated.lastIndexOf('.'),
              truncated.lastIndexOf('!'),
              truncated.lastIndexOf('?')
            );
            
            // Use punctuation if within last 20%, otherwise use last space
            if (lastPunctuation > maxChars * 0.8) {
              truncated = truncated.substring(0, lastPunctuation + 1);
            } else if (lastSpace > maxChars * 0.7) {
              truncated = truncated.substring(0, lastSpace);
            }
            
            translatedText = truncated;
            console.log(`   ⚠️ Block ${block.index + 1}: Truncated ${originalChars} → ${translatedText.length} chars (max: ${maxChars})`);
          }
          
          results[block.index] = {
            index: block.index,
            start: block.start,
            end: block.end,
            duration: block.duration,
            originalText: block.text,
            translatedText,
            chars: translatedText.length,
            targetChars,
            maxChars,
            wasExceeded: originalChars > maxChars,
            segmentCount: block.segments.length,
            isNarratorBlock: true,
          };
          
          console.log(`   ✅ Block ${block.index + 1}: ${block.duration.toFixed(1)}s → ${translatedText.length} chars (target: ${targetChars}, max: ${maxChars})`);
          break;
        } catch (error) {
          if (attempt === 3) {
            console.error(`   ❌ Block ${block.index + 1} failed: ${error.message}`);
            results[block.index] = {
              index: block.index,
              start: block.start,
              end: block.end,
              duration: block.duration,
              translatedText: "[Error]",
              error: true,
            };
          }
        }
      }
    }));
    
    console.log(`   Progress: ${Math.min(i + batchSize, blocks.length)}/${blocks.length} blocks`);
  }

  const validResults = results.filter(r => r && !r.error);
  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  
  console.log(`\n   ✅ Continuous narration complete in ${elapsed}s`);
  console.log(`   📊 ${validResults.length}/${blocks.length} blocks translated`);
  console.log(`   ⏱️ Total narration time: ${validResults.reduce((a, r) => a + r.duration, 0).toFixed(1)}s`);
  
  // Calculate fill rate
  const totalTargetChars = validResults.reduce((a, r) => a + r.targetChars, 0);
  const totalActualChars = validResults.reduce((a, r) => a + r.chars, 0);
  const totalMaxChars = validResults.reduce((a, r) => a + r.maxChars, 0);
  const truncatedCount = validResults.filter(r => r.wasExceeded).length;
  
  console.log(`   📝 Characters: ${totalActualChars} / ${totalTargetChars} target / ${totalMaxChars} max`);
  console.log(`   📊 Fill rate: ${((totalActualChars / totalMaxChars) * 100).toFixed(0)}% of max capacity`);
  
  if (truncatedCount > 0) {
    console.log(`   ✂️ Truncated ${truncatedCount}/${validResults.length} blocks that exceeded limits`);
  }

  return validResults;
}

/**
 * Translate from character's perspective (1st person POV)
 * Shifts pronouns based on who's in the scene:
 * - Character's scenes: First person ("I crashed", "I decided")
 * - Others' scenes: Third person ("Kate found", "Locke believed")
 * - Group scenes: First person plural ("We survived", "We fought")
 */
async function translateCharacterPerspective(segments, options = {}) {
  const {
    level = "B1",
    targetLanguage = "spanish",
    characterName = "the protagonist",
    characterTraits = "",
    blockDurationTarget = 20,
  } = options;
  
  const guide = LEVEL_GUIDES[level] || LEVEL_GUIDES.B1;
  const ttsRate = TTS_RATES[targetLanguage.toLowerCase()] || SPANISH_TTS_RATE;
  const langDisplay = targetLanguage.charAt(0).toUpperCase() + targetLanguage.slice(1);
  
  console.log(`\n════════════════════════════════════════════════════════════`);
  console.log(`🎭 CHARACTER PERSPECTIVE: ${characterName}'s POV`);
  console.log(`════════════════════════════════════════════════════════════`);
  console.log(`   Level: ${level} (${guide.name})`);
  console.log(`   Language: ${langDisplay}`);
  console.log(`   Character: ${characterName}`);
  console.log(`   TTS rate: ${ttsRate.charsPerSecond} chars/sec`);
  
  // Merge segments into blocks (similar to narrator continuous)
  const blocks = [];
  let currentBlock = null;
  const minBlockDuration = 10;
  const maxBlockDuration = 30;
  
  for (const seg of segments) {
    const segDuration = seg.end - seg.start;
    
    if (!currentBlock) {
      currentBlock = {
        start: seg.start,
        end: seg.end,
        duration: segDuration,
        text: seg.text,
        segments: [seg],
      };
    } else {
      const gap = seg.start - currentBlock.end;
      const potentialDuration = seg.end - currentBlock.start;
      
      // Merge if gap is small and duration reasonable
      if (gap < 1.0 && potentialDuration < maxBlockDuration) {
        currentBlock.end = seg.end;
        currentBlock.duration = potentialDuration;
        currentBlock.text += " " + seg.text;
        currentBlock.segments.push(seg);
      } else {
        // Only save if meets minimum duration
        if (currentBlock.duration >= minBlockDuration || currentBlock.segments.length >= 3) {
          blocks.push(currentBlock);
        }
        currentBlock = {
          start: seg.start,
          end: seg.end,
          duration: segDuration,
          text: seg.text,
          segments: [seg],
        };
      }
    }
  }
  
  if (currentBlock && (currentBlock.duration >= minBlockDuration || currentBlock.segments.length >= 3)) {
    blocks.push(currentBlock);
  }
  
  console.log(`   📦 Created ${blocks.length} narration blocks`);
  console.log(`   ⏱️ Total time: ${blocks.reduce((a, b) => a + b.duration, 0).toFixed(1)}s\n`);
  
  // Prepare Gemini model
  const model = genAI.getGenerativeModel({
    model: "gemini-2.0-flash",
    generationConfig: {
      temperature: 0.3,
      maxOutputTokens: 8192,
      responseMimeType: "application/json",
    },
  });
  
  // Build character-specific system prompt
  const characterInfo = characterTraits ? `\n\nCHARACTER TRAITS: ${characterTraits}` : "";
  
  const systemPrompt = `You are ${characterName} narrating events from your perspective in ${langDisplay}.

YOUR ROLE: Translate the original narration into ${characterName}'s first-person POV.

PERSPECTIVE RULES:
1. Scenes about YOU (${characterName}): First person
   - "Jack crashed" → "I crashed" / "Yo me estrellé"
   - "Jack made a decision" → "I made a decision" / "Tomé una decisión"

2. Scenes about OTHERS: Third person
   - "Kate found the hatch" → "Kate found the hatch" / "Kate encontró la escotilla"
   - "Locke believed in destiny" → "Locke believed in destiny" / "Locke creía en el destino"

3. GROUP scenes (with you): First person plural
   - "The survivors built shelter" → "We built shelter" / "Construimos un refugio"
   - "They fought the Others" → "We fought the Others" / "Luchamos contra los Otros"

LANGUAGE LEVEL: ${level} - ${guide.vocab}
- ${guide.grammar}
${characterInfo}

TIMING:
- At ${level}, TTS speaks at ~${ttsRate.charsPerSecond} chars/second
- Target 95% of available time (fillRate: 0.95)
- maxChars is absolute limit - NEVER exceed it

GOAL: Natural ${langDisplay} narration from ${characterName}'s perspective.

Return JSON: [{"idx": 0, "${targetLanguage}": "narration...", "chars": 123}, ...]`;
  
  const results = [];
  const batchSize = 3;
  
  for (let i = 0; i < blocks.length; i += batchSize) {
    const batchBlocks = blocks.slice(i, i + batchSize);
    
    await Promise.all(batchBlocks.map(async (block, batchIdx) => {
      const blockIndex = i + batchIdx;
      const effectiveSpeed = guide.ttsSpeed || 0.85;
      const fillRate = 0.95;
      const targetChars = Math.round(block.duration * ttsRate.charsPerSecond * effectiveSpeed * fillRate);
      const maxChars = Math.round(block.duration * ttsRate.charsPerSecond * effectiveSpeed * 1.05);
      
      const userPrompt = `Translate this block from ${characterName}'s perspective.

Block ${blockIndex + 1}/${blocks.length}:
- Duration: ${block.duration.toFixed(1)} seconds
- Target: ${targetChars} chars (aim for 90-100%)
- MAX: ${maxChars} chars (absolute limit)
- Original: "${block.text}"

Think about who's in this scene:
- Is it about ${characterName}? Use "I" / "yo"
- Is it about others? Use their names / "he/she/they"
- Is it a group scene with ${characterName}? Use "we" / "nosotros"

Create ${langDisplay} narration from ${characterName}'s POV. Aim for ${targetChars} chars!`;
      
      for (let attempt = 1; attempt <= 3; attempt++) {
        try {
          const result = await model.generateContent([
            { text: systemPrompt },
            { text: userPrompt },
          ]);
          
          const responseText = result.response.text().trim();
          let jsonStr = responseText;
          if (responseText.includes("```")) {
            const match = responseText.match(/```(?:json)?\s*([\s\S]*?)```/);
            if (match) jsonStr = match[1].trim();
          }
          
          const parsed = JSON.parse(jsonStr);
          const blockResult = Array.isArray(parsed) ? parsed[0] : parsed;
          
          let translatedText = blockResult[targetLanguage] || blockResult.spanish || blockResult.translation || "";
          const originalChars = translatedText.length;
          
          // Force truncate if exceeds maxChars
          let wasExceeded = false;
          if (translatedText.length > maxChars) {
            wasExceeded = true;
            const sentences = translatedText.match(/[^.!?]+[.!?]+/g) || [translatedText];
            let truncated = "";
            for (const sentence of sentences) {
              if ((truncated + sentence).length <= maxChars) {
                truncated += sentence;
              } else {
                break;
              }
            }
            
            if (!truncated || truncated.length < maxChars * 0.6) {
              const words = translatedText.split(/\s+/);
              truncated = "";
              for (const word of words) {
                if ((truncated + " " + word).length <= maxChars) {
                  truncated += (truncated ? " " : "") + word;
                } else {
                  break;
                }
              }
            }
            
            translatedText = truncated;
          }
          
          results.push({
            index: blockIndex,
            start: block.start,
            end: block.end,
            duration: block.duration,
            originalText: block.text,
            translatedText,
            chars: translatedText.length,
            targetChars,
            maxChars,
            wasExceeded,
            characterPerspective: true,
          });
          
          break;
        } catch (error) {
          if (attempt === 3) {
            console.log(`      ⚠️ Block ${blockIndex} failed after 3 attempts: ${error.message}`);
          }
        }
      }
    }));
  }
  
  // Sort by index
  results.sort((a, b) => a.index - b.index);
  
  const validResults = results.filter(r => r.translatedText && r.translatedText.length > 0);
  
  console.log(`\n   ✅ CHARACTER PERSPECTIVE COMPLETE`);
  console.log(`   📊 ${validResults.length}/${blocks.length} blocks translated`);
  console.log(`   🎭 Narrated from ${characterName}'s POV`);
  
  const truncatedCount = validResults.filter(r => r.wasExceeded).length;
  if (truncatedCount > 0) {
    console.log(`   ✂️ Truncated ${truncatedCount}/${validResults.length} blocks`);
  }
  
  return validResults;
}

/**
 * Build system prompt for NARRATOR mode
 * Uses TIME-FILLING approach: slower speech but MORE simple words to fill the slot
 */
function buildNarratorPrompt(level, targetLanguage = "Spanish", options = {}) {
  const { thirdPerson = false } = options;
  const guide = LEVEL_GUIDES[level] || LEVEL_GUIDES.B1;

  // Different instructions based on level
  const levelInstructions = {
    A1: `Use simple words to explain clearly. Add helpful context. Short sentences but enough to fill the time.`,
    A2: `Explain using simple vocabulary. Be thorough - fill the time with clear explanations.`,
    B1: `Natural narration with good coverage. Balance detail with clarity.`,
    B2: `Full detail with rich vocabulary. Natural phrasing.`,
    C1: `Complete translation with native expressions.`,
  };

  // 3rd person style instructions
  const thirdPersonStyle = thirdPerson ? `
NARRATION STYLE (3rd Person):
- Describe what people are saying, don't quote them directly
- Use phrases like: "Él dice que...", "Ella explica...", "El hombre menciona..."
- Summarize and paraphrase rather than translate word-for-word
- Make it sound like a narrator describing a scene
- Example: "What are you doing?" → "Le pregunta qué está haciendo."
- Example: "I love this game!" → "Dice que le encanta este juego."
` : "";

  return `You are narrating a video in ${targetLanguage} for ${level} learners.

YOUR TASK: Create ${targetLanguage} narration for each segment.
- ${levelInstructions[level] || levelInstructions.B1}
- Vocabulary: ${guide.vocab}
- Grammar: ${guide.grammar}
- IMPORTANT: ${targetLanguage} uses ~20% more syllables than English. Keep translations CONCISE — 15-20% shorter in character count than the English source to ensure natural speech speed.
${thirdPersonStyle}
CHARACTER TARGETS:
- Aim to match targetChars closely (within ±10%)
- Do NOT go under 85% of targetChars (audio will sound rushed/choppy)
- Do NOT exceed maxChars (causes audio overlap)
- When in doubt, match targetChars as closely as possible

The audio plays at ${guide.ttsSpeed}x speed.

Return JSON: [{"idx": N, "spanish": "...", "chars": N}, ...]`;
}

/**
 * Translate a batch of segments with duration awareness
 */
async function translateBatch(
  segments,
  level,
  batchOffset = 0,
  maxRetries = 3,
  timeout = 30000, // 30s - gemini-2.0-flash with small batches should be quick
  targetLanguage = "Spanish",
  ttsRate = SPANISH_TTS_RATE
) {
  const model = genAI.getGenerativeModel({
    model: "gemini-2.0-flash", // 2.0-flash is faster for translation tasks
    generationConfig: {
      temperature: 0.3, // Lower temp = faster, more consistent
      maxOutputTokens: 4096, // Smaller batches need less tokens
      responseMimeType: "application/json",
    },
  });

  const systemPrompt = buildSystemPrompt(level, targetLanguage);

  // Build input with character budgets
  const inputSegments = segments.map((seg, i) => {
    const targetLength = calculateTargetLength(seg.duration, ttsRate);
    return {
      idx: batchOffset + i,
      duration: seg.duration,
      targetChars: targetLength.target,
      minChars: targetLength.min,
      maxChars: targetLength.max,
      text: seg.text,
    };
  });

  // Compact JSON (no pretty-print) saves tokens and speeds up parsing
  const userPrompt = `Translate ${segments.length} segments:\n${JSON.stringify(
    inputSegments
  )}`;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const timeoutPromise = new Promise((_, reject) =>
        setTimeout(
          () => reject(new Error(`Timeout after ${timeout / 1000}s`)),
          timeout
        )
      );

      const resultPromise = model.generateContent([
        { text: systemPrompt },
        { text: userPrompt },
      ]);

      const result = await Promise.race([resultPromise, timeoutPromise]);
      const responseText = result.response.text().trim();
      const parsed = safeJSONParse(responseText, `batch translation`);

      // Validate response is an array with expected structure
      if (!Array.isArray(parsed)) {
        throw new Error(`Expected array, got ${typeof parsed}`);
      }

      // Validate each segment has required fields
      const validated = parsed.filter((seg) => {
        if (typeof seg.idx !== "number") return false;
        if (typeof seg.spanish !== "string" || seg.spanish.length === 0)
          return false;
        return true;
      });

      if (validated.length < parsed.length) {
        console.log(
          `      ⚠️ Filtered ${
            parsed.length - validated.length
          } invalid segments from response`
        );
      }

      return validated;
    } catch (error) {
      if (attempt < maxRetries) {
        // Exponential backoff: 2s, 4s, 8s... + extra time for timeouts
        const isTimeout = error.message.includes("Timeout");
        const backoffMs = Math.pow(2, attempt) * 1000 + (isTimeout ? 3000 : 0);
        console.log(
          `      ⚠️ Attempt ${attempt} failed: ${error.message}, retrying in ${(
            backoffMs / 1000
          ).toFixed(0)}s...`
        );
        await new Promise((r) => setTimeout(r, backoffMs));
      } else {
        throw error;
      }
    }
  }
}

/**
 * Translate all segments with duration awareness
 *
 * @param {array} segments - Transcription segments with text and timing
 * @param {object} options - Translation options
 * @returns {Promise<array>} Translated segments with character targets
 */
async function translate(segments, options = {}) {
  // Small batches + high concurrency = fast parallel translation
  // Reduced batch size to prevent Gemini response truncation
  const {
    level = "B1",
    batchSize = 5, // Reduced from 10 to avoid JSON truncation issues
    concurrency = 15, // High parallelization with staggered starts
    targetLanguage = "spanish", // "spanish" or "indonesian"
    isXTTS = false, // When true, use slower XTTS rate for shorter translations
  } = options;

  // Get language-specific TTS rate
  // XTTS speaks at ~14 c/s (natural rate). We target this and handle timing with
  // silence padding (too short) or gentle atempo (too long). No fallback needed.
  const ttsRate = isXTTS 
    ? XTTS_TTS_RATE 
    : (TTS_RATES[targetLanguage.toLowerCase()] || TTS_RATES.spanish);
  const langDisplay =
    targetLanguage.charAt(0).toUpperCase() + targetLanguage.slice(1);

  console.log(`\n${"═".repeat(60)}`);
  console.log(`🌐 TRANSLATE: English → ${langDisplay} (Duration-Aware)`);
  console.log(`${"═".repeat(60)}`);

  if (!process.env.GEMINI_API_KEY) {
    throw new Error(
      "GEMINI_API_KEY not set!\n" + "Add to .env: GEMINI_API_KEY=your_key_here"
    );
  }

  console.log(`   Segments: ${segments.length}`);
  console.log(`   Level: ${level} (${LEVEL_GUIDES[level]?.name || "Unknown"})`);
  console.log(`   Language: ${langDisplay}`);
  console.log(`   TTS rate: ${ttsRate.charsPerSecond} chars/sec${isXTTS ? " (XTTS - uses atempo to fit timing)" : ""}`);

  const totalDuration = segments.reduce((sum, s) => sum + s.duration, 0);
  const totalTargetChars = Math.round(totalDuration * ttsRate.charsPerSecond);
  console.log(
    `   Total duration: ${totalDuration.toFixed(
      1
    )}s → ~${totalTargetChars} chars target`
  );

  const startTime = Date.now();

  // Create batches
  const batches = [];
  for (let i = 0; i < segments.length; i += batchSize) {
    batches.push({
      segments: segments.slice(i, i + batchSize),
      offset: i,
    });
  }

  console.log(
    `\n   🔄 Processing ${batches.length} batches (${concurrency} parallel)...`
  );

  const results = new Array(segments.length);
  let failedBatches = [];

  // Process batches with limited concurrency + staggered starts to avoid burst
  for (let i = 0; i < batches.length; i += concurrency) {
    const batchGroup = batches.slice(i, i + concurrency);

    const batchResults = await Promise.all(
      batchGroup.map(async (batch, localIdx) => {
        const globalIdx = i + localIdx;
        
        // Stagger requests by 200ms each to avoid burst triggering
        if (localIdx > 0) {
          await new Promise(r => setTimeout(r, localIdx * 200));
        }
        
        try {
          const translated = await translateBatch(
            batch.segments,
            level,
            batch.offset,
            4, // maxRetries (increased)
            45000, // timeout (increased to 45s)
            langDisplay,
            ttsRate
          );
          console.log(`      ✅ Batch ${globalIdx + 1}/${batches.length}`);
          return { success: true, segments: translated, offset: batch.offset };
        } catch (error) {
          const isRateLimit = error.message.includes("429") || error.message.includes("Too Many") || error.message.includes("Resource exhausted") || error.message.includes("Timeout");
          console.error(
            `      ❌ Batch ${globalIdx + 1} failed: ${error.message.substring(0, 80)}${isRateLimit ? ' (will retry)' : ''}`
          );
          return {
            success: false,
            offset: batch.offset,
            originalSegments: batch.segments,
            isRateLimit,
          };
        }
      })
    );
    
    // Collect failed batches for retry
    for (const result of batchResults) {
      if (!result.success) {
        failedBatches.push(result);
      }
    }
    
    // Small delay between batch groups to avoid overwhelming the API
    if (i + concurrency < batches.length) {
      await new Promise(r => setTimeout(r, 500));
    }

    // Collect results
    for (const batchResult of batchResults) {
      if (batchResult.success) {
        // Create a map of idx -> segment for easier lookup
        const segmentMap = new Map();
        for (const seg of batchResult.segments) {
          segmentMap.set(seg.idx, seg);
        }

        // Process each original segment in this batch
        const batchSegments =
          batches.find((b) => b.offset === batchResult.offset)?.segments || [];
        for (let j = 0; j < batchSegments.length; j++) {
          const idx = batchResult.offset + j;
          const original = segments[idx];
          const translatedSeg = segmentMap.get(idx);

          if (translatedSeg && translatedSeg.spanish) {
            const targetLength = calculateTargetLength(
              original.duration,
              ttsRate
            );
            
            let translatedText = translatedSeg.spanish;
            const originalChars = translatedText.length;
            
            // Truncate if WAY over max — but always at a sentence boundary
            // Allow 25% over max before truncating (TTS speed-up handles mild overrun)
            const hardLimit = Math.round(targetLength.max * 1.25);
            if (translatedText.length > hardLimit) {
              // Find the last complete sentence that fits within the hard limit
              const sentences = translatedText.match(/[^.!?]+[.!?]+/g) || [];
              if (sentences.length > 1) {
                let truncated = "";
                for (const sentence of sentences) {
                  if ((truncated + sentence).length <= hardLimit) {
                    truncated += sentence;
                  } else {
                    break;
                  }
                }
                // Only use sentence-based truncation if we kept at least 50% of content
                if (truncated.length > hardLimit * 0.5) {
                  translatedText = truncated.trim();
                } else {
                  // Sentences are too long individually — fall back to clause/word boundary
                  let fallback = translatedText.substring(0, hardLimit);
                  const lastPunct = Math.max(
                    fallback.lastIndexOf('.'), fallback.lastIndexOf('!'),
                    fallback.lastIndexOf('?'), fallback.lastIndexOf(',')
                  );
                  if (lastPunct > hardLimit * 0.6) {
                    translatedText = fallback.substring(0, lastPunct + 1).trim();
                  } else {
                    const lastSpace = fallback.lastIndexOf(' ');
                    if (lastSpace > hardLimit * 0.5) {
                      translatedText = fallback.substring(0, lastSpace).trim();
                    }
                  }
                }
                console.log(`      ⚠️ Seg ${idx}: Truncated ${originalChars} → ${translatedText.length} chars (limit: ${hardLimit}) at sentence boundary`);
              }
            }
            
            const actualChars = translatedText.length;

            // Calculate what TTS speed we'll need
            const charRatio = actualChars / targetLength.target;
            const suggestedSpeed = Math.max(
              ttsRate.minSpeed,
              Math.min(ttsRate.maxSpeed, charRatio)
            );

            results[idx] = {
              index: idx,
              start: original.start,
              end: original.end,
              duration: original.duration,
              pauseBefore: original.pauseBefore || 0,
              speaker: original.speaker,
              originalText: original.text,
              translatedText: translatedText,
              // Duration matching metadata
              targetChars: targetLength.target,
              actualChars: actualChars,
              charRatio: charRatio,
              suggestedTTSSpeed: suggestedSpeed,
              wasExceeded: originalChars > targetLength.max,
              originalWords: original.text.split(/\s+/).length,
              translatedWords: translatedText.split(/\s+/).length,
            };
          } else {
            // Segment missing from response - log and mark as error
            console.log(`      ⚠️ Segment ${idx} missing translation`);
            results[idx] = {
              index: idx,
              start: original.start,
              end: original.end,
              duration: original.duration,
              speaker: original.speaker,
              originalText: original.text,
              translatedText: null,
              error: true,
              errorReason: "missing_from_response",
            };
          }
        }
      } else {
        // Mark failed segments
        const startIdx = batchResult.offset;
        batchResult.originalSegments?.forEach((seg, j) => {
          const idx = startIdx + j;
          results[idx] = {
            index: idx,
            start: seg.start,
            end: seg.end,
            duration: seg.duration,
            speaker: seg.speaker,
            originalText: seg.text,
            translatedText: "[ERROR: Translation failed]",
            error: true,
            errorReason: "batch_failed",
          };
        });
      }
    }
  }

  // RETRY FAILED BATCHES - especially for rate limit errors
  if (failedBatches.length > 0) {
    console.log(`\n   ⏳ Detected ${failedBatches.length} failed batches - waiting 10s before retrying...`);
    await new Promise(r => setTimeout(r, 10000)); // Wait 10 seconds
    
    // Retry ALL failed batches SEQUENTIALLY (one at a time) to avoid overwhelming API
    for (let retryIdx = 0; retryIdx < failedBatches.length; retryIdx++) {
      const failedBatch = failedBatches[retryIdx];
      console.log(`   🔄 Retrying batch ${retryIdx + 1}/${failedBatches.length} (offset ${failedBatch.offset})...`);
      
      try {
        const translated = await translateBatch(
          failedBatch.originalSegments,
          level,
          failedBatch.offset,
          5, // More retries on second attempt
          60000, // Longer timeout
          langDisplay,
          ttsRate
        );
        
        console.log(`      ✅ Retry successful!`);
        
        // Process the successful retry results
        const segmentMap = new Map();
        for (const seg of translated) {
          segmentMap.set(seg.idx, seg);
        }
        
        for (let j = 0; j < failedBatch.originalSegments.length; j++) {
          const idx = failedBatch.offset + j;
          const original = segments[idx];
          const translatedSeg = segmentMap.get(idx);
          
          if (translatedSeg && translatedSeg.spanish) {
            const targetLength = calculateTargetLength(original.duration, ttsRate);
            let translatedText = translatedSeg.spanish;
            const originalChars = translatedText.length;
            
            // Smart truncation at sentence/clause boundaries
            if (translatedText.length > targetLength.maxChars) {
              let truncated = translatedText.substring(0, targetLength.maxChars);
              
              // Try to cut at sentence boundary first (. ! ?)
              const lastSentence = Math.max(
                truncated.lastIndexOf('. '),
                truncated.lastIndexOf('! '),
                truncated.lastIndexOf('? ')
              );
              
              // Try clause boundary (comma)
              const lastComma = truncated.lastIndexOf(', ');
              
              // Try word boundary
              const lastSpace = truncated.lastIndexOf(' ');
              
              // Choose best cut point
              if (lastSentence > targetLength.maxChars * 0.7) {
                truncated = truncated.substring(0, lastSentence + 1); // Keep the period
              } else if (lastComma > targetLength.maxChars * 0.75) {
                truncated = truncated.substring(0, lastComma);
              } else if (lastSpace > targetLength.maxChars * 0.7) {
                truncated = truncated.substring(0, lastSpace);
              }
              
              translatedText = truncated.trim();
              console.log(`      ⚠️ Seg ${idx}: Truncated ${originalChars} → ${translatedText.length} chars (max: ${targetLength.maxChars})`);
            }
            
            const actualChars = translatedText.length;
            const charRatio = actualChars / targetLength.targetChars;
            
            results[idx] = {
              index: idx,
              start: original.start,
              end: original.end,
              duration: original.duration,
              speaker: original.speaker,
              originalText: original.text,
              translatedText: translatedText,
              charRatio: charRatio,
              retried: true,
            };
          }
        }
      } catch (error) {
        console.error(`      ❌ Retry failed: ${error.message.substring(0, 60)}`);
      }
      
      // Small delay between retries to be gentle on the API
      if (retryIdx < failedBatches.length - 1) {
        await new Promise(r => setTimeout(r, 2000));
      }
    }
  }

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  const validResults = results.filter((r) => r && !r.error && r.translatedText);
  const missingCount = results.filter(
    (r) => r?.errorReason === "missing_from_response"
  ).length;
  const batchFailedCount = results.filter(
    (r) => r?.errorReason === "batch_failed"
  ).length;
  const nullCount = results.filter((r) => r === null || r === undefined).length;
  const truncatedCount = validResults.filter((r) => r.wasExceeded).length;

  // Calculate accuracy stats
  const charRatios = validResults.map((r) => r.charRatio).filter((r) => r);
  const avgCharRatio =
    charRatios.length > 0
      ? charRatios.reduce((a, b) => a + b, 0) / charRatios.length
      : 0;
  const withinTarget = charRatios.filter((r) => r >= 0.85 && r <= 1.15).length;

  console.log(`\n   ✅ TRANSLATION COMPLETE in ${elapsed}s`);
  console.log(
    `   📊 Translated: ${validResults.length}/${segments.length} segments`
  );
  
  if (truncatedCount > 0) {
    console.log(`   ✂️ Truncated ${truncatedCount}/${validResults.length} segments that exceeded max chars`);
  }

  if (missingCount > 0 || batchFailedCount > 0 || nullCount > 0) {
    console.log(`   ⚠️ Issues:`);
    if (missingCount > 0)
      console.log(`      - Missing from Gemini response: ${missingCount}`);
    if (batchFailedCount > 0)
      console.log(`      - Batch failures: ${batchFailedCount}`);
    if (nullCount > 0) console.log(`      - Null results: ${nullCount}`);
  }

  if (charRatios.length > 0) {
    console.log(`   📏 Duration accuracy:`);
    console.log(
      `      Avg char ratio: ${avgCharRatio.toFixed(2)}x (1.0 = perfect)`
    );
    console.log(
      `      Within ±15%: ${withinTarget}/${charRatios.length} (${(
        (withinTarget / charRatios.length) *
        100
      ).toFixed(0)}%)`
    );
  }

  return results;
}

/**
 * Detect speaker gender(s) from transcript
 * Can analyze full text OR per-speaker segments from diarization
 *
 * @param {string|array} input - Full text string OR array of segments with speaker labels
 * @returns {Promise<string|object>} Single gender OR map of speaker -> gender
 */
async function detectGender(input) {
  console.log(`\n   🔍 Detecting speaker gender...`);

  const model = genAI.getGenerativeModel({
    model: "gemini-2.0-flash",
    generationConfig: {
      temperature: 0,
      maxOutputTokens: 500,
      responseMimeType: "application/json",
    },
  });

  // Check if we have diarized segments with speaker labels
  const hasSegments =
    Array.isArray(input) && input.length > 0 && input[0].speaker;

  if (hasSegments) {
    // Multi-speaker analysis using diarization data
    return await detectMultipleSpeakerGenders(input, model);
  }

  // Single speaker / full text analysis
  const fullText =
    typeof input === "string" ? input : input.map((s) => s.text).join(" ");

  const prompt = `Analyze this transcript and determine the PRIMARY speaker's likely gender.

Look for clues:
- Names mentioned (especially self-references like "I'm John" or "My name is Sarah")
- Pronouns used by others referring to the speaker
- Voice descriptions or gendered terms
- Context clues (topics, profession mentions)

Transcript:
"${fullText.substring(0, 3000)}"

IMPORTANT: Make your best guess even if uncertain. Default to "male" only if truly no clues.

Respond with JSON: {"gender": "male" | "female", "confidence": "high" | "medium" | "low", "reasoning": "brief explanation"}`;

  try {
    const result = await model.generateContent(prompt);
    const responseText = result.response.text().trim();

    // Try to parse JSON, handle potential markdown code blocks
    let jsonStr = responseText;
    if (responseText.includes("```")) {
      const match = responseText.match(/```(?:json)?\s*([\s\S]*?)```/);
      if (match) jsonStr = match[1].trim();
    }

    const response = JSON.parse(jsonStr);
    console.log(
      `      Primary speaker: ${response.gender} (${response.confidence} confidence)`
    );
    if (response.reasoning) {
      console.log(`      Reason: ${response.reasoning}`);
    }
    return response.gender || "male";
  } catch (error) {
    console.log(`      ⚠️ Gender detection failed: ${error.message}`);
    console.log(`      Defaulting to male`);
    return "male";
  }
}

/**
 * Detect gender for multiple speakers using diarization data
 * @param {array} segments - Segments with speaker labels
 * @param {object} model - Gemini model instance
 * @returns {Promise<object>} Map of speaker ID -> gender
 */
async function detectMultipleSpeakerGenders(segments, model) {
  // Group segments by speaker
  const speakerTexts = {};
  for (const seg of segments) {
    const speaker = seg.speaker || "SPEAKER_00";
    if (!speakerTexts[speaker]) {
      speakerTexts[speaker] = [];
    }
    speakerTexts[speaker].push(seg.text);
  }

  const speakers = Object.keys(speakerTexts);
  console.log(
    `      Found ${speakers.length} speakers: ${speakers.join(", ")}`
  );

  if (speakers.length === 1) {
    // Single speaker - use simple detection
    const fullText = speakerTexts[speakers[0]].join(" ");
    const gender = await detectGender(fullText);
    return { [speakers[0]]: gender, _primary: gender };
  }

  // Multi-speaker - analyze each speaker's text
  const speakerSamples = speakers.map((speaker) => {
    const texts = speakerTexts[speaker];
    const sample = texts.slice(0, 10).join(" ").substring(0, 1000);
    const wordCount = texts.join(" ").split(/\s+/).length;
    return { speaker, sample, wordCount };
  });

  const prompt = `Analyze this multi-speaker transcript and determine each speaker's likely gender.

${speakerSamples
  .map(
    (s) => `${s.speaker} (${s.wordCount} words):
"${s.sample}"`
  )
  .join("\n\n")}

For each speaker, look for:
- Self-identification ("I'm John", "As a mother...")
- How others address them
- Voice/tone descriptions
- Gendered language patterns

Respond with JSON: {
  "speakers": {
    "SPEAKER_00": {"gender": "male"|"female", "confidence": "high"|"medium"|"low"},
    "SPEAKER_01": {"gender": "male"|"female", "confidence": "high"|"medium"|"low"}
  },
  "primary_speaker": "SPEAKER_XX"
}`;

  try {
    const result = await model.generateContent(prompt);
    const responseText = result.response.text().trim();

    // Parse JSON, handle markdown
    let jsonStr = responseText;
    if (responseText.includes("```")) {
      const match = responseText.match(/```(?:json)?\s*([\s\S]*?)```/);
      if (match) jsonStr = match[1].trim();
    }

    const response = JSON.parse(jsonStr);

    // Build speaker -> gender map
    const genderMap = {};
    for (const [speaker, data] of Object.entries(response.speakers || {})) {
      genderMap[speaker] = data.gender || "male";
      console.log(`      ${speaker}: ${data.gender} (${data.confidence})`);
    }

    // Add primary speaker info
    genderMap._primary = response.primary_speaker
      ? genderMap[response.primary_speaker] || "male"
      : genderMap[speakers[0]] || "male";

    return genderMap;
  } catch (error) {
    console.log(
      `      ⚠️ Multi-speaker gender detection failed: ${error.message}`
    );
    // Default all speakers to male
    const genderMap = { _primary: "male" };
    speakers.forEach((s) => (genderMap[s] = "male"));
    return genderMap;
  }
}

/**
 * Check if Gemini API key is set
 */
function checkApiKey() {
  return !!process.env.GEMINI_API_KEY;
}

/**
 * Calculate dynamic target chars for narrator mode
 * 
 * Key insight: We want to FILL TIME with simple words at lower levels,
 * BUT we must respect the gap to the next segment to avoid overlaps!
 * 
 * TUNING HISTORY:
 * - v1: 96% fill, 7 overlaps (too aggressive)
 * - v2: 69% fill, 0 overlaps (too conservative)  
 * - v3: 78% fill, 1 overlap at C1 (TTS variance at high speed)
 * - v4: Add speed-based safety margin for high-speed TTS
 * 
 * @param {number} duration - Segment duration in seconds
 * @param {number} gapToNext - Gap to next segment in seconds (Infinity if last segment)
 * @param {object} guide - Level guide with ttsSpeed and targetFillRate
 * @param {object} ttsRate - Language TTS rate (chars per second)
 * @returns {object} { targetChars, maxChars, dynamicFillRate, availableTime }
 */
function calculateNarratorTargetChars(duration, gapToNext, guide, ttsRate) {
  const baseFillRate = guide.targetFillRate || 0.85;
  const ttsSpeed = guide.ttsSpeed || 0.85;
  
  // TTS variance is higher at faster speeds (no slow playback to absorb it)
  // At 1.0x speed, TTS can vary ±15% from expected duration
  // At 0.7x speed, variance is dampened by slow playback
  const speedVarianceFactor = 0.85 + (ttsSpeed * 0.15); // 0.85 at 0x, 1.0 at 1.0x
  
  // Calculate available time: segment duration + portion of gap we can use
  // Leave buffer proportional to TTS speed (more buffer at high speed)
  const minBuffer = 0.1 + (ttsSpeed * 0.15); // 0.1s at slow, 0.25s at full speed
  const safeGap = Math.max(0, gapToNext - minBuffer);
  const maxSpillover = Math.min(safeGap, duration * 0.2); // Max 20% spillover into gap
  const availableTime = duration + maxSpillover;
  
  // Dynamic fill rate based on gap AND TTS speed:
  // Higher TTS speed = more conservative with tight gaps
  let dynamicFillRate;
  const tightGapThreshold = ttsSpeed >= 0.95 ? 0.5 : 0.3; // C1 needs bigger gap buffer
  
  if (gapToNext < tightGapThreshold) {
    // Very tight gap - be more conservative at high speeds
    const conservativeRate = ttsSpeed >= 0.95 ? 0.78 : 0.82;
    dynamicFillRate = Math.min(baseFillRate, conservativeRate);
  } else if (gapToNext < 1.0) {
    // Tight gap
    dynamicFillRate = Math.min(baseFillRate, 0.85);
  } else if (gapToNext < 3.0) {
    // Normal gap
    dynamicFillRate = baseFillRate;
  } else {
    // Large gap - can fill more
    dynamicFillRate = Math.min(0.92, baseFillRate + 0.05);
  }
  
  // Adjust for segment length
  if (duration < 3) {
    dynamicFillRate = Math.min(0.90, dynamicFillRate + 0.03);
  } else if (duration > 12) {
    dynamicFillRate = Math.max(0.75, dynamicFillRate - 0.03);
  }
  
  // Calculate target and MAX chars
  // Use slightly conservative char rate at high TTS speeds (TTS variance)
  const conservativeRate = ttsRate.charsPerSecond * (ttsSpeed >= 0.95 ? 0.92 : 1.0);
  const effectiveRate = conservativeRate * ttsSpeed;
  const targetChars = Math.round(duration * effectiveRate * dynamicFillRate);
  
  // Max chars: based on available time with speed-adjusted safety margin
  // Higher speed = more margin needed for TTS variance
  const safetyMargin = ttsSpeed >= 0.95 ? 0.93 : 0.97;
  const maxChars = Math.round(availableTime * effectiveRate * safetyMargin);
  
  return { 
    targetChars, 
    maxChars, 
    dynamicFillRate, 
    availableTime,
    gapToNext 
  };
}

/**
 * NARRATOR MODE: Segment-by-segment translation with TIME-FILLING approach
 * 
 * Unlike direct translation, this FILLS TIME with level-appropriate content:
 * - A1: Slow speech (0.70x), fill 80% of time with SIMPLE words (more words, not fewer!)
 * - A2: Slow speech (0.75x), fill 82% of time with clear explanations
 * - B1: Moderate (0.85x), fill 85% of time with natural narration
 * - B2: Near-native (0.95x), fill 88% of time with rich vocabulary
 * - C1: Full speed (1.0x), fill 90% of time with complete translation
 * 
 * This allows beginners to follow along with normal-speed video while
 * hearing comprehensible, thorough explanations at their level.
 * 
 * @param {array} segments - Transcription segments
 * @param {object} options - Translation options
 * @returns {Promise<array>} Translated segments
 */
async function translateNarrator(segments, options = {}) {
  const {
    level = "B1",
    batchSize = 5, // Reduced from 10 to avoid JSON truncation issues
    concurrency = 10,
    targetLanguage = "spanish",
    thirdPerson = false,  // Use 3rd person narration ("He says..." instead of direct speech)
  } = options;

  const guide = LEVEL_GUIDES[level] || LEVEL_GUIDES.B1;
  const ttsRate = TTS_RATES[targetLanguage.toLowerCase()] || TTS_RATES.spanish;
  const langDisplay = targetLanguage.charAt(0).toUpperCase() + targetLanguage.slice(1);
  
  // Get time-filling settings for this level
  const ttsSpeed = guide.ttsSpeed || 0.85;
  const targetFillRate = guide.targetFillRate || 0.85;

  console.log(`\n${"═".repeat(60)}`);
  console.log(`🎙️ NARRATOR MODE: ${langDisplay} (Time-Filling)`);
  console.log(`${"═".repeat(60)}`);
  console.log(`   Level: ${level} (${guide.name})`);
  console.log(`   TTS Speed: ${ttsSpeed}x`);
  console.log(`   Target Fill Rate: ${Math.round(targetFillRate * 100)}% of time`);
  console.log(`   Style: ${thirdPerson ? "3rd person narration (He says...)" : "Direct translation"}`);
  console.log(`   Strategy: ${level === "A1" || level === "A2" ? "MORE simple words to fill time" : "Natural coverage"}`);
  console.log(`   Segments: ${segments.length}`);

  if (!process.env.GEMINI_API_KEY) {
    throw new Error("GEMINI_API_KEY not set!");
  }

  const model = genAI.getGenerativeModel({
    model: "gemini-2.0-flash",
    generationConfig: {
      temperature: 0.3,
      maxOutputTokens: 4096,
      responseMimeType: "application/json",
    },
  });

  const systemPrompt = buildNarratorPrompt(level, langDisplay, { thirdPerson });
  const startTime = Date.now();
  const results = new Array(segments.length);

  // Process in batches
  const batches = [];
  for (let i = 0; i < segments.length; i += batchSize) {
    batches.push({
      segments: segments.slice(i, i + batchSize),
      offset: i,
    });
  }

  console.log(`   Processing ${batches.length} batches...`);

  for (let i = 0; i < batches.length; i += concurrency) {
    const batchGroup = batches.slice(i, i + concurrency);

    await Promise.all(
      batchGroup.map(async (batch, localIdx) => {
        const globalIdx = i + localIdx;
        
        // Build input with TIME-FILLING character targets
        const inputSegments = batch.segments.map((seg, j) => {
          // Calculate gap to next segment
          const globalIndex = batch.offset + j;
          const nextSeg = segments[globalIndex + 1];
          const gapToNext = nextSeg ? (nextSeg.start - seg.end) : Infinity;
          
          // Calculate target chars using time-filling approach
          // This dynamically adjusts based on segment length + gap to next
          const { targetChars, maxChars, dynamicFillRate, availableTime } = calculateNarratorTargetChars(
            seg.duration, 
            gapToNext,
            guide, 
            ttsRate
          );
          
          return {
            idx: globalIndex,
            duration: seg.duration,
            gapToNext: gapToNext === Infinity ? "none" : gapToNext.toFixed(2),
            targetChars: targetChars,
            maxChars: maxChars, // HARD LIMIT - do not exceed!
            text: seg.text,
          };
        });

        const userPrompt = `Create ${langDisplay} narration for ${inputSegments.length} segments.

CRITICAL: Each segment has a maxChars limit - DO NOT EXCEED IT or audio will overlap!
- targetChars: aim for this length
- maxChars: HARD LIMIT, never go over

Segments:\n${JSON.stringify(inputSegments)}`;

        for (let attempt = 1; attempt <= 3; attempt++) {
          try {
            const result = await model.generateContent([
              { text: systemPrompt },
              { text: userPrompt },
            ]);

            const responseText = result.response.text().trim();
            let jsonStr = responseText;
            if (responseText.includes("```")) {
              const match = responseText.match(/```(?:json)?\s*([\s\S]*?)```/);
              if (match) jsonStr = match[1].trim();
            }

            const parsed = JSON.parse(jsonStr);
            
            // Store results
            for (const seg of parsed) {
              if (typeof seg.idx === "number" && seg.spanish) {
                const originalSeg = segments[seg.idx];
                const nextSeg = segments[seg.idx + 1];
                const gapToNext = nextSeg ? (nextSeg.start - originalSeg.end) : Infinity;
                
                // Recalculate the target for this specific segment for accurate tracking
                const { targetChars, maxChars, dynamicFillRate } = calculateNarratorTargetChars(
                  originalSeg.duration, 
                  gapToNext,
                  guide, 
                  ttsRate
                );
                
                const actualChars = seg.chars || seg.spanish.length;
                const exceededMax = actualChars > maxChars;
                
                results[seg.idx] = {
                  ...originalSeg,
                  index: seg.idx,
                  translatedText: seg.spanish,
                  chars: actualChars,
                  targetChars,
                  maxChars,
                  exceededMax, // Flag for debugging
                  fillRate: dynamicFillRate,
                  gapToNext: gapToNext === Infinity ? null : gapToNext,
                  suggestedTTSSpeed: ttsSpeed,
                  isNarrator: true,
                };
                
                if (exceededMax) {
                  console.log(`      ⚠️ Seg ${seg.idx}: ${actualChars}/${maxChars} chars (OVER LIMIT by ${actualChars - maxChars})`);
                }
              }
            }
            
            console.log(`      ✅ Batch ${globalIdx + 1}/${batches.length}`);
            break;
          } catch (error) {
            if (attempt < 3) {
              await new Promise(r => setTimeout(r, 2000 * attempt));
            } else {
              console.error(`      ❌ Batch ${globalIdx + 1} failed: ${error.message}`);
              // Fill with fallback
              for (const seg of batch.segments) {
                const idx = batch.offset + batch.segments.indexOf(seg);
                results[idx] = {
                  ...seg,
                  index: idx,
                  translatedText: "[Error]",
                  error: true,
                };
              }
            }
          }
        }
      })
    );
  }

  // Filter out nulls and errors
  let validResults = results.filter(r => r && !r.error);
  
  // POST-TRANSLATION VALIDATION: Truncate segments that exceed maxChars
  const exceededCount = validResults.filter(r => r.exceededMax).length;
  if (exceededCount > 0) {
    console.log(`\n   🔧 Truncating ${exceededCount} segments that exceeded maxChars...`);
    validResults = validResults.map(seg => {
      if (seg.exceededMax && seg.translatedText && seg.maxChars) {
        // Truncate at last COMPLETE SENTENCE to avoid cut-offs
        let truncated = seg.translatedText.substring(0, seg.maxChars);
        
        // Find last sentence-ending punctuation
        const lastPeriod = truncated.lastIndexOf('.');
        const lastExclaim = truncated.lastIndexOf('!');
        const lastQuestion = truncated.lastIndexOf('?');
        const lastSentence = Math.max(lastPeriod, lastExclaim, lastQuestion);
        
        if (lastSentence > seg.maxChars * 0.6) {
          // Keep complete sentence (at least 60% of target)
          truncated = truncated.substring(0, lastSentence + 1);
        } else {
          // Fall back to last complete word
          const lastSpace = truncated.lastIndexOf(' ');
          if (lastSpace > seg.maxChars * 0.6) {
            truncated = truncated.substring(0, lastSpace);
          }
        }
        
        console.log(`      Seg ${seg.index}: ${seg.chars} → ${truncated.length} chars (complete sentence)`);
        
        return {
          ...seg,
          translatedText: truncated.trim(),
          chars: truncated.trim().length,
          wasTruncated: true,
          originalChars: seg.chars,
        };
      }
      return seg;
    });
  }
  
  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log(`\n   ✅ Narrator translation complete in ${elapsed}s`);
  console.log(`   📊 ${validResults.length}/${segments.length} segments translated`);
  if (exceededCount > 0) {
    console.log(`   🔧 Truncated: ${exceededCount} segments that exceeded limits`);
  }
  
  // Calculate time-filling accuracy and overlap risk
  if (validResults.length > 0) {
    // Check for segments at risk of overlap (chars close to or exceeding maxChars)
    const atRisk = validResults.filter(r => r.chars > r.maxChars * 0.95);
    const safeSegments = validResults.filter(r => r.chars <= r.maxChars * 0.90);
    
    const fillAccuracies = validResults.map(r => {
      if (!r.targetChars || !r.chars) return null;
      return r.chars / r.targetChars;
    }).filter(Boolean);
    
    if (fillAccuracies.length > 0) {
      const avgFillAccuracy = fillAccuracies.reduce((a, b) => a + b, 0) / fillAccuracies.length;
      const withinTarget = fillAccuracies.filter(a => a >= 0.85 && a <= 1.05).length;
      
      console.log(`   📏 Character budget compliance:`);
      console.log(`      Safe (≤90% of max): ${safeSegments.length}/${validResults.length}`);
      console.log(`      At risk (>95% of max): ${atRisk.length}`);
      console.log(`      Avg fill: ${(avgFillAccuracy * 100).toFixed(0)}% of target`);
    }
    
    // Show segments with tight gaps
    const tightGaps = validResults.filter(r => r.gapToNext !== null && r.gapToNext < 0.5);
    if (tightGaps.length > 0) {
      console.log(`   ⚠️ Tight gaps (<0.5s): ${tightGaps.length} segments`);
    }
    
    // Show example
    const sample = validResults[0];
    console.log(`   📝 Example (seg 0, ${sample.duration?.toFixed(1)}s, gap: ${sample.gapToNext?.toFixed(2) || 'none'}s):`);
    console.log(`      Target: ${sample.targetChars}, Max: ${sample.maxChars}, Got: ${sample.chars} chars`);
    if (sample.translatedText) {
      console.log(`      Text: "${sample.translatedText.substring(0, 50)}..."`);
    }
  }

  return validResults;
}

/**
 * BEGINNER MODE: Dreaming Spanish-style comprehensible input translation
 * 
 * Creates beginner-friendly content with visual context and repetition.
 * Optimized for language acquisition (comprehensible input methodology):
 * 
 * - Describes what's visible on screen
 * - Uses repetition: "El perro. Mira, el perro. El perro corre."
 * - Extremely simplified vocabulary (500 most common words)
 * - Includes comprehension scaffolding
 * - Outputs vocabulary list per segment for overlay generation
 * 
 * @param {array} segments - Transcription segments
 * @param {object} options - Translation options
 * @returns {Promise<array>} Translated segments with vocabulary lists
 */
async function translateBeginner(segments, options = {}) {
  const {
    level = "A1",  // Defaults to superbeginner
    targetLanguage = "spanish",
    sceneAnalysis = null,  // Optional: output from scene-analyzer.js
    batchSize = 5,
    concurrency = 5,
    repetitionLevel = "high",  // "low", "medium", "high"
  } = options;

  const guide = LEVEL_GUIDES[level] || LEVEL_GUIDES.A1;
  const ttsRate = TTS_RATES[targetLanguage.toLowerCase()] || TTS_RATES.spanish;
  const langDisplay = targetLanguage.charAt(0).toUpperCase() + targetLanguage.slice(1);

  console.log(`\n${"═".repeat(60)}`);
  console.log(`📚 BEGINNER MODE: Dreaming Spanish Style (${langDisplay})`);
  console.log(`${"═".repeat(60)}`);
  console.log(`   Level: ${level} (${guide.name})`);
  console.log(`   Repetition: ${repetitionLevel}`);
  console.log(`   Segments: ${segments.length}`);
  console.log(`   Scene analysis: ${sceneAnalysis ? "provided" : "none"}`);

  if (!process.env.GEMINI_API_KEY) {
    throw new Error("GEMINI_API_KEY not set!");
  }

  const model = genAI.getGenerativeModel({
    model: "gemini-2.0-flash",
    generationConfig: {
      temperature: 0.4,  // Slightly more creative for natural repetition
      maxOutputTokens: 4096,
      responseMimeType: "application/json",
    },
  });

  // Build repetition instructions based on level
  const repetitionInstructions = {
    low: "Repeat key vocabulary once when introducing it.",
    medium: "Repeat key vocabulary 2 times. Use pattern: introduce, use in context.",
    high: "Repeat key vocabulary 2-3 times. Use pattern: 'Mira, [word]. [word]. El [word] [action].'",
  };

  const systemPrompt = `You are creating ${langDisplay} comprehensible input for ABSOLUTE BEGINNERS (${level}).

YOUR GOAL: Make the content UNDERSTANDABLE through context and repetition, even for someone with ZERO prior ${langDisplay} knowledge.

DREAMING SPANISH METHODOLOGY:
1. DESCRIBE what's visible: "Mira. Un perro. El perro es grande."
2. USE REPETITION: ${repetitionInstructions[repetitionLevel]}
3. SIMPLE VOCABULARY: ${guide.vocab}
4. SHORT SENTENCES: 3-7 words maximum
5. PRESENT TENSE: ${guide.grammar}

VOCABULARY EXTRACTION:
- Identify 2-4 KEY vocabulary words per segment
- Choose concrete, visual words a beginner should learn
- Include the word, its translation, and difficulty level

OUTPUT FORMAT (JSON array):
[{
  "idx": 0,
  "beginner${langDisplay.charAt(0).toUpperCase() + langDisplay.slice(1)}": "Mira. Un hombre. El hombre habla. Habla mucho.",
  "chars": 45,
  "vocabulary": [
    {"word": "hombre", "translation": "man", "difficulty": "A1"},
    {"word": "habla", "translation": "speaks", "difficulty": "A1"}
  ],
  "visualDescription": "A man is talking on screen"
}]`;

  const startTime = Date.now();
  const results = new Array(segments.length);

  // Process in batches
  const batches = [];
  for (let i = 0; i < segments.length; i += batchSize) {
    batches.push({
      segments: segments.slice(i, i + batchSize),
      offset: i,
    });
  }

  console.log(`   Processing ${batches.length} batches...`);

  for (let i = 0; i < batches.length; i += concurrency) {
    const batchGroup = batches.slice(i, i + concurrency);

    await Promise.all(
      batchGroup.map(async (batch, localIdx) => {
        const globalIdx = i + localIdx;
        
        // Build input with scene context if available
        const inputSegments = batch.segments.map((seg, j) => {
          const globalIndex = batch.offset + j;
          
          // Get scene analysis for this segment if available
          let sceneContext = "";
          if (sceneAnalysis?.segmentVocabulary) {
            const segScene = sceneAnalysis.segmentVocabulary.find(
              sv => sv.segmentIndex === globalIndex
            );
            if (segScene?.sceneDescriptions?.length > 0) {
              sceneContext = segScene.sceneDescriptions[0].english || "";
            }
          }
          
          // Calculate target chars (slower speech for beginners)
          const ttsSpeed = 0.65;  // 65% speed for beginners
          const fillRate = 0.85;
          const targetChars = Math.round(seg.duration * ttsRate.charsPerSecond * ttsSpeed * fillRate);
          const maxChars = Math.round(seg.duration * ttsRate.charsPerSecond * ttsSpeed * 1.0);
          
          return {
            idx: globalIndex,
            duration: seg.duration,
            targetChars,
            maxChars,
            text: seg.text,
            sceneContext: sceneContext || "No visual context",
          };
        });

        const userPrompt = `Create beginner-friendly ${langDisplay} narration for ${inputSegments.length} segments.

IMPORTANT:
- Use REPETITION to reinforce vocabulary
- Describe what's happening visually
- Keep sentences SHORT (3-7 words)
- targetChars = ideal length, maxChars = maximum
- Include 2-4 vocabulary words per segment

Segments:
${JSON.stringify(inputSegments, null, 2)}`;

        for (let attempt = 1; attempt <= 3; attempt++) {
          try {
            const result = await model.generateContent([
              { text: systemPrompt },
              { text: userPrompt },
            ]);

            const responseText = result.response.text().trim();
            let jsonStr = responseText;
            if (responseText.includes("```")) {
              const match = responseText.match(/```(?:json)?\s*([\s\S]*?)```/);
              if (match) jsonStr = match[1].trim();
            }

            const parsed = JSON.parse(jsonStr);
            
            // Store results
            for (const seg of parsed) {
              if (typeof seg.idx === "number") {
                const originalSeg = segments[seg.idx];
                const translationKey = `beginner${langDisplay.charAt(0).toUpperCase() + langDisplay.slice(1)}`;
                let translatedText = seg[translationKey] || seg.spanish || seg.translation || "";
                
                // Truncate if exceeds max
                const inputSeg = inputSegments.find(is => is.idx === seg.idx);
                if (inputSeg && translatedText.length > inputSeg.maxChars) {
                  // Find last complete sentence
                  const lastPeriod = translatedText.substring(0, inputSeg.maxChars).lastIndexOf('.');
                  if (lastPeriod > inputSeg.maxChars * 0.6) {
                    translatedText = translatedText.substring(0, lastPeriod + 1);
                  }
                }
                
                results[seg.idx] = {
                  ...originalSeg,
                  index: seg.idx,
                  translatedText,
                  chars: translatedText.length,
                  targetChars: inputSeg?.targetChars,
                  maxChars: inputSeg?.maxChars,
                  vocabulary: seg.vocabulary || [],
                  visualDescription: seg.visualDescription || "",
                  isBeginner: true,
                  level,
                };
              }
            }
            
            console.log(`      ✅ Batch ${globalIdx + 1}/${batches.length}`);
            break;
          } catch (error) {
            if (attempt < 3) {
              await new Promise(r => setTimeout(r, 2000 * attempt));
            } else {
              console.error(`      ❌ Batch ${globalIdx + 1} failed: ${error.message}`);
              // Fill with error fallback
              for (const seg of batch.segments) {
                const idx = batch.offset + batch.segments.indexOf(seg);
                results[idx] = {
                  ...seg,
                  index: idx,
                  translatedText: "[Error]",
                  error: true,
                  vocabulary: [],
                };
              }
            }
          }
        }
      })
    );
  }

  // Filter and validate results
  const validResults = results.filter(r => r && !r.error);
  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);

  // Collect all vocabulary
  const allVocabulary = new Map();
  for (const r of validResults) {
    if (r.vocabulary) {
      for (const v of r.vocabulary) {
        const key = v.word?.toLowerCase();
        if (key && !allVocabulary.has(key)) {
          allVocabulary.set(key, {
            word: v.word,
            translation: v.translation,
            difficulty: v.difficulty,
            firstAppearance: r.start,
            appearances: 1,
          });
        } else if (key) {
          allVocabulary.get(key).appearances++;
        }
      }
    }
  }

  console.log(`\n   ✅ BEGINNER TRANSLATION COMPLETE in ${elapsed}s`);
  console.log(`   📊 ${validResults.length}/${segments.length} segments translated`);
  console.log(`   📚 Vocabulary extracted: ${allVocabulary.size} unique words`);

  // Show top vocabulary
  const topVocab = Array.from(allVocabulary.values())
    .sort((a, b) => b.appearances - a.appearances)
    .slice(0, 10);
  
  if (topVocab.length > 0) {
    console.log(`\n   🔤 Top Vocabulary:`);
    topVocab.forEach((v, i) => {
      console.log(`      ${i + 1}. ${v.word} (${v.translation}) - ${v.appearances}x`);
    });
  }

  // Show sample output
  if (validResults.length > 0 && validResults[0].translatedText) {
    console.log(`\n   📢 Sample output (seg 0):`);
    console.log(`      "${validResults[0].translatedText.substring(0, 80)}${validResults[0].translatedText.length > 80 ? '...' : ''}"`);
    if (validResults[0].vocabulary?.length > 0) {
      console.log(`      Vocab: ${validResults[0].vocabulary.map(v => v.word).join(", ")}`);
    }
  }

  return {
    segments: validResults,
    vocabulary: Array.from(allVocabulary.values()),
    stats: {
      translatedCount: validResults.length,
      totalSegments: segments.length,
      uniqueVocabulary: allVocabulary.size,
      processingTime: parseFloat(elapsed),
    },
  };
}

/**
 * BRAINROT MODE: Summarize content into third-person narration
 * 
 * Instead of translating segment-by-segment, this creates a flowing
 * narration that summarizes what's happening in the video.
 * 
 * Perfect for TikTok-style content with:
 * - Slower, clearer speech
 * - Third-person narration ("The man says...")
 * - Simplified vocabulary
 * - Engaging storytelling tone
 * 
 * @param {array} segments - Original transcription segments
 * @param {object} options - Translation options
 * @returns {Promise<object>} Narration chunks with timing
 */
async function translateBrainrot(segments, options = {}) {
  const {
    level = "A2", // Brainrot is usually for beginners
    targetLanguage = "spanish",
    chunkDuration = 15, // Target duration per narration chunk (seconds)
  } = options;

  const ttsRate = TTS_RATES[targetLanguage.toLowerCase()] || TTS_RATES.spanish;
  const langDisplay = targetLanguage.charAt(0).toUpperCase() + targetLanguage.slice(1);
  const guide = LEVEL_GUIDES[level] || LEVEL_GUIDES.A2;

  console.log(`\n${"═".repeat(60)}`);
  console.log(`🧠 BRAINROT MODE: Summarizing to ${langDisplay} Narration`);
  console.log(`${"═".repeat(60)}`);
  console.log(`   Level: ${level} (${guide.name})`);
  console.log(`   Segments to summarize: ${segments.length}`);

  if (!process.env.GEMINI_API_KEY) {
    throw new Error("GEMINI_API_KEY not set!");
  }

  // Get total video duration
  const totalDuration = segments.length > 0 
    ? segments[segments.length - 1].end 
    : 0;
  
  // Calculate how many narration chunks we need
  const numChunks = Math.max(1, Math.ceil(totalDuration / chunkDuration));
  console.log(`   Video duration: ${totalDuration.toFixed(1)}s`);
  console.log(`   Target chunks: ${numChunks} (~${chunkDuration}s each)`);

  // Group segments into chunks for summarization
  const segmentChunks = [];
  const chunkSize = Math.ceil(segments.length / numChunks);
  
  for (let i = 0; i < segments.length; i += chunkSize) {
    const chunkSegments = segments.slice(i, i + chunkSize);
    const chunkText = chunkSegments.map(s => s.text).join(" ");
    const chunkStart = chunkSegments[0]?.start || 0;
    const chunkEnd = chunkSegments[chunkSegments.length - 1]?.end || chunkStart + chunkDuration;
    
    segmentChunks.push({
      index: segmentChunks.length,
      start: chunkStart,
      end: chunkEnd,
      duration: chunkEnd - chunkStart,
      originalText: chunkText,
    });
  }

  // Build the brainrot prompt
  const systemPrompt = `You are a TikTok narrator creating engaging third-person narration in ${langDisplay}.

YOUR STYLE:
- Narrate like you're telling a story to a friend
- Use third person: "Este hombre dice que...", "Ella explica que..."
- Keep it SIMPLE and ENGAGING for ${level} learners
- Vocabulary: ${guide.vocab}
- Grammar: ${guide.grammar}

CRITICAL RULES:
1. Summarize the key points, don't translate word-for-word
2. Make it flow naturally - this will be spoken aloud
3. Each chunk should be ${Math.round(chunkDuration * ttsRate.charsPerSecond * 0.7)} chars (spoken slowly)
4. Use engaging transitions between ideas
5. Keep the energy up - this is brainrot content!

Return JSON array: [{"idx": N, "narration": "...", "chars": N}, ...]`;

  const model = genAI.getGenerativeModel({
    model: "gemini-2.0-flash",
    generationConfig: {
      temperature: 0.7, // More creative for narration
      maxOutputTokens: 8192, // Increased for longer videos
      responseMimeType: "application/json",
    },
  });

  // Process in batches to avoid token limits
  const BATCH_SIZE = 5; // Process 5 chunks at a time
  const allNarrationSegments = [];
  
  for (let batchStart = 0; batchStart < segmentChunks.length; batchStart += BATCH_SIZE) {
    const batchChunks = segmentChunks.slice(batchStart, batchStart + BATCH_SIZE);
    const batchNum = Math.floor(batchStart / BATCH_SIZE) + 1;
    const totalBatches = Math.ceil(segmentChunks.length / BATCH_SIZE);
    
    console.log(`   📝 Generating narration batch ${batchNum}/${totalBatches}...`);
    
    // Build input for this batch
    const inputChunks = batchChunks.map((chunk, i) => ({
      idx: batchStart + i,
      duration: chunk.duration,
      targetChars: Math.round(chunk.duration * ttsRate.charsPerSecond * 0.7), // 70% for slow speech
      content: chunk.originalText.substring(0, 500), // Limit content length
    }));

    const userPrompt = `Create engaging ${langDisplay} narration for these ${inputChunks.length} video chunks:

${JSON.stringify(inputChunks)}

Remember: Third person, storytelling style, ${level} vocabulary. Make it sound like a TikTok voiceover!`;

    // Retry logic
    let narrationChunks = null;
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        const result = await model.generateContent([
          { text: systemPrompt },
          { text: userPrompt },
        ]);

        const responseText = result.response.text().trim();
        
        // Parse JSON, handle markdown
        let jsonStr = responseText;
        if (responseText.includes("```")) {
          const match = responseText.match(/```(?:json)?\s*([\s\S]*?)```/);
          if (match) jsonStr = match[1].trim();
        }

        // Debug: log if parsing fails
        if (!jsonStr || jsonStr.length < 10) {
          console.log(`      ⚠️ Empty or short response: "${responseText.substring(0, 100)}..."`);
          throw new Error("Empty response from API");
        }

        narrationChunks = JSON.parse(jsonStr);
        
        if (!Array.isArray(narrationChunks)) {
          throw new Error(`Expected array, got ${typeof narrationChunks}`);
        }
        
        break; // Success!
        
      } catch (parseError) {
        console.log(`      ⚠️ Attempt ${attempt}/3 failed: ${parseError.message}`);
        if (attempt < 3) {
          await new Promise(r => setTimeout(r, 2000 * attempt)); // Backoff
        } else {
          // Last resort: create placeholder narration
          console.log(`      ⚠️ Using fallback narration for batch ${batchNum}`);
          narrationChunks = inputChunks.map((chunk, i) => ({
            idx: chunk.idx,
            narration: `En este momento del video...`, // Placeholder
            chars: 30,
          }));
        }
      }
    }

    // Map batch results to our segment structure
    for (const chunk of narrationChunks) {
      const originalChunk = segmentChunks[chunk.idx] || batchChunks[chunk.idx - batchStart];
      allNarrationSegments.push({
        index: chunk.idx,
        start: originalChunk?.start || 0,
        end: originalChunk?.end || chunkDuration,
        duration: originalChunk?.duration || chunkDuration,
        originalText: originalChunk?.originalText || "",
        translatedText: chunk.narration,
        chars: chunk.chars || chunk.narration?.length || 0,
        speaker: "narrator", // Single narrator voice
        isBrainrot: true,
      });
    }
  }

  console.log(`   ✅ Generated ${allNarrationSegments.length} narration chunks`);
  
  // Log sample
  if (allNarrationSegments.length > 0 && allNarrationSegments[0].translatedText) {
    console.log(`   📢 Sample: "${allNarrationSegments[0].translatedText.substring(0, 60)}..."`);
  }

  return {
    segments: allNarrationSegments,
    totalDuration,
    mode: "brainrot",
    level,
    language: targetLanguage,
  };
}

/**
 * CONVERSATION MODE: Translate rapid multi-speaker dialogues
 * 
 * Optimized for rapid back-and-forth conversations (podcasts, interviews, debates).
 * Translates entire conversation blocks together for better context, then splits
 * back into individual speaker turns.
 * 
 * Key features:
 * - Translates blocks with full conversation context
 * - Shorter, punchier translations for rapid exchanges
 * - Preserves speaker turns and timing relationships
 * - Allows TTS timing flexibility for natural flow
 * 
 * @param {object} conversationData - Output from detectConversationBlocks()
 * @param {object} options - Translation options
 * @returns {Promise<object>} Translated conversation with blocks and monologues
 */
async function translateConversation(conversationData, options = {}) {
  const {
    level = "B1",
    targetLanguage = "spanish",
    concurrency = 5,
  } = options;

  const { blocks, monologues, stats: inputStats } = conversationData;
  const guide = LEVEL_GUIDES[level] || LEVEL_GUIDES.B1;
  const ttsRate = TTS_RATES[targetLanguage.toLowerCase()] || TTS_RATES.spanish;
  const langDisplay = targetLanguage.charAt(0).toUpperCase() + targetLanguage.slice(1);

  console.log(`\n${"═".repeat(60)}`);
  console.log(`🗣️ CONVERSATION MODE: ${langDisplay} Translation`);
  console.log(`${"═".repeat(60)}`);
  console.log(`   Level: ${level} (${guide.name})`);
  console.log(`   Conversation blocks: ${blocks.length}`);
  console.log(`   Monologue segments: ${monologues.length}`);
  console.log(`   Conversation time: ${inputStats.conversationTime.toFixed(1)}s`);

  if (!process.env.GEMINI_API_KEY) {
    throw new Error("GEMINI_API_KEY not set!");
  }

  const model = genAI.getGenerativeModel({
    model: "gemini-2.0-flash",
    generationConfig: {
      temperature: 0.3,
      maxOutputTokens: 8192,
      responseMimeType: "application/json",
    },
  });

  const startTime = Date.now();
  const translatedBlocks = [];
  const translatedMonologues = [];

  // ═══════════════════════════════════════════════════════════════
  // STEP 1: Translate conversation blocks with full context
  // ═══════════════════════════════════════════════════════════════
  if (blocks.length > 0) {
    console.log(`\n   📦 Translating ${blocks.length} conversation blocks...`);

    const systemPrompt = `You are translating a rapid conversation between multiple speakers into ${langDisplay} for ${level} learners.

CONVERSATION TRANSLATION RULES:
1. Keep it PUNCHY - rapid dialogue needs SHORT translations
2. Each speaker turn should fit in its time slot (see duration)
3. Preserve the conversational flow and natural back-and-forth
4. Use contractions and casual speech appropriate for conversation
5. ${guide.vocab}
6. ${guide.grammar}

TIMING RULES:
- Each turn has a "duration" - aim for ${ttsRate.charsPerSecond * 0.85} chars per second
- Rapid exchanges (< 1s) need VERY short translations
- Don't sacrifice meaning, but be concise

OUTPUT FORMAT:
Return a JSON array with EXACTLY one object per input turn:
[
  {"turnIdx": 0, "speaker": "SPEAKER_00", "spanish": "translation", "chars": N},
  {"turnIdx": 1, "speaker": "SPEAKER_01", "spanish": "translation", "chars": N},
  ...
]`;

    // Process blocks in parallel batches
    for (let i = 0; i < blocks.length; i += concurrency) {
      const batchBlocks = blocks.slice(i, i + concurrency);

      await Promise.all(batchBlocks.map(async (block) => {
        // Build conversation context
        const turns = block.segments.map((seg, turnIdx) => ({
          turnIdx,
          speaker: seg.speaker,
          duration: seg.end - seg.start,
          targetChars: Math.round((seg.end - seg.start) * ttsRate.charsPerSecond * 0.85),
          text: seg.text,
        }));

        const userPrompt = `Translate this ${block.segments.length}-turn conversation (${block.duration.toFixed(1)}s total):

${JSON.stringify(turns, null, 2)}

Remember: Keep translations SHORT and PUNCHY for natural conversation flow!`;

        for (let attempt = 1; attempt <= 3; attempt++) {
          try {
            const result = await model.generateContent([
              { text: systemPrompt },
              { text: userPrompt },
            ]);

            const responseText = result.response.text().trim();
            let jsonStr = responseText;
            if (responseText.includes("```")) {
              const match = responseText.match(/```(?:json)?\s*([\s\S]*?)```/);
              if (match) jsonStr = match[1].trim();
            }

            const parsed = JSON.parse(jsonStr);
            
            if (!Array.isArray(parsed)) {
              throw new Error("Expected array response");
            }

            // Map translations back to segments
            const translatedSegments = block.segments.map((seg, idx) => {
              const translated = parsed.find(p => p.turnIdx === idx) || parsed[idx];
              const targetChars = Math.round((seg.end - seg.start) * ttsRate.charsPerSecond * 0.85);
              
              let translatedText = translated?.spanish || translated?.translation || "[Error]";
              
              // Truncate if exceeds target by too much
              const maxChars = Math.round(targetChars * 1.2);
              if (translatedText.length > maxChars) {
                const lastSpace = translatedText.substring(0, maxChars).lastIndexOf(' ');
                if (lastSpace > maxChars * 0.6) {
                  translatedText = translatedText.substring(0, lastSpace);
                }
              }

              return {
                ...seg,
                translatedText,
                chars: translatedText.length,
                targetChars,
                isConversation: true,
                conversationBlockIndex: block.index,
              };
            });

            translatedBlocks.push({
              ...block,
              segments: translatedSegments,
              translated: true,
            });

            console.log(`      ✅ Block ${block.index}: ${block.segments.length} turns, ${block.duration.toFixed(1)}s`);
            break;

          } catch (error) {
            if (attempt === 3) {
              console.error(`      ❌ Block ${block.index} failed: ${error.message}`);
              // Fall back to individual segment translation
              const fallbackSegments = block.segments.map(seg => ({
                ...seg,
                translatedText: "[Translation Error]",
                error: true,
                isConversation: true,
                conversationBlockIndex: block.index,
              }));
              translatedBlocks.push({
                ...block,
                segments: fallbackSegments,
                translated: false,
                error: true,
              });
            } else {
              await new Promise(r => setTimeout(r, 2000 * attempt));
            }
          }
        }
      }));

      console.log(`   Progress: ${Math.min(i + concurrency, blocks.length)}/${blocks.length} blocks`);
    }
  }

  // ═══════════════════════════════════════════════════════════════
  // STEP 2: Translate monologue segments (standard translation)
  // ═══════════════════════════════════════════════════════════════
  if (monologues.length > 0) {
    console.log(`\n   📝 Translating ${monologues.length} monologue segments...`);

    // Use standard translation for monologues
    const monoTranslated = await translate(monologues, {
      level,
      batchSize: 10,
      concurrency: 10,
      targetLanguage,
    });

    // Mark as monologue
    monoTranslated.forEach(seg => {
      if (seg) {
        seg.isConversation = false;
        seg.isMonologue = true;
        translatedMonologues.push(seg);
      }
    });
  }

  // ═══════════════════════════════════════════════════════════════
  // STEP 3: Combine and sort all segments
  // ═══════════════════════════════════════════════════════════════
  const allSegments = [
    ...translatedBlocks.flatMap(b => b.segments),
    ...translatedMonologues,
  ].sort((a, b) => a.start - b.start);

  // Re-index
  allSegments.forEach((seg, i) => {
    seg.index = i;
  });

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  const validSegments = allSegments.filter(s => s.translatedText && !s.error);

  console.log(`\n   ✅ CONVERSATION TRANSLATION COMPLETE in ${elapsed}s`);
  console.log(`   📊 Total segments: ${allSegments.length}`);
  console.log(`   🗣️ Conversation turns: ${translatedBlocks.reduce((sum, b) => sum + b.segments.length, 0)}`);
  console.log(`   📝 Monologue segments: ${translatedMonologues.length}`);
  console.log(`   ✅ Valid translations: ${validSegments.length}`);

  // Show sample conversation translation
  if (translatedBlocks.length > 0 && translatedBlocks[0].segments.length > 0) {
    console.log(`\n   📢 Sample conversation translation:`);
    const sampleBlock = translatedBlocks[0];
    sampleBlock.segments.slice(0, 3).forEach(seg => {
      console.log(`      [${seg.speaker}]: "${seg.translatedText?.substring(0, 50)}${seg.translatedText?.length > 50 ? '...' : ''}"`);
    });
  }

  return {
    segments: allSegments,
    blocks: translatedBlocks,
    monologues: translatedMonologues,
    stats: {
      totalSegments: allSegments.length,
      conversationTurns: translatedBlocks.reduce((sum, b) => sum + b.segments.length, 0),
      monologueSegments: translatedMonologues.length,
      validTranslations: validSegments.length,
      processingTime: parseFloat(elapsed),
    },
  };
}

module.exports = {
  translate,
  translateBatch,
  translateBeginner, // NEW: Dreaming Spanish-style beginner content
  translateCharacterPerspective,
  translateConversation, // Rapid multi-speaker dialogue translation
  translateNarrator,
  translateNarratorContinuous, // Continuous narration mode (YouTube dub style)
  translateBrainrot,
  detectGender,
  detectMultipleSpeakerGenders,
  checkApiKey,
  calculateTargetLength,
  LEVEL_GUIDES,
  SPANISH_TTS_RATE,
  TTS_RATES, // Language-specific TTS rates
  XTTS_TTS_RATE, // XTTS voice cloning rate (~14 c/s, same as natural speech)
};
