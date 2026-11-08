/* eslint-disable no-console */
// Tires recorded as mounted on no truck and no trailer go back to the store as used stock, with a logged movement,
// so the workshop can mount them where they really are. Backs up the rows first. Dry run unless --apply.
//   node src/scripts/repairLs2MountedNowhere.js [--apply]
require('dotenv').config();
const fs = require('fs');
const mongoose = require('mongoose');
const Ls2TireAsset = require('../models/Ls2TireAsset');
const Ls2AssetEvent = require('../models/Ls2AssetEvent');

const REASON = 'تصحيح: كانت مسجّلة مركّبة بدون عربية ولا تيدر (نقل تيدر قديم) — رجعت للمستودع لتُركَّب من مكانها الفعلي';

(async () => {
  const apply = process.argv.includes('--apply');
  await mongoose.connect(process.env.MONGODB_URI || process.env.MONGO_URI);
  const q = { status: 'mounted', $and: [{ $or: [{ plateKey: null }, { plateKey: '' }] }, { $or: [{ trailerNumber: null }, { trailerNumber: '' }] }] };
  const rows = await Ls2TireAsset.find(q);
  rows.forEach((t) => console.log(`${t.serial}: ${t.positionLabel || ''} ${t.section || ''} -> store (used)`));
  if (apply && rows.length) {
    const dir = '/opt/energize/backups';
    const file = `${fs.existsSync(dir) ? dir : '.'}/ls2-mounted-nowhere-${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
    fs.writeFileSync(file, JSON.stringify(rows.map((r) => r.toObject()), null, 1));
    console.log('backup', file);
    for (const t of rows) {
      const from = `${t.positionLabel || t.positionNumber || ''} — ${t.section || ''}`;
      t.set({ status: 'spare', condition: t.condition === 'new' ? 'new' : 'used', plate: null, plateKey: null, positionNumber: null, positionLabel: '', section: '' });
      await t.save(); // eslint-disable-line no-await-in-loop
      await Ls2AssetEvent.create({ entityType: 'tire', refId: t._id, label: t.serial, action: 'to_store', fromPosition: from, reason: REASON }); // eslint-disable-line no-await-in-loop
    }
  }
  console.log(apply ? `moved ${rows.length}` : `dry run: ${rows.length}`);
  await mongoose.disconnect();
})().catch((e) => { console.error(e.message); process.exit(1); });
