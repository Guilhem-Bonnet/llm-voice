# Agentic Claim Ledger

- Task id: GAO-spike-moteur-001
- Profile: controlled

## Claims

| ID | Affirmation | Type | Source ou preuve | Statut | Confiance | Décision |
|---|---|---|---|---|---|---|
| CL-001 | Les deux moteurs produisent un son intelligible sur le banc | résultat | `mesures/*.prove.json`, `prove.sh` exit 0 ×4 | prouvé | élevée | utiliser |
| CL-002 | Rust rapporte une position finale exacte (8 707 ms = durée de référence) | résultat | `measure.sh`, sortie `last_position_ms` | prouvé | élevée | utiliser |
| CL-003 | Rust reprend exactement à la position de pause ; mpv dérive de 80 ms | résultat | `measure.sh`, `pause_position_ms` / `resume_position_ms` | prouvé | moyenne (une seule mesure) | utiliser |
| CL-004 | Le dernier mot tronqué vient de la fenêtre de capture du banc | hypothèse | **contredite** (2026-09-28) : `prove.sh reference.wav` en lecture directe transcrit la phrase entière (WER 0,038, « …et la reprise. ») avec la marge par défaut de 1 s. Cause réelle : les enveloppes de lecture Rust et mpv rendent la main avant la vidange du tampon audio | contredit | élevée | rejeter ; exigence pour le Core : l'événement `ended` part après vidange du périphérique |
| CL-005 | Lecture sans blanc à la jonction | hypothèse | silence max mesuré inclut pré-roll et silences Piper | hypothèse | faible | vérifier (tonalités, carte AudioSink v2) |
| CL-006 | Crate et dépendances sous licences compatibles MIT | fait | `Cargo.toml` : cpal, hound Apache-2.0 ; thiserror MIT/Apache-2.0 | prouvé | élevée | utiliser |

## Synthèse

| Question | Réponse |
|---|---|
| Affirmations bloquantes non prouvées | aucune pour la recommandation ; CL-005 reste à prouver avant la carte Core |
| Contradictions détectées | aucune |
| Hypothèses acceptées temporairement | CL-004, CL-005 |
| Preuves à obtenir avant livraison | jonction mesurée sur tonalités ; banc avec marge de fin |
