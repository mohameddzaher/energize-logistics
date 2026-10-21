/**
 * ls2VehicleLink — شاحنةُ لوكيشن سوليوشن هي مركبةُ السجلّ نفسُها، لا نسخةٌ منها.
 *
 * ── القاعدة (صاحبُ الشركة، ٢٠٢٦/١٠/٢١) ───────────────────────────────────────
 * سجلٌّ واحدٌ لكلّ مركبةٍ في النظام كلِّه، وما يُعدَّل فيه يظهر في كلّ قسمٍ
 * لحظتَها. ومرآةُ Wialon (`Ls2Vehicle`) كانت تحمل لوحتَها وماركتَها وسنتَها
 * ورقمَ شاسيهها نصًّا بلا رابط، فاختلفت مع سجلّ المركبات في ٢٢ سنةَ صنع و١٨
 * رقمَ شاسيه ولا يعلم أحدٌ أيَّهما الصحيح.
 *
 * فهنا الربطُ وحدَه:
 *   • `Ls2Vehicle.vehicleMaster` — من لوحته بالمفتاح الموحَّد (عربيّةً أو لاتينيّة).
 *   • `Ls2Flatbed.vehicleMaster` — من شاحنته: إن حملت لوحتُه حروفًا فبالمفتاح
 *     الموحَّد، وإن كانت أرقامًا وحدها («2708») فمن وحدة لوكيشن التي تحمل
 *     الأرقامَ نفسَها — **لا بالأرقام في السجلّ أبدًا**: «1080» دراجةٌ هناك
 *     وتريلا هنا (راجع utils/plateKey).
 *   • ولِما يُكتب نصًّا في المخزن والعهدة: `resolveLs2Plate` بالقاعدة نفسِها.
 *
 * والهويّةُ تُقرأ من السجلّ عند العرض (`attachRegistry`)، وما يقوله الجهاز
 * يبقى «حسب الجهاز» بجانبها — وحيث يختلفان يُرفع العلَم.
 */
const Ls2Vehicle = require('../models/Ls2Vehicle');
const Ls2Flatbed = require('../models/Ls2Flatbed');
const { canonicalPlateKey, vehiclePlateKey, plateKey } = require('../utils/plateKey');

const VM = () => require('../models/VehicleMaster').VehicleMaster;

/** أفي المفتاح الموحَّد حروف؟ «2708|» لا حروفَ فيه فلا يُطابَق في السجلّ. */
const hasLetters = (k) => !!k && !k.endsWith('|');

/**
 * لوحةُ وحدة لوكيشن كما تُقرأ للربط: `plate` ثمّ لوحةُ التسجيل في الملفّ،
 * وإن خلتا فمن الاسم — والاسمُ «3450 JTA بلال اشرف» فيه اسمُ السائق، وحروفُه
 * العربيّة تُفسد المفتاح، فيُؤخذ منه الرقمُ والحروفُ اللاتينيّةُ اللاصقةُ به وحدَهما.
 */
function unitPlate(v) {
  if (!v) return '';
  const p = String(v.plate || v.profile?.registrationPlate || '').trim();
  if (p) return p;
  const m = String(v.name || '').match(/\d{1,4}\s*[A-Za-z]{2,3}\b|[A-Za-z]{2,3}\s*\d{1,4}/);
  return m ? m[0] : '';
}
const unitCanonKey = (v) => canonicalPlateKey(unitPlate(v));

async function registryByKeys(keys) {
  const list = [...new Set(keys.filter(hasLetters))];
  if (!list.length) return new Map();
  const rows = await VM().find({ canonKey: { $in: list } }).select('_id canonKey').lean();
  return new Map(rows.map((r) => [r.canonKey, r._id]));
}

/**
 * يربط كلَّ وحدةٍ وكلَّ سطحةٍ بمركبتها في السجلّ. يكتب ما تغيّر وحدَه، ويُرجع
 * الأعداد. `apply=false` عرضٌ فقط (لسكربت الإكمال).
 */
