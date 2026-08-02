const { VehicleMaster, VehicleRegistryConfig } = require('../models/VehicleMaster');
const cache = require('../utils/ttlCache');
const { emitToAll } = require('../websocket/socketManager');

const emit = (event, payload = {}) => { try { emitToAll(event, payload); } catch (e) {} cache.clear('vreg:'); };

// المستندات ذات تاريخ الانتهاء — المفتاح ← مسار التاريخ + الاسم.
const DOC_TYPES = [
  { key: 'insurance', ar: 'التأمين', en: 'Insurance', path: 'insurance.expiryDate' },
  { key: 'operatingCard', ar: 'بطاقة التشغيل', en: 'Operating Card', path: 'operatingCard.expiryDate' },
  { key: 'vehicleLicense', ar: 'رخصة السير', en: 'Vehicle License', path: 'vehicleLicense.expiryDate' },
  { key: 'inspection', ar: 'الفحص', en: 'Inspection', path: 'inspection.expiryDate' },
  { key: 'gps', ar: 'اشتراك GPS', en: 'GPS', path: 'gps.expiryDate' },
];

const DAY = 86400000;
const daysUntil = (date) => (date ? Math.floor((new Date(date).getTime() - Date.now()) / DAY) : null);
const getPath = (obj, path) => path.split('.').reduce((c, p) => (c == null ? c : c[p]), obj);

const _multi = (v) => (v == null ? [] : (Array.isArray(v) ? v : String(v).split(',')).map((x) => String(x).trim()).filter(Boolean));

const getConfig = async () =>
  VehicleRegistryConfig.findOneAndUpdate({ key: 'vehicle-registry' }, { $setOnInsert: { key: 'vehicle-registry' } }, { new: true, upsert: true, setDefaultsOnInsert: true }).lean();

// حالة مستند مقابل عتبته: expired / critical(≤30) / warning(≤warnDays) / valid / none
const docStatus = (date, warnDays) => {
  const dr = daysUntil(date);
  if (dr === null) return { status: 'none', days: null };
  if (dr < 0) return { status: 'expired', days: dr };
  if (dr <= 30) return { status: 'critical', days: dr };
  if (dr <= (warnDays || 60)) return { status: 'warning', days: dr };
  return { status: 'valid', days: dr };
};

