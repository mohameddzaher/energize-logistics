/**
 * genPageCatalog: generates the system page catalogue from the sidebar.
 * --check verifies it is current without writing.
 * The permissions pages need every page's path, section, and Arabic and English names, and that list already exists as the sidebar in frontend/src/app/system/layout.tsx. Writing it again on the server would let each new page be born without a guarding permission, unnoticed on any screen, so it is read from the source and --check blocks any divergence.
 * The reverse direction is genFrontendRoles.js.
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..', '..');
const NAV = path.join(ROOT, 'frontend', 'src', 'app', 'system', 'layout.tsx');
const OUT = path.join(__dirname, '..', 'config', 'pages.json');
const CHECK = process.argv.includes('--check');

// Names that come from the translation file.
// Some entries write their name inline (a lang === 'ar' ternary) and others point at translations (label: L.wallet). Without a table for the second kind, sixty-four pages would show their code path on the permissions screen instead of a name. So layout is read from its source.
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

// Every line with href: is a sidebar entry. The format is regular because the file has always been written that way; any exception takes its name from L_LABELS or keeps its path.
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
    // A label written once for both languages (`label: 'API Reference'`).
    const plain = /label:\s*'([^']+)'/.exec(line);
    if (!ar && plain) { ar = plain[1]; en = plain[1]; }
  }
  const key = href[1];
  // One path can appear twice for two sections (the operations workflow shows for operations and collections). The permission is on the page, not its appearance, so it is registered once under the first section that declares it.
  if (seen.has(key)) continue;
  seen.add(key);
  items.push({
    key,
    section: section[1],
    ar: ar || key,
    en: en || key,
    // A page without a readable name is flagged to be fixed, not hidden.
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
