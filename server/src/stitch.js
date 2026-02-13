const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

/**
 * Stitch audio chunks into a single file
 *
 * Modes:
 * - flow: Concatenate back-to-back, no gaps (best for natural speech)
 * - natural: Use audio as-is, place at start times, small gaps allowed
 * - exact: Stretch/compress to match target duration exactly (best sync)
 */
async function stitchAudio(
  manifestPath,
  outputFileName = "dubbed_audio.mp3",
  options = {}
) {
  const {
    fillGaps = true, // Fill gaps between segments with silence (ignored in flow mode)
    minGapToFill = 0.02, // Minimum gap to fill (20ms)
    mode = "flow", // "flow" (no gaps), "natural" (gaps ok), or "exact" (force timing)
  } = options;

  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf-8"));
  const jobDir = path.dirname(manifestPath);
  const outputPath = path.join(jobDir, outputFileName);

  // Flow mode: simple concatenation, no timing manipulation
  if (mode === "flow") {
    return stitchAudioFlow(manifest, jobDir, outputPath);
  }

  const isNatural = mode === "natural";

  console.log(
    `\n🎬 Stitching: ${manifest.tracks.length} tracks (mode: ${mode})\n`
  );

  const tracks = manifest.tracks.sort((a, b) => a.start - b.start);
  const totalDuration = Math.max(...tracks.map((t) => t.end));
  console.log(`   Target video duration: ${totalDuration.toFixed(2)}s\n`);

  const tempFiles = [];
  const processedChunks = [];

  // Process each track
  for (let i = 0; i < tracks.length; i++) {
    const track = tracks[i];
    const chunkFile = path.join(jobDir, path.basename(track.audioUrl));

    if (!fs.existsSync(chunkFile)) {
      console.warn(`   ⚠️ Missing: ${chunkFile}`);
      continue;
    }

    const actualDuration = getAudioDuration(chunkFile);
    const targetDuration = track.duration;
    const startTime = track.start;

    // Skip chunks with near-zero target duration (bad chunking edge case)
    if (targetDuration < 0.1) {
      console.log(
        `   [${i}] ⏭️ Skipping (target duration: ${targetDuration.toFixed(3)}s)`
      );
      continue;
    }

    let processedFile = chunkFile;
    let finalDuration = actualDuration || targetDuration;

    if (isNatural) {
      // NATURAL MODE: Use audio as-is, no stretching
      // Just log the difference for info
      const diff = actualDuration ? actualDuration - targetDuration : 0;
      const diffStr = diff >= 0 ? `+${diff.toFixed(2)}` : diff.toFixed(2);
      console.log(
        `   [${i}] ${path.basename(chunkFile)}: ${actualDuration?.toFixed(
          2
        )}s (${diffStr}s) @ ${startTime.toFixed(2)}s`
      );
    } else {
      // EXACT MODE: Stretch/compress to match target
      console.log(
        `   [${i}] ${path.basename(
          chunkFile
        )}: actual=${actualDuration?.toFixed(
          2
        )}s → target=${targetDuration.toFixed(2)}s @ ${startTime.toFixed(2)}s`
      );

      if (actualDuration) {
        const ratio = actualDuration / targetDuration;

        // Force exact timing - stretch or compress to EXACTLY match target
        if (Math.abs(ratio - 1.0) > 0.02) {
          const adjustedFile = path.join(jobDir, `_exact_${i}.mp3`);

          if (ratio > 1.0) {
            console.log(`       ⏩ Speed up ${ratio.toFixed(2)}x`);
          } else {
            console.log(`       🐢 Slow down ${(1 / ratio).toFixed(2)}x`);
          }

          if (stretchAudio(chunkFile, adjustedFile, targetDuration)) {
            processedFile = adjustedFile;
            finalDuration = targetDuration;
            tempFiles.push(adjustedFile);
          } else {
            console.log(`       ⚠️ Stretch failed, using original`);
          }
        }
      }
    }

    processedChunks.push({
      file: processedFile,
      start: startTime,
      duration: finalDuration,
      targetEnd: startTime + targetDuration, // Track where this chunk SHOULD end
      index: i,
    });
  }

  if (processedChunks.length === 0) {
    throw new Error("No audio chunks found to stitch");
  }

  // Build the final audio with exact timing
  const result = await buildFinalAudioExact(
    processedChunks,
    outputPath,
    totalDuration,
    fillGaps,
    minGapToFill,
    jobDir,
    tempFiles
  );

  // Cleanup temp files
  tempFiles.forEach((f) => {
    if (fs.existsSync(f)) fs.unlinkSync(f);
  });

  // Generate sync report
  generateSyncReport(manifest, outputPath, jobDir);

  return result;
}

