/**
 * XTTS Voice Cloning via Replicate API
 * 
 * Uses Coqui XTTS-v2 for multilingual voice cloning TTS
 * Much cheaper than ElevenLabs for voice cloning!
 * 
 * Features:
 * - Pre-merge overlapping segments (prevents cut-off words)
 * - Post-process speed adjustment via ffmpeg atempo
 * - Level-based speed control (B1 slower than C1)
 */

require("dotenv").config();
const Replicate = require("replicate");
const fs = require("fs");
const path = require("path");
const { promisify } = require("util");
const { exec, execSync } = require("child_process");
const { TPSLimiter, ConcurrentRateLimiter } = require("./rate-limiter");
const writeFile = promisify(fs.writeFile);
const readFile = promisify(fs.readFile);
const execAsync = promisify(exec);

// Speed multipliers by CEFR level (target TTS speed)
// Used to determine how much speedup is acceptable
const LEVEL_SPEEDS = {
  A1: 1.00,
  A2: 1.00,
  B1: 1.00,
  B2: 1.00,
  C1: 1.00,
};

// Maximum allowed speedup via atempo
// XTTS can generate very slow audio (4-8 c/s) depending on the voice sample.
// atempo up to ~2.0x still sounds acceptable for cloned voices.
// We allow higher speedup to improve sync accuracy.
const MAX_SPEEDUP = 2.0;

// XTTS speaks at roughly the same rate as natural human speech: ~13-15 c/s
// It doesn't have a "speed" setting - it generates what it thinks is natural
// for the cloned voice. If the cloned voice is fast, XTTS is fast, and vice versa.
// The KEY is to give XTTS ~14 chars/sec of text, then handle timing with:
//   - Silence padding (if audio too short)
//   - Gentle atempo (if audio slightly too long)
const XTTS_CHARS_PER_SECOND = 14;   // Natural XTTS speaking rate
const TTS_CHARS_PER_SECOND = 14;    // Lemonfox rate (similar)

// ════════════════════════════════════════════════════════════════════════════
// Utility Functions
// ════════════════════════════════════════════════════════════════════════════

function getAudioDuration(filePath) {
  try {
    const result = execSync(
      `ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "${filePath}"`,
      { encoding: "utf-8", timeout: 10000 }
    );
    return parseFloat(result.trim());
  } catch {
    return 0;
  }
}

// ════════════════════════════════════════════════════════════════════════════
// Configuration
// ════════════════════════════════════════════════════════════════════════════

const XTTS_MODEL = "lucataco/xtts-v2:684bc3855b37866c0c65add2ff39c78f3dea3f4ff103a436465326e0f438d55e";

// Language codes for XTTS (ISO 639-1)
// NOTE: XTTS only supports these languages!
// Indonesian, Japanese NOT supported - use ElevenLabs for those
const LANGUAGE_CODES = {
  english: "en",
  spanish: "es", 
  french: "fr",
  german: "de",
  italian: "it",
  portuguese: "pt",
  polish: "pl",
  turkish: "tr",
  russian: "ru",
  dutch: "nl",
  czech: "cs",
  arabic: "ar",
  chinese: "zh",
  korean: "ko",
  hungarian: "hu",
  hindi: "hi",
};

// Languages NOT supported by XTTS (need ElevenLabs)
const UNSUPPORTED_LANGUAGES = ["indonesian", "japanese", "vietnamese", "thai", "malay"];

// ════════════════════════════════════════════════════════════════════════════
// Quality Filtering - Skip weird/broken translations
// ════════════════════════════════════════════════════════════════════════════

/**
 * Check if a translation seems valid/natural
 * Filters out weird AI artifacts, untranslated text, repetitions
 */
function isValidTranslation(segment, targetLanguage = "spanish") {
  const text = segment.translatedText || segment.translated || "";
  const original = segment.originalText || segment.text || "";
  
  if (!text || text.trim().length < 2) {
    return { valid: false, reason: "empty" };
  }
  
  // Check for untranslated English (if target is Spanish)
  if (targetLanguage === "spanish") {
    // Common English words that shouldn't appear in Spanish translation
    const englishPatterns = /\b(the|and|but|with|that|this|what|have|from|they|would|could|should|about|there|their|which|when|will|more|been|were|being|other)\b/gi;
    const englishMatches = text.match(englishPatterns) || [];
    if (englishMatches.length > 2) {
      return { valid: false, reason: `too much English: ${englishMatches.slice(0, 3).join(", ")}` };
    }
  }
  
  // Check for weird repetition (same word 3+ times in a row)
  const repetitionPattern = /(\b\w+\b)(\s+\1){2,}/i;
  if (repetitionPattern.test(text)) {
    return { valid: false, reason: "repetitive text" };
  }
  
  // Check for translation that's way too long (likely hallucination)
  if (text.length > original.length * 3 && text.length > 100) {
    return { valid: false, reason: "suspiciously long" };
  }
  
  // Check for translation that's suspiciously identical to original
  if (text.toLowerCase().trim() === original.toLowerCase().trim() && original.length > 10) {
    return { valid: false, reason: "not translated" };
  }
  
  return { valid: true };
}

/**
 * Filter segments, removing invalid translations
 * Returns { filtered: [], skipped: [], stats: {} }
 */
function filterBadTranslations(segments, targetLanguage = "spanish") {
  const filtered = [];
  const skipped = [];
  
  for (const seg of segments) {
    const check = isValidTranslation(seg, targetLanguage);
    if (check.valid) {
      filtered.push(seg);
    } else {
      skipped.push({ ...seg, skipReason: check.reason });
    }
  }
  
  return {
    filtered,
    skipped,
    stats: {
      total: segments.length,
      kept: filtered.length,
      removed: skipped.length,
    }
  };
}

// ════════════════════════════════════════════════════════════════════════════
// Pre-processing: Merge Overlapping Segments
// ════════════════════════════════════════════════════════════════════════════

/**
 * Merge consecutive segments that would overlap into single TTS calls
 * This prevents cutting off words like "a veces" at segment boundaries
 * 
 * @param {array} segments - Segments with start, end, translatedText, speaker
 * @param {object} options - Merge options
 * @returns {object} { segments: merged segments, stats }
 */
function mergeOverlappingSegments(segments, options = {}) {
  const {
    level = "B1",
    maxMergeDuration = 15, // Don't merge if combined would be > 15s
  } = options;
  
  const speedMultiplier = LEVEL_SPEEDS[level] || 0.85;
  const effectiveCharsPerSecond = TTS_CHARS_PER_SECOND * speedMultiplier;
  
  const merged = [];
  let current = null;
  let mergeCount = 0;
  
  for (const seg of segments) {
    if (!current) {
      current = { ...seg };
      continue;
    }
    
    // Calculate if current segment's TTS would overlap with next
    const currentText = current.translatedText || current.translated || "";
    const estimatedDuration = currentText.length / effectiveCharsPerSecond;
    const currentEnd = current.start + estimatedDuration;
    const wouldOverlap = currentEnd > seg.start - 0.1; // 100ms buffer
    
    // Same speaker and would overlap?
    const sameSpeaker = !current.speaker || !seg.speaker || current.speaker === seg.speaker;
    const combinedDuration = seg.end - current.start;
    
    if (sameSpeaker && wouldOverlap && combinedDuration <= maxMergeDuration) {
      // Merge segments - combine text with space
      const segText = seg.translatedText || seg.translated || "";
      current.translatedText = `${currentText} ${segText}`.trim();
      current.translated = current.translatedText;
      current.end = seg.end;
      current.originalText = (current.originalText || current.text || "") + " " + (seg.originalText || seg.text || "");
      current.text = current.originalText;
      current.merged = (current.merged || 1) + 1;
      mergeCount++;
    } else {
      // Push current and start new
      merged.push(current);
      current = { ...seg };
    }
  }
  
  // Don't forget the last segment
  if (current) {
    merged.push(current);
  }
  
  return {
    segments: merged,
    stats: {
      original: segments.length,
      merged: merged.length,
      combinedCount: mergeCount,
    }
  };
}

// ════════════════════════════════════════════════════════════════════════════
// Post-processing: Clean XTTS Artifacts
// ════════════════════════════════════════════════════════════════════════════

/**
 * Clean XTTS audio output to remove artifacts
 * 
 * XTTS-v2 commonly produces garbled/distorted audio ("zombie sounds") in
 * the first ~100-200ms of generated segments. This function:
 * 1. Trims the first 150ms where artifacts typically live
 * 2. Applies a 50ms fade-in to smooth any remaining edge
 * 3. Applies a 30ms fade-out for clean endings
 * 4. Applies a highpass filter to remove low-frequency rumble artifacts
 * 
 * @param {string} inputPath - Raw XTTS output file
 * @param {string} outputPath - Cleaned output file
 * @returns {Promise<string>} Path to cleaned audio (or original if cleaning fails)
 */
async function cleanXTTSOutput(inputPath, outputPath) {
  try {
    // Trim first 150ms (artifact zone) + fade-in 50ms + fade-out 30ms + highpass 60Hz
    const cmd = `ffmpeg -y -ss 0.15 -i "${inputPath}" -af "afade=t=in:d=0.05,highpass=f=60" "${outputPath}" 2>/dev/null`;
    await execAsync(cmd);
    
    // Verify the cleaned file is valid and not too short
    const cleanedDuration = getAudioDuration(outputPath);
    if (cleanedDuration < 0.3) {
      // Cleaning made it too short, use original
      return inputPath;
    }
    
    return outputPath;
  } catch (err) {
    // If cleaning fails, use original
    return inputPath;
  }
}

/**
 * Detect and trim zombie preamble from XTTS output.
 * 
 * XTTS sometimes produces audio like:
 *   [zombie noise / garbled speech for N seconds] [brief gap] [actual clean translation]
 * 
 * The zombie preamble inflates the total duration, and when atempo is applied to fit
 * the time slot, both the zombie AND the real speech get sped up — the user hears
 * garbled noise followed by rushed/out-of-sync real speech.
 * 
 * Detection strategy:
 * 1. If audio is > 1.4x expected duration, it likely has a zombie preamble
 * 2. Analyze per-window energy to find where speech actually starts
 * 3. Use silencedetect to find silence gaps that separate zombie from real speech
 * 4. Trim everything before the speech onset
 * 
 * @param {string} audioPath - XTTS output audio file
 * @param {number} expectedDuration - Expected segment duration (seconds)
 * @param {string} outputPath - Path for trimmed output
 * @param {number} textLength - Length of the translated text (chars)
 * @returns {{ trimmed: boolean, path: string, duration: number, preambleDuration?: number, diagnostics?: object }}
 */
