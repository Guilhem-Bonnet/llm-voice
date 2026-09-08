# ADR-007 — Protocole d'inbox ouvert et CLI `llm-voice-inbox`

## Statut

Accepté (2026-09-08). Remplace la version initiale d'ADR-007 (« hook Claude
Code uniquement ») suite à D8.

## Contexte

D8 (corrigée le 2026-09-08) établit que les LLM tiers (Copilot, Gemini,
Kimi, Qwen, DeepSeek, Grok, Codex…) sont des **sources de contenu**, jamais
des voix : notre TTS lit leurs réponses, aucun narrateur cloud n'est ajouté.
Chaque outil a un mécanisme de sortie différent (hook, `notify`, stdin…),
d'où le besoin d'un protocole unique découplé de la source.

## Décision

- **Un seul mécanisme commun : l'Inbox ouverte.** Tout outil dépose un
  fichier JSON dans `~/.llm-voice/inbox/` :
  ```json
  {
    "schemaVersion": 1,
    "provider": "claude-code",
    "sessionId": "...",
    "capturedAt": "2026-09-08T12:00:00Z",
    "cwd": "/path/to/project",
    "title": "optionnel",
    "message": "texte capturé"
  }
  ```
- **Nommage de fichier** : `<ts>-<session>-<rand>.json`, écrit en
  tmp+rename (atomique), permissions 0600.
- **Extension** : affiche chaque entrée avec l'icône du `provider`, lue à
  la demande avec n'importe quel profil. Zéro autoplay, quelle que soit la
  source.
- **Trois façons d'alimenter l'inbox** selon ce que l'outil offre :
  1. **Hooks/notify natifs** : Claude Code (`Stop` + `last_assistant_message`)
     → plugin `llm-voice` + collector Node cross-platform
     (`llm-voice-capture.js`), voie officielle en 0.1. Codex CLI (`notify`,
     JSON en argument) et Gemini CLI (hooks de cycle de vie) réutilisent le
     même collector en mode `--from <provider>`, en 0.2, **à vérifier**
     (nom de l'événement de fin de tour côté Gemini, présence du texte
     final).
  2. **CLI générique** : `llm-voice-inbox add --provider <nom>` qui lit
     stdin — pour tout outil capable de lancer une commande ou de piper sa
     sortie (Kimi, Qwen Code, DeepSeek, Grok, autres CLI), en 0.2.
  3. **Manuel** : sélection/presse-papiers pour les outils sans API
     d'automatisation (extensions VS Code tierces sans API publique de
     lecture du chat).
- **Jamais de scraping** du DOM/historique d'un chat tiers, quelle que soit
  la source (CdC §45).

## Conséquences

- Le player, le highlight et les profils sont totalement découplés de la
  source : un nouveau provider s'ajoute sans toucher au cœur de l'extension.
- Le collector Node unique remplace les trois variantes bash/python/
  powershell envisagées au CdC §59.
- Codex et Gemini restent marqués « à vérifier » : leur intégration 0.2 peut
  glisser si le mécanisme d'event n'est pas confirmé.

## Alternatives rejetées

- **Scraper l'historique des extensions de chat tierces** : rejeté, aucune
  API publique fiable, viole le principe de non-scraping (CdC §45).
- **Un narrateur cloud par provider tiers** : rejeté par la correction D8 —
  ces outils ne parlent jamais eux-mêmes, notre TTS est la seule voix.
- **Un format JSON différent par provider** : rejeté, casserait le
  découplage source/lecture et multiplierait le code d'ingestion.

## Tests qui prouvent la décision

- Unit : validation du schéma JSON (`schemaVersion`, champs requis) côté
  lecture de l'inbox — rejet gracieux d'une entrée malformée.
- Unit : `llm-voice-capture.js` — écriture tmp+rename, permissions 0600,
  timeout 15 s, exit 0 dans tous les cas (y compris stdin vide/invalide).
- Intégration : scénario Claude Code hook → fichier inbox → apparition dans
  l'extension avec la bonne icône, zéro autoplay.
- Intégration : `llm-voice-inbox add --provider test` via stdin → entrée
  inbox conforme.
