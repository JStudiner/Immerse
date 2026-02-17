/**
 * Immersion v2 - Merge Module (FFmpeg)
 * 
 * Merges aligned TTS segments with background audio
 * Uses a streaming approach - no temp files, single FFmpeg pass
 * 
 * Strategy: Single-pass filter_complex with anullsrc silent anchor
 * Each segment uses adelay (no apad!) — ~10x faster than batched approach
 */

const fs = require("fs");
const path = require("path");
const { execSync, spawn } = require("child_process");

/**
 * Get audio duration using ffprobe
 */
function getAudioDuration(filePath) {
  try {
    const result = execSync(
      `ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "${filePath}"`,
      { encoding: "utf-8", timeout: 10000 }
    );
    return parseFloat(result.trim());
  } catch {
    return null;
  }
}

/**
 * Merge TTS segments with background audio - FAST version
 * 
 * Strategy: Use FFmpeg's adelay + amix in batches
 * Instead of creating 332 padded files, we:
 * 1. Process in batches of 50 segments
 * 2. Each batch creates one mixed track
 * 3. Final merge of batches + background
 * 
 * @param {string} backgroundPath - Path to background audio (from Demucs)
 * @param {array} segments - TTS segments with alignedFile and start time
 * @param {string} outputPath - Output path for merged audio
 * @param {object} options - Merge options
 * @returns {Promise<object>} Merge result
 */
