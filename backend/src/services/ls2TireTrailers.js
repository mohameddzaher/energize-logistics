/**
 * رقمُ التيدر على كلّ فردةٍ — يُعاد اشتقاقُه من موضعها.
 *
 * القاعدةُ في `models/Ls2TireAsset` (deriveTrailer) وتُطبَّق عند كلّ حفظٍ لفردة.
 * لكنّ التيدرَ نفسَه يتحرّك أيضًا (نقلٌ، استيرادٌ يضعه على عربيّةٍ أخرى) —
 * فتبقى فِرَدُ العربيّتين على رقمٍ لم يعد صحيحًا حتى تُحفَظ كلٌّ منها. فهذه
 * تمرّ على المركَّب كلِّه مرّةً وتصحّح ما اختلف: تُنادى بعد كلّ حركةِ تيدر،
 * ويُصلَح بها ما تراكم قبلها (scripts/repairLs2TireTrailers).
 *
 * تردّ ما غيّرته — ولا تكتب مع `dryRun`.
 */
const Ls2TireAsset = require('../models/Ls2TireAsset');
const Ls2Trailer = require('../models/Ls2Trailer');

const TRAILER_SECTION = /تيدر|تريل/;

async function resyncTireTrailers({ dryRun = false } = {}) {
  const [tires, trailers] = await Promise.all([
    Ls2TireAsset.find({ $or: [{ trailerNumber: { $nin: [null, ''] } }, { status: 'mounted' }] })
      .select('serial status section plate plateKey trailerNumber positionNumber').lean(),
    Ls2Trailer.find({}).select('trailerNumber currentPlateKey').lean(),
  ]);
  const onPlate = new Map(trailers.filter((t) => t.currentPlateKey).map((t) => [String(t.currentPlateKey), t.trailerNumber]));
  const known = new Map(trailers.map((t) => [String(t.trailerNumber), t]));
  const changes = [];
  for (const t of tires) {
    const cur = t.trailerNumber || null;
    let want;
    if (t.status !== 'mounted' || !TRAILER_SECTION.test(String(t.section || ''))) want = null;
    else if (t.plateKey) want = onPlate.get(String(t.plateKey)) || null;
    else {
      // واقفةٌ مع تيدرها: يبقى رقمُه ما دام التيدرُ نفسُه واقفًا. فإن كان مركّبًا
      // على عربيّةٍ فهي لم تمشِ معه — يُرفَع الرقمُ فتظهر «بلا موضع» ولا تُخفى.
      const tr = cur ? known.get(String(cur)) : null;
      want = tr && !tr.currentPlateKey ? cur : null;
    }
    if (String(want || '') !== String(cur || '')) {
      changes.push({ _id: t._id, serial: t.serial, plate: t.plate, section: t.section, positionNumber: t.positionNumber, from: cur, to: want });
    }
  }
  if (!dryRun && changes.length) {
    await Ls2TireAsset.bulkWrite(changes.map((c) => ({
      updateOne: { filter: { _id: c._id }, update: { $set: { trailerNumber: c.to } } },
    })));
  }
  return changes;
}

module.exports = { resyncTireTrailers };
