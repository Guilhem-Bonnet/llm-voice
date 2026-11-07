#!/usr/bin/env bash
# native-real.sh — preuve de bout en bout de l'extension entière (GAO-tests-int-gr-001).
#
# Vrai VS Code sans écran (xvfb-run), `llmVoice.audio.engine=native`, vrai Core
# Rust (`target/release/llm-voice-core`), vraie voix Piper (fournisseur
# `system`), son capté sur un sink nul par le banc `prove.sh` puis transcrit.
# C'est le test qui aurait attrapé le bogue terrain `segmentId "session-4:0"`.
#
# Étapes : cargo build --release -p llm-voice-core → build de l'extension →
# prove.sh --play-cmd "<ce script> --inner" (le test `native-real` de
# vscode-extension/test/integration-native-real/ tourne pendant la capture).
#
# Le Core hérite de PULSE_SINK/PIPEWIRE_PROPS (même routage que
# scripts/audio-spike/native-sink-play.sh) et d'un LLM_VOICE_CORE_STATE_DIR
# jetable : jamais de rattachement au Core « réel » d'un VS Code ouvert.
#
# `--response` : dépose une réponse de test dans un dossier temporaire et la lit par
# Ctrl+Alt+V puis R, vraie frappe, focus dans le terminal intégré (Kyutai 1.6B).
#
# `--response-adapted` : même chemin, avec une réponse qui porte du balisage, un chemin, des URL
# et un bloc de code. La transcription doit suivre ce qui se dit, et ne contenir aucun de ces mots.
#
# `--kyutai` : même chaîne avec la voix Estelle (`pocket-tts serve --language french`
# requis), via le chemin du bouton Test, pause de 2,5 s comprise :
# `silence_between_sounds_ms` du JSON mesure ce silence.
#
# Sortie 0 si le test est vert ET la transcription conforme (prove.sh, WER
# <= 0.25, signal non silencieux) ; 1 sinon ; 2 erreur du banc. Le JSON de
# prove.sh est imprimé sur stdout ; les journaux détaillés vont sur stderr.
set -euo pipefail

SCRIPT="$(readlink -f "${BASH_SOURCE[0]}")"
SCRIPT_DIR="$(dirname "$SCRIPT")"
REPO="$(cd "$SCRIPT_DIR/../.." && pwd)"
EXT="$REPO/vscode-extension"
MARKDOWN="$EXT/test/fixtures-native-real/native-real.md"

if [ "${1:-}" = "--inner" ]; then
  # Exécuté par prove.sh (--play-cmd) : PULSE_SINK est exporté vers le sink nul.
  original_sink=""
  cleanup_inner() { [ -n "$original_sink" ] && pactl set-default-sink "$original_sink" >/dev/null 2>&1 || true; }
  trap cleanup_inner EXIT
  if [ -n "${PULSE_SINK:-}" ]; then
    original_sink="$(pactl get-default-sink 2>/dev/null || true)"
    pactl set-default-sink "$PULSE_SINK" >/dev/null 2>&1 || true
    export PIPEWIRE_NODE="$PULSE_SINK"
    export PIPEWIRE_PROPS="{ node.name = llm-voice-native-real application.name = llm-voice-native-real target.object = $PULSE_SINK node.dont-move = true }"
  fi
  export LLM_VOICE_CORE_STATE_DIR
  LLM_VOICE_CORE_STATE_DIR="$(mktemp -d)"
  export LLM_VOICE_NATIVE_REAL=1
  cd "$EXT"
  set +e
  xvfb-run -a npx vscode-test --label native-real >&2
  code=$?
  set -e
  echo "$code" > "$LLM_VOICE_NATIVE_REAL_EXIT_FILE"
  # Le Core lancé par l'extension s'arrête avec son parent ; on nettoie au cas où.
  if [ -f "$LLM_VOICE_CORE_STATE_DIR/core.json" ]; then
    pid="$(python3 -c 'import json,sys;print(json.load(open(sys.argv[1]))["pid"])' "$LLM_VOICE_CORE_STATE_DIR/core.json" 2>/dev/null || true)"
    [ -n "$pid" ] && kill "$pid" 2>/dev/null || true
  fi
  rm -rf "$LLM_VOICE_CORE_STATE_DIR"
  exit 0   # le verdict du test est combiné à celui du banc plus bas
fi

if [ "${1:-}" = "--cast" ]; then
  # ADR-018 : une scène à plusieurs voix, Kyutai TTS 1.6B, service `kyutai16` démarré sur le port 8020.
  export LLM_VOICE_NATIVE_REAL_ENGINE=kyutai16 LLM_VOICE_NATIVE_REAL_SCENARIO=cast
  export LLM_VOICE_NATIVE_REAL_DOCUMENT="$REPO/docs/essais-voix/theatre-demo.md"
  curl -fs -m 3 http://localhost:8020/health >/dev/null \
    || { echo "native-real.sh: le service kyutai16 doit tourner sur le port 8020 (deploy/README.md)" >&2; exit 2; }
  [ -n "${LLM_VOICE_NATIVE_REAL_KEEP_CACHE:-}" ] \
    || rm -rf "$EXT/.vscode-test/native-real/User/globalStorage/guilhem-bonnet.llm-voice/cache"
  CAST_SINCE="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
