/**
 * طلباتُ الأسطول إلى الصيانة — الطلبُ من الأسطول، والقرارُ من لوكيشن سوليوشن.
 *
 * شاشتان لجدولٍ واحد: «طلباتي» في إدارة الأسطول، و«طلبات الأسطول» في لوكيشن
 * سوليوشن. والقرارُ لا يُؤخَذ إلّا من الثانية — من يملك الصيانةَ هو من يأذن
 * بتأجيلها. راجع models/FleetRequest.
 */
const mongoose = require('mongoose');
const FleetRequest = require('../models/FleetRequest');
const { FleetVehicle, FleetShipment } = require('../models/FleetModels');
const Ls2Vehicle = require('../models/Ls2Vehicle');
const { plateKey, vehiclePlateKey } = require('../utils/plateKey');
const { createNotification } = require('../services/notificationService');
const { emitToAll } = require('../websocket/socketManager');
const logAudit = require('../utils/auditLogger');
const cache = require('../utils/ttlCache');

// والإبطالُ قبل الإعلان: الحدثُ يوقظ الشاشاتَ لتُعيد الجلب، فإن أُعلن أوّلًا
// قرأت مخزونًا لم يُمسَح — راجع ذاكرةَ «announce before invalidate».
const emit = (event, payload = {}) => {
  cache.clear('fleet:');
  try { emitToAll(event, payload); } catch (e) { /* السوكت ليس شرطًا */ }
};

const fullName = (u) => [u?.firstName, u?.lastName].filter(Boolean).join(' ').trim() || u?.username || '';

/** حالةُ صيانة شاحنةٍ من مرآة لوكيشن — باللوحة، فالسجلّان منفصلان. */
async function maintenanceOf(vehicleId) {
  if (!vehicleId || !mongoose.isValidObjectId(String(vehicleId))) return null;
  const v = await FleetVehicle.findById(vehicleId).select('plate name').lean();
  if (!v) return null;
  const key = plateKey(v.plate);
  if (!key) return { vehicle: v, live: null };
  // المرآةُ تُفهرَس باللوحة كما تكتبها هي — فتُقرأ كلُّها وتُطابَق بالمفتاح.
  const rows = await Ls2Vehicle.find({}).select('plate maintenanceStatus kmToService nextServiceName odometerKm').lean();
  const live = rows.find((lv) => vehiclePlateKey(lv) === key) || null;
  return { vehicle: v, live };
}

/**
 * ── الحارسُ: شاحنةٌ فات موعدُ صيانتها لا تُحمَّل بلا إذن ─────────────────────
 *
 * يُنادى من إنشاء الحمولة وتعديلِ شاحنتها. ويردّ:
 *   • `null` — لا مانع (الحالةُ سليمةٌ أو قريبةٌ، أو لا مرآةَ للشاحنة).
 *   • `{ block }` — ممنوعٌ، ومعه ما فات ورقمُ الطلب المعلّق إن كان.
 *   • `{ approval }` — مسموحٌ بموافقةٍ قائمة، تُستهلَك بعد إنشاء الحمولة.
 */
async function maintenanceGate(vehicleId) {
  const m = await maintenanceOf(vehicleId);
  if (!m || !m.live) return null;
  if (m.live.maintenanceStatus !== 'overdue') return null;

  const approval = await FleetRequest.findOne({
    vehicle: vehicleId, kind: 'maintenance_override', status: 'approved', usedBy: null,
  }).sort({ decidedAt: -1 });
  if (approval) return { approval, live: m.live, vehicle: m.vehicle };

  const pending = await FleetRequest.findOne({
    vehicle: vehicleId, kind: 'maintenance_override', status: 'pending',
  }).select('_id createdAt requestedByName').lean();

  const km = m.live.kmToService;
  const service = m.live.nextServiceName || 'صيانة دوريّة';
  return {
    block: {
      needsMaintenanceApproval: true,
      vehicle: String(vehicleId),
      plate: m.vehicle.plate,
      service,
      kmOverdue: km != null ? Math.abs(km) : null,
      odometerKm: m.live.odometerKm ?? null,
      pendingRequest: pending ? { _id: String(pending._id), at: pending.createdAt, by: pending.requestedByName } : null,
      message: `«${service}» متأخّرة على ${m.vehicle.plate}${km != null ? ` بـ${Math.abs(km).toLocaleString('en-US')} كم` : ''} — تحتاج موافقةَ مدير الصيانة قبل التحميل.`,
    },
  };
}

