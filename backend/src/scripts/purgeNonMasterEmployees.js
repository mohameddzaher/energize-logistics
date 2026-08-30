/**
 * تنقيةُ سجلّ الموظفين — لا يبقى إلّا من في الماستر والشيتات الأربعة عشر.
 *
 *   node src/scripts/purgeNonMasterEmployees.js          # تقرير
 *   node src/scripts/purgeNonMasterEmployees.js --yes    # تنفيذ
 *   node src/scripts/purgeNonMasterEmployees.js --yes --with-data   # يحذف حتى ما عليه بيانات
 *
 * ── المرجع ──────────────────────────────────────────────────────────────────
 * `master of hr.xlsx` (٣٧٨ موظّفًا) ومعه ثلاثةَ عشرَ شيتًا تفصيليًّا. كلُّ رقم
 * هويّةٍ يظهر في أيٍّ منها = موظّفٌ حقيقيّ. وما عداه بقايا استيراداتٍ قديمة
 * حُذف مصدرُها.
 *
 * ── وما لا يُحذف بلا إذن ────────────────────────────────────────────────────
 * السجلُّ الذي عليه عهدةُ شركةٍ أو عقدٌ أو مستند: حذفُه يترك العهدةَ معلّقةً
 * بلا صاحب، فلا يُعرف عند مَن الجهاز. والسجلُّ الذي يشير إليه حسابُ دخول:
 * حذفُه يُعطّل الخدمةَ الذاتيّة لصاحبه. كلاهما يُقال ولا يُمَسّ إلّا بـ
 * `--with-data` — أي بقرارٍ صريح.
 *
 * وكلُّ ما يُحذف يُكتب أوّلًا في backups/ كاملًا، فالتراجعُ ممكن.
 */
require('dotenv').config({ path: require('path').join(__dirname, '../../.env') });
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const mongoose = require('mongoose');
const { readSheet } = require('./lib/xlsxStream');

const APPLY = process.argv.includes('--yes');
const WITH_DATA = process.argv.includes('--with-data');
const DIR = path.join(__dirname, '../seeds/data/hr-2026-08');
const OWNED = [['إجازات', 'LeaveRequest'], ['طلبات', 'HRRequest'], ['عقود', 'Contract'],
  ['عهد', 'Asset'], ['مستندات', 'EmployeeDocument'], ['تجديدات', 'EmployeeRenewal']];

/**
 * كلُّ رقم هويّةٍ في الماستر أو في أيّ شيتٍ تفصيليّ.
 *
 * الماستر يُقرأ عمودُه الثاني **كما هو**، لا بنمطٍ يفترض عشرةَ أرقامٍ تبدأ
 * بواحدٍ أو اثنين: في الملفّ هويّاتٌ لا تشبه ذلك — «١١١» لزهرة، و«٢٢٢» لعمّ
 * رجب، وواحدةٌ تبدأ بأربعة. والنمطُ الذي يرفضها يجعل ثلاثةَ موظّفين حقيقيّين
 * يبدون دخلاء فيُحذفون. أمّا الشيتات التفصيليّة فتُمسح بالنمط لأنّها تحمل
 * أرقامًا أخرى كثيرة (جوازات وسجلّات) لا تُخلط بالهويّات.
 */
function authoritativeIds() {
  const ids = new Set();
  const MASTER = 'master-of-hr.xlsx';
  try {
    const rows = readSheet(path.join(DIR, MASTER), 'xl/worksheets/sheet1.xml').filter((r) => r.r > 3);
    for (const r of rows) {
      const v = String(r.cells.B ?? '').trim();
      if (v) ids.add(v);
    }
  } catch (e) { throw new Error('تعذّر قراءة ماستر الموارد البشريّة: ' + e.message); }

  for (const f of fs.readdirSync(DIR)) {
    if (!f.endsWith('.xlsx') || f.startsWith('~$') || f === MASTER) continue;
    const F = path.join(DIR, f);
    let sheets = [];
    try { sheets = [...new Set(execSync(`unzip -l ${JSON.stringify(F)} | grep -o "xl/worksheets/sheet[0-9]*.xml"`).toString().trim().split('\n'))]; } catch (e) { continue; }
    for (const sh of sheets) {
      let rows = []; try { rows = readSheet(F, sh); } catch (e) { continue; }
      for (const r of rows) {
        for (const v of Object.values(r.cells)) {
          const s = String(v).trim();
          if (/^[12]\d{9}$/.test(s)) ids.add(s);
        }
      }
    }
  }
  return ids;
}

