require("dotenv").config();
const express = require("express");
const crypto = require("crypto");
const path = require("path");
const fs = require("fs");
const { processVideo, processAudioOnly, testSimplification } = require("./src/immersionLogic");

// Import v2 API
const apiV2 = require("./api-v2");

const app = express();
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// CORS for frontend
app.use((req, res, next) => {
  res.header("Access-Control-Allow-Origin", "*");
  res.header("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");
  res.header("Access-Control-Allow-Headers", "Origin, X-Requested-With, Content-Type, Accept");
  if (req.method === "OPTIONS") {
    return res.sendStatus(200);
  }
  next();
});

// ══════════════════════════════════════════════════════════════════════════
// Simple Password Protection (optional)
// Set AUTH_PASSWORD in .env to enable. Unset = no password required.
// Uses a token cookie so you only enter the password once per browser.
// ══════════════════════════════════════════════════════════════════════════
const AUTH_PASSWORD = process.env.AUTH_PASSWORD;
const AUTH_TOKEN = AUTH_PASSWORD
  ? crypto.createHash("sha256").update(AUTH_PASSWORD + "_immersion_salt").digest("hex").slice(0, 32)
  : null;

if (AUTH_PASSWORD) {
  console.log("🔒 Password protection ENABLED");

  // Login page handler
  app.post("/auth/login", express.urlencoded({ extended: false }), (req, res) => {
    if (req.body.password === AUTH_PASSWORD) {
      res.cookie("immersion_auth", AUTH_TOKEN, {
        httpOnly: true,
        maxAge: 365 * 24 * 60 * 60 * 1000, // 1 year
        sameSite: "lax",
      });
      return res.redirect("/");
    }
    return res.status(401).send(getLoginPage("Wrong password"));
  });

  // Auth middleware — skip health check so Docker healthcheck still works
  app.use((req, res, next) => {
    if (req.path === "/health" || req.path === "/auth/login") return next();

    // Check cookie
    const cookies = parseCookies(req.headers.cookie || "");
    if (cookies.immersion_auth === AUTH_TOKEN) return next();

    // Check query param (for easy sharing of links)
    if (req.query.token === AUTH_TOKEN) {
      res.cookie("immersion_auth", AUTH_TOKEN, {
        httpOnly: true,
        maxAge: 365 * 24 * 60 * 60 * 1000,
        sameSite: "lax",
      });
      return next();
    }

    return res.status(401).send(getLoginPage());
  });
}

function parseCookies(cookieStr) {
  const cookies = {};
  cookieStr.split(";").forEach((pair) => {
    const [key, ...val] = pair.trim().split("=");
    if (key) cookies[key.trim()] = val.join("=").trim();
  });
  return cookies;
}

function getLoginPage(error) {
  return `<!DOCTYPE html>
<html lang="en"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Immersion - Login</title>
<style>
  *{box-sizing:border-box;margin:0;padding:0}
  body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;
       background:#0a0a0f;color:#e0e0e0;display:flex;align-items:center;justify-content:center;min-height:100vh}
  .card{background:#14141f;border:1px solid #2a2a3a;border-radius:16px;padding:2.5rem;width:90%;max-width:380px;text-align:center}
  h1{font-size:1.5rem;margin-bottom:0.5rem}
  .sub{color:#888;margin-bottom:1.5rem;font-size:0.9rem}
  input{width:100%;padding:0.8rem 1rem;border:1px solid #2a2a3a;border-radius:8px;background:#0a0a0f;color:#fff;
        font-size:1rem;margin-bottom:1rem;outline:none}
  input:focus{border-color:#6366f1}
  button{width:100%;padding:0.8rem;border:none;border-radius:8px;background:linear-gradient(135deg,#6366f1,#8b5cf6);
         color:#fff;font-size:1rem;font-weight:600;cursor:pointer;transition:transform 0.1s}
  button:active{transform:scale(0.98)}
  .err{color:#f87171;font-size:0.85rem;margin-bottom:1rem}
</style>
</head><body>
<div class="card">
  <h1>Immersion</h1>
  <p class="sub">Enter password to continue</p>
  ${error ? `<p class="err">${error}</p>` : ""}
  <form method="POST" action="/auth/login">
    <input type="password" name="password" placeholder="Password" autofocus required>
    <button type="submit">Enter</button>
  </form>
</div>
</body></html>`;
}

// ══════════════════════════════════════════════════════════════════════════

// Serve generated audio files
app.use("/audio", express.static(path.join(__dirname, "output")));

