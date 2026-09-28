# Modèles de décision (Jev et alternatives) pour LLM Voice — étude v1

> Rédigé le 2026-09-27 par la session concierge (Fable) à la demande de guilhem-bonnet,
> sous la tâche `GAO-diagnostic-s-001`. Étude d'opportunité, **aucune décision prise** :
> les points à trancher sont listés en §7. Sources web consultées le 2026-09-27, listées en §9.
> Statut : à lire avant toute carte du Mission Ledger touchant au « mode Auto » ou aux modèles de décision.

## 1. Question posée

Faut-il utiliser un modèle de décision de type Jev dans LLM Voice, et lequel ?
L'usage visé par l'utilisateur : choisir automatiquement le **ton / la manière de lire**
une réponse Claude (résumer, lire de bout en bout, réviser, etc.) via une option « Auto »
visible et modifiable en un clic. Question annexe : éviter que plusieurs fenêtres VS Code
lisent en même temps quand plusieurs projets reçoivent une réponse Claude.

## 2. Ce que le projet fait déjà (état du code au 2026-09-27, `main` à 88384dc)

| Besoin exprimé | Déjà en place | Où |
|---|---|---|
| Transformer le texte avant lecture (résumé, explication) | Narrateur LLM optionnel via Ollama, sorties structurées JSON Schema, repli fidèle si indisponible | `vscode-extension/src/narrator/OllamaNarrator.ts`, `narrationContract.ts` |
| Choisir le ton | Profils, pas du code : `system-voice`, `technical-teacher`, `llm-summary`, `quick-review` | `vscode-extension/src/profiles/defaults.ts`, CdC §3.4, §19 |
| Profil par défaut pour les réponses Claude | `llmVoice.profiles.bySource` → `claude-code: llm-summary` | `vscode-extension/package.json` |
| Canal unique multi-projets | Inbox globale `~/.llm-voice/inbox`, écrite par le hook Stop, lue par toutes les fenêtres | ADR-003/004, `src/claude/` |
| Éviter les lectures simultanées | **Invariant P0 n°1 : zéro autoplay.** Rien ne se lance sans action utilisateur, donc aucun conflit audio aujourd'hui | `shared-context.md`, CdC §66 |
| File globale entre fenêtres | Prévu, pas livré : verrou `~/.llm-voice/player.lock` (CdC §66), « queue globale multi-window » en 0.3 (CdC §73) | — |
| Modèle par défaut du narrateur | `qwen2.5:7b`, **absent de la machine dev** (`ollama list` du 2026-09-27 : `qwen2.5:3b`, `qwen2.5:1.5b`, `gpt-oss:20b` présents) — le narrateur y tourne donc en mode dégradé tant que le modèle n'est pas tiré | `ollama list` |

Conséquences :

- Un modèle de décision **ne remplace pas le narrateur** : il ne génère pas de texte. Il ne fait que
  choisir le profil ; la reformulation reste au narrateur.
- Ce qui manque réellement est (a) un pseudo-profil **« Auto »** qui délègue le choix à un fournisseur
  de décision, et (b) si la lecture automatique est un jour activée, la file globale de CdC §66/§73.
- L'idée d'un conteneur Docker unique commun à tous les projets est **contraire à la décision du
  2026-09-11** (« Zéro Docker : la voie par défaut doit être autonome »). Les services lourds (Ollama, TTS)
  sont déjà partagés entre fenêtres puisqu'ils écoutent en localhost ; seul l'arbitrage de lecture est par
  fenêtre. Un verrou fichier + file dans `~/.llm-voice` suffit, au pire un petit démon Node.

## 3. Jev (TypeSafe AI) — fiche

- Sorti le 2026-09-15, accès anticipé limité. **Propriétaire, API cloud uniquement, clé requise.**
  Aucun poids téléchargeable, aucune fiche technique.
- Entrée : un état textuel + des questions typées. Sortie : jamais de texte, uniquement des valeurs
  typées avec probabilités. Trois primitives : **choice** (option + distribution), **score** (niveau
  sur une échelle + distribution), **noul** (oui/non, P(vrai) ∈ [0,1]).
- Latence annoncée 70–500 ms. Prix : 0,042 $/M tokens en entrée, sortie gratuite.
  Une réponse Claude de 2 000 tokens coûte une fraction de centime.
- Réserves des observateurs : aucune validation indépendante, boîte noire, faible sur nombres et dates,
  sensible au contenu adversarial.
