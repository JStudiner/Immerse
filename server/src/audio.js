const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

// Lemonfox API - $2.50 per 1M characters!
// Get your key at: https://www.lemonfox.ai
const LEMONFOX_API_KEY = process.env.LEMONFOX_API_KEY;
const TTS_ENDPOINT = "https://api.lemonfox.ai/v1/audio/speech";

/**
 * Available voices for Spanish
 * Full list at: https://www.lemonfox.ai/apis/text-to-speech
 */
const VOICES = {
  // Spanish voices
  dora: "dora", // Female Spanish
  noel: "noel", // Male Spanish
  alex: "alex", // Spanish

  // English voices
  nova: "nova", // American Female
  eric: "eric", // American Male
  emma: "emma", // British Female
};

// Default voice - Noel for Spanish male
const DEFAULT_VOICE = "noel";

/**
 * Get audio duration using ffprobe
 */
function getAudioDuration(filePath) {
  try {
    const result = execSync(
      `ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "${filePath}"`,
      { encoding: "utf-8" }
    );
    return parseFloat(result.trim());
  } catch {
    return null;
  }
}

/**
 * Generate audio for a single chunk using Lemonfox TTS
 */
async function generateChunkAudio(
  spanishText,
  chunkIndex,
  outputDir,
  voiceKey = DEFAULT_VOICE
) {
  const fileName = `chunk_${String(chunkIndex).padStart(3, "0")}.mp3`;
  const filePath = path.join(outputDir, fileName);

  const voice = VOICES[voiceKey] || VOICES[DEFAULT_VOICE];

  try {
    const response = await fetch(TTS_ENDPOINT, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LEMONFOX_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        input: spanishText,
        voice: voice,
        language: "es", // Spanish
        response_format: "mp3",
        speed: 0.85, // Slower pace - helps fill video duration and aids comprehension
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`HTTP ${response.status}: ${errorText}`);
    }

    // Response is the audio file directly
    const audioBuffer = Buffer.from(await response.arrayBuffer());

    fs.writeFileSync(filePath, audioBuffer);

    // Get actual TTS audio duration for sync analysis
    const actualDuration = getAudioDuration(filePath);

    console.log(
      `    ✅ Saved: ${fileName} (${(audioBuffer.length / 1024).toFixed(
        1
      )} KB, ${actualDuration?.toFixed(2) || "?"}s)`
    );

    return {
      fileName,
      filePath,
      size: audioBuffer.length,
      actualDuration, // Include for sync verification
    };
  } catch (error) {
    console.error(`    ❌ Audio generation failed: ${error.message}`);
    throw error;
  }
}

/**
 * Generate audio for all simplified chunks (parallel for speed)
 */
async function generateAllAudio(
  simplifiedChunks,
  jobId,
  voiceKey = DEFAULT_VOICE,
  concurrency = 10
) {
  const outputDir = path.join(__dirname, "..", "output", jobId);

  // Create output directory
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  console.log(
    `\n🎙️ Generating audio for ${simplifiedChunks.length} chunks (Lemonfox TTS, ${concurrency} parallel)...\n`
  );
  console.log(`   Voice: ${voiceKey}\n`);

  const audioFiles = new Array(simplifiedChunks.length);

  // Process in parallel batches
  for (let i = 0; i < simplifiedChunks.length; i += concurrency) {
    const batch = simplifiedChunks.slice(i, i + concurrency);
    const batchNum = Math.floor(i / concurrency) + 1;
    const totalBatches = Math.ceil(simplifiedChunks.length / concurrency);

    console.log(`  ⚡ TTS batch ${batchNum}/${totalBatches}...`);

    const batchResults = await Promise.all(
      batch.map(async (chunk) => {
        const audioResult = await generateChunkAudio(
          chunk.spanishText,
          chunk.index,
          outputDir,
          voiceKey
        );
        return {
          ...chunk,
          audio: audioResult,
        };
      })
    );

    // Place in correct order
    batchResults.forEach((result) => {
      audioFiles[result.index] = result;
    });
  }

  console.log(`\n✅ All audio generated in: ${outputDir}\n`);

  return {
    outputDir,
    audioFiles,
  };
}

/**
 * Generate audio for a single segment using Lemonfox TTS
 * Uses natural speech speed - timing gaps are acceptable for natural sound
 */
