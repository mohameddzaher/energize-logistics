/**
 * fleetIdentity — شاحنةُ الأسطول وسائقُه يُقرآن من سجلّيهما لا من نسخة.
 *
 * ── القاعدة (صاحبُ الشركة، ٢٠٢٦/١٠/٢١) ──────────────────────────────────────
 * «سجلٌّ واحدٌ لكلّ مركبةٍ ولكلّ شخصٍ في النظام كلِّه؛ وأيُّ تعديلٍ يظهر في كلّ
 * مكانٍ فورًا». وكان الأسطولُ يحمل نسخًا: الماركةُ واللونُ على `FleetVehicle`
 * بلا صلةٍ بسجلّ المركبات، والاسمُ والجوالُ والإقامةُ والجنسيّةُ والإيبانُ على
 * `FleetDriver` بلا صلةٍ بملفّ الموارد البشريّة. فيُصحَّح الشيءُ هناك ويبقى
 * خطؤه هنا.
 *
 * ── فصار لكلٍّ منهما مرجع ─────────────────────────────────────────────────
 *   `FleetVehicle.vehicleMaster` ← VehicleMaster: الهويّةُ (اللوحة، الماركة،
 *       الطراز، السنة، الهيكل، اللون) والمستنداتُ وانتهاؤها — تُقرأ من هناك.
 *   `FleetDriver.employee` ← Employee: الاسمُ والجوالُ ورقمُ الهويّة والجنسيّةُ
 *       والإيبان — من الملفّ؛ وحالةُ العمل تتبع إجازتَه وإنهاءَ خدمته هناك.
 * والنصُّ المخزَّنُ على صفّ الأسطول يبقى احتياطًا لِمَن لم يُربط بعد، لا مصدرًا.
 *
 * ولا يمسّ هذا لقطاتِ البوليصة (`FleetShipment.vehiclePlate` …): البوليصةُ
 * مستندٌ قانونيٌّ يُقرأ كما صدر.
 */
const S = (v) => String(v == null ? '' : v).trim();
const cache = require('./ttlCache');

// ── المركبة ─────────────────────────────────────────────────────────────────

/** ما يُقرأ من سجلّ المركبات لشاحنة الأسطول — الهويّةُ والمستنداتُ المؤرَّخة. */
const REGISTRY_SELECT = [
  'plateNumber', 'canonKey', 'brandAr', 'modelAr', 'modelYear', 'chassisNumber', 'colorAr',
  'sectorAr', 'serviceStatusAr', 'isActive',
  'insurance.expiryDate', 'insurance.statusCode',
  'operatingCard.expiryDate', 'operatingCard.statusCode', 'operatingCard.cardNumber',
  'vehicleLicense.expiryDate', 'vehicleLicense.statusCode',
  'inspection.expiryDate', 'inspection.statusCode',
  'authorizedPerson.expiryDate', 'authorizedPerson.statusCode', 'authorizedPerson.name',
].join(' ');

// اشتراكُ التتبّع خارج القائمة: تنبيهُه معطَّلٌ افتراضًا، وأسطولُنا على LS.
const FLEET_DOCS = ['insurance', 'operatingCard', 'vehicleLicense', 'inspection', 'authorization'];

/**
 * عتباتُ التنبيه من إعدادات قسم المركبات — بالحساب نفسِه (`VDOC.stateOf`)
 * وإلّا قالت شاشتان لوثيقةٍ واحدةٍ حالتين. والمفتاحُ تحت `vreg:` فيُمسَح مع
 * كلّ تغييرٍ في إعداداتهم.
 */
const docAlerts = () => cache.wrap('vreg:fleet-doc-alerts', 60000, async () => {
  const { VehicleRegistryConfig } = require('../models/VehicleMaster');
  const cfg = await VehicleRegistryConfig.findOne({ key: 'vehicle-registry' }).select('alerts').lean();
  return (cfg && cfg.alerts) || {};
});

const getPath = (o, p) => p.split('.').reduce((x, k) => (x == null ? x : x[k]), o);