/** تُستهلَك الموافقةُ بالحمولة التي أُنشئت بها — لا تبقى مفتوحة. */
async function consumeApproval(approval, shipment) {
  if (!approval) return;
  approval.usedBy = shipment._id;
  approval.usedAt = new Date();
  await approval.save();
  cache.clear('fleetRequests');
  emit('fleet:requests', {});
}

/** POST /api/fleet/requests — الأسطولُ يطلب. */
exports.create = async (req, res) => {
  try {
    const { vehicle, reason } = req.body || {};
    if (!vehicle || !mongoose.isValidObjectId(String(vehicle))) {
      return res.status(400).json({ message: 'اختر الشاحنة' });
    }
    const m = await maintenanceOf(vehicle);
    if (!m) return res.status(404).json({ message: 'الشاحنة غير موجودة' });
    if (!m.live || m.live.maintenanceStatus !== 'overdue') {
      // لا طلبَ لما لا يحتاج إذنًا — وإلّا امتلأ الجدولُ بطلباتٍ لا موضوعَ لها.
      return res.status(400).json({ message: 'صيانةُ هذه الشاحنة ليست متأخّرة — لا تحتاج موافقة' });
    }
    const open = await FleetRequest.findOne({ vehicle, kind: 'maintenance_override', status: 'pending' }).lean();
    if (open) {
      return res.status(409).json({ message: 'لها طلبٌ معلّقٌ بالفعل', request: open });
    }

    const doc = await FleetRequest.create({
      vehicle,
      plate: m.vehicle.plate,
      service: m.live.nextServiceName || '',
      kmToService: m.live.kmToService ?? null,
      odometerKm: m.live.odometerKm ?? null,
      reason: String(reason || '').trim().slice(0, 600),
      load: {
        customerName: String(req.body?.load?.customerName || '').trim(),
        fromCity: String(req.body?.load?.fromCity || '').trim(),
        toCity: String(req.body?.load?.toCity || '').trim(),
        loadDate: String(req.body?.load?.loadDate || '').trim(),
      },
      requestedBy: req.user._id,
      requestedByName: fullName(req.user),
      status: 'pending',
    });

    emit('fleet:requests', { id: String(doc._id) });
    emit('ls2:updated', {});

    // ── ويصل مَن يقرّر، لا مَن يقرأ شاشة ──────────────────────────────────
    // القرارُ على مدير الصيانة وفريقِه. وإشعارٌ يصل من لا يقرّر يُدرَّب الناسُ
    // على تجاهله — راجع services/ls2Notify.
    try {
      const User = require('../models/User');
      const deciders = await User.find({
        isActive: { $ne: false },
        role: { $in: ['location_manager', 'location_staff', 'super_admin'] },
      }).select('_id').lean();
      await Promise.all(deciders.map((u) => createNotification({
        recipient: u._id,
        type: 'system_alert',
        title: `طلبُ تحميلٍ على شاحنةٍ صيانتُها متأخّرة — ${m.vehicle.plate}`,
        message: `${fullName(req.user)}: ${doc.reason || 'بلا سبب مكتوب'}${doc.service ? ` · ${doc.service}` : ''}`,
        relatedEntity: 'FleetRequest',
        relatedEntityId: doc._id,
        event: 'fleet:requests',
      }).catch(() => {})));
    } catch { /* الإشعارُ لا يُسقِط الطلب */ }

    await logAudit({
      user: req.user, action: 'create', entity: 'FleetRequest', entityId: doc._id,
      changes: { plate: doc.plate, service: doc.service, reason: doc.reason }, ipAddress: req.ip,
    });
    return res.status(201).json({ request: doc });
  } catch (error) {
    console.error('fleetRequest create', error);
    return res.status(500).json({ message: 'تعذّر إرسال الطلب' });
  }
};

