#!/usr/bin/env node
/**
 * Voice Sample Extractor
 * 
 * Intelligently extracts high-quality voice samples from a video for XTTS cloning.
 * 
 * Features:
 * - Finds the cleanest speech segments (no music/background noise)
 * - Analyzes volume, clarity, and speech density
 * - Extracts multiple samples with quality scores
 * - Lets you preview and choose the best one
 * 
 * Usage:
 *   node extract-voice-samples.js <youtube-url-or-file>
 *   node extract-voice-samples.js <youtube-url-or-file> --speaker "SPEAKER_00"
 *   node extract-voice-samples.js <youtube-url-or-file> --duration 15 --count 5
 */

require("dotenv").config();
const path = require("path");
const fs = require("fs");
const { execSync } = require("child_process");
const { v4: uuidv4 } = require("uuid");

// Import v2 modules
const { ingest } = require("./src/v2/ingest");
const { transcribe } = require("./src/v2/transcribe");
const { split } = require("./src/v2/split");
const { getAudioDuration } = require("./src/audio");

const SAMPLES_DIR = path.join(__dirname, "samples");
if (!fs.existsSync(SAMPLES_DIR)) {
  fs.mkdirSync(SAMPLES_DIR, { recursive: true });
}

/**
 * Download and extract audio from YouTube URL using ingest module
 */
async function downloadAudio(url, tempDir) {
  console.log(`\n📥 Downloading video...`);
  
  try {
    // Use the same ingest module as the pipeline (handles YouTube properly!)
    const result = await ingest(url, tempDir);
    
    console.log(`   ✅ Downloaded: ${path.basename(result.audioPath)}`);
    if (result.metadata?.duration) {
      console.log(`   📊 Duration: ${result.metadata.duration.toFixed(1)}s`);
    }
    
    return result.audioPath;
  } catch (error) {
    console.error(`   ❌ Download failed: ${error.message}`);
    throw error;
  }
}

/**
 * Analyze audio quality of a segment
 * Returns a quality score (0-100)
 */
function analyzeSegmentQuality(audioPath, start, duration) {
  try {
    // Extract segment for analysis
    const tempPath = path.join(SAMPLES_DIR, `temp_${Date.now()}.wav`);
    execSync(
      `ffmpeg -y -ss ${start} -t ${duration} -i "${audioPath}" -ar 44100 -ac 1 "${tempPath}" 2>/dev/null`,
      { stdio: "pipe" }
    );
    
    // Analyze with ffmpeg volumedetect and astats
    const volumeOutput = execSync(
      `ffmpeg -i "${tempPath}" -af "volumedetect" -f null - 2>&1 | grep "mean_volume"`,
      { encoding: "utf-8", stdio: "pipe" }
    ).trim();
    
    const statsOutput = execSync(
      `ffmpeg -i "${tempPath}" -af "astats" -f null - 2>&1 | grep -E "(RMS level|Peak level)"`,
      { encoding: "utf-8", stdio: "pipe" }
    ).trim();
    
    // Clean up temp file
    if (fs.existsSync(tempPath)) {
      fs.unlinkSync(tempPath);
    }
    
    // Parse volume (closer to 0 dB = louder)
    const meanVolumeMatch = volumeOutput.match(/mean_volume:\s*([-\d.]+)\s*dB/);
    const meanVolume = meanVolumeMatch ? parseFloat(meanVolumeMatch[1]) : -50;
    
    // Score based on volume (louder = better, but not clipping)
    // Good range: -20 to -10 dB
    let volumeScore = 0;
    if (meanVolume > -10) {
      volumeScore = 50; // Too loud, might be clipping
    } else if (meanVolume > -20) {
      volumeScore = 100; // Perfect
    } else if (meanVolume > -30) {
      volumeScore = 70; // Good
    } else if (meanVolume > -40) {
      volumeScore = 40; // Quiet
    } else {
      volumeScore = 20; // Very quiet
    }
    
    return {
      score: volumeScore,
      meanVolume,
      details: { volumeOutput, statsOutput },
    };
  } catch (error) {
    console.error(`      ⚠️ Quality analysis failed: ${error.message}`);
    return { score: 50, meanVolume: -30, details: {} };
  }
}

/**
 * Detect if a time range overlaps with any other speaker's segments
 */
