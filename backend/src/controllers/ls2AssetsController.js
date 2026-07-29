/**
 * ls2AssetsController — سجل أصول الأسطول: flatbeds (السطحات), trailers (التيدرات)
 * and individual tires (فردات الكاوتش) with their full movement history.
 *
 * The live Wialon mirror (Ls2Vehicle) knows nothing about WHICH physical tire or
 * trailer is on a truck — only sensors. This registry is the workshop's source of
 * truth for that, keyed by tire serial / trailer number, and every mount, removal
 * or transfer is an immutable Ls2AssetEvent. Matching to live vehicles is by
 * normalized plate digits (plateKey), because Wialon plate strings vary.
 */
const Ls2Flatbed = require('../models/Ls2Flatbed');
const Ls2Trailer = require('../models/Ls2Trailer');
const Ls2TireAsset = require('../models/Ls2TireAsset');
const Ls2AssetEvent = require('../models/Ls2AssetEvent');
const Ls2Vehicle = require('../models/Ls2Vehicle');

// Shared with the workshop store — see utils/plateKey.js for why.
const { plateKey, vehiclePlateKey } = require('../utils/plateKey');
const { emitToAll } = require('../websocket/socketManager');

// Any asset mutation must reach the screens that mirror this registry live (the
// workshop store, fleet-assets, the vehicle profile). Coalesced so a bulk import
// broadcasts once, not once per row.
let emitTimer = null;
function emitAssetsChanged() {
  if (emitTimer) return;
  emitTimer = setTimeout(() => {
    emitTimer = null;
    try { emitToAll('ls2:updated', { at: Date.now(), assets: true }); } catch (e) { /* socket down ≠ failed save */ }
  }, 300);
}

const posLabel = (t) => [t.positionLabel || (t.positionNumber != null ? `اطار ${t.positionNumber}` : ''), t.section].filter(Boolean).join(' — ');

let vehicleKeyCache = { at: 0, map: new Map() };
async function vehicleByKey(key) {
  if (Date.now() - vehicleKeyCache.at > 15000) {
    const vs = await Ls2Vehicle.find({}, { plate: 1, name: 1, unitId: 1, odometerKm: 1, driver: 1 }).lean();
    const map = new Map();
    for (const v of vs) {
      const k = vehiclePlateKey(v);
      if (k) map.set(k, v);
    }
    vehicleKeyCache = { at: Date.now(), map };
  }
  return vehicleKeyCache.map.get(key) || null;
}

// Recording tire work for a truck IS the review the tire_sensor_change notice
// asks for — clear it so the alert resolves on the next poll.
async function clearSensorNotice(...keys) {
  for (const key of keys) {
    if (!key) continue;
    const live = await vehicleByKey(key);
    if (live) await Ls2Vehicle.updateOne({ unitId: live.unitId }, { $set: { sensorChangeNotice: null } });
  }
}

async function logEvent(req, data) {
  emitAssetsChanged(); // every logged movement is a change some open screen shows
  return Ls2AssetEvent.create({
    ...data,
    performedBy: req.user?._id || null,
    performedByName: req.user ? `${req.user.firstName || ''} ${req.user.lastName || ''}`.trim() : '',
  });
}

// ---- Overview --------------------------------------------------------------
// GET /assets/overview — everything the fleet-assets page needs in one call.
exports.getOverview = async (req, res) => {
  try {
    const [flatbeds, trailers, tires] = await Promise.all([
      Ls2Flatbed.find().sort({ numbering: 1 }).lean(),
      Ls2Trailer.find().sort({ trailerNumber: 1 }).lean(),
      Ls2TireAsset.find().sort({ plateKey: 1, positionNumber: 1 }).lean(),
    ]);
    // Attach live identity (unitId/driver/odometer) + mounted-tire counts per flatbed.
    const tiresByPlate = new Map();
    for (const t of tires) {
      if (t.status === 'mounted' && t.plateKey) {
        tiresByPlate.set(t.plateKey, (tiresByPlate.get(t.plateKey) || 0) + 1);
      }
    }
    const out = [];
    for (const f of flatbeds) {
      const live = await vehicleByKey(f.plateKey);
      out.push({
        ...f,
        tireCount: tiresByPlate.get(f.plateKey) || 0,
        unitId: live?.unitId ?? null,
        driver: live?.driver || '',
        odometerKm: live?.odometerKm ?? null,
      });
    }
    res.json({
      flatbeds: out,
      trailers,
      tires,
      counts: {
        flatbeds: flatbeds.length,
        trailers: trailers.length,
        tires: tires.length,
        mounted: tires.filter((t) => t.status === 'mounted').length,
        spare: tires.filter((t) => t.status === 'spare').length,
        inRepair: tires.filter((t) => t.status === 'in_repair').length,
        retired: tires.filter((t) => t.status === 'retired').length,
        withSensor: tires.filter((t) => t.sensor === 'yes').length,
      },
    });
  } catch (e) {
    res.status(500).json({ message: e.message });
  }
};

