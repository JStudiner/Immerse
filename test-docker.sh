#!/bin/bash

# Test Docker build before deploying

echo "🧪 Testing Docker build..."
echo ""

# Check if Docker is installed
if ! command -v docker &> /dev/null; then
    echo "❌ Docker is not installed"
    echo "   Install from: https://docs.docker.com/get-docker/"
    exit 1
fi

echo "✅ Docker is installed"
echo ""

# Check if .env exists
if [ ! -f server/.env ]; then
    echo "⚠️  No server/.env file found"
    echo "   Copying from .env.example..."
    cp server/.env.example server/.env
    echo "   ⚠️  Please edit server/.env and add your API keys before testing"
    echo ""
    read -p "Press Enter once you've added your API keys..."
fi

echo "🏗️  Building Docker image..."
echo "   (This may take 2-5 minutes the first time)"
echo ""

# Build the image
docker build -t immersion-test . 2>&1 | tee build.log

if [ ${PIPESTATUS[0]} -eq 0 ]; then
    echo ""
    echo "✅ Build successful!"
    echo ""
    echo "🚀 Would you like to test it locally?"
    read -p "Start container? (y/n) " -n 1 -r
    echo
    
    if [[ $REPLY =~ ^[Yy]$ ]]; then
        echo "Starting container on port 3000..."
        echo "Press Ctrl+C to stop"
        echo ""
        docker run -p 3000:3000 \
            --env-file server/.env \
            -v "$(pwd)/server/output:/app/output" \
            -v "$(pwd)/server/cache:/app/cache" \
            immersion-test
    fi
else
    echo ""
    echo "❌ Build failed!"
    echo "   Check build.log for details"
    exit 1
fi
