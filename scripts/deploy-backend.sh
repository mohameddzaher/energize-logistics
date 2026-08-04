#!/usr/bin/env bash
#
# deploy-backend.sh — ship the API to the VPS, prove it works, roll back if not.
#
#   ./scripts/deploy-backend.sh              deploy
#   ./scripts/deploy-backend.sh --check      verify what is live now, change nothing
#   ./scripts/deploy-backend.sh --rollback   go back to the previous release
#
# Why this exists: both production incidents in this project came from a deploy
# that "succeeded".
#   • 2026-07-19 — a full-directory rsync overwrote the VPS .env, so NODE_ENV
#     became development and every login failed CORS.
#   • 2026-07-26 — nginx got literal \$ escapes in the websocket headers; every
#     handshake returned 400 and NO page live-refreshed for weeks. Nobody
#     noticed, because the API itself answered 200 the whole time.
# Neither would survive the checks below. A deploy is not done when the files
# land; it is done when the thing works.
set -euo pipefail

VPS_HOST="${VPS_HOST:-root@152.239.127.46}"
VPS_KEY="${VPS_KEY:-$HOME/.ssh/energize_vps}"
APP_DIR="/opt/energize/backend"
RELEASES="/opt/energize/releases"
PM2_NAME="energize-api"
API="https://api.energize-logistics.com"
SITE="https://energize-logistics.com"
KEEP_RELEASES=5
# puppeteer's postinstall tries to fetch a browser and fails on this VPS (no
# unzip / restricted egress); the app uses the system Chromium instead. Without
# this, `npm install` exits non-zero and leaves node_modules half-written.
NPM_ENV="PUPPETEER_SKIP_DOWNLOAD=true PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true"

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SSH=(ssh -i "$VPS_KEY" -o ConnectTimeout=15 "$VPS_HOST")

c_ok=$'\e[32m'; c_bad=$'\e[31m'; c_dim=$'\e[2m'; c_off=$'\e[0m'
say()  { printf '\n\e[1m%s\e[0m\n' "$*"; }
good() { printf '  %s✓%s %s\n' "$c_ok" "$c_off" "$*"; }
bad()  { printf '  %s✗%s %s\n' "$c_bad" "$c_off" "$*"; }
note() { printf '  %s%s%s\n' "$c_dim" "$*" "$c_off"; }

fails=0
check() { # check <label> <actual> <expected>
  if [[ "$2" == "$3" ]]; then good "$1 ${c_dim}($2)${c_off}"; else bad "$1 — got $2, expected $3"; fails=$((fails+1)); fi
}

# Give the process a chance to finish booting before judging it. A rollback
# triggered by an app that simply had not listened yet would be a self-inflicted
# outage — which is exactly what happened the first time this script ran.
wait_ready() {
  local tries=${1:-20}
  for ((i=1; i<=tries; i++)); do
    [[ "$(curl -s -o /dev/null -w '%{http_code}' --max-time 10 "$API/api/health")" == "200" ]] && {
      note "ready after ${i}s"; return 0; }
    sleep 3
  done
  return 1
}

# ── The health gate ─────────────────────────────────────────────────────────
# Everything a user needs in order for the app to actually work, not just to
# return bytes. Used after a deploy AND on its own via --check.
verify() {
  fails=0
  say "Verifying $API"

  check "API answers"            "$(curl -s -o /dev/null -w '%{http_code}' --max-time 20 "$API/api/health")" "200"

  # A route that is MOUNTED answers 401 (needs auth). A 404 means the deploy
  # dropped it — which is exactly what a half-copied release looks like.
  for route in /api/reports/subjects /api/business-review/meta /api/ls2/store /api/partners /api/admin/permissions; do
    check "mounted: $route" "$(curl -s -o /dev/null -w '%{http_code}' --max-time 20 "$API$route")" "401"
  done

  # The 2026-07-26 incident. 101 = the upgrade really happened.
  check "websocket upgrade" "$(curl -s -o /dev/null -w '%{http_code}' --max-time 20 \
      -H 'Connection: Upgrade' -H 'Upgrade: websocket' -H 'Sec-WebSocket-Version: 13' \
      -H 'Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==' \
      "$API/socket.io/?EIO=4&transport=websocket")" "101"

  # The 2026-07-19 incident: a wrong origin fails the browser, not curl, so ask
  # for the CORS header explicitly.
  local origin
  origin=$(curl -s -o /dev/null -D - --max-time 20 -H 'Origin: https://energize-logistics.com' \
      "$API/api/health" | tr -d '\r' | awk -F': ' 'tolower($1)=="access-control-allow-origin"{print $2}')
  check "CORS allows the site" "${origin:-none}" "https://energize-logistics.com"

  # The process, and the env it is actually running with.
  check "pm2 online"  "$("${SSH[@]}" "pm2 jlist" 2>/dev/null | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{const p=JSON.parse(s).find(x=>x.name==="'"$PM2_NAME"'");console.log(p?p.pm2_env.status:"missing")}catch(e){console.log("unreadable")}})')" "online"
  check "NODE_ENV"    "$("${SSH[@]}" "grep -m1 '^NODE_ENV=' $APP_DIR/.env | cut -d= -f2" 2>/dev/null | tr -d '\r')" "production"
  check ".env present" "$("${SSH[@]}" "test -f $APP_DIR/.env && echo yes || echo NO" 2>/dev/null | tr -d '\r')" "yes"
  check "uploads kept" "$("${SSH[@]}" "test -d $APP_DIR/uploads && echo yes || echo NO" 2>/dev/null | tr -d '\r')" "yes"

  # The site itself. Netlify deploys separately, but "production is fine" is not
  # true if the frontend is serving a stale bundle or 404ing its own routes.
  check "site answers"          "$(curl -s -o /dev/null -w '%{http_code}' --max-time 20 "$SITE/")" "200"
  check "site route: reports"   "$(curl -s -o /dev/null -w '%{http_code}' --max-time 20 "$SITE/system/reports")" "200"
  # Control: a path that does not exist MUST 404, otherwise the two checks above
  # prove nothing (a catch-all would answer 200 for anything).
  check "site 404s unknown path" "$(curl -s -o /dev/null -w '%{http_code}' --max-time 20 "$SITE/system/zzz-no-such-page")" "404"

  # Nothing crash-looping: a restart storm shows as a climbing restart count.
  note "restarts: $("${SSH[@]}" "pm2 jlist" 2>/dev/null | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{const p=JSON.parse(s).find(x=>x.name==="'"$PM2_NAME"'");console.log(p?p.pm2_env.restart_time:"?")}catch(e){console.log("?")}})')"

  if (( fails )); then bad "$fails check(s) failed"; return 1; fi
  good "all checks passed"
  return 0
}