/**
 * Build final audio with precise gap handling
 */
async function buildFinalAudio(
  chunks,
  outputPath,
  totalDuration,
  crossfadeDuration,
  fillGaps,
  minGapToFill,
  jobDir,
  tempFiles
) {
  console.log(`\n   📊 Building timeline with ${chunks.length} chunks...`);

  // Create timeline entries (audio or silence)
  const timeline = [];
  let currentTime = 0;

  for (let i = 0; i < chunks.length; i++) {
    const chunk = chunks[i];
    const gap = chunk.start - currentTime;

    // Add silence for gaps before this chunk
    if (fillGaps && gap > minGapToFill) {
      const silenceFile = path.join(jobDir, `_gap_silence_${i}.mp3`);
      createSilence(silenceFile, gap);
      tempFiles.push(silenceFile);
      timeline.push({ file: silenceFile, type: "silence", duration: gap });
      console.log(
        `       🔇 Gap: ${gap.toFixed(2)}s silence before chunk ${i}`
      );
      currentTime += gap;
    }

    // Check if this chunk would extend beyond the video duration
    const chunkEnd = chunk.start + chunk.duration;
    let useDuration = chunk.duration;
    let useFile = chunk.file;

    if (chunkEnd > totalDuration + 0.1) {
      // Chunk extends beyond video - trim it
      const allowedDuration = Math.max(0, totalDuration - chunk.start);
      if (allowedDuration < 0.1) {
        console.log(
          `       ⏭️ Skipping chunk ${chunk.index} (beyond video end)`
        );
        continue;
      }

      // Trim the audio to fit
      const trimmedFile = path.join(jobDir, `_trimmed_${chunk.index}.mp3`);
      try {
        execSync(
          `ffmpeg -y -i "${chunk.file}" -t ${allowedDuration} -c:a libmp3lame -q:a 2 "${trimmedFile}"`,
          { stdio: "pipe" }
        );
        useFile = trimmedFile;
        useDuration = allowedDuration;
        tempFiles.push(trimmedFile);
        console.log(
          `       ✂️ Trimmed chunk ${chunk.index}: ${chunk.duration.toFixed(
            2
          )}s → ${allowedDuration.toFixed(2)}s`
        );
      } catch {
        console.log(`       ⚠️ Could not trim chunk ${chunk.index}, skipping`);
        continue;
      }
    }

    timeline.push({
      file: useFile,
      type: "audio",
      duration: useDuration,
    });
    currentTime = chunk.start + useDuration;
  }

  // Add trailing silence if needed
  const trailingGap = totalDuration - currentTime;
  if (trailingGap > minGapToFill) {
    const silenceFile = path.join(jobDir, `_trailing_silence.mp3`);
    createSilence(silenceFile, trailingGap);
    tempFiles.push(silenceFile);
    timeline.push({
      file: silenceFile,
      type: "silence",
      duration: trailingGap,
    });
    console.log(`       🔇 Trailing: ${trailingGap.toFixed(2)}s silence`);
  }

  // Concatenate with optional crossfade
  const concatListPath = path.join(jobDir, "_final_concat.txt");
  const concatList = timeline.map((t) => `file '${t.file}'`);
  fs.writeFileSync(concatListPath, concatList.join("\n"));
  tempFiles.push(concatListPath);

  console.log(`\n   🔀 Concatenating ${timeline.length} timeline segments...`);

  try {
    // Simple concatenation first
    const tempConcat = path.join(jobDir, "_temp_concat.mp3");
    tempFiles.push(tempConcat);

    execSync(
      `ffmpeg -y -f concat -safe 0 -i "${concatListPath}" -c:a libmp3lame -q:a 2 "${tempConcat}"`,
      { stdio: "pipe" }
    );

    // Apply light compression and normalization for consistent volume
    execSync(
      `ffmpeg -y -i "${tempConcat}" -af "acompressor=threshold=-20dB:ratio=4:attack=5:release=100,loudnorm=I=-16:TP=-1.5:LRA=11" -q:a 2 "${outputPath}"`,
      { stdio: "pipe" }
    );
  } catch (error) {
    console.error("   ⚠️ Advanced processing failed, using simple concat...");
    execSync(
      `ffmpeg -y -f concat -safe 0 -i "${concatListPath}" -q:a 2 "${outputPath}"`,
      { stdio: "pipe" }
    );
  }

  const stats = fs.statSync(outputPath);
  const finalDuration = getAudioDuration(outputPath) || totalDuration;

  console.log(`\n✅ Stitched audio saved: ${outputPath}`);
  console.log(
    `   Duration: ${finalDuration.toFixed(2)}s (target: ${totalDuration.toFixed(
      2
    )}s)`
  );
  console.log(`   Drift: ${(finalDuration - totalDuration).toFixed(2)}s`);
  console.log(`   Size: ${(stats.size / 1024 / 1024).toFixed(1)} MB\n`);

  return {
    outputPath,
    duration: finalDuration,
    targetDuration: totalDuration,
    drift: finalDuration - totalDuration,
    size: stats.size,
  };
}