async function merge(backgroundPath, segments, outputPath, options = {}) {
  const {
    backgroundVolume = 0.35,  // Reduced to 35% - background was too loud
    ttsVolume = 2.8,          // Increased to 280% - make voice much louder
    batchSize = 100,          // Process 100 segments per FFmpeg call (was 50)
    fadeInDuration = 0.04,    // 40ms fade-in - soft attack, sounds natural
    fadeOutDuration = 0.06,   // 60ms fade-out - gentle ending for each segment
    crossfadeDuration = 0.3,  // 300ms crossfade for overlapping segments
    maxOverlap = 5.0,         // Max overlap we'll crossfade (increased to 5s - allow more overlap than skip)
  } = options;

  console.log(`\n${"═".repeat(60)}`);
  console.log(`🎛️ MERGE: Combining TTS + Background (Fast Mode)`);
  console.log(`${"═".repeat(60)}`);

  const hasBackground = backgroundPath && fs.existsSync(backgroundPath);
  if (!hasBackground) {
    console.log(`   ⚠️ No background audio - will generate TTS-only output`);
  }

  // Filter segments: must have aligned TTS file (either XTTS, Lemonfox, or fallback)
  // Also validate each file is a real audio file (not corrupt/truncated)
  let corruptCount = 0;
  const validSegments = segments.filter(s => {
    if (!s.alignedFile || !fs.existsSync(s.alignedFile) || s.start === undefined) return false;
    // Check file size — anything under 2KB is almost certainly corrupt
    try {
      const stat = fs.statSync(s.alignedFile);
      if (stat.size < 2048) {
        corruptCount++;
        console.log(`      ⚠️ Skipping seg ${s.index}: corrupt file (${stat.size} bytes)`);
        return false;
      }
      // Quick ffprobe validation — can FFmpeg actually read this file?
      const dur = getAudioDuration(s.alignedFile);
      if (!dur || dur <= 0) {
        corruptCount++;
        console.log(`      ⚠️ Skipping seg ${s.index}: unreadable by FFmpeg`);
        return false;
      }
    } catch {
      corruptCount++;
      return false;
    }
    return true;
  }).sort((a, b) => a.start - b.start);
  
  if (corruptCount > 0) {
    console.log(`   ⚠️ Skipped ${corruptCount} corrupt/unreadable TTS files`);
  }
  
  // Count segments that used fallback TTS
  const fallbackCount = validSegments.filter(s => s.usedFallback).length;
  if (fallbackCount > 0) {
    console.log(`   🔄 ${fallbackCount} segments used Lemonfox fallback TTS`);
  }
  
  // Count segments using original audio (narrator-only mode)
  const usingOriginalCount = validSegments.filter(s => s.useOriginal).length;
  if (usingOriginalCount > 0) {
    console.log(`   🎙️ ${usingOriginalCount} segments will use original vocals (non-narrator)`);
  }

  // ═══════════════════════════════════════════════════════════════
  // OVERLAP DETECTION: Truncate overrunning segments to prevent
  // bleed-through into the next segment's timeslot
  // ═══════════════════════════════════════════════════════════════
  let truncatedCount = 0;
  
  const processedSegments = validSegments.map((seg, i) => {
    const ttsDuration = seg.alignedDuration || seg.ttsDuration || seg.duration || 3;
    const nextSeg = validSegments[i + 1];
    const nextSegStart = nextSeg?.start;
    
    // Calculate max allowed duration: must not bleed into next segment
    // Leave a 50ms gap so segments don't butt up against each other
    let maxAllowedDuration = ttsDuration;
    let wasTruncated = false;
    
    if (nextSegStart !== undefined) {
      const availableSlot = nextSegStart - seg.start - 0.05;
      if (ttsDuration > availableSlot && availableSlot > 0.5) {
        maxAllowedDuration = availableSlot;
        wasTruncated = true;
        truncatedCount++;
        const trimmed = ttsDuration - availableSlot;
        if (trimmed > 1) {
          console.log(`      ✂️ Seg ${seg.index || i}: trimmed ${trimmed.toFixed(1)}s to fit before next segment`);
        }
      }
    }
    
    return {
      ...seg,
      ttsDuration,
      maxDuration: maxAllowedDuration,
      wasTruncated,
    };
  });

  // ALL segments included
  const includedSegments = processedSegments;

  if (includedSegments.length === 0) {
    throw new Error(
      `No valid TTS segments to merge (${segments.length} total, ${corruptCount} corrupt). ` +
      `This may happen if the TTS API was overwhelmed by concurrent requests.`
    );
  }
  
  console.log(`   Background: ${hasBackground ? path.basename(backgroundPath) : "(none)"}`);
  console.log(`   TTS segments: ${includedSegments.length}${corruptCount > 0 ? ` (${corruptCount} skipped as corrupt)` : " (ALL included)"}`);
  
  if (truncatedCount > 0) {
    console.log(`   ✂️ Truncated ${truncatedCount} overrunning segments to prevent overlap`);
  }
  console.log(`   Batch size: ${batchSize}`);
  console.log(`   Background volume: ${(backgroundVolume * 100).toFixed(0)}%`);
  console.log(`   TTS volume: ${(ttsVolume * 100).toFixed(0)}%`);

  const totalDuration = hasBackground ? getAudioDuration(backgroundPath) : (options.totalDuration || 60);
  console.log(`   Total duration: ${totalDuration?.toFixed(1)}s`);

  const startTime = Date.now();
  const tempDir = path.dirname(outputPath);

  // ═══════════════════════════════════════════════════════════════
  // STRATEGY: Single-pass filter_complex with silent anchor track
  // Uses anullsrc as duration reference — eliminates apad overhead!
  // Old approach: apad every segment to full duration → 200×30min = 100hr of audio
  // New approach: anullsrc anchor + adelay only → 30min + 200×5s = ~47min of audio
  // Result: ~10x less data for FFmpeg to process
  // ═══════════════════════════════════════════════════════════════

  console.log(`\n   🎵 Single-pass merge (${includedSegments.length} segments)...`);

  const filterScriptPath = path.join(tempDir, "merge_filter.txt");
  let ttsComboPath = path.join(tempDir, "tts_combined.mp3");

  // Build filter_complex_script — written to file to avoid command-line length limits
  const filterLines = [];

  // Input 0: silent anchor track (defines output duration — no per-segment apad needed!)
  filterLines.push(`[0]atrim=duration=${totalDuration.toFixed(3)}[base]`);

  // Each segment: volume → truncate (if needed) → fades → adelay (NO apad!)
  for (let i = 0; i < includedSegments.length; i++) {
    const seg = includedSegments[i];
    const inputIdx = i + 1; // +1 because input 0 is anullsrc
    const delayMs = Math.round(seg.start * 1000);
    const rawDuration = seg.alignedDuration || seg.ttsDuration || seg.duration || 3;
    const effectiveDuration = seg.maxDuration || rawDuration;

    let chain = `[${inputIdx}]volume=${ttsVolume}`;

    // Overrunning segments: speed up to fit (never hard-clip mid-word)
    if (seg.wasTruncated && effectiveDuration < rawDuration) {
      const speedRatio = rawDuration / effectiveDuration; // e.g. 1.3 = need 30% speedup
      const MAX_MERGE_SPEEDUP = 1.8; // Cap at 1.8x — beyond this, hard-clip as last resort
      
      if (speedRatio <= MAX_MERGE_SPEEDUP) {
        // Speed up so words finish naturally — atempo range per filter is 0.5-2.0
        let remaining = speedRatio;
        while (remaining > 2.0) {
          chain += `,atempo=2.0`;
          remaining /= 2.0;
        }
        chain += `,atempo=${remaining.toFixed(4)}`;
      } else {
        // Extreme overrun (>1.8x) — speed up to max, then trim the tail with fade
        chain += `,atempo=${MAX_MERGE_SPEEDUP.toFixed(1)}`;
        const sped = rawDuration / MAX_MERGE_SPEEDUP;
        if (sped > effectiveDuration) {
          chain += `,atrim=end=${effectiveDuration.toFixed(3)}`;
          const trimFadeStart = Math.max(0, effectiveDuration - 0.20);
          chain += `,afade=t=out:st=${trimFadeStart.toFixed(3)}:d=0.20`;
        }
      }
      chain += `,afade=t=in:d=${fadeInDuration}`;
      const fadeOutStart = Math.max(0, effectiveDuration - fadeOutDuration);
      chain += `,afade=t=out:st=${fadeOutStart.toFixed(3)}:d=${fadeOutDuration}`;
    } else {
      chain += `,afade=t=in:d=${fadeInDuration}`;
      // Natural fade-out at the end (60ms)
      const fadeOutStart = Math.max(0, effectiveDuration - fadeOutDuration);
      chain += `,afade=t=out:st=${fadeOutStart.toFixed(3)}:d=${fadeOutDuration}`;
    }

    // adelay positions the segment — anullsrc anchor handles total duration
    chain += `,adelay=${delayMs}|${delayMs}[s${i}]`;
    filterLines.push(chain);
  }

  // Final amix: silent anchor + all segments → single output
  // duration=first: run for the duration of input 0 (the anullsrc anchor)
  // dropout_transition=0: no volume ramp when inputs end
  // normalize=0: raw sum (no division by active input count)
  const streamLabels = ["[base]"].concat(includedSegments.map((_, i) => `[s${i}]`));
  filterLines.push(`${streamLabels.join("")}amix=inputs=${includedSegments.length + 1}:duration=first:dropout_transition=0:normalize=0[out]`);

  // Write filter script to temp file (handles 200+ segment filter chains cleanly)
  fs.writeFileSync(filterScriptPath, filterLines.join(";\n"));

  // Build input list: anullsrc (silent anchor) + all TTS segment files
  const inputArgs = ['-f lavfi -i "anullsrc=channel_layout=stereo:sample_rate=44100"'];
  for (const seg of includedSegments) {
    inputArgs.push(`-i "${seg.alignedFile}"`);
  }

  try {
    console.log(`   ⚡ Running single-pass FFmpeg (${includedSegments.length + 1} inputs)...`);
    execSync(
      `ffmpeg -y -threads 0 ${inputArgs.join(" ")} -filter_complex_script "${filterScriptPath}" -map "[out]" -ar 44100 -ac 2 -b:a 192k -t ${totalDuration} "${ttsComboPath}"`,
      { encoding: "utf-8", timeout: 300000, maxBuffer: 50 * 1024 * 1024, stdio: ["pipe", "pipe", "pipe"] }
    );
    console.log(`   ✅ Single-pass merge complete`);
  } catch (e) {
    console.log(`\n   ⚠️ Single-pass merge failed: ${e.message.substring(0, 200)}`);
    console.log(`   🔄 Falling back to batched merge (still without apad)...`);

    // Fallback: same anullsrc approach but in smaller batches
    const batchOutputs = [];
    const fallbackBatchSize = 50;
    const totalBatches = Math.ceil(includedSegments.length / fallbackBatchSize);

    for (let b = 0; b < includedSegments.length; b += fallbackBatchSize) {
      const batch = includedSegments.slice(b, b + fallbackBatchSize);
      const batchIdx = Math.floor(b / fallbackBatchSize);
      const batchPath = path.join(tempDir, `batch_${batchIdx.toString().padStart(3, "0")}.mp3`);

      process.stdout.write(`\r   📦 Batch ${batchIdx + 1}/${totalBatches} (${batch.length} segments)...`);

      // Build per-batch filter with anullsrc anchor (same approach, fewer inputs)
      const batchFilterLines = [];
      batchFilterLines.push(`[0]atrim=duration=${totalDuration.toFixed(3)}[base]`);

      for (let i = 0; i < batch.length; i++) {
        const seg = batch[i];
        const delayMs = Math.round(seg.start * 1000);
        const rawDur = seg.alignedDuration || seg.ttsDuration || seg.duration || 3;
        const effectiveDur = seg.maxDuration || rawDur;
        let chain = `[${i + 1}]volume=${ttsVolume}`;
        if (seg.wasTruncated && effectiveDur < rawDur) {
          chain += `,atrim=end=${effectiveDur.toFixed(3)}`;
          chain += `,afade=t=out:st=${Math.max(0, effectiveDur - 0.15).toFixed(3)}:d=0.15`;
          chain += `,afade=t=in:d=${fadeInDuration}`;
        } else {
          chain += `,afade=t=in:d=${fadeInDuration}`;
          chain += `,afade=t=out:st=${Math.max(0, effectiveDur - fadeOutDuration).toFixed(3)}:d=${fadeOutDuration}`;
        }
        chain += `,adelay=${delayMs}|${delayMs}[s${i}]`;
        batchFilterLines.push(chain);
      }

      const batchLabels = ["[base]"].concat(batch.map((_, i) => `[s${i}]`));
      batchFilterLines.push(`${batchLabels.join("")}amix=inputs=${batch.length + 1}:duration=first:dropout_transition=0:normalize=0[out]`);

      const batchFilterPath = path.join(tempDir, `batch_filter_${batchIdx}.txt`);
      fs.writeFileSync(batchFilterPath, batchFilterLines.join(";\n"));

      const batchInputArgs = ['-f lavfi -i "anullsrc=channel_layout=stereo:sample_rate=44100"'];
      for (const seg of batch) {
        batchInputArgs.push(`-i "${seg.alignedFile}"`);
      }

      try {
        execSync(
          `ffmpeg -y -threads 0 ${batchInputArgs.join(" ")} -filter_complex_script "${batchFilterPath}" -map "[out]" -ar 44100 -ac 2 -b:a 192k -t ${totalDuration} "${batchPath}"`,
          { encoding: "utf-8", timeout: 180000, maxBuffer: 50 * 1024 * 1024, stdio: ["pipe", "pipe", "pipe"] }
        );
        batchOutputs.push(batchPath);
      } catch (batchErr) {
        console.log(`\n      ⚠️ Batch ${batchIdx} failed: ${batchErr.message.substring(0, 100)}`);
      }
      try { fs.unlinkSync(batchFilterPath); } catch {}
    }

    console.log("");

    // Merge batch outputs (each is already full-duration thanks to anullsrc)
    if (batchOutputs.length === 1) {
      fs.renameSync(batchOutputs[0], ttsComboPath);
    } else if (batchOutputs.length > 1) {
      const batchInputs = batchOutputs.map(f => `-i "${f}"`).join(" ");
      const batchStreamRefs = batchOutputs.map((_, i) => `[${i}]`).join("");
      execSync(
        `ffmpeg -y -threads 0 ${batchInputs} -filter_complex "${batchStreamRefs}amix=inputs=${batchOutputs.length}:duration=longest:normalize=0[out]" -map "[out]" -ar 44100 -ac 2 -b:a 192k "${ttsComboPath}"`,
        { encoding: "utf-8", timeout: 300000, stdio: ["pipe", "pipe", "pipe"] }
      );
      batchOutputs.forEach(f => { try { fs.unlinkSync(f); } catch {} });
    } else {
      throw new Error("All merge batches failed - no TTS audio could be created");
    }
  }

  // Cleanup filter script
  try { fs.unlinkSync(filterScriptPath); } catch {}

  // ═══════════════════════════════════════════════════════════════
  // Final mix: background + combined TTS
  // ═══════════════════════════════════════════════════════════════
  console.log(`\n   🎚️ Final mix: TTS + background...`);
  
  if (!fs.existsSync(ttsComboPath)) {
    throw new Error(`TTS combined file not found: ${ttsComboPath}`);
  }
  
  // Detect output format and set appropriate codec
  const outputExt = path.extname(outputPath).toLowerCase();
  const audioCodec = (outputExt === ".m4a" || outputExt === ".aac") 
    ? "-c:a aac -b:a 192k" 
    : "-c:a libmp3lame -b:a 192k";
  
  if (hasBackground) {
    // Mix TTS with background audio
    try {
      execSync(
        `ffmpeg -y -threads 0 -i "${backgroundPath}" -i "${ttsComboPath}" -filter_complex "[0]volume=${backgroundVolume}[bg];[bg][1]amerge=inputs=2,pan=stereo|c0<c0+c2|c1<c1+c3[out]" -map "[out]" -ac 2 -ar 44100 ${audioCodec} "${outputPath}"`,
        { encoding: "utf-8", timeout: 300000, stdio: ["pipe", "pipe", "pipe"] }
      );
    } catch (e) {
      console.log(`      ⚠️ Final mix failed, trying simpler approach...`);
      // Fallback: simple amix instead of amerge+pan
      execSync(
        `ffmpeg -y -threads 0 -i "${backgroundPath}" -i "${ttsComboPath}" -filter_complex "[0]volume=${backgroundVolume}[bg];[bg][1]amix=inputs=2:duration=longest[out]" -map "[out]" -ac 2 -ar 44100 ${audioCodec} "${outputPath}"`,
        { encoding: "utf-8", timeout: 300000, stdio: ["pipe", "pipe", "pipe"] }
      );
    }
  } else {
    // No background - just copy TTS output
    console.log(`      📝 TTS-only output (no background)`);
    execSync(
      `ffmpeg -y -i "${ttsComboPath}" -ac 2 -ar 44100 ${audioCodec} "${outputPath}"`,
      { encoding: "utf-8", timeout: 300000, stdio: ["pipe", "pipe", "pipe"] }
    );
  }

  // ═══════════════════════════════════════════════════════════════
  // Save separate TTS-only track for independent volume control
  // ═══════════════════════════════════════════════════════════════
  const ttsOnlyPath = outputPath.replace(/\.\w+$/, '_voice_only.m4a');
  
  console.log(`   🎙️ Creating voice-only track...`);
  console.log(`      Source: ${ttsComboPath} (exists: ${fs.existsSync(ttsComboPath)})`);
  console.log(`      Target: ${path.basename(ttsOnlyPath)}`);
  
  if (fs.existsSync(ttsComboPath)) {
    try {
      const ttsCodec = "-c:a aac -b:a 192k";
      execSync(
        `ffmpeg -y -i "${ttsComboPath}" -ac 2 -ar 44100 ${ttsCodec} "${ttsOnlyPath}"`,
        { encoding: "utf-8", timeout: 120000, stdio: ["pipe", "pipe", "pipe"] }
      );
      
      if (fs.existsSync(ttsOnlyPath)) {
        const voiceSize = fs.statSync(ttsOnlyPath).size;
        console.log(`   ✅ Voice-only track saved (${(voiceSize / 1024 / 1024).toFixed(1)} MB)`);
      } else {
        console.log(`   ⚠️ FFmpeg ran but voice-only file not found`);
      }
    } catch (e) {
      console.log(`   ⚠️ Voice-only track creation failed: ${e.message.substring(0, 100)}`);
      
      // Fallback: copy the batch file directly as voice-only
      try {
        fs.copyFileSync(ttsComboPath, ttsOnlyPath);
        console.log(`   🔄 Fallback: copied batch file as voice-only track`);
      } catch (e2) {
        console.log(`   ❌ Fallback also failed: ${e2.message.substring(0, 50)}`);
      }
    }
  } else {
    console.log(`   ⚠️ TTS combo path does not exist, cannot create voice-only track`);
  }

  // ═══════════════════════════════════════════════════════════════
  // Cleanup
  // ═══════════════════════════════════════════════════════════════
  console.log(`   🧹 Cleaning up...`);
  try { fs.unlinkSync(ttsComboPath); } catch {}
  
  // Clean any leftover files
  const files = fs.readdirSync(tempDir);
  files.forEach(f => {
    if (f.startsWith("batch_") || f.startsWith("merge_iter") || f.startsWith("small_batch_")) {
      try { fs.unlinkSync(path.join(tempDir, f)); } catch {}
    }
  });

  const outputDuration = getAudioDuration(outputPath);
  const outputSize = fs.statSync(outputPath).size;
  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);

  console.log(`\n   ✅ MERGE COMPLETE in ${elapsed}s`);
  console.log(`   📁 Output: ${path.basename(outputPath)}`);
  console.log(`      Duration: ${outputDuration?.toFixed(1)}s`);
  console.log(`      Size: ${(outputSize / 1024 / 1024).toFixed(1)} MB`);

  return {
    outputPath,
    ttsOnlyPath: fs.existsSync(ttsOnlyPath) ? ttsOnlyPath : null,
    backgroundPath: hasBackground ? backgroundPath : null,
    duration: outputDuration,
    size: outputSize,
    segmentsMerged: validSegments.length,
    processingTime: parseFloat(elapsed),
  };
}

