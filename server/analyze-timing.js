#!/usr/bin/env node
/**
 * Analyze timing between original transcription and narrator blocks
 * Shows exactly where gaps/overlaps are happening
 */

const fs = require('fs');
const path = require('path');

const jobId = process.argv[2] || 'immersion_da4ebe24';
const jobDir = path.join(__dirname, 'output', jobId);

console.log(`\n📊 TIMING ANALYSIS: ${jobId}\n`);
console.log(`${"=".repeat(80)}\n`);

// Read transcription (original timing)
const transcriptionPath = path.join(jobDir, 'transcription.json');
if (!fs.existsSync(transcriptionPath)) {
  console.error(`❌ Transcription not found: ${transcriptionPath}`);
  process.exit(1);
}

const transcription = JSON.parse(fs.readFileSync(transcriptionPath, 'utf8'));
const segments = transcription.segments || transcription;

// Read narrator translation
const translationPath = path.join(jobDir, 'translation.json');
if (!fs.existsSync(translationPath)) {
  console.error(`❌ Translation not found: ${translationPath}`);
  process.exit(1);
}

let translation = JSON.parse(fs.readFileSync(translationPath, 'utf8'));

// Handle different translation formats
if (!Array.isArray(translation)) {
  // Might be wrapped in an object
  if (translation.segments) translation = translation.segments;
  else if (translation.results) translation = translation.results;
  else {
    console.error(`❌ Translation is not an array and has no segments/results property`);
    console.log(`   Found keys: ${Object.keys(translation).join(', ')}`);
    process.exit(1);
  }
}

// Analyze original speech timing
console.log(`📝 ORIGINAL TRANSCRIPTION:`);
console.log(`   Total segments: ${segments.length}`);
const totalSpeechTime = segments.reduce((sum, s) => sum + (s.end - s.start), 0);
const firstStart = Math.min(...segments.map(s => s.start));
const lastEnd = Math.max(...segments.map(s => s.end));
const videoDuration = lastEnd;
console.log(`   Total speech time: ${totalSpeechTime.toFixed(1)}s`);
console.log(`   Video duration: ${videoDuration.toFixed(1)}s`);
console.log(`   Fill rate: ${((totalSpeechTime / videoDuration) * 100).toFixed(1)}%`);

// Find gaps in original
const gaps = [];
for (let i = 0; i < segments.length - 1; i++) {
  const gap = segments[i + 1].start - segments[i].end;
  if (gap > 1.0) {
    gaps.push({
      start: segments[i].end,
      end: segments[i + 1].start,
      duration: gap
    });
  }
}
console.log(`   Gaps (>1s): ${gaps.length} totaling ${gaps.reduce((sum, g) => sum + g.duration, 0).toFixed(1)}s`);

// Analyze narrator blocks
console.log(`\n🎙️ NARRATOR TRANSLATION:`);
console.log(`   Total blocks: ${translation.length}`);

// Read TTS timing results
const ttsTimingPath = path.join(jobDir, 'tts_continuous_timing.json');
let ttsBlocks = [];

if (fs.existsSync(ttsTimingPath)) {
  const ttsTiming = JSON.parse(fs.readFileSync(ttsTimingPath, 'utf8'));
  ttsBlocks = ttsTiming.results || [];
  
  console.log(`   Total narration time: ${ttsTiming.totalNarrationTime?.toFixed(1)}s`);
  console.log(`   Timeline end: ${ttsTiming.timelineEnd?.toFixed(1)}s`);
  console.log(`   Fill rate: ${(ttsTiming.fillRate * 100).toFixed(1)}%`);
} else {
  console.log(`   ⚠️ No timing file found at: ${ttsTimingPath}`);
  console.log(`   💡 Run the pipeline again to generate timing data`);
}

console.log(`   TTS blocks found: ${ttsBlocks.length}`);

console.log(`\n${"=".repeat(80)}`);
console.log(`⏱️  TIMING COMPARISON (Block-by-Block):`);
console.log(`${"=".repeat(80)}\n`);

