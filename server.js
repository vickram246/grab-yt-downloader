import express from "express";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DOWNLOADS = path.join(__dirname, "downloads");
fs.mkdirSync(DOWNLOADS, { recursive: true });

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

const PORT = process.env.PORT || 3000;

// Locate yt-dlp / ffmpeg. Prefer PATH; allow override via env.
const YTDLP = process.env.YTDLP_PATH || "yt-dlp";
const FFMPEG_DIR = process.env.FFMPEG_DIR || ""; // dir containing ffmpeg, optional

// YouTube blocks many datacenter IPs with a "confirm you're not a bot" check.
// Supplying browser cookies sidesteps it. Provide EITHER a path (YTDLP_COOKIES)
// or the raw cookies.txt contents in an env var (YTDLP_COOKIES_CONTENT), which
// we materialize to a file once at startup — convenient for cloud dashboards.
let COOKIES_FILE = process.env.YTDLP_COOKIES || "";
if (!COOKIES_FILE && process.env.YTDLP_COOKIES_CONTENT) {
  COOKIES_FILE = path.join(__dirname, "cookies.txt");
  try {
    fs.writeFileSync(COOKIES_FILE, process.env.YTDLP_COOKIES_CONTENT);
    console.log("  ✓ Loaded YouTube cookies from YTDLP_COOKIES_CONTENT");
  } catch (e) {
    console.warn("  ! Could not write cookies file:", e.message);
    COOKIES_FILE = "";
  }
}

// In-memory job registry: id -> { proc, status, percent, file, title, error, clients }
const jobs = new Map();

function ytdlpArgs(extra) {
  const args = [...extra];
  if (FFMPEG_DIR) args.push("--ffmpeg-location", FFMPEG_DIR);
  if (COOKIES_FILE && fs.existsSync(COOKIES_FILE)) {
    args.push("--cookies", COOKIES_FILE);
  }
  return args;
}

function run(args) {
  return new Promise((resolve, reject) => {
    const proc = spawn(YTDLP, ytdlpArgs(args), { windowsHide: true });
    let out = "";
    let err = "";
    proc.stdout.on("data", (d) => (out += d));
    proc.stderr.on("data", (d) => (err += d));
    proc.on("error", reject);
    proc.on("close", (code) => {
      if (code === 0) resolve(out);
      else reject(new Error(err || `yt-dlp exited with code ${code}`));
    });
  });
}

function fmtBytes(n) {
  if (!n || n < 0) return null;
  const u = ["B", "KB", "MB", "GB"];
  let i = 0;
  while (n >= 1024 && i < u.length - 1) {
    n /= 1024;
    i++;
  }
  return `${n.toFixed(n < 10 && i > 0 ? 1 : 0)} ${u[i]}`;
}

// --- Fetch video metadata + available formats ---------------------------------
app.post("/api/info", async (req, res) => {
  const { url } = req.body || {};
  if (!url || typeof url !== "string") {
    return res.status(400).json({ error: "A URL is required." });
  }
  try {
    const raw = await run(["-J", "--no-playlist", url]);
    const data = JSON.parse(raw);

    // Build a clean list of progressive/merge-able video heights + audio option.
    const heights = new Set();
    for (const f of data.formats || []) {
      if (f.vcodec && f.vcodec !== "none" && f.height) heights.add(f.height);
    }
    const videoOptions = [...heights]
      .sort((a, b) => b - a)
      .map((h) => ({
        id: `bv*[height<=${h}]+ba/b[height<=${h}]`,
        label: `${h}p`,
        kind: "video",
        height: h,
      }));

    const audioOptions = [
      { id: "ba/b", label: "Audio only (MP3)", kind: "audio" },
    ];

    res.json({
      id: data.id,
      title: data.title,
      uploader: data.uploader || data.channel || "",
      duration: data.duration,
      durationString: data.duration_string,
      thumbnail: data.thumbnail,
      viewCount: data.view_count,
      formats: [...videoOptions, ...audioOptions],
    });
  } catch (e) {
    res.status(500).json({ error: cleanError(e.message) });
  }
});

function cleanError(msg) {
  const line = String(msg)
    .split("\n")
    .find((l) => l.includes("ERROR")) || String(msg).split("\n")[0];
  return line.replace(/^ERROR:\s*/i, "").trim() || "Failed to process this URL.";
}