/**
 * Build final audio with EXACT timing - output duration matches video exactly
 */
async function buildFinalAudioExact(
  chunks,
  outputPath,
  totalDuration,
  fillGaps,
  minGapToFill,
  jobDir,
  tempFiles
) {
  console.log(
    `\n   📊 Building EXACT timeline (target: ${totalDuration.toFixed(2)}s)...`
  );

  // Create timeline entries - each chunk goes at its exact position
  const timeline = [];
  let currentTime = 0;

  for (let i = 0; i < chunks.length; i++) {
    const chunk = chunks[i];

    // Add silence gap before this chunk if needed
    const gap = chunk.start - currentTime;
    if (gap > minGapToFill) {
      const silenceFile = path.join(jobDir, `_gap_${i}.mp3`);
      createSilence(silenceFile, gap);
      tempFiles.push(silenceFile);
      timeline.push({ file: silenceFile, duration: gap, type: "gap" });
      currentTime = chunk.start;
    } else if (gap < -minGapToFill) {
      // Overlap! Previous chunk ran too long - this shouldn't happen with exact timing
      console.log(`       ⚠️ Overlap at chunk ${i}: ${(-gap).toFixed(2)}s`);
    }

    // Add the audio chunk
    timeline.push({
      file: chunk.file,
      duration: chunk.duration,
      type: "audio",
    });
    currentTime = chunk.start + chunk.duration;

    console.log(
      `       ✓ [${chunk.index}] @ ${chunk.start.toFixed(
        2
      )}s for ${chunk.duration.toFixed(2)}s`
    );
  }

  // Add trailing silence to reach exact total duration
  const trailingGap = totalDuration - currentTime;
  if (trailingGap > minGapToFill) {
    const silenceFile = path.join(jobDir, `_trailing.mp3`);
    createSilence(silenceFile, trailingGap);
    tempFiles.push(silenceFile);
    timeline.push({
      file: silenceFile,
      duration: trailingGap,
      type: "trailing",
    });
    console.log(`       🔇 Trailing silence: ${trailingGap.toFixed(2)}s`);
  }

  // Concatenate all segments
  const concatListPath = path.join(jobDir, "_exact_concat.txt");
  const concatList = timeline.map((t) => `file '${t.file}'`);
  fs.writeFileSync(concatListPath, concatList.join("\n"));
  tempFiles.push(concatListPath);

  console.log(`\n   🔀 Concatenating ${timeline.length} segments...`);

  // First pass: concatenate
  const tempConcat = path.join(jobDir, "_temp_exact.mp3");
  tempFiles.push(tempConcat);

  execSync(
    `ffmpeg -y -f concat -safe 0 -i "${concatListPath}" -c:a libmp3lame -q:a 2 "${tempConcat}"`,
    { stdio: "pipe" }
  );

  // Second pass: FORCE exact duration with trim + loudnorm
  console.log(`   ✂️ Forcing exact duration: ${totalDuration.toFixed(2)}s`);
  execSync(
    `ffmpeg -y -i "${tempConcat}" -t ${totalDuration} -af "loudnorm=I=-16:TP=-1.5:LRA=11" -c:a libmp3lame -q:a 2 "${outputPath}"`,
    { stdio: "pipe" }
  );

  const stats = fs.statSync(outputPath);
  const finalDuration = getAudioDuration(outputPath);

  console.log(`\n✅ EXACT stitched audio: ${outputPath}`);
  console.log(
    `   Duration: ${finalDuration.toFixed(2)}s (target: ${totalDuration.toFixed(
      2
    )}s)`
  );
  console.log(`   Drift: ${(finalDuration - totalDuration).toFixed(3)}s`);
  console.log(`   Size: ${(stats.size / 1024 / 1024).toFixed(1)} MB\n`);

  return {
    outputPath,
    duration: finalDuration,
    targetDuration: totalDuration,
    drift: finalDuration - totalDuration,
    size: stats.size,
  };
}

