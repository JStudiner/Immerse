/**
 * Immersion v2 - Transcribe Module (Lemonfox Whisper)
 *
 * Transcribes vocals audio to get speech segments with timestamps
 * Uses Lemonfox Speech-to-Text API (Whisper v3)
 *
 * Features:
 * - Word-level timestamps
 * - Speaker diarization
 * - Caching for instant re-runs
 * - $0.50 per 3 hours (~$0.003/min)
 */

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { execSync } = require("child_process");

const LEMONFOX_API_KEY = process.env.LEMONFOX_API_KEY;
const STT_ENDPOINT = "https://api.lemonfox.ai/v1/audio/transcriptions";

// Max file size for Lemonfox API (25MB to be safe)
const MAX_UPLOAD_SIZE = 25 * 1024 * 1024;

// Transcription cache directory
const TRANSCRIBE_CACHE_DIR = path.join(__dirname, "..", "..", "cache", "transcriptions");

/**
 * Generate cache key for audio file
 */
function getTranscribeKey(audioPath) {
  const stats = fs.statSync(audioPath);
  const fileSize = stats.size;
  
  // Read first 64KB for hash
  const fd = fs.openSync(audioPath, 'r');
  const buffer = Buffer.alloc(Math.min(65536, fileSize));
  fs.readSync(fd, buffer, 0, buffer.length, 0);
  fs.closeSync(fd);
  
  const hash = crypto.createHash("md5").update(buffer).digest("hex").substring(0, 12);
  return `transcribe_${fileSize}_${hash}`;
}

/**
 * Get cached transcription
 */
function getCachedTranscription(cacheKey) {
  const cachePath = path.join(TRANSCRIBE_CACHE_DIR, `${cacheKey}.json`);
  if (fs.existsSync(cachePath)) {
    try {
      const data = JSON.parse(fs.readFileSync(cachePath, 'utf-8'));
      if (data.segments && data.segments.length > 0) {
        return data;
      }
    } catch {}
  }
  return null;
}

/**
 * Cache transcription result
 */
function cacheTranscription(result, cacheKey) {
  fs.mkdirSync(TRANSCRIBE_CACHE_DIR, { recursive: true });
  const cachePath = path.join(TRANSCRIBE_CACHE_DIR, `${cacheKey}.json`);
  fs.writeFileSync(cachePath, JSON.stringify(result, null, 2));
  console.log(`   💾 Cached transcription for future use`);
}

/**
 * Compress audio to MP3 for smaller upload size
 * @param {string} inputPath - Path to input audio
 * @param {string} outputPath - Path for compressed output
 * @returns {string} Path to compressed file
 */
function compressAudio(inputPath, outputPath) {
  // Use 64kbps mono - good enough for speech, very small file
  execSync(
    `ffmpeg -y -i "${inputPath}" -ac 1 -ar 16000 -b:a 64k "${outputPath}"`,
    { stdio: "pipe", timeout: 120000 }
  );
  return outputPath;
}

/**
 * Transcribe audio file using Lemonfox Whisper API
 *
 * @param {string} audioPath - Path to audio file (vocals.mp3)
 * @param {object} options - Transcription options
 * @returns {Promise<object>} Transcription result with segments
 */
