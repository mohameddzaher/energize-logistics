/* eslint-disable no-console */
/**
 * restoreUserPlacements — شغل اليوزر هو الحقيقة، والاستيراد ما يدوسش عليه.
 *
 *   node src/scripts/restoreUserPlacements.js --dry
 *   node src/scripts/restoreUserPlacements.js --yes
 *
 * ── الغلطة اللي بيصلّحها ────────────────────────────────────────────────────
 * لما الجرد النهائي اتعارض مع حركتين اليوزرز عملوهم من الشاشة، أنا قدّمت الشيت.
 * وده مقلوب: الشيت لقطة قديمة، والحركة اللي اتعملت من الشاشة هي اللي حصلت على
 * الأرض وبإيد بني آدم شايف العربية. القاعدة: **اللي اليوزر عمله هو الحقيقي**،
 * والشيت بيتقدّم بس في الخانات اللي محدش لمسها.
 *
 * الحركتين:
 *
 * ١) الكاوتش Y5S243257 — اليوزر نقله من ٥٠٣٤ لـ٣٤٤٧ يوم ٦ أغسطس بسبب «تآكل».
 *    أنا رجّعته المخزن عشان الجرد حطّ فردة تانية في نفس الموقع. الصح إنه يفضل
 *    على ٣٤٤٧، وفردة الجرد (Y5S425919) هي اللي تستنى في المخزن لحد ما الورشة
 *    تقرّر — لأنها هي اللي جاية من ورق، وهو اللي جاي من إيد.
 *
 * ٢) التيدر ٢٧ — اليوزر نزّله من ٨١٩٨ يوم ٩ أغسطس. علّقه على TR1 لأن الشاشة
 *    وقتها ماكانش فيها خيار «يقف لوحده»، وTR1 كانت سطحة وهمية اتعملت للتيدر
 *    ٥٩. أنا رجّعته على ٨١٩٨. الصح إن قراره يتنفّذ: التيدر نازل من ٨١٩٨ —
 *    وبقى فيه دلوقتي حالة تعبّر عن ده بالظبط (واقف لوحده)، وكاوتشه معاه.
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

  // ── ① الكاوتش يرجع لمكان اليوزر ───────────────────────────────────────────
  log('── الكاوتش Y5S243257 ──');
  const mine = await Ls2TireAsset.findOne({ serial: 'Y5S243257' });
  const fromSheet = await Ls2TireAsset.findOne({ serial: 'Y5S425919' });
  const k3447 = plateKey('أ ط ح 3447');
  if (!mine) { log('   مش موجود — اتخطّى'); } else {
    log(`   دلوقتي: ${mine.status} · ${mine.plate || 'مخزن'}`);
    log(`   المفروض: مركّب على 3447 موقع 1 (نقلة اليوزر يوم ٦ أغسطس — «تآكل»)`);
    log(`   وفردة الجرد ${fromSheet ? fromSheet.serial : '—'} تستنى في المخزن`);
    if (!DRY) {
      // الأول نفضّي الموقع من فردة الجرد
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

  // ── ② التيدر ٢٧: قرار اليوزر يتنفّذ ───────────────────────────────────────
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
