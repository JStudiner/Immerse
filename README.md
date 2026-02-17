# Immersion

Transform any video into comprehensible input for language learning. Dub YouTube videos (or uploads) into simplified Spanish at your level, with the original background audio preserved.

Inspired by [Dreaming Spanish](https://dreamingspanish.com) and the comprehensible input methodology by Dr. Stephen Krashen.

## How It Works

1. Download/upload a video, extract the audio
2. Separate vocals from background (music, ambient sounds preserved)
3. Transcribe speech with speaker diarization
4. Translate and simplify to your Spanish level (A1-C1)
5. Generate natural Spanish TTS (or clone the original speaker's voice)
6. Align TTS timing to match original speech
7. Output a fully dubbed video you can download to your phone

## Features

- **Adaptive Levels** - A1 to C1 CEFR language difficulty
- **Voice Cloning** - XTTS clones the original speaker's voice
- **Premium Voices** - ElevenLabs high-quality TTS (optional)
- **Standard Voices** - Fast Lemonfox preset voices
- **Multiple Modes** - Synced, narrator, learner, extended, and more
- **YouTube Support** - Paste a URL, or upload your own video
- **TikTok Export** - Vertical short-form output
- **Multi-language** - Spanish and Indonesian (more coming)
- **Phone Friendly** - Use from any device, download videos directly

## Pipeline

| Step       | Action                          | Technology                   | Output                                  |
| ---------- | ------------------------------- | ---------------------------- | --------------------------------------- |
| Ingest     | Download video, extract audio   | yt-dlp + FFmpeg              | `source_video.mp4` + `source_audio.wav` |
| Split      | Separate vocals from background | Replicate Demucs (GPU)       | `vocals.mp3` + `background.mp3`         |
| Transcribe | Speech-to-text with timestamps  | Lemonfox Whisper v3          | `transcription.json`                    |
| Translate  | Duration-aware simplification   | Google Gemini 2.5 Flash      | `translation.json`                      |
| TTS        | Generate dubbed audio           | Lemonfox / ElevenLabs / XTTS | `tts/*.wav`                             |
| Merge      | Combine background + TTS        | FFmpeg                       | `dubbed_audio.m4a`                      |
| Render     | Replace video audio track       | FFmpeg                       | `dubbed_video.mp4`                      |

### Cost Per Video (~5 minutes)

| Service            | Cost               |
| ------------------ | ------------------ |
| Replicate Demucs   | ~$0.07             |
| Lemonfox Whisper   | ~$0.01             |
| Gemini Translation | ~$0.00 (free tier) |
| Lemonfox TTS       | ~$0.01             |
| **Total**          | **~$0.10**         |

Voice cloning (XTTS): ~$0.05 extra. ElevenLabs premium: ~$0.40 extra.

## Quick Start (Local Development)

### Prerequisites

- Node.js 20+
- FFmpeg installed
- API keys: Replicate, Lemonfox, Gemini

### Setup

```bash
git clone https://github.com/yourusername/Immersion.git
cd Immersion

# Backend
cd server
npm install
cp .env.example .env
# Edit .env with your API keys

# Frontend
cd ../frontend
npm install
```

### Run

Terminal 1 (Backend):

```bash
cd server
npm run dev
```

Terminal 2 (Frontend):

```bash
cd frontend
npm run dev
```

Open http://localhost:5173 in your browser.

## Deploy (Access From Anywhere)

The whole app (frontend + backend) is packaged into a single Docker container.

### Option A: Cloudflare Tunnel (free, instant)

Run from your own machine with a public URL for phone access:

```bash
./deploy.sh tunnel
```

Opens a free HTTPS URL you can use on your phone. Works whenever your machine is on.

### Option B: Cloud Server ($4-12/month)

Deploy to DigitalOcean, Hetzner, Oracle Cloud, etc:

```bash
# On the server after cloning:
cp server/.env.example server/.env
nano server/.env  # Add API keys
docker compose up -d --build
```

See [DEPLOYMENT.md](DEPLOYMENT.md) for detailed guides per platform.

### Option C: Docker locally

```bash
./deploy.sh local
# App runs at http://localhost:3000
```

### Environment Variables

```bash
# Required
REPLICATE_API_KEY=your_key    # Audio separation + voice cloning
LEMONFOX_API_KEY=your_key     # Transcription + standard TTS
GEMINI_API_KEY=your_key       # Translation

# Optional
ELEVENLABS_API_KEY=your_key   # Premium voices
AUTH_PASSWORD=your_password    # Password-protect your instance
PORT=3000
NODE_ENV=production
```

## API

### Process a URL

```bash
curl -X POST http://localhost:3000/api/v2/process \
  -H "Content-Type: application/json" \
  -d '{
    "url": "https://youtube.com/watch?v=...",
    "level": "B1",
    "voice": "auto",
    "mode": "synced",
    "language": "spanish"
  }'
```

### Upload a File

```bash
curl -X POST http://localhost:3000/api/v2/process-file \
  -F "file=@video.mp4" \
  -F "level=B1" \
  -F "voice=neutral" \
  -F "mode=synced" \
  -F "language=spanish"
```

### Check Status

```bash
curl http://localhost:3000/api/v2/status/{jobId}
```

## Project Structure

```
Immersion/
├── frontend/                # React 19 + Vite
│   ├── src/
│   │   ├── App.jsx          # Main app component
│   │   └── App.css          # Styles
│   └── package.json
├── server/                  # Node.js + Express
│   ├── server.js            # Express server + auth
│   ├── api-v2.js            # API routes
│   ├── pipeline-v2.js       # Pipeline orchestrator
│   ├── src/v2/              # Pipeline modules
│   │   ├── ingest.js        # Download + extract audio
│   │   ├── split.js         # Demucs/Spleeter separation
│   │   ├── transcribe.js    # Whisper STT
│   │   ├── translate.js     # Gemini translation
│   │   ├── tts.js           # Lemonfox TTS
│   │   ├── xtts.js          # XTTS voice cloning
│   │   ├── elevenlabs.js    # ElevenLabs premium TTS
│   │   ├── merge.js         # FFmpeg audio mixing
│   │   └── voice-extract.js # Voice sample extraction
│   ├── input/               # Uploaded files
│   ├── output/              # Generated videos
│   ├── temp/                # Temporary files
│   └── cache/               # Cached results
├── Dockerfile               # Production Docker build
├── docker-compose.yml       # One-command deployment
├── deploy.sh                # Deploy helper script
├── setup-server.sh          # VPS setup script
└── DEPLOYMENT.md            # Detailed deployment guide
```

## Language Levels

| Level | Name               | Description                        |
| ----- | ------------------ | ---------------------------------- |
| A1    | Superbeginner      | ~500 words, present tense only     |
| A2    | Beginner           | ~1500 words, simple past           |
| B1    | Intermediate       | ~3000 words, all indicative tenses |
| B2    | Upper Intermediate | Full grammar                       |
| C1    | Advanced           | Native-like complexity             |

## Processing Modes

| Mode          | Description                                |
| ------------- | ------------------------------------------ |
| Synced        | Direct translation keeping original timing |
| Narrator      | Time-filling with slower, clearer speech   |
| Narrator Only | Only dub the main speaker                  |
| Learner       | Slower TTS, audio-only output              |
| Extended      | Video stretched to fit full translation    |

## License

MIT
