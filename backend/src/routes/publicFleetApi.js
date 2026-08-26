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

/** شكلٌ واحد للمركبة في كل ردّ — فلا يخمّن المستهلك أين يجد ما يريد. */
const shape = (v, tires) => ({
  plate: v.plate || null,
  unitId: v.unitId,
  online: v.online ?? null,
  lastMessageAt: v.lastMessageAt || null,
  // ثانيةً منذ آخر رسالة. قراءةٌ عمرُها ساعة ليست «قراءة حاليّة»، وبلا هذا
  // الرقم تبني الأتمتة قرارها على رقمٍ مات ولا تدري.
  dataAgeSeconds: ageSec(v.lastMessageAt),
  driver: v.driver || null,
  position: v.position ? { lat: v.position.lat, lng: v.position.lng, speed: v.position.speed, course: v.position.course } : null,
  engine: {
    ignition: v.ignition ?? null,
    moving: v.moving ?? null,
    speedKmh: v.speed ?? null,
    rpm: v.rpm ?? null,
    coolantC: v.coolantC ?? null,
    engineHours: v.engineHours ?? null,
  },
  odometerKm: v.odometerKm ?? null,
  fuelPct: v.fuelPct ?? null,
  weightKg: v.weightKg ?? null,
  power: { mainV: v.mainPowerV ?? null, backupV: v.backupBatteryV ?? null, gsm: v.gsmSignal ?? null },
  tyres: {
    count: v.tireCount ?? 0,
    faults: v.tireFaults ?? 0,
    maxTempC: v.maxTireTempC ?? null,
    minTempC: v.minTireTempC ?? null,
    maxPressurePsi: v.maxTirePressurePsi ?? null,
    minPressurePsi: v.minTirePressurePsi ?? null,
    // كلُّ فردةٍ بموضعها — هذا ما تبني عليه الأتمتة شرطها: «أيُّ فردةٍ تجاوزت ٩٠».
    readings: (v.tires || []).map((t) => ({
      axle: t.axle ?? null, position: t.position ?? null,
      tempC: t.tempC ?? null, pressurePsi: t.pressurePsi ?? null, fault: !!t.fault,
    })),
    // ما نعرفه نحن ولا يعرفه المزوّد: المركَّب فعلًا في سجلّ الأصول.
    registered: tires ? { mounted: tires.mounted, spare: tires.spare, withSensor: tires.withSensor } : undefined,
  },
});

/** GET /vehicles — كلّ المركبات بلقطتها الأخيرة. */
router.get('/vehicles', async (req, res) => {
  try {
    const key = `ls2:api:vehicles:${req.query.plate || 'all'}`;
    const hit = cache.get(key);
    if (hit !== undefined) return res.json(hit);

    const filter = {};
    if (req.query.plate) filter.plate = String(req.query.plate).trim();
    const vehicles = await Ls2Vehicle.find(filter).lean();

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
      vehicles: vehicles.map((v) => shape(v, byPlate.get(v.plateKey || ''))),
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
    res.json({ generatedAt: new Date().toISOString(), vehicle: shape(v) });
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