for (let i = 0; i < translation.length; i++) {
  const block = translation[i];
  const ttsBlock = ttsBlocks.find(t => t.index === i);
  
  const blockStart = block.start;
  const blockEnd = block.end;
  const blockDuration = blockEnd - blockStart;
  
  // Calculate how much original speech was in this block's timeframe
  let originalSpeechInBlock = 0;
  segments.forEach(seg => {
    const overlapStart = Math.max(blockStart, seg.start);
    const overlapEnd = Math.min(blockEnd, seg.end);
    const overlap = Math.max(0, overlapEnd - overlapStart);
    originalSpeechInBlock += overlap;
  });
  
  const ttsGenerated = ttsBlock ? ttsBlock.audioDuration : 0;
  const fillRate = ttsGenerated > 0 ? (ttsGenerated / blockDuration) * 100 : 0;
  const gap = blockDuration - ttsGenerated;
  const speechMatchRate = originalSpeechInBlock > 0 ? (ttsGenerated / originalSpeechInBlock) * 100 : 0;
  
  console.log(`Block ${i + 1}:`);
  console.log(`  Time slot: ${blockStart.toFixed(1)}s - ${blockEnd.toFixed(1)}s (${blockDuration.toFixed(1)}s)`);
  console.log(`  Original speech in slot: ${originalSpeechInBlock.toFixed(1)}s (${((originalSpeechInBlock / blockDuration) * 100).toFixed(0)}% of slot)`);
  
  const chars = block.translatedText ? block.translatedText.length : (block.chars || 0);
  const maxChars = block.maxChars || (blockDuration * 12); // Estimate if missing
  console.log(`  Characters: ${chars} / ${maxChars.toFixed(0)} max (${((chars / maxChars) * 100).toFixed(0)}%)`);
  
  if (ttsBlock) {
    console.log(`  TTS generated: ${ttsGenerated.toFixed(1)}s`);
    console.log(`  Fill rate: ${fillRate.toFixed(0)}% of slot`);
    console.log(`  vs Original: ${speechMatchRate.toFixed(0)}% of original speech time`);
    
    if (gap > 0.5) {
      console.log(`  ⚠️ GAP: ${gap.toFixed(1)}s of silence`);
    } else if (gap < -0.5) {
      console.log(`  ⚠️ OVERLAP: ${Math.abs(gap).toFixed(1)}s overrun`);
    } else {
      console.log(`  ✅ PERFECT FIT`);
    }
    
    // Comparison to original
    const diff = ttsGenerated - originalSpeechInBlock;
    if (Math.abs(diff) > 2) {
      if (diff > 0) {
        console.log(`  📊 ${diff.toFixed(1)}s MORE narration than original had speech`);
      } else {
        console.log(`  📊 ${Math.abs(diff).toFixed(1)}s LESS narration than original had speech`);
      }
    }
  } else {
    console.log(`  ❌ TTS file not found`);
  }
  
  console.log();
}

