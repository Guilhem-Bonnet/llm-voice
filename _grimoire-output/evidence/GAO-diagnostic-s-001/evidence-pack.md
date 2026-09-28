# Agentic Evidence Pack

## Summary

- Task id: GAO-diagnostic-s-001
- Profile: controlled
- Outcome: Diagnostic son absent et resynchronisation surlignage, stratégie Rust — critères : AC-001 gate check --strict vert, son audible prouvé sur profil jetable, ADR Rust tranché
- Final state: in_progress (2026-09-20)

## Evidence inventory

| Evidence | Location | Produced by | Result |
|---|---|---|---|
| Point de départ git | HEAD 88384dc | git rev-parse --short HEAD | référence (2026-09-20) |
| Veille briques existantes (7 notes + rapport) | `_grimoire-output/research/reports/Briques existantes pour LLM Voice.md` | sous-agents Sonnet, coordination concierge | livré (2026-09-27) |
| Fact-check alternatives Jev | `_grimoire-output/research/research_notes/verification-alternatives-jev.md` | sous-agent Sonnet | livré (2026-09-27) ; 2 corrections majeures (Ollama logprobs, OpenJev≠Verdict) |
| Preuve logprobs Ollama natif | `curl localhost:11434/api/generate` (qwen2.5:3b, logprobs+top_logprobs) | concierge | `response "A"`, distribution A/B/C retournée (2026-09-27) |
| Boucle de vérification audio sans humain | scratchpad : venv faster-whisper (small, CPU) + sink nul PipeWire + monitor | concierge | Chatterbox FR transcrit mot pour mot ; capture monitor transcrite (2026-09-27) — à pérenniser dans `scripts/` |
| Arbitrage mode Auto | `decision-models-jev-v1.md` §10, `decisions-log.md` 2026-09-27 | concierge | SemIf sur Ollama retenu pour le spike |
| Cartographie points d'insertion mode Auto | `_grimoire-output/research/research_notes/decision-points-code-map.md` | sous-agent Explore Sonnet | 7 sections file:line ; chokepoint `Pipeline.ts:553` (2026-09-27) |
| Cartographie autres points de décision produit | `_grimoire-output/research/research_notes/decision-points-product-map.md` | sous-agent Explore Sonnet, écrit par concierge | a–j évalués ; retenus : triage inbox, langue par document ; 6 refus motivés (2026-09-27) |
| Plan d'implémentation DecisionProvider | `_grimoire-output/planning-artifacts/decision-points-map-v1.md` | sous-agent Sonnet, file:line revérifiés dans le code | 12 + 6 + 7 points d'insertion ; 1 correction de lignes (InboxTreeProvider 50-52) (2026-09-27) |
| Débat langage Core : 3 plaidoiries sourcées | `_grimoire-output/research/debate-language-core/position-{rust,go,typescript}.md` | sous-agents Sonnet | livrées (2026-09-27), ~10 000 mots |
| Synthèse du juge (option E proposée) | `_grimoire-output/planning-artifacts/debat-langage-core-synthese-v1.md` | platform-architect Opus, contexte neuf | scores E 82,1 / D 81,6 / F 72,1 / A 66,4 / C 59,9 / B 54,4 ; chiffres TS corrigés (24 fichiers importent vscode) ; **en attente validation utilisateur** |
| Cartes Mission Ledger du lot ADR-012 + maquette | `grimoire task list` | concierge | 11 cartes ouvertes (2026-09-27) |
| Politique d'autoplay lue dans le binaire VS Code | `grep -o 'autoplayPolicy:"[a-z-]*"' /usr/share/code/resources/app/out/main.js` → `autoplayPolicy:"user-gesture-required"` (VS Code 1.138.0 le 2026-09-27, revérifié en 1.139.1 le 2026-09-28) | concierge | confirme la cause racine `NotAllowedError` : politique Electron explicite, pas un effet de bord |
| Maquette produit haute fidélité v1 (8 artboards, Design canvas) | https://claude.ai/artifact/28tcdY8BgnvMLoFQmSxyVJ · `_grimoire-output/design/maquette-v1.md` | agent-optimizer + skill meta-art-direction (Frida), Opus | publiée (version 3, 2026-09-28), non rendue ni vérifiée visuellement ; en attente de relecture utilisateur |
| Maquette v2.0 (revue Sentinel appliquée, règle des boutons, phasage OS) | https://claude.ai/artifact/28tcdY8BgnvMLoFQmSxyVJ version 28 · `_grimoire-output/design/maquette-v1.md` · `_grimoire-output/design/verify_boards.py` | agent-optimizer + skill meta-art-direction (Frida), Opus, carte GAO-s2-design-ma-001 | `python3 verify_boards.py` : AUCUN ÉCHEC sur 13 artboards / 90 boutons (analyse statique, sans rendu) ; détecte le texte parasite sur l’ancien SidebarLight |