// GET /assets/vehicle/:plate — current tires + trailer + history for one truck.
exports.getVehicleAssets = async (req, res) => {
  try {
    const key = plateKey(req.params.plate);
    if (!key) return res.status(400).json({ message: 'Bad plate' });
    const [flatbed, tires, trailer, events] = await Promise.all([
      Ls2Flatbed.findOne({ plateKey: key }).lean(),
      Ls2TireAsset.find({ plateKey: key, status: 'mounted' }).sort({ positionNumber: 1 }).lean(),
      Ls2Trailer.findOne({ currentPlateKey: key }).lean(),
      Ls2AssetEvent.find({ $or: [{ fromPlateKey: key }, { toPlateKey: key }] }).sort({ date: -1 }).limit(100).lean(),
    ]);
    res.json({ flatbed, tires, trailer, events });
  } catch (e) {
    res.status(500).json({ message: e.message });
  }
};

// ---- Tires -----------------------------------------------------------------
// POST /assets/tires — register a new tire (optionally mounted straight away).
// A renewed (retreaded) tire carries the trailer-only rule: الرأس positions
// (الرأس + المحور الخلفي للرأس) are where a blowout is most dangerous.
const isHeadSection = (section) => String(section || '').includes('الرأس');

exports.createTire = async (req, res) => {
  try {
    const { serial, tireNumber = '', type = '', size = '', sensor = 'unknown', condition, plate = null, positionNumber = null, positionLabel = '', section = '', notes = '' } = req.body;
    if (!serial || !String(serial).trim()) return res.status(400).json({ message: 'Serial required' });
    const exists = await Ls2TireAsset.findOne({ serial: String(serial).trim() });
    if (exists) return res.status(409).json({ message: 'Serial already registered', tire: exists });
    const key = plate ? plateKey(plate) : null;
    // A freshly registered unmounted tire is what a purchase just delivered —
    // grade 'new' unless the workshop says otherwise; a tire registered already
    // on a truck is ordinary 'used'.
    const grade = ['new', 'used', 'renewed'].includes(condition) ? condition : (key ? 'used' : 'new');
    if (grade === 'renewed' && key && isHeadSection(section)) {
      return res.status(400).json({ message: 'الكاوتش المجدد يُركَّب على التيدر فقط — لا يُركَّب على الرأس' });
    }
    const tire = await Ls2TireAsset.create({
      serial: String(serial).trim(), tireNumber, type, size, sensor, notes,
      condition: grade,
      status: key ? 'mounted' : 'spare',
      plate: key ? plate : null, plateKey: key,
      positionNumber: key ? positionNumber : null,
      positionLabel: key ? positionLabel : '', section: key ? section : '',
    });
    const live = key ? await vehicleByKey(key) : null;
    await logEvent(req, {
      entityType: 'tire', refId: tire._id, label: tire.serial,
      action: key ? 'mounted' : 'registered',
      toPlate: key ? plate : null, toPlateKey: key, toPosition: posLabel(tire),
      odometerKm: live?.odometerKm ?? null, notes,
    });
    res.status(201).json({ tire });
  } catch (e) {
    res.status(500).json({ message: e.message });
  }
};

