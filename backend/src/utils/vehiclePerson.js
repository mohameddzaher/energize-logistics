/**
 * vehiclePerson: the person on a vehicle is chosen from employees, never typed by hand.
 * What happened: in the B2C board's vehicles-without-rider view, vehicles were opened by names in the actual-driver column. The name was a text field: someone typed "not used", someone's name had never been linked to the vehicle in the section register, and a man who had moved to another vehicle stayed in it. The request: the actual driver, the authorized person and every person field on a vehicle become a searchable dropdown of the section's employees, so the data is unified.
 * Rules:
 * - A field is sent as a reference (HR file id or light-transport row) or an ID number, and the name, ID and phone are read from it. A bare name is accepted only if it matches exactly one employee (older clients send names), otherwise rejected with a clear message. - An archived or ended employee cannot be chosen: a vehicle is not handed to someone who left. - The dropdown itself is built from here (`options`): light-transport employees first for the section's vehicles, then HR employees, so what is shown is what is accepted.
 */
const mongoose = require('mongoose');
const PR = require('./personRef');

const S = (v) => String(v == null ? '' : v).trim();
const idKey = (v) => S(v).replace(/[٠-٩]/g, (d) => '٠١٢٣٤٥٦٧٨٩'.indexOf(d)).replace(/\s+/g, '');
const bad = (message) => Object.assign(new Error(message), { status: 400, bad: true });

/** Texts put in place of a name that are not names: "not used", "none", "-". */
const PLACEHOLDER_RX = /^(?:[-–—_.\s0]*|غير\s*مستخدم[ةه]?|غيرمستخدم[ةه]?|لا\s*يوجد|لايوجد|بدون|بلا|غير\s*محدد|n\/?a|none|null|nil|unused|not\s*used|-+)$/i;
const isPlaceholder = (v) => PLACEHOLDER_RX.test(S(v));

const HR_SELECT = 'firstName lastName arabicName fullName iqamaNumber nationalId idType phone jobTitle department employmentStatus isHrRecord systemStatus registerNumber';
const LT_SELECT = 'name idNumber phone jobTitleAr projectAr cityAr vehicle vehiclePlate employee isActive workStatusAr';

async function archiveSets() {
  return require('./endedStaff').endedStaff();
}

/** Ended? From his file, otherwise from the section register for someone with no file. */
const hrEnded = (e) => !!e && e.employmentStatus === 'terminated';
const ltEnded = (l, hr) => (hr ? hrEnded(hr) : /انهاء|إنهاء/.test(S(l?.workStatusAr)));

function shape({ hr, lt }) {
  const name = (hr && PR.canonicalName(hr)) || S(lt?.name);
  const idNumber = idKey(lt?.idNumber) || (hr ? PR.primaryId(hr) : '');
  return {
    name,
    idNumber,
    phone: S(hr?.phone) || S(lt?.phone),
    jobTitleAr: S(lt?.jobTitleAr) || S(hr?.jobTitle),
    employee: hr || null,
    employeeId: hr ? String(hr._id) : '',
    lt: lt || null,
    ltId: lt ? String(lt._id) : '',
  };
}

/**
 * Resolves the submitted person, or throws an error whose message is shown as is.
 * @param input  { employeeId?, ltId?, idNumber?, name? }
 * @param opts.needLt   the rider can only come from the light-transport register.
 * @param opts.label    the field's name in the message (actual driver, authorized person). @returns null if the field is empty (clearing), otherwise the person.
 */
