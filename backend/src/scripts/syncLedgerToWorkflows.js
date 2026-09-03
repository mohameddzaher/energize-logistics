/**
 * syncLedgerToWorkflows — ما يعرفه دفترُ التحصيل يصل إلى الكشف.
 *
 *   node src/scripts/syncLedgerToWorkflows.js --dry
 *   node src/scripts/syncLedgerToWorkflows.js
 *
 * ── الواقعة ────────────────────────────────────────────────────────────────
 * الفاتورة ٩٧١٩ في دفتر التحصيل: سُلّمت في ١ مارس وحالتُها «محصَّلة». وكشفُها
 * في التشغيل (٦٢٨٠٠) خانتا التسليم والتحصيل فيه فارغتان. فمن فتح الكشف رأى
 * فاتورةً لم تُسلَّم بعد، ومن فتح الدفتر رآها منتهية — والاثنان عن الشيء نفسه.
 *
 * وليست واحدة: ألفان ومئتان وثلاثةٌ وسبعون كشفًا تحمل رقمَ فاتورةٍ يعرف الدفترُ
 * تاريخَ تسليمها ولا يعرفه الكشف.
 *
 * ── والقاعدة هي القاعدة ────────────────────────────────────────────────────
 * يُملأ الفارغُ ولا يُدهَس المكتوب. وما اختلف فيه الدفتران يُعَدّ ويُعرَض ولا
 * يُطبَّق: تاريخان مختلفان لتسليمٍ واحد سؤالٌ لبشرٍ لا لسكربت.
 *
 * والاتّجاهُ من الدفتر إلى الكشف لا العكس: الدفترُ مصدرُه دفترُ التحصيل الورقيّ
 * وفيه تسعةُ آلافِ فاتورة، والكشوفُ تعرف ستّةً في المئة منها. أمّا من اليوم
 * فصار كلُّ تسجيلٍ في الشاشة يكتب في الوجهين معًا (راجع syncInvoiceLedger).
 */
require('dotenv').config();
const mongoose = require('mongoose');

const DRY = process.argv.includes('--dry');
// ── ولماذا يُفصَل التسليمُ عن التحصيل ──────────────────────────────────────
//
// «تاريخ التحصيل» شيءٌ واحد في الدفترين: وصل المال. ولذلك يملأ ألفين وتسعمئةً
// وثمانيةً وثمانين كشفًا ويختلف في اثنين فقط — دليلٌ كافٍ على أنّهما عن الشيء
// نفسِه.
//
// أمّا «تاريخ التسليم» فمشكوكٌ في أنّه واحد: في شيت المتابعة يقع بين «تاريخ
// الإرسال» و«مراجعة الحسابات» وقبل أعمدة الفاتورة كلِّها — أي أنّه تسليمُ
// الكشف إلى الحسابات؛ وفي دفتر التحصيل هو تسليمُ الفاتورة إلى العميل. ولو
// كانا واحدًا لتطابقا في أكثر الصفوف، وهما يتطابقان في خمسةٍ وسبعين ويختلفان
// في ثمانمئةٍ وستّةٍ وتسعين.
//
// فلا يُملأ أحدُهما من الآخر بالتخمين: `--with-delivery` قرارٌ يُتَّخذ صراحةً
// بعد أن يقول صاحبُ الدفتر إنّهما شيءٌ واحد.
const WITH_DELIVERY = process.argv.includes('--with-delivery');
const sameDay = (a, b) => a && b && new Date(a).toISOString().slice(0, 10) === new Date(b).toISOString().slice(0, 10);

