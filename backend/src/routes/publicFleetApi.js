const express = require('express');
const router = express.Router();
const { requireApiKey } = require('../middleware/apiKey');
const Ls2Vehicle = require('../models/Ls2Vehicle');
const Ls2Alert = require('../models/Ls2Alert');
const Ls2TireAsset = require('../models/Ls2TireAsset');
const cache = require('../utils/ttlCache');

/**
 * واجهةُ قراءةٍ للأتمتة — الأسطول المباشر لأنظمةٍ خارجية.
 *
 * ── لماذا تقرأ من قاعدتنا لا من Wialon مباشرةً ─────────────────────────────
 * نبضُ القسم (jobs/ls2Poll) يسحب كلّ الوحدات من Wialon كلّ عشرين ثانية، يفكّ
 * قراءات الحسّاسات، ويحفظ لقطةً لكلّ مركبة. فالبيانات **عندنا أصلًا**: القراءةُ
 * من هنا أسرع، ولا تستهلك حصّتنا من مزوّد التتبّع مهما تكرّر النداء، وتحمل معها
 * ما أضفناه نحن (سجلّ الإطارات والحالة) وهو ما لا يعرفه المزوّد إطلاقًا.
 *
 * ── وحدُّها القراءة ────────────────────────────────────────────────────────
 * لا كتابةَ هنا بحال. الأتمتة تراقب وتُنبِّه؛ ومَن يملك أن يغيّر شيئًا في
 * النظام يدخل إليه كإنسانٍ بصلاحياته.
 *
 * المفتاح: ترويسة `x-api-key`. يُضبَط في `FLEET_API_KEY` على الخادم.
 */
router.use(requireApiKey('FLEET_API_KEY', 'واجهة الأسطول للأتمتة'));

/** عمرُ القراءة بالثواني — الأتمتة تحتاج أن تعرف هل ما تقرؤه حديثٌ أم بائت. */
const ageSec = (d) => (d ? Math.round((Date.now() - new Date(d).getTime()) / 1000) : null);

/**
 * شكلٌ واحد للمركبة في كل ردّ — وفيه **كلّ** ما تعرضه شاشة الأسطول المباشر.
 *
 * كان يُصدَّر بعضُه، فيضطرّ المستهلك إلى بناء شرطه على ما نُقص عنه: حالة
 * الصيانة، ومستوى التنبيه، والوقود المستهلك، وبيانات المركبة الثابتة. والواجهةُ
 * التي تُعطي بعضَ ما على الشاشة تُقرأ كلَّها، فيُبنى عليها ما لا تحتمله.
 */
