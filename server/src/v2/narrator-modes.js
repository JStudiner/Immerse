/**
 * Narrator Modes Configuration
 * 
 * Defines different narrator styles for the Immersion pipeline:
 * 
 * 1. CLONE_SPEAKER - Clone the original speaker's voice (1st person)
 *    - Uses XTTS to clone the main speaker
 *    - Speaks as if they are the original person
 *    - Best for: Monologues, vlogs, educational content
 * 
 * 2. THIRD_PARTY - External narrator voice (3rd person)
 *    - Uses a preset voice or custom voice file
 *    - Speaks about the content ("He says...", "They explain...")
 *    - Best for: Movie recaps, news, documentaries
 * 
 * 3. STORYTELLER - Hybrid approach
 *    - Narrates action/scene in 3rd person
 *    - Quotes dialogue in 1st person
 *    - Best for: Fiction, stories, dramas
 */

// Voice presets for third-party narration
const NARRATOR_VOICES = {
  // Male voices (Lemonfox preset)
  male: {
    neutral: "noel",       // Neutral male narrator
    warm: "brian",         // Warm, friendly tone
    authoritative: "david", // News anchor style
  },
  // Female voices (Lemonfox preset)
  female: {
    neutral: "kimberly",   // Neutral female narrator
    warm: "emma",          // Warm, conversational
    professional: "helen", // Formal, documentary style
  },
  // Spanish-specific voices (ElevenLabs premium)
  spanish: {
    male: "adam",          // Native Spanish male
    female: "aria",        // Native Spanish female
  },
};

// Narrator mode configurations
const NARRATOR_MODES = {
  /**
   * CLONE_SPEAKER: Clone the original speaker's voice
   * The translated content speaks as if it IS the original person
   */
  clone_speaker: {
    id: "clone_speaker",
    name: "Clone Speaker (1st Person)",
    description: "Clones the original speaker's voice using XTTS. Speaks as the original person.",
    ttsProvider: "xtts",           // Use XTTS voice cloning
    voiceSource: "video",          // Extract from input video
    perspective: "first",          // 1st person narration
    translationStyle: "direct",    // Direct speech translation
    
    // Translation prompts
    promptHints: {
      style: "Translate as if YOU are the speaker. Use 1st person (I, me, my).",
      example: "EN: 'I went to the store' → ES: 'Fui a la tienda'",
    },
    
    // When to use this mode
    bestFor: ["vlogs", "tutorials", "monologues", "podcasts", "interviews"],
    
    // Limitations
    limitations: [
      "Requires clear speech in source video for good clone",
      "XTTS speaks slower than preset voices",
      "May need speed adjustment for fast speakers",
    ],
  },

  /**
   * THIRD_PARTY: External narrator describes what happens
   * Like a movie recap or documentary narrator
   */
  third_party: {
    id: "third_party",
    name: "Third Party Narrator",
    description: "An external narrator describes what happens in 3rd person.",
    ttsProvider: "lemonfox",       // Use Lemonfox preset voices
    voiceSource: "preset",         // Use preset voice
    perspective: "third",          // 3rd person narration
    translationStyle: "descriptive", // Descriptive narration
    
    // Translation prompts
    promptHints: {
      style: "Narrate in 3rd person describing what happens. Use 'he/she/they'.",
      example: "EN: 'I went to the store' → ES: 'Él fue a la tienda'",
    },
    
    bestFor: ["movies", "documentaries", "news", "recaps", "explainers"],
    
    limitations: [
      "Voice doesn't match original speaker",
      "Can feel disconnected from content",
    ],
  },

  /**
   * CUSTOM_NARRATOR: Use a custom voice file
   * For branding or specific narrator requirements
   */
  custom_narrator: {
    id: "custom_narrator",
    name: "Custom Narrator Voice",
    description: "Use a custom voice file for XTTS cloning.",
    ttsProvider: "xtts",
    voiceSource: "custom",         // Requires voicePath option
    perspective: "configurable",   // Can be 1st or 3rd
    translationStyle: "configurable",
    
    promptHints: {
      style: "Configured based on perspective option",
    },
    
    bestFor: ["branded content", "specific narrator requirements", "audiobooks"],
    
    limitations: [
      "Requires high-quality voice sample (6-30s)",
      "XTTS speaks slower than preset voices",
    ],
  },

  /**
   * STORYTELLER: Hybrid narrator for fiction
   * Narrates action in 3rd person, quotes dialogue directly
   */
  storyteller: {
    id: "storyteller",
    name: "Storyteller (Hybrid)",
    description: "Narrates action in 3rd person but quotes dialogue in 1st person.",
    ttsProvider: "lemonfox",       // Fast preset voices
    voiceSource: "preset",
    perspective: "hybrid",
    translationStyle: "narrative",
    
    promptHints: {
      style: "Narrate like a storyteller. Action in 3rd person, dialogue in quotes.",
      example: "EN: 'John said, I need help!' → ES: 'Juan dijo: \"¡Necesito ayuda!\"'",
    },
    
    bestFor: ["fiction", "stories", "audio dramas", "books"],
    
    limitations: [
      "More complex translation required",
      "May not suit all content types",
    ],
  },
};

