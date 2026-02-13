const { v4: uuidv4 } = require("uuid");
const { getTranscript, chunkTranscript } = require("./transcript");
const { simplifyAllChunks, simplifyAllSegments } = require("./simplify");
const {
  generateAllAudio,
  generateAllSegmentAudio,
  createManifest,
  VOICES,
} = require("./audio");

// Default voice if none provided
const DEFAULT_VOICE = "noel";

/**
 * Main processing pipeline
 * Takes a YouTube URL, level, and voice - returns a manifest for synced playback
 */
async function processVideo(url, level = "B2", voice = DEFAULT_VOICE) {
  const jobId = uuidv4();
  const startTime = Date.now();

  // Validate voice
  const selectedVoice = VOICES[voice] ? voice : DEFAULT_VOICE;

  console.log(`
╔════════════════════════════════════════════════════════╗
║  🌊 IMMERSION JOB STARTED                              ║
║  Job ID: ${jobId}  
║  Level: ${level}   Voice: ${selectedVoice}                                          
╚════════════════════════════════════════════════════════╝
  `);

  try {
    // Step 1: Get the transcript
    console.log("\n📥 STEP 1: Fetching transcript...");
    const { videoId, transcript } = await getTranscript(url);
    console.log(`   Video ID: ${videoId}`);
    console.log(`   Raw segments: ${transcript.length}`);

    // Step 2: Chunk the transcript into processable pieces
    console.log("\n📦 STEP 2: Chunking transcript...");
    const chunks = chunkTranscript(transcript, 20); // 20 second chunks
    console.log(`   Created ${chunks.length} chunks`);

    // Step 3: Simplify each chunk to Spanish at the target level
    console.log("\n🧠 STEP 3: AI Simplification...");
    const simplifiedChunks = await simplifyAllChunks(chunks, level);

    // Step 4: Generate audio for each chunk
    console.log("\n🎙️ STEP 4: Audio generation...");
    const { outputDir, audioFiles } = await generateAllAudio(
      simplifiedChunks,
      jobId,
      selectedVoice
    );

    // Step 5: Create the manifest for the frontend
    console.log("\n📋 STEP 5: Creating manifest...");
    const manifest = createManifest(videoId, audioFiles, jobId, level);

    const duration = ((Date.now() - startTime) / 1000).toFixed(1);

    console.log(`
╔════════════════════════════════════════════════════════╗
║  ✅ JOB COMPLETE                                       ║
║  Time: ${duration}s                                       
║  Output: /audio/${jobId}/                               
║  Tracks: ${manifest.tracks.length}                                        
╚════════════════════════════════════════════════════════╝
    `);

    return {
      jobId,
      videoId,
      level,
      processingTime: `${duration}s`,
      manifestUrl: `/audio/${jobId}/manifest.json`,
      tracks: manifest.tracks.length,
      youtubeUrl: `https://youtube.com/watch?v=${videoId}`,
    };
  } catch (error) {
    console.error(`\n❌ JOB FAILED: ${error.message}`);
    throw error;
  }
}

/**
 * SEGMENT-LEVEL processing pipeline (better sync!)
 * Processes individual transcript segments instead of chunks
 * for much better audio sync (2-5 second precision instead of 20 second)
 *
 * @param {string} url - YouTube URL
 * @param {string} level - CEFR level (A1, A2, B1, B2, C1)
 * @param {string} voice - Voice to use: "noel" (male) or "dora" (female)
 */