const shape = (v, tires, crew) => ({
  // ── الهوية ──
  plate: v.plate || null,
  name: v.name || null,
  unitId: v.unitId,
  driver: v.driver || null,
  // ── ورقمُه مع اسمه ────────────────────────────────────────────────────────
  // الاسمُ يقول مَن هو، والرقمُ يقول كيف يُبلَّغ. وأتمتةٌ تُنبِّه على حرارة
  // إطارٍ ثمّ لا تملك رقمَ السائق تُنبِّه إلى الهواء — فيُبحَث عن الرقم بيدٍ
  // في شاشةٍ أخرى بينما الشاحنةُ تسير.
  //
  // ومصدرُه سجلُّ سائقي الأسطول (FleetDriver)، ونظامُ التتبّع لا يعرفه. راجع
  // `crewIndex`: يُطابَق باسم السائق الذي يبلّغه الجهاز، فإن لم يُعرَف الاسمُ
  // أُخذ رقمُ سائق الشاحنة إن كان واحدًا لا أكثر — ولا يُخمَّن بين اثنين.
  driverPhone: crew ? crew.phone : null,
  driverPhoneSource: crew ? crew.source : null,
  // وطاقمُ الشاحنة كما هو مسجَّلٌ عندنا — لمن أراد الثانيَ أو أراد أن يختار.
  crew: crew ? crew.list : [],

  // ── حياة القراءة ──
  online: v.online ?? null,
  status: v.status || null,
  lastMessageAt: v.lastMessageAt || null,
  // ثانيةً منذ آخر رسالة. قراءةٌ عمرُها ساعة ليست «قراءة حاليّة»، وبلا هذا
  // الرقم تبني الأتمتة قرارها على رقمٍ مات ولا تدري.
  dataAgeSeconds: ageSec(v.lastMessageAt),
  lastSyncedAt: v.lastSyncedAt || null,

  // ── الموقع والحركة ──
  position: v.position ? {
    lat: v.position.lat ?? null, lng: v.position.lng ?? null,
    speed: v.position.speed ?? null, course: v.position.course ?? null,
    altitude: v.position.altitude ?? null,
  } : null,

  // ── المحرّك ──
  engine: {
    ignition: v.ignition ?? null,
    moving: v.moving ?? null,
    speedKmh: v.speed ?? null,
    rpm: v.rpm ?? null,
    coolantC: v.coolantC ?? null,
    engineHours: v.engineHours ?? null,
  },

  // ── العدّادات ──
  odometerKm: v.odometerKm ?? null,
  fuelPct: v.fuelPct ?? null,
  totalFuelUsedL: v.totalFuelUsedL ?? null,
  weightKg: v.weightKg ?? null,

  // ── الكهرباء والإرسال ──
  power: {
    mainV: v.mainPowerV ?? null,
    backupV: v.backupBatteryV ?? null,
    gsmSignal: v.gsmSignal ?? null,
  },

  // ── الإطارات ──
  tyres: {
    count: v.tireCount ?? 0,
    faults: v.tireFaults ?? 0,
    brand: v.tireBrand || null,
    maxTempC: v.maxTireTempC ?? null,
    minTempC: v.minTireTempC ?? null,
    maxPressurePsi: v.maxTirePressurePsi ?? null,
    minPressurePsi: v.minTirePressurePsi ?? null,
    // كلُّ فردةٍ بموضعها — هذا ما تبني عليه الأتمتة شرطها.
    readings: (v.tires || []).map((t) => ({
      axle: t.axle ?? null, position: t.position ?? null,
      tempC: t.tempC ?? null, pressurePsi: t.pressurePsi ?? null, fault: !!t.fault,
    })),
    // ما نعرفه نحن ولا يعرفه المزوّد: المركَّب فعلًا في سجلّ الأصول.
    registered: tires ? { mounted: tires.mounted, spare: tires.spare, withSensor: tires.withSensor } : null,
    sensorChangeNotice: v.sensorChangeNotice ?? null,
  },

  // ── التنبيهات والصيانة ──
  alerts: {
    level: v.alertLevel ?? null,
    activeCount: v.activeAlertCount ?? 0,
  },
  maintenance: {
    status: v.maintenanceStatus ?? null,
    overdueCount: v.maintenanceOverdueCount ?? 0,
    dueCount: v.maintenanceDueCount ?? 0,
    kmToService: v.kmToService ?? null,
    nextServiceKm: v.nextServiceKm ?? null,
    nextServiceName: v.nextServiceName || null,
    upcomingServiceKm: v.upcomingServiceKm ?? null,
    upcomingServiceName: v.upcomingServiceName || null,
  },

  // ── بيانات المركبة الثابتة ──
  profile: v.profile ? {
    vin: v.profile.vin || null,
    brand: v.profile.brand || null,
    modelYear: v.profile.modelYear ?? null,
    vehicleType: v.profile.vehicleType || null,
    registrationPlate: v.profile.registrationPlate || null,
    installDate: v.profile.installDate || null,
  } : null,
});

/**
 * فهرسُ سائقي الأسطول: مفتاحُ اللوحة ← طاقمُها، واسمٌ مطويّ ← رقمُه.
 *
 * يُبنى مرّةً لكلّ نداءٍ لا استعلامًا لكلّ مركبة، ويُحفَظ دقيقةً: الأرقامُ
 * تتغيّر حين يُكتب رقمٌ في ملفّ سائق، لا كلَّ عشرين ثانية.
 */