function hasOverlappingSpeakers(start, end, speaker, allSegments) {
  for (const seg of allSegments) {
    // Skip segments from the same speaker
    if (seg.speaker === speaker) continue;
    
    // Check for overlap
    const overlapStart = Math.max(start, seg.start);
    const overlapEnd = Math.min(end, seg.end);
    const overlap = overlapEnd - overlapStart;
    
    // If there's more than 0.5s overlap, consider it contaminated
    if (overlap > 0.5) {
      return true;
    }
  }
  return false;
}

/**
 * Find the best voice samples from a transcribed video
 */
async function findBestSamples(audioPath, transcription, options = {}) {
  const {
    targetSpeaker = null,  // Specific speaker to extract, or null for all
    sampleDuration = 12,   // Target duration (10-15s is ideal for XTTS)
    minDuration = 8,       // Minimum acceptable duration
    maxDuration = 20,      // Maximum duration
    sampleCount = 5,       // How many samples to extract
  } = options;
  
  console.log(`\n🔍 Analyzing segments for voice samples...`);
  console.log(`   Target: ${sampleDuration}s clips (clean, single-speaker only)`);
  console.log(`   Extracting: ${sampleCount} best samples`);
  
  // All segments for overlap detection
  const allSegments = transcription.segments;
  
  // Group segments by speaker
  const speakerSegments = {};
  for (const seg of allSegments) {
    const speaker = seg.speaker || "UNKNOWN";
    if (!speakerSegments[speaker]) {
      speakerSegments[speaker] = [];
    }
    speakerSegments[speaker].push(seg);
  }
  
  console.log(`   👥 Found ${Object.keys(speakerSegments).length} speaker(s):`);
  for (const [speaker, segs] of Object.entries(speakerSegments)) {
    const totalTime = segs.reduce((sum, s) => sum + (s.end - s.start), 0);
    console.log(`      ${speaker}: ${segs.length} segments, ${totalTime.toFixed(1)}s total`);
  }
  
  // Decide which speaker(s) to process
  const speakersToProcess = targetSpeaker 
    ? [targetSpeaker] 
    : Object.keys(speakerSegments);
  
  // Find candidate segments for each speaker
  const allCandidates = [];
  
  for (const speaker of speakersToProcess) {
    const segments = speakerSegments[speaker];
    if (!segments) {
      console.log(`   ⚠️ Speaker ${speaker} not found`);
      continue;
    }
    
    console.log(`\n   🎯 Analyzing ${speaker}...`);
    
    // STEP 1: Filter out segments that overlap with other speakers
    const cleanSegments = segments.filter(seg => {
      return !hasOverlappingSpeakers(seg.start, seg.end, speaker, allSegments);
    });
    
    const filteredCount = segments.length - cleanSegments.length;
    if (filteredCount > 0) {
      console.log(`      🧹 Filtered ${filteredCount} segments with overlapping speakers`);
    }
    console.log(`      ✅ ${cleanSegments.length} clean segments remaining`);
    
    // STEP 2: Find continuous speech blocks (merge close segments)
    // Only merge if there's no other speaker in the gap!
    const blocks = [];
    let currentBlock = null;
    
    for (const seg of cleanSegments) {
      const segDuration = seg.end - seg.start;
      
      if (!currentBlock) {
        currentBlock = { ...seg, segments: [seg] };
      } else {
        const gap = seg.start - currentBlock.end;
        const potentialBlockEnd = seg.end;
        const potentialBlockStart = currentBlock.start;
        
        // Check if we can merge: gap < 1s, combined duration OK, and NO other speakers in the gap or block
        const canMerge = 
          gap < 1.0 && 
          (potentialBlockEnd - potentialBlockStart) < maxDuration &&
          !hasOverlappingSpeakers(currentBlock.end, seg.start, speaker, allSegments) &&
          !hasOverlappingSpeakers(potentialBlockStart, potentialBlockEnd, speaker, allSegments);
        
        if (canMerge) {
          currentBlock.end = seg.end;
          currentBlock.text += " " + seg.text;
          currentBlock.segments.push(seg);
        } else {
          // Save current block and start new one
          blocks.push(currentBlock);
          currentBlock = { ...seg, segments: [seg] };
        }
      }
    }
    if (currentBlock) blocks.push(currentBlock);
    
    console.log(`      📦 Created ${blocks.length} continuous speech blocks`);
    
    // STEP 3: Score each block (prioritize longer continuous speech)
    for (const block of blocks) {
      const duration = block.end - block.start;
      const wordCount = block.text.split(/\s+/).length;
      const wordsPerSecond = wordCount / duration;
      
      // Skip blocks that are too short or too long
      if (duration < minDuration || duration > maxDuration) {
        continue;
      }
      
      // Analyze audio quality
      const quality = analyzeSegmentQuality(audioPath, block.start, Math.min(duration, sampleDuration));
      
      // Calculate overall score (weighted for voice cloning quality)
      let score = quality.score * 0.5; // 50% weight on audio quality
      
      // HEAVILY prefer longer durations (more data = better clone)
      // Longer blocks get exponentially higher scores
      const durationBonus = Math.min(50, (duration / sampleDuration) * 30);
      score += durationBonus;
      
      // Bonus for being close to ideal target (12-15s)
      if (duration >= 12 && duration <= 15) {
        score += 30;
      } else if (duration >= 10 && duration <= 18) {
        score += 20;
      }
      
      // Prefer moderate speaking rate (not too fast or slow)
      // Good: 2-4 words/sec
      if (wordsPerSecond >= 2 && wordsPerSecond <= 4) {
        score += 15;
      } else if (wordsPerSecond >= 1.5 && wordsPerSecond <= 5) {
        score += 8;
      }
      
      // Bonus for multiple merged segments (shows continuous speech)
      const segmentCount = block.segments ? block.segments.length : 1;
      if (segmentCount >= 3) {
        score += 10; // Very continuous speech
      } else if (segmentCount >= 2) {
        score += 5;
      }
      
      allCandidates.push({
        speaker,
        start: block.start,
        end: block.end,
        duration,
        text: block.text.substring(0, 100) + (block.text.length > 100 ? "..." : ""),
        wordCount,
        wordsPerSecond: wordsPerSecond.toFixed(1),
        quality: quality.meanVolume.toFixed(1),
        score: Math.round(score),
      });
    }
  }
  
  // Sort by score and take top N
  allCandidates.sort((a, b) => b.score - a.score);
  const bestSamples = allCandidates.slice(0, sampleCount);
  
  console.log(`\n   ✨ Found ${bestSamples.length} high-quality samples:\n`);
  bestSamples.forEach((sample, i) => {
    console.log(`   ${i + 1}. [${sample.start.toFixed(1)}s - ${sample.end.toFixed(1)}s] Score: ${sample.score}/100`);
    console.log(`      Speaker: ${sample.speaker} | Duration: ${sample.duration.toFixed(1)}s`);
    console.log(`      Quality: ${sample.quality} dB | Rate: ${sample.wordsPerSecond} words/sec`);
    console.log(`      Text: "${sample.text}"`);
    console.log();
  });
  
  return bestSamples;
}

