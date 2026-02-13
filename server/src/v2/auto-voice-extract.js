/**
 * Automatic Voice Sample Extraction
 * 
 * Analyzes audio to automatically find the best voice samples for each speaker
 * - Detects all speakers
 * - Finds segments with clear, loud speech
 * - Avoids silence, music, and noise
 * - Returns top samples per speaker
 */

const { transcribe } = require('./transcribe');
const path = require('path');
const fs = require('fs');

/**
 * Automatically find best voice samples for each speaker
 */
async function autoExtractVoiceSamples(audioPath, outputDir, options = {}) {
  const {
    samplesPerSpeaker = 3,    // How many samples to extract per speaker
    minDuration = 8,           // Minimum sample duration (seconds)
    maxDuration = 20,          // Maximum sample duration (seconds)
    targetDuration = 15,       // Ideal sample duration (seconds)
  } = options;

  console.log(`\n🎤 Auto Voice Extraction`);
  console.log(`   Analyzing audio for speakers...`);

  // Step 1: Transcribe with speaker diarization
  const transcriptResult = await transcribe(audioPath, outputDir, {
    language: 'en',
    diarization: true,
  });

  const segments = transcriptResult.segments;
  if (!segments || segments.length === 0) {
    throw new Error('No speech detected in audio');
  }

  // Step 2: Group segments by speaker
  const speakerSegments = {};
  segments.forEach(seg => {
    const speaker = seg.speaker || 'SPEAKER_00';
    if (!speakerSegments[speaker]) {
      speakerSegments[speaker] = [];
    }
    speakerSegments[speaker].push(seg);
  });

  const speakers = Object.keys(speakerSegments);
  console.log(`   ✅ Found ${speakers.length} speaker(s): ${speakers.join(', ')}`);

  // Step 3: For each speaker, find best continuous segments
  const allSamples = [];

  for (const speaker of speakers) {
    const speakerSegs = speakerSegments[speaker];
    
    console.log(`\n   🔍 Analyzing ${speaker}...`);
    
    // Find continuous speech blocks (merge close segments)
    const blocks = findContinuousBlocks(speakerSegs, {
      maxGap: 1.0, // Max 1s gap between segments
      minDuration,
      maxDuration,
    });

    // Score each block
    const scoredBlocks = blocks.map(block => ({
      ...block,
      score: scoreVoiceBlock(block, targetDuration),
    }));

    // Sort by score and take top N
    scoredBlocks.sort((a, b) => b.score - a.score);
    const topBlocks = scoredBlocks.slice(0, samplesPerSpeaker);

    // Extract audio for each block
    for (let i = 0; i < topBlocks.length; i++) {
      const block = topBlocks[i];
      const samplePath = path.join(outputDir, `${speaker}_sample_${i + 1}.wav`);
      
      // Extract with ffmpeg
      const extractCmd = `ffmpeg -y -ss ${block.start} -i "${audioPath}" -t ${block.duration} \
        -ar 22050 -ac 1 \
        -af "loudnorm=I=-16:TP=-1.5:LRA=11,highpass=f=80,lowpass=f=8000" \
        "${samplePath}" 2>/dev/null`;
      
      try {
        require('child_process').execSync(extractCmd);
        
        // Verify quality
        const { analyzeVoiceSample } = require('../../check-voice-quality');
        const analysis = analyzeVoiceSample(samplePath);
        
        allSamples.push({
          speaker,
          rank: i + 1,
          start: block.start,
          end: block.end,
          duration: block.duration,
          text: block.text,
          score: block.score,
          qualityScore: analysis.qualityScore,
          path: samplePath,
          issues: analysis.issues,
        });

        console.log(`      Sample ${i + 1}: ${block.start.toFixed(1)}s (${block.duration.toFixed(1)}s) - Score: ${block.score.toFixed(1)}, Quality: ${analysis.qualityScore}/100`);
      } catch (err) {
        console.warn(`      ⚠️ Failed to extract sample ${i + 1}: ${err.message}`);
      }
    }
  }

  // Step 4: Return results grouped by speaker
  const results = {};
  speakers.forEach(speaker => {
    results[speaker] = allSamples
      .filter(s => s.speaker === speaker)
      .sort((a, b) => b.qualityScore - a.qualityScore);
  });

  console.log(`\n   ✅ Extracted ${allSamples.length} samples total`);

  return {
    speakers,
    samples: results,
    allSamples: allSamples.sort((a, b) => b.qualityScore - a.qualityScore),
    bestSample: allSamples.sort((a, b) => b.qualityScore - a.qualityScore)[0],
  };
}

/**
 * Find continuous speech blocks from segments
 */
function findContinuousBlocks(segments, options) {
  const { maxGap = 1.0, minDuration = 8, maxDuration = 20 } = options;
  
  const blocks = [];
  let currentBlock = null;

  for (const seg of segments) {
    if (!currentBlock) {
      // Start new block
      currentBlock = {
        start: seg.start,
        end: seg.end,
        duration: seg.end - seg.start,
        segments: [seg],
        text: seg.text,
      };
    } else {
      const gap = seg.start - currentBlock.end;
      const newDuration = seg.end - currentBlock.start;

      if (gap <= maxGap && newDuration <= maxDuration) {
        // Extend current block
        currentBlock.end = seg.end;
        currentBlock.duration = seg.end - currentBlock.start;
        currentBlock.segments.push(seg);
        currentBlock.text += ' ' + seg.text;
      } else {
        // Save current block if it meets criteria
        if (currentBlock.duration >= minDuration) {
          blocks.push(currentBlock);
        }
        
        // Start new block
        currentBlock = {
          start: seg.start,
          end: seg.end,
          duration: seg.end - seg.start,
          segments: [seg],
          text: seg.text,
        };
      }
    }
  }

  // Don't forget last block
  if (currentBlock && currentBlock.duration >= minDuration) {
    blocks.push(currentBlock);
  }

  return blocks;
}

/**
 * Score a voice block for quality
 * Higher score = better for voice cloning
 */
function scoreVoiceBlock(block, targetDuration) {
  let score = 50; // Base score

  // Duration score (prefer closer to target)
  const durationDiff = Math.abs(block.duration - targetDuration);
  score += Math.max(0, 20 - durationDiff * 2);

  // Word count (prefer more words = more expressive)
  const wordCount = block.text.split(/\s+/).length;
  score += Math.min(20, wordCount * 0.5);

  // Segment count (prefer fewer segments = less pauses)
  score += Math.max(0, 10 - block.segments.length);

  // Position bonus (prefer middle of audio, avoid intro/outro)
  if (block.start > 30 && block.start < 300) {
    score += 10;
  }

  // Text quality (avoid short phrases)
  if (block.text.length > 50) {
    score += 10;
  }

  return Math.min(100, score);
}

module.exports = {
  autoExtractVoiceSamples,
  findContinuousBlocks,
  scoreVoiceBlock,
};
