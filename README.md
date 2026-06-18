# Grab — YouTube Downloader

A modern, single-page YouTube downloader with a glassmorphism UI. Express backend
drives **yt-dlp** + **ffmpeg**; live download progress streams to the browser over SSE.

![tech](https://img.shields.io/badge/node-%E2%89%A518-339933) ![tech](https://img.shields.io/badge/yt--dlp-backend-ff3d71)

## Features

- Paste a URL → fetch title, thumbnail, channel, duration, and available qualities
- Pick a video resolution (merged to MP4) or **Audio only** (extracted to MP3)
- Real-time progress bar with speed + ETA (Server-Sent Events)
- Auto-saves to your device, then cleans the temp file server-side
- Zero build step — vanilla HTML/CSS/JS frontend

## Requirements

These must be on your `PATH` (all detected on this machine):

- [Node.js](https://nodejs.org) ≥ 18
- [yt-dlp](https://github.com/yt-dlp/yt-dlp)
- [ffmpeg](https://ffmpeg.org) (needed to merge video+audio and extract MP3)

## Run

```bash
cd yt-downloader
npm install
npm start
```

Open <http://localhost:3000>.

`npm run dev` starts with `--watch` for auto-reload.

## Configuration (optional env vars)

| Variable      | Purpose                                              |
|---------------|------------------------------------------------------|
| `PORT`        | Server port (default `3000`)                         |
| `YTDLP_PATH`  | Full path to the `yt-dlp` binary if not on PATH      |
| `FFMPEG_DIR`  | Directory containing `ffmpeg` if not on PATH         |

## How it works

```
Browser ──POST /api/info────► yt-dlp -J (metadata + formats)
Browser ──POST /api/download─► spawn yt-dlp, returns a job id
Browser ──GET  /api/progress/:id (SSE) ◄── parsed % / speed / ETA
Browser ──GET  /api/file/:id──► streams the finished file, then deletes it
```

## Deploy (Railway or Render)

The repo ships a `Dockerfile` (with `yt-dlp` + `ffmpeg` baked in) plus blueprints
for both platforms. Neither needs Docker installed locally — they build in the cloud.

### 1. Push to GitHub

```bash
git init && git add -A && git commit -m "Grab: YouTube downloader"
gh repo create grab-yt-downloader --public --source=. --push   # or use the GitHub UI
```

### 2a. Render

1. <https://dashboard.render.com> → **New → Blueprint**
2. Connect the repo. Render reads `render.yaml` and provisions a Docker web service.
3. Deploy → you get `https://grab-yt-downloader.onrender.com`.

### 2b. Railway

1. <https://railway.app> → **New Project → Deploy from GitHub repo**
2. Railway detects `railway.json` and builds the `Dockerfile`.
3. **Settings → Networking → Generate Domain** for a public URL.

### ⚠️ YouTube bot-check on cloud IPs

YouTube often blocks datacenter IPs with *"Sign in to confirm you're not a bot."*
To fix it, export your browser cookies and feed them to yt-dlp:

1. Install a *Get cookies.txt* browser extension and export youtube.com cookies.
2. In the platform dashboard, add an env var **`YTDLP_COOKIES_CONTENT`** and paste
   the entire contents of the `cookies.txt` file as the value.

The server writes it to disk on boot and passes `--cookies` to every yt-dlp call.
Alternatively set `YTDLP_COOKIES` to a path if you mount the file yourself.

## Note

For personal use only. You are responsible for complying with copyright law and
YouTube's Terms of Service.