async function resolvePerson(input = {}, { needLt = false, label = 'الشخص' } = {}) {
  const Employee = require('../models/Employee');
  const { LightTransportEmployee } = require('../models/LightTransport');
  const employeeId = S(input.employeeId);
  const ltId = S(input.ltId);
  const idNumber = idKey(input.idNumber);
  const name = S(input.name);
  if (!employeeId && !ltId && !idNumber && (!name || isPlaceholder(name))) return null;

  let hr = null; let lt = null;
  if (ltId) {
    if (!mongoose.isValidObjectId(ltId)) throw bad(`${label}: اختيارٌ غير صالح — اختره من القائمة`);
    lt = await LightTransportEmployee.findOne({ _id: ltId, isActive: { $ne: false } }).select(LT_SELECT).lean();
    if (!lt) throw bad(`${label}: لم يُعثَر عليه في سجلّ موظّفي النقل الخفيف — اختره من القائمة`);
  }
  if (employeeId) {
    if (!mongoose.isValidObjectId(employeeId)) throw bad(`${label}: اختيارٌ غير صالح — اختره من القائمة`);
    hr = await Employee.findById(employeeId).select(HR_SELECT).lean();
    if (!hr) throw bad(`${label}: لم يُعثَر على ملفّه في الموارد البشرية — اختره من القائمة`);
  }
  if (!lt && !hr && idNumber) {
    lt = await LightTransportEmployee.findOne({ idNumber, isActive: { $ne: false } }).select(LT_SELECT).lean();
    hr = await PR.byIdNumber(idNumber, HR_SELECT);
    if (!lt && !hr) throw bad(`${label}: رقم الهوية ${idNumber} لا يطابق أيَّ موظّف — اختره من القائمة`);
  }
  if (!lt && !hr && name) {
    // Name only: accepted if it matches exactly one employee, otherwise rejected.
    const want = PR.foldName(name);
    const lts = (await LightTransportEmployee.find({ isActive: { $ne: false } }).select(LT_SELECT).lean())
      .filter((l) => PR.foldName(l.name) === want);
    if (lts.length === 1) lt = lts[0];
    else if (lts.length > 1) throw bad(`${label}: «${name}» يطابق أكثرَ من موظّف — اختره من القائمة`);
    else {
      hr = await PR.byExactName(name, HR_SELECT);
      if (!hr) throw bad(`${label}: «${name}» ليس موظّفًا مسجَّلًا — اختره من القائمة، ومن لا يظهر فيها يُضاف من الموارد البشرية أو من موظّفي النقل الخفيف أوّلًا`);
    }
  }
  // The other side is completed too: the section row points to his file, and the file finds his row by ID number.
  if (lt && !hr && lt.employee) hr = await Employee.findById(lt.employee).select(HR_SELECT).lean();
  if (hr && !lt) {
    const ids = PR.idsOf(hr);
    lt = await LightTransportEmployee.findOne({
      isActive: { $ne: false }, $or: [{ employee: hr._id }, ...(ids.length ? [{ idNumber: { $in: ids } }] : [])],
    }).select(LT_SELECT).lean();
  }

  const sets = await archiveSets();
  const { employeeArchived, idNumberArchived } = require('./endedStaff');
  const p = shape({ hr, lt });
  if ((hr && employeeArchived(sets, hr._id)) || (!hr && idNumberArchived(sets, p.idNumber))) {
    throw bad(`${label}: ${p.name} في الأرشيف — لا يُسنَد إليه شيء`);
  }
  if (lt ? ltEnded(lt, hr) : hrEnded(hr)) {
    throw bad(`${label}: انتهت خدمة ${p.name} في الموارد البشرية — لا تُسلَّم إليه مركبة`);
  }
  if (needLt && !lt) {
    throw bad(`${label}: ${p.name} ليس في سجلّ موظّفي النقل الخفيف — القائدُ الفعليّ يُختار من موظّفي القسم`);
  }
  return p;
}

/**
 * Dropdown options: `scope = 'lt'` is light-transport employees first, then HR; `scope = 'hr'` is HR, then light-transport people with no file. Ended and archived staff are not options, matching what `resolvePerson` rejects.
 * `q` narrows the list (name or ID number); empty returns all.
 */