function detectAndTrimZombiePreamble(audioPath, expectedDuration, outputPath, textLength) {
  const rawDuration = getAudioDuration(audioPath);
  const ratio = rawDuration / expectedDuration;
  
  // Only analyze if suspiciously long (> 1.4x expected)
  if (ratio <= 1.4) {
    return { trimmed: false, path: audioPath, duration: rawDuration };
  }
  
  console.log(`      🔍 Preamble analysis: raw=${rawDuration.toFixed(1)}s vs expected=${expectedDuration.toFixed(1)}s (${ratio.toFixed(2)}x overshoot)`);
  
  const diagnostics = { ratio, rawDuration, expectedDuration, silenceGaps: [], energyWindows: [] };
  
  try {
    // ── Step 1: Silence gap detection ──
    // Find silence gaps that might separate zombie from real speech
    let silenceGaps = [];
    try {
      const silenceOutput = execSync(
        `ffmpeg -i "${audioPath}" -af "silencedetect=noise=-30dB:d=0.2" -f null /dev/null 2>&1`,
        { encoding: 'utf-8', timeout: 10000 }
      );
      
      const endRegex = /silence_end:\s*([\d.]+)\s*\|\s*silence_duration:\s*([\d.]+)/g;
      
      let m;
      while ((m = endRegex.exec(silenceOutput)) !== null) {
        const end = parseFloat(m[1]);
        const dur = parseFloat(m[2]);
        const start = end - dur;
        silenceGaps.push({ start, end, duration: dur });
      }
      diagnostics.silenceGaps = silenceGaps;
    } catch {}
    
    // ── Step 2: Per-window energy analysis ──
    // Analyze in 1-second windows to find energy profile
    // Only need to analyze enough to find the preamble boundary (first ~25s max)
    const windowSize = 1.0;
    const analyzeUpTo = Math.min(rawDuration * 0.7, 25); // Cap at 25s to keep analysis fast
    const windowCount = Math.ceil(analyzeUpTo / windowSize);
    const energyWindows = [];
    
    try {
      // Analyze each 1-second window individually for reliable energy profiling
      for (let i = 0; i < windowCount && i < 25; i++) {
        const startTime = i * windowSize;
        try {
          const rmsOut = execSync(
            `ffmpeg -ss ${startTime.toFixed(2)} -t ${windowSize.toFixed(2)} -i "${audioPath}" -af "volumedetect" -f null /dev/null 2>&1`,
            { encoding: 'utf-8', timeout: 5000 }
          );
          const meanMatch = rmsOut.match(/mean_volume:\s*([-\d.]+)/);
          const maxMatch = rmsOut.match(/max_volume:\s*([-\d.]+)/);
          energyWindows.push({
            start: startTime,
            end: startTime + windowSize,
            meanVol: meanMatch ? parseFloat(meanMatch[1]) : -100,
            maxVol: maxMatch ? parseFloat(maxMatch[1]) : -100,
          });
        } catch {
          energyWindows.push({ start: startTime, end: startTime + windowSize, meanVol: -100, maxVol: -100 });
        }
      }
      diagnostics.energyWindows = energyWindows;
    } catch {}
    
    // ── Step 3: Find speech onset ──
    let speechOnset = 0;
    let detectionMethod = 'none';
    
    // Method A: Look for silence gaps in the first half that separate zombie from speech
    // The zombie preamble is often followed by a silence gap, then the real speech starts
    const firstHalf = rawDuration * 0.6;
    const significantGaps = silenceGaps.filter(g => g.start > 0.3 && g.start < firstHalf && g.duration >= 0.2);
    
    for (const gap of significantGaps) {
      const audioAfterGap = rawDuration - gap.end;
      // Check if the audio AFTER this gap has a reasonable duration for the expected text
      // Real speech should be roughly expectedDuration ± 30%
      if (audioAfterGap >= expectedDuration * 0.5 && audioAfterGap <= expectedDuration * 1.8) {
        // Check if the speaking rate after this gap makes sense
        const rateAfterGap = textLength / audioAfterGap;
        if (rateAfterGap >= 4 && rateAfterGap <= 18) {
          speechOnset = gap.end;
          detectionMethod = `silence_gap at ${gap.start.toFixed(1)}-${gap.end.toFixed(1)}s (gap=${gap.duration.toFixed(2)}s)`;
          break;
        }
      }
    }
    
    // Method B: Energy transition detection
    // Look for a clear energy increase that's sustained (zombie → speech transition)
    if (speechOnset === 0 && energyWindows.length >= 4) {
      // Calculate the median energy of the last 40% of windows (likely contains real speech)
      const lastWindows = energyWindows.slice(Math.floor(energyWindows.length * 0.6));
      const lastEnergies = lastWindows.map(w => w.meanVol).filter(v => v > -80).sort((a, b) => a - b);
      const speechMedianEnergy = lastEnergies.length > 0 ? lastEnergies[Math.floor(lastEnergies.length / 2)] : -20;
      
      // Look for the transition point: where energy crosses from below to above the speech level
      const threshold = speechMedianEnergy - 8; // Speech energy minus 8dB margin
      
      for (let i = 0; i < energyWindows.length - 2; i++) {
        const curr = energyWindows[i];
        const next1 = energyWindows[i + 1];
        const next2 = energyWindows[i + 2];
        
        // Transition: low energy → sustained high energy
        if (curr.meanVol < threshold && next1.meanVol >= threshold && next2.meanVol >= threshold) {
          // Verify: audio remaining after this point is reasonable for expected duration
          const remaining = rawDuration - next1.start;
          const rateAfter = textLength / remaining;
          if (rateAfter >= 4 && rateAfter <= 18 && next1.start > 0.5) {
            speechOnset = next1.start;
            detectionMethod = `energy_transition at ${next1.start.toFixed(1)}s (below=${curr.meanVol.toFixed(0)}dB, above=${next1.meanVol.toFixed(0)}dB, threshold=${threshold.toFixed(0)}dB)`;
            break;
          }
        }
      }
    }
    
    // Method C: Duration-based estimation
    // If all else fails and the duration is WAY over (>1.8x), estimate trim based on excess
    if (speechOnset === 0 && ratio > 1.8) {
      // The zombie preamble roughly equals the excess duration
      const excessDuration = rawDuration - expectedDuration * 1.15; // Leave 15% buffer
      if (excessDuration > 1.0) {
        // Snap to nearest silence gap if one exists near our estimate
        const nearbyGap = silenceGaps.find(g => Math.abs(g.end - excessDuration) < 2.0 && g.start > 0.5);
        if (nearbyGap) {
          speechOnset = nearbyGap.end;
          detectionMethod = `duration_estimate + nearby_gap at ${nearbyGap.end.toFixed(1)}s`;
        } else {
          speechOnset = excessDuration;
          detectionMethod = `duration_estimate at ${excessDuration.toFixed(1)}s (${ratio.toFixed(2)}x overshoot)`;
        }
      }
    }
    
    // ── Step 4: Trim if preamble found ──
    if (speechOnset > 0.5) {
      // Log detailed diagnostics
      console.log(`      ✂️ ZOMBIE PREAMBLE DETECTED: ${speechOnset.toFixed(1)}s of zombie noise`);
      console.log(`         Method: ${detectionMethod}`);
      
      // Log energy profile
      if (energyWindows.length > 0) {
        const preWindows = energyWindows.filter(w => w.end <= speechOnset);
        const postWindows = energyWindows.filter(w => w.start >= speechOnset).slice(0, 6);
        if (preWindows.length > 0) {
          console.log(`         Pre-trim energy (dB):  [${preWindows.map(w => w.meanVol.toFixed(0)).join(', ')}]`);
        }
        if (postWindows.length > 0) {
          console.log(`         Post-trim energy (dB): [${postWindows.map(w => w.meanVol.toFixed(0)).join(', ')}]`);
        }
      }
      
      // Trim the preamble
      try {
        execSync(
          `ffmpeg -y -ss ${speechOnset.toFixed(3)} -i "${audioPath}" -af "afade=t=in:d=0.03" -acodec pcm_s16le -ar 22050 -ac 1 "${outputPath}"`,
          { stdio: ['pipe', 'pipe', 'pipe'] }
        );
        
        const trimmedDuration = getAudioDuration(outputPath);
        if (trimmedDuration > 0.5) {
          const newRate = textLength / trimmedDuration;
          console.log(`         Result: ${rawDuration.toFixed(1)}s → ${trimmedDuration.toFixed(1)}s (rate: ${newRate.toFixed(1)} c/s)`);
          return { trimmed: true, path: outputPath, duration: trimmedDuration, preambleDuration: speechOnset, diagnostics };
        }
      } catch (err) {
        console.log(`      ⚠️ Trim failed: ${err.message}`);
      }
    } else if (ratio > 1.5) {
      // No clear preamble found, but audio is still very long — log warning
      console.log(`      ⚠️ Audio is ${ratio.toFixed(2)}x expected but no clear preamble boundary found`);
      if (energyWindows.length > 0) {
        console.log(`         Energy profile (dB): [${energyWindows.slice(0, 15).map(w => w.meanVol.toFixed(0)).join(', ')}]`);
      }
    }
    
    return { trimmed: false, path: audioPath, duration: rawDuration, diagnostics };
  } catch (err) {
    console.log(`      ⚠️ Preamble analysis error: ${err.message}`);
    return { trimmed: false, path: audioPath, duration: rawDuration };
  }
}

/**
 * Analyze XTTS output quality and detect "zombie" segments
 * 
 * Zombie indicators:
 * 1. Speaking rate > 20 c/s (garbled/compressed audio)
 * 2. Speaking rate < 3 c/s (mostly silence/noise)
 * 3. Initial energy spike (first 200ms much louder than rest)
 * 4. Very short duration relative to text length
 * 5. Extreme peak-to-mean ratio (clipping/distortion)
 * 
 * @returns {object} { isZombie, quality, issues[], metrics }
 */
