/**
 * splitDeliveryDates — تسليمُ الفرع يُفصَل عن تسليم العميل.
 *
 *   node src/scripts/splitDeliveryDates.js --dry
 *   node src/scripts/splitDeliveryDates.js
 *
 * ── الواقعة ────────────────────────────────────────────────────────────────
 * «تاريخ التسليم» كان حقلًا واحدًا، وهو حدثان:
 *
 *   · تسليمُ الكشف إلى الفرع — عملُ التشغيل، وهو ما في عمود شيت المتابعة الواقع
 *     بين «تاريخ الإرسال» و«مراجعة الحسابات».
 *   · تسليمُ الفاتورة إلى العميل — عملُ التحصيل، ومنه تبدأ مهلةُ السداد: عميلٌ
 *     على خمسةٍ وأربعين يومًا تُعَدُّ مهلتُه من يوم استلامه الفاتورة.
 *
 * وكلُّ ما في `deliveryDate` اليومَ جاء من عمود الشيت — أي أنّه تسليمُ الفرع.
 * منصّةُ التشغيل لا تُرسل هذا الحقل أصلًا (راجع opsWorkflowSyncService)، فلا
 * مصدرَ ثالثَ له. فيُنقَل كلُّه إلى `branchDeliveryDate`، ويُفرَّغ `deliveryDate`
 * ليبقى لتسليم العميل وحدَه — يكتبه قسمُ التحصيل من زرّ «تسليم».
 *
 * وترْكُهما مدموجين يعني أن تُحسب مهلةُ السداد من تاريخٍ أسبقَ من التسليم
 * الحقيقيّ، فتظهر فاتورةٌ متأخّرةً وهي في مهلتها.
 */
require('dotenv').config();
const mongoose = require('mongoose');

const DRY = process.argv.includes('--dry');

(async () => {
  await mongoose.connect(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 30000 });
  const OW = require('../models/OperationsWorkflow');

  console.log(DRY ? '— تجربة، بلا كتابة —\n' : '');
  const [withDelivery, alreadySplit, total] = await Promise.all([
    OW.countDocuments({ deliveryDate: { $ne: null } }),
    OW.countDocuments({ branchDeliveryDate: { $ne: null } }),
    OW.countDocuments({}),
  ]);
  console.log(`الكشوف: ${total}`);
  console.log(`  لها «تاريخ التسليم» الآن: ${withDelivery}`);
  console.log(`  لها «تاريخ التسليم للفرع» سلفًا: ${alreadySplit}`);

  // مَن نُقل سلفًا لا يُنقَل مرّتين: يُشترَط أن تكون خانةُ الفرع فارغة.
  const filter = { deliveryDate: { $ne: null }, $or: [{ branchDeliveryDate: null }, { branchDeliveryDate: { $exists: false } }] };
  const toMove = await OW.countDocuments(filter);
  console.log(`\n${DRY ? 'سيُنقَل' : 'نُقل'} إلى «تاريخ التسليم للفرع»: ${toMove}`);

  if (!DRY && toMove) {
    // خطوتان لا واحدة: النسخُ أوّلًا، ثمّ التفريغ — فإن انقطع الاتّصال بينهما
    // بقيت القيمةُ في الحقلين لا ضائعةً من كليهما.
    const copied = await OW.updateMany(filter, [{ $set: { branchDeliveryDate: '$deliveryDate' } }]);
    console.log(`  نُسخ: ${copied.modifiedCount}`);
    const cleared = await OW.updateMany(
      { branchDeliveryDate: { $ne: null }, deliveryDate: { $ne: null }, $expr: { $eq: ['$branchDeliveryDate', '$deliveryDate'] } },
      { $set: { deliveryDate: null } },
    );
    console.log(`  فُرِّغ «تاريخ التسليم للعميل»: ${cleared.modifiedCount}`);
  }

  const after = {
    branch: await OW.countDocuments({ branchDeliveryDate: { $ne: null } }),
    customer: await OW.countDocuments({ deliveryDate: { $ne: null } }),
  };
  console.log(`\n${DRY ? 'سيصير' : 'صار'}: تسليمُ الفرع ${after.branch} · تسليمُ العميل ${after.customer}`);
  console.log('وتسليمُ العميل يكتبه قسمُ التحصيل من زرّ «تسليم» — ومنه تُعَدُّ مهلةُ السداد.');
  await mongoose.disconnect();
})().catch((e) => { console.error(e); process.exit(1); });
