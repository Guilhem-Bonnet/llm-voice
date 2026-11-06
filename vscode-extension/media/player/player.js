// Mini-player script (ADR-001 protocol D4). Passive: no queue, no cache,
// no state machine — everything here just drives one <audio> element and
// relays messages to/from the Extension Host.
(function () {
  "use strict";

  const vscode = acquireVsCodeApi();
  // VS Code hands it out once per page, and responses.js needs it too.
  window.llmVoiceApi = vscode;

  const audio = document.getElementById("audio");
  const body = document.body;
  const titleEl = document.getElementById("title");
  const profileEl = document.getElementById("profile");
  const voiceEl = document.getElementById("voice");
  const timeEl = document.getElementById("time");
  const statusEl = document.getElementById("status");
  const progressTrack = document.getElementById("progress-track");
  const progressFill = document.getElementById("progress-fill");

  const buttons = {
    prev: document.getElementById("btn-prev"),
    playPause: document.getElementById("btn-play-pause"),
    next: document.getElementById("btn-next"),
    stop: document.getElementById("btn-stop")
  };

  const welcomeButtons = {
    setupVoice: document.getElementById("btn-setup-voice")
  };

  const wait = {
    block: document.getElementById("wait"),
    label: document.getElementById("wait-label"),
    elapsed: document.getElementById("wait-elapsed"),
    bar: document.getElementById("wait-bar"),
    fill: document.getElementById("wait-fill"),
    text: document.getElementById("wait-text"),
    typical: document.getElementById("wait-typical"),
    note: document.getElementById("wait-note"),
    cancel: document.getElementById("btn-wait-cancel")
  };

  const readingLine = document.getElementById("reading-line");
  const readingEl = document.getElementById("reading");
  const speakerEl = document.getElementById("speaker");
  const aheadEl = document.getElementById("ahead");

  const notice = {
    block: document.getElementById("notice"),
    title: document.getElementById("notice-title"),
    body: document.getElementById("notice-body"),
    system: document.getElementById("btn-notice-system"),
    retry: document.getElementById("btn-notice-retry")
  };

  const documentBlock = {
    open: document.getElementById("document-open"),
    empty: document.getElementById("document-empty"),
    name: document.getElementById("document-name"),
    passages: document.getElementById("document-passages"),
    readDocument: document.getElementById("btn-read-document"),
    readSelection: document.getElementById("btn-read-selection"),
    readFromHere: document.getElementById("btn-read-from-here"),
    readClipboard: document.getElementById("btn-read-clipboard"),
    script: document.getElementById("document-script"),
    scriptText: document.getElementById("document-script-text"),
    scriptActions: document.getElementById("document-script-actions"),
    toggleCast: document.getElementById("btn-toggle-cast"),
    castVoices: document.getElementById("btn-cast-voices")
  };

  let currentChunkId = null;
  let lastTimeUpdatePostMs = 0;
  const TIMEUPDATE_THROTTLE_MS = 250;

  // While a session loads there is nothing to pause, and the host ignores
  // "play": the button cancels instead, and says what is happening. The glyph
  // is text, like the other transport buttons; this webview loads no codicon
  // font. U+2715 has no emoji presentation, unlike U+2716.
  const CANCEL_GLYPH = "✕";
  const LOADING_STATES = new Map([
    ["preparing", { status: "Préparation de la voix…", label: "Annuler la préparation" }],
    ["buffering", { status: "Préparation du segment suivant…", label: "Annuler et arrêter la lecture" }]
  ]);
  // The cancel lands while the second click of a double click is on its way:
  // that click must not read as "play", which would start a new reading.
  const CANCEL_GUARD_MS = 600;
  let lastCancelAtMs = Number.NEGATIVE_INFINITY;
  let hasWait = false;

  function formatTime(ms) {
    const totalSeconds = Math.max(0, Math.floor(ms / 1000));
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
  }

  function post(message) {
    vscode.postMessage(message);
  }

  function setState(state) {
    body.setAttribute("data-state", state);
    const loading = LOADING_STATES.get(state);
    const isPlaying = state === "playing";
    const label = loading ? loading.label : isPlaying ? "Pause" : "Lecture";
    buttons.playPause.textContent = loading ? CANCEL_GLYPH : isPlaying ? "⏸" /* pause */ : "▶" /* play */;
    buttons.playPause.setAttribute("aria-label", label);
    buttons.playPause.setAttribute("title", label);
    if (!hasWait) {
      setStatus(loading ? loading.status : "");
    }
  }

  // The live region: writing it again would announce it again, so only a change reaches it.
  function setStatus(text) {
    if (statusEl.textContent !== text) {
      statusEl.textContent = text;
    }
  }

  // The bar and its counters stay out of the live region: only `announcement` is spoken,
  // and it changes at thresholds alone. Reduced motion is CSS: the width simply jumps.
  function renderWait(view) {
    hasWait = view !== null && typeof view === "object";
    wait.block.hidden = !hasWait;
    if (!hasWait) {
      return;
    }
    const percent = Math.min(100, Math.max(0, Number(view.percent) || 0));
    wait.label.textContent = typeof view.label === "string" ? view.label : "";
    wait.elapsed.textContent = view.step === "next-passage" ? "" : `${Number(view.elapsedSeconds) || 0} s`;
    wait.fill.style.width = `${percent}%`;
    wait.bar.setAttribute("aria-valuenow", String(percent));
    wait.bar.setAttribute("aria-valuetext", typeof view.valueText === "string" ? view.valueText : "");
    wait.text.textContent = typeof view.text === "string" ? view.text : "";
    const typical = typeof view.typicalSeconds === "number" ? `D'habitude environ ${view.typicalSeconds} s` : "";
    wait.typical.textContent = typical;
    wait.typical.hidden = typical.length === 0;
    const note = typeof view.note === "string" ? view.note : "";
    wait.note.textContent = note;
    wait.note.hidden = note.length === 0;
    setStatus(typeof view.announcement === "string" ? view.announcement : "");
  }

  function aheadText(state) {
    if (typeof state.ahead !== "number" || (state.state !== "playing" && state.state !== "paused")) {
      return "";
    }
    if (state.ahead <= 0) {
      return "Passage suivant en préparation…";
    }
    return state.ahead === 1 ? "1 passage d'avance" : `${state.ahead} passages d'avance`;
  }

  function renderReading(state) {
    const reading = state.state === "playing" || state.state === "paused" ? state.reading : "";
    const ahead = aheadText(state);
    readingEl.textContent = typeof reading === "string" ? reading : "";
    aheadEl.textContent = ahead;
    speakerEl.textContent = typeof state.speaker === "string" ? state.speaker : "";
    readingLine.hidden = readingEl.textContent.length === 0 && ahead.length === 0 && speakerEl.textContent.length === 0;
  }

  function renderNotice(view) {
    const shown = view !== null && typeof view === "object";
    notice.block.hidden = !shown;
    notice.title.textContent = shown && typeof view.title === "string" ? view.title : "";
    notice.body.textContent = shown && typeof view.body === "string" ? view.body : "";
  }

  function renderDocument(view) {
    const open = view !== null && typeof view === "object";
    documentBlock.open.hidden = !open;
    documentBlock.empty.hidden = open;
    if (!open) {
      return;
    }
    const passages = Number(view.passages) || 0;
    documentBlock.name.textContent = typeof view.fileName === "string" ? view.fileName : "";
    documentBlock.readSelection.hidden = passages === 0;
    documentBlock.readSelection.textContent = passages > 1 ? `Lire les ${passages} passages` : "Lire la sélection";
    const text = typeof view.passagesText === "string" ? view.passagesText : "";
    documentBlock.passages.textContent = text;
    documentBlock.passages.hidden = text.length === 0;
    const script = view.script !== null && typeof view.script === "object" ? view.script : undefined;
    documentBlock.script.hidden = script === undefined;
    if (script !== undefined) {
      const roles = Number(script.roles) || 0;
      documentBlock.scriptText.textContent = typeof script.text === "string" ? script.text : "";
      documentBlock.scriptActions.hidden = roles === 0;
      documentBlock.toggleCast.textContent = script.enabled === true ? "Lire à une voix" : "Lire à plusieurs voix";
      documentBlock.castVoices.hidden = script.enabled !== true;
    }
  }

  function updateProgress(positionMs, durationMs) {
    timeEl.textContent = formatTime(positionMs);
    if (durationMs && durationMs > 0) {
      const ratio = Math.min(1, Math.max(0, positionMs / durationMs));
      progressFill.style.width = `${ratio * 100}%`;
      progressTrack.setAttribute("aria-valuenow", String(Math.round(ratio * 100)));
    }
  }

  // The "message" channel of a WebviewView's postMessage is only ever
  // wired to this extension's own Extension Host (a VS Code guarantee, not
  // a page an attacker can script into); `message.src` is produced there by
  // `webview.asWebviewUri()` on the audio cache directory, or is a `blob:`
  // URL. The structural check below is defense in depth, not a trust
  // boundary crossing.
  function handleLoad(message) {
    currentChunkId = message.chunkId;
    if (typeof message.src !== "string") {
      return;
    }
    let url;
    try {
      url = new URL(message.src);
    } catch {
      return;
    }
    // Suffix match, never `includes()` (S6.1 audit F-12): `hostname.includes(
    // "vscode-webview")` also accepts `https://vscode-webview.evil.example/`.
    // Only a real VS Code webview-resource host, or a `blob:` URL this page
    // itself created, may be assigned to `audio.src`.
    const host = url.hostname.toLowerCase();
    const isWebviewResourceHost =
      host === "vscode-cdn.net" ||
      host.endsWith(".vscode-cdn.net") ||
      host === "vscode-webview.net" ||
      host.endsWith(".vscode-webview.net");
    const isTrustedHttps = url.protocol === "https:" && isWebviewResourceHost;
    if (!isTrustedHttps && url.protocol !== "blob:") {
      return;
    }
    audio.src = url.href;
    audio.load();
    if (typeof message.durationMs === "number") {
      progressTrack.setAttribute("aria-valuemax", String(message.durationMs));
    }
    if (message.autoplay) {
      void audio.play();
    }
  }

  // ---- Extension Host -> Webview -------------------------------------
  window.addEventListener("message", (event) => {
    const message = event.data;
    switch (message.type) {
      case "load": {
        handleLoad(message);
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
        renderWait(state.wait);
        setState(state.state);
        renderReading(state);
        renderNotice(state.notice);
        // `textContent` only — never an HTML-parsing sink. `state.title` is
        // derived from the first line of a Claude response or a document
        // heading, i.e. untrusted text that routinely contains `<`, `&`,
        // backticks and ANSI escapes (AC-SEC-02). A static test in
        // `test/unit/security/webview-injection.test.ts` forbids every such
        // sink anywhere under `media/`.
        titleEl.textContent = typeof state.title === "string" ? state.title : "";
        profileEl.textContent = typeof state.profile === "string" ? state.profile : "";
        voiceEl.textContent = typeof state.voice === "string" ? state.voice : "";
        break;
      }
      case "document":
        renderDocument(message.document);
        break;
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
    // The host's state, not `audio.paused`: this element stays silent under the native engine.
    const state = body.getAttribute("data-state");
    if (LOADING_STATES.has(state)) {
      lastCancelAtMs = Date.now();
      post({ type: "userAction", action: "stop" });
    } else if (state === "playing") {
      post({ type: "userAction", action: "pause" });
    } else if (Date.now() - lastCancelAtMs >= CANCEL_GUARD_MS) {
      post({ type: "userAction", action: "play" });
    }
  });

  // Empty-player welcome actions (S7.2): only visible in the idle state
  // (`body[data-state="idle"]`, see player.css), so these never compete
  // with the transport buttons.
  welcomeButtons.setupVoice.addEventListener("click", () => post({ type: "userAction", action: "setupVoice" }));

  wait.cancel.addEventListener("click", () => {
    lastCancelAtMs = Date.now();
    post({ type: "userAction", action: "stop" });
  });
  notice.retry.addEventListener("click", () => post({ type: "userAction", action: "retryHold" }));
  notice.system.addEventListener("click", () => post({ type: "userAction", action: "readWithSystemVoice" }));

  // A click, always: the document block never starts anything on its own.
  documentBlock.readDocument.addEventListener("click", () =>
    post({ type: "userAction", action: "speakCurrentDocument" })
  );
  documentBlock.readSelection.addEventListener("click", () => post({ type: "userAction", action: "speakSelection" }));
  documentBlock.readFromHere.addEventListener("click", () => post({ type: "userAction", action: "speakFromCursor" }));
  documentBlock.readClipboard.addEventListener("click", () => post({ type: "userAction", action: "speakClipboard" }));

  // A setting and a list: neither one starts a reading.
  documentBlock.toggleCast.addEventListener("click", () => post({ type: "userAction", action: "toggleCast" }));
  documentBlock.castVoices.addEventListener("click", () => post({ type: "userAction", action: "chooseCastVoices" }));

  post({ type: "ready" });
})();