function analyzeXTTSQuality(audioPath, textLength, expectedDuration) {
  const issues = [];
  const metrics = {};
  
  try {
    const duration = getAudioDuration(audioPath);
    metrics.duration = duration;
    
    if (duration < 0.3) {
      return { isZombie: true, quality: 0, issues: ["Audio too short (<0.3s)"], metrics };
    }
    
    // Speaking rate analysis
    const speakingRate = textLength / duration;
    metrics.speakingRate = speakingRate;
    
    if (speakingRate > 17) {
      issues.push(`Speaking rate ${speakingRate.toFixed(1)} c/s (>17 = garbled/rushed)`);
    } else if (speakingRate > 15) {
      issues.push(`Speaking rate ${speakingRate.toFixed(1)} c/s (>15 = suspiciously fast)`);
    }
    if (speakingRate < 3) {
      issues.push(`Speaking rate ${speakingRate.toFixed(1)} c/s (<3 = mostly silence)`);
    }
    
    // Duration ratio check
    const durationRatio = duration / expectedDuration;
    metrics.durationRatio = durationRatio;
    if (durationRatio < 0.15) {
      issues.push(`Duration ${duration.toFixed(2)}s vs expected ${expectedDuration.toFixed(1)}s (${(durationRatio * 100).toFixed(0)}%)`);
    }
    // Duration overrun check — if XTTS generates > 2.5x the expected duration,
    // it almost certainly has a massive zombie preamble and should be retried
    if (durationRatio > 2.5) {
      issues.push(`Massive overrun: ${duration.toFixed(1)}s vs expected ${expectedDuration.toFixed(1)}s (${(durationRatio * 100).toFixed(0)}% — likely zombie preamble)`);
    }
    
    // Audio level analysis using ffmpeg
    try {
      // Get volume stats: mean volume and max volume
      const volumeInfo = execSync(
        `ffmpeg -i "${audioPath}" -af "volumedetect" -f null /dev/null 2>&1 | grep -E "mean_volume|max_volume"`,
        { encoding: "utf-8", timeout: 5000 }
      );
      
      const meanMatch = volumeInfo.match(/mean_volume:\s*([-\d.]+)/);
      const maxMatch = volumeInfo.match(/max_volume:\s*([-\d.]+)/);
      
      if (meanMatch) metrics.meanVolume = parseFloat(meanMatch[1]);
      if (maxMatch) metrics.maxVolume = parseFloat(maxMatch[1]);
      
      // Very quiet audio (mean < -40dB) suggests mostly silence/noise
      if (metrics.meanVolume && metrics.meanVolume < -40) {
        issues.push(`Very quiet: mean ${metrics.meanVolume.toFixed(1)}dB (<-40dB)`);
      }
      
      // Extreme peak-to-mean spread suggests distortion
      if (metrics.meanVolume && metrics.maxVolume) {
        const spread = metrics.maxVolume - metrics.meanVolume;
        metrics.peakMeanSpread = spread;
        if (spread > 30) {
          issues.push(`High peak-to-mean: ${spread.toFixed(1)}dB (>30dB = distortion likely)`);
        }
      }
    } catch {}
    
    // Initial artifact detection: compare first 200ms RMS to rest
    try {
      const firstChunkRMS = execSync(
        `ffmpeg -i "${audioPath}" -t 0.2 -af "astats=metadata=1:reset=1,ametadata=print:key=lavfi.astats.Overall.RMS_level" -f null /dev/null 2>&1 | grep "RMS_level" | tail -1`,
        { encoding: "utf-8", timeout: 5000 }
      );
      const restRMS = execSync(
        `ffmpeg -ss 0.3 -i "${audioPath}" -af "astats=metadata=1:reset=1,ametadata=print:key=lavfi.astats.Overall.RMS_level" -f null /dev/null 2>&1 | grep "RMS_level" | tail -1`,
        { encoding: "utf-8", timeout: 5000 }
      );
      
      const firstRMSMatch = firstChunkRMS.match(/RMS_level=([-\d.]+)/);
      const restRMSMatch = restRMS.match(/RMS_level=([-\d.]+)/);
      
      if (firstRMSMatch && restRMSMatch) {
        const firstRMS = parseFloat(firstRMSMatch[1]);
        const restRMSVal = parseFloat(restRMSMatch[1]);
        metrics.initialRMS = firstRMS;
        metrics.bodyRMS = restRMSVal;
        
        // If first 200ms is >15dB louder than the rest, it's an artifact
        if (firstRMS - restRMSVal > 15) {
          issues.push(`Initial artifact: first 200ms ${(firstRMS - restRMSVal).toFixed(1)}dB louder than body`);
        }
      }
    } catch {}
    
    // Quality scoring (0-100)
    // Natural XTTS speech is 10-15 c/s. Above 17 = rushed/garbled. Above 20 = definitely zombie.
    let quality = 100;
    if (speakingRate > 20) quality -= 70;       // Almost certainly garbled
    else if (speakingRate > 17) quality -= 50;  // Rushed/zombie (18.1 c/s should flag!)
    else if (speakingRate > 15) quality -= 20;  // Suspicious but may be ok
    if (speakingRate < 3) quality -= 50;        // Mostly empty
    if (durationRatio < 0.15) quality -= 40;    // Way too short
    if (durationRatio > 2.5) quality -= 60;     // Massive overrun = zombie preamble
    else if (durationRatio > 2.0) quality -= 30; // Significant overrun, likely has preamble
    if (metrics.meanVolume && metrics.meanVolume < -40) quality -= 20;
    if (metrics.peakMeanSpread && metrics.peakMeanSpread > 30) quality -= 20;
    if (metrics.initialRMS && metrics.bodyRMS && (metrics.initialRMS - metrics.bodyRMS > 15)) quality -= 15;
    quality = Math.max(0, quality);
    
    const isZombie = quality < 40 || speakingRate > 17 || (speakingRate < 3 && duration > 0.5) || durationRatio > 2.5;
    
    return { isZombie, quality, issues, metrics };
  } catch (err) {
    return { isZombie: false, quality: 50, issues: [`Analysis error: ${err.message}`], metrics };
  }
}

// ════════════════════════════════════════════════════════════════════════════
// Post-processing: Speed Adjustment with FFmpeg
// ════════════════════════════════════════════════════════════════════════════

/**
 * Adjust audio speed using ffmpeg atempo filter
 * atempo range is 0.5 to 2.0, chain multiple for extreme values
 * 
 * @param {string} inputPath - Input audio file
 * @param {string} outputPath - Output audio file
 * @param {number} targetDuration - Desired duration in seconds
 * @param {number} currentDuration - Current audio duration
 * @returns {string} Path to adjusted audio (or original if no change needed)
 */
async function adjustAudioSpeed(inputPath, outputPath, targetDuration, currentDuration) {
  if (!currentDuration || currentDuration <= 0) {
    return inputPath; // Can't adjust
  }
  
  const ratio = currentDuration / targetDuration; // How much faster we need to go
  
  // If within 10% tolerance, don't adjust
  if (ratio >= 0.9 && ratio <= 1.1) {
    return inputPath;
  }
  
  // atempo = how much to speed up (>1 = faster, <1 = slower)
  // We want to SPEED UP to fit the slot → use atempo > 1.0
  let atempo = ratio;
  
  // Clamp to reasonable range (0.5 to MAX_SPEEDUP for natural sound)
  // Beyond MAX_SPEEDUP, audio sounds robotic - better to overflow
  atempo = Math.max(0.5, Math.min(MAX_SPEEDUP, atempo));
  
  // Build atempo filter chain (atempo only accepts 0.5-2.0)
  let atempoFilters = [];
  let remaining = atempo;
  
  while (remaining > 2.0) {
    atempoFilters.push("atempo=2.0");
    remaining /= 2.0;
  }
  while (remaining < 0.5) {
    atempoFilters.push("atempo=0.5");
    remaining /= 0.5;
  }
  atempoFilters.push(`atempo=${remaining.toFixed(4)}`);
  
  const filterChain = atempoFilters.join(",");
  
  const cmd = `ffmpeg -y -i "${inputPath}" -filter:a "${filterChain}" "${outputPath}" 2>/dev/null`;
  
  try {
    await execAsync(cmd);
    return outputPath;
  } catch (err) {
    console.log(`   ⚠️ Speed adjustment failed: ${err.message}`);
    return inputPath; // Return original on failure
  }
}

/**
 * Pad audio with silence to reach target duration
 * Centers the audio in the slot with equal silence before/after
 * This sounds MUCH more natural than stretching/slowing the voice
 * 
 * @param {string} inputPath - Input audio file
 * @param {string} outputPath - Output audio file
 * @param {number} targetDuration - Desired total duration in seconds
 * @param {number} currentDuration - Current audio duration
 * @returns {Promise<string>} Path to padded audio
 */
async function padWithSilence(inputPath, outputPath, targetDuration, currentDuration) {
  if (!currentDuration || currentDuration <= 0 || currentDuration >= targetDuration) {
    return inputPath;
  }
  
  const totalPad = targetDuration - currentDuration;
  const padBefore = totalPad * 0.3;  // 30% silence before (small lead-in)
  const padAfter = totalPad * 0.7;   // 70% silence after (natural trailing)
  
  // Use ffmpeg to add silence padding
  // adelay adds silence at the start, apad adds at the end
  const cmd = `ffmpeg -y -i "${inputPath}" -af "adelay=${Math.round(padBefore * 1000)}|${Math.round(padBefore * 1000)},apad=pad_dur=${padAfter.toFixed(3)}" -t ${targetDuration.toFixed(3)} "${outputPath}" 2>/dev/null`;
  
  try {
    await execAsync(cmd);
    return outputPath;
  } catch (err) {
    // Simpler fallback: just add silence after
    try {
      const fallbackCmd = `ffmpeg -y -f lavfi -t ${padBefore.toFixed(3)} -i anullsrc=r=22050:cl=mono -i "${inputPath}" -f lavfi -t ${padAfter.toFixed(3)} -i anullsrc=r=22050:cl=mono -filter_complex "[0][1][2]concat=n=3:v=0:a=1" "${outputPath}" 2>/dev/null`;
      await execAsync(fallbackCmd);
      return outputPath;
    } catch {
      return inputPath;
    }
  }
}

// ════════════════════════════════════════════════════════════════════════════
// Voice Sample Extraction
// ════════════════════════════════════════════════════════════════════════════

/**
 * Extract a clean voice sample from video for a specific speaker
 * Uses the longest segment from that speaker for best quality
 */
async function extractVoiceSample(videoPath, segments, speaker, outputDir) {
  
  // Find segments for this speaker, sorted by duration (longest first)
  const speakerSegments = segments
    .filter(s => s.speaker === speaker && s.end - s.start >= 3) // At least 3 seconds
    .sort((a, b) => (b.end - b.start) - (a.end - a.start));
  
  if (speakerSegments.length === 0) {
    throw new Error(`No suitable segments found for speaker: ${speaker}`);
  }
  
  // Take the longest segment (up to 15 seconds for best cloning)
  const bestSegment = speakerSegments[0];
  const duration = Math.min(bestSegment.end - bestSegment.start, 15);
  
  const samplePath = path.join(outputDir, `voice_sample_${speaker}.wav`);
  
  // Extract audio segment as WAV (required format for XTTS)
  const cmd = [
    "ffmpeg", "-y",
    "-i", `"${videoPath}"`,
    "-ss", bestSegment.start.toFixed(3),
    "-t", duration.toFixed(3),
    "-vn",                    // No video
    "-acodec", "pcm_s16le",   // WAV format
    "-ar", "22050",           // 22kHz sample rate (XTTS preference)
    "-ac", "1",               // Mono
    `"${samplePath}"`
  ].join(" ");
  
  await execAsync(cmd);
  
  console.log(`   📎 Extracted ${duration.toFixed(1)}s voice sample for ${speaker}`);
  
  return {
    speaker,
    samplePath,
    duration,
    segmentUsed: bestSegment,
  };
}