- **Conflit avec l'invariant P0 n°2 (local-first)** : pour décider, Jev doit recevoir le texte de la
  réponse Claude, qui quitte donc la machine. Utilisable seulement derrière `privacy.localOnly = false`,
  hôte de confiance, clé dans `SecretStorage`, badge ☁ — jamais par défaut.

## 4. Alternatives ouvertes — comparatif

Contraintes d'évaluation propres au projet : local-first, zéro Docker par défaut, **français
obligatoire**, GPU non garanti chez l'utilisateur, machine dev en **ROCm (AMD RDNA4), pas CUDA**,
extension TypeScript/Node sans Python (Piper est un binaire natif).

| Modèle | Taille / base | Licence | Exécution | Français | Qualité mesurée | Verdict projet |
|---|---|---|---|---|---|---|
| **Laya** (Convai Innovations) | 322M mmBERT multilingue, ou 421M ModernBERT-large | Apache-2.0 | `pip install laya`, serveur FastAPI `laya-serve` ; CPU ok (66 ms sur M3 Pro, 23–33 ms GPU) ; contexte 512–1024 tokens | 100+ langues | Zéro-shot **quasi aléatoire** (~0,35) ; 0,77–0,95 après fine-tuning selon jeu ; se dégrade au-delà de 20 options | **Meilleur fit**, à condition de fine-tuner. Dépendance Python |
| **SemIf** (ex-OpenJev) | aucun modèle propre : lit les logits d'un modèle ouvert déjà hébergé (réf. Qwen3.5-4B) | MIT | llama.cpp, MLX, MPS, WebGPU ; **pas Ollama** (pas de logits exposés) | via le modèle sous-jacent | n°2 composite JevBench (73,1 vs 74,4 pour Jev) ; 0,845 d'accord modal avec Jev | **Second**. Zéro entraînement, mais impose un narrateur llama.cpp (CdC §22, non livré) |
| **Kev** (jaredpalmer) | 0,8B / 4B / 9B (Qwen3.5 + LoRA) / 27B | Apache-2.0 | serveur HTTP `kev.serve`, `/v1/systemone`, **API filaire identique à Jev** ; CUDA, ROCm, MLX Mac | entraîné en anglais, multilingue non documenté | 0,817 (4B) à 0,848 (27B) vs Jev 0,857 ; MMLU 0,74 vs 0,90 | Bon si l'on veut un chemin de code unique Jev cloud / Kev local. GPU + Python |
| **Bespoke Nimble** | adaptateur 165 Mio sur Qwen3.5-9B | Apache-2.0 | Python, **CUDA bf16 uniquement** | non documenté | 0,90 vs 0,93 Jev sur jeu interne | **Écarté** : trop lourd, incompatible ROCm |
| **NanoJev** | 0,6B Qwen3 | MIT | script Python, **CUDA uniquement** | non documenté | 18–31 % sur TREC/AG News/Banking77 (entraîné sur Maze/Snake/ViZDoom) | **Écarté** : prototype de recherche |
| **OpenJev** | DiffusionGemma 26B-A4B (images) ou Verdict 151M ModernBERT | Apache-2.0 | GPU 24 Go | non documenté | composite 66,4 (n°11) ; 66–85 % sur les jeux publics | **Écarté** : trop lourd ou trop faible |
| *Référence* : classifieur embeddings (MiniLM + régression logistique) | ~30M | — | CPU, 6 ms | selon l'encodeur | 88–90 % sur les trois jeux, **bat tous les modèles ci-dessus** à peu d'options | Option la plus sobre pour 3–4 profils, mais données étiquetées nécessaires |

Deux réserves transverses :

1. **Aucune source ne mesure le français.** Tout choix devra passer par un jeu d'évaluation maison en français.
2. La tâche « quel profil ? » compte 3–4 options. Sur ce régime, l'article de référence conclut qu'un petit
   classifieur entraîné bat les modèles de décision généralistes. L'effet de mode ne doit pas décider.

## 5. Recommandation (à valider par l'utilisateur)

1. **Figer un contrat `DecisionProvider` dans `src/core`** au format Jev (`choice` / `score` / `noul`
   + distributions de probabilités), indépendant du fournisseur — application de l'invariant P0 n°3
   (provider agnostic) à une nouvelle famille. Implémentations prévues : `NoneDecisionProvider`
   (profil statique), `OllamaDecisionProvider` (local, structuré), plus tard `Laya`, `Kev`, `Jev` (☁).
