/* eslint-disable no-console */
// Undoes a trailer return that left tires behind: each listed tire goes to the
// slot it physically occupies. Refuses a tire that moved or a slot that filled
// since the plan was written. Dry run unless --apply.
//   node src/scripts/repairLs2DoubledSlots.js [--apply]
require('dotenv').config();
const mongoose = require('mongoose');
const Ls2TireAsset = require('../models/Ls2TireAsset');
const Ls2AssetEvent = require('../models/Ls2AssetEvent');

const REASON = 'تصحيح: فضلت مسجّلة مكانها لما التيدر اتنقل';
const TRAILER_27 = { plate: '5036', plateKey: '5036', section: 'التيدر' };
const PLAN = [
  { serial: '6158772568', from: '5916', to: { ...TRAILER_27, positionNumber: 7 } },
  { serial: 'D651434000', from: '5916', to: { ...TRAILER_27, positionNumber: 8 } },
  { serial: 'HCK02856U', from: '5916', to: { ...TRAILER_27, positionNumber: 9 } },
  { serial: 'M6E280385', from: '5916', to: { ...TRAILER_27, positionNumber: 10 } },
  { serial: 'M6R260107', from: '5916', to: { ...TRAILER_27, positionNumber: 11 } },
  { serial: 'C551618847', from: '5916', to: { plate: 'ا ص ي 5742', plateKey: '5742', section: 'الاستبن', positionNumber: 13 } },
];

async function main() {
  const apply = process.argv.includes('--apply');
  await mongoose.connect(process.env.MONGODB_URI || process.env.MONGO_URI);
  const steps = [];
  for (const m of PLAN) {
    const tire = await Ls2TireAsset.findOne({ serial: m.serial, status: 'mounted', plateKey: m.from });
    const held = await Ls2TireAsset.findOne({ status: 'mounted', plateKey: m.to.plateKey, positionNumber: m.to.positionNumber }).select('serial').lean();
    if (!tire || held) {
      console.log(`STOP ${m.serial}: ${!tire ? `no longer on ${m.from}` : `slot held by ${held.serial}`}`);
      await mongoose.disconnect();
      process.exit(1);
    }
    steps.push({ tire, to: m.to });
    console.log(`${m.serial}: ${tire.plate} pos ${tire.positionNumber} -> ${m.to.plate} pos ${m.to.positionNumber}`);
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
