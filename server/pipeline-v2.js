#!/usr/bin/env node
/**
 * Immersion v2 - Full Pipeline
 *
 * Runs the complete dubbing pipeline on a video:
 * Ingest → Split → Transcribe → Translate → TTS → Align → Merge → Render
 *
 * Generates 3 output versions:
 *   1. SYNCED:   Intermediate translation (B1) + original video timing
 *   2. LEARNER:  Slower TTS (0.8x) for comprehension, audio-only
 *   3. EXTENDED: Full translation + video stretched to fit audio
 *
 * Usage:
 *   node pipeline-v2.js <youtube-url-or-local-file> [level] [voice] [mode]
 *
 * Examples:
 *   node pipeline-v2.js https://www.youtube.com/watch?v=dQw4w9WgXcQ
 *   node pipeline-v2.js https://www.youtube.com/watch?v=dQw4w9WgXcQ B1 female
 *   node pipeline-v2.js ./my-video.mp4 A2 male synced
 *
 * Options:
 *   level  - CEFR level: A1, A2, B1 (default), B2, C1
 *   voice  - TTS voice: male (default), female, neutral
 *   mode   - Output mode: synced, learner, extended, or all (default: synced)
 *
 * Estimated cost: ~$0.10 per 5-minute video
 */

require("dotenv").config();

const path = require("path");
const fs = require("fs");
const { v4: uuidv4 } = require("uuid");
const { execSync } = require("child_process");

// Import v2 modules
const { ingest } = require("./src/v2/ingest");
const {
  split,
  checkSystemRequirements,
  validateSeparation,
} = require("./src/v2/split");
const {
  transcribe,
  calculatePauses,
  mergeCloseSegments,
  detectAndHandleOverlaps,
} = require("./src/v2/transcribe");
const { translate, translateNarrator, translateNarratorContinuous, translateCharacterPerspective, translateBrainrot, detectGender, LEVEL_GUIDES } = require("./src/v2/translate");
const { generateAndAlign, generateTTS, VOICES, OUTPUT_MODES, elevenlabs } = require("./src/v2/tts");
const { merge, renderVideo, renderVideoBrainrot, generateSubtitles } = require("./src/v2/merge");
const { processOverflowSegments, STRETCH_STRATEGIES } = require("./src/v2/stretch");
const { voiceCloneTTS, extractAllVoiceSamples, generateAndAlignXTTS, generateContinuousXTTS, findDominantSpeaker, LANGUAGE_CODES: XTTS_LANGUAGES } = require("./src/v2/xtts");
const { extractFromYouTube, extractFromAudioFile } = require("./src/v2/voice-extract");
const { lipsync } = require("./src/v2/lipsync");

const OUTPUT_DIR = path.join(__dirname, "output");

/**
 * Detailed timing tracker for pipeline optimization
 * Tracks all sub-workflows with hierarchical timing
 */
class TimingTracker {
  constructor() {
    this.startTime = Date.now();
    this.timings = {};
    this.currentStep = null;
    this.stepStack = [];
  }

  // Start a top-level step
  startStep(name) {
    this.currentStep = name;
    this.timings[name] = {
      start: Date.now(),
      end: null,
      duration: null,
      substeps: {},
    };
  }

  // End the current step
  endStep(name) {
    if (this.timings[name]) {
      this.timings[name].end = Date.now();
      this.timings[name].duration =
        (this.timings[name].end - this.timings[name].start) / 1000;
    }
  }

  // Start a substep within the current step
  startSubstep(stepName, substepName) {
    if (this.timings[stepName]) {
      this.timings[stepName].substeps[substepName] = {
        start: Date.now(),
        end: null,
        duration: null,
      };
    }
  }

  // End a substep
  endSubstep(stepName, substepName) {
    if (this.timings[stepName]?.substeps[substepName]) {
      const substep = this.timings[stepName].substeps[substepName];
      substep.end = Date.now();
      substep.duration = (substep.end - substep.start) / 1000;
    }
  }

  // Add metadata to a step
  addMetadata(stepName, key, value) {
    if (this.timings[stepName]) {
      if (!this.timings[stepName].metadata) {
        this.timings[stepName].metadata = {};
      }
      this.timings[stepName].metadata[key] = value;
    }
  }

  // Get total elapsed time
  getTotalTime() {
    return (Date.now() - this.startTime) / 1000;
  }

  // Get summary object
  getSummary() {
    const summary = {
      totalTime: this.getTotalTime(),
      steps: {},
    };

    for (const [name, step] of Object.entries(this.timings)) {
      summary.steps[name] = {
        duration: step.duration,
        percentage: ((step.duration / this.getTotalTime()) * 100).toFixed(1),
        substeps: {},
        metadata: step.metadata || {},
      };

      for (const [subName, substep] of Object.entries(step.substeps)) {
        summary.steps[name].substeps[subName] = {
          duration: substep.duration,
          percentage: ((substep.duration / step.duration) * 100).toFixed(1),
        };
      }
    }

    return summary;
  }

  // Print detailed timing report
  printReport() {
    const total = this.getTotalTime();

    console.log(`\n${"═".repeat(70)}`);
    console.log(`📊 DETAILED TIMING REPORT`);
    console.log(`${"═".repeat(70)}`);
    console.log(`Total Pipeline Time: ${this.formatTime(total)}`);

    // Check for parallel execution (split runs with transcribe/translate/tts)
    const splitTime = this.timings.split?.duration || 0;
    const parallelSteps = ["transcribe", "translate", "tts"];
    const parallelTime = parallelSteps.reduce(
      (sum, name) => sum + (this.timings[name]?.duration || 0),
      0
    );
    const savedTime = Math.min(splitTime, parallelTime);

    if (savedTime > 10) {
      console.log(
        `⚡ Parallel Execution: Saved ~${this.formatTime(
          savedTime
        )} by running Split || Transcribe+Translate+TTS`
      );
    }
    console.log(`${"─".repeat(70)}`);

    // Sort steps by duration (descending)
    const sortedSteps = Object.entries(this.timings)
      .filter(([_, s]) => s.duration !== null)
      .sort((a, b) => b[1].duration - a[1].duration);

    // Calculate sum of all step times (for parallel comparison)
    const totalStepTime = sortedSteps.reduce(
      (sum, [_, s]) => sum + s.duration,
      0
    );
    const parallelEfficiency =
      totalStepTime > 0
        ? (((totalStepTime - total) / totalStepTime) * 100).toFixed(0)
        : 0;

    for (const [name, step] of sortedSteps) {
      const pct = ((step.duration / total) * 100).toFixed(1);
      const bar = this.makeBar(Math.min(1, step.duration / total), 20);

      // Mark steps that ran in parallel
      const isParallelStep = parallelSteps.includes(name);
      const parallelNote = isParallelStep ? " ⚡(parallel)" : "";

      console.log(
        `\n${name.toUpperCase()}: ${this.formatTime(
          step.duration
        )} (${pct}%) ${bar}${parallelNote}`
      );

      // Print metadata if any
      if (step.metadata && Object.keys(step.metadata).length > 0) {
        for (const [key, value] of Object.entries(step.metadata)) {
          console.log(`   📋 ${key}: ${value}`);
        }
      }

      // Print substeps sorted by duration
      const sortedSubsteps = Object.entries(step.substeps)
        .filter(([_, s]) => s.duration !== null)
        .sort((a, b) => b[1].duration - a[1].duration);

      if (sortedSubsteps.length > 0) {
        for (const [subName, substep] of sortedSubsteps) {
          const subPct = ((substep.duration / step.duration) * 100).toFixed(1);
          const subBar = this.makeBar(substep.duration / step.duration, 15);
          console.log(
            `   ├─ ${subName}: ${this.formatTime(
              substep.duration
            )} (${subPct}%) ${subBar}`
          );
        }
      }
    }

    // Print optimization suggestions
    this.printOptimizationSuggestions(sortedSteps, total);

    console.log(`\n${"═".repeat(70)}\n`);
  }

  // Format time nicely
  formatTime(seconds) {
    if (seconds < 60) {
      return `${seconds.toFixed(1)}s`;
    }
    const mins = Math.floor(seconds / 60);
    const secs = (seconds % 60).toFixed(1);
    return `${mins}m ${secs}s`;
  }

  // Make a progress bar
  makeBar(ratio, length) {
    const filled = Math.round(ratio * length);
    const empty = length - filled;
    return `[${"█".repeat(filled)}${"░".repeat(empty)}]`;
  }

