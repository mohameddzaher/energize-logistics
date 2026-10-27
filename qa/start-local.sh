#!/bin/bash
# Starts the whole system locally on a throwaway database — never production.
#
#   mongod   127.0.0.1:27099  (data in qa/.data, wiped by `seed`)
#   backend  127.0.0.1:5055   started from an EMPTY folder with `env -i`, so
#            backend/.env (production secrets + the Atlas URI) is never read
#   web      127.0.0.1:3055   (next dev, pointed at the local backend)
#
# Every external service points at a dead address (127.0.0.1:9): the ops
# platform, Wialon/LS2, keep-alive. Mail is written to JSON, never sent.
set -euo pipefail
QA="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(dirname "$QA")"
mkdir -p "$QA/.data/db" "$QA/.data/cwd" "$QA/out"
[ -f "$QA/.data/cwd/.env" ] && { echo "refusing: an .env exists in the QA cwd"; exit 1; }

if ! nc -z 127.0.0.1 27099 2>/dev/null; then
  mongod --dbpath "$QA/.data/db" --port 27099 --bind_ip 127.0.0.1 > "$QA/out/mongod.log" 2>&1 &
  for i in $(seq 1 30); do nc -z 127.0.0.1 27099 && break; sleep 0.5; done
fi

pkill -f "$ROOT/backend/src/server.js" 2>/dev/null || true
for i in $(seq 1 20); do nc -z 127.0.0.1 5055 2>/dev/null || break; sleep 0.5; done
DEAD=http://127.0.0.1:9
( cd "$QA/.data/cwd" && exec env -i PATH="$PATH" HOME="$HOME" QA_BACKEND=1 \
  PORT=5055 NODE_ENV=development \
  MONGODB_URI=mongodb://127.0.0.1:27099/qa MONGO_URI=mongodb://127.0.0.1:27099/qa DATABASE_URL=mongodb://127.0.0.1:27099/qa \
  NODE_APP_INSTANCE=1 MAIL_TRANSPORT=json MAIL_SMTP_HOST=127.0.0.1 MAIL_IMAP_HOST=127.0.0.1 \
  JWT_ACCESS_SECRET=qa-access-secret-0123456789 JWT_REFRESH_SECRET=qa-refresh-secret-0123456789 \
  JWT_ACCESS_EXPIRY=12h EMAIL_VAULT_KEY=0123456789abcdef0123456789abcdef FLEET_API_KEY=qa-partner-key \
  UPL_BASE_URL=$DEAD UPL_API_KEY=qa UPL_ADMIN_EMAIL=qa@local.test UPL_ADMIN_PASSWORD=qa UPL_WEBHOOK_SECRET=qa \
  LS2_BASE_URL=$DEAD/wialon/ajax.html LS2_TOKEN=qa LS2_POLL_ENABLED=false \
  KEEPALIVE_ENABLED=false KEEPALIVE_URL=$DEAD FRONTEND_URL=http://127.0.0.1:3055 RENDER_EXTERNAL_URL=$DEAD \
  COLLECTIONS_MAILBOX=qa@local.test COLLECTIONS_MANAGER_EMAIL=qa@local.test \
  node "$ROOT/backend/src/server.js" > "$QA/out/backend.log" 2>&1 ) &
for i in $(seq 1 60); do curl -s -o /dev/null 127.0.0.1:5055/api/health && break; sleep 1; done

if [ "${1:-}" != "--no-web" ]; then
  pkill -f "next dev -p 3055" 2>/dev/null || true
  ( cd "$ROOT/frontend" && NEXT_PUBLIC_API_URL=http://127.0.0.1:5055 npx next dev -p 3055 > "$QA/out/web.log" 2>&1 ) &
  for i in $(seq 1 90); do curl -s -o /dev/null 127.0.0.1:3055/login && break; sleep 2; done
fi
echo "QA stack up — api http://127.0.0.1:5055 · web http://127.0.0.1:3055 · db mongodb://127.0.0.1:27099/qa"