/** GET — القائمةُ نفسُها للشاشتين، بفلترِ الحالة. */
exports.list = async (req, res) => {
  try {
    const filter = { kind: 'maintenance_override' };
    const status = String(req.query.status || '').trim();
    if (status && status !== 'all') filter.status = status;
    const rows = await FleetRequest.find(filter).sort({ createdAt: -1 }).limit(300).lean();

    // ولوحةُ الأرقام تُقاس على الجدول كلِّه لا على المعروض.
    const counts = await FleetRequest.aggregate([
      { $match: { kind: 'maintenance_override' } },
      { $group: { _id: '$status', n: { $sum: 1 } } },
    ]);
    const summary = { pending: 0, approved: 0, rejected: 0 };
    counts.forEach((c) => { summary[c._id] = c.n; });
    // الموافقاتُ التي لم تُستعمَل بعد: شاحناتٌ مفتوحةٌ لحمولةٍ واحدة.
    summary.openApprovals = await FleetRequest.countDocuments({
      kind: 'maintenance_override', status: 'approved', usedBy: null,
    });
    return res.json({ requests: rows, summary });
  } catch (error) {
    console.error('fleetRequest list', error);
    return res.status(500).json({ message: 'تعذّر تحميل الطلبات' });
  }
};

/** POST /:id/decide — { decision: approved|rejected, note } */
exports.decide = async (req, res) => {
  try {
    const decision = String(req.body?.decision || '');
    if (!['approved', 'rejected'].includes(decision)) {
      return res.status(400).json({ message: 'القرارُ موافقةٌ أو رفض' });
    }
    const doc = await FleetRequest.findById(req.params.id);
    if (!doc) return res.status(404).json({ message: 'الطلب غير موجود' });
    if (doc.status !== 'pending') {
      return res.status(400).json({ message: `سبق أن ${doc.status === 'approved' ? 'وُوفق عليه' : 'رُفض'} — ${doc.decidedByName || ''}` });
    }
    doc.status = decision;
    doc.decidedBy = req.user._id;
    doc.decidedByName = fullName(req.user);
    doc.decidedAt = new Date();
    doc.decisionNote = String(req.body?.note || '').trim().slice(0, 600);
    await doc.save();

    emit('fleet:requests', { id: String(doc._id) });
    emit('fleet:updated', {});

    if (doc.requestedBy) {
      await createNotification({
        recipient: doc.requestedBy,
        type: 'system_alert',
        title: decision === 'approved'
          ? `وُوفق على التحميل — ${doc.plate}`
          : `رُفض التحميل — ${doc.plate}`,
        message: `${doc.decidedByName}${doc.decisionNote ? `: ${doc.decisionNote}` : ''}`,
        relatedEntity: 'FleetRequest',
        relatedEntityId: doc._id,
        event: 'fleet:requests',
      }).catch(() => {});
    }

    await logAudit({
      user: req.user, action: 'update', entity: 'FleetRequest', entityId: doc._id,
      changes: { after: { status: decision, note: doc.decisionNote, plate: doc.plate } }, ipAddress: req.ip,
    });
    return res.json({ request: doc });
  } catch (error) {
    console.error('fleetRequest decide', error);
    return res.status(500).json({ message: 'تعذّر تسجيل القرار' });
  }
};

module.exports.maintenanceGate = maintenanceGate;
module.exports.consumeApproval = consumeApproval;
module.exports.maintenanceOf = maintenanceOf;
