/* eslint-disable no-console */
/**
 * مراجعةُ سلامة البيانات — هل ما في القاعدة يشير إلى شيءٍ موجود؟
 *
 *   node src/scripts/auditDataIntegrity.js
 *
 * ── ما الذي يُفحَص ─────────────────────────────────────────────────────────
 * المرجعُ المعلَّق لا يُخطئ ولا يُسجَّل: يُطلَب `populate` فيعود `null`،
 * فتُعرض شرطةٌ مكان اسمٍ ويُظنُّ أنّ الخانة فارغة. وأخطرُه ما يحمل مالًا —
 * فاتورةٌ على عميلٍ حُذف، أو عهدةٌ على موظّفٍ لم يعد.
 */
require('dotenv').config({ path: require('path').join(__dirname, '../../.env') });
const mongoose = require('mongoose');

// [النموذج, الحقل, نموذجُ الهدف, وصفٌ عربيّ]
const LINKS = [
  ['Contract', 'employee', 'Employee', 'عقدٌ على موظّف'],
  ['LeaveRequest', 'employee', 'Employee', 'إجازةٌ على موظّف'],
  ['LeaveRequest', 'leaveType', 'LeaveType', 'إجازةٌ على نوع'],
  ['HRRequest', 'employee', 'Employee', 'طلبٌ على موظّف'],
  ['Asset', 'employee', 'Employee', 'عهدةٌ على موظّف'],
  ['EmployeeDocument', 'employee', 'Employee', 'مستندٌ على موظّف'],
  ['EmployeeRenewal', 'employee', 'Employee', 'تجديدٌ على موظّف'],
  ['User', 'linkedEmployee', 'Employee', 'حسابٌ على ملفّ موظّف'],
  ['User', 'manager', 'User', 'حسابٌ على مديره'],
  ['FleetShipment', 'vehicle', 'FleetVehicle', 'حمولةٌ على سيّارة'],
  ['FleetShipment', 'driver', 'FleetDriver', 'حمولةٌ على سائق'],
  ['FleetShipment', 'customer', 'FleetCustomer', 'حمولةٌ على عميل'],
  ['FleetEvent', 'shipment', 'FleetShipment', 'حدثٌ على حمولة'],
  ['FleetVehicleLog', 'vehicle', 'FleetVehicle', 'قيدُ سجلٍّ على سيّارة'],
  ['FleetVehicleLog', 'shipment', 'FleetShipment', 'قيدُ سجلٍّ على حمولة'],
  ['CustomsClearance', 'customer', 'Customer', 'معاملةُ تخليصٍ على عميل'],
  ['VehicleAuthorization', 'vehicle', 'Vehicle', 'تفويضٌ على مركبة'],
  ['VehicleAuthorization', 'employee', 'Employee', 'تفويضٌ على موظّف'],
  ['VehicleClaim', 'vehicle', 'VehicleMaster', 'مطالبةٌ على مركبة'],
];

const MODEL_PATH = {
  Contract: 'Contract', LeaveRequest: 'LeaveRequest', LeaveType: 'LeaveType',
  HRRequest: 'HRRequest', Asset: 'Asset', EmployeeDocument: 'EmployeeDocument',
  EmployeeRenewal: 'EmployeeRenewal', User: 'User', Employee: 'Employee',
  Customer: 'Customer', Vehicle: 'Vehicle', VehicleAuthorization: 'VehicleAuthorization',
  VehicleClaim: 'VehicleClaim', CustomsClearance: 'CustomsClearance',
  FleetVehicleLog: 'FleetVehicleLog',
};
const FLEET = ['FleetVehicle', 'FleetDriver', 'FleetCustomer', 'FleetShipment', 'FleetEvent'];
const VehicleMaster = () => require('../models/VehicleMaster').VehicleMaster;

const load = (name) => {
  if (FLEET.includes(name)) return require('../models/FleetModels')[name];
  if (name === 'VehicleMaster') return VehicleMaster();
  return require(`../models/${MODEL_PATH[name] || name}`);
};

