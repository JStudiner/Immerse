const { getSubtitles } = require("youtube-caption-extractor");

/**
 * Extract video ID from various YouTube URL formats
 */
function extractVideoId(url) {
  const patterns = [
    /(?:youtube\.com\/watch\?v=)([^&\n?#]+)/,
    /(?:youtu\.be\/)([^&\n?#]+)/,
    /(?:youtube\.com\/embed\/)([^&\n?#]+)/,
    /(?:youtube\.com\/shorts\/)([^&\n?#]+)/,
  ];

  for (const pattern of patterns) {
    const match = url.match(pattern);
    if (match) return match[1];
  }

  if (/^[a-zA-Z0-9_-]{11}$/.test(url)) {
    return url;
  }

  throw new Error(`Could not extract video ID from: ${url}`);
}

/**
 * Fetch transcript from YouTube
 * Uses youtube-caption-extractor to grab the hidden CC data
 */
async function getTranscript(url, lang = "en") {
  const videoId = extractVideoId(url);
  console.log(`⚡ Fetching captions for: ${videoId}`);

  try {
    const subtitles = await getSubtitles({ videoID: videoId, lang });

    if (!subtitles || subtitles.length === 0) {
      throw new Error("No captions returned");
    }

    // Transform to our format
    const transcript = subtitles.map((item, index) => ({
      index,
      text: item.text,
      start: parseFloat(item.start),
      duration: parseFloat(item.dur),
      end: parseFloat(item.start) + parseFloat(item.dur),
    }));

    console.log(`✅ Got ${transcript.length} segments`);
    return { videoId, transcript };
  } catch (error) {
    console.error("❌ Transcript fetch failed:", error.message);
    throw new Error(
      "Could not fetch captions - video may have captions disabled"
    );
  }
}

/**
 * Group transcript segments into larger chunks
 * Ensures no overlapping chunks for proper audio stitching
 */
function chunkTranscript(transcript, targetDurationSec = 30) {
  const chunks = [];
  let current = { segments: [], text: "", start: 0, end: 0, duration: 0 };
  let lastChunkEnd = 0;

  for (const segment of transcript) {
    if (current.duration >= targetDurationSec && current.segments.length > 0) {
      chunks.push(current);
      lastChunkEnd = current.end;
      current = {
        segments: [],
        text: "",
        start: 0,
        end: 0,
        duration: 0,
      };
    }

    if (current.segments.length === 0) {
      // Start new chunk at the previous chunk's end to avoid overlap
      current.start = Math.max(segment.start, lastChunkEnd);
    }

    current.segments.push(segment);
    current.text += (current.text ? " " : "") + segment.text;
    current.end = segment.end;
    current.duration = current.end - current.start;
  }

  if (current.segments.length > 0) {
    chunks.push(current);
  }

  console.log(`📦 Chunked into ${chunks.length} pieces (no overlaps)`);
  return chunks;
}

module.exports = {
  extractVideoId,
  getTranscript,
  chunkTranscript,
};
