# 🌊 Immersion

Transform any YouTube video into Comprehensible Input Spanish at your level.

Inspired by [Dreaming Spanish](https://www.dreamingspanish.com/) and Dr. Stephen Krashen's input hypothesis.

## What it does

1. Takes a YouTube URL (or any video from 1000+ supported sites)
2. Separates vocals from background audio (music/ambient preserved)
3. Transcribes the speech with speaker diarization
4. Uses AI to **simplify & translate** to your Spanish level (A1-C1)
5. Generates natural Spanish TTS audio
6. Aligns TTS timing to match original speech
7. Outputs a fully dubbed video with original background + Spanish speech

## v2 Pipeline

| Step          | Action                             | Technology                                  | Output                                    |
| ------------- | ---------------------------------- | ------------------------------------------- | ----------------------------------------- |
| 1. Ingest     | Download video, extract audio      | **yt-dlp** + **FFmpeg**                     | `source_video.mp4` + `source_audio.wav`   |
| 2. Split      | Separate vocals from background    | **Replicate Demucs** (htdemucs on A100 GPU) | `vocals.mp3` + `background.mp3`           |
| 3. Transcribe | Speech-to-text with timestamps     | **Lemonfox Whisper v3**                     | `transcription.json` (segments w/ timing) |
| 4. Translate  | Duration-aware translation         | **Google Gemini 2.5 Flash**                 | `translation.json` (with char budgets)    |
| 5. TTS        | Generate audio (native speed ctrl) | **Lemonfox TTS**                            | `tts/*.mp3` (natural speed, no stretching)|
| 7. Merge      | Combine background + aligned TTS   | **FFmpeg amix**                             | `dubbed_audio.mp3`                        |
| 8. Render     | Replace video audio track          | **FFmpeg**                                  | `dubbed_video.mp4` ✨                     |

### Cost Estimates (per 5-minute video)

| Service          | Usage      | Cost               |
| ---------------- | ---------- | ------------------ |
| Replicate Demucs | 1 run      | ~$0.07             |
| Lemonfox STT     | 5 min      | ~$0.01             |
| Gemini 2.5 Flash | ~2K tokens | ~$0.00 (free tier) |
| Lemonfox TTS     | ~3K chars  | ~$0.01             |
| **Total**        |            | **~$0.10**         |

## Quick Start

```bash
# Install dependencies
npm install

# Set up your API keys
cp .env.example .env
# Edit .env with your keys

# Run the full pipeline on a video
node pipeline-v2.js "https://youtube.com/watch?v=VIDEO_ID"

# Or run individual steps
node test-v2-split.js "https://youtube.com/watch?v=VIDEO_ID"
node test-v2-transcribe.js
node test-v2-translate.js
node test-v2-tts.js
node test-v2-merge.js
```

## API Usage

### Process a video (legacy v1)

```bash
curl -X POST http://localhost:3000/immersion \
  -H "Content-Type: application/json" \
  -d '{"url": "https://youtube.com/watch?v=VIDEO_ID", "level": "A2"}'
```

### Levels

| Level | Name               | Description                   |
| ----- | ------------------ | ----------------------------- |
| A1    | Superbeginner      | 500 words, present tense only |
| A2    | Beginner           | 1500 words, simple past       |
| B1    | Intermediate       | 3000 words, all indicative    |
| B2    | Upper Intermediate | Full grammar                  |
| C1    | Advanced           | Native-like                   |

## Environment Variables

```env
# Required for v2 pipeline
REPLICATE_API_TOKEN=r8_xxx     # Demucs audio separation
LEMONFOX_API_KEY=lf_xxx        # Whisper STT + TTS
GEMINI_API_KEY=xxx             # Translation

# Optional (legacy v1)
ELEVENLABS_API_KEY=xxx
PORT=3000
```

## Project Structure

```
server/
├── pipeline-v2.js             # Full v2 pipeline (one command)
├── server.js                  # Express server (legacy v1)
├── src/
│   ├── v2/                    # v2 Pipeline modules
│   │   ├── ingest.js          # Download + extract audio
│   │   ├── split.js           # Demucs via Replicate
│   │   ├── transcribe.js      # Lemonfox Whisper
│   │   ├── translate.js       # Gemini translation
│   │   ├── tts.js             # Lemonfox TTS + alignment
│   │   ├── merge.js           # FFmpeg audio mixing
│   │   └── index.js           # Module exports
│   ├── transcript.js          # YouTube transcript (legacy)
│   ├── simplify.js            # Gemini simplification (legacy)
│   ├── audio.js               # ElevenLabs (legacy)
│   └── immersionLogic.js      # v1 pipeline
├── test-v2-*.js               # Individual step test scripts
├── output/                    # Generated job outputs
└── temp/                      # Temporary processing files
```

## Tech Stack (v2)

| Component        | Technology                  | Purpose                     |
| ---------------- | --------------------------- | --------------------------- |
| Video Download   | **yt-dlp**                  | 1000+ site support          |
| Audio Processing | **FFmpeg**                  | Extract, transform, merge   |
| Vocal Separation | **Replicate Demucs**        | AI stem separation (GPU)    |
| Speech-to-Text   | **Lemonfox Whisper v3**     | Transcription + diarization |
| Translation      | **Google Gemini 2.5 Flash** | Duration-aware, CEFR-level  |
| Text-to-Speech   | **Lemonfox TTS**            | Native speed control        |
| Runtime          | **Node.js**                 | Pipeline orchestration      |

## License

MIT
