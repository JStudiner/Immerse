const { GoogleGenerativeAI } = require("@google/generative-ai");

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

/**
 * Level descriptions for the prompt
 * Based on CEFR levels adapted for Comprehensible Input
 */
const LEVEL_GUIDES = {
  A1: {
    name: "Superbeginner",
    vocab: "Only the 500 most common words",
    grammar: 'Present tense only. No subjunctive. "Yo tengo", "Él va".',
    style: "Extremely simple. Short sentences (5-8 words). Repeat key words.",
    example:
      '"The sophisticated technology enables rapid communication" → "Esta cosa es para hablar. Tú puedes hablar con personas. Es muy rápido."',
  },
  A2: {
    name: "Beginner",
    vocab: "Top 1500 common words",
    grammar:
      "Present tense, simple past (pretérito). Basic connectors (y, pero, porque).",
    style:
      "Simple explanations. 8-12 word sentences. Explain idioms literally.",
    example:
      '"He kicked the bucket" → "Él murió. Esta frase significa que alguien murió."',
  },
  B1: {
    name: "Intermediate",
    vocab: "Top 3000 words. Can use some technical terms if explained.",
    grammar: "All indicative tenses. Simple subjunctive in common phrases.",
    style: "Natural flow. Can use some idioms if common. 12-18 word sentences.",
    example: "Can handle news broadcasts with some simplification.",
  },
  B2: {
    name: "Upper Intermediate",
    vocab: "Wide vocabulary. Technical terms okay with brief context.",
    grammar: "Full grammar including subjunctive, conditionals.",
    style: "Near-native but clear articulation. Avoid heavy slang.",
    example: "Can handle documentaries and podcasts.",
  },
  C1: {
    name: "Advanced",
    vocab: "Full vocabulary including idioms and colloquialisms.",
    grammar: "Complete grammar. Regional variations okay.",
    style: "Native-like. Can include wordplay and cultural references.",
    example: "Full native content, just translated.",
  },
};

/**
 * Build the system prompt for the given level
 */
function buildSystemPrompt(level) {
  const guide = LEVEL_GUIDES[level];

  return `You are "Immersion AI" - a specialized interpreter creating Comprehensible Input content for Spanish learners.

TARGET LEVEL: ${level} (${guide.name})

YOUR MISSION:
Transform English content into Spanish that a ${level} learner can understand through context and simple language. This is NOT translation - it's RE-INTERPRETATION for acquisition.

LEVEL ${level} CONSTRAINTS:
- Vocabulary: ${guide.vocab}
- Grammar: ${guide.grammar}
- Style: ${guide.style}
- Example: ${guide.example}

CRITICAL RULES:
1. MEANING OVER WORDS: Convey the MEANING, not literal translation. If something is complex, explain it simply.
2. **DURATION MATCHING**: Your Spanish output will replace the original audio for each segment.
   - Match the WORD COUNT of each segment (±10%)
   - Spanish is spoken ~10% faster than English, so aim for SAME or SLIGHTLY MORE words
3. NO ENGLISH: Output ONLY Spanish. Never include English words unless they're loanwords used in Spanish (like "internet", "marketing").
4. NATURAL SPEECH: Write for SPEAKING, not reading. Use contractions, natural flow.
5. CONTEXT PRESERVATION: If the speaker is excited, be excited. If they're explaining, explain clearly.

OUTPUT FORMAT:
You will receive a JSON array of segments with timing info. Return a JSON array with the SAME indices, containing only the Spanish text for each segment.

Input format: [{"idx": 0, "start": 0.0, "end": 5.2, "text": "English text..."}, ...]
Output format: [{"idx": 0, "spanish": "Spanish text..."}, ...]

Return ONLY valid JSON. No markdown, no explanation, no code fences.`;
}

/**
 * Simplify a batch of chunks in one API call (with retry)
 */
async function simplifyBatch(chunks, level, batchOffset = 0, maxRetries = 3) {
  const model = genAI.getGenerativeModel({
    model: "gemini-2.5-flash",
    generationConfig: {
      temperature: 0.7,
      maxOutputTokens: 16384,
      responseMimeType: "application/json",
    },
  });

  const systemPrompt = buildSystemPrompt(level);

  const inputSegments = chunks.map((chunk, i) => ({
    idx: batchOffset + i,
    start: chunk.start,
    end: chunk.end,
    wordCount: chunk.text.split(/\s+/).length,
    text: chunk.text,
  }));

  const userPrompt = `Translate these ${
    chunks.length
  } segments. Return JSON array with idx and spanish fields.

${JSON.stringify(inputSegments)}`;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const result = await model.generateContent([
        { text: systemPrompt },
        { text: userPrompt },
      ]);

      const responseText = result.response.text().trim();
      return JSON.parse(responseText);
    } catch (error) {
      if (attempt < maxRetries) {
        console.log(`      ⚠️ Attempt ${attempt} failed, retrying...`);
        await new Promise((r) => setTimeout(r, 1000 * attempt)); // backoff
      } else {
        throw error;
      }
    }
  }
}