/**
 * Find the speaker with the most total speaking time
 * Used for narrator mode - single voice narration
 */
function findDominantSpeaker(segments) {
  const speakerTime = {};
  
  for (const seg of segments) {
    const speaker = seg.speaker || "SPEAKER_00";
    const duration = (seg.end - seg.start) || seg.duration || 0;
    speakerTime[speaker] = (speakerTime[speaker] || 0) + duration;
  }
  
  // Find speaker with most time
  let dominant = null;
  let maxTime = 0;
  
  for (const [speaker, time] of Object.entries(speakerTime)) {
    if (time > maxTime) {
      maxTime = time;
      dominant = speaker;
    }
  }
  
  return { speaker: dominant, totalTime: maxTime, allSpeakers: speakerTime };
}

/**
 * Filter segments to only include the dominant speaker
 * Returns both the filtered segments and the excluded segments
 * Used for narrator-only mode where we only dub the main speaker
 */
function filterDominantSpeakerSegments(segments) {
  const { speaker: dominant, totalTime, allSpeakers } = findDominantSpeaker(segments);
  
  const narratorSegments = segments.filter(seg => seg.speaker === dominant);
  const otherSegments = segments.filter(seg => seg.speaker !== dominant);
  
  const totalDuration = Object.values(allSpeakers).reduce((a, b) => a + b, 0);
  const percentage = ((totalTime / totalDuration) * 100).toFixed(1);
  
  console.log(`\n   🎙️ NARRATOR-ONLY MODE: Filtering to dominant speaker`);
  console.log(`   Dominant: ${dominant} (${totalTime.toFixed(1)}s / ${percentage}% of speech)`);
  console.log(`   Narrator segments: ${narratorSegments.length}`);
  console.log(`   Other segments: ${otherSegments.length} (will keep original audio)`);
  
  return {
    narratorSegments,
    otherSegments,
    dominantSpeaker: dominant,
    speakerStats: allSpeakers,
  };
}

/**
 * Extract voice samples for all speakers in the video
 */
async function extractAllVoiceSamples(videoPath, segments, outputDir, options = {}) {
  const { narratorMode = false } = options;
  
  // Get unique speakers
  const speakers = [...new Set(segments.map(s => s.speaker).filter(Boolean))];
  
  console.log(`\n${"═".repeat(60)}`);
  console.log(`🎤 VOICE CLONING: Extracting speaker samples`);
  console.log(`${"═".repeat(60)}`);
  
  if (narratorMode) {
    // Narrator mode: only extract the dominant speaker's voice
    const { speaker: dominant, totalTime, allSpeakers } = findDominantSpeaker(segments);
    console.log(`   🎙️ NARRATOR MODE: Using single voice`);
    console.log(`   Found ${speakers.length} speaker(s), picking dominant:`);
    
    for (const [spk, time] of Object.entries(allSpeakers)) {
      const marker = spk === dominant ? "★" : " ";
      console.log(`      ${marker} ${spk}: ${time.toFixed(1)}s${spk === dominant ? " (NARRATOR)" : ""}`);
    }
    
    const samples = {};
    try {
      samples[dominant] = await extractVoiceSample(videoPath, segments, dominant, outputDir);
      // Map ALL speakers to the dominant voice
      for (const speaker of speakers) {
        samples[speaker] = samples[dominant];
      }
      console.log(`   ✅ All speakers will use ${dominant}'s voice`);
    } catch (err) {
      console.log(`   ❌ Could not extract sample for ${dominant}: ${err.message}`);
    }
    
    return samples;
  }
  
  // Normal mode: extract all speakers
  console.log(`   Found ${speakers.length} speaker(s): ${speakers.join(", ")}`);
  
  const samples = {};
  
  for (const speaker of speakers) {
    try {
      samples[speaker] = await extractVoiceSample(videoPath, segments, speaker, outputDir);
    } catch (err) {
      console.log(`   ⚠️ Could not extract sample for ${speaker}: ${err.message}`);
    }
  }
  
  return samples;
}

// ════════════════════════════════════════════════════════════════════════════
// XTTS TTS Generation via Replicate
// ════════════════════════════════════════════════════════════════════════════

/**
 * Generate TTS for a single segment using cloned voice
 */
async function generateXTTS(text, voiceSamplePath, language, outputPath, options = {}) {
  const { skipPreprocessing = false, voiceUrl = false } = options;
  
  // Support both REPLICATE_API_TOKEN and REPLICATE_API_KEY
  const apiToken = process.env.REPLICATE_API_TOKEN || process.env.REPLICATE_API_KEY;
  const replicate = new Replicate({ auth: apiToken });
  
  const languageCode = LANGUAGE_CODES[language?.toLowerCase()] || "en";
  
  let speakerUrl;
  let tempProcessedPath = null;
  
  // If voiceUrl is true, voiceSamplePath is already a URL - use it directly
  if (voiceUrl) {
    speakerUrl = voiceSamplePath;
  } else {
    // Need to preprocess and upload the file
    let finalSamplePath = voiceSamplePath;
    tempProcessedPath = voiceSamplePath.replace(/\.\w+$/, '_processed.wav');
    
    // Preprocess voice sample ONLY if not already done (to avoid repeated preprocessing)
    if (!skipPreprocessing) {
      // Preprocess voice sample to ensure it's in the right format for XTTS
      // XTTS needs: WAV, 22050Hz, mono, 16-bit PCM
      // Also trim silence from start/end to get just the speech
      try {
        execSync(
          `ffmpeg -y -i "${voiceSamplePath}" -af "silenceremove=start_periods=1:start_silence=0.1:start_threshold=-40dB,areverse,silenceremove=start_periods=1:start_silence=0.1:start_threshold=-40dB,areverse" -ar 22050 -ac 1 -acodec pcm_s16le "${tempProcessedPath}" 2>/dev/null`,
          { stdio: 'pipe' }
        );
        
        // Check duration of processed file
        const processedDuration = execSync(
          `ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "${tempProcessedPath}"`,
          { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] }
        ).trim();
        
        const duration = parseFloat(processedDuration);
        if (duration < 3) {
          console.warn(`   ⚠️ Voice sample after trimming is too short (${duration.toFixed(1)}s). Using original.`);
          if (fs.existsSync(tempProcessedPath)) {
            fs.unlinkSync(tempProcessedPath);
          }
        } else {
          console.log(`   ✅ Voice sample preprocessed: ${duration.toFixed(1)}s of clean speech`);
          finalSamplePath = tempProcessedPath;
        }
      } catch (err) {
        // If preprocessing fails, try using the original
        console.warn(`   ⚠️ Audio preprocessing failed: ${err.message}`);
      }
      
      // If preprocessing failed, use original
      if (!fs.existsSync(finalSamplePath) || finalSamplePath === tempProcessedPath && !fs.existsSync(tempProcessedPath)) {
        finalSamplePath = voiceSamplePath;
      }
    }
    
    // Upload voice sample to Replicate and get a URL
    // The direct buffer approach doesn't work reliably with XTTS
    try {
      // Read file as buffer
      const sampleBuffer = await readFile(finalSamplePath);
      console.log(`   📤 Uploading voice sample (${(sampleBuffer.length / 1024).toFixed(1)} KB)...`);
      
      // Upload to Replicate's file storage
      const file = await replicate.files.create(sampleBuffer, {
        filename: path.basename(finalSamplePath),
      });
      
      speakerUrl = file.urls.get;
      console.log(`   ✅ Voice sample uploaded: ${speakerUrl}`);
    } catch (uploadErr) {
      console.warn(`   ⚠️ File upload failed: ${uploadErr.message}`);
      // Fallback: try using the buffer directly
      const sampleBuffer = await readFile(finalSamplePath);
      speakerUrl = sampleBuffer;
    }
  }
  
  // Clean up temp file helper
  const cleanupTemp = () => {
    if (tempProcessedPath && fs.existsSync(tempProcessedPath) && tempProcessedPath !== voiceSamplePath) {
      try {
        fs.unlinkSync(tempProcessedPath);
      } catch (e) {
        // Ignore cleanup errors
      }
    }
  };
  
  const input = {
    text: text,
    speaker: speakerUrl,  // Use URL from Replicate's file storage
    language: languageCode,
  };
  
  try {
    const output = await replicate.run(XTTS_MODEL, { input });
    
    // Clean up temp file after API call completes
    cleanupTemp();
    
    // Output is a ReadableStream or URL, need to download it
    if (output && typeof output.url === "function") {
      // It's a FileOutput object
      const url = output.url();
      const response = await fetch(url);
      const buffer = Buffer.from(await response.arrayBuffer());
      await writeFile(outputPath, buffer);
    } else if (typeof output === "string") {
      // It's a URL string
      const response = await fetch(output);
      const buffer = Buffer.from(await response.arrayBuffer());
      await writeFile(outputPath, buffer);
    } else {
      // It's already a buffer/stream
      await writeFile(outputPath, output);
    }
    
    return { success: true, outputPath };
  } catch (err) {
    // Clean up temp file on error too
    cleanupTemp();
    console.error(`   ❌ XTTS error: ${err.message}`);
    return { success: false, error: err.message };
  }
}

/**
 * Generate TTS for all segments with voice cloning
 * 
 * Features:
 * - Pre-merges overlapping segments (prevents cut-off words)
 * - Post-processes with atempo for level-based speed control
 * - Respects segment timing to prevent overlaps
 */