/**
 * Process a small batch when the main batch fails
 * Uses anullsrc anchor instead of apad for efficiency
 */
async function processSmallBatch(segments, tempDir, totalDuration, ttsVolume, parentBatchIdx) {
  const smallBatchSize = 10;
  const fadeIn = 0.04;  // 40ms fade-in
  const fadeOut = 0.06; // 60ms fade-out
  const outputs = [];
  
  for (let i = 0; i < segments.length; i += smallBatchSize) {
    const batch = segments.slice(i, i + smallBatchSize);
    const outPath = path.join(tempDir, `small_batch_${parentBatchIdx}_${Math.floor(i/smallBatchSize)}.mp3`);
    
    // Use anullsrc anchor instead of apad on every segment
    const inputs = ['-f lavfi -i "anullsrc=channel_layout=stereo:sample_rate=44100"']
      .concat(batch.map(s => `-i "${s.alignedFile}"`)).join(" ");
    
    const filterLines = [`[0]atrim=duration=${totalDuration.toFixed(3)}[base]`];
    
    batch.forEach((s, j) => {
      const delayMs = Math.round(s.start * 1000);
      const rawDuration = s.alignedDuration || s.ttsDuration || s.duration || 3;
      const effectiveDuration = s.maxDuration || rawDuration;
      
      let chain = `[${j + 1}]volume=${ttsVolume}`;
      if (s.wasTruncated && effectiveDuration < rawDuration) {
        chain += `,atrim=end=${effectiveDuration.toFixed(3)}`;
        const trimFadeStart = Math.max(0, effectiveDuration - 0.15);
        chain += `,afade=t=out:st=${trimFadeStart.toFixed(3)}:d=0.15`;
        chain += `,afade=t=in:d=${fadeIn}`;
      } else {
        chain += `,afade=t=in:d=${fadeIn}`;
        const fadeOutStart = Math.max(0, effectiveDuration - fadeOut);
        chain += `,afade=t=out:st=${fadeOutStart.toFixed(3)}:d=${fadeOut}`;
      }
      chain += `,adelay=${delayMs}|${delayMs}[s${j}]`;
      filterLines.push(chain);
    });
    
    const streamLabels = ["[base]"].concat(batch.map((_, j) => `[s${j}]`));
    filterLines.push(`${streamLabels.join("")}amix=inputs=${batch.length + 1}:duration=first:dropout_transition=0:normalize=0[out]`);
    const filterComplex = filterLines.join(";");
    
    try {
      execSync(
        `ffmpeg -y -threads 0 ${inputs} -filter_complex "${filterComplex}" -map "[out]" -ar 44100 -ac 2 -b:a 192k -t ${totalDuration} "${outPath}"`,
        { encoding: "utf-8", timeout: 120000, maxBuffer: 50 * 1024 * 1024, stdio: ["pipe", "pipe", "pipe"] }
      );
      outputs.push(outPath);
    } catch (e) {
      console.log(`         Small batch ${Math.floor(i/smallBatchSize)} failed`);
    }
  }
  
  return outputs;
}