async function transcribe(audioPath, options = {}) {
  const {
    language = "english",
    speakerLabels = true, // Enable speaker diarization
    timestampGranularities = ["word", "segment"], // Get word-level timestamps
    useCache = true, // Enable caching by default
  } = options;

  console.log(`\n${"═".repeat(60)}`);
  console.log(`🎤 TRANSCRIBE: Speech-to-Text (Lemonfox Whisper)`);
  console.log(`${"═".repeat(60)}`);
  
  // Check cache first
  if (useCache) {
    const cacheKey = getTranscribeKey(audioPath);
    const cached = getCachedTranscription(cacheKey);
    
    if (cached) {
      console.log(`   ⚡ Found in cache!`);
      console.log(`   ✅ Loaded ${cached.segments.length} segments from cache`);
      console.log(`   💰 Saved API cost and ~20 seconds!`);
      return { ...cached, fromCache: true, cacheKey };
    }
    
    options._cacheKey = cacheKey;
  }

  // Check API key
  if (!LEMONFOX_API_KEY) {
    throw new Error(
      "LEMONFOX_API_KEY not set!\n" +
        "Add to .env: LEMONFOX_API_KEY=your_key_here"
    );
  }

  const originalSize = fs.statSync(audioPath).size;
  const ext = path.extname(audioPath).toLowerCase();
  
  console.log(`   Input: ${path.basename(audioPath)}`);
  console.log(`   Size: ${(originalSize / 1024 / 1024).toFixed(1)} MB`);
  console.log(`   Language: ${language}`);
  console.log(
    `   Speaker diarization: ${speakerLabels ? "enabled" : "disabled"}`
  );

  const startTime = Date.now();

  // Compress if file is too large or is WAV format
  let uploadPath = audioPath;
  let tempFile = null;
  
  if (originalSize > MAX_UPLOAD_SIZE || ext === ".wav") {
    console.log(`\n   🗜️ Compressing audio for upload...`);
    tempFile = audioPath.replace(ext, "_compressed.mp3");
    compressAudio(audioPath, tempFile);
    uploadPath = tempFile;
    
    const compressedSize = fs.statSync(uploadPath).size;
    console.log(`      ${(originalSize / 1024 / 1024).toFixed(1)} MB → ${(compressedSize / 1024 / 1024).toFixed(1)} MB (${((1 - compressedSize/originalSize) * 100).toFixed(0)}% smaller)`);
  }

  // Read file into buffer and create Blob (native fetch approach)
  const fileBuffer = fs.readFileSync(uploadPath);
  const fileBlob = new Blob([fileBuffer], { type: "audio/mpeg" });

  // Build form data using native FormData
  const form = new FormData();
  form.append("file", fileBlob, path.basename(uploadPath));
  form.append("language", language);
  form.append("response_format", "verbose_json"); // Get detailed response with timestamps
  form.append("speaker_labels", String(speakerLabels));

  // Request word and segment level timestamps
  for (const granularity of timestampGranularities) {
    form.append("timestamp_granularities[]", granularity);
  }

  console.log(`\n   📤 Uploading audio to Lemonfox...`);
  console.log(`   🔄 Transcribing (this may take a minute)...`);

  // Timeout: 5 minutes for long audio files
  const timeout = 300000;
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeout);

  try {
    const response = await fetch(STT_ENDPOINT, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LEMONFOX_API_KEY}`,
      },
      body: form,
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Lemonfox API error: ${response.status} ${errorText}`);
    }

    const result = await response.json();
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);

    // Process the response into our segment format
    const segments = processTranscriptionResult(result, speakerLabels);

    console.log(`\n   ✅ TRANSCRIPTION COMPLETE in ${elapsed}s`);
    console.log(`   📝 Full text: ${result.text?.substring(0, 100)}...`);
    console.log(`   📊 Segments: ${segments.length}`);

    if (speakerLabels && segments.length > 0) {
      const speakers = [
        ...new Set(segments.map((s) => s.speaker).filter(Boolean)),
      ];
      console.log(
        `   👥 Speakers detected: ${
          speakers.length > 0 ? speakers.join(", ") : "none"
        }`
      );
    }

    // Calculate speech statistics
    const totalSpeechDuration = segments.reduce(
      (sum, s) => sum + s.duration,
      0
    );
    console.log(`   ⏱️ Total speech: ${totalSpeechDuration.toFixed(1)}s`);

    // Cleanup temp file
    if (tempFile && fs.existsSync(tempFile)) {
      fs.unlinkSync(tempFile);
    }

    const transcriptionResult = {
      text: result.text,
      language: result.language || language,
      segments,
      words: result.words || [],
      duration: result.duration,
      processingTime: parseFloat(elapsed),
      fromCache: false,
    };
    
    // Cache the result for future use
    if (useCache && options._cacheKey) {
      cacheTranscription(transcriptionResult, options._cacheKey);
    }

    return transcriptionResult;
  } catch (error) {
    clearTimeout(timeoutId);
    
    // Cleanup temp file on error too
    if (tempFile && fs.existsSync(tempFile)) {
      try { fs.unlinkSync(tempFile); } catch {}
    }
    
    if (error.name === 'AbortError') {
      console.error(`   ❌ Transcription timed out after ${timeout/1000}s`);
      throw new Error(`Transcription timed out after ${timeout/1000}s`);
    }
    console.error(`   ❌ Transcription failed: ${error.message}`);
    throw error;
  }
}

