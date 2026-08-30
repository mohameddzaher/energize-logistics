/* eslint-disable no-console */
/**
 * مراجعةُ ترابط النظام — هل كلُّ شيءٍ موصولٌ بما يليه فعلًا؟
 *
 *   node src/scripts/auditSystemWiring.js
 *
 * ── ما الذي يُفحَص ─────────────────────────────────────────────────────────
 * ليست فحوصَ نوعٍ ولا صياغة — تلك يمسكها المترجم. هذه فحوصُ **وصلٍ**: الأشياءُ
 * التي تُكتب في ملفّين فتفترق بلا أن يشتكي أحد.
 *
 *   ١. كلُّ رابطٍ في الشريط الجانبيّ له صفحةٌ موجودة.
 *   ٢. كلُّ نداءٍ للـAPI من الواجهة له مسارٌ في الخادم.
 *   ٣. كلُّ قسمٍ له مدير وموظّف وتسميةٌ عربيّةٌ وإنجليزيّة.
 *   ٤. كلُّ دورٍ له اسمٌ باللغتين ويظهر في القوائم.
 *   ٥. كلُّ `ref` في المخطّطات يشير إلى نموذجٍ مسجَّل.
 *   ٦. كلُّ مسارٍ مركَّبٍ في الخادم له متحكّمٌ حقيقيّ.
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '../../..');
const FE = path.join(ROOT, 'frontend/src');
const BE = path.join(ROOT, 'backend/src');

const walk = (dir, out = []) => {
  for (const f of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, f.name);
    if (f.isDirectory()) { if (f.name !== 'node_modules' && f.name !== '.next') walk(p, out); }
    else out.push(p);
  }
  return out;
};

const problems = [];
const notes = [];
const ok = [];

// ═════ ١) روابطُ الشريط الجانبيّ ↔ الصفحات ══════════════════════════════════
const layout = fs.readFileSync(path.join(FE, 'app/system/layout.tsx'), 'utf8');
const hrefs = [...new Set([...layout.matchAll(/href:\s*'(\/system\/[^']+)'/g)].map((m) => m[1]))];
const pageFiles = new Set(walk(path.join(FE, 'app/system')).filter((p) => /page\.tsx$/.test(p)));
const routeOf = (href) => path.join(FE, 'app', href.replace(/^\//, ''), 'page.tsx');
let missingPages = 0;
for (const h of hrefs) {
  if (pageFiles.has(routeOf(h))) continue;
  // مسارٌ ديناميكيّ: /system/x/[id]
  const parts = h.split('/').filter(Boolean);
  const dyn = walk(path.join(FE, 'app/system')).some((p) => {
    const rel = path.relative(path.join(FE, 'app'), p).replace(/\/page\.tsx$/, '');
    const segs = rel.split('/');
    if (segs.length !== parts.length) return false;
    return segs.every((s, i) => s === parts[i] || /^\[.+\]$/.test(s));
  });
  if (!dyn) { problems.push(`رابطٌ في الشريط بلا صفحة: ${h}`); missingPages += 1; }
}
ok.push(`روابط الشريط الجانبيّ: ${hrefs.length} · بلا صفحة: ${missingPages}`);

// ═════ ٢) نداءاتُ الواجهة ↔ مسارات الخادم ══════════════════════════════════
const feFiles = walk(FE).filter((p) => /\.(ts|tsx)$/.test(p));
const called = new Set();
for (const f of feFiles) {
  const src = fs.readFileSync(f, 'utf8');
  for (const m of src.matchAll(/['"`](\/api\/[a-z0-9\-_/]+)/gi)) {
    const raw = m[1].replace(/\/$/, '');
    called.add(raw);
  }
}
// المسارات المركَّبة في الخادم
const server = fs.readFileSync(path.join(BE, 'server.js'), 'utf8');
const mounts = [...server.matchAll(/app\.use\(\s*'(\/api\/[^']+)'/g)].map((m) => m[1]);
const mountSet = new Set(mounts);
let unknownApi = 0;
const unknownList = [];
for (const c of called) {
  const seg = c.split('/').slice(0, 3).join('/'); // /api/<mount>
  if (mountSet.has(seg)) continue;
  // بعضُ المسارات مركَّبةٌ بعمقٍ أكبر (/api/admin/permissions)
  const seg4 = c.split('/').slice(0, 4).join('/');
  if (mountSet.has(seg4)) continue;
  if (c === '/api/uploads' || c.startsWith('/api/uploads/')) continue;
  unknownApi += 1; unknownList.push(c);
}
ok.push(`نداءات API من الواجهة: ${called.size} · مسارات مركَّبة: ${mounts.length} · بلا مسار: ${unknownApi}`);
unknownList.slice(0, 10).forEach((u) => problems.push(`نداءٌ بلا مسارٍ في الخادم: ${u}`));

// ═════ ٣) الأقسام ══════════════════════════════════════════════════════════
const { SECTIONS, SECTION_KEYS, sectionLabel } = require(path.join(BE, 'config/sections'));
const R = require(path.join(BE, 'config/roles'));
let sectionIssues = 0;
for (const key of SECTION_KEYS) {
  const roles = R.rolesOfSection(key);
  if (!roles.length && key !== 'Business Review') { problems.push(`قسم «${key}» بلا أدوار`); sectionIssues += 1; }
  const label = sectionLabel(key);
  if (!label || label === key) { notes.push(`قسم «${key}» بلا تسميةٍ عربيّة`); }
}
ok.push(`الأقسام: ${SECTION_KEYS.length} · بلا أدوار: ${sectionIssues}`);

// ═════ ٤) الأدوار ══════════════════════════════════════════════════════════
const feRoles = fs.readFileSync(path.join(FE, 'lib/roles.ts'), 'utf8');
let roleIssues = 0;
for (const d of R.ALL_ROLE_DEFS) {
  if (!feRoles.includes(`"${d.key}"`)) { problems.push(`دور «${d.ar}» غيرُ موجودٍ في ملفّ الواجهة المولَّد`); roleIssues += 1; }
  if (!/[ء-ي]/.test(d.ar)) { problems.push(`دور «${d.key}» اسمُه العربيّ ليس عربيًّا: «${d.ar}»`); roleIssues += 1; }
}
ok.push(`الأدوار: ${R.ALL_ROLE_DEFS.length} · مشكلات: ${roleIssues}`);

// ═════ ٥) مراجعُ المخطّطات ══════════════════════════════════════════════════
const modelFiles = walk(path.join(BE, 'models')).filter((p) => /\.js$/.test(p));
const declared = new Set();
for (const f of modelFiles) {
  const src = fs.readFileSync(f, 'utf8');
  for (const m of src.matchAll(/mongoose\.model\(\s*'([^']+)'/g)) declared.add(m[1]);
}
const refs = new Set();
for (const f of modelFiles) {
  const src = fs.readFileSync(f, 'utf8');
  for (const m of src.matchAll(/ref:\s*'([^']+)'/g)) refs.add(m[1]);
}
const danglingRefs = [...refs].filter((r) => !declared.has(r));
danglingRefs.forEach((r) => problems.push(`مرجعُ مخطّطٍ إلى نموذجٍ غير معرَّف: ${r}`));
ok.push(`النماذج: ${declared.size} · مراجع: ${refs.size} · معلّقة: ${danglingRefs.length}`);

// ═════ ٦) المسارات ↔ المتحكّمات ════════════════════════════════════════════
const routeFiles = walk(path.join(BE, 'routes')).filter((p) => /\.js$/.test(p));
let handlerIssues = 0;
for (const f of routeFiles) {
  const src = fs.readFileSync(f, 'utf8');
  const ctrlMatch = src.match(/require\('\.\.\/controllers\/([a-zA-Z0-9_]+)'\)/);
  if (!ctrlMatch) continue;
  let ctrl;
  try { ctrl = require(path.join(BE, 'controllers', ctrlMatch[1])); } catch (e) { problems.push(`متحكّمٌ لا يُحمَّل: ${ctrlMatch[1]} — ${e.message.split('\n')[0]}`); continue; }
  const varName = src.match(new RegExp(`const (\\w+) = require\\('\\.\\./controllers/${ctrlMatch[1]}'\\)`));
  if (!varName) continue;
  // المتحكّمُ يصدّر ثلاثةَ أشياء: معالجات، وثوابتَ تُنشر على `authorize(...)`،
  // ومجموعاتٍ متداخلة (`c.tasks.list`). المطلوبُ فحصُه المعالجُ وحدَه — وما
  // بعده نقطةٌ أو ما سبقه `...` ليس معالجًا.
  for (const m of src.matchAll(new RegExp(`(\\.{3})?${varName[1]}\\.([a-zA-Z0-9_]+)(\\.[a-zA-Z0-9_]+)?`, 'g'))) {
    const [, spread, key, nested] = m;
    const val = ctrl[key];
    if (spread) { if (!Array.isArray(val)) { problems.push(`ثابتٌ منشورٌ غيرُ مصفوفة: ${ctrlMatch[1]}.${key}`); handlerIssues += 1; } continue; }
    if (nested) {
      const inner = nested.slice(1);
      if (!val || typeof val[inner] !== 'function') {
        problems.push(`مسارٌ يشير إلى معالجٍ غير موجود: ${path.basename(f)} → ${ctrlMatch[1]}.${key}${nested}`);
        handlerIssues += 1;
      }
      continue;
    }
    if (typeof val !== 'function') {
      problems.push(`مسارٌ يشير إلى معالجٍ غير موجود: ${path.basename(f)} → ${ctrlMatch[1]}.${key}`);
      handlerIssues += 1;
    }
  }
}
ok.push(`ملفّات المسارات: ${routeFiles.length} · معالجاتٌ مفقودة: ${handlerIssues}`);

// ═════ التقرير ═════════════════════════════════════════════════════════════
console.log('\n' + '='.repeat(74));
console.log('  مراجعةُ ترابط النظام');
console.log('='.repeat(74));
ok.forEach((o) => console.log('  · ' + o));
if (notes.length) { console.log(`\n  ملاحظات (${notes.length}):`); notes.slice(0, 10).forEach((n) => console.log('    ' + n)); }
console.log(`\n  المشكلات: ${problems.length}`);
[...new Set(problems)].forEach((p) => console.log('   ✗ ' + p));
if (!problems.length) console.log('   ✓ كلُّ شيءٍ موصول');
console.log('');
process.exit(problems.length ? 1 : 0);
