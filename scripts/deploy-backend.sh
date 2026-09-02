#!/usr/bin/env bash
#
# deploy-backend.sh — ship the API to the VPS, prove it works, roll back if not.
#
#   ./scripts/deploy-backend.sh              deploy
#   ./scripts/deploy-backend.sh --check      verify what is live now, change nothing
#   ./scripts/deploy-backend.sh --rollback   go back to the previous release
#   ./scripts/deploy-backend.sh --diff       are the files on the VPS identical?
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
failed_list=""
check() { # check <label> <actual> <expected>
  if [[ "$2" == "$3" ]]; then
    good "$1 ${c_dim}($2)${c_off}"
  else
    bad "$1 — got $2, expected $3"
    fails=$((fails+1))
    # Name the failures again at the end. A rollback that only says "1 check
    # failed" tells whoever reads the log nothing about what to look at.
    failed_list="${failed_list}${failed_list:+, }$1 (got $2)"
  fi
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
#
# Only BACKEND facts may fail this gate, because rolling the backend back is the
# only remedy it has. Frontend state is reported, never fatal.
verify() {
  fails=0
  failed_list=""
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

  # ── وكلُّ عاملٍ على المنفذ يجب أن يكون عاملًا يعرفه pm2 ───────────────────
  #
  # الحادثة: مستخدمٌ يعدّل كشفًا فيُقال له «خارج صلاحيّتك» لعمودين يملكهما،
  # مرّةً من كلّ ثلاث. والسبب لم يكن الصلاحيات: على المنفذ ثلاثةُ عمّال، وpm2
  # يعرف اثنين. الثالث بقيّةُ إعادةِ تشغيلٍ سابقة، أفلت من `reload` وظلّ ممسكًا
  # بالمنفذ المشترَك ثلاثَ ساعات — فالنواةُ توزّع الطلبات على ثلاثةٍ أحدُهم
  # يشغّل كودًا قديمًا. والنشرُ يقول «سليم» لأنّه يسأل أوّلَ عاملٍ فيجده جديدًا.
  #
  # فيُعَدُّ العمّالُ لا يُسأل أوّلُهم: كلُّ ما يشغّل `server.js` ولا يعرفه pm2
  # يتيمٌ يُقتَل. عاملٌ واحدٌ متخلّفٌ يُبطل النشرَ كلَّه، وبصمت.
  #
  # والنمطُ مثبَّتُ الطرفين عن قصد: `pgrep -f` يطابق سطرَ الأمر كلَّه، فنمطٌ
  # حرٌّ يطابق أيضًا الصَّدَفةَ التي تحمل المسارَ في أمرها — أي أمرَ الفحص
  # نفسِه. جُرِّب فعَدَّ يتيمًا وهمًا؛ ولو مضى القتلُ على ذلك لقتل الفحصُ نفسَه.
  local stray
  stray=$("${SSH[@]}" "MANAGED=\$(pm2 jlist 2>/dev/null | node -e 'let s=\"\";process.stdin.on(\"data\",d=>s+=d).on(\"end\",()=>{try{console.log(JSON.parse(s).map(p=>p.pid).filter(Boolean).join(\" \"))}catch(e){console.log(\"\")}})'); n=0; for pid in \$(pgrep -f \"^node $APP_DIR/src/server.js\$\"); do case \" \$MANAGED \" in *\" \$pid \"*) ;; *) n=\$((n+1));; esac; done; echo \$n" 2>/dev/null | tr -d '\r')
  check "no stray workers on the port" "${stray:-unreadable}" "0"

  # ── وحدُّ كومة node مضبوطٌ دون حدّ pm2 ────────────────────────────────────
  # بدونه ترى node ثمانيةَ جيجا على الجهاز فتضبط حدَّها على ٢٠٩٦ ميجا ولا تجمع
  # القمامةَ جادًّا قبلها، فتقتلها pm2 عند ٩٠٠ — إعادةُ تشغيلٍ كلَّ ثلاث دقائق
  # بلا خطأٍ في السجلّ. وهو إعدادٌ يضيع بأيّ `pm2 delete` ثمّ `pm2 start` بغير
  # ملفّ الإعداد، فيُفحَص لا يُفترَض.
  check "node heap capped under pm2" "$("${SSH[@]}" "pm2 jlist" 2>/dev/null | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{const a=JSON.parse(s).filter(x=>x.name==="'"$PM2_NAME"'");console.log(a.length&&a.every(p=>String(p.pm2_env.node_args||"").includes("max-old-space-size"))?"yes":"NO")}catch(e){console.log("unreadable")}})')" "yes"

  # The process, and the env it is actually running with.
  check "pm2 online"  "$("${SSH[@]}" "pm2 jlist" 2>/dev/null | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{const p=JSON.parse(s).find(x=>x.name==="'"$PM2_NAME"'");console.log(p?p.pm2_env.status:"missing")}catch(e){console.log("unreadable")}})')" "online"
  check "NODE_ENV"    "$("${SSH[@]}" "grep -m1 '^NODE_ENV=' $APP_DIR/.env | cut -d= -f2" 2>/dev/null | tr -d '\r')" "production"
  check ".env present" "$("${SSH[@]}" "test -f $APP_DIR/.env && echo yes || echo NO" 2>/dev/null | tr -d '\r')" "yes"
  check "uploads kept" "$("${SSH[@]}" "test -d $APP_DIR/uploads && echo yes || echo NO" 2>/dev/null | tr -d '\r')" "yes"

  # أنهي كوميت شغّال هناك، ومطابق للي عندك ولا لأ.
  local live_commit here_commit
  live_commit=$("${SSH[@]}" "cat $APP_DIR/.deployed-commit 2>/dev/null" | tr -d '\r')
  here_commit=$(git -C "$ROOT" rev-parse HEAD 2>/dev/null || echo '')
  if [[ -z "$live_commit" ]]; then
    note "commit: البرودكشن مش مختوم (اتنشر قبل ما الختم يتضاف) — قارن بـ --diff"
  elif [[ "$live_commit" == "$here_commit" ]]; then
    good "commit ${c_dim}($(git -C "$ROOT" rev-parse --short HEAD)) — مطابق للي عندك${c_off}"
  else
    printf '  %s!%s commit: البرودكشن على %s وإنت على %s\n' "$c_bad" "$c_off" \
      "${live_commit:0:8}" "${here_commit:0:8}"
    note "informational — انشر لو ده مش مقصود"
  fi

  # The site is REPORTED but does not gate the backend. Netlify deploys on its own
  # schedule, and a push that lands here mid-rebuild made a perfectly good API
  # deploy "fail" and roll itself back — for a frontend blip that rolling the API
  # back could not possibly fix. Report it; let a human judge it.
  local site_root site_route site_404
  site_root=$(curl -s -o /dev/null -w '%{http_code}' --max-time 20 "$SITE/")
  site_route=$(curl -s -o /dev/null -w '%{http_code}' --max-time 20 "$SITE/system/reports")
  # Control: a path that does not exist MUST 404, or the two above prove nothing.
  site_404=$(curl -s -o /dev/null -w '%{http_code}' --max-time 20 "$SITE/system/zzz-no-such-page")
  if [[ "$site_root" == "200" && "$site_route" == "200" && "$site_404" == "404" ]]; then
    good "site healthy ${c_dim}(Netlify — informational)${c_off}"
  else
    printf '  %s!%s site: / =%s, /system/reports =%s, unknown-path =%s (want 200/200/404)\n' "$c_bad" "$c_off" "$site_root" "$site_route" "$site_404"
    note "informational only — Netlify may be mid-rebuild; not rolling the API back for this"
  fi

  # Nothing crash-looping: a restart storm shows as a climbing restart count.
  note "restarts: $("${SSH[@]}" "pm2 jlist" 2>/dev/null | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{const p=JSON.parse(s).find(x=>x.name==="'"$PM2_NAME"'");console.log(p?p.pm2_env.restart_time:"?")}catch(e){console.log("?")}})')"

  if (( fails )); then bad "$fails check(s) failed: $failed_list"; return 1; fi
  good "all checks passed"
  return 0
}

# Verify, and if it fails, verify ONCE more after a pause before believing it.
# Restarting behind nginx has a ~1s window where everything returns 502 together;
# a single unlucky sample there would otherwise revert a perfectly good deploy.
# Rolling back is disruptive, so it needs two opinions, not one.
verify_twice() {
  verify && return 0
  note "re-checking in 10s before rolling back (a restart has a brief 502 window)…"
  sleep 10
  verify
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
  # `reload` لا `restart`: التطبيق يعمل في نسختين بوضع العنقود، فتُستبدَل واحدةٌ
# بينما الأخرى تخدم. و`restart` كان يقتلهما معًا فيردّ nginx ٥٠٢ في تلك الثواني —
# قِيس ذلك: تسعون طلبًا أثناء إعادةٍ حيّة، تسعون نجحت وصفرٌ فشل.
"${SSH[@]}" "pm2 reload $PM2_NAME >/dev/null"
  wait_ready 20 || true
  verify && good "rolled back to $prev" || { bad "still unhealthy after rollback — needs a human"; exit 1; }
}

# هل الملفات اللي على السيرفر هي نفسها اللي عندي؟ الختم بيقول الكوميت، وده
# بيقول الملفات — والاتنين مش نفس السؤال: ممكن حد يعدّل ملف على السيرفر بإيده.
diff_source() {
  say "Comparing $ROOT/backend/src with $APP_DIR/src"
  local here there
  here=$(cd "$ROOT/backend" && find src -type f -name '*.js' | sort | xargs shasum | shasum | cut -d' ' -f1)
  there=$("${SSH[@]}" "cd $APP_DIR && find src -type f -name '*.js' | sort | xargs shasum | shasum | cut -d' ' -f1" | tr -d '\r')
  printf '  local      %s\n  production %s\n' "$here" "$there"
  if [[ "$here" == "$there" ]]; then good "identical"; return 0; fi
  bad "the files differ"
  note "listing the first differences…"
  "${SSH[@]}" "cd $APP_DIR && find src -type f -name '*.js' | sort | xargs shasum" | tr -d '\r' | sort -k2 > /tmp/.energize-there
  (cd "$ROOT/backend" && find src -type f -name '*.js' | sort | xargs shasum) | sort -k2 > /tmp/.energize-here
  diff /tmp/.energize-here /tmp/.energize-there | head -20
  rm -f /tmp/.energize-here /tmp/.energize-there
  return 1
}

case "${1:-deploy}" in
  --check)    verify; exit $?;;
  --rollback) rollback; exit 0;;
  --diff)     diff_source; exit $?;;
  deploy|"")  ;;
  *) echo "usage: $0 [--check|--rollback|--diff]"; exit 2;;
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
# `reload` لا `restart`: التطبيق يعمل في نسختين بوضع العنقود، فتُستبدَل واحدةٌ
# بينما الأخرى تخدم. و`restart` كان يقتلهما معًا فيردّ nginx ٥٠٢ في تلك الثواني —
# قِيس ذلك: تسعون طلبًا أثناء إعادةٍ حيّة، تسعون نجحت وصفرٌ فشل.
# ── ويُعاد التحميلُ من ملفّ الإعداد ─────────────────────────────────────────
# `pm2 reload <name>` يعيد الكودَ ولا يعيد قراءةَ الإعداد، فتغييرٌ في
# `ecosystem.config.js` — كحدّ كومة node — لا يصل أبدًا. ومن الملفّ يصل الاثنان.
"${SSH[@]}" "cd $APP_DIR && pm2 reload ecosystem.config.js --update-env >/dev/null 2>&1 || pm2 reload $PM2_NAME >/dev/null"
good "$PM2_NAME restarted"

