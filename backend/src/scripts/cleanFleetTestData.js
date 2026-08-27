/* eslint-disable no-console */
/**
 * cleanFleetTestData — يحذف حمولات التجربة وعملاءها من قسم إدارة الأسطول.
 *
 *   node src/scripts/cleanFleetTestData.js --dry
 *   node src/scripts/cleanFleetTestData.js --yes
 *
 * القسم بُني وجُرِّب ببياناتٍ مصطنعة، وهي الآن تفسد كلَّ رقمٍ في القسم: تدخل
 * في الدخل والتحليلات وتقييم السائقين وملفّات العملاء. فتُحذف قبل أن يبدأ
 * الشغل الحقيقيّ عليه.
 *
 * ولا يُحذف شيءٌ إلّا بعد كتابته كاملًا في ملفّ نسخةٍ احتياطية — الحذف قرارٌ
 * لا يُراجَع، وما لم يُنسخ لا يعود.
 *
 * ما يُحذف: كلُّ حمولةٍ أُنشئت قبل بدء التشغيل الفعليّ (--before)، وأحداثُها،
 * والعملاء الذين اسمُهم صريحٌ في التجربة ولا حمولة لهم بعد الحذف.
 */
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const mongoose = require('mongoose');

const DRY = process.argv.includes('--dry');
const YES = process.argv.includes('--yes');
const argOf = (flag, dflt) => {
  const i = process.argv.indexOf(flag);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : dflt;
};
// كلُّ حمولةٍ في القسم اليوم من فترة البناء والاختبار؛ التاريخ يُمرَّر صراحةً
// كي يبقى السكربت صالحًا لو شُغِّل بعد أن يدخل شغلٌ حقيقيّ.
const BEFORE = new Date(argOf('--before', '2026-08-28'));

/** أسماءٌ لا تكون إلّا تجربة. */
const TEST_NAME = /تجرب|تجريب|test|demo|اختبار/i;

(async () => {
  await mongoose.connect(process.env.MONGODB_URI);
  const { FleetCustomer, FleetShipment, FleetEvent } = require('../models/FleetModels');

  const shipments = await FleetShipment.find({ createdAt: { $lt: BEFORE } }).lean();
  const ids = shipments.map((s) => s._id);
  const events = ids.length ? await FleetEvent.find({ shipment: { $in: ids } }).lean() : [];

  console.log(`\n  حمولاتٌ أُنشئت قبل ${BEFORE.toISOString().slice(0, 10)}: ${shipments.length} · أحداثُها: ${events.length}`);
  for (const s of shipments) {
    console.log(`    بوليصة ${s.waybillNumber} · ${s.customerName || '—'} · ${s.vehiclePlate || '—'} · ${s.status} · ${new Date(s.createdAt).toISOString().slice(0, 10)}`);
  }
  const kept = await FleetShipment.countDocuments({ createdAt: { $gte: BEFORE } });
  console.log(`  يبقى ${kept} حمولة.`);

  // العملاء: صريحو التجربة فقط، وبشرط ألّا تبقى لهم حمولة.
  const survivors = new Set(
    (await FleetShipment.find({ createdAt: { $gte: BEFORE } }).select('customer').lean())
      .map((s) => String(s.customer)).filter(Boolean),
  );
  const allCustomers = await FleetCustomer.find().lean();
  const testCustomers = allCustomers.filter((c) => TEST_NAME.test(c.name) && !survivors.has(String(c._id)));
  console.log(`\n  عملاءُ تجربةٍ سيُحذفون: ${testCustomers.length}`);
  testCustomers.forEach((c) => console.log(`    ${c.name}`));
  const suspicious = allCustomers.filter((c) => !TEST_NAME.test(c.name) && !survivors.has(String(c._id)) && !c.nameKey);
  if (suspicious.length) {
    console.log(`\n  · ${suspicious.length} عميلًا بلا حمولةٍ باقية واسمُه ليس تجربةً صريحة — لن يُحذف، يُراجَع يدويًّا:`);
    suspicious.forEach((c) => console.log(`    ${c.name}`));
  }

  if (DRY || !YES) { console.log('\n  ' + (DRY ? '— تجربةٌ فقط، لم يُحذف شيء.' : '— لم يُمرَّر --yes، فلم يُحذف شيء.') + '\n'); process.exit(0); }

  const dir = path.join(__dirname, '../../backups');
  fs.mkdirSync(dir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const file = path.join(dir, `fleet-test-data-${stamp}.json`);
  fs.writeFileSync(file, JSON.stringify({ shipments, events, customers: testCustomers }, null, 1));
  console.log(`\n  ↩ نسخةٌ احتياطية: ${path.relative(process.cwd(), file)}`);

  if (ids.length) {
    await FleetEvent.deleteMany({ shipment: { $in: ids } });
    await FleetShipment.deleteMany({ _id: { $in: ids } });
  }
  if (testCustomers.length) await FleetCustomer.deleteMany({ _id: { $in: testCustomers.map((c) => c._id) } });
  console.log(`  ✓ حُذف ${shipments.length} حمولة · ${events.length} حدثًا · ${testCustomers.length} عميلًا.`);

  // عدّاد البوليصة: يُعاد إلى بدايته وحده حين لا تبقى بوليصةٌ واحدة — فتبدأ
  // أوّلُ بوليصةٍ حقيقيّة من 100001 كما صُمّم. ولو بقيت واحدةٌ لم يُمسّ العدّاد،
  // فإعادةُ استعمال رقمٍ صدر لعميلٍ ورقةٌ رسميّةٌ مكرّرة.
  if (await FleetShipment.countDocuments() === 0) {
    const FleetCounter = mongoose.models.FleetCounter || mongoose.model('FleetCounter');
    await FleetCounter.updateOne({ _id: 'waybill' }, { $set: { seq: 100000 } }, { upsert: true });
    console.log('  ✓ عدّاد البوليصة أُعيد — أوّل بوليصةٍ حقيقيّة ستحمل 100001.');
  }
  console.log('');
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