// Overall stats
if (ttsBlocks.length > 0) {
  const totalTTS = ttsBlocks.reduce((sum, t) => sum + t.audioDuration, 0);
  const totalSlots = translation.reduce((sum, t) => sum + (t.end - t.start), 0);
  const overallGap = totalSlots - totalTTS;
  
  console.log(`${"=".repeat(80)}`);
  console.log(`📊 OVERALL STATS:`);
  console.log(`${"=".repeat(80)}\n`);
  
  console.log(`  📹 VIDEO TIMELINE:`);
  console.log(`     Total video duration: ${videoDuration.toFixed(1)}s`);
  console.log(`     Original speech: ${totalSpeechTime.toFixed(1)}s (${((totalSpeechTime / videoDuration) * 100).toFixed(1)}%)`);
  console.log(`     Original silence: ${(videoDuration - totalSpeechTime).toFixed(1)}s (${((1 - totalSpeechTime / videoDuration) * 100).toFixed(1)}%)`);
  
  console.log(`\n  🎙️ NARRATOR OUTPUT:`);
  console.log(`     Total time slots: ${totalSlots.toFixed(1)}s`);
  console.log(`     Total narrator generated: ${totalTTS.toFixed(1)}s`);
  console.log(`     Slot fill: ${((totalTTS / totalSlots) * 100).toFixed(1)}%`);
  
  console.log(`\n  📊 COMPARISON:`);
  const narratorVsOriginal = (totalTTS / totalSpeechTime) * 100;
  console.log(`     Narrator vs Original speech: ${narratorVsOriginal.toFixed(1)}%`);
  
  const diff = totalTTS - totalSpeechTime;
  if (diff > 0) {
    console.log(`     🔺 ${diff.toFixed(1)}s MORE narration than original`);
  } else {
    console.log(`     🔻 ${Math.abs(diff).toFixed(1)}s LESS narration than original`);
  }
  
  if (overallGap > 0) {
    console.log(`\n  ⚠️ ${overallGap.toFixed(1)}s of unfilled time in slots`);
  }
  
  if (narratorVsOriginal < 85) {
    console.log(`\n  💡 LOW OUTPUT: Narrator has ${(100 - narratorVsOriginal).toFixed(0)}% less speech than original`);
    console.log(`     → Increase character targets in translate.js`);
  } else if (narratorVsOriginal > 110) {
    console.log(`\n  ⚠️ OVER-NARRATING: ${(narratorVsOriginal - 100).toFixed(0)}% more speech than original`);
    console.log(`     → Will cause overlaps. Reduce character targets.`);
  } else {
    console.log(`\n  ✅ GOOD BALANCE: Narrator time matches original speech time!`);
  }
  
  // Character rate analysis
  const totalChars = translation.reduce((sum, t) => {
    return sum + (t.translatedText ? t.translatedText.length : (t.chars || 0));
  }, 0);
  const charsPerSec = totalChars / totalTTS;
  console.log(`\n  Characters: ${totalChars}`);
  console.log(`  Actual TTS rate: ${charsPerSec.toFixed(2)} chars/sec`);
  console.log(`  Expected rate: 12.00 chars/sec`);
  const rateDiff = ((charsPerSec / 12) * 100).toFixed(0);
  console.log(`  ${charsPerSec < 11 ? '⚠️' : '✅'} XTTS is ${rateDiff}% of expected speed`);
  
  if (charsPerSec < 11) {
    console.log(`\n  🔧 RECOMMENDATION: Increase TTS_RATES.spanish.charsPerSecond to ${charsPerSec.toFixed(1)}`);
  }
  
  // Analyze alignment with original speech
  console.log(`\n${"=".repeat(80)}`);
  console.log(`🎯 ALIGNMENT ANALYSIS: Narrator vs Original Speech`);
  console.log(`${"=".repeat(80)}\n`);
  
  let totalAlignedTime = 0;
  let totalMisalignedTime = 0;
  const alignmentDetails = [];
  
  ttsBlocks.forEach((ttsBlock, idx) => {
    const narratorStart = ttsBlock.start || translation[idx].start;
    const narratorEnd = narratorStart + ttsBlock.audioDuration;
    
    // Find all original segments that overlap with this narrator block
    let overlapTime = 0;
    const overlappingOriginals = [];
    
    segments.forEach(origSeg => {
      const origStart = origSeg.start;
      const origEnd = origSeg.end;
      
      // Calculate overlap
      const overlapStart = Math.max(narratorStart, origStart);
      const overlapEnd = Math.min(narratorEnd, origEnd);
      const overlap = Math.max(0, overlapEnd - overlapStart);
      
      if (overlap > 0) {
        overlapTime += overlap;
        overlappingOriginals.push({
          text: origSeg.text?.substring(0, 50) || '',
          overlap: overlap
        });
      }
    });
    
    const narratorDuration = ttsBlock.audioDuration;
    const alignmentRate = (overlapTime / narratorDuration) * 100;
    const misaligned = narratorDuration - overlapTime;
    
    totalAlignedTime += overlapTime;
    totalMisalignedTime += misaligned;
    
    if (alignmentRate < 70) {
      alignmentDetails.push({
        block: idx + 1,
        rate: alignmentRate,
        aligned: overlapTime,
        misaligned: misaligned,
      });
    }
  });
  
  const overallAlignment = (totalAlignedTime / (totalAlignedTime + totalMisalignedTime)) * 100;
  
  console.log(`  Overall alignment: ${overallAlignment.toFixed(1)}%`);
  console.log(`    Aligned time: ${totalAlignedTime.toFixed(1)}s (narrator speaking when original was)`);
  console.log(`    Misaligned time: ${totalMisalignedTime.toFixed(1)}s (narrator speaking during original silence)`);
  
  if (alignmentDetails.length > 0) {
    console.log(`\n  ⚠️ Poorly aligned blocks (< 70%):`);
    alignmentDetails.forEach(detail => {
      console.log(`    Block ${detail.block}: ${detail.rate.toFixed(0)}% aligned (${detail.misaligned.toFixed(1)}s during silence)`);
    });
  }
  
  if (overallAlignment < 80) {
    console.log(`\n  💡 LOW ALIGNMENT: Consider using smaller block sizes (15-20s) for tighter sync`);
  } else if (overallAlignment >= 90) {
    console.log(`\n  ✅ EXCELLENT ALIGNMENT: Narrator timing matches original speech patterns!`);
  }
}

