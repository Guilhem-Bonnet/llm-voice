#!/usr/bin/env bash
# Preuve réelle de l'image ROCm avec compose, sans réseau. Aucun son joué.
#   bash _grimoire-output/evidence/GAO-images-docke-001/run_proof.sh
set -euo pipefail
cd "$(dirname "$0")/../../.."
E=_grimoire-output/evidence/GAO-images-docke-001
[ -e "${XDG_RUNTIME_DIR}/gpu-yield/active" ] && { echo "mode jeu actif : arrêt" >&2; exit 3; }
export COMPOSE_PROFILES=rocm QWEN3_PORT=8031
DC=(docker compose -p llm-voice-qwen3-test -f deploy/docker-compose.qwen3.yml -f "$E/compose-test-override.yml")
t0=$(date +%s.%N)
"${DC[@]}" up -d qwen3
t1=$(date +%s.%N)
"${DC[@]}" logs --no-color qwen3-data > "$E/qwen3-data.log"
C=$("${DC[@]}" ps -q qwen3)
docker inspect "$C" --format 'network_mode={{.HostConfig.NetworkMode}} user={{.Config.User}} readonly={{.HostConfig.ReadonlyRootfs}} capdrop={{.HostConfig.CapDrop}} image={{.Config.Image}}' > "$E/container.txt"
X() { docker exec -i "$C" python3 -c "$1"; }
X 'import socket
try:
    socket.create_connection(("1.1.1.1", 443), timeout=3); print("réseau : JOIGNABLE")
except OSError as e:
    print("réseau : injoignable (" + type(e).__name__ + ")")' >> "$E/container.txt"
for i in $(seq 1 60); do
  X 'import urllib.request as u; print(u.urlopen("http://127.0.0.1:8021/health", timeout=5).read().decode())' > "$E/health-start.json" 2>/dev/null && break
  sleep 2
done
t2=$(date +%s.%N)
X 'import urllib.request as u; print(u.urlopen("http://127.0.0.1:8021/voices", timeout=10).read().decode())' > "$E/voices.json"
TEXT="Le serveur tourne dans son image, sans réseau, et lit cette phrase avec la voix figée."
t3=$(date +%s.%N)
X "import urllib.request as u, urllib.parse as p, sys
body = p.urlencode({'text': '''$TEXT'''}).encode()
r = u.urlopen(u.Request('http://127.0.0.1:8021/tts', data=body, headers={'Content-Type': 'application/x-www-form-urlencoded'}), timeout=600)
sys.stdout.buffer.write(r.read())" > "$E/figee-image-rocm.wav"
t4=$(date +%s.%N)
X 'import urllib.request as u; print(u.urlopen("http://127.0.0.1:8021/health", timeout=5).read().decode())' > "$E/health-after.json"
python3 -P - "$E" "$t0" "$t1" "$t2" "$t3" "$t4" "$TEXT" <<'PY'
import json, sys, wave
e, t0, t1, t2, t3, t4, text = sys.argv[1], *map(float, sys.argv[2:7]), sys.argv[7]
with wave.open(f"{e}/figee-image-rocm.wav") as w:
    seconds = w.getnframes() / w.getframerate()
voices = json.loads(open(f"{e}/voices.json").read())
out = {"compose_up_s": round(t1 - t0, 1), "health_after_up_s": round(t2 - t1, 1),
       "tts_s": round(t4 - t3, 1), "audio_s": round(seconds, 2), "text": text,
       "voices": voices if isinstance(voices, (int, str)) else None}
json.dump(out, open(f"{e}/timings.json", "w"), ensure_ascii=False, indent=2)
print(json.dumps(out, ensure_ascii=False))
PY