async function crewIndex() {
  const hit = cache.get('fleetapi:crew');
  if (hit) return hit;

  const FleetModels = require('../models/FleetModels');
  const { plateKey } = require('../utils/plateKey');
  const { flexNormalize } = require('../utils/plateKey');
  const [vehicles, drivers] = await Promise.all([
    FleetModels.FleetVehicle.find({ isActive: { $ne: false } }).select('plate').lean(),
    FleetModels.FleetDriver.find({ isActive: { $ne: false } }).select('name phone vehicle working').lean(),
  ]);

  const plateOf = new Map(vehicles.map((v) => [String(v._id), plateKey(v.plate)]));
  const byPlate = new Map();   // مفتاحُ اللوحة ← [{name, phone, working}]
  const byName = new Map();    // الاسمُ المطويّ ← رقمُه
  for (const d of drivers) {
    const person = {
      name: d.name,
      phone: String(d.phone || '').trim() || null,
      working: d.working !== false,
    };
    const k = d.vehicle ? plateOf.get(String(d.vehicle)) : null;
    if (k) {
      if (!byPlate.has(k)) byPlate.set(k, []);
      byPlate.get(k).push(person);
    }
    const n = flexNormalize(d.name);
    if (n && person.phone && !byName.has(n)) byName.set(n, person.phone);
  }

  const out = { byPlate, byName };
  cache.set('fleetapi:crew', out, 60000);
  return out;
}

/** رقمُ سائقٍ بعينه — بالاسم أوّلًا، ثمّ بالشاحنة إن كان سائقُها واحدًا. */
function crewFor(v, index) {
  const { plateKey, flexNormalize } = require('../utils/plateKey');
  const key = plateKey(v.plate);
  const list = (index.byPlate.get(key) || []).map((p) => ({ ...p }));
  const reported = flexNormalize(v.driver || '');

  let phone = null;
  let source = null;
  if (reported) {
    const onTruck = list.find((p) => flexNormalize(p.name) === reported && p.phone);
    if (onTruck) { phone = onTruck.phone; source = 'driver_name'; }
    else if (index.byName.has(reported)) { phone = index.byName.get(reported); source = 'driver_name'; }
  }
  // ── ولا يُخمَّن بين اثنين ────────────────────────────────────────────────
  // للشاحنة سائقان أحيانًا؛ وإرسالُ رقمِ أحدهما على أنّه «سائقُها» يُبلَّغ به
  // مَن ليس على الطريق. فإن لم يُعرَف الاسمُ ولها سائقان تُترَك فارغةً
  // و`crew` أمام القارئ يختار منها.
  if (!phone && list.length === 1 && list[0].phone) { phone = list[0].phone; source = 'vehicle_single_driver'; }
  return { phone, source, list };
}