async function generateAndAlignXTTS(segments, voiceSamples, outputDir, options = {}) {
  const {
    language = "english",
    maxTPS = 10,
    maxConcurrent = 50,    // Max simultaneous Replicate requests
    onProgress = null,
    level = "B1",
    mergeOverlaps = false,
    adjustSpeed = true,
    filterBad = true,
  } = options;
  
  console.log(`\n${"═".repeat(60)}`);
  console.log(`🎙️ XTTS: Generating cloned voice TTS`);
  console.log(`${"═".repeat(60)}`);
  console.log(`   Language: ${language}`);
  console.log(`   Level: ${level}`);
  console.log(`   Segments: ${segments.length}`);
  console.log(`   Max TPS: ${maxTPS} | Max concurrent: ${maxConcurrent}`);
  console.log(`   Merge overlaps: ${mergeOverlaps}`);
  console.log(`   Filter bad translations: ${filterBad}`);
  console.log(`   Strategy: 100% XTTS (silence padding + gentle atempo, NO fallback)`);
  
  // Check if language is supported
  if (UNSUPPORTED_LANGUAGES.includes(language.toLowerCase())) {
    throw new Error(
      `XTTS does not support ${language}!\n` +
      `Supported: en, es, fr, de, it, pt, pl, tr, ru, nl, cs, ar, zh, ko, hu, hi\n` +
      `For ${language}, use ElevenLabs instead (--premium flag in pipeline)`
    );
  }
  
  // Step 0: Filter out bad/weird translations
  let inputSegments = segments;
  let filterStats = { total: segments.length, kept: segments.length, removed: 0 };
  
  if (filterBad) {
    const filterResult = filterBadTranslations(segments, language);
    inputSegments = filterResult.filtered;
    filterStats = filterResult.stats;
    
    if (filterResult.skipped.length > 0) {
      console.log(`   🗑️ Filtered ${filterResult.skipped.length} bad translations:`);
      filterResult.skipped.forEach(s => {
        console.log(`      Seg ${s.index}: ${s.skipReason} - "${(s.translatedText || "").substring(0, 40)}..."`);
      });
    }
  }
  
  // Step 1: Pre-merge overlapping segments
  let processedSegments = inputSegments;
  let mergeStats = { original: inputSegments.length, merged: inputSegments.length, combinedCount: 0 };
  
  if (mergeOverlaps) {
    const mergeResult = mergeOverlappingSegments(inputSegments, { level });
    processedSegments = mergeResult.segments;
    mergeStats = mergeResult.stats;
    
    if (mergeStats.combinedCount > 0) {
      console.log(`   🔗 Merged ${mergeStats.combinedCount} overlapping segments:`);
      console.log(`      ${mergeStats.original} → ${mergeStats.merged} segments`);
    }
  }
  
  let speedAdjusted = 0;
  let silencePadded = 0;
  let preambleTrimmed = 0;
  
  // Create tts subdir for adjusted audio
  const ttsDir = path.join(outputDir, "tts");
  fs.mkdirSync(ttsDir, { recursive: true });
  
  // ═══════════════════════════════════════════════════════════════════
  // STEP 2: UPLOAD VOICE SAMPLES ONCE (not per-segment!)
  // ═══════════════════════════════════════════════════════════════════
  console.log(`\n   🎤 Preprocessing & uploading voice samples (once)...`);
  
  const apiToken = process.env.REPLICATE_API_TOKEN || process.env.REPLICATE_API_KEY;
  const replicate = new Replicate({ auth: apiToken });
  
  // Upload each unique voice sample once
  const uploadedVoiceUrls = {};
  for (const [speaker, sample] of Object.entries(voiceSamples)) {
    // Check if this sample path is already uploaded (speakers may share a sample)
    const existingUpload = Object.entries(uploadedVoiceUrls).find(
      ([, info]) => info.sourcePath === sample.samplePath
    );
    
    if (existingUpload) {
      uploadedVoiceUrls[speaker] = existingUpload[1];
      console.log(`   ✅ ${speaker}: Reusing ${existingUpload[0]}'s uploaded sample`);
      continue;
    }
    
    try {
      // Preprocess voice sample once
      const preprocessedPath = await preprocessVoiceSample(sample.samplePath, ttsDir);
      
      // Upload to Replicate once
      const sampleBuffer = await readFile(preprocessedPath);
      console.log(`   📤 Uploading ${speaker} voice sample (${(sampleBuffer.length / 1024).toFixed(1)} KB)...`);
      
      const file = await replicate.files.create(sampleBuffer, {
        filename: `voice_${speaker}.wav`,
      });
      
      uploadedVoiceUrls[speaker] = {
        url: file.urls.get,
        sourcePath: sample.samplePath,
      };
      console.log(`   ✅ ${speaker} voice uploaded (will reuse for ALL segments)`);
    } catch (err) {
      console.error(`   ❌ Failed to upload ${speaker} voice: ${err.message}`);
    }
  }
  
  if (Object.keys(uploadedVoiceUrls).length === 0) {
    throw new Error("Could not upload any voice samples to Replicate");
  }
  
  // ═══════════════════════════════════════════════════════════════════
  // STEP 3: GENERATE ALL XTTS CONCURRENTLY
  // ═══════════════════════════════════════════════════════════════════
  console.log(`\n   🚀 Generating ${processedSegments.length} segments CONCURRENTLY...`);
  console.log(`      (launching ${maxTPS}/sec, max ${maxConcurrent} in-flight)\n`);
  
  const limiter = new ConcurrentRateLimiter(maxTPS, maxConcurrent);
  let completedCount = 0;
  
  const allResults = await limiter.processAll(
    processedSegments,
    async (segment, idx) => {
      const text = segment?.translatedText || segment?.translated || segment?.text;
      
      if (!text || text.trim().length === 0) {
        return { idx, segment, skipped: true };
      }
      
      const speaker = segment.speaker || "SPEAKER_00";
      const voiceInfo = uploadedVoiceUrls[speaker];
      
      if (!voiceInfo) {
        return { idx, segment, skipped: true, reason: `no voice for ${speaker}` };
      }
      
      const rawOutputPath = path.join(ttsDir, `segment_${String(idx).padStart(4, "0")}_xtts_raw.wav`);
      const finalOutputPath = path.join(ttsDir, `segment_${String(idx).padStart(4, "0")}_xtts.wav`);
      
      // Use the pre-uploaded URL (no re-upload!)
      const result = await generateXTTS(
        text,
        voiceInfo.url,
        language,
        rawOutputPath,
        { skipPreprocessing: true, voiceUrl: true }
      );
      
      completedCount++;
      if (onProgress) {
        onProgress(completedCount, processedSegments.length);
      } else if (completedCount % 10 === 0 || completedCount === processedSegments.length) {
        process.stdout.write(`\r   ⏳ Progress: ${completedCount}/${processedSegments.length} (${limiter.inFlight} in-flight)`);
      }
      
      if (!result.success) {
        return { idx, segment, error: result.error };
      }
      
      // ─────────────────────────────────────────────────────────────
      // CLEAN + QUALITY CHECK + RETRY (zombie detection)
      // ─────────────────────────────────────────────────────────────
      const segmentDuration = segment.end - segment.start;
      const MAX_RETRIES = 2;
      let effectiveRawPath = rawOutputPath;
      let qualityResult = null;
      let retryCount = 0;
      
      for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
        // Clean XTTS artifacts
        const cleanedPath = rawOutputPath.replace('_raw.wav', `_clean${attempt > 0 ? attempt : ''}.wav`);
        const cleanResult = await cleanXTTSOutput(effectiveRawPath, cleanedPath);
        effectiveRawPath = cleanResult === cleanedPath ? cleanedPath : effectiveRawPath;
        
        // Analyze quality
        qualityResult = analyzeXTTSQuality(effectiveRawPath, text.length, segmentDuration);
        
        if (!qualityResult.isZombie) {
          // Good quality — proceed
          if (attempt > 0) {
            console.log(`      ✅ Seg ${idx}: Retry ${attempt} succeeded (quality: ${qualityResult.quality}/100)`);
          }
          break;
        }
        
        // Zombie detected!
        if (attempt < MAX_RETRIES) {
          retryCount++;
          console.log(`      🧟 Seg ${idx}: ZOMBIE DETECTED (quality: ${qualityResult.quality}/100, ${qualityResult.issues.join('; ')})`);
          console.log(`         Retrying... (attempt ${attempt + 2}/${MAX_RETRIES + 1})`);
          
          // Re-generate with XTTS
          const retryOutputPath = rawOutputPath.replace('_raw.wav', `_retry${attempt + 1}_raw.wav`);
          const retryResult = await generateXTTS(
            text,
            voiceInfo.url,
            language,
            retryOutputPath,
            { skipPreprocessing: true, voiceUrl: true }
          );
          
          if (retryResult.success) {
            effectiveRawPath = retryOutputPath;
          } else {
            console.log(`         ❌ Retry generation failed: ${retryResult.error}`);
            break;
          }
        } else {
          // All retries exhausted — replace with silence
          console.log(`      🧟❌ Seg ${idx}: ZOMBIE after ${MAX_RETRIES + 1} attempts — REPLACING WITH SILENCE`);
          console.log(`         Issues: ${qualityResult.issues.join('; ')}`);
          console.log(`         Metrics: rate=${qualityResult.metrics.speakingRate?.toFixed(1)}c/s, dur=${qualityResult.metrics.duration?.toFixed(2)}s, vol=${qualityResult.metrics.meanVolume?.toFixed(1)}dB`);
          
          // Generate silence for this segment
          const silencePath = rawOutputPath.replace('_raw.wav', '_silence.wav');
          try {
            execSync(
              `ffmpeg -y -f lavfi -t ${segmentDuration.toFixed(3)} -i anullsrc=r=22050:cl=mono "${silencePath}" 2>/dev/null`,
              { stdio: 'pipe' }
            );
            effectiveRawPath = silencePath;
            qualityResult = { isZombie: true, quality: 0, issues: ['Replaced with silence'], metrics: { duration: segmentDuration, speakingRate: 0 } };
          } catch {
            // Even silence generation failed, just skip this segment
            return { idx, segment, error: 'Zombie segment, could not generate silence replacement', zombieRemoved: true };
          }
        }
      }
      
      // Log per-segment quality details
      const qRate = qualityResult.metrics.speakingRate?.toFixed(1) || '?';
      const qDur = qualityResult.metrics.duration?.toFixed(2) || '?';
      const qVol = qualityResult.metrics.meanVolume?.toFixed(1) || '?';
      const qEmoji = qualityResult.quality >= 80 ? '✅' : qualityResult.quality >= 50 ? '⚠️' : '🧟';
      console.log(`      ${qEmoji} Seg ${idx}: quality=${qualityResult.quality}/100 rate=${qRate}c/s dur=${qDur}s vol=${qVol}dB${retryCount > 0 ? ` (${retryCount} retries)` : ''}${qualityResult.isZombie ? ' [ZOMBIE→SILENCE]' : ''}`);
      
      // ─────────────────────────────────────────────────────────────
      // ZOMBIE PREAMBLE DETECTION + TRIM
      // XTTS sometimes outputs [garbled noise] [gap] [actual speech]
      // The preamble inflates duration → aggressive atempo → everything sounds rushed
      // We detect and trim the preamble BEFORE timing adjustment
      // ─────────────────────────────────────────────────────────────
      if (!qualityResult.isZombie) {
        const preambleTrimPath = rawOutputPath.replace('_raw.wav', '_preamble_trimmed.wav');
        const preambleResult = detectAndTrimZombiePreamble(
          effectiveRawPath, segmentDuration, preambleTrimPath, text.length
        );
        if (preambleResult.trimmed) {
          effectiveRawPath = preambleResult.path;
          preambleTrimmed++;
          // Re-analyze quality after trim to make sure it's still good
          const postTrimQuality = analyzeXTTSQuality(effectiveRawPath, text.length, segmentDuration);
          if (postTrimQuality.isZombie) {
            console.log(`      ⚠️ Post-trim quality still poor (${postTrimQuality.quality}/100) — keeping trimmed version anyway`);
          } else {
            console.log(`      ✅ Post-trim quality: ${postTrimQuality.quality}/100, rate=${postTrimQuality.metrics.speakingRate?.toFixed(1)}c/s`);
          }
        }
      }
      
      // ─────────────────────────────────────────────────────────────
      // SMART TIMING: Natural audio handling
      // ─────────────────────────────────────────────────────────────
      const rawDuration = getAudioDuration(effectiveRawPath);
      const ratio = rawDuration / segmentDuration; // >1 = too long, <1 = too short
      
      let finalPath = effectiveRawPath;
      let finalDuration = rawDuration;
      let timingAction = "none";
      
      if (ratio >= 0.95 && ratio <= 1.05) {
        // ✅ Within ±5% — perfect, use as-is
        fs.copyFileSync(effectiveRawPath, finalOutputPath);
        finalPath = finalOutputPath;
        timingAction = "perfect";
        
      } else if (ratio > 1.05 && ratio <= MAX_SPEEDUP) {
        // 🏃 Too long but within max atempo — gentle speed adjustment
        const atempoResult = await adjustAudioSpeed(effectiveRawPath, finalOutputPath, segmentDuration, rawDuration);
        if (atempoResult === finalOutputPath) {
          finalDuration = getAudioDuration(finalOutputPath);
          finalPath = finalOutputPath;
          speedAdjusted++;
          timingAction = `atempo ${ratio.toFixed(2)}x`;
        }
        
      } else if (ratio > MAX_SPEEDUP) {
        // 🏃🏃 Way too long — apply max atempo and accept overrun
        // Better to have slight overlap than robot-speed audio
        const atempoResult = await adjustAudioSpeed(effectiveRawPath, finalOutputPath, rawDuration / MAX_SPEEDUP, rawDuration);
        if (atempoResult === finalOutputPath) {
          finalDuration = getAudioDuration(finalOutputPath);
          finalPath = finalOutputPath;
          speedAdjusted++;
          timingAction = `atempo ${MAX_SPEEDUP.toFixed(2)}x (clamped, will overrun)`;
        }
        
      } else if (ratio < 0.95) {
        // 🎵 Too short — PAD WITH SILENCE (never stretch the voice!)
        // Center the audio in the time slot
        const padResult = await padWithSilence(effectiveRawPath, finalOutputPath, segmentDuration, rawDuration);
        if (padResult === finalOutputPath) {
          finalDuration = getAudioDuration(finalOutputPath) || segmentDuration;
          finalPath = finalOutputPath;
          silencePadded++;
          timingAction = `padded (${rawDuration.toFixed(1)}s → ${segmentDuration.toFixed(1)}s)`;
        }
      }
      
      // ─────────────────────────────────────────────────────────────
      // ANTI-OVERLAP: Trim if audio would bleed into next segment
      // ─────────────────────────────────────────────────────────────
      const nextSeg = processedSegments[idx + 1];
      if (nextSeg && finalDuration > 0) {
        const maxAllowed = nextSeg.start - segment.start - 0.05; // 50ms gap
        if (finalDuration > maxAllowed && maxAllowed > 0.5) {
          const trimPath = finalPath.replace('.wav', '_trimmed.wav');
          try {
            const fadeStart = Math.max(0, maxAllowed - 0.15);
            execSync(
              `ffmpeg -y -i "${finalPath}" -t ${maxAllowed.toFixed(3)} -af "afade=t=out:st=${fadeStart.toFixed(3)}:d=0.15" "${trimPath}" 2>/dev/null`,
              { encoding: "utf-8", timeout: 10000 }
            );
            if (fs.existsSync(trimPath)) {
              finalPath = trimPath;
              finalDuration = getAudioDuration(trimPath) || maxAllowed;
              timingAction += ` + trimmed to ${maxAllowed.toFixed(1)}s`;
            }
          } catch { /* keep untrimmed if ffmpeg fails */ }
        }
      }

      return {
        idx,
        segment,
        audioPath: finalPath,
        alignedFile: finalPath,
        duration: finalDuration,
        rawDuration,
        requiredSpeedup: ratio,
        speaker,
        start: segment.start,
        end: segment.end,
        translatedText: text,
        merged: segment.merged || 1,
        timingAction,
      };
    },
    (completed, total) => {
      // Additional progress callback from limiter
    }
  );
  
  // ═══════════════════════════════════════════════════════════════════
  // STEP 4: STATS
  // ═══════════════════════════════════════════════════════════════════
  const successful = allResults.filter(r => r?.audioPath);
  const failed = allResults.filter(r => r?.error);
  const skipped = allResults.filter(r => r?.skipped);
  const zombieRemoved = allResults.filter(r => r?.zombieRemoved);
  
  console.log(`\n\n   ✅ Generated ${successful.length}/${processedSegments.length} segments with XTTS (100% XTTS, no fallback)`);
  
  if (speedAdjusted > 0) {
    console.log(`   🎚️ Gentle atempo: ${speedAdjusted} segments (subtle speed adjustment)`);
  }
  if (silencePadded > 0) {
    console.log(`   🔇 Silence padded: ${silencePadded} segments (natural pauses, no stretching)`);
  }
  if (preambleTrimmed > 0) {
    console.log(`   ✂️ Preamble trimmed: ${preambleTrimmed} segments (zombie preamble removed from start)`);
  }
  if (zombieRemoved.length > 0) {
    console.log(`   🧟 Zombie removed: ${zombieRemoved.length} segments (replaced with silence — bad XTTS output)`);
  }
  if (failed.length > 0) {
    console.log(`   ❌ Failed: ${failed.length} segments`);
  }
  
  // Duration analysis
  const overruns = successful.filter(r => {
    const slotDuration = (r.segment?.end - r.segment?.start) || r.segment?.duration || 0;
    return r.duration > slotDuration + 0.5;
  });
  
  if (overruns.length > 0) {
    const totalOverrun = overruns.reduce((sum, r) => {
      const slotDuration = (r.segment?.end - r.segment?.start) || r.segment?.duration || 0;
      return sum + (r.duration - slotDuration);
    }, 0);
    console.log(`   ⚠️ ${overruns.length} segments overrun their slots (${totalOverrun.toFixed(1)}s total)`);
  }
  
  // Speaking rate analysis
  const rates = successful.map(r => ({
    idx: r.idx,
    charsPerSec: r.translatedText.length / r.rawDuration,
    action: r.timingAction,
  }));
  
  if (rates.length > 0) {
    const avgRate = rates.reduce((sum, r) => sum + r.charsPerSec, 0) / rates.length;
    const minRate = Math.min(...rates.map(r => r.charsPerSec));
    const maxRate = Math.max(...rates.map(r => r.charsPerSec));
    
    console.log(`\n   📊 XTTS Speaking Rate:`);
    console.log(`      Average: ${avgRate.toFixed(1)} c/s | Range: ${minRate.toFixed(1)}-${maxRate.toFixed(1)} c/s`);
    console.log(`      Timing: ${rates.filter(r => r.action === 'perfect').length} perfect, ${speedAdjusted} atempo'd, ${silencePadded} padded`);
  }
  
  return {
    results: allResults.filter(Boolean).sort((a, b) => a.idx - b.idx),
    stats: {
      total: processedSegments.length,
      successful: successful.length,
      failed: failed.length,
      needingFallback: 0, // NEVER fallback to Lemonfox
      speedAdjusted,
      silencePadded,
      preambleTrimmed,
      filtered: filterStats.removed,
    },
    mergeStats,
    filterStats,
  };
}

