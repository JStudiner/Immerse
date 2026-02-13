/**
 * Immersion v2 - Module Exports
 *
 * Multi-speaker dubbing pipeline with:
 * - Audio separation (Demucs via Replicate)
 * - Speech-to-text with diarization (Lemonfox Whisper)
 * - AI translation (Gemini)
 * - Text-to-speech (Lemonfox + ElevenLabs Premium)
 * - Temporal alignment (FFmpeg)
 * - Video stretching for extended mode
 * - AI Lip-sync (Sync Labs)
 * - Scene Analysis (Gemini Vision) - NEW
 * - Beginner Content Generation (Dreaming Spanish style) - NEW
 * - Conversation Mode (rapid multi-speaker dialogue) - NEW
 * 
 * Output Modes:
 * - SYNCED: Intermediate translation (B1/B2) with original video timing
 * - LEARNER: Slower TTS for comprehension, audio-only
 * - EXTENDED: Full translation with video stretched to fit
 * - LIPSYNC: Natural TTS + AI lip-sync to match audio
 * - BEGINNER: Dreaming Spanish-style with visual aids and repetition
 * - CONVERSATION: Optimized for rapid multi-speaker dialogue
 */

const ingest = require("./ingest");
const split = require("./split");
const transcribe = require("./transcribe");
const translate = require("./translate");
const tts = require("./tts");
const merge = require("./merge");
const stretch = require("./stretch");
const lipsync = require("./lipsync");
const xtts = require("./xtts");
const sceneAnalyzer = require("./scene-analyzer");
const beginnerOverlay = require("./beginner-overlay");
const voiceExtract = require("./voice-extract");
const narratorModes = require("./narrator-modes");
const rateLimiter = require("./rate-limiter");
const tiktokHooks = require("./tiktok-hooks");
const tierConfig = require("./tier-config");

