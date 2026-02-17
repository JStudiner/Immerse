/**
 * Immersion v2 - Restyle Module (Gemini)
 *
 * Restyiles transcribed text into different voice personas/styles
 * Uses Google Gemini 2.5 Flash for fast, creative text transformation
 *
 * Features:
 * - Preset voice styles (valley girl, gay bestie, British posh, etc.)
 * - Custom prompt support
 * - Translation + restyle combo (e.g., restyle AS Spanish valley girl)
 * - Duration-aware output (keeps text length similar for TTS timing)
 */

const { GoogleGenerativeAI } = require("@google/generative-ai");

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

// ============================================
// VOICE STYLE PRESETS
// ============================================

const VOICE_STYLES = {
  valley_girl: {
    id: "valley_girl",
    name: "Valley Girl",
    emoji: "💅",
    description: "Like, totally! Uptalk, vocal fry, SoCal vibes",
    prompt: `Rewrite this transcript in a Valley Girl speaking style. Rules:
- Add "like", "totally", "oh my god", "literally", "I can't even" naturally
- Use uptalk patterns (statements that sound like questions?)
- Add dramatic reactions: "wait what?!", "I'm dead", "no way"
- Keep the MEANING identical but change HOW it's said
- Sound natural, not a parody. Think real SoCal girl storytelling.`,
    suggestedVoice: "nova",
    suggestedVoicePremium: "emily",
    voiceDescription:
      "A young American woman in her early 20s with a high-pitched, animated voice. Natural Southern California accent with uptalk patterns and vocal fry. Energetic and expressive, like she's telling her best friend a story.",
    styleInstruction:
      "Speak with rising intonation at the end of phrases, animated and expressive, slightly fast pace with dramatic emphasis on key words",
    qwenSpeaker: "vivian",
  },

  gay_bestie: {
    id: "gay_bestie",
    name: "Gay Bestie",
    emoji: "💁‍♂️",
    description: "Sassy, dramatic, reading for filth",
    prompt: `Rewrite this transcript in a sassy gay best friend speaking style. Rules:
- Add flair and drama: "hunty", "period", "slay", "the way I screamed", "chile"
- Use emphatic expressions: "NOT the...", "the audacity", "I'm gagged"
- Add dramatic reactions and commentary
- Keep the MEANING identical but make it fabulous
- Sound natural like real conversation, not a caricature`,
    suggestedVoice: "echo",
    suggestedVoicePremium: "charlie",
    voiceDescription:
      "A young man in his 20s with a bright, expressive voice. Animated and theatrical delivery with dramatic flair. Warm and charismatic, like a sassy best friend dishing tea over brunch.",
    styleInstruction:
      "Speak with dramatic emphasis, animated delivery, varying pitch expressively, drawn-out vowels on key words for effect",
    qwenSpeaker: "dylan",
  },

  british_posh: {
    id: "british_posh",
    name: "British Posh",
    emoji: "🎩",
    description: "Frightfully proper. Pip pip cheerio.",
    prompt: `Rewrite this transcript as if spoken by an extremely posh British person. Rules:
- Add "quite", "rather", "I dare say", "frightfully", "jolly good"
- Use formal constructions: "one might suggest", "it would appear"
- British spellings and expressions: "brilliant", "proper", "spot on"
- Keep the MEANING identical but make it sound upper-class British
- Think David Attenborough meets Hugh Grant`,
    suggestedVoice: "onyx",
    suggestedVoicePremium: "daniel",
    voiceDescription:
      "A refined British man with a deep, authoritative voice. Upper-class Received Pronunciation accent. Measured pacing and distinguished tone, like a BBC documentary narrator or a well-spoken Oxford professor.",
    styleInstruction:
      "Speak with measured pacing, authoritative and composed, with subtle dry humor in the delivery",
    qwenSpeaker: "eric",
  },

  southern: {
    id: "southern",
    name: "Southern Belle",
    emoji: "🤠",
    description: "Y'all fixin' to hear some sweet tea wisdom",
    prompt: `Rewrite this transcript in a thick Southern US accent/dialect. Rules:
- Add "y'all", "fixin' to", "bless your heart", "I reckon"
- Use Southern expressions: "might could", "over yonder", "all get-out"
- Add warmth and folksy charm
- Keep the MEANING identical but make it sound Southern
- Think warm storytelling on a porch`,
    suggestedVoice: "adam",
    suggestedVoicePremium: "josh",
    voiceDescription:
      "A warm, friendly person with a thick Southern US drawl. Rich and inviting voice, like someone telling stories on a front porch in the Deep South. Unhurried, folksy, and genuine.",
    styleInstruction:
      "Speak with a warm, unhurried drawl, friendly and inviting, with natural pauses like porch-side storytelling",
    qwenSpeaker: "ryan",
  },

  shakespeare: {
    id: "shakespeare",
    name: "Shakespearean",
    emoji: "🎭",
    description: "Hark! Forsooth, what content through yonder screen breaks?",
    prompt: `Rewrite this transcript in Shakespearean/Early Modern English. Rules:
- Use thee, thou, hath, doth, forsooth, hark, prithee
- Use archaic sentence structures: "'Tis", "Wherefore", "Methinks"  
- Add dramatic flair befitting the Bard
- Keep the MEANING identical but make it sound Elizabethan
- Make it fun and dramatic, not boring academic English`,
    suggestedVoice: "onyx",
    suggestedVoicePremium: "paul",
    voiceDescription:
      "A deep, commanding male voice with theatrical projection, like a seasoned Shakespearean stage actor performing a soliloquy. Rich timbre with dramatic gravitas and natural stage presence.",
    styleInstruction:
      "Speak with theatrical grandeur, dramatic pauses, powerful emphasis on key words, like performing on stage at the Globe Theatre",
    qwenSpeaker: "eric",
  },

  surfer_dude: {
    id: "surfer_dude",
    name: "Surfer Dude",
    emoji: "🏄",
    description: "Gnarly bro, totally tubular vibes",
    prompt: `Rewrite this transcript as a laid-back surfer dude. Rules:
- Add "dude", "bro", "gnarly", "radical", "stoked", "vibes"
- Use relaxed speech: "like", "you know", "for real"
- Everything is either "sick" or "chill"
- Keep the MEANING identical but make it sound like a surfer telling a story
- Relaxed, positive, good vibes only`,
    suggestedVoice: "adam",
    suggestedVoicePremium: "liam",
    voiceDescription:
      "A laid-back young man with a relaxed, mellow California surfer voice. Easy-going and chill delivery, like a guy telling a story between waves at the beach. Warm and positive energy.",
    styleInstruction:
      "Speak slowly and relaxed, chill and mellow, with a positive laidback energy, natural pauses between thoughts",
    qwenSpeaker: "aiden",
  },

  news_anchor: {
    id: "news_anchor",
    name: "News Anchor",
    emoji: "📺",
    description: "Breaking news: someone said something interesting",
    prompt: `Rewrite this transcript in the style of a dramatic news anchor. Rules:
- Add "Breaking:", "Sources say", "In a stunning development"
- Use news language: "reportedly", "allegedly", "experts confirm"
- Add dramatic pauses and emphasis indicators
- Keep the MEANING identical but present it like breaking news
- Think serious CNN anchor with a flair for the dramatic`,
    suggestedVoice: "onyx",
    suggestedVoicePremium: "drew",
    voiceDescription:
      "A polished, authoritative news anchor with a deep, commanding voice. Clear and professional diction with dramatic gravitas, like a veteran CNN or BBC correspondent delivering breaking news.",
    styleInstruction:
      "Speak with authority and urgency, clear and professional, deliberate pacing with emphasis on key developments",
    qwenSpeaker: "eric",
  },

  gen_z: {
    id: "gen_z",
    name: "Gen Z",
    emoji: "📱",
    description: "No cap, this slaps fr fr. It's giving main character.",
    prompt: `Rewrite this transcript in Gen Z internet speak. Rules:
- Use current slang: "no cap", "fr fr", "it's giving", "slay", "bussin"
- Add reactions: "I'm dead", "crying rn", "help", "screaming"
- Use "lowkey", "highkey", "the vibes are immaculate"
- Keep the MEANING identical but make it sound like a Gen Z person
- Natural, not try-hard. Think actual TikTok narration.`,
    suggestedVoice: "jessica",
    suggestedVoicePremium: "emily",
    voiceDescription:
      "A young person in their late teens or early 20s with a casual, internet-native voice. Natural and conversational, like someone narrating a TikTok or talking to their group chat on speaker.",
    styleInstruction:
      "Speak casually and naturally, conversational pace, with emphasis on slang words, like you're talking to your friends",
    qwenSpeaker: "serena",
  },

  spanish_translation: {
    id: "spanish_translation",
    name: "Spanish",
    emoji: "🇪🇸",
    description: "Translate to natural conversational Spanish",
    prompt: `Translate this transcript to natural conversational Spanish. Rules:
- Use everyday conversational Spanish (not formal/textbook)
- Keep the tone and energy of the original
- Use common expressions and slang where natural
- Maintain the same meaning and emotional impact`,
    suggestedVoice: "noel",
    suggestedVoicePremium: "adam",
    isTranslation: true,
    voiceDescription:
      "A native Spanish speaker with a warm, natural voice. Clear conversational delivery with natural rhythm and intonation.",
    styleInstruction: "Speak naturally and conversationally in Spanish",
    qwenSpeaker: "aiden",
  },

  french_translation: {
    id: "french_translation",
    name: "French",
    emoji: "🇫🇷",
    description: "Translate to natural conversational French",
    prompt: `Translate this transcript to natural conversational French. Rules:
- Use everyday conversational French
- Keep the tone and energy of the original
- Use common expressions where natural
- Maintain the same meaning and emotional impact`,
    suggestedVoice: "nova",
    suggestedVoicePremium: "charlotte",
    isTranslation: true,
    voiceDescription:
      "A native French speaker with a smooth, elegant voice. Natural Parisian accent with warm, conversational delivery.",
    styleInstruction: "Speak naturally and conversationally in French",
    qwenSpeaker: "serena",
  },
};