/**
 * Extract audio samples to files
 */
async function extractSamples(audioPath, samples, baseName) {
  console.log(`\n📦 Extracting samples to files...\n`);
  
  const extractedFiles = [];
  
  for (let i = 0; i < samples.length; i++) {
    const sample = samples[i];
    const filename = `${baseName}_sample${i + 1}_${sample.speaker}_${sample.score}pts.wav`;
    const outputPath = path.join(SAMPLES_DIR, filename);
    
    try {
      execSync(
        `ffmpeg -y -ss ${sample.start} -t ${sample.duration} -i "${audioPath}" -ar 44100 -ac 2 -b:a 192k "${outputPath}" 2>/dev/null`,
        { stdio: "pipe" }
      );
      
      console.log(`   ✅ ${filename}`);
      console.log(`      ${sample.duration.toFixed(1)}s | Score: ${sample.score}/100 | "${sample.text}"`);
      
      extractedFiles.push({
        path: outputPath,
        filename,
        ...sample,
      });
    } catch (error) {
      console.error(`   ❌ Failed to extract sample ${i + 1}: ${error.message}`);
    }
  }
  
  return extractedFiles;
}

/**
 * Main extraction workflow
 */
async function main() {
  const args = process.argv.slice(2);
  
  if (args.length === 0) {
    console.log(`
╔══════════════════════════════════════════════════════════════╗
║                                                              ║
║   🎙️  V O I C E   S A M P L E   E X T R A C T O R           ║
║                                                              ║
║   Extract high-quality voice samples for XTTS cloning       ║
║                                                              ║
╚══════════════════════════════════════════════════════════════╝

Usage:
  node extract-voice-samples.js <youtube-url-or-file> [options]

Options:
  --speaker SPEAKER_00    Extract only this speaker
  --duration 15          Target sample duration (default: 12s)
  --count 5              Number of samples to extract (default: 5)

Examples:
  node extract-voice-samples.js "https://youtube.com/watch?v=..."
  node extract-voice-samples.js video.mp4 --speaker SPEAKER_00
  node extract-voice-samples.js "https://youtube.com/watch?v=..." --duration 15 --count 3
`);
    process.exit(0);
  }
  
  const input = args[0];
  const speaker = args.includes("--speaker") ? args[args.indexOf("--speaker") + 1] : null;
  const duration = args.includes("--duration") ? parseInt(args[args.indexOf("--duration") + 1]) : 12;
  const count = args.includes("--count") ? parseInt(args[args.indexOf("--count") + 1]) : 5;
  
  console.log(`\n📋 Configuration:`);
  console.log(`   Input: ${input}`);
  if (speaker) console.log(`   Target speaker: ${speaker}`);
  console.log(`   Sample duration: ${duration}s`);
  console.log(`   Sample count: ${count}`);
  
  const jobId = uuidv4().substring(0, 8);
  const tempDir = path.join(__dirname, "temp", `samples_${jobId}`);
  fs.mkdirSync(tempDir, { recursive: true });
  
  try {
    // Step 1: Get audio
    let audioPath;
    if (input.startsWith("http")) {
      // Use ingest module (same as pipeline)
      audioPath = await downloadAudio(input, tempDir);
    } else {
      audioPath = input;
      if (!fs.existsSync(audioPath)) {
        throw new Error(`File not found: ${audioPath}`);
      }
    }
    
    // Step 2: Transcribe with diarization
    console.log(`\n🎤 Transcribing audio...`);
    const transcription = await transcribe(audioPath, {
      language: "english",
      diarize: true,
    });
    
    console.log(`   ✅ Found ${transcription.segments.length} segments`);
    
    // Step 3: Find best samples
    const bestSamples = await findBestSamples(audioPath, transcription, {
      targetSpeaker: speaker,
      sampleDuration: duration,
      sampleCount: count,
    });
    
    if (bestSamples.length === 0) {
      console.log(`\n   ❌ No suitable samples found. Try:`);
      console.log(`      - Different speaker (--speaker SPEAKER_XX)`);
      console.log(`      - Shorter duration (--duration 8)`);
      console.log(`      - More samples (--count 10)`);
      process.exit(1);
    }
    
    // Step 4: Extract to files
    const baseName = input.startsWith("http") ? `yt_${jobId}` : path.basename(input, path.extname(input));
    const extractedFiles = await extractSamples(audioPath, bestSamples, baseName);
    
    // Step 5: Summary
    console.log(`\n╔══════════════════════════════════════════════════════════════╗`);
    console.log(`║                                                              ║`);
    console.log(`║   ✅  E X T R A C T I O N   C O M P L E T E !                ║`);
    console.log(`║                                                              ║`);
    console.log(`╚══════════════════════════════════════════════════════════════╝\n`);
    
    console.log(`📁 Samples saved to: ${SAMPLES_DIR}\n`);
    console.log(`🎯 Best sample (highest score):`);
    const best = extractedFiles[0];
    console.log(`   ${best.filename}`);
    console.log(`   Score: ${best.score}/100 | Duration: ${best.duration.toFixed(1)}s`);
    console.log(`   "${best.text}"\n`);
    
    console.log(`🎬 Use in pipeline:`);
    console.log(`   node pipeline-v2.js "VIDEO_URL" B2 auto narrator spanish --clone \\`);
    console.log(`     --voice-sample "samples/${best.filename}"\n`);
    
    console.log(`🎧 Preview samples:`);
    extractedFiles.forEach((file, i) => {
      console.log(`   ${i + 1}. mpv "samples/${file.filename}"`);
    });
    
    // Save metadata
    const metadataPath = path.join(SAMPLES_DIR, `${baseName}_metadata.json`);
    fs.writeFileSync(metadataPath, JSON.stringify({
      input,
      extractedAt: new Date().toISOString(),
      samples: extractedFiles.map(f => ({
        filename: f.filename,
        speaker: f.speaker,
        start: f.start,
        end: f.end,
        duration: f.duration,
        score: f.score,
        text: f.text,
      })),
    }, null, 2));
    
    console.log(`\n💾 Metadata saved: ${path.basename(metadataPath)}`);
    
  } catch (error) {
    console.error(`\n❌ Error: ${error.message}`);
    console.error(error.stack);
    process.exit(1);
  } finally {
    // Cleanup temp dir
    if (fs.existsSync(tempDir)) {
      execSync(`rm -rf "${tempDir}"`);
    }
  }
}

main();