async function processVideoSegmentLevel(url, level = "A2", voice = "noel") {
  const jobId = uuidv4();
  const startTime = Date.now();

  console.log(`
╔════════════════════════════════════════════════════════╗
║  🌊 IMMERSION JOB (SEGMENT-LEVEL SYNC)                 ║
║  Job ID: ${jobId}  
║  Level: ${level}    Voice: ${voice}                                      
╚════════════════════════════════════════════════════════╝
  `);

  try {
    // Step 1: Get the transcript (raw segments)
    console.log("\n📥 STEP 1: Fetching transcript...");
    const { videoId, transcript } = await getTranscript(url);
    console.log(`   Video ID: ${videoId}`);
    console.log(`   Raw segments: ${transcript.length}`);

    // Step 2: Simplify at SEGMENT level (not chunk level!)
    console.log("\n🧠 STEP 2: AI Simplification (segment-level)...");
    const simplifiedSegments = await simplifyAllSegments(transcript, level);
    console.log(`   Processed ${simplifiedSegments.length} segments`);

    // Step 3: Generate audio for each SEGMENT
    console.log("\n🎙️ STEP 3: Audio generation (per-segment)...");
    const { outputDir, audioFiles, successCount, failCount } =
      await generateAllSegmentAudio(simplifiedSegments, jobId, voice);

    // Step 4: Create the manifest
    console.log("\n📋 STEP 4: Creating manifest...");
    const manifest = createManifest(videoId, audioFiles, jobId, level);

    const duration = ((Date.now() - startTime) / 1000).toFixed(1);

    console.log(`
╔════════════════════════════════════════════════════════╗
║  ✅ SEGMENT-LEVEL JOB COMPLETE                         ║
║  Time: ${duration}s                                       
║  Output: /audio/${jobId}/                               
║  Segments: ${manifest.tracks.length} (${successCount} success, ${failCount} failed)
╚════════════════════════════════════════════════════════╝
    `);

    return {
      jobId,
      videoId,
      level,
      processingTime: `${duration}s`,
      manifestUrl: `/audio/${jobId}/manifest.json`,
      tracks: manifest.tracks.length,
      mode: "segment-level",
      youtubeUrl: `https://youtube.com/watch?v=${videoId}`,
    };
  } catch (error) {
    console.error(`\n❌ JOB FAILED: ${error.message}`);
    throw error;
  }
}

/**
 * AUDIO-ONLY processing pipeline
 * Optimized for listening without video sync:
 * - Larger, more natural chunks (by paragraph/section)
 * - No timing constraints
 * - Natural pauses between sections
 * - Smoother, more natural flow
 */
