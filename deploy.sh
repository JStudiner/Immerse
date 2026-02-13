#!/usr/bin/env bash
# ============================================================================
# Immersion Deploy Script
# 
# Usage:
#   ./deploy.sh local        - Run with Docker locally (port 3000)
#   ./deploy.sh tunnel       - Run locally + Cloudflare Tunnel (free public URL)
#   ./deploy.sh stop         - Stop everything
#   ./deploy.sh status       - Check if running
#   ./deploy.sh logs         - Show container logs
# ============================================================================

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$SCRIPT_DIR"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

log()   { echo -e "${GREEN}[+]${NC} $1"; }
warn()  { echo -e "${YELLOW}[!]${NC} $1"; }
err()   { echo -e "${RED}[x]${NC} $1"; }
info()  { echo -e "${BLUE}[i]${NC} $1"; }

# ── Preflight checks ──────────────────────────────────────────────────────

check_docker() {
    if ! command -v docker &> /dev/null; then
        err "Docker is not installed."
        echo "  Install: https://docs.docker.com/engine/install/"
        exit 1
    fi
    if ! docker info &> /dev/null; then
        err "Docker daemon is not running. Start it first."
        exit 1
    fi
    log "Docker is ready"
}

check_env() {
    if [ ! -f "server/.env" ]; then
        err "server/.env not found!"
        echo ""
        echo "  Create it from the example:"
        echo "    cp server/.env.example server/.env"
        echo "    nano server/.env  # Add your API keys"
        echo ""
        exit 1
    fi
    
    # Check for required keys
    local missing=0
    for key in REPLICATE_API_KEY LEMONFOX_API_KEY GEMINI_API_KEY; do
        val=$(grep "^${key}=" server/.env 2>/dev/null | cut -d= -f2)
        if [ -z "$val" ] || [ "$val" = "your_replicate_key_here" ] || [ "$val" = "your_lemonfox_key_here" ] || [ "$val" = "your_gemini_key_here" ]; then
            warn "Missing or placeholder: $key"
            missing=1
        fi
    done
    
    if [ $missing -eq 1 ]; then
        warn "Some API keys are missing. The app will start but processing won't work."
        echo "  Edit: server/.env"
        echo ""
    else
        log "API keys configured"
    fi
}

# ── Commands ───────────────────────────────────────────────────────────────

cmd_local() {
    log "Building and starting Immersion..."
    check_docker
    check_env
    
    # Build and start
    docker compose up -d --build
    
    echo ""
    log "Immersion is running!"
    echo ""
    echo "  Local:  http://localhost:3000"
    echo ""
    echo "  Stop:   ./deploy.sh stop"
    echo "  Logs:   ./deploy.sh logs"
    echo "  Tunnel: ./deploy.sh tunnel  (for phone access)"
    echo ""
}

cmd_tunnel() {
    log "Starting Immersion with Cloudflare Tunnel..."
    check_docker
    check_env
    
    # Make sure cloudflared is available
    install_cloudflared
    
    # Start the app if not running
    if ! docker compose ps --format json 2>/dev/null | grep -q '"running"'; then
        log "Starting Docker containers..."
        docker compose up -d --build
        sleep 3
    else
        log "Containers already running"
    fi
    
    # Verify health
    if ! curl -sf http://localhost:3000/health > /dev/null 2>&1; then
        err "App doesn't seem healthy. Check logs: ./deploy.sh logs"
        exit 1
    fi
    log "App is healthy"
    
    echo ""
    log "Starting Cloudflare Tunnel..."
    info "A public HTTPS URL will appear below. Open it on your phone!"
    info "Press Ctrl+C to stop the tunnel (containers keep running)"
    echo ""
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    
    # Run cloudflared (blocks until Ctrl+C)
    ./cloudflared tunnel --url http://localhost:3000 2>&1 | grep --line-buffered -E "https://.*trycloudflare.com|INF |ERR "
}

install_cloudflared() {
    if [ -f "./cloudflared" ]; then
        log "cloudflared already downloaded"
        return
    fi
    
    if command -v cloudflared &> /dev/null; then
        log "cloudflared is installed system-wide"
        # Use system cloudflared
        ln -sf "$(which cloudflared)" ./cloudflared
        return
    fi
    
    log "Downloading cloudflared..."
    local arch
    arch=$(uname -m)
    local url=""
    
    case "$arch" in
        x86_64)  url="https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64" ;;
        aarch64) url="https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-arm64" ;;
        armv7l)  url="https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-arm" ;;
        *)
            err "Unsupported architecture: $arch"
            echo "  Download manually from: https://github.com/cloudflare/cloudflared/releases"
            exit 1
            ;;
    esac
    
    curl -L "$url" -o cloudflared
    chmod +x cloudflared
    log "cloudflared downloaded"
}

cmd_stop() {
    log "Stopping Immersion..."
    docker compose down 2>/dev/null || true
    log "Stopped"
}

cmd_status() {
    echo ""
    if docker compose ps --format json 2>/dev/null | grep -q '"running"'; then
        log "Immersion is RUNNING"
        echo ""
        docker compose ps
        echo ""
        # Health check
        if curl -sf http://localhost:3000/health > /dev/null 2>&1; then
            log "Health: OK"
            echo "  URL: http://localhost:3000"
        else
            warn "Container running but health check failed"
        fi
    else
        info "Immersion is NOT running"
        echo "  Start: ./deploy.sh local"
    fi
    echo ""
}

cmd_logs() {
    docker compose logs -f --tail 100
}

# ── Main ───────────────────────────────────────────────────────────────────

case "${1:-}" in
    local)   cmd_local ;;
    tunnel)  cmd_tunnel ;;
    stop)    cmd_stop ;;
    status)  cmd_status ;;
    logs)    cmd_logs ;;
    *)
        echo ""
        echo "  Immersion Deploy"
        echo "  ──────────────────────────────────────"
        echo ""
        echo "  Usage: ./deploy.sh <command>"
        echo ""
        echo "  Commands:"
        echo "    local    Build and run locally (port 3000)"
        echo "    tunnel   Run + Cloudflare Tunnel (free public HTTPS URL)"
        echo "    stop     Stop all containers"
        echo "    status   Check if running"
        echo "    logs     Show container logs"
        echo ""
        echo "  Quick start:"
        echo "    1. cp server/.env.example server/.env"
        echo "    2. Edit server/.env with your API keys"
        echo "    3. ./deploy.sh tunnel"
        echo "    4. Open the URL on your phone"
        echo ""
        ;;
esac
