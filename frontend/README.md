# Immersion Frontend

The web interface for transforming videos into comprehensible language learning content.

## Overview

This is the React frontend for the Immersion video dubbing platform. It provides an intuitive interface for users to upload videos or paste YouTube URLs and transform them into language learning content with adaptive difficulty levels and multiple voice options.

## Tech Stack

- **React 19** - Latest React with modern features
- **Vite** - Fast build tool and dev server
- **Lucide React** - Beautiful icon library
- **CSS Modules** - Component-scoped styling

## Features

### User Tiers

- **Learner** - Fast processing with standard TTS voices (A1-A2)
- **Immerser** - Premium ElevenLabs voices (A1-B2)
- **Pro** - Voice cloning with XTTS + TikTok export (A1-C1)

### Core Functionality

- YouTube URL processing
- File upload support (drag & drop)
- Real-time job status tracking
- Video preview and playback
- Download processed videos
- Multiple processing modes (synced, narrator, learner, etc.)
- Language selection (Spanish, Indonesian)
- Adaptive difficulty levels (A1-C1)

## Getting Started

### Prerequisites

- Node.js 20+
- A running instance of the Immersion backend API

### Installation

```bash
# Clone the repository
git clone <your-repo-url>
cd frontend

# Install dependencies
npm install
```

### Development

Start the development server:

```bash
npm run dev
```

The app will be available at `http://localhost:5173`

The dev server includes a proxy configuration that forwards API requests to `http://localhost:3000` (the backend).

### Building for Production

```bash
# Build the app
npm run build

# Preview the production build locally
npm run preview
```

The build output will be in the `dist/` directory.

## Project Structure

```
frontend/
├── src/
│   ├── App.jsx          # Main application component
│   ├── App.css          # Application styles
│   ├── main.jsx         # Entry point
│   └── index.css        # Global styles
├── public/              # Static assets
├── index.html           # HTML template
├── vite.config.js       # Vite configuration
├── package.json         # Dependencies and scripts
└── eslint.config.js     # ESLint configuration
```

## Configuration

### API URL

The frontend connects to the backend API via proxy in development. Update `vite.config.js` if your backend runs on a different port:

```javascript
server: {
  proxy: {
    '/api': {
      target: 'http://localhost:3000',  // Change this if needed
      changeOrigin: true,
    },
  },
}
```

### Tier Configuration

User tiers are configured in `App.jsx` under `TIER_INFO`. Each tier defines:

- Available language levels
- Features and capabilities
- Cost estimates
- UI colors and branding

## API Integration

The frontend communicates with the backend through these endpoints:

- `POST /api/v2/process` - Process YouTube URL
- `POST /api/v2/process-file` - Upload and process video file
- `GET /api/v2/status/:jobId` - Check job status
- `GET /api/v2/output/:filename` - Download processed video
- `GET /api/v2/jobs` - List all jobs
- `DELETE /api/v2/job/:jobId` - Cancel/delete job

## Available Scripts

| Command           | Description                       |
| ----------------- | --------------------------------- |
| `npm run dev`     | Start development server with HMR |
| `npm run build`   | Build for production              |
| `npm run preview` | Preview production build          |
| `npm run lint`    | Run ESLint                        |

## Environment Variables

The frontend doesn't require environment variables for local development. For production deployments, ensure the API proxy is configured correctly or set the base API URL.

## Deployment

### Static Hosting (Netlify, Vercel, etc.)

1. Build the app:

   ```bash
   npm run build
   ```

2. Deploy the `dist/` directory to your hosting provider

3. Configure rewrites to handle client-side routing:
   - **Netlify**: Create `_redirects` file in `public/`:
     ```
     /api/* https://your-backend-url.com/api/:splat 200
     /* /index.html 200
     ```
   - **Vercel**: Create `vercel.json`:
     ```json
     {
       "rewrites": [
         {
           "source": "/api/:path*",
           "destination": "https://your-backend-url.com/api/:path*"
         },
         { "source": "/(.*)", "destination": "/index.html" }
       ]
     }
     ```

### Docker

Build and run with Docker:

```bash
# Build image
docker build -t immersion-frontend .

# Run container
docker run -p 5173:5173 immersion-frontend
```

## Development Tips

### Hot Module Replacement (HMR)

Vite provides instant HMR. Changes to React components will update immediately without losing state.

### Component State

The main `App.jsx` component manages:

- Selected tier (learner/immerser/pro)
- Form inputs (URL, level, voice, mode, language)
- Job tracking and status polling
- Video preview and playback

### Styling

Styles are in `App.css` with CSS variables for theming. The design uses:

- Dark theme by default
- Gradient backgrounds for tier cards
- Responsive layout
- Smooth animations and transitions

### Adding New Features

To add a new processing option:

1. Add the option to configuration constants in `App.jsx`
2. Update the form UI to include the new option
3. Include it in the API request payload
4. Update the backend API to handle the new parameter

## Browser Support

- Chrome/Edge 90+
- Firefox 88+
- Safari 14+

Modern features used:

- CSS Grid and Flexbox
- Fetch API
- ES2020+ JavaScript
- React 19 features

## Contributing

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

## Troubleshooting

### Backend Connection Issues

If the frontend can't connect to the backend:

1. Ensure the backend is running on `http://localhost:3000`
2. Check `vite.config.js` proxy configuration
3. Verify CORS settings in the backend

### Build Errors

If you encounter build errors:

```bash
# Clear node_modules and reinstall
rm -rf node_modules package-lock.json
npm install

# Clear Vite cache
rm -rf .vite
```

## License

MIT

## Related

- [Backend Repository](../server) - Node.js API server
- [Main Documentation](../README.md) - Project overview
