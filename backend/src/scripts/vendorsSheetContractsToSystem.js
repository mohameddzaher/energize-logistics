/**
 * Records on the system the contracts the vendors team's sheet marked as signed: contract status «موقع», or both
 * signature flags (vendor and us). Same fields «تمّ التعاقد رسميًّا» sets, with source `sheet` and no end date; the
 * files are uploaded later (the carrier then shows «بانتظار رفع ملف العقد»).
 * Idempotent: a carrier already recorded either way (contracted true or false) is never touched.
 * Usage: node src/scripts/vendorsSheetContractsToSystem.js (dry run) | --apply
 */
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const mongoose = require('mongoose');
const ShipmentOrderSupplier = require('../models/ShipmentOrderSupplier');

const APPLY = process.argv.includes('--apply');
const SIGNED_LABEL = /^\s*موقّ?ع\s*$/;
const MARKER = 'مستورَدٌ من شيت الموردين';

(async () => {
  await mongoose.connect(process.env.MONGODB_URI);
  const rows = await ShipmentOrderSupplier.find({ mergedInto: null, contracted: null })
    .select('name inMaster contractStatus vendorSigned ourSigned contractFiles').lean();
  const byLabel = rows.filter((r) => SIGNED_LABEL.test(r.contractStatus || ''));
  const byFlags = rows.filter((r) => !SIGNED_LABEL.test(r.contractStatus || '') && r.vendorSigned && r.ourSigned);
  const plan = [...byLabel, ...byFlags];
  const already = await ShipmentOrderSupplier.countDocuments({ mergedInto: null, contracted: true, contractSource: 'sheet' });
  console.log(`unrecorded carriers scanned: ${rows.length}`);
  console.log(`  «موقع» label: ${byLabel.length} · both signature flags only: ${byFlags.length} · to record: ${plan.length}`);
  console.log(`  of them on the approved list: ${plan.filter((r) => r.inMaster).length} · with a contract file already: ${plan.filter((r) => (r.contractFiles || []).length).length}`);
  console.log(`  already recorded from the sheet earlier: ${already}`);
  plan.slice(0, 15).forEach((r) => console.log(`    ${r._id}  ${r.name}  [${r.contractStatus || '—'}${r.vendorSigned && r.ourSigned ? ' · flags' : ''}]`));
  if (plan.length > 15) console.log(`    … ${plan.length - 15} more`);
  if (!APPLY || !plan.length) {
    console.log(APPLY ? 'Nothing to write.' : 'Dry run (pass --apply to write).');
    return mongoose.disconnect();
  }
  const dir = fs.existsSync('/opt/energize/backups') ? '/opt/energize/backups' : path.join(process.cwd(), 'backups');
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `shipmentordersuppliers-before-sheet-contracts-${Date.now()}.json`);
  fs.writeFileSync(file, JSON.stringify(plan.map((r) => ({ _id: r._id, name: r.name, contracted: null, contractStatus: r.contractStatus, vendorSigned: r.vendorSigned, ourSigned: r.ourSigned })), null, 1));
  const now = new Date();
  // The filter repeats `contracted: null` so a record made on the system meanwhile is never overwritten.
  const r = await ShipmentOrderSupplier.updateMany({ _id: { $in: plan.map((x) => x._id) }, contracted: null }, {
    $set: { contracted: true, contractSource: 'sheet', contractRecordedAt: now, contractRecordedBy: null, contractRecordedByName: MARKER, contractEndDate: null },
  });
  // Dashboards read cached figures; the shared stamp clears both workers.
  const cache = require('../utils/ttlCache');
  for (const p of ['so:registry:', 'so:analytics:']) await cache.clearShared(p);
  console.log(`Recorded ${r.modifiedCount} contracts · backup: ${file}`);
  await mongoose.disconnect();
})().catch((e) => { console.error(e); process.exit(1); });
