/**
 * Voice Sample Quality Checker
 * 
 * Analyzes audio samples and rates their quality for voice cloning.
 * Helps you pick the best sample from multiple options.
 * 
 * Usage:
 *   node check-voice-quality.js sample1.wav sample2.wav sample3.wav
 */

const { execSync } = require('child_process');
const path = require('path');
const fs = require('fs');

/**
 * Analyze audio quality for voice cloning
 */
function analyzeVoiceSample(audioPath) {
  console.log(`\n🔍 Analyzing: ${path.basename(audioPath)}`);
  
  const analysis = {
    path: audioPath,
    duration: 0,
    loudness: 0,
    silenceRatio: 0,
    noiseLevel: 0,
    dynamicRange: 0,
    qualityScore: 0,
    issues: [],
    recommendations: [],
  };
  
  try {
    // Get duration
    const durationCmd = `ffprobe -v quiet -show_entries format=duration -of csv=p=0 "${audioPath}"`;
    analysis.duration = parseFloat(execSync(durationCmd).toString().trim());
    
    // Check duration
    if (analysis.duration < 6) {
      analysis.issues.push(`❌ Too short (${analysis.duration.toFixed(1)}s < 6s minimum)`);
      analysis.recommendations.push("Extract a longer sample (10-15s recommended)");
    } else if (analysis.duration > 30) {
      analysis.issues.push(`⚠️ Too long (${analysis.duration.toFixed(1)}s > 30s recommended)`);
      analysis.recommendations.push("Trim to 10-20 seconds for best results");
    } else if (analysis.duration >= 10 && analysis.duration <= 20) {
      analysis.issues.push(`✅ Good duration (${analysis.duration.toFixed(1)}s)`);
    }
    
    // Analyze loudness (LUFS)
    const loudnessCmd = `ffmpeg -i "${audioPath}" -af "loudnorm=print_format=json" -f null - 2>&1 | grep -A 12 "input"`;
    const loudnessOutput = execSync(loudnessCmd).toString();
    
    const lufsMatch = loudnessOutput.match(/"input_i" : "(-?[\d.]+)"/);
    const tpMatch = loudnessOutput.match(/"input_tp" : "(-?[\d.]+)"/);
    const lraMatch = loudnessOutput.match(/"input_lra" : "(-?[\d.]+)"/);
    
    if (lufsMatch) {
      analysis.loudness = parseFloat(lufsMatch[1]);
      
      if (analysis.loudness < -30) {
        analysis.issues.push(`❌ Too quiet (${analysis.loudness.toFixed(1)} LUFS)`);
        analysis.recommendations.push("Normalize volume to -16 LUFS");
      } else if (analysis.loudness > -10) {
        analysis.issues.push(`❌ Too loud (${analysis.loudness.toFixed(1)} LUFS, may have clipping)`);
        analysis.recommendations.push("Reduce volume and check for distortion");
      } else if (analysis.loudness >= -20 && analysis.loudness <= -14) {
        analysis.issues.push(`✅ Good loudness (${analysis.loudness.toFixed(1)} LUFS)`);
      }
    }
    
    if (lraMatch) {
      analysis.dynamicRange = parseFloat(lraMatch[1]);
      
      if (analysis.dynamicRange < 3) {
        analysis.issues.push(`⚠️ Low dynamic range (${analysis.dynamicRange.toFixed(1)} LRA) - may be over-compressed`);
      } else if (analysis.dynamicRange > 20) {
        analysis.issues.push(`⚠️ High dynamic range (${analysis.dynamicRange.toFixed(1)} LRA) - inconsistent volume`);
        analysis.recommendations.push("Apply gentle compression");
      } else {
        analysis.issues.push(`✅ Good dynamic range (${analysis.dynamicRange.toFixed(1)} LRA)`);
      }
    }
    
    // Detect silence
    const silenceCmd = `ffmpeg -i "${audioPath}" -af silencedetect=n=-40dB:d=0.5 -f null - 2>&1 | grep "silence_" | wc -l`;
    const silenceCount = parseInt(execSync(silenceCmd).toString().trim());
    analysis.silenceRatio = silenceCount / analysis.duration;
    
    if (silenceCount > analysis.duration * 2) {
      analysis.issues.push(`⚠️ Many silence gaps detected (${silenceCount} pauses)`);
      analysis.recommendations.push("Trim silence at start/end, or choose a more continuous speech segment");
    } else if (silenceCount === 0) {
      analysis.issues.push(`⚠️ No natural pauses detected - may be too heavily edited`);
    } else {
      analysis.issues.push(`✅ Natural speech rhythm`);
    }
    
    // Check sample rate
    const srCmd = `ffprobe -v quiet -show_entries stream=sample_rate -of csv=p=0 "${audioPath}"`;
    const sampleRate = parseInt(execSync(srCmd).toString().trim());
    
    if (sampleRate < 22050) {
      analysis.issues.push(`❌ Low sample rate (${sampleRate}Hz < 22050Hz)`);
      analysis.recommendations.push("Use higher quality source audio");
    } else if (sampleRate >= 22050 && sampleRate <= 48000) {
      analysis.issues.push(`✅ Good sample rate (${sampleRate}Hz)`);
    }
    
    // Check channels
    const channelsCmd = `ffprobe -v quiet -show_entries stream=channels -of csv=p=0 "${audioPath}"`;
    const channels = parseInt(execSync(channelsCmd).toString().trim());
    
    if (channels > 1) {
      analysis.issues.push(`⚠️ Stereo audio detected`);
      analysis.recommendations.push("Convert to mono for voice cloning");
    } else {
      analysis.issues.push(`✅ Mono audio`);
    }
    
    // Calculate quality score (0-100)
    let score = 100;
    
    // Duration penalties
    if (analysis.duration < 6) score -= 50;
    else if (analysis.duration < 10 || analysis.duration > 25) score -= 10;
    
    // Loudness penalties
    if (analysis.loudness < -30 || analysis.loudness > -10) score -= 30;
    else if (analysis.loudness < -25 || analysis.loudness > -12) score -= 10;
    
    // Dynamic range penalties
    if (analysis.dynamicRange < 3 || analysis.dynamicRange > 20) score -= 15;
    
    // Sample rate penalties
    if (sampleRate < 22050) score -= 20;
    
    // Silence penalties
    if (silenceCount > analysis.duration * 2) score -= 10;
    if (silenceCount === 0) score -= 5;
    
    analysis.qualityScore = Math.max(0, Math.min(100, score));
    
    // Overall rating
    let rating = '';
    let color = '';
    if (analysis.qualityScore >= 80) {
      rating = '🌟 EXCELLENT';
      color = '\x1b[32m'; // Green
    } else if (analysis.qualityScore >= 60) {
      rating = '✅ GOOD';
      color = '\x1b[36m'; // Cyan
    } else if (analysis.qualityScore >= 40) {
      rating = '⚠️ FAIR';
      color = '\x1b[33m'; // Yellow
    } else {
      rating = '❌ POOR';
      color = '\x1b[31m'; // Red
    }
    
    console.log(`\n${color}${rating} - Quality Score: ${analysis.qualityScore}/100\x1b[0m`);
    console.log(`\n📊 Analysis:`);
    analysis.issues.forEach(issue => console.log(`   ${issue}`));
    
    if (analysis.recommendations.length > 0) {
      console.log(`\n💡 Recommendations:`);
      analysis.recommendations.forEach(rec => console.log(`   • ${rec}`));
    }
    
  } catch (error) {
    console.error(`\n❌ Error analyzing ${path.basename(audioPath)}: ${error.message}`);
    analysis.qualityScore = 0;
  }
  
  return analysis;
}