async function linkLs2Fleet({ apply = true } = {}) {
  const [units, flatbeds] = await Promise.all([
    Ls2Vehicle.find({}).select('unitId name plate profile.registrationPlate vehicleMaster').lean(),
    Ls2Flatbed.find({}).select('plate plateKey vehicleMaster').lean(),
  ]);
  const unitKeys = units.map(unitCanonKey);
  const flatKeys = flatbeds.map((f) => canonicalPlateKey(f.plate));
  const byKey = await registryByKeys([...unitKeys, ...flatKeys]);

  const out = { units: units.length, unitsLinked: 0, unitsChanged: 0, unitsUnlinked: [], flatbeds: flatbeds.length, flatbedsLinked: 0, flatbedsChanged: 0, flatbedsUnlinked: [], unitMap: new Map() };
  const unitOps = [];
  const vmByDigits = new Map(); // أرقامُ الوحدة ← مركبتُها (للسطحات بلا حروف)
  units.forEach((u, i) => {
    const id = byKey.get(unitKeys[i]) || null;
    if (id) { out.unitsLinked += 1; vmByDigits.set(vehiclePlateKey(u), id); out.unitMap.set(u.unitId, id); } else out.unitsUnlinked.push(unitPlate(u) || u.name || String(u.unitId));
    if (String(u.vehicleMaster || '') !== String(id || '')) {
      out.unitsChanged += 1;
      unitOps.push({ updateOne: { filter: { _id: u._id }, update: { $set: { vehicleMaster: id } } } });
    }
  });
  const flatOps = [];
  flatbeds.forEach((f, i) => {
    const k = flatKeys[i];
    const id = (hasLetters(k) ? byKey.get(k) : vmByDigits.get(f.plateKey || plateKey(f.plate))) || null;
    if (id) out.flatbedsLinked += 1; else out.flatbedsUnlinked.push(f.plate);
    if (String(f.vehicleMaster || '') !== String(id || '')) {
      out.flatbedsChanged += 1;
      flatOps.push({ updateOne: { filter: { _id: f._id }, update: { $set: { vehicleMaster: id } } } });
    }
  });
  if (apply) {
    // بلا طوابع زمنيّة: الربطُ ليس تعديلًا على الشاحنة.
    if (unitOps.length) await Ls2Vehicle.bulkWrite(unitOps, { ordered: false, timestamps: false });
    if (flatOps.length) await Ls2Flatbed.bulkWrite(flatOps, { ordered: false, timestamps: false });
  }
  return out;
}

/**
 * لوحةٌ مكتوبةٌ نصًّا في قسم النقل الثقيل (حركةُ مخزن، قيدُ عهدة) ← مركبتُها.
 * بحروفها: السجلُّ بالمفتاح الموحَّد. وبأرقامها وحدها: وحدةُ لوكيشن التي تحملها
 * (أسطولُنا الثقيل فريدٌ بأرقامه)، ثمّ مركبتُها. وإلّا null — والنصُّ يبقى كما كُتب.
 */
async function resolveLs2Plate(plate, opts = {}) {
  const raw = String(plate || '').trim();
  if (!raw) return null;
  return (await resolveLs2Plates([raw], opts)).get(raw) || null;
}

/**
 * أرقامُ كلّ وحدةٍ في الأسطول ← مركبتُها في السجلّ، محسوبةً من لوحة الوحدة
 * بالمفتاح الموحَّد لا من الحقل المخزَّن — فيصحّ قبل الإكمال وبعده سواء.
 */
async function fleetByDigits() {
  const units = await Ls2Vehicle.find({}).select('plate name profile.registrationPlate').lean();
  const keys = units.map(unitCanonKey);
  const byKey = await registryByKeys(keys);
  const m = new Map();
  units.forEach((u, i) => { const id = byKey.get(keys[i]); if (id) m.set(vehiclePlateKey(u), id); });
  return m;
}

/** حلٌّ دفعةً واحدة لعدّة لوحات: Map من النصّ كما كُتب إلى المعرّف أو null. */
async function resolveLs2Plates(plates, { heavy = true } = {}) {
  const list = [...new Set((plates || []).map((p) => String(p || '').trim()).filter(Boolean))];
  const out = new Map();
  if (!list.length) return out;
  const keys = list.map(canonicalPlateKey);
  const byKey = await registryByKeys(keys);
  let byDigits = null;
  for (let i = 0; i < list.length; i += 1) {
    let id = hasLetters(keys[i]) ? byKey.get(keys[i]) || null : null;
    // والأرقامُ وحدها حين يكون المكتوبُ أرقامًا لا غير («2708»): نصٌّ فيه رقمٌ
    // («سيارة الورشة/ 6939»، «فاتورة 11020») ليس لوحةً ولا يُخمَّن له.
    if (!id && heavy && /^\s*[0-9٠-٩]+\s*$/.test(list[i])) {
      const d = plateKey(list[i]);
      if (d) {
        // eslint-disable-next-line no-await-in-loop
        if (!byDigits) byDigits = await fleetByDigits();
        id = byDigits.get(d) || null;
      }
    }
    out.set(list[i], id);
  }
  return out;
}

