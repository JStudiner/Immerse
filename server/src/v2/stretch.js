/**
 * Immersion v2 - Video Stretch Module
 * 
 * Extends video segments where TTS audio exceeds the original duration
 * Used for "extended" mode to preserve full translation without cutting audio
 * 
 * Strategies:
 * 1. FREEZE_FRAME: Pause on a still image during speech overflow
 * 2. SLOW_MOTION: Slow down video segment (avoid when lips visible)
 * 3. SCENE_EXTEND: Find safe B-roll or non-face moments to extend
 * 
 * Future: Lip-sync modification to adjust apparent speaking speed
 */

const fs = require("fs");
const path = require("path");
const { execSync, spawn } = require("child_process");

/**
 * Strategy types for video stretching
 */
const STRETCH_STRATEGIES = {
  FREEZE_FRAME: "freeze_frame",   // Pause on last frame
  SLOW_MOTION: "slow_motion",     // Slow down entire segment
  SMART_EXTEND: "smart_extend",   // AI-detected safe extension points
};

/**
 * Analyze a video segment to determine best stretch strategy
 * 
 * @param {string} videoPath - Source video file
 * @param {number} startTime - Segment start in seconds
 * @param {number} endTime - Segment end in seconds  
 * @param {object} options - Analysis options
 * @returns {object} Analysis result with recommended strategy
 */
async function analyzeSegment(videoPath, startTime, endTime, options = {}) {
  const {
    detectFaces = true,
    sampleFrames = 5,
  } = options;
  
  const duration = endTime - startTime;
  
  // For now, use simple heuristics
  // TODO: Add face detection using ffmpeg's dnn_processing or external API
  
  // Default to freeze frame (safest option)
  let strategy = STRETCH_STRATEGIES.FREEZE_FRAME;
  let confidence = 0.7;
  let freezePoint = endTime - 0.1; // Freeze near the end
  
  // If segment is very short, slow motion might work better
  if (duration < 2.0) {
    strategy = STRETCH_STRATEGIES.SLOW_MOTION;
    confidence = 0.6;
  }
  
  return {
    startTime,
    endTime,
    duration,
    recommendedStrategy: strategy,
    confidence,
    freezePoint,
    // Placeholder for future face detection
    hasFace: null,
    lipMovementDetected: null,
  };
}

/**
 * Generate FFmpeg filter for freeze frame extension
 * 
 * @param {number} freezePoint - Time to freeze at (seconds)
 * @param {number} freezeDuration - How long to freeze (seconds)
 * @param {number} streamIndex - Video stream index for filter
 * @returns {string} FFmpeg filter string
 */
function generateFreezeFilter(freezePoint, freezeDuration, streamIndex = 0) {
  // Use tpad filter to extend with last frame
  // Or use split + loop for more control
  return `[${streamIndex}:v]tpad=stop_mode=clone:stop_duration=${freezeDuration.toFixed(3)}[vout]`;
}

/**
 * Generate FFmpeg filter for slow motion extension
 * 
 * @param {number} slowFactor - Speed factor (0.5 = half speed = 2x duration)
 * @param {number} streamIndex - Video stream index
 * @returns {string} FFmpeg filter string
 */
function generateSlowMotionFilter(slowFactor, streamIndex = 0) {
  // setpts for video, atempo for audio
  const ptsFactor = (1 / slowFactor).toFixed(3);
  return `[${streamIndex}:v]setpts=${ptsFactor}*PTS[vout]`;
}

/**
 * Create stretched video segment using specified strategy
 * 
 * @param {string} inputVideo - Source video path
 * @param {number} startTime - Segment start
 * @param {number} endTime - Segment end  
 * @param {number} targetDuration - Desired output duration
 * @param {string} outputPath - Output file path
 * @param {object} options - Stretch options
 * @returns {Promise<object>} Result with output path and stats
 */
