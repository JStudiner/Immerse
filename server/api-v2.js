/**
 * API v2 - Full v2 Pipeline Integration
 *
 * Supports all pipeline-v2.js features:
 * - Levels: A1, A2, B1, B2, C1
 * - Voices: male, female, neutral, auto
 * - Modes: synced, narrator, narrator-only, learner, extended, brainrot
 * - Languages: spanish, indonesian
 * - Premium TTS (ElevenLabs)
 * - Voice cloning (XTTS)
 * - Lip-sync (Sync Labs)
 * - File uploads
 * - Clipping (start/duration)
 * - Narrator modes (clone_speaker, third_party, custom_narrator, storyteller)
 * - Voice extraction (from video, file, YouTube)
 */

const express = require("express");
const router = express.Router();
const path = require("path");
const fs = require("fs");
const crypto = require("crypto");
const { v4: uuidv4 } = require("uuid");
const multer = require("multer");
const { spawn } = require("child_process");

// Configure file upload for both video and voice files
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const uploadDir = path.join(__dirname, "input");
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    const prefix = file.fieldname === "voiceFile" ? "voice" : "upload";
    cb(null, `${prefix}_${Date.now()}${ext}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 500 * 1024 * 1024 }, // 500MB max
  fileFilter: (req, file, cb) => {
    // Different allowed types for video vs voice files
    const videoTypes = [
      ".mp4",
      ".mkv",
      ".webm",
      ".mov",
      ".avi",
      ".mp3",
      ".wav",
      ".m4a",
    ];
    const voiceTypes = [".mp3", ".wav", ".m4a", ".aac", ".ogg", ".flac"];

    const ext = path.extname(file.originalname).toLowerCase();
    const allowedTypes =
      file.fieldname === "voiceFile" ? voiceTypes : videoTypes;

    if (allowedTypes.includes(ext)) {
      cb(null, true);
    } else {
      cb(
        new Error(
          `File type ${ext} not allowed for ${file.fieldname}. Allowed: ${allowedTypes.join(", ")}`,
        ),
      );
    }
  },
});

// Multi-file upload handler (video + optional voice file)
const multiUpload = upload.fields([
  { name: "file", maxCount: 1 },
  { name: "voiceFile", maxCount: 1 },
]);

// In-memory job store (replace with Redis for production)
const jobs = new Map();

// ============================================
// RESULT CACHE - Skip reprocessing for identical params
// ============================================
const RESULT_CACHE_DIR = path.join(__dirname, "cache", "results");
if (!fs.existsSync(RESULT_CACHE_DIR)) {
  fs.mkdirSync(RESULT_CACHE_DIR, { recursive: true });
}

/**
 * Normalize a URL to a canonical form for cache key matching.
 * YouTube URLs come in many forms (youtu.be, youtube.com, with tracking params, etc.)
 * but they all refer to the same video. Normalize to: youtube:VIDEO_ID
 */
function normalizeSource(source) {
  if (!source || source.startsWith("file:")) return source;

  try {
    const url = new URL(source);

    // YouTube: extract video ID, ignore tracking/timestamp params
    // Matches: youtube.com/watch?v=ID, youtu.be/ID, youtube.com/embed/ID, youtube.com/shorts/ID
    let videoId = null;

    if (
      url.hostname.includes("youtube.com") ||
      url.hostname.includes("youtube-nocookie.com")
    ) {
      videoId = url.searchParams.get("v");
      if (!videoId) {
        // /embed/ID or /shorts/ID
        const match = url.pathname.match(/\/(embed|shorts|v)\/([^/?&]+)/);
        if (match) videoId = match[2];
      }
    } else if (url.hostname === "youtu.be") {
      videoId = url.pathname.slice(1).split("/")[0];
    }

    if (videoId) {
      return `youtube:${videoId}`;
    }
  } catch {}

  // Not YouTube or invalid URL -- use as-is
  return source;
}

/**
 * Build a deterministic cache key from processing parameters.
 * For URLs: hash the normalized URL + all pipeline options.
 * For files: hash the original filename + file size + all pipeline options.
 */
function buildCacheKey(params) {
  const keyData = {
    source: normalizeSource(params.source), // Normalized source identifier
    level: params.level || "B1",
    voice: params.voice || "neutral",
    mode: params.mode || "synced",
    language: params.language || "spanish",
    flags: (params.flags || []).slice().sort(),
    narratorOptions: params.narratorOptions || null,
    tiktokOptions: params.tiktokOptions || null,
    startTime: params.startTime || null,
    duration: params.duration || null,
    speakers: params.speakers || null,
    assignVoices: params.assignVoices || null,
  };
  const hash = crypto
    .createHash("sha256")
    .update(JSON.stringify(keyData))
    .digest("hex")
    .slice(0, 16);
  return hash;
}

/**
 * Look up a cached result. Returns the result object if cache hit + files exist, null otherwise.
 */
function getCachedResult(cacheKey) {
  const cachePath = path.join(RESULT_CACHE_DIR, `${cacheKey}.json`);
  if (!fs.existsSync(cachePath)) return null;

  try {
    const cached = JSON.parse(fs.readFileSync(cachePath, "utf8"));

    // Verify the output directory still exists and key files are present
    if (!cached.outputDir || !fs.existsSync(cached.outputDir)) {
      console.log(`🗑️  Cache ${cacheKey}: output dir missing, invalidating`);
      fs.unlinkSync(cachePath);
      return null;
    }

    // Check that at least one main output file still exists
    const hasVideo =
      cached.result?.videoUrl &&
      fs.existsSync(
        path.join(
          __dirname,
          cached.result.videoUrl.replace("/audio/", "output/"),
        ),
      );
    const hasAudio =
      cached.result?.audioUrl &&
      fs.existsSync(
        path.join(
          __dirname,
          cached.result.audioUrl.replace("/audio/", "output/"),
        ),
      );
    if (!hasVideo && !hasAudio) {
      console.log(`🗑️  Cache ${cacheKey}: output files missing, invalidating`);
      fs.unlinkSync(cachePath);
      return null;
    }

    console.log(
      `⚡ Cache HIT for ${cacheKey} (created ${new Date(cached.createdAt).toLocaleString()})`,
    );
    return cached.result;
  } catch (err) {
    console.error(`⚠️  Cache read error for ${cacheKey}:`, err.message);
    return null;
  }
}

/**
 * Save a result to the cache.
 */
function saveCacheResult(cacheKey, result, outputDir, options) {
  const cachePath = path.join(RESULT_CACHE_DIR, `${cacheKey}.json`);
  try {
    fs.writeFileSync(
      cachePath,
      JSON.stringify(
        {
          cacheKey,
          result,
          outputDir,
          options,
          createdAt: Date.now(),
        },
        null,
        2,
      ),
    );
    console.log(`💾 Cached result as ${cacheKey}`);
  } catch (err) {
    console.error(`⚠️  Cache write error:`, err.message);
  }
}

/**
 * GET /api/v2/tiers
 * Returns available service tiers for User Mode
 */
router.get("/tiers", (req, res) => {
  const { TIERS } = require("./src/v2/tier-config");
  res.json({
    tiers: Object.entries(TIERS).map(([key, tier]) => ({
      id: key,
      ...tier,
    })),
  });
});

/**
 * GET /api/v2/options
 * Returns all available options for the frontend
 */
router.get("/options", (req, res) => {
  res.json({
    levels: [
      {
        value: "A1",
        label: "A1 - Superbeginner",
        desc: "500 words, present tense only",
      },
      { value: "A2", label: "A2 - Beginner", desc: "1500 words, simple past" },
      {
        value: "B1",
        label: "B1 - Intermediate",
        desc: "3000 words, all indicative",
      },
      { value: "B2", label: "B2 - Upper Intermediate", desc: "Full grammar" },
      { value: "C1", label: "C1 - Advanced", desc: "Native-like" },
    ],
    voices: [
      { value: "male", label: "Male", desc: "Default male voice" },
      { value: "female", label: "Female", desc: "Default female voice" },
      { value: "neutral", label: "Neutral", desc: "Neutral voice" },
      { value: "auto", label: "Auto", desc: "Detect from video" },
    ],
    modes: [
      {
        value: "synced",
        label: "Synced",
        desc: "Direct translation, original timing",
        icon: "🎬",
      },
      {
        value: "narrator",
        label: "Narrator",
        desc: "Time-filling, more words, slower speech",
        icon: "🎙️",
      },
      {
        value: "narrator-only",
        label: "Narrator Only",
        desc: "Only dub the main speaker",
        icon: "🎤",
      },
      {
        value: "learner",
        label: "Learner",
        desc: "Slower TTS (0.8x), audio-only",
        icon: "📚",
      },
      {
        value: "extended",
        label: "Extended",
        desc: "Video stretched to fit full translation",
        icon: "⏱️",
      },
      {
        value: "brainrot",
        label: "Brainrot",
        desc: "TikTok-style narration, sped-up video",
        icon: "🧠",
      },
    ],
    languages: [
      {
        value: "spanish",
        label: "Spanish",
        voices: ["male", "female", "neutral"],
      },
      {
        value: "indonesian",
        label: "Indonesian",
        voices: ["firman", "bian", "meraki"],
      },
    ],
    flags: [
      {
        value: "premium",
        label: "Premium TTS",
        desc: "Use ElevenLabs (higher quality)",
        icon: "✨",
      },
      {
        value: "clone",
        label: "Voice Clone",
        desc: "Clone original speaker voice (XTTS)",
        icon: "🎭",
      },
      {
        value: "lipsync",
        label: "Lip Sync",
        desc: "AI lip-sync (Sync Labs)",
        icon: "👄",
      },
      {
        value: "quality",
        label: "High Quality",
        desc: "Better audio separation (slower)",
        icon: "🎵",
      },
    ],
    narratorModes: [
      {
        value: "clone_speaker",
        label: "Clone Speaker",
        desc: "Clone original speaker voice (1st person)",
        icon: "🎭",
        perspective: "first",
        ttsProvider: "xtts",
        bestFor: ["vlogs", "tutorials", "podcasts", "interviews"],
      },
      {
        value: "third_party",
        label: "Third Party Narrator",
        desc: "External narrator describes content (3rd person)",
        icon: "🎙️",
        perspective: "third",
        ttsProvider: "lemonfox",
        bestFor: ["movie recaps", "news", "documentaries", "explainers"],
      },
      {
        value: "custom_narrator",
        label: "Custom Voice",
        desc: "Use your own voice sample or YouTube voice",
        icon: "🎨",
        perspective: "configurable",
        ttsProvider: "xtts",
        bestFor: ["branded content", "audiobooks", "custom projects"],
      },
      {
        value: "storyteller",
        label: "Storyteller",
        desc: "Hybrid: action in 3rd person, dialogue in 1st",
        icon: "📖",
        perspective: "hybrid",
        ttsProvider: "lemonfox",
        bestFor: ["fiction", "stories", "dramas", "audio dramas"],
      },
    ],
    voiceSources: [
      {
        value: "video",
        label: "From Video",
        desc: "Extract voice from input video",
      },
      {
        value: "file",
        label: "Upload File",
        desc: "Upload your own voice sample (6-30s)",
      },
      {
        value: "youtube",
        label: "YouTube URL",
        desc: "Extract voice from any YouTube video",
      },
    ],
  });
});

/**
 * POST /api/v2/process
 * Start processing a video with v2 pipeline
 */
router.post("/process", upload.single("voiceFile"), async (req, res) => {
  const {
    url,
    level = "B1",
    voice = "neutral",
    mode = "synced",
    language = "spanish",
    flags = [],
    narratorOptions = null,
    tiktokOptions = null,
    startTime = null,
    duration = null,
    speakers = null,
    assignVoices = null,
    character = null,
    characterTraits = null,
    voiceSampleUrl = null, // URL to a voice sample (from extraction)
  } = req.body;

  if (!url) {
    return res.status(400).json({ error: "URL is required" });
  }

  // Parse flags/options early for cache key
  const parsedFlags = typeof flags === "string" ? JSON.parse(flags) : flags;
  const parsedNarratorOptions =
    typeof narratorOptions === "string"
      ? JSON.parse(narratorOptions)
      : narratorOptions;
  const parsedTiktokOptions =
    typeof tiktokOptions === "string"
      ? JSON.parse(tiktokOptions)
      : tiktokOptions;

  // Check cache for identical request
  const cacheKey = buildCacheKey({
    source: url,
    level,
    voice,
    mode,
    language,
    flags: parsedFlags,
    narratorOptions: parsedNarratorOptions,
    tiktokOptions: parsedTiktokOptions,
    startTime,
    duration,
    speakers,
    assignVoices,
  });
  console.log(`🔍 Cache lookup: ${normalizeSource(url)} → key ${cacheKey}`);

  const cachedResult = getCachedResult(cacheKey);
  if (cachedResult) {
    // Return a completed job instantly from cache
    const jobId = uuidv4();
    jobs.set(jobId, {
      id: jobId,
      status: "completed",
      progress: 100,
      currentStep: "Done! (cached)",
      options: {
        url,
        level,
        voice,
        mode,
        language,
        flags,
        narratorOptions,
        tiktokOptions,
        startTime,
        duration,
      },
      createdAt: Date.now(),
      result: { ...cachedResult, jobId, cached: true },
      logs: ["Cache hit - returning previous result"],
    });
    console.log(`⚡ Returning cached result for ${url} [${cacheKey}]`);
    return res.json({ jobId, status: "completed", cached: true });
  }

  const jobId = uuidv4();

  // Handle voice file - either uploaded or from URL
  let voiceFilePath = null;
  if (req.file) {
    voiceFilePath = req.file.path;
  } else if (voiceSampleUrl) {
    // If a voice sample URL was provided (from extraction), get the path
    const samplePath = path.join(__dirname, voiceSampleUrl);
    if (fs.existsSync(samplePath)) {
      voiceFilePath = samplePath;
    }
  }

  // Store job with cache key for saving result later
  jobs.set(jobId, {
    id: jobId,
    status: "processing",
    progress: 0,
    currentStep: "Starting...",
    options: {
      url,
      level,
      voice,
      mode,
      language,
      flags,
      narratorOptions,
      tiktokOptions,
      startTime,
      duration,
    },
    cacheKey,
    createdAt: Date.now(),
    logs: [],
  });

  // Start processing in background
  runPipeline(jobId, {
    source: url,
    level,
    voice,
    mode,
    language,
    flags: parsedFlags,
    narratorOptions: parsedNarratorOptions,
    tiktokOptions: parsedTiktokOptions,
    startTime,
    duration,
    speakers,
    assignVoices,
    character,
    characterTraits,
    voiceFilePath,
  });

  res.json({ jobId, status: "processing" });
});

/**
 * POST /api/v2/process-file
 * Process an uploaded file (video + optional voice file)
 */
router.post("/process-file", multiUpload, async (req, res) => {
  const mainFile = req.files?.["file"]?.[0];
  const voiceFile = req.files?.["voiceFile"]?.[0];

  if (!mainFile) {
    return res.status(400).json({ error: "No file uploaded" });
  }

  const {
    level = "B1",
    voice = "neutral",
    mode = "synced",
    language = "spanish",
    flags = "[]",
    narratorOptions = "{}",
    tiktokOptions = null,
    startTime = null,
    duration = null,
    speakers = null,
    assignVoices = null,
    character = null,
    characterTraits = null,
  } = req.body;

  const filePath = mainFile.path;
  const voiceFilePath = voiceFile?.path || null;

  // Parse JSON strings
  const parsedFlags = typeof flags === "string" ? JSON.parse(flags) : flags;
  const parsedNarratorOptions =
    typeof narratorOptions === "string"
      ? JSON.parse(narratorOptions)
      : narratorOptions;
  const parsedTiktokOptions =
    tiktokOptions && typeof tiktokOptions === "string"
      ? JSON.parse(tiktokOptions)
      : tiktokOptions;

  // Check cache - use original filename + file size as source identifier
  const fileSource = `file:${mainFile.originalname}:${mainFile.size}`;
  const cacheKey = buildCacheKey({
    source: fileSource,
    level,
    voice,
    mode,
    language,
    flags: parsedFlags,
    narratorOptions: parsedNarratorOptions,
    tiktokOptions: parsedTiktokOptions,
    startTime,
    duration,
    speakers,
    assignVoices,
  });

  const cachedResult = getCachedResult(cacheKey);
  if (cachedResult) {
    const jobId = uuidv4();
    jobs.set(jobId, {
      id: jobId,
      status: "completed",
      progress: 100,
      currentStep: "Done! (cached)",
      options: { file: mainFile.originalname, level, voice, mode, language },
      createdAt: Date.now(),
      result: { ...cachedResult, jobId, cached: true },
      logs: ["Cache hit - returning previous result"],
    });
    console.log(
      `⚡ Returning cached result for ${mainFile.originalname} [${cacheKey}]`,
    );
    return res.json({ jobId, status: "completed", cached: true });
  }

  const jobId = uuidv4();

  // If voice file was uploaded, add it to narrator options
  if (voiceFilePath && parsedNarratorOptions) {
    parsedNarratorOptions.voiceFilePath = voiceFilePath;
  }

  // Store job with cache key for saving result later
  jobs.set(jobId, {
    id: jobId,
    status: "processing",
    progress: 0,
    currentStep: "Starting...",
    options: {
      file: mainFile.originalname,
      voiceFile: voiceFile?.originalname || null,
      level,
      voice,
      mode,
      language,
      flags: parsedFlags,
      narratorOptions: parsedNarratorOptions,
      tiktokOptions: parsedTiktokOptions,
      startTime,
      duration,
    },
    cacheKey,
    createdAt: Date.now(),
    logs: [],
  });

  // Start processing in background
  runPipeline(jobId, {
    source: filePath,
    level,
    voice,
    mode,
    language,
    flags: parsedFlags,
    narratorOptions: parsedNarratorOptions,
    tiktokOptions: parsedTiktokOptions,
    startTime,
    duration,
    speakers,
    assignVoices,
    character,
    characterTraits,
  });

  res.json({
    jobId,
    status: "processing",
    file: mainFile.originalname,
    voiceFile: voiceFile?.originalname || null,
  });
});

/**
 * GET /api/v2/status/:jobId
 * Get job status
 */
router.get("/status/:jobId", (req, res) => {
  const { jobId } = req.params;
  const job = jobs.get(jobId);

  if (!job) {
    return res.status(404).json({ error: "Job not found" });
  }

  res.json(job);
});

/**
 * DELETE /api/v2/cache
 * Clear result cache (all or for a specific URL)
 */
router.delete("/cache", (req, res) => {
  const { url } = req.query;

  if (url) {
    // Clear cache entries matching this URL
    let cleared = 0;
    const files = fs
      .readdirSync(RESULT_CACHE_DIR)
      .filter((f) => f.endsWith(".json"));
    for (const file of files) {
      try {
        const cached = JSON.parse(
          fs.readFileSync(path.join(RESULT_CACHE_DIR, file), "utf8"),
        );
        if (cached.options?.url === url) {
          fs.unlinkSync(path.join(RESULT_CACHE_DIR, file));
          cleared++;
        }
      } catch {}
    }
    console.log(`🗑️  Cleared ${cleared} cache entries for ${url}`);
    res.json({
      cleared,
      message: `Cleared ${cleared} cached results for this URL`,
    });
  } else {
    // Clear all cache
    const files = fs
      .readdirSync(RESULT_CACHE_DIR)
      .filter((f) => f.endsWith(".json"));
    for (const file of files) {
      fs.unlinkSync(path.join(RESULT_CACHE_DIR, file));
    }
    console.log(`🗑️  Cleared all ${files.length} cache entries`);
    res.json({
      cleared: files.length,
      message: `Cleared all ${files.length} cached results`,
    });
  }
});

/**
 * GET /api/v2/cache
 * List cached results
 */
router.get("/cache", (req, res) => {
  const files = fs
    .readdirSync(RESULT_CACHE_DIR)
    .filter((f) => f.endsWith(".json"));
  const entries = files
    .map((f) => {
      try {
        const cached = JSON.parse(
          fs.readFileSync(path.join(RESULT_CACHE_DIR, f), "utf8"),
        );
        return {
          cacheKey: cached.cacheKey,
          source: cached.options?.url || cached.options?.file || "unknown",
          level: cached.options?.level,
          mode: cached.options?.mode,
          language: cached.options?.language,
          createdAt: cached.createdAt,
        };
      } catch {
        return null;
      }
    })
    .filter(Boolean);

  res.json({ count: entries.length, entries });
});

/**
 * POST /api/v2/extract-voice
 * Automatically extract best voice samples from video (file upload or YouTube URL)
 * Analyzes speakers, finds clear speech, returns top samples per speaker
 */
router.post("/extract-voice", upload.single("file"), async (req, res) => {
  const {
    url = null, // YouTube URL (alternative to file upload)
    mode = "auto", // 'auto' or 'manual'
    segments = "30,60,120", // Manual mode: time points
    duration = "15", // Manual mode: duration
    samplesPerSpeaker = 3, // Auto mode: samples per speaker
  } = req.body;

  // Must have either file or URL
  if (!req.file && !url) {
    return res.status(400).json({ error: "No file uploaded or URL provided" });
  }

  const jobId = uuidv4();

  // Generate cache key based on source
  let cacheKey;
  if (url) {
    cacheKey = crypto
      .createHash("md5")
      .update(url + mode + samplesPerSpeaker)
      .digest("hex")
      .substring(0, 16);
  } else {
    const fileHash = crypto
      .createHash("md5")
      .update(req.file.originalname + req.file.size)
      .digest("hex")
      .substring(0, 16);
    cacheKey = fileHash + "_" + mode + "_" + samplesPerSpeaker;
  }

  const cacheDir = path.join(__dirname, "cache", "voice_extracts");
  const cachedResultPath = path.join(cacheDir, `${cacheKey}.json`);

  // Check cache
  if (fs.existsSync(cachedResultPath)) {
    console.log(`\n🎤 Voice Sample Extraction (${mode} mode) - FROM CACHE`);
    console.log(`   Source: ${req.file ? req.file.originalname : url}`);
    console.log(`   ⚡ Found in cache!`);

    try {
      const cachedResult = JSON.parse(
        fs.readFileSync(cachedResultPath, "utf8"),
      );

      // Verify cached files still exist
      const allFilesExist = cachedResult.samples.every((s) => {
        // s.path is already an absolute path
        return fs.existsSync(s.path);
      });

      if (allFilesExist) {
        return res.json({
          ...cachedResult,
          fromCache: true,
        });
      } else {
        console.log(`   ⚠️ Cached files missing, re-extracting...`);
      }
    } catch (e) {
      console.log(`   ⚠️ Cache invalid, re-extracting...`);
    }
  }

  const extractDir = path.join(__dirname, "temp", "voice_extracts", jobId);
  fs.mkdirSync(extractDir, { recursive: true });

  console.log(`\n🎤 Voice Sample Extraction (${mode} mode)`);
  console.log(`   Source: ${req.file ? req.file.originalname : url}`);

  try {
    let audioPath;

    // If URL provided, use youtube-dl-exec (same as pipeline ingest)
    if (url) {
      console.log(`   📥 Downloading from YouTube...`);

      // Check YouTube audio cache first (for voice extraction specifically)
      const ytAudioCacheDir = path.join(__dirname, "cache", "youtube_audio");
      fs.mkdirSync(ytAudioCacheDir, { recursive: true });
      const urlHash = crypto
        .createHash("md5")
        .update(url)
        .digest("hex")
        .substring(0, 16);
      const cachedYtAudioPath = path.join(ytAudioCacheDir, `${urlHash}.wav`);

      if (fs.existsSync(cachedYtAudioPath)) {
        console.log(`   ⚡ Found YouTube audio in cache!`);
        audioPath = path.join(extractDir, `audio_${jobId}.wav`);
        fs.copyFileSync(cachedYtAudioPath, audioPath);
        console.log(`   ✅ Loaded audio from cache`);
      } else {
        // Check if video is cached by ingest module
        const {
          getCachedVideo,
          getCacheKey,
          detectSourceType,
          downloadWithCobalt,
        } = require("./src/v2/ingest");
        const sourceType = detectSourceType(url);
        const videoCacheKey = getCacheKey(url, sourceType);
        const cachedVideoPath = getCachedVideo(videoCacheKey);

        if (cachedVideoPath) {
          console.log(`   ⚡ Found video in pipeline cache!`);
          audioPath = path.join(extractDir, `audio_${jobId}.wav`);
          const extractCmd = `ffmpeg -y -i "${cachedVideoPath}" -vn -acodec pcm_s16le -ar 44100 -ac 2 "${audioPath}" 2>/dev/null`;
          require("child_process").execSync(extractCmd);
          console.log(`   ✅ Extracted audio from cached video`);
        } else {
          // Download fresh — try Cobalt first, then yt-dlp
          const tempDir = path.join(extractDir, "temp");
          fs.mkdirSync(tempDir, { recursive: true });

          const fullVideoPath = path.join(tempDir, `youtube_${jobId}.mp4`);

          // Try Cobalt API (audio-only mode for voice extraction)
          const cobaltOk = await downloadWithCobalt(url, fullVideoPath, {
            downloadMode: "audio",
          });

          if (!cobaltOk) {
            // Fallback to yt-dlp
            console.log(`   📥 Falling back to yt-dlp for audio...`);
            try {
              const youtubedl = require("youtube-dl-exec");

              await youtubedl(url, {
                format: "bestaudio[ext=m4a]/bestaudio/best",
                output: fullVideoPath,
                noCheckCertificates: true,
                noWarnings: true,
                extractorArgs: "youtube:player_client=android",
              });
            } catch (dlErr) {
              throw new Error(`Failed to download from URL: ${dlErr.message}`);
            }
          }

          if (!fs.existsSync(fullVideoPath)) {
            throw new Error("Failed to download audio from YouTube");
          }

          // Extract audio to WAV for processing
          audioPath = path.join(extractDir, `audio_${jobId}.wav`);
          const extractCmd = `ffmpeg -y -i "${fullVideoPath}" -vn -acodec pcm_s16le -ar 44100 -ac 2 "${audioPath}" 2>/dev/null`;
          require("child_process").execSync(extractCmd);

          console.log(`   ✅ Downloaded audio`);
        }

        // Cache the extracted audio for future voice extractions
        try {
          fs.copyFileSync(audioPath, cachedYtAudioPath);
          console.log(`   💾 Cached YouTube audio for future use`);
        } catch {}
      }
    } else {
      // Use uploaded file
      const filePath = req.file.path;
      audioPath = path.join(extractDir, `audio_${jobId}.wav`);

      // Extract audio from video
      const extractCmd = `ffmpeg -y -i "${filePath}" -vn -acodec pcm_s16le -ar 44100 -ac 2 "${audioPath}" 2>/dev/null`;
      require("child_process").execSync(extractCmd);
    }

    // Use Spleeter for vocal separation (cheap & fast for voice extraction)
    // Spleeter: ~$0.00025/run, ~2s vs Demucs: ~$0.034/run, ~30s
    console.log(`   🎵 Separating vocals (Spleeter - fast mode)...`);
    let vocalsPath = audioPath;

    try {
      const v2 = require("./src/v2");
      const splitResult = await v2.split(audioPath, extractDir, {
        engine: "spleeter", // Use cheap/fast Spleeter for voice extraction
      });
      vocalsPath = splitResult.vocals;
      console.log(`   ✅ Vocals separated (Spleeter)`);
    } catch (err) {
      console.log(
        `   ⚠️ Spleeter failed, trying Demucs: ${err.message.substring(0, 80)}`,
      );
      // Fallback to Demucs if Spleeter fails
      try {
        const v2 = require("./src/v2");
        const splitResult = await v2.split(audioPath, extractDir, {
          model: "htdemucs",
          shifts: 1,
        });
        vocalsPath = splitResult.vocals;
        console.log(`   ✅ Vocals separated (Demucs fallback)`);
      } catch (err2) {
        console.log(
          `   ⚠️ Both separation failed, using original: ${err2.message.substring(0, 50)}`,
        );
      }
    }

    // AUTO MODE: Intelligent extraction
    if (mode === "auto") {
      const {
        autoExtractVoiceSamples,
      } = require("./src/v2/auto-voice-extract");

      const result = await autoExtractVoiceSamples(vocalsPath, extractDir, {
        samplesPerSpeaker: parseInt(samplesPerSpeaker),
      });

      // Format for frontend
      const samples = result.allSamples.map((sample, idx) => {
        // Move sample to permanent cache location
        const permanentDir = path.join(cacheDir, "samples", cacheKey);
        fs.mkdirSync(permanentDir, { recursive: true });

        const permanentPath = path.join(
          permanentDir,
          path.basename(sample.path),
        );
        if (!fs.existsSync(permanentPath)) {
          fs.copyFileSync(sample.path, permanentPath);
        }

        return {
          id: `${sample.speaker}_${sample.rank}`,
          speaker: sample.speaker,
          rank: sample.rank,
          startTime: Math.round(sample.start),
          duration: Math.round(sample.duration),
          text:
            sample.text.substring(0, 100) +
            (sample.text.length > 100 ? "..." : ""),
          url: `/cache/voice_extracts/samples/${cacheKey}/${path.basename(sample.path)}`,
          path: permanentPath,
          qualityScore: sample.qualityScore,
          autoScore: Math.round(sample.score),
          issues: sample.issues,
        };
      });

      console.log(`\n   🎯 Best samples:`);
      result.speakers.forEach((speaker) => {
        const speakerSamples = samples.filter((s) => s.speaker === speaker);
        console.log(
          `      ${speaker}: ${speakerSamples.length} samples, best quality ${speakerSamples[0]?.qualityScore}/100`,
        );
      });

      const responseData = {
        success: true,
        jobId,
        mode: "auto",
        speakers: result.speakers,
        samples,
        bestSample: samples[0],
        samplesBySpeaker: result.speakers.reduce((acc, speaker) => {
          acc[speaker] = samples.filter((s) => s.speaker === speaker);
          return acc;
        }, {}),
      };

      // Cache the result
      fs.mkdirSync(cacheDir, { recursive: true });
      fs.writeFileSync(cachedResultPath, JSON.stringify(responseData, null, 2));
      console.log(`   💾 Cached for future use`);

      return res.json(responseData);
    }

    // MANUAL MODE: Extract at specified time points (fallback)
    const timePoints = segments.split(",").map((s) => parseInt(s.trim()));
    const sampleDuration = parseInt(duration);
    const samples = [];

    for (let i = 0; i < timePoints.length; i++) {
      const startTime = timePoints[i];
      const outputPath = path.join(
        extractDir,
        `sample_${i + 1}_${startTime}s.wav`,
      );

      const extractSampleCmd = `ffmpeg -y -ss ${startTime} -i "${vocalsPath}" -t ${sampleDuration} \
        -ar 22050 -ac 1 \
        -af "loudnorm=I=-16:TP=-1.5:LRA=11,highpass=f=80,lowpass=f=8000" \
        "${outputPath}" 2>/dev/null`;

      try {
        require("child_process").execSync(extractSampleCmd);
      } catch (e) {
        console.log(
          `   ⚠️ Sample ${i + 1} at ${startTime}s failed (may be past end of audio)`,
        );
        continue;
      }

      // Check quality
      const { analyzeVoiceSample } = require("./check-voice-quality");
      const analysis = analyzeVoiceSample(outputPath);

      // Move sample to permanent cache location
      const permanentDir = path.join(cacheDir, "samples", cacheKey);
      fs.mkdirSync(permanentDir, { recursive: true });

      const permanentPath = path.join(
        permanentDir,
        `sample_${i + 1}_${startTime}s.wav`,
      );
      if (!fs.existsSync(permanentPath)) {
        fs.copyFileSync(outputPath, permanentPath);
      }

      samples.push({
        id: `sample_${i + 1}`,
        startTime,
        duration: sampleDuration,
        url: `/cache/voice_extracts/samples/${cacheKey}/sample_${i + 1}_${startTime}s.wav`,
        path: permanentPath,
        qualityScore: analysis.qualityScore,
        issues: analysis.issues,
        recommendations: analysis.recommendations,
      });

      console.log(
        `   ✅ Sample ${i + 1}: ${startTime}s (quality: ${analysis.qualityScore}/100)`,
      );
    }

    if (samples.length === 0) {
      throw new Error(
        "No samples could be extracted. Try different time points.",
      );
    }

    // Sort by quality score
    samples.sort((a, b) => b.qualityScore - a.qualityScore);

    const responseData = {
      success: true,
      jobId,
      mode: "manual",
      samples,
      bestSample: samples[0],
    };

    // Cache the result
    fs.mkdirSync(cacheDir, { recursive: true });
    fs.writeFileSync(cachedResultPath, JSON.stringify(responseData, null, 2));
    console.log(`   💾 Cached for future use`);

    res.json(responseData);
  } catch (error) {
    console.error(`❌ Voice extraction failed: ${error.message}`);
    res.status(500).json({ error: error.message });
  }
});

// ============================================
// REMIX ENDPOINTS
// ============================================

/**
 * GET /api/v2/remix/styles
 * Returns available voice remix styles
 */
router.get("/remix/styles", (req, res) => {
  const { VOICE_STYLES } = require("./src/v2/restyle");
  const styles = Object.entries(VOICE_STYLES).map(([id, style]) => ({
    id,
    name: style.name,
    emoji: style.emoji,
    description: style.description,
    isTranslation: style.isTranslation || false,
    suggestedVoice: style.suggestedVoice,
    suggestedVoicePremium: style.suggestedVoicePremium,
  }));
  res.json({ styles });
});

/**
 * POST /api/v2/remix
 * Start a voice remix job (URL input)
 */
router.post("/remix", upload.single("voiceFile"), async (req, res) => {
  const {
    url,
    style = "valley_girl",
    customPrompt = null,
    voicePrompt = null,
    voice = null,
    clone = false,
    premium = false,
    startTime = null,
    duration = null,
    fromJobDir = null,
    voiceSampleUrl = null,
  } = req.body;

  if (!url) {
    return res.status(400).json({ error: "URL is required" });
  }

  const parsedClone = clone === "true" || clone === true;
  const parsedPremium = premium === "true" || premium === true;

  const jobId = uuidv4();

  let voiceFilePath = null;
  if (req.file) {
    voiceFilePath = req.file.path;
  } else if (voiceSampleUrl) {
    const samplePath = path.join(__dirname, voiceSampleUrl);
    if (fs.existsSync(samplePath)) {
      voiceFilePath = samplePath;
    }
  }

  jobs.set(jobId, {
    id: jobId,
    status: "processing",
    progress: 0,
    currentStep: "Starting remix...",
    options: {
      url,
      style,
      customPrompt,
      voicePrompt,
      voice,
      clone: parsedClone,
      premium: parsedPremium,
    },
    createdAt: Date.now(),
    logs: [],
  });

  // Start remix pipeline in background
  runRemixPipeline(jobId, {
    source: url,
    style,
    customPrompt,
    voicePrompt,
    voice,
    clone: parsedClone,
    premium: parsedPremium,
    startTime,
    duration,
    voiceFilePath,
    fromJobDir: fromJobDir || null,
  });

  res.json({ jobId, status: "processing" });
});

/**
 * POST /api/v2/remix-file
 * Start a voice remix job (file upload)
 */
router.post("/remix-file", multiUpload, async (req, res) => {
  const mainFile = req.files?.["file"]?.[0];
  const voiceFile = req.files?.["voiceFile"]?.[0];

  if (!mainFile) {
    return res.status(400).json({ error: "No file uploaded" });
  }

  const {
    style = "valley_girl",
    customPrompt = null,
    voicePrompt = null,
    voice = null,
    clone = "false",
    premium = "false",
    startTime = null,
    duration = null,
    fromJobDir = null,
    voiceSampleUrl = null,
  } = req.body;

  const parsedClone = clone === "true" || clone === true;
  const parsedPremium = premium === "true" || premium === true;

  const jobId = uuidv4();

  jobs.set(jobId, {
    id: jobId,
    status: "processing",
    progress: 0,
    currentStep: "Starting remix...",
    options: {
      file: mainFile.originalname,
      style,
      customPrompt,
      voicePrompt,
      voice,
      clone: parsedClone,
      premium: parsedPremium,
    },
    createdAt: Date.now(),
    logs: [],
  });

  runRemixPipeline(jobId, {
    source: mainFile.path,
    style,
    customPrompt,
    voicePrompt,
    voice,
    clone: parsedClone,
    premium: parsedPremium,
    startTime,
    duration,
    voiceFilePath: voiceFile?.path || (voiceSampleUrl ? (() => { const p = path.join(__dirname, voiceSampleUrl); return fs.existsSync(p) ? p : null; })() : null),
    fromJobDir: fromJobDir || null,
  });

  res.json({
    jobId,
    status: "processing",
    file: mainFile.originalname,
  });
});

/**
 * Run the remix pipeline as a child process
 */
function runRemixPipeline(jobId, options) {
  const job = jobs.get(jobId);
  const pipelinePath = path.join(__dirname, "pipeline-remix.js");

  // Build command arguments
  const args = [pipelinePath, options.source, options.style || "valley_girl"];

  // Add flags
  if (options.premium) args.push("--premium");
  if (options.clone) args.push("--clone");
  if (options.voice) args.push("--voice", options.voice);
  if (options.customPrompt) args.push("--custom-prompt", options.customPrompt);
  if (options.voicePrompt) args.push("--voice-prompt", options.voicePrompt);
  if (options.startTime) args.push("--start", options.startTime);
  if (options.duration) args.push("--duration", options.duration);
  if (options.voiceFilePath) args.push("--voice-file", options.voiceFilePath);
  if (options.fromJobDir) args.push("--from-job", options.fromJobDir);

  console.log(`\n🎨 Starting remix pipeline for job ${jobId}`);
  console.log(`   Command: node ${args.join(" ")}\n`);

  const child = spawn("node", args, {
    cwd: __dirname,
    env: process.env,
  });

  child.stdout.on("data", (data) => {
    const output = data.toString();
    job.logs.push(output);

    // Parse progress from output
    if (output.includes("CACHE HIT")) {
      job.currentStep = "Loading cached data...";
      job.progress = 50;
    } else if (output.includes("INGEST")) {
      job.currentStep = "Downloading video...";
      job.progress = 5;
    } else if (output.includes("SPLIT") || output.includes("TRANSCRIBE")) {
      job.currentStep = "Splitting audio + transcribing...";
      job.progress = 15;
    } else if (
      output.includes("Transcribed:") ||
      output.includes("Clean segments:")
    ) {
      job.progress = 35;
    } else if (output.includes("RESTYLE")) {
      job.currentStep = "Restyling voice...";
      job.progress = 45;
    } else if (output.includes("Restyled")) {
      job.progress = 55;
    } else if (output.includes("TTS")) {
      job.currentStep = "Generating new voice...";
      job.progress = 60;
    } else if (output.includes("Generated") && output.includes("TTS")) {
      job.progress = 80;
    } else if (output.includes("FINALIZE")) {
      job.currentStep = "Finalizing...";
      job.progress = 85;
    } else if (output.includes("Rendering video")) {
      job.currentStep = "Rendering video...";
      job.progress = 90;
    } else if (output.includes("COMPLETE")) {
      job.currentStep = "Done!";
      job.progress = 100;
    }

    console.log(output);
  });

  child.stderr.on("data", (data) => {
    const error = data.toString();
    job.logs.push(`[ERROR] ${error}`);
    console.error(error);
  });

  child.on("close", (code) => {
    if (code === 0) {
      job.status = "completed";
      job.progress = 100;
      job.currentStep = "Done!";

      // Find output files
      const jobDir = findJobOutputDir(jobId, options.source);
      if (jobDir) {
        const dirBase = path.basename(jobDir);

        // Find the restyled voice file
        const restyledVoiceFile = fs
          .readdirSync(jobDir)
          .find(
            (f) => f.includes("voice_restyled") || f.includes("voice_only"),
          );

        job.result = {
          jobId,
          jobDir: dirBase,
          type: "remix",
          videoUrl: fs.existsSync(path.join(jobDir, "dubbed_video.mp4"))
            ? `/audio/${dirBase}/dubbed_video.mp4`
            : null,
          audioUrl: fs.existsSync(path.join(jobDir, "dubbed_audio.m4a"))
            ? `/audio/${dirBase}/dubbed_audio.m4a`
            : null,
          restyledVoiceUrl: restyledVoiceFile
            ? `/audio/${dirBase}/${restyledVoiceFile}`
            : null,
          voiceOnlyUrl: restyledVoiceFile
            ? `/audio/${dirBase}/${restyledVoiceFile}`
            : null,
          originalVocalsUrl: fs.existsSync(
            path.join(jobDir, "vocals_original.mp3"),
          )
            ? `/audio/${dirBase}/vocals_original.mp3`
            : null,
          backgroundUrl: fs.existsSync(path.join(jobDir, "background.mp3"))
            ? `/audio/${dirBase}/background.mp3`
            : null,
          transcriptUrl: fs.existsSync(path.join(jobDir, "transcription.json"))
            ? `/audio/${dirBase}/transcription.json`
            : null,
        };
      }

      console.log(`\n✅ Remix job ${jobId} completed successfully`);
    } else {
      job.status = "failed";
      job.error = `Remix pipeline exited with code ${code}`;
      console.error(`\n❌ Remix job ${jobId} failed with code ${code}`);
    }
  });
}

/**
 * GET /api/v2/jobs
 * List all jobs (for debugging)
 */
router.get("/jobs", (req, res) => {
  const jobList = Array.from(jobs.values()).map((j) => ({
    id: j.id,
    status: j.status,
    progress: j.progress,
    currentStep: j.currentStep,
    createdAt: j.createdAt,
  }));
  res.json(jobList);
});

/**
 * Run the v2 pipeline as a child process
 */
function runPipeline(jobId, options) {
  const job = jobs.get(jobId);
  const pipelinePath = path.join(__dirname, "pipeline-v2.js");

  // Build command arguments
  const args = [
    pipelinePath,
    options.source,
    options.level,
    options.voice,
    options.mode,
    options.language,
  ];

  // Add flags
  if (options.flags?.includes("premium")) args.push("--premium");
  if (options.flags?.includes("clone")) args.push("--clone");
  if (options.flags?.includes("lipsync")) args.push("--lipsync");
  if (options.flags?.includes("quality")) args.push("--quality");
  if (options.flags?.includes("spleeter")) args.push("--spleeter");

  // Add optional parameters
  if (options.startTime) args.push("--start", options.startTime);
  if (options.duration) args.push("--duration", options.duration);
  if (options.speakers) args.push("--speakers", options.speakers);
  if (options.assignVoices) args.push("--assign-voices", options.assignVoices);
  if (options.character) args.push("--character", options.character);
  if (options.characterTraits)
    args.push("--character-traits", options.characterTraits);

  // Add narrator options
  if (options.narratorOptions) {
    const {
      narratorMode,
      voiceSource,
      voiceStartTime,
      voiceDuration,
      customVoiceUrl,
      voiceFilePath,
    } = options.narratorOptions;

    if (narratorMode) args.push("--narrator-mode", narratorMode);
    if (voiceSource) args.push("--voice-source", voiceSource);
    if (voiceStartTime) args.push("--voice-start", voiceStartTime);
    if (voiceDuration) args.push("--voice-duration", voiceDuration);
    if (customVoiceUrl) args.push("--voice-youtube", customVoiceUrl);
    if (voiceFilePath) args.push("--voice-file", voiceFilePath);
  }

  // Voice file at top level (from extracted samples or uploads)
  if (options.voiceFilePath && !args.includes("--voice-file")) {
    args.push("--voice-file", options.voiceFilePath);
    // Also ensure clone mode is enabled if we have a voice file
    if (!args.includes("--clone")) {
      args.push("--clone");
    }
  }

  console.log(`\n🚀 Starting pipeline for job ${jobId}`);
  console.log(`   Command: node ${args.join(" ")}\n`);

  const child = spawn("node", args, {
    cwd: __dirname,
    env: process.env,
  });

  // Parse output for progress
  child.stdout.on("data", (data) => {
    const output = data.toString();
    job.logs.push(output);

    // Parse progress from pipeline output
    const progressMatch = output.match(/(\d+)%/);
    if (progressMatch) {
      job.progress = parseInt(progressMatch[1]);
    }

    // Parse step names
    if (output.includes("INGEST")) job.currentStep = "Downloading video...";
    else if (output.includes("SPLIT"))
      job.currentStep = "Separating audio (Demucs)...";
    else if (output.includes("TRANSCRIBE"))
      job.currentStep = "Transcribing speech...";
    else if (output.includes("TRANSLATE"))
      job.currentStep = "AI translation...";
    else if (output.includes("TTS"))
      job.currentStep = "Generating Spanish audio...";
    else if (output.includes("MERGE")) job.currentStep = "Mixing audio...";
    else if (output.includes("RENDER")) job.currentStep = "Rendering video...";
    else if (output.includes("LIP-SYNC"))
      job.currentStep = "AI lip-sync (this takes a while)...";
    else if (output.includes("TIKTOK"))
      job.currentStep = "Creating TikTok format...";
    else if (output.includes("COMPLETE")) job.currentStep = "Done!";

    // Check for output paths
    const outputMatch = output.match(/Output: (output\/[^\s]+)/);
    if (outputMatch) {
      job.outputPath = outputMatch[1];
    }

    console.log(output);
  });

  child.stderr.on("data", (data) => {
    const error = data.toString();
    job.logs.push(`[ERROR] ${error}`);
    console.error(error);
  });

  child.on("close", async (code) => {
    if (code === 0) {
      job.status = "completed";
      job.progress = 100;
      job.currentStep = "Done!";

      // Find output files
      const jobDir = findJobOutputDir(jobId, options.source);
      if (jobDir) {
        // Check for TikTok formatted video
        const tiktokVideo = fs.existsSync(
          path.join(jobDir, "dubbed_video_tiktok.mp4"),
        )
          ? `/audio/${path.basename(jobDir)}/dubbed_video_tiktok.mp4`
          : null;

        // Find voice-only and background tracks for independent volume control
        const dirBase = path.basename(jobDir);
        const voiceOnlyFile = fs
          .readdirSync(jobDir)
          .find((f) => f.includes("voice_only") && f.endsWith(".m4a"));
        const backgroundFile = fs
          .readdirSync(jobDir)
          .find((f) => f === "background.mp3");

        job.result = {
          jobId,
          videoUrl: fs.existsSync(path.join(jobDir, "dubbed_video.mp4"))
            ? `/audio/${dirBase}/dubbed_video.mp4`
            : null,
          tiktokVideoUrl: tiktokVideo,
          audioUrl: fs.existsSync(path.join(jobDir, "dubbed_audio.mp3"))
            ? `/audio/${dirBase}/dubbed_audio.mp3`
            : fs.existsSync(path.join(jobDir, "dubbed_audio.m4a"))
              ? `/audio/${dirBase}/dubbed_audio.m4a`
              : null,
          voiceOnlyUrl: voiceOnlyFile
            ? `/audio/${dirBase}/${voiceOnlyFile}`
            : null,
          backgroundUrl: backgroundFile
            ? `/audio/${dirBase}/${backgroundFile}`
            : null,
          transcriptUrl: fs.existsSync(path.join(jobDir, "translation.json"))
            ? `/audio/${dirBase}/translation.json`
            : null,
        };
      }

      // Apply TikTok formatting if requested (post-processing)
      if (
        options.tiktokOptions &&
        options.tiktokOptions.style &&
        options.tiktokOptions.style !== "none" &&
        job.result?.videoUrl
      ) {
        const inputVideo = path.join(
          __dirname,
          job.result.videoUrl.replace("/audio/", "output/"),
        );
        const outputVideo = inputVideo.replace(".mp4", "_tiktok.mp4");
        const metadataPath = inputVideo.replace(".mp4", "_metadata.json");

        console.log(
          `\n🎬 Applying TikTok format: ${options.tiktokOptions.style}...`,
        );

        try {
          const { createTikTokFormat } = require("./create-tiktok-format");

          // Generate metadata if requested
          let metadata = null;
          if (options.tiktokOptions.generateMetadata) {
            console.log(`\n📝 Generating TikTok metadata...`);
            const {
              generateTikTokMetadata,
              extractVideoContext,
            } = require("./src/v2/tiktok-hooks");

            // Try to extract context from transcript
            const transcriptPath = path.join(
              path.dirname(inputVideo),
              "translation.json",
            );
            let context = "Language learning video";

            if (fs.existsSync(transcriptPath)) {
              const transcript = JSON.parse(
                fs.readFileSync(transcriptPath, "utf8"),
              );
              const segments = transcript.segments || transcript;
              context = segments
                .slice(0, 3)
                .map((s) => s.originalText || s.text)
                .join(" ");
            }

            metadata = await generateTikTokMetadata(context, {
              language: options.language,
              level: options.level,
              niche: options.mode === "brainrot" ? "memes" : "general",
            });

            // Use metadata for text overlays if not manually specified
            if (!options.tiktokOptions.topText && metadata.topText) {
              options.tiktokOptions.topText = metadata.topText;
            }
            if (!options.tiktokOptions.bottomText && metadata.bottomText) {
              options.tiktokOptions.bottomText = metadata.bottomText;
            }

            // Save metadata to file
            fs.writeFileSync(metadataPath, JSON.stringify(metadata, null, 2));
            console.log(
              `   ✅ Metadata saved to ${path.basename(metadataPath)}`,
            );
          }

          const result = createTikTokFormat(
            inputVideo,
            outputVideo,
            options.tiktokOptions,
          );

          if (result.success) {
            job.result.tiktokVideoUrl = job.result.videoUrl.replace(
              ".mp4",
              "_tiktok.mp4",
            );
            job.result.metadataUrl = metadata
              ? job.result.videoUrl.replace(".mp4", "_metadata.json")
              : null;
            job.result.metadata = metadata; // Include actual metadata object for frontend
            console.log(`   ✅ TikTok format created!`);

            if (metadata) {
              console.log(`\n   📋 TikTok Metadata:`);
              console.log(`      Caption: ${metadata.caption}`);
              console.log(`      Hashtags: ${metadata.hashtags?.join(" ")}`);
              console.log(`      Hook: ${metadata.hook}`);
            }
          }
        } catch (err) {
          console.error(`   ⚠️ TikTok formatting failed: ${err.message}`);
        }
      }

      // Save to result cache for future identical requests
      if (job.cacheKey && job.result) {
        saveCacheResult(job.cacheKey, job.result, jobDir, job.options);
      }

      console.log(`\n✅ Job ${jobId} completed successfully`);
    } else {
      job.status = "failed";
      job.error = `Pipeline exited with code ${code}`;
      console.error(`\n❌ Job ${jobId} failed with code ${code}`);
    }
  });
}

/**
 * Find the output directory for a job
 */
function findJobOutputDir(jobId, source) {
  const outputDir = path.join(__dirname, "output");
  if (!fs.existsSync(outputDir)) return null;

  // Get the most recent directory that matches the source
  const dirs = fs
    .readdirSync(outputDir)
    .filter((d) => fs.statSync(path.join(outputDir, d)).isDirectory())
    .map((d) => ({
      name: d,
      path: path.join(outputDir, d),
      time: fs.statSync(path.join(outputDir, d)).mtime.getTime(),
    }))
    .sort((a, b) => b.time - a.time);

  // Return the most recent directory
  if (dirs.length > 0) {
    return dirs[0].path;
  }

  return null;
}

module.exports = router;