/**
 * Restyle a transcript using Gemini
 * Takes segments from Whisper transcription and restyiles them
 *
 * @param {array} segments - Array of { text, start, end, speaker } segments
 * @param {object} options - { style, customPrompt, batchSize, concurrency }
 * @returns {Promise<array>} Array of restyled segments with original + restyled text
 */
async function restyleTranscript(segments, options = {}) {
  const {
    style = "valley_girl",
    customPrompt = null,
    batchSize = 30,
    concurrency = 5,
  } = options;

  const styleConfig = VOICE_STYLES[style] || {
    name: "Custom",
    emoji: "✨",
    prompt: "Repeat the transcript exactly as-is, preserving all meaning and tone.",
  };
  const promptText = customPrompt || styleConfig.prompt;

  console.log(`\n${"═".repeat(60)}`);
  console.log(`🎨 RESTYLE: ${styleConfig.name || "Custom"}`);
  console.log(`${"═".repeat(60)}`);
  console.log(
    `   Style: ${styleConfig.emoji || "✨"} ${styleConfig.name || "Custom Prompt"}`,
  );
  console.log(`   Input segments: ${segments.length}`);
  console.log(`   Batch size: ${batchSize}`);

  // Build batches
  const batches = [];
  for (let i = 0; i < segments.length; i += batchSize) {
    batches.push(segments.slice(i, i + batchSize));
  }
  console.log(`   Batches: ${batches.length}`);

  // Process batches with concurrency
  const allResults = [];
  for (let i = 0; i < batches.length; i += concurrency) {
    const batchGroup = batches.slice(i, i + concurrency);
    const promises = batchGroup.map((batch, batchIdx) =>
      restyleBatch(batch, promptText, i + batchIdx, batches.length),
    );

    const results = await Promise.all(promises);
    for (const result of results) {
      allResults.push(...result);
    }
  }

  // Merge results back with original segments
  const restyledSegments = segments.map((seg, idx) => {
    const restyled = allResults.find((r) => r.idx === idx);
    return {
      ...seg,
      originalText: seg.text,
      restyledText: restyled?.restyled || seg.text,
      // For pipeline compatibility
      translatedText: restyled?.restyled || seg.text,
      targetChars: seg.text.length,
    };
  });

  const successCount = restyledSegments.filter(
    (s) => s.restyledText !== s.originalText,
  ).length;
  console.log(`\n   ✅ Restyled ${successCount}/${segments.length} segments`);

  return restyledSegments;
}