2. **Livrer d'abord le mode « Auto » avec le narrateur Ollama existant** et un schéma JSON à choix
   fermé (modèle 1,5–3B suffisant, `qwen2.5:1.5b` déjà installé). Marche aujourd'hui, sans clé, sans
   sortie réseau, en français. La confiance sera moins calibrée que Jev : acceptable pour un routage de
   ton. UI : pseudo-profil « Auto » dans la barre d'état et la vue Profils, changeable en un clic.
3. **Spike mesuré ensuite** sur ~50 réponses Claude réelles de l'inbox, étiquetées par profil :
   Ollama structuré **vs** Laya 322M fine-tuné **vs** classifieur embeddings. Retenir celui qui gagne
   sur preuve (exactitude, latence CPU, poids d'installation). Critère d'acceptation à nommer : test.
4. **Jev cloud** reste une option distante, jamais par défaut, derrière `localOnly = false`.
5. **Docker unique commun** : non. Si la lecture automatique est activée un jour, implémenter
   CdC §66 (verrou `player.lock`) + file dans `~/.llm-voice`, sans conteneur.

## 6. Comment brancher chaque fournisseur (mémo technique)

- **Ollama structuré** : `POST /api/chat`, `format` = JSON Schema `{ profileId: enum[...], confidence: number }`
  — même mécanique que `OllamaNarrator`. Ollama n'expose pas les logits : la « confiance » est déclarative.
- **Laya** : service Python `laya-serve` (FastAPI) sur `127.0.0.1`, à installer à la demande comme Piper ;
  passer par `EgressGuard` comme tout provider. Nécessite un checkpoint fine-tuné livré ou téléchargé
  (jamais dans le VSIX, invariant P0 n°5).
- **Kev** : serveur `kev.serve` sur `127.0.0.1:8009`, API `/v1/systemone` identique à Jev ⇒ un seul
  client TS pour Kev et Jev, seule l'URL change.
- **SemIf** : uniquement si le narrateur bascule sur llama.cpp (`/completion` avec `n_probs`) ; le
  motif « lire les probabilités des options dans les logits » est réimplémentable en TypeScript sans
  dépendance Python.

## 7. Points à trancher (utilisateur)

- [ ] Accepte-t-on qu'en mode « Auto » avec Jev, le texte des réponses Claude parte chez TypeSafe ?
      Si non : mode Auto **local uniquement**.
- [ ] Le mode « Auto » justifie-t-il une dépendance Python à la demande (Laya/Kev), alors que la voie
      par défaut vise « rien à installer » ?
- [ ] La lecture automatique des réponses Claude (abandon de l'invariant zéro autoplay) est-elle
      souhaitée ? C'est ce qui rend la file globale (CdC §66/§73) nécessaire.
- [ ] Ouvrir une carte du Mission Ledger « Mode Auto : contrat DecisionProvider + implémentation Ollama »
      (critère : tests unitaires + gate), puis une seconde « Spike décision FR : Ollama vs Laya vs embeddings ».

## 8. Routage agents si les cartes sont ouvertes

- Contrat `src/core` + ADR : `platform-architect` (Opus puis Sonnet).
- Implémentation `OllamaDecisionProvider`, pseudo-profil Auto, tests : `backend-engineer` (Sonnet).
- Spike d'évaluation et outillage (jeu étiqueté, script de mesure) : `agent-optimizer` + skill
  `meta-toolsmithing` (Sonnet).
- Revue sécurité du fournisseur distant Jev (egress, clé) : `ops-engineer` + `infra-security-hardening`.

## 9. Sources (consultées le 2026-09-27)

- Simon Willison, « Jev introduces a new shape of LLM — System One » : https://simonwillison.net/2026/Sep/21/jev/
- Wikipedia, « Jev (AI model) » : https://en.wikipedia.org/wiki/Jev_(AI_model)
- LeMagIT, « Jev, le modèle de décision pensé pour accélérer l'IA agentique » : https://www.lemagit.fr/actualites/366651192/Jev-le-modele-de-decision-pense-pour-accelerer-lIA-agentique
- Next, « le nouveau modèle Jev se veut le champion des décisions typées » : https://next.ink/257219/ia-le-nouveau-modele-jev-se-veut-le-champion-des-decisions-typees/
- Laya (Convai Innovations) : https://laya.convaiinnovations.com/
- Kev (jaredpalmer) : https://github.com/jaredpalmer/kev
- NanoJev : https://jevtypesafeai.com/jev/local/nanojev
- Bespoke Nimble 9B : https://huggingface.co/bespokelabs/Bespoke-Nimble-9B
- Comparatif Jev / djev / Laya / OpenJev / SemIf (JevBench v1.3.0) : https://huggingface.co/blog/sora-2/jev-ai-vs-djev-vs-laya-vs-openjev-vs-semif-which-d
- Benchmark indépendant laya / openjev / NanoJev (SOTAAZ) : https://sotaaz.com/post/jev-alternatives-bench-en
- Pinggy, « 5 self-hosted decision models » : https://pinggy.io/blog/best_open_source_jev_alternatives_self_hosted_decision_models/

Limites de l'étude : chiffres repris des sources sans réexécution locale ; format exact de l'API Jev non
vérifié sur la documentation officielle ; support CPU de Laya rapporté par un tiers, non mesuré ici.

## 10. Vérification indépendante et arbitrage (2026-09-27, session concierge suivante)

Vérification factuelle des affirmations de §3–§5 par un sous-agent (Sonnet, WebSearch/WebFetch), notes
complètes : `_grimoire-output/research/research_notes/verification-alternatives-jev.md`.

Corrections apportées à l'étude :

- **Écosystème à prendre avec réserve** : blogs SEO quasi identiques et forks GitHub aux README copiés
  mot pour mot. Les noms existent, les chiffres de benchmark ne sont pas des sources primaires.
- **« Ollama n'expose pas les logprobs » est faux** : l'API native `/api/generate` les renvoie
  (`logprobs`, `top_logprobs`) ; seule la couche compatible OpenAI `/v1/chat/completions` les ignore
  (ollama/ollama#16117, fermée « not planned »). Le §7 « basculer le narrateur sur llama.cpp » tombe.
- OpenJev (26B, ≥ 24 Go GPU) et Verdict (151M, GPU 6 Go ou WebGPU navigateur) sont deux produits distincts.
- Bespoke Nimble supporte aussi Mac/MLX ; Kev 27B est basé sur Qwen3.8, pas Qwen3.5.
- « SemIf 2e sur JevBench » n'est confirmé que par palier (judge), pas en composite.
- Le benchmark « classifieur embeddings à 6 ms » vient de SOTAAZ (tâches à 6 et 77 options), pas de Pinggy.
- Laya n'est « quasi aléatoire » que sur le banc de décisions typées dur (0,342) ; XNLI zéro-shot 0,731.

Preuve locale (2026-09-27, Ollama 0.21.0, `qwen2.5:3b`, `temperature 0`, `num_predict 1`,
`logprobs: true`, `top_logprobs: 5`) : prompt à trois options A/B/C (lecture intégrale / résumé /
révision rapide) sur une réponse Claude courte → `response: "A"`, distribution retournée
`A p=1.000, B p=0.000, C p=0.000`. L'approche SemIf fonctionne donc avec l'installation existante.
Réserve : petit modèle surconfiant, la distribution est un classement, pas une confiance calibrée.

**Arbitrage retenu (en attente de validation finale utilisateur, voir decisions-log) :**

| Rang | Candidat | Rôle |
|---|---|---|
| 1 | **SemIf — la technique, réimplémentée en TypeScript sur l'API native Ollama** | Fournisseur de décision local par défaut du mode « Auto » : zéro modèle, zéro entraînement, zéro installation nouvelle, français via le modèle narrateur |
| 2 | Laya 322M multilingue | Réserve, palier avancé (Python + fine-tuning) si SemIf ne bat pas les règles simples sur le jeu d'évaluation |
| 3 | Kev | Sans avantage pour nous (anglais, lourd), API Jev à l'identique seulement |
| — | Nimble, NanoJev, OpenJev | Écartés (CUDA, taille, français non documenté) ; Verdict 151M à revoir si on veut un jour se passer d'Ollama |
| ☁ | Jev cloud | Jamais par défaut ; option distante derrière `privacy.localOnly = false` |

Protocole du spike avant tout code produit : 50 réponses Claude réelles de l'inbox **étiquetées par
l'utilisateur** (pas par un LLM, sinon on apprend le goût du LLM) ; témoin à règles (longueur, part de code,
questions) ; SemIf sur Ollama ; classifieur embeddings (Ollama sert déjà `nomic-embed-text`, préférer un
modèle multilingue). On embarque le gagnant seulement s'il bat les règles. Calendrier : fonctionnalité 0.4,
après ADR-012 (son). Trou à corriger indépendamment : narrateur par défaut `qwen2.5:7b` absent de la machine.
