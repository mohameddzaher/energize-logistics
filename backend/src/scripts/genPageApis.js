/**
 * genPageApis — أيُّ نقاط الـ API تنادِيها كلُّ صفحة.
 *
 *   node src/scripts/genPageApis.js
 *   node src/scripts/genPageApis.js --check
 *
 * ── لماذا يلزم هذا الملفّ ────────────────────────────────────────────────────
 * صلاحيّةُ الصفحة كانت تُخفي الشاشةَ ولا تحرس البيانات: مَن يعرف المسارَ يكتبه،
 * ومَن يعرف نقطةَ الـ API ينادِيها. وقيلَ ذلك في الشاشة صراحةً — وقولُ العيب لا
 * يُصلحه.
 *
 * والمانعُ التقنيّ كان حقيقيًّا: الصفحةُ الواحدة تنادي عشرَ نقاط، والنقطةُ
 * الواحدة تخدم خمسَ صفحات، فلا انطباقَ بينهما. والجوابُ ليس تركَ الحراسة، بل
 * **بناءُ الخريطة**: أيُّ الصفحات تنادي هذه النقطة؟ فإن كانت كلُّها مغلقةً على
 * هذا الدور فالنقطةُ مغلقةٌ عليه — بلا حاجةٍ إلى تصديق ما يقوله المتصفّح عن
 * نفسه.
 *
 * ── وتُقرأ من الشيفرة لا تُكتب باليد ──────────────────────────────────────────
 * خريطةٌ تُكتب يدويًّا لمئتين وستٍّ وستّين صفحةً تشيخ في أوّل أسبوع، وشيخوختُها
 * صامتة: نقطةٌ تُنسى فتُغلَق في وجه من يملكها. فتُستخرَج من الشيفرة نفسِها:
 * تُقرأ صفحةُ كلّ مسار، وتُتبَع وارداتُها المحلّيّة، وتُجمَع نداءاتُ `/api/…`
 * منها كلِّها.
 *
 * ── والشكُّ يوسِّع ولا يضيّق ──────────────────────────────────────────────────
 * ما لا يُقرأ ساكنًا — `` `${base}/x` `` — يجعل الصفحةَ «مفتوحةً على قسمها
 * كلِّه»، فلا يُغلَق بابٌ بسبب سطرٍ لم نفهمه. المنعُ لا يقع إلّا حين نكون على
 * يقين.
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..', '..');
const SRC = path.join(ROOT, 'frontend', 'src');
const APP = path.join(SRC, 'app', 'system');
const OUT = path.join(__dirname, '..', 'config', 'pageApis.json');
const CHECK = process.argv.includes('--check');

const { PAGES } = require('../config/pages');
const { SECTIONS } = require('../config/sections');

const read = (f) => { try { return fs.readFileSync(f, 'utf8'); } catch { return ''; } };

/** يحوّل واردًا إلى مسار ملفٍّ حقيقيّ — `@/x` أو `./x` أو `../x`. */
function resolveImport(spec, fromFile) {
  let base;
  if (spec.startsWith('@/')) base = path.join(SRC, spec.slice(2));
  else if (spec.startsWith('.')) base = path.resolve(path.dirname(fromFile), spec);
  else return null; // حزمةٌ خارجيّة
  const tries = ['.tsx', '.ts', '/index.tsx', '/index.ts', ''];
  for (const t of tries) {
    const p = base + t;
    if (fs.existsSync(p) && fs.statSync(p).isFile()) return p;
  }
  return null;
}

/**
 * الأسماءُ المستوردة من كلّ ملفّ في الشجرة.
 *
 * ── ولماذا الأسماءُ لا الملفّات ─────────────────────────────────────────────
 * صفحةٌ تستورد `money` من `lib/vehicleRegistry` لا تنادي كلَّ نقطةٍ في ذلك
 * الملفّ. وأخذُ الملفّ كلِّه يجعل كلَّ صفحةٍ في القسم تنادي كلَّ شيءٍ فيه — فلا
 * يبقى لإغلاق صفحةٍ أثرٌ على أيّ نقطة، وتصير الحراسةُ اسمًا بلا معنى.
 *
 * فتُقيَّد ملفّاتُ `lib/` بما استُورد منها بالاسم. والمكوّناتُ والخطّافات تُؤخَذ
 * كاملةً: من استوردها استوردَ سلوكَها كلَّه.
 */