  // Suggest optimizations based on timing data
  printOptimizationSuggestions(sortedSteps, total) {
    console.log(`\n${"─".repeat(70)}`);
    console.log(`💡 OPTIMIZATION SUGGESTIONS:`);

    const suggestions = [];

    for (const [name, step] of sortedSteps) {
      const pct = (step.duration / total) * 100;

      if (name.toLowerCase().includes("split") && pct > 40) {
        suggestions.push(
          `⚡ SPLIT takes ${pct.toFixed(
            0
          )}% - Consider: smaller chunks, more parallel workers, or simpler Demucs model`
        );
      }

      if (name.toLowerCase().includes("merge") && pct > 15) {
        suggestions.push(
          `⚡ MERGE takes ${pct.toFixed(
            0
          )}% - Consider: larger batch sizes, faster intermediate format`
        );
      }

      if (name.toLowerCase().includes("render") && pct > 10) {
        suggestions.push(
          `⚡ RENDER takes ${pct.toFixed(
            0
          )}% - Ensure audio stream copy is working (should be instant)`
        );
      }

      if (name.toLowerCase().includes("transcribe")) {
        const compressionTime = step.substeps["compression"]?.duration || 0;
        if (compressionTime > 5) {
          suggestions.push(
            `⚡ TRANSCRIBE compression takes ${compressionTime.toFixed(
              1
            )}s - Could pre-compress or use faster codec`
          );
        }
      }
      
      if (name.toLowerCase().includes("tts") && pct > 50) {
        const xttsBlocks = step.metadata?.xtts_blocks;
        const concurrency = step.metadata?.xtts_concurrency;
        const avgSpeed = step.metadata?.xtts_avg_speed;
        const retries = step.metadata?.xtts_retries;
        
        if (xttsBlocks && concurrency) {
          const timePerBlock = step.duration / xttsBlocks;
          suggestions.push(
            `⚡ TTS (XTTS) takes ${pct.toFixed(0)}% - ${xttsBlocks} blocks @ concurrency=${concurrency}, avg ${timePerBlock.toFixed(1)}s/block`
          );
          if (concurrency < 8) {
            suggestions.push(
              `   → Increase concurrency to 8-10 if you have Replicate Pro (currently ${concurrency})`
            );
          }
          if (retries > 5) {
            suggestions.push(
              `   → ${retries} retries occurred - consider adjusting character targets or quality thresholds`
            );
          }
        }
      }
    }

    if (suggestions.length === 0) {
      suggestions.push(
        `✅ Pipeline is well-optimized! Main bottleneck is likely API latency.`
      );
    }

    suggestions.forEach((s) => console.log(`   ${s}`));
  }

  // Export to JSON for external analysis
  toJSON() {
    return {
      totalTime: this.getTotalTime(),
      timings: this.timings,
      summary: this.getSummary(),
    };
  }
}

// Global timing tracker instance
let tracker = null;

/**
 * Print banner
 */
function printBanner() {
  console.log(`
╔══════════════════════════════════════════════════════════════╗
║                                                              ║
║   🌊  I M M E R S I O N   v 2                                ║
║                                                              ║
║   Transform any video into Spanish Comprehensible Input      ║
║                                                              ║
╚══════════════════════════════════════════════════════════════╝
  `);
}

/**
 * Check all required API keys and dependencies
 */
function checkRequirements(premium = false) {
  console.log("📋 Checking requirements...\n");

  const checks = {
    replicate: !!(
      process.env.REPLICATE_API_TOKEN || process.env.REPLICATE_API_KEY
    ),
    lemonfox: !!process.env.LEMONFOX_API_KEY,
    gemini: !!process.env.GEMINI_API_KEY,
    ffmpeg: false,
  };

  // Check ElevenLabs if premium mode
  if (premium) {
    checks.elevenlabs = !!process.env.ELEVENLABS_API_KEY;
  }

  // Check FFmpeg
  try {
    const { execSync } = require("child_process");
    execSync("ffmpeg -version", { stdio: "pipe" });
    checks.ffmpeg = true;
  } catch {}

  console.log(
    `   Replicate API key:  ${
      checks.replicate ? "✅" : "❌ Missing (REPLICATE_API_TOKEN)"
    }`
  );
  console.log(
    `   Lemonfox API key:   ${
      checks.lemonfox ? "✅" : "❌ Missing (LEMONFOX_API_KEY)"
    }`
  );
  console.log(
    `   Gemini API key:     ${
      checks.gemini ? "✅" : "❌ Missing (GEMINI_API_KEY)"
    }`
  );
  if (premium) {
    console.log(
      `   ElevenLabs API key: ${
        checks.elevenlabs ? "✅" : "❌ Missing (ELEVENLABS_API_KEY)"
      }`
    );
  }
  console.log(`   FFmpeg installed:   ${checks.ffmpeg ? "✅" : "❌ Missing"}`);

  const missing = Object.entries(checks)
    .filter(([_, ok]) => !ok)
    .map(([key]) => key);

  if (missing.length > 0) {
    console.log(`
❌ Missing requirements: ${missing.join(", ")}

Setup guide:
  1. Replicate:   https://replicate.com/account/api-tokens
  2. Lemonfox:    https://lemonfox.ai (get API key)
  3. Gemini:      https://makersuite.google.com/app/apikey
  4. ElevenLabs:  https://elevenlabs.io/app/settings/api-keys (for premium)
  5. FFmpeg:      sudo apt install ffmpeg (Ubuntu) or brew install ffmpeg (Mac)

Add to .env file:
  REPLICATE_API_TOKEN=r8_xxx
  LEMONFOX_API_KEY=lf_xxx
  GEMINI_API_KEY=xxx
  ELEVENLABS_API_KEY=xxx  # For premium TTS
    `);
    return false;
  }

  console.log("\n   ✅ All requirements satisfied!\n");
  return true;
}

/**
 * Estimate cost for a video
 */
function estimateCost(durationSeconds) {
  const minutes = durationSeconds / 60;

  const costs = {
    replicate: 0.07, // ~$0.07 per run (fixed)
    lemonfoxSTT: (minutes / 180) * 0.5, // $0.50 per 3 hours
    gemini: 0, // Free tier
    lemonfoxTTS: 0.01, // ~$0.01 per 3K chars
  };

  const total = Object.values(costs).reduce((a, b) => a + b, 0);

  return { ...costs, total };
}

/**
 * Format duration in mm:ss
 */
