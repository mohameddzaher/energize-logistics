#!/usr/bin/env bash
#
# نشرُ الواجهة على خادمنا — بديلُ Netlify.
#
# ── العلّة ────────────────────────────────────────────────────────────────────
# الواجهةُ كانت تُبنى وتُنشَر في Netlify من فرع `main`. وحين ينفد رصيدُ الباقة
# **تُتخطّى النشراتُ صامتةً**: الشيفرةُ في GitHub، والموقعُ الحيُّ واقفٌ عند آخر
# نشرةٍ نجحت — تسعُ نشراتٍ متتالية في هذه المرّة. ولا شيءَ في الموقع يقول ذلك:
# المستخدمُ يفتح الصفحةَ فلا يجد ما بُني له، ويُقال «النظامُ لم يتغيّر».
#
# وبناءُ الواجهة عملٌ يتمّ على جهازنا في دقائق، والخادمُ عندنا يشغّل الـAPI
# أصلًا (٨ جيجا ونواتان، والمستعمَلُ منها الخمس). فلا حاجةَ إلى وسيطٍ يتوقّف
# بانتهاء رصيد: تُبنى هنا وتُرفَع هناك وتُشغَّل تحت pm2 خلف nginx نفسِه الذي
# يخدم الـAPI — فالموقعُ والـAPI على خادمٍ واحد، ويُختصَر طريقُ كلّ نداء.
#
#   bash scripts/deploy-web.sh
#
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
# ── والبناءُ يُعاد كاملًا ────────────────────────────────────────────────────
# ذاكرةُ `.next` القديمةُ تخلط صفحاتٍ حُذفت بأخرى أُضيفت، فيخرج موقعٌ نصفُه
# قديم. والبناءُ الكامل دقيقتان.
rm -rf .next
NEXT_PUBLIC_API_URL="${NEXT_PUBLIC_API_URL:-https://api.energize-logistics.com}" npm run build \
  | tail -3 || die "فشل البناء"
[ -d .next ] || die "لم يُنتَج .next"
ok "بُنيت الواجهة"

say "Upload"
# ما يلزم للتشغيل فقط: الناتج، والعامّ، ووصفُ الحزم، والإعدادات.
# و`node_modules` لا تُرفَع — تُثبَّت هناك (أسرعُ وأسلم من نسخ عشرات الآلاف من الملفّات).
rsync -az --delete -e "ssh -i $VPS_KEY -o ConnectTimeout=20" \
  --exclude 'cache' \
  "$HERE/frontend/.next/" "$VPS_HOST:$REMOTE/.next/"
rsync -az --delete -e "ssh -i $VPS_KEY -o ConnectTimeout=20" \
  "$HERE/frontend/public/" "$VPS_HOST:$REMOTE/public/"
rsync -az -e "ssh -i $VPS_KEY -o ConnectTimeout=20" \
  "$HERE/frontend/package.json" "$HERE/frontend/package-lock.json" "$HERE/frontend/next.config.ts" \
  "$VPS_HOST:$REMOTE/"
ok "رُفعت إلى $REMOTE"

say "Install & run"
"${SSH[@]}" bash -s <<REMOTE_SCRIPT
set -euo pipefail
cd "$REMOTE"
# حزمُ التشغيل وحدَها — أدواتُ البناء بقيت على جهازنا.
npm ci --omit=dev --no-audit --no-fund >/dev/null 2>&1 || npm install --omit=dev --no-audit --no-fund >/dev/null
# المتغيّرُ الوحيد الذي تحتاجه الواجهة: أين الـAPI. وهو على الخادم نفسِه،
# فتُنادى محلّيًّا بلا خروجٍ إلى الشبكة ولا شهادةٍ تُفحَص.
cat > .env.production <<ENVFILE
NEXT_PUBLIC_API_URL=http://127.0.0.1:5001
PORT=$PORT
ENVFILE
if pm2 describe energize-web >/dev/null 2>&1; then
  pm2 restart energize-web --update-env >/dev/null
else
  pm2 start "npx next start -p $PORT" --name energize-web --cwd "$REMOTE" >/dev/null
fi
pm2 save >/dev/null 2>&1 || true
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
printf '  \033[2mلتصير هي الموقعَ الحيّ: وجِّه سجلَّ DNS للدومين إلى %s (بدل Netlify).\033[0m\n' "${VPS_HOST#*@}"
