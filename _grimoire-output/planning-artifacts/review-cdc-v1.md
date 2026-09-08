# Review critique — Cahier des charges LLM Voice (v1.0, 8 sept. 2026)

**Auteur** : Archie (platform-architect) — review non-interactive
**Source** : `/mnt/Travail/Projets/Dev/TTS-Voice/cahier-des-charges.md`

---

## 1. Verdict global

Document mature et bien structuré (contrats TS, interfaces provider-agnostic, ADR-like §85, AC testables §82), mais deux zones critiques restent non tranchées : le split UI/Workspace (audio local vs contenu distant, §56) et le protocole concret Webview↔Extension Host pour le player. Le scope MVP (§71) est trop large pour un premier slice vertical de 2 semaines — narration LLM, profils multiples, cache et Claude Inbox robuste sont empilés dans un seul lot P0.

| Axe | Score /10 | Justification courte |
|---|---|---|
| Fonctionnel | 8 | UC priorisés (§5), AC clairs (§82), périmètres versionnés (§71-74) |
| Architecture | 6 | Interfaces propres (§10, §20, §23) mais split UI/workspace non résolu (§56) |
| UX | 6 | Wireframes texte détaillés (§6-9, §49) mais protocole player audio absent |
| Testabilité | 5 | Bonne base tests (§76-82) mais critères en langage flou (« immédiatement », « proprement ») |
| Faisabilité MVP 2 sem. | 5 | §71 cumule narration + profils + inbox + highlight + cache en un seul lot |

---

## 2. Points forts