async function processAudioOnly(url, level = "B2", voice = DEFAULT_VOICE, options = {}) {
  const {
    ttsSpeed = 0.92,      // TTS speaking speed
    pauseDuration = 0.8,  // Pause between sections
  } = options;

  const jobId = uuidv4();
  const startTime = Date.now();

  const selectedVoice = VOICES[voice] ? voice : DEFAULT_VOICE;

  console.log(`
╔════════════════════════════════════════════════════════╗
║  🎧 AUDIO-ONLY IMMERSION JOB                           ║
║  Job ID: ${jobId}  
║  Level: ${level}   Voice: ${selectedVoice}                                          
╚════════════════════════════════════════════════════════╝
  `);

  try {
    const timings = {};

    // Step 1: Get the transcript
    let stepStart = Date.now();
    console.log("\n📥 STEP 1: Fetching transcript...");
    const { videoId, transcript } = await getTranscript(url);
    console.log(`   Video ID: ${videoId}`);
    console.log(`   Raw segments: ${transcript.length}`);
    timings.transcript = ((Date.now() - stepStart) / 1000).toFixed(1);
    console.log(`   ⏱️ ${timings.transcript}s`);

    // Step 2: Combine into natural chunks (by content, not time)
    stepStart = Date.now();
    console.log("\n📦 STEP 2: Creating natural content chunks...");
    const fullText = transcript.map((s) => s.text).join(" ");
    const contentChunks = chunkByContent(fullText, 200); // ~200 words per chunk for better parallelization
    console.log(`   Created ${contentChunks.length} content sections (parallel processing)`);
    timings.chunking = ((Date.now() - stepStart) / 1000).toFixed(1);
    console.log(`   ⏱️ ${timings.chunking}s`);

    // Step 3: Simplify each chunk to Spanish at the target level
    stepStart = Date.now();
    console.log("\n🧠 STEP 3: AI Simplification (PARALLEL)...");
    const simplifiedChunks = await simplifyContentChunks(contentChunks, level);
    timings.simplification = ((Date.now() - stepStart) / 1000).toFixed(1);
    console.log(`   ⏱️ Simplification: ${timings.simplification}s`);

    // Step 4: Generate audio for each chunk (natural pacing)
    stepStart = Date.now();
    console.log(`\n🎙️ STEP 4: Audio generation (speed: ${ttsSpeed})...`);
    const { generateAudioOnlyChunks } = require("./audio");
    const { outputDir, audioFiles } = await generateAudioOnlyChunks(
      simplifiedChunks,
      jobId,
      selectedVoice,
      { ttsSpeed }
    );
    timings.tts = ((Date.now() - stepStart) / 1000).toFixed(1);
    console.log(`   ⏱️ TTS: ${timings.tts}s`);

    // Step 5: Stitch with natural pauses
    stepStart = Date.now();
    console.log(`\n🎬 STEP 5: Stitching (pause: ${pauseDuration}s)...`);
    const { stitchAudioWithPauses } = require("./stitch");
    const stitchResult = await stitchAudioWithPauses(jobId, audioFiles, {
      pauseDuration,
    });
    timings.stitch = ((Date.now() - stepStart) / 1000).toFixed(1);
    console.log(`   ⏱️ Stitch: ${timings.stitch}s`);

    // Step 6: Create manifest (simplified, no video sync)
    console.log("\n📋 STEP 6: Creating manifest...");
    const manifest = createAudioOnlyManifest(
      videoId,
      simplifiedChunks,
      audioFiles,
      jobId,
      level,
      stitchResult
    );

    const totalDuration = ((Date.now() - startTime) / 1000).toFixed(1);

    console.log(`
╔════════════════════════════════════════════════════════╗
║  ✅ AUDIO-ONLY JOB COMPLETE                            ║
║  Total: ${totalDuration}s                                       
║  ├─ Transcript: ${timings.transcript}s
║  ├─ Simplify:   ${timings.simplification}s (parallel)
║  ├─ TTS:        ${timings.tts}s (parallel)
║  └─ Stitch:     ${timings.stitch}s (fast)
║                                                        ║
║  Output: /audio/${jobId}/dubbed_audio.mp3                               
║  Sections: ${simplifiedChunks.length} | Audio: ${stitchResult.duration.toFixed(1)}s                                        
╚════════════════════════════════════════════════════════╝
    `);

    return {
      jobId,
      videoId,
      level,
      voice: selectedVoice,
      mode: "audio-only",
      processingTime: `${totalDuration}s`,
      audioUrl: `/audio/${jobId}/dubbed_audio.mp3`,
      manifestUrl: `/audio/${jobId}/manifest.json`,
      sections: simplifiedChunks.length,
      audioDuration: `${stitchResult.duration.toFixed(1)}s`,
      youtubeUrl: `https://youtube.com/watch?v=${videoId}`,
    };
  } catch (error) {
    console.error(`\n❌ JOB FAILED: ${error.message}`);
    throw error;
  }
}

/**
 * Chunk text by content (paragraphs/sections) rather than time
 * Aims for natural break points
 */
function chunkByContent(text, targetWordCount = 500) {
  const chunks = [];
  
  // Split by sentence endings
  const sentences = text
    .replace(/([.!?])\s+/g, "$1|SPLIT|")
    .split("|SPLIT|")
    .filter((s) => s.trim());

  let currentChunk = [];
  let currentWordCount = 0;

  for (const sentence of sentences) {
    const sentenceWords = sentence.trim().split(/\s+/).length;

    // If adding this sentence would exceed target, start new chunk
    if (currentWordCount + sentenceWords > targetWordCount && currentChunk.length > 0) {
      chunks.push({
        index: chunks.length,
        text: currentChunk.join(" ").trim(),
        wordCount: currentWordCount,
      });
      currentChunk = [];
      currentWordCount = 0;
    }

    currentChunk.push(sentence.trim());
    currentWordCount += sentenceWords;
  }

  // Don't forget the last chunk
  if (currentChunk.length > 0) {
    chunks.push({
      index: chunks.length,
      text: currentChunk.join(" ").trim(),
      wordCount: currentWordCount,
    });
  }

  return chunks;
}

