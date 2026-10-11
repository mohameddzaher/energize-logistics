/**
 * fixHijriBirthDates — تاريخُ ميلادٍ كُتب هجريًّا في الخانة الميلاديّة.
 *
 *   node src/scripts/fixHijriBirthDates.js            ← تجربة: يعرض ما سيُكتب
 *   node src/scripts/fixHijriBirthDates.js --apply
 *
 * ── العلّة ──────────────────────────────────────────────────────────────────
 * `dateOfBirth` تاريخٌ ميلاديٌّ «YYYY-MM-DD»، والهجريُّ يُشتقّ منه عند العرض.
 * وفي الاستيراد الأوّل دخلت تواريخُ بعض الموظّفين بالهجريّ كما في أوراقهم
 * («1415-06-13»)، فقُرئت ميلاديّةً: سنةُ ١٤١٥ للميلاد، وهجريُّها المشتقّ سنةُ ٨١٨.
 *
 * ── الإصلاح ─────────────────────────────────────────────────────────────────
 * ما سنتُه دون ١٥٠٠ ليس ميلادَ موظّفٍ بالميلاديّ: يُقرأ هجريًّا ويُحوَّل إلى
 * ميلاديِّه بتقويم أمّ القرى (utils/hijri) ويُكتب في الخانة. فيعود العمودُ
 * الهجريُّ يعرض التاريخَ نفسَه الذي كُتب أوّلًا، والميلاديُّ صحيحًا بجانبه.
 *
 * ولا يُحوَّل ما يخرج منه عمرٌ دون الخامسةَ عشرة أو فوق التسعين: ذاك ليس تاريخَ
 * ميلادٍ أصلًا (تاريخُ انتهاءٍ كُتب في الخانة الخطأ) — يُعرَض ليُصحَّح بيده.
 */
require('dotenv').config();
const mongoose = require('mongoose');
const { fromHijriString, toHijri } = require('../utils/hijri');

const APPLY = process.argv.includes('--apply');

(async () => {
  await mongoose.connect(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 60000 });
  const Employee = require('../models/Employee');
  const rows = await Employee.find({ dateOfBirth: { $nin: [null, ''] } }).select('dateOfBirth arabicName firstName lastName employeeNumber').lean();
  const year = new Date().getUTCFullYear();
  const fix = []; const odd = [];
  for (const e of rows) {
    const v = String(e.dateOfBirth).trim();
    const y = Number(v.slice(0, 4));
    if (!(y > 1300 && y < 1500)) continue;
    const name = e.arabicName || `${e.firstName || ''} ${e.lastName || ''}`.trim();
    const greg = fromHijriString(v);
    const age = greg ? year - Number(greg.slice(0, 4)) : null;
    if (!greg || age < 15 || age > 90 || toHijri(greg) !== v.replace(/-(\d)(?=-|$)/g, '-0$1')) { odd.push({ e, name, v, greg, age }); continue; }
    fix.push({ e, name, v, greg, age });
  }
  console.log(`\n  تواريخُ ميلادٍ هجريّةٌ في الخانة الميلاديّة: ${fix.length + odd.length}${APPLY ? '' : '   — تجربة، بلا كتابة —'}\n`);
  for (const x of fix) console.log(`  ${String(x.e.employeeNumber || '').padEnd(6)} ${x.name.padEnd(34)} هجري ${x.v}  ←  ميلادي ${x.greg}  (العمر ${x.age})`);
  if (odd.length) {
    console.log(`\n  لا تُحوَّل (${odd.length}) — ليست تاريخَ ميلادٍ معقولًا، تُصحَّح بيدٍ من ملفّ الموظّف:`);
    for (const x of odd) console.log(`  ${String(x.e.employeeNumber || '').padEnd(6)} ${x.name.padEnd(34)} المكتوب ${x.v}${x.greg ? `  (لو هجري = ${x.greg}، العمر ${x.age})` : '  (لا يُقرأ تاريخًا هجريًّا)'}`);
  }
  if (!APPLY) { console.log(`\n  سيُكتب: ${fix.length}. أضف --apply للتنفيذ.\n`); await mongoose.disconnect(); return; }

  const fs = require('fs'); const path = require('path');
  const dir = path.join(__dirname, '..', '..', 'backups'); fs.mkdirSync(dir, { recursive: true });
  const backup = path.join(dir, `birth-dates-${new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)}.json`);
  fs.writeFileSync(backup, JSON.stringify(fix.map((x) => ({ _id: x.e._id, employeeNumber: x.e.employeeNumber, dateOfBirth: x.v }))));
  const r = await Employee.bulkWrite(fix.map((x) => ({ updateOne: { filter: { _id: x.e._id, dateOfBirth: x.e.dateOfBirth }, update: { $set: { dateOfBirth: x.greg } } } })));
  try { require('../utils/ttlCache').clear('hrm:'); } catch (_) { /* */ }
  console.log(`\n  ✔ نسخةٌ من القديم: ${backup}\n  ✔ كُتبت: ${r.modifiedCount}\n`);
  await mongoose.disconnect();
})().catch((e) => { console.error(e); process.exit(1); });
