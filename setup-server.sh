#!/usr/bin/env bash
# ============================================================================
# Immersion Server Setup Script
#
# Run this on a fresh Ubuntu 22.04+ VPS (Oracle Cloud, Hetzner, DigitalOcean, etc.)
# 
# Usage:
#   curl -sSL <raw-github-url>/setup-server.sh | bash
#   # or after cloning:
#   ./setup-server.sh
#
# What it does:
#   1. Installs Docker
#   2. Clones the repo (if not already in it)
#   3. Prompts for API keys
#   4. Builds and starts Immersion
#   5. Sets up firewall rules
#   6. Optionally installs Caddy for HTTPS
# ============================================================================

set -e

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

log()   { echo -e "${GREEN}[+]${NC} $1"; }
warn()  { echo -e "${YELLOW}[!]${NC} $1"; }
err()   { echo -e "${RED}[x]${NC} $1"; exit 1; }
info()  { echo -e "${BLUE}[i]${NC} $1"; }

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  Immersion Server Setup"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

# ── Step 1: Install Docker ─────────────────────────────────────────────────

if command -v docker &> /dev/null; then
    log "Docker already installed: $(docker --version)"
else
    log "Installing Docker..."
    curl -fsSL https://get.docker.com | sh
    
    # Add current user to docker group (avoid sudo for docker commands)
    if [ "$EUID" -eq 0 ]; then
        # Running as root - also set up for a non-root user if one exists
        log "Running as root, Docker accessible directly"
    else
        sudo usermod -aG docker "$USER"
        warn "Added $USER to docker group. You may need to log out and back in."
    fi
    
    log "Docker installed: $(docker --version)"
fi

# Ensure docker compose plugin is available
if ! docker compose version &> /dev/null; then
    log "Installing Docker Compose plugin..."
    sudo apt-get update -qq
    sudo apt-get install -y -qq docker-compose-plugin
fi
log "Docker Compose: $(docker compose version --short)"

# ── Step 2: Clone repo if needed ──────────────────────────────────────────

REPO_DIR=""
if [ -f "./docker-compose.yml" ] && [ -f "./Dockerfile" ]; then
    REPO_DIR="$(pwd)"
    log "Already in Immersion repo: $REPO_DIR"
elif [ -f "./Immersion/docker-compose.yml" ]; then
    REPO_DIR="$(pwd)/Immersion"
    log "Found Immersion repo: $REPO_DIR"
else
    log "Cloning Immersion repository..."
    
    read -rp "GitHub repo URL (or press Enter for default): " REPO_URL
    REPO_URL="${REPO_URL:-https://github.com/yourusername/Immersion.git}"
    
    git clone "$REPO_URL" Immersion
    REPO_DIR="$(pwd)/Immersion"
    log "Cloned to: $REPO_DIR"
fi

cd "$REPO_DIR"

# ── Step 3: Configure API keys ────────────────────────────────────────────

if [ -f "server/.env" ]; then
    log "server/.env already exists"
    read -rp "Overwrite API keys? (y/N): " overwrite
    if [ "$overwrite" != "y" ] && [ "$overwrite" != "Y" ]; then
        log "Keeping existing .env"
    else
        configure_env=true
    fi
else
    configure_env=true
fi

if [ "${configure_env:-false}" = true ]; then
    log "Configuring API keys..."
    echo ""
    
    read -rp "  Replicate API key: " REPLICATE_KEY
    read -rp "  Lemonfox API key:  " LEMONFOX_KEY
    read -rp "  Gemini API key:    " GEMINI_KEY
    read -rp "  ElevenLabs key (optional, press Enter to skip): " ELEVENLABS_KEY
    
    cat > server/.env << EOF
# API Keys
REPLICATE_API_KEY=${REPLICATE_KEY}
LEMONFOX_API_KEY=${LEMONFOX_KEY}
GEMINI_API_KEY=${GEMINI_KEY}
ELEVENLABS_API_KEY=${ELEVENLABS_KEY}

# Server
PORT=3000
NODE_ENV=production
EOF
    
    log "API keys saved to server/.env"
fi

# ── Step 4: Build and start ───────────────────────────────────────────────

log "Building Docker image (this may take a few minutes on first run)..."
docker compose up -d --build

# Wait for health
log "Waiting for app to start..."
for i in {1..30}; do
    if curl -sf http://localhost:3000/health > /dev/null 2>&1; then
        break
    fi
    sleep 2
done

if curl -sf http://localhost:3000/health > /dev/null 2>&1; then
    log "Immersion is running and healthy!"
else
    err "App didn't start. Check logs: docker compose logs"
fi

# ── Step 5: Firewall ──────────────────────────────────────────────────────

# Open port 3000 (and 80/443 for HTTPS later)
if command -v ufw &> /dev/null; then
    log "Configuring firewall (ufw)..."
    sudo ufw allow 22/tcp   > /dev/null 2>&1 || true  # SSH
    sudo ufw allow 80/tcp   > /dev/null 2>&1 || true  # HTTP
    sudo ufw allow 443/tcp  > /dev/null 2>&1 || true  # HTTPS
    sudo ufw allow 3000/tcp > /dev/null 2>&1 || true  # App
    sudo ufw --force enable > /dev/null 2>&1 || true
    log "Firewall configured"
elif command -v iptables &> /dev/null; then
    # Oracle Cloud uses iptables by default
    log "Opening ports via iptables..."
    sudo iptables -I INPUT -p tcp --dport 3000 -j ACCEPT 2>/dev/null || true
    sudo iptables -I INPUT -p tcp --dport 80 -j ACCEPT 2>/dev/null || true
    sudo iptables -I INPUT -p tcp --dport 443 -j ACCEPT 2>/dev/null || true
    # Persist rules
    sudo sh -c 'iptables-save > /etc/iptables/rules.v4' 2>/dev/null || true
    log "iptables rules configured"
fi

# ── Step 6: Show results ──────────────────────────────────────────────────

PUBLIC_IP=$(curl -sf https://ifconfig.me 2>/dev/null || curl -sf https://api.ipify.org 2>/dev/null || echo "YOUR_SERVER_IP")

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
log "Setup complete!"
echo ""
echo "  Your Immersion app is live at:"
echo ""
echo "    http://${PUBLIC_IP}:3000"
echo ""
echo "  Open this URL on your phone to start dubbing videos!"
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
info "Oracle Cloud users: Don't forget to open port 3000 in your"
info "  Security List (Networking > Virtual Cloud Networks > Security Lists)"
echo ""
info "For HTTPS with a custom domain, install Caddy:"
echo "    sudo apt install -y debian-keyring debian-archive-keyring apt-transport-https"
echo "    curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | sudo gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg"
echo "    curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | sudo tee /etc/apt/sources.list.d/caddy-stable.list"
echo "    sudo apt update && sudo apt install caddy"
echo "    # Then create /etc/caddy/Caddyfile with:"
echo "    # yourdomain.com {"
echo "    #     reverse_proxy localhost:3000"
echo "    # }"
echo "    # sudo systemctl restart caddy"
echo ""
info "Useful commands:"
echo "    docker compose logs -f      # View logs"
echo "    docker compose restart      # Restart"
echo "    docker compose down         # Stop"
echo "    git pull && docker compose up -d --build  # Update"
echo ""