// ── الهويّةُ من السجلّ عند العرض ──────────────────────────────────────────────

const REG_SELECT = 'plateNumber brandAr modelAr modelYear chassisNumber sectorAr sectorCode serviceStatusAr '
  + 'vehicleLicense.expiryDate vehicleLicense.statusCode inspection.expiryDate inspection.statusCode '
  + 'insurance.expiryDate insurance.statusCode operatingCard.expiryDate operatingCard.statusCode '
  + 'authorizedPerson.name authorizedPerson.expiryDate authorizedPerson.statusCode';
const REG_DOCS = ['vehicleLicense', 'inspection', 'insurance', 'operatingCard', 'authorization'];

const normVin = (s) => String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, '');

/**
 * ما يقوله الجهاز وما يقوله السجلّ. الفارغُ لا يُعدّ تعارضًا (نقصٌ لا خلاف).
 * ورقمُ شاسيه الجهاز إن كان ذيلَ رقم السجلّ («546250») فهو جزئيّ لا مخالف.
 */
function compareIdentity(profile, reg) {
  const out = {};
  const dYear = String(profile?.modelYear || '').trim();
  const rYear = reg?.modelYear != null ? String(reg.modelYear) : '';
  if (dYear && rYear && dYear !== rYear) out.year = { registry: rYear, device: dYear };
  const dVin = normVin(profile?.vin);
  const rVin = normVin(reg?.chassisNumber);
  if (dVin && rVin && dVin !== rVin) {
    out.vin = { registry: reg.chassisNumber, device: profile.vin, partial: rVin.endsWith(dVin) || dVin.endsWith(rVin) };
  }
  return out;
}

let alertsCache = { at: 0, v: {} };
async function docAlerts() {
  if (Date.now() - alertsCache.at < 60000) return alertsCache.v;
  const { VehicleRegistryConfig } = require('../models/VehicleMaster');
  const cfg = await VehicleRegistryConfig.findOne({ key: 'vehicle-registry' }).select('alerts').lean().catch(() => null);
  alertsCache = { at: Date.now(), v: cfg?.alerts || {} };
  return alertsCache.v;
}

function registryCard(reg, alerts) {
  const VDOC = require('../config/vehicleDocuments');
  const docs = {};
  for (const key of REG_DOCS) {
    const d = key === 'authorization' ? reg.authorizedPerson : reg[key];
    const st = VDOC.stateOf(d?.expiryDate, d?.statusCode, alerts?.[key] || {});
    docs[key] = { expiryDate: d?.expiryDate || null, state: VDOC.publicState(st.state), days: st.days };
  }
  return {
    _id: reg._id,
    plateNumber: reg.plateNumber || '',
    brand: reg.brandAr || '',
    model: reg.modelAr || '',
    modelYear: reg.modelYear ?? null,
    chassisNumber: reg.chassisNumber || '',
    sector: reg.sectorAr || '',
    serviceStatus: reg.serviceStatusAr || '',
    authorizedPerson: reg.authorizedPerson?.name || '',
    docs,
  };
}

/**
 * يُلحق بكلّ صفٍّ `registry` (هويّةُ السجلّ ومستنداته) و`conflicts`. يُقرأ من
 * السجلّ عند كلّ طلب — لا يمرّ بذاكرة القسم المؤقّتة — فتعديلٌ في سجلّ المركبات
 * يظهر هنا في الطلب التالي، ولا يحتاج قسمُ المركبات أن يعرف ذاكرةَ هذا القسم.
 */
async function attachRegistry(rows) {
  const ids = [...new Set(rows.map((r) => r.vehicleMaster && String(r.vehicleMaster)).filter(Boolean))];
  const [regs, alerts] = await Promise.all([
    ids.length ? VM().find({ _id: { $in: ids } }).select(REG_SELECT).lean() : [],
    ids.length ? docAlerts() : {},
  ]);
  const byId = new Map(regs.map((r) => [String(r._id), r]));
  return rows.map((r) => {
    const reg = r.vehicleMaster ? byId.get(String(r.vehicleMaster)) : null;
    return { ...r, registry: reg ? registryCard(reg, alerts) : null, conflicts: reg ? compareIdentity(r.profile, reg) : {} };
  });
}

module.exports = {
  linkLs2Fleet, resolveLs2Plate, resolveLs2Plates, attachRegistry, compareIdentity, unitPlate, unitCanonKey,
};