/**
 * Process Lemonfox response into our segment format
 *
 * @param {object} result - Raw Lemonfox API response
 * @param {boolean} speakerLabels - Whether speaker labels were requested
 * @returns {array} Processed segments
 */
function processTranscriptionResult(result, speakerLabels) {
  const segments = [];

  // Handle different response formats
  if (result.segments && Array.isArray(result.segments)) {
    // Verbose JSON format with segments
    for (let i = 0; i < result.segments.length; i++) {
      const seg = result.segments[i];
      segments.push({
        index: i,
        start: seg.start,
        end: seg.end,
        duration: seg.end - seg.start,
        text: seg.text?.trim() || "",
        speaker: seg.speaker || (speakerLabels ? "SPEAKER_00" : null),
        confidence: seg.confidence || null,
        words: seg.words || [],
      });
    }
  } else if (result.words && Array.isArray(result.words)) {
    // Word-level response - group into segments by pauses
    const grouped = groupWordsIntoSegments(result.words);
    for (let i = 0; i < grouped.length; i++) {
      const group = grouped[i];
      segments.push({
        index: i,
        start: group.start,
        end: group.end,
        duration: group.end - group.start,
        text: group.text,
        speaker: group.speaker || "SPEAKER_00",
        words: group.words,
      });
    }
  } else if (result.text) {
    // Simple text response - create single segment
    segments.push({
      index: 0,
      start: 0,
      end: result.duration || 0,
      duration: result.duration || 0,
      text: result.text,
      speaker: "SPEAKER_00",
      words: [],
    });
  }

  return segments;
}

/**
 * Group words into segments based on pauses
 * Words with > 0.5s gap between them start a new segment
 *
 * @param {array} words - Array of word objects with timestamps
 * @returns {array} Grouped segments
 */
function groupWordsIntoSegments(words, pauseThreshold = 0.5) {
  if (!words || words.length === 0) return [];

  const segments = [];
  let currentSegment = {
    words: [words[0]],
    start: words[0].start,
    end: words[0].end,
    speaker: words[0].speaker,
  };

  for (let i = 1; i < words.length; i++) {
    const word = words[i];
    const gap = word.start - currentSegment.end;
    const speakerChanged =
      word.speaker && word.speaker !== currentSegment.speaker;

    // Start new segment if pause is long or speaker changed
    if (gap > pauseThreshold || speakerChanged) {
      currentSegment.text = currentSegment.words
        .map((w) => w.word || w.text)
        .join(" ");
      segments.push(currentSegment);

      currentSegment = {
        words: [word],
        start: word.start,
        end: word.end,
        speaker: word.speaker,
      };
    } else {
      currentSegment.words.push(word);
      currentSegment.end = word.end;
    }
  }

  // Don't forget last segment
  if (currentSegment.words.length > 0) {
    currentSegment.text = currentSegment.words
      .map((w) => w.word || w.text)
      .join(" ");
    segments.push(currentSegment);
  }

  return segments;
}

/**
 * Merge very short segments with neighbors
 * Segments shorter than minDuration get merged
 *
 * @param {array} segments - Array of segments
 * @param {number} minDuration - Minimum segment duration in seconds
 * @returns {array} Merged segments
 */
