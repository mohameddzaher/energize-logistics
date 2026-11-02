/* eslint-disable no-console */
/**
 * cleanFleetTestData: delete test loads and their customers from fleet management.
 * Usage: node src/scripts/cleanFleetTestData.js --dry | --yes
 * Synthetic data corrupts income, analytics and ratings. Nothing is deleted before a full backup file is written. Deleted: loads created before go-live (--before), their events, and explicit test customers left with no load.
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
// Every load in the section today is from the build and test period; the date is passed explicitly so the script stays valid if run after real work enters.
const BEFORE = new Date(argOf('--before', '2026-08-28'));

/** Names that can only be test data. */
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

  // Customers: explicit test names only, and only if no load remains for them.
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

  // Waybill counter: reset to its start only when no waybill remains, so the first real waybill starts at 100001 as designed. If one remains the counter is untouched, since reusing an issued number would duplicate an official paper.
  if (await FleetShipment.countDocuments() === 0) {
    const FleetCounter = mongoose.models.FleetCounter || mongoose.model('FleetCounter');
    await FleetCounter.updateOne({ _id: 'waybill' }, { $set: { seq: 100000 } }, { upsert: true });
    console.log('  ✓ عدّاد البوليصة أُعيد — أوّل بوليصةٍ حقيقيّة ستحمل 100001.');
  }
  console.log('');
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
