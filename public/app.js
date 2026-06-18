const form = document.getElementById("form");
const urlInput = document.getElementById("url");
const fetchBtn = document.getElementById("fetchBtn");
const btnLabel = fetchBtn.querySelector(".btn-label");
const spinner = fetchBtn.querySelector(".spinner");
const errorBox = document.getElementById("error");

const result = document.getElementById("result");
const thumb = document.getElementById("thumb");
const titleEl = document.getElementById("title");
const uploaderEl = document.getElementById("uploader");
const viewsEl = document.getElementById("views");
const durationEl = document.getElementById("duration");
const formatList = document.getElementById("formatList");
const downloadBtn = document.getElementById("downloadBtn");

const progressWrap = document.getElementById("progressWrap");
const progressBar = document.getElementById("progressBar");
const progressLabel = document.getElementById("progressLabel");
const progressStats = document.getElementById("progressStats");

let current = null; // { url, formats }
let selected = null; // chosen format object

function showError(msg) {
  errorBox.textContent = msg;
  errorBox.hidden = false;
}
function clearError() {
  errorBox.hidden = true;
}
function setLoading(on) {
  fetchBtn.disabled = on;
  spinner.hidden = !on;
  btnLabel.textContent = on ? "Fetching" : "Fetch";
}

function fmtViews(n) {
  if (!n) return "";
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)}M views`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(1)}K views`;
  return `${n} views`;
}

form.addEventListener("submit", async (e) => {
  e.preventDefault();
  const url = urlInput.value.trim();
  if (!url) return;

  clearError();
  setLoading(true);
  result.hidden = true;
  progressWrap.hidden = true;

  try {
    const res = await fetch("/api/info", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Failed to fetch video info.");

    current = { url, ...data };
    renderResult(data);
  } catch (err) {
    showError(err.message);
  } finally {
    setLoading(false);
  }
});

function renderResult(data) {
  thumb.src = data.thumbnail || "";
  titleEl.textContent = data.title || "Untitled";
  uploaderEl.textContent = data.uploader || "";
  viewsEl.textContent = fmtViews(data.viewCount);
  durationEl.textContent = data.durationString || "";
  durationEl.style.display = data.durationString ? "" : "none";

  formatList.innerHTML = "";
  selected = null;
  downloadBtn.disabled = true;

  for (const f of data.formats) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "fmt";
    btn.innerHTML =
      f.kind === "audio"
        ? `<span>${f.label}</span><span class="tag">mp3</span>`
        : `<span>${f.label}</span><span class="tag">mp4</span>`;
    btn.addEventListener("click", () => {
      document.querySelectorAll(".fmt").forEach((el) => el.classList.remove("active"));
      btn.classList.add("active");
      selected = f;
      downloadBtn.disabled = false;
    });
    formatList.appendChild(btn);
  }

  result.hidden = false;
  result.scrollIntoView({ behavior: "smooth", block: "nearest" });
}

downloadBtn.addEventListener("click", async () => {
  if (!selected || !current) return;

  downloadBtn.disabled = true;
  progressWrap.hidden = false;
  progressBar.classList.remove("done");
  progressBar.style.width = "0%";
  progressLabel.textContent = "Starting…";
  progressStats.textContent = "";

  try {
    const res = await fetch("/api/download", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url: current.url, formatId: selected.id, kind: selected.kind }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Could not start download.");

    listen(data.id);
  } catch (err) {
    showError(err.message);
    downloadBtn.disabled = false;
    progressWrap.hidden = true;
  }
});

function listen(id) {
  const es = new EventSource(`/api/progress/${id}`);

  es.onmessage = (ev) => {
    const msg = JSON.parse(ev.data);

    if (msg.type === "progress") {
      const pct = Math.max(0, Math.min(100, msg.percent || 0));
      progressBar.style.width = `${pct}%`;
      progressLabel.textContent = pct >= 99.5 ? "Processing…" : `Downloading ${pct.toFixed(1)}%`;
      const parts = [];
      if (msg.speed) parts.push(msg.speed);
      if (msg.eta) parts.push(`ETA ${msg.eta}`);
      progressStats.textContent = parts.join(" · ");
    } else if (msg.type === "done") {
      progressBar.style.width = "100%";
      progressBar.classList.add("done");
      progressLabel.textContent = "Ready!";
      progressStats.textContent = "Saving to your device…";
      es.close();
      // Trigger the browser download.
      window.location.href = msg.downloadUrl;
      setTimeout(() => {
        downloadBtn.disabled = false;
        progressLabel.textContent = "Done ✓";
        progressStats.textContent = "";
      }, 1500);
    } else if (msg.type === "error") {
      showError(msg.error || "Download failed.");
      es.close();
      downloadBtn.disabled = false;
      progressWrap.hidden = true;
    }
  };

  es.onerror = () => {
    es.close();
    downloadBtn.disabled = false;
  };
}