function mergeShortSegments(segments, minDuration = 1.0) {
  if (!segments || segments.length === 0) return [];

  const merged = [];
  let current = null;

  for (const seg of segments) {
    if (!current) {
      current = { ...seg };
      continue;
    }

    // If current segment is too short, merge with next
    if (current.duration < minDuration) {
      current.text += " " + seg.text;
      current.end = seg.end;
      current.duration = current.end - current.start;
      if (seg.words) {
        current.words = [...(current.words || []), ...seg.words];
      }
    } else {
      merged.push(current);
      current = { ...seg };
    }
  }

  // Don't forget the last segment
  if (current) {
    merged.push(current);
  }

  // Re-index
  return merged.map((seg, i) => ({ ...seg, index: i }));
}

/**
 * Calculate pause durations between segments
 * Useful for preserving natural pauses in the dub
 *
 * @param {array} segments - Array of segments
 * @returns {array} Segments with pauseBefore property added
 */
function calculatePauses(segments) {
  if (!segments || segments.length === 0) return [];

  return segments.map((seg, i) => {
    const prevEnd = i > 0 ? segments[i - 1].end : 0;
    const pauseBefore = seg.start - prevEnd;

    return {
      ...seg,
      pauseBefore: Math.max(0, pauseBefore),
    };
  });
}

/**
 * Merge segments with small gaps between them
 * This creates longer, more natural-sounding TTS segments
 *
 * @param {array} segments - Array of segments with start/end times
 * @param {object} options - Merge options
 * @param {number} options.maxGap - Max gap in seconds to merge (default 0.5s)
 * @param {number} options.maxDuration - Max merged segment duration (default 15s)
 * @param {boolean} options.sameSpeakerOnly - Only merge same speaker (default true)
 * @returns {array} Merged segments
 */
function mergeCloseSegments(segments, options = {}) {
  const {
    maxGap = 0.5,           // Merge if gap < 0.5s
    maxDuration = 15,       // Don't create segments longer than 15s
    maxMergeCount = 5,      // Don't merge more than 5 segments into one (prevents mega-blocks)
    sameSpeakerOnly = true, // Only merge same speaker
  } = options;

  if (!segments || segments.length === 0) return [];

  const merged = [];
  let current = { ...segments[0] };
  let mergeCount = 1; // Track how many original segments are in current block

  for (let i = 1; i < segments.length; i++) {
    const next = segments[i];
    const gap = next.start - current.end;
    const wouldBeTooLong = (next.end - current.start) > maxDuration;
    const wouldMergeTooMany = mergeCount >= maxMergeCount;
    const differentSpeaker = sameSpeakerOnly && next.speaker !== current.speaker;

    // Merge if gap is small enough and constraints are met
    if (gap <= maxGap && !wouldBeTooLong && !wouldMergeTooMany && !differentSpeaker) {
      // Merge: extend current segment
      current.text = current.text + " " + next.text;
      current.end = next.end;
      current.duration = current.end - current.start;
      if (next.words && current.words) {
        current.words = [...current.words, ...next.words];
      }
      mergeCount++;
    } else {
      // Gap too big, too long, too many merged, or different speaker - start new segment
      merged.push(current);
      current = { ...next };
      mergeCount = 1;
    }
  }

  // Don't forget last segment
  merged.push(current);

  // Re-index and log stats
  const result = merged.map((seg, i) => ({ ...seg, index: i }));
  
  console.log(`   📎 Merged ${segments.length} → ${result.length} segments (gap ≤ ${maxGap}s, max ${maxMergeCount} per block)`);
  
  return result;
}

/**
 * Detect and handle overlapping speech segments
 * When people talk over each other, we need to decide what to do:
 * - Option 1: Keep the longer segment, drop the shorter one
 * - Option 2: Truncate the overlap (adjust end/start times)
 * - Option 3: Flag for manual review
 * 
 * @param {array} segments - Array of segments with start/end times
 * @param {object} options - Overlap handling options
 * @returns {object} { segments, overlaps, stats }
 */
