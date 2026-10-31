/* eslint-disable no-console */
// Undoes trailer moves that left or dragged tires: each listed tire goes back to
// the slot of the last move a person made on it, never an automatic one.
// Stops on a tire that moved or a slot that filled since the plan was written;
// `ifFree` entries are skipped instead. Dry run unless --apply.
//   node src/scripts/repairLs2DoubledSlots.js [--apply]
require('dotenv').config();
const mongoose = require('mongoose');
const Ls2TireAsset = require('../models/Ls2TireAsset');
const Ls2AssetEvent = require('../models/Ls2AssetEvent');
const Ls2Flatbed = require('../models/Ls2Flatbed');

const REASON = 'تصحيح: رجعت لآخر موضع سجله الموظف بعد نقل التيدر';
const onTrailer = (plateKey, positionNumber) => ({ plateKey, section: 'التيدر', positionNumber });
const spare = (plateKey) => ({ plateKey, section: 'الاستبن', positionNumber: 13 });
const PLAN = [
  { serial: '6158772568', from: '5916', to: onTrailer('5036', 7) },
  { serial: 'D651434000', from: '5916', to: onTrailer('5036', 8) },
  { serial: 'HCK02856U', from: '5916', to: onTrailer('5036', 9) },
  { serial: 'M6E280385', from: '5916', to: onTrailer('5036', 10) },
  { serial: 'M6R260107', from: '5916', to: onTrailer('5036', 11) },
  { serial: '6159590041', from: '5036', to: onTrailer('5007', 12) },
  { serial: 'Y5A306965', from: '5916', to: onTrailer('5036', 12) },
  { serial: 'C551618847', from: '5916', to: spare('5742') },
  { serial: 'B651483542', from: null, to: spare('8201'), ifFree: true },
  { serial: 'B651408339', from: null, to: spare('7363'), ifFree: true },
];

async function main() {
  const apply = process.argv.includes('--apply');
  await mongoose.connect(process.env.MONGODB_URI || process.env.MONGO_URI);
  const steps = [];
  const moving = PLAN.map((m) => m.serial);
  for (const m of PLAN) {
    const tire = await Ls2TireAsset.findOne({ serial: m.serial, status: 'mounted', plateKey: m.from });
    const held = await Ls2TireAsset.findOne({
      status: 'mounted', plateKey: m.to.plateKey, positionNumber: m.to.positionNumber, serial: { $nin: moving },
    }).select('serial').lean();
    const flatbed = await Ls2Flatbed.findOne({ plateKey: m.to.plateKey }).select('plate').lean();
    if (!tire || held || !flatbed) {
      const why = !tire ? `no longer on ${m.from}` : held ? `slot held by ${held.serial}` : `no flatbed ${m.to.plateKey}`;
      console.log(`${m.ifFree ? 'SKIP' : 'STOP'} ${m.serial} -> ${m.to.plateKey} pos ${m.to.positionNumber}: ${why}`);
      if (m.ifFree) continue;
      await mongoose.disconnect();
      process.exit(1);
    }
    const to = { ...m.to, plate: flatbed.plate };
    steps.push({ tire, to });
    console.log(`${m.serial}: ${tire.plate} pos ${tire.positionNumber} -> ${to.plate} pos ${to.positionNumber}`);
  }
  if (apply) {
    for (const { tire, to } of steps) {
      const from = { plate: tire.plate, plateKey: tire.plateKey, position: `${tire.positionNumber} ${tire.section}` };
      tire.set(to);
      await tire.save();
      await Ls2AssetEvent.create({
        entityType: 'tire', refId: tire._id, label: tire.serial, action: 'transferred',
        fromPlate: from.plate, fromPlateKey: from.plateKey, fromPosition: from.position,
        toPlate: to.plate, toPlateKey: to.plateKey, toPosition: `${to.positionNumber} ${to.section}`, reason: REASON,
      });
    }
  }
  console.log(apply ? `applied ${steps.length}` : `dry run: ${steps.length} moves`);
  await mongoose.disconnect();
}
main().catch((e) => { console.error(e.message); process.exit(1); });