/**
 * Restyle a batch of segments via Gemini
 */
async function restyleBatch(segments, stylePrompt, batchIdx, totalBatches) {
  const model = genAI.getGenerativeModel({
    model: "gemini-2.0-flash",
    generationConfig: {
      temperature: 0.9, // Higher temp for creative restyling
      maxOutputTokens: 8192,
    },
  });

  // Build segment list for the prompt
  const segmentList = segments
    .map((seg, i) => `[${i}] (${seg.text.length} chars): "${seg.text}"`)
    .join("\n");

  const prompt = `${stylePrompt}

IMPORTANT RULES:
1. Keep roughly the SAME LENGTH (±20% character count) as the original - this is critical for audio timing
2. Preserve the core meaning - we're changing HOW it's said, not WHAT is said
3. Every segment must get a restyled version, even if short

Here are the transcript segments to restyle:

${segmentList}

Return ONLY a JSON array with this exact format, no other text:
[{"idx": 0, "restyled": "restyled text here", "chars": 42}, ...]`;

  try {
    const result = await model.generateContent(prompt);
    const responseText = result.response.text();

    // Extract JSON from response
    const jsonMatch = responseText.match(/\[[\s\S]*\]/);
    if (!jsonMatch) {
      console.log(
        `      ⚠️ Batch ${batchIdx + 1}/${totalBatches}: No JSON found in response`,
      );
      return segments.map((seg, i) => ({
        idx: batchIdx * segments.length + i,
        restyled: seg.text,
      }));
    }

    const parsed = JSON.parse(jsonMatch[0]);
    console.log(
      `      ✅ Batch ${batchIdx + 1}/${totalBatches}: ${parsed.length} segments restyled`,
    );

    // Map back to global indices
    return parsed.map((item) => ({
      idx: item.idx,
      restyled: item.restyled || item.spanish || item.text,
      chars: item.chars,
    }));
  } catch (err) {
    console.log(
      `      ❌ Batch ${batchIdx + 1}/${totalBatches} failed: ${err.message}`,
    );
    // Return originals on failure
    return segments.map((seg, i) => ({
      idx: i,
      restyled: seg.text,
    }));
  }
}

/**
 * Get suggested voice for a style
 */
function getSuggestedVoice(styleId, premium = false) {
  const style = VOICE_STYLES[styleId];
  if (!style) return premium ? "adam" : "nova";
  return premium ? style.suggestedVoicePremium : style.suggestedVoice;
}

module.exports = {
  restyleTranscript,
  getSuggestedVoice,
  VOICE_STYLES,
};
