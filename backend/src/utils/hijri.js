/**
 * التقويمُ الهجريُّ (أمُّ القرى) — تحويلٌ في الاتّجاهين.
 *
 * ── ولماذا لا تُخزَّن الهجريّة ─────────────────────────────────────────────
 * التاريخُ في القاعدة لحظةٌ واحدة، والتقويمُ طريقةُ كتابتها. فتُخزَّن اللحظةُ
 * ميلاديّةً ويُعرَض ما يُطلَب — وإلّا صار للحقل الواحد معنيان، ولا يُعرف أيّهما
 * كُتب.
 *
 * وهذا بالضبط ما وقع في «الشهادات الصحّيّة»: واحدٌ وثلاثون تاريخًا هجريًّا
 * كُتب كأنّه ميلاديّ. فصار `1449-01-09` سنةَ ألفٍ وأربعمئةٍ وتسعٍ وأربعين
 * **ميلاديّة** — أي قبل ستّمئة عام — فتقول الشاشةُ «متأخّر ٢١٠٩٨٧ يومًا» عن
 * شهادةٍ لم يحن أجلُها بعد.
 *
 * ── والتحويلُ يُسأل عنه المتصفّحُ/العقدة، لا يُحسب بمعادلة ─────────────────
 * أمُّ القرى جدولٌ رصديٌّ لا معادلةَ فلكيّةً مطّردة، و`Intl` يحمله. فالتحويلُ
 * من الميلاديّ إليها سؤالٌ مباشر؛ وإليه بحثٌ ثنائيٌّ عن اليوم الميلاديّ الذي
 * يُكتب بالهجريّة كما طُلب — وهو دقيقٌ لأنّ الدالّتين مصدرُهما واحد.
 */

const FMT = new Intl.DateTimeFormat('en-u-ca-islamic-umalqura-nu-latn', {
  year: 'numeric', month: '2-digit', day: '2-digit', timeZone: 'UTC',
});

/** لحظةٌ ميلاديّة ← { y, m, d } هجريّة. */
function toHijriParts(input) {
  const dt = input instanceof Date ? input : new Date(input);
  if (!dt || Number.isNaN(dt.getTime())) return null;
  const p = FMT.formatToParts(dt);
  const get = (t) => Number(p.find((x) => x.type === t)?.value);
  const y = get('year'); const m = get('month'); const d = get('day');
  if (!y || !m || !d) return null;
  return { y, m, d };
}

/** لحظةٌ ميلاديّة ← «dd/mm/yyyy» هجريّة (أو '' حين لا تاريخ). */
function toHijri(input) {
  const h = toHijriParts(input);
  if (!h) return '';
  return `${String(h.d).padStart(2, '0')}/${String(h.m).padStart(2, '0')}/${h.y}`;
}

const cmp = (a, b) => (a.y - b.y) || (a.m - b.m) || (a.d - b.d);
const DAY = 86400000;

/**
 * { y, m, d } هجريّة ← لحظةٌ ميلاديّة (منتصفُ ليلِ UTC).
 *
 * يُقدَّر اليومُ تقديرًا أوّليًّا (السنةُ الهجريّة ٣٥٤٫٣٦٧ يومًا) ثمّ يُصحَّح
 * بالمقارنة — خطواتٌ معدودةٌ لا مسحٌ كامل.
 */
function fromHijri(y, m, d) {
  const Y = Number(y); const M = Number(m); const D = Number(d);
  if (!Y || !M || !D || M < 1 || M > 12 || D < 1 || D > 30) return null;
  const want = { y: Y, m: M, d: D };

  // تقديرٌ أوّليّ: بدايةُ التقويم الهجريّ ١٦ يوليو ٦٢٢م.
  const approx = Date.UTC(622, 6, 16) + ((Y - 1) * 354.367 + (M - 1) * 29.53 + (D - 1)) * DAY;
  let lo = approx - 20 * DAY;
  let hi = approx + 20 * DAY;

  // يُوسَّع المدى إن جانَب التقديرُ الصوابَ.
  for (let i = 0; i < 8; i += 1) {
    const a = toHijriParts(new Date(lo));
    const b = toHijriParts(new Date(hi));
    if (a && cmp(a, want) > 0) { lo -= 60 * DAY; continue; }
    if (b && cmp(b, want) < 0) { hi += 60 * DAY; continue; }
    break;
  }

  // بحثٌ ثنائيٌّ على أوّل يومٍ يبلغ المطلوب.
  let loD = Math.floor(lo / DAY);
  let hiD = Math.ceil(hi / DAY);
  while (loD < hiD) {
    const mid = Math.floor((loD + hiD) / 2);
    const h = toHijriParts(new Date(mid * DAY));
    if (h && cmp(h, want) < 0) loD = mid + 1; else hiD = mid;
  }
  const out = new Date(loD * DAY);
  const check = toHijriParts(out);
  if (!check || cmp(check, want) !== 0) return null;   // تاريخٌ لا وجودَ له
  return out;
}

/** «1449-01-09» أو «09/01/1449» ← لحظةٌ ميلاديّة. */
function parseHijri(text) {
  const s = String(text || '').trim();
  let m = /^(\d{3,4})[-/](\d{1,2})[-/](\d{1,2})$/.exec(s);          // سنة أوّلًا
  if (m) return fromHijri(m[1], m[2], m[3]);
  m = /^(\d{1,2})[-/](\d{1,2})[-/](\d{3,4})$/.exec(s);              // يوم أوّلًا
  if (m) return fromHijri(m[3], m[2], m[1]);
  return null;
}

module.exports = { toHijri, toHijriParts, fromHijri, parseHijri };