// PATCH /assets/tires/:id — edit identity fields (not location — use /move).
exports.updateTire = async (req, res) => {
  try {
    const allowed = ['tireNumber', 'type', 'size', 'sensor', 'notes', 'serial', 'positionLabel'];
    const patch = {};
    for (const k of allowed) if (req.body[k] !== undefined) patch[k] = req.body[k];
    const tire = await Ls2TireAsset.findByIdAndUpdate(req.params.id, patch, { new: true });
    if (!tire) return res.status(404).json({ message: 'Not found' });
    await logEvent(req, {
      entityType: 'tire', refId: tire._id, label: tire.serial, action: 'updated',
      notes: Object.keys(patch).map((k) => `${k}: ${patch[k]}`).join(', '),
    });
    res.json({ tire });
  } catch (e) {
    res.status(500).json({ message: e.message });
  }
};

// POST /assets/tires/:id/move — mount / transfer / unmount one tire.
// body: { toPlate|null, positionNumber, positionLabel, section, reason, notes,
//         date, destination, conditionPercent, displacedTo, replacementTireId }
// The in⇒out rule lives here: mounting into an OCCUPIED slot requires
// `displacedTo` — where the removed tire goes: 'repair' (تحت التجديد),
// 'damaged' (تالف), 'scrap' (سكراب) or 'store' (سليمة، رجعت للمخزن).
//
// `replacementTireId` closes the OTHER half of a swap in the same operation:
// a spare tire from the store mounts into the slot THIS tire just vacated —
// whether it went down to the shelf/scrap or transferred to another truck.
const DEST_STATUS = { repair: 'in_repair', damaged: 'damaged', scrap: 'scrap', store: 'spare' };
const DEST_ACTION = { in_repair: 'to_repair', damaged: 'damaged', scrap: 'scrapped', spare: 'removed' };

// Mount a spare tire into a specific (now empty) slot. Shared by the move and
// swap paths; throws with a user-facing Arabic message on rule violations.
async function mountSpareTire(req, tireId, slot, when, reason) {
  const r = await Ls2TireAsset.findById(tireId);
  if (!r) throw new Error('الفردة البديلة غير موجودة');
  // The replacement may come from the store (spare) OR be pulled off ANOTHER
  // truck (a swap) — the workshop usually has zero spares, so a mounted tire is
  // the common case. Only out-of-service tires (تحت التجديد/تالفة/سكراب/خارج
  // الخدمة) are rejected.
  if (!['spare', 'mounted'].includes(r.status)) {
    throw new Error(`الفردة البديلة ${r.serial} ليست متاحة للتركيب — حالتها الحالية لا تسمح بذلك`);
  }
  if (r.status === 'mounted' && r.plateKey && r.plateKey === slot.plateKey) {
    throw new Error(`الفردة البديلة ${r.serial} مركّبة بالفعل على نفس المركبة`);
  }
  if (r.condition === 'renewed' && isHeadSection(slot.section)) {
    throw new Error(`الفردة البديلة ${r.serial} مجددة — المجدد يُركَّب على التيدر فقط، لا على الرأس`);
  }
  // If it was mounted on another truck, record it leaving that truck first so
  // the swap is a full audit trail (the old slot is now physically empty).
  const fromMounted = r.status === 'mounted' && r.plateKey
    ? { plate: r.plate, plateKey: r.plateKey, pos: posLabel(r) }
    : null;
  r.set({
    status: 'mounted', plate: slot.plate, plateKey: slot.plateKey,
    positionNumber: slot.positionNumber, positionLabel: slot.positionLabel, section: slot.section,
  });
  await r.save();
  const live = await vehicleByKey(slot.plateKey);
  await logEvent(req, {
    entityType: 'tire', refId: r._id, label: r.serial,
    action: fromMounted ? 'transferred' : 'mounted',
    fromPlate: fromMounted?.plate ?? null, fromPlateKey: fromMounted?.plateKey ?? null, fromPosition: fromMounted?.pos ?? '',
    toPlate: slot.plate, toPlateKey: slot.plateKey, toPosition: posLabel(r),
    date: when, odometerKm: live?.odometerKm ?? null,
    reason: reason || (fromMounted
      ? `نُقلت من ${fromMounted.plate} وركِّبت بديلًا في الموقع الذي أُخلي`
      : 'رُكِّبت بديلًا في الموقع الذي أُخلي'),
  });
  return r;
}

