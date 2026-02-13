#!/usr/bin/env node
/**
 * TikTok Clip Generator
 * 
 * Automatically creates viral TikTok clips from Immersion pipeline output.
 * 
 * Features:
 * - Converts to vertical format (9:16, 1080x1920)
 * - Burns in Spanish captions (large, readable)
 * - Adds English subtitles below (optional)
 * - Identifies interesting segments (high information density)
 * - Creates 15-60 second clips optimized for virality
 * 
 * Usage:
 *   node create-tiktok-clips.js <job-directory> [options]
 * 
 * Examples:
 *   node create-tiktok-clips.js output/job-abc123
 *   node create-tiktok-clips.js output/job-abc123 --clips 3 --duration 30
 *   node create-tiktok-clips.js output/job-abc123 --no-english
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

/**
 * Main function to generate TikTok clips
 */
async function createTikTokClips(jobDir, options = {}) {
  const {
    clipDuration = 45,        // Target clip length (seconds)
    maxClips = 5,             // Max clips to create
    minClipDuration = 15,     // Minimum clip length
    addCaptions = true,       // Burn in Spanish captions
    addEnglishSubs = true,    // Add English translation
    verticalFormat = true,    // Convert to 9:16
    formatStyle = 'blur',     // 'blur' (blurred bg), 'square' (movie review), 'crop' (simple)
    outputDir = null,         // Custom output directory
  } = options;

  console.log(`\n${"═".repeat(60)}`);
  console.log(`📱 TIKTOK CLIP GENERATOR`);
  console.log(`${"═".repeat(60)}`);

  // 1. Verify job directory exists
  if (!fs.existsSync(jobDir)) {
    throw new Error(`Job directory not found: ${jobDir}`);
  }

  const videoPath = path.join(jobDir, 'dubbed_video.mp4');
  const translationPath = path.join(jobDir, 'translation.json');

  if (!fs.existsSync(videoPath)) {
    throw new Error(`Video not found: ${videoPath}`);
  }
  if (!fs.existsSync(translationPath)) {
    throw new Error(`Translation not found: ${translationPath}`);
  }

  // 2. Read translation data
  console.log(`\n   📄 Reading translation data...`);
  const translation = JSON.parse(fs.readFileSync(translationPath, 'utf-8'));
  console.log(`   Found ${translation.length} segments`);

  // 3. Identify viral-worthy clip segments
  console.log(`\n   🎯 Identifying clip-worthy segments...`);
  const clipSegments = identifyViralSegments(
    translation,
    clipDuration,
    minClipDuration,
    maxClips
  );

  if (clipSegments.length === 0) {
    console.log(`\n   ⚠️ No suitable clips found (video too short?)`);
    return [];
  }

  console.log(`   Found ${clipSegments.length} potential clips`);

  // 4. Create output directory
  const clipsDir = outputDir || path.join(jobDir, 'tiktok_clips');
  if (!fs.existsSync(clipsDir)) {
    fs.mkdirSync(clipsDir, { recursive: true });
  }

  // 5. Generate each clip
  console.log(`\n   🎬 Generating ${clipSegments.length} TikTok clips...`);
  const outputClips = [];

  for (let i = 0; i < clipSegments.length; i++) {
    const clipData = clipSegments[i];
    const outputPath = path.join(clipsDir, `clip_${i + 1}.mp4`);

    console.log(`\n   Clip ${i + 1}/${clipSegments.length}:`);
    console.log(`      Time: ${clipData.start.toFixed(1)}s - ${clipData.end.toFixed(1)}s`);
    console.log(`      Duration: ${clipData.duration.toFixed(1)}s`);
    console.log(`      Segments: ${clipData.segments.length}`);

    try {
      await generateClip(
        videoPath,
        outputPath,
        clipData,
        { addCaptions, addEnglishSubs, verticalFormat, formatStyle }
      );

      const stats = fs.statSync(outputPath);
      console.log(`      ✅ Generated: ${path.basename(outputPath)} (${(stats.size / 1024 / 1024).toFixed(1)} MB)`);
      
      outputClips.push({
        path: outputPath,
        number: i + 1,
        start: clipData.start,
        end: clipData.end,
        duration: clipData.duration,
        segments: clipData.segments.length,
      });
    } catch (error) {
      console.error(`      ❌ Failed to generate clip ${i + 1}: ${error.message}`);
    }
  }

  // 6. Summary
  console.log(`\n${"═".repeat(60)}`);
  console.log(`✅ Generated ${outputClips.length} TikTok clips`);
  console.log(`📁 Output directory: ${clipsDir}`);
  console.log(`${"═".repeat(60)}\n`);

  return outputClips;
}

/**
 * Identify segments that would make good TikTok clips
 */
