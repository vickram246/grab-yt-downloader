# ---- Grab: YouTube downloader -------------------------------------------------
# Node app that shells out to yt-dlp + ffmpeg, so both are baked into the image.
FROM node:20-slim

# System deps: ffmpeg (merge/extract), python3 (yt-dlp runtime), curl + CA certs.
RUN apt-get update \
  && apt-get install -y --no-install-recommends \
       ffmpeg \
       python3 \
       aria2 \
       ca-certificates \
       curl \
  && curl -L https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp \
       -o /usr/local/bin/yt-dlp \
  && chmod a+rx /usr/local/bin/yt-dlp \
  && apt-get purge -y curl \
  && apt-get autoremove -y \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Install only production deps first for better layer caching.
COPY package*.json ./
RUN npm install --omit=dev

# App source.
COPY . .

ENV NODE_ENV=production
ENV PORT=3000
EXPOSE 3000

CMD ["node", "server.js"]
