/**
 * fillPaymentTypeFromIndicator — «ض / غ ض» تُغذّي نوعَ الدفع أينما كان مصدرُها.
 *
 *   node src/scripts/fillPaymentTypeFromIndicator.js --dry
 *
 * ── لماذا سكربتٌ منفصلٌ عن الاستيراد ────────────────────────────────────────
 * الاستيرادُ يملأ نوعَ الدفع من عمود «ض / غ ض» في الشيت الذي يقرؤه. لكنّ في
 * القاعدة كشوفًا وصلها العمودُ من استيرادٍ أقدم ولم تصلها هذه القاعدة، لأنّ
 * الشيتَ الأحدث لا يحوي صفوفَها. فبقيت بلا نوعِ دفعٍ ومعها الجوابُ مكتوبٌ في
 * حقلها نفسِه — واثنا عشر كشفًا منها في دفتر التحصيل النقديّ يعدُّها نقديّةً.
 *
 * فالقاعدةُ تُطبَّق على الحقل لا على الورقة: أينما وُجد العمودُ ولا نوعَ للكشف،
 * يُقرأ منه. والمكتوبُ باليد لا يُدهَس — النوعُ قرارٌ يُتَّخذ على الكشف نفسِه،
 * فالعميلُ الواحد كاشٌ في حمولةٍ وضريبيٌّ في أخرى.
 */
require('dotenv').config();
const mongoose = require('mongoose');

const DRY = process.argv.includes('--dry');

/** الصياغاتُ التي رأيناها في الملفّات، وما يُحتمل منها. */
const readType = (v) => {
  const s = String(v == null ? '' : v).trim().toLowerCase();
  if (!s) return null;
  if (/^(cash|كاش|نقد|غ\s*ض|غير\s*ضريب)/.test(s)) return 'cash';
  if (/ضريب|^tax$|^ض$/.test(s)) return 'tax';
  return null;                       // صياغةٌ لم نرَها — تُترك ولا تُخمَّن
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
