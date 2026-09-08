# Revue Sentinel — Phase 1 bootstrap-repo.sh (`Guilhem-Bonnet/llm-voice`)

Date : 2026-09-08. Vérificateur : Sentinel (Sonnet, contexte neuf, indépendant de Flow).
Périmètre : `scripts/bootstrap-repo.sh`, `.github/workflows/*.yml`, `.github/dependabot.yml`,
`.gitleaks.toml`, `.gitignore`, `vscode-extension/package.json`, `.vscodeignore`,
`integrations/claude-code/plugin/**`, `README.md`, `LICENSE`, `SECURITY.md`.

## 1. Script bootstrap — `scripts/bootstrap-repo.sh`

| Contrôle | Verdict | Preuve |
|---|---|---|
| `set -euo pipefail` | PASS | ligne 12 |
| Arrêt si repo existe déjà | PASS | ligne 71-74 `gh repo view ... exit 0` |
| gitleaks bloquant avant tout commit | PASS | lignes 76-87, avant `git init`/`git add` |
| `git init` seulement si `.git` absent | PASS | lignes 91-95 `if [[ -d .git ]]` |
| `--dry-run` sans effet de bord | PASS | exécuté, cf §10, aucun `.git` créé |
| JSON branch protection complet via `--input` | PASS | lignes 141-178 : `required_status_checks.strict`, `contexts`, `enforce_admins`, `required_pull_request_reviews.required_approving_review_count`, `restrictions: null`, `allow_force_pushes`, `allow_deletions` tous présents, envoyés via `--input -` (pas de `-f` aplati) |
| `contexts` == noms réels des jobs CI | PASS | ci.yml : jobs `lint`, `unit`, `package` ont `name:` = id ; `integration` matriciel (`os: [ubuntu-latest, windows-latest, macos-latest]`) avec `name: integration` (= id) → GitHub Actions produit bien `integration (ubuntu-latest)` etc. Les 6 contexts du script (lignes 145-152) correspondent exactement. |
| Pas de `sleep` fragile après `gh repo create` | PASS | `gh repo create --push` est synchrone ; aucun sleep dans le script, correct car pas nécessaire |
| Labels / topics / security_and_analysis | PASS | JSON réel via `--input -`, idempotent (`gh label create` avec fallback `gh label edit`) |

Aucun défaut trouvé dans le script lui-même.

## 2. Contenu poussé — audit du périmètre public

`find . -type f | grep -vE 'node_modules|\.vscode-test|/out/|/coverage/|\.git/'` (~180 fichiers).