/**
 * Create a silence audio file
 */
function createSilence(outputPath, duration) {
  try {
    execSync(
      `ffmpeg -y -f lavfi -i anullsrc=r=44100:cl=stereo -t ${duration} -c:a libmp3lame -q:a 9 "${outputPath}"`,
      { stdio: "pipe" }
    );
    return true;
  } catch {
    return false;
  }
}

/**
 * Pad audio with silence to reach target duration
 */
function padAudioWithSilence(inputPath, outputPath, targetDuration) {
  try {
    execSync(
      `ffmpeg -y -i "${inputPath}" -af "apad=whole_dur=${targetDuration}" -c:a libmp3lame -q:a 2 "${outputPath}"`,
      { stdio: "pipe" }
    );
    return true;
  } catch {
    return false;
  }
}

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
 * Time-stretch audio to match target duration
 */
function stretchAudio(inputPath, outputPath, targetDuration) {
  const actualDuration = getAudioDuration(inputPath);
  if (!actualDuration) return false;

  const ratio = actualDuration / targetDuration;

  // atempo only accepts 0.5 to 2.0, so chain if needed
  let atempoFilters = [];
  let r = ratio;
  while (r > 2.0) {
    atempoFilters.push("atempo=2.0");
    r /= 2.0;
  }
  while (r < 0.5) {
    atempoFilters.push("atempo=0.5");
    r /= 0.5;
  }
  atempoFilters.push(`atempo=${r.toFixed(4)}`);

  const filter = atempoFilters.join(",");

  try {
    execSync(
      `ffmpeg -y -i "${inputPath}" -filter:a "${filter}" -c:a libmp3lame -q:a 2 "${outputPath}"`,
      { stdio: "pipe" }
    );
    return true;
  } catch {
    return false;
  }
}

/**
 * Generate a sync report showing timing accuracy
 */
function generateSyncReport(manifest, outputPath, jobDir) {
  const tracks = manifest.tracks.sort((a, b) => a.start - b.start);
  const report = {
    generatedAt: new Date().toISOString(),
    totalTracks: tracks.length,
    timing: tracks.map((track) => {
      const chunkFile = path.join(jobDir, path.basename(track.audioUrl));
      const actualDuration = fs.existsSync(chunkFile)
        ? getAudioDuration(chunkFile)
        : null;

      return {
        index: track.index,
        expectedStart: track.start,
        expectedDuration: track.duration,
        actualDuration: actualDuration,
        durationDiff: actualDuration ? actualDuration - track.duration : null,
      };
    }),
  };

  // Calculate summary stats
  const diffs = report.timing
    .filter((t) => t.durationDiff !== null)
    .map((t) => t.durationDiff);
  if (diffs.length > 0) {
    report.summary = {
      avgDrift: (diffs.reduce((a, b) => a + b, 0) / diffs.length).toFixed(3),
      maxDrift: Math.max(...diffs).toFixed(3),
      minDrift: Math.min(...diffs).toFixed(3),
      totalDrift: diffs.reduce((a, b) => a + b, 0).toFixed(3),
    };

    console.log(`\n📊 Sync Report:`);
    console.log(`   Avg drift per chunk: ${report.summary.avgDrift}s`);
    console.log(`   Total drift: ${report.summary.totalDrift}s`);
  }

  const reportPath = path.join(jobDir, "sync_report.json");
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));

  return report;
}

/**
 * Alternative: Use adelay method for complex mixing (backup)
 * This places each audio at its exact timestamp in the timeline
 */
