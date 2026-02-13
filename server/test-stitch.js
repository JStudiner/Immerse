#!/usr/bin/env node
/**
 * Test the improved stitching with existing job data
 * Usage: node test-stitch.js <job-id> [options]
 * 
 * Options:
 *   --analyze     Only analyze timing, don't stitch
 *   --precise     Use precise adelay method instead of concat
 *   --output      Custom output filename
 */

const path = require("path");
const fs = require("fs");
const { stitchAudio, stitchAudioPrecise, analyzeTiming, getAudioDuration } = require("./src/stitch");

async function main() {
  const args = process.argv.slice(2);
  
  if (args.length === 0 || args[0] === "--help") {
    console.log(`
🎬 Immersion Audio Stitcher

Usage:
  node test-stitch.js <job-id>              Stitch with improved algorithm
  node test-stitch.js <job-id> --analyze    Analyze timing issues only  
  node test-stitch.js <job-id> --precise    Use precise adelay method
  node test-stitch.js --list                List available jobs

Examples:
  node test-stitch.js b01d7816-0910-4bf0-9e76-944ab7b892f6
  node test-stitch.js b01d7816-0910-4bf0-9e76-944ab7b892f6 --analyze
  node test-stitch.js b01d7816-0910-4bf0-9e76-944ab7b892f6 --precise
`);
    return;
  }

  // List available jobs
  if (args[0] === "--list") {
    const outputDir = path.join(__dirname, "output");
    const jobs = fs.readdirSync(outputDir).filter(d => {
      const manifestPath = path.join(outputDir, d, "manifest.json");
      return fs.existsSync(manifestPath);
    });
    
    console.log("\n📂 Available jobs with manifests:\n");
    for (const job of jobs) {
      const manifestPath = path.join(outputDir, job, "manifest.json");
      const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf-8"));
      const dubbedPath = path.join(outputDir, job, "dubbed_audio.mp3");
      const hasDubbed = fs.existsSync(dubbedPath);
      
      console.log(`   ${job}`);
      console.log(`   ├─ Video: ${manifest.videoId}`);
      console.log(`   ├─ Level: ${manifest.level}`);
      console.log(`   ├─ Tracks: ${manifest.tracks.length}`);
      console.log(`   └─ Dubbed: ${hasDubbed ? "✅" : "❌"}\n`);
    }
    return;
  }

  const jobId = args[0];
  const analyzeOnly = args.includes("--analyze");
  const usePrecise = args.includes("--precise");
  
  const outputDir = path.join(__dirname, "output", jobId);
  const manifestPath = path.join(outputDir, "manifest.json");

  if (!fs.existsSync(manifestPath)) {
    console.error(`❌ Manifest not found: ${manifestPath}`);
    console.log("   Run with --list to see available jobs");
    return;
  }

  console.log(`\n🎬 Processing job: ${jobId}\n`);

  // Analyze timing first
  console.log("━".repeat(60));
  const analysis = analyzeTiming(manifestPath);
  console.log("━".repeat(60));

  if (analyzeOnly) {
    // Show more detailed analysis
    const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf-8"));
    const tracks = manifest.tracks.sort((a, b) => a.start - b.start);
    
    console.log("\n📊 Detailed Track Analysis:\n");
    console.log("  Index │ Start   │ Target  │ Actual  │  Diff   │ Status");
    console.log("  ──────┼─────────┼─────────┼─────────┼─────────┼────────");
    
    for (const track of tracks) {
      const chunkFile = path.join(outputDir, path.basename(track.audioUrl));
      const actualDuration = fs.existsSync(chunkFile) ? getAudioDuration(chunkFile) : null;
      const diff = actualDuration ? actualDuration - track.duration : null;
      
      let status = "✓";
      if (diff > 0.5) status = "⏩ TOO LONG";
      else if (diff < -0.5) status = "⏸️ TOO SHORT";
      else if (diff !== null && Math.abs(diff) > 0.1) status = "~";
      
      console.log(
        `  ${String(track.index).padStart(5)} │ ${track.start.toFixed(2).padStart(7)}s │ ` +
        `${track.duration.toFixed(2).padStart(7)}s │ ${(actualDuration?.toFixed(2) || "N/A").padStart(7)}s │ ` +
        `${(diff?.toFixed(2) || "N/A").padStart(7)}s │ ${status}`
      );
    }
    
    // Summary
    const diffs = tracks
      .map((t) => {
        const f = path.join(outputDir, path.basename(t.audioUrl));
        return fs.existsSync(f) ? getAudioDuration(f) - t.duration : null;
      })
      .filter((d) => d !== null);
    
    if (diffs.length > 0) {
      const totalDrift = diffs.reduce((a, b) => a + b, 0);
      const avgDrift = totalDrift / diffs.length;
      const shortCount = diffs.filter((d) => d < -0.1).length;
      const longCount = diffs.filter((d) => d > 0.1).length;
      
      console.log("\n  Summary:");
      console.log(`  ├─ Total drift: ${totalDrift.toFixed(2)}s`);
      console.log(`  ├─ Avg drift per chunk: ${avgDrift.toFixed(2)}s`);
      console.log(`  ├─ Chunks too short: ${shortCount}`);
      console.log(`  └─ Chunks too long: ${longCount}`);
    }
    
    return;
  }

  // Perform stitching
  console.log("\n" + "━".repeat(60));
  
  const outputFileName = usePrecise ? "dubbed_audio_precise.mp3" : "dubbed_audio_v2.mp3";
  
  try {
    let result;
    if (usePrecise) {
      result = await stitchAudioPrecise(manifestPath, outputFileName);
    } else {
      result = await stitchAudio(manifestPath, outputFileName, {
        padShortAudio: true,
        speedUpLongAudio: true,
        fillGaps: true,
        crossfadeDuration: 0.05,
      });
    }
    
    console.log("━".repeat(60));
    console.log("\n✅ Done! New audio saved as:", outputFileName);
    console.log("   Compare with original dubbed_audio.mp3 to see improvements\n");
    
    // Show comparison if original exists
    const originalPath = path.join(outputDir, "dubbed_audio.mp3");
    if (fs.existsSync(originalPath)) {
      const originalDuration = getAudioDuration(originalPath);
      const newDuration = result.duration;
      const targetDuration = result.targetDuration;
      
      console.log("📊 Comparison:");
      console.log(`   Original:  ${originalDuration?.toFixed(2)}s`);
      console.log(`   New:       ${newDuration.toFixed(2)}s`);
      console.log(`   Target:    ${targetDuration.toFixed(2)}s`);
      console.log(`   Improvement: ${Math.abs((originalDuration || 0) - targetDuration).toFixed(2)}s → ${Math.abs(newDuration - targetDuration).toFixed(2)}s drift\n`);
    }
    
  } catch (error) {
    console.error("❌ Stitching failed:", error.message);
    console.error(error.stack);
  }
}

main();

