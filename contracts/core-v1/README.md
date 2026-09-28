# Protocole Core v1 (ADR-012)

Contrat versionné entre l'extension VS Code (TypeScript) et `llm-voice-core`
(Rust) : lecture native hors webview. Source normative : `docs/adr/ADR-012-native-audio-core.md`
(§4 Protocole local, §5 Cycle de vie, §6 Sécurité).

## Transport

- **HTTP** (`127.0.0.1:<port éphémère>`) : commandes synchrones —
  `GET /health` (pas de jeton, pas de corps) et `POST /v1/{enqueue,play,pause,resume,stop,seek}`
  (jeton requis dans le corps). Chaque commande répond par `http/ack.response.schema.json`,
  sauf `/health` qui répond par `http/health.response.schema.json`.
- **WebSocket** (`/v1/ws`) : événements asynchrones émis par le Core —
  `state`, `position`, `segment_started`, `segment_ended`, `underrun`, `ended`, `error`.
  La connexion elle-même est refusée sans jeton valide, `Origin` ou `Host`
  étranger (ADR-012 §6) ; les événements individuels ne reportent donc pas
  le jeton, contrairement aux commandes HTTP.

Ce découpage (jeton par message côté HTTP, jeton à la connexion côté WS)
est une clarification apportée par cette carte par rapport à la esquisse de
l'ADR-012 §4 (qui plaçait aussi les commandes sur la WebSocket) : à documenter
dans le journal de décisions si elle est confirmée à l'implémentation du Core.

## Fichiers

```
contracts/core-v1/
  common.schema.json        # $defs partagés (protocolVersion, token, segmentId, positionMs, ...)
  http/*.schema.json         # requêtes et réponses HTTP
  ws/*.schema.json           # événements WebSocket
  examples/valid/*.json      # messages acceptés
  examples/invalid/*.json    # messages rejetés (un défaut précis chacun)
  examples/manifest.json     # table exemple → schéma → verdict attendu
```

Tous les schémas sont en JSON Schema **draft 2020-12**
(`https://json-schema.org/draft/2020-12/schema`). Aucun générateur de code :
les deux côtés lisent les mêmes fichiers `.json` (ADR-012 §4 : « Pas de
générateur de code »).

## Version de protocole et jeton

- `protocolVersion` : chaîne `"majeure.mineure"` (`^1\.[0-9]+$` ici). Une
  majeure différente de celle du Core est refusée (`GET /health` permet de
  la découvrir avant toute connexion authentifiée).
- `token` : jeton de session aléatoire (≥ 16 caractères ici), transmis par
  l'extension au Core hors ligne de commande (ADR-012 §5), requis sur
  chaque commande HTTP.

## Comment chaque côté vérifie le contrat

- **TypeScript** (`vscode-extension/test/unit/contracts/core-v1.contract.test.ts`) :
  charge chaque `.schema.json` avec `ajv` (`Ajv2020`, `$ref` cross-fichiers
  vers `common.schema.json`), rejoue `examples/manifest.json` et vérifie que
  chaque exemple est accepté/rejeté comme annoncé.
- **Rust** (`crates/llm-voice-protocol/tests/contract_examples.rs`) : des
  structs `serde` par type de message (un miroir manuel du schéma, pas un
  moteur JSON Schema générique) désérialisent puis valident les mêmes
  exemples via `examples/manifest.json`.

Une divergence entre les deux (un exemple accepté d'un côté, rejeté de
l'autre) est un bug de contrat : c'est justement ce que ce double test
détecte.

## Ajouter un message

1. Ajouter/modifier un `.schema.json` sous `http/` ou `ws/` (`$ref` vers
   `common.schema.json` pour les types partagés).
2. Ajouter au moins un exemple valide et un exemple invalide sous
   `examples/`, et l'entrée correspondante dans `examples/manifest.json`.
3. Ajouter le struct `serde` miroir dans `crates/llm-voice-protocol`.
4. `npm --prefix vscode-extension run test:unit -- contracts` et
   `cargo test -p llm-voice-protocol` doivent rester verts.