(async () => {
  await mongoose.connect(process.env.MONGODB_URI);
  console.log('\n' + '='.repeat(74));
  console.log('  مراجعةُ سلامة البيانات — المراجع المعلَّقة');
  console.log('='.repeat(74));

  let broken = 0;
  for (const [from, field, to, label] of LINKS) {
    let A; let B;
    try { A = load(from); B = load(to); } catch (e) { console.log(`  ? ${label} — نموذجٌ لا يُحمَّل`); continue; }
    // eslint-disable-next-line no-await-in-loop
    // `$ne: null` لا `$nin: [null, '']` — الحقلُ ObjectId، والسلسلةُ الفارغة
    // في شرطٍ عليه تُرمى قبل أن تُنفَّذ الاستعلامة.
    const rows = (await A.find({ [field]: { $ne: null } }).select(field).lean())
      .filter((r) => r[field]);
    if (!rows.length) { console.log(`  · ${label.padEnd(28)} 0`); continue; }
    const ids = [...new Set(rows.map((r) => String(r[field])))];
    // eslint-disable-next-line no-await-in-loop
    const found = await B.find({ _id: { $in: ids } }).select('_id').lean();
    const have = new Set(found.map((x) => String(x._id)));
    const dangling = ids.filter((x) => !have.has(x));
    broken += dangling.length;
    const mark = dangling.length ? '✗' : '✓';
    console.log(`  ${mark} ${label.padEnd(28)} ${String(rows.length).padStart(6)} سجلًّا · معلَّق: ${dangling.length}`);
  }

  // ── أرقامٌ يجب أن تتّسق ──────────────────────────────────────────────────
  console.log('\n  اتّساقُ الأرقام:');
  const Cust = require('../models/CustomsClearance');
  const { recomputeTotals } = Cust;
  const cc = await Cust.find({}).select('costs revenue refNumber').lean();
  let drift = 0;
  for (const c of cc) {
    const copy = recomputeTotals(JSON.parse(JSON.stringify({ costs: c.costs, revenue: c.revenue })));
    if (Math.abs((copy.costs.total || 0) - (c.costs?.total || 0)) > 0.02
      || Math.abs((copy.revenue.profit || 0) - (c.revenue?.profit || 0)) > 0.02) drift += 1;
  }
  console.log(`  ${drift ? '✗' : '✓'} التخليص: ${cc.length} معاملة · أرقامٌ لا تطابق مدخلاتها: ${drift}`);
  broken += drift;

  const Employee = require('../models/Employee');
  const dupNum = await Employee.aggregate([
    { $match: { employeeNumber: { $nin: [null, ''] } } },
    { $group: { _id: '$employeeNumber', n: { $sum: 1 } } }, { $match: { n: { $gt: 1 } } },
  ]);
  console.log(`  ${dupNum.length ? '✗' : '✓'} أرقامُ موظّفين مكرّرة: ${dupNum.length}`);
  broken += dupNum.length;

  const User = require('../models/User');
  const R = require('../config/roles');
  const known = new Set(R.ALL_ROLES);
  const badRole = (await User.find({}).select('role email').lean()).filter((u) => !known.has(u.role));
  console.log(`  ${badRole.length ? '✗' : '✓'} حساباتٌ بدورٍ غير معتمَد: ${badRole.length}${badRole.length ? ' — ' + badRole.map((u) => u.email).join(', ') : ''}`);
  broken += badRole.length;

  console.log(`\n  المشكلات: ${broken}`);
  if (!broken) console.log('   ✓ لا مرجعَ معلَّقٌ ولا رقمَ منحرف');
  console.log('');
  await mongoose.disconnect();
  process.exit(broken ? 1 : 0);
})().catch(async (e) => { console.error(e); try { await mongoose.disconnect(); } catch (_) {} process.exit(1); });
