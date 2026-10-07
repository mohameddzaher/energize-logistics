#!/usr/bin/env bash
#
# تنصيبُ بلوك nginx للموقع — وفحصُه **قبل** أن يُوجَّه إليه الدومين.
#
# ── العلّة ────────────────────────────────────────────────────────────────────
# البلوكُ السابق كُتب على الخادم بيدٍ عبر heredoc غير مُقتبَس، فخرجت متغيّراتُه
# مهروبةً: `\$host` في الملفّ، و nginx يقرأ `\$` دولارًا حرفيًّا فيمرّر النصَّ
# «$host» ترويسةَ Host بدل اسم المضيف. و `nginx -t` يعدّي — عطبٌ صامتٌ لا
# يظهر إلّا على زائرٍ حقيقيّ. فالإعدادُ يُقرأ من المستودع ويُرفَع، ولا يُكتَب
# هناك بعد اليوم.
#
#   bash scripts/install-web-nginx.sh
#
# ولا يُعيد التحميلَ إلّا إذا نجح `nginx -t`، ويفحص الموقعَ بـ`--resolve`
# فيبلغ خادمَنا بغير الـDNS: فنعرف أنّه يَخدم قبل أن يراه أحد.
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

# المتغيّراتُ المهروبةُ هي العطبُ الذي وُلد منه هذا السكربت. فيُفحَص الملفُّ
# قبل رفعه: لا تدخل الخادمَ مرّةً أخرى.
#
# والتعليقاتُ تُنزَع قبل الفحص: الفقرةُ التي تشرح العطبَ تكتبه لتُعرِّفه، فكان
# الحارسُ يرفض الإعدادَ الصحيحَ بسبب شرحِه لنفسه. والعطبُ عطبٌ في التعليمة لا
# في الكلام عنها.
if sed 's/#.*//' "$CONF" | grep -q '\\\$'; then
  sed 's/#.*//' "$CONF" | grep -n '\\\$' | head -5
  die "الإعدادُ فيه متغيّرٌ مهروب في تعليمة — هذا هو العطبُ نفسُه. أصلِحه أوّلًا."
fi
ok "لا متغيّرَ مهروبًا في التعليمات"

"${SSH[@]}" "test -s $CERT && test -s $KEY" \
  || die "الشهادةُ أو المفتاحُ غيرُ موجودَين على الخادم ($CERT / $KEY)"
ok "الشهادةُ والمفتاح في مكانهما"

# شهادةٌ لا تطابق مفتاحَها تقبلها nginx عند الفحص وتسقط عند أوّل مصافحة.
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
# والـAPI لا يُمسّ — يُفحَص لأنّ البلوكَين في نفس nginx.
code=$(curl -s -o /dev/null -w '%{http_code}' --max-time 20 "https://api.energize-logistics.com/api/health" || echo 000)
printf '  %-34s %s  (لم يُمسّ)\n' "api .../api/health" "$code"

printf '\n\033[1mالخادمُ يخدم الموقعَ. ولم يتغيّر شيءٌ عند الناس بعد.\033[0m\n'
printf '  \033[2mللتحويل: سجلُّ A للجذر وللـwww في Cloudflare ← %s (بدل Netlify).\033[0m\n' "$VPS_IP"
printf '  \033[2mوللرجوع: أعِد السجلَّ إلى Netlify — الرجوعُ فوريٌّ لأنّ Cloudflare وسيط.\033[0m\n'