rollback() {
  say "Rolling back"
  local prev
  prev=$("${SSH[@]}" "ls -1 $RELEASES 2>/dev/null | sort | tail -1" | tr -d '\r')
  if [[ -z "$prev" ]]; then bad "no saved release to roll back to"; exit 1; fi
  note "restoring $prev"
  # --exclude node_modules is the one that matters here. The backup deliberately
  # does not contain node_modules, so a --delete without this exclude DELETES
  # every installed dependency and the app dies with MODULE_NOT_FOUND. That is
  # not a hypothetical: it is how this script took production down on its first
  # run, turning a single failed health check into a real outage. A rollback must
  # never be able to do more damage than the deploy it is undoing.
  if ! "${SSH[@]}" "rsync -a --delete --exclude node_modules --exclude .env --exclude uploads $RELEASES/$prev/ $APP_DIR/"; then
    bad "could not restore the files — the running process is untouched, fix by hand"; exit 1
  fi
  # Dependencies only need reinstalling if the restored package.json disagrees
  # with what is installed; run it, but never restart on a failed install.
  if ! "${SSH[@]}" "cd $APP_DIR && $NPM_ENV npm install --omit=dev >/tmp/npm-rollback.log 2>&1"; then
    bad "npm install failed during rollback"; "${SSH[@]}" "tail -15 /tmp/npm-rollback.log"; exit 1
  fi
  "${SSH[@]}" "pm2 restart $PM2_NAME >/dev/null"
  wait_ready 20 || true
  verify && good "rolled back to $prev" || { bad "still unhealthy after rollback — needs a human"; exit 1; }
}

case "${1:-deploy}" in
  --check)    verify; exit $?;;
  --rollback) rollback; exit 0;;
  deploy|"")  ;;
  *) echo "usage: $0 [--check|--rollback]"; exit 2;;
esac

# ── Pre-flight ──────────────────────────────────────────────────────────────
say "Pre-flight"
cd "$ROOT"
if [[ -n "$(git status --porcelain)" ]]; then
  bad "working tree is dirty — commit first, so what is live matches a commit"
  git status --short | head -10
  exit 1
fi
good "working tree clean at $(git rev-parse --short HEAD)"

# Syntax-check every file being shipped. A parse error would otherwise be found
# by pm2, after the old code is already gone.
if ! find backend/src -name '*.js' -print0 | xargs -0 -n40 node --check >/dev/null 2>&1; then
  bad "a backend file does not parse:"
  find backend/src -name '*.js' -print0 | xargs -0 -n1 node --check 2>&1 | head -5
  exit 1
fi
good "all backend files parse"
"${SSH[@]}" 'echo ok' >/dev/null && good "VPS reachable"

# ── Back up the running release, then ship ──────────────────────────────────
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
say "Backing up the running release → $RELEASES/$STAMP"
"${SSH[@]}" "mkdir -p $RELEASES/$STAMP && rsync -a --exclude node_modules --exclude .env --exclude uploads $APP_DIR/ $RELEASES/$STAMP/"
good "saved"

say "Shipping"
# --exclude .env and --exclude uploads are NOT optional: --delete would take the
# server's environment file and every uploaded HR/contract document with it.
rsync -az --delete -e "ssh -i $VPS_KEY -o ConnectTimeout=15" \
  --exclude node_modules --exclude .git --exclude .env --exclude uploads --exclude '*.log' \
  backend/ "$VPS_HOST:$APP_DIR/"
good "files in place"

if ! "${SSH[@]}" "cd $APP_DIR && $NPM_ENV npm install --omit=dev >/tmp/npm-deploy.log 2>&1"; then
  bad "npm install failed on the server — NOT restarting; the old process is still serving"
  "${SSH[@]}" "tail -15 /tmp/npm-deploy.log"
  exit 1
fi
good "dependencies installed"
"${SSH[@]}" "pm2 restart $PM2_NAME >/dev/null"
good "$PM2_NAME restarted"

# ── Prove it, or put it back ────────────────────────────────────────────────
note "waiting for the app to come up…"
wait_ready 20 || note "did not answer within 60s — verifying anyway"

if verify; then
  "${SSH[@]}" "cd $RELEASES && ls -1 | sort | head -n -$KEEP_RELEASES | xargs -r rm -rf"
  say "Deployed $(git rev-parse --short HEAD) — healthy"
  note "previous release kept at $RELEASES/$STAMP"
else
  say "Deploy FAILED verification — rolling back automatically"
  rollback
  exit 1
fi