/**
 * Render final video by replacing audio track
 */
async function renderVideo(videoPath, audioPath, outputPath, options = {}) {
  const {
    subtitlePath = null,  // Optional: burn subtitles into video
    subtitleStyle = "FontSize=22,FontName=Arial,PrimaryColour=&HFFFFFF,OutlineColour=&H000000,Outline=2,MarginV=30",
  } = options;
  
  console.log(`\n${"═".repeat(60)}`);
  console.log(`🎬 RENDER: Final Video`);
  console.log(`${"═".repeat(60)}`);

  if (!fs.existsSync(videoPath)) {
    throw new Error(`Video not found: ${videoPath}`);
  }
  if (!fs.existsSync(audioPath)) {
    throw new Error(`Audio not found: ${audioPath}`);
  }

  console.log(`   Video: ${path.basename(videoPath)}`);
  console.log(`   Audio: ${path.basename(audioPath)}`);
  if (subtitlePath && fs.existsSync(subtitlePath)) {
    console.log(`   Subtitles: ${path.basename(subtitlePath)} (burning in)`);
  }

  const startTime = Date.now();

  // Build ffmpeg command
  const audioExt = path.extname(audioPath).toLowerCase();
  const audioCodecOpt = (audioExt === ".m4a" || audioExt === ".aac") 
    ? "-c:a copy"  // Stream copy AAC (instant)
    : "-c:a aac -b:a 192k";  // Re-encode to AAC
  
  let cmd;
  if (subtitlePath && fs.existsSync(subtitlePath)) {
    // Burn subtitles into video (requires video re-encode)
    // Escape path for subtitles filter (colons and backslashes need escaping)
    const escapedSubPath = subtitlePath.replace(/\\/g, '/').replace(/:/g, '\\:');
    cmd = `ffmpeg -y -i "${videoPath}" -i "${audioPath}" -vf "subtitles='${escapedSubPath}':force_style='${subtitleStyle}'" -c:v libx264 -preset fast -crf 23 ${audioCodecOpt} -map 0:v:0 -map 1:a:0 -shortest "${outputPath}"`;
  } else {
    // No subtitles - just replace audio (fast, no re-encode)
    cmd = `ffmpeg -y -i "${videoPath}" -i "${audioPath}" -c:v copy ${audioCodecOpt} -map 0:v:0 -map 1:a:0 -shortest "${outputPath}"`;
  }
  
  execSync(cmd, { encoding: "utf-8", timeout: 600000, stdio: ["pipe", "pipe", "pipe"] });

  const outputDuration = getAudioDuration(outputPath);
  const outputSize = fs.statSync(outputPath).size;
  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);

  console.log(`\n   ✅ RENDER COMPLETE in ${elapsed}s`);
  console.log(`   📁 Output: ${path.basename(outputPath)}`);
  console.log(`      Duration: ${outputDuration?.toFixed(1)}s`);
  console.log(`      Size: ${(outputSize / 1024 / 1024).toFixed(1)} MB`);

  return {
    outputPath,
    duration: outputDuration,
    size: outputSize,
    processingTime: parseFloat(elapsed),
  };
}