async function stitchAudioPrecise(
  manifestPath,
  outputFileName = "dubbed_audio.mp3"
) {
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf-8"));
  const jobDir = path.dirname(manifestPath);
  const outputPath = path.join(jobDir, outputFileName);

  console.log(`\n🎯 Precise Stitching: ${manifest.tracks.length} chunks\n`);

  const totalDuration = Math.max(...manifest.tracks.map((t) => t.end));
  const tracks = manifest.tracks.sort((a, b) => a.start - b.start);

  const inputs = [];
  const delayFilters = [];
  const validTracks = [];
  const tempFiles = [];

  for (let i = 0; i < tracks.length; i++) {
    const track = tracks[i];
    const chunkFile = path.join(jobDir, path.basename(track.audioUrl));

    if (!fs.existsSync(chunkFile)) {
      console.warn(`   ⚠️ Missing: ${chunkFile}`);
      continue;
    }

    // Adjust audio to fit target duration
    const actualDuration = getAudioDuration(chunkFile);
    const targetDuration = track.duration;
    let useFile = chunkFile;

    if (actualDuration) {
      if (actualDuration > targetDuration * 1.1) {
        // Speed up
        const adjustedFile = path.join(jobDir, `_precise_${i}.mp3`);
        if (stretchAudio(chunkFile, adjustedFile, targetDuration)) {
          useFile = adjustedFile;
          tempFiles.push(adjustedFile);
          console.log(
            `   ⏩ [${i}] Sped up: ${actualDuration.toFixed(
              2
            )}s → ${targetDuration.toFixed(2)}s`
          );
        }
      } else if (
        actualDuration < targetDuration * 0.9 &&
        targetDuration > 0.5
      ) {
        // Slow down audio to fill duration naturally (but not too much)
        const slowedFile = path.join(jobDir, `_precise_slow_${i}.mp3`);
        const ratio = actualDuration / targetDuration;
        const slowdownRatio = Math.min(1 / ratio, 1.35); // Max 1.35x slowdown
        const effectiveTarget = actualDuration * slowdownRatio;

        if (stretchAudio(chunkFile, slowedFile, effectiveTarget)) {
          useFile = slowedFile;
          tempFiles.push(slowedFile);
          console.log(
            `   🐢 [${i}] Slowed: ${actualDuration.toFixed(
              2
            )}s → ${effectiveTarget.toFixed(2)}s (${slowdownRatio.toFixed(2)}x)`
          );
          // Don't pad - let adelay handle positioning
        }
      } else if (targetDuration < 0.5) {
        // Skip chunks with near-zero target duration
        console.log(`   ⏭️ [${i}] Skipping (target duration too short)`);
        continue;
      }
    }

    inputs.push(`-i "${useFile}"`);
    const inputIdx = inputs.length - 1;
    const delayMs = Math.round(track.start * 1000);

    // Delay and pad each track
    delayFilters.push(
      `[${inputIdx}:a]adelay=${delayMs}|${delayMs},apad=whole_dur=${totalDuration}[d${inputIdx}]`
    );
    validTracks.push(`[d${inputIdx}]`);

    console.log(
      `   ✓ chunk_${String(track.index).padStart(
        3,
        "0"
      )}.mp3 @ ${track.start.toFixed(2)}s`
    );
  }

  if (validTracks.length === 0) {
    throw new Error("No audio chunks found to stitch");
  }

  // Mix all delayed tracks
  const mixFilter = `${validTracks.join("")}amix=inputs=${
    validTracks.length
  }:duration=longest:normalize=0[out]`;
  const filterComplex = delayFilters.join(";") + ";" + mixFilter;

  const ffmpegCmd = `ffmpeg -y ${inputs.join(
    " "
  )} -filter_complex "${filterComplex}" -map "[out]" -t ${totalDuration} -c:a libmp3lame -q:a 2 "${outputPath}"`;

  console.log(
    `\n   🔀 Mixing ${validTracks.length} tracks with precise timing...`
  );

  try {
    execSync(ffmpegCmd, { stdio: "pipe", maxBuffer: 100 * 1024 * 1024 });
  } catch (error) {
    console.error("   ⚠️ Precise method failed, falling back to sequential...");
    tempFiles.forEach((f) => {
      if (fs.existsSync(f)) fs.unlinkSync(f);
    });
    return stitchAudio(manifestPath, outputFileName);
  }

  // Cleanup
  tempFiles.forEach((f) => {
    if (fs.existsSync(f)) fs.unlinkSync(f);
  });

  const stats = fs.statSync(outputPath);
  const finalDuration = getAudioDuration(outputPath) || totalDuration;

  console.log(`\n✅ Precise stitched audio: ${outputPath}`);
  console.log(`   Duration: ${finalDuration.toFixed(2)}s`);
  console.log(`   Size: ${(stats.size / 1024 / 1024).toFixed(1)} MB\n`);

  return {
    outputPath,
    duration: finalDuration,
    size: stats.size,
  };
}

