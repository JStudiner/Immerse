# Multi-stage build for smaller image
FROM node:20-slim AS frontend-build

# Install frontend dependencies
WORKDIR /app/frontend
COPY frontend/package*.json ./
RUN npm ci

# Build frontend
COPY frontend/ ./
RUN npm run build

# Production stage
FROM node:20-slim

# Install system dependencies:
#   ffmpeg  - audio/video processing (core pipeline requirement)
#   python3 - needed by yt-dlp for some extractors
#   curl    - healthcheck probe
RUN apt-get update && apt-get install -y --no-install-recommends \
    ffmpeg \
    python3 \
    curl \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy server dependencies and install (production only)
COPY server/package*.json ./
RUN npm ci --omit=dev

# Copy server code
COPY server/ ./

# Copy built frontend
COPY --from=frontend-build /app/frontend/dist ./public

# Create necessary directories
RUN mkdir -p input output temp cache

# Expose port
EXPOSE 3000

# Set environment
ENV NODE_ENV=production

# Healthcheck
HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=3 \
    CMD curl -f http://localhost:3000/health || exit 1

# Start server
CMD ["node", "server.js"]
