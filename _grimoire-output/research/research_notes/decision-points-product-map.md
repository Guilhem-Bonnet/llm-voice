# Cartographie des points de décision « typée » (choix fermé + probabilités) au-delà du mode Auto

> Produit le 2026-09-27 par un sous-agent Explore (Sonnet, lecture seule) sur `main` à 88384dc ; fichier
> écrit par la session concierge à partir de son retour. Complète `decision-points-code-map.md` (points
> d'insertion du mode Auto). Contexte : `decision-models-jev-v1.md` §10 (SemIf sur Ollama retenu).

## a. Langue du texte avant synthèse

**Aujourd'hui** : `language` est un champ **statique du profil** (`fr-FR` par défaut,
`vscode-extension/src/core/profile.ts:93-94`), fixé une fois pour toutes et propagé tel quel, sans
jamais être recalculé à partir du contenu réel :
- `SentenceSplitter` est **langue-agnostique** : les deux listes d'abréviations FR et EN sont actives
  simultanément (`vscode-extension/src/parser/SentenceSplitter.ts:156-157`, commentaire : « a document can
  freely mix languages… ») — pas de détection, choix délibéré d'ignorer le problème à ce niveau.
- `Segmenter.segmentationPolicyFor` copie `profile.language` dans `lang`
  (`vscode-extension/src/pipeline/Pipeline.ts:219`), utilisé par `normalize()`
  (`SpokenTextNormalizer.ts:27`, `isFrench(lang)` → phrasing FR/EN de surface uniquement).
- `NarrationRequest.language` = `profile.language`, un seul champ pour tout le groupe narré
  (`vscode-extension/src/playback/SessionFactory.ts:202`).
- Chaque chunk TTS reçoit `this.binding.language` (jamais recalculé) — `vscode-extension/src/playback/AudioQueue.ts:555-556`.
- `ChatterboxProvider.normalizeLanguage` réduit le tag à 2 lettres et l'envoie à `/tts`
  (`vscode-extension/src/tts/ChatterboxProvider.ts:110-111,273`) ; le endpoint compatible OpenAI **ignore**
  ce champ (`shared-context.md:106-120`), l'accent réel dépend surtout de la voix/référence de clonage.
- `SystemTtsProvider.primarySubtag(ctx.language)` retombe sur la 1ère sous-étiquette BCP-47
  (`vscode-extension/src/tts/SystemTtsProvider.ts:196-200`) pour choisir la voix espeak-ng/say/SAPI.
- `isEnglishVoice` (`vscode-extension/src/profiles/voiceBrowser.ts:28-40`) compare le tag de la voix au tag
  du profil, repli regex `/\ben(glish)?\b/i` sur le libellé — avertissement UI au choix de voix, pas une
  correction automatique.

**CdC** : aucune section ne prévoit de détection de langue par document/segment ; §18/§49 traitent
`Language` comme un champ de profil.

**Bug utilisateur « langue non définie après changement de profil ou de voix »** : cité dans
`_grimoire-output/evidence/GAO-diagnostic-s-001/task-envelope.md`, mais l'evidence-pack documente le son
absent et le surlignage, pas la langue. Aucune mutation de `profile.language` (`grep "\.language\s*="`)
n'existe : le champ est fixé à la création/édition du profil. Hypothèse la plus probable, **non vérifiée** :
profil édité sans `language` explicite retombant sur un défaut incohérent avec la voix choisie — à vérifier
par un autre agent avant d'attribuer la cause.

**Valeur d'une décision typée** : **oui, plausible** — pas pour réparer le bug (une règle suffit), mais pour
le cas non couvert : un document qui mélange FR/EN reçoit un seul tag. Options : `{fr, en, mixed}` **par
document** (un seul appel) ; par segment trop coûteux (~500 ms × N).

## b. Politique Markdown pour les blocs de code

**Aujourd'hui** : réglage **statique par profil**, un seul mode `code` pour tout le document
(`skip | read | explain | summarize`, `vscode-extension/src/core/profile.schema.ts:36`, CdC §13).
`Segmenter.segmentBlock` l'applique tel quel : `explain`/`summarize` ne produisent **aucun texte** à ce
niveau (`spokenText = ""`, `vscode-extension/src/parser/Segmenter.ts:188-192`) ; le « explain » de CdC §13
dépend entièrement du `NarratorProvider` qui reçoit le `rawText` du bloc dans le groupe narré
(`SessionFactory.narrateGroup`, `vscode-extension/src/playback/SessionFactory.ts:180-200`).

**Valeur** : **non/maybe** — le travail sémantique est déjà délégué au narrateur complet. Seul cas concret :
un profil `faithful` avec `code: "explain"` produit un blanc silencieux (`spokenText: ""`, jamais remplacé
sans narrateur) — bug de config plus qu'un besoin de décision.

## c. Triage de l'Inbox (bruit vs signal)

**Aujourd'hui** : **aucun tri, aucune priorité, aucun scoring.** `InboxRepository.scan()` ne filtre que la
validité technique — JSON invalide, schéma inconnu, message vide
(`vscode-extension/src/claude/InboxRepository.ts:154-170`) — puis trie par `capturedAt` décroissant
(`InboxRepository.ts:184`). `InboxTreeProvider.getChildren()` retourne tous les messages valides
(`vscode-extension/src/claude/InboxTreeProvider.ts:50-52`), seul un badge lu/non lu existe (`entry.read`).
`ClaudeInboxSource` et `inboxFormat.ts` ne font que du formatage.