/**
 * Simplify all chunks in batches (parallel for speed, avoids truncation)
 */
async function simplifyAllChunks(chunks, level, batchSize = 10) {
  console.log(
    `\n🧠 Simplifying ${chunks.length} chunks to level ${level} (batches of ${batchSize})...\n`
  );

  const results = new Array(chunks.length);
  const batches = [];

  // Create batches
  for (let i = 0; i < chunks.length; i += batchSize) {
    batches.push({
      chunks: chunks.slice(i, i + batchSize),
      offset: i,
    });
  }

  console.log(`  ⚡ Processing ${batches.length} batches in parallel...`);
  const startTime = Date.now();

  // Process all batches in parallel
  const batchResults = await Promise.all(
    batches.map(async (batch, batchIdx) => {
      try {
        const spanishSegments = await simplifyBatch(
          batch.chunks,
          level,
          batch.offset
        );
        console.log(`    ✅ Batch ${batchIdx + 1}/${batches.length} done`);
        return {
          success: true,
          segments: spanishSegments,
          offset: batch.offset,
        };
      } catch (error) {
        console.error(`    ❌ Batch ${batchIdx + 1} failed: ${error.message}`);
        return {
          success: false,
          offset: batch.offset,
          chunks: batch.chunks,
        };
      }
    })
  );

  // Combine results
  for (const batchResult of batchResults) {
    if (batchResult.success) {
      for (const seg of batchResult.segments) {
        const chunkIdx = seg.idx;
        const chunk = chunks[chunkIdx];
        results[chunkIdx] = {
          index: chunkIdx,
          originalText: chunk.text,
          spanishText: seg.spanish,
          start: chunk.start,
          end: chunk.end,
          duration: chunk.duration,
        };
      }
    } else {
      // Mark failed chunks
      for (let i = 0; i < batchResult.chunks.length; i++) {
        const chunkIdx = batchResult.offset + i;
        const chunk = chunks[chunkIdx];
        results[chunkIdx] = {
          index: chunkIdx,
          originalText: chunk.text,
          spanishText: "[ERROR: Translation failed]",
          start: chunk.start,
          end: chunk.end,
          duration: chunk.duration,
        };
      }
    }
  }

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log(`\n✅ All ${chunks.length} chunks simplified in ${elapsed}s!\n`);
  return results;
}

/**
 * Merge very short segments with neighbors to avoid choppy TTS
 * Segments shorter than minDuration get merged with the next segment
 */
function mergeShortSegments(segments, minDuration = 1.0) {
  const merged = [];
  let current = null;

  for (const seg of segments) {
    if (!current) {
      current = { ...seg };
      continue;
    }

    // If current segment is too short, merge with next
    if (current.duration < minDuration) {
      current.text += " " + seg.text;
      current.end = seg.end;
      current.duration = current.end - current.start;
    } else {
      merged.push(current);
      current = { ...seg };
    }
  }

  // Don't forget the last segment
  if (current) {
    merged.push(current);
  }

  return merged;
}

/**
 * Simplify all segments (fine-grained timing)
 * This processes individual transcript segments instead of chunks
 * for much better audio sync (2-5 second precision instead of 20 second)
 */