/**
 * Get narrator mode configuration
 */
function getNarratorMode(modeId) {
  const mode = NARRATOR_MODES[modeId];
  if (!mode) {
    console.warn(`Unknown narrator mode: ${modeId}, defaulting to third_party`);
    return NARRATOR_MODES.third_party;
  }
  return mode;
}

/**
 * Get default voice for a narrator mode
 */
function getDefaultVoice(modeId, gender = "male", language = "spanish") {
  const mode = getNarratorMode(modeId);
  
  if (mode.ttsProvider === "xtts") {
    // XTTS uses cloned voice, no preset
    return null;
  }
  
  // For Lemonfox, use language-appropriate voice
  if (language === "spanish" && NARRATOR_VOICES.spanish[gender]) {
    return NARRATOR_VOICES.spanish[gender];
  }
  
  return NARRATOR_VOICES[gender]?.neutral || "noel";
}

/**
 * Build translation prompt based on narrator mode
 */
function buildNarratorPrompt(mode, options = {}) {
  const config = typeof mode === "string" ? getNarratorMode(mode) : mode;
  const { characterName = null, perspective = config.perspective } = options;
  
  let perspectiveInstructions = "";
  
  switch (perspective) {
    case "first":
      perspectiveInstructions = `
Translate in FIRST PERSON (yo, me, mi).
Speak AS IF you are the original speaker.
Do NOT add "he says" or "she explains" - just translate directly.`;
      break;
      
    case "third":
      perspectiveInstructions = `
Translate in THIRD PERSON (él, ella, ellos).
Describe what happens as an external narrator.
Example: "John goes to the store" → "Juan va a la tienda"`;
      if (characterName) {
        perspectiveInstructions += `\nRefer to the main character as "${characterName}".`;
      }
      break;
      
    case "hybrid":
      perspectiveInstructions = `
Use HYBRID narration style:
- Describe actions in 3rd person: "Ella camina hacia la puerta"
- Quote dialogue in 1st person with quotation marks: "Ella dice: 'Necesito irme'"`;
      break;
      
    default:
      perspectiveInstructions = config.promptHints?.style || "";
  }
  
  return perspectiveInstructions.trim();
}

/**
 * Validate narrator mode options
 */
function validateNarratorOptions(modeId, options = {}) {
  const mode = getNarratorMode(modeId);
  const errors = [];
  
  // Check if custom voice is required but not provided
  if (mode.voiceSource === "custom" && !options.voicePath) {
    errors.push("custom_narrator mode requires voicePath option");
  }
  
  // Check if XTTS is needed but not available
  if (mode.ttsProvider === "xtts") {
    if (!process.env.REPLICATE_API_TOKEN && !process.env.REPLICATE_API_KEY) {
      errors.push("XTTS (clone_speaker) requires REPLICATE_API_TOKEN");
    }
  }
  
  return {
    valid: errors.length === 0,
    errors,
    mode,
  };
}

/**
 * List available narrator modes
 */
function listNarratorModes() {
  return Object.values(NARRATOR_MODES).map(mode => ({
    id: mode.id,
    name: mode.name,
    description: mode.description,
    ttsProvider: mode.ttsProvider,
    perspective: mode.perspective,
    bestFor: mode.bestFor,
  }));
}

module.exports = {
  NARRATOR_MODES,
  NARRATOR_VOICES,
  getNarratorMode,
  getDefaultVoice,
  buildNarratorPrompt,
  validateNarratorOptions,
  listNarratorModes,
};
