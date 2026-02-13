# 🌊 Immersion

Transform any video into comprehensible input for language learning.

**Live Demo:** [Coming soon - deploy yours!]

## Features

- 🎬 **Video Dubbing** - Transform YouTube videos or uploads into comprehensible Spanish
- 📚 **Adaptive Levels** - A1 to C1 language difficulty levels
- 🎙️ **Voice Options** - Standard voices, premium ElevenLabs, or AI voice cloning
- 🎯 **Multiple Modes** - Synced, narrator, learner, and more
- 📱 **TikTok Export** - Create vertical short-form content
- 🌐 **Multi-language** - Spanish and Indonesian (more coming soon)

## Tech Stack

### Frontend
- React 19
- Vite
- Lucide React icons

### Backend
- Node.js + Express
- FFmpeg for audio/video processing
- Multiple AI services:
  - **Replicate** (Demucs audio separation, XTTS voice cloning)
  - **Lemonfox** (Whisper transcription, TTS)
  - **Google Gemini** (Translation)
  - **ElevenLabs** (Premium TTS - optional)

## Local Development

### Prerequisites

- Node.js 20+
- FFmpeg
- API keys for: Replicate, Lemonfox, Gemini

### Setup

1. **Clone the repository**
   ```bash
   git clone https://github.com/yourusername/Immersion.git
   cd Immersion
   ```

2. **Install dependencies**
   ```bash
   # Backend
   cd server
   npm install
   
   # Frontend
   cd ../frontend
   npm install
   ```

3. **Configure environment variables**
   ```bash
   cd ../server
   cp .env.example .env
   nano .env  # Add your API keys
   ```

4. **Start development servers**
   
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

5. **Open the app**
   - Frontend: http://localhost:5173
   - Backend API: http://localhost:3000

## Deployment

See [DEPLOYMENT.md](DEPLOYMENT.md) for detailed deployment instructions.

### Quick Deploy to Railway

1. Push to GitHub
2. Go to [railway.app](https://railway.app) → New Project → Deploy from GitHub
3. Add environment variables
4. Generate domain
5. Done! 🎉

### Environment Variables

```bash
# Required
REPLICATE_API_KEY=your_replicate_key
LEMONFOX_API_KEY=your_lemonfox_key
GEMINI_API_KEY=your_gemini_key

# Optional
ELEVENLABS_API_KEY=your_elevenlabs_key  # For premium voices
PORT=3000
NODE_ENV=production
```

## Project Structure

```
Immersion/
├── frontend/              # React frontend
│   ├── src/
│   │   ├── App.jsx       # Main app component
│   │   └── App.css       # Styles
│   ├── package.json
│   └── vite.config.js
├── server/               # Node.js backend
│   ├── src/
│   │   └── v2/          # Pipeline v2 modules
│   ├── server.js        # Express server
│   ├── api-v2.js        # API routes
│   ├── pipeline-v2.js   # Main pipeline
│   ├── input/           # Uploaded files
│   ├── output/          # Generated videos
│   ├── temp/            # Temporary files
│   └── cache/           # Cached results
├── Dockerfile           # Production build
├── .dockerignore
└── DEPLOYMENT.md        # Deployment guide
```

## API Usage

### Process URL

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

### Upload File

```bash
curl -X POST http://localhost:3000/api/v2/process-file \
  -F "file=@video.mp4" \
  -F "level=B2" \
  -F "voice=neutral" \
  -F "mode=synced" \
  -F "language=spanish"
```

### Check Status

```bash
curl http://localhost:3000/api/v2/status/{jobId}
```

## Cost Estimates

Processing costs vary by features used:

- **Learner tier** (Standard TTS): ~$0.05 per 5 minutes
- **Immerser tier** (ElevenLabs): ~$0.50 per 5 minutes
- **Pro tier** (Voice Cloning): ~$0.40 per 5 minutes
- **Lip Sync** (optional): +$6.00 per 5 minutes

## Features in Detail

### Language Levels

- **A1** - Superbeginner (500 words, present tense only)
- **A2** - Beginner (1500 words, simple past)
- **B1** - Intermediate (3000 words, all indicative tenses)
- **B2** - Upper Intermediate (full grammar)
- **C1** - Advanced (native-like complexity)

### Processing Modes

- **Synced** - Direct translation keeping original timing
- **Narrator** - Time-filling with slower, clearer speech
- **Narrator Only** - Only dub the main speaker
- **Learner** - Slower TTS, audio-only output
- **Extended** - Video stretched to fit full translation
- **Brainrot** - TikTok-style narration

### Voice Options

- **Standard** - Fast Lemonfox preset voices
- **Premium** - High-quality ElevenLabs voices
- **Voice Clone** - XTTS clones the original speaker

## Contributing

Contributions welcome! Please open an issue or PR.

## License

MIT

## Acknowledgments

Inspired by [Dreaming Spanish](https://dreamingspanish.com) and the comprehensible input methodology by Dr. Stephen Krashen.

---

Built with ❤️ for language learners
