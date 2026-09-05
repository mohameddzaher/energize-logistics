/**
 * genPageCatalog — يولّد فهرس صفحات النظام من الشريط الجانبي.
 *
 *   node src/scripts/genPageCatalog.js
 *   node src/scripts/genPageCatalog.js --check    يتأكّد إنه محدَّث، بلا كتابة
 *
 * ── لماذا يُولَّد ولا يُكتب ────────────────────────────────────────────────────
 * صفحاتُ الصلاحيّات تحتاج قائمةً بكلّ صفحةٍ في النظام: مسارُها، وقسمُها، واسمُها
 * بالعربيّة والإنجليزيّة. والقائمةُ موجودةٌ أصلًا — هي الشريطُ الجانبيُّ نفسُه في
 * `frontend/src/app/system/layout.tsx`.
 *
 * وكتابتُها مرّةً ثانيةً في الخادم تعني أنّ كلَّ صفحةٍ جديدةٍ تُولَد بلا صلاحيّةٍ
 * تحرسها، ولا يظهر ذلك في شاشة: تُضاف الصفحةُ إلى الشريط فيراها الجميع، ويظنّ
 * من فتح صفحةَ الصلاحيّات أنّه ضبط كلَّ شيء. فتُقرأ من مصدرها، و`--check` يقف
 * في وجه أيّ تفرّقٍ بينهما.
 *
 * ونظيرُه في الاتّجاه المعاكس `genFrontendRoles.js`.
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..', '..');
const NAV = path.join(ROOT, 'frontend', 'src', 'app', 'system', 'layout.tsx');
const OUT = path.join(__dirname, '..', 'config', 'pages.json');
const CHECK = process.argv.includes('--check');

// ── الأسماءُ التي تأتي من ملفّ الترجمة ──────────────────────────────────────
// بعضُ المداخل تكتب اسمَها في السطر (`lang === 'ar' ? 'المحفظة' : 'Wallet'`)
// وبعضُها يشير إلى الترجمة (`label: L.wallet`). وكتابةُ جدولٍ يدويٍّ للثانية
// يعني أن تصير أربعٌ وستّون صفحةً في شاشة الصلاحيّات بمسارها البرمجيّ بدل
// اسمها — يقرؤه صاحبُ الشركة فلا يعرف ما يمنح. فيُقرأ `layout` من مصدره.
function layoutLabels() {
  const TR = path.join(ROOT, 'frontend', 'src', 'lib', 'translations.ts');
  const t = fs.readFileSync(TR, 'utf8');
  const block = t.slice(t.indexOf('const layout = {'), t.indexOf('export function getLayoutTranslations'));
  const grab = (langKey) => {
    const i = block.indexOf(`  ${langKey}: {`);
    if (i < 0) return {};
    const body = block.slice(i, block.indexOf('\n  },', i));
    const out = {};
    for (const m of body.matchAll(/^\s{4}(\w+):\s*'((?:[^'\\]|\\.)*)'/gm)) out[m[1]] = m[2];
    return out;
  };
  const en = grab('en'); const ar = grab('ar');
  const map = {};
  for (const k of Object.keys(en)) if (ar[k]) map[k] = [ar[k], en[k]];
  return map;
}

const L_LABELS = layoutLabels();

const src = fs.readFileSync(NAV, 'utf8');

// كلُّ سطرٍ فيه `href:` هو مدخلُ صفحةٍ في الشريط. والصياغةُ منتظمةٌ لأنّ الملفّ
// يُكتب هكذا منذ أوّله؛ وما يشذّ يُستخرَج اسمُه من `L_LABELS` أو يُترك بمساره.
const items = [];
const seen = new Set();
for (const line of src.split('\n')) {
  const href = /href:\s*'([^']+)'/.exec(line);
  if (!href || !href[1].startsWith('/system')) continue;
  const section = /section:\s*'([^']+)'/.exec(line);
  if (!section) continue;
  let ar = null; let en = null;
  const inline = /label:\s*lang === 'ar' \? '([^']*)' : '([^']*)'/.exec(line);
  if (inline) { [, ar, en] = inline; }
  else {
    const fromL = /label:\s*L\.(\w+)/.exec(line);
    if (fromL && L_LABELS[fromL[1]]) { [ar, en] = L_LABELS[fromL[1]]; }
  }
  const key = href[1];
  // المسارُ الواحد قد يظهر مرّتين لقسمين (سير عمل التشغيل يظهر للتشغيل
  // وللتحصيل). والصلاحيّةُ على الصفحة لا على ظهورها، فتُسجَّل مرّةً واحدةً
  // تحت أوّل قسمٍ يعلنها.
  if (seen.has(key)) continue;
  seen.add(key);
  items.push({
    key,
    section: section[1],
    ar: ar || key,
    en: en || key,
    // صفحةٌ بلا اسمٍ مقروءٍ تُعلَّم كي تُصلَّح، لا كي تُخفى.
    ...(ar ? {} : { unnamed: true }),
  });
}

if (!items.length) {
  console.error('لم يُقرأ أيُّ مدخلٍ من الشريط الجانبيّ — تغيّرت صياغةُ الملفّ.');
  process.exit(1);
}

const payload = `${JSON.stringify({ generatedFrom: 'frontend/src/app/system/layout.tsx', pages: items }, null, 2)}\n`;

if (CHECK) {
  const current = fs.existsSync(OUT) ? fs.readFileSync(OUT, 'utf8') : '';
  if (current !== payload) {
    console.error('فهرسُ الصفحات متأخّرٌ عن الشريط الجانبيّ — شغّل: node backend/src/scripts/genPageCatalog.js');
    process.exit(1);
  }
  console.log(`فهرسُ الصفحات محدَّث — ${items.length} صفحة.`);
  process.exit(0);
}

fs.writeFileSync(OUT, payload);
const unnamed = items.filter((i) => i.unnamed);
console.log(`كُتب ${OUT}\n${items.length} صفحة في ${new Set(items.map((i) => i.section)).size} قسمًا.`);
if (unnamed.length) console.log(`بلا اسمٍ مقروء (${unnamed.length}): ${unnamed.map((i) => i.key).join(', ')}`);
