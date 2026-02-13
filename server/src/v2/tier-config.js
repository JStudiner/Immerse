/**
 * Immersion v2 - Tier Configuration
 * 
 * Defines three service tiers that map to different pipeline settings.
 * Each tier balances speed, cost, and quality differently.
 * 
 * Tier 1: Learner   → Fast/Cheap (Standard TTS, fast separation, A1-A2)
 * Tier 2: Immerser  → Mid-Tier   (Premium TTS, standard Demucs, B1-B2)
 * Tier 3: Pro       → High-Tier  (XTTS cloning, quality Demucs, TikTok, C1)
 */

const TIERS = {
  learner: {
    name: "Learner",
    icon: "📚",
    tagline: "Quick & affordable — understand the gist",
    description: "Fast processing with standard voices. Perfect for beginners who want to understand video content quickly.",
    levels: ["A1", "A2"],
    defaultLevel: "A2",
    
    // Pipeline settings
    ttsProvider: "default",     // Lemonfox standard voices (fast, cheap)
    separationPreset: "fast",   // htdemucs shifts=0 (2-4x faster)
    mode: "synced",             // Direct translation, original timing
    
    // Features available
    features: {
      voiceCloning: false,
      tiktokFormat: false,
      lipsync: false,
      narratorModes: false,
      voiceExtraction: false,
      advancedOptions: false,
      customVoices: false,
    },
    
    // Cost estimate
    estimatedCost: "~$0.05/5min",
    processingTime: "~2 min for 5min video",
  },
  
  immerser: {
    name: "Immerser",
    icon: "🌊",
    tagline: "Premium voices — natural immersion",
    description: "High-quality voices with standard audio separation. Ideal for intermediate learners who want natural-sounding content.",
    levels: ["A1", "A2", "B1", "B2"],
    defaultLevel: "B1",
    
    // Pipeline settings
    ttsProvider: "premium",     // ElevenLabs premium voices
    separationPreset: "standard", // htdemucs shifts=1 (good balance)
    mode: "synced",
    
    // Features available
    features: {
      voiceCloning: false,
      tiktokFormat: false,
      lipsync: false,
      narratorModes: true,      // Can use narrator modes with premium voices
      voiceExtraction: false,
      advancedOptions: true,
      customVoices: true,       // Can choose specific voice presets
    },
    
    // Cost estimate
    estimatedCost: "~$0.50/5min",
    processingTime: "~3 min for 5min video",
  },
  
  pro: {
    name: "Pro",
    icon: "🚀",
    tagline: "Voice cloning + TikTok — full control",
    description: "Clone the original speaker's voice with XTTS, generate TikTok-ready content, and access all advanced features.",
    levels: ["A1", "A2", "B1", "B2", "C1"],
    defaultLevel: "B1",
    
    // Pipeline settings
    ttsProvider: "clone",       // XTTS voice cloning
    separationPreset: "quality", // htdemucs_ft shifts=2 (best quality)
    mode: "synced",
    
    // Features available
    features: {
      voiceCloning: true,
      tiktokFormat: true,
      lipsync: true,
      narratorModes: true,
      voiceExtraction: true,
      advancedOptions: true,
      customVoices: true,
    },
    
    // Cost estimate
    estimatedCost: "~$0.40/5min",
    processingTime: "~5 min for 5min video",
  },
};

/**
 * Get pipeline options for a given tier
 * Maps tier settings to actual pipeline-v2.js options
 */
function getTierPipelineOptions(tierName) {
  const tier = TIERS[tierName];
  if (!tier) {
    console.warn(`Unknown tier: ${tierName}, falling back to 'learner'`);
    return getTierPipelineOptions("learner");
  }
  
  const { SEPARATION_MODELS } = require("./split");
  const preset = SEPARATION_MODELS[tier.separationPreset] || SEPARATION_MODELS.standard;
  
  return {
    // TTS provider flags
    premium: tier.ttsProvider === "premium",
    clone: tier.ttsProvider === "clone",
    
    // Demucs settings (passed to split)
    quality: tier.separationPreset === "quality",
    separationModel: preset.model,
    separationShifts: preset.shifts,
    
    // Default level for this tier
    defaultLevel: tier.defaultLevel,
    
    // Features
    features: tier.features,
    
    // Tier metadata
    tierName,
    tierDisplayName: tier.name,
    tierIcon: tier.icon,
  };
}

/**
 * Determine best tier for a given level
 */
function suggestTier(level) {
  if (["A1", "A2"].includes(level)) return "learner";
  if (["B1", "B2"].includes(level)) return "immerser";
  if (["C1"].includes(level)) return "pro";
  return "immerser"; // default
}

module.exports = {
  TIERS,
  getTierPipelineOptions,
  suggestTier,
};
