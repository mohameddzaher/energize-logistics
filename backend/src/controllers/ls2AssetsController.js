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
const cache = require('../utils/ttlCache');
const tireSensors = require('../services/ls2TireSensors');

// Any asset mutation must reach the screens that mirror this registry live (the
// workshop store, fleet-assets, the vehicle profile). Coalesced so a bulk import
// broadcasts once, not once per row. Also drops the overview cache so the next
// load reflects the move immediately (no stale 15s window after a mutation).
let emitTimer = null;
function emitAssetsChanged() {
  cache.clear('ls2assets:');
  // عمود «الفرد اللي عليها سينسور» في شاشتَي الأسطول يقرأ مواضع هذا السجل.
  // بدون إسقاط ذاكرته يظلّ الفنيّ دقيقةً كاملة يرى تسجيله كأنه لم يحدث.
  tireSensors.clearLayoutCache();
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
// Cached 20s (cleared instantly on any asset mutation via emitAssetsChanged) so
// the throttled-Atlas triple-find (the tires set alone is ~260KB) runs once per
// window instead of on every page load — the page opens warm in ~2ms.
exports.getOverview = async (req, res) => {
  try {
    const body = await cache.wrap('ls2assets:overview', 20000, async () => {
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
          // خانةٌ لكلّ حالة، من التعريف الواحد — فلا تُكتب بطاقةٌ في الشاشة
          // ولا يجد الخادمُ رقمَها، ولا يُحسب رقمٌ لا بطاقةَ له.
          ...Object.fromEntries(TIRE_STATES.map((st) => [st.key, tires.filter((t) => tireState(t) === st.key).length])),
          // «في المخزن» مجموعُ ما هو عندنا وغيرُ مركَّب: الجديد والمستعمل وتحت
          // التجديد وفي المصنع والسكراب. والتالف والمباع خارجه — خرجا من العهدة.
          inStore: tires.filter((t) => TIRE_STATES.find((x) => x.key === tireState(t))?.inStore).length,
          notMounted: tires.filter((t) => tireState(t) !== 'mounted').length,
          withSensor: tires.filter((t) => t.sensor === 'yes').length,
        },
      };
    });
    res.json(body);
  } catch (e) {
    res.status(500).json({ message: e.message });
  }
};

