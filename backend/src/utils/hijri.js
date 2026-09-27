/**
 * الهجريُّ والميلاديُّ — أحدهما يُملي الآخر.
 *
 * ── العلّة ──────────────────────────────────────────────────────────────────
 * رخصةُ السير والفحصُ لكلٍّ تاريخان في السجلّ: ميلاديٌّ يحسب به النظامُ
 * الانتهاءَ والتنبيهَ، وهجريٌّ مكتوبٌ على الورقة كما طُبع. وكانا خانتين لا
 * صلةَ بينهما: يكتب الموظّفُ «١٤٤٨/٠٤/٠٤» في الهجريّة ويحفظ، فتبقى الميلاديّةُ
 * فارغة. وكلُّ الحسابِ على الميلاديّة — فالمستندُ الذي كُتب تاريخُه بالكامل
 * يُقرأ «بلا تاريخ»، ولا يظهر في انتهاءٍ ولا تنبيهٍ ولا تقرير. سطرٌ مُلئ
 * وأثرُه صفر.
 *
 * والموضعُ هنا لا في الشاشة: الشاشتان اثنتان (الويب وتطبيقُ الهاتف) ومعهما
 * الاستيراد، فلو كان الاشتقاقُ في إحداهما بقيت الأخرى على حالها. فمن كتب
 * هجريًّا — من أيّ باب — خرج منه ميلاديٌّ يُحسَب به.
 *
 * ── ولماذا بحثٌ لا معادلة ───────────────────────────────────────────────────
 * تقويمُ أمّ القرى مقرَّرٌ في جداولَ رسميّةٍ لا يُستخرج بمعادلة: أطوالُ شهوره
 * مثبَّتةٌ سلفًا، وكلُّ تقريبٍ حسابيٍّ يخطئ يومًا في بعض السنين. والجدولُ الصحيح
 * موجودٌ في `Intl` — لكنّه يُخرج ولا يُدخل. فيُقلَب عليه: يُقدَّر اليومُ ثمّ
 * يُمشى حولَه حتّى يُطابق. وميزتُه أنّ الذهابَ والإيابَ يتّفقان دائمًا، فما
 * كُتب هجريًّا يعود هجريًّا كما كُتب حرفًا بحرف.
 *
 * وما لا وجودَ له في التقويم يُرَدّ فارغًا لا يُقرَّب: «٣٠/١٢/١٤٤٧» ليس تاريخًا
 * — ذو الحجّة تلك السنة تسعةٌ وعشرون يومًا — فتقريبُه إلى يومٍ مجاورٍ يكتب في
 * السجلّ تاريخًا لم يُطبَع على ورقةٍ قطّ.
 */
const FMT = new Intl.DateTimeFormat('ar-SA-u-ca-islamic-umalqura-nu-latn', {
  year: 'numeric', month: '2-digit', day: '2-digit',
});

/** ميلاديٌّ → هجريٌّ `DD/MM/YYYY` بلا لاحقة «هـ». */
const toHijriPlain = (d) => {
  if (!d) return '';
  const x = new Date(d);
  if (Number.isNaN(x.getTime())) return '';
  try {
    return FMT.format(x).replace(/[‎‏]/g, '').replace(/\s*هـ\s*$/, '').trim();
  } catch (e) { return ''; }
};

/**
 * hijriParts — يقبل ما يكتبه الناس: «1448-04-04» و«4/4/1448» و«١٤٤٨/٠٤/٠٤».
 * والسنةُ هي الطرفُ الرباعيّ أيًّا كان موضعُه.
 */
const hijriParts = (text) => {
  if (!text) return null;
  const t = String(text)
    .replace(/[٠-٩]/g, (c) => String(c.charCodeAt(0) - 0x0660))
    .replace(/[۰-۹]/g, (c) => String(c.charCodeAt(0) - 0x06f0))
    .replace(/هـ|AH|H/gi, '').trim();
  const n = t.split(/[^\d]+/).filter(Boolean).map(Number);
  if (n.length < 3) return null;
  const [a, b, c] = n;
  const y = a > 1000 ? a : c;
  const d = a > 1000 ? c : a;
  const m = b;
  if (!y || !m || !d || m > 12 || d > 30 || y < 1300 || y > 1600) return null;
  return { y, m, d };
};

/** هجريٌّ → ميلاديٌّ `YYYY-MM-DD`، أو `''` إن لم يكن التاريخُ موجودًا. */
const fromHijri = (text) => {
  const p = hijriParts(text);
  if (!p) return '';
  const want = `${String(p.d).padStart(2, '0')}/${String(p.m).padStart(2, '0')}/${p.y}`;
  // نقطةُ البدء: السنةُ الهجريّة ٣٥٤٫٣٦٧ يومًا، والأولى تبدأ ١٦ يوليو ٦٢٢م.
  const approx = Date.UTC(622, 6, 16)
    + Math.round(((p.y - 1) * 354.367 + (p.m - 1) * 29.53 + (p.d - 1)) * 86400000);
  for (let step = 0; step <= 40; step += 1) {
    for (const dir of step === 0 ? [0] : [step, -step]) {
      const cand = new Date(approx + dir * 86400000);
      if (toHijriPlain(cand.toISOString().slice(0, 10)) === want) return cand.toISOString().slice(0, 10);
    }
  }
  return '';
};

/**
 * الأزواجُ التي يُملي فيها أحدُ التاريخين الآخر — مسارٌ هجريٌّ ومسارُه الميلاديّ.
 * تُقرأ من مُخطَّط المركبة: كلُّ مستندٍ له `expiryDateHijri` له `expiryDate`.
 */
const HIJRI_PAIRS = [
  ['vehicleLicense.expiryDateHijri', 'vehicleLicense.expiryDate'],
  ['inspection.expiryDateHijri', 'inspection.expiryDate'],
];

/**
 * يكمل ما نقص في تعديلٍ مُسطَّح (`{'vehicleLicense.expiryDateHijri': '…'}`)،
 * ويُعيد ما أضافه ليُقال لصاحبه.
 *
 * والأولويّةُ للهجريّ حين يُكتب: هو ما على الورقة، وهو الحجّة. وإن كُتب
 * الميلاديُّ وحدَه مُلئ الهجريُّ منه — ولا يُطمَس هجريٌّ موجودٌ في السجلّ.
 */
const fillHijriPairs = ($set, existing = {}) => {
  const added = {};
  const at = (obj, path) => String(path).split('.').reduce((o, k) => (o == null ? o : o[k]), obj);
  for (const [hPath, gPath] of HIJRI_PAIRS) {
    const hNew = Object.prototype.hasOwnProperty.call($set, hPath) ? $set[hPath] : undefined;
    const gNew = Object.prototype.hasOwnProperty.call($set, gPath) ? $set[gPath] : undefined;

    if (hNew !== undefined && String(hNew || '').trim() && (gNew === undefined || !gNew)) {
      const greg = fromHijri(hNew);
      if (greg) { $set[gPath] = greg; added[gPath] = greg; }
      continue;
    }
    if (gNew !== undefined && gNew && (hNew === undefined) && !String(at(existing, hPath) || '').trim()) {
      const hij = toHijriPlain(gNew);
      if (hij) { $set[hPath] = hij; added[hPath] = hij; }
    }
  }
  return added;
};

module.exports = {
  toHijriPlain, hijriParts, fromHijri, HIJRI_PAIRS, fillHijriPairs,
};