async function stretchSegment(inputVideo, startTime, endTime, targetDuration, outputPath, options = {}) {
  const {
    strategy = STRETCH_STRATEGIES.FREEZE_FRAME,
    freezePoint = null,
    quality = "medium", // low, medium, high
  } = options;
  
  const originalDuration = endTime - startTime;
  const extensionNeeded = targetDuration - originalDuration;
  
  if (extensionNeeded <= 0) {
    // No stretch needed, just copy
    return { 
      outputPath: null, 
      stretched: false,
      reason: "no_extension_needed" 
    };
  }
  
  console.log(`   📺 Stretching segment ${startTime.toFixed(1)}s-${endTime.toFixed(1)}s`);
  console.log(`      Original: ${originalDuration.toFixed(2)}s → Target: ${targetDuration.toFixed(2)}s (+${extensionNeeded.toFixed(2)}s)`);
  console.log(`      Strategy: ${strategy}`);
  
  // Quality presets
  const qualityPresets = {
    low: { crf: 28, preset: "ultrafast" },
    medium: { crf: 23, preset: "medium" },
    high: { crf: 18, preset: "slow" },
  };
  const qp = qualityPresets[quality] || qualityPresets.medium;
  
  let filterComplex;
  
  if (strategy === STRETCH_STRATEGIES.FREEZE_FRAME) {
    // Freeze on last frame for extensionNeeded seconds
    const actualFreezePoint = freezePoint || (endTime - 0.05);
    filterComplex = [
      // Trim to the segment
      `[0:v]trim=${startTime}:${endTime},setpts=PTS-STARTPTS[main]`,
      // Add freeze frame padding at the end
      `[main]tpad=stop_mode=clone:stop_duration=${extensionNeeded.toFixed(3)}[vout]`,
    ].join(";");
    
  } else if (strategy === STRETCH_STRATEGIES.SLOW_MOTION) {
    // Slow down the entire segment
    const slowFactor = originalDuration / targetDuration;
    const ptsFactor = (1 / slowFactor).toFixed(4);
    filterComplex = [
      `[0:v]trim=${startTime}:${endTime},setpts=PTS-STARTPTS[trimmed]`,
      `[trimmed]setpts=${ptsFactor}*PTS[vout]`,
    ].join(";");
    
  } else {
    // Default to freeze frame
    filterComplex = [
      `[0:v]trim=${startTime}:${endTime},setpts=PTS-STARTPTS[main]`,
      `[main]tpad=stop_mode=clone:stop_duration=${extensionNeeded.toFixed(3)}[vout]`,
    ].join(";");
  }
  
  const cmd = [
    "ffmpeg", "-y",
    "-i", `"${inputVideo}"`,
    "-filter_complex", `"${filterComplex}"`,
    "-map", '"[vout]"',
    "-c:v", "libx264",
    "-crf", qp.crf,
    "-preset", qp.preset,
    "-an",  // No audio (we handle audio separately)
    `"${outputPath}"`,
  ].join(" ");
  
  try {
    execSync(cmd, { 
      encoding: "utf-8", 
      stdio: ["pipe", "pipe", "pipe"],
      timeout: 60000 
    });
    
    // Verify output duration
    const actualDuration = getVideoDuration(outputPath);
    
    return {
      outputPath,
      stretched: true,
      strategy,
      originalDuration,
      targetDuration,
      actualDuration,
      extensionAdded: extensionNeeded,
    };
  } catch (error) {
    console.error(`   ❌ Stretch failed: ${error.message}`);
    return {
      outputPath: null,
      stretched: false,
      error: error.message,
    };
  }
}

/**
 * Get video duration using ffprobe
 */