// Serve temp files (voice samples, etc.)
app.use("/temp", express.static(path.join(__dirname, "temp")));

// Serve cache files (voice samples, videos, etc.)
app.use("/cache", express.static(path.join(__dirname, "cache")));

// Serve static frontend files (production)
if (process.env.NODE_ENV === "production") {
  app.use(express.static(path.join(__dirname, "public")));
}

// Mount v2 API
app.use("/api/v2", apiV2);

// Health check
app.get("/health", (req, res) => {
  res.json({
    status: "ok",
    message: "🎧 Immersion API is running",
    endpoints: {
      "POST /api/v2/process": "Process a video URL",
      "POST /api/v2/process-file": "Upload and process a file",
    },
  });
});

// Serve frontend in production
if (process.env.NODE_ENV === "production") {
  app.get("*", (req, res) => {
    res.sendFile(path.join(__dirname, "public", "index.html"));
  });
}

// The Main Endpoint
app.post("/immersion", async (req, res) => {
  const { url, level = "B2", voice = "noel" } = req.body;

  if (!url) {
    return res.status(400).json({ error: "No URL provided" });
  }

  // Validate level
  const validLevels = ["A1", "A2", "B1", "B2", "C1"];
  if (!validLevels.includes(level.toUpperCase())) {
    return res.status(400).json({
      error: `Invalid level. Must be one of: ${validLevels.join(", ")}`,
    });
  }

  try {
    console.log(`\n🚀 Starting processing for: ${url}`);
    console.log(`📚 Target level: ${level}, Voice: ${voice}\n`);

    const result = await processVideo(url, level.toUpperCase(), voice);

    res.json({
      status: "success",
      ...result,
    });
  } catch (error) {
    console.error("❌ Processing failed:", error);
    res.status(500).json({
      error: "Processing failed",
      message: error.message,
    });
  }
});

// Audio-only endpoint - natural flow without video sync
app.post("/immersion-audio", async (req, res) => {
  const { 
    url, 
    level = "B2", 
    voice = "noel",
    ttsSpeed = 0.92,      // TTS speaking speed (0.7 - 1.0)
    pauseDuration = 0.8,  // Pause between sections in seconds
  } = req.body;

  if (!url) {
    return res.status(400).json({ error: "No URL provided" });
  }

  const validLevels = ["A1", "A2", "B1", "B2", "C1"];
  if (!validLevels.includes(level.toUpperCase())) {
    return res.status(400).json({
      error: `Invalid level. Must be one of: ${validLevels.join(", ")}`,
    });
  }

  try {
    console.log(`\n🎧 Starting AUDIO-ONLY processing for: ${url}`);
    console.log(`📚 Level: ${level}, Voice: ${voice}, Speed: ${ttsSpeed}, Pause: ${pauseDuration}s\n`);

    const result = await processAudioOnly(url, level.toUpperCase(), voice, { ttsSpeed, pauseDuration });

    res.json({
      status: "success",
      ...result,
    });
  } catch (error) {
    console.error("❌ Audio-only processing failed:", error);
    res.status(500).json({
      error: "Processing failed",
      message: error.message,
    });
  }
});

// Test endpoint - simplification only (no audio generation)
// Great for testing without burning ElevenLabs credits
// Pass maxChunks=0 to process ALL chunks, or a number to limit
app.post("/test", async (req, res) => {
  const { url, level = "A2", maxChunks = 0 } = req.body;

  if (!url) {
    return res.status(400).json({ error: "No URL provided" });
  }

  try {
    console.log(`\n🧪 Test mode for: ${url}`);
    console.log(`📊 Max chunks: ${maxChunks || "ALL"}`);
    const result = await testSimplification(
      url,
      level.toUpperCase(),
      maxChunks
    );

    // Write transcript to file
    const timestamp = Date.now();
    const filename = `transcript_${result.videoId}_${level}_${timestamp}.txt`;
    const filepath = path.join(__dirname, "output", filename);

    let transcriptContent = `# Spanish Transcript (${level.toUpperCase()})\n`;
    transcriptContent += `# Video ID: ${result.videoId}\n`;
    transcriptContent += `# Chunks: ${result.processedChunks}/${result.totalChunks}\n`;
    transcriptContent += `# Generated: ${new Date().toISOString()}\n`;
    transcriptContent += `${"=".repeat(60)}\n\n`;

    result.samples.forEach((chunk, i) => {
      transcriptContent += `[Chunk ${i + 1}] ${chunk.timing}\n`;
      transcriptContent += `Original (${chunk.originalWordCount} words):\n${chunk.original}\n\n`;
      transcriptContent += `Spanish (${chunk.spanishWordCount} words):\n${chunk.spanish}\n`;
      transcriptContent += `${"-".repeat(60)}\n\n`;
    });

    fs.writeFileSync(filepath, transcriptContent);
    console.log(`📄 Transcript saved to: ${filepath}`);

    res.json({
      status: "success",
      transcriptFile: `/audio/${filename}`,
      ...result,
    });
  } catch (error) {
    console.error("❌ Test failed:", error);
    res.status(500).json({ error: "Test failed", message: error.message });
  }
});

