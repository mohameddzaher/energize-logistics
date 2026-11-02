#!/usr/bin/env bash
# Installs the website nginx block and checks it before the domain is pointed at it. Cause: the previous block was written by hand on the server through an unquoted heredoc, so its variables came out escaped: `\$host` in the file, which nginx reads as a literal dollar, passing the text "$host" as the Host header instead of the host name, while `nginx -t` passes. A silent fault visible only to a real visitor. So the config is read from the repo and uploaded, never written there. Usage: bash scripts/install-web-nginx.sh. It reloads only if `nginx -t` succeeds and tests the site with `--resolve` to reach our server without DNS, so we know it serves before anyone sees it.
set -euo pipefail

VPS_HOST="${VPS_HOST:-root@152.239.127.46}"
VPS_KEY="${VPS_KEY:-$HOME/.ssh/energize_vps}"
VPS_IP="${VPS_HOST#*@}"
SSH=(ssh -i "$VPS_KEY" -o ConnectTimeout=20 "$VPS_HOST")
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CONF="$HERE/deploy/nginx/energize-web.conf"
CERT=/etc/ssl/cloudflare/energize-logistics.com.pem
KEY=/etc/ssl/cloudflare/energize-logistics.com.key

say() { printf '\n\033[1m%s\033[0m\n' "$1"; }
ok()  { printf '  \033[32m✓\033[0m %s\n' "$1"; }
bad() { printf '  \033[31m✗\033[0m %s\n' "$1"; }
die() { bad "$1"; exit 1; }

say "Pre-flight"
[ -f "$CONF" ] || die "لا إعدادَ في $CONF"
ok "الإعداد موجود"

# Escaped variables are the fault this script was born from, so the file is checked before upload to keep them off the server. Comments are stripped before the check: the paragraph explaining the fault writes it to describe it, and the guard rejected a correct config because of its own explanation. The fault is in the directive, not in talk about it.
if sed 's/#.*//' "$CONF" | grep -q '\\\$'; then
  sed 's/#.*//' "$CONF" | grep -n '\\\$' | head -5
  die "الإعدادُ فيه متغيّرٌ مهروب في تعليمة — هذا هو العطبُ نفسُه. أصلِحه أوّلًا."
fi
ok "لا متغيّرَ مهروبًا في التعليمات"

"${SSH[@]}" "test -s $CERT && test -s $KEY" \
  || die "الشهادةُ أو المفتاحُ غيرُ موجودَين على الخادم ($CERT / $KEY)"
ok "الشهادةُ والمفتاح في مكانهما"

# A certificate that does not match its key passes nginx's check and fails at the first handshake.
"${SSH[@]}" bash -s <<REMOTE || die "الشهادةُ لا تطابق المفتاح"
set -e
a=\$(openssl x509 -noout -pubkey -in $CERT | openssl md5)
b=\$(openssl pkey -pubout -in $KEY | openssl md5)
[ "\$a" = "\$b" ]
REMOTE
ok "الشهادةُ تطابق المفتاح"

"${SSH[@]}" "openssl x509 -noout -checkend 2592000 -in $CERT" >/dev/null \
  && ok "الشهادةُ صالحةٌ شهرًا على الأقلّ" || bad "الشهادةُ تنتهي قريبًا"

say "Install"
scp -q -i "$VPS_KEY" "$CONF" "$VPS_HOST:/etc/nginx/sites-available/energize-web"
"${SSH[@]}" "ln -sfn /etc/nginx/sites-available/energize-web /etc/nginx/sites-enabled/energize-web"
ok "رُفع البلوك"

"${SSH[@]}" "nginx -t" >/dev/null 2>&1 || {
  "${SSH[@]}" "nginx -t" 2>&1 | tail -5
  die "nginx -t فشل — لم يُعَد التحميل، والموقعُ الحيُّ لم يُمسّ"
}
ok "nginx -t سليم"
"${SSH[@]}" "systemctl reload nginx"
ok "أُعيد تحميل nginx"

say "Verify — من خادمنا مباشرةً، بلا DNS"
for host in energize-logistics.com www.energize-logistics.com; do
  code=$(curl -ks -o /dev/null -w '%{http_code}' --max-time 20 \
    --resolve "$host:443:$VPS_IP" "https://$host/login" || echo 000)
  printf '  %-34s %s\n' "$host/login" "$code"
done
# The API is not touched; it is checked because both blocks live in the same nginx.
code=$(curl -s -o /dev/null -w '%{http_code}' --max-time 20 "https://api.energize-logistics.com/api/health" || echo 000)
printf '  %-34s %s  (لم يُمسّ)\n' "api .../api/health" "$code"

printf '\n\033[1mالخادمُ يخدم الموقعَ. ولم يتغيّر شيءٌ عند الناس بعد.\033[0m\n'
printf '  \033[2mللتحويل: سجلُّ A للجذر وللـwww في Cloudflare ← %s (بدل Netlify).\033[0m\n' "$VPS_IP"
printf '  \033[2mوللرجوع: أعِد السجلَّ إلى Netlify — الرجوعُ فوريٌّ لأنّ Cloudflare وسيط.\033[0m\n'
