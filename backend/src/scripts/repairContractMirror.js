/**
 * يوحّد خاناتِ العقد في ملفّ الموظّف (البداية، النهاية، رقم قوى) مع عقده الحاكم.
 * راجع utils/contractStatus: العقدُ هو المصدر، والخاناتُ صورةٌ منه.
 *
 * ما لا يعرفه العقدُ ويعرفه الملفّ لا يضيع: عقدٌ سارٍ محدَّدُ المدّة بلا نهايةٍ
 * مكتوبة، أو بلا رقم، يُملأ من الملفّ أوّلًا — ثمّ تُكتب الصورة.
 *
 * وهو نفسُه فحصُ السلامة: بلا `--apply` يعدّ الفروق ويخرج بـ1 إن وُجدت.
 *
 *   node src/scripts/repairContractMirror.js           ← عرضٌ فقط
 *   node src/scripts/repairContractMirror.js --apply
 */
require('dotenv').config();
const mongoose = require('mongoose');
const Employee = require('../models/Employee');
const Contract = require('../models/Contract');
const { mirrorOf, CONTRACT_STATUS_AR } = require('../utils/contractStatus');

const APPLY = process.argv.includes('--apply');
const day = (v) => (v ? String(v instanceof Date ? v.toISOString() : v).trim().slice(0, 10) : '');

(async () => {
  await mongoose.connect(process.env.MONGODB_URI);
  const contracts = await Contract.find({}).sort({ createdAt: -1 }).lean();
  const gov = new Map();
  for (const c of contracts) {
    const k = String(c.employee); const cur = gov.get(k);
    if (!cur || (cur.status !== 'active' && c.status === 'active')) gov.set(k, c);
  }
  const emps = await Employee.find({ _id: { $in: [...gov.keys()] } })
    .select('employeeNumber arabicName contractStartDate contractEndDate qiwaContractNumber contractStatusText').lean();
  const t = { employees: emps.length, filledContractEnd: 0, filledContractNumber: 0, endFixed: 0, startFixed: 0, numberFixed: 0, statusFixed: 0 };
  for (const e of emps) {
    const c = gov.get(String(e._id));
    const fill = {};
    if (c.status === 'active' && c.type !== 'unlimited' && !day(c.endDate) && day(e.contractEndDate)) { fill.endDate = day(e.contractEndDate); t.filledContractEnd += 1; }
    if (c.status === 'active' && !String(c.contractNumber || '').trim() && String(e.qiwaContractNumber || '').trim()) { fill.contractNumber = String(e.qiwaContractNumber).trim(); t.filledContractNumber += 1; }
    const set = { ...mirrorOf({ ...c, ...fill }), contractStatusText: CONTRACT_STATUS_AR[c.status] || c.status || '' };
    const diff = {};
    if (day(e.contractEndDate) !== set.contractEndDate) { diff.contractEndDate = set.contractEndDate; t.endFixed += 1; }
    if (day(e.contractStartDate) !== set.contractStartDate) { diff.contractStartDate = set.contractStartDate; t.startFixed += 1; }
    if (set.qiwaContractNumber && (e.qiwaContractNumber || '') !== set.qiwaContractNumber) { diff.qiwaContractNumber = set.qiwaContractNumber; t.numberFixed += 1; }
    if ((e.contractStatusText || '') !== set.contractStatusText) { diff.contractStatusText = set.contractStatusText; t.statusFixed += 1; }
    if (!Object.keys(diff).length && !Object.keys(fill).length) continue;
    console.log(`  ${e.employeeNumber || '—'} ${String(e.arabicName || '').slice(0, 24)} · ${Object.entries(diff).map(([k, v]) => `${k}: ${day(e[k]) || e[k] || '∅'} → ${v || '∅'}`).join(' · ')}${Object.keys(fill).length ? ` · العقدُ يُملأ: ${JSON.stringify(fill)}` : ''}`);
    if (!APPLY) continue;
    /* eslint-disable no-await-in-loop */
    if (Object.keys(fill).length) await Contract.updateOne({ _id: c._id }, { $set: fill });
    if (Object.keys(diff).length) await Employee.updateOne({ _id: e._id }, { $set: diff });
    /* eslint-enable no-await-in-loop */
  }
  console.log(t);
  const dirty = t.endFixed + t.startFixed + t.numberFixed + t.statusFixed + t.filledContractEnd + t.filledContractNumber;
  if (APPLY) { try { const cache = require('../utils/ttlCache'); cache.clear('hrm:'); cache.clear('hr:employees:'); cache.clear('dash:hr:'); } catch (_) { /* */ } }
  console.log(APPLY ? 'كُتب.' : dirty ? 'عرضٌ فقط (--apply للكتابة).' : 'الملفّاتُ والعقودُ متطابقة.');
  await mongoose.disconnect();
  process.exit(!APPLY && dirty ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
