// @ts-check
// Voice gallery (ADR-017, card 0-005). A display: it holds no favorite and no voice.
// Audio only ever starts from a click here, or from the answer to a request a click
// made. Everything shown is written with textContent. See VoiceGalleryController.ts.
(function () {
  "use strict";

  const vscode = acquireVsCodeApi();
  const get = (id) => document.getElementById(id);

  const SVG_NS = "http://www.w3.org/2000/svg";
  const STAR_PATH = "M8 1.5l2 4.3 4.7.6-3.5 3.2.9 4.7L8 12l-4.1 2.3.9-4.7L1.3 6.4 6 5.8z";
  const SECTIONS = ["local", "kyutai", "prepare"];

  const search = get("search");
  const phrase = get("phrase");
  const audio = get("audio");
  const notice = get("notice");
  const banner = get("server-banner");
  const filterButtons = {
    all: get("filter-all"),
    ready: get("filter-ready"),
    favorites: get("filter-favorites")
  };

  /** @type {Map<string, any>} */
  const cards = new Map();
  /** @type {Set<string>} */
  const heard = new Set();
  let favorites = [];
  let engines = {};
  let activeId;
  let filter = "all";
  /** The engine the banner speaks of, when a click found its server stopped. */
  let refusedEngine;
  /** What sounds: { id } */
  let playing;
  /** What is being generated: { id, requestId, startedAt, timer } */
  let pending;
  let nextRequestId = 1;

  function normalized(text) {
    return String(text).normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
  }

  function clock(seconds) {
    const whole = Number.isFinite(seconds) ? Math.max(0, Math.floor(seconds)) : 0;
    const minutes = String(Math.floor(whole / 60)).padStart(2, "0");
    const rest = String(whole % 60).padStart(2, "0");
    return minutes + ":" + rest;
  }

  function element(tag, className, text) {
    const created = document.createElement(tag);
    if (className) {
      created.className = className;
    }
    if (text !== undefined) {
      created.textContent = text;
    }
    return created;
  }

  function button(text, extraClass) {
    const created = document.createElement("button");
    created.className = "button" + (extraClass ? " " + extraClass : "");
    created.setAttribute("type", "button");
    created.textContent = text;
    return created;
  }

  function starIcon() {
    const svg = document.createElementNS(SVG_NS, "svg");
    svg.setAttribute("viewBox", "0 0 16 16");
    svg.setAttribute("width", "14");
    svg.setAttribute("height", "14");
    svg.setAttribute("aria-hidden", "true");
    const path = document.createElementNS(SVG_NS, "path");
    path.setAttribute("d", STAR_PATH);
    svg.appendChild(path);
    return svg;
  }

  // ---------------------------------------------------------------- cards

  function createCard(model) {
    const root = element("div", "card");
    root.dataset.voiceId = model.id;

    const star = document.createElement("button");
    star.className = "star";
    star.setAttribute("type", "button");
    star.appendChild(starIcon());
    star.addEventListener("click", () => {
      vscode.postMessage({ type: "favorite", voiceId: model.id, favorite: !favorites.includes(model.id) });
    });

    const name = element("strong", "name");
    const state = element("span", "state small");
    const choose = button("Choisir", "primary");
    choose.addEventListener("click", () => {
      if (activeId !== model.id) {
        vscode.postMessage({ type: "choose", voiceId: model.id });
      }
    });
    const prepare = button("Préparer");
    prepare.addEventListener("click", () => {
      const current = cards.get(model.id);
      if (current && current.model.prepare) {
        vscode.postMessage({ type: "prepare", target: current.model.prepare });
      }
    });

    const head = element("div", "card-head");
    const title = element("div", "card-title");
    title.append(star, name);
    head.append(title, state);

    const detail = element("p", "detail muted small");

    const listen = button("Écouter");
    listen.addEventListener("click", () => startListening(model.id));
    const stop = button("Arrêter");
    stop.addEventListener("click", () => stopCurrent(model.id));
    const status = element("span", "status muted small");

    const fill = element("div", "progress-fill");
    const progress = element("div", "progress");
    progress.appendChild(fill);

    const actions = element("div", "card-actions");
    actions.append(listen, stop, status, prepare, choose);

    root.append(head, detail, progress, actions);

    const card = { root, star, name, state, choose, prepare, detail, listen, stop, status, progress, fill, model };
    cards.set(model.id, card);
    return card;
  }

  function placeCard(card, section) {
    const container = get("cards-" + section);
    if (card.section !== section) {
      container.appendChild(card.root);
      card.section = section;
    }
  }

  function refreshCard(card) {
    const { model } = card;
    const isActive = activeId === model.id;
    const isFavorite = favorites.includes(model.id);
    card.root.classList.toggle("active", isActive);
    card.name.textContent = model.label;
    card.state.textContent = model.state || "";
    card.state.classList.toggle("state-ok", Boolean(model.ready));
    card.detail.textContent = model.detail || "";
    card.detail.hidden = !model.detail;

    card.star.classList.toggle("on", isFavorite);
    card.star.setAttribute("aria-pressed", isFavorite ? "true" : "false");
    const starLabel = (isFavorite ? "Retirer des favorites : " : "Ajouter aux favorites : ") + model.label;
    card.star.setAttribute("aria-label", starLabel);
    card.star.setAttribute("title", starLabel);

    card.choose.hidden = !(model.canChoose || isActive);
    card.choose.textContent = isActive ? "Choisie" : "Choisir";
    card.choose.classList.toggle("chosen", isActive);
    card.choose.setAttribute("aria-pressed", isActive ? "true" : "false");

    card.prepare.hidden = !model.prepare;
    card.prepare.textContent = model.prepareLabel || "Préparer";

    refreshListening(card);
  }

  function refreshListening(card) {
    const { model } = card;
    const isPending = pending !== undefined && pending.id === model.id;
    const isPlaying = playing !== undefined && playing.id === model.id;
    card.listen.hidden = !model.canListen || isPending || isPlaying;
    card.stop.hidden = !(isPending || isPlaying);
    card.stop.textContent = isPending ? "Annuler" : "Arrêter";
    card.progress.hidden = !isPlaying;
    if (isPending) {
      card.status.textContent = "Génération… " + Math.floor((Date.now() - pending.startedAt) / 1000) + " s";
    } else if (isPlaying) {
      card.status.textContent = clock(audio.currentTime) + " / " + clock(audio.duration);
    } else if (card.message) {
      card.status.textContent = card.message;
    } else {
      card.status.textContent = heard.has(model.id) ? "Déjà écoutée" : "";
    }
  }

  function showCardMessage(id, message) {
    const card = cards.get(id);
    if (card) {
      card.message = message;
      refreshListening(card);
    }
  }

  // ---------------------------------------------------------------- listening

  function clearPending() {
    if (pending === undefined) {
      return undefined;
    }
    const finished = pending;
    window.clearInterval(finished.timer);
    pending = undefined;
    const card = cards.get(finished.id);
    if (card) {
      refreshListening(card);
    }
    return finished;
  }

  function silence() {
    const wasPlaying = playing;
    playing = undefined;
    audio.pause();
    audio.removeAttribute("src");
    audio.load();
    if (wasPlaying) {
      const card = cards.get(wasPlaying.id);
      if (card) {
        refreshListening(card);
      }
    }
  }

  function cancelPending() {
    const finished = clearPending();
    if (finished) {
      vscode.postMessage({ type: "cancelTrial", requestId: finished.requestId });
    }
  }

  function play(id, uri) {
    silence();
    playing = { id };
    audio.src = uri;
    const card = cards.get(id);
    if (card) {
      card.message = undefined;
      card.fill.style.width = "0%";
      refreshListening(card);
    }
    const started = audio.play();
    if (started && started.catch) {
      started.catch((error) => {
        // A stop or a switch interrupts the promise: only a real refusal is news.
        if (playing && playing.id === id && error && error.name !== "AbortError") {
          silence();
          showCardMessage(id, "Lecture impossible.");
        }
      });
    }
  }

  function startListening(id) {
    const card = cards.get(id);
    if (!card) {
      return;
    }
    cancelPending();
    silence();
    card.message = undefined;
    const text = String(phrase.value || "").trim();
    if (text.length === 0 && card.model.sampleUri) {
      play(id, card.model.sampleUri);
      return;
    }
    const requestId = nextRequestId++;
    pending = {
      id,
      requestId,
      startedAt: Date.now(),
      timer: window.setInterval(() => {
        const current = cards.get(id);
        if (current) {
          refreshListening(current);
        }
      }, 1000)
    };
    refreshListening(card);
    vscode.postMessage({ type: "trial", voiceId: id, text, requestId });
  }

  function stopCurrent(id) {
    if (pending && pending.id === id) {
      cancelPending();
    }
    if (playing && playing.id === id) {
      silence();
    }
  }

  audio.addEventListener("timeupdate", () => {
    if (!playing) {
      return;
    }
    const card = cards.get(playing.id);
    if (card) {
      const ratio = audio.duration > 0 ? Math.min(1, audio.currentTime / audio.duration) : 0;
      card.fill.style.width = Math.round(ratio * 100) + "%";
      refreshListening(card);
    }
  });
  audio.addEventListener("ended", () => {
    if (playing) {
      heard.add(playing.id);
    }
    silence();
  });
  audio.addEventListener("error", () => {
    if (playing) {
      const { id } = playing;
      silence();
      showCardMessage(id, "Échantillon illisible.");
    }
  });

  // ---------------------------------------------------------------- filters

  function matches(model) {
    const wanted = normalized(String(search.value || "").trim());
    if (wanted.length > 0 && !normalized(model.label).includes(wanted)) {
      return false;
    }
    if (filter === "ready") {
      return Boolean(model.ready);
    }
    if (filter === "favorites") {
      return favorites.includes(model.id);
    }
    return true;
  }

  function applyFilters() {
    const visible = { local: 0, kyutai: 0, prepare: 0 };
    for (const card of cards.values()) {
      const shown = matches(card.model);
      card.root.hidden = !shown;
      if (shown) {
        visible[card.section] += 1;
      }
    }
    for (const section of SECTIONS) {
      get("section-" + section).hidden = visible[section] === 0;
    }
    get("empty").hidden = visible.local + visible.kyutai + visible.prepare > 0;
    for (const name of Object.keys(filterButtons)) {
      const on = name === filter;
      filterButtons[name].setAttribute("aria-pressed", on ? "true" : "false");
      filterButtons[name].classList.toggle("primary", on);
    }
  }

  // ---------------------------------------------------------------- server

  function refreshEngines() {
    const kyutai = engines.kyutai;
    const status = get("kyutai-status");
    status.textContent = !kyutai
      ? ""
      : kyutai.status === "started"
        ? "Serveur démarré"
        : kyutai.status === "stopped"
          ? "Serveur arrêté"
          : "État du serveur inconnu";
    status.classList.toggle("state-ok", Boolean(kyutai) && kyutai.status === "started");

    const engine = bannerEngine();
    banner.hidden = engine === undefined;
    if (engine !== undefined) {
      const name = engine === "kokoro" ? "Kokoro" : engine === "chatterbox" ? "Chatterbox" : "Kyutai";
      get("banner-title").textContent = "Le serveur " + name + " est arrêté";
      get("banner-detail").textContent =
        engine === "kyutai"
          ? "Les échantillons inclus s'écoutent quand même. Pour votre phrase, démarrez-le : il tourne uniquement sur votre machine."
          : "Démarrez-le pour écouter cette voix : il tourne uniquement sur votre machine.";
      get("banner-command").textContent = engines[engine].command;
    }
  }

  function bannerEngine() {
    if (refusedEngine && engines[refusedEngine] && engines[refusedEngine].status !== "started") {
      return refusedEngine;
    }
    refusedEngine = undefined;
    return engines.kyutai && engines.kyutai.status === "stopped" ? "kyutai" : undefined;
  }

  // ---------------------------------------------------------------- credits

  function renderCredits(credits) {
    get("credits-subtitle").textContent = credits.subtitle || "";
    get("credits-clause").textContent = credits.clause || "";
    const groups = (credits.groups || []).map((group) => {
      const row = element("div", "credit");
      const head = element("div", "credit-head");
      head.append(element("strong", "", group.source), element("span", "muted small", group.licence));
      row.append(head, element("span", "", group.voices));
      if (group.note) {
        row.append(element("span", "muted small", group.note));
      }
      return row;
    });
    get("credits-groups").replaceChildren(...groups);
    const links = (credits.links || []).map((link) => {
      const created = button(link.label);
      created.addEventListener("click", () => {
        vscode.postMessage({ type: "openLink", url: link.url });
      });
      return created;
    });
    get("credits-links").replaceChildren(...links);
  }

  function showCredits(shown) {
    get("gallery-view").hidden = shown;
    get("credits-view").hidden = !shown;
  }

  // ---------------------------------------------------------------- messages

  function applyState(message) {
    if (!Array.isArray(message.cards)) {
      return;
    }
    favorites = Array.isArray(message.favorites) ? message.favorites : [];
    engines = message.engines && typeof message.engines === "object" ? message.engines : {};
    activeId = message.activeId;
    get("current-voice").textContent = message.activeLabel || "";
    for (const model of message.cards) {
      const card = cards.get(model.id) || createCard(model);
      card.model = model;
      placeCard(card, model.section);
      refreshCard(card);
    }
    if (message.credits) {
      renderCredits(message.credits);
    }
    refreshEngines();
    applyFilters();
  }

  /** The answer to the request still waiting, and no other. */
  function settlePending(message) {
    if (!pending || pending.requestId !== message.requestId) {
      return undefined;
    }
    return clearPending();
  }

  window.addEventListener("message", (event) => {
    const message = event.data;
    if (!message || typeof message !== "object") {
      return;
    }
    switch (message.type) {
      case "state":
        applyState(message);
        break;
      case "trialAudio": {
        const finished = settlePending(message);
        if (finished) {
          play(finished.id, message.uri);
        }
        break;
      }
      case "trialStopped": {
        const finished = settlePending(message);
        if (finished) {
          refusedEngine = message.engine;
          if (engines[message.engine]) {
            engines[message.engine].status = "stopped";
          }
          showCardMessage(finished.id, "Serveur arrêté.");
          refreshEngines();
        }
        break;
      }
      case "trialError": {
        const finished = settlePending(message);
        if (finished) {
          showCardMessage(finished.id, String(message.message || "Écoute impossible."));
        }
        break;
      }
      case "notice":
        notice.textContent = String(message.message || "");
        notice.hidden = false;
        break;
      default:
        break;
    }
  });

  // ---------------------------------------------------------------- controls

  search.addEventListener("input", applyFilters);
  for (const name of Object.keys(filterButtons)) {
    filterButtons[name].addEventListener("click", () => {
      filter = name;
      applyFilters();
    });
  }
  get("phrase-reset").addEventListener("click", () => {
    phrase.value = "";
  });
  get("banner-copy").addEventListener("click", () => {
    const engine = bannerEngine();
    if (engine !== undefined) {
      vscode.postMessage({ type: "copyCommand", engine });
    }
  });
  get("banner-check").addEventListener("click", () => {
    vscode.postMessage({ type: "refreshHealth" });
  });
  get("open-credits").addEventListener("click", () => showCredits(true));
  get("credits-back").addEventListener("click", () => showCredits(false));

  vscode.postMessage({ type: "ready" });
})();