/**
 * Analyze manifest and suggest improvements
 */
function analyzeTiming(manifestPath) {
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf-8"));
  const jobDir = path.dirname(manifestPath);
  const tracks = manifest.tracks.sort((a, b) => a.start - b.start);

  console.log(`\n📊 Timing Analysis for ${tracks.length} tracks:\n`);

  let issues = [];
  let lastEnd = 0;

  for (const track of tracks) {
    const chunkFile = path.join(jobDir, path.basename(track.audioUrl));
    const actualDuration = fs.existsSync(chunkFile)
      ? getAudioDuration(chunkFile)
      : null;

    const gap = track.start - lastEnd;
    const durationDiff = actualDuration
      ? actualDuration - track.duration
      : null;

    if (gap > 0.5) {
      issues.push({
        type: "large_gap",
        index: track.index,
        gap,
        start: track.start,
      });
      console.log(
        `   ⚠️ [${track.index}] Large gap: ${gap.toFixed(2)}s before this chunk`
      );
    }

    if (durationDiff && durationDiff > 0.5) {
      issues.push({ type: "too_long", index: track.index, diff: durationDiff });
      console.log(
        `   ⚠️ [${track.index}] Audio too long: +${durationDiff.toFixed(2)}s`
      );
    }

    if (durationDiff && durationDiff < -0.5) {
      issues.push({
        type: "too_short",
        index: track.index,
        diff: durationDiff,
      });
      console.log(
        `   ⚠️ [${track.index}] Audio too short: ${durationDiff.toFixed(2)}s`
      );
    }

    lastEnd = track.end;
  }

  console.log(`\n   Found ${issues.length} potential sync issues`);
  return { tracks: tracks.length, issues };
}

/**
 * FLOW MODE: Crossfade segments together, then stretch to match video duration
 * Smooth transitions + exact total timing
 */