function formatDuration(seconds) {
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs.toString().padStart(2, "0")}`;
}

/**
 * Create custom speaker-to-voice mapping from assigned voices
 * Uses speaker reordering info to map SPEAKER_00 (most active) to first voice, etc.
 */
function createCustomSpeakerVoiceMap(segments, assignedVoices, speakerReorderInfo) {
  const speakers = [...new Set(segments.map(s => s.speaker).filter(Boolean))];
  const voiceMap = {};
  
  speakers.forEach((speaker, index) => {
    // Map SPEAKER_00 → assignedVoices[0], SPEAKER_01 → assignedVoices[1], etc.
    const voiceIndex = parseInt(speaker.replace("SPEAKER_", "")) || 0;
    voiceMap[speaker] = assignedVoices[voiceIndex] || assignedVoices[assignedVoices.length - 1]; // Fallback to last voice
  });
  
  console.log(`\n   🎭 CUSTOM VOICE ASSIGNMENT:`);
  for (const [speaker, voice] of Object.entries(voiceMap)) {
    console.log(`      ${speaker} → ${voice}`);
  }
  
  return voiceMap;
}

/**
 * Main pipeline function
 */
async function runPipeline(source, options = {}) {
  const {
    level = "B1",
    voiceType = "male",
    quality = false, // Use higher quality Demucs settings
    mode = "synced", // Output mode: synced, learner, extended, or all
    language = "spanish", // Target language: spanish, indonesian
    premium = false, // Use ElevenLabs premium TTS instead of Lemonfox
    speakerVoices = null, // Custom speaker-to-voice map for premium
    clone = false, // Use XTTS voice cloning (clones original speaker's voice)
    lipsync: doLipsync = false, // Run AI lip-sync after dubbing
    burnSubs = false, // Burn subtitles into video
    start = null, // Start time for clipping (seconds)
    clipDuration = null, // Duration for clipping (seconds)
    speakerCount = null, // Number of speakers to process (auto or number)
    assignedVoices = null, // Custom voice assignment array
    separationModel = null, // Override Demucs model (from tier)
    separationShifts = null, // Override Demucs shifts (from tier)
    narratorMode = null, // Narrator mode: clone_speaker, third_party, custom_narrator, storyteller
    voiceSource = null, // Voice source: video, file, youtube
    voiceStartTime = null, // Start time for voice extraction (seconds)
    voiceDuration = null, // Duration for voice extraction (seconds)
    voiceYoutubeUrl = null, // YouTube URL for voice extraction
    voiceFilePath = null, // Path to voice file for extraction
  } = options;
  
  // Parse modes to generate
  const modesToGenerate = mode === "all" 
    ? ["synced", "learner", "extended"]
    : [mode];

  printBanner();

  // Validate options
  if (!LEVEL_GUIDES[level]) {
    console.error(`❌ Invalid level: ${level}`);
    console.error(`   Valid levels: ${Object.keys(LEVEL_GUIDES).join(", ")}`);
    process.exit(1);
  }

  // Check if Indonesian requires premium TTS
  const needsPremiumForLanguage = ["indonesian", "japanese", "vietnamese", "thai"].includes(language.toLowerCase());
  if (needsPremiumForLanguage && !premium && !clone) {
    console.error(`\n❌ ${language} requires --premium flag for TTS!`);
    console.error(`   Lemonfox doesn't have ${language} voices.`);
    console.error(`   Run with: node pipeline-v2.js <source> ${level} ${voiceType} ${mode} ${language} --premium`);
    console.error(`\n   Or use --clone for voice cloning (only works for XTTS-supported languages)`);
    process.exit(1);
  }

  // If voiceType is a gender (male/female/neutral), map to default voice name.
  // If it's already a specific voice name (e.g., "adam", "veronica"), use it directly.
  const voice = VOICES[voiceType] || voiceType || VOICES.male;

  // Check requirements
  if (!checkRequirements(premium)) {
    process.exit(1);
  }

  // Create job directory
  const jobId = `immersion_${uuidv4().substring(0, 8)}`;
  const jobDir = path.join(OUTPUT_DIR, jobId);
  fs.mkdirSync(jobDir, { recursive: true });

  console.log(`📁 Job ID: ${jobId}`);
  console.log(`   Output: ${jobDir}`);
  console.log(`   Level: ${level} (${LEVEL_GUIDES[level].name})`);
  console.log(`   Voice: ${voiceType}`);
  console.log(`   Language: ${language.charAt(0).toUpperCase() + language.slice(1)}`);
  console.log(`   Mode(s): ${modesToGenerate.join(", ").toUpperCase()}`);
  if (quality) {
    console.log(`   🎯 Quality mode: ON (htdemucs_ft + shifts=2)`);
  }
  if (premium) {
    console.log(`   🎙️ Premium TTS: ON (ElevenLabs)`);
  }
  if (clone) {
    console.log(`   🎤 Voice Clone: ON (XTTS via Replicate)`);
    // Check if language is supported by XTTS
    if (!XTTS_LANGUAGES[language.toLowerCase()]) {
      console.log(`   ⚠️ Warning: ${language} not supported by XTTS, will use premium TTS instead`);
    }
  }
  if (doLipsync) {
    console.log(`   👄 Lip-sync: ON (Sync Labs)`);
  }
  console.log("");

  const pipelineStart = Date.now();
  const timings = {};

  // Initialize timing tracker for detailed profiling
  tracker = new TimingTracker();

  try {
    // ═══════════════════════════════════════════════════════════════
    // STEP 1: INGEST - Download video and extract audio
    // ═══════════════════════════════════════════════════════════════
    tracker.startStep("ingest");
    let stepStart = Date.now();
    const ingestResult = await ingest(source, jobDir, { start, duration: clipDuration });
    timings.ingest = (Date.now() - stepStart) / 1000;
    tracker.addMetadata("ingest", "source_type", ingestResult.source.type);
    tracker.addMetadata(
      "ingest",
      "duration",
      `${ingestResult.media.duration?.toFixed(1)}s`
    );
    tracker.addMetadata(
      "ingest",
      "resolution",
      `${ingestResult.media.width}x${ingestResult.media.height}`
    );
    tracker.endStep("ingest");

    const duration = ingestResult.media.duration;
    const costs = estimateCost(duration);

    console.log(
      `\n💰 Estimated cost: ~$${costs.total.toFixed(2)} for ${formatDuration(
        duration
      )}`
    );

    // ═══════════════════════════════════════════════════════════════
    // STEP 2 & 3: PARALLEL - Split AND Transcribe simultaneously!
    // Split needs ~7 minutes, Transcribe needs ~30 seconds
    // No reason to wait - Transcribe works fine on original audio
    // ═══════════════════════════════════════════════════════════════
    console.log(`\n${"═".repeat(60)}`);
    console.log(`⚡ PARALLEL: Running Split + Transcribe simultaneously`);
    console.log(`${"═".repeat(60)}`);

    const parallelStart = Date.now();
    tracker.startStep("split");
    tracker.startStep("transcribe");

    // Start both in parallel
    // Separation model can come from: tier override > quality flag > default
    const splitModel = separationModel || (quality ? "htdemucs_ft" : "htdemucs");
    const splitShifts = separationShifts !== null ? separationShifts : (quality ? 2 : 1);
    
    const splitPromise = split(ingestResult.audioPath, jobDir, {
      model: splitModel,
      shifts: splitShifts,
    });

    const transcribePromise = transcribe(ingestResult.audioPath, {
      language: "english",
      speakerLabels: true,
    });

    // Wait for transcribe first (it's faster), then continue pipeline
    // Split will keep running in background
    const transcribeResult = await transcribePromise;
    timings.transcribe = (Date.now() - parallelStart) / 1000;
    tracker.addMetadata(
      "transcribe",
      "segments",
      transcribeResult.segments.length
    );
    tracker.addMetadata(
      "transcribe",
      "speakers",
      [...new Set(transcribeResult.segments.map((s) => s.speaker))].length
    );
    tracker.endStep("transcribe");
    console.log(
      `\n   ✅ Transcribe finished in ${timings.transcribe.toFixed(
        1
      )}s (Split still running...)`
    );

    stepStart = Date.now();

    // We'll await splitPromise later when we need the background track

    // Merge segments with small gaps for better TTS flow
    // XTTS needs larger segments for natural-sounding speech - a sentence like
    // "I am the best botanist [0.8s pause] on this planet" should stay as ONE segment
    // to avoid unnatural gaps in the TTS output
    const isXTTS = cloneMode;
    const mergeGap = isXTTS ? 1.5 : 0.5;  // XTTS: 1.5s gap merge (flowing sentences), Lemonfox: 0.5s
    const mergeMaxDur = isXTTS ? 20 : 12;  // XTTS handles longer segments better
    const mergedSegments = mergeCloseSegments(transcribeResult.segments, {
      maxGap: mergeGap,
      maxDuration: mergeMaxDur,
    });

    // Detect and handle overlapping speech (people talking over each other)
    const {
      segments: nonOverlappingSegments,
      overlaps,
      stats: overlapStats,
    } = detectAndHandleOverlaps(mergedSegments, {
      strategy: "truncate", // Truncate overlaps to keep both speakers
      minOverlap: 0.1, // Ignore tiny overlaps < 100ms
    });

    // Add pause information
    const segmentsWithPauses = calculatePauses(nonOverlappingSegments);

    // REORDER SPEAKERS BY ACTIVITY (most active = SPEAKER_00)
    let speakerReorderInfo = null;
    let reorderedSegments = segmentsWithPauses;
    
    if (speakerCount !== null || mode === "narrator-only") {
      const { reorderSpeakersByActivity } = require("./src/v2/transcribe");
      speakerReorderInfo = reorderSpeakersByActivity(segmentsWithPauses);
      reorderedSegments = speakerReorderInfo.segments;
      
      console.log(`\n   🔄 SPEAKERS REORDERED BY ACTIVITY:`);
      speakerReorderInfo.stats.forEach((stat, i) => {
        const marker = i === 0 ? "★" : " ";
        console.log(`      ${marker} ${stat.newLabel} (was ${stat.oldLabel}): ${stat.time.toFixed(1)}s (${stat.percentage}%)`);
      });
    }

    // Filter for narrator-only mode (only dub dominant speaker)
    let narratorOnlyInfo = null;
    let segmentsToProcess = reorderedSegments;
    
    if (mode === "narrator-only") {
      const { filterDominantSpeakerSegments } = require("./src/v2/xtts");
      narratorOnlyInfo = filterDominantSpeakerSegments(reorderedSegments);
      segmentsToProcess = narratorOnlyInfo.narratorSegments;
    }

    // Save transcription
    fs.writeFileSync(
      path.join(jobDir, "transcription.json"),
      JSON.stringify(
        {
          text: transcribeResult.text,
          language: transcribeResult.language,
          segments: reorderedSegments,
          speakerReordering: speakerReorderInfo ? {
            applied: true,
            speakerMap: speakerReorderInfo.speakerMap,
            stats: speakerReorderInfo.stats,
          } : null,
          narratorOnly: narratorOnlyInfo ? {
            dominantSpeaker: narratorOnlyInfo.dominantSpeaker,
            narratorSegments: narratorOnlyInfo.narratorSegments.length,
            otherSegments: narratorOnlyInfo.otherSegments.length,
          } : null,
          transcribedAt: new Date().toISOString(),
        },
        null,
        2
      )
    );

    // ═══════════════════════════════════════════════════════════════
    // STEP 4: TRANSLATE - English to Spanish (Gemini)
    // (Split is still running in parallel!)
    // ═══════════════════════════════════════════════════════════════
    tracker.startStep("translate");
    stepStart = Date.now();

    // Detect speaker gender(s) for better TTS voice selection
    // Pass segments with speaker labels for multi-speaker detection
    tracker.startSubstep("translate", "gender_detection");
    const genderResult = await detectGender(segmentsWithPauses);
    tracker.endSubstep("translate", "gender_detection");

    // Handle both single gender string and multi-speaker map
    const isMultiSpeaker = typeof genderResult === "object";
    const detectedGender = isMultiSpeaker
      ? genderResult._primary || "male"
      : genderResult;
    const speakerGenders = isMultiSpeaker ? genderResult : null;

    const finalVoice =
      voiceType === "auto" ? VOICES[detectedGender] || VOICES.male : voice;

    tracker.startSubstep("translate", "translation_api");
    
    // Choose translation strategy based on mode
    let translatedSegments;
    const currentMode = modesToGenerate[0]; // Check mode early for translation
    
    if (currentMode === "brainrot") {
      // Brainrot: Summarize into flowing third-person narration
      console.log(`   🧠 Brainrot mode: Generating third-person narration...`);
      const brainrotResult = await translateBrainrot(segmentsToProcess, {
        level,
        targetLanguage: language,
        chunkDuration: 15, // ~15s narration chunks
      });
      translatedSegments = brainrotResult.segments;
    } else if (currentMode === "narrator" || currentMode === "narrator-only" || characterName) {
      // CHARACTER PERSPECTIVE: Narrate from a character's POV (1st person for their scenes)
      if (characterName) {
        console.log(`   🎭 CHARACTER PERSPECTIVE mode: ${characterName}'s POV`);
        console.log(`   📢 1st person for ${characterName}, 3rd person for others, "we" for group scenes`);
        translatedSegments = await translateCharacterPerspective(segmentsToProcess, {
          level,
          targetLanguage: language,
          characterName,
          characterTraits: characterTraits || "",
          blockDurationTarget: 20, // ~20 second blocks
        });
        // Mark as narrator blocks for continuous XTTS
        translatedSegments = translatedSegments.map(seg => ({
          ...seg,
          isNarratorBlock: true,
          characterPerspective: true,
        }));
      }
      // Narrator mode with voice cloning = CONTINUOUS mode (YouTube dub style)
      // Without voice cloning = segment-by-segment narrator
      else if (clone && XTTS_LANGUAGES[language.toLowerCase()]) {
        // CONTINUOUS NARRATOR: Merge segments into 30-45s blocks for constant talking
        console.log(`   🎙️ CONTINUOUS NARRATOR mode: YouTube-dub style constant talking`);
        console.log(`   📢 Merging segments into ~30s blocks with third-person narration`);
        translatedSegments = await translateNarratorContinuous(segmentsToProcess, {
          level,
          targetLanguage: language,
          blockDurationTarget: 30, // ~30 second blocks
          thirdPerson: true,
          isXTTS: true, // Use slower XTTS rate for shorter translations
        });
      } else {
        // Standard narrator: segment-by-segment
        console.log(`   🎙️ Narrator mode: Segment-by-segment for ${level} learners...`);
        translatedSegments = await translateNarrator(segmentsToProcess, {
          level,
          batchSize: 10,
          concurrency: 10,
          targetLanguage: language,
          thirdPerson: false,
        });
      }
    } else {
      // Standard: Direct translation matching original timing
      translatedSegments = await translate(segmentsToProcess, {
        level,
        batchSize: 60, // Larger batches = fewer API calls
        concurrency: 15, // More parallel batches
        targetLanguage: language, // spanish, indonesian, etc.
        isXTTS: clone, // Use slower XTTS rate when voice cloning
      });
    }
    
    tracker.endSubstep("translate", "translation_api");
    timings.translate = (Date.now() - stepStart) / 1000;
    tracker.addMetadata("translate", "segments", translatedSegments.length);
    tracker.addMetadata("translate", "level", level);
    tracker.addMetadata("translate", "mode", currentMode);
    tracker.endStep("translate");

    // Save translation
    fs.writeFileSync(
      path.join(jobDir, "translation.json"),
      JSON.stringify(
        {
          level,
          gender: detectedGender,
          originalLanguage: transcribeResult.language,
          targetLanguage: language,
          segments: translatedSegments,
          translatedAt: new Date().toISOString(),
        },
        null,
        2
      )
    );

    // ═══════════════════════════════════════════════════════════════
    // STEP 5: TTS - Generate Spanish audio (native speed control)
    // ═══════════════════════════════════════════════════════════════
    tracker.startStep("tts");
    stepStart = Date.now();

    // Filter valid segments
    const validSegments = translatedSegments.filter(
      (s) =>
        s &&
        !s.error &&
        s.translatedText &&
        s.translatedText !== "[ERROR: Translation failed]"
    );

    // Generate TTS for the requested mode
    // synced: Original timing, intermediate translation
    // learner: Slower TTS (0.8x), audio-only 
    // extended: Natural TTS, will flag segments needing video stretch
    // brainrot: Slow narration + sped-up video
    console.log(`   📋 Generating TTS for mode: ${currentMode.toUpperCase()}`);
    
    let ttsResult;
    
    // Check if we should use voice cloning
    const useClone = clone && XTTS_LANGUAGES[language.toLowerCase()];
    
    if (useClone) {
      // ═══════════════════════════════════════════════════════════════
      // VOICE CLONING MODE: Extract voice samples and use XTTS
      // ═══════════════════════════════════════════════════════════════
      const isNarratorMode = currentMode === "narrator";
      console.log(`   🎤 Using XTTS Voice Cloning${isNarratorMode ? " (single narrator voice)" : ""}`);
      
      // Get voice samples: either use custom sample or extract from video
      let voiceSamples = {};
      
      if (customVoiceSample) {
        console.log(`\n   🎤 Using custom voice sample: ${path.basename(customVoiceSample)}`);
        // Use custom sample for all speakers
        const speakerIds = [...new Set(transcribeResult.segments.map(s => s.speaker))];
        for (const speakerId of speakerIds) {
          voiceSamples[speakerId] = customVoiceSample;
        }
        console.log(`   ✅ Mapped custom sample to ${speakerIds.length} speaker(s)`);
      } else if (voiceSource === "youtube" && voiceYoutubeUrl) {
        // Extract voice from YouTube video
        console.log(`\n   🎤 Extracting voice from YouTube: ${voiceYoutubeUrl}`);
        console.log(`      Start: ${voiceStartTime || 30}s, Duration: ${voiceDuration || 15}s`);
        const ytResult = await extractFromYouTube(voiceYoutubeUrl, jobDir, {
          startTime: voiceStartTime ? parseFloat(voiceStartTime) : 30,
          duration: voiceDuration ? parseFloat(voiceDuration) : 15,
          speakerLabel: "youtube_voice",
        });
        if (ytResult.success) {
          console.log(`   ✅ YouTube voice extracted: ${ytResult.duration?.toFixed(1)}s`);
          const speakerIds = [...new Set(transcribeResult.segments.map(s => s.speaker))];
          for (const speakerId of speakerIds) {
            voiceSamples[speakerId] = {
              samplePath: ytResult.samplePath,
              speaker: speakerId,
              duration: ytResult.duration,
            };
          }
        } else {
          console.log(`   ⚠️ YouTube voice extraction failed: ${ytResult.error}`);
          console.log(`   Falling back to video voice extraction...`);
          voiceSamples = await extractAllVoiceSamples(
            ingestResult.videoPath,
            transcribeResult.segments,
            jobDir,
            { narratorMode: isNarratorMode }
          );
        }
      } else if (voiceSource === "file" && voiceFilePath) {
        // Extract voice from uploaded file
        console.log(`\n   🎤 Using voice file: ${path.basename(voiceFilePath)}`);
        const fileResult = await extractFromAudioFile(voiceFilePath, jobDir, {
          speakerLabel: "custom_voice",
        });
        if (fileResult.success) {
          const speakerIds = [...new Set(transcribeResult.segments.map(s => s.speaker))];
          for (const speakerId of speakerIds) {
            voiceSamples[speakerId] = {
              samplePath: fileResult.samplePath,
              speaker: speakerId,
              duration: fileResult.duration,
            };
          }
        } else {
          console.log(`   ⚠️ Voice file extraction failed, falling back to video...`);
          voiceSamples = await extractAllVoiceSamples(
            ingestResult.videoPath,
            transcribeResult.segments,
            jobDir,
            { narratorMode: isNarratorMode }
          );
        }
      } else {
        // Extract voice samples from the original video
        // In narrator mode: only extract dominant speaker's voice
        console.log(`\n   🎤 Extracting voice samples from video...`);
        voiceSamples = await extractAllVoiceSamples(
          ingestResult.videoPath,
          transcribeResult.segments,
          jobDir,
          { narratorMode: isNarratorMode }
        );
      }
      
      if (Object.keys(voiceSamples).length === 0) {
        console.log(`   ⚠️ Could not extract voice samples, falling back to premium TTS`);
        // Fallback to premium if voice extraction fails
        ttsResult = await generateTTS(validSegments, jobDir, {
          premium: true,
          voice: finalVoice,
          concurrency: 3,
          durationTolerance: 0.2,
          maxRetries: 1,
          multiSpeaker: true,
          defaultGender: detectedGender,
          speakerGenders: speakerGenders,
          speakerVoices: assignedVoices ? createCustomSpeakerVoiceMap(validSegments, assignedVoices, speakerReorderInfo) : null,
          mode: currentMode,
          language,
        });
      } else {
        // Check if using continuous narrator mode (blocks instead of segments)
        const isContinuousNarrator = currentMode === "narrator" && validSegments[0]?.isNarratorBlock;
        
        if (isContinuousNarrator) {
          // CONTINUOUS NARRATOR: Use generateContinuousXTTS for merged blocks
          console.log(`   🎙️ CONTINUOUS XTTS: Generating audio for ${validSegments.length} narrator blocks`);
          
          // Get the dominant speaker's voice for single-narrator style
          const { speaker: dominantSpeaker } = findDominantSpeaker(transcribeResult.segments);
          let narratorVoice = voiceSamples[dominantSpeaker] || Object.values(voiceSamples)[0];
          
          // If narratorVoice is just a string path (custom sample), wrap it
          if (typeof narratorVoice === 'string') {
            narratorVoice = {
              samplePath: narratorVoice,
              speaker: characterName || "narrator",
            };
          }
          
          console.log(`   📢 Narrator voice: ${narratorVoice.speaker || "default"}`);
          
          const continuousResult = await generateContinuousXTTS(
            validSegments,
            narratorVoice,
            jobDir,
            { 
              language, 
              concurrency: 5,      // Process 5 blocks at a time (increased from 3)
              qualityFilter: true, // ENABLED - reject weird/slow audio
              maxRetries: 3        // Increased from 2 to 3 for stubborn blocks
            }
          );
          
          // Save continuous TTS timing data for analysis
          const continuousTimingPath = path.join(jobDir, 'tts_continuous_timing.json');
          fs.writeFileSync(continuousTimingPath, JSON.stringify({
            results: continuousResult.results,
            totalNarrationTime: continuousResult.totalNarrationTime,
            totalVideoTime: continuousResult.totalVideoTime,
            fillRate: continuousResult.fillRate,
            timelineEnd: continuousResult.timelineEnd,
          }, null, 2));
          console.log(`   💾 Saved timing data to tts_continuous_timing.json`);
          
          // Convert continuous result to standard TTS result format
          ttsResult = {
            stats: {
              success: continuousResult.results.length,
              failed: validSegments.length - continuousResult.results.length,
              total: validSegments.length,
            },
            syncStats: {
              toleranceRate: continuousResult.fillRate,
            },
            segments: continuousResult.results.map(r => ({
              ...r,
              alignedFile: r.audioPath,
              alignedDuration: r.audioDuration,
            })),
            mode: "continuous_narrator",
            xttsMetrics: continuousResult.xttsMetrics,
          };
        } else {
          // Standard XTTS: per-segment cloned voice TTS
          const xttsResult = await generateAndAlignXTTS(
            validSegments,
            voiceSamples,
            jobDir,
            {
              language,
              level,
              concurrency: 10,       // Replicate allows 600/min
              mergeOverlaps: false,  // Keep segments separate
              adjustSpeed: true,     // Gentle speedup (max 1.5x)
              skipExtreme: true,     // Skip segments needing >1.5x speedup
            }
          );
          
          // Convert XTTS result to standard TTS result format
          ttsResult = {
            stats: {
              success: xttsResult.stats.successful,
              failed: xttsResult.stats.failed,
              total: xttsResult.stats.total,
            },
            syncStats: {
              toleranceRate: xttsResult.stats.successful / xttsResult.stats.total,
            },
            segments: xttsResult.results
              .filter(r => r.audioPath || r.useOriginal) // Include segments using original audio
              .map(r => ({
                ...r.segment,
                alignedFile: r.audioPath,
                alignedDuration: r.duration,
                index: r.idx,
                useOriginal: r.useOriginal, // Pass through the flag
                idx: r.idx, // Needed for extraction later
                start: r.start,
                end: r.end,
              })),
          };
        }
      }
    } else if (premium) {
      console.log(`   🎙️ Using ElevenLabs Premium TTS`);
      ttsResult = await generateTTS(validSegments, jobDir, {
        premium: true,
        voice: finalVoice,
        concurrency: 3, // ElevenLabs needs lower concurrency
        durationTolerance: 0.2,
        maxRetries: 1,
        multiSpeaker: true,
        defaultGender: detectedGender,
        speakerGenders: speakerGenders,
        speakerVoices: assignedVoices ? createCustomSpeakerVoiceMap(validSegments, assignedVoices, speakerReorderInfo) : null,
        mode: currentMode,
        language,
      });
    } else {
      // Standard Lemonfox TTS
      ttsResult = await generateTTS(validSegments, jobDir, {
        premium: false,
        voice: finalVoice,
        concurrency: 40,
        durationTolerance: 0.2,
        maxRetries: 1,
        multiSpeaker: true,
        defaultGender: detectedGender,
        speakerGenders: speakerGenders,
        speakerVoices: assignedVoices ? createCustomSpeakerVoiceMap(validSegments, assignedVoices, speakerReorderInfo) : null,
        mode: currentMode,
        language
      });
    }
    timings.tts = (Date.now() - stepStart) / 1000;
    tracker.addMetadata("tts", "segments_generated", ttsResult.stats?.success || ttsResult.stats?.successful || 0);
    if (ttsResult.syncStats?.toleranceRate !== undefined) {
      tracker.addMetadata(
        "tts",
        "within_tolerance",
        `${(ttsResult.syncStats.toleranceRate * 100).toFixed(0)}%`
      );
    }
    
    // Add XTTS-specific metadata if using voice cloning
    if (ttsResult.xttsMetrics) {
      const metrics = ttsResult.xttsMetrics;
      tracker.addMetadata("tts", "xtts_blocks", metrics.blocksGenerated);
      tracker.addMetadata("tts", "xtts_retries", metrics.retriesCount);
      tracker.addMetadata("tts", "xtts_concurrency", metrics.concurrency);
      if (metrics.speedMetrics) {
        tracker.addMetadata("tts", "xtts_avg_speed", `${metrics.speedMetrics.average.toFixed(1)} c/s`);
        tracker.addMetadata("tts", "xtts_quality", `${metrics.speedMetrics.normal}/${metrics.blocksGenerated} normal`);
      }
    }
    tracker.endStep("tts");

    // Save TTS results
    fs.writeFileSync(
      path.join(jobDir, "tts_result.json"),
      JSON.stringify(
        {
          voice: finalVoice,
          stats: ttsResult.stats,
          syncStats: ttsResult.syncStats || null,
          segments: ttsResult.segments.map((s) => ({
            index: s.index,
            start: s.start,
            end: s.end,
            targetDuration: s.targetDuration,
            alignedDuration: s.alignedDuration,
            ratio: s.ratio,
            alignedFile: s.alignedFile ? path.basename(s.alignedFile) : null,
          })),
          generatedAt: new Date().toISOString(),
        },
        null,
        2
      )
    );

    // ═══════════════════════════════════════════════════════════════
    // STEP 7: MERGE - Combine background + TTS
    // NOW we need the split result - wait for it if still running
    // ═══════════════════════════════════════════════════════════════
    console.log(`\n   ⏳ Waiting for Split to complete (if still running)...`);
    tracker.startSubstep("split", "wait_for_completion");
    const splitWaitStart = Date.now();
    const splitResult = await splitPromise;
    const splitWaitTime = (Date.now() - splitWaitStart) / 1000;
    tracker.endSubstep("split", "wait_for_completion");

    // Split total time = its processing time (reported by the module)
    timings.split = splitResult.processingTime || 0;
    tracker.addMetadata("split", "chunks", splitResult.chunks || 1);
    tracker.addMetadata("split", "model", `${splitModel} (shifts=${splitShifts})`);
    tracker.addMetadata(
      "split",
      "parallel_saved",
      splitWaitTime < 1
        ? `${(timings.transcribe + timings.translate + timings.tts).toFixed(
            0
          )}s`
        : "0s"
    );
    tracker.endStep("split");

    if (splitWaitTime < 1) {
      console.log(
        `   ✅ Split was already done! (completed during Translate/TTS)`
      );
      console.log(
        `   ⚡ Saved ~${(
          timings.transcribe +
          timings.translate +
          timings.tts
        ).toFixed(0)}s by running in parallel!`
      );
    } else {
      console.log(
        `   ✅ Split finished (waited ${splitWaitTime.toFixed(1)}s more)`
      );
    }

    // Validate separation
    const validation = validateSeparation(
      splitResult.vocals,
      splitResult.background
    );

    tracker.startStep("merge");
    stepStart = Date.now();

    const backgroundPath = splitResult.background;
    const vocalsPath = splitResult.vocals;
    
    // Include mode in filename so different modes don't overwrite each other
    const modeSuffix = currentMode !== "synced" ? `_${currentMode}` : "";
    const dubbedAudioPath = path.join(jobDir, `dubbed_audio${modeSuffix}.m4a`); // M4A = AAC, allows stream copy in render

    // NOTE: Lemonfox fallback is REMOVED. 100% XTTS with smart timing.
    // XTTS handles timing via: silence padding (too short) or gentle atempo (too long)
    const segmentsNeedingFallback = ttsResult.segments.filter(s => s.needsFallbackTTS);
    if (segmentsNeedingFallback.length > 0) {
      // This shouldn't happen anymore with the new XTTS logic, but log just in case
      console.log(`\n   ⚠️ ${segmentsNeedingFallback.length} segments flagged for fallback (unexpected with new XTTS logic)`);
    }

    // Build segment list with full paths (include both TTS and original audio segments)
    let segmentsForMerge = ttsResult.segments
      .filter((s) => s.alignedFile && !s.error && !s.skipped)
      .map((s) => ({
        ...s,
        alignedFile: s.alignedFile,
      }));

    // NARRATOR-ONLY MODE: Add original vocals for non-narrator segments
    if (mode === "narrator-only" && narratorOnlyInfo) {
      console.log(`\n   🎙️ NARRATOR-ONLY: Extracting original audio for non-narrator segments...`);
      const otherSegmentsDir = path.join(jobDir, "other_segments");
      fs.mkdirSync(otherSegmentsDir, { recursive: true });
      
      let extractedCount = 0;
      for (const seg of narratorOnlyInfo.otherSegments) {
        const originalAudioPath = path.join(otherSegmentsDir, `original_seg_${seg.index || extractedCount}.mp3`);
        const duration = seg.end - seg.start;
        try {
          execSync(
            `ffmpeg -y -ss ${seg.start} -t ${duration} -i "${vocalsPath}" -ar 44100 -ac 2 -b:a 192k "${originalAudioPath}"`,
            { encoding: "utf-8", stdio: ["pipe", "pipe", "pipe"], timeout: 30000 }
          );
          
          // Add to segments for merge
          segmentsForMerge.push({
            ...seg,
            alignedFile: originalAudioPath,
            alignedDuration: duration,
            useOriginal: true,
          });
          extractedCount++;
        } catch (e) {
          console.log(`      ⚠️ Seg ${seg.index}: failed to extract - ${e.message.substring(0, 50)}`);
        }
      }
      console.log(`   ✅ Extracted ${extractedCount} non-narrator segments`);
      
      // Re-sort by start time
      segmentsForMerge = segmentsForMerge.sort((a, b) => a.start - b.start);
    }

    const mergeResult = await merge(
      backgroundPath,
      segmentsForMerge,
      dubbedAudioPath,
      {
        backgroundVolume: 0.35, // 35% - reduced so voice is clearer
        ttsVolume: 2.8, // 280% - much louder voice
      }
    );
    timings.merge = (Date.now() - stepStart) / 1000;
    tracker.addMetadata("merge", "segments_merged", segmentsForMerge.length);
    tracker.addMetadata(
      "merge",
      "output_size",
      `${(mergeResult.size / 1024 / 1024).toFixed(1)}MB`
    );
    tracker.endStep("merge");

    // ═══════════════════════════════════════════════════════════════
    // STEP 7.5: SUBTITLES - Generate dual captions (original + translated)
    // ═══════════════════════════════════════════════════════════════
    const subtitlePath = path.join(jobDir, `subtitles${modeSuffix}.srt`);
    const languageFlags = {
      spanish: "🇪🇸",
      indonesian: "🇮🇩",
      french: "🇫🇷",
      german: "🇩🇪",
      portuguese: "🇧🇷",
      italian: "🇮🇹",
    };
    
    const subtitleResult = generateSubtitles(segmentsForMerge, subtitlePath, {
      mode: "dual",
      originalLabel: "🇺🇸",
      translatedLabel: languageFlags[language] || "🌍",
    });
    console.log(`   📝 Generated ${subtitleResult.count} dual subtitles`);

    // ═══════════════════════════════════════════════════════════════
    // STEP 8: RENDER - Final video with dubbed audio
    // ═══════════════════════════════════════════════════════════════
    tracker.startStep("render");
    stepStart = Date.now();

    const videoPath = ingestResult.videoPath;
    const dubbedVideoPath = path.join(jobDir, `dubbed_video${modeSuffix}.mp4`);
    
    // For extended mode: process overflow segments for video stretching
    let stretchResult = null;
    if (currentMode === "extended" && ttsResult.overflowStats?.segmentsNeedingStretch > 0) {
      console.log(`\n   📺 Extended mode: Processing ${ttsResult.overflowStats.segmentsNeedingStretch} overflow segments...`);
      stretchResult = await processOverflowSegments(
        videoPath,
        ttsResult.overflowStats.segments,
        jobDir
      );
      // Note: Full video reassembly with stretched segments is TODO
      // For now, stretched segments are saved separately
    }
    
    // For learner mode: skip video render, only output audio
    let renderResult = null;
    if (currentMode === "learner") {
      console.log(`   🎓 Learner mode: Skipping video render (audio-only output)`);
      timings.render = 0;
      tracker.addMetadata("render", "skipped", "learner mode (audio only)");
      tracker.endStep("render");
    } else if (currentMode === "brainrot") {
      // Brainrot mode: speed up video to match narration length
      console.log(`   🧠 Brainrot mode: Rendering with video speed-up...`);
      renderResult = await renderVideoBrainrot(
        videoPath,
        dubbedAudioPath,
        dubbedVideoPath,
        { maxSpeedup: 2.0 }
      );
      timings.render = (Date.now() - stepStart) / 1000;
      tracker.addMetadata(
        "render",
        "output_size",
        `${(renderResult.size / 1024 / 1024).toFixed(1)}MB`
      );
      tracker.addMetadata(
        "render",
        "speedup",
        `${renderResult.speedup?.toFixed(2)}x`
      );
      tracker.endStep("render");
    } else {
      renderResult = await renderVideo(
        videoPath,
        dubbedAudioPath,
        dubbedVideoPath,
        {
          subtitlePath: burnSubs ? subtitlePath : null,  // Burn subs if --subs flag
        }
      );
      timings.render = (Date.now() - stepStart) / 1000;
      tracker.addMetadata(
        "render",
        "output_size",
        `${(renderResult.size / 1024 / 1024).toFixed(1)}MB`
      );
      tracker.addMetadata(
        "render",
        "audio_codec",
        dubbedAudioPath.endsWith(".m4a") ? "stream_copy" : "transcode"
      );
      tracker.endStep("render");
    }

    // ═══════════════════════════════════════════════════════════════
    // STEP 9: LIP-SYNC (Optional) - AI lip-sync with Sync Labs
    // ═══════════════════════════════════════════════════════════════
    let lipsyncVideoPath = null;
    
    if (doLipsync && currentMode !== "learner" && renderResult) {
      tracker.startStep("lipsync");
      stepStart = Date.now();
      
      if (!process.env.SYNCLABS_API_KEY) {
        console.log(`\n   ⚠️ SYNCLABS_API_KEY not set, skipping lip-sync`);
        tracker.addMetadata("lipsync", "skipped", "no API key");
        tracker.endStep("lipsync");
      } else {
        console.log(`\n   👄 Running AI lip-sync (this may take 5-10 minutes)...`);
        lipsyncVideoPath = path.join(jobDir, `dubbed_video_lipsync${modeSuffix}.mp4`);
        
        try {
          const lipsyncResult = await lipsync(
            dubbedVideoPath, // Use the rendered video
            dubbedAudioPath,
            lipsyncVideoPath,
            { model: "lipsync-1.9.0-beta" } // Use cheaper model
          );
          
          timings.lipsync = (Date.now() - stepStart) / 1000;
          tracker.addMetadata("lipsync", "processing_time", `${lipsyncResult.processingTime?.toFixed(0)}s`);
          tracker.addMetadata("lipsync", "model", "lipsync-1.9.0-beta");
          tracker.endStep("lipsync");
          
          console.log(`   ✅ Lip-sync complete! Processing: ${lipsyncResult.processingTime?.toFixed(0)}s`);
        } catch (err) {
          console.log(`   ❌ Lip-sync failed: ${err.message}`);
          tracker.addMetadata("lipsync", "error", err.message);
          tracker.endStep("lipsync");
          lipsyncVideoPath = null;
        }
      }
    }

    // ═══════════════════════════════════════════════════════════════
    // DONE - Print summary
    // ═══════════════════════════════════════════════════════════════
    const totalTime = (Date.now() - pipelineStart) / 1000;

    // Save manifest
    const manifest = {
      jobId,
      completedAt: new Date().toISOString(),
      source: {
        type: ingestResult.source.type,
        url: ingestResult.source.url,
        title: ingestResult.title,
        titleSanitized: ingestResult.titleSanitized,
        uploader: ingestResult.uploader,
      },
      settings: {
        level,
        levelName: LEVEL_GUIDES[level].name,
        voice: finalVoice,
        voiceType,
        mode: currentMode,
        modeDescription: OUTPUT_MODES[currentMode]?.description || "Unknown mode",
        premium,
        clone,
        lipsync: doLipsync,
        ttsProvider: clone ? "xtts" : (premium ? "elevenlabs" : "lemonfox"),
        language,
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
        detailedTimings: tracker.getSummary(),
        overflowSegments: ttsResult.overflowStats?.segmentsNeedingStretch || 0,
        totalStretchNeeded: ttsResult.overflowStats?.totalStretchNeeded || 0,
      },
      outputs: {
        video: currentMode !== "learner" ? `dubbed_video${modeSuffix}.mp4` : null,
        videoLipsync: lipsyncVideoPath ? `dubbed_video_lipsync${modeSuffix}.mp4` : null,
        audio: `dubbed_audio${modeSuffix}.m4a`,
        voiceOnly: mergeResult.ttsOnlyPath ? path.basename(mergeResult.ttsOnlyPath) : null,
        background: mergeResult.backgroundPath ? path.basename(mergeResult.backgroundPath) : null,
        transcription: "transcription.json",
        translation: "translation.json",
        // Title-based filenames (for easy identification)
        videoTitled: null,
        audioTitled: null,
      },
    };
    
    // Create title-based copies of output files (easier to identify)
    const titleBase = ingestResult.titleSanitized || jobId;
    const levelSuffix = `_${level}_${language}`;
    
    if (currentMode !== "learner" && renderResult?.outputPath) {
      const titledVideoPath = path.join(jobDir, `${titleBase}${levelSuffix}${modeSuffix}.mp4`);
      try {
        fs.copyFileSync(renderResult.outputPath, titledVideoPath);
        manifest.outputs.videoTitled = `${titleBase}${levelSuffix}${modeSuffix}.mp4`;
        console.log(`   📁 Created titled copy: ${path.basename(titledVideoPath)}`);
      } catch (e) { /* ignore copy errors */ }
    }
    
    const titledAudioPath = path.join(jobDir, `${titleBase}${levelSuffix}${modeSuffix}.m4a`);
    try {
      fs.copyFileSync(dubbedAudioPath, titledAudioPath);
      manifest.outputs.audioTitled = `${titleBase}${levelSuffix}${modeSuffix}.m4a`;
    } catch (e) { /* ignore copy errors */ }

    fs.writeFileSync(
      path.join(jobDir, "manifest.json"),
      JSON.stringify(manifest, null, 2)
    );

    console.log(`
╔══════════════════════════════════════════════════════════════╗
║                                                              ║
║   🎉  P I P E L I N E   C O M P L E T E !                    ║
║                                                              ║
╠══════════════════════════════════════════════════════════════╣
║                                                              ║
║   📁 Job: ${jobId.padEnd(43)}║
║   ⏱️  Total time: ${formatDuration(totalTime).padEnd(39)}║
║                                                              ║
║   📊 Timing breakdown:                                       ║
║      Ingest:     ${timings.ingest
      .toFixed(1)
      .padEnd(6)}s                                 ║
║      Split:      ${timings.split
      .toFixed(1)
      .padEnd(6)}s (Demucs)                        ║
║      Transcribe: ${timings.transcribe
      .toFixed(1)
      .padEnd(6)}s (Whisper)                       ║
║      Translate:  ${timings.translate
      .toFixed(1)
      .padEnd(6)}s (Gemini)                        ║
║      TTS:        ${timings.tts
      .toFixed(1)
      .padEnd(6)}s (${clone ? "XTTS Replicate" : premium ? "ElevenLabs Premium" : "Lemonfox"})                       ║
║      Merge:      ${timings.merge
      .toFixed(1)
      .padEnd(6)}s (FFmpeg)                        ║
║      Render:     ${timings.render
      .toFixed(1)
      .padEnd(6)}s ${currentMode === "learner" ? "(skipped - audio only)" : "(FFmpeg)"}                        ║
║                                                              ║
║   🎯 Mode: ${currentMode.toUpperCase().padEnd(50)}║
║                                                              ║
║   📦 Output files:                                           ║${
      currentMode !== "learner"
        ? `
║      🎬 dubbed_video${modeSuffix}.mp4 (${(renderResult?.size / 1024 / 1024 || 0)
            .toFixed(1)
            .padEnd(5)} MB)                       ║`
        : ""
    }
║      🎵 dubbed_audio${modeSuffix}.m4a (${(mergeResult.size / 1024 / 1024)
      .toFixed(1)
      .padEnd(5)} MB)                       ║${
      ttsResult.overflowStats?.segmentsNeedingStretch > 0
        ? `
║      ⚠️  ${ttsResult.overflowStats.segmentsNeedingStretch} segments need ${ttsResult.overflowStats.totalStretchNeeded.toFixed(1)}s video stretch      ║`
        : ""
    }
║                                                              ║
║   📂 Full path:                                              ║
║      ${(currentMode !== "learner" ? dubbedVideoPath : dubbedAudioPath).substring(0, 55)}
║                                                              ║
╚══════════════════════════════════════════════════════════════╝

🎧 Play the output:${
      currentMode !== "learner"
        ? `
   mpv "${dubbedVideoPath}"
   # or
   vlc "${dubbedVideoPath}"`
        : `
   mpv "${dubbedAudioPath}"  # Audio only (learner mode)
   # or
   vlc "${dubbedAudioPath}"`
    }
   # or open in your file manager
    `);

    // Print detailed timing report
    tracker.printReport();

    // Save detailed timing data
    fs.writeFileSync(
      path.join(jobDir, "timing_report.json"),
      JSON.stringify(tracker.toJSON(), null, 2)
    );

    // Auto-run timing analysis for narrator mode with XTTS
    if (currentMode === "narrator" && clone) {
      console.log('\n' + '═'.repeat(70));
      console.log('📊 AUTO-ANALYSIS: Running timing analysis...');
      console.log('═'.repeat(70) + '\n');
      
      try {
        const { execSync } = require('child_process');
        execSync(`node "${path.join(__dirname, 'analyze-timing.js')}" "${jobId}"`, {
          stdio: 'inherit',
          cwd: __dirname
        });
      } catch (err) {
        console.error('⚠️ Analysis failed:', err.message);
        console.log('💡 You can run it manually: node analyze-timing.js', jobId);
      }
    }

    // ═══════════════════════════════════════════════════════════════
    // FINAL OUTPUT - Print file path for easy access
    // ═══════════════════════════════════════════════════════════════
    const outputFile = currentMode !== "learner" ? dubbedVideoPath : dubbedAudioPath;
    const fileType = currentMode !== "learner" ? "VIDEO" : "AUDIO";
    console.log("\n" + "═".repeat(80));
    console.log(`🎬 OUTPUT ${fileType}:`);
    console.log(`   ${outputFile}`);
    console.log("═".repeat(80) + "\n");

    return {
      success: true,
      jobId,
      jobDir,
      outputs: {
        video: dubbedVideoPath,
        audio: dubbedAudioPath,
      },
      timings,
      detailedTimings: tracker.toJSON(),
      totalTime,
    };
  } catch (error) {
    console.error(`
╔══════════════════════════════════════════════════════════════╗
║   ❌ PIPELINE FAILED                                         ║
╚══════════════════════════════════════════════════════════════╝

Error: ${error.message}

Partial output saved to: ${jobDir}
    `);
    console.error(error.stack);

    return {
      success: false,
      error: error.message,
      jobDir,
    };
  }
}