function getVideoDuration(filePath) {
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
 * Process all overflow segments and create stretched video
 * 
 * This is the main function for extended mode video processing
 * 
 * @param {string} sourceVideo - Original video path
 * @param {array} overflowSegments - Segments needing stretch (from TTS)
 * @param {string} outputDir - Output directory
 * @param {object} options - Processing options
 * @returns {Promise<object>} Results with stretched segments and final video info
 */
async function processOverflowSegments(sourceVideo, overflowSegments, outputDir, options = {}) {
  const {
    defaultStrategy = STRETCH_STRATEGIES.FREEZE_FRAME,
    analyzeForFaces = false, // TODO: implement face detection
  } = options;
  
  console.log(`\n${"═".repeat(60)}`);
  console.log(`📺 VIDEO STRETCH: Processing ${overflowSegments.length} overflow segments`);
  console.log(`${"═".repeat(60)}`);
  
  if (!overflowSegments || overflowSegments.length === 0) {
    console.log(`   ✅ No overflow segments - video unchanged`);
    return {
      stretched: false,
      segments: [],
      totalExtension: 0,
    };
  }
  
  const stretchDir = path.join(outputDir, "stretched_segments");
  fs.mkdirSync(stretchDir, { recursive: true });
  
  const results = [];
  let totalExtension = 0;
  
  for (const seg of overflowSegments) {
    const outputPath = path.join(stretchDir, `stretch_${String(seg.index).padStart(4, "0")}.mp4`);
    
    // Calculate target duration (original + overflow)
    const originalDuration = seg.end - seg.start;
    const targetDuration = originalDuration + seg.stretchAmount;
    
    // Optionally analyze segment for best strategy
    let strategy = defaultStrategy;
    if (analyzeForFaces) {
      const analysis = await analyzeSegment(sourceVideo, seg.start, seg.end);
      if (analysis.hasFace && analysis.lipMovementDetected) {
        // If face with lips moving, use freeze frame to avoid weird slow-mo lips
        strategy = STRETCH_STRATEGIES.FREEZE_FRAME;
      }
    }
    
    const result = await stretchSegment(
      sourceVideo,
      seg.start,
      seg.end,
      targetDuration,
      outputPath,
      { strategy }
    );
    
    results.push({
      ...seg,
      ...result,
    });
    
    if (result.stretched) {
      totalExtension += seg.stretchAmount;
    }
  }
  
  console.log(`\n   ✅ Stretched ${results.filter(r => r.stretched).length}/${overflowSegments.length} segments`);
  console.log(`   📏 Total video extension: +${totalExtension.toFixed(2)}s`);
  
  return {
    stretched: true,
    segments: results,
    totalExtension,
    stretchDir,
  };
}

/**
 * Generate the final extended video by reassembling stretched segments
 * 
 * Creates a new video with:
 * 1. Original segments where TTS fits
 * 2. Stretched segments where TTS overflows
 * 3. Dubbed audio track
 * 
 * @param {string} sourceVideo - Original video
 * @param {array} allSegments - All TTS segments with stretch info
 * @param {string} dubbedAudio - Path to merged dubbed audio
 * @param {string} outputPath - Final output path
 * @param {object} options - Render options
 */
async function renderExtendedVideo(sourceVideo, allSegments, stretchedSegments, dubbedAudio, outputPath, options = {}) {
  console.log(`\n${"═".repeat(60)}`);
  console.log(`🎬 RENDER: Creating Extended Video`);
  console.log(`${"═".repeat(60)}`);
  
  // This is complex - we need to:
  // 1. Build a concat list of original + stretched segments
  // 2. Handle timing offsets due to extensions
  // 3. Sync with the dubbed audio (which was generated for extended timing)
  
  // For now, simplified approach:
  // If there are stretched segments, we create a new video with concat demuxer
  
  if (!stretchedSegments || stretchedSegments.length === 0) {
    // No stretching needed - just combine original video with dubbed audio
    console.log(`   📋 No stretching needed - standard video/audio merge`);
    return null; // Let the regular render handle it
  }
  
  // TODO: Implement full segment reassembly
  // This requires building a concat file and handling the timing offsets
  
  console.log(`   ⚠️  Extended video reassembly not yet implemented`);
  console.log(`   📋 Stretched segments saved to stretchDir for manual assembly`);
  
  return {
    outputPath: null,
    implemented: false,
    stretchedSegments: stretchedSegments.length,
  };
}

/**
 * Calculate cumulative time offsets after stretching
 * 
 * When we stretch segment N, all subsequent segments shift forward
 * This calculates the new timing for each segment
 * 
 * @param {array} segments - All segments with original timing
 * @param {array} stretchedSegments - Segments that were stretched
 * @returns {array} Segments with adjusted timing
 */
function calculateStretchOffsets(segments, stretchedSegments) {
  // Create a map of segment index -> stretch amount
  const stretchMap = new Map();
  for (const s of stretchedSegments) {
    stretchMap.set(s.index, s.stretchAmount || 0);
  }
  
  // Calculate cumulative offset
  let cumulativeOffset = 0;
  const adjusted = segments.map(seg => {
    const newStart = seg.start + cumulativeOffset;
    const stretchAmount = stretchMap.get(seg.index) || 0;
    const newEnd = seg.end + cumulativeOffset + stretchAmount;
    
    cumulativeOffset += stretchAmount;
    
    return {
      ...seg,
      originalStart: seg.start,
      originalEnd: seg.end,
      start: newStart,
      end: newEnd,
      stretchOffset: cumulativeOffset,
    };
  });
  
  return adjusted;
}

module.exports = {
  STRETCH_STRATEGIES,
  analyzeSegment,
  stretchSegment,
  processOverflowSegments,
  renderExtendedVideo,
  calculateStretchOffsets,
  getVideoDuration,
  generateFreezeFilter,
  generateSlowMotionFilter,
};