exports.moveTire = async (req, res) => {
  try {
    const tire = await Ls2TireAsset.findById(req.params.id);
    if (!tire) return res.status(404).json({ message: 'Not found' });
    const { toPlate = null, positionNumber = null, positionLabel = '', section = '', reason = '', notes = '', date, destination = 'store', conditionPercent = null, displacedTo = '', replacementTireId = null } = req.body;
    const from = { plate: tire.plate, key: tire.plateKey, pos: posLabel(tire) };
    // The exact slot being vacated — the replacement (if any) goes here.
    const vacated = tire.status === 'mounted' && tire.plateKey
      ? { plate: tire.plate, plateKey: tire.plateKey, positionNumber: tire.positionNumber, positionLabel: tire.positionLabel, section: tire.section }
      : null;
    if (replacementTireId && !vacated) {
      return res.status(400).json({ message: 'لا يمكن تركيب بديل — الفردة ليست مركبة على سطحة أصلًا' });
    }
    if (replacementTireId && String(replacementTireId) === String(tire._id)) {
      return res.status(400).json({ message: 'الفردة البديلة هي نفسها الفردة المُنزَلة' });
    }
    const when = date ? new Date(date) : new Date();

    if (toPlate) {
      // مجدد يركب على التيدر فقط.
      if (tire.condition === 'renewed' && isHeadSection(section)) {
        return res.status(400).json({ message: 'الكاوتش المجدد يُركَّب على التيدر فقط — لا يُركَّب على الرأس' });
      }
      const toKey = plateKey(toPlate);
      const live = await vehicleByKey(toKey);
      // The slot's current occupant: an IN must declare its OUT.
      if (positionNumber != null) {
        const occupant = await Ls2TireAsset.findOne({
          plateKey: toKey, positionNumber, status: 'mounted', _id: { $ne: tire._id },
        });
        if (occupant) {
          if (!DEST_STATUS[displacedTo]) {
            return res.status(400).json({
              code: 'DISPLACED_FATE_REQUIRED',
              message: `الموقع مشغول بالفردة ${occupant.serial} — حدد مصيرها: تحت التجديد أو تالفة أو سكراب أو سليمة للمخزن`,
              occupant: { serial: occupant.serial, tireNumber: occupant.tireNumber },
            });
          }
          const occFrom = posLabel(occupant);
          const occStatus = DEST_STATUS[displacedTo];
          occupant.set({ status: occStatus, plate: null, plateKey: null, positionNumber: null, positionLabel: '', section: '' });
          await occupant.save();
          await logEvent(req, {
            entityType: 'tire', refId: occupant._id, label: occupant.serial,
            action: DEST_ACTION[occStatus],
            fromPlate: toPlate, fromPlateKey: toKey, fromPosition: occFrom, date: when,
            odometerKm: live?.odometerKm ?? null,
            reason: reason || `أُزيلت لتركيب الفردة ${tire.serial} مكانها`,
          });
        }
      }
      tire.set({
        status: 'mounted', plate: toPlate, plateKey: toKey,
        positionNumber, positionLabel, section,
      });
      await tire.save();
      await logEvent(req, {
        entityType: 'tire', refId: tire._id, label: tire.serial,
        action: from.key ? 'transferred' : 'mounted',
        fromPlate: from.plate, fromPlateKey: from.key, fromPosition: from.pos,
        toPlate, toPlateKey: toKey, toPosition: posLabel(tire),
        date: when, odometerKm: live?.odometerKm ?? null, reason, notes,
      });
    } else {
      // Off the truck — but "where to" matters: the renewal shop is not the
      // shelf, سكراب is stored-to-sell, and تالف is gone for good.
      const wasInRepair = tire.status === 'in_repair';
      const toStatus = DEST_STATUS[destination] || 'spare';
      tire.set({
        status: toStatus,
        plate: null, plateKey: null, positionNumber: null, positionLabel: '', section: '',
        // نسبة الحالة تُسجَّل عند النزول إلى المخزن — هي ما يقرأه التسكين لاحقًا.
        ...(toStatus === 'spare' && conditionPercent != null && conditionPercent !== ''
          ? { conditionPercent: Math.max(0, Math.min(100, Number(conditionPercent))) } : {}),
      });
      await tire.save();
      await logEvent(req, {
        entityType: 'tire', refId: tire._id, label: tire.serial,
        action: toStatus === 'spare' && wasInRepair ? 'from_repair' : DEST_ACTION[toStatus],
        fromPlate: from.plate, fromPlateKey: from.key, fromPosition: from.pos,
        date: when, reason,
        notes: [notes, toStatus === 'spare' && conditionPercent != null && conditionPercent !== '' ? `الحالة ${conditionPercent}%` : ''].filter(Boolean).join(' — '),
      });
    }
    // النصف الثاني من التبديل: بديل من المخزن يُركَّب في الموقع الذي أُخلي —
    // نفس العملية، سواء نزلت الفردة أو انتقلت إلى سطحة أخرى.
    let replacement = null;
    if (replacementTireId && vacated) {
      try {
        replacement = await mountSpareTire(req, replacementTireId, vacated, when, reason);
      } catch (err) {
        // الفردة الأساسية تحركت بنجاح — بلّغ عن البديل فقط بدل إفشال كل العملية.
        return res.status(400).json({ message: err.message, tire, partial: true });
      }
    }
    await clearSensorNotice(from.key, toPlate ? plateKey(toPlate) : null);
    res.json({ tire, replacement });
  } catch (e) {
    res.status(500).json({ message: e.message });
  }
};