fi
RESPONSE_TEXT="Les deux pannes sont corrigées. La lecture part maintenant du raccourci. Rien ne se lit tout seul."
RESPONSE_MESSAGE="$RESPONSE_TEXT"
RESPONSE_FORBIDDEN=""
if [ "${1:-}" = "--response-adapted" ]; then
  # GAO-r-ponses-2-l-001 : ce qui s'entend n'est pas ce qui est écrit.
  RESPONSE_MESSAGE="$(printf '%s\n' '## Bilan' '' 'Le **correctif** touche `src/core/tts.ts`. La documentation est sur [le guide](https://example.test/guide) et sur https://example.test/docs.' '' '```ts' 'const hiddenValue = computeTheAnswer();' '```' '' 'Le test passe maintenant.')"
  RESPONSE_TEXT="Bilan. Le correctif touche tts.ts. La documentation est sur le guide et sur un lien. Un exemple de code. Le test passe maintenant."
  RESPONSE_FORBIDDEN="http www example.test src/ hidden compute answer const astérisque étoile dièse crochet parenthèse"
  export LLM_VOICE_NATIVE_REAL_RESPONSE_HAS_CODE=1
  set -- --response
fi
if [ "${1:-}" = "--response" ]; then
  # GAO-r-ponses-1-l-001 : une réponse de test dans un dossier temporaire, jamais l'inbox de
  # l'utilisateur, lue par Ctrl+Alt+V puis R avec le focus dans le terminal. Kyutai 1.6B, port 8020.
  export LLM_VOICE_NATIVE_REAL_ENGINE=kyutai16 LLM_VOICE_NATIVE_REAL_SCENARIO=response
  export LLM_VOICE_NATIVE_REAL_CDP_PORT="${LLM_VOICE_NATIVE_REAL_CDP_PORT:-47631}"
  curl -fs -m 3 http://localhost:8020/health >/dev/null \
    || { echo "native-real.sh: le service kyutai16 doit tourner sur le port 8020 (deploy/README.md)" >&2; exit 2; }
  [ -n "${LLM_VOICE_NATIVE_REAL_KEEP_CACHE:-}" ] \
    || rm -rf "$EXT/.vscode-test/native-real/User/globalStorage/guilhem-bonnet.llm-voice/cache"
  export LLM_VOICE_INBOX
  LLM_VOICE_INBOX="$(mktemp -d)"
  python3 -c 'import json,sys,time; now=int(time.time()*1000); json.dump({"schemaVersion":1,"provider":"claude-code","sessionId":"preuve-reponse","capturedAt":now,"cwd":"/tmp/preuve","message":sys.argv[2]},open(sys.argv[1]+"/"+str(now)+"-preuve.json","w",encoding="utf-8"),ensure_ascii=False)' "$LLM_VOICE_INBOX" "$RESPONSE_MESSAGE"
fi
if [ "${1:-}" = "--kyutai16" ]; then
  # Même scénario avec Kyutai TTS 1.6B et la voix Camille, service `kyutai16` démarré sur le port 8020.
  export LLM_VOICE_NATIVE_REAL_ENGINE=kyutai16
  curl -fs -m 3 http://localhost:8020/health >/dev/null \
    || { echo "native-real.sh: le service kyutai16 doit tourner sur le port 8020 (deploy/README.md)" >&2; exit 2; }
  set -- --kyutai
fi
if [ "${1:-}" = "--kyutai" ]; then
  export LLM_VOICE_NATIVE_REAL_SCENARIO=kyutai
  [ "${LLM_VOICE_NATIVE_REAL_ENGINE:-}" = "kyutai16" ] || curl -fs -m 3 http://localhost:8000/health >/dev/null \
    || { echo "native-real.sh: pocket-tts serve --language french doit tourner sur le port 8000" >&2; exit 2; }
  # Cache du VS Code de test uniquement : chaque preuve exerce une vraie synthèse.
  # `LLM_VOICE_NATIVE_REAL_KEEP_CACHE=1` conserve le cache pour prouver sa guérison.
  [ -n "${LLM_VOICE_NATIVE_REAL_KEEP_CACHE:-}" ] \
    || rm -rf "$EXT/.vscode-test/native-real/User/globalStorage/guilhem-bonnet.llm-voice/cache"
fi

for bin in cargo npm npx xvfb-run pactl parecord python3; do
  command -v "$bin" >/dev/null 2>&1 || { echo "native-real.sh: binaire requis introuvable : $bin" >&2; exit 2; }