/** GET /vehicles — كلّ المركبات بلقطتها الأخيرة. */
router.get('/vehicles', async (req, res) => {
  try {
    const key = `ls2:api:vehicles:${req.query.plate || 'all'}`;
    const hit = cache.get(key);
    if (hit !== undefined) return res.json(hit);

    const filter = {};
    if (req.query.plate) filter.plate = String(req.query.plate).trim();
    const [vehicles, crew] = await Promise.all([Ls2Vehicle.find(filter).lean(), crewIndex()]);

    // سجلّ الإطارات لكلّ اللوحات دفعةً واحدة — لا استعلامًا لكلّ مركبة.
    const assets = await Ls2TireAsset.find({ status: { $in: ['mounted', 'spare'] } })
      .select('plateKey status sensor').lean();
    const byPlate = new Map();
    for (const a of assets) {
      const k = a.plateKey || '';
      if (!k) continue;
      const e = byPlate.get(k) || { mounted: 0, spare: 0, withSensor: 0 };
      if (a.status === 'mounted') e.mounted += 1; else e.spare += 1;
      if (a.sensor === 'yes') e.withSensor += 1;
      byPlate.set(k, e);
    }

    const body = {
      generatedAt: new Date().toISOString(),
      count: vehicles.length,
      // ── ومفتاحُ اللوحة يُشتقّ ولا يُقرأ ──────────────────────────────
      // كان يُقرأ `v.plateKey` من سجلّ التتبّع — وهو حقلٌ لا وجود له فيه
      // إطلاقًا (صفرٌ من ثمانٍ وخمسين). فكان `tyres.registered` يخرج `null`
      // في كلّ مركبةٍ منذ أن كُتبت الواجهة: سجلُّ الإطارات الذي وُعد به
      // المستهلك لم يصله قطّ، ولا خطأَ يُقال. فيُشتقّ من اللوحة كما يُشتقّ
      // في بقيّة النظام (utils/plateKey).
      vehicles: vehicles.map((v) => shape(v, byPlate.get(require('../utils/plateKey').plateKey(v.plate) || ''), crewFor(v, crew))),
    };
    cache.set(key, body, 10000);
    res.json(body);
  } catch (e) {
    console.error('[fleet-api] vehicles', e);
    res.status(500).json({ message: 'تعذّر جلب المركبات' });
  }
});

/** GET /vehicles/:plate — مركبةٌ واحدة. */
router.get('/vehicles/:plate', async (req, res) => {
  try {
    const v = await Ls2Vehicle.findOne({ plate: String(req.params.plate).trim() }).lean();
    if (!v) return res.status(404).json({ message: 'المركبة غير موجودة' });
    const { plateKey } = require('../utils/plateKey');
    const [assets, crew] = await Promise.all([
      Ls2TireAsset.find({ plateKey: plateKey(v.plate), status: { $in: ['mounted', 'spare'] } }).select('status sensor').lean(),
      crewIndex(),
    ]);
    const tires = assets.length ? {
      mounted: assets.filter((a) => a.status === 'mounted').length,
      spare: assets.filter((a) => a.status !== 'mounted').length,
      withSensor: assets.filter((a) => a.sensor === 'yes').length,
    } : null;
    res.json({ generatedAt: new Date().toISOString(), vehicle: shape(v, tires, crewFor(v, crew)) });
  } catch (e) {
    res.status(500).json({ message: 'تعذّر جلب المركبة' });
  }
});

/**
 * GET /alerts — التنبيهات المفتوحة كما يراها النظام.
 *
 * الأتمتة قد تبني شروطها بنفسها، لكنّ العتبات هنا قابلةٌ للتعديل من الشاشة —
 * فالقراءة من هنا تعني أن تغيير العتبة يصل الأتمتة بلا تعديل شيفرتها.
 */
router.get('/alerts', async (req, res) => {
  try {
    const filter = { resolvedAt: null };
    if (req.query.plate) filter.plate = String(req.query.plate).trim();
    if (req.query.type) filter.type = { $in: String(req.query.type).split(',').map((s) => s.trim()).filter(Boolean) };
    const alerts = await Ls2Alert.find(filter).sort({ createdAt: -1 }).limit(500).lean();
    res.json({
      generatedAt: new Date().toISOString(),
      count: alerts.length,
      alerts: alerts.map((a) => ({
        plate: a.plate, type: a.type, severity: a.severity ?? null,
        message: a.message ?? null, value: a.value ?? null,
        raisedAt: a.createdAt, ageSeconds: ageSec(a.createdAt),
      })),
    });
  } catch (e) {
    res.status(500).json({ message: 'تعذّر جلب التنبيهات' });
  }
});

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  توزيعُ المشرفين — مَن يشرف على أيّ شاحنة
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * ── لماذا في هذه الواجهة ───────────────────────────────────────────────────
 * شاشةُ «توزيع السيارات على المشرفين» تُقرأ بالعين مرّةً كلَّ حين، والأسئلةُ
 * التي تُبنى عليها يوميّة: أيُّ شاحنةٍ بلا مشرف؟ ومَن حمل أكثرَ من طاقته؟
 * ومتى تحرّكت شاحنةٌ من مشرفٍ إلى آخر؟ وكلُّها أسئلةٌ تُسأل في وقتها لا حين
 * يفتح أحدٌ الشاشة — فتُقرأ من هنا وتُبنى عليها التنبيهات.
 *
 * ── وحدُّها القراءة ────────────────────────────────────────────────────────
 * الإسنادُ قرارُ مدير القسم: يُقرأ من هنا ولا يُكتب. ومَن يوزّع يدخل بصلاحيّته.
 */

