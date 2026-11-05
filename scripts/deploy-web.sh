#!/usr/bin/env bash
# Deploys the web frontend on our own server, replacing Netlify. Cause: the frontend was built and deployed by Netlify from `main`, and when the plan credit runs out deploys are skipped silently, so GitHub has the code while the live site stays on the last successful deploy, with nothing on the site saying so. The build takes minutes on our machine and the server already runs the API, so no credit-limited middleman is needed: build here, upload there, run under pm2 behind the same nginx as the API, which also shortens every call. Usage: bash scripts/deploy-web.sh
set -euo pipefail

VPS_HOST="${VPS_HOST:-root@152.239.127.46}"
VPS_KEY="${VPS_KEY:-$HOME/.ssh/energize_vps}"
REMOTE="/opt/energize/web"
PORT="${WEB_PORT:-3000}"
SSH=(ssh -i "$VPS_KEY" -o ConnectTimeout=20 "$VPS_HOST")
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

say() { printf '\n\033[1m%s\033[0m\n' "$1"; }
ok()  { printf '  \033[32m✓\033[0m %s\n' "$1"; }
die() { printf '  \033[31m✗\033[0m %s\n' "$1"; exit 1; }

say "Build"
cd "$HERE/frontend"
# The build is always done from scratch: an old `.next` cache mixes deleted pages with added ones and yields a half-old site. A full build takes two minutes.
rm -rf .next
NEXT_PUBLIC_API_URL="${NEXT_PUBLIC_API_URL:-https://api.energize-logistics.com}" npm run build \
  | tail -3 || die "فشل البناء"
[ -d .next ] || die "لم يُنتَج .next"
ok "بُنيت الواجهة"

say "Upload"
# Order matters. While the old web server runs, it renders from whatever build is on disk but serves only the static files it knew at start, so a page opened between replacing the build and the restart asked for new chunks, got 404 and showed «حدث خطأ غير متوقع» (2026-11-05, during one of many deploys).
# So: new static files, public and manifests first (add-only, harmless to the old server); install packages while the old build is still in place; then swap the build and restart at once, leaving a window of seconds instead of the minute npm took.
# Old `static` files are kept: names are content hashes, so old tabs keep loading theirs; files older than a week are removed after the restart.
rsync -az -e "ssh -i $VPS_KEY -o ConnectTimeout=20" \
  "$HERE/frontend/.next/static/" "$VPS_HOST:$REMOTE/.next/static/"
rsync -az --delete -e "ssh -i $VPS_KEY -o ConnectTimeout=20" \
  "$HERE/frontend/public/" "$VPS_HOST:$REMOTE/public/"
rsync -az -e "ssh -i $VPS_KEY -o ConnectTimeout=20" \
  "$HERE/frontend/package.json" "$HERE/frontend/package-lock.json" "$HERE/frontend/next.config.ts" \
  "$VPS_HOST:$REMOTE/"

say "Install"
"${SSH[@]}" bash -s <<REMOTE_SCRIPT
set -euo pipefail
cd "$REMOTE"
# Runtime packages only; build tools stay on our machine.
npm ci --omit=dev --no-audit --no-fund >/dev/null 2>&1 || npm install --omit=dev --no-audit --no-fund >/dev/null
# The API URL is not written here, and no backtick appears in this paragraph: it sits inside an unquoted heredoc, so text between backticks runs as a command locally before anything reaches the server (this caused "NEXT_PUBLIC_*: command not found"). This file used to write NEXT_PUBLIC_API_URL=http://127.0.0.1:5001 on the idea that the frontend calls the API from inside the server. That is an illusion: NEXT_PUBLIC_* variables are baked into the bundle at build time, not read at runtime. The line does nothing while the build runs on our machine, and that is the danger: if the frontend were ever built on the server, 127.0.0.1 would be baked into the JavaScript sent to browsers, which can never reach the server's localhost, and the site would fail for everyone. Browser calls need a public address anyway, so there is no gain.
cat > .env.production <<ENVFILE
PORT=$PORT
ENVFILE
REMOTE_SCRIPT

say "Swap & run"
rsync -az --delete -e "ssh -i $VPS_KEY -o ConnectTimeout=20" \
  --exclude 'cache' --exclude 'static' \
  "$HERE/frontend/.next/" "$VPS_HOST:$REMOTE/.next/"
ok "رُفعت إلى $REMOTE"
"${SSH[@]}" bash -s <<REMOTE_SCRIPT
set -euo pipefail
cd "$REMOTE"
if pm2 describe energize-web >/dev/null 2>&1; then
  pm2 restart energize-web --update-env >/dev/null
else
  pm2 start "npx next start -p $PORT" --name energize-web --cwd "$REMOTE" >/dev/null
fi
pm2 save >/dev/null 2>&1 || true
# Files left from earlier deploys for over a week; nobody requests them any more.
find "$REMOTE/.next/static" -type f -mtime +7 -delete 2>/dev/null || true
find "$REMOTE/.next/static" -type d -empty -delete 2>/dev/null || true
sleep 3
pm2 describe energize-web | grep -E "status|restarts" | head -2
REMOTE_SCRIPT
ok "pm2: energize-web"

say "Health"
code=$("${SSH[@]}" "curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:$PORT/login")
[ "$code" = "200" ] && ok "الصفحة تُخدَم محلّيًّا ($code)" || die "الصفحة لا تُخدَم ($code)"
ver=$("${SSH[@]}" "curl -s http://127.0.0.1:$PORT/login | grep -o 'buildId[^,]*' | head -1" || true)
printf '  \033[2m%s\033[0m\n' "$ver"

printf '\n\033[1mالواجهةُ تعمل على الخادم.\033[0m\n'
# The domain already points at us: the root A record points to this server through Cloudflare. A line saying to point DNS here made every deploy claim the release had not arrived yet, but it has.
printf '  \033[2mالموقعُ الحيُّ هو هذا: energize-logistics.com ← %s عبر Cloudflare.\033[0m\n' "${VPS_HOST#*@}"
printf '  \033[2mوللرجوع إلى Netlify عند الحاجة: أعِد سجلَّ A إلى 75.2.60.5 — الرجوعُ فوريّ.\033[0m\n'