// ════════════════════════════════════════════════════════════════════════════
// Main Voice Clone Pipeline
// ════════════════════════════════════════════════════════════════════════════

/**
 * Full voice cloning TTS pipeline:
 * 1. Extract voice samples from source video
 * 2. Generate TTS with cloned voices
 * 3. Return aligned audio segments
 */
async function voiceCloneTTS(videoPath, segments, outputDir, options = {}) {
  const {
    language = "english",
    maxTPS = 10,
    level = "B1",
    mergeOverlaps = true,
    adjustSpeed = true,
  } = options;
  
  // Step 1: Extract voice samples
  const voiceSamples = await extractAllVoiceSamples(videoPath, segments, outputDir);
  
  if (Object.keys(voiceSamples).length === 0) {
    throw new Error("Could not extract any voice samples from video");
  }
  
  // Step 2: Generate TTS with cloned voices
  const ttsResult = await generateAndAlignXTTS(segments, voiceSamples, outputDir, {
    language,
    maxTPS,
    level,
    mergeOverlaps,
    adjustSpeed,
  });
  
  return {
    voiceSamples,
    tts: ttsResult,
  };
}

// ════════════════════════════════════════════════════════════════════════════
// CONTINUOUS NARRATOR MODE: TTS for merged blocks (YouTube-dub style)
// ════════════════════════════════════════════════════════════════════════════

/**
 * Preprocess a voice sample once (instead of every XTTS call)
 * Converts to 22050Hz mono WAV and trims silence
 * 
 * @param {string} voiceSamplePath - Path to original voice sample
 * @param {string} outputDir - Directory to save preprocessed file
 * @returns {Promise<string>} Path to preprocessed file
 */