function identifyViralSegments(translation, targetDuration, minDuration, maxClips) {
  const segments = [];
  let currentClip = [];
  let currentDuration = 0;

  // Strategy: Create clips that are close to targetDuration
  // with natural break points (pauses between segments)

  for (let i = 0; i < translation.length; i++) {
    const seg = translation[i];
    currentClip.push(seg);
    currentDuration += seg.duration || 0;

    // Check if we've reached target duration
    if (currentDuration >= targetDuration) {
      // Find a good stopping point (next pause > 0.5s or end of video)
      const nextSeg = translation[i + 1];
      const hasNaturalBreak = !nextSeg || (nextSeg.start - seg.end) > 0.5;

      if (hasNaturalBreak && currentDuration >= minDuration) {
        segments.push({
          start: currentClip[0].start,
          end: currentClip[currentClip.length - 1].end,
          duration: currentDuration,
          segments: [...currentClip],
        });

        currentClip = [];
        currentDuration = 0;

        if (segments.length >= maxClips) break;
      }
    }
  }

  // Handle remaining segments if they meet minimum duration
  if (currentClip.length > 0 && currentDuration >= minDuration && segments.length < maxClips) {
    segments.push({
      start: currentClip[0].start,
      end: currentClip[currentClip.length - 1].end,
      duration: currentDuration,
      segments: currentClip,
    });
  }

  return segments;
}

/**
 * Generate a single TikTok clip with captions
 * 
 * @param {string} formatStyle - 'blur' (blurred bg), 'crop' (center crop), 'square' (square video + blur)
 */
async function generateClip(inputVideo, outputPath, clipData, options) {
  const { addCaptions, addEnglishSubs, verticalFormat, formatStyle = 'blur' } = options;
  const { start, end, segments } = clipData;
  const duration = end - start;

  // Build FFmpeg filter chain
  const filters = [];
  let useFilterComplex = false;
  let filterComplex = '';

  // 1. Convert to vertical (9:16 aspect ratio)
  if (verticalFormat) {
    if (formatStyle === 'blur') {
      // Blurred background style (most professional)
      useFilterComplex = true;
      filterComplex = `
        [0:v]scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,boxblur=25:5[bg];
        [0:v]scale=1080:-2:force_original_aspect_ratio=decrease[fg];
        [bg][fg]overlay=(W-w)/2:(H-h)/2[base]
      `.replace(/\s+/g, ' ').trim();
    } else if (formatStyle === 'square') {
      // Square video with blurred top/bottom (popular for movie reviews)
      useFilterComplex = true;
      filterComplex = `
        [0:v]scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,boxblur=25:5[bg];
        [0:v]scale=1080:1080:force_original_aspect_ratio=decrease,pad=1080:1080:(ow-iw)/2:(oh-ih)/2:color=black[fg];
        [bg][fg]overlay=(W-w)/2:(H-h)/2[base]
      `.replace(/\s+/g, ' ').trim();
    } else {
      // Simple center crop (fastest, but may cut content)
      filters.push('crop=ih*9/16:ih');
      filters.push('scale=1080:1920:flags=lanczos');
    }
  }

  // 2. Add Spanish captions (if enabled)
  if (addCaptions) {
    for (const seg of segments) {
      const text = escapeFFmpegText(seg.translatedText || seg.text);
      const segStart = seg.start - start; // Relative to clip start
      const segEnd = seg.end - start;

      // Large white text with black background box
      // Positioned at 70% from top (leaves room for TikTok UI)
      filters.push(
        `drawtext=text='${text}':` +
        `x=(w-text_w)/2:` +
        `y=h*0.65:` +
        `fontsize=56:` +
        `fontcolor=white:` +
        `box=1:` +
        `boxcolor=black@0.8:` +
        `boxborderw=15:` +
        `enable='between(t,${segStart},${segEnd})'`
      );
    }
  }

  // 3. Add English subtitles below (if enabled)
  if (addEnglishSubs) {
    for (const seg of segments) {
      const englishText = escapeFFmpegText(seg.text); // Original English text
      const segStart = seg.start - start;
      const segEnd = seg.end - start;

      // Smaller English text below Spanish
      filters.push(
        `drawtext=text='${englishText}':` +
        `x=(w-text_w)/2:` +
        `y=h*0.80:` +
        `fontsize=36:` +
        `fontcolor=gray:` +
        `box=1:` +
        `boxcolor=black@0.6:` +
        `boxborderw=10:` +
        `enable='between(t,${segStart},${segEnd})'`
      );
    }
  }

  // Build FFmpeg command
  let ffmpegFilters;
  let ffmpegMap = '';
  
  if (useFilterComplex) {
    // Using filter_complex for blur/square styles
    // Append caption filters to the base
    let captionFilters = '';
    let lastOutput = 'base';
    let filterIdx = 0;
    
    if (addCaptions) {
      for (const seg of segments) {
        const text = escapeFFmpegText(seg.translatedText || seg.text);
        const segStart = seg.start - start;
        const segEnd = seg.end - start;
        const nextOutput = `c${filterIdx++}`;
        
        captionFilters += `;[${lastOutput}]drawtext=text='${text}':x=(w-text_w)/2:y=h*0.65:fontsize=56:fontcolor=white:box=1:boxcolor=black@0.8:boxborderw=15:enable='between(t\\,${segStart}\\,${segEnd})'[${nextOutput}]`;
        lastOutput = nextOutput;
      }
    }
    
    if (addEnglishSubs) {
      for (const seg of segments) {
        const englishText = escapeFFmpegText(seg.text);
        const segStart = seg.start - start;
        const segEnd = seg.end - start;
        const nextOutput = `e${filterIdx++}`;
        
        captionFilters += `;[${lastOutput}]drawtext=text='${englishText}':x=(w-text_w)/2:y=h*0.80:fontsize=36:fontcolor=gray:box=1:boxcolor=black@0.6:boxborderw=10:enable='between(t\\,${segStart}\\,${segEnd})'[${nextOutput}]`;
        lastOutput = nextOutput;
      }
    }
    
    ffmpegFilters = `-filter_complex "${filterComplex}${captionFilters}"`;
    ffmpegMap = `-map "[${lastOutput}]" -map 0:a`;
  } else {
    // Using simple -vf filters for crop style
    ffmpegFilters = filters.length > 0 ? `-vf "${filters.join(',')}"` : '';
  }

  const cmd = [
    'ffmpeg',
    '-y', // Overwrite output
    `-ss ${start}`, // Start time
    `-t ${duration}`, // Duration
    `-i "${inputVideo}"`, // Input
    ffmpegFilters,
    ffmpegMap,
    '-c:v libx264', // Video codec
    '-preset fast', // Encoding speed
    '-crf 23', // Quality (lower = better, 23 is good)
    '-c:a aac', // Audio codec
    '-b:a 128k', // Audio bitrate
    '-movflags +faststart', // Optimize for streaming
    `"${outputPath}"`,
  ].filter(Boolean).join(' ');

  // Execute FFmpeg
  execSync(cmd, { stdio: 'pipe' });
}