function detectAndHandleOverlaps(segments, options = {}) {
  const {
    strategy = "truncate",  // "truncate" | "drop_shorter" | "flag_only"
    minOverlap = 0.1,       // Ignore overlaps < 100ms
  } = options;

  if (!segments || segments.length < 2) {
    return { segments, overlaps: [], stats: { count: 0 } };
  }

  // Sort by start time
  const sorted = [...segments].sort((a, b) => a.start - b.start);
  const overlaps = [];
  const processed = [];
  
  for (let i = 0; i < sorted.length; i++) {
    const current = { ...sorted[i] };
    
    // Check for overlap with previous segments
    for (let j = processed.length - 1; j >= 0; j--) {
      const prev = processed[j];
      
      // If previous segment ends after current starts = overlap
      if (prev.end > current.start + minOverlap) {
        const overlapDuration = prev.end - current.start;
        
        overlaps.push({
          segment1: prev.index,
          segment2: current.index,
          speaker1: prev.speaker,
          speaker2: current.speaker,
          overlapStart: current.start,
          overlapEnd: Math.min(prev.end, current.end),
          overlapDuration,
        });

        // Handle based on strategy
        if (strategy === "truncate") {
          // Truncate the previous segment's end to current's start
          prev.end = current.start;
          prev.duration = prev.end - prev.start;
          prev.truncated = true;
        } else if (strategy === "drop_shorter") {
          // Mark shorter segment for removal
          if (prev.duration < current.duration) {
            prev.dropped = true;
          } else {
            current.dropped = true;
          }
        }
        // "flag_only" - just record the overlap, don't modify
      }
    }
    
    // Only add if not dropped
    if (!current.dropped) {
      processed.push(current);
    }
  }

  // Filter out dropped segments and re-index
  const finalSegments = processed
    .filter(s => !s.dropped && s.duration > 0.1)  // Keep segments > 100ms
    .map((seg, i) => ({ ...seg, index: i }));

  const stats = {
    count: overlaps.length,
    totalOverlapDuration: overlaps.reduce((sum, o) => sum + o.overlapDuration, 0),
    droppedSegments: processed.filter(s => s.dropped).length,
    truncatedSegments: processed.filter(s => s.truncated).length,
  };

  if (overlaps.length > 0) {
    console.log(`   ⚠️ Detected ${overlaps.length} overlapping segments (${stats.totalOverlapDuration.toFixed(1)}s total)`);
    console.log(`      Strategy: ${strategy}`);
    if (stats.droppedSegments > 0) {
      console.log(`      Dropped: ${stats.droppedSegments} segments`);
    }
    if (stats.truncatedSegments > 0) {
      console.log(`      Truncated: ${stats.truncatedSegments} segments`);
    }
  }

  return { segments: finalSegments, overlaps, stats };
}

/**
 * Check if Lemonfox API key is set
 */
function checkApiKey() {
  return !!LEMONFOX_API_KEY;
}

/**
 * Detect conversation blocks - rapid back-and-forth dialogue between speakers
 * 
 * Identifies patterns like:
 * - Speaker A: "What do you think?"
 * - Speaker B: "I agree!" (gap < 0.3s)
 * - Speaker A: "Great!" (gap < 0.3s)
 * 
 * These rapid exchanges are grouped into "conversation blocks" for better
 * translation context and TTS handling.
 * 
 * @param {array} segments - Segments with speaker labels and timing
 * @param {object} options - Detection options
 * @returns {object} { blocks, monologues, segments (with block assignments), stats }
 */