/**
 * Render video with speed adjustment for brainrot mode
 * 
 * Takes a video and audio of potentially different lengths,
 * speeds up the video to match the audio duration.
 * 
 * @param {string} videoPath - Original video
 * @param {string} audioPath - Narration audio (slower than video)
 * @param {string} outputPath - Output video path
 * @param {object} options - Render options
 * @returns {Promise<object>} Render result
 */
async function renderVideoBrainrot(videoPath, audioPath, outputPath, options = {}) {
  const {
    maxSpeedup = 2.0, // Don't speed up more than 2x
    minSpeedup = 1.0, // Minimum speedup (1.0 = no change)
  } = options;

  console.log(`\n${"═".repeat(60)}`);
  console.log(`🧠 BRAINROT RENDER: Speed-adjusted Video`);
  console.log(`${"═".repeat(60)}`);

  if (!fs.existsSync(videoPath)) {
    throw new Error(`Video not found: ${videoPath}`);
  }
  if (!fs.existsSync(audioPath)) {
    throw new Error(`Audio not found: ${audioPath}`);
  }

  // Get durations
  const videoDuration = getAudioDuration(videoPath);
  const audioDuration = getAudioDuration(audioPath);

  console.log(`   Video: ${path.basename(videoPath)} (${videoDuration?.toFixed(1)}s)`);
  console.log(`   Audio: ${path.basename(audioPath)} (${audioDuration?.toFixed(1)}s)`);

  // Calculate required speedup
  // If audio is longer than video, we'd need to slow down (not typical for brainrot)
  // If video is longer than audio, we speed up the video
  let speedup = videoDuration / audioDuration;
  
  // Clamp to safe range
  speedup = Math.max(minSpeedup, Math.min(maxSpeedup, speedup));
  
  console.log(`   📊 Speed factor: ${speedup.toFixed(2)}x`);
  
  const startTime = Date.now();

  if (speedup <= 1.05) {
    // No significant speedup needed - just do normal render
    console.log(`   ℹ️ No significant speedup needed, using normal render`);
    execSync(
      `ffmpeg -y -i "${videoPath}" -i "${audioPath}" -c:v copy -c:a aac -b:a 192k -map 0:v:0 -map 1:a:0 -shortest "${outputPath}"`,
      { encoding: "utf-8", timeout: 300000, stdio: ["pipe", "pipe", "pipe"] }
    );
  } else {
    // Speed up video using setpts filter
    // setpts=PTS/X speeds up video by factor X
    // Example: setpts=PTS/1.5 = 1.5x faster
    const ptsFilter = `setpts=PTS/${speedup.toFixed(4)}`;
    
    console.log(`   🎬 Speeding up video with filter: ${ptsFilter}`);
    
    // Use libx264 for re-encoding (needed for speed change)
    // crf 23 is good quality, preset faster for speed
    execSync(
      `ffmpeg -y -i "${videoPath}" -i "${audioPath}" ` +
      `-filter:v "${ptsFilter}" ` +
      `-c:v libx264 -preset faster -crf 23 ` +
      `-c:a aac -b:a 192k ` +
      `-map 0:v:0 -map 1:a:0 ` +
      `-shortest "${outputPath}"`,
      { encoding: "utf-8", timeout: 600000, stdio: ["pipe", "pipe", "pipe"] }
    );
  }

  const outputDuration = getAudioDuration(outputPath);
  const outputSize = fs.statSync(outputPath).size;
  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);

  console.log(`\n   ✅ BRAINROT RENDER COMPLETE in ${elapsed}s`);
  console.log(`   📁 Output: ${path.basename(outputPath)}`);
  console.log(`      Original video: ${videoDuration?.toFixed(1)}s`);
  console.log(`      Output duration: ${outputDuration?.toFixed(1)}s`);
  console.log(`      Speed factor: ${speedup.toFixed(2)}x`);
  console.log(`      Size: ${(outputSize / 1024 / 1024).toFixed(1)} MB`);

  return {
    outputPath,
    duration: outputDuration,
    originalDuration: videoDuration,
    speedup,
    size: outputSize,
    processingTime: parseFloat(elapsed),
  };
}

