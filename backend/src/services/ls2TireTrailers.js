/**
 * The trailer number on each tire, re-derived from its position.
 * The rule is in `models/Ls2TireAsset` (deriveTrailer) and applies on every tire save. But the trailer itself also moves (transfer, import placing it on another truck), leaving both trucks' tires on a number no longer correct until each is saved. This pass walks all fitted tires once and corrects the differences: called after every trailer movement, and it repairs earlier accumulation (scripts/repairLs2TireTrailers).
 * Returns what it changed and writes nothing with `dryRun`.
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
      // Stored with its trailer: the number stays while the trailer itself is stored. If it is fitted to a truck, the tire did not move with it, so the number is cleared and the tire shows as "no position" instead of being hidden.
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