// POST /assets/tires/:id/renewal-result — the ONLY exit from تحت التجديد:
// it either came back usable (مجدد → spare, trailer-only from now on) or it
// did not (سكراب → kept in store to be sold).
exports.tireRenewalResult = async (req, res) => {
  try {
    const tire = await Ls2TireAsset.findById(req.params.id);
    if (!tire) return res.status(404).json({ message: 'Not found' });
    if (tire.status !== 'in_repair') return res.status(400).json({ message: 'الفردة ليست تحت التجديد' });
    const { result, notes = '' } = req.body || {};
    if (!['renewed', 'scrap'].includes(result)) return res.status(400).json({ message: 'result must be renewed | scrap' });
    if (result === 'renewed') tire.set({ status: 'spare', condition: 'renewed' });
    else tire.set({ status: 'scrap' });
    await tire.save();
    await logEvent(req, {
      entityType: 'tire', refId: tire._id, label: tire.serial,
      action: result === 'renewed' ? 'renewed' : 'scrapped',
      notes,
    });
    res.json({ tire });
  } catch (e) {
    res.status(500).json({ message: e.message });
  }
};

// POST /assets/tires/:id/retire — terminal states outside the renewal loop.
// kind: 'damaged' (تالف — لا وجود لها) | 'scrap' (سكراب للبيع) | default legacy 'retired'.
exports.retireTire = async (req, res) => {
  try {
    const tire = await Ls2TireAsset.findById(req.params.id);
    if (!tire) return res.status(404).json({ message: 'Not found' });
    const kind = ['damaged', 'scrap'].includes(req.body?.kind) ? req.body.kind : 'retired';
    const from = { plate: tire.plate, key: tire.plateKey, pos: posLabel(tire) };
    tire.set({ status: kind, plate: null, plateKey: null, positionNumber: null, positionLabel: '', section: '' });
    await tire.save();
    await logEvent(req, {
      entityType: 'tire', refId: tire._id, label: tire.serial,
      action: kind === 'damaged' ? 'damaged' : kind === 'scrap' ? 'scrapped' : 'retired',
      fromPlate: from.plate, fromPlateKey: from.key, fromPosition: from.pos,
      reason: req.body?.reason || '', notes: req.body?.notes || '',
    });
    await clearSensorNotice(from.key);
    res.json({ tire });
  } catch (e) {
    res.status(500).json({ message: e.message });
  }
};

// ---- Trailers --------------------------------------------------------------
exports.createTrailer = async (req, res) => {
  try {
    const { trailerNumber, plate = null, notes = '' } = req.body;
    if (!trailerNumber) return res.status(400).json({ message: 'Trailer number required' });
    const exists = await Ls2Trailer.findOne({ trailerNumber: String(trailerNumber).trim() });
    if (exists) return res.status(409).json({ message: 'Trailer already registered' });
    const key = plate ? plateKey(plate) : null;
    const trailer = await Ls2Trailer.create({
      trailerNumber: String(trailerNumber).trim(),
      currentPlate: key ? plate : null, currentPlateKey: key, notes,
      status: key ? 'active' : 'spare',
    });
    if (key) await Ls2Flatbed.updateOne({ plateKey: key }, { currentTrailerNumber: trailer.trailerNumber });
    await logEvent(req, {
      entityType: 'trailer', refId: trailer._id, label: trailer.trailerNumber,
      action: key ? 'mounted' : 'registered', toPlate: plate, toPlateKey: key, notes,
    });
    res.status(201).json({ trailer });
  } catch (e) {
    res.status(500).json({ message: e.message });
  }
};

