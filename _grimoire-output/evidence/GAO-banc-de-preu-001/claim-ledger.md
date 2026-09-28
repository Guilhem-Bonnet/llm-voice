# Agentic Claim Ledger

Une affirmation sans preuve reste une hypothèse. Ce registre relie chaque
affirmation qui pèse sur une décision ou une livraison à ce qui la prouve.

- Task id: GAO-banc-de-preu-001
- Profile: controlled

## Claims

| ID | Affirmation | Type | Source ou preuve | Statut | Confiance | Décision |
|---|---|---|---|---|---|---|
| CL-001 | `pw-record --target` sur le monitor donne un fichier quasi silencieux | fait (repris du brief) | brief utilisateur, méthode déjà prouvée le 2026-09-27 | prouvé | élevée | ne pas utiliser `pw-record` ; utiliser `parecord` |
| CL-002 | `paplay -d $SINK` est rerouté par PipeWire vers un autre sink (`sc_media`) sur cette machine, par nom de processus | fait | `pw-link -l` (aucun lien `paplay -> $SINK`, lien `paplay -> sc_media` présent) ; `pactl list sink-inputs` (`module-stream-restore.id = "sink-input-by-application-name:paplay"`) | prouvé | élevée | remplacer par `pw-play --target $SINK -P '{node.name=…, node.dont-move=true}'` |
| CL-003 | `pw-play --target $SINK -P '{node.name=…, node.dont-move=true}'` reste relié au sink demandé | fait | `pw-link -l` sur un run de 6 s (`llmvoice_*:playback_FL/FR <- llm-voice-audio-proof:output_FL/FR`) | prouvé | élevée | utiliser par défaut dans `prove.sh` |
| CL-004 | Un sink nul au format natif du WAV (fréquence/canaux) réduit le WER par rapport au format par défaut 48 kHz stéréo | résultat mesuré | comparaison directe : WER 0,4444 (48 kHz stéréo forcé) vs WER 0,0–0,1111 (format natif 22050 Hz mono), même phrase, même modèle | prouvé | élevée | créer le sink et lancer `parecord` au format détecté par `soxi` |
| CL-005 | `selftest.sh` distingue de façon stable référence (exit 0) et silence (exit ≠ 0) | résultat mesuré | deux exécutions consécutives de `selftest.sh`, résultats identiques (`reference_exit=0`, `silence_exit=1`) | prouvé | moyenne | deux répétitions seulement ; pas de campagne longue durée |
| CL-006 | Whisper `small` hallucine « Sous-titres réalisés par la communauté d'Amara.org » sur un WAV totalement silencieux | fait observé | sortie brute de `analyze.py` sur le WAV silencieux généré par `sox`, reproduit à chaque essai | prouvé | élevée | la détection de silence (`silence_max_ms`, `rms`) ne dépend pas de cette transcription pour classer le run comme silencieux |
| CL-007 | Le fichier scratchpad `audible-probe.test.ts` fourni par le brief existe et peut être copié tel quel | fait | `ls` du chemin exact donné dans le brief ; fichier lu (65 lignes) avant copie | prouvé | élevée | copié dans `vscode-extension/test/integration-security/`, non exécuté (hors périmètre : nécessite l'Extension Test Host) |
| CL-008 | Seuil WER 0,25 est adapté à ce banc | hypothèse | choix proposé par le brief, validé empiriquement sur une seule phrase de test (marge confortable : 0,0 à 0,11 mesurés contre le seuil 0,25) | hypothèse | moyenne | à revalider sur un corpus de phrases plus large si ce banc devient un gate strict de non-régression |

Types : `fait`, `hypothèse`, `résultat`, `décision`. Statuts : `prouvé`,
`hypothèse`, `contredit`. Confiance : `faible`, `moyenne`, `élevée`. Décision :
`utiliser`, `vérifier`, `rejeter`.

## Synthèse

| Question | Réponse |
|---|---|
| Affirmations bloquantes non prouvées | aucune |
| Contradictions détectées | la méthode manuelle décrite dans le brief (`paplay -d`) ne fonctionne pas telle quelle sur cette machine ; root cause identifiée et corrigée (CL-002, CL-003) |
| Hypothèses acceptées temporairement | CL-008 (seuil WER sur une seule phrase) |
| Preuves à obtenir avant d'en faire un gate strict | campagne multi-phrases et multi-voix pour calibrer le seuil WER ; exécution réelle de la sonde autoplay dans l'Extension Test Host |