# ── والأيتامُ تُجمَع قبل أن تخدم ─────────────────────────────────────────────
# `reload` يستبدل العمّالَ واحدًا واحدًا، وقد يفلت منه واحدٌ فيبقى ممسكًا
# بالمنفذ المشترَك بكودٍ قديم. فيُمهَل ثوانٍ حتى يستقرّ العمّالُ الجدد، ثمّ
# يُقتَل كلُّ ما يشغّل `server.js` ولا يعرفه pm2.
"${SSH[@]}" "sleep 6; MANAGED=\$(pm2 jlist 2>/dev/null | node -e 'let s=\"\";process.stdin.on(\"data\",d=>s+=d).on(\"end\",()=>{try{console.log(JSON.parse(s).map(p=>p.pid).filter(Boolean).join(\" \"))}catch(e){console.log(\"\")}})'); [ -z \"\$MANAGED\" ] && exit 0; for pid in \$(pgrep -f \"^node $APP_DIR/src/server.js\$\"); do case \" \$MANAGED \" in *\" \$pid \"*) ;; *) kill -9 \$pid 2>/dev/null && echo \"reaped \$pid\";; esac; done" 2>/dev/null | while read -r l; do note "$l"; done

# ── Prove it, or put it back ────────────────────────────────────────────────
note "waiting for the app to come up…"
wait_ready 20 || note "did not answer within 60s — verifying anyway"

if verify_twice; then
  # اختم الكوميت اللي اتنشر. من غير الختم ده، السؤال «البرودكشن شغّال على أنهي
  # نسخة؟» مالوش إجابة إلا بمقارنة الملفات ملف ملف — وده اللي حصل فعلًا لما
  # اتسأل السؤال. الختم بيتقرا في --check.
  "${SSH[@]}" "printf '%s\n' '$(git rev-parse HEAD)' > $APP_DIR/.deployed-commit"
  "${SSH[@]}" "cd $RELEASES && ls -1 | sort | head -n -$KEEP_RELEASES | xargs -r rm -rf"
  say "Deployed $(git rev-parse --short HEAD) — healthy"
  note "previous release kept at $RELEASES/$STAMP"
else
  say "Deploy FAILED verification — rolling back automatically"
  rollback
  exit 1
fi