function fileClosure(entry) {
  const seen = new Map(); // ملفّ → مجموعةُ الأسماء المستوردة منه (أو null = كلُّه)
  const stack = [[entry, null]];
  while (stack.length) {
    const [f, names] = stack.pop();
    if (!f) continue;
    const prev = seen.get(f);
    if (prev === null) { /* مأخوذٌ كاملًا بالفعل */ }
    else if (names === null) seen.set(f, null);
    else {
      const merged = new Set(prev || []);
      names.forEach((n) => merged.add(n));
      if (prev && [...merged].length === prev.size) continue; // لا جديد
      seen.set(f, merged);
    }
    if (prev !== undefined && prev === null) continue;

    const src = read(f);
    for (const m of src.matchAll(/import\s+([^;]*?)\s+from\s+['"]([^'"]+)['"]/g)) {
      const clause = m[1];
      const r = resolveImport(m[2], f);
      if (!r) continue;
      // `import { a, b as c }` → أسماء؛ و`import X` أو `* as X` → الملفُّ كلُّه.
      const braced = clause.match(/\{([^}]*)\}/);
      const hasDefaultOrStar = /^[^{]*[A-Za-z_$]/.test(clause.split('{')[0].trim()) || clause.includes('* as');
      const named = braced
        ? braced[1].split(',').map((x) => x.trim().split(/\s+as\s+/)[0].replace(/^type\s+/, '').trim()).filter(Boolean)
        : [];
      stack.push([r, hasDefaultOrStar || !braced ? null : named]);
    }
    for (const m of src.matchAll(/import\s*\(\s*['"]([^'"]+)['"]/g)) {
      const r = resolveImport(m[1], f);
      if (r) stack.push([r, null]);
    }
    for (const m of src.matchAll(/export\s+\*\s+from\s+['"]([^'"]+)['"]/g)) {
      const r = resolveImport(m[1], f);
      if (r) stack.push([r, null]);
    }
  }
  return seen;
}

/**
 * نصُّ الأسماء المطلوبة من ملفّ `lib` — وما هو خارج أيِّ تصدير.
 *
 * ما هو خارج التصديرات يُنفَّذ عند الاستيراد، فيُؤخَذ دائمًا.
 */
function scopedSource(file, names) {
  const src = read(file);
  if (!names || !/\/lib\//.test(file.replace(/\\/g, '/'))) return src;

  const rx = /export\s+(?:const|let|var|function|async function)\s+([A-Za-z0-9_$]+)/g;
  const marks = [];
  for (const m of rx.exec.length ? src.matchAll(rx) : []) marks.push({ name: m[1], at: m.index });
  if (!marks.length) return src;

  let outside = '';
  let prevEnd = 0;
  const wanted = [];
  marks.forEach((mk, i) => {
    const end = i + 1 < marks.length ? marks[i + 1].at : src.length;
    outside += src.slice(prevEnd, mk.at);
    prevEnd = end;
    if (names.has(mk.name)) wanted.push(src.slice(mk.at, end));
  });
  outside += src.slice(prevEnd);
  return outside + wanted.join('\n');
}

/**
 * نقاطُ الـ API في نصّ ملفّ.
 *
 * تُقتطع عند أوّل ما لا يُعرَف ساكنًا: `?` أو `${` أو نهاية النصّ. فـ
 * `` `/api/vehicle-registry/${id}` `` تُقرأ `/api/vehicle-registry` — وهي
 * البادئةُ الصحيحة، إذ الحارسُ يطابق بالبادئة.
 */
function apisIn(src) {
  const out = new Set();
  let wildcard = false;
  for (const m of src.matchAll(/['"`]\/api\/([^'"`]*)/g)) {
    const rest = m[1];
    // `/api/${x}` — لا تُعرَف الوجهة: تُوسَّع الصفحةُ إلى قسمها.
    if (rest.startsWith('$')) { wildcard = true; continue; }
    const cut = rest.split(/[?#]/)[0].split('${')[0];
    const clean = cut.replace(/\/+$/, '');
    if (!clean) { wildcard = true; continue; }
    out.add(`/api/${clean}`);
  }
  return { apis: [...out], wildcard };
}

// ── نقاطٌ يناديها الإطارُ نفسُه، لا صفحةٌ بعينها ────────────────────────────
// الشريطُ الجانبيُّ والترويسةُ يعملان في كلّ شاشة: الدخول، وإشعاراتٌ، وقوائمُ
// مرجعيّة تُقرأ في كلّ استمارة. إغلاقُها بإغلاق صفحةٍ يوقف النظام كلَّه.
const SHELL_ENTRIES = [
  path.join(APP, 'layout.tsx'),
  path.join(SRC, 'context', 'AuthContext.tsx'),
  path.join(SRC, 'components', 'system', 'DialogProvider.tsx'),
];

function build() {
  // ── الإطارُ ملفّاتُه هو، لا ما تستورده ────────────────────────────────────
  // الشريطُ الجانبيُّ يستورد `lib/businessReview` و`lib/fleet` ليقرّر مَن يرى
  // أيَّ رابط. وأخذُ شجرتِه كلِّها كان يجعل نقاطَ مراجعةِ الأعمال والأسطول
  // «نقاطَ إطار» — مفتوحةً للجميع بلا حارس.
  const shell = new Set(['/api/auth', '/api/notifications', '/api/lookups', '/api/uploads', '/api/portal/me']);
  for (const e of SHELL_ENTRIES) {
    apisIn(read(e)).apis.forEach((a) => shell.add(a));
  }

  const sectionPrefixes = Object.fromEntries(SECTIONS.map((s) => [s.key, s.apiPrefixes]));
  const pages = {};
  let unresolved = 0;

  for (const p of PAGES) {
    // مسارُ الصفحة → ملفُّها. المسارُ ذو المعامل (`[id]`) يقابله مجلَّدٌ باسمه.
    const rel = p.key.replace(/^\/system\/?/, '');
    const file = path.join(APP, rel, 'page.tsx');
    if (!fs.existsSync(file)) { pages[p.key] = { apis: [], wildcard: true }; unresolved += 1; continue; }

    const apis = new Set();
    let wildcard = false;
    for (const [f, names] of fileClosure(file)) {
      const got = apisIn(scopedSource(f, names));
      got.apis.forEach((a) => apis.add(a));
      if (got.wildcard) wildcard = true;
    }
    // ما هو من الإطار لا يُنسَب إلى الصفحة: وإلّا صارت كلُّ صفحةٍ تفتح كلَّ شيء.
    const own = [...apis].filter((a) => !shell.has(a));
    // الشكُّ يوسِّع: نداءٌ لم يُقرأ ساكنًا يفتح للصفحة بادئاتِ قسمها.
    if (wildcard) (sectionPrefixes[p.section] || []).forEach((x) => own.push(x));
    pages[p.key] = { apis: [...new Set(own)].sort(), wildcard };
  }

  return { shell: [...shell].sort(), pages, unresolved };
}

const built = build();
const payload = `${JSON.stringify({
  generatedFrom: 'frontend/src/app/system/**/page.tsx (+ its local imports)',
  shell: built.shell,
  pages: built.pages,
}, null, 2)}\n`;

if (CHECK) {
  const cur = fs.existsSync(OUT) ? fs.readFileSync(OUT, 'utf8') : '';
  if (cur !== payload) {
    console.error('خريطةُ نقاط الصفحات متأخّرة — شغّل: node backend/src/scripts/genPageApis.js');
    process.exit(1);
  }
  console.log('خريطةُ نقاط الصفحات محدَّثة.');
  process.exit(0);
}

fs.writeFileSync(OUT, payload);
const withApis = Object.values(built.pages).filter((v) => v.apis.length).length;
const wild = Object.values(built.pages).filter((v) => v.wildcard).length;
console.log(`كُتب ${OUT}`);
console.log(`${Object.keys(built.pages).length} صفحة · ${withApis} لها نقاطٌ معروفة · ${wild} موسَّعةٌ إلى قسمها · ${built.shell.length} نقطةَ إطار`);
if (built.unresolved) console.log(`لم يُعثر على ملفّ ${built.unresolved} صفحة (وُسِّعت إلى قسمها)`);