// ═══════════════════════════════════════════════════════════════
// CLI Entry Point
// ═══════════════════════════════════════════════════════════════
const args = process.argv.slice(2);

// Parse flags
const qualityMode = args.includes("--quality") || args.includes("-q");
const premiumMode = args.includes("--premium") || args.includes("-p");
const cloneMode = args.includes("--clone") || args.includes("-c");
const lipsyncMode = args.includes("--lipsync") || args.includes("-l");
const subsMode = args.includes("--subs") || args.includes("-s");  // Burn subtitles into video

// Parse time clipping flags
let startTime = null;
let clipDuration = null;
if (args.includes("--start")) {
  const idx = args.indexOf("--start");
  const startValue = args[idx + 1];
  if (!startValue || startValue.startsWith("-")) {
    console.error("❌ --start requires a time value (in seconds or MM:SS format)");
    process.exit(1);
  }
  // Parse time (support both seconds and MM:SS format)
  if (startValue.includes(":")) {
    const parts = startValue.split(":").map(Number);
    startTime = parts.length === 2 ? parts[0] * 60 + parts[1] : parts[0] * 3600 + parts[1] * 60 + parts[2];
  } else {
    startTime = parseFloat(startValue);
  }
}
if (args.includes("--duration")) {
  const idx = args.indexOf("--duration");
  const durValue = args[idx + 1];
  if (!durValue || durValue.startsWith("-")) {
    console.error("❌ --duration requires a time value (in seconds or MM:SS format)");
    process.exit(1);
  }
  // Parse time (support both seconds and MM:SS format)
  if (durValue.includes(":")) {
    const parts = durValue.split(":").map(Number);
    clipDuration = parts.length === 2 ? parts[0] * 60 + parts[1] : parts[0] * 3600 + parts[1] * 60 + parts[2];
  } else {
    clipDuration = parseFloat(durValue);
  }
}