// POST /assets/trailers/:id/move — hitch to another flatbed (or unhitch: toPlate null).
exports.moveTrailer = async (req, res) => {
  try {
    const trailer = await Ls2Trailer.findById(req.params.id);
    if (!trailer) return res.status(404).json({ message: 'Not found' });
    const { toPlate = null, reason = '', notes = '', date } = req.body;
    const when = date ? new Date(date) : new Date();
    const from = { plate: trailer.currentPlate, key: trailer.currentPlateKey };
    if (from.key) await Ls2Flatbed.updateOne({ plateKey: from.key }, { currentTrailerNumber: null });

    if (toPlate) {
      const toKey = plateKey(toPlate);
      // A flatbed carries one trailer: whoever is on the target becomes spare.
      const occupant = await Ls2Trailer.findOne({ currentPlateKey: toKey, _id: { $ne: trailer._id } });
      if (occupant) {
        occupant.set({ currentPlate: null, currentPlateKey: null, status: 'spare' });
        await occupant.save();
        await logEvent(req, {
          entityType: 'trailer', refId: occupant._id, label: occupant.trailerNumber, action: 'removed',
          fromPlate: toPlate, fromPlateKey: toKey, date: when,
          reason: reason || `أُنزل لتركيب التيدر ${trailer.trailerNumber} مكانه`,
        });
      }
      const live = await vehicleByKey(toKey);
      trailer.set({ currentPlate: toPlate, currentPlateKey: toKey, status: 'active' });
      await trailer.save();
      await Ls2Flatbed.updateOne({ plateKey: toKey }, { currentTrailerNumber: trailer.trailerNumber });
      await logEvent(req, {
        entityType: 'trailer', refId: trailer._id, label: trailer.trailerNumber,
        action: from.key ? 'transferred' : 'mounted',
        fromPlate: from.plate, fromPlateKey: from.key,
        toPlate, toPlateKey: toKey, date: when,
        odometerKm: live?.odometerKm ?? null, reason, notes,
      });
    } else {
      trailer.set({ currentPlate: null, currentPlateKey: null, status: 'spare' });
      await trailer.save();
      await logEvent(req, {
        entityType: 'trailer', refId: trailer._id, label: trailer.trailerNumber, action: 'removed',
        fromPlate: from.plate, fromPlateKey: from.key, date: when, reason, notes,
      });
    }
    // Trailer sensors travel with the trailer — recording its move is a review.
    await clearSensorNotice(from.key, toPlate ? plateKey(toPlate) : null);
    res.json({ trailer });
  } catch (e) {
    res.status(500).json({ message: e.message });
  }
};

// ---- Flatbeds --------------------------------------------------------------
exports.createFlatbed = async (req, res) => {
  try {
    const { plate, numbering = null, batch = '', brand = '', notes = '' } = req.body;
    if (!plate) return res.status(400).json({ message: 'Plate required' });
    const key = plateKey(plate);
    const exists = await Ls2Flatbed.findOne({ plateKey: key });
    if (exists) return res.status(409).json({ message: 'Flatbed already registered' });
    const flatbed = await Ls2Flatbed.create({ plate, plateKey: key, numbering, batch, brand, notes });
    await logEvent(req, { entityType: 'flatbed', refId: flatbed._id, label: flatbed.plate, action: 'registered' });
    res.status(201).json({ flatbed });
  } catch (e) {
    res.status(500).json({ message: e.message });
  }
};

exports.updateFlatbed = async (req, res) => {
  try {
    const allowed = ['numbering', 'batch', 'brand', 'notes'];
    const patch = {};
    for (const k of allowed) if (req.body[k] !== undefined) patch[k] = req.body[k];
    const flatbed = await Ls2Flatbed.findByIdAndUpdate(req.params.id, patch, { new: true });
    if (!flatbed) return res.status(404).json({ message: 'Not found' });
    emitAssetsChanged(); // the one mutation here that doesn't log an event
    res.json({ flatbed });
  } catch (e) {
    res.status(500).json({ message: e.message });
  }
};

