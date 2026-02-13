# Immersion Deployment Guide

This guide will help you deploy your Immersion app to the web so you can access it from anywhere and share it with others.

## Prerequisites

You'll need:
- API keys for: Replicate, Lemonfox, Gemini (and optionally ElevenLabs)
- A deployment platform account (Railway, Render, or DigitalOcean)

---

## Option 1: Railway (Recommended - Easiest)

**Cost:** Free tier available, then ~$5-10/month  
**Time:** ~10 minutes  
**Best for:** Quick deployment, easy scaling

### Steps:

1. **Create a Railway account**
   - Go to https://railway.app
   - Sign up with GitHub

2. **Install Railway CLI** (optional, can use web UI)
   ```bash
   npm install -g @railway/cli
   railway login
   ```

3. **Deploy your app**

   **Option A: Using GitHub (Recommended)**
   - Push your code to GitHub
   - In Railway, click "New Project" → "Deploy from GitHub repo"
   - Select your repository
   - Railway will automatically detect the Dockerfile and build

   **Option B: Using Railway CLI**
   ```bash
   cd /home/jack/Desktop/projects/Immersion
   railway init
   railway up
   ```

4. **Add environment variables**
   - In Railway dashboard, go to your project → Variables
   - Add these variables:
     ```
     REPLICATE_API_KEY=your_key
     LEMONFOX_API_KEY=your_key
     GEMINI_API_KEY=your_key
     ELEVENLABS_API_KEY=your_key (optional)
     PORT=3000
     NODE_ENV=production
     ```

5. **Generate a domain**
   - In Railway, go to Settings → Generate Domain
   - Your app will be live at: `your-app.railway.app`

**Important Notes:**
- Railway provides 500 hours/month free
- After that, it's ~$5/month per service
- File storage is ephemeral (uploaded files are lost on restart)
- For persistent storage, add Railway Volume or use S3

---

## Option 2: Render.com

**Cost:** Free tier available (slow), $7/month for production  
**Time:** ~15 minutes  
**Best for:** Simple deployment with persistent storage

### Steps:

1. **Create Render account**
   - Go to https://render.com
   - Sign up with GitHub

2. **Create a new Web Service**
   - Click "New +" → "Web Service"
   - Connect your GitHub repository

3. **Configure the service**
   - **Name:** immersion-app
   - **Environment:** Docker
   - **Region:** Choose closest to you
   - **Instance Type:** Free (for testing) or Starter ($7/mo)

4. **Add environment variables**
   - Scroll to "Environment Variables"
   - Add the same variables as Railway

5. **Add persistent disk** (optional, for file uploads)
   - In Advanced settings → Add Disk
   - Mount path: `/app/server/output`

6. **Deploy**
   - Click "Create Web Service"
   - Render will build and deploy automatically

Your app will be live at: `your-app.onrender.com`

---

## Option 3: DigitalOcean Droplet (Most Control)

**Cost:** $6-12/month  
**Time:** ~30-60 minutes  
**Best for:** Full control, custom domain, best performance

### Steps:

1. **Create a DigitalOcean account**
   - Go to https://digitalocean.com
   - Create account and add payment method

2. **Create a Droplet**
   - Click "Create" → "Droplets"
   - Choose: Ubuntu 22.04 LTS
   - Plan: Basic ($6/mo)
   - Choose datacenter region near you
   - Add SSH key or use password

3. **SSH into your server**
   ```bash
   ssh root@your_droplet_ip
   ```

4. **Install dependencies**
   ```bash
   # Update system
   apt update && apt upgrade -y

   # Install Node.js 20
   curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
   apt install -y nodejs

   # Install Docker
   curl -fsSL https://get.docker.com | sh

   # Install nginx (reverse proxy)
   apt install -y nginx

   # Install certbot (for HTTPS)
   apt install -y certbot python3-certbot-nginx
   ```

5. **Clone your repository**
   ```bash
   cd /opt
   git clone https://github.com/yourusername/Immersion.git
   cd Immersion
   ```

6. **Set up environment variables**
   ```bash
   nano server/.env
   ```
   Paste your API keys, then save (Ctrl+X, Y, Enter)