function detectConversationBlocks(segments, options = {}) {
  const {
    rapidGapThreshold = 0.3,    // Speaker change < 0.3s = rapid exchange
    minExchanges = 2,            // Need at least 2 rapid exchanges to be a "conversation"
    maxBlockDuration = 30,       // Don't let conversation blocks exceed 30s
    minSpeakerChanges = 2,       // Need at least 2 speaker changes to be a conversation
  } = options;

  if (!segments || segments.length < 2) {
    return {
      blocks: [],
      monologues: segments || [],
      segments: segments || [],
      stats: { conversationBlocks: 0, monologueSegments: segments?.length || 0 },
    };
  }

  console.log(`\n   🗣️ CONVERSATION DETECTION`);
  console.log(`   ════════════════════════════════════════════════════`);
  console.log(`   Rapid gap threshold: ${rapidGapThreshold}s`);
  console.log(`   Min exchanges for conversation: ${minExchanges}`);

  const blocks = [];
  const monologues = [];
  let currentBlock = null;
  let rapidExchangeCount = 0;

  // Sort segments by start time
  const sorted = [...segments].sort((a, b) => a.start - b.start);

  for (let i = 0; i < sorted.length; i++) {
    const seg = sorted[i];
    const prevSeg = sorted[i - 1];
    const nextSeg = sorted[i + 1];

    // Calculate gap from previous segment
    const gapFromPrev = prevSeg ? (seg.start - prevSeg.end) : Infinity;
    const speakerChanged = prevSeg && seg.speaker !== prevSeg.speaker;
    const isRapidExchange = speakerChanged && gapFromPrev < rapidGapThreshold && gapFromPrev >= 0;

    // Check if we should start a new conversation block
    if (isRapidExchange) {
      if (!currentBlock) {
        // Start new conversation block with previous segment
        currentBlock = {
          type: 'conversation',
          segments: [{ ...prevSeg, blockIndex: blocks.length }],
          speakers: new Set([prevSeg.speaker]),
          start: prevSeg.start,
          end: seg.end,
          speakerChanges: 0,
          rapidExchanges: 0,
        };
        rapidExchangeCount = 1;
      }
      
      // Add current segment to block
      currentBlock.segments.push({ ...seg, blockIndex: blocks.length });
      currentBlock.speakers.add(seg.speaker);
      currentBlock.end = seg.end;
      currentBlock.speakerChanges++;
      currentBlock.rapidExchanges++;
      rapidExchangeCount++;
      
    } else if (currentBlock) {
      // Check if we should continue the block (non-rapid but close)
      const shouldContinue = gapFromPrev < 1.0 && 
                            (currentBlock.end - currentBlock.start) < maxBlockDuration &&
                            rapidExchangeCount >= minExchanges;
      
      if (shouldContinue) {
        // Continue block with this segment
        currentBlock.segments.push({ ...seg, blockIndex: blocks.length });
        currentBlock.speakers.add(seg.speaker);
        currentBlock.end = seg.end;
        if (speakerChanged) currentBlock.speakerChanges++;
      } else {
        // End the current block
        if (currentBlock.rapidExchanges >= minExchanges && 
            currentBlock.speakerChanges >= minSpeakerChanges) {
          // Valid conversation block
          currentBlock.speakers = Array.from(currentBlock.speakers);
          currentBlock.duration = currentBlock.end - currentBlock.start;
          currentBlock.index = blocks.length;
          blocks.push(currentBlock);
        } else {
          // Not enough exchanges - convert to monologues
          currentBlock.segments.forEach(s => {
            delete s.blockIndex;
            monologues.push(s);
          });
        }
        currentBlock = null;
        rapidExchangeCount = 0;
        
        // Current segment becomes a monologue (or starts a new block)
        monologues.push({ ...seg });
      }
    } else {
      // No active block, this is a monologue segment
      monologues.push({ ...seg });
    }
  }

  // Handle any remaining block
  if (currentBlock) {
    if (currentBlock.rapidExchanges >= minExchanges && 
        currentBlock.speakerChanges >= minSpeakerChanges) {
      currentBlock.speakers = Array.from(currentBlock.speakers);
      currentBlock.duration = currentBlock.end - currentBlock.start;
      currentBlock.index = blocks.length;
      blocks.push(currentBlock);
    } else {
      currentBlock.segments.forEach(s => {
        delete s.blockIndex;
        monologues.push(s);
      });
    }
  }

  // Mark segments with their block assignment
  const processedSegments = sorted.map(seg => {
    const block = blocks.find(b => 
      b.segments.some(bs => bs.start === seg.start && bs.end === seg.end)
    );
    return {
      ...seg,
      conversationBlock: block ? block.index : null,
      isConversation: !!block,
    };
  });

  // Calculate statistics
  const stats = {
    conversationBlocks: blocks.length,
    monologueSegments: monologues.length,
    totalSegments: segments.length,
    conversationTime: blocks.reduce((sum, b) => sum + b.duration, 0),
    monologueTime: monologues.reduce((sum, s) => sum + (s.end - s.start), 0),
    avgExchangesPerBlock: blocks.length > 0 
      ? (blocks.reduce((sum, b) => sum + b.rapidExchanges, 0) / blocks.length).toFixed(1)
      : 0,
    speakersInConversations: [...new Set(blocks.flatMap(b => b.speakers))],
  };

  // Log results
  console.log(`\n   📊 CONVERSATION DETECTION RESULTS`);
  console.log(`   ─────────────────────────────────────────────`);
  console.log(`   Conversation blocks: ${stats.conversationBlocks}`);
  console.log(`   Monologue segments: ${stats.monologueSegments}`);
  console.log(`   Conversation time: ${stats.conversationTime.toFixed(1)}s`);
  console.log(`   Monologue time: ${stats.monologueTime.toFixed(1)}s`);
  
  if (blocks.length > 0) {
    console.log(`   Avg exchanges per block: ${stats.avgExchangesPerBlock}`);
    console.log(`\n   🗨️ Conversation Blocks:`);
    blocks.forEach((block, i) => {
      console.log(`      Block ${i}: ${block.duration.toFixed(1)}s, ${block.segments.length} segments, ${block.speakers.length} speakers, ${block.rapidExchanges} rapid exchanges`);
      // Show first few lines of conversation
      const preview = block.segments.slice(0, 3).map(s => 
        `         [${s.speaker}]: "${s.text.substring(0, 40)}${s.text.length > 40 ? '...' : ''}"`
      ).join('\n');
      console.log(preview);
      if (block.segments.length > 3) {
        console.log(`         ... and ${block.segments.length - 3} more exchanges`);
      }
    });
  }

  return {
    blocks,
    monologues,
    segments: processedSegments,
    stats,
  };
}