// Custom voice sample for cloning
let customVoiceSample = null;
if (args.includes("--voice-sample")) {
  const idx = args.indexOf("--voice-sample");
  customVoiceSample = args[idx + 1];
  if (!customVoiceSample || customVoiceSample.startsWith("-")) {
    console.error("❌ --voice-sample requires a file path");
    process.exit(1);
  }
  // Resolve relative to samples/ or absolute path
  if (!customVoiceSample.startsWith("/")) {
    const samplesPath = path.join(__dirname, "samples", customVoiceSample);
    if (fs.existsSync(samplesPath)) {
      customVoiceSample = samplesPath;
    } else if (fs.existsSync(customVoiceSample)) {
      customVoiceSample = path.resolve(customVoiceSample);
    } else {
      console.error(`❌ Voice sample not found: ${customVoiceSample}`);
      console.error(`   Looked in: samples/${customVoiceSample} and ${customVoiceSample}`);
      process.exit(1);
    }
  }
}

// Narrator mode and voice source options
let narratorMode = null;
let voiceSource = null;
let voiceStartTime = null;
let voiceDuration = null;
let voiceYoutubeUrl = null;
let voiceFilePath = null;

if (args.includes("--narrator-mode")) {
  const idx = args.indexOf("--narrator-mode");
  narratorMode = args[idx + 1];
}
if (args.includes("--voice-source")) {
  const idx = args.indexOf("--voice-source");
  voiceSource = args[idx + 1];
}
if (args.includes("--voice-start")) {
  const idx = args.indexOf("--voice-start");
  voiceStartTime = args[idx + 1];
}
if (args.includes("--voice-duration")) {
  const idx = args.indexOf("--voice-duration");
  voiceDuration = args[idx + 1];
}
if (args.includes("--voice-youtube")) {
  const idx = args.indexOf("--voice-youtube");
  voiceYoutubeUrl = args[idx + 1];
}
if (args.includes("--voice-file")) {
  const idx = args.indexOf("--voice-file");
  voiceFilePath = args[idx + 1];
  if (voiceFilePath && !voiceFilePath.startsWith("/")) {
    voiceFilePath = path.resolve(voiceFilePath);
  }
}