const FleetModels = require('../models/FleetModels');
const FleetVehicle = FleetModels.FleetVehicle;
const FleetDriver = FleetModels.FleetDriver;
const User = require('../models/User');

const fullName = (u) => `${u?.firstName || ''} ${u?.lastName || ''}`.trim() || u?.email || '';

/** يقرأ المركباتِ وسائقيها والمشرفين مرّةً واحدة — وتُشتقّ منها كلُّ الردود. */
async function assignmentSnapshot() {
  const [vehicles, drivers, sups] = await Promise.all([
    FleetVehicle.find({ isActive: { $ne: false } }).sort({ plate: 1 })
      .select('plate name trailerType gpsType brand color supervisor supervisorName notes monthlyTarget updatedAt').lean(),
    FleetDriver.find({ isActive: { $ne: false }, vehicle: { $ne: null } })
      .select('name phone working offReason vehicle').lean(),
    User.find({ role: { $in: ['fleet_supervisor', 'fleet_manager'] }, isActive: { $ne: false } })
      .select('firstName lastName email phone role').lean(),
  ]);

  const byVehicle = new Map();
  for (const d of drivers) {
    const k = String(d.vehicle);
    if (!byVehicle.has(k)) byVehicle.set(k, []);
    byVehicle.get(k).push({
      name: d.name, phone: d.phone || null,
      working: d.working !== false,
      offReason: d.working === false ? (d.offReason || null) : null,
    });
  }

  const supById = new Map(sups.map((u) => [String(u._id), u]));
  const rows = vehicles.map((v) => {
    const sid = v.supervisor ? String(v.supervisor) : null;
    const u = sid ? supById.get(sid) : null;
    return {
      plate: v.plate,
      name: v.name || null,
      trailerType: v.trailerType || null,
      gpsType: v.gpsType || null,
      brand: v.brand || null,
      color: v.color || null,
      monthlyTarget: v.monthlyTarget ?? null,
      notes: v.notes || null,
      // ── والمشرفُ اسمٌ ومعرّفٌ وبريدٌ وهاتف ──────────────────────────────
      // مَن يبني تنبيهًا يحتاج إلى مَن يُرسِله إليه، لا إلى اسمٍ يبحث عنه.
      supervisor: u ? {
        id: String(u._id), name: fullName(u), email: u.email || null,
        phone: u.phone || null, role: u.role,
      } : null,
      // الاسمُ المحفوظُ على المركبة — يبقى وإن حُذف المستخدم.
      supervisorName: v.supervisorName || null,
      unassigned: !sid,
      drivers: byVehicle.get(String(v._id)) || [],
      updatedAt: v.updatedAt || null,
    };
  });

  // ── ومديرُ القسم نطاقُه الأسطولُ كلُّه ────────────────────────────────────
  // لا تُسنَد إليه مركباتٌ بالإفراد، فعدُّ ما يحمل اسمَه صفرٌ — ويُقرأ الصفرُ
  // «لا يعمل» وهو أبعدُ ما يكون عن الحقيقة. فيُقال نطاقُه صراحةً.
  const counts = new Map();
  for (const r of rows) {
    const k = r.supervisor ? r.supervisor.id : 'none';
    counts.set(k, (counts.get(k) || 0) + 1);
  }
  const supervisors = sups.map((u) => {
    const id = String(u._id);
    const isManager = u.role === 'fleet_manager';
    return {
      id,
      name: fullName(u),
      email: u.email || null,
      phone: u.phone || null,
      role: u.role,
      isDepartmentManager: isManager,
      scope: isManager ? 'whole_fleet' : 'assigned_vehicles',
      vehicleCount: isManager ? rows.length : (counts.get(id) || 0),
      plates: isManager
        ? rows.map((r) => r.plate)
        : rows.filter((r) => r.supervisor && r.supervisor.id === id).map((r) => r.plate),
    };
  }).sort((a, b) => a.name.localeCompare(b.name, 'ar'));

  return {
    summary: {
      vehicles: rows.length,
      supervisors: supervisors.filter((s) => !s.isDepartmentManager).length,
      departmentManagers: supervisors.filter((s) => s.isDepartmentManager).length,
      assigned: rows.filter((r) => !r.unassigned).length,
      unassigned: counts.get('none') || 0,
      vehiclesWithoutDriver: rows.filter((r) => r.drivers.length === 0).length,
    },
    supervisors,
    vehicles: rows,
  };
}