async function stitchAudioFlow(manifest, jobDir, outputPath) {
  const tracks = manifest.tracks.sort((a, b) => a.start - b.start);
  const targetDuration = Math.max(...tracks.map((t) => t.end));
  const crossfadeDuration = 0.18; // 180ms crossfade - smooth blends

  console.log(`\n🎬 Stitching: ${tracks.length} tracks (mode: flow)\n`);
  console.log(`   Step 1: Crossfade segments (${crossfadeDuration * 1000}ms blend)`);
  console.log(`   Step 2: Stretch + audio smoothing\n`);

  const audioFiles = [];

  for (let i = 0; i < tracks.length; i++) {
    const track = tracks[i];
    const chunkFile = path.join(jobDir, path.basename(track.audioUrl));

    if (!fs.existsSync(chunkFile)) {
      console.warn(`   ⚠️ Missing: ${chunkFile}`);
      continue;
    }

    const actualDuration = getAudioDuration(chunkFile);
    audioFiles.push(chunkFile);
    console.log(
      `   [${i}] ${path.basename(chunkFile)}: ${actualDuration?.toFixed(2)}s`
    );
  }

  if (audioFiles.length === 0) {
    throw new Error("No audio files found to stitch");
  }

  const tempConcat = path.join(jobDir, "_temp_flow.mp3");

  console.log(`\n   🔀 Crossfading ${audioFiles.length} segments...`);

  if (audioFiles.length === 1) {
    fs.copyFileSync(audioFiles[0], tempConcat);
  } else {
    // Build crossfade filter chain using acrossfade
    const inputs = audioFiles.map((f) => `-i "${f}"`).join(" ");

    let filterParts = [];
    let lastOutput = "0:a";

    for (let i = 1; i < audioFiles.length; i++) {
      const outputLabel = i === audioFiles.length - 1 ? "out" : `a${i}`;
      // Use exponential curves (exp) for more natural sounding crossfades
      filterParts.push(
        `[${lastOutput}][${i}:a]acrossfade=d=${crossfadeDuration}:c1=exp:c2=exp[${outputLabel}]`
      );
      lastOutput = outputLabel;
    }

    const filterComplex = filterParts.join(";");

    try {
      execSync(
        `ffmpeg -y ${inputs} -filter_complex "${filterComplex}" -map "[out]" -c:a libmp3lame -q:a 2 "${tempConcat}"`,
        { stdio: "pipe", maxBuffer: 100 * 1024 * 1024 }
      );
    } catch (error) {
      // Fallback to simple concat if crossfade fails (too many files)
      console.log(`   ⚠️ Crossfade failed, using simple concat...`);
      const concatListPath = path.join(jobDir, "_flow_concat.txt");
      fs.writeFileSync(
        concatListPath,
        audioFiles.map((f) => `file '${f}'`).join("\n")
      );
      execSync(
        `ffmpeg -y -f concat -safe 0 -i "${concatListPath}" -c:a libmp3lame -q:a 2 "${tempConcat}"`,
        { stdio: "pipe" }
      );
      fs.unlinkSync(concatListPath);
    }
  }

  const concatDuration = getAudioDuration(tempConcat);
  console.log(`   Crossfaded: ${concatDuration.toFixed(2)}s`);

  // Step 2: Stretch to match target duration
  const stretchRatio = concatDuration / targetDuration;
  console.log(
    `\n   🎚️ Stretching ${stretchRatio.toFixed(2)}x to ${targetDuration.toFixed(
      2
    )}s...`
  );

  // Stretch and apply audio smoothing (compressor + limiter for consistent levels)
  const tempStretched = path.join(jobDir, "_temp_stretched.mp3");
  
  if (stretchAudio(tempConcat, tempStretched, targetDuration)) {
    console.log(`   ✅ Stretched successfully`);
    
    // Apply subtle compression and limiting to smooth out transitions
    console.log(`   🎛️ Applying audio smoothing...`);
    try {
      execSync(
        `ffmpeg -y -i "${tempStretched}" -af "acompressor=threshold=-18dB:ratio=3:attack=10:release=100,alimiter=limit=-1dB:attack=5:release=50,loudnorm=I=-16:TP=-1.5:LRA=11" -c:a libmp3lame -q:a 2 "${outputPath}"`,
        { stdio: "pipe" }
      );
    } catch (e) {
      // Fallback without processing
      fs.copyFileSync(tempStretched, outputPath);
    }
    if (fs.existsSync(tempStretched)) fs.unlinkSync(tempStretched);
  } else {
    console.log(`   ⚠️ Stretch failed, using crossfaded audio`);
    fs.copyFileSync(tempConcat, outputPath);
  }

  // Cleanup
  if (fs.existsSync(tempConcat)) fs.unlinkSync(tempConcat);

  const stats = fs.statSync(outputPath);
  const finalDuration = getAudioDuration(outputPath);

  console.log(`\n✅ Flow stitched audio: ${outputPath}`);
  console.log(
    `   Duration: ${finalDuration.toFixed(
      2
    )}s (target: ${targetDuration.toFixed(2)}s)`
  );
  console.log(`   Drift: ${(finalDuration - targetDuration).toFixed(3)}s`);
  console.log(`   Size: ${(stats.size / 1024 / 1024).toFixed(1)} MB\n`);

  return {
    outputPath,
    duration: finalDuration,
    targetDuration: targetDuration,
    drift: finalDuration - targetDuration,
    size: stats.size,
  };
}

/**
 * Create a streamable audio file optimized for serving to users
 * - Consistent 128k CBR for smooth streaming
 * - ID3 metadata tags
 * - Normalized loudness
 */
