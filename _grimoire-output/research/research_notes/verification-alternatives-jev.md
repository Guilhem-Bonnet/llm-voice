# Fact-check — "Jev" ecosystem claims (as of 2026-09-27)

> Contexte : vérification des affirmations d'une autre session IA sur une famille de modèles
> de "décision typée" (Jev / TypeSafe AI) et ses alternatives. Toutes les recherches ont été
> faites via WebSearch/WebFetch le 2026-09-27.
>
> **Note de prudence** : l'écosystème entier (dizaines de blogs SEO quasi-identiques —
> aiweekly.co, benchmarkheaven.com, jevals.com, scriptbyai.com, ai-tldr.dev, zentor.ai,
> explainx.ai, madewithjev.com, jevlist.ai — et des dizaines de forks GitHub sous des comptes
> utilisateurs sans rapport apparent, tous avec des README identiques mot pour mot pour
> "kev" et "SemIf") a un profil caractéristique de contenu généré/dupliqué en masse (SEO
> farm ou astroturfing). Le contenu existe bel et bien et est indexé, mais sa fiabilité
> éditoriale (chiffres de benchmark, comparatifs) doit être prise avec réserve — ce ne sont
> pas des sources primaires indépendantes au sens classique.

## Table récapitulative

| Nom | Existe ? | Description | URL principale | Licence | Taille | Matériel | Langues | Verdict sur les affirmations |
|---|---|---|---|---|---|---|---|---|
| Jev | OUI | Modèle de décision "System One" (choix/score/oui-non typé) de TypeSafe AI, sorti ~15/09/2026 | https://benchlm.ai/blog/posts/what-is-jev | Propriétaire (API hébergée) | Non communiquée | API cloud | Non précisé | Confirmé |
| JevBench | OUI | Benchmark de modèles "Jev-class" (52 systèmes, 534 décisions typées, 3 niveaux) | https://github.com/fstandhartinger/jevbench (+ miroirs) | Ouvert (repo benchmark) | — | — | — | Confirmé |
| Laya | OUI | Modèle de décision non-autorégressif Convai Innovations, têtes de décision sur backbone ModernBERT/mmBERT | https://huggingface.co/convaiinnovations/laya-multilingual | Apache-2.0 | 322M (multilingue, mmBERT-base) et 421M (ModernBERT-large) — les deux tailles confirmées | CPU possible (build torch CPU-only) + GPU/MLX ; latence ~33ms | 100+ langues annoncées ; testé sur 51 langues MASSIVE avec forte variance (macro acc. 0.366 zero-shot vs ~0.33 hasard) | Globalement confirmé. "Score quasi aléatoire en zero-shot" confirmé sur le benchmark typed-decisions dur ("Near chance ... 0.342"), mais le modèle a un zero-shot exploitable sur d'autres bancs (XNLI 0.731) — donc "near random partout" est une généralisation excessive |
| SemIf | OUI (plusieurs forks/variantes) | Ne possède pas de modèle propre : lit les logits des options déclarées d'un LLM déjà hébergé, en un seul forward pass | https://github.com/mhg337/SemIf-Classifier / https://github.com/ILuce/semif-local | Ouvert (MIT/Apache selon fork) | N/A (pas de poids propres) | CUDA, llama.cpp (CPU, plus lent), MLX confirmés ; WebGPU non confirmé pour SemIf lui-même (WebGPU est documenté pour "Verdict", pas SemIf) | N/A | Partiellement confirmé : zéro-shot et "pas de modèle propre" confirmés ; backends CUDA/llama.cpp/MLX confirmés, WebGPU non confirmé pour SemIf. Le classement "2e derrière Jev sur JevBench" est plausible mais pas confirmé de façon univoque : une source montre SemIf devant Jev sur le tiers "judge" (95.2% vs 94.5%) mais derrière sur le tiers "hard" — le classement composite global n'a pas pu être vérifié précisément |
| Kev | OUI | Famille de modèles de décision "façon Jev" basés sur Qwen, tailles 0.8B/4B/9B/27B | https://github.com/jaredpalmer/kev | Apache-2.0 (+ licence Qwen amont) | 0.8B à 27B confirmé | CUDA, ROCm, MLX (Mac) confirmés ; CPU possible mais lent | Entraîné en anglais uniquement (confirmé, pas de mention multilingue) | Globalement confirmé, avec une nuance : les modèles 0.8B–9B sont basés sur Qwen3.5, mais le 27B est basé sur "Qwen3.8-27B" et non Qwen3.5 — l'affirmation "basé sur Qwen3.5" n'est donc exacte que pour une partie de la gamme. "Offre l'API Jev localement" confirmé ("drop-in for Jev": le SDK TypeSafe fonctionne contre un serveur Kev sans modification) |
| Bespoke Nimble | OUI | LoRA de décision (choix parmi une liste) sur base Qwen3.5-9B | https://huggingface.co/bespokelabs/Bespoke-Nimble-9B | Apache-2.0 | 9B (adaptateur LoRA ~165 MiB) confirmé | **CORRECTION** : PAS "CUDA bf16 uniquement". La fiche modèle documente aussi un chargeur Mac/MLX ("For Mac/MLX and Linux loaders, use the current GitHub quickstart") | Non précisé | Affirmation partiellement FAUSSE : le CUDA bf16 est le chemin principal documenté, mais MLX/Mac est aussi supporté |
| NanoJev | OUI | Réplique "nano" de Jev, backbone Qwen3-0.6B, entraînée sur des jeux (ViZDoom, Maze, Snake) | https://huggingface.co/C-Tianyu/NanoJev | MIT (+ licence Qwen amont) | 0.6B confirmé | CUDA uniquement documenté (`device_name="cuda:0"`), pas de CPU mentionné | N/A | Confirmé pour la taille, le CUDA-only et l'entraînement sur des jeux. Nuance : le dépôt se présente comme une "réplique nano" complète, pas explicitement comme un "prototype" — qualificatif un peu excessif mais pas déraisonnable |
| OpenJev | OUI | Serveur de décision compatible Jev basé sur DiffusionGemma 26B (MoE, 26B total / 4B actifs) | https://github.com/longzhenren/openjev | Apache-2.0 (poids DiffusionGemma NVIDIA/Google) | 26B total (4B actifs) confirmé | ≥24 GB GPU pour le checkpoint NVFP4, testé sur RTX PRO 6000 Blackwell — confirmé | Non précisé | Confirmé pour OpenJev/DiffusionGemma (26B, 24GB GPU) |
| Verdict (openJev-verdict-2.0) | OUI | Encodeur de décision non-autorégressif séparé, 151M paramètres (ModernBERT-base), PAS le même produit qu'OpenJev/DiffusionGemma | https://github.com/Heman10x-NGU/openJev-verdict-2.0 | Apache-2.0 | 149.6M (~151M) confirmé | **CORRECTION** : entraîné sur une GTX 1660 Ti (6 GB VRAM) en 8.8h ; tourne aussi dans le navigateur via WebGPU (~600 MB). **Ne nécessite PAS 24 GB de GPU** — c'est OpenJev/DiffusionGemma (produit distinct) qui a cette exigence | Non précisé | La fusion des deux produits dans la question ("OpenJev 26B, ou Verdict 151M, nécessite 24 Go de GPU") est trompeuse : l'exigence de 24 Go s'applique à OpenJev/DiffusionGemma (26B), PAS à Verdict (151M) qui tourne sur du matériel très modeste |