/**
 * GET /supervisor-assignment — الشاشةُ كلُّها في ردٍّ واحد.
 *
 * `?unassignedOnly=true` تختصر الردَّ على ما لا مشرفَ له — وهو أكثرُ ما تُبنى
 * عليه التنبيهات: شاحنةٌ تعمل ولا أحدَ مسؤولٌ عنها.
 * `?supervisor=<id|name>` تقصره على مشرفٍ بعينه.
 */
router.get('/supervisor-assignment', async (req, res) => {
  try {
    const hit = cache.get('fleetapi:assign');
    const snap = hit || await assignmentSnapshot();
    if (!hit) cache.set('fleetapi:assign', snap, 15000);

    let vehicles = snap.vehicles;
    if (String(req.query.unassignedOnly || '') === 'true') vehicles = vehicles.filter((v) => v.unassigned);
    const who = String(req.query.supervisor || '').trim();
    if (who) {
      const k = who.toLowerCase();
      vehicles = vehicles.filter((v) => v.supervisor
        && (v.supervisor.id === who
          || v.supervisor.name.toLowerCase().includes(k)
          || String(v.supervisor.email || '').toLowerCase() === k));
    }

    res.json({
      generatedAt: new Date().toISOString(),
      summary: snap.summary,
      supervisors: snap.supervisors,
      count: vehicles.length,
      vehicles,
    });
  } catch (e) {
    console.error('[fleet-api] supervisor-assignment', e);
    res.status(500).json({ message: 'تعذّر جلب توزيع المشرفين' });
  }
});

/** GET /supervisors — المشرفون وأعدادُ مركباتهم ولوحاتُها، بلا تفاصيل المركبات. */
router.get('/supervisors', async (req, res) => {
  try {
    const hit = cache.get('fleetapi:assign');
    const snap = hit || await assignmentSnapshot();
    if (!hit) cache.set('fleetapi:assign', snap, 15000);
    res.json({
      generatedAt: new Date().toISOString(),
      summary: snap.summary,
      count: snap.supervisors.length,
      supervisors: snap.supervisors,
    });
  } catch (e) {
    res.status(500).json({ message: 'تعذّر جلب المشرفين' });
  }
});

/** GET /health — للأتمتة أن تتحقّق من المفتاح وحياة النبض قبل أن تعتمد عليه. */
router.get('/health', async (req, res) => {
  const newest = await Ls2Vehicle.findOne({}).sort({ lastMessageAt: -1 }).select('lastMessageAt').lean();
  const age = ageSec(newest?.lastMessageAt);
  res.json({
    ok: true,
    generatedAt: new Date().toISOString(),
    // النبض يعمل كلّ عشرين ثانية، فقراءةٌ أحدثُ من خمس دقائق تعني أنه حيّ.
    pollHealthy: age != null && age < 300,
    newestReadingAgeSeconds: age,
  });
});

module.exports = router;