(async () => {
  await mongoose.connect(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 30000 });
  const CollectionInvoice = require('../models/CollectionInvoice');
  const OW = require('../models/OperationsWorkflow');

  console.log(DRY ? '— تجربة، بلا كتابة —\n' : '');
  const invs = await CollectionInvoice.find({
    $or: [{ deliveryDate: { $ne: null } }, { collectionDate: { $ne: null } }],
  }).select('invoiceNumber deliveryDate collectionDate status').lean();
  console.log(`فواتيرُ الدفتر ولها تاريخُ تسليمٍ أو تحصيل: ${invs.length}`);

  const byNo = new Map();
  for (const i of invs) {
    const no = String(i.invoiceNumber || '').trim();
    if (!no) continue;
    // الفاتورةُ الواحدة قد تُسجَّل نقديّةً وضريبيّة؛ يُؤخذ ما فيه تاريخ.
    const cur = byNo.get(no);
    if (!cur || (!cur.deliveryDate && i.deliveryDate) || (!cur.collectionDate && i.collectionDate)) byNo.set(no, i);
  }

  const nums = [...byNo.keys()];
  const ops = [];
  const stat = { deliveryFilled: 0, collectionFilled: 0, deliverySame: 0, collectionSame: 0, deliveryConflict: 0, collectionConflict: 0 };
  const conflicts = [];
  let seen = 0;

  for (let i = 0; i < nums.length; i += 500) {
    const part = await OW.find({ invoiceNumber: { $in: nums.slice(i, i + 500) } })
      .select('reportNumber invoiceNumber deliveryDate collectionDate').lean();
    seen += part.length;
    for (const w of part) {
      const inv = byNo.get(String(w.invoiceNumber).trim());
      if (!inv) continue;
      const patch = {};
      if (inv.deliveryDate) {
        if (!w.deliveryDate) { if (WITH_DELIVERY) patch.deliveryDate = inv.deliveryDate; stat.deliveryFilled += 1; }
        else if (sameDay(w.deliveryDate, inv.deliveryDate)) stat.deliverySame += 1;
        else { stat.deliveryConflict += 1; conflicts.push(`كشف ${w.reportNumber} فاتورة ${w.invoiceNumber}: تسليمُنا ${String(w.deliveryDate).slice(0, 10)} والدفتر ${String(inv.deliveryDate).slice(0, 10)}`); }
      }
      if (inv.collectionDate) {
        if (!w.collectionDate) { patch.collectionDate = inv.collectionDate; stat.collectionFilled += 1; }
        else if (sameDay(w.collectionDate, inv.collectionDate)) stat.collectionSame += 1;
        else { stat.collectionConflict += 1; conflicts.push(`كشف ${w.reportNumber} فاتورة ${w.invoiceNumber}: تحصيلُنا ${String(w.collectionDate).slice(0, 10)} والدفتر ${String(inv.collectionDate).slice(0, 10)}`); }
      }
      if (Object.keys(patch).length) ops.push({ updateOne: { filter: { _id: w._id }, update: { $set: patch } } });
    }
    process.stdout.write(`\r  فُحص ${Math.min(i + 500, nums.length)}/${nums.length} رقمَ فاتورة…`);
  }
  console.log(`\nكشوفٌ تحمل أرقامَ تلك الفواتير: ${seen}\n`);

  console.log('             يُملأ   مطابق   مختلف (يُترك)');
  console.log('─'.repeat(48));
  console.log(`  التسليم  ${String(stat.deliveryFilled).padStart(8)} ${String(stat.deliverySame).padStart(7)} ${String(stat.deliveryConflict).padStart(8)}`
    + (WITH_DELIVERY ? '' : '   ← لا يُكتب بلا --with-delivery'));
  console.log(`  التحصيل  ${String(stat.collectionFilled).padStart(8)} ${String(stat.collectionSame).padStart(7)} ${String(stat.collectionConflict).padStart(8)}`);
  console.log('─'.repeat(48));
  console.log(`\nكشوفٌ ستتغيّر: ${ops.length}`);
  if (conflicts.length) {
    console.log(`\nاختلافاتٌ تُترك للمراجعة (${conflicts.length}):`);
    for (const c of conflicts.slice(0, 20)) console.log('    ' + c);
    if (conflicts.length > 20) console.log(`    … و${conflicts.length - 20} غيرها`);
  }

  if (!DRY && ops.length) {
    let done = 0;
    for (let i = 0; i < ops.length; i += 500) {
      const r = await OW.bulkWrite(ops.slice(i, i + 500), { ordered: false });
      done += r.modifiedCount || 0;
    }
    console.log(`\n✓ عُدِّل ${done} كشفًا`);
  }
  await mongoose.disconnect();
})().catch((e) => { console.error(e); process.exit(1); });