// Quick TTS test - just generates one audio clip
app.post("/test-tts", async (req, res) => {
  const {
    text = "Hola, esto es una prueba del sistema de audio.",
    voice = "dora",
  } = req.body;
  const { generateChunkAudio, getAvailableVoices } = require("./src/audio");

  try {
    console.log(`\n🔊 TTS test: "${text.substring(0, 50)}..."`);

    const outputDir = path.join(__dirname, "output");
    const result = await generateChunkAudio(text, Date.now(), outputDir, voice);

    res.json({
      status: "success",
      audioUrl: `/audio/${result.fileName}`,
      size: `${(result.size / 1024).toFixed(1)} KB`,
      voice,
      availableVoices: getAvailableVoices(),
    });
  } catch (error) {
    console.error("❌ TTS test failed:", error);
    res.status(500).json({ error: "TTS failed", message: error.message });
  }
});

// Stitch audio chunks into single timed file
app.post("/stitch", async (req, res) => {
  const { jobId } = req.body;

  if (!jobId) {
    return res.status(400).json({ error: "No jobId provided" });
  }

  const { stitchAudio } = require("./src/stitch");
  const manifestPath = path.join(__dirname, "output", jobId, "manifest.json");

  if (!fs.existsSync(manifestPath)) {
    return res.status(404).json({ error: "Job not found", jobId });
  }

  try {
    console.log(`\n🎬 Stitching audio for job: ${jobId}`);
    const result = await stitchAudio(manifestPath);

    res.json({
      status: "success",
      audioUrl: `/audio/${jobId}/dubbed_audio.mp3`,
      duration: `${result.duration.toFixed(1)}s`,
      size: `${(result.size / 1024 / 1024).toFixed(1)} MB`,
    });
  } catch (error) {
    console.error("❌ Stitch failed:", error);
    res.status(500).json({ error: "Stitch failed", message: error.message });
  }
});

// Create dubbed video (downloads original + merges with dubbed audio)
app.post("/dub-video", async (req, res) => {
  const { jobId } = req.body;

  if (!jobId) {
    return res.status(400).json({ error: "No jobId provided" });
  }

  const { createDubbedVideo } = require("./src/video");
  const jobDir = path.join(__dirname, "output", jobId);
  const manifestPath = path.join(jobDir, "manifest.json");
  const dubbedAudioPath = path.join(jobDir, "dubbed_audio.mp3");

  if (!fs.existsSync(manifestPath)) {
    return res.status(404).json({ error: "Job not found", jobId });
  }

  if (!fs.existsSync(dubbedAudioPath)) {
    return res.status(400).json({ 
      error: "Dubbed audio not found. Run /stitch first.", 
      jobId 
    });
  }

  try {
    const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf-8"));
    const videoId = manifest.videoId;

    if (!videoId) {
      return res.status(400).json({ error: "No videoId in manifest" });
    }

    console.log(`\n🎬 Creating dubbed video for job: ${jobId}`);
    const result = await createDubbedVideo(videoId, dubbedAudioPath, jobDir);

    res.json({
      status: "success",
      videoUrl: `/audio/${jobId}/dubbed_video.mp4`,
      size: `${(result.size / 1024 / 1024).toFixed(1)} MB`,
    });
  } catch (error) {
    console.error("❌ Video creation failed:", error);
    res.status(500).json({ error: "Video creation failed", message: error.message });
  }
});

// Ensure output directories exist
const dirs = ["./output", "./temp"];
dirs.forEach((dir) => {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`
  ╔═══════════════════════════════════════════╗
  ║                                           ║
  ║   🌊  IMMERSION SERVER                    ║
  ║   Comprehensible Input Generator          ║
  ║                                           ║
  ║   Running on: http://localhost:${PORT}       ║
  ║                                           ║
  ╚═══════════════════════════════════════════╝
  `);
});