// ---- History ---------------------------------------------------------------
// GET /assets/events?plate=&entityType=&refId=&limit=
exports.listEvents = async (req, res) => {
  try {
    const { plate, entityType, refId, limit = 300 } = req.query;
    const q = {};
    if (entityType) q.entityType = entityType;
    if (refId) q.refId = refId;
    if (plate) {
      const key = plateKey(plate);
      q.$or = [{ fromPlateKey: key }, { toPlateKey: key }];
    }
    const events = await Ls2AssetEvent.find(q).sort({ date: -1 }).limit(Math.min(Number(limit) || 300, 1000)).lean();
    res.json({ events });
  } catch (e) {
    res.status(500).json({ message: e.message });
  }
};

// ---- Sensor check ----------------------------------------------------------
// GET /assets/sensor-check — registered sensor flags vs what Wialon actually
// reports, per vehicle. Wialon's axle/tire numbering doesn't map 1:1 onto the
// workshop's 14-position scheme, so we compare COUNTS and show both layouts —
// enough to spot "registered يوجد but nothing reporting" and the reverse.
exports.sensorCheck = async (req, res) => {
  try {
    const [tires, vehicles] = await Promise.all([
      Ls2TireAsset.find({ status: 'mounted' }).lean(),
      Ls2Vehicle.find({}, { plate: 1, name: 1, unitId: 1, driver: 1, tires: 1, tireCount: 1 }).lean(),
    ]);
    const byPlate = new Map();
    for (const t of tires) {
      if (!t.plateKey) continue;
      if (!byPlate.has(t.plateKey)) byPlate.set(t.plateKey, []);
      byPlate.get(t.plateKey).push(t);
    }
    const rows = [];
    for (const [key, list] of byPlate) {
      const live = vehicles.find((v) => (plateKey(v.plate) || plateKey(v.name)) === key) || null;
      const liveTires = (live?.tires || []).filter((x) => x.tempC != null || (x.pressurePsi != null && x.pressurePsi > 10));
      const registeredYes = list.filter((t) => t.sensor === 'yes');
      rows.push({
        plate: list[0].plate,
        plateKey: key,
        unitId: live?.unitId ?? null,
        driver: live?.driver || '',
        registeredTotal: list.length,
        registeredWithSensor: registeredYes.length,
        registeredSensorPositions: registeredYes.map((t) => ({ positionNumber: t.positionNumber, positionLabel: t.positionLabel, section: t.section, serial: t.serial })),
        liveReporting: liveTires.length,
        liveTotal: live?.tires?.length ?? 0,
        livePositions: liveTires.map((x) => ({ axle: x.axle, position: x.position })),
        match: live ? registeredYes.length === liveTires.length : null,
        hasLive: !!live,
      });
    }
    rows.sort((a, b) => Number(a.match === true) - Number(b.match === true) || String(a.plate).localeCompare(String(b.plate)));
    res.json({ rows });
  } catch (e) {
    res.status(500).json({ message: e.message });
  }
};

