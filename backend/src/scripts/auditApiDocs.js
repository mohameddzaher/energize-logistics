/**
 * auditApiDocs — يتأكّد أنّ حقولَ التوثيق (services/apiFieldScan) مقروءةٌ من كود
 * كلّ مسارٍ نفسِه: كلُّ حقلٍ يظهر لمسارٍ يجب أن يوجد اسمُه في ملفّ معالِجه.
 * حقلٌ لا يوجد = قائمةٌ قُرئت من ملفٍّ آخرَ بالخطأ (اسمٌ متشابه).
 *
 *   API_DOCS_ONLY=1 node src/scripts/auditApiDocs.js
 *
 * لا يصل قاعدةً ولا يفتح منفذًا (API_DOCS_ONLY).
 */
process.env.API_DOCS_ONLY = '1';
const fs = require('fs');
const { app } = require('../server');
const { walk, stats } = require('../services/apiDocs');
const { routeFields } = require('../services/apiFieldScan');

const fileOf = new Map();
for (const f of Object.keys(require.cache)) {
  if (!/\/src\/(controllers|routes|services)\//.test(f)) continue;
  const ex = require.cache[f].exports;
  if (!ex) continue;
  const v = (x) => { if (typeof x === 'function' && !fileOf.has(x)) fileOf.set(x, f); };
  v(ex);
  for (const k of Object.keys(ex)) { try { v(ex[k]); } catch (_) { /* getter */ } }
}

const all = walk(app._router.stack).filter((r) => r.path.startsWith('/api'));
// قواعدُ express-validator تُكتب في ملفّات الراوتر — حقولُها من هناك.
const routeTexts = Object.keys(require.cache).filter((f) => /\/src\/routes\//.test(f)).map((f) => fs.readFileSync(f, 'utf8')).join('\n');
const writes = all.filter((r) => ['POST', 'PUT', 'PATCH'].includes(r.method));
let checked = 0; const stray = [];
for (const r of all) {
  const h = r.stack[r.stack.length - 1].handle;
  const file = fileOf.get(h);
  const text = (file ? fs.readFileSync(file, 'utf8') : '') + Function.prototype.toString.call(h) + routeTexts;
  const f = routeFields(r.stack);
  for (const x of [...f.query, ...f.body]) {
    checked += 1;
    // حقولُ قواعد express-validator المتداخلة (a.*.b) تُكتب في مسار الراوتر لا في المعالِج.
    if (!text.includes(x.name) && !x.name.includes('.')) stray.push(`${r.method} ${r.path} :: ${x.name}`);
  }
}
const blank = writes.filter((r) => { const f = routeFields(r.stack); return !f.body.length && !f.wholeBody
  && /req\.body/.test(Function.prototype.toString.call(r.stack[r.stack.length - 1].handle)); });
console.log(JSON.stringify(stats(app)));
console.log(`حقول فُحصت: ${checked} · خارج ملفّ معالِجها: ${stray.length} · مساراتُ حفظٍ تقرأ الجسمَ بلا حقولٍ مقروءة: ${blank.length}`);
stray.slice(0, 30).forEach((s) => console.log('  ✗', s));
blank.forEach((r) => console.log('  ·', r.method, r.path));
process.exit(stray.length ? 1 : 0);
