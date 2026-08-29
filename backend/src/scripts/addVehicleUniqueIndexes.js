/* eslint-disable no-console */
/**
 * addVehicleUniqueIndexes — يثبّت تفرّد الأرقام الرسميّة في سجلّ المركبات.
 *
 *   node src/scripts/addVehicleUniqueIndexes.js --dry
 *   node src/scripts/addVehicleUniqueIndexes.js --yes
 *
 * الفهرس في المخطَّط لا يُنشأ وحده على مجموعةٍ قائمة، ولا يُنشأ إن كان فيها
 * تكرارٌ أصلًا. فهذا السكربت يفحص التكرار أوّلًا ويسمّيه، ولا يبني إلّا ما صحّ
 * — بناءُ فهرسٍ يفشل في منتصف النشر أسوأ من فهرسٍ لم يُبنَ.
 */
require('dotenv').config();
const mongoose = require('mongoose');

const DRY = process.argv.includes('--dry');
const YES = process.argv.includes('--yes');

const FIELDS = [
  ['chassisNumber', 'رقم الهيكل'],
  ['serialNumber', 'الرقم التسلسلي'],
  ['operatingCard.cardNumber', 'رقم بطاقة التشغيل'],
  ['gps.serialImei', 'سريال جهاز التتبّع'],
  ['fuelCard.cardNumber', 'رقم شريحة الوقود'],
  ['authorizedPerson.authorizationNumber', 'رقم التفويض'],
];

(async () => {
  await mongoose.connect(process.env.MONGODB_URI);
  const { VehicleMaster } = require('../models/VehicleMaster');

  let blocked = 0;
  const plan = [];
  for (const [field, label] of FIELDS) {
    const dups = await VehicleMaster.aggregate([
      { $match: { [field]: { $gt: '' } } },
      { $group: { _id: `$${field}`, n: { $sum: 1 }, plates: { $push: '$plateNumber' } } },
      { $match: { n: { $gt: 1 } } },
    ]);
    if (dups.length) {
      blocked++;
      console.log(`  ✗ ${label} — ${dups.length} قيمةً مكرّرة، لن يُبنى الفهرس:`);
      dups.slice(0, 5).forEach((d) => console.log(`      «${d._id}» على ${d.n} مركبة: ${d.plates.slice(0, 5).join(' · ')}`));
    } else {
      const n = await VehicleMaster.countDocuments({ [field]: { $gt: '' } });
      console.log(`  ✓ ${label} — ${n} قيمةً مملوءة، بلا تكرار`);
      plan.push([field, label]);
    }
  }

  if (DRY || !YES) { console.log(`\n  ${DRY ? '— تجربةٌ فقط.' : '— لم يُمرَّر --yes.'} سيُبنى ${plan.length} فهرسًا.\n`); process.exit(blocked ? 1 : 0); }

  for (const [field, label] of plan) {
    const name = `${field.replace(/\./g, '_')}_unique`;
    try {
      await VehicleMaster.collection.createIndex(
        { [field]: 1 },
        { unique: true, partialFilterExpression: { [field]: { $gt: '' } }, name },
      );
      console.log(`  ✓ بُني ${name} (${label})`);
    } catch (e) {
      console.log(`  ✗ ${name}: ${e.message}`);
    }
  }
  console.log('');
  process.exit(blocked ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
