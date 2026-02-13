#!/usr/bin/env node
/**
 * Test Voice Cloning with XTTS via Replicate
 * 
 * Usage:
 *   node test-voice-clone.js <youtube-id> <level> <source> <target> [--lipsync]
 *   node test-voice-clone.js 1aA1WGON49E B1 english spanish --lipsync
 *   node test-voice-clone.js PXAOZwvv04 B1 indonesian english
 * 
 * Flags:
 *   --lipsync    Run AI lip-sync after dubbing (costs extra ~$0.02/sec)
 *   --job=ID     Resume from existing job directory
 * 
 * This will:
 *   1. Download video and extract audio
 *   2. Transcribe with speaker diarization
 *   3. Extract voice samples for each speaker
 *   4. Translate to target language
 *   5. Generate TTS using cloned voices (XTTS via Replicate)
 *   6. Merge audio
 *   7. (Optional) AI Lip-sync with Sync Labs
 * 
 * Cost: ~$0.30-0.60 per 5-minute video (TTS only)
 *       +$0.02/sec for lip-sync (~$6 for 5 min video)
 */

require("dotenv").config();
const path = require("path");
const fs = require("fs");
const v2 = require("./src/v2");

// ════════════════════════════════════════════════════════════════════════════
// CLI Args
// ════════════════════════════════════════════════════════════════════════════

const args = process.argv.slice(2);
const flags = args.filter(a => a.startsWith("--"));
const positional = args.filter(a => !a.startsWith("--"));

const videoId = positional[0] || "IdTMDpizis8";
const level = positional[1] || "B1";
const sourceLanguage = positional[2] || "spanish";  // Language IN the video
const targetLanguage = positional[3] || "english";  // Language to translate TO

// Flags
const doLipsync = flags.includes("--lipsync");
const jobFlag = flags.find(f => f.startsWith("--job="));
const resumeJobId = jobFlag ? jobFlag.split("=")[1] : null;

console.log(`
╔══════════════════════════════════════════════════════════════════╗
║  🎤 VOICE CLONE TEST - XTTS via Replicate                        ║
╠══════════════════════════════════════════════════════════════════╣
║  Video: ${videoId.padEnd(54)}║
║  Level: ${level.padEnd(54)}║
║  Source: ${sourceLanguage.padEnd(53)}║
║  Target: ${targetLanguage.padEnd(53)}║
║  TTS: XTTS (Replicate) - Voice Cloning                           ║
║  Lip-sync: ${(doLipsync ? "YES (Sync Labs)" : "No").padEnd(51)}║
╚══════════════════════════════════════════════════════════════════╝
`);

// ════════════════════════════════════════════════════════════════════════════
// Main Pipeline
// ════════════════════════════════════════════════════════════════════════════

