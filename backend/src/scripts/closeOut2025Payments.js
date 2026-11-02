/**
 * closeOut2025Payments: stamps the 2025 payment close-out in the operations workflow.
 * Dry run by default; --yes applies.
 * Unpaid 2025 rows are a closed year, not open work, so they get the year's last day and the collecting branch. Cancelled shipments are not stamped: no money was received and they are outside the not-arrived count.
 */
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const mongoose = require('mongoose');
const OperationsWorkflow = require('../models/OperationsWorkflow');
const { startOfDay, endOfDay } = require('../utils/companyDay');

const APPLY = process.argv.includes('--yes');
const arg = (k, d) => { const i = process.argv.indexOf(`--${k}`); return i > -1 ? process.argv[i + 1] : d; };
const YEAR = Number(arg('year', 2025));
const BRANCH = arg('branch', 'جده');
const CANCELLED = ['cancelled', 'canceled'];

(async () => {
  const payDate = endOfDay(`${YEAR}-12-31`);
  console.log('\n' + '='.repeat(72));
  console.log(APPLY ? `  إقفالُ ${YEAR} — تنفيذ` : `  إقفالُ ${YEAR} — فحصٌ فقط`);
  console.log('='.repeat(72));
  console.log(`  تاريخُ السداد: ${YEAR}-12-31 · الفرع: ${BRANCH}`);
  await mongoose.connect(process.env.MONGODB_URI);

  const noPay = { $or: [{ paymentDate: null }, { paymentDate: '' }, { paymentDate: { $exists: false } }] };
  const scope = {
    reportDate: { $gte: startOfDay(`${YEAR}-01-01`), $lte: endOfDay(`${YEAR}-12-31`) },
    $and: [noPay],
  };

  const [all, cancelled] = await Promise.all([
    OperationsWorkflow.countDocuments(scope),
    OperationsWorkflow.countDocuments({ ...scope, applicationStatus: { $in: CANCELLED } }),
  ]);
  const target = { ...scope, applicationStatus: { $nin: CANCELLED } };
  const rows = await OperationsWorkflow.find(target).select('_id reportNumber applicationStatus').lean();

  console.log(`\n  كشوفُ ${YEAR} بلا تاريخ سداد : ${all}`);
  console.log(`    ملغاة (لا تُمَسّ)        : ${cancelled}`);
  console.log(`    ستُقفَل                  : ${rows.length}`);

  if (!APPLY) { console.log('\n  فحصٌ فقط — أضِف --yes للتنفيذ.\n'); await mongoose.disconnect(); return; }
  if (!rows.length) { console.log('\n  لا شيءَ يُقفَل.\n'); await mongoose.disconnect(); return; }

  const dir = path.join(__dirname, '../../backups');
  fs.mkdirSync(dir, { recursive: true });
  const backup = path.join(dir, `closeOut${YEAR}-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
  fs.writeFileSync(backup, JSON.stringify({ at: new Date(), year: YEAR, branch: BRANCH, rows }, null, 1));
  console.log(`\n  نسخةٌ محفوظة: ${path.relative(process.cwd(), backup)}`);

  const r = await OperationsWorkflow.updateMany(
    { _id: { $in: rows.map((x) => x._id) } },
    { $set: { paymentDate: payDate, payingBranch: BRANCH } },
  );
  console.log(`  أُقفل: ${r.modifiedCount} كشفًا\n`);
  await mongoose.disconnect();
})().catch(async (e) => { console.error(e); try { await mongoose.disconnect(); } catch (_) {} process.exit(1); });