/** صورةُ المركبة كما يقرؤها الأسطول من السجلّ. */
function registryView(vm, alerts = {}) {
  if (!vm) return null;
  const VDOC = require('../config/vehicleDocuments');
  const docs = FLEET_DOCS.map((key) => {
    const d = VDOC.getDoc(key);
    const expiryDate = getPath(vm, d.path) || null;
    const st = VDOC.stateOf(expiryDate, getPath(vm, d.statusPath) || '', alerts[key] || {});
    return { key, ar: d.ar, en: d.en, expiryDate, state: VDOC.publicState(st.state), days: st.days };
  });
  return {
    _id: vm._id,
    plateNumber: vm.plateNumber || '',
    brand: vm.brandAr || '',
    model: vm.modelAr || '',
    year: vm.modelYear || null,
    chassis: vm.chassisNumber || '',
    color: vm.colorAr || '',
    sector: vm.sectorAr || '',
    serviceStatus: vm.serviceStatusAr || '',
    docs,
  };
}

/**
 * يُلحق بكلّ صفٍّ من صفوف `FleetVehicle` صورتَه من السجلّ (`registry`)، وتُقرأ
 * الماركةُ واللونُ منه — والنسخةُ احتياطٌ لغير المربوط. سؤالٌ واحدٌ للصفوف كلِّها.
 */
async function decorateVehicles(rows) {
  const list = (rows || []).filter(Boolean);
  const ids = [...new Set(list.map((v) => v.vehicleMaster && String(v.vehicleMaster._id || v.vehicleMaster)).filter(Boolean))];
  if (!ids.length) {
    for (const v of list) { v.registry = null; v.linked = false; }
    return rows;
  }
  const { VehicleMaster } = require('../models/VehicleMaster');
  const [vms, alerts] = await Promise.all([
    VehicleMaster.find({ _id: { $in: ids } }).select(REGISTRY_SELECT).lean(),
    docAlerts(),
  ]);
  const byId = new Map(vms.map((m) => [String(m._id), m]));
  for (const v of list) {
    const vm = v.vehicleMaster ? byId.get(String(v.vehicleMaster._id || v.vehicleMaster)) : null;
    const reg = registryView(vm, alerts);
    v.registry = reg;
    v.linked = !!reg;
    if (reg) {
      // ما في السجلّ هو الجواب؛ والنسخةُ تُقرأ إن كانت خانةُ السجلّ فارغة.
      v.brand = reg.brand || v.brand || '';
      v.color = reg.color || v.color || '';
    }
  }
  return rows;
}

/** هويّةُ مركبةٍ واحدة (لقطةُ البوليصة عند الإنشاء). */
async function vehicleIdentity(fleetVehicle) {
  if (!fleetVehicle) return null;
  const row = { ...fleetVehicle };
  await decorateVehicles([row]);
  return row;
}

// ── السائق ──────────────────────────────────────────────────────────────────

const HR_SELECT = 'firstName lastName arabicName phone nationality iban idType iqamaNumber nationalId '
  + 'employmentStatus department jobTitle staffCategory employeeNumber';

const hrName = (e) => S(e && (e.arabicName || `${e.firstName || ''} ${e.lastName || ''}`));
/** رقمُ الهويّة بعمودَيه — راجع identity-number-two-columns. */
const hrIdNumber = (e) => (e ? S(e.idType === 'national_id' ? (e.nationalId || e.iqamaNumber) : (e.iqamaNumber || e.nationalId)) : '');

/**
 * يُلحق بصفوف `FleetDriver` ما في ملفّ الموارد البشريّة لمن رُبط:
 *   · الاسمُ والجوالُ ورقمُ الهويّة والجنسيّةُ والإيبان — من الملفّ، والمخزَّنُ
 *     احتياطٌ إن كانت خانةُ الملفّ فارغة؛
 *   · وحالةُ العمل: مَن انتهت خدمتُه أو هو في إجازةٍ (حالةُ الملفّ، أو إجازةٌ
 *     معتمَدةٌ تشمل اليوم) أو موقوفٌ — لا يعمل، ومصدرُ ذلك الموارد البشريّة
 *     (`offSource: 'hr'`). والموارد البشريّة وحدَها تكتب حالةَ العمل، فلا يُكتب
 *     هذا على صفّ الأسطول: يُقرأ في كلّ طلب.
 * سؤالان للصفوف كلِّها، لا سؤالٌ لكلّ صفّ.
 */
