#!/usr/bin/env bash
# Suite d'attaque du démon local llm-voice-core (ADR-012 §6, carte
# GAO-audit-s-curi-001). Démarre le binaire release dans un état/cache isolés,
# lit core.json, lance une batterie d'attaques loopback, imprime un tableau et
# sort non nul si au moins une attaque attendue comme refusée ne l'est pas.
#
# Aucune connexion sortante, aucun commit, aucune modification de l'état réel de
# l'utilisateur : STATE_DIR et CACHE_DIR vivent sous un mktemp, détruits au trap.
set -uo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
BIN="$REPO_ROOT/target/release/llm-voice-core"
WORK="$(mktemp -d)"
STATE_DIR="$WORK/state"
CACHE_DIR="$WORK/cache"
# STATE_DIR n'est volontairement PAS pré-créé : le Core doit le créer
# lui-même en 0700 (G02) ; le pré-créer masquerait un dossier laxiste
# hérité (umask) que `ensure_dir` ne resserre pas sur un dossier existant.
mkdir -p "$CACHE_DIR"
core_pid=""
fails=0
total=0
declare -a ROWS

log()  { echo "attack: $*" >&2; }
cleanup() {
  [[ -n "$core_pid" ]] && kill -TERM "$core_pid" 2>/dev/null || true
  [[ -n "$core_pid" ]] && wait "$core_pid" 2>/dev/null || true
  rm -rf "$WORK"
}
trap cleanup EXIT

# record <id> <description> <attendu> <obtenu> <PASS|FAIL>
record() {
  total=$((total+1))
  [[ "$5" == "FAIL" ]] && fails=$((fails+1))
  ROWS+=("$(printf '%-6s | %-46s | %-22s | %-22s | %s' "$1" "$2" "$3" "$4" "$5")")
  log "$1 [$5] $2 — attendu=$3 obtenu=$4"
}

command -v curl >/dev/null || { log "curl requis"; exit 2; }
command -v jq   >/dev/null || { log "jq requis"; exit 2; }

# --- build ---------------------------------------------------------------
log "cargo build --release -p llm-voice-core"
( cd "$REPO_ROOT" && cargo build --release -p llm-voice-core ) >&2 || { log "build échoué"; exit 2; }
[[ -x "$BIN" ]] || { log "binaire absent : $BIN"; exit 2; }

# --- démarrage isolé -----------------------------------------------------
LLM_VOICE_CORE_STATE_DIR="$STATE_DIR" LLM_VOICE_CACHE_DIR="$CACHE_DIR" \
  "$BIN" 2>"$WORK/core.log" &
core_pid=$!
STATE_FILE="$STATE_DIR/core.json"
for _ in $(seq 1 200); do
  [[ -f "$STATE_FILE" ]] && [[ "$(jq -r .pid "$STATE_FILE" 2>/dev/null)" == "$core_pid" ]] && break
  kill -0 "$core_pid" 2>/dev/null || { log "le Core est mort : $(cat "$WORK/core.log")"; exit 2; }
  sleep 0.05
done
[[ "$(jq -r .pid "$STATE_FILE" 2>/dev/null)" == "$core_pid" ]] || { log "core.json jamais publié"; exit 2; }
PORT="$(jq -r .port "$STATE_FILE")"
TOKEN="$(jq -r .token "$STATE_FILE")"
BASE="http://127.0.0.1:$PORT"
log "Core pid=$core_pid port=$PORT token=${#TOKEN} caractères"

# helpers -----------------------------------------------------------------
# hcode <fichier corps> curl-args...  -> imprime le code HTTP, corps dans $1
hcode() { local out="$1"; shift; curl -s -m 8 -o "$out" -w '%{http_code}' "$@"; }
body_code() { jq -r '.error.code // "-"' "$1" 2>/dev/null || echo "-"; }
jbody() { jq -nc --arg t "$1" --argjson extra "$2" '{protocolVersion:"1.0",token:$t}+$extra'; }
# ws_status : effectue un handshake WebSocket manuel et renvoie le code HTTP
ws_status() {
  local url_headers=("$@")
  curl -s -m 8 -o /dev/null -w '%{http_code}' \
    -H 'Connection: Upgrade' -H 'Upgrade: websocket' \
    -H 'Sec-WebSocket-Version: 13' -H 'Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==' \
    "${url_headers[@]}"
}
O="$WORK/o"