async function options({ scope = 'lt', q = '' } = {}) {
  const Employee = require('../models/Employee');
  const { LightTransportEmployee } = require('../models/LightTransport');
  const { NOT_ARCHIVED } = require('./hrEngagement');
  const sets = await archiveSets();
  const qq = S(q);
  const rx = qq ? require('./arabicSearch').arabicSearchRegex(qq) : null;
  const digits = qq.replace(/\D/g, '');
  const [hrs, lts] = await Promise.all([
    Employee.find({
      $and: [NOT_ARCHIVED, { employmentStatus: { $ne: 'terminated' } }, { isHrRecord: { $ne: false } },
        ...(rx ? [{ $or: [{ firstName: rx }, { lastName: rx }, { arabicName: rx },
          ...(digits.length >= 3 ? [{ iqamaNumber: new RegExp(digits) }, { nationalId: new RegExp(digits) }] : [])] }] : [])],
    }).select(HR_SELECT).lean(),
    LightTransportEmployee.find({
      isActive: { $ne: false },
      ...(rx ? { $or: [{ name: rx }, ...(digits.length >= 3 ? [{ idNumber: new RegExp(digits) }] : [])] } : {}),
    }).select(LT_SELECT).populate('employee', 'employmentStatus').lean(),
  ]);
  const hrById = new Map(hrs.map((e) => [String(e._id), e]));
  const ltRows = lts.filter((l) => {
    const hrRef = l.employee && typeof l.employee === 'object' ? l.employee : null;
    if (hrRef && (hrRef.employmentStatus === 'terminated' || sets.archivedIds.has(String(hrRef._id)))) return false;
    if (!hrRef && (/انهاء|إنهاء/.test(S(l.workStatusAr)) || sets.archivedIdNumbers.has(idKey(l.idNumber)))) return false;
    return true;
  });
  const used = new Set();
  const out = [];
  const pushLt = (l) => {
    const hr = l.employee ? hrById.get(String(l.employee._id || l.employee)) : null;
    const p = shape({ hr: hr || null, lt: l });
    if (hr) used.add(String(hr._id));
    for (const k of [p.idNumber, ...(hr ? PR.idsOf(hr) : [])]) if (k) used.add(`#${k}`);
    out.push({
      key: `lt:${p.ltId}`, source: 'lt', ltId: p.ltId, employeeId: p.employeeId,
      name: p.name, idNumber: p.idNumber, phone: p.phone, jobTitleAr: p.jobTitleAr,
      projectAr: S(l.projectAr), vehiclePlate: S(l.vehiclePlate),
    });
  };
  const pushHr = (e) => {
    if (used.has(String(e._id)) || PR.idsOf(e).some((k) => used.has(`#${k}`))) return;
    const p = shape({ hr: e, lt: null });
    out.push({
      key: `hr:${p.employeeId}`, source: 'hr', ltId: '', employeeId: p.employeeId,
      name: p.name, idNumber: p.idNumber, phone: p.phone, jobTitleAr: p.jobTitleAr,
      projectAr: S(e.department), vehiclePlate: '',
    });
  };
  const byName = (a, b) => S(a.name).localeCompare(S(b.name), 'ar');
  if (scope === 'hr') {
    // HR first; those in the section are read by their row (project and vehicle).
    const ltOfHr = new Map(ltRows.filter((l) => l.employee).map((l) => [String(l.employee._id || l.employee), l]));
    for (const e of [...hrs].sort((a, b) => byName({ name: PR.canonicalName(a) }, { name: PR.canonicalName(b) }))) {
      const l = ltOfHr.get(String(e._id));
      if (l) pushLt(l); else pushHr(e);
    }
    for (const l of ltRows.filter((x) => !x.employee).sort(byName)) pushLt(l);
  } else {
    for (const l of [...ltRows].sort(byName)) pushLt(l);
    for (const e of [...hrs].sort((a, b) => byName({ name: PR.canonicalName(a) }, { name: PR.canonicalName(b) }))) pushHr(e);
  }
  return out.filter((p) => p.name);
}

module.exports = { resolvePerson, options, isPlaceholder, PLACEHOLDER_RX, idKey };