module.exports = {
  // Ingest module
  ingest: ingest.ingest,
  getDuration: ingest.getDuration,
  getMediaInfo: ingest.getMediaInfo,
  detectSourceType: ingest.detectSourceType,
  extractAudio: ingest.extractAudio,

  // Split module (Replicate Demucs - with parallel chunking, or Spleeter - cheap/fast)
  split: split.split,
  splitParallel: split.splitParallel,
  splitSpleeter: split.splitSpleeter,
  validateSeparation: split.validateSeparation,
  checkSystemRequirements: split.checkSystemRequirements,
  PARALLEL_CONFIG: split.PARALLEL_CONFIG,

  // Transcribe module (Lemonfox Whisper)
  transcribe: transcribe.transcribe,
  mergeShortSegments: transcribe.mergeShortSegments,
  mergeCloseSegments: transcribe.mergeCloseSegments,
  calculatePauses: transcribe.calculatePauses,
  detectAndHandleOverlaps: transcribe.detectAndHandleOverlaps,
  detectConversationBlocks: transcribe.detectConversationBlocks, // NEW: Conversation detection
  reorderSpeakersByActivity: transcribe.reorderSpeakersByActivity,

  // Translate module (Gemini with duration-aware translation)
  translate: translate.translate,
  translateBeginner: translate.translateBeginner, // NEW: Dreaming Spanish style
  translateConversation: translate.translateConversation, // NEW: Rapid dialogue
  translateNarrator: translate.translateNarrator,
  translateNarratorContinuous: translate.translateNarratorContinuous, // YouTube-dub style
  translateCharacterPerspective: translate.translateCharacterPerspective,
  translateBrainrot: translate.translateBrainrot,
  detectGender: translate.detectGender,
  calculateTargetLength: translate.calculateTargetLength,
  LEVEL_GUIDES: translate.LEVEL_GUIDES,
  SPANISH_TTS_RATE: translate.SPANISH_TTS_RATE,
  TTS_RATES: translate.TTS_RATES,

  // TTS module (Lemonfox + ElevenLabs Premium)
  generateTTS: tts.generateTTS, // Unified function (supports premium: true)
  generateConversationTTS: tts.generateConversationTTS, // NEW: Pre-mixed multi-speaker
  generateAndAlign: tts.generateAndAlign, // Lemonfox direct
  mixConversationTurns: tts.mixConversationTurns,
  OUTPUT_MODES: tts.OUTPUT_MODES,
  VOICES: tts.VOICES,
  SPEED_LIMITS: tts.SPEED_LIMITS,
  TTS_PROVIDERS: tts.TTS_PROVIDERS,
  elevenlabs: tts.elevenlabs, // Premium ElevenLabs direct access

  // Merge + Render module (FFmpeg)
  merge: merge.merge,
  renderVideo: merge.renderVideo,
  renderVideoBrainrot: merge.renderVideoBrainrot,
  renderVideoWithOverlays: merge.renderVideoWithOverlays, // NEW: Beginner overlays
  createVocabularySummary: merge.createVocabularySummary,
  concatenateVideos: merge.concatenateVideos,
  generateSubtitles: merge.generateSubtitles,
  
  // Video Stretch module (for extended mode)
  stretchSegment: stretch.stretchSegment,
  processOverflowSegments: stretch.processOverflowSegments,
  renderExtendedVideo: stretch.renderExtendedVideo,
  calculateStretchOffsets: stretch.calculateStretchOffsets,
  STRETCH_STRATEGIES: stretch.STRETCH_STRATEGIES,

  // Lip-sync module (AI lip-sync for natural dubbing)
  lipsync: lipsync.lipsync,
  generateNaturalTTS: lipsync.generateNaturalTTS,
  concatenateSegments: lipsync.concatenateSegments,
  submitLipsyncJob: lipsync.submitLipsyncJob,
  pollLipsyncJob: lipsync.pollLipsyncJob,
  LIPSYNC_PROVIDERS: lipsync.LIPSYNC_PROVIDERS,

  // Voice Cloning module (XTTS via Replicate - cheap voice cloning!)
  voiceCloneTTS: xtts.voiceCloneTTS,
  extractVoiceSample: xtts.extractVoiceSample,
  extractAllVoiceSamples: xtts.extractAllVoiceSamples,
  generateXTTS: xtts.generateXTTS,
  generateAndAlignXTTS: xtts.generateAndAlignXTTS,
  generateContinuousXTTS: xtts.generateContinuousXTTS, // Continuous narrator mode
  findDominantSpeaker: xtts.findDominantSpeaker,
  XTTS_LANGUAGE_CODES: xtts.LANGUAGE_CODES,

  // Scene Analyzer module (Gemini Vision - NEW)
  analyzeVideoForBeginnerContent: sceneAnalyzer.analyzeVideoForBeginnerContent,
  analyzeFrame: sceneAnalyzer.analyzeFrame,
  analyzeFrames: sceneAnalyzer.analyzeFrames,
  extractFrames: sceneAnalyzer.extractFrames,
  extractFramesAtIntervals: sceneAnalyzer.extractFramesAtIntervals,
  alignVocabularyWithSegments: sceneAnalyzer.alignVocabularyWithSegments,
  generateVocabularyFlashcards: sceneAnalyzer.generateVocabularyFlashcards,
  A1_VOCABULARY: sceneAnalyzer.A1_VOCABULARY,

  // Beginner Overlay module (Visual aids - NEW)
  generateVocabularyOverlays: beginnerOverlay.generateVocabularyOverlays,
  generateEnhancedSubtitles: beginnerOverlay.generateEnhancedSubtitles,
  generateOverlayFilterComplex: beginnerOverlay.generateOverlayFilterComplex,
  generateWordTimingOverlays: beginnerOverlay.generateWordTimingOverlays,
  VOCABULARY_EMOJIS: beginnerOverlay.VOCABULARY_EMOJIS,
  OVERLAY_STYLES: beginnerOverlay.OVERLAY_STYLES,

  // Voice Extraction module (for custom narrator voices)
  extractVoice: voiceExtract.extractVoice,
  extractFromVocals: voiceExtract.extractFromVocals,
  extractFromAudioFile: voiceExtract.extractFromAudioFile,
  extractFromYouTube: voiceExtract.extractFromYouTube,
  preprocessForXTTS: voiceExtract.preprocessForXTTS,
  VOICE_SAMPLE_CONFIG: voiceExtract.VOICE_SAMPLE_CONFIG,

  // Narrator Modes module (1st person clone vs 3rd party narrator)
  NARRATOR_MODES: narratorModes.NARRATOR_MODES,
  NARRATOR_VOICES: narratorModes.NARRATOR_VOICES,
  getNarratorMode: narratorModes.getNarratorMode,
  getDefaultVoice: narratorModes.getDefaultVoice,
  buildNarratorPrompt: narratorModes.buildNarratorPrompt,
  validateNarratorOptions: narratorModes.validateNarratorOptions,
  listNarratorModes: narratorModes.listNarratorModes,

  // Rate Limiter (TPS-based API rate limiting)
  TPSLimiter: rateLimiter.TPSLimiter,
  BatchTPSProcessor: rateLimiter.BatchTPSProcessor,

  // TikTok Hooks & Metadata
  generateHook: tiktokHooks.generateHook,
  generateTikTokMetadata: tiktokHooks.generateTikTokMetadata,
  addHookToSegments: tiktokHooks.addHookToSegments,
  extractVideoContext: tiktokHooks.extractVideoContext,

  // Tier Configuration (Learner / Immerser / Pro)
  TIERS: tierConfig.TIERS,
  getTierPipelineOptions: tierConfig.getTierPipelineOptions,
  suggestTier: tierConfig.suggestTier,
  
  // Separation Model Presets
  SEPARATION_MODELS: split.SEPARATION_MODELS,
};