/**
 * Simplify content chunks (no timing data needed)
 * PARALLELIZED for speed - processes all chunks concurrently
 */
async function simplifyContentChunks(chunks, level) {
  const { simplifyText } = require("./simplify");

  console.log(`\n🧠 Simplifying ${chunks.length} content sections to level ${level} (parallel)...\n`);

  const startTime = Date.now();

  // Process ALL chunks in parallel for maximum speed
  const results = await Promise.all(
    chunks.map(async (chunk, i) => {
      try {
        const spanishText = await simplifyText(chunk.text, level);
        const spanishWordCount = spanishText.split(/\s+/).length;
        console.log(`  ✅ Section ${i + 1}/${chunks.length}: ${chunk.wordCount} → ${spanishWordCount} words`);
        return {
          index: i,
          originalText: chunk.text,
          spanishText,
          originalWordCount: chunk.wordCount,
          spanishWordCount,
        };
      } catch (error) {
        console.error(`  ❌ Section ${i + 1} failed: ${error.message}`);
        return {
          index: i,
          originalText: chunk.text,
          spanishText: chunk.text,
          originalWordCount: chunk.wordCount,
          spanishWordCount: chunk.wordCount,
          error: error.message,
        };
      }
    })
  );

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log(`\n✅ All ${chunks.length} sections simplified in ${elapsed}s (parallel)\n`);

  // Sort by index to maintain order
  return results.sort((a, b) => a.index - b.index);
}

/**
 * Create manifest for audio-only mode (no video sync data)
 */
function createAudioOnlyManifest(videoId, chunks, audioFiles, jobId, level, stitchResult) {
  const fs = require("fs");
  const path = require("path");

  const manifest = {
    jobId,
    videoId,
    level,
    mode: "audio-only",
    createdAt: new Date().toISOString(),
    totalDuration: stitchResult.duration,
    audioUrl: `/audio/${jobId}/dubbed_audio.mp3`,
    tracks: chunks.map((chunk, i) => ({
      index: i,
      originalText: chunk.originalText,
      spanishText: chunk.spanishText,
      originalWordCount: chunk.originalWordCount,
      spanishWordCount: chunk.spanishWordCount,
    })),
  };

  const manifestPath = path.join(
    __dirname,
    "..",
    "output",
    jobId,
    "manifest.json"
  );
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
  console.log(`📋 Manifest saved: ${manifestPath}`);

  return manifest;
}

/**
 * Quick test function - just get transcript and simplify (no audio)
 * Useful for testing without burning ElevenLabs credits
 * @param {number} maxChunks - Max chunks to process (0 = all)
 */
async function testSimplification(url, level = "A2", maxChunks = 0) {
  console.log("\n🧪 TEST MODE: Transcript + Simplification only\n");

  const { videoId, transcript } = await getTranscript(url);
  const chunks = chunkTranscript(transcript, 30);

  // Process all chunks or limit for quick testing
  const testChunks = maxChunks > 0 ? chunks.slice(0, maxChunks) : chunks;
  console.log(
    `📊 Processing ${testChunks.length} of ${chunks.length} chunks\n`
  );

  const simplified = await simplifyAllChunks(testChunks, level);

  return {
    videoId,
    level,
    totalChunks: chunks.length,
    processedChunks: testChunks.length,
    samples: simplified.map((s) => ({
      original: s.originalText,
      spanish: s.spanishText,
      timing: `${s.start.toFixed(1)}s - ${s.end.toFixed(1)}s`,
      originalWordCount: s.originalText.split(" ").length,
      spanishWordCount: s.spanishText.split(" ").length,
    })),
  };
}

module.exports = {
  processVideo,
  processVideoSegmentLevel,
  processAudioOnly,
  testSimplification,
};
