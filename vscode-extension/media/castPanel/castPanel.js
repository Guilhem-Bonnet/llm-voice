// Panneau Distribution : la page montre l'état envoyé par l'hôte ; tout texte passe par textContent.
(function () {
  const vscode = acquireVsCodeApi();
  const page = document.getElementById("page");
  const audio = new Audio();
  let state;
  let nextRequest = 1;
  let openRole;
  const pending = new Map(); // requestId -> { label, started, estimate, timer }
  let status = "";

  function el(tag, attrs, children) {
    const node = document.createElement(tag);
    for (const [key, value] of Object.entries(attrs || {})) {
      if (key === "text") node.textContent = value;
      else if (key === "onclick") node.addEventListener("click", value);
      else if (value !== undefined && value !== false) node.setAttribute(key, value === true ? "" : value);
    }
    for (const child of children || []) if (child) node.appendChild(child);
    return node;
  }

  function button(label, onclick, extra) {
    return el("button", Object.assign({ type: "button", text: label, onclick }, extra || {}));
  }

  function setStatus(text) {
    status = text;
    const node = document.getElementById("status");
    if (node) node.textContent = text;
  }

  function startRequest(label) {
    const requestId = nextRequest++;
    pending.set(requestId, { label, started: Date.now(), estimate: undefined, timer: undefined });
    return requestId;
  }

  function tick(requestId) {
    const item = pending.get(requestId);
    if (!item) return;
    const elapsed = Math.round((Date.now() - item.started) / 1000);
    const estimate = item.estimate !== undefined ? ` sur environ ${item.estimate} s` : "";
    setStatus(`${item.label} : calcul en cours, ${elapsed} s${estimate}.`);
  }

  function listen(roleId, voiceId) {
    const requestId = startRequest("Écoute");
    vscode.postMessage(Object.assign({ type: "listen", roleId, requestId }, voiceId ? { voiceId } : {}));
  }

  function render() {
    page.replaceChildren();
    if (!state) return;
    const plural = state.rows.length > 1 ? "personnages repérés" : "personnage repéré";
    page.appendChild(el("h1", { text: `Distribution : ${state.documentName}` }));
    page.appendChild(el("p", { class: "muted", text: `${state.rows.length} ${plural}. Moteur : ${state.engineLabel}. Les mots du texte ne changent jamais.` }));
    if (state.slowFactor) {
      page.appendChild(el("p", { class: "muted", text: `Ce moteur calcule environ ${state.slowFactor} s par seconde d'audio : une écoute demande un peu d'attente.` }));
    }
    if (state.notice) page.appendChild(el("p", { class: "notice", id: "notice", text: state.notice }));
    page.appendChild(el("p", { class: "status", id: "status", role: "status", text: status }));

    const narrator = el("div", { class: "row", "data-role": "narrator" }, [
      el("div", { class: "who" }, [
        el("span", { class: "name", text: "Narrateur" }),
        el("span", { class: "voice", text: `Voix du mode : ${state.narrator.voiceLabel || "voix par défaut"}` })
      ]),
      el("div", { class: "actions" }, [])
    ]);
    page.appendChild(narrator);

    for (const row of state.rows) {
      const voiceText = row.voiceLabel ? `Voix : ${row.voiceLabel}` : "Voix : celle du narrateur (aucune voix libre)";
      const who = el("div", { class: "who" }, [
        el("span", { class: "name", text: `${row.name} · ${row.lines} répliques` }),
        el("span", { class: "quote", title: row.firstLine, text: row.firstLine ? `« ${row.firstLine} »` : "" }),
        el("span", { class: "voice" }, [
          document.createTextNode(voiceText),
          row.byUser ? el("span", { class: "tag", text: "Choisie par vous" }) : null,
          row.shared ? el("span", { class: "tag", text: "Voix partagée" }) : null,
          row.unavailable ? el("span", { class: "tag", text: "Voix absente du moteur" }) : null,
          row.narratorClash ? el("span", { class: "tag", text: "Même voix que le narrateur" }) : null
        ]),
        row.proposal ? el("span", { class: "proposal", text: proposalText(row.proposal) }) : null
      ]);
      const actions = el("div", { class: "actions" }, [
        button("Écouter", () => listen(row.roleId, undefined), { "data-action": "listen", disabled: !row.firstLine }),
        button("Changer", () => { openRole = openRole === row.roleId ? undefined : row.roleId; render(); }, { "data-action": "change" })
      ]);
      const line = el("div", { class: "row", "data-role": row.roleId }, [who, actions]);
      if (openRole === row.roleId) line.appendChild(choices(row));
      page.appendChild(line);
    }

    page.appendChild(el("div", { class: "footer" }, [
      button("Lire", () => vscode.postMessage({ type: "read" }), { class: "primary", "data-action": "read" }),
      button("Refaire la distribution", () => vscode.postMessage({ type: "recast" }), { "data-action": "recast", title: "Les voix attribuées automatiquement sont recalculées avec les voix disponibles. Vos choix restent." })
    ]));
    if (state.canCreateVoice) page.appendChild(createForm());
  }

  function proposalText(p) {
    const parts = [p.age, p.gender, p.character].filter(Boolean).join(", ");
    return `Proposition : ${parts}${p.quote ? ` (d'après « ${p.quote} »)` : ""}`;
  }

  function choices(row) {
    const box = el("div", { class: "choices" });
    if (state.voices.length === 0) {
      box.appendChild(el("p", { class: "muted", text: state.canCreateVoice ? "Aucune voix à proposer : créez une voix ci-dessous." : "Ce moteur ne propose pas d'autre voix." }));
    }
    for (const voice of state.voices) {
      const notes = [];
      if (voice.narrator) notes.push("voix du narrateur");
      const others = voice.takenBy.filter((name) => name !== row.name);
      if (others.length) notes.push(`déjà prise par ${others.join(", ")}`);
      if (voice.created) notes.push("créée ici");
      const label = notes.length ? `${voice.label} (${notes.join(" ; ")})` : voice.label;
      box.appendChild(el("div", { class: "choice", "data-voice": voice.id }, [
        el("span", { class: "choice-label", title: label, text: label }),
        el("div", { class: "actions" }, [
          button("Écouter la voix", () => { const requestId = startRequest("Extrait"); vscode.postMessage({ type: "sampleVoice", voiceId: voice.id, requestId }); }),
          button("Essayer sur la réplique", () => listen(row.roleId, voice.id), { disabled: !row.firstLine }),
          button("Attribuer", () => { openRole = undefined; vscode.postMessage({ type: "assign", roleId: row.roleId, voiceId: voice.id }); }, { class: "primary" })
        ])
      ]));
    }
    return box;
  }

  function select(id, options) {
    return el("select", { id }, options.map(([value, label]) => el("option", { value, text: label })));
  }

  function createForm() {
    const target = select("create-for", [["", "aucun personnage pour l'instant"]].concat(state.rows.map((row) => [row.roleId, row.name])));
    const form = el("section", { class: "create", "aria-label": "Créer une voix" }, [
      el("h2", { text: "Créer une voix" }),
      el("p", { class: "muted", text: "Quelques choix simples ; l'extension écrit la consigne pour le moteur. Le calcul prend environ 30 s." }),
      el("div", { class: "fields" }, [
        el("label", {}, [document.createTextNode("Genre"), select("create-gender", [["woman", "femme"], ["man", "homme"], ["unspecified", "non précisé"]])]),
        el("label", {}, [document.createTextNode("Âge"), select("create-age", [["adult", "adulte"], ["young", "jeune"], ["elderly", "âgé"], ["child", "enfant"]])]),
        el("label", {}, [document.createTextNode("Timbre"), select("create-timbre", [["medium", "medium"], ["deep", "grave"], ["high", "aigu"]])]),
        el("fieldset", { class: "traits" }, [el("legend", { text: "Caractère (trois au plus)" })].concat(
          state.traitChoices.map((trait) => el("label", { class: "trait" }, [
            el("input", { type: "checkbox", value: trait.id, "data-trait": trait.id, onclick: limitTraits }),
            document.createTextNode(trait.label)
          ]))
        )),
        el("label", {}, [document.createTextNode("Nom de la voix"), el("input", { id: "create-name", maxlength: "40" })]),
        el("label", {}, [document.createTextNode("Attribuer à"), target])
      ]),
      el("div", { class: "footer" }, [button("Créer la voix", submitCreate, { class: "primary", id: "create-submit" })])
    ]);
    return form;
  }

  function chosenTraits() {
    return Array.from(document.querySelectorAll("input[data-trait]:checked")).map((node) => node.value);
  }

  function limitTraits(event) {
    if (chosenTraits().length > 3) {
      event.target.checked = false;
      setStatus("Trois caractères au plus.");
    }
  }

  function value(id) {
    const node = document.getElementById(id);
    return node ? node.value : "";
  }

  function submitCreate() {
    const name = value("create-name").trim();
    if (!name) { setStatus("Donnez un nom à la voix."); return; }
    const requestId = startRequest("Création de la voix");
    const forRoleId = value("create-for");
    vscode.postMessage(Object.assign({
      type: "createVoice",
      name,
      requestId,
      recipe: { gender: value("create-gender"), age: value("create-age"), timbre: value("create-timbre"), traits: chosenTraits() }
    }, forRoleId ? { forRoleId } : {}));
  }

  function finish(requestId) {
    const item = pending.get(requestId);
    if (item && item.timer) clearInterval(item.timer);
    pending.delete(requestId);
  }

  window.addEventListener("message", (event) => {
    const message = event.data || {};
    switch (message.type) {
      case "state": state = message.state; render(); break;
      case "busy": {
        const item = pending.get(message.requestId);
        if (item) { item.estimate = message.estimateSeconds; item.timer = setInterval(() => tick(message.requestId), 1000); tick(message.requestId); }
        break;
      }
      case "audio":
        finish(message.requestId);
        setStatus("Écoute.");
        audio.src = message.uri;
        audio.play().catch(() => setStatus("La page n'a pas pu lire ce son."));
        break;
      case "failed": finish(message.requestId); setStatus(message.message); break;
      case "created": finish(message.requestId); setStatus(`Voix « ${message.name} » créée : elle est dans la liste de Changer.`); break;
      case "notice": setStatus(message.message); break;
    }
  });

  vscode.postMessage({ type: "ready" });
})();
