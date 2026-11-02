/**
 * ls2AssetsController: fleet asset register of flatbeds, trailers and individual tires with full movement history.
 * The Wialon mirror only knows sensors, not which physical tire or trailer is on a truck, so this registry (keyed by tire serial / trailer number) is the source of truth; every mount, removal or transfer is an immutable Ls2AssetEvent. Vehicles match by normalized plate digits (plateKey) because Wialon plate strings vary.
 */
const Ls2Flatbed = require('../models/Ls2Flatbed');
const { sendMongooseError, describeMongooseError } = require('../utils/mongooseError');
const Ls2Trailer = require('../models/Ls2Trailer');
const Ls2TireAsset = require('../models/Ls2TireAsset');
const Ls2AssetEvent = require('../models/Ls2AssetEvent');
const Ls2Vehicle = require('../models/Ls2Vehicle');

// Shared with the workshop store — see utils/plateKey.js for why.
const { plateKey, vehiclePlateKey } = require('../utils/plateKey');
const { emitToAll } = require('../websocket/socketManager');
const cache = require('../utils/ttlCache');
const logAudit = require('../utils/auditLogger');
const tireSensors = require('../services/ls2TireSensors');

// Any asset mutation must reach the screens that mirror this registry live (the
// workshop store, fleet-assets, the vehicle profile). Coalesced so a bulk import
// broadcasts once, not once per row. Also drops the overview cache so the next
// load reflects the move immediately (no stale 15s window after a mutation).
let emitTimer = null;
function emitAssetsChanged() {
  cache.clear('ls2assets:');
  // Also covers what is derived from assets elsewhere in the section (dashboard, vehicle list, reports).
  require('../utils/ls2Touch').clearLs2Derived();
  // The fleet screens' sensor-tire column reads this registry's positions; without clearing the cache a technician would not see a new entry for up to a minute.
  tireSensors.clearLayoutCache();
  if (emitTimer) return;
  emitTimer = setTimeout(() => {
    emitTimer = null;
    try { emitToAll('ls2:updated', { at: Date.now(), assets: true }); emitToAll('ls2:store', {}); } catch (e) { /* socket down ≠ failed save */ }
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

const ENTITY_AR = { tire: 'كاوتش', trailer: 'تيدر', flatbed: 'سطحة' };
async function tireSnapshot(data) {
  if (data.entityType !== 'tire') return {};
  const t = await Ls2TireAsset.findById(data.refId).select('status condition conditionPercent').lean();
  return t ? { stateAfter: tireState(t), percentAfter: t.conditionPercent ?? null } : {};
}

async function logEvent(req, data) {
  let ev;
  try {
    ev = await Ls2AssetEvent.create({
      ...data,
      ...await tireSnapshot(data),
      performedBy: req.user?._id || null,
      performedByName: req.user ? `${req.user.firstName || ''} ${req.user.lastName || ''}`.trim() : '',
    });
  } finally {
    // After the write, so a screen reloading on the announcement sees this row; the asset
    // itself has already changed, so a failed log row must still announce.
    emitAssetsChanged();
  }
  // Asset movements are also written to the audit log: Ls2AssetEvent is the asset's own history, while the audit log answers what a given user did in the section this month.
  if (req.user) {
    const where = (plate, pos) => [plate, pos].filter(Boolean).join(' · ');
    logAudit({
      user: req.user, action: `ls2_asset_${data.action || 'changed'}`, entity: 'Ls2Asset', entityId: data.refId,
      changes: { details: [
        `${ENTITY_AR[data.entityType] || data.entityType || ''} ${data.label || ''}`.trim(),
        where(data.fromPlate, data.fromPosition) ? `من ${where(data.fromPlate, data.fromPosition)}` : '',
        where(data.toPlate, data.toPosition) ? `إلى ${where(data.toPlate, data.toPosition)}` : '',
        data.reason || '', data.notes || '',
      ].filter(Boolean).join(' — ') },
      ipAddress: req.ip,
    });
  }
  return ev;
}

// ---- Overview --------------------------------------------------------------
// GET /assets/overview — everything the fleet-assets page needs in one call.
// Cached 20s (cleared instantly on any asset mutation via emitAssetsChanged) so
// the throttled-Atlas triple-find (the tires set alone is ~260KB) runs once per
// window instead of on every page load — the page opens warm in ~2ms.
exports.getOverview = async (req, res) => {
  try {
    const body = await cache.wrap('ls2assets:overview', 20000, async () => {
      // A new truck in Location Solutions appears here without waiting for the poller; see services/ls2FleetRegister.
      await require('../services/ls2FleetRegister').ensureFlatbeds().catch(() => {});
      const [flatbeds, trailers, tires] = await Promise.all([
        Ls2Flatbed.find().sort({ numbering: 1 }).lean(),
        Ls2Trailer.find().sort({ trailerNumber: 1 }).lean(),
        Ls2TireAsset.find().sort({ plateKey: 1, positionNumber: 1 }).lean(),
      ]);
      // Prime the vehicle map ONCE, then look up per flatbed (no await in loop).
      await vehicleByKey('');
      const tiresByPlate = new Map();
      for (const t of tires) {
        if (t.status === 'mounted' && t.plateKey) {
          tiresByPlate.set(t.plateKey, (tiresByPlate.get(t.plateKey) || 0) + 1);
        }
      }
      const out = flatbeds.map((f) => {
        const live = vehicleKeyCache.map.get(f.plateKey) || null;
        return {
          ...f,
          tireCount: tiresByPlate.get(f.plateKey) || 0,
          unitId: live?.unitId ?? null,
          driver: live?.driver || '',
          odometerKm: live?.odometerKm ?? null,
        };
      });
      return {
        flatbeds: out,
        trailers,
        tires,
        counts: {
          flatbeds: flatbeds.length,
          trailers: trailers.length,
          tires: tires.length,
          // One bucket per state from the single definition, so the server and screen never disagree on a card or count a number with no card.
          ...Object.fromEntries(TIRE_STATES.map((st) => [st.key, tires.filter((t) => tireState(t) === st.key).length])),
          // In store = everything owned and not mounted: new, used, under renewal, at the factory and scrap. Damaged and sold are out of custody.
          inStore: tires.filter((t) => TIRE_STATES.find((x) => x.key === tireState(t))?.inStore).length,
          notMounted: tires.filter((t) => tireState(t) !== 'mounted').length,
          withSensor: tires.filter((t) => t.sensor === 'yes').length,
        },
      };
    });
    // Each flatbed's plate comes from the vehicle register, read outside the cache so edits there show on the next request.
    const vmIds = [...new Set(body.flatbeds.map((f) => f.vehicleMaster && String(f.vehicleMaster)).filter(Boolean))];
    if (vmIds.length) {
      const { VehicleMaster } = require('../models/VehicleMaster');
      const regs = new Map((await VehicleMaster.find({ _id: { $in: vmIds } }).select('plateNumber').lean()).map((v) => [String(v._id), v.plateNumber]));
      return res.json({ ...body, flatbeds: body.flatbeds.map((f) => ({ ...f, registryPlate: f.vehicleMaster ? regs.get(String(f.vehicleMaster)) || '' : '' })) });
    }
    res.json(body);
  } catch (e) {
    sendMongooseError(res, e, e.message);
  }
};

// GET /assets/vehicle/:plate/history
// One timeline of everything done to a truck, merged from five collections (tire movements, LS2 store issues, workshop store issues, repairs, periodic maintenance). Each row carries `kind` for screen filtering and its source. Rows are matched by the plateKey derived from the free-text plate, not the raw text, otherwise the same plate written two ways becomes two trucks.
exports.getVehicleHistory = async (req, res) => {
  try {
    const key = plateKey(req.params.plate);
    if (!key) return res.status(400).json({ message: 'Bad plate' });

    const { Ls2StoreMovement } = require('../models/Ls2Store');
    const { issueReasonLabel } = require('../utils/storeIssueReasons');
    const InventoryIssue = require('../models/InventoryIssue');
    const Ls2Repair = require('../models/Ls2Repair');
    const Ls2ServiceLog = require('../models/Ls2ServiceLog');

    const { Ls2RimMovement } = require('../models/Ls2Rim');
    const [tireEvents, storeOut, issues, repairs, services, rimMoves] = await Promise.all([
      // The busiest plate has more than 500 events, so the old cap made its tire history look complete while truncated.
      Ls2AssetEvent.find({ $or: [{ fromPlateKey: key }, { toPlateKey: key }] }).sort({ date: -1 }).limit(10000).lean(),
      Ls2StoreMovement.find({ vehiclePlate: { $nin: ['', null] } }).sort({ createdAt: -1 }).limit(3000).lean(),
      InventoryIssue.find({ vehicleNumber: { $nin: ['', null] } }).sort({ date: -1 }).limit(3000).lean(),
      Ls2Repair.find({ plate: { $nin: ['', null] } }).sort({ date: -1 }).limit(1000).lean(),
      Ls2ServiceLog.find({ plate: { $nin: ['', null] } }).sort({ date: -1 }).limit(1000).lean(),
      // Legacy copies are skipped: the store rows they copy are already read above.
      Ls2RimMovement.find({ plateKey: key, legacy: { $ne: true }, type: { $ne: 'edit' } }).sort({ at: -1 }).limit(1000).lean(),
    ]);

    const mine = (v) => plateKey(v) === key;
    const rows = [];

    for (const e of tireEvents) {
      rows.push({
        kind: e.entityType === 'tire' ? 'tire' : 'asset',
        date: e.date, action: e.action, label: e.label,
        title: e.entityType === 'tire' ? `كاوتش ${e.label}` : `${e.entityType} ${e.label}`,
        detail: [e.fromPosition && `من ${e.fromPlate || 'مخزن'} ${e.fromPosition}`,
          e.toPosition && `إلى ${e.toPlate || 'مخزن'} ${e.toPosition}`].filter(Boolean).join('  ←  '),
        odometerKm: e.odometerKm, by: e.performedByName, notes: e.notes,
        source: 'assets', refId: e.refId,
      });
    }
    for (const m of storeOut.filter((x) => mine(x.vehiclePlate))) {
      rows.push({
        kind: 'part', date: m.createdAt, action: m.type === 'out' ? 'صرف' : 'وارد',
        title: m.itemName, detail: `${m.type === 'out' ? 'صادر' : 'وارد'} ${m.quantity}`,
        by: m.performedByName, notes: [issueReasonLabel(m.issueReason), m.reason, m.reversed ? 'اتّرجع عنها' : ''].filter(Boolean).join(' · '),
        issueReason: m.issueReason || '', issueReasonLabel: issueReasonLabel(m.issueReason),
        reversed: !!m.reversed, source: 'ls2-store', refId: m._id,
      });
    }
    const { REASON_LABELS: RIM_REASONS } = require('./ls2RimsController');
    for (const m of rimMoves) {
      rows.push({
        kind: 'part', date: m.at || m.createdAt, action: m.type === 'out' ? 'صرف' : 'وارد',
        title: m.rimName, detail: `${m.type === 'out' ? 'صادر' : 'وارد'} ${m.quantity}`,
        by: m.performedByName, notes: [RIM_REASONS[m.reason]?.ar, m.notes, m.reversed ? 'اتّرجع عنها' : ''].filter(Boolean).join(' · '),
        reversed: !!m.reversed, source: 'ls2-rims', refId: m._id,
      });
    }
    for (const i of issues.filter((x) => mine(x.vehicleNumber))) {
      rows.push({
        kind: 'part', date: i.date ? new Date(i.date) : i.createdAt, action: 'صرف',
        title: i.itemName, detail: [i.quantity && `${i.quantity} ${i.unit || ''}`.trim(), i.fitLocation].filter(Boolean).join(' · '),
        by: i.issuedByName || i.performedByName || '', notes: i.notes || '',
        source: 'workshop-store', refId: i._id,
      });
    }
    for (const r of repairs.filter((x) => mine(x.plate))) {
      rows.push({
        kind: 'repair', date: r.date || r.createdAt, action: r.status, title: r.title,
        detail: [r.workshop, r.partsReplaced].filter(Boolean).join(' · '),
        odometerKm: r.odometerKm ?? null, by: r.performedByName, notes: r.description || '',
        source: 'repairs', refId: r._id,
      });
    }
    for (const s of services.filter((x) => mine(x.plate))) {
      rows.push({
        kind: 'service', date: s.serviceDate || s.date || s.createdAt, action: s.action,
        title: s.intervalName || s.serviceType || 'صيانة',
        detail: (s.items || []).filter((x) => x.status === 'done').map((x) => x.labelAr || x.label).slice(0, 6).join(' · '),
        odometerKm: s.odometerKm ?? null, by: s.performedByName, notes: s.notes || '',
        source: 'maintenance', refId: s._id,
      });
    }

    rows.sort((a, b) => new Date(b.date || 0) - new Date(a.date || 0));
    const counts = rows.reduce((acc, r) => { acc[r.kind] = (acc[r.kind] || 0) + 1; return acc; }, {});
    res.json({ plate: req.params.plate, plateKey: key, counts, total: rows.length, rows: rows.slice(0, 800) });
  } catch (e) {
    sendMongooseError(res, e, e.message);
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
    sendMongooseError(res, e, e.message);
  }
};

// ---- Tires ----
// POST /assets/tires - register a new tire (optionally mounted straight away).
// No rule ties tire grade to mount position: the old retread-on-trailer-only rule blocked real workshop practice (retreads on the four rear-of-head positions), so only physical checks remain (state and empty slot).

/** The tire number is generated, not typed: a free field allowed duplicates and gaps. Next number = highest registered tire number + 1, shown in the form and recomputed on save because a colleague may have taken it. */
async function nextTireNumber() {
  const rows = await Ls2TireAsset.find({ tireNumber: { $regex: /^\s*\d+\s*$/ } }).select('tireNumber').lean();
  let max = 0;
  for (const r of rows) { const n = Number(String(r.tireNumber).trim()); if (Number.isSafeInteger(n) && n > max) max = n; }
  return String(max + 1);
}

// Slots are not unique in the schema: a transfer passes through a shared slot
// mid-swap, so every write that seats a tire has to check here.
async function slotHolders(key, positions, exceptIds = []) {
  const wanted = [...new Set(positions.filter((p) => p != null && p !== '').map(Number))];
  if (!key || !wanted.length) return [];
  return Ls2TireAsset.find({ status: 'mounted', plateKey: key, positionNumber: { $in: wanted }, _id: { $nin: exceptIds } })
    .select('serial tireNumber positionNumber').lean();
}
const slotClashMessage = (plate, held) => `الموقع مشغول على ${plate}: ${held
  .map((t) => `إطار ${t.positionNumber} (${t.serial})`).join('، ')} — انقل الفردة دي الأول`;

const isSlotClash = (e) => e?.code === 11000 && !!e.keyPattern?.positionNumber;
const SLOT_TAKEN = 'الموقع اتشغل حالًا بفردة تانية — حدّث الصفحة واختر موقع تاني';
function sendTireError(res, e) {
  if (isSlotClash(e)) return res.status(409).json({ code: 'SLOT_OCCUPIED', message: SLOT_TAKEN });
  return sendMongooseError(res, e, e.message);
}

// Tires trading slots would break the one-tire-per-slot index mid-way, so they
// give up their slot first. Each must be saved with `markModified('positionNumber')`
// because its loaded doc still holds the old number. The returned undo puts back
// whatever was not placed.
async function parkTires(tires) {
  const parked = tires.filter((t) => t.positionNumber != null).map((t) => ({ _id: t._id, positionNumber: t.positionNumber }));
  if (parked.length) await Ls2TireAsset.updateMany({ _id: { $in: parked.map((t) => t._id) } }, { $set: { positionNumber: null } });
  return async () => {
    for (const t of parked) {
      await Ls2TireAsset.updateOne({ _id: t._id, positionNumber: null }, { $set: { positionNumber: t.positionNumber } })
        .catch((e) => console.error(`[ls2] tire ${t._id} lost its slot:`, e.message));
    }
  };
}

exports.nextTireNumber = async (req, res) => {
  try { res.json({ tireNumber: await nextTireNumber() }); }
  catch (e) { res.status(500).json({ message: 'تعذّر توليد رقم الفردة' }); }
};

exports.createTire = async (req, res) => {
  try {
    const { serial, tireNumber: sentNumber = '', type = '', size = '', sensor = 'unknown', condition, plate = null, positionNumber = null, positionLabel = '', section = '', notes = '', isSpare = false } = req.body;
    if (!serial || !String(serial).trim()) return res.status(400).json({ message: 'Serial required' });
    const exists = await Ls2TireAsset.findOne({ serial: String(serial).trim() });
    if (exists) return res.status(409).json({ message: 'Serial already registered', tire: exists });
    const key = plate ? plateKey(plate) : null;
    // A freshly registered unmounted tire is what a purchase just delivered —
    // grade 'new' unless the workshop says otherwise; a tire registered already
    // on a truck is ordinary 'used'.
    const held = await slotHolders(key, [positionNumber]);
    if (held.length) return res.status(409).json({ code: 'SLOT_OCCUPIED', message: slotClashMessage(plate, held) });
    const grade = ['new', 'used'].includes(condition) ? condition : (key ? 'used' : 'new');
    const tireNumber = String(sentNumber || '').trim() || await nextTireNumber();
    const tire = await Ls2TireAsset.create({
      serial: String(serial).trim(), tireNumber, type, size, sensor, notes,
      condition: grade,
      status: key ? 'mounted' : 'spare',
      plate: key ? plate : null, plateKey: key,
      positionNumber: key ? positionNumber : null,
      positionLabel: key ? positionLabel : '', section: key ? section : '',
      isSpare: key ? !!isSpare : false, // A spare is flagged only while mounted on the truck.
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
    sendTireError(res, e);
  }
};

// PATCH /assets/tires/:id — edit identity fields (not location — use /move).
exports.updateTire = async (req, res) => {
  try {
    const allowed = ['tireNumber', 'type', 'size', 'sensor', 'notes', 'serial', 'positionLabel', 'isSpare'];
    const current = await Ls2TireAsset.findById(req.params.id);
    if (!current) return res.status(404).json({ message: 'Not found' });
    // The edit form sends every field; only real changes reach the log.
    const patch = {};
    for (const k of allowed) if (req.body[k] !== undefined && String(req.body[k]) !== String(current[k] ?? '')) patch[k] = req.body[k];
    if (!Object.keys(patch).length) return res.json({ tire: current, unchanged: true });
    const tire = await Ls2TireAsset.findByIdAndUpdate(req.params.id, patch, { new: true });
    if (!tire) return res.status(404).json({ message: 'Not found' });
    await logEvent(req, {
      entityType: 'tire', refId: tire._id, label: tire.serial, action: 'updated',
      notes: Object.keys(patch).map((k) => `${k}: ${patch[k]}`).join(', '),
    });
    res.json({ tire });
  } catch (e) {
    sendMongooseError(res, e, e.message);
  }
};

// POST /assets/tires/:id/move - mount / transfer / unmount one tire.
// body: { toPlate|null, positionNumber, positionLabel, section, reason, notes, date, destination, conditionPercent, displacedTo, replacementTireId }
// In-implies-out: mounting into an OCCUPIED slot requires `displacedTo` ('repair', 'damaged', 'scrap' or 'store'). `replacementTireId` completes the other half of a swap in the same operation. Destinations come from config/tireStates.js, shared by server, web and mobile.
const { DISMOUNT_DESTINATIONS, STATUS_ACTION: TIRE_STATUS_ACTION, tireState, TIRE_STATES } = require('../config/tireStates');
const DEST = Object.fromEntries(DISMOUNT_DESTINATIONS.map((d) => [d.key, d]));
// Legacy names still sent by outdated clients are accepted rather than rejected.
const DEST_ALIAS = { store: 'used', repair: 'under_renewal' };
const destOf = (key) => DEST[DEST_ALIAS[key] || key] || null;

/** Grade describes the tire, not its location, so it does not follow status. Location lives entirely in `status`; grade stays unchanged unless given explicitly. Otherwise the two could diverge and a shelf tire would still count as at the factory. */
function gradeForStatus(tire, status, explicit) {
  if (explicit === 'new' || explicit === 'used') return explicit;
  // The legacy grade `at_factory` is no longer valid and is read as used.
  return tire.condition === 'new' ? 'new' : 'used';
}

// Mount a spare tire into a specific (now empty) slot. Shared by the move and
// swap paths; throws with a user-facing Arabic message on rule violations.
async function mountSpareTire(req, tireId, slot, when, reason) {
  const r = await Ls2TireAsset.findById(tireId);
  if (!r) throw new Error('الفردة البديلة غير موجودة');
  // The replacement may come from the store (spare) or be pulled off another truck (a swap); the workshop usually has no spares. Only out-of-service tires (at factory, damaged, scrap, out of service) are rejected.
  if (!['spare', 'mounted'].includes(r.status)) {
    throw new Error(`الفردة البديلة ${r.serial} ليست متاحة للتركيب — حالتها الحالية لا تسمح بذلك`);
  }
  // Mounting from the same vehicle is allowed (e.g. swap with the spare) as long as it is not the exact same position.
  if (r.status === 'mounted' && r.plateKey === slot.plateKey && r.positionNumber != null && slot.positionNumber != null
      && String(r.positionNumber) === String(slot.positionNumber)) {
    throw new Error(`الفردة البديلة ${r.serial} مركّبة بالفعل في نفس الموضع`);
  }
  // If it was mounted on another truck, record it leaving that truck first so
  // the swap is a full audit trail (the old slot is now physically empty).
  const fromMounted = r.status === 'mounted' && r.plateKey
    ? { plate: r.plate, plateKey: r.plateKey, pos: posLabel(r) }
    : null;
  r.set({
    status: 'mounted', plate: slot.plate, plateKey: slot.plateKey,
    positionNumber: slot.positionNumber, positionLabel: slot.positionLabel, section: slot.section,
    isSpare: !!slot.isSpare, // The tire inherits its spare flag from the position it is mounted in.
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

/** Spare position: the only position allowed to stay empty, since the truck runs without it. */
const isSpareSlot = (slot) => !!slot && (slot.isSpare || /استبن/.test(String(slot.section || '')));
const slotOf = (t) => ({
  plate: t.plate, plateKey: t.plateKey, positionNumber: t.positionNumber,
  positionLabel: t.positionLabel, section: t.section, isSpare: t.isSpare,
});

/**
 * Replacement chain: no position is left empty.
 * A tire leaving a truck vacates a slot that needs a replacement. If the replacement comes from stock the chain ends; if it is pulled from another truck, that truck needs a third, and so on until a stock tire or a spare position ends the chain.
 * The whole chain is validated before any write, so a failure at step three cannot leave two moves applied.
 * Returns `{ error }` or `{ steps }` (each step is a tire and the slot it mounts into).
 */
async function planReplacementChain({ movedTire, vacated, chainIds, excludeIds = [] }) {
  const steps = [];
  const used = new Set([String(movedTire._id), ...excludeIds.map(String)]);
  let pending = vacated && !isSpareSlot(vacated) ? vacated : null;
  let slot = vacated;
  for (const id of chainIds) {
    if (!slot) return { error: 'لا يوجد موقعٌ أُخلي لتُركَّب فيه هذه الفردة' };
    if (used.has(String(id))) return { error: 'الفردة نفسها مختارة مرّتين في سلسلة البدائل' };
    used.add(String(id));
    const r = await Ls2TireAsset.findById(id).lean();
    if (!r) return { error: 'الفردة البديلة غير موجودة' };
    if (!['spare', 'mounted'].includes(r.status)) {
      return { error: `الفردة البديلة ${r.serial} ليست متاحة للتركيب — حالتها الحالية لا تسمح بذلك` };
    }
    steps.push({ id: String(r._id), serial: r.serial, slot });
    if (r.status === 'mounted' && r.plateKey) {
      slot = slotOf(r);
      pending = isSpareSlot(slot) ? null : { ...slot, serial: r.serial };
    } else {
      slot = null;
      pending = null;
    }
  }
  if (pending) {
    return {
      error: `الموقع «${pending.positionLabel || pending.positionNumber}» على ${pending.plate} `
        + (pending.serial ? `(كانت عليه ${pending.serial}) ` : '')
        + 'لا يجوز أن يبقى فارغًا — اختر فردةً تُركَّب مكانها: من المستودع، أو من عربيةٍ أخرى ثمّ املأ مكانها هي أيضًا.',
      code: 'REPLACEMENT_REQUIRED',
      vacating: { plate: pending.plate, positionNumber: pending.positionNumber, positionLabel: pending.positionLabel, section: pending.section },
    };
  }
  return { steps };
}

const chainHasReplacement = (b) => !!(b.replacementTireId || b.secondReplacementTireId || b.chain?.length);

exports.moveTire = async (req, res) => {
  try {
    const tire = await Ls2TireAsset.findById(req.params.id);
    if (!tire) return res.status(404).json({ message: 'Not found' });
    const { toPlate = null, positionNumber = null, positionLabel = '', section = '', reason = '', notes = '', date, destination = 'store', conditionPercent = null, displacedTo = '', displacedConditionPercent = null, replacementTireId = null, secondReplacementTireId = null } = req.body;
    const from = { plate: tire.plate, key: tire.plateKey, pos: posLabel(tire) };
    // The exact slot being vacated — the replacement (if any) goes here.
    const vacated = tire.status === 'mounted' && tire.plateKey
      ? { plate: tire.plate, plateKey: tire.plateKey, positionNumber: tire.positionNumber, positionLabel: tire.positionLabel, section: tire.section, isSpare: tire.isSpare }
      : null;
    if (replacementTireId && !vacated) {
      return res.status(400).json({ message: 'لا يمكن تركيب بديل — الفردة ليست مركبة على سطحة أصلًا' });
    }
    if (replacementTireId && String(replacementTireId) === String(tire._id)) {
      return res.status(400).json({ message: 'الفردة البديلة هي نفسها الفردة المُنزَلة' });
    }
    // A repeated request (double tap, retry) already took effect: log nothing twice.
    if (vacated && toPlate && !chainHasReplacement(req.body) && plateKey(toPlate) === vacated.plateKey
        && String(positionNumber) === String(vacated.positionNumber)) {
      return res.json({ tire, unchanged: true });
    }

    // Business rule: a position is never left empty, including at the end of the chain; see planReplacementChain. A mutual swap fills both positions itself, so it has no chain.
    const chainIds = [replacementTireId, secondReplacementTireId, ...(Array.isArray(req.body.chain) ? req.body.chain : [])]
      .filter(Boolean).map(String);
    let plan = { steps: [] };
    if (destination !== 'swap') {
      // The tire in the target position already has its fate in `displacedTo`, so it cannot also be pulled as a replacement in the same operation; that is a swap with its own option.
      const exclude = [];
      if (toPlate && positionNumber != null) {
        const occ = await Ls2TireAsset.findOne({ plateKey: plateKey(toPlate), positionNumber, status: 'mounted', _id: { $ne: tire._id } }).select('_id').lean();
        if (occ) exclude.push(occ._id);
      }
      // Moving within the same position vacates nothing.
      const sameSlot = vacated && toPlate && plateKey(toPlate) === vacated.plateKey
        && String(positionNumber) === String(vacated.positionNumber);
      plan = await planReplacementChain({ movedTire: tire, vacated: sameSlot ? null : vacated, chainIds, excludeIds: exclude });
      if (plan.error) {
        return res.status(400).json({ code: plan.code, message: plan.error, vacating: plan.vacating });
      }
    }

    const when = date ? new Date(date) : new Date();

    // Mutual swap between two trucks: tire X on truck A and replacement Y on truck B trade positions in one operation, requested with destination='swap'.
    if (destination === 'swap') {
      if (!vacated) return res.status(400).json({ message: 'التبديل يتطلب أن تكون الفردة مركّبة على سطحة أصلًا' });
      if (!replacementTireId) return res.status(400).json({ message: 'اختر الفردة التي ستُبدَّل معها من العربية الأخرى' });
      const y = await Ls2TireAsset.findById(replacementTireId);
      if (!y) return res.status(404).json({ message: 'الفردة البديلة غير موجودة' });
      if (String(y._id) === String(tire._id)) return res.status(400).json({ message: 'لا يمكن تبديل الفردة مع نفسها' });
      if (y.status !== 'mounted' || !y.plateKey) return res.status(400).json({ message: `الفردة ${y.serial} ليست مركّبة على عربية — التبديل يكون مع فردة مركّبة` });
      // A swap on the same truck (e.g. spare with a mounted tire) is allowed; only the exact same position is rejected.
      if (y.plateKey === vacated.plateKey && y.positionNumber != null && vacated.positionNumber != null
          && String(y.positionNumber) === String(vacated.positionNumber)) {
        return res.status(400).json({ message: 'الفردتان في نفس الموضع — لا يمكن التبديل' });
      }
      const ySlot = { plate: y.plate, plateKey: y.plateKey, positionNumber: y.positionNumber, positionLabel: y.positionLabel, section: y.section };
      const yPos = posLabel(y);
      // The spare flag follows the position: each tire inherits it from the position it moves to.
      const xWasSpare = tire.isSpare, yWasSpare = y.isSpare;
      const [liveA, liveB] = [await vehicleByKey(vacated.plateKey), await vehicleByKey(ySlot.plateKey)];
      const unpark = await parkTires([y]);
      try {
        // X takes Y's slot first, then Y takes the one X just left.
        tire.set({ status: 'mounted', plate: ySlot.plate, plateKey: ySlot.plateKey, positionNumber: ySlot.positionNumber, positionLabel: ySlot.positionLabel, section: ySlot.section, isSpare: yWasSpare });
        await tire.save();
        y.set({ status: 'mounted', plate: vacated.plate, plateKey: vacated.plateKey, positionNumber: vacated.positionNumber, positionLabel: vacated.positionLabel, section: vacated.section, isSpare: xWasSpare });
        y.markModified('positionNumber');
        await y.save();
      } catch (err) {
        await unpark();
        throw err;
      }
      await logEvent(req, {
        entityType: 'tire', refId: y._id, label: y.serial, action: 'transferred',
        fromPlate: ySlot.plate, fromPlateKey: ySlot.plateKey, fromPosition: yPos,
        toPlate: vacated.plate, toPlateKey: vacated.plateKey, toPosition: posLabel(y),
        date: when, odometerKm: liveA?.odometerKm ?? null,
        reason: reason || `تبديل: نُقلت من ${ySlot.plate} إلى ${vacated.plate}`,
      });
      await logEvent(req, {
        entityType: 'tire', refId: tire._id, label: tire.serial, action: 'transferred',
        fromPlate: from.plate, fromPlateKey: from.key, fromPosition: from.pos,
        toPlate: ySlot.plate, toPlateKey: ySlot.plateKey, toPosition: posLabel(tire),
        date: when, odometerKm: liveB?.odometerKm ?? null,
        reason: reason || `تبديل: نُقلت من ${vacated.plate} إلى ${ySlot.plate}`,
      });
      return res.json({ tire, replacement: y, swapped: true });
    }

    if (toPlate) {
      const toKey = plateKey(toPlate);
      const live = await vehicleByKey(toKey);
      // The slot's current occupant: an IN must declare its OUT.
      if (positionNumber != null) {
        const occupant = await Ls2TireAsset.findOne({
          plateKey: toKey, positionNumber, status: 'mounted', _id: { $ne: tire._id },
        });
        if (occupant) {
          if (!destOf(displacedTo)) {
            return res.status(400).json({
              code: 'DISPLACED_FATE_REQUIRED',
              message: `الموقع مشغول بالفردة ${occupant.serial} — حدد مصيرها: في المصنع أو تالفة أو سكراب أو سليمة للمخزن`,
              occupant: { serial: occupant.serial, tireNumber: occupant.tireNumber },
            });
          }
          const occFrom = posLabel(occupant);
          const occDest = destOf(displacedTo);
          const occStatus = occDest.status;
          const occPct = occStatus === 'spare' && displacedConditionPercent != null && displacedConditionPercent !== ''
            ? Math.max(0, Math.min(100, Number(displacedConditionPercent))) : null;
          occupant.set({
            status: occStatus, plate: null, plateKey: null, positionNumber: null, positionLabel: '', section: '', isSpare: false,
            // Grade follows destination: a tire sent to the factory must show in the factory bucket, otherwise it stays counted on the shelf while physically gone.
            condition: gradeForStatus(occupant, occStatus, occDest.condition),
            // A good tire returned to the store records its condition percent (read later by placement), like a normal removal.
            ...(occPct != null ? { conditionPercent: occPct } : {}),
          });
          await occupant.save();
          await logEvent(req, {
            entityType: 'tire', refId: occupant._id, label: occupant.serial,
            action: occDest.action,
            fromPlate: toPlate, fromPlateKey: toKey, fromPosition: occFrom, date: when,
            odometerKm: live?.odometerKm ?? null,
            reason: reason || `أُزيلت لتركيب الفردة ${tire.serial} مكانها`,
            notes: occPct != null ? `الحالة ${occPct}%` : '',
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
      // Off the truck, but the destination matters: the renewal shop is not the shelf, scrap is stored to sell, and damaged is gone for good.
      const wasInRepair = ['in_repair', 'under_renewal', 'at_factory'].includes(tire.status);
      const dest = destOf(destination) || DEST.used;
      const toStatus = dest.status;
      tire.set({
        status: toStatus,
        condition: gradeForStatus(tire, toStatus, dest.condition),
        plate: null, plateKey: null, positionNumber: null, positionLabel: '', section: '',
        isSpare: false, // A tire off the truck is not a spare.

        // Condition percent is recorded on return to the store; placement reads it later.
        ...(toStatus === 'spare' && conditionPercent != null && conditionPercent !== ''
          ? { conditionPercent: Math.max(0, Math.min(100, Number(conditionPercent))) } : {}),
      });
      await tire.save();
      await logEvent(req, {
        entityType: 'tire', refId: tire._id, label: tire.serial,
        action: toStatus === 'spare' && wasInRepair ? 'from_repair' : dest.action,
        fromPlate: from.plate, fromPlateKey: from.key, fromPosition: from.pos,
        date: when, reason,
        notes: [notes, toStatus === 'spare' && conditionPercent != null && conditionPercent !== '' ? `الحالة ${conditionPercent}%` : ''].filter(Boolean).join(' — '),
      });
    }
    // Chain execution: each tire goes into the slot its predecessor vacated. Slots were computed in planning before any move, so no step reads a slot changed by an earlier one.
    const placed = [];
    for (const step of plan.steps) {
      try {
        placed.push(await mountSpareTire(req, step.id, step.slot, when, reason));
      } catch (err) {
        return res.status(isSlotClash(err) ? 409 : 400).json({ message: isSlotClash(err) ? SLOT_TAKEN : err.message, tire, placed, partial: true });
      }
    }
    const replacement = placed[0] || null;
    const secondReplacement = placed[1] || null;
    await clearSensorNotice(from.key, toPlate ? plateKey(toPlate) : null);
    res.json({ tire, replacement, secondReplacement, chain: placed });
  } catch (e) {
    sendTireError(res, e);
  }
};

// POST /assets/tires/:id/renewal-result
// The only exit from the factory state: returned usable (to the shelf, used grade, mountable anywhere) or scrapped for sale.
exports.tireRenewalResult = async (req, res) => {
  try {
    const tire = await Ls2TireAsset.findById(req.params.id);
    if (!tire) return res.status(404).json({ message: 'Not found' });
    if (!['in_repair', 'under_renewal', 'at_factory'].includes(tire.status)) {
      return res.status(400).json({ message: 'الفردة ليست تحت التجديد ولا في المصنع' });
    }
    const { result, notes = '' } = req.body || {};
    if (!['renewed', 'scrap'].includes(result)) return res.status(400).json({ message: 'result must be renewed | scrap' });
    // Either way the tire left the factory so its grade returns to normal: renewal success puts it on the shelf as used; failure makes it scrap for sale.
    const st = result === 'renewed' ? 'spare' : 'scrap';
    tire.set({ status: st, condition: gradeForStatus(tire, st, req.body.condition) });
    await tire.save();
    await logEvent(req, {
      entityType: 'tire', refId: tire._id, label: tire.serial,
      action: result === 'renewed' ? 'renewed' : 'scrapped',
      notes,
    });
    res.json({ tire });
  } catch (e) {
    sendMongooseError(res, e, e.message);
  }
};

// POST /assets/tires/:id/retire
// Terminal states outside the renewal loop. kind: 'damaged' (gone) | 'scrap' (for sale) | default legacy 'retired'.
// A position is never left empty: every path that removes a tire from a truck goes through here. Only the spare is exempt, since the truck runs without it (see /move).
function blockEmptySlot(tire, replacementTireId) {
  if (tire.status !== 'mounted' || !tire.plateKey) return null;
  if (replacementTireId) return null;
  if (tire.isSpare || /استبن/.test(String(tire.section || ''))) return null;
  return {
    code: 'REPLACEMENT_REQUIRED',
    message: `الفردة مركّبة في «${tire.positionLabel || tire.positionNumber}» على ${tire.plate} — `
      + 'نزّلها من «إنزال + بديل» واختر الفردة اللي هتتركب مكانها. الموقع لا يجوز أن يبقى فارغًا.',
    vacating: {
      plate: tire.plate, positionNumber: tire.positionNumber,
      positionLabel: tire.positionLabel, section: tire.section,
    },
  };
}

exports.retireTire = async (req, res) => {
  try {
    const tire = await Ls2TireAsset.findById(req.params.id);
    if (!tire) return res.status(404).json({ message: 'Not found' });
    const kind = ['damaged', 'scrap', 'sold'].includes(req.body?.kind) ? req.body.kind : 'retired';
    if (tire.status === kind) return res.json({ tire, unchanged: true });
    const blocked = blockEmptySlot(tire, req.body?.replacementTireId);
    if (blocked) return res.status(400).json(blocked);
    const from = { plate: tire.plate, key: tire.plateKey, pos: posLabel(tire) };
    tire.set({ status: kind, plate: null, plateKey: null, positionNumber: null, positionLabel: '', section: '', isSpare: false });
    await tire.save();
    await logEvent(req, {
      entityType: 'tire', refId: tire._id, label: tire.serial,
      action: kind === 'damaged' ? 'damaged' : kind === 'scrap' ? 'scrapped' : kind === 'sold' ? 'sold' : 'retired',
      fromPlate: from.plate, fromPlateKey: from.key, fromPosition: from.pos,
      reason: req.body?.reason || '', notes: req.body?.notes || '',
    });
    await clearSensorNotice(from.key);
    res.json({ tire });
  } catch (e) {
    sendMongooseError(res, e, e.message);
  }
};

// POST /assets/tires/:id/status
// Move a tire between states directly from the store: spare / in_repair / scrap / damaged / retired / sold. A mounted tire is unmounted automatically. body: { status, condition?, conditionPercent?, reason?, notes? }. States come from config/tireStates.js.
const STATUS_ACTION = TIRE_STATUS_ACTION;
exports.setTireStatus = async (req, res) => {
  try {
    const tire = await Ls2TireAsset.findById(req.params.id);
    if (!tire) return res.status(404).json({ message: 'Not found' });
    let { status } = req.body || {};
    // The screen sends the bucket as the user sees it (new / used), but both buckets are one status (`spare`) with two grades, so the translation happens once here instead of in every screen.
    const asDest = destOf(status);
    if (asDest && asDest.status === 'spare') {
      req.body.condition = asDest.condition;
      status = 'spare';
    } else if (asDest) {
      status = asDest.status;
    }
    if (!['spare', 'under_renewal', 'at_factory', 'scrap', 'damaged', 'retired', 'sold', 'in_repair'].includes(status)) {
      return res.status(400).json({ message: 'حالة غير صالحة' });
    }
    const samePct = req.body.conditionPercent == null || req.body.conditionPercent === '' || Number(req.body.conditionPercent) === tire.conditionPercent;
    if (status === tire.status && samePct && (!req.body.condition || req.body.condition === tire.condition)) {
      return res.json({ tire, unchanged: true });
    }
    const blocked = blockEmptySlot(tire, req.body?.replacementTireId);
    if (blocked) return res.status(400).json(blocked);
    const from = { plate: tire.plate, key: tire.plateKey, pos: posLabel(tire), status: tire.status };
    const set = { status, condition: gradeForStatus(tire, status, req.body.condition) };
    // The factory state is derived from status, not chosen. Grade is not manually changed while the tire is at the factory, otherwise the store bucket counts an absent tire as on the shelf.
    if (['new', 'used'].includes(req.body.condition)) set.condition = req.body.condition;
    if (req.body.conditionPercent != null && req.body.conditionPercent !== '') set.conditionPercent = Number(req.body.conditionPercent);
    // Leaving a mounted state unmounts the tire from vehicle and position.
    if (tire.status === 'mounted') {
      Object.assign(set, { plate: null, plateKey: null, positionNumber: null, positionLabel: '', section: '', isSpare: false });
    }
    tire.set(set);
    await tire.save();
    await logEvent(req, {
      entityType: 'tire', refId: tire._id, label: tire.serial, action: STATUS_ACTION[status] || 'updated',
      fromPlate: from.plate, fromPlateKey: from.key, fromPosition: from.pos,
      reason: req.body?.reason || '', notes: `${from.status} → ${status}${req.body?.notes ? ` · ${req.body.notes}` : ''}`,
    });
    if (from.key) await clearSensorNotice(from.key);
    res.json({ tire });
  } catch (e) {
    sendMongooseError(res, e, e.message);
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
    await require('../services/ls2TireTrailers').resyncTireTrailers();
    res.status(201).json({ trailer });
  } catch (e) {
    sendMongooseError(res, e, e.message);
  }
};

// POST /assets/trailers/:id/move - hitch to another flatbed (or unhitch: toPlate null).
// A trailer moves WITH its tires; otherwise the old truck keeps tires that left with the trailer.
// A truck pulls one trailer, so the displaced old trailer needs an explicit destination: displacedTo 'standing' (dropped with its tires) or 'swap' (goes to the truck the new trailer left).
// body: { toPlate | null, displacedTo, reason, notes, date }

/**
 * A trailer's tires, collected BEFORE any trailer moves: the tire pre-save derives
 * trailerNumber from whichever trailer is on the plate, so two trailers sharing a
 * plate mid-swap would mix their tires.
 * Matched by number, or by being in the trailer section of its plate with no number.
 * Always within the trailer section: a spare on another truck never travels with it.
 */
async function trailerTires(trailer) {
  const or = [{ trailerNumber: trailer.trailerNumber }];
  if (trailer.currentPlateKey) {
    or.push({ plateKey: trailer.currentPlateKey, trailerNumber: { $in: [null, ''] } });
  }
  return Ls2TireAsset.find({ status: 'mounted', section: { $regex: 'تيدر|تريل' }, $or: or });
}

/** Moves tires collected by `trailerTires` to their trailer's new place. Call after all trailers are seated. */
async function carryTrailerTires(req, trailer, tires, toPlate, toKey, when, odometerKm, reason) {
  for (const ti of tires) {
    const from = { plate: ti.plate, key: ti.plateKey, pos: posLabel(ti) };
    if (String(from.key || '') === String(toKey || '')) continue;
    // Written explicitly: a standing trailer has no plate to derive the number from.
    ti.set({ plate: toPlate || null, plateKey: toKey || null, trailerNumber: trailer.trailerNumber });
    ti.markModified('positionNumber');
    await ti.save();
    await logEvent(req, {
      entityType: 'tire', refId: ti._id, label: ti.serial, action: 'transferred',
      fromPlate: from.plate, fromPlateKey: from.key, fromPosition: from.pos,
      toPlate: toPlate || null, toPlateKey: toKey || null,
      toPosition: toPlate ? posLabel(ti) : `تيدر ${trailer.trailerNumber} (واقف)`,
      date: when, odometerKm: odometerKm ?? null,
      // The tire note recording that it moved with the trailer is always written (the real reason). The user's reason is appended, not substituted, otherwise the tire would look like it moved by itself.
      reason: [`مشيت مع التيدر ${trailer.trailerNumber}`, reason].filter(Boolean).join(' — '),
    });
  }
  return tires.length;
}

/** Puts the trailer on a plate (or takes it off) and updates the flatbed, without tire events. */
async function seatTrailer(trailer, plate, key) {
  trailer.set({
    currentPlate: plate || null,
    currentPlateKey: key || null,
    status: plate ? 'active' : 'spare',
  });
  await trailer.save();
  if (key) await Ls2Flatbed.updateOne({ plateKey: key }, { currentTrailerNumber: trailer.trailerNumber });
}

exports.moveTrailer = async (req, res) => {
  try {
    const trailer = await Ls2Trailer.findById(req.params.id);
    if (!trailer) return res.status(404).json({ message: 'Not found' });
    const { toPlate = null, reason = '', notes = '', date, displacedTo = 'standing' } = req.body;
    const when = date ? new Date(date) : new Date();
    const from = { plate: trailer.currentPlate, key: trailer.currentPlateKey };
    const toKey = toPlate ? plateKey(toPlate) : null;

    if (toKey && toKey === from.key) {
      return res.status(400).json({ message: 'التيدر مركّب على العربية دي أصلًا' });
    }

    // Check the target truck exists; without it the trailer gets attached to a plate with no flatbed record (this happened with trailer 27 moved to a nonexistent flatbed).
    if (toKey && !(await Ls2Flatbed.findOne({ plateKey: toKey }))) {
      return res.status(400).json({ message: `مفيش سطحة باللوحة «${toPlate}»` });
    }

    const occupant = toKey
      ? await Ls2Trailer.findOne({ currentPlateKey: toKey, _id: { $ne: trailer._id } })
      : null;

    if (occupant && !['standing', 'swap'].includes(displacedTo)) {
      return res.status(400).json({
        code: 'DISPLACED_TRAILER_FATE_REQUIRED',
        message: `العربية عليها التيدر ${occupant.trailerNumber} — حدد يروح فين: يقف لوحده، ولا ياخد مكان التيدر ده؟`,
        occupant: { _id: occupant._id, trailerNumber: occupant.trailerNumber },
      });
    }
    if (occupant && displacedTo === 'swap' && !from.key) {
      return res.status(400).json({
        message: `التبديل محتاج التيدر ${trailer.trailerNumber} يكون على عربية — هو واقف لوحده، فاختر إن ${occupant.trailerNumber} يقف لوحده`,
      });
    }

    const live = toKey ? await vehicleByKey(toKey) : null;
    let moved = 0; let occupantMoved = 0;
    const ownTires = await trailerTires(trailer);
    const occupantTires = occupant ? await trailerTires(occupant) : [];
    const occDest = occupant && displacedTo === 'swap' ? { plate: from.plate, key: from.key } : { plate: null, key: null };

    // Refuse before anything moves: a tire that stays behind would end up
    // sharing a slot with the one arriving.
    const leaving = [...ownTires, ...occupantTires].map((t) => t._id);
    const heldTo = await slotHolders(toKey, ownTires.map((t) => t.positionNumber), leaving);
    const heldFrom = await slotHolders(occDest.key, occupantTires.map((t) => t.positionNumber), leaving);
    if (heldTo.length || heldFrom.length) {
      return res.status(409).json({
        code: 'SLOT_OCCUPIED',
        message: slotClashMessage(heldTo.length ? toPlate : occDest.plate, heldTo.length ? heldTo : heldFrom),
      });
    }

    // Step 1: empty the old truck of this trailer.
    if (from.key) await Ls2Flatbed.updateOne({ plateKey: from.key }, { currentTrailerNumber: null });

    // Step 2: the trailer on the receiving truck goes to its explicit destination, with its tires.
    if (occupant) {
      const dest = occDest;
      await seatTrailer(occupant, dest.plate, dest.key);
      await logEvent(req, {
        entityType: 'trailer', refId: occupant._id, label: occupant.trailerNumber,
        action: dest.key ? 'transferred' : 'removed',
        fromPlate: toPlate, fromPlateKey: toKey,
        toPlate: dest.plate, toPlateKey: dest.key, date: when,
        reason: reason || (dest.key
          ? `تبديل مع التيدر ${trailer.trailerNumber}`
          : `نزل ووقف لوحده لتركيب التيدر ${trailer.trailerNumber} مكانه`),
      });
    }

    // Step 3: the trailer itself.
    await seatTrailer(trailer, toPlate, toKey);
    await logEvent(req, {
      entityType: 'trailer', refId: trailer._id, label: trailer.trailerNumber,
      action: toKey ? (from.key ? 'transferred' : 'mounted') : 'removed',
      fromPlate: from.plate, fromPlateKey: from.key,
      toPlate: toPlate || null, toPlateKey: toKey, date: when,
      odometerKm: live?.odometerKm ?? null, reason, notes,
    });

    // Step 4: tires, after every trailer has settled, each tire with its trailer. In a swap each set lands on slots the other still holds.
    const unpark = await parkTires(occupant && occDest.key ? ownTires.filter((t) => String(t.plateKey || '') !== String(toKey || '')) : []);
    try {
      if (occupant) {
        const occLive = occDest.key ? await vehicleByKey(occDest.key) : null;
        occupantMoved = await carryTrailerTires(req, occupant, occupantTires, occDest.plate, occDest.key, when,
          occLive?.odometerKm, reason || `مشيت مع التيدر ${occupant.trailerNumber}`);
      }
      moved = await carryTrailerTires(req, trailer, ownTires, toPlate, toKey, when, live?.odometerKm, reason);
    } catch (err) {
      await unpark();
      throw err;
    }

    // The trailer moved, so its number on both trucks' tires follows; see services/ls2TireTrailers.
    await require('../services/ls2TireTrailers').resyncTireTrailers();
    await clearSensorNotice(from.key, toKey);
    emitAssetsChanged();
    res.json({
      trailer,
      tiresMoved: moved,
      displaced: occupant ? { trailerNumber: occupant.trailerNumber, to: displacedTo, tiresMoved: occupantMoved } : null,
    });
  } catch (e) {
    sendTireError(res, e);
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
    // Its vehicle in the vehicle register follows from its truck (services/ls2VehicleLink).
    await require('../services/ls2VehicleLink').linkLs2Fleet().catch(() => {});
    await logEvent(req, { entityType: 'flatbed', refId: flatbed._id, label: flatbed.plate, action: 'registered' });
    res.status(201).json({ flatbed });
  } catch (e) {
    sendMongooseError(res, e, e.message);
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
    sendMongooseError(res, e, e.message);
  }
};

// ---- History ---------------------------------------------------------------
const ACTION_STATE = { mounted: 'mounted', transferred: 'mounted', scrapped: 'scrap', retired: 'scrap', damaged: 'damaged', sold: 'sold', to_repair: 'under_renewal' };
const SHELF_ACTIONS = new Set(['removed', 'to_store', 'from_repair', 'renewed', 'registered']);

// Rows logged before the snapshot existed: the action says where the tire went,
// and the shelf grade is read from the tire.
function pastState(e, tire) {
  if (e.stateAfter) return e.stateAfter;
  if (e.action === 'to_repair' && /at_factory\s*$/.test(String(e.notes).split('·')[0].trim())) return 'at_factory';
  if (ACTION_STATE[e.action]) return ACTION_STATE[e.action];
  if (!tire) return '';
  if (SHELF_ACTIONS.has(e.action)) return tire.condition === 'new' ? 'new' : 'used';
  return tireState(tire);
}

function pastPercent(e, tire) {
  if (e.stateAfter) return e.percentAfter ?? null;   // snapshot row: blank means none was recorded yet
  const noted = String(e.notes || '').match(/الحالة\s*(\d+)%/);
  return noted ? Number(noted[1]) : (tire?.conditionPercent ?? null);
}

async function withTireDetails(events) {
  const ids = [...new Set(events.filter((e) => e.entityType === 'tire').map((e) => String(e.refId)))];
  const tires = await Ls2TireAsset.find({ _id: { $in: ids } }).select('tireNumber type size sensor status condition conditionPercent').lean();
  const byId = new Map(tires.map((t) => [String(t._id), t]));
  return events.map((e) => {
    if (e.entityType !== 'tire') return e;
    const tire = byId.get(String(e.refId));
    const key = pastState(e, tire);
    const st = TIRE_STATES.find((x) => x.key === key);
    return {
      ...e, tireNumber: tire?.tireNumber || '', tireType: tire?.type || '', tireSize: tire?.size || '', tireSensor: tire?.sensor || '',
      stateAfter: key, stateAfterAr: st?.ar || '', stateAfterEn: st?.en || '', percentAfter: pastPercent(e, tire),
    };
  });
}

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
    const events = await Ls2AssetEvent.find(q).sort({ date: -1 }).limit(Math.min(Number(limit) || 300, 20000)).lean();
    res.json({ events: await withTireDetails(events) });
  } catch (e) {
    sendMongooseError(res, e, e.message);
  }
};

// ---- Sensor check ----
// GET /assets/sensor-check - registered sensor flags vs what Wialon actually reports, per vehicle. Wialon's axle/tire numbering does not map 1:1 onto the workshop's 14-position scheme, so COUNTS are compared and both layouts shown, enough to spot registered-but-silent sensors and the reverse.
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
    sendMongooseError(res, e, e.message);
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
    const summary = { flatbeds: 0, trailers: 0, tiresNew: 0, tiresMoved: 0, tiresUnchanged: 0, slotConflicts: [] };

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
      // Tires. A slot held by a tire this sheet also lists is free: that tire moves too.
      const listed = (v.tires || []).map((t) => String(t.serial || '').trim()).filter(Boolean);
      const claimed = new Map();
      // A sheet may rotate tires on the truck; those give up their slots first.
      const sheetPos = new Map((v.tires || []).map((t) => [String(t.serial || '').trim(), t.position_number ?? null]));
      const rotating = (await Ls2TireAsset.find({ status: 'mounted', plateKey: key, serial: { $in: listed } }))
        .filter((t) => Number(sheetPos.get(t.serial)) !== t.positionNumber);
      const unparkSheet = await parkTires(rotating);
      for (const t of v.tires || []) {
        const serial = String(t.serial || '').trim();
        if (!serial) continue;
        const pos = t.position_number ?? null;
        const holder = pos != null
          ? (await Ls2TireAsset.findOne({ status: 'mounted', plateKey: key, positionNumber: pos, serial: { $nin: listed } }).select('serial').lean())?.serial
            || (claimed.has(Number(pos)) && claimed.get(Number(pos)) !== serial ? claimed.get(Number(pos)) : null)
          : null;
        if (holder) {
          summary.slotConflicts.push({ plate, serial, positionNumber: pos, heldBy: holder });
          continue;
        }
        if (pos != null) claimed.set(Number(pos), serial);
        const sensor = t.sensor === 'يوجد' ? 'yes' : t.sensor === 'لايوجد' || t.sensor === 'لا يوجد' ? 'no' : 'unknown';
        // The spare is an independent feature: inferred from the section (spare) or an explicit flag on the row.
        const isSpare = /استبن/.test(String(t.section || '')) || t.is_spare === true;
        const fields = {
          tireNumber: String(t.tire_number ?? ''), type: t.type || '', sensor,
          status: 'mounted', plate, plateKey: key,
          positionNumber: t.position_number ?? null,
          positionLabel: t.position || '', section: t.section || '', isSpare,
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
          existing.set({ tireNumber: fields.tireNumber, type: fields.type, sensor: fields.sensor, positionLabel: fields.positionLabel, section: fields.section, isSpare: fields.isSpare });
          await existing.save();
          summary.tiresUnchanged++;
        }
      }
      await unparkSheet();   // rows skipped as slot conflicts keep their old slot
      // A fresh workshop sheet for this truck is exactly the review the
      // tire_sensor_change notice was waiting for.
      await clearSensorNotice(key);
    }
    await require('../services/ls2TireTrailers').resyncTireTrailers();
    res.json({ ok: true, summary });
  } catch (e) {
    sendTireError(res, e);
  }
};

// GET /assets/tires/:id/profile - a tire's whole life.
// The question is how long it lived, on what, and how far it ran, not where it is now. Mount periods are built from the movement log: each `mounted` opens a period and the first exit after it closes it. Distance = truck odometer at removal minus at mounting, read from the daily odometer table because an event may be recorded a day late and carry a stale reading. Maintenance and repairs on the truck while the tire was on it are attributed to the tire, by intersecting dates with periods.
exports.getTireProfile = async (req, res) => {
  try {
    const tire = await Ls2TireAsset.findById(req.params.id).lean();
    if (!tire) return res.status(404).json({ message: 'الفردة غير موجودة' });

    const Ls2OdometerDaily = require('../models/Ls2OdometerDaily');
    const Ls2Repair = require('../models/Ls2Repair');
    const Ls2ServiceLog = require('../models/Ls2ServiceLog');

    const events = await Ls2AssetEvent.find({ entityType: 'tire', refId: tire._id })
      .sort({ date: 1 }).limit(2000).lean();

    // Periods: from mounting to removal.
    const MOUNTS = new Set(['mounted', 'transferred']);
    const stints = [];
    let open = null;
    for (const e of events) {
      const landed = e.toPlate || e.toPlateKey;
      if (MOUNTS.has(e.action) && landed) {
        if (open) { open.to = e.date; open.endReason = 'transferred'; stints.push(open); }
        open = {
          plate: e.toPlate, plateKey: e.toPlateKey, position: e.toPosition || '',
          // The trailer number is taken from the position text when mounted on a trailer: the tire travels with the trailer, not the truck, and without it its real location is unknown.
          trailerNumber: (String(e.toPosition || '').match(/تيدر\s*([\w-]+)/) || [])[1] || null,
          from: e.date, to: null, endReason: null,
          odoStart: e.odometerKm ?? null, odoEnd: null, by: e.performedByName || '',
        };
        continue;
      }
      if (open && ['removed', 'to_repair', 'scrapped', 'damaged', 'sold', 'retired'].includes(e.action)) {
        open.to = e.date; open.endReason = e.action; open.odoEnd = e.odometerKm ?? null;
        stints.push(open); open = null;
      }
    }
    // An open period means the tire is mounted now.
    if (open) stints.push(open);
    // Tires mounted before the system existed: the log starts when the system did, so such a tire has no mount event and would show an empty profile. An open, flagged period starts at the day it entered the system (the true mounting day is unknown) and gets no kilometers, since the truck odometer on mounting day is unknown and a difference from an unknown reading invents a number. Later mounts or replacements open real periods with known odometers at both ends.
    if (!stints.length && tire.status === 'mounted' && (tire.plate || tire.trailerNumber)) {
      stints.push({
        plate: tire.plate, plateKey: tire.plateKey, position: tire.positionLabel || '',
        trailerNumber: tire.trailerNumber || null,
        from: tire.createdAt, to: null, endReason: null, odoStart: null, odoEnd: null, by: '',
        preSystem: true,
      });
    }

    // Odometer: read from the daily table for each plate across the periods.
    const dayKey = (d) => (d ? new Date(d).toISOString().slice(0, 10) : null);
    const plates = [...new Set(stints.map((s) => s.plateKey).filter(Boolean))];
    const units = plates.length
      ? await Ls2Vehicle.find({ $or: [{ plateKey: { $in: plates } }, {}] }).select('plate plateKey unitId odometerKm driver').lean()
      : [];
    const unitByKey = new Map();
    for (const u of units) { const k = u.plateKey || plateKey(u.plate); if (k) unitByKey.set(k, u); }

    const odoDays = new Set();
    for (const s of stints) { const a = dayKey(s.from); const b = dayKey(s.to) || dayKey(new Date()); if (a) odoDays.add(a); if (b) odoDays.add(b); }
    const unitIds = [...new Set(stints.map((s) => unitByKey.get(s.plateKey)?.unitId).filter((x) => x != null))];
    const odoRows = unitIds.length
      ? await Ls2OdometerDaily.find({ unitId: { $in: unitIds }, date: { $in: [...odoDays] } }).select('unitId date odometerKm').lean()
      : [];
    const odoAt = new Map(odoRows.map((r) => [`${r.unitId}|${r.date}`, r.odometerKm]));

    // A trailer is pulled by a truck: its tires travel with the trailer, so the truck plate is empty for them. Saying only mounted on trailer 39 leaves the reader not knowing which truck pulls it today, so the truck is read from the trailer record and shown with it.
    const Ls2Trailer = require('../models/Ls2Trailer');
    const trailerNos = [...new Set([tire.trailerNumber, ...stints.map((x) => x.trailerNumber)].filter(Boolean))];
    const trailers = trailerNos.length
      ? await Ls2Trailer.find({ trailerNumber: { $in: trailerNos } }).select('trailerNumber currentPlate currentPlateKey').lean()
      : [];
    const trailerBy = new Map(trailers.map((x) => [String(x.trailerNumber), x]));
    const currentTrailer = tire.trailerNumber ? trailerBy.get(String(tire.trailerNumber)) || null : null;

    const now = new Date();
    for (const s of stints) {
      const u = unitByKey.get(s.plateKey);
      const uid = u?.unitId;
      if (uid != null && !s.preSystem) {
        s.odoStart = s.odoStart ?? odoAt.get(`${uid}|${dayKey(s.from)}`) ?? null;
        s.odoEnd = s.to
          ? (s.odoEnd ?? odoAt.get(`${uid}|${dayKey(s.to)}`) ?? null)
          : (u.odometerKm ?? null);
      }
      s.km = (!s.preSystem && s.odoStart != null && s.odoEnd != null && s.odoEnd >= s.odoStart)
        ? Math.round(s.odoEnd - s.odoStart) : null;
      const end = s.to ? new Date(s.to) : now;
      s.days = s.from ? Math.max(0, Math.round((end - new Date(s.from)) / 86400000)) : null;
      s.driver = u?.driver || '';
      s.current = !s.to;
    }

    // What happened to the truck and the tire on it.
    const inStint = (plate, date) => {
      if (!plate || !date) return null;
      const k = plateKey(plate); const t = new Date(date).getTime();
      return stints.find((s) => s.plateKey === k
        && t >= new Date(s.from).getTime()
        && t <= (s.to ? new Date(s.to).getTime() : now.getTime())) || null;
    };
    const plateRx = plates.length ? null : null;
    const [repairs, services] = await Promise.all([
      Ls2Repair.find({}).sort({ date: -1 }).limit(3000).select('plate title description category status cost date odometerKm performedByName').lean(),
      Ls2ServiceLog.find({}).sort({ createdAt: -1 }).limit(3000).select('plate items note byName odometerKm createdAt serviceDate intervalName').lean(),
    ]);
    const whileOn = [];
    for (const r of repairs) {
      const st = inStint(r.plate, r.date || r.createdAt);
      if (!st) continue;
      whileOn.push({ kind: 'repair', date: r.date || r.createdAt, plate: r.plate, title: r.title || 'إصلاح',
        detail: [r.category, r.description].filter(Boolean).join(' · '), cost: r.cost ?? null, by: r.performedByName || '' });
    }
    for (const sv of services) {
      const st = inStint(sv.plate, sv.serviceDate || sv.createdAt);
      if (!st) continue;
      whileOn.push({ kind: 'service', date: sv.serviceDate || sv.createdAt, plate: sv.plate,
        title: sv.intervalName || 'صيانة',
        detail: (sv.items || []).filter((x) => x.status === 'done').map((x) => x.labelAr || x.label).slice(0, 6).join(' · '),
        by: sv.byName || '' });
    }
    whileOn.sort((a, b) => new Date(b.date) - new Date(a.date));

    const realStints = stints.filter((s) => !s.preSystem);
    const totals = {
      preSystem: stints.some((s) => s.preSystem),
      stints: stints.length,
      vehicles: new Set(stints.map((s) => s.plateKey).filter(Boolean)).size,
      // Kilometers come only from periods with both odometers known; no distance is invented for a tire mounted before the system, whose truck odometer that day is unknown.
      km: realStints.reduce((a, s) => a + (s.km || 0), 0),
      days: stints.reduce((a, s) => a + (s.days || 0), 0),
      mountedDays: stints.filter((s) => s.current).reduce((a, s) => a + (s.days || 0), 0),
      repairs: whileOn.filter((x) => x.kind === 'repair').length,
      services: whileOn.filter((x) => x.kind === 'service').length,
      // Tire age counts from its first trace: registration or first mounting.
      ageDays: Math.max(0, Math.round((now - new Date(events[0]?.date || tire.createdAt)) / 86400000)),
    };

    // Unit id per plate: the truck page is `/system/ls2/<unitId>`. Links used to open a nonexistent `/system/ls2/vehicles?q=<plate>` page, which showed no data and made the truck look unregistered.
    await vehicleByKey('');
    const unitOf = (key) => (key ? vehicleKeyCache.map.get(key)?.unitId ?? null : null);
    res.json({
      tire: {
        ...tire,
        unitId: unitOf(tire.plateKey),
        trailerOnUnitId: unitOf(currentTrailer?.currentPlateKey),
        state: tireState(tire),
        // The truck currently pulling the trailer, shown with its current location.
        trailerOnPlate: currentTrailer?.currentPlate || null,
      },
      stints: stints.slice().reverse().map((s) => ({
        ...s,
        unitId: unitOf(s.plateKey),
        trailerOnPlate: s.trailerNumber ? (trailerBy.get(String(s.trailerNumber))?.currentPlate || null) : null,
      })),                                    // Newest first.
      events: events.slice().reverse(),
      whileOn: whileOn.slice(0, 300),
      totals,
    });
  } catch (e) {
    console.error('tire profile', e);
    sendMongooseError(res, e, e.message);
  }
};
exports._planReplacementChain = planReplacementChain;