// ════════════════════════════════════════════════════════════════════════════
// Subtitle Generation
// ════════════════════════════════════════════════════════════════════════════

/**
 * Format time for SRT (HH:MM:SS,mmm)
 */
function formatSRTTime(seconds) {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  const ms = Math.round((seconds % 1) * 1000);
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')},${String(ms).padStart(3, '0')}`;
}

/**
 * Generate SRT subtitle file from segments
 * 
 * @param {array} segments - Segments with start, end, text, translatedText
 * @param {string} outputPath - Path for .srt file
 * @param {object} options - Options for subtitle generation
 * @returns {object} Result with path and count
 */
function generateSubtitles(segments, outputPath, options = {}) {
  const {
    mode = "dual",           // "original", "translated", "dual"
    originalLabel = "🇺🇸",   // Label for original text
    translatedLabel = "🇪🇸", // Label for translated text
  } = options;
  
  console.log(`\n${"═".repeat(60)}`);
  console.log(`📝 SUBTITLES: Generating ${mode} captions`);
  console.log(`${"═".repeat(60)}`);
  
  let srtContent = "";
  let idx = 1;
  
  for (const seg of segments) {
    if (!seg.start || !seg.end) continue;
    
    const startTime = formatSRTTime(seg.start);
    const endTime = formatSRTTime(seg.end);
    
    const originalText = seg.originalText || seg.text || "";
    const translatedText = seg.translatedText || seg.translated || "";
    
    let subtitleText = "";
    
    if (mode === "original" && originalText) {
      subtitleText = originalText;
    } else if (mode === "translated" && translatedText) {
      subtitleText = translatedText;
    } else if (mode === "dual") {
      // Dual: Original on top, translated below
      const lines = [];
      if (originalText) lines.push(`${originalLabel} ${originalText}`);
      if (translatedText) lines.push(`${translatedLabel} ${translatedText}`);
      subtitleText = lines.join("\n");
    }
    
    if (subtitleText.trim()) {
      srtContent += `${idx}\n`;
      srtContent += `${startTime} --> ${endTime}\n`;
      srtContent += `${subtitleText}\n\n`;
      idx++;
    }
  }
  
  // Write SRT file
  fs.writeFileSync(outputPath, srtContent);
  
  console.log(`   ✅ Generated ${idx - 1} subtitles`);
  console.log(`   📁 Output: ${path.basename(outputPath)}`);
  
  return {
    outputPath,
    count: idx - 1,
  };
}

