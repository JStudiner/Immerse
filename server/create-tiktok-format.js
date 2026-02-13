#!/usr/bin/env node
/**
 * TikTok Format Converter
 * 
 * Converts videos to TikTok-friendly vertical format with:
 * - Blurred background (from the video itself)
 * - Centered main video (square or letterboxed)
 * - Optional text overlays (top/bottom)
 * 
 * Usage:
 *   node create-tiktok-format.js <input> [options]
 * 
 * Examples:
 *   node create-tiktok-format.js video.mp4
 *   node create-tiktok-format.js video.mp4 --style square --top-text "POV: Learning Spanish"
 *   node create-tiktok-format.js video.mp4 --style letterbox --bottom-text "Follow for more!"
 */

const { execSync } = require('child_process');
const path = require('path');
const fs = require('fs');

// TikTok dimensions
const TIKTOK_WIDTH = 1080;
const TIKTOK_HEIGHT = 1920;

// Style presets
const STYLES = {
  // Square video in center with blurred background
  square: {
    videoHeight: 1080,  // Square: 1080x1080
    topPadding: 420,
    bottomPadding: 420,
  },
  // Letterbox (wider video, less padding)
  letterbox: {
    videoHeight: 810,   // 16:9 at 1080 width = 607, but we go bigger
    topPadding: 555,
    bottomPadding: 555,
  },
  // Cinematic (2.35:1 aspect ratio feel)
  cinematic: {
    videoHeight: 460,   // Very wide letterbox
    topPadding: 730,
    bottomPadding: 730,
  },
  // Large (video takes most of screen)
  large: {
    videoHeight: 1280,
    topPadding: 320,
    bottomPadding: 320,
  },
  // Split (good for before/after or comparison)
  split: {
    videoHeight: 960,
    topPadding: 480,
    bottomPadding: 480,
  },
};

// Background styles
const BACKGROUNDS = {
  blur: 'blur',           // Blurred version of video
  black: 'black',         // Solid black
  gradient: 'gradient',   // Dark gradient
  color: 'color',         // Custom color
};

/**
 * Create TikTok-formatted video
 */