**CdC** : §42 liste plate chronologique ; §43 résumé au clic ; §44 « Audio = silence » quand 4 projets
terminent en même temps — ni priorité ni badge de type au-delà de lu/non lu.

**Valeur** : **oui, la plus solide du lot**. Aucune règle simple en concurrence, signal réellement ambigu
(une réponse d'une ligne peut être « rien à faire » ou « question critique »), volume qui justifie un tri.
Options : `{needs-attention, routine-done, noise}` ou `{question-for-user, error-reported, completed-clean,
tool-noise}`. Contrainte : la décision sert à **trier/badger**, jamais à déclencher la lecture (CdC §44).

## d. Mode de segmentation (phrase vs paragraphe)

**Aujourd'hui** : statique par profil (`chunking.unit: "sentence" | "block"`, `defaults.ts:57,72,90,107`) ;
`Segmenter.segmentBlock` bascule sur `policy.mode === "block"` (`Segmenter.ts:212-219`) ; le type de bloc
Markdown a déjà son traitement dédié. CdC §14/§33 : compromis par **profil**.

**Valeur** : **non** — le type structurel est connu à coup sûr par le parseur ; une règle suffit.

## e. Vitesse / pauses par type de contenu

**Aujourd'hui** : `playback.rate` un seul nombre par profil (`defaults.ts:58,73,91,108`) ; aucune logique
conditionnelle à `SourceSegment.type` dans `src/playback/`. CdC §33 : vitesse par provider.

**Valeur** : **non** — mapping déterministe (`heading → pause`, `table → -10 %`), pas un choix probabiliste.

## f. Avertissements de sélection de voix

**Aujourd'hui** : `isEnglishVoice` (`voiceBrowser.ts:10-40`), « best-effort », asymétrique (ne fait jamais
taire un avertissement, ligne 37-38), un seul cas cible (28 voix Chatterbox anglophones).

**Valeur** : **non** — remplacer une regex correcte par un appel de 100-500 ms serait une régression.

## g. Repli du narrateur (sauter la réécriture LLM)

**Aujourd'hui** : binaire et statique, par `profile.mode` uniquement
(`Pipeline.ts:576-578` : `profile.mode === "narrated" && !this.narrationDisabledForSession`). `NoNarrator`
et `faithfulSegment` (`narrator/shared.ts:12-19`) gèrent le repli **en cas d'échec** (ADR-005), pas a priori.
`narrationDisabledForSession` est un choix utilisateur (« Read without narration », CdC §52, `Pipeline.ts:342-348`).

**Valeur** : **maybe** — « Done, all tests pass. » en narration coûte un aller-retour LLM pour rien, mais
une **règle de longueur** couvre 90 % du gain pour un coût nul.

## h. Arbitrage multi-fenêtres

**Aujourd'hui** : non implémenté (`grep player.lock` → 0). Zéro autoplay rend tout conflit impossible.
CdC §66 : verrou `~/.llm-voice/player.lock`, §65 `maxConcurrentTtsJobs = 1`, §73 queue globale en 0.3.

**Valeur** : **non** — mutuelle exclusion, pas un choix ambigu.

## i. Gestion des erreurs (retry / skip / stop)

**Aujourd'hui** : `AudioQueue` backoff exponentiel + gigue, `DEFAULT_MAX_RETRIES = 2`
(`AudioQueue.ts:128,192-194,474-475`) ; `PlaybackController` délègue à `onChunkError` typé
`"skip" | "stop"` (`PlaybackController.ts:73-74`, défaut `"skip"` ligne 140) ; l'utilisateur choisit via
`retryCurrentChunk()` (`:302-310`, CdC §52).

**Valeur** : **non** — choix utilisateur explicite par design.

## j. TODO/FIXME/heuristique/guess/threshold dans `src/`

`grep TODO|FIXME|XXX` → **0 résultat**. 12 occurrences de « guess » décrivent toutes l'absence de
supposition (`audioValidation.ts:31`, `inbox.ts:19`, `tts.ts:33`, `presets.ts:17`). Seule heuristique
assumée : `isEnglishVoice` (point f). Aucune dette de jugement cachée.

## Classement final (valeur × facilité)

| # | Point de décision | Valeur | Facilité | Verdict |
|---|---|---|---|---|
| c | Triage Inbox (bruit vs signal, attention requise) | **Haute** | Haute — même contrat que le mode Auto, lit déjà l'entrée | **1 — meilleur candidat** |
| a | Langue du document (fr/en/mixed) avant synthèse | Moyenne-haute | Moyenne — par document, branché sur `profile.language` | **2** |
| g | Repli narrateur sur texte trivial | Faible-moyenne | Haute | 3, **une règle suffit probablement** |
| b | Explication de bloc de code | Faible | Moyenne | Non prioritaire |
| d | Segmentation par type de contenu | Nulle | — | Refuser |
| e | Vitesse/pauses par type | Nulle | — | Refuser |
| f | Avertissement voix anglophone | Nulle | — | Refuser |
| h | Arbitrage multi-fenêtres | Nulle | — | Refuser (verrou, CdC §66) |
| i | Retry/Skip/Stop | Nulle | — | Refuser (CdC §52) |
| j | Dette de jugement cachée | Sans objet | — | Rien à faire |