// يبني فلتر Mongo من الـ query (متعدد القيم + بحث + نطاق سنة).
function buildFilter(q) {
  const f = { isActive: { $ne: false } };
  const and = [];
  // كل الفلاتر بالاسم العربي (نفس ما تعرضه التوزيعات) — أبسط وأوضح.
  const map = {
    sector: 'sectorAr', registrationType: 'registrationTypeAr', brand: 'brandAr',
    owner: 'ownerNameAr', insuranceCompany: 'insurance.companyAr',
    coverageType: 'insurance.coverageTypeAr', fuelCardStatus: 'fuelCard.statusAr',
    inspectionStatus: 'inspection.statusAr', tamStatus: 'tamStatusAr', color: 'colorAr',
    // توافق خلفي مع الأكواد:
    sectorCode: 'sectorCode', registrationTypeCode: 'registrationTypeCode',
  };
  for (const [qk, field] of Object.entries(map)) {
    const vals = _multi(q[qk]);
    if (vals.length) and.push({ [field]: { $in: vals } });
  }
  const years = _multi(q.modelYear).map(Number).filter((x) => !Number.isNaN(x));
  if (years.length) and.push({ modelYear: { $in: years } });
  if (q.yearFrom || q.yearTo) {
    const yr = {}; if (q.yearFrom) yr.$gte = Number(q.yearFrom); if (q.yearTo) yr.$lte = Number(q.yearTo);
    and.push({ modelYear: yr });
  }
  if (q.q && String(q.q).trim()) {
    const rx = new RegExp(String(q.q).trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
    and.push({ $or: [
      { plateNumber: rx }, { chassisNumber: rx }, { serialNumber: rx }, { brandAr: rx }, { modelAr: rx },
      { ownerNameAr: rx }, { 'insurance.policyNumber': rx }, { 'insurance.companyAr': rx },
      { 'fuelCard.cardNumber': rx }, { 'operatingCard.cardNumber': rx }, { notesAr: rx },
    ] });
  }
  // فلتر انتهاء مستند خلال مدة، أو منتهي، أو ضمن نطاق تاريخي.
  if (q.expiringDoc && q.expiringWithin) {
    const dt = DOC_TYPES.find((x) => x.key === q.expiringDoc);
    if (dt) {
      const end = new Date(Date.now() + Number(q.expiringWithin) * DAY);
      and.push({ [dt.path]: { $ne: null, $lte: end, $gte: new Date() } });
    }
  }
  if (q.expiredDoc) {
    const dt = DOC_TYPES.find((x) => x.key === q.expiredDoc);
    if (dt) and.push({ [dt.path]: { $ne: null, $lt: new Date() } });
  }
  // «بدون مستند»: مركبات ينقصها هذا المستند (لا تاريخ/لا رقم).
  if (q.missingDoc) {
    const paths = { insurance: 'insurance.expiryDate', operatingCard: 'operatingCard.cardNumber', vehicleLicense: 'vehicleLicense.expiryDate', inspection: 'inspection.expiryDate', gps: 'gps.deviceId', fuelCard: 'fuelCard.cardNumber' };
    const p = paths[q.missingDoc];
    if (p) and.push({ $or: [{ [p]: null }, { [p]: '' }] });
  }
  // «لديه GPS»: مركبات عليها جهاز مركّب.
  if (q.hasGps === '1') and.push({ 'gps.deviceId': { $nin: [null, ''] } });
  if (q.expiryDoc && (q.expiryFrom || q.expiryTo)) {
    const dt = DOC_TYPES.find((x) => x.key === q.expiryDoc);
    if (dt) {
      const rng = {}; if (q.expiryFrom) rng.$gte = new Date(q.expiryFrom);
      if (q.expiryTo) rng.$lte = new Date(new Date(q.expiryTo).getTime() + DAY);
      and.push({ [dt.path]: rng });
    }
  }
  if (and.length) f.$and = and;
  return f;
}

// ── قائمة المركبات ─────────────────────────────────────────────────────────────
exports.list = async (req, res) => {
  try {
    const filter = buildFilter(req.query);
    const limit = Math.min(Number(req.query.limit) || 500, 2000);
    const page = Math.max(Number(req.query.page) || 1, 1);
    const sortBy = req.query.sortBy || 'plateNumber';
    const sortDir = req.query.sortDir === 'desc' ? -1 : 1;
    const [vehicles, total] = await Promise.all([
      VehicleMaster.find(filter).sort({ [sortBy]: sortDir }).skip((page - 1) * limit).limit(limit).lean(),
      VehicleMaster.countDocuments(filter),
    ]);
    const cfg = await getConfig();
    const withStatus = vehicles.map((v) => decorate(v, cfg));
    res.json({ vehicles: withStatus, total, page, pages: Math.ceil(total / limit) });
  } catch (e) { console.error('vreg list', e); res.status(500).json({ message: 'Failed to load vehicles' }); }
};

// يضيف حالة كل مستند + أقرب انتهاء + أدنى حالة للمركبة.
function decorate(v, cfg) {
  const a = cfg.alerts || {};
  const docs = {
    insurance: docStatus(v.insurance?.expiryDate, a.insurance?.warnDays),
    operatingCard: docStatus(v.operatingCard?.expiryDate, a.operatingCard?.warnDays),
    vehicleLicense: docStatus(v.vehicleLicense?.expiryDate, a.vehicleLicense?.warnDays),
    inspection: docStatus(v.inspection?.expiryDate, a.inspection?.warnDays),
    gps: docStatus(v.gps?.expiryDate, a.gps?.warnDays),
  };
  const order = { expired: 0, critical: 1, warning: 2, valid: 3, none: 4 };
  let worst = 'valid'; let worstDays = null;
  for (const [k, s] of Object.entries(docs)) {
    if (k === 'gps' && !a.gps?.enabled) continue;
    if (order[s.status] < order[worst]) { worst = s.status; worstDays = s.days; }
    else if (s.status === worst && s.days != null && (worstDays == null || s.days < worstDays)) worstDays = s.days;
  }
  return { ...v, docStatuses: docs, overallStatus: worst, overallDays: worstDays };
}

exports.getOne = async (req, res) => {
  try {
    const v = await VehicleMaster.findById(req.params.id).lean();
    if (!v) return res.status(404).json({ message: 'Vehicle not found' });
    const cfg = await getConfig();
    res.json({ vehicle: decorate(v, cfg) });
  } catch (e) { res.status(500).json({ message: 'Failed to load vehicle' }); }
};

exports.create = async (req, res) => {
  try {
    const v = await VehicleMaster.create({ ...req.body, isActive: true });
    emit('vreg:updated', {});
    res.status(201).json({ vehicle: v });
  } catch (e) {
    if (e.code === 11000) return res.status(400).json({ message: 'رقم اللوحة أو الهيكل مكرر' });
    res.status(500).json({ message: 'Failed to create vehicle' });
  }
};

exports.update = async (req, res) => {
  try {
    const v = await VehicleMaster.findByIdAndUpdate(req.params.id, { $set: req.body }, { new: true, runValidators: true });
    if (!v) return res.status(404).json({ message: 'Vehicle not found' });
    emit('vreg:updated', {});
    res.json({ vehicle: v });
  } catch (e) {
    if (e.code === 11000) return res.status(400).json({ message: 'رقم اللوحة أو الهيكل مكرر' });
    res.status(500).json({ message: 'Failed to update vehicle' });
  }
};

exports.remove = async (req, res) => {
  try {
    await VehicleMaster.findByIdAndDelete(req.params.id);
    emit('vreg:updated', {});
    res.json({ message: 'Vehicle deleted' });
  } catch (e) { res.status(500).json({ message: 'Failed to delete vehicle' }); }
};

// ── لوحة التحليلات ─────────────────────────────────────────────────────────────
exports.dashboard = async (req, res) => {
  try {
    const cacheKey = `vreg:dash:${JSON.stringify(req.query || {})}`;
    const hit = cache.get(cacheKey);
    if (hit !== undefined) return res.json(hit);

    const filter = buildFilter(req.query);
    const [vehicles, cfg] = await Promise.all([VehicleMaster.find(filter).lean(), getConfig()]);

    const count = (fn) => vehicles.reduce((m, v) => { const k = fn(v) || '—'; m[k] = (m[k] || 0) + 1; return m; }, {});
    const toArr = (obj, extra = {}) => Object.entries(obj).map(([key, value]) => ({ key, count: value, ...(extra[key] || {}) })).sort((a, b) => b.count - a.count);

    // توزيعات
    const bySector = count((v) => v.sectorAr);
    const byRegistrationType = count((v) => v.registrationTypeAr);
    const byBrand = count((v) => v.brandAr);
    const byOwner = count((v) => v.ownerNameAr);
    const byInsuranceCompany = count((v) => v.insurance?.companyAr);
    const byCoverageType = count((v) => v.insurance?.coverageTypeAr);
    const byFuelCardStatus = count((v) => v.fuelCard?.statusAr);
    const byInspectionStatus = count((v) => v.inspection?.statusAr);
    const byColor = count((v) => v.colorAr);
    const byTamStatus = count((v) => v.tamStatusAr);
    const byModelYear = count((v) => (v.modelYear ? String(v.modelYear) : '—'));

    // مبالغ
    const premiums = vehicles.map((v) => Number(v.insurance?.premiumSar) || 0).filter((x) => x > 0);
    const totalPremium = premiums.reduce((a, b) => a + b, 0);
    const fuelLimits = vehicles.map((v) => Number(v.fuelCard?.limitSar) || 0).filter((x) => x > 0);
    const totalFuelLimit = fuelLimits.reduce((a, b) => a + b, 0);

    // حالة المستندات (buckets) لكل نوع
    const docBuckets = {};
    for (const dt of DOC_TYPES) {
      const b = { expired: 0, critical: 0, warning: 0, valid: 0, none: 0 };
      const warnDays = cfg.alerts?.[dt.key]?.warnDays;
      for (const v of vehicles) b[docStatus(getPath(v, dt.path), warnDays).status] += 1;
      docBuckets[dt.key] = b;
    }

    // مؤشرات علوية
    const withGps = vehicles.filter((v) => v.gps?.deviceId).length;
    const missingInsurance = vehicles.filter((v) => !v.insurance?.expiryDate).length;
    const missingOperatingCard = vehicles.filter((v) => !v.operatingCard?.cardNumber).length;
    const activeFuelCards = vehicles.filter((v) => v.fuelCard?.statusCode === 'active').length;

    // إجمالي التنبيهات (منتهي + خلال العتبة) عبر كل المستندات المفعّلة
    let expiredTotal = 0; let expiringTotal = 0;
    for (const dt of DOC_TYPES) {
      if (dt.key === 'gps' && !cfg.alerts?.gps?.enabled) continue;
      const b = docBuckets[dt.key];
      expiredTotal += b.expired;
      expiringTotal += b.critical + b.warning;
    }

    const body = {
      totals: {
        vehicles: vehicles.length,
        totalPremium: Math.round(totalPremium),
        avgPremium: premiums.length ? Math.round(totalPremium / premiums.length) : 0,
        totalFuelLimit: Math.round(totalFuelLimit),
        activeFuelCards, withGps, missingInsurance, missingOperatingCard,
        expiredTotal, expiringTotal,
        sectors: Object.keys(bySector).length, brands: Object.keys(byBrand).length, owners: Object.keys(byOwner).length,
      },
      bySector: toArr(bySector), byRegistrationType: toArr(byRegistrationType), byBrand: toArr(byBrand),
      byOwner: toArr(byOwner), byInsuranceCompany: toArr(byInsuranceCompany), byCoverageType: toArr(byCoverageType),
      byFuelCardStatus: toArr(byFuelCardStatus), byInspectionStatus: toArr(byInspectionStatus),
      byColor: toArr(byColor), byTamStatus: toArr(byTamStatus), byModelYear: toArr(byModelYear),
      docBuckets,
    };
    cache.set(cacheKey, body, 30000);
    res.json(body);
  } catch (e) { console.error('vreg dashboard', e); res.status(500).json({ message: 'Failed to load dashboard' }); }
};

// ── التنبيهات: كل مستند خلال عتبته أو منتهي ───────────────────────────────────
exports.alerts = async (req, res) => {
  try {
    const cfg = await getConfig();
    const vehicles = await VehicleMaster.find({ isActive: { $ne: false } }).lean();
    const items = [];
    for (const v of vehicles) {
      for (const dt of DOC_TYPES) {
        const conf = cfg.alerts?.[dt.key];
        if (!conf?.enabled) continue;
        const date = getPath(v, dt.path);
        if (!date) continue;
        const st = docStatus(date, conf.warnDays);
        if (st.status === 'expired' || st.status === 'critical' || st.status === 'warning') {
          items.push({
            vehicleId: v._id, plateNumber: v.plateNumber, brandAr: v.brandAr, modelAr: v.modelAr,
            sectorAr: v.sectorAr, ownerNameAr: v.ownerNameAr,
            docType: dt.key, docAr: dt.ar, docEn: dt.en,
            expiryDate: date, daysRemaining: st.days, status: st.status,
          });
        }
      }
    }
    items.sort((a, b) => (a.daysRemaining ?? 0) - (b.daysRemaining ?? 0));
    const byStatus = { expired: 0, critical: 0, warning: 0 };
    const byDoc = {};
    for (const it of items) { byStatus[it.status] += 1; byDoc[it.docType] = (byDoc[it.docType] || 0) + 1; }
    res.json({ items, total: items.length, byStatus, byDoc });
  } catch (e) { console.error('vreg alerts', e); res.status(500).json({ message: 'Failed to load alerts' }); }
};

exports.getSettings = async (req, res) => {
  try { const cfg = await getConfig(); res.json({ config: { alerts: cfg.alerts } }); }
  catch (e) { res.status(500).json({ message: 'Failed to load settings' }); }
};

exports.updateSettings = async (req, res) => {
  try {
    const cfg = await VehicleRegistryConfig.findOneAndUpdate(
      { key: 'vehicle-registry' },
      { $set: { alerts: req.body.alerts, updatedBy: req.user?._id }, $setOnInsert: { key: 'vehicle-registry' } },
      { new: true, upsert: true, setDefaultsOnInsert: true },
    ).lean();
    emit('vreg:updated', {});
    res.json({ config: { alerts: cfg.alerts } });
  } catch (e) { res.status(500).json({ message: 'Failed to save settings' }); }
};