# =========================================================================
# A. Authentification par jeton
# =========================================================================
c=$(hcode "$O" -X POST -H 'Content-Type: application/json' -d '{"protocolVersion":"1.0"}' "$BASE/v1/pause")
[[ "$c" == 401 && "$(body_code "$O")" == invalid_token ]] && r=PASS || r=FAIL
record A01 "POST /v1/pause sans jeton" "401 invalid_token" "$c $(body_code "$O")" "$r"

c=$(hcode "$O" -X POST -H 'Content-Type: application/json' -d "$(jbody wrongtokenwrongtokenwrong '{}')" "$BASE/v1/pause")
[[ "$c" == 401 ]] && r=PASS || r=FAIL
record A02 "jeton faux même longueur" "401" "$c" "$r"

c=$(hcode "$O" -X POST -H 'Content-Type: application/json' -d "$(jbody "${TOKEN:0:31}" '{}')" "$BASE/v1/pause")
[[ "$c" == 401 ]] && r=PASS || r=FAIL
record A03 "jeton longueur 31 (voisine)" "401" "$c" "$r"

c=$(hcode "$O" -X POST -H 'Content-Type: application/json' -d "$(jbody "${TOKEN}X" '{}')" "$BASE/v1/pause")
[[ "$c" == 401 ]] && r=PASS || r=FAIL
record A04 "jeton longueur 33 (voisine)" "401" "$c" "$r"

c=$(hcode "$O" -X POST -H 'Content-Type: application/json' -d 'pas du json' "$BASE/v1/pause")
[[ "$c" == 401 ]] && r=PASS || r=FAIL
record A05 "corps non-JSON (sans jeton)" "401" "$c" "$r"

# jeton valide, mais chaque route protégée
allok=ok
for route in enqueue play pause resume stop seek; do
  c=$(hcode "$O" -X POST -H 'Content-Type: application/json' -d '{"protocolVersion":"1.0"}' "$BASE/v1/$route")
  [[ "$c" == 401 ]] || allok="$route=$c"
done
[[ "$allok" == ok ]] && r=PASS || r=FAIL
record A06 "6 routes sans jeton -> 401" "toutes 401" "$allok" "$r"

# =========================================================================
# B. Origin (le Core n'a aucun client navigateur)
# =========================================================================
for pair in "evil=http://evil.example" "null=null" "file=file://"; do
  name="${pair%%=*}"; val="${pair#*=}"
  c=$(hcode "$O" -X POST -H 'Content-Type: application/json' -H "Origin: $val" -d "$(jbody "$TOKEN" '{}')" "$BASE/v1/pause")
  [[ "$c" == 403 && "$(body_code "$O")" == invalid_origin ]] && r=PASS || r=FAIL
  record "B-$name" "Origin=$val + jeton valide" "403 invalid_origin" "$c $(body_code "$O")" "$r"
done

# =========================================================================
# C. Host / rebinding DNS
# =========================================================================
c=$(hcode "$O" -H "Host: evil.example:$PORT" "$BASE/health")
[[ "$c" == 403 && "$(body_code "$O")" == invalid_host ]] && r=PASS || r=FAIL
record C01 "Host: evil.example:PORT (rebinding)" "403 invalid_host" "$c $(body_code "$O")" "$r"

c=$(hcode "$O" -H "Host: 127.0.0.1:1" "$BASE/health")
[[ "$c" == 403 ]] && r=PASS || r=FAIL
record C02 "Host: 127.0.0.1 mauvais port" "403" "$c" "$r"