## Notes détaillées par affirmation

### 8. "SOTAAZ" + "Pinggy"
- **SOTAAZ existe** : blog https://sotaaz.com/post/jev-explained-en — contient bien un constat indépendant qu'un classifieur léger (embeddings de phrases + régression logistique, entraîné sur les exemples labellisés du jeu de données) atteint ~90% d'exactitude en **moins de 10 ms sur CPU**, battant Laya (421M) sur une tâche à **6 options** (TREC) et une autre à 77 options.
  - Écart avec la question posée : la démonstration porte sur des tâches à **6 et 77 options**, pas spécifiquement "3-4 options". Le chiffre "6 ms" évoqué dans la question correspond plutôt à un autre résultat cité ailleurs (MiniLM + régression logistique, 6.8 ms médian) — proche mais pas identique au libellé "sous 10 ms" de SOTAAZ.
- **Pinggy** existe bien comme source (https://pinggy.io/blog/best_open_source_jev_alternatives_self_hosted_decision_models/), mais c'est un article de liste "meilleures alternatives Jev open source" d'un service de tunneling — **il ne contient pas** la démonstration du classifieur à embeddings battant les modèles de décision. Le classement cité par Pinggy dans nos recherches va même dans le sens inverse pour un autre benchmark ("jabr classifier benchmark") où Jev hébergé (0.966) bat largement les alternatives ouvertes (Von 0.704, GLiNER2 0.698, Laya 0.583).
  - **Correction** : Pinggy n'est pas la source de la démonstration SOTAAZ ; associer les deux dans une même phrase est trompeur.

### 9. "Ollama n'expose pas les logits/logprobs"
- **Affirmation FAUSSE / DÉPASSÉE en 2026.** L'API native d'Ollama (`/api/generate`) calcule et retourne bien des logprobs (champs `Logprobs` / `TopLogprobs` documentés dans le package Go `github.com/ollama/ollama/api` — https://pkg.go.dev/github.com/ollama/ollama/api).
- La limite réelle et actuelle concerne uniquement **la couche de compatibilité OpenAI** (`/v1/chat/completions`), qui ignore silencieusement les champs `logprobs`/`top_logprobs` de la requête — cf. issue GitHub fermée "not planned" : https://github.com/ollama/ollama/issues/16117
- **Correction à apporter** : dire "Ollama n'expose pas les logprobs" sans préciser est incorrect depuis l'ajout du support natif ; c'est seulement l'endpoint OpenAI-compatible qui ne les relaie pas.

## Deux corrections les plus importantes

1. **La confusion OpenJev (26B, DiffusionGemma, nécessite bien 24 Go de GPU) / Verdict (151M, tourne sur GPU 6 Go ou même dans le navigateur via WebGPU, ne nécessite PAS 24 Go)** — ce sont deux produits distincts et la contrainte "24 Go" ne s'applique qu'au premier.
2. **"Ollama n'expose pas les logprobs" est faux en l'état** : l'API native les expose depuis plusieurs versions ; seule la couche de compatibilité OpenAI (`/v1/chat/completions`) ne les relaie pas encore (issue #16117, fermée "not planned").

Corrections secondaires : Bespoke Nimble supporte aussi MLX/Mac (pas "CUDA bf16 uniquement") ; Kev-27B est basé sur Qwen3.8 et non Qwen3.5 ; le classement "SemIf 2e sur JevBench" n'est confirmé que par tiers (judge) et pas en composite global ; Pinggy n'est pas la source du benchmark SOTAAZ.