// Character perspective mode
let characterName = null;
let characterTraits = null;
if (args.includes("--character")) {
  const idx = args.indexOf("--character");
  characterName = args[idx + 1];
  if (!characterName || characterName.startsWith("-")) {
    console.error("❌ --character requires a character name");
    process.exit(1);
  }
}
if (args.includes("--character-traits")) {
  const idx = args.indexOf("--character-traits");
  characterTraits = args[idx + 1];
  if (!characterTraits || characterTraits.startsWith("-")) {
    console.error("❌ --character-traits requires a description");
    process.exit(1);
  }
}

// Multi-speaker voice assignment
let speakerCount = null;
let assignedVoices = null;
if (args.includes("--speakers")) {
  const idx = args.indexOf("--speakers");
  const speakerValue = args[idx + 1];
  if (!speakerValue || speakerValue.startsWith("-")) {
    console.error("❌ --speakers requires a number or 'auto'");
    process.exit(1);
  }
  speakerCount = speakerValue === "auto" ? "auto" : parseInt(speakerValue);
  if (speakerCount !== "auto" && (isNaN(speakerCount) || speakerCount < 1)) {
    console.error("❌ --speakers must be a positive number or 'auto'");
    process.exit(1);
  }
}
if (args.includes("--assign-voices")) {
  const idx = args.indexOf("--assign-voices");
  const voicesValue = args[idx + 1];
  if (!voicesValue || voicesValue.startsWith("-")) {
    console.error("❌ --assign-voices requires comma-separated voice names");
    process.exit(1);
  }
  assignedVoices = voicesValue.split(",").map(v => v.trim());
  console.log(`✅ Voice assignment: ${assignedVoices.join(", ")}`);
}

