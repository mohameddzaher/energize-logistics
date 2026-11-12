/**
 * Containers transactions that have a return deadline and an unloading date but no free days: fill the free days
 * from the gap (the two are one fact, see services/customsDeadlines). Dry run by default; --apply writes a backup first.
 */
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const mongoose = require('mongoose');

(async () => {
  const apply = process.argv.includes('--apply');
  await mongoose.connect(process.env.MONGODB_URI || process.env.MONGO_URI);
  const CustomsClearance = require('../models/CustomsClearance');
  const rows = await CustomsClearance.find({
    cargoType: { $ne: 'vehicles' }, returnDeadline: { $gt: '' }, unloadingAppointment: { $gt: '' },
    $or: [{ returnFreeDays: { $lte: 0 } }, { returnFreeDays: null }],
  }).select('refNumber unloadingAppointment returnDeadline returnFreeDays').lean();
  const ymd = (v) => String(v || '').slice(0, 10);
  const plan = rows.map((r) => ({ id: r._id, ref: r.refNumber, days: Math.round((new Date(`${ymd(r.returnDeadline)}T12:00:00Z`) - new Date(`${ymd(r.unloadingAppointment)}T12:00:00Z`)) / 86400000) }))
    .filter((p) => Number.isFinite(p.days) && p.days >= 0);
  for (const p of plan) console.log(`  ${p.ref}  ${p.days} days`);
  console.log(`${plan.length} to fill`);
  if (!apply) { console.log('Dry run (pass --apply to write).'); process.exit(0); }
  const dir = fs.existsSync('/opt/energize/backups') ? '/opt/energize/backups' : path.join(process.cwd(), 'backups');
  fs.mkdirSync(dir, { recursive: true });
  const bk = path.join(dir, `customs-return-days-before-${Date.now()}.json`);
  fs.writeFileSync(bk, JSON.stringify(rows));
  for (const p of plan) await CustomsClearance.updateOne({ _id: p.id, $or: [{ returnFreeDays: { $lte: 0 } }, { returnFreeDays: null }] }, { $set: { returnFreeDays: p.days } });
  try { require('../utils/ttlCache').clear('customs:'); } catch (e) { /* the TTL is enough */ }
  console.log(`Filled ${plan.length} · backup: ${bk}`);
  process.exit(0);
})().catch((e) => { console.error(e.message); process.exit(1); });