done

echo "== cargo build --release -p llm-voice-core" >&2
(cd "$REPO" && cargo build --release -p llm-voice-core >&2)
echo "== build de l'extension" >&2
(cd "$EXT" && npm run build >&2)

# Texte attendu = les phrases du Markdown (retours à la ligne aplatis).
EXPECT="$(tr '\n' ' ' < "$MARKDOWN" | sed 's/  */ /g; s/ *$//')"
if [ "${LLM_VOICE_NATIVE_REAL_SCENARIO:-}" = "kyutai" ]; then
  EXPECT="Bonjour. Voici un exemple de ma voix. Nous allons maintenant examiner un concept technique et voir comment l'expliquer clairement."
fi
if [ "${LLM_VOICE_NATIVE_REAL_SCENARIO:-}" = "cast" ]; then
  # Ce qui doit s'entendre : tout le texte, sans les noms en capitales ni le balisage.
  EXPECT="$(python3 -c 'import re,sys; t=open(sys.argv[1],encoding="utf-8").read(); t=re.sub(r"^[A-ZÉÈ]+ : ","",t,flags=re.M); t=re.sub(r"[#*]","",t); print(" ".join(t.split()))' "$LLM_VOICE_NATIVE_REAL_DOCUMENT")"
fi
if [ "${LLM_VOICE_NATIVE_REAL_SCENARIO:-}" = "response" ]; then
  EXPECT="$RESPONSE_TEXT"
fi
export LLM_VOICE_NATIVE_REAL_EXIT_FILE
LLM_VOICE_NATIVE_REAL_EXIT_FILE="$(mktemp)"
trap 'rm -f "$LLM_VOICE_NATIVE_REAL_EXIT_FILE"' EXIT
echo "1" > "$LLM_VOICE_NATIVE_REAL_EXIT_FILE"   # défaut : test non exécuté = échec

set +e
PROVE_JSON="$("$SCRIPT_DIR/prove.sh" "$(mktemp -u).wav" --expect "$EXPECT" --post-roll 3 \
  --play-cmd "\"$SCRIPT\" --inner")"
PROVE_EXIT=$?
set -e
echo "$PROVE_JSON"
if [ "${LLM_VOICE_NATIVE_REAL_SCENARIO:-}" = "kyutai" ] && [ "$PROVE_EXIT" = "0" ]; then
  # La pause du test dure 2,5 s : sans ce silence dans le son capté, elle n'a rien arrêté.
  echo "$PROVE_JSON" | python3 -c 'import json,sys; sys.exit(0 if json.loads(sys.stdin.read().strip().splitlines()[-1])["silence_between_sounds_ms"] >= 2000 else 1)' \
    || { echo "native-real.sh: la pause n'a pas laissé 2 s de silence dans la capture" >&2; PROVE_EXIT=1; }
fi
if [ -n "$RESPONSE_FORBIDDEN" ]; then
  echo "$PROVE_JSON" | python3 -c 'import json,sys
heard=json.loads(sys.stdin.read().strip().splitlines()[-1])["transcription"].lower()
found=[word for word in sys.argv[1].split() if word in heard]
print(json.dumps({"entendu":heard,"mots_interdits_entendus":found},ensure_ascii=False))
sys.exit(1 if found else 0)' "$RESPONSE_FORBIDDEN" \
    || { echo "native-real.sh: la transcription contient du balisage, une URL ou du code" >&2; PROVE_EXIT=1; }
fi
TEST_EXIT="$(cat "$LLM_VOICE_NATIVE_REAL_EXIT_FILE")"
if [ "${LLM_VOICE_NATIVE_REAL_SCENARIO:-}" = "cast" ]; then
  # Le journal du serveur dit quelles voix ont vraiment été demandées, et le temps de chaque passage.
  docker logs --since "$CAST_SINCE" deploy-kyutai16-1 2>/dev/null | python3 -c 'import json,sys
rows=[json.loads(l) for l in sys.stdin if l.startswith("{") and "\"/tts\"" in l]
voices={r["voice"] for r in rows}
print(json.dumps({"requetes":len(rows),"voix":sorted(voices),"passages":[[r["voice"],r["text_chars"],r["duration_s"],r["status"]] for r in rows]},ensure_ascii=False))
sys.exit(0 if len(voices)>=4 and all(r["status"]==200 for r in rows) else 1)' \
    || { echo "native-real.sh: quatre voix différentes attendues dans le journal du serveur" >&2; PROVE_EXIT=1; }
fi

echo "native-real.sh: test vscode-test exit=$TEST_EXIT ; banc prove.sh exit=$PROVE_EXIT" >&2
if [ "$TEST_EXIT" = "0" ] && [ "$PROVE_EXIT" = "0" ]; then
  exit 0
fi
[ "$PROVE_EXIT" = "2" ] && exit 2
exit 1
