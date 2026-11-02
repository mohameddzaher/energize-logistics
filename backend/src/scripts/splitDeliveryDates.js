/**
 * Separates branch delivery from customer delivery.
 * Usage: node src/scripts/splitDeliveryDates.js [--dry]
 * The old single delivery date was two events: the statement handed to the branch (operations, the tracking-sheet column) and the invoice handed to the customer (collections, which starts the payment term). Everything in deliveryDate came from the sheet, so it is moved to branchDeliveryDate and deliveryDate is emptied for customer delivery only. Merged dates would start the payment term too early and show invoices as overdue within their term.
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

  // Rows already moved are not moved twice: the branch field must be empty.
  const filter = { deliveryDate: { $ne: null }, $or: [{ branchDeliveryDate: null }, { branchDeliveryDate: { $exists: false } }] };
  const toMove = await OW.countDocuments(filter);
  console.log(`\n${DRY ? 'سيُنقَل' : 'نُقل'} إلى «تاريخ التسليم للفرع»: ${toMove}`);

  if (!DRY && toMove) {
    // Two steps, copy then clear, so an interruption between them leaves the value in both fields rather than lost from both.
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