7. **Build and run with Docker**
   ```bash
   docker build -t immersion-app .
   docker run -d \
     --name immersion \
     --restart unless-stopped \
     -p 3000:3000 \
     -v $(pwd)/server/output:/app/output \
     immersion-app
   ```

8. **Configure Nginx reverse proxy**
   ```bash
   nano /etc/nginx/sites-available/immersion
   ```
   
   Paste this config:
   ```nginx
   server {
       listen 80;
       server_name your_domain.com;  # Replace with your domain

       client_max_body_size 500M;

       location / {
           proxy_pass http://localhost:3000;
           proxy_http_version 1.1;
           proxy_set_header Upgrade $http_upgrade;
           proxy_set_header Connection 'upgrade';
           proxy_set_header Host $host;
           proxy_cache_bypass $http_upgrade;
           proxy_read_timeout 300s;
           proxy_connect_timeout 75s;
       }
   }
   ```

9. **Enable the site**
   ```bash
   ln -s /etc/nginx/sites-available/immersion /etc/nginx/sites-enabled/
   nginx -t
   systemctl restart nginx
   ```

10. **Set up HTTPS with Let's Encrypt**
    ```bash
    certbot --nginx -d your_domain.com
    ```

Your app is now live at `https://your_domain.com`!

---

## Option 4: AWS (Advanced)

For AWS deployment using EC2 + ECS, follow the DigitalOcean steps but use AWS services instead.

---

## Post-Deployment Checklist

✅ **Test all features:**
- Upload a video
- Process with different levels
- Test voice cloning
- Download outputs

✅ **Monitor costs:**
- API usage (Replicate, ElevenLabs are metered)
- Server costs
- Bandwidth

✅ **Set up monitoring:**
- Railway/Render have built-in logs
- For DigitalOcean, use: `docker logs -f immersion`

✅ **Backup strategy:**
- Database if you add one later
- Uploaded videos (consider S3/Cloudflare R2)

---

## Storage Considerations

Your app processes videos, which creates large files. Options:

1. **Ephemeral (Railway/Render free tier)**
   - Files deleted on restart
   - OK for demo purposes

2. **Persistent Disk (Railway Volumes, Render Disks)**
   - ~$0.25/GB/month
   - Files persist across restarts

3. **Object Storage (S3, R2, DigitalOcean Spaces)**
   - Cheapest for large files
   - ~$0.02/GB/month
   - Requires code changes

---

## Updating Your Deployment

### Railway/Render (GitHub connected):
```bash
git push origin main
# Automatic deployment happens
```

### DigitalOcean:
```bash
ssh root@your_droplet_ip
cd /opt/Immersion
git pull
docker build -t immersion-app .
docker stop immersion
docker rm immersion
docker run -d --name immersion --restart unless-stopped -p 3000:3000 immersion-app
```

---

## Troubleshooting

**Issue: "Out of memory"**
- Increase your plan (Railway/Render)
- Add swap on DigitalOcean: `fallocate -l 2G /swapfile && chmod 600 /swapfile && mkswap /swapfile && swapon /swapfile`

**Issue: "FFmpeg not found"**
- Dockerfile includes ffmpeg, rebuild: `docker build --no-cache -t immersion-app .`

**Issue: "API rate limits"**
- Check your API usage in respective dashboards
- Add rate limiting to your server

**Issue: "Uploads timing out"**
- Increase nginx timeout (DigitalOcean): `proxy_read_timeout 600s;`
- Check your platform's timeout limits

---

## Need Help?

- Railway docs: https://docs.railway.app
- Render docs: https://render.com/docs
- DigitalOcean docs: https://docs.digitalocean.com

---

## Quick Start (Railway - Fastest)

```bash
# 1. Push to GitHub
git init
git add .
git commit -m "Initial commit"
git remote add origin https://github.com/yourusername/Immersion.git
git push -u origin main

# 2. Go to railway.app → New Project → Deploy from GitHub
# 3. Add environment variables
# 4. Generate domain
# 5. Done! 🎉
```
