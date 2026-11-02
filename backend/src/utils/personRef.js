/**
 * personRef: who is this person in HR, whichever section asks.
 * A person is one record (Employee) and every section holds a reference to it, not a copy. Where a name or phone copy remains on a row elsewhere (light transport, driver card, authorization sheet, actual driver) it is a snapshot that follows the file, written by utils/employeeIdentitySync.pushPersonChange on every HR save.
 * Linking: by ID number first, in both columns (residents in `iqamaNumber`, Saudis in `nationalId`), then by exact folded name; a name matching more than one file is not accepted, since guessing between two is worse than not knowing.
 * Display name: the HR name wins. In Arabic `arabicName` if set, else first and last; in English first and last. Snapshots stored in other sections use the Arabic form (`canonicalName`). New section: store `employee: ObjectId` (plus ID number if needed) resolved from here on create, show the name from the file via `displayName`, and listen to `hr:employee`. Vehicles likewise via utils/vehicleRef, listening to `vreg:updated`.
 */
const S = (v) => String(v == null ? '' : v).trim();

/** Fold a name for matching: hamza forms, ta marbuta and ya variants, with no spaces or symbols. */
const foldName = (x) => S(x)
  .replace(/[أإآٱا]/g, 'ا').replace(/ى/g, 'ي').replace(/ة/g, 'ه')
  .replace(/[ً-ْـ]/g, '')
  .replace(/[^؀-ۿa-zA-Z0-9]/g, '')
  .toLowerCase();

/** Its ID numbers, both columns together, with no blanks. */
const idsOf = (emp) => [...new Set([emp?.iqamaNumber, emp?.nationalId].map((x) => S(x).replace(/\s+/g, '')).filter(Boolean))];

/** Its primary ID number according to its type. */
const primaryId = (emp) => S(emp?.idType === 'national_id'
  ? (emp?.nationalId || emp?.iqamaNumber) : (emp?.iqamaNumber || emp?.nationalId)).replace(/\s+/g, '');

/** The name as displayed; `lang` = 'ar' | 'en'. */
function displayName(emp, lang = 'ar') {
  if (!emp) return '';
  const fl = S(`${S(emp.firstName)} ${S(emp.lastName)}`).replace(/\s+/g, ' ');
  if (lang === 'en') return fl || S(emp.arabicName) || S(emp.fullName);
  return S(emp.arabicName) || fl || S(emp.fullName);
}

/** The name used when writing snapshots in other sections. */
const canonicalName = (emp) => displayName(emp, 'ar');

const SELECT = 'firstName lastName arabicName iqamaNumber nationalId idType phone nationality project department employmentStatus isHrRecord vehiclePlate';
// The active HR file first, then the one currently employed.
const rank = (e) => (e.isHrRecord !== false ? 2 : 0) + (e.employmentStatus !== 'terminated' ? 1 : 0);

/** Employee by ID number (both columns), or null. */
async function byIdNumber(id, select = SELECT) {
  const n = S(id).replace(/\s+/g, '');
  if (!n) return null;
  const Employee = require('../models/Employee');
  const rows = await Employee.find({ $or: [{ iqamaNumber: n }, { nationalId: n }] }).select(`${select} isHrRecord employmentStatus`).lean();
  if (!rows.length) return null;
  return rows.sort((a, b) => rank(b) - rank(a))[0];
}

/** Employee by exact folded name; accepted only if exactly one file matches. */
async function byExactName(name, select = SELECT) {
  const want = foldName(name);
  if (!want) return null;
  const Employee = require('../models/Employee');
  const rows = await Employee.find({ isHrRecord: { $ne: false } }).select(`${select} fullName`).lean();
  const hits = rows.filter((e) => [e.arabicName, `${S(e.firstName)} ${S(e.lastName)}`, e.fullName].some((n) => n && foldName(n) === want));
  return hits.length === 1 ? hits[0] : null;
}

/** The single linking door: { idNumber, name } to the HR file or null. */
async function resolve({ idNumber, name } = {}, select = SELECT) {
  return (await byIdNumber(idNumber, select)) || (S(idNumber) ? null : await byExactName(name, select));
}

/** Batch resolution by ID number: Map from number to file. */
async function resolveManyByIds(ids, select = SELECT) {
  const want = [...new Set((ids || []).map((x) => S(x).replace(/\s+/g, '')).filter(Boolean))];
  if (!want.length) return new Map();
  const Employee = require('../models/Employee');
  const rows = await Employee.find({ $or: [{ iqamaNumber: { $in: want } }, { nationalId: { $in: want } }] })
    .select(`${select} isHrRecord employmentStatus`).lean();
  const out = new Map();
  for (const e of rows.sort((a, b) => rank(b) - rank(a))) {
    for (const k of idsOf(e)) if (want.includes(k) && !out.has(k)) out.set(k, e);
  }
  return out;
}

module.exports = {
  S, foldName, idsOf, primaryId, displayName, canonicalName, byIdNumber, byExactName, resolve, resolveManyByIds, rank,
};