/**
 * Compare multiple samples and recommend the best one
 */
function compareSamples(samplePaths) {
  console.log(`\n${"═".repeat(60)}`);
  console.log(`🎤 VOICE SAMPLE QUALITY CHECKER`);
  console.log(`${"═".repeat(60)}`);
  console.log(`   Analyzing ${samplePaths.length} samples...`);
  
  const analyses = samplePaths.map(analyzeVoiceSample);
  
  // Sort by quality score
  analyses.sort((a, b) => b.qualityScore - a.qualityScore);
  
  console.log(`\n${"═".repeat(60)}`);
  console.log(`📊 RANKING (Best to Worst):`);
  console.log(`${"═".repeat(60)}\n`);
  
  analyses.forEach((analysis, index) => {
    const medal = index === 0 ? '🥇' : index === 1 ? '🥈' : index === 2 ? '🥉' : `${index + 1}.`;
    console.log(`${medal} ${path.basename(analysis.path)}`);
    console.log(`   Score: ${analysis.qualityScore}/100`);
    console.log(`   Duration: ${analysis.duration.toFixed(1)}s`);
    console.log(`   Loudness: ${analysis.loudness.toFixed(1)} LUFS`);
    console.log(``);
  });
  
  const best = analyses[0];
  console.log(`${"═".repeat(60)}`);
  console.log(`✨ RECOMMENDED: ${path.basename(best.path)}`);
  console.log(`${"═".repeat(60)}`);
  
  if (best.qualityScore < 60) {
    console.log(`\n⚠️ Warning: Even the best sample has quality issues.`);
    console.log(`   Consider recording a new sample or using a different source.`);
  }
  
  return best;
}

// CLI
if (require.main === module) {
  const args = process.argv.slice(2);
  
  if (args.length === 0 || args.includes('--help')) {
    console.log(`
🎤 Voice Sample Quality Checker

Analyzes audio samples for voice cloning and recommends the best one.

Usage:
  node check-voice-quality.js <sample1> [sample2] [sample3] ...

Examples:
  node check-voice-quality.js narrator_sample.wav
  node check-voice-quality.js sample1.wav sample2.mp3 sample3.wav

What it checks:
  ✓ Duration (6-30 seconds recommended)
  ✓ Loudness (target: -16 LUFS)
  ✓ Dynamic range (natural but consistent)
  ✓ Silence detection (natural pauses)
  ✓ Sample rate (22050Hz minimum)
  ✓ Mono vs stereo
    `);
    process.exit(0);
  }
  
  // Check if files exist
  const validFiles = args.filter(f => {
    if (!fs.existsSync(f)) {
      console.error(`❌ File not found: ${f}`);
      return false;
    }
    return true;
  });
  
  if (validFiles.length === 0) {
    console.error(`❌ No valid audio files provided`);
    process.exit(1);
  }
  
  if (validFiles.length === 1) {
    analyzeVoiceSample(validFiles[0]);
  } else {
    compareSamples(validFiles);
  }
}

module.exports = {
  analyzeVoiceSample,
  compareSamples,
};