async function simplifyAllSegments(segments, level, batchSize = 25) {
  // First, merge very short segments to avoid choppy TTS
  const processedSegments = mergeShortSegments(segments, 1.0);

  console.log(
    `\n🧠 Simplifying ${processedSegments.length} segments to level ${level} (from ${segments.length} original)...\n`
  );
  console.log(`   Batching ${batchSize} segments per API call for context\n`);

  const results = new Array(processedSegments.length);
  const batches = [];

  // Create batches - we batch for API efficiency but keep segment-level output
  for (let i = 0; i < processedSegments.length; i += batchSize) {
    batches.push({
      segments: processedSegments.slice(i, i + batchSize),
      offset: i,
    });
  }

  console.log(`  ⚡ Processing ${batches.length} batches...`);
  const startTime = Date.now();

  // Process batches (can parallelize but be mindful of rate limits)
  const concurrency = 3; // Limit parallel batches to avoid rate limits
  for (let i = 0; i < batches.length; i += concurrency) {
    const batchGroup = batches.slice(i, i + concurrency);

    const batchResults = await Promise.all(
      batchGroup.map(async (batch, localIdx) => {
        const globalIdx = i + localIdx;
        try {
          const spanishSegments = await simplifyBatch(
            batch.segments,
            level,
            batch.offset
          );
          console.log(
            `    ✅ Batch ${globalIdx + 1}/${batches.length} done (${
              batch.segments.length
            } segments)`
          );
          return {
            success: true,
            segments: spanishSegments,
            offset: batch.offset,
            originalSegments: batch.segments,
          };
        } catch (error) {
          console.error(
            `    ❌ Batch ${globalIdx + 1} failed: ${error.message}`
          );
          return {
            success: false,
            offset: batch.offset,
            segments: batch.segments,
          };
        }
      })
    );

    // Combine results
    for (const batchResult of batchResults) {
      if (batchResult.success) {
        for (const seg of batchResult.segments) {
          const segIdx = seg.idx;
          const originalSeg = processedSegments[segIdx];
          results[segIdx] = {
            index: segIdx,
            originalText: originalSeg.text,
            spanishText: seg.spanish,
            start: originalSeg.start,
            end: originalSeg.end,
            duration: originalSeg.duration,
          };
        }
      } else {
        // Mark failed segments
        for (let j = 0; j < batchResult.segments.length; j++) {
          const segIdx = batchResult.offset + j;
          const originalSeg = processedSegments[segIdx];
          results[segIdx] = {
            index: segIdx,
            originalText: originalSeg.text,
            spanishText: "[ERROR: Translation failed]",
            start: originalSeg.start,
            end: originalSeg.end,
            duration: originalSeg.duration,
          };
        }
      }
    }
  }

  // Filter out any null results (shouldn't happen but be safe)
  const validResults = results.filter((r) => r !== null && r !== undefined);

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log(
    `\n✅ All ${validResults.length} segments simplified in ${elapsed}s!\n`
  );

  return validResults;
}

/**
 * Detect speaker gender from transcript
 * Returns "male", "female", or "mixed"
 */
async function detectSpeakerGender(fullTranscript) {
  console.log(`\n🔍 Detecting speaker gender...`);

  const model = genAI.getGenerativeModel({
    model: "gemini-2.5-flash",
    generationConfig: {
      temperature: 0,
      maxOutputTokens: 100,
      responseMimeType: "application/json",
    },
  });

  const prompt = `Analyze this transcript and determine the speaker's gender based on context clues (names mentioned, pronouns used about the speaker, topics, speech patterns, etc).

Transcript excerpt:
"${fullTranscript.substring(0, 2000)}"

Respond with JSON: {"gender": "male" | "female" | "mixed", "confidence": "high" | "medium" | "low", "reason": "brief explanation"}`;

  try {
    const result = await model.generateContent(prompt);
    const response = JSON.parse(result.response.text().trim());
    console.log(
      `   Speaker: ${response.gender} (${response.confidence} confidence)`
    );
    console.log(`   Reason: ${response.reason}\n`);
    return response.gender;
  } catch (error) {
    console.log(`   Could not detect gender, defaulting to male`);
    return "male";
  }
}

/**
 * Simplify a single text block (for audio-only mode)
 * No timing constraints, just natural translation
 */
async function simplifyText(text, level, maxRetries = 3) {
  const guide = LEVEL_GUIDES[level];

  const model = genAI.getGenerativeModel({
    model: "gemini-2.5-flash",
    generationConfig: {
      temperature: 0.7,
      maxOutputTokens: 8192,
    },
  });

  const prompt = `You are "Immersion AI" creating Comprehensible Input for Spanish learners at level ${level} (${guide.name}).

TARGET LEVEL ${level} CONSTRAINTS:
- Vocabulary: ${guide.vocab}
- Grammar: ${guide.grammar}
- Style: ${guide.style}

TASK: Transform this English text into natural, flowing Spanish that a ${level} learner can understand. This is for AUDIO listening, so:
- Write for natural speech flow
- Use appropriate punctuation for pauses
- Keep the meaning but simplify complex ideas
- NO English words (except loanwords like "internet")

ENGLISH TEXT:
${text}

OUTPUT: Return ONLY the Spanish text. No explanations, no markdown, just the Spanish.`;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const result = await model.generateContent(prompt);
      return result.response.text().trim();
    } catch (error) {
      if (attempt < maxRetries) {
        console.log(`      ⚠️ Attempt ${attempt} failed, retrying...`);
        await new Promise((r) => setTimeout(r, 1000 * attempt));
      } else {
        throw error;
      }
    }
  }
}

module.exports = {
  simplifyAllChunks,
  simplifyAllSegments,
  simplifyText,
  mergeShortSegments,
  detectSpeakerGender,
  LEVEL_GUIDES,
};