/**
 * Reorder speakers by activity (speaking time)
 * SPEAKER_00 = most active, SPEAKER_01 = second most, etc.
 * 
 * @param {array} segments - Segments with speaker labels
 * @returns {object} { segments: reordered segments, speakerMap: old -> new mapping, stats }
 */
function reorderSpeakersByActivity(segments) {
  // Calculate total speaking time per speaker
  const speakerTime = {};
  
  for (const seg of segments) {
    const speaker = seg.speaker || "SPEAKER_00";
    const duration = (seg.end - seg.start) || seg.duration || 0;
    speakerTime[speaker] = (speakerTime[speaker] || 0) + duration;
  }
  
  // Sort speakers by activity (most active first)
  const sortedSpeakers = Object.entries(speakerTime)
    .sort((a, b) => b[1] - a[1]) // Descending by time
    .map(([speaker, time]) => ({ oldLabel: speaker, time }));
  
  // Create mapping: old speaker ID -> new speaker ID
  const speakerMap = {};
  sortedSpeakers.forEach((item, index) => {
    speakerMap[item.oldLabel] = `SPEAKER_${String(index).padStart(2, '0')}`;
  });
  
  // Apply remapping to all segments
  const reorderedSegments = segments.map(seg => ({
    ...seg,
    speaker: speakerMap[seg.speaker] || seg.speaker,
  }));
  
  // Generate stats for logging
  const stats = sortedSpeakers.map((item, index) => ({
    newLabel: `SPEAKER_${String(index).padStart(2, '0')}`,
    oldLabel: item.oldLabel,
    time: item.time,
    percentage: ((item.time / Object.values(speakerTime).reduce((a, b) => a + b, 0)) * 100).toFixed(1),
  }));
  
  return {
    segments: reorderedSegments,
    speakerMap,
    stats,
  };
}

module.exports = {
  transcribe,
  processTranscriptionResult,
  groupWordsIntoSegments,
  mergeShortSegments,
  mergeCloseSegments,
  calculatePauses,
  detectAndHandleOverlaps,
  detectConversationBlocks,
  reorderSpeakersByActivity,
  checkApiKey,
};