// GET /assets/vehicle/:plate/history — كل حاجة حصلت للعربية دي، في خط زمني واحد.
//
// السؤال اللي بيرد عليه: «العربية دي عملت فيها إيه؟». الإجابة كانت متفرّقة على
// خمس مجموعات مختلفة — حركة الكاوتش في سجل الأصول، صادر مخزن LS2، صرف مخزن
// الورشة، الإصلاحات، والصيانة الدورية — وكل واحدة ليها شاشتها. اللي بيدوّر على
// «الكاوتش اتغيّر إمتى وإيه القطع اللي اتركبت بعده» كان بيفتح خمس شاشات ويرتّب
// بنفسه.
//
// الدمج هنا مش عرض تاني للبيانات: هو الترتيب الزمني نفسه. كل صف بيقول `kind`
// عشان الشاشة تعرف تفلتر (كاوتش / قطع غيار / إصلاح / صيانة)، والمصدر بيفضل
// مكتوب فـ اللي عايز يفتح الأصل يعرف يروح فين.
//
// الربط بالعربية: plateKey لسجل الأصول (المفتاح الموحّد)، والباقي بيتخزّن رقم
// اللوحة كنص حر زي ما الورشة بتكتبه — فبنطابق بالمفتاح المستخرج منه، مش
// بالنص، وإلا «5010» و«أ ص ر 5010» يبقوا عربيتين.
exports.getVehicleHistory = async (req, res) => {
  try {
    const key = plateKey(req.params.plate);
    if (!key) return res.status(400).json({ message: 'Bad plate' });

    const { Ls2StoreMovement } = require('../models/Ls2Store');
    const InventoryIssue = require('../models/InventoryIssue');
    const Ls2Repair = require('../models/Ls2Repair');
    const Ls2ServiceLog = require('../models/Ls2ServiceLog');

    const [tireEvents, storeOut, issues, repairs, services] = await Promise.all([
      // أكثرُ لوحةٍ عليها ثمانمئةٌ وثمانيةٌ وثلاثون حدثًا — تجاوزت الخمسمئة،
      // فكان سجلّ حركة إطاراتها يظهر ناقصًا وكأنّه كلُّ تاريخها.
      Ls2AssetEvent.find({ $or: [{ fromPlateKey: key }, { toPlateKey: key }] }).sort({ date: -1 }).limit(10000).lean(),
      Ls2StoreMovement.find({ vehiclePlate: { $nin: ['', null] } }).sort({ createdAt: -1 }).limit(3000).lean(),
      InventoryIssue.find({ vehicleNumber: { $nin: ['', null] } }).sort({ date: -1 }).limit(3000).lean(),
      Ls2Repair.find({ plate: { $nin: ['', null] } }).sort({ date: -1 }).limit(1000).lean(),
      Ls2ServiceLog.find({ plate: { $nin: ['', null] } }).sort({ date: -1 }).limit(1000).lean(),
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
        by: m.performedByName, notes: [m.reason, m.reversed ? 'اتّرجع عنها' : ''].filter(Boolean).join(' · '),
        reversed: !!m.reversed, source: 'ls2-store', refId: m._id,
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
//
// ما فيش قاعدة بتربط درجة الفردة بموضع التركيب. كان فيه واحدة: «المجدد يُركَّب
// على التيدر فقط»، وكانت بترفض أي فردة مجددة على أي موضع قسمه فيه «الرأس» —
// يعني الاتنين قدّام **والأربعة اللي ورا الرأس** كمان. الورشة بتركّب المجدد في
// الأربعة دول فعلًا، فالقاعدة كانت بتمنع شغل قايم بالفعل، والفنّي كان بيلفّها
// بإنه يسجّل الفردة «مستعملة». التحقق الوحيد الباقي هو التحقق المادي: الحالة
// والموضع الفاضي — مش درجة الفردة.

exports.createTire = async (req, res) => {
  try {
    const { serial, tireNumber = '', type = '', size = '', sensor = 'unknown', condition, plate = null, positionNumber = null, positionLabel = '', section = '', notes = '', isSpare = false } = req.body;
    if (!serial || !String(serial).trim()) return res.status(400).json({ message: 'Serial required' });
    const exists = await Ls2TireAsset.findOne({ serial: String(serial).trim() });
    if (exists) return res.status(409).json({ message: 'Serial already registered', tire: exists });
    const key = plate ? plateKey(plate) : null;
    // A freshly registered unmounted tire is what a purchase just delivered —
    // grade 'new' unless the workshop says otherwise; a tire registered already
    // on a truck is ordinary 'used'.
    const grade = ['new', 'used'].includes(condition) ? condition : (key ? 'used' : 'new');
    const tire = await Ls2TireAsset.create({
      serial: String(serial).trim(), tireNumber, type, size, sensor, notes,
      condition: grade,
      status: key ? 'mounted' : 'spare',
      plate: key ? plate : null, plateKey: key,
      positionNumber: key ? positionNumber : null,
      positionLabel: key ? positionLabel : '', section: key ? section : '',
      isSpare: key ? !!isSpare : false, // الاستبن لا يُوسم إلا وهو مركّب على العربية
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
    const allowed = ['tireNumber', 'type', 'size', 'sensor', 'notes', 'serial', 'positionLabel', 'isSpare'];
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
// `displacedTo` — where the removed tire goes: 'repair' (في المصنع),
// 'damaged' (تالف), 'scrap' (سكراب) or 'store' (سليمة، رجعت للمخزن).
//
// `replacementTireId` closes the OTHER half of a swap in the same operation:
// a spare tire from the store mounts into the slot THIS tire just vacated —
// whether it went down to the shelf/scrap or transferred to another truck.
// الوجهات تُقرأ من تعريفٍ واحد يشترك فيه الخادم والشاشة والجوّال — راجع
// config/tireStates.js. وكانت أربعًا: «سليمة/مخزن» واحدةً لا يُعرف منها أنزلت
// الفردة جديدةً أم مستعملة، و«في المصنع» و«تحت التجديد» شيئًا واحدًا.
const { DISMOUNT_DESTINATIONS, STATUS_ACTION: TIRE_STATUS_ACTION, tireState, TIRE_STATES } = require('../config/tireStates');
const DEST = Object.fromEntries(DISMOUNT_DESTINATIONS.map((d) => [d.key, d]));
// أسماءٌ قديمة تصل من نسخٍ لم تُحدَّث بعد — تُقبل ولا تُكسر.
const DEST_ALIAS = { store: 'used', repair: 'under_renewal' };
const destOf = (key) => DEST[DEST_ALIAS[key] || key] || null;

/**
 * الدرجة صارت وصفًا للفردة لا لمكانها، فلا تتبع الحالة.
 *
 * كانت «في المصنع» درجةً وحالةً معًا: تُعَدّ الخانة بالدرجة وتُغيَّر بالحالة،
 * فإن افترقتا بقيت الفردة معدودةً عند المصنع وهي على الرفّ. والمكان كلُّه في
 * `status` الآن، فتبقى الدرجة كما هي إلّا أن تُذكر صراحةً.
 */
function gradeForStatus(tire, status, explicit) {
  if (explicit === 'new' || explicit === 'used') return explicit;
  // الموروثة `at_factory` لم تعد درجةً صالحة — تُقرأ مستعملةً.
  return tire.condition === 'new' ? 'new' : 'used';
}

// Mount a spare tire into a specific (now empty) slot. Shared by the move and
// swap paths; throws with a user-facing Arabic message on rule violations.
async function mountSpareTire(req, tireId, slot, when, reason) {
  const r = await Ls2TireAsset.findById(tireId);
  if (!r) throw new Error('الفردة البديلة غير موجودة');
  // The replacement may come from the store (spare) OR be pulled off ANOTHER
  // truck (a swap) — the workshop usually has zero spares, so a mounted tire is
  // the common case. Only out-of-service tires (في المصنع/تالفة/سكراب/خارج
  // الخدمة) are rejected.
  if (!['spare', 'mounted'].includes(r.status)) {
    throw new Error(`الفردة البديلة ${r.serial} ليست متاحة للتركيب — حالتها الحالية لا تسمح بذلك`);
  }
  // نسمح بالتركيب من نفس المركبة (مثل: تبديل مع الاستبن على نفس العربية) طالما
  // ليست نفس الموضع تمامًا.
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
    isSpare: !!slot.isSpare, // ترث الفردة كونها استبن من الموقع الذي تُركَّب فيه
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

    // ── قاعدة الشغل: الموقع ما بيفضلش فاضي ────────────────────────────────────
    // فردة ما بتنزلش من على عربية إلا لما حاجة تتركب مكانها أو تتبدّل بيها.
    // العربية بتمشي على ١٤ فردة؛ سلوت فاضي يا إما شغل ما اتسجّلش يا إما عربية
    // نزلت الطريق ناقصة. الاتنين لازم يبانوا وقت الحركة نفسها، مش في جرد بعد
    // شهر — ساعتها محدش فاكر الفردة راحت فين ولا مين نزّلها.
    //
    // مسموح من غير بديل في حالة واحدة بس: الاستبن. الاستبن مش موقع شغّال —
    // العربية بتمشي من غيره فعلاً، وأول ما يتركّب في مكان فردة فقعت، مكانه
    // بيفضل فاضي لحد ما يتشتري واحد جديد. منع ده كان هيمنع تسجيل الواقع.
    const spareSlot = vacated && (vacated.isSpare || /استبن/.test(String(vacated.section || '')));
    if (vacated && !toPlate && !replacementTireId && !spareSlot) {
      return res.status(400).json({
        code: 'REPLACEMENT_REQUIRED',
        message: `الموقع «${vacated.positionLabel || vacated.positionNumber}» على ${vacated.plate} `
          + 'لا يجوز أن يبقى فارغًا — اختر الفردة اللي هتتركب مكانها، أو اعمل تبديل مع فردة تانية.',
        vacating: {
          plate: vacated.plate, positionNumber: vacated.positionNumber,
          positionLabel: vacated.positionLabel, section: vacated.section,
        },
      });
    }

    const when = date ? new Date(date) : new Date();

    // ── التبديل المتبادل بين عربيتين ──────────────────────────────────────────
    // الفردة (X) على العربية A، والبديلة (Y) على العربية B: تنتقل Y إلى موقع X،
    // وتنتقل X إلى موقع Y — تبديل كامل في عملية واحدة. يُطلب بـ destination='swap'.
    if (destination === 'swap') {
      if (!vacated) return res.status(400).json({ message: 'التبديل يتطلب أن تكون الفردة مركّبة على سطحة أصلًا' });
      if (!replacementTireId) return res.status(400).json({ message: 'اختر الفردة التي ستُبدَّل معها من العربية الأخرى' });
      const y = await Ls2TireAsset.findById(replacementTireId);
      if (!y) return res.status(404).json({ message: 'الفردة البديلة غير موجودة' });
      if (String(y._id) === String(tire._id)) return res.status(400).json({ message: 'لا يمكن تبديل الفردة مع نفسها' });
      if (y.status !== 'mounted' || !y.plateKey) return res.status(400).json({ message: `الفردة ${y.serial} ليست مركّبة على عربية — التبديل يكون مع فردة مركّبة` });
      // نسمح بالتبديل على نفس العربية (تبديل الاستبن مع فردة على نفس المركبة) —
      // نمنع فقط لو كانتا في نفس الموضع تمامًا.
      if (y.plateKey === vacated.plateKey && y.positionNumber != null && vacated.positionNumber != null
          && String(y.positionNumber) === String(vacated.positionNumber)) {
        return res.status(400).json({ message: 'الفردتان في نفس الموضع — لا يمكن التبديل' });
      }
      const ySlot = { plate: y.plate, plateKey: y.plateKey, positionNumber: y.positionNumber, positionLabel: y.positionLabel, section: y.section };
      const yPos = posLabel(y);
      // وسم الاستبن يتبع الموقع: كل فردة ترث كونها استبن من الموقع الذي تنتقل إليه.
      const xWasSpare = tire.isSpare, yWasSpare = y.isSpare;
      const [liveA, liveB] = [await vehicleByKey(vacated.plateKey), await vehicleByKey(ySlot.plateKey)];
      // Y → موقع X (العربية A)
      y.set({ status: 'mounted', plate: vacated.plate, plateKey: vacated.plateKey, positionNumber: vacated.positionNumber, positionLabel: vacated.positionLabel, section: vacated.section, isSpare: xWasSpare });
      await y.save();
      // X → موقع Y (العربية B)
      tire.set({ status: 'mounted', plate: ySlot.plate, plateKey: ySlot.plateKey, positionNumber: ySlot.positionNumber, positionLabel: ySlot.positionLabel, section: ySlot.section, isSpare: yWasSpare });
      await tire.save();
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
            // الدرجة تتبع المصير: القاطن اللي راح المصنع لازم يبان في خانة «في
            // المصنع»، وإلا يفضل متعدّ على الرف وهو أصلاً برّه.
            condition: gradeForStatus(occupant, occStatus, occDest.condition),
            // سليمة للمخزن → نسجّل نسبة حالتها (يقرأها التسكين لاحقًا) تمامًا كالنزول العادي.
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
      // Off the truck — but "where to" matters: the renewal shop is not the
      // shelf, سكراب is stored-to-sell, and تالف is gone for good.
      const wasInRepair = ['in_repair', 'under_renewal', 'at_factory'].includes(tire.status);
      const dest = destOf(destination) || DEST.used;
      const toStatus = dest.status;
      tire.set({
        status: toStatus,
        condition: gradeForStatus(tire, toStatus, dest.condition),
        plate: null, plateKey: null, positionNumber: null, positionLabel: '', section: '',
        isSpare: false, // فردة خارج العربية ليست الاستبن

        // نسبة الحالة تُسجَّل عند النزول إلى المخزن — هي ما يقرأه التسكين لاحقًا.
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
    // النصف الثاني من التبديل: بديل يُركَّب في الموقع الذي أُخلي — من المخزن أو
    // مسحوب من عربية أخرى (يُنقل تلقائيًا). نلتقط موقع البديلة قبل تحريكها حتى
    // نتمكن من ملء مكانها بفردة ثالثة.
    let replacement = null;
    let backfillSlot = null; // موقع البديلة على عربيتها (يُملأ بالفردة الثالثة)
    if (replacementTireId && vacated) {
      const yPeek = await Ls2TireAsset.findById(replacementTireId).lean();
      if (yPeek && yPeek.status === 'mounted' && yPeek.plateKey) {
        backfillSlot = { plate: yPeek.plate, plateKey: yPeek.plateKey, positionNumber: yPeek.positionNumber, positionLabel: yPeek.positionLabel, section: yPeek.section, isSpare: yPeek.isSpare };
      }
      try {
        replacement = await mountSpareTire(req, replacementTireId, vacated, when, reason);
      } catch (err) {
        // الفردة الأساسية تحركت بنجاح — بلّغ عن البديل فقط بدل إفشال كل العملية.
        return res.status(400).json({ message: err.message, tire, partial: true });
      }
    }
    // النصف الثالث (اختياري ومرن): فردة تملأ مكان البديلة على عربيتها — من المخزن
    // أو من عربية ثالثة. للحالات الكثيرة في الورشة (سلسلة تبديل).
    let secondReplacement = null;
    if (secondReplacementTireId && backfillSlot) {
      if ([String(tire._id), String(replacementTireId)].includes(String(secondReplacementTireId))) {
        return res.status(400).json({ message: 'الفردة التي تملأ المكان يجب أن تكون مختلفة عن الفردتين السابقتين', tire, replacement, partial: true });
      }
      try {
        secondReplacement = await mountSpareTire(req, secondReplacementTireId, backfillSlot, when, reason);
      } catch (err) {
        return res.status(400).json({ message: err.message, tire, replacement, partial: true });
      }
    }
    await clearSensorNotice(from.key, toPlate ? plateKey(toPlate) : null);
    res.json({ tire, replacement, secondReplacement });
  } catch (e) {
    res.status(500).json({ message: e.message });
  }
};

// POST /assets/tires/:id/renewal-result — المخرج الوحيد من «في المصنع»:
// إما رجعت صالحة (⇐ الرف، مستعملة، تتركّب في أي موضع) أو لأ (سكراب يتباع).
exports.tireRenewalResult = async (req, res) => {
  try {
    const tire = await Ls2TireAsset.findById(req.params.id);
    if (!tire) return res.status(404).json({ message: 'Not found' });
    if (!['in_repair', 'under_renewal', 'at_factory'].includes(tire.status)) {
      return res.status(400).json({ message: 'الفردة ليست تحت التجديد ولا في المصنع' });
    }
    const { result, notes = '' } = req.body || {};
    if (!['renewed', 'scrap'].includes(result)) return res.status(400).json({ message: 'result must be renewed | scrap' });
    // في الحالتين الفردة سابت المصنع، فدرجتها ترجع طبيعية: نجح التجديد ⇐ رجعت
    // الرف مستعملة صالحة (تتركّب في أي موضع)، فشل ⇐ سكراب للبيع.
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
    res.status(500).json({ message: e.message });
  }
};

// POST /assets/tires/:id/retire — terminal states outside the renewal loop.
// kind: 'damaged' (تالف — لا وجود لها) | 'scrap' (سكراب للبيع) | default legacy 'retired'.
// الموقع ما بيفضلش فاضي: أي مسار بينزّل فردة من على عربية لازم يعدّي من هنا.
// الاستبن وحده مستثنى — العربية بتمشي من غيره فعلاً (شوف الشرح في /move).
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
    res.status(500).json({ message: e.message });
  }
};

// POST /assets/tires/:id/status — نقل الفردة بين الحالات مباشرة من المخزن:
// spare (سليمة/مخزن) / in_repair (تجديد) / scrap / damaged (تالف) / retired / sold.
// إن كانت مركّبة، تُفَك تلقائيًا من المركبة. body: { status, condition?,
// conditionPercent?, reason?, notes? }.
// من التعريف الواحد — راجع config/tireStates.js.
const STATUS_ACTION = TIRE_STATUS_ACTION;
exports.setTireStatus = async (req, res) => {
  try {
    const tire = await Ls2TireAsset.findById(req.params.id);
    if (!tire) return res.status(404).json({ message: 'Not found' });
    let { status } = req.body || {};
    // الشاشة ترسل الخانة كما يراها المستخدم («الجديد»/«المستعمل»)، والخانتان
    // حالةٌ واحدة (`spare`) ودرجتان. فتُترجَم هنا في نقطةٍ واحدة بدل أن تعرف
    // كلُّ شاشةٍ هذا التفصيل.
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
    const blocked = blockEmptySlot(tire, req.body?.replacementTireId);
    if (blocked) return res.status(400).json(blocked);
    const from = { plate: tire.plate, key: tire.plateKey, pos: posLabel(tire), status: tire.status };
    const set = { status, condition: gradeForStatus(tire, status, req.body.condition) };
    // «في المصنع» مش اختيار — بتتولد من الحالة. والدرجة ما تتغيّرش يدويًا والفردة
    // عند المصنع، وإلا خانة المخزن تعدّ فردة برّه على إنها على الرف.
    if (['new', 'used'].includes(req.body.condition)) set.condition = req.body.condition;
    if (req.body.conditionPercent != null && req.body.conditionPercent !== '') set.conditionPercent = Number(req.body.conditionPercent);
    // مغادرة حالة التركيب → فَكّ من المركبة والموضع.
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
// ── نقل التيدر ─────────────────────────────────────────────────────────────
// التيدر بيتنقل **بكاوتشه**. مش تفصيلة: الفردة اللي على التيدر بتمشي معاه فعليًا
// على الأرض، فلو السجل نقل التيدر وساب الكاوتش، العربية القديمة تفضل مسجّل عليها
// ١٤ إطار وفيهم ٦ مش عليها والجديدة ٨ — والاتنين غلط ومحدش واخد باله.
//
// والعربية بتشيل تيدر واحد. فلو التيدر الجديد رايح على عربية عليها تيدر، التيدر
// القديم **لازم يروح مكان محدّد** — نفس قاعدة الداخل ⇐ الخارج بتاعة الكاوتش:
//
//   displacedTo: 'standing'  التيدر القديم ينزل ويقف لوحده (بكاوتشه)
//   displacedTo: 'swap'      يروح العربية اللي التيدر الجديد سابها (تبديل كامل)
//
// وكل الحالات دي بتشتغل مع التيدرات الواقفة برضه: تجيب تيدر واقف وتركّبه، واللي
// كان مكانه يقف؛ أو تبدّل تيدرين بين عربيتين؛ أو تبدّل مركّب بواقف.
//
// body: { toPlate | null, displacedTo: 'standing'|'swap', reason, notes, date }

/** ينقل كاوتش تيدر معيّن للوحة جديدة (أو يفضّيها لو التيدر وقف)، ويسجّل كل فردة. */
async function carryTrailerTires(req, trailer, toPlate, toKey, when, odometerKm, reason) {
  const tires = await Ls2TireAsset.find({ trailerNumber: trailer.trailerNumber, status: 'mounted' });
  for (const ti of tires) {
    const from = { plate: ti.plate, key: ti.plateKey, pos: posLabel(ti) };
    if (String(from.key || '') === String(toKey || '')) continue;
    ti.set({ plate: toPlate || null, plateKey: toKey || null });
    await ti.save();
    await logEvent(req, {
      entityType: 'tire', refId: ti._id, label: ti.serial, action: 'transferred',
      fromPlate: from.plate, fromPlateKey: from.key, fromPosition: from.pos,
      toPlate: toPlate || null, toPlateKey: toKey || null,
      toPosition: toPlate ? posLabel(ti) : `تيدر ${trailer.trailerNumber} (واقف)`,
      date: when, odometerKm: odometerKm ?? null,
      // «مشيت مع التيدر» بيتكتب دايمًا: ده سبب الحركة الحقيقي. سبب المستخدم
      // بيتزوّد عليه، ما بيستبدلوش — وإلا الفردة تبان اتنقلت لوحدها.
      reason: [`مشيت مع التيدر ${trailer.trailerNumber}`, reason].filter(Boolean).join(' — '),
    });
  }
  return tires.length;
}

/** يحطّ التيدر على لوحة (أو ينزّله) ويحدّث السطحة، من غير أحداث الكاوتش. */
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

    // العربية اللي رايح لها موجودة؟ من غير الفحص ده التيدر بيتعلّق على لوحة
    // مالهاش سطحة — وده اللي حصل فعلاً مع تيدر ٢٧ لما اتنقل على سطحة وهمية.
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

    // ① نفضّي العربية القديمة من التيدر ده
    if (from.key) await Ls2Flatbed.updateOne({ plateKey: from.key }, { currentTrailerNumber: null });

    // ② التيدر اللي على العربية المستقبِلة يروح مكانه المحدّد — **بكاوتشه**
    if (occupant) {
      const dest = displacedTo === 'swap' ? { plate: from.plate, key: from.key } : { plate: null, key: null };
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
      const occLive = dest.key ? await vehicleByKey(dest.key) : null;
      occupantMoved = await carryTrailerTires(req, occupant, dest.plate, dest.key, when,
        occLive?.odometerKm, reason || `مشيت مع التيدر ${occupant.trailerNumber}`);
    }

    // ③ التيدر نفسه
    await seatTrailer(trailer, toPlate, toKey);
    await logEvent(req, {
      entityType: 'trailer', refId: trailer._id, label: trailer.trailerNumber,
      action: toKey ? (from.key ? 'transferred' : 'mounted') : 'removed',
      fromPlate: from.plate, fromPlateKey: from.key,
      toPlate: toPlate || null, toPlateKey: toKey, date: when,
      odometerKm: live?.odometerKm ?? null, reason, notes,
    });
    moved = await carryTrailerTires(req, trailer, toPlate, toKey, when, live?.odometerKm, reason);

    await clearSensorNotice(from.key, toKey);
    emitAssetsChanged();
    res.json({
      trailer,
      tiresMoved: moved,
      displaced: occupant ? { trailerNumber: occupant.trailerNumber, to: displacedTo, tiresMoved: occupantMoved } : null,
    });
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
        // الاستبن فيتشر مستقل: نستنتجه من القسم (الاستبن) أو علَم صريح في الصف.
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
      // A fresh workshop sheet for this truck is exactly the review the
      // tire_sensor_change notice was waiting for.
      await clearSensorNotice(key);
    }
    res.json({ ok: true, summary });
  } catch (e) {
    res.status(500).json({ message: e.message });
  }
};

// ── GET /assets/tires/:id/profile — حياةُ فردةٍ واحدة كاملةً ──────────────────
//
// السؤال الذي تجيب عنه هذه الشاشة ليس «أين الفردة الآن» — ذاك سطرٌ في الجدول —
// بل: **كم عاشت، وعلى ماذا، وكم مشت.** فردةٌ عمرها سنتان على أربع عربيات ليست
// كفردةٍ عمرها سنتان على واحدة، والفرق لا يُقرأ إلّا من السجلّ مجموعًا.
//
// وتُبنى «فترات التركيب» من سجلّ الحركة نفسه: كلُّ `mounted` تفتح فترة، وأوّلُ
// خروجٍ بعدها يُغلقها. والمسافة = عدّاد العربية عند النزول ناقص عدّادها عند
// التركيب — يُقرآن من جدول العدّاد اليوميّ لا من لحظة الحدث، لأنّ الحدث قد
// يُسجَّل بعد يومٍ من وقوعه فيحمل عدّادًا متأخّرًا.
//
// وما جرى للعربية **أثناء** وجود الفردة عليها يُنسب إلى الفردة: صيانةٌ في ذلك
// اليوم كانت الفردة تحتها، وإصلاحٌ كذلك. وهذا هو الفرق بين سجلّ فردةٍ وسجلّ
// عربية — ولا يُعرف إلّا بمقاطعة التواريخ مع الفترات.
exports.getTireProfile = async (req, res) => {
  try {
    const tire = await Ls2TireAsset.findById(req.params.id).lean();
    if (!tire) return res.status(404).json({ message: 'الفردة غير موجودة' });

    const Ls2OdometerDaily = require('../models/Ls2OdometerDaily');
    const Ls2Repair = require('../models/Ls2Repair');
    const Ls2ServiceLog = require('../models/Ls2ServiceLog');

    const events = await Ls2AssetEvent.find({ entityType: 'tire', refId: tire._id })
      .sort({ date: 1 }).limit(2000).lean();

    // ── الفترات: من ركوبٍ إلى نزول ──────────────────────────────────────────
    const MOUNTS = new Set(['mounted', 'transferred']);
    const stints = [];
    let open = null;
    for (const e of events) {
      const landed = e.toPlate || e.toPlateKey;
      if (MOUNTS.has(e.action) && landed) {
        if (open) { open.to = e.date; open.endReason = 'transferred'; stints.push(open); }
        open = {
          plate: e.toPlate, plateKey: e.toPlateKey, position: e.toPosition || '',
          // رقم التيدر يُلتقط من نصّ الموضع حين يكون التركيب على تيدر: الفردة
          // تمشي معه لا مع العربية، ومن دونه لا يُعرف أين كانت فعلًا.
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
    // فترةٌ مفتوحة = الفردة مركَّبة الآن.
    if (open) stints.push(open);
    // ── الفردة التي رُكّبت قبل النظام ─────────────────────────────────────
    // سجلُّ الحركة يبدأ يوم بدأ النظام. وفردةٌ كانت على العربية قبله لا حدثَ
    // لتركيبها، فلو تُركت بلا فترةٍ ظهر ملفُّها فارغًا وهي تعمل منذ سنة.
    //
    // فتُفتح لها فترةٌ مُعلَّمة: بدايتُها يوم دخلت النظام لا يوم رُكّبت — ذاك
    // لا يعرفه أحد — ولا تُحسب لها كيلومترات، لأنّ عدّاد العربية يوم التركيب
    // غير معروف. وحسابُ فرقٍ من عدّادٍ مجهول يخترع رقمًا لا سند له.
    //
    // وكلُّ ما يقع بعد اليوم يُحسب كاملًا: أوّلُ تركيبٍ أو استبدالٍ يفتح فترةً
    // حقيقيّة بعدّادٍ معروف من طرفيها.
    if (!stints.length && tire.status === 'mounted' && (tire.plate || tire.trailerNumber)) {
      stints.push({
        plate: tire.plate, plateKey: tire.plateKey, position: tire.positionLabel || '',
        trailerNumber: tire.trailerNumber || null,
        from: tire.createdAt, to: null, endReason: null, odoStart: null, odoEnd: null, by: '',
        preSystem: true,
      });
    }

    // ── العدّاد: يُقرأ من الجدول اليوميّ لكلّ لوحةٍ في الفترات ────────────────
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

    // ── التيدر يُجرّ بعربية ──────────────────────────────────────────────
    // فردةُ التيدر تمشي مع التيدر لا مع العربية، فلوحةُ العربية فارغةٌ عندها.
    // وقول «مركَّبة على تيدر ٣٩» وحدَه ناقص: مَن يقرأه لا يعرف أين هذا التيدر
    // ولا أيَّ عربيةٍ تجرّه اليوم. فتُقرأ العربيةُ من سجلّ التيدر وتُذكر معه.
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

    // ── ما جرى للعربية والفردة عليها ────────────────────────────────────────
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
      // الكيلومترات من الفترات التي يُعرف عدّاداها فقط — لا تُخترع مسافةٌ
      // لفردةٍ رُكّبت قبل النظام ولا يُعرف عدّاد عربيتها يومها.
      km: realStints.reduce((a, s) => a + (s.km || 0), 0),
      days: stints.reduce((a, s) => a + (s.days || 0), 0),
      mountedDays: stints.filter((s) => s.current).reduce((a, s) => a + (s.days || 0), 0),
      repairs: whileOn.filter((x) => x.kind === 'repair').length,
      services: whileOn.filter((x) => x.kind === 'service').length,
      // عمرُ الفردة من أوّل أثرٍ لها: التسجيل أو أوّل تركيب.
      ageDays: Math.max(0, Math.round((now - new Date(events[0]?.date || tire.createdAt)) / 86400000)),
    };

    res.json({
      tire: {
        ...tire,
        state: tireState(tire),
        // العربية التي تجرّ التيدر الآن — تُذكر مع «أين هي الآن».
        trailerOnPlate: currentTrailer?.currentPlate || null,
      },
      stints: stints.slice().reverse().map((s) => ({
        ...s,
        trailerOnPlate: s.trailerNumber ? (trailerBy.get(String(s.trailerNumber))?.currentPlate || null) : null,
      })),                                    // الأحدث أوّلًا
      events: events.slice().reverse(),
      whileOn: whileOn.slice(0, 300),
      totals,
    });
  } catch (e) {
    console.error('tire profile', e);
    res.status(500).json({ message: e.message });
  }
};