async function decorateDrivers(rows) {
  const list = (rows || []).filter(Boolean);
  const ids = [...new Set(list.map((d) => d.employee && String(d.employee._id || d.employee)).filter(Boolean))];
  for (const d of list) { d.hr = null; d.hrLinked = false; }
  if (!ids.length) return rows;
  const Employee = require('../models/Employee');
  const LeaveRequest = require('../models/LeaveRequest');
  const today = require('./companyDay').todayKey();
  const [emps, leaves] = await Promise.all([
    Employee.find({ _id: { $in: ids } }).select(HR_SELECT).lean(),
    LeaveRequest.find({ employee: { $in: ids }, status: 'approved', startDate: { $lte: today }, endDate: { $gte: today } })
      .select('employee').lean(),
  ]);
  const byId = new Map(emps.map((e) => [String(e._id), e]));
  const onLeave = new Set(leaves.map((l) => String(l.employee)));
  for (const d of list) {
    const e = d.employee ? byId.get(String(d.employee._id || d.employee)) : null;
    if (!e) continue;
    const status = e.employmentStatus || 'active';
    const leave = status === 'on_leave' || onLeave.has(String(e._id));
    d.hr = {
      _id: e._id,
      name: hrName(e),
      employeeNumber: e.employeeNumber || '',
      employmentStatus: status,
      department: e.department || '',
      jobTitle: e.jobTitle || '',
      onLeave: leave,
    };
    d.hrLinked = true;
    d.employee = e._id;
    d.name = hrName(e) || d.name;
    d.phone = S(e.phone) || d.phone || '';
    d.iqama = hrIdNumber(e) || d.iqama || '';
    d.nationality = S(e.nationality) || d.nationality || '';
    d.iban = S(e.iban) || d.iban || '';
    // حالةُ الملفّ تغلب حالةَ القسم حين تقول «لا يعمل»؛ وإلّا فما كتبه القسم.
    if (status === 'terminated') {
      d.working = false; d.offReason = 'other'; d.offNote = 'انتهت خدمته في الموارد البشرية'; d.offSource = 'hr';
    } else if (status === 'suspended') {
      d.working = false; d.offReason = 'other'; d.offNote = 'موقوف في الموارد البشرية'; d.offSource = 'hr';
    } else if (leave) {
      d.working = false; d.offReason = 'leave'; d.offNote = d.offNote || 'إجازة معتمدة في الموارد البشرية'; d.offSource = 'hr';
    }
  }
  return rows;
}

/** سائقٌ واحد — لقطةُ البوليصة عند الإنشاء تُقرأ من ملفّه. */
async function driverIdentity(driver) {
  if (!driver) return null;
  const row = driver.toObject ? driver.toObject() : { ...driver };
  await decorateDrivers([row]);
  return row;
}

/** حقولٌ يملكها ملفُّ الموارد البشريّة متى رُبط السائق — لا تُكتب من الأسطول. */
const HR_OWNED_DRIVER_FIELDS = ['name', 'phone', 'iqama', 'nationality', 'iban'];

/**
 * الموظّفُ الذي يحمل رقمَ الهويّة هذا — بالعمودين، لا يُقبَل إلّا واحدٌ بعينه.
 */
async function employeeByIdNumber(idNumber) {
  const n = S(idNumber).replace(/\s+/g, '');
  if (!n) return null;
  const Employee = require('../models/Employee');
  const rows = await Employee.find({ $or: [{ iqamaNumber: n }, { nationalId: n }] }).select('_id').limit(2).lean();
  return rows.length === 1 ? rows[0] : null;
}

/**
 * يعلن تغييرًا في سجلّ المركبات بالطريقة التي يعلنه بها قسمُ المركبات: تُمسَح
 * مخازنُه ثمّ يُرسَل حدثُه (الإبطالُ قبل الإعلان — راجع announce-before-invalidate).
 */
function announceRegistry() {
  require('./vehicleAnnounce').announceVehicles({ from: 'fleet' });
}

module.exports = {
  REGISTRY_SELECT, registryView, decorateVehicles, vehicleIdentity, docAlerts,
  HR_SELECT, hrName, hrIdNumber, decorateDrivers, driverIdentity, HR_OWNED_DRIVER_FIELDS,
  employeeByIdNumber, announceRegistry,
};
