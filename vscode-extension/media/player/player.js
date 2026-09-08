// Mini-player script (ADR-001 protocol D4). Passive: no queue, no cache,
// no state machine — everything here just drives one <audio> element and
// relays messages to/from the Extension Host.
(function () {
  "use strict";

  const vscode = acquireVsCodeApi();

  const audio = document.getElementById("audio");
  const body = document.body;
  const titleEl = document.getElementById("title");
  const profileEl = document.getElementById("profile");
  const timeEl = document.getElementById("time");
  const progressTrack = document.getElementById("progress-track");
  const progressFill = document.getElementById("progress-fill");

  const buttons = {
    prev: document.getElementById("btn-prev"),
    playPause: document.getElementById("btn-play-pause"),
    next: document.getElementById("btn-next"),
    stop: document.getElementById("btn-stop")
  };

  let currentChunkId = null;
  let lastTimeUpdatePostMs = 0;
  const TIMEUPDATE_THROTTLE_MS = 250;

  function formatTime(ms) {
    const totalSeconds = Math.max(0, Math.floor(ms / 1000));
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
  }

  function post(message) {
    vscode.postMessage(message);
  }

  // `message.src` arrives over `postMessage`, which CodeQL (rightly) treats
  // as externally controlled input regardless of who the sender is in this
  // extension's threat model. The Extension Host only ever sends a
  // `webview.asWebviewUri()` result (https:) or a `blob:` URL, so reject
  // anything else instead of handing an unvalidated string to `audio.src`
  // (AC-SEC-02: no untrusted value reaches a navigation/URL sink unchecked).
  function isSafeAudioSrc(src) {
    if (typeof src !== "string" || src.length === 0) {
      return false;
    }
    let url;
    try {
      url = new URL(src, window.location.href);
    } catch {
      return false;
    }
    return url.protocol === "https:" || url.protocol === "blob:";
  }

  function setState(state) {
    body.setAttribute("data-state", state);
    const isPlaying = state === "playing";
    buttons.playPause.textContent = isPlaying ? "⏸" /* pause */ : "▶" /* play */;
    buttons.playPause.setAttribute("aria-label", isPlaying ? "Pause" : "Lecture");
  }

  function updateProgress(positionMs, durationMs) {
    timeEl.textContent = formatTime(positionMs);
    if (durationMs && durationMs > 0) {
      const ratio = Math.min(1, Math.max(0, positionMs / durationMs));
      progressFill.style.width = `${ratio * 100}%`;
      progressTrack.setAttribute("aria-valuenow", String(Math.round(ratio * 100)));
    }
  }

  // ---- Extension Host -> Webview -------------------------------------
  window.addEventListener("message", (event) => {
    const message = event.data;
    switch (message.type) {
      case "load": {
        currentChunkId = message.chunkId;
        if (!isSafeAudioSrc(message.src)) {
          break;
        }
        audio.src = message.src;
        audio.load();
        if (typeof message.durationMs === "number") {
          progressTrack.setAttribute("aria-valuemax", String(message.durationMs));
        }
        if (message.autoplay) {
          void audio.play();
        }
        break;
      }
      case "play":
        void audio.play();
        break;
      case "pause":
        audio.pause();
        break;
      case "stop":
        audio.pause();
        audio.currentTime = 0;
        currentChunkId = null;
        break;
      case "seek":
        audio.currentTime = message.positionMs / 1000;
        break;
      case "setRate":
        audio.playbackRate = message.value;
        break;
      case "setVolume":
        audio.volume = message.value;
        break;
      case "state": {
        const state = message.state;
        setState(state.state);
        titleEl.textContent = state.title;
        profileEl.textContent = state.profile;
        break;
      }
      default:
        break;
    }
  });

  // ---- Webview -> Extension Host --------------------------------------
  audio.addEventListener("timeupdate", () => {
    if (!currentChunkId) {
      return;
    }
    const now = Date.now();
    if (now - lastTimeUpdatePostMs < TIMEUPDATE_THROTTLE_MS) {
      return;
    }
    lastTimeUpdatePostMs = now;
    const positionMs = Math.round(audio.currentTime * 1000);
    updateProgress(positionMs, audio.duration ? audio.duration * 1000 : undefined);
    post({ type: "timeupdate", chunkId: currentChunkId, positionMs });
  });

  audio.addEventListener("ended", () => {
    if (!currentChunkId) {
      return;
    }
    post({ type: "ended", chunkId: currentChunkId });
  });

  audio.addEventListener("error", () => {
    if (!currentChunkId) {
      return;
    }
    const message = audio.error ? `Audio error code ${audio.error.code}` : "Unknown audio error";
    post({ type: "error", chunkId: currentChunkId, message });
  });

  progressTrack.addEventListener("click", (event) => {
    if (!audio.duration || !Number.isFinite(audio.duration)) {
      return;
    }
    const rect = progressTrack.getBoundingClientRect();
    const ratio = Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width));
    const positionMs = Math.round(ratio * audio.duration * 1000);
    audio.currentTime = positionMs / 1000;
    post({ type: "timeupdate", chunkId: currentChunkId, positionMs });
  });

  buttons.prev.addEventListener("click", () => post({ type: "userAction", action: "prev" }));
  buttons.next.addEventListener("click", () => post({ type: "userAction", action: "next" }));
  buttons.stop.addEventListener("click", () => post({ type: "userAction", action: "stop" }));
  buttons.playPause.addEventListener("click", () => {
    post({ type: "userAction", action: audio.paused ? "play" : "pause" });
  });

  post({ type: "ready" });
})();
