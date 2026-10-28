#!/bin/bash
# Builds (if needed) and serves the QA web from its OWN folder (frontend/.next-qa),
# pointed at the local QA API. A production deploy builds frontend/.next and
# never touches this one — and this never touches it.
#   qa/web.sh           build if missing, then serve on 127.0.0.1:3055
#   qa/web.sh --rebuild force a fresh build
set -euo pipefail
QA="$(cd "$(dirname "$0")" && pwd)"; FE="$(dirname "$QA")/frontend"
mkdir -p "$QA/out"
pkill -f "next start -p 3055" 2>/dev/null || true
if [ "${1:-}" = "--rebuild" ] || [ ! -f "$FE/.next-qa/BUILD_ID" ]; then
  rm -rf "$FE/.next-qa"
  ( cd "$FE" && NEXT_DIST_DIR=.next-qa NEXT_PUBLIC_API_URL=http://127.0.0.1:5055 BUILD_ID_OVERRIDE=qa-local npx next build > "$QA/out/web-build.log" 2>&1 ) \
    || { echo "QA web build failed — see qa/out/web-build.log"; exit 1; }
fi
( cd "$FE" && NEXT_DIST_DIR=.next-qa nohup npx next start -p 3055 -H 127.0.0.1 > "$QA/out/web.log" 2>&1 ) &
disown
for i in $(seq 1 40); do curl -s -o /dev/null 127.0.0.1:3055/login && break; sleep 1; done
echo "QA web up — http://127.0.0.1:3055 (build: frontend/.next-qa → API 127.0.0.1:5055)"