// --- Start a download job -----------------------------------------------------
app.post("/api/download", (req, res) => {
  const { url, formatId, kind } = req.body || {};
  if (!url || !formatId) {
    return res.status(400).json({ error: "url and formatId are required." });
  }

  const id = randomUUID();
  const outTmpl = path.join(DOWNLOADS, `${id}.%(ext)s`);

  const args = [
    "--no-playlist",
    "--newline",
    "-o", outTmpl,
    "-f", formatId,
  ];

  if (kind === "audio") {
    args.push("-x", "--audio-format", "mp3", "--audio-quality", "0");
  } else {
    // Ensure a browser-friendly container.
    args.push("--merge-output-format", "mp4");
  }

  args.push("--print", "after_move:filepath", url);

  const proc = spawn(YTDLP, ytdlpArgs(args), { windowsHide: true });
  const job = {
    proc,
    status: "downloading",
    percent: 0,
    speed: null,
    eta: null,
    file: null,
    title: null,
    error: null,
    clients: new Set(),
  };
  jobs.set(id, job);

  const push = (event) => {
    const payload = `data: ${JSON.stringify(event)}\n\n`;
    for (const c of job.clients) c.write(payload);
  };

  let buf = "";
  proc.stdout.on("data", (d) => {
    buf += d.toString();
    let nl;
    while ((nl = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, nl).trim();
      buf = buf.slice(nl + 1);
      handleLine(line);
    }
  });

  function handleLine(line) {
    // Progress lines: [download]  42.3% of 10.00MiB at 2.00MiB/s ETA 00:03
    const m = line.match(/\[download\]\s+([\d.]+)%/);
    if (m) {
      job.percent = parseFloat(m[1]);
      const sp = line.match(/at\s+([\d.]+\w+\/s)/);
      const eta = line.match(/ETA\s+([\d:]+)/);
      job.speed = sp ? sp[1] : job.speed;
      job.eta = eta ? eta[1] : job.eta;
      push({ type: "progress", percent: job.percent, speed: job.speed, eta: job.eta });
      return;
    }
    // The final printed filepath (after_move) — not prefixed by yt-dlp tags.
    if (line && !line.startsWith("[") && fs.existsSync(line)) {
      job.file = line;
      job.title = path.basename(line);
    }
  }

  let stderr = "";
  proc.stderr.on("data", (d) => (stderr += d.toString()));

  proc.on("close", (code) => {
    if (code === 0 && job.file) {
      job.status = "done";
      job.percent = 100;
      push({
        type: "done",
        percent: 100,
        downloadUrl: `/api/file/${id}`,
        filename: job.title,
      });
    } else {
      job.status = "error";
      job.error = cleanError(stderr) || "Download failed.";
      push({ type: "error", error: job.error });
    }
    // Close SSE streams.
    for (const c of job.clients) c.end();
    job.clients.clear();
  });

  proc.on("error", (e) => {
    job.status = "error";
    job.error = e.message;
    push({ type: "error", error: job.error });
  });

  res.json({ id });
});

// --- SSE progress stream ------------------------------------------------------
app.get("/api/progress/:id", (req, res) => {
  const job = jobs.get(req.params.id);
  if (!job) return res.status(404).end();

  res.set({
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
  });
  res.flushHeaders?.();

  // Replay current state immediately.
  if (job.status === "done") {
    res.write(`data: ${JSON.stringify({ type: "done", percent: 100, downloadUrl: `/api/file/${req.params.id}`, filename: job.title })}\n\n`);
    return res.end();
  }
  if (job.status === "error") {
    res.write(`data: ${JSON.stringify({ type: "error", error: job.error })}\n\n`);
    return res.end();
  }
  res.write(`data: ${JSON.stringify({ type: "progress", percent: job.percent })}\n\n`);
  job.clients.add(res);
  req.on("close", () => job.clients.delete(res));
});

// --- Serve the finished file --------------------------------------------------
app.get("/api/file/:id", (req, res) => {
  const job = jobs.get(req.params.id);
  if (!job || !job.file || !fs.existsSync(job.file)) {
    return res.status(404).send("File not found.");
  }
  res.download(job.file, job.title, (err) => {
    // Clean up the file shortly after the response finishes.
    if (!err) {
      setTimeout(() => {
        fs.rm(job.file, { force: true }, () => {});
        jobs.delete(req.params.id);
      }, 60_000);
    }
  });
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(`\n  ▶  YouTube Downloader running on port ${PORT}\n`);
});