- Séparation Narration (ce qui est dit) / TTS (comment c'est prononcé) explicitée dès §4 et réappliquée partout (profils §18, interfaces §20/§23).
- Interdiction stricte d'autoplay formulée comme P0 avec diagramme (§3.1) et AC dédiés (AC-13, AC-14, §44).
- Contrats TypeScript précis pour les entités clés : `SourceSegment` (§14), `NarrationSegment` (§61), `AudioChunk` (§30), `PlaybackSession` (§31).
- Stratégie provider-agnostic cohérente (§3.3) avec cible API standardisée `/v1/audio/speech` (§28) réduisant le couplage à Chatterbox.
- Génération progressive avec prefetch documentée avec paramètre configurable (§32-33).
- Critères d'acceptation MVP énumérés et numérotés (AC-01 à AC-17, §82), base solide pour un plan de test.
- Anticipation confidentialité/télémétrie dès la conception (§53-54, §80 test réseau localhost).

---

## 3. Incohérences / contradictions internes

1. **extensionKind ui/workspace vs accès fichiers local (§56)** — Le CDC recommande `"extensionKind": ["ui", "workspace"]` avec « préférence UI à étudier ». Or §56 §1 affirme que le TTS « doit généralement fonctionner sur la machine utilisateur » (GPU, haut-parleurs, Ollama/Chatterbox locaux). Si VS Code retombe sur le mode `workspace` (cas Remote/Codespaces), l'Extension Host tourne côté distant et perd l'accès aux ressources audio locales — contredit directement l'exigence local-first (§3.2) sans que le document tranche explicitement pour le MVP.

2. **Webview player vs « Tree Views doivent être privilégiées » (§6 vs §9/§85)** — §6 pose comme règle générale que les Tree Views sont à privilégier « lorsque des composants natifs suffisent ». §9 justifie une Webview pour le player, et §85 fige la décision (« Player : Webview légère »). L'exception est motivée (contrôles audio HTML) mais la règle générale n'est jamais formellement révisée ; aucun critère explicite ne dit pourquoi une Tree View + Status Bar ne suffiraient pas.

3. **Format WAV interne vs streaming audio (§9 vs §25, §32, §63, §72)** — §9 fixe « Format interne recommandé MVP : WAV » (fichier complet par chunk, cf. `AudioChunk.audioUri`, §30). §25 vante le serveur communautaire Chatterbox pour son support de « streaming audio », et §63/§32 exigent que la lecture démarre dès le premier chunk disponible. Le document ne précise jamais si le « streaming » désigné est (a) un vrai flux d'octets partiel exploité par LLM Voice, ou (b) une pseudo-lecture progressive par enchaînement de petits fichiers WAV complets — deux architectures très différentes. §72 relance la confusion en listant « streaming amélioré » comme feature de la v0.2, sans définir la baseline v0.1.

4. **Inbox globale `~/.llm-voice/inbox` vs `globalStorageUri` (§38 vs §41)** — §38 assigne à `globalStorageUri` le rôle d'« index inbox » et de métadonnées, tandis que §41 place les fichiers Inbox eux-mêmes dans `~/.llm-voice/inbox/`, un répertoire écrit par un processus externe (script Python/bash du hook Claude, §39, hors sandbox VS Code). La relation entre les deux emplacements (source de vérité vs index secondaire, synchronisation, watch de fichiers) n'est pas définie.

5. **UC-05 highlight P0 vs Remote non garanti (§5 vs §56)** — UC-05 (highlight, P0) et AC-02/AC-03 (§82) sont des critères d'acceptation MVP obligatoires, mais §56 déclare le fonctionnement en Remote Development « non garanti dans le MVP ». Ce n'est pas strictement contradictoire (la plateforme prioritaire est Linux Desktop, page de garde) mais le document ne précise jamais explicitement si les AC de highlight sont exemptées de validation en contexte Remote — zone grise qui devrait être un critère de scope explicite plutôt qu'implicite.

6. **« Aucun framework frontend lourd » vs Profile Editor riche (§57 vs §49-50)** — §57 dit littéralement « Aucun framework frontend lourd n'est nécessaire pour le MVP » (nuance : lourd, pas zéro framework). Mais §49-50 décrivent un Profile Editor avec dropdowns, sliders bidirectionnels, bouton « Test Voice » avec lecture audio immédiate — une UI interactive non triviale en HTML/JS vanilla dans une Webview. Le choix technique (vanilla DOM vs micro-lib type lit-html/Preact) n'est jamais tranché, alors que §72 reporte le « Profile editor complet » en v0.2, suggérant que sa version MVP (nécessaire pour UC-06/UC-07 P0) reste non spécifiée.

7. **Copilot P2 « dépend API » (UC-17) vs sourceType "copilot" dans le contrat interne (§60)** — `SourceDocument.sourceType` inclut la valeur `"copilot"` (§60) comme si un adaptateur Copilot dédié existait, alors que §10.5 et §45 précisent que le MVP Copilot n'est qu'un alias de `SelectionSource`/`ClipboardSource`, sans captation propre. Le contrat de données anticipe donc une fonctionnalité classée P2/« dépend API » (UC-17) et jamais confirmée.

---

## 4. Manques / zones floues bloquantes pour un dev

1. Protocole exact Webview ↔ Extension Host pour l'audio : quels messages `postMessage` (play/pause/seek/ended/timeupdate), comment la durée et la position sont remontées pour piloter le highlight (§9, §30, §32) — absent.
2. Comportement multi-éditeurs/onglets : si le `sourceUri` ciblé par le highlight n'est ouvert dans aucun `TextEditor` visible, doit-on l'ouvrir automatiquement, ignorer le highlight, ou échouer (§15, §17) — non traité.
3. Invalidation des `sourceRange`/segments si le document est édité pendant la lecture active — aucune règle de undo/freeze/re-parse n'est définie (§14-17, §61).
4. Mécanisme d'installation/désinstallation du hook Claude Code (`ClaudeHookInstaller.ts`, §58) : modification de `settings.json` de Claude Code, gestion de conflit avec un hook `Stop` déjà présent, rollback — non spécifié.
5. Versioning/migration des profils utilisateur stockés (schéma, migration lors d'une mise à jour d'extension) — seul `schemaVersion` est mentionné pour l'Inbox (§40), pas pour les profils (§18-19, §47).
6. i18n de l'interface de l'extension elle-même (menus, Webviews, messages d'erreur) — seule la langue de la voix/narration est traitée (§18 `language`).
7. Licence/droits des voix prédéfinies livrées par défaut avec Chatterbox — seul le voice cloning utilisateur est encadré par un avertissement de consentement (§55).
8. Mécanique de cancellation HTTP concrète (AbortController, timeout, propagation à travers Narrator → TTS → Queue) — §62 énonce le principe sans contrat d'implémentation.
9. Lecture séquentielle de plusieurs fichiers WAV distincts dans un même `<audio>` Webview (gapless playback ?) — non spécifié malgré le découpage en petits chunks recommandé pour la lecture fidèle (§33).
10. Gestion des timeouts/retries réseau localhost pour Ollama/Chatterbox non reliée à un AC testable (§51-52 restent descriptifs, pas de seuil chiffré).

---

## 5. Risques techniques (probabilité × impact)

| Risque | Prob. | Impact | Mitigation (1 ligne) |
|---|---|---|---|
| Split UI/Workspace non tranché casse l'audio local en Remote/Codespaces (§56) | Moyenne | Élevé | Forcer `extensionKind: ["ui"]` seul pour 0.1 et documenter l'absence de support Remote au lieu de laisser un fallback silencieux |
| Contention GPU multi-fenêtres VS Code (chaque instance a sa propre queue `maxConcurrentTtsJobs=1`, §65-66) | Moyenne | Moyen | Avancer le verrou inter-processus `player.lock` (prévu V2, §66) en garde-fou dès 0.1, même minimal |
| Audio haché par enchaînement de petits WAV séparés (chunking fin, §33) | Élevée | Moyen | Prototyper tôt le gapless playback (Web Audio API / buffering côté Webview) avant de figer WAV comme format interne |
| Highlight désynchronisé si le document est édité pendant la lecture (gap §3 du présent doc) | Moyenne | Moyen | Détecter tout `onDidChangeTextDocument` sur le doc actif et invalider/stopper la session en cours |
| Corruption/concurrence sur l'Inbox écrite par script externe multi-instances Claude (§39-44, §79) | Moyenne | Moyen | Écriture atomique (fichier temp + rename) systématique côté collector, déjà testable via §79 |
| Scope creep MVP : narration + profils + inbox + cache + highlight en un seul lot 2 semaines (§71) | Élevée | Élevé | Voir découpage §7 ci-dessous |
| Messages d'erreur (§52) et santé provider (§51) décrits en prose sans contrat UI précis | Faible-Moyenne | Faible | Spécifier les `showErrorMessage`/`showWarningMessage` exacts dans un futur Profile/Error catalog |

---

## 6. Exigences non testables → reformulation testable

- §63 « L'interface doit réagir immédiatement au clic » → *« Le délai entre le clic sur une commande Speak/Play/Pause/Stop et le changement d'état visible (UI + Status Bar) doit être ≤ 150 ms sur la machine de référence, mesuré par test d'intégration `@vscode/test-electron`. »*
- §63 « La lecture doit commencer dès que le premier chunk est disponible » → *« Le délai entre `Speak Document` et le début effectif de l'audio doit être ≤ N s pour un premier chunk de ≤ 3 phrases, avec `FakeTtsProvider` en CI et provider réel en test manuel documenté. »*
- AC-02 (§82) « La portion actuellement prononcée est visuellement identifiable » → *« Un test d'intégration vérifie qu'une `TextEditorDecorationType` est appliquée sur le `Range` correspondant au `sourceRange` du chunk dont `status === "playing"`. »*
- AC-16 (§82) « L'indisponibilité d'Ollama ou Chatterbox est signalée proprement sans crash » → *« Un test simule `health()` en échec et vérifie qu'un `showErrorMessage` apparaît, qu'aucune exception non capturée n'atteint l'Extension Host, et qu'une entrée `error` est écrite dans l'Output Channel. »*
- §36 « Stop doit arrêter immédiatement l'audio » → *« Le délai entre l'appel de la commande Stop et l'arrêt effectif du flux audio (état `stopped` du `PlaybackSession`) doit être ≤ 100 ms, vérifié par test d'intégration. »*
- §54 « telemetry = OFF par défaut » → *« Un test réseau mocké vérifie qu'aucune requête HTTP sortante n'est émise vers un domaine de télémétrie pendant une session complète Speak→Play→Stop, en plus de la règle localhost déjà couverte par §80. »*

---

## 7. Recommandations de découpage MVP (slice vertical ~2 semaines)

À sortir du 0.1 (§71) et reporter :

- **Narration LLM (Ollama)** — livrer d'abord la « Lecture fidèle » sans transformation ; le pipeline Narrator ajoute une dépendance externe et un contrat JSON Schema (§21) non nécessaires pour valider le cœur audio/highlight.
- **Gestion complète des profils / Profile Editor Webview (§49-50)** — remplacer par un seul profil « Lecture fidèle » codé en dur + réglages basiques via `contributes.configuration`, pas de CRUD ni d'éditeur riche.
- **Claude Inbox multi-source robuste (§39-44)** — garder uniquement une commande manuelle « Speak Latest Claude Response » avec capture minimale d'un seul projet ; différer la robustesse multi-instance/concurrence (§79) à un lot 0.1.1.
- **Cache audio (§37)** — optimisation prématurée avant que le pipeline segment→TTS→audio soit stable ; risque de masquer des bugs de state machine.

À garder comme cœur du slice vertical : `MarkdownSource` (document complet) → `Segmenter` (phrase/bloc) → `FakeTtsProvider`/`ChatterboxProvider` minimal → `AudioQueue` avec prefetch simple → Player Webview minimal (Play/Pause/Stop) → `HighlightController`. Cela couvre AC-01 à AC-06, AC-11 (partiellement) et pose les fondations testables avant d'empiler narration/profils/inbox.

---

## 8. Questions ouvertes à poser à l'utilisateur

**P0**

1. Confirme-t-on `extensionKind: ["ui"]` seul pour le MVP (abandon volontaire du support Remote/Workspace en 0.1) ? (réf §56, incohérence #1)
2. Le « streaming audio » mentionné pour Chatterbox-TTS-Server (§25) doit-il être exploité dès le MVP (flux progressif intra-chunk), ou le MVP reste-t-il sur des fichiers WAV complets par chunk (§9, §30) ? (incohérence #3)
3. Quelle est la source de vérité pour l'Inbox : le répertoire `~/.llm-voice/inbox` (§41) ou l'index dans `globalStorageUri` (§38) ? Faut-il les synchroniser ou en éliminer un ? (incohérence #4)
4. Quel protocole exact Webview ↔ Extension Host pilote l'audio (postMessage, événements, seek) ? (manque #1)

**P1**

5. Le Profile Editor doit-il être livré en 0.1 (requis implicitement par UC-06/UC-07 P0) ou explicitement reporté en 0.2 comme le suggère §72 ? (incohérence #6)
6. Quel comportement attendu si le document source est édité pendant une lecture active (freeze, invalidation, ignore) ? (manque #3)
7. Comment le hook Claude Code est-il installé/désinstallé côté utilisateur (édition automatique de `settings.json`, script manuel, CLI) ? (manque #4)
8. Le `sourceType: "copilot"` (§60) désigne-t-il un adaptateur réellement distinct à développer, ou doit-il être retiré du contrat MVP au profit d'un simple alias Selection/Clipboard ? (incohérence #7)