(async () => {
  console.log('\n' + '='.repeat(72));
  console.log(APPLY ? '  تنقيةُ سجلّ الموظفين — تنفيذ' : '  تنقيةُ سجلّ الموظفين — تقريرٌ فقط');
  console.log('='.repeat(72));

  const ids = authoritativeIds();
  console.log(`  أرقامُ هويّةٍ في الماستر والشيتات: ${ids.size}`);

  await mongoose.connect(process.env.MONGODB_URI);
  const Employee = require('../models/Employee');
  const User = require('../models/User');
  const emps = await Employee.find({}).lean();
  const linked = new Map();
  (await User.find({}).select('email linkedEmployee').lean())
    .filter((u) => u.linkedEmployee).forEach((u) => linked.set(String(u.linkedEmployee), u.email));

  const outside = emps.filter((e) => {
    const iq = String(e.iqamaNumber || e.nationalId || '').trim();
    return !iq || !ids.has(iq);
  });
  console.log(`  الموظّفون: ${emps.length} · في المرجع: ${emps.length - outside.length} · خارجه: ${outside.length}\n`);

  const rows = [];
  for (const e of outside) {
    const counts = {}; let total = 0;
    for (const [ar, M] of OWNED) {
      // eslint-disable-next-line no-await-in-loop
      const n = await require('../models/' + M).countDocuments({ employee: e._id });
      if (n) { counts[ar] = n; total += n; }
    }
    rows.push({ e, counts, total, account: linked.get(String(e._id)) || '' });
  }
  const name = (e) => e.arabicName || `${e.firstName || ''} ${e.lastName || ''}`.trim() || '(بلا اسم)';
  const safe = rows.filter((r) => !r.total && !r.account);
  const held = rows.filter((r) => r.total || r.account);

  console.log(`  ① يُحذف (بلا بياناتٍ ولا حساب): ${safe.length}`);
  safe.forEach((r) => console.log(`     #${String(r.e.employeeNumber || '—').padEnd(9)} ${name(r.e).padEnd(32)} هويّة ${String(r.e.iqamaNumber || r.e.nationalId || '—')}`));

  console.log(`\n  ② مُمسَكٌ عنه${WITH_DATA ? ' — لكن --with-data يحذفه' : ''}: ${held.length}`);
  held.forEach((r) => console.log(`     #${String(r.e.employeeNumber || '—').padEnd(9)} ${name(r.e).padEnd(32)} ${r.account ? 'حساب ' + r.account + '  ' : ''}${Object.entries(r.counts).map(([k, v]) => k + ' ' + v).join('، ')}`));

  const toDelete = WITH_DATA ? rows : safe;
  if (!APPLY) { console.log(`\n  — تقريرٌ فقط. أضف --yes للتنفيذ (${toDelete.length} سجلًّا).\n`); await mongoose.disconnect(); return; }

  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const dir = path.join(__dirname, '../../backups', `employee-purge-${stamp}`);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'employees.json'), JSON.stringify(toDelete.map((r) => r.e), null, 1));
  // وما تعلّق بهم، كي لا يضيع أثرُه لو احتيج للتراجع.
  const owned = {};
  for (const [ar, M] of OWNED) {
    // eslint-disable-next-line no-await-in-loop
    owned[M] = await require('../models/' + M).find({ employee: { $in: toDelete.map((r) => r.e._id) } }).lean();
  }
  fs.writeFileSync(path.join(dir, 'owned.json'), JSON.stringify(owned, null, 1));
  console.log(`\n  ↩ نسخةٌ احتياطية: backups/${path.basename(dir)}`);

  const r = await Employee.deleteMany({ _id: { $in: toDelete.map((x) => x.e._id) } });
  console.log(`  ✓ حُذف ${r.deletedCount} سجلَّ موظّف`);
  console.log(`  إجمالي الموظفين الآن: ${await Employee.countDocuments()}`);
  await mongoose.disconnect();
})().catch(async (e) => { console.error(e); try { await mongoose.disconnect(); } catch (_) {} process.exit(1); });
