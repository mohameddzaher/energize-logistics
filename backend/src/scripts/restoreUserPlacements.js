/* eslint-disable no-console */
/**
 * restoreUserPlacements: what the user did is the truth, and import must not override it. Usage: node src/scripts/restoreUserPlacements.js [--dry|--yes] Fix: when the final stocktake conflicted with two moves users made from the screen, the sheet was preferred. That is backwards: the sheet is an
 * old snapshot, while the screen move happened on the ground by a person looking at the truck. Rule: the user's action is authoritative; the sheet wins only for fields nobody touched. The two moves: 1) Tire Y5S243257: the user moved it from 5034 to 3447 on Aug 6 for wear. It had been returned to
 * the store because the stocktake put another tire in the same position. It should stay on 3447, and the stocktake tire (Y5S425919) waits in the store until the workshop decides, since it came from paper and the other from a hand. 2) Trailer 27: the user took it off 8198 on Aug 9. It had been hung
 * on TR1 because the screen had no 'standing alone' option then, and TR1 was a dummy flatbed made for trailer 59. It had been put back on 8198. The user's decision must be executed: the trailer is off 8198 and there is now a state for exactly that (standing alone), with its tires.
 */
require('dotenv').config();
const mongoose = require('mongoose');

const DRY = !process.argv.includes('--yes');

(async () => {
  await mongoose.connect(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 20000 });
  const Ls2TireAsset = require('../models/Ls2TireAsset');
  const Ls2Trailer = require('../models/Ls2Trailer');
  const Ls2Flatbed = require('../models/Ls2Flatbed');
  const Ls2AssetEvent = require('../models/Ls2AssetEvent');
  const { plateKey } = require('../utils/plateKey');

  const log = (...a) => console.log(...a);

  // 1) The tire returns to the user's position
  log('── الكاوتش Y5S243257 ──');
  const mine = await Ls2TireAsset.findOne({ serial: 'Y5S243257' });
  const fromSheet = await Ls2TireAsset.findOne({ serial: 'Y5S425919' });
  const k3447 = plateKey('أ ط ح 3447');
  if (!mine) { log('   مش موجود — اتخطّى'); } else {
    log(`   دلوقتي: ${mine.status} · ${mine.plate || 'مخزن'}`);
    log(`   المفروض: مركّب على 3447 موقع 1 (نقلة اليوزر يوم ٦ أغسطس — «تآكل»)`);
    log(`   وفردة الجرد ${fromSheet ? fromSheet.serial : '—'} تستنى في المخزن`);
    if (!DRY) {
      // First free the position from the stocktake tire
      if (fromSheet && String(fromSheet.plateKey) === String(k3447) && fromSheet.positionNumber === 1) {
        const f = { plate: fromSheet.plate, key: fromSheet.plateKey, pos: `${fromSheet.positionLabel} — ${fromSheet.section}` };
        fromSheet.set({
          status: 'spare', plate: null, plateKey: null, positionNumber: null,
          positionLabel: '', section: '', isSpare: false, trailerNumber: null,
          notes: [fromSheet.notes, 'جات من الجرد على 3447 موقع 1، والموقع عليه فردة نقلها موظف — مستنية قرار الورشة']
            .filter(Boolean).join(' · '),
        });
        await fromSheet.save();
        await Ls2AssetEvent.create({
          entityType: 'tire', refId: fromSheet._id, label: fromSheet.serial, action: 'removed',
          fromPlate: f.plate, fromPlateKey: f.key, fromPosition: f.pos,
          reason: 'تصحيح: الموقع محجوز بفردة نقلها موظف من الشاشة — شغل الموظف مقدَّم على الجرد',
        });
      }
      mine.set({
        status: 'mounted', plate: 'أ ط ح 3447', plateKey: k3447,
        positionNumber: 1, positionLabel: 'اطار 1 يسار', section: 'الرأس', isSpare: false,
      });
      await mine.save();
      await Ls2AssetEvent.create({
        entityType: 'tire', refId: mine._id, label: mine.serial, action: 'mounted',
        toPlate: 'أ ط ح 3447', toPlateKey: k3447, toPosition: 'اطار 1 يسار — الرأس',
        reason: 'رجوع لمكانه: النقلة دي عملها موظف من الشاشة، والاستيراد ما كانش المفروض يدوس عليها',
      });
      log('   ✓ رجع مكانه');
    }
  }

  // 2) Trailer 27: the user's decision is executed
  log('\n── التيدر ٢٧ ──');
  const tr = await Ls2Trailer.findOne({ trailerNumber: '27' });
  if (!tr) { log('   مش موجود — اتخطّى'); } else {
    log(`   دلوقتي: ${tr.currentPlate || 'واقف'} · ${tr.status}`);
    log('   المفروض: واقف لوحده — اليوزر نزّله من ٨١٩٨ يوم ٩ أغسطس، وحطّه على سطحة وهمية');
    log('   لأن الشاشة وقتها ماكانش فيها «يقف لوحده». دلوقتي فيه.');
    const tires = await Ls2TireAsset.find({ trailerNumber: '27', status: 'mounted' });
    log(`   وكاوتشه (${tires.length} إطار) بينزل معاه`);
    if (!DRY) {
      const from = { plate: tr.currentPlate, key: tr.currentPlateKey };
      if (from.key) await Ls2Flatbed.updateOne({ plateKey: from.key }, { currentTrailerNumber: null });
      tr.set({ currentPlate: null, currentPlateKey: null, status: 'spare' });
      await tr.save();
      await Ls2AssetEvent.create({
        entityType: 'trailer', refId: tr._id, label: '27', action: 'removed',
        fromPlate: from.plate, fromPlateKey: from.key,
        reason: 'تنفيذ قرار الموظف: نزّله من ٨١٩٨ يوم ٩ أغسطس — اتسجّل على سطحة وهمية وقتها لغياب خيار «يقف لوحده»',
      });
      for (const ti of tires) {
        const f = { plate: ti.plate, key: ti.plateKey, pos: `${ti.positionLabel} — ${ti.section}` };
        ti.set({ plate: null, plateKey: null });
        await ti.save();
        await Ls2AssetEvent.create({
          entityType: 'tire', refId: ti._id, label: ti.serial, action: 'transferred',
          fromPlate: f.plate, fromPlateKey: f.key, fromPosition: f.pos,
          toPlate: null, toPlateKey: null, toPosition: 'تيدر 27 (واقف)',
          reason: 'مشيت مع التيدر ٢٧ — تنفيذ قرار الموظف',
        });
      }
      log('   ✓ اتنفّذ');
    }
  }

  if (!DRY) {
    const F = await Ls2Flatbed.countDocuments({});
    const T = await Ls2Trailer.countDocuments({});
    const standing = await Ls2Trailer.countDocuments({ currentPlateKey: null });
    const on3447 = await Ls2TireAsset.countDocuments({ plateKey: k3447, status: 'mounted' });
    const on8198 = await Ls2TireAsset.countDocuments({ plateKey: '8198', status: 'mounted' });
    log(`\nسطحات ${F} · تيدرات ${T} (واقف ${standing}) · 3447 عليها ${on3447} إطار · 8198 عليها ${on8198}`);
  }
  process.exit(0);
})().catch((e) => { console.error('FATAL', e); process.exit(1); });