c=$(hcode "$O" -H "Host: attacker.tld" "$BASE/health")
[[ "$c" == 403 ]] && r=PASS || r=FAIL
record C03 "Host: attacker.tld (sans port)" "403" "$c" "$r"

# Requête HTTP/1.0 sans en-tête Host : socket brute via bash + /dev/tcp
# (pas nc/zsh — zsh n'a pas /dev/tcp, nc n'est pas garanti installé).
raw="$(timeout 3 bash -c "exec 3<>/dev/tcp/127.0.0.1/$PORT && printf 'GET /health HTTP/1.0\r\n\r\n' >&3 && head -1 <&3" 2>/dev/null)"
[[ "$raw" == *403* ]] && r=PASS || r=FAIL
record C04 "HTTP/1.0 sans en-tête Host" "403" "${raw:-vide}" "$r"

# =========================================================================
# D. WebSocket
# =========================================================================
c=$(ws_status "$BASE/v1/ws")
[[ "$c" == 401 ]] && r=PASS || r=FAIL
record D01 "upgrade WS sans jeton" "401" "$c" "$r"

c=$(ws_status "$BASE/v1/ws?token=faux")
[[ "$c" == 401 ]] && r=PASS || r=FAIL
record D02 "upgrade WS jeton faux" "401" "$c" "$r"

c=$(ws_status -H "Origin: http://evil.example" "$BASE/v1/ws?token=$TOKEN")
[[ "$c" == 403 ]] && r=PASS || r=FAIL
record D03 "upgrade WS jeton valide + Origin" "403" "$c" "$r"

c=$(ws_status "$BASE/v1/ws?token=$TOKEN")
[[ "$c" == 101 ]] && r=PASS || r=FAIL
record D04 "upgrade WS jeton valide (contrôle)" "101" "$c" "$r"

c=$(ws_status -H "Authorization: Bearer $TOKEN" "$BASE/v1/ws")
[[ "$c" == 101 ]] && r=PASS || r=FAIL
record D05 "upgrade WS via Bearer (contrôle)" "101" "$c" "$r"

# =========================================================================
# E. Chemins d'enfilage
# =========================================================================
c=$(hcode "$O" -X POST -H 'Content-Type: application/json' -d "$(jbody "$TOKEN" '{"segmentId":"s","path":"/etc/passwd","format":"wav"}')" "$BASE/v1/enqueue")
[[ "$c" == 403 && "$(body_code "$O")" == path_outside_cache ]] && r=PASS || r=FAIL
record E01 "enqueue /etc/passwd" "403 path_outside_cache" "$c $(body_code "$O")" "$r"

ln -sf /etc/passwd "$CACHE_DIR/link.wav"
c=$(hcode "$O" -X POST -H 'Content-Type: application/json' -d "$(jbody "$TOKEN" "$(jq -nc --arg p "$CACHE_DIR/link.wav" '{segmentId:"s",path:$p,format:"wav"}')")" "$BASE/v1/enqueue")
[[ "$c" == 403 && "$(body_code "$O")" == path_outside_cache ]] && r=PASS || r=FAIL
record E02 "enqueue lien symbolique -> /etc/passwd" "403 path_outside_cache" "$c $(body_code "$O")" "$r"

c=$(hcode "$O" -X POST -H 'Content-Type: application/json' -d "$(jbody "$TOKEN" "$(jq -nc --arg p "$CACHE_DIR/../../../etc/passwd" '{segmentId:"s",path:$p,format:"wav"}')")" "$BASE/v1/enqueue")
[[ "$c" == 400 && "$(body_code "$O")" == invalid_request ]] && r=PASS || r=FAIL
record E03 "enqueue traversal ../../../etc/passwd" "400 invalid_request" "$c $(body_code "$O")" "$r"

c=$(hcode "$O" -X POST -H 'Content-Type: application/json' -d "$(jbody "$TOKEN" "$(jq -nc --arg p "$CACHE_DIR/absent.wav" '{segmentId:"s",path:$p,format:"wav"}')")" "$BASE/v1/enqueue")
[[ "$c" == 404 && "$(body_code "$O")" == segment_not_found ]] && r=PASS || r=FAIL
record E04 "enqueue fichier absent (oracle?)" "404 segment_not_found" "$c $(body_code "$O")" "$r"