const cleanArgs = args.filter((a) => !a.startsWith("-") && a !== customVoiceSample && a !== characterName && a !== characterTraits && a !== (startTime?.toString()) && a !== (clipDuration?.toString()) && a !== (speakerCount?.toString()) && !assignedVoices?.includes(a) && a !== narratorMode && a !== voiceSource && a !== voiceStartTime && a !== voiceDuration && a !== voiceYoutubeUrl && a !== voiceFilePath);

const source = cleanArgs[0];
const level = cleanArgs[1] || "B1";
const voiceType = cleanArgs[2] || "neutral"; // alex voice (cleaner for dubbing)
const outputMode = cleanArgs[3] || "synced"; // Output mode: synced, learner, extended
const targetLanguage = cleanArgs[4] || "spanish"; // Target language: spanish, indonesian

if (!source) {
  console.log(`
🌊 Immersion v2 - Full Pipeline

Usage: 
  node pipeline-v2.js <source> [level] [voice] [mode] [language] [flags]

Arguments:
  source      YouTube URL or local file path (required)
  level       CEFR level: A1, A2, B1 (default), B2, C1
  voice       TTS voice: male, female, neutral (default), auto
  mode        Output mode: synced (default), learner, extended, brainrot
  language    Target language: spanish (default), indonesian

Output Modes:
  synced        Direct translation + original video timing
                Best for: Native-like viewing experience
  
  narrator      🎙️ Time-filling: MORE simple words + slower speech
                A1=0.70x fills 80% of time, C1=1.0x fills 90%
                Best for: Beginners who want thorough explanations with normal video
  
  narrator-only 🎤 Only dub the dominant speaker (narrator)
                Other speakers keep original audio
                Best for: Videos with main narrator + occasional guests
  
  learner       Slower TTS (0.8x speed) + audio-only output
                Best for: Language learners practicing listening
  
  extended      Full translation + video stretched to fit audio
                Best for: Complete understanding with visual context
  
  brainrot      🧠 TikTok-style third-person narration + sped-up video
                Best for: Short-form content, movie recaps, satisfying background

Languages:
  spanish     Spanish with native Spanish voices (default)
  indonesian  Indonesian with Indonesian voices (Firman, Bian, Meraki)

Flags:
  --premium               🎙️ Use ElevenLabs premium TTS (higher quality, more natural)
  -p                      Shorthand for --premium
  --clone                 🎤 Voice cloning via XTTS (clones original speaker's voice!)
  -c                      Shorthand for --clone
  --voice-sample FILE     🎙️ Use custom voice sample for cloning (instead of extracting from video)
  --speakers N            👥 Number of speakers (auto or number, enables activity-based reordering)
  --assign-voices LIST    🎭 Comma-separated voice names (SPEAKER_00 gets first, etc.)
                          Example: "firman,bian,meraki" or "adam,veronica,josh"
  --character NAME        🎭 Character perspective (1st person POV narration)
  --character-traits DESC 💬 Character personality/traits (optional, for better narration)
  --lipsync               👄 AI lip-sync via Sync Labs (morphs lips to match audio)
  -l                      Shorthand for --lipsync
  --quality               Better audio separation (htdemucs_ft + shifts=2, slower)
  -q                      Shorthand for --quality
  --start TIME            ✂️  Start time for clipping (seconds or MM:SS or HH:MM:SS)
  --duration TIME         ✂️  Duration for clipping (seconds or MM:SS or HH:MM:SS)

Examples:
  node pipeline-v2.js "https://www.youtube.com/watch?v=dQw4w9WgXcQ"
  node pipeline-v2.js "https://www.youtube.com/watch?v=VIDEO_ID" B1 female
  node pipeline-v2.js "./my-video.mp4" A2 male synced spanish
  node pipeline-v2.js "./my-video.mp4" A2 male synced indonesian --premium  # Premium Indonesian!
  node pipeline-v2.js "./my-video.mp4" A1 neutral narrator spanish --premium
  node pipeline-v2.js "./my-video.mp4" A2 neutral brainrot spanish
  node pipeline-v2.js "./my-video.mp4" A2 male learner spanish --quality
  
  # Clip 10 minutes starting from 5:00 (5 minutes)
  node pipeline-v2.js "https://youtube.com/watch?v=VIDEO_ID" B1 neutral narrator indonesian --premium --start 5:00 --duration 10:00
  
  # Narrator-only mode: only dub the main speaker (keep others in original audio)
  node pipeline-v2.js "https://youtube.com/watch?v=VIDEO_ID" B1 neutral narrator-only indonesian --premium --start 0 --duration 10:00
  
  # Multi-speaker with custom voices (auto-detects speakers, orders by activity)
  node pipeline-v2.js "https://youtube.com/watch?v=VIDEO_ID" B1 auto synced indonesian --premium \
    --speakers auto \
    --assign-voices "firman,bian,meraki"
  # SPEAKER_00 (most active) → Firman, SPEAKER_01 → Bian, SPEAKER_02 → Meraki
  
  # Force 2 speakers with specific Spanish voices
  node pipeline-v2.js "video.mp4" B2 auto synced spanish --premium \
    --speakers 2 \
    --assign-voices "adam,veronica"
  
  # Clip 10 minutes from a 1hr video (using seconds)
  node pipeline-v2.js "https://youtube.com/watch?v=VIDEO_ID" B1 neutral narrator indonesian --premium --start 300 --duration 600
  
  # Voice cloning + lip-sync (full dubbing experience!)
  node pipeline-v2.js "./my-video.mp4" B1 auto synced spanish --clone --lipsync
  
  # Use a specific voice sample for cloning (e.g., from extract-voice-samples.js)
  node pipeline-v2.js "video.mp4" B2 auto narrator spanish --clone --voice-sample "mkbhd_sample1.wav"
  
  # Character perspective narration (e.g., Jack from Lost narrates a Lost recap)
  node pipeline-v2.js "Lost-Recap.mp4" B2 auto narrator english --clone \
    --voice-sample "jack_voice.wav" \
    --character "Jack Shephard" \
    --character-traits "doctor, leader, man of science, determined"

Cost: 
  Standard:  ~$0.10 per 5-minute video (Replicate + Lemonfox)
  Premium:   ~$0.50 per 5-minute video (Replicate + ElevenLabs)
  Clone:     ~$0.40 per 5-minute video (XTTS voice cloning)
  Lip-sync:  ~$6.00 per 5-minute video (Sync Labs, cheap model)

Pipeline steps:
  1. Ingest     - Download video, extract audio (yt-dlp + FFmpeg)
  2. Split      - Separate vocals/background (Replicate Demucs)
  3. Transcribe - Speech-to-text (Lemonfox Whisper)
  4. Translate  - English → Target Language (Gemini 2.5 Flash)
  5. TTS        - Generate dubbed audio (Lemonfox, ElevenLabs, or XTTS clone)
  6. Merge      - Combine background + TTS (FFmpeg amix)
  7. Render     - Final video (FFmpeg)
  8. Lip-sync   - (Optional) AI lip-sync (Sync Labs)
  `);
  process.exit(0);
}

runPipeline(source, { level, voiceType, quality: qualityMode, mode: outputMode, language: targetLanguage, premium: premiumMode, clone: cloneMode, lipsync: lipsyncMode, burnSubs: subsMode, start: startTime, clipDuration, speakerCount, assignedVoices, narratorMode, voiceSource, voiceStartTime, voiceDuration, voiceYoutubeUrl, voiceFilePath })
  .then((result) => {
    process.exit(result.success ? 0 : 1);
  })
  .catch((error) => {
    console.error("Fatal error:", error);
    process.exit(1);
  });