/**
 * Render video with vocabulary overlays for beginner content
 * 
 * Adds visual aids to support language comprehension:
 * - Vocabulary cards in corners
 * - Word highlights when spoken
 * - Optional PIP (picture-in-picture) for illustrations
 * 
 * @param {string} videoPath - Input video path
 * @param {string} audioPath - Dubbed audio path
 * @param {string} outputPath - Output video path
 * @param {object} options - Render options
 * @returns {Promise<object>} Render result
 */
async function renderVideoWithOverlays(videoPath, audioPath, outputPath, options = {}) {
  const {
    overlays = [],          // Array of overlay specifications
    subtitlePath = null,    // Optional subtitle file
    burnSubtitles = false,  // Burn subtitles into video
    pipImages = [],         // Picture-in-picture images [{imagePath, start, end, position}]
  } = options;

  console.log(`\n${"═".repeat(60)}`);
  console.log(`🎨 BEGINNER RENDER: Video with Vocabulary Overlays`);
  console.log(`${"═".repeat(60)}`);

  if (!fs.existsSync(videoPath)) {
    throw new Error(`Video not found: ${videoPath}`);
  }
  if (!fs.existsSync(audioPath)) {
    throw new Error(`Audio not found: ${audioPath}`);
  }

  console.log(`   Video: ${path.basename(videoPath)}`);
  console.log(`   Audio: ${path.basename(audioPath)}`);
  console.log(`   Overlays: ${overlays.length}`);
  console.log(`   PIP images: ${pipImages.length}`);

  const startTime = Date.now();

  // Get video dimensions
  let videoWidth = 1920, videoHeight = 1080;
  try {
    const probeResult = execSync(
      `ffprobe -v error -select_streams v:0 -show_entries stream=width,height -of csv=p=0 "${videoPath}"`,
      { encoding: "utf-8", timeout: 10000 }
    );
    const [w, h] = probeResult.trim().split(",").map(Number);
    if (w && h) {
      videoWidth = w;
      videoHeight = h;
    }
  } catch {}

  console.log(`   Resolution: ${videoWidth}x${videoHeight}`);

  // Build FFmpeg filter complex
  const filters = [];

  // Add vocabulary overlay filters
  for (let i = 0; i < overlays.length; i++) {
    const overlay = overlays[i];
    const filter = buildOverlayFilter(overlay, videoWidth, videoHeight, i);
    if (filter) {
      filters.push(filter);
    }
  }

  // Add PIP filters for images
  // Note: PIP requires additional input files in FFmpeg
  // This is a simplified version - full PIP requires more complex filter chain
  
  // Combine all video filters
  let videoFilter = "";
  if (filters.length > 0) {
    videoFilter = filters.join(",");
  }

  // Add subtitle filter if needed
  if (burnSubtitles && subtitlePath && fs.existsSync(subtitlePath)) {
    const escapedSubPath = subtitlePath.replace(/\\/g, '/').replace(/:/g, '\\:');
    const subtitleFilter = `subtitles='${escapedSubPath}'`;
    videoFilter = videoFilter ? `${videoFilter},${subtitleFilter}` : subtitleFilter;
  }

  // Build FFmpeg command
  const audioExt = path.extname(audioPath).toLowerCase();
  const audioCodecOpt = (audioExt === ".m4a" || audioExt === ".aac") 
    ? "-c:a copy" 
    : "-c:a aac -b:a 192k";

  let cmd;
  if (videoFilter) {
    // Need to re-encode video for filters
    cmd = `ffmpeg -y -i "${videoPath}" -i "${audioPath}" -vf "${videoFilter}" -c:v libx264 -preset fast -crf 23 ${audioCodecOpt} -map 0:v:0 -map 1:a:0 -shortest "${outputPath}"`;
  } else {
    // No filters - fast copy
    cmd = `ffmpeg -y -i "${videoPath}" -i "${audioPath}" -c:v copy ${audioCodecOpt} -map 0:v:0 -map 1:a:0 -shortest "${outputPath}"`;
  }

  console.log(`\n   Running FFmpeg${videoFilter ? ' (with overlays)' : ''}...`);

  try {
    execSync(cmd, { 
      encoding: "utf-8", 
      timeout: 900000, // 15 min timeout
      stdio: ["pipe", "pipe", "pipe"] 
    });
  } catch (err) {
    console.log(`   ⚠️ Overlay render failed, trying without overlays...`);
    // Fallback to simple render
    execSync(
      `ffmpeg -y -i "${videoPath}" -i "${audioPath}" -c:v copy ${audioCodecOpt} -map 0:v:0 -map 1:a:0 -shortest "${outputPath}"`,
      { encoding: "utf-8", timeout: 300000, stdio: ["pipe", "pipe", "pipe"] }
    );
  }

  const outputDuration = getAudioDuration(outputPath);
  const outputSize = fs.statSync(outputPath).size;
  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);

  console.log(`\n   ✅ BEGINNER RENDER COMPLETE in ${elapsed}s`);
  console.log(`   📁 Output: ${path.basename(outputPath)}`);
  console.log(`      Duration: ${outputDuration?.toFixed(1)}s`);
  console.log(`      Size: ${(outputSize / 1024 / 1024).toFixed(1)} MB`);
  console.log(`      Overlays applied: ${filters.length}`);

  return {
    outputPath,
    duration: outputDuration,
    size: outputSize,
    overlaysApplied: filters.length,
    processingTime: parseFloat(elapsed),
  };
}

/**
 * Build FFmpeg drawtext filter for a single overlay
 * 
 * @param {object} overlay - Overlay specification
 * @param {number} videoWidth - Video width
 * @param {number} videoHeight - Video height
 * @param {number} index - Overlay index (for unique filter names)
 * @returns {string} FFmpeg filter string
 */