printf 'pas un wav du tout' > "$CACHE_DIR/bad.wav"
c=$(hcode "$O" -X POST -H 'Content-Type: application/json' -d "$(jbody "$TOKEN" "$(jq -nc --arg p "$CACHE_DIR/bad.wav" '{segmentId:"s",path:$p,format:"wav"}')")" "$BASE/v1/enqueue")
[[ "$c" == 400 && "$(body_code "$O")" == unsupported_format ]] && r=PASS || r=FAIL
record E05 "enqueue fichier non-WAV" "400 unsupported_format" "$c $(body_code "$O")" "$r"

# =========================================================================
# F. Épuisement de ressources
# =========================================================================
# F01 : corps JSON énorme (60 Mo) -> attendu 413 (limite axum 2 Mo)
big="$WORK/big.json"
{ printf '{"protocolVersion":"1.0","token":"%s","junk":"' "$TOKEN"; head -c 60000000 /dev/zero | tr '\0' 'a'; printf '"}'; } > "$big"
c=$(hcode "$O" -X POST -H 'Content-Type: application/json' --data-binary @"$big" "$BASE/v1/pause")
[[ "$c" == 413 ]] && r=PASS || r=FAIL
record F01 "corps JSON 60 Mo" "413 (limite)" "$c" "$r"

# F02 : PCM géant sur disque (200 Mo, > MAX_ENQUEUE_FILE_BYTES = 50 Mio,
# server.rs) -> refusé sur les métadonnées, avant toute lecture (F-01 corrigé).
big_pcm="$CACHE_DIR/huge.pcm"
head -c 200000000 /dev/zero > "$big_pcm"
c=$(hcode "$O" -X POST -H 'Content-Type: application/json' -d "$(jbody "$TOKEN" "$(jq -nc --arg p "$big_pcm" '{segmentId:"huge",path:$p,format:"pcm16le",sampleRate:22050,channels:1}')")" "$BASE/v1/enqueue")
[[ "$c" == 413 && "$(body_code "$O")" == file_too_large ]] && r=PASS || r=FAIL
record F02 "enqueue PCM 200 Mo (plafond taille)" "413 file_too_large" "$c $(body_code "$O")" "$r"
rm -f "$big_pcm"

# F03 : flood de /health (200 requêtes séquentielles) -> aucun throttle attendu
flood_fail=0
for _ in $(seq 1 200); do
  cc=$(curl -s -m 8 -o /dev/null -w '%{http_code}' "$BASE/health")
  [[ "$cc" == 200 ]] || flood_fail=$((flood_fail+1))
done
# Informationnel : on documente l'absence de limite ; PASS si le service survit.
kill -0 "$core_pid" 2>/dev/null && r=PASS || r=FAIL
record F03 "flood 200x /health (sans jeton)" "service survit (aucun throttle)" "echecs=$flood_fail vivant" "$r"

# =========================================================================
# G. État / cycle de vie
# =========================================================================
mode_file="$(stat -c %a "$STATE_FILE")"
[[ "$mode_file" == 600 ]] && r=PASS || r=FAIL
record G01 "core.json en 0600" "600" "$mode_file" "$r"

mode_dir="$(stat -c %a "$STATE_DIR")"
[[ "$mode_dir" == 700 ]] && r=PASS || r=FAIL
record G02 "dossier d'état en 0700" "700" "$mode_dir" "$r"

# G03 : seconde instance concurrente -> code 17
LLM_VOICE_CORE_STATE_DIR="$STATE_DIR" LLM_VOICE_CACHE_DIR="$CACHE_DIR" "$BIN" 2>/dev/null
sec=$?
[[ "$sec" == 17 ]] && r=PASS || r=FAIL
record G03 "seconde instance concurrente" "exit 17" "exit $sec" "$r"
[[ -f "$STATE_FILE" ]] && r=PASS || r=FAIL
record G04 "core.json intact après 2e instance" "présent" "$([[ -f "$STATE_FILE" ]] && echo présent || echo absent)" "$r"

