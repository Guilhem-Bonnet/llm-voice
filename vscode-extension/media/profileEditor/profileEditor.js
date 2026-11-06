// Profile editor webview script (S8.2, CdC §49, AC-SEC-02). Every field
// coming from the Extension Host (profile label, description, narration
// prompt, voice id...) is untrusted text and is written with `.value`/
// `.textContent` or built with `document.createElement` — never an
// HTML-parsing sink (see this file's own security test,
// `test/unit/security/webview-injection-profile-editor.test.ts`).
(function () {
  "use strict";

  const vscode = acquireVsCodeApi();

  const form = document.getElementById("profile-form");
  const fields = {
    label: document.getElementById("field-label"),
    language: document.getElementById("field-language"),
    description: document.getElementById("field-description"),
    mode: document.getElementById("field-mode"),
    narratorProvider: document.getElementById("field-narrator-provider"),
    narratorModel: document.getElementById("field-narrator-model"),
    style: document.getElementById("field-style"),
    ttsProvider: document.getElementById("field-tts-provider"),
    ttsBaseUrl: document.getElementById("field-tts-base-url"),
    ttsVoice: document.getElementById("field-tts-voice"),
    speed: document.getElementById("field-speed"),
    markdownCode: document.getElementById("field-md-code"),
    markdownLinks: document.getElementById("field-md-links"),
    markdownImages: document.getElementById("field-md-images"),
    markdownTables: document.getElementById("field-md-tables"),
    syncMode: document.getElementById("field-sync-mode")
  };
  const narratorFields = document.getElementById("narrator-fields");
  const parametersContainer = document.getElementById("tts-parameters");
  const validationErrors = document.getElementById("validation-errors");
  const voiceWarning = document.getElementById("voice-warning");
  const testStatus = document.getElementById("test-status");
  const connectionStatus = document.getElementById("connection-status");

  // The full profile last loaded from the extension host: fields this form
  // does not expose (id, chunking, playback.volume, tts.apiKeyRef,
  // tts.format, tts.referenceAudio...) are carried over unchanged rather
  // than dropped on save.
  let loadedProfile;
  /** Descriptors for the current provider's tunables (ADR-005 `TtsParameterDescriptor`). */
  let parameterDescriptors = [];
  /** Current values of provider-specific parameters, keyed by name. */
  let parameterValues = {};

  function post(message) {
    vscode.postMessage(message);
  }

  function textOf(value) {
    return typeof value === "string" ? value : "";
  }

  function numberOr(value, fallback) {
    return typeof value === "number" && Number.isFinite(value) ? value : fallback;
  }

  /** ADR-017: `tts: {}` inherits the global voice; any field in it is a voice of its own. */
  function inheritsGlobalVoice(tts) {
    return !tts || Object.keys(tts).every((key) => tts[key] === undefined);
  }

  function isGlobalVoiceSelected() {
    return fields.ttsProvider.value === "global";
  }

  /**
   * "Voix globale" leaves nothing to set here: the voice and the settings of the
   * engine belong to it, and the form keeps `tts: {}` (ADR-017 §3).
   */
  function updateVoiceFieldsAvailability() {
    const disabled = isGlobalVoiceSelected();
    fields.ttsBaseUrl.disabled = disabled;
    fields.ttsVoice.disabled = disabled;
    document.getElementById("btn-check-health").disabled = disabled;
    document.getElementById("btn-browse-voices").disabled = disabled;
    parametersContainer.hidden = disabled;
  }

  function updateNarratorVisibility() {
    narratorFields.style.display = fields.mode.value === "narrated" ? "" : "none";
  }

  function clearChildren(node) {
    while (node.firstChild) {
      node.removeChild(node.firstChild);
    }
  }

  /** Builds one number/text input per `TtsParameterDescriptor` (ADR-005: UI generated from capabilities, never hard-coded). */
  function renderParameters() {
    clearChildren(parametersContainer);
    for (const descriptor of parameterDescriptors) {
      const wrapper = document.createElement("div");
      wrapper.className = "parameter-row";

      const label = document.createElement("label");
      const inputId = `param-${descriptor.name}`;
      label.setAttribute("for", inputId);
      label.textContent = textOf(descriptor.label) || textOf(descriptor.name);

      const input = document.createElement("input");
      input.id = inputId;
      input.dataset.paramName = descriptor.name;
      if (descriptor.type === "number") {
        input.type = "number";
        if (typeof descriptor.min === "number") input.min = String(descriptor.min);
        if (typeof descriptor.max === "number") input.max = String(descriptor.max);
        if (typeof descriptor.step === "number") input.step = String(descriptor.step);
        const current = parameterValues[descriptor.name];
        input.value = String(numberOr(current, numberOr(descriptor.default, 0)));
      } else if (descriptor.type === "boolean") {
        input.type = "checkbox";
        input.checked = Boolean(parameterValues[descriptor.name] ?? descriptor.default);
      } else {
        input.type = "text";
        input.value = textOf(parameterValues[descriptor.name] ?? descriptor.default ?? "");
      }
      if (typeof descriptor.description === "string" && descriptor.description.length > 0) {
        input.title = descriptor.description;
      }

      wrapper.appendChild(label);
      wrapper.appendChild(input);
      parametersContainer.appendChild(wrapper);
    }
  }

  function collectParameterValues() {
    const values = {};
    const inputs = parametersContainer.querySelectorAll("input[data-param-name]");
    for (const input of inputs) {
      const name = input.dataset.paramName;
      if (input.type === "checkbox") {
        values[name] = input.checked;
      } else if (input.type === "number") {
        values[name] = Number(input.value);
      } else {
        values[name] = input.value;
      }
    }
    return values;
  }

  function applyProfileToForm(profile) {
    loadedProfile = profile;
    fields.label.value = textOf(profile.label);
    fields.language.value = textOf(profile.language);
    fields.description.value = textOf(profile.description);
    fields.mode.value = profile.mode === "narrated" ? "narrated" : "faithful";
    fields.narratorProvider.value = textOf(profile.narrator && profile.narrator.providerId);
    fields.narratorModel.value = textOf(profile.narrator && profile.narrator.model);
    fields.style.value = textOf(profile.style);
    // A voice of its own that names no engine resolves like "auto" from the settings.
    fields.ttsProvider.value = inheritsGlobalVoice(profile.tts)
      ? "global"
      : textOf(profile.tts.providerId) || "auto";
    fields.ttsBaseUrl.value = textOf(profile.tts && profile.tts.baseUrl);
    fields.ttsVoice.value = textOf(profile.tts && profile.tts.voice);
    fields.speed.value = String(numberOr(profile.playback && profile.playback.rate, 1));
    const md = profile.markdown || {};
    fields.markdownCode.value = textOf(md.code) || "skip";
    fields.markdownImages.value = textOf(md.images) || "skip";
    fields.markdownTables.value = textOf(md.tables) || "summarize";
    fields.syncMode.value = textOf(profile.synchronization && profile.synchronization.mode) || "highlight-scroll";
    voiceWarning.hidden = true;
    voiceWarning.textContent = "";
    parameterValues = { ...(profile.tts && profile.tts.parameters) };
    updateNarratorVisibility();
    updateVoiceFieldsAvailability();
    renderParameters();
  }

  /** The voice of this form: nothing for "Voix globale", without a guess for what was not named. */
  function collectFormTts(base) {
    if (isGlobalVoiceSelected()) {
      return {};
    }
    // An engine this list does not offer leaves the select empty: it is kept, not lost.
    const provider = fields.ttsProvider.value || (base.tts && base.tts.providerId);
    const namedNoEngine = provider === "auto" && base.tts && base.tts.providerId === undefined;
    const tts = {
      ...base.tts,
      providerId: provider,
      baseUrl: fields.ttsBaseUrl.value || undefined,
      voice: fields.ttsVoice.value || undefined,
      parameters: collectParameterValues()
    };
    if (namedNoEngine) {
      delete tts.providerId;
    }
    return tts;
  }

  /** Builds the profile-shaped object this form can produce, merged over `loadedProfile`. */
  function collectFormProfile() {
    const base = loadedProfile || {};
    const narratorProvider = fields.narratorProvider.value;
    const profile = {
      ...base,
      label: fields.label.value,
      language: fields.language.value,
      description: fields.description.value,
      mode: fields.mode.value === "narrated" ? "narrated" : "faithful",
      style: fields.style.value,
      tts: collectFormTts(base),
      playback: {
        ...base.playback,
        rate: Number(fields.speed.value)
      },
      markdown: {
        headings: "read",
        links: "labelOnly",
        images: fields.markdownImages.value,
        code: fields.markdownCode.value,
        tables: fields.markdownTables.value,
        frontmatter: "skip"
      },
      synchronization: {
        mode: fields.syncMode.value
      }
    };
    if (narratorProvider) {
      profile.narrator = {
        ...base.narrator,
        providerId: narratorProvider,
        model: fields.narratorModel.value || undefined
      };
    } else {
      delete profile.narrator;
    }
    if (!profile.description) {
      delete profile.description;
    }
    if (!profile.tts.baseUrl) {
      delete profile.tts.baseUrl;
    }
    if (!profile.tts.voice) {
      delete profile.tts.voice;
    }
    return profile;
  }

  function renderErrors(errors) {
    clearChildren(validationErrors);
    if (!errors || errors.length === 0) {
      return;
    }
    const list = document.createElement("ul");
    for (const message of errors) {
      const item = document.createElement("li");
      item.textContent = message;
      list.appendChild(item);
    }
    validationErrors.appendChild(list);
  }

  // Real-user bug (2026-11-05): switching `field-tts-provider` never
  // touched `field-tts-base-url` — picking "Kyutai Pocket TTS" after the
  // profile had been created with Chatterbox left the Chatterbox port
  // (8004) in place, so synthesis failed against the wrong server with no
  // obvious reason why. Known default base URLs, mirroring
  // `src/tts/presets.ts`'s own preset objects (this plain webview script
  // has no bundler/import access to that file, so the values are kept in
  // sync by hand — see that file if a preset's default ever changes).
  var KNOWN_DEFAULT_BASE_URLS = {
    chatterbox: "http://localhost:8004",
    kokoro: "http://localhost:8880",
    "kyutai-pocket": "http://localhost:8000",
    "kyutai-1-6b": "http://localhost:8020"
  };
  // Sentinel review (same day): the first version of this fix compared
  // `current` to these values verbatim — but the real error the user saw
  // named `http://127.0.0.1:8004`, not `http://localhost:8004`, so a
  // byte-exact comparison would have missed the exact case this fix exists
  // for. `localhost` and `127.0.0.1` name the same loopback endpoint; this
  // normalizes both forms (lowercase, no trailing slash, `127.0.0.1` ===
  // `localhost`) before comparing, so either spelling of a known default is
  // recognized the same way.
  function normalizeLoopbackUrl(value) {
    return value
      .toLowerCase()
      .replace(/\/+$/, "")
      .replace("://127.0.0.1", "://localhost");
  }
  var NORMALIZED_KNOWN_DEFAULTS = Object.values(KNOWN_DEFAULT_BASE_URLS).map(normalizeLoopbackUrl);
  fields.ttsProvider.addEventListener("change", () => {
    // Leaving "Voix globale": its tunables described another engine, they must not
    // be saved as this one's.
    if (parametersContainer.hidden && !isGlobalVoiceSelected()) {
      parameterDescriptors = [];
      renderParameters();
    }
    updateVoiceFieldsAvailability();
    if (isGlobalVoiceSelected()) {
      return;
    }
    const current = fields.ttsBaseUrl.value.trim();
    // Only auto-fill when the field is empty or still holds another known
    // provider's *default* (in either loopback spelling) — a URL the user
    // typed by hand (anything else) is never touched, so a deliberate
    // custom endpoint always survives a provider switch.
    const isKnownDefault = current === "" || NORMALIZED_KNOWN_DEFAULTS.includes(normalizeLoopbackUrl(current));
    if (!isKnownDefault) {
      return;
    }
    const next = KNOWN_DEFAULT_BASE_URLS[fields.ttsProvider.value];
    if (next !== undefined) {
      fields.ttsBaseUrl.value = next;
    }
  });

  fields.mode.addEventListener("change", updateNarratorVisibility);

  // Real-user bug (2026-11-05): a provider/Base URL mismatch used to be
  // invisible until the user actually tried to speak something, minutes
  // later, with a cryptic "fetch failed" naming neither field. Checking
  // right here — on provider change (after the auto-fill above) and when
  // the Base URL field loses focus — surfaces it immediately instead.
  //
  // Sentinel review (same day): nothing stopped two checks from racing —
  // e.g. editing the URL then immediately picking a different provider
  // fires `blur` then `change`, each posting its own `checkHealth`; if
  // their `healthResult` replies came back out of order, the status shown
  // could describe the wrong one. `requestId` makes every reply carry back
  // which request it answers, so a stale one arriving after a newer one
  // (or after a profile reload) is simply ignored instead of overwriting
  // the current status.
  var lastCheckedBaseUrl;
  var latestHealthRequestId = 0;
  function checkConnection() {
    if (isGlobalVoiceSelected()) {
      return;
    }
    const baseUrl = fields.ttsBaseUrl.value.trim();
    if (baseUrl === lastCheckedBaseUrl) {
      // A `blur` with nothing actually changed (e.g. tabbing through
      // without editing) would otherwise re-run the same check for no
      // reason every time the field loses focus.
      return;
    }
    lastCheckedBaseUrl = baseUrl;
    latestHealthRequestId += 1;
    connectionStatus.textContent = "Vérification…";
    connectionStatus.className = "";
    post({ type: "checkHealth", requestId: latestHealthRequestId, profile: collectFormProfile() });
  }
  document.getElementById("btn-check-health").addEventListener("click", () => {
    // The button means "check now" even if the URL hasn't changed since
    // the last check — bypass the no-op guard above for this one trigger.
    lastCheckedBaseUrl = undefined;
    checkConnection();
  });
  fields.ttsProvider.addEventListener("change", checkConnection);
  fields.ttsBaseUrl.addEventListener("blur", checkConnection);

  form.addEventListener("submit", (event) => {
    event.preventDefault();
    post({ type: "save", profile: collectFormProfile() });
  });

  document.getElementById("btn-test").addEventListener("click", () => {
    testStatus.textContent = "Lecture en cours…";
    post({ type: "test", profile: collectFormProfile() });
  });

  document.getElementById("btn-duplicate").addEventListener("click", () => {
    post({ type: "duplicate" });
  });

  document.getElementById("btn-delete").addEventListener("click", () => {
    post({ type: "delete" });
  });

  document.getElementById("btn-browse-voices").addEventListener("click", () => {
    post({ type: "browseVoices", profile: collectFormProfile() });
  });

  window.addEventListener("message", (event) => {
    const message = event.data;
    switch (message.type) {
      case "load": {
        parameterDescriptors = Array.isArray(message.parameters) ? message.parameters : [];
        applyProfileToForm(message.profile || {});
        renderErrors(undefined);
        testStatus.textContent = "";
        connectionStatus.textContent = "";
        connectionStatus.className = "";
        // A check already in flight for the previous profile must never be
        // allowed to paint its (now meaningless) result over this one.
        latestHealthRequestId += 1;
        lastCheckedBaseUrl = undefined;
        break;
      }
      case "voiceSelected": {
        fields.ttsVoice.value = textOf(message.voiceId);
        if (message.warning) {
          voiceWarning.hidden = false;
          voiceWarning.textContent = textOf(message.warning);
        } else {
          voiceWarning.hidden = true;
          voiceWarning.textContent = "";
        }
        break;
      }
      case "saveResult": {
        renderErrors(message.errors);
        break;
      }
      case "testResult": {
        testStatus.textContent = message.ok ? "Lecture lancée." : `Erreur : ${textOf(message.error)}`;
        break;
      }
      case "healthResult": {
        if (message.requestId !== undefined && message.requestId !== latestHealthRequestId) {
          // A reply to a superseded check (raced by a newer one, or by a
          // profile reload) — ignore it rather than overwrite a status that
          // describes the *current* form state with one that doesn't.
          break;
        }
        const ok = message.status === "ok" || message.status === "degraded";
        connectionStatus.className = ok ? "connection-ok" : "connection-error";
        const endpoint = textOf(message.endpoint);
        const detail = textOf(message.detail);
        if (ok) {
          connectionStatus.textContent = `✓ Joignable${endpoint ? ` (${endpoint})` : ""}`;
        } else {
          connectionStatus.textContent = `✗ Injoignable${detail ? ` — ${detail}` : ""}`;
        }
        break;
      }
      default:
        break;
    }
  });

  post({ type: "ready" });
})();
