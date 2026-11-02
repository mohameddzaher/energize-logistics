/**
 * fillPaymentTypeFromIndicator: the tax / non-tax indicator column feeds payment type wherever it came from.
 * --dry previews.
 * Import fills payment type from that column of the sheet it reads, but some statements got the column from an older import and their rows are absent from the newer sheet, so they have no payment type; twelve of them are counted as cash in the cash collections ledger.
 * The rule applies to the field, not the sheet: where the column exists and no type is set, read it. Hand-entered types are never overwritten, since type is per statement (one customer can be cash on one load and tax on another).
 */
require('dotenv').config();
const mongoose = require('mongoose');

const DRY = process.argv.includes('--dry');

/** Spellings seen in the files and what each can mean. */
const readType = (v) => {
  const s = String(v == null ? '' : v).trim().toLowerCase();
  if (!s) return null;
  if (/^(cash|كاش|نقد|غ\s*ض|غير\s*ضريب)/.test(s)) return 'cash';
  if (/ضريب|^tax$|^ض$/.test(s)) return 'tax';
  return null;                       // Unseen spelling: leave it, do not guess.
};

(async () => {
  await mongoose.connect(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 30000 });
  const OW = require('../models/OperationsWorkflow');

  console.log(DRY ? '— تجربة، بلا كتابة —\n' : '');
  const blank = { $or: [{ paymentType: null }, { paymentType: '' }] };
  const rows = await OW.find({ $and: [blank, { taxIndicator: { $nin: [null, ''] } }] })
    .select('reportNumber taxIndicator username').lean();
  console.log(`كشوفٌ بلا نوعِ دفعٍ ولها عمود «ض / غ ض»: ${rows.length}`);

  const ops = []; const unread = [];
  const tally = { cash: 0, tax: 0 };
  for (const w of rows) {
    const t = readType(w.taxIndicator);
    if (!t) { unread.push(`${w.reportNumber} «${w.taxIndicator}»`); continue; }
    tally[t] += 1;
    ops.push({ updateOne: { filter: { _id: w._id }, update: { $set: { paymentType: t } } } });
    if (ops.length <= 15) console.log(`   كشف ${w.reportNumber}  «${w.taxIndicator}» → ${t}   ${w.username || ''}`);
  }
  console.log(`\n${DRY ? 'سيُكتب' : 'كُتب'}: نقديّ ${tally.cash} · ضريبيّ ${tally.tax}`);
  if (unread.length) console.log(`صياغةٌ غيرُ مقروءةٍ (تُترك): ${unread.length} — ${unread.slice(0, 6).join('، ')}`);

  if (!DRY && ops.length) {
    let done = 0;
    for (let i = 0; i < ops.length; i += 500) {
      const r = await OW.bulkWrite(ops.slice(i, i + 500), { ordered: false });
      done += r.modifiedCount || 0;
    }
    console.log(`✓ عُدِّل ${done} كشفًا`);
  }

  const after = await OW.aggregate([{ $group: { _id: '$paymentType', n: { $sum: 1 } } }, { $sort: { n: -1 } }]);
  console.log('\nنوعُ الدفع في السجلّ الآن:');
  for (const a of after) console.log(`  ${String(a.n).padStart(6)}  ${a._id || '(بلا نوع)'}`);
  await mongoose.disconnect();
})().catch((e) => { console.error(e); process.exit(1); });
