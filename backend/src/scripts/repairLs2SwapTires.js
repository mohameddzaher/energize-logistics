/**
 * repairLs2SwapTires — يعيد فِرَدَ التيدر التي جرّها تبديلُ التيدرات إلى غير عربيّتها.
 *
 *   node src/scripts/repairLs2SwapTires.js            ← عرضٌ فقط
 *   node src/scripts/repairLs2SwapTires.js --apply
 *
 * ── ما الذي حدث ───────────────────────────────────────────────────────────
 * في التبديل (تيدر A على العربيّة X يُركَّب على Y، وتيدرُ Y — B — يرجع إلى X)
 * كانت فِرَدُ B تُنقَل إلى X **وA لم يغادرها بعد**، فتأخذ رقمَ A، ثمّ تُجمَع مع
 * فِرَد A وتمشي معه إلى Y. الكاوتشُ كلُّه على Y، وX بلا كاوتش. أُصلح في
 * moveTrailer (controllers/ls2AssetsController، `trailerTires`) يوم ٢٠٢٦/١٠/١٧.
 *
 * ── وكيف تُعرَف الفردةُ المجرورة ──────────────────────────────────────────
 * من سجلّ حركتها: حركتان «مشيت مع التيدر» متتاليتان في الطلب نفسِه (أقلّ من
 * دقيقتين) بتيدرين مختلفين، والثانيةُ تبدأ حيث انتهت الأولى. الأولى هي الحقيقة
 * (الفردةُ على تيدر B)، والثانيةُ هي الخطأ.
 *
 * ── ومتى تُصحَّح وحدَها ───────────────────────────────────────────────────
 * إن لم يمسّها أحدٌ بعد الخطأ (آخرُ حركةٍ لها هي الخاطئة، وهي في مكانها). فتُعاد
 * إلى حيث تيدرُها B الآن — على عربيّةٍ أو واقفًا. وما مُسّ بعدها يُعرَض ولا يُلمَس:
 * الورشةُ ربّما صحّحته باليد.
 */
require('dotenv').config();
const mongoose = require('mongoose');
const Ls2TireAsset = require('../models/Ls2TireAsset');
const Ls2Trailer = require('../models/Ls2Trailer');
const Ls2AssetEvent = require('../models/Ls2AssetEvent');

const APPLY = process.argv.includes('--apply');
const CARRY = /^مشيت مع التيدر (\S+)/;
const WINDOW_MS = 2 * 60 * 1000;
const trailerOf = (e) => (String(e.reason || '').match(CARRY) || [])[1] || null;

async function findVictims() {
  const events = await Ls2AssetEvent.find({ entityType: 'tire' }).sort({ refId: 1, createdAt: 1 }).lean();
  const byTire = new Map();
  for (const e of events) {
    const k = String(e.refId);
    if (!byTire.has(k)) byTire.set(k, []);
    byTire.get(k).push(e);
  }
  const fix = []; const manual = [];
  for (const [id, list] of byTire) {
    // صحّحها هذا السكربتُ من قبل: لا تُعرَض مرّةً ثانية.
    if (String(list[list.length - 1].reason || '').startsWith('تصحيح: الفردة على التيدر')) continue;
    for (let i = list.length - 2; i >= 0; i -= 1) {
      const a = list[i]; const b = list[i + 1];
      const ta = trailerOf(a); const tb = trailerOf(b);
      if (!(a.action === 'transferred' && b.action === 'transferred' && ta && tb && ta !== tb)) continue;
      if (new Date(b.createdAt) - new Date(a.createdAt) > WINDOW_MS) continue;
      if (String(a.toPlateKey || '') !== String(b.fromPlateKey || '')) continue;
      const tire = await Ls2TireAsset.findById(id).lean(); // eslint-disable-line no-await-in-loop
      const row = { tireId: id, serial: tire?.serial || a.label, belongsTo: ta, draggedWith: tb, at: b.createdAt, nowOn: tire?.plate || '(واقفة)' };
      const untouched = i + 1 === list.length - 1 && tire && tire.status === 'mounted' && String(tire.plateKey || '') === String(b.toPlateKey || '');
      (untouched ? fix : manual).push(row);
      break; // آخرُ خطأٍ للفردة يكفي
    }
  }
  return { fix, manual };
}

(async () => {
  await mongoose.connect(process.env.MONGODB_URI || process.env.MONGO_URI);
  const { fix, manual } = await findVictims();
  const trailers = new Map((await Ls2Trailer.find({}).lean()).map((t) => [String(t.trailerNumber), t]));

  console.log(`فِرَدٌ جُرَّت مع تيدرٍ غير تيدرها ولم يمسّها أحدٌ بعدُ: ${fix.length}`);
  for (const r of fix) {
    const tr = trailers.get(String(r.belongsTo));
    r.to = tr ? (tr.currentPlate || '(واقف)') : null;
    console.log(`  ${r.serial}: على ${r.nowOn} ← مكانُها مع التيدر ${r.belongsTo}: ${r.to || 'التيدر غير موجود — يُترك'}  (جُرَّت مع ${r.draggedWith} في ${new Date(r.at).toISOString().slice(0, 16)})`);
  }
  if (manual.length) {
    console.log(`\nومُسّت بعد الخطأ فتُراجَع باليد: ${manual.length}`);
    for (const r of manual) console.log(`  ${r.serial}: الآن على ${r.nowOn} — كانت على التيدر ${r.belongsTo} وجُرَّت مع ${r.draggedWith}`);
  }

  if (!APPLY) { console.log('\n(عرضٌ فقط — أضِف --apply للتنفيذ)'); await mongoose.disconnect(); return; }

  let done = 0;
  for (const r of fix) {
    const tr = trailers.get(String(r.belongsTo));
    if (!tr) continue;
    const ti = await Ls2TireAsset.findById(r.tireId); // eslint-disable-line no-await-in-loop
    const from = { plate: ti.plate, key: ti.plateKey };
    ti.set({ plate: tr.currentPlate || null, plateKey: tr.currentPlateKey || null, trailerNumber: tr.trailerNumber });
    await ti.save(); // eslint-disable-line no-await-in-loop
    await Ls2AssetEvent.create({ // eslint-disable-line no-await-in-loop
      entityType: 'tire', refId: ti._id, label: ti.serial, action: 'transferred',
      fromPlate: from.plate, fromPlateKey: from.key, toPlate: tr.currentPlate || null, toPlateKey: tr.currentPlateKey || null,
      toPosition: tr.currentPlate ? '' : `تيدر ${tr.trailerNumber} (واقف)`,
      reason: `تصحيح: الفردة على التيدر ${tr.trailerNumber} — نُقلت خطأً مع التيدر ${r.draggedWith} عند تبديل التيدرات`,
      performedByName: 'تصحيح النظام',
    });
    done += 1;
  }
  await require('../services/ls2TireTrailers').resyncTireTrailers();
  try { require('../utils/ls2Touch').clearLs2Derived(); } catch (_) { /* */ }
  try { require('../utils/ttlCache').clear('ls2'); } catch (_) { /* */ }
  console.log(`\nصُحِّحت ${done} فردة.`);
  await mongoose.disconnect();
})().catch((e) => { console.error(e); process.exit(1); });