async function runVoiceCloneTest() {
  const jobId = `voiceclone_${videoId}_${Date.now()}`;
  const jobDir = path.join(__dirname, "output", jobId);
  fs.mkdirSync(jobDir, { recursive: true });
  
  console.log(`📁 Job directory: ${jobDir}\n`);
  
  try {
    // ══════════════════════════════════════════════════════════════════════
    // Step 1: Ingest
    // ══════════════════════════════════════════════════════════════════════
    console.log(`${"═".repeat(60)}`);
    console.log(`📥 STEP 1: Ingest Video`);
    console.log(`${"═".repeat(60)}`);
    
    const ingestResult = await v2.ingest(
      `https://www.youtube.com/watch?v=${videoId}`,
      jobDir,
      { extractAudio: true }
    );
    console.log(`   ✅ Downloaded: ${ingestResult.videoPath}`);
    console.log(`   ✅ Audio: ${ingestResult.audioPath}`);
    console.log(`   ⏱️ Duration: ${ingestResult.duration?.toFixed(1)}s`);
    
    // ══════════════════════════════════════════════════════════════════════
    // Step 2: Split (optional - extract vocals)
    // ══════════════════════════════════════════════════════════════════════
    console.log(`\n${"═".repeat(60)}`);
    console.log(`🎵 STEP 2: Audio Separation`);
    console.log(`${"═".repeat(60)}`);
    
    const splitResult = await v2.split(ingestResult.audioPath, jobDir);
    console.log(`   ✅ Vocals: ${splitResult.vocals}`);
    console.log(`   ✅ Background: ${splitResult.background || "N/A"}`);
    
    // ══════════════════════════════════════════════════════════════════════
    // Step 3: Transcribe with diarization
    // ══════════════════════════════════════════════════════════════════════
    console.log(`\n${"═".repeat(60)}`);
    console.log(`📝 STEP 3: Transcribe (with speaker diarization)`);
    console.log(`${"═".repeat(60)}`);
    
    const transcribeResult = await v2.transcribe(splitResult.vocals, {
      diarize: true,
      language: sourceLanguage, // Transcribe in source language
    });
    
    const segments = transcribeResult.segments || [];
    const speakers = [...new Set(segments.map(s => s.speaker).filter(Boolean))];
    
    console.log(`   ✅ Segments: ${segments.length}`);
    console.log(`   ✅ Speakers: ${speakers.length} (${speakers.join(", ")})`);
    console.log(`   🌐 Detected language: ${transcribeResult.language}`);
    
    // Save transcription
    fs.writeFileSync(
      path.join(jobDir, "transcription.json"),
      JSON.stringify(transcribeResult, null, 2)
    );
    
    // ══════════════════════════════════════════════════════════════════════
    // Step 4: Extract Voice Samples for each speaker
    // ══════════════════════════════════════════════════════════════════════
    console.log(`\n${"═".repeat(60)}`);
    console.log(`🎤 STEP 4: Extract Voice Samples`);
    console.log(`${"═".repeat(60)}`);
    
    const voiceSamples = await v2.extractAllVoiceSamples(
      ingestResult.videoPath,
      segments,
      jobDir
    );
    
    console.log(`   ✅ Extracted samples for ${Object.keys(voiceSamples).length} speaker(s)`);
    for (const [speaker, sample] of Object.entries(voiceSamples)) {
      console.log(`      - ${speaker}: ${sample.duration.toFixed(1)}s sample`);
    }
    
    // ══════════════════════════════════════════════════════════════════════
    // Step 5: Translate
    // ══════════════════════════════════════════════════════════════════════
    console.log(`\n${"═".repeat(60)}`);
    console.log(`🌍 STEP 5: Translate ${sourceLanguage} → ${targetLanguage}`);
    console.log(`${"═".repeat(60)}`);
    
    const translatedSegments = await v2.translate(segments, {
      targetLanguage: targetLanguage,
      level: level,
      mode: "narrator", // Natural speech, not forced timing
    });
    
    console.log(`   ✅ Translated ${translatedSegments.length} segments`);
    
    // Preview first few
    console.log(`\n   📖 Preview (first 3 segments):`);
    for (let i = 0; i < Math.min(3, translatedSegments.length); i++) {
      const seg = translatedSegments[i];
      if (!seg) {
        console.log(`   [${i}] NULL SEGMENT`);
        continue;
      }
      const origText = (seg.originalText || seg.text || "").substring(0, 35);
      const transText = (seg.translatedText || "").substring(0, 35);
      console.log(`   [${seg.speaker || "?"}] "${origText}" → "${transText}"`);
    }
    
    // Debug: check for empty translations
    const emptyCount = translatedSegments.filter(s => !s || !s.translatedText).length;
    if (emptyCount > 0) {
      console.log(`   ⚠️ ${emptyCount} segments have no translatedText!`);
    }
    
    // Save translations
    fs.writeFileSync(
      path.join(jobDir, "translations.json"),
      JSON.stringify(translatedSegments, null, 2)
    );
    
    // ══════════════════════════════════════════════════════════════════════
    // Step 6: Generate TTS with XTTS (Voice Cloning!)
    // ══════════════════════════════════════════════════════════════════════
    console.log(`\n${"═".repeat(60)}`);
    console.log(`🎙️ STEP 6: Voice Clone TTS (XTTS via Replicate)`);
    console.log(`${"═".repeat(60)}`);
    console.log(`   💰 Estimated cost: ~$0.30-0.60 (vs $5+ for ElevenLabs clone)`);
    
    const ttsResult = await v2.generateAndAlignXTTS(
      translatedSegments,
      voiceSamples,
      jobDir,
      {
        language: targetLanguage, // Generate TTS in target language
        level,
        concurrency: 10,           // Replicate allows 600/min
        mergeOverlaps: false,      // Keep segments separate
        adjustSpeed: true,         // Gentle speedup (max 1.5x)
        skipExtreme: true,         // Skip segments needing >1.5x speedup
      }
    );
    
    console.log(`\n   ✅ Generated ${ttsResult.stats.successful}/${ttsResult.stats.total} segments`);
    if (ttsResult.stats.failed > 0) {
      console.log(`   ⚠️ Failed: ${ttsResult.stats.failed}`);
    }
    
    // ══════════════════════════════════════════════════════════════════════
    // Step 7: Merge Audio
    // ══════════════════════════════════════════════════════════════════════
    console.log(`\n${"═".repeat(60)}`);
    console.log(`🔊 STEP 7: Merge Audio`);
    console.log(`${"═".repeat(60)}`);
    
    const dubbedAudioPath = path.join(jobDir, "dubbed_audio_cloned.m4a");
    
    // Prepare segments for merge (merge expects alignedFile field)
    const mergeSegments = ttsResult.results
      .filter(r => r.audioPath)
      .map(r => ({
        ...r.segment,
        alignedFile: r.audioPath,  // merge looks for alignedFile
        alignedDuration: r.duration,
        audioPath: r.audioPath,
        generatedDuration: r.duration,
      }));
    
    // Use background audio from split
    const backgroundPath = splitResult.background;
    
    if (!backgroundPath || !fs.existsSync(backgroundPath)) {
      console.log(`   ⚠️ No background audio found, generating TTS-only output`);
    }
    
    // merge(backgroundPath, segments, outputPath, options)
    await v2.merge(
      backgroundPath,
      mergeSegments,
      dubbedAudioPath,
      {
        totalDuration: ingestResult.duration || 80,
        mode: "synced",
        backgroundVolume: backgroundPath ? 0.3 : 0,
      }
    );
    
    console.log(`   ✅ Dubbed audio: ${dubbedAudioPath}`);
    
    // ══════════════════════════════════════════════════════════════════════
    // Step 8: Lip-sync (Optional)
    // ══════════════════════════════════════════════════════════════════════
    let lipsyncVideoPath = null;
    
    if (doLipsync) {
      console.log(`\n${"═".repeat(60)}`);
      console.log(`👄 STEP 8: AI Lip-Sync (Sync Labs)`);
      console.log(`${"═".repeat(60)}`);
      
      if (!process.env.SYNCLABS_API_KEY) {
        console.log(`   ⚠️ SYNCLABS_API_KEY not set, skipping lip-sync`);
      } else {
        lipsyncVideoPath = path.join(jobDir, "dubbed_video_lipsync.mp4");
        
        // Use the cheaper model
        const lipsyncResult = await v2.lipsync(
          ingestResult.videoPath,
          dubbedAudioPath,
          lipsyncVideoPath,
          { model: "lipsync-1.9.0-beta" } // Cheaper model
        );
        
        console.log(`   ✅ Lip-sync complete!`);
        console.log(`   ⏱️ Processing time: ${lipsyncResult.processingTime?.toFixed(0)}s`);
      }
    } else {
      console.log(`\n   💡 Tip: Add --lipsync flag to generate lip-synced video`);
    }
    
    // ══════════════════════════════════════════════════════════════════════
    // Done!
    // ══════════════════════════════════════════════════════════════════════
    const finalOutput = lipsyncVideoPath && fs.existsSync(lipsyncVideoPath) 
      ? lipsyncVideoPath 
      : dubbedAudioPath;
    
    console.log(`
╔══════════════════════════════════════════════════════════════════╗
║  ✅ VOICE CLONE PIPELINE COMPLETE!                               ║
╠══════════════════════════════════════════════════════════════════╣
║  Output: ${jobDir.padEnd(53)}║
║                                                                  ║
║  Files:                                                          ║
║    - dubbed_audio_cloned.m4a (cloned voice dubbed audio)         ║${lipsyncVideoPath ? `
║    - dubbed_video_lipsync.mp4 (lip-synced video!)                ║` : ""}
║    - voice_sample_*.wav (extracted speaker samples)              ║
║    - segment_*_xtts.wav (individual TTS segments)                ║
╚══════════════════════════════════════════════════════════════════╝
`);
    
    console.log(`\n🎧 Play the result:`);
    console.log(`   mpv "${finalOutput}"`);
    
    if (!doLipsync) {
      console.log(`\n💡 Want lip-synced video? Run again with --lipsync flag`);
    }
    
  } catch (err) {
    console.error(`\n❌ Error: ${err.message}`);
    console.error(err.stack);
    process.exit(1);
  }
}

// Run it!
runVoiceCloneTest();