// ---- Bulk import -----------------------------------------------------------
// POST /assets/import — accepts the workshop's JSON exactly as collected:
// { vehicles: [{ vehicle_number, trailer_number, tires: [{ tire_number, position,
//   position_number, section, serial, type, sensor }] }], flatbeds: [{ numbering,
//   plate, batch, brand }] }
// Idempotent: tires upsert by serial (a serial seen on another truck is a
// transfer, with the event to prove it), trailers by number, flatbeds by plate.
exports.importAssets = async (req, res) => {
  try {
    const { vehicles = [], flatbeds = [] } = req.body || {};
    const summary = { flatbeds: 0, trailers: 0, tiresNew: 0, tiresMoved: 0, tiresUnchanged: 0 };

    for (const f of flatbeds) {
      if (!f?.plate) continue;
      const key = plateKey(f.plate);
      const existing = await Ls2Flatbed.findOne({ plateKey: key });
      if (existing) {
        existing.set({ numbering: f.numbering ?? existing.numbering, batch: f.batch ?? existing.batch, brand: f.brand ?? existing.brand });
        await existing.save();
      } else {
        const created = await Ls2Flatbed.create({ plate: String(f.plate), plateKey: key, numbering: f.numbering ?? null, batch: f.batch || '', brand: f.brand || '' });
        await logEvent(req, { entityType: 'flatbed', refId: created._id, label: created.plate, action: 'registered', notes: 'استيراد' });
      }
      summary.flatbeds++;
    }

    for (const v of vehicles) {
      const plate = String(v.vehicle_number || '').trim();
      if (!plate) continue;
      const key = plateKey(plate);
      // Make sure the flatbed itself exists in the registry.
      if (!(await Ls2Flatbed.findOne({ plateKey: key }))) {
        const created = await Ls2Flatbed.create({ plate, plateKey: key });
        await logEvent(req, { entityType: 'flatbed', refId: created._id, label: plate, action: 'registered', notes: 'استيراد' });
      }
      // Trailer.
      if (v.trailer_number != null && String(v.trailer_number).trim()) {
        const tn = String(v.trailer_number).trim();
        let trailer = await Ls2Trailer.findOne({ trailerNumber: tn });
        if (!trailer) {
          trailer = await Ls2Trailer.create({ trailerNumber: tn, currentPlate: plate, currentPlateKey: key });
          await logEvent(req, { entityType: 'trailer', refId: trailer._id, label: tn, action: 'mounted', toPlate: plate, toPlateKey: key, notes: 'استيراد' });
          summary.trailers++;
        } else if (trailer.currentPlateKey !== key) {
          const from = { plate: trailer.currentPlate, key: trailer.currentPlateKey };
          trailer.set({ currentPlate: plate, currentPlateKey: key, status: 'active' });
          await trailer.save();
          await logEvent(req, {
            entityType: 'trailer', refId: trailer._id, label: tn,
            action: from.key ? 'transferred' : 'mounted',
            fromPlate: from.plate, fromPlateKey: from.key, toPlate: plate, toPlateKey: key, notes: 'استيراد',
          });
          summary.trailers++;
        }
        await Ls2Flatbed.updateOne({ plateKey: key }, { currentTrailerNumber: tn });
      }
      // Tires.
      for (const t of v.tires || []) {
        const serial = String(t.serial || '').trim();
        if (!serial) continue;
        const sensor = t.sensor === 'يوجد' ? 'yes' : t.sensor === 'لايوجد' || t.sensor === 'لا يوجد' ? 'no' : 'unknown';
        const fields = {
          tireNumber: String(t.tire_number ?? ''), type: t.type || '', sensor,
          status: 'mounted', plate, plateKey: key,
          positionNumber: t.position_number ?? null,
          positionLabel: t.position || '', section: t.section || '',
        };
        const existing = await Ls2TireAsset.findOne({ serial });
        if (!existing) {
          const created = await Ls2TireAsset.create({ serial, ...fields });
          await logEvent(req, {
            entityType: 'tire', refId: created._id, label: serial, action: 'mounted',
            toPlate: plate, toPlateKey: key, toPosition: posLabel(created), notes: 'استيراد',
          });
          summary.tiresNew++;
        } else if (existing.plateKey !== key || existing.positionNumber !== (t.position_number ?? null)) {
          const from = { plate: existing.plate, key: existing.plateKey, pos: posLabel(existing) };
          existing.set(fields);
          await existing.save();
          await logEvent(req, {
            entityType: 'tire', refId: existing._id, label: serial,
            action: from.key ? 'transferred' : 'mounted',
            fromPlate: from.plate, fromPlateKey: from.key, fromPosition: from.pos,
            toPlate: plate, toPlateKey: key, toPosition: posLabel(existing), notes: 'استيراد',
          });
          summary.tiresMoved++;
        } else {
          // Same place — just refresh identity fields quietly.
          existing.set({ tireNumber: fields.tireNumber, type: fields.type, sensor: fields.sensor, positionLabel: fields.positionLabel, section: fields.section });
          await existing.save();
          summary.tiresUnchanged++;
        }
      }
      // A fresh workshop sheet for this truck is exactly the review the
      // tire_sensor_change notice was waiting for.
      await clearSensorNotice(key);
    }
    res.json({ ok: true, summary });
  } catch (e) {
    res.status(500).json({ message: e.message });
  }
};