// AUDIO QUALITY ANALYSIS
console.log('\n================================================================================');
console.log('🎵 AUDIO QUALITY ANALYSIS');
console.log('================================================================================\n');

if (ttsBlocks && ttsBlocks.length > 0) {
  const qualityIssues = [];
  const speedIssues = [];
  const cutOffs = [];
  
  ttsBlocks.forEach((result, idx) => {
    const metrics = result.qualityMetrics;
    if (metrics) {
      if (metrics.tooShort) {
        qualityIssues.push(`Block ${idx + 1}: Too short (${result.audioDuration?.toFixed(1)}s)`);
      }
      if (metrics.tooFast) {
        speedIssues.push(`Block ${idx + 1}: Too fast (${metrics.charsPerSec?.toFixed(1)} c/s)`);
      }
      if (metrics.tooSlow) {
        speedIssues.push(`Block ${idx + 1}: Too slow (${metrics.charsPerSec?.toFixed(1)} c/s)`);
      }
    }
    
    // Check for potential cut-offs (sentences not ending properly)
    const text = result.translatedText || '';
    const endsCleanly = text.match(/[.!?]\s*$/);
    if (text.length > 50 && !endsCleanly) {
      cutOffs.push(`Block ${idx + 1}: Possibly cut off ("...${text.slice(-40)}")`);
    }
  });
  
  if (qualityIssues.length > 0) {
    console.log(`  ⚠️ Quality Issues (${qualityIssues.length}):`);
    qualityIssues.slice(0, 5).forEach(issue => console.log(`     ${issue}`));
    if (qualityIssues.length > 5) console.log(`     ... and ${qualityIssues.length - 5} more`);
  }
  
  if (speedIssues.length > 0) {
    console.log(`\n  ⚠️ Speed Issues (${speedIssues.length}):`);
    speedIssues.slice(0, 5).forEach(issue => console.log(`     ${issue}`));
    if (speedIssues.length > 5) console.log(`     ... and ${speedIssues.length - 5} more`);
    console.log('     → These may sound unnatural or "possessed"');
    console.log('     💡 Fix: Increase/decrease character targets in translate.js');
  }
  
  if (cutOffs.length > 0) {
    console.log(`\n  ⚠️ Potential Cut-offs (${cutOffs.length}):`);
    cutOffs.slice(0, 5).forEach(issue => console.log(`     ${issue}`));
    if (cutOffs.length > 5) console.log(`     ... and ${cutOffs.length - 5} more`);
    console.log('     → These segments may not complete their thought');
    console.log('     💡 Fix: Sentences should end with . ! or ?');
  }
  
  if (qualityIssues.length === 0 && speedIssues.length === 0 && cutOffs.length === 0) {
    console.log('  ✅ NO QUALITY ISSUES DETECTED: All audio appears clean!');
  }
} else {
  console.log('  ℹ️ No TTS quality data available');
}