function createStreamableAudio(inputPath, outputPath, metadata = {}) {
  const {
    title = "Immersion Audio",
    artist = "Immersion",
    album = "Spanish Learning",
    level = "B2",
    videoId = "",
  } = metadata;

  console.log(`\n🎧 Creating streamable audio...`);
  console.log(`   Input: ${path.basename(inputPath)}`);

  // Create metadata args for ffmpeg
  const metadataArgs = [
    `-metadata title="${title}"`,
    `-metadata artist="${artist}"`,
    `-metadata album="${album}"`,
    `-metadata genre="Language Learning"`,
    `-metadata comment="CEFR Level: ${level}"`,
  ];

  if (videoId) {
    metadataArgs.push(`-metadata description="Source: youtube.com/watch?v=${videoId}"`);
  }

  try {
    // CBR 128k for consistent streaming, loudnorm for consistent volume
    execSync(
      `ffmpeg -y -i "${inputPath}" -af "loudnorm=I=-16:TP=-1.5:LRA=11" ${metadataArgs.join(" ")} -c:a libmp3lame -b:a 128k -ar 44100 "${outputPath}"`,
      { stdio: "pipe" }
    );

    const stats = fs.statSync(outputPath);
    const duration = getAudioDuration(outputPath);

    console.log(`   ✅ Created: ${path.basename(outputPath)}`);
    console.log(`   Duration: ${duration?.toFixed(2)}s`);
    console.log(`   Size: ${(stats.size / 1024 / 1024).toFixed(2)} MB`);
    console.log(`   Bitrate: 128 kbps CBR`);

    return {
      outputPath,
      duration,
      size: stats.size,
      format: "mp3",
      bitrate: "128k",
    };
  } catch (error) {
    throw new Error(`Failed to create streamable audio: ${error.message}`);
  }
}

/**
 * Stitch audio files with natural pauses between sections
 * For audio-only mode - no video sync needed
 * OPTIMIZED: Single-pass concat with stream copy (no re-encoding)
 */
async function stitchAudioWithPauses(jobId, audioFiles, options = {}) {
  const {
    pauseDuration = 0.8, // Seconds between sections
    outputFileName = "dubbed_audio.mp3",
  } = options;

  const jobDir = path.join(__dirname, "..", "output", jobId);
  const outputPath = path.join(jobDir, outputFileName);

  console.log(`\n🎬 Stitching ${audioFiles.length} sections (fast mode)...\n`);

  if (audioFiles.length === 0) {
    throw new Error("No audio files to stitch");
  }

  const tempFiles = [];
  const startTime = Date.now();

  // Create a short silence file (only once, reused)
  const silenceFile = path.join(jobDir, "_pause.mp3");
  // Use faster silence generation with minimal quality (it's silence anyway)
  execSync(
    `ffmpeg -y -f lavfi -i anullsrc=r=44100:cl=mono -t ${pauseDuration} -c:a libmp3lame -b:a 32k "${silenceFile}"`,
    { stdio: "pipe" }
  );
  tempFiles.push(silenceFile);

  // Build concat list with pauses between sections
  const concatList = [];
  for (let i = 0; i < audioFiles.length; i++) {
    concatList.push(`file '${audioFiles[i].filePath}'`);
    if (i < audioFiles.length - 1) {
      concatList.push(`file '${silenceFile}'`);
    }
  }

  const concatListPath = path.join(jobDir, "_concat_list.txt");
  fs.writeFileSync(concatListPath, concatList.join("\n"));
  tempFiles.push(concatListPath);

  // Single-pass concat - TTS audio is already normalized, skip loudnorm
  // Using copy codec where possible for speed
  execSync(
    `ffmpeg -y -f concat -safe 0 -i "${concatListPath}" -c:a libmp3lame -q:a 4 "${outputPath}"`,
    { stdio: "pipe" }
  );

  // Cleanup temp files
  tempFiles.forEach((f) => {
    if (fs.existsSync(f)) fs.unlinkSync(f);
  });

  const stats = fs.statSync(outputPath);
  const duration = getAudioDuration(outputPath);
  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);

  console.log(`✅ Stitched in ${elapsed}s: ${outputPath}`);
  console.log(`   Duration: ${duration.toFixed(1)}s | Size: ${(stats.size / 1024 / 1024).toFixed(1)} MB\n`);

  return {
    outputPath,
    duration,
    size: stats.size,
    sections: audioFiles.length,
  };
}

module.exports = {
  stitchAudio,
  stitchAudioFlow,
  stitchAudioPrecise,
  stitchAudioWithPauses,
  analyzeTiming,
  getAudioDuration,
  generateSyncReport,
  createStreamableAudio,
};