async function generateSegmentAudio(
  spanishText,
  segmentIndex,
  targetDuration,
  outputDir,
  voiceKey = DEFAULT_VOICE
) {
  const fileName = `seg_${String(segmentIndex).padStart(4, "0")}.mp3`;
  const filePath = path.join(outputDir, fileName);

  const voice = VOICES[voiceKey] || VOICES[DEFAULT_VOICE];

  // Natural speech speed - prioritize quality over exact timing
  // 0.95 is slightly slower for learner comprehension but still natural
  const speed = 0.95;

  try {
    const response = await fetch(TTS_ENDPOINT, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LEMONFOX_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        input: spanishText,
        voice: voice,
        language: "es",
        response_format: "mp3",
        speed: speed,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`HTTP ${response.status}: ${errorText}`);
    }

    const audioBuffer = Buffer.from(await response.arrayBuffer());
    fs.writeFileSync(filePath, audioBuffer);

    const actualDuration = getAudioDuration(filePath);

    return {
      fileName,
      filePath,
      size: audioBuffer.length,
      actualDuration,
    };
  } catch (error) {
    console.error(
      `    ❌ Segment ${segmentIndex} TTS failed: ${error.message}`
    );
    throw error;
  }
}

/**
 * Generate audio for all segments (fine-grained timing)
 * This processes individual segments for better sync
 */
async function generateAllSegmentAudio(
  simplifiedSegments,
  jobId,
  voiceKey = DEFAULT_VOICE,
  concurrency = 10
) {
  const outputDir = path.join(__dirname, "..", "output", jobId);

  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  console.log(
    `\n🎙️ Generating audio for ${simplifiedSegments.length} SEGMENTS (fine-grained timing)...\n`
  );
  console.log(`   Voice: ${voiceKey}, Concurrency: ${concurrency}\n`);

  const audioFiles = new Array(simplifiedSegments.length);
  let successCount = 0;
  let failCount = 0;

  // Process in parallel batches
  for (let i = 0; i < simplifiedSegments.length; i += concurrency) {
    const batch = simplifiedSegments.slice(i, i + concurrency);
    const batchNum = Math.floor(i / concurrency) + 1;
    const totalBatches = Math.ceil(simplifiedSegments.length / concurrency);

    const progress = ((i / simplifiedSegments.length) * 100).toFixed(0);
    process.stdout.write(
      `\r  ⚡ TTS batch ${batchNum}/${totalBatches} (${progress}%)...`
    );

    const batchResults = await Promise.all(
      batch.map(async (segment) => {
        try {
          const audioResult = await generateSegmentAudio(
            segment.spanishText,
            segment.index,
            segment.duration,
            outputDir,
            voiceKey
          );
          successCount++;
          return {
            ...segment,
            audio: audioResult,
          };
        } catch (error) {
          failCount++;
          // Return a placeholder for failed segments
          return {
            ...segment,
            audio: null,
            error: error.message,
          };
        }
      })
    );

    // Place in correct order
    batchResults.forEach((result) => {
      audioFiles[result.index] = result;
    });
  }

  console.log(
    `\n\n✅ Generated ${successCount}/${simplifiedSegments.length} segment audio files`
  );
  if (failCount > 0) {
    console.log(`   ⚠️ ${failCount} segments failed`);
  }
  console.log(`   Output: ${outputDir}\n`);

  return {
    outputDir,
    audioFiles: audioFiles.filter((f) => f && f.audio), // Filter out failed ones
    totalSegments: simplifiedSegments.length,
    successCount,
    failCount,
  };
}

/**
 * Create a manifest file that the frontend can use for synced playback
 * Includes timing data for sync verification
 */