# =========================================================================
# H. Réseau
# =========================================================================
if command -v ss >/dev/null; then
  listen="$(ss -H -ltnp 2>/dev/null | grep "pid=$core_pid," || true)"
  bad_listen="$(echo "$listen" | awk '{print $4}' | grep -v '^127\.0\.0\.1:' || true)"
  [[ -n "$listen" && -z "$bad_listen" ]] && r=PASS || r=FAIL
  record H01 "écoute 127.0.0.1 uniquement" "127.0.0.1:* seul" "${bad_listen:-127.0.0.1 seul}" "$r"

  # Connexion active pendant une lecture réelle (WAV minuscule) puis inspection.
  # Génère un WAV 8 bits mono trivial via un enqueue pcm valide + play.
  head -c 4000 /dev/zero > "$CACHE_DIR/tiny.pcm"
  curl -s -m 8 -o /dev/null -X POST -H 'Content-Type: application/json' \
    -d "$(jbody "$TOKEN" "$(jq -nc --arg p "$CACHE_DIR/tiny.pcm" '{segmentId:"t",path:$p,format:"pcm16le",sampleRate:22050,channels:1}')")" "$BASE/v1/enqueue"
  curl -s -m 8 -o /dev/null -X POST -H 'Content-Type: application/json' -d "$(jbody "$TOKEN" '{"segmentId":"t"}')" "$BASE/v1/play"
  outbound="$(ss -H -tnp 2>/dev/null | grep "pid=$core_pid," | awk '{print $5}' | grep -v '^127\.0\.0\.1:' | grep -v '^\[::1\]:' || true)"
  [[ -z "$outbound" ]] && r=PASS || r=FAIL
  record H02 "aucune connexion sortante pendant lecture" "aucune" "${outbound:-aucune}" "$r"
fi

# =========================================================================
# I. Cycle de vie : arrêt quand --parent-pid meurt (ADR-012 §5, F-02 corrigé)
# =========================================================================
STATE2="$WORK/state2"; CACHE2="$WORK/cache2"; mkdir -p "$CACHE2"
# "Parent" éphémère : un sous-shell qui meurt vite après avoir publié son PID.
sleep 1 &
parent_pid=$!
LLM_VOICE_CORE_STATE_DIR="$STATE2" LLM_VOICE_CACHE_DIR="$CACHE2" \
  "$BIN" --parent-pid "$parent_pid" >/dev/null 2>&1 &
orphan=$!
wait "$parent_pid" 2>/dev/null || true
# Le Core sonde /proc/<parent_pid> au plus toutes les secondes (main.rs) :
# lui laisser jusqu'à 3 s pour constater la mort du parent et s'arrêter.
deadline=$((SECONDS + 3))
while kill -0 "$orphan" 2>/dev/null && [[ $SECONDS -lt $deadline ]]; do sleep 0.1; done
if kill -0 "$orphan" 2>/dev/null; then
  r=FAIL; obt="vivant (orphelin)"
else
  r=PASS; obt="arrêté"
fi
record I01 "arrêt quand --parent-pid meurt (ADR-012 §5)" "s'arrête" "$obt" "$r"
kill -TERM "$orphan" 2>/dev/null || true

# =========================================================================
# Tableau
# =========================================================================
echo
printf '%-6s | %-46s | %-22s | %-22s | %s\n' "ID" "Attaque" "Attendu" "Obtenu" "Verdict"
printf '%s\n' "-------|------------------------------------------------|------------------------|------------------------|--------"
for row in "${ROWS[@]}"; do echo "$row"; done
echo
echo "Total: $total  Échecs/failles: $fails"
[[ "$fails" -eq 0 ]] && exit 0 || exit 1