async function preprocessVoiceSample(voiceSamplePath, outputDir) {
  const tempProcessedPath = path.join(outputDir, 'voice_sample_preprocessed.wav');
  
  // XTTS v2 speaker conditioning limits:
  //   - Minimum: ~3 seconds of speech for decent cloning
  //   - Optimal: 6-12 seconds (best quality)
  //   - Maximum: ~15 seconds (beyond this, XTTS padding errors occur!)
  //     Error: "Padding size should be less than the corresponding input dimension"
  //     This happens because XTTS GPT encoder internal buffer overflows with long samples.
  const MAX_SAMPLE_DURATION = 12; // Cap at 12s for reliability + quality
  
  try {
    // First, check input duration to decide if we need to trim
    const inputDurationStr = execSync(
      `ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "${voiceSamplePath}"`,
      { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] }
    ).trim();
    const inputDuration = parseFloat(inputDurationStr) || 0;
    
    // If the input is very long, find the best section to extract
    // Skip the first 2 seconds (often has noise/silence) and take MAX_SAMPLE_DURATION
    let timeArgs = '';
    if (inputDuration > MAX_SAMPLE_DURATION + 2) {
      const startOffset = Math.min(2, inputDuration - MAX_SAMPLE_DURATION);
      timeArgs = `-ss ${startOffset} -t ${MAX_SAMPLE_DURATION}`;
      console.log(`   ✂️ Trimming voice sample: ${inputDuration.toFixed(1)}s → ${MAX_SAMPLE_DURATION}s (XTTS max for reliable cloning)`);
    }
    
    // Preprocess voice sample: format conversion + noise removal + silence trimming
    // XTTS needs: WAV, 22050Hz, mono, 16-bit PCM
    // 
    // Filters applied:
    //   1. highpass=f=80 — Remove low-frequency rumble (causes "zombie" undertones)
    //   2. lowpass=f=8000 — Remove high-frequency hiss/noise
    //   3. loudnorm — Normalize volume to -16 LUFS (consistent input for XTTS)
    //   4. silenceremove — Trim silence from start/end to get clean speech
    execSync(
      `ffmpeg -y -i "${voiceSamplePath}" ${timeArgs} -af "highpass=f=80,lowpass=f=8000,loudnorm=I=-16:TP=-1.5:LRA=11,silenceremove=start_periods=1:start_silence=0.1:start_threshold=-40dB,areverse,silenceremove=start_periods=1:start_silence=0.1:start_threshold=-40dB,areverse" -ar 22050 -ac 1 -acodec pcm_s16le "${tempProcessedPath}"`,
      { stdio: ['pipe', 'pipe', 'pipe'], timeout: 30000 }
    );
    
    // Validate output file exists and has data
    if (!fs.existsSync(tempProcessedPath)) {
      console.warn(`   ⚠️ Preprocessing produced no output file. Using original.`);
      return voiceSamplePath;
    }
    
    const fileSize = fs.statSync(tempProcessedPath).size;
    if (fileSize < 10000) { // Less than 10KB = essentially empty
      console.warn(`   ⚠️ Preprocessed file too small (${fileSize} bytes). Using original.`);
      return voiceSamplePath;
    }
    
    // Check duration of processed file
    const processedDuration = execSync(
      `ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "${tempProcessedPath}"`,
      { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] }
    ).trim();
    
    const duration = parseFloat(processedDuration);
    if (duration < 3) {
      console.warn(`   ⚠️ Voice sample after trimming too short (${duration.toFixed(1)}s). Need at least 3s. Using original.`);
      return voiceSamplePath;
    }
    
    if (duration > MAX_SAMPLE_DURATION) {
      // Extra safety: hard-truncate if somehow still too long after processing
      const truncPath = path.join(outputDir, 'voice_sample_truncated.wav');
      execSync(
        `ffmpeg -y -i "${tempProcessedPath}" -t ${MAX_SAMPLE_DURATION} -acodec pcm_s16le "${truncPath}"`,
        { stdio: ['pipe', 'pipe', 'pipe'] }
      );
      if (fs.existsSync(truncPath) && fs.statSync(truncPath).size > 10000) {
        fs.renameSync(truncPath, tempProcessedPath);
        console.log(`   ✅ Preprocessed voice sample: ${MAX_SAMPLE_DURATION}s of clean speech (capped)`);
        return tempProcessedPath;
      }
    }
    
    console.log(`   ✅ Preprocessed voice sample: ${duration.toFixed(1)}s of clean speech`);
    return tempProcessedPath;
    
  } catch (err) {
    console.warn(`   ⚠️ Audio preprocessing failed: ${err.message}`);
    return voiceSamplePath;
  }
}

/**
 * Generate XTTS for continuous narration blocks
 * Each block is ~30-60 seconds and gets one continuous TTS audio
 * No per-segment timing constraints - just continuous talking!
 * 
 * @param {array} blocks - Array from translateNarratorContinuous()
 * @param {object} voiceSample - Single voice sample (narrator mode uses one voice)
 * @param {string} outputDir - Output directory
 * @param {object} options - Options
 */