function buildOverlayFilter(overlay, videoWidth, videoHeight, index) {
  const {
    type = "card",
    word = "",
    translation = "",
    emoji = "📝",
    startTime = 0,
    endTime = 2,
    position = "bottom-right",
    fontSize = 42,
    backgroundColor = "0x000000@0.8",
    textColor = "white",
    fadeInDuration = 0.3,
    fadeOutDuration = 0.3,
  } = overlay;

  // Calculate position
  const margin = 30;
  let x, y;
  
  switch (position) {
    case "top-left":
      x = margin;
      y = margin;
      break;
    case "top-right":
      x = `w-tw-${margin}`;
      y = margin;
      break;
    case "bottom-left":
      x = margin;
      y = `h-th-${margin}`;
      break;
    case "center":
      x = "(w-tw)/2";
      y = "(h-th)/2";
      break;
    case "bottom-right":
    default:
      x = `w-tw-${margin}`;
      y = `h-th-${margin}`;
      break;
  }

  // Build display text
  const displayText = type === "highlight" 
    ? `${emoji} ${word}`
    : `${emoji}  ${word}\\n(${translation})`;

  // Escape special characters for FFmpeg
  const escapedText = displayText
    .replace(/\\/g, "\\\\")
    .replace(/'/g, "\\'")
    .replace(/:/g, "\\:")
    .replace(/%/g, "\\%");

  // Build alpha expression for fade in/out
  const alphaExpr = `if(lt(t\\,${startTime})\\,0\\,if(lt(t\\,${startTime + fadeInDuration})\\,(t-${startTime})/${fadeInDuration}\\,if(lt(t\\,${endTime - fadeOutDuration})\\,1\\,(${endTime}-t)/${fadeOutDuration})))`;

  // Build drawtext filter
  const fontFile = ""; // Uses default font
  const boxPadding = type === "highlight" ? 20 : 15;
  const actualFontSize = type === "highlight" ? fontSize * 1.5 : fontSize;

  return `drawtext=text='${escapedText}':fontsize=${actualFontSize}:fontcolor=${textColor}@{${alphaExpr}}:x=${x}:y=${y}:box=1:boxcolor=${backgroundColor}:boxborderw=${boxPadding}:enable='between(t\\,${startTime}\\,${endTime})'`;
}

/**
 * Create vocabulary summary screen (intro/outro)
 * 
 * @param {array} vocabulary - Vocabulary items to display
 * @param {string} outputPath - Output image/video path
 * @param {object} options - Summary options
 * @returns {Promise<object>} Result with path
 */
async function createVocabularySummary(vocabulary, outputPath, options = {}) {
  const {
    title = "Vocabulario de hoy",
    duration = 5,
    width = 1920,
    height = 1080,
    backgroundColor = "0x1a1a2e",
    textColor = "white",
    maxWords = 12,
  } = options;

  console.log(`\n   📋 Creating vocabulary summary...`);

  // Build vocabulary text
  const vocabLines = vocabulary.slice(0, maxWords).map((v, i) => {
    const emoji = v.emoji || "📝";
    return `${emoji}  ${v.word}  -  ${v.translation}`;
  });

  // Create a simple video with text using FFmpeg
  // This creates a static image with the vocabulary list
  const textContent = `${title}\\n\\n${vocabLines.join("\\n")}`;
  
  const cmd = `ffmpeg -y -f lavfi -i color=c=${backgroundColor}:s=${width}x${height}:d=${duration} -vf "drawtext=text='${textContent.replace(/'/g, "\\'")}':fontsize=48:fontcolor=${textColor}:x=(w-tw)/2:y=(h-th)/2" -c:v libx264 -preset fast -crf 23 "${outputPath}"`;

  try {
    execSync(cmd, {
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
      timeout: 30000,
    });

    console.log(`   ✅ Vocabulary summary created`);
    return {
      success: true,
      outputPath,
      vocabularyCount: Math.min(vocabulary.length, maxWords),
      duration,
    };
  } catch (err) {
    console.log(`   ⚠️ Failed to create vocabulary summary: ${err.message}`);
    return {
      success: false,
      error: err.message,
    };
  }
}

/**
 * Concatenate intro, main video, and outro
 * 
 * @param {array} videoParts - Array of video paths in order
 * @param {string} outputPath - Output video path
 * @returns {Promise<object>} Result
 */
async function concatenateVideos(videoParts, outputPath) {
  console.log(`\n   🎬 Concatenating ${videoParts.length} video parts...`);

  // Filter to existing files
  const existingParts = videoParts.filter(p => fs.existsSync(p));
  
  if (existingParts.length === 0) {
    throw new Error("No valid video parts to concatenate");
  }

  if (existingParts.length === 1) {
    // Just copy
    fs.copyFileSync(existingParts[0], outputPath);
    return {
      success: true,
      outputPath,
      partCount: 1,
    };
  }

  // Create concat list file
  const concatListPath = outputPath.replace(/\.\w+$/, "_concat.txt");
  const concatContent = existingParts.map(p => `file '${p}'`).join("\n");
  fs.writeFileSync(concatListPath, concatContent);

  try {
    execSync(
      `ffmpeg -y -f concat -safe 0 -i "${concatListPath}" -c copy "${outputPath}"`,
      { encoding: "utf-8", stdio: ["pipe", "pipe", "pipe"], timeout: 300000 }
    );

    // Cleanup
    try { fs.unlinkSync(concatListPath); } catch {}

    const outputSize = fs.statSync(outputPath).size;
    console.log(`   ✅ Concatenation complete: ${(outputSize / 1024 / 1024).toFixed(1)} MB`);

    return {
      success: true,
      outputPath,
      partCount: existingParts.length,
      size: outputSize,
    };
  } catch (err) {
    try { fs.unlinkSync(concatListPath); } catch {}
    throw err;
  }
}

module.exports = {
  merge,
  renderVideo,
  renderVideoBrainrot,
  renderVideoWithOverlays,
  buildOverlayFilter,
  createVocabularySummary,
  concatenateVideos,
  getAudioDuration,
  generateSubtitles,
};