function createManifest(videoId, audioFiles, jobId, level) {
  const tracks = audioFiles.map((file) => {
    const targetDuration = file.duration;
    const actualDuration = file.audio.actualDuration;
    const durationDiff = actualDuration
      ? actualDuration - targetDuration
      : null;

    return {
      index: file.index,
      start: file.start,
      end: file.end,
      duration: targetDuration, // Target duration from video
      actualDuration: actualDuration, // Actual TTS duration
      durationDiff: durationDiff, // Difference (positive = TTS is longer)
      audioUrl: `/audio/${jobId}/${file.audio.fileName}`,
      originalText: file.originalText,
      spanishText: file.spanishText,
    };
  });

  // Calculate sync summary
  const diffs = tracks
    .filter((t) => t.durationDiff !== null)
    .map((t) => t.durationDiff);
  const syncSummary =
    diffs.length > 0
      ? {
          avgDrift: diffs.reduce((a, b) => a + b, 0) / diffs.length,
          maxDrift: Math.max(...diffs),
          minDrift: Math.min(...diffs),
          totalDrift: diffs.reduce((a, b) => a + b, 0),
          chunksLonger: diffs.filter((d) => d > 0.1).length,
          chunksShorter: diffs.filter((d) => d < -0.1).length,
        }
      : null;

  const manifest = {
    jobId,
    videoId,
    level,
    createdAt: new Date().toISOString(),
    syncSummary,
    tracks,
  };

  if (syncSummary) {
    console.log(`\n📊 Sync Summary:`);
    console.log(`   Avg drift: ${syncSummary.avgDrift.toFixed(2)}s`);
    console.log(`   Total drift: ${syncSummary.totalDrift.toFixed(2)}s`);
    console.log(`   Chunks longer than target: ${syncSummary.chunksLonger}`);
    console.log(`   Chunks shorter than target: ${syncSummary.chunksShorter}`);
  }

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
 * List available voices
 */
function getAvailableVoices() {
  return Object.keys(VOICES);
}

/**
 * Generate audio for audio-only mode (no timing constraints)
 * Generates natural-paced audio for each content chunk
 */
async function generateAudioOnlyChunks(
  chunks,
  jobId,
  voiceKey = DEFAULT_VOICE,
  options = {}
) {
  const { ttsSpeed = 0.92, concurrency = 5 } = options;
  const outputDir = path.join(__dirname, "..", "output", jobId);

  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  console.log(
    `\n🎙️ Generating audio for ${chunks.length} sections (speed: ${ttsSpeed})...\n`
  );
  console.log(`   Voice: ${voiceKey}\n`);

  const audioFiles = [];

  // Process in parallel batches
  for (let i = 0; i < chunks.length; i += concurrency) {
    const batch = chunks.slice(i, i + concurrency);
    const batchNum = Math.floor(i / concurrency) + 1;
    const totalBatches = Math.ceil(chunks.length / concurrency);

    console.log(`  ⚡ TTS batch ${batchNum}/${totalBatches}...`);

    const batchResults = await Promise.all(
      batch.map(async (chunk) => {
        const fileName = `section_${String(chunk.index).padStart(3, "0")}.mp3`;
        const filePath = path.join(outputDir, fileName);
        const voice = VOICES[voiceKey] || VOICES[DEFAULT_VOICE];

        try {
          const response = await fetch(TTS_ENDPOINT, {
            method: "POST",
            headers: {
              Authorization: `Bearer ${LEMONFOX_API_KEY}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              input: chunk.spanishText,
              voice: voice,
              language: "es",
              response_format: "mp3",
              speed: ttsSpeed, // Controlled by pace setting
            }),
          });

          if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
          }

          const audioBuffer = Buffer.from(await response.arrayBuffer());
          fs.writeFileSync(filePath, audioBuffer);

          const duration = getAudioDuration(filePath);

          console.log(
            `    ✅ Section ${chunk.index + 1}: ${duration?.toFixed(1)}s`
          );

          return {
            index: chunk.index,
            fileName,
            filePath,
            duration,
            size: audioBuffer.length,
          };
        } catch (error) {
          console.error(`    ❌ Section ${chunk.index + 1} failed: ${error.message}`);
          return null;
        }
      })
    );

    audioFiles.push(...batchResults.filter((r) => r !== null));
  }

  console.log(`\n✅ Generated ${audioFiles.length}/${chunks.length} audio sections\n`);

  return {
    outputDir,
    audioFiles: audioFiles.sort((a, b) => a.index - b.index),
  };
}

module.exports = {
  generateChunkAudio,
  generateAllAudio,
  generateSegmentAudio,
  generateAllSegmentAudio,
  generateAudioOnlyChunks,
  createManifest,
  getAudioDuration,
  VOICES,
  getAvailableVoices,
  DEFAULT_VOICE,
};
