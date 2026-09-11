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
    fields.ttsProvider.value = textOf(profile.tts && profile.tts.providerId) || "chatterbox";
    fields.ttsBaseUrl.value = textOf(profile.tts && profile.tts.baseUrl);
    fields.ttsVoice.value = textOf(profile.tts && profile.tts.voice);
    fields.speed.value = String(numberOr(profile.playback && profile.playback.rate, 1));
    const md = profile.markdownPolicy || {};
    fields.markdownCode.value = textOf(md.code) || "skip";
    fields.markdownImages.value = textOf(md.images) || "skip";
    fields.markdownTables.value = textOf(md.tables) || "summarize";
    fields.syncMode.value = textOf(profile.syncMode) || "highlight-scroll";
    voiceWarning.hidden = true;
    voiceWarning.textContent = "";
    parameterValues = { ...(profile.tts && profile.tts.parameters) };
    updateNarratorVisibility();
    renderParameters();
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
      tts: {
        ...base.tts,
        providerId: fields.ttsProvider.value,
        baseUrl: fields.ttsBaseUrl.value || undefined,
        voice: fields.ttsVoice.value || undefined,
        parameters: collectParameterValues()
      },
      playback: {
        ...base.playback,
        rate: Number(fields.speed.value)
      },
      markdownPolicy: {
        headings: "read",
        links: "labelOnly",
        images: fields.markdownImages.value,
        code: fields.markdownCode.value,
        tables: fields.markdownTables.value,
        frontmatter: "skip"
      },
      syncMode: fields.syncMode.value
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

  fields.mode.addEventListener("change", updateNarratorVisibility);

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
        testStatus.textContent = message.ok ? "Lecture terminée." : `Erreur : ${textOf(message.error)}`;
        break;
      }
      default:
        break;
    }
  });

  post({ type: "ready" });
})();