## Validation

| Check | Command or method | Result | Notes |
|---|---|---|---|
|  |  |  |  |

## Controls

| Control family | Applied? | Evidence | Gap |
|---|---:|---|---|
| Governance | no |  |  |
| Quality | no |  |  |
| Runtime | no |  |  |
| Knowledge | no |  |  |
| Model/provider | no |  |  |

## Deviations and accepted risks

| Deviation | Impact | Accepted by | Review trigger |
|---|---|---|---|
|  |  |  |  |

## Completion statement

The task can be considered complete only when mandatory evidence gates for the selected profile are satisfied or explicitly marked non-applicable with justification.

## Cause racine établie le 2026-09-27 — politique d'autoplay de Chromium

**Symptôme** : aucun son, surlignage qui défile, `Audio error code 4` intermittent, chez l'utilisateur, alors que tous les tests passent.

**Mesure décisive.** Sonde écrite dans `test/integration-security/audible-probe.test.ts` : un webview réel, sur l'affichage réel (`DISPLAY=:0`, session Wayland, socket PipeWire accessible), charge un WAV de 10 s de sinus 440 Hz valide et appelle `audio.play()`. Surveillance simultanée des flux PipeWire (`pactl list sink-inputs`, échantillonnage 250 ms).

Résultat brut, reproduit deux fois :

```
playRejected: "NotAllowedError: play() can only be initiated by a user gesture."
flux audio VS Code détectés : 0
```

Deuxième passe avec `audio.muted = true` avant `play()` — la lecture muette, habituellement tolérée par Chromium : **même rejet**. La politique d'Electron dans VS Code exige un geste utilisateur sans exception.

**Conséquence.** `ADR-001` (lecture audio par une balise `<audio>` dans un webview piloté par `postMessage`) est **structurellement impossible** pour une lecture déclenchée par l'extension : aucune correction d'URI, de CSP, de `localResourceRoots` ou de pont audio ne peut contourner la politique d'autoplay. Les quatre corrections précédentes (garde d'existence, erreur non progressive, chien de garde, lien de webview par identité) étaient justes mais ne pouvaient pas rétablir le son.

**Ce que cela ne remet pas en cause** : le fichier audio produit est valide, le cache fonctionne, la synthèse fonctionne, le transport de ressource fonctionne. Seule la mise en lecture est bloquée.

**Deux issues possibles** :
1. Un geste utilisateur réel dans le document du lecteur (clic sur ▶ dans la vue) débloque la lecture pour la durée de vie de ce document.
2. Lecture audio hors du webview — c'est la décision de l'`ADR-012` (moteur audio natif), dont cette mesure devient la justification empirique.

## Étude modèles de décision (Jev et alternatives) — 2026-09-27

**Demande utilisateur** : évaluer l'usage d'un modèle de décision type Jev pour choisir automatiquement le ton de lecture, puis produire un rapport partageable entre sessions.

**Livrable** : `_grimoire-output/planning-artifacts/decision-models-jev-v1.md` (étude, aucune décision prise, points à trancher en §7). Pointeur ajouté dans `_grimoire/_memory/shared-context.md` (section « Organisation du travail »).

**Preuves de lecture du code (état `main` 88384dc)** : `src/narrator/OllamaNarrator.ts` + `narrationContract.ts` (narrateur structuré existant), `src/profiles/defaults.ts` (4 profils livrés), `package.json` (`llmVoice.profiles.bySource` → `claude-code: llm-summary`, narrateur `qwen2.5:7b`), `src/claude/resolveInboxPath.ts` (inbox globale `~/.llm-voice/inbox`), CdC §66/§73 (verrou et file multi-fenêtres non livrés), decisions-log 2026-09-11 (Zéro Docker).

**Mesures locales** : `ollama list` → `qwen2.5:1.5b` et `qwen2.5:3b` présents, `qwen2.5:7b` (modèle narrateur par défaut) **absent** sur la machine dev ; `curl 127.0.0.1:11434/api/version` → `0.21.0`.

**Sources web** : 11 URL consultées le 2026-09-27, listées en §9 du rapport. Chiffres non réexécutés localement (limite déclarée en fin de rapport).

**Aucun fichier sous `vscode-extension/` modifié.**