- Secrets / creds : aucun trouvé (voir §3, gitleaks clean).
- `.mcp.json` : contenu générique (`command: grimoire-mcp`, `env: {}`), pas de secret. OK public.
- `.claude/settings.json` : hooks Grimoire + deny-list défensive (`.env`, clés privées, etc.), pas de secret. OK public, plutôt un bon signal.
- `docker-compose.memory-target.yml` : mot de passe par défaut `grimoire-dev-password` (Neo4j). **Faux positif acceptable** : placeholder explicitement nommé "dev-password", stack de mémoire locale Grimoire, pas un secret réel du produit LLM Voice. Recommandation mineure non bloquante : ajouter un commentaire "changer avant tout usage exposé au réseau" (le compose expose déjà `0.0.0.0:7474/7687` par défaut si aucune variable d'env n'est positionnée — acceptable pour un service dev local mais mérite le commentaire).
- `_grimoire-output/.runs/` : correctement gitignoré (`.gitignore` ligne 3) — confirmé absent de la liste `find` filtrée par les patterns usuels mais présent sur disque (`_grimoire-output/.runs/main/branch.json`, contenu trivial `{"name":"main",...}`) : sera bien exclu par `.gitignore`, à vérifier quand même après le premier `git add -A` réel.
- `_grimoire-output/evidence/**`, `_grimoire-output/events/runtime-journal.jsonl`, `_grimoire-output/traces/traces.jsonl` : **PAS gitignorés**, contenu = télémétrie interne des agents (hash d'arguments, latences, timestamps). Pas de secret, mais bruit opérationnel sans valeur pour un contributeur OSS externe.
- **Bug trouvé** : `_grimoire-output/planning-artifacts/_grimoire-output/traces/traces.jsonl` — fichier de trace dupliqué accidentellement imbriqué sous `planning-artifacts/` (cwd erroné au moment de la génération). À supprimer avant commit, indépendamment de la question de publication.
- Avis sur `_grimoire/` et `_grimoire-output/planning-artifacts/` publics : **raisonnable pour `planning-artifacts/`** (ADR, revue sécurité, plan CI — bonne transparence OSS). **Discutable pour `_grimoire/_memory/*` et `_grimoire-output/{traces,events,evidence}/`** : pas de fuite de secret ni de PII détectée, mais expose le détail interne du tooling d'agents IA (routage de modèles, coûts, hashes d'appels d'outils) sans intérêt pour l'utilisateur final de l'extension. Recommandation non bloquante : ignorer `_grimoire-output/{traces,events,evidence}/` et supprimer le doublon avant le premier commit public.

## 3. gitleaks

```
$ gitleaks detect --no-git -s . --redact --config .gitleaks.toml
1:03PM INF scanned ~1414926 bytes (1.41 MB) in 217ms
1:03PM INF no leaks found
EXIT=0
```
`.gitleaks.toml` : `[allowlist].paths` ne contient que des chemins déjà gitignorés (`node_modules/`, `.vscode-test/`, `out/`, `dist/`, `coverage/`, `*.vsix`) — cohérent avec `.gitignore`, pas d'allowlist abusive.

## 4. npm audit

```
$ npm audit --prefix vscode-extension --omit=dev
found 0 vulnerabilities

$ npm audit --prefix vscode-extension
8 vulnerabilities (5 moderate, 2 high, 1 critical)  [exit 1]
```
Détail JSON : `esbuild` (moderate, dev-server only), `serialize-javascript` (high, via `mocha`←`@vscode/test-cli`, **no fix available**), `vitest`/`vite`/`vite-node`/`@vitest/mocker` (moderate→"critical" — artefact d'agrégation npm sur la chaîne de dépendances, pas d'avis GHSA "critical" direct listé dans le rapport texte).

- **Aucune vulnérabilité en dépendance de production** (`package.json` n'a que `devDependencies`, aucune `dependencies`).
- Les devDeps critiques/high (test tooling only, jamais embarquées dans le VSIX vu `.vscodeignore` + `vsce package --no-dependencies`) ne bloquent pas le push initial.
- **Gap réel vs `AC-SEC-10`** (`security-privacy-review-v1.md` L108 : "Le build CI échoue si `npm audit` détecte une vulnérabilité high+ sur les dépendances de prod") : **aucun step `npm audit` n'existe dans `ci.yml`** (`grep -rn audit .github/workflows/*.yml` → 0 résultat). L'AC est donc non implémenté en CI, alors que le script bootstrap suppose la CI complète. À corriger avant de considérer la phase 1 "faite".

## 5. ci.yml

| Contrôle | Verdict | Preuve |
|---|---|---|
| `permissions:` minimales déclarées | **FAIL** | aucune clé `permissions:` dans tout `ci.yml` (workflow ni jobs) — GITHUB_TOKEN hérite des permissions par défaut du repo/org au lieu d'un `contents: read` explicite |
| Actions épinglées (tag majeur mini) | PASS | `actions/checkout@v4`, `actions/setup-node@v4`, `actions/upload-artifact@v4` |
| `cache-dependency-path` correct | PASS | `vscode-extension/package-lock.json` (existe, 303 908 octets) |
| xvfb Linux uniquement | PASS | lignes 68-73, `if: runner.os == 'Linux'` / `!= 'Linux'` |
| `concurrency` | PASS | lignes 9-11 |
| `package` dépend des tests | PASS | `needs: [unit, integration]` (ligne 77) |
| `npm audit` (AC-SEC-10) | **FAIL** | absent, voir §4 |

## 6. release.yml

| Contrôle | Verdict | Preuve |
|---|---|---|
| Déclenché sur `v*` uniquement | PASS | `on.push.tags: ["v*"]` |
| `permissions: contents: write` | PASS | ligne 8-9 |
| Publication Marketplace conditionnée à `secrets.VSCE_PAT` | **RISQUE** | `if: ${{ env.VSCE_PAT != '' }}` référence `env.VSCE_PAT` défini par le `env:` du **même step** (lignes 35-38). Documentation GitHub (exemples officiels "env context") montre ce pattern fonctionner uniquement quand l'`env` est défini par un step **précédent** — dans le même step, le contexte `env` évalué pour `if:` ne contient pas encore la valeur qu'on est en train de définir. Résultat probable : la condition est toujours fausse et l'étape de publication ne s'exécute jamais, même avec `VSCE_PAT` positionné. Correction recommandée : `if: ${{ secrets.VSCE_PAT != '' }}` (référencer le secret directement dans le `if`, pattern documenté et supporté). Non bloquant pour le push initial (n'affecte que le futur tag `v0.1.0`), mais à corriger avant la première release. |
| Pas de secret en clair | PASS | uniquement `${{ secrets.* }}` |

## 7. codeql.yml / dependabot.yml

- `codeql.yml` : `permissions: actions: read, contents: read, security-events: write` déclarées au niveau job — PASS. `languages: javascript-typescript`, build via `npm ci --prefix vscode-extension && npm run compile --prefix vscode-extension` cohérent avec la structure du repo — PASS.
- `dependabot.yml` : deux écosystèmes (`npm` sur `/vscode-extension`, `github-actions` sur `/`), hebdo, reviewer `Guilhem-Bonnet`, groupes minor/patch — cohérent et valide — PASS.

## 8. `vscode-extension/package.json`

| Contrôle | Verdict |
|---|---|
| `extensionKind: ["ui"]` (D1) | PASS (ligne 18-20) |
| `publisher` | PASS (`guilhem-bonnet`) |
| `repository` (type/url/directory) | PASS |
| `engines.vscode` / `engines.node` | PASS |
| `activationEvents` vide mais `contributes.commands` présent | PASS — activation implicite `onCommand` auto-inférée par VS Code moderne (engine `^1.95.0`), comportement documenté, pas un oubli |
| scripts (lint/typecheck/test/package) | PASS |
| Pas de dépendance de prod inutile | PASS — `dependencies` absent, uniquement `devDependencies` |

`.vscodeignore` exclut correctement `src/**`, `test/**`, `.vscode-test/**`, `node_modules/**`, configs de build — pas de fuite de sources TS dans le VSIX packagé.

## 9. Plugin Claude Code (`integrations/claude-code/plugin/**`)

| Contrôle | Verdict | Preuve |
|---|---|---|
| `hooks.json` valide, Stop sans matcher, timeout 15, `${CLAUDE_PLUGIN_ROOT}` | PASS | `hooks/hooks.json` |
| Lecture stdin | PASS | `readStdin()` via `fs.readFileSync(0, "utf8")` avec try/catch |
| `last_assistant_message` (fallback `message`) | PASS | `buildEntry()` L50-55 |
| Écriture tmp + rename | PASS | `writeAtomic()` L68-80, `.tmp` puis `renameSync` |
| Permissions 0600 fichier / 0700 dossier | PASS | `mkdirSync(..., {mode:0o700})`, `writeFileSync(..., {mode:0o600})`, `chmodSync(finalPath,0o600)` après rename |
| `LLM_VOICE_INBOX` respecté | PASS | `resolveInboxDir()` L33-39 |
| `exit 0` toujours | PASS | `main()` sort en 0 même sur échec d'écriture (catch, stderr only, L96-98) |
| Aucun réseau | PASS | pas d'import `http`/`https`/`fetch`/`net` dans le script |
| Aucun log du contenu du message | PASS | stderr n'écrit que le path (`wrote ${writtenPath}`), jamais `entry.message` |
| Conformité `AC-SEC-06` | Non applicable ici — AC-SEC-06 concerne la commande VS Code d'installation/désinstallation dans `~/.claude/settings.json` (pas encore implémentée, hors scope phase 1 : squelette d'extension seulement). Le plugin lui-même (voie recommandée) ne touche pas `settings.json`. |

## 10. `--dry-run`

```
$ bash scripts/bootstrap-repo.sh --dry-run
[bootstrap-repo] Repo root: /mnt/Travail/Projets/Dev/TTS-Voice
[bootstrap-repo] Target: Guilhem-Bonnet/llm-voice
[bootstrap-repo] MODE: --dry-run (no side effects)
[bootstrap-repo] Running gitleaks (blocking) before any commit is created...
[bootstrap-repo] DRY-RUN would run: gitleaks detect --no-git -s . --redact
[bootstrap-repo] DRY-RUN would run: git init -b main
...
[bootstrap-repo] DRY-RUN would run: gh api --method PUT --input - repos/Guilhem-Bonnet/llm-voice/branches/main/protection
{ ...JSON complet identique à §1... }
...
[bootstrap-repo] Done. https://github.com/Guilhem-Bonnet/llm-voice
EXIT=0
```
Confirmé : aucun `.git` créé (`[[ -d .git ]]` → absent avant et après exécution). Note : le script appelle `gh repo view` (réseau, lecture seule) même en `--dry-run` pour le garde-fou "repo existe déjà" — comportement voulu, sans effet de bord.

---

## VERDICT

**GO AVEC CORRECTIONS**

1. 🔴 BLOQUANT — `ci.yml` n'implémente pas `AC-SEC-10` : ajouter un step `npm audit --omit=dev --audit-level=high` (ou job dédié) qui fait échouer la CI.
2. 🔴 BLOQUANT — `ci.yml` n'a aucune clé `permissions:` : ajouter `permissions: contents: read` au niveau workflow (least privilege, GITHUB_TOKEN).
3. 🟠 RECOMMANDÉ — `release.yml` L36 : `if: ${{ env.VSCE_PAT != '' }}` référence l'`env` du même step, probablement toujours faux ; remplacer par `if: ${{ secrets.VSCE_PAT != '' }}`.
4. 🟠 RECOMMANDÉ — Supprimer le fichier dupliqué `_grimoire-output/planning-artifacts/_grimoire-output/traces/traces.jsonl` (bug de cwd) avant le premier commit.
5. 🟢 RECOMMANDÉ — Ajouter `_grimoire-output/{traces,events,evidence}/` au `.gitignore` (bruit de télémétrie interne, aucun secret mais sans valeur pour un dépôt OSS public) ; garder `planning-artifacts/`.
6. 🟢 RECOMMANDÉ — `docker-compose.memory-target.yml` : mot de passe par défaut `grimoire-dev-password` accepté comme placeholder, mais ajouter un commentaire explicite "dev only, changer si exposé".

Rien de bloquant côté script `bootstrap-repo.sh` lui-même (§1, §10), `.gitleaks.toml`/gitleaks (§3), dépendances de production (§4), `codeql.yml`/`dependabot.yml` (§7), `package.json` (§8), ou plugin Claude Code (§9).