// TRANSLATION COMPLETENESS
console.log('\n================================================================================');
console.log('📝 TRANSLATION COMPLETENESS');
console.log('================================================================================\n');

if (translation && translation.length > 0) {
  const truncated = translation.filter(t => t.wasTruncated || t.truncated);
  const retried = ttsBlocks ? ttsBlocks.filter(t => t.retryAttempt && t.retryAttempt > 1) : [];
  
  if (truncated.length > 0) {
    console.log(`  ⚠️ ${truncated.length} segments were truncated to fit time limits`);
    console.log('     → Some content may be cut short');
    console.log('     💡 Fix: Increase maxChars limits or improve Gemini prompt');
  }
  
  if (retried.length > 0) {
    console.log(`  🔄 ${retried.length} segments were retried to fix overruns`);
    console.log('     → Adaptive retry system is working!');
  }
  
  if (truncated.length === 0 && retried.length === 0) {
    console.log('  ✅ All translations fit within time limits!');
  }
  
  // Original text coverage
  const originalSegments = transcription?.segments?.length || 0;
  const translatedBlocks = translation.length;
  console.log(`\n  📊 Coverage:`);
  console.log(`     Original segments: ${originalSegments}`);
  console.log(`     Translation blocks: ${translatedBlocks}`);
  console.log(`     Ratio: ${(translatedBlocks / originalSegments).toFixed(2)}x (${translatedBlocks < originalSegments ? 'merged' : 'split'})`);
}

// TRANSLATION ACCURACY ANALYSIS
console.log('\n================================================================================');
console.log('🔍 TRANSLATION ACCURACY: Source vs Narrator');
console.log('================================================================================\n');

if (segments && segments.length > 0 && translation && translation.length > 0) {
  console.log('Comparing original English with translated narration...\n');
  
  translation.forEach((block, idx) => {
    const blockStart = block.start;
    const blockEnd = block.end;
    
    // Find all original segments that overlap with this block
    const overlappingSegments = segments.filter(seg => {
      return (seg.start < blockEnd && seg.end > blockStart);
    });
    
    // Combine original text from overlapping segments
    const originalText = overlappingSegments
      .map(seg => seg.text || '')
      .join(' ')
      .trim();
    
    const translatedText = block.translatedText || block.text || '';
    
    // Only show if we have both texts
    if (originalText && translatedText) {
      console.log(`Block ${idx + 1} (${blockStart.toFixed(1)}s - ${blockEnd.toFixed(1)}s):`);
      console.log(`  📖 ORIGINAL (EN):`);
      
      // Wrap text at 80 chars for readability
      const wrappedOriginal = wrapText(originalText, 76);
      wrappedOriginal.forEach(line => console.log(`     ${line}`));
      
      console.log(`  🎙️ NARRATOR (${translation[0].language || 'ES'}):`);
      const wrappedTranslated = wrapText(translatedText, 76);
      wrappedTranslated.forEach(line => console.log(`     ${line}`));
      
      console.log('');
    }
  });
  
  console.log('💡 Review above to check if narration accurately represents source content.');
} else {
  console.log('  ℹ️ Cannot compare - missing transcription or translation data');
}

// Helper function to wrap text at specified width
function wrapText(text, width) {
  const words = text.split(' ');
  const lines = [];
  let currentLine = '';
  
  words.forEach(word => {
    if ((currentLine + word).length > width) {
      if (currentLine) lines.push(currentLine.trim());
      currentLine = word + ' ';
    } else {
      currentLine += word + ' ';
    }
  });
  
  if (currentLine) lines.push(currentLine.trim());
  return lines;
}

console.log();