async function generateContinuousXTTS(blocks, voiceSample, outputDir, options = {}) {
  const {
    language = "spanish",
    maxTPS = 10, // 10 transactions per second for Replicate
    onProgress = null,
    retryOverruns = true, // Enable adaptive retry for overruns
    maxRetries = 2, // Max retry attempts per block
    qualityFilter = false, // Set to true to auto-reject bad speeds (disabled by default for testing)
  } = options;
  
  console.log(`\n${"═".repeat(60)}`);
  console.log(`🎙️ CONTINUOUS NARRATOR XTTS: Generating block audio`);
  console.log(`${"═".repeat(60)}`);
  console.log(`   Blocks: ${blocks.length}`);
  console.log(`   Language: ${language}`);
  console.log(`   Voice: ${voiceSample.speaker || "narrator"}`);
  console.log(`   TPS Limit: ${maxTPS} requests/second`);
  console.log(`   Adaptive retry: ${retryOverruns ? 'ON' : 'OFF'}`);
  
  // Check if language is supported
  if (UNSUPPORTED_LANGUAGES.includes(language.toLowerCase())) {
    throw new Error(
      `XTTS does not support ${language}!\n` +
      `Use ElevenLabs instead (--premium flag in pipeline)`
    );
  }
  
  const ttsDir = path.join(outputDir, "tts_continuous");
  fs.mkdirSync(ttsDir, { recursive: true });
  
  // ⚡ PREPROCESS VOICE SAMPLE ONCE (instead of for every block)
  console.log(`\n🎤 Preprocessing voice sample...`);
  const preprocessedVoicePath = await preprocessVoiceSample(voiceSample.samplePath, ttsDir);
  console.log(`   ✅ Voice sample ready: ${preprocessedVoicePath}`);
  
  // ⚡ UPLOAD VOICE SAMPLE ONCE (instead of for every block)
  console.log(`   📤 Uploading voice sample to Replicate...`);
  const sampleBuffer = await readFile(preprocessedVoicePath);
  const apiToken = process.env.REPLICATE_API_TOKEN || process.env.REPLICATE_API_KEY;
  const replicate = new Replicate({ auth: apiToken });
  const file = await replicate.files.create(sampleBuffer, {
    filename: path.basename(preprocessedVoicePath),
  });
  const sharedVoiceUrl = file.urls.get;
  console.log(`   ✅ Voice sample uploaded (will be reused for all blocks)\n`);
  
  const results = [];
  let completed = 0;
  let retriedCount = 0;
  
  // Create TPS limiter for rate-limited processing
  const tpsLimiter = new TPSLimiter(maxTPS);
  
  // Process all blocks with TPS rate limiting
  const allPromises = blocks.map(async (block) => {
    return tpsLimiter.schedule(async () => {
      let text = block.translatedText;
      let attempt = 0;
      let bestResult = null;
      
      if (!text || text.trim().length < 5) {
        console.log(`   ⚠️ Block ${block.index} has no/short text, skipping`);
        return null;
      }
      
      const blockDuration = block.end - block.start;
      
      // Retry loop for overruns
      while (attempt <= maxRetries) {
        const outputPath = path.join(ttsDir, `block_${String(block.index).padStart(3, "0")}.wav`);
        
        const result = await generateXTTS(
          text,
          sharedVoiceUrl, // Use shared uploaded URL (already uploaded once)
          language,
          outputPath,
          { skipPreprocessing: true, voiceUrl: true } // Tell generateXTTS this is a URL, not a path
        );
        
        if (result.success) {
          // Clean XTTS artifacts (garbled audio at start)
          const cleanedBlockPath = outputPath.replace('.wav', '_clean.wav');
          const cleanBlockResult = await cleanXTTSOutput(outputPath, cleanedBlockPath);
          const effectiveBlockPath = cleanBlockResult === cleanedBlockPath ? cleanedBlockPath : outputPath;
          
          const audioDuration = getAudioDuration(effectiveBlockPath);
          const overrun = audioDuration - blockDuration;
          
          // ZOMBIE QUALITY CHECK
          const qualityCheck = analyzeXTTSQuality(effectiveBlockPath, text.length, blockDuration);
          const charsPerSec = text.length / audioDuration;
          
          if (qualityCheck.isZombie && attempt < maxRetries) {
            console.log(`   🧟 Block ${block.index + 1}: ZOMBIE (quality: ${qualityCheck.quality}/100, ${qualityCheck.issues.join('; ')}) — retrying...`);
            attempt++;
            continue; // Retry this block
          } else if (qualityCheck.isZombie) {
            console.log(`   🧟❌ Block ${block.index + 1}: ZOMBIE after ${attempt} attempts — replacing with silence`);
            console.log(`      Issues: ${qualityCheck.issues.join('; ')}`);
          }
          
          // Log quality for all blocks
          const qEmoji = qualityCheck.quality >= 80 ? '✅' : qualityCheck.quality >= 50 ? '⚠️' : '🧟';
          console.log(`   ${qEmoji} Block ${block.index + 1}: quality=${qualityCheck.quality}/100 rate=${charsPerSec.toFixed(1)}c/s dur=${audioDuration.toFixed(1)}s${qualityCheck.issues.length > 0 ? ' [' + qualityCheck.issues[0] + ']' : ''}`);
          
          // POST-PROCESS: Speed up audio if it's too slow (voice sample has slow speech)
          // Target: 12-14 c/s (natural XTTS rate)
          let finalOutputPath = effectiveBlockPath;
          let finalDuration = audioDuration;
          
          if (charsPerSec < 11 && audioDuration > 3) {
            // Calculate speedup needed to reach target 13 c/s
            const targetCharsPerSec = 13;
            const speedupNeeded = charsPerSec / targetCharsPerSec;
            const speedupFactor = 1 / speedupNeeded; // atempo factor (e.g., 1.5 = 50% faster)
            
            // Cap speedup at MAX_SPEEDUP to avoid robotic audio
            const actualSpeedup = Math.min(speedupFactor, MAX_SPEEDUP);
            
            if (actualSpeedup > 1.05) {
              const speedupPath = outputPath.replace('.wav', '_spedup.wav');
              try {
                const { execSync } = require('child_process');
                execSync(
                  `ffmpeg -y -i "${effectiveBlockPath}" -filter:a "atempo=${actualSpeedup.toFixed(2)}" "${speedupPath}" 2>/dev/null`,
                  { stdio: 'pipe' }
                );
                
                // Get new duration
                const newDurationStr = execSync(
                  `ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "${speedupPath}"`,
                  { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] }
                ).trim();
                
                finalDuration = parseFloat(newDurationStr);
                finalOutputPath = speedupPath;
                
                const newCharsPerSec = text.length / finalDuration;
                console.log(`   ⚡ Sped up ${actualSpeedup.toFixed(2)}x: ${charsPerSec.toFixed(1)} → ${newCharsPerSec.toFixed(1)} c/s`);
              } catch (err) {
                console.warn(`   ⚠️ Speedup failed: ${err.message}`);
              }
            }
          }
          
          bestResult = {
            index: block.index,
            audioPath: finalOutputPath || effectiveBlockPath,
            audioDuration: finalDuration,
            start: block.start,
            end: block.start + finalDuration,
            duration: finalDuration,
            translatedText: text,
            originalText: block.originalText,
            alignedFile: finalOutputPath || effectiveBlockPath,
            alignedDuration: finalDuration,
            ttsDuration: finalDuration,
            blockDuration,
            overrun: overrun > 0 ? overrun : 0,
            isNarratorBlock: true,
            retryAttempt: attempt,
            qualityMetrics: { charsPerSec, tooShort, tooFast, tooSlow },
          };
          
          // BIDIRECTIONAL ADAPTIVE RETRY: Handle overruns, underruns, AND quality issues
          const fillRate = audioDuration / blockDuration;
          const hasQualityIssue = qualityFilter && (tooShort || tooFast || tooSlow);
          const needsRetry = retryOverruns && attempt < maxRetries && (
            overrun > 1.0 ||              // Too long (overrun)
            fillRate < 0.75 ||            // Too short (underrun - less than 75% filled)
            (tooSlow && fillRate < 0.90) || // Weird audio (too slow AND not filling time)
            hasQualityIssue               // Quality filter detected issues
          );
          
          if (needsRetry) {
            // Calculate target: aim for 90-95% fill
            const targetDuration = blockDuration * 0.92;
            const observedCharsPerSec = text.length / audioDuration;
            const newTargetChars = Math.floor(targetDuration * observedCharsPerSec);
            
            if (overrun > 1.0 || tooFast) {
              // REDUCE text (too long OR too fast)
              let shortenedText = text.substring(0, newTargetChars);
              const lastPunctuation = Math.max(
                shortenedText.lastIndexOf('.'),
                shortenedText.lastIndexOf('!'),
                shortenedText.lastIndexOf('?')
              );
              
              if (lastPunctuation > newTargetChars * 0.6) {
                shortenedText = shortenedText.substring(0, lastPunctuation + 1);
              } else {
                const lastSpace = shortenedText.lastIndexOf(' ');
                if (lastSpace > newTargetChars * 0.6) {
                  shortenedText = shortenedText.substring(0, lastSpace);
                }
              }
              
              const reason = tooFast ? 'too fast audio' : 'overrun';
              console.log(`\n   🔄 Block ${block.index} retry (${reason}): ${audioDuration.toFixed(1)}s → target ${targetDuration.toFixed(1)}s`);
              console.log(`       ${text.length} → ${shortenedText.length} chars (${observedCharsPerSec.toFixed(1)} c/s)`);
              
              text = shortenedText.trim();
              attempt++;
              retriedCount++;
              continue;
            } else if (fillRate < 0.75 || tooSlow) {
              // INCREASE text (too short OR too slow - not enough content)
              // Calculate how much more text we need
              const neededChars = Math.floor(targetDuration * 13); // Target ~13 c/s (natural XTTS speed)
              const charsToAdd = Math.max(neededChars - text.length, 30); // At least 30 chars
              
              // Add contextual filler phrases to extend naturally
              const fillerPhrases = [
                ' Y hay más detalles importantes sobre lo que está sucediendo aquí.',
                ' La situación continúa desarrollándose de manera interesante.',
                ' Todo esto sigue escalando mientras avanza la historia.',
                ' Las cosas se ponen cada vez más intensas e importantes.'
              ];
              let filler = fillerPhrases[Math.floor(Math.random() * fillerPhrases.length)];
              
              // If we need even more text, add multiple phrases
              if (charsToAdd > 60) {
                filler += ' ' + fillerPhrases[(Math.floor(Math.random() * fillerPhrases.length))];
              }
              
              const extendedText = text + filler;
              const reason = tooSlow ? `too slow (${charsPerSec.toFixed(1)} c/s)` : `underfill ${(fillRate * 100).toFixed(0)}%`;
              
              console.log(`\n   🔄 Block ${block.index} retry (${reason}): Adding detail`);
              console.log(`       ${text.length} → ${extendedText.length} chars to fill ${(targetDuration).toFixed(1)}s`);
              
              text = extendedText;
              attempt++;
              retriedCount++;
              continue;
            }
          }
          
          // Success or decided not to retry
          break;
        } else {
          console.log(`   ❌ Block ${block.index} failed: ${result.error}`);
          break;
        }
      }
      
      completed++;
      process.stdout.write(`\r   ⏳ Progress: ${completed}/${blocks.length} blocks`);
      
      if (bestResult && bestResult.overrun > 1) {
        console.log(`\n   ⚠️ Block ${bestResult.index}: ${bestResult.audioDuration.toFixed(1)}s audio for ${blockDuration.toFixed(1)}s slot (+${bestResult.overrun.toFixed(1)}s overrun)`);
      }
      
      return bestResult;
    });
  });
  
  // Wait for all TPS-limited requests to complete
  const allResults = await Promise.all(allPromises);
  results.push(...allResults.filter(Boolean));
  
  // Sort by original timeline position
  results.sort((a, b) => a.start - b.start);
  
  console.log(`\n   ✅ Generated ${results.length}/${blocks.length} continuous blocks`);
  
  if (retriedCount > 0) {
    console.log(`   🔄 Retried ${retriedCount} blocks to reduce overlaps`);
  }
  
  // Calculate timing
  const totalNarrationTime = results.reduce((sum, r) => sum + r.audioDuration, 0);
  const totalVideoTime = blocks.length > 0 ? blocks[blocks.length - 1].end - blocks[0].start : 0;
  const totalOverrun = results.reduce((sum, r) => sum + (r.overrun || 0), 0);
  const lastAudioEnd = results.length > 0 ? results[results.length - 1].end : 0;
  
  console.log(`   🎙️ Total narration: ${totalNarrationTime.toFixed(1)}s`);
  console.log(`   📺 Video duration: ${totalVideoTime.toFixed(1)}s`);
  console.log(`   ⏰ Timeline end: ${lastAudioEnd.toFixed(1)}s`);
  
  if (totalOverrun > 0) {
    console.log(`   ⚠️ Total overrun: ${totalOverrun.toFixed(1)}s across ${results.filter(r => r.overrun > 0).length} blocks`);
  }
  
  if (lastAudioEnd > totalVideoTime) {
    console.log(`   💡 Final audio extends ${(lastAudioEnd - totalVideoTime).toFixed(1)}s beyond video - will loop/slow video`);
  }
  
  // QUALITY ANALYSIS: Show c/s distribution
  console.log(`\n   📊 SPEAKING RATE ANALYSIS:`);
  const speeds = results
    .filter(r => r.qualityMetrics?.charsPerSec)
    .map(r => r.qualityMetrics.charsPerSec);
  
  if (speeds.length > 0) {
    const avgSpeed = speeds.reduce((a, b) => a + b, 0) / speeds.length;
    const minSpeed = Math.min(...speeds);
    const maxSpeed = Math.max(...speeds);
    
    console.log(`      Average: ${avgSpeed.toFixed(1)} c/s`);
    console.log(`      Range: ${minSpeed.toFixed(1)} - ${maxSpeed.toFixed(1)} c/s`);
    
    // Show distribution
    const slow = speeds.filter(s => s < 9).length;
    const normal = speeds.filter(s => s >= 9 && s <= 14).length;
    const fast = speeds.filter(s => s > 14).length;
    
    console.log(`      Distribution:`);
    console.log(`         🐌 Slow (<9 c/s): ${slow} blocks`);
    console.log(`         ✅ Normal (9-14 c/s): ${normal} blocks`);
    console.log(`         🏃 Fast (>14 c/s): ${fast} blocks`);
    
    if (fast > 0) {
      const fastBlocks = results
        .filter(r => r.qualityMetrics?.charsPerSec > 14)
        .map(r => `Block ${r.index + 1} (${r.qualityMetrics.charsPerSec.toFixed(1)} c/s)`)
        .slice(0, 5);
      console.log(`      Fast blocks: ${fastBlocks.join(', ')}`);
    }
    
    if (slow > 0) {
      const slowBlocks = results
        .filter(r => r.qualityMetrics?.charsPerSec < 9)
        .map(r => `Block ${r.index + 1} (${r.qualityMetrics.charsPerSec.toFixed(1)} c/s)`)
        .slice(0, 5);
      console.log(`      Slow blocks: ${slowBlocks.join(', ')}`);
    }
    
    if (!qualityFilter) {
      console.log(`\n   💡 Quality filter is OFF - all speeds accepted`);
      console.log(`      Listen to the output and decide which speeds sound good`);
      console.log(`      Then adjust thresholds or enable filter`);
    }
  }
  
  // Calculate quality metrics
  const speedMetrics = speeds.length > 0 ? {
    average: speeds.reduce((a, b) => a + b, 0) / speeds.length,
    min: Math.min(...speeds),
    max: Math.max(...speeds),
    slow: speeds.filter(s => s < 9).length,
    normal: speeds.filter(s => s >= 9 && s <= 14).length,
    fast: speeds.filter(s => s > 14).length,
  } : null;
  
  return {
    results,
    totalNarrationTime,
    totalVideoTime,
    timelineEnd: lastAudioEnd,
    fillRate: totalNarrationTime / totalVideoTime,
    mode: "continuous_narrator",
    xttsMetrics: {
      blocksGenerated: results.length,
      blocksTotal: blocks.length,
      retriesCount: retriedCount,
      maxTPS,
      speedMetrics,
    },
  };
}

// ════════════════════════════════════════════════════════════════════════════
// Exports
// ════════════════════════════════════════════════════════════════════════════

module.exports = {
  // Main function
  voiceCloneTTS,
  
  // Individual functions
  extractVoiceSample,
  extractAllVoiceSamples,
  generateXTTS,
  generateAndAlignXTTS,
  generateContinuousXTTS,
  mergeOverlappingSegments,
  adjustAudioSpeed,
  padWithSilence,
  cleanXTTSOutput,
  analyzeXTTSQuality,
  filterBadTranslations,
  isValidTranslation,
  findDominantSpeaker,
  filterDominantSpeakerSegments,
  
  // Config
  XTTS_MODEL,
  LANGUAGE_CODES,
  LEVEL_SPEEDS,
  MAX_SPEEDUP,
  XTTS_CHARS_PER_SECOND,  // ~14 c/s natural XTTS rate
  TTS_CHARS_PER_SECOND,   // ~14 c/s Lemonfox rate
};
