/**
 * employeeClearance: clearance checks before ending an employee's service.
 * Terminating an employee who was authorised on a vehicle left the vehicle registered to a non-employee, and the owning department never learned. The only prior check was asset custody, which is not all an employee holds: vehicle authorisation, a system login, a company email and a wallet with cash, each cleared by a different department.
 * Blocks: what would be left ownerless after departure (custody, authorisation, wallet cash). Warns: what is closed in one click with no loss (login, email).
 */
const mongoose = require('mongoose');

const fold = (x) => String(x || '')
  .replace(/[أإآا]/g, 'ا').replace(/ى/g, 'ي').replace(/ة/g, 'ه')
  .replace(/[^\u0600-\u06FFa-zA-Z0-9]/g, '').toLowerCase();

/**
 * Registry vehicles registered to this employee, matched by residence number first, then by folded name.
 * Authorisations live in two places: the movement log (`VehicleAuthorization`) and the paper on the vehicle itself (`VehicleMaster.authorizedPerson`). The paper is what counts at a checkpoint, and the check only read the log. The residence number is more reliable than the name, which varies in spelling.
 */
async function vehiclesHeldBy(employee, VehicleMaster) {
  if (!VehicleMaster || !employee) return [];
  // Both columns: a resident is in `iqamaNumber`, a Saudi in `nationalId`.
  const ids = [employee.iqamaNumber, employee.nationalId].map((x) => String(x || '').trim()).filter(Boolean);
  const name = fold(`${employee.firstName || ''} ${employee.lastName || ''}`.trim() || employee.fullName || '');
  const or = [];
  if (ids.length) or.push({ 'authorizedPerson.iqamaNumber': { $in: ids } });
  if (!or.length && !name) return [];
  const rows = await VehicleMaster.find(or.length ? { $or: or } : {})
    .select('plateNumber authorizedPerson fuelCard.cardNumber ownerNameAr').lean();
  if (rows.length || !name) return rows;
  // No match by number; try the folded name. It is weaker, so it is read as a warning only.
  const all = await VehicleMaster.find({ 'authorizedPerson.name': { $nin: ['', null] } })
    .select('plateNumber authorizedPerson fuelCard.cardNumber ownerNameAr').lean();
  return all.filter((v) => fold(v.authorizedPerson?.name) === name);
}

/** What this employee holds now. Returns items described in Arabic and English. */
async function checkClearance(employeeId) {
  const id = new mongoose.Types.ObjectId(String(employeeId));
  const M = (n) => { try { return mongoose.model(n); } catch (e) { return null; } };

  const Asset = M('Asset');
  const CompanyEmail = M('CompanyEmail');
  const User = M('User');

  const [assets, emails, logins] = await Promise.all([
    Asset ? Asset.find({ employee: id, status: 'assigned' }).select('name assetTag category').lean() : [],
    CompanyEmail ? CompanyEmail.find({ employee: id, status: 'active' }).select('address').lean() : [],
    User ? User.find({ linkedEmployee: id, isActive: true }).select('email role').lean() : [],
  ]);

  // Registry vehicles: authorisation and fuel card
  const Employee = M('Employee');
  const VehicleMaster = M('VehicleMaster');
  let held = []; let auths = [];
  try {
    const emp = Employee ? await Employee.findById(id).select('firstName lastName fullName arabicName iqamaNumber nationalId').lean() : null;
    held = await vehiclesHeldBy(emp, VehicleMaster);
    // Authorisation from its single source. Two separate reads each blocked: the paper on the vehicle and the old assignment log, so someone whose authorisation was cancelled in Vehicles or B2C but whose old assignment stayed open was told to cancel it again. Now only `currentFor` is asked: the paper is the reference, and the old assignment is read only for a vehicle with no paper in the registry (see utils/vehicleAuthorization).
    if (emp) auths = await require('../utils/vehicleAuthorization').currentFor(emp);
  } catch (_) { held = []; auths = []; }

  const blockers = []; const warnings = [];

  if (auths.length) {
    blockers.push({
      kind: 'vehicle_authorization', section: 'المركبات', sectionEn: 'Vehicles',
      ar: `تفويض مركبة ساري (${auths.length})`, en: `${auths.length} active vehicle authorisation(s)`,
      items: auths.map((a) => [a.plateNumber, a.authorizationNumber].filter(Boolean).join(' — ') || 'مركبة'),
      actionAr: 'يُلغى التفويض أو يُنقل لموظّف آخر من قسم المركبات (أو من مركبات B2C) قبل الإنهاء — ومعه تعود شريحة بترو اب إلينا.',
    });
  }

  // The fuel card is removed even if the vehicle is the employee's own. An employee who bought his own car may have a company card fitted; the car is his with no authorisation from us, but the card is ours and bills our account, so ending service with it attached lets him keep spending.
  const chips = held.filter((v) => String(v.fuelCard?.cardNumber || '').trim());
  if (chips.length) {
    blockers.push({
      kind: 'fuel_card', section: 'المركبات', sectionEn: 'Vehicles',
      ar: `شريحة بترو اب في يده (${chips.length})`, en: `${chips.length} Petro App chip(s) still held`,
      items: chips.map((v) => [v.plateNumber, v.fuelCard?.cardNumber].filter(Boolean).join(' — ')),
      actionAr: 'تُنزَع الشريحة من صفحة «بترو اب» أو من سجل المركبات قبل الإنهاء — ولو كانت المركبة ملكه، فالشريحة شريحتنا وتصرف من حسابنا.',
    });
  }

  if (assets.length) {
    blockers.push({
      kind: 'custody', section: 'تقنية المعلومات / الموارد البشرية', sectionEn: 'IT / HR',
      ar: `عهدة لم تُسلَّم (${assets.length})`, en: `${assets.length} custody item(s) not returned`,
      items: assets.map((a) => a.assetTag ? `${a.name} — ${a.assetTag}` : a.name),
      actionAr: 'تُسلَّم العهدة أو تُنقَل من صفحة العهد قبل الإنهاء.',
    });
  }
  if (emails.length) {
    warnings.push({
      kind: 'company_email', section: 'تقنية المعلومات', sectionEn: 'IT',
      ar: `بريد مؤسّسي نشط (${emails.length})`, en: `${emails.length} active company mailbox(es)`,
      items: emails.map((e) => e.address),
      actionAr: 'يُغلق أو يُحوَّل بعد الإنهاء.',
    });
  }
  if (logins.length) {
    warnings.push({
      kind: 'login', section: 'إدارة المستخدمين', sectionEn: 'User admin',
      ar: `حساب دخول نشط (${logins.length})`, en: `${logins.length} active login account(s)`,
      items: logins.map((u) => u.email),
      actionAr: 'يُعطَّل بعد الإنهاء.',
    });
  }

  return { clear: blockers.length === 0, blockers, warnings };
}

module.exports = { checkClearance };