function createTikTokFormat(inputPath, outputPath, options = {}) {
  const {
    style = 'square',
    background = 'blur',
    topText = null,
    bottomText = null,
    textColor = 'white',
    textSize = 60,
    fontFile = null,  // Path to custom font
    backgroundColor = '#000000',
  } = options;

  const styleConfig = STYLES[style] || STYLES.square;
  
  console.log(`\n🎬 Creating TikTok format: ${style}`);
  console.log(`   Input: ${path.basename(inputPath)}`);
  console.log(`   Output: ${path.basename(outputPath)}`);
  console.log(`   Background: ${background}`);
  
  // Build FFmpeg filter complex
  let filterComplex = '';
  
  if (background === 'blur') {
    // Create blurred background from the video itself
    filterComplex = `
      [0:v]scale=${TIKTOK_WIDTH}:${TIKTOK_HEIGHT}:force_original_aspect_ratio=increase,crop=${TIKTOK_WIDTH}:${TIKTOK_HEIGHT},boxblur=20:5[bg];
      [0:v]scale=${TIKTOK_WIDTH}:-2:force_original_aspect_ratio=decrease,pad=${TIKTOK_WIDTH}:${styleConfig.videoHeight}:(ow-iw)/2:(oh-ih)/2:color=black[fg];
      [bg][fg]overlay=(W-w)/2:(H-h)/2[v1]
    `;
  } else if (background === 'black') {
    // Black background
    filterComplex = `
      color=c=black:s=${TIKTOK_WIDTH}x${TIKTOK_HEIGHT}:d=1[bg];
      [0:v]scale=${TIKTOK_WIDTH}:-2:force_original_aspect_ratio=decrease[fg];
      [bg][fg]overlay=(W-w)/2:(H-h)/2:shortest=1[v1]
    `;
  } else if (background === 'gradient') {
    // Dark gradient background
    filterComplex = `
      color=c=black:s=${TIKTOK_WIDTH}x${TIKTOK_HEIGHT}:d=1,
      geq=lum='if(lt(Y,H/3),40+Y/3*0.3,if(gt(Y,H*2/3),40+(H-Y)/3*0.3,50))':cr=128:cb=128[bg];
      [0:v]scale=${TIKTOK_WIDTH}:-2:force_original_aspect_ratio=decrease[fg];
      [bg][fg]overlay=(W-w)/2:(H-h)/2:shortest=1[v1]
    `;
  } else {
    // Solid color background
    filterComplex = `
      color=c=${backgroundColor}:s=${TIKTOK_WIDTH}x${TIKTOK_HEIGHT}:d=1[bg];
      [0:v]scale=${TIKTOK_WIDTH}:-2:force_original_aspect_ratio=decrease[fg];
      [bg][fg]overlay=(W-w)/2:(H-h)/2:shortest=1[v1]
    `;
  }
  
  // Add text overlays
  let lastOutput = 'v1';
  
  if (topText) {
    const escapedText = topText.replace(/'/g, "'\\''").replace(/:/g, '\\:');
    const fontOpt = fontFile ? `:fontfile='${fontFile}'` : '';
    filterComplex += `;
      [${lastOutput}]drawtext=text='${escapedText}':fontsize=${textSize}:fontcolor=${textColor}:x=(w-text_w)/2:y=${styleConfig.topPadding / 2 - textSize / 2}${fontOpt}:box=1:boxcolor=black@0.5:boxborderw=10[v2]
    `;
    lastOutput = 'v2';
  }
  
  if (bottomText) {
    const escapedText = bottomText.replace(/'/g, "'\\''").replace(/:/g, '\\:');
    const fontOpt = fontFile ? `:fontfile='${fontFile}'` : '';
    const nextOutput = topText ? 'v3' : 'v2';
    const yPos = TIKTOK_HEIGHT - styleConfig.bottomPadding / 2 - textSize / 2;
    filterComplex += `;
      [${lastOutput}]drawtext=text='${escapedText}':fontsize=${textSize}:fontcolor=${textColor}:x=(w-text_w)/2:y=${yPos}${fontOpt}:box=1:boxcolor=black@0.5:boxborderw=10[${nextOutput}]
    `;
    lastOutput = nextOutput;
  }
  
  // Clean up filter (remove extra whitespace/newlines)
  filterComplex = filterComplex.replace(/\s+/g, ' ').trim();
  
  // Build FFmpeg command
  const cmd = `ffmpeg -y -i "${inputPath}" -filter_complex "${filterComplex}" -map "[${lastOutput}]" -map 0:a? -c:v libx264 -preset fast -crf 23 -c:a aac -b:a 192k -r 30 "${outputPath}"`;
  
  console.log(`\n   🔧 Running FFmpeg...`);
  
  try {
    execSync(cmd, { stdio: 'pipe', timeout: 600000 });
    
    const stats = fs.statSync(outputPath);
    console.log(`\n   ✅ Created: ${path.basename(outputPath)}`);
    console.log(`      Size: ${(stats.size / 1024 / 1024).toFixed(1)} MB`);
    
    return { success: true, outputPath, size: stats.size };
  } catch (error) {
    console.error(`\n   ❌ Error: ${error.message}`);
    return { success: false, error: error.message };
  }
}

/**
 * Batch process multiple videos
 */
function batchProcess(inputDir, outputDir, options = {}) {
  const files = fs.readdirSync(inputDir)
    .filter(f => /\.(mp4|mov|mkv|webm|avi)$/i.test(f));
  
  console.log(`\n📦 Batch processing ${files.length} videos...`);
  
  fs.mkdirSync(outputDir, { recursive: true });
  
  const results = [];
  for (const file of files) {
    const inputPath = path.join(inputDir, file);
    const outputPath = path.join(outputDir, `tiktok_${file.replace(/\.[^.]+$/, '.mp4')}`);
    
    results.push(createTikTokFormat(inputPath, outputPath, options));
  }
  
  const successful = results.filter(r => r.success).length;
  console.log(`\n✅ Completed: ${successful}/${files.length}`);
  
  return results;
}

// CLI handling
if (require.main === module) {
  const args = process.argv.slice(2);
  
  if (args.length === 0 || args.includes('--help')) {
    console.log(`
🎬 TikTok Format Converter

Usage:
  node create-tiktok-format.js <input> [options]

Options:
  --style <style>       Video style: square, letterbox, cinematic, large, split (default: square)
  --background <bg>     Background: blur, black, gradient, color (default: blur)
  --top-text <text>     Text to display at top
  --bottom-text <text>  Text to display at bottom
  --text-size <size>    Font size (default: 60)
  --text-color <color>  Text color (default: white)
  --output <path>       Output file path (default: input_tiktok.mp4)

Examples:
  node create-tiktok-format.js movie.mp4
  node create-tiktok-format.js movie.mp4 --style square --top-text "POV: You speak Spanish now"
  node create-tiktok-format.js clip.mp4 --style cinematic --background blur --bottom-text "Follow for more!"

Styles:
  square    - 1:1 video centered (most popular for movie clips)
  letterbox - 16:9 centered with padding
  cinematic - Wide 2.35:1 look with big padding (great for movie scenes)
  large     - Bigger video, less padding
  split     - Good for before/after comparisons
    `);
    process.exit(0);
  }
  
  const inputPath = args[0];
  
  if (!fs.existsSync(inputPath)) {
    console.error(`❌ File not found: ${inputPath}`);
    process.exit(1);
  }
  
  // Parse options
  const options = {};
  for (let i = 1; i < args.length; i += 2) {
    const key = args[i].replace(/^--/, '').replace(/-/g, '');
    const value = args[i + 1];
    
    if (key === 'toptext') options.topText = value;
    else if (key === 'bottomtext') options.bottomText = value;
    else if (key === 'textsize') options.textSize = parseInt(value);
    else if (key === 'textcolor') options.textColor = value;
    else options[key] = value;
  }
  
  // Generate output path
  const outputPath = options.output || 
    inputPath.replace(/\.[^.]+$/, '_tiktok.mp4');
  
  createTikTokFormat(inputPath, outputPath, options);
}

module.exports = {
  createTikTokFormat,
  batchProcess,
  STYLES,
  BACKGROUNDS,
  TIKTOK_WIDTH,
  TIKTOK_HEIGHT,
};