/**
 * Escape text for FFmpeg drawtext filter
 */
function escapeFFmpegText(text) {
  return text
    .replace(/\\/g, '\\\\')    // Backslash
    .replace(/'/g, "\\'")       // Single quote
    .replace(/:/g, '\\:')       // Colon
    .replace(/\[/g, '\\[')      // Left bracket
    .replace(/\]/g, '\\]')      // Right bracket
    .replace(/%/g, '\\%')       // Percent
    .slice(0, 100);             // Limit length for readability
}

/**
 * CLI interface
 */
if (require.main === module) {
  const args = process.argv.slice(2);

  if (args.length === 0 || args.includes('--help') || args.includes('-h')) {
    console.log(`
TikTok Clip Generator for Immersion Pipeline

Usage:
  node create-tiktok-clips.js <job-directory> [options]

Arguments:
  job-directory         Path to Immersion job output directory

Options:
  --clips <number>      Number of clips to generate (default: 5)
  --duration <seconds>  Target clip duration (default: 45)
  --min <seconds>       Minimum clip duration (default: 15)
  --format <style>      Video format style (default: blur)
                          blur   - Full video with blurred background (best for most content)
                          square - Square video in center (best for movie clips/reviews)
                          crop   - Simple center crop (fastest, may cut content)
  --no-captions         Don't burn in Spanish captions
  --no-english          Don't add English subtitles
  --no-vertical         Keep original aspect ratio
  --output <directory>  Custom output directory

Examples:
  node create-tiktok-clips.js output/job-abc123
  node create-tiktok-clips.js output/job-abc123 --clips 3 --duration 30
  node create-tiktok-clips.js output/job-abc123 --format square --no-english
  node create-tiktok-clips.js output/job-abc123 --no-english --output ./clips
`);
    process.exit(0);
  }

  const jobDir = args[0];
  const options = {
    maxClips: parseInt(args[args.indexOf('--clips') + 1] || '5'),
    clipDuration: parseInt(args[args.indexOf('--duration') + 1] || '45'),
    minClipDuration: parseInt(args[args.indexOf('--min') + 1] || '15'),
    formatStyle: args.includes('--format') ? args[args.indexOf('--format') + 1] : 'blur',
    addCaptions: !args.includes('--no-captions'),
    addEnglishSubs: !args.includes('--no-english'),
    verticalFormat: !args.includes('--no-vertical'),
    outputDir: args.includes('--output') ? args[args.indexOf('--output') + 1] : null,
  };

  createTikTokClips(jobDir, options)
    .then(clips => {
      console.log('\n✨ Done! Your TikTok clips are ready to post.\n');
      process.exit(0);
    })
    .catch(error => {
      console.error(`\n❌ Error: ${error.message}\n`);
      process.exit(1);
    });
}

module.exports = { createTikTokClips };
