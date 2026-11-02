/**
 * b2cRepLink: which delivery-app account (`B2CRep`) belongs to which light transport register row.
 * Keys, strongest first: ID number (or `repId` if it is an ID), phone (last nine digits), fully folded name accepted only if all names point to one row. No near-name matching: a wrong link counts one man's orders for another (weaker tiers are in scripts/linkRepsToRegister.js, run manually).
 * Two accounts for one man is valid; both link to his row and orders are summed by row.
 */
const { fold } = require('./b2cSupervisors');
const { idKey, displayName } = require('./personLookup');

const S = (v) => String(v == null ? '' : v).trim();
/** Phone by last nine digits, the key on which 05..., 9665... and +966 5... agree. */
const phoneKey = (v) => {
  const d = idKey(v).replace(/\D/g, '');
  return d.length >= 9 ? d.slice(-9) : '';
};
/** An account number that can be an ID: ten digits starting with 1 or 2. */
const looksLikeId = (v) => /^[12]\d{9}$/.test(idKey(v));

/** Index of the light transport register for matching, built once per batch. */
async function buildIndex() {
  const { LightTransportEmployee } = require('../models/LightTransport');
  const Employee = require('../models/Employee');
  const lts = await LightTransportEmployee.find({ isActive: { $ne: false } })
    .select('_id name idNumber phone employee staffKind').lean();
  const emps = await Employee.find({ _id: { $in: lts.map((l) => l.employee).filter(Boolean) } })
    .select('_id firstName lastName arabicName phone iqamaNumber nationalId').lean();
  const empById = new Map(emps.map((e) => [String(e._id), e]));

  const byId = new Map(); const byPhone = new Map(); const byName = new Map();
  const add = (map, k, id) => { if (!k) return; if (!map.has(k)) map.set(k, new Set()); map.get(k).add(id); };
  for (const l of lts) {
    const id = String(l._id);
    const e = l.employee ? empById.get(String(l.employee)) : null;
    add(byId, idKey(l.idNumber), id);
    if (e) { add(byId, idKey(e.iqamaNumber), id); add(byId, idKey(e.nationalId), id); }
    add(byPhone, phoneKey(l.phone), id);
    if (e) add(byPhone, phoneKey(e.phone), id);
    add(byName, fold(l.name), id);
    if (e) { add(byName, fold(e.arabicName), id); add(byName, fold(`${S(e.firstName)} ${S(e.lastName)}`), id); }
  }
  return { lts: new Map(lts.map((l) => [String(l._id), l])), empById, byId, byPhone, byName };
}

const one = (set) => (set && set.size === 1 ? [...set][0] : null);

/** Matches one account. `extra.idNumber` is an ID number written at creation (not stored on the account; it belongs in the register). Returns `{ lt, via }`, `{ ambiguous }` or null. */
function matchRep(rep, index, extra = {}) {
  // The sheet sometimes wrote the ID or phone in the name field (a ten-digit and a nine-digit number in `arabicName`), so each field is read by what it holds, not its label: ten digits starting with 1 or 2 is an ID, nine digits or more is a phone.
  const fields = [extra.idNumber, rep.repId, rep.arabicName, rep.englishName];
  for (const raw of fields) {
    if (!looksLikeId(raw)) continue;
    const hit = index.byId.get(idKey(raw));
    if (hit && hit.size === 1) return { lt: one(hit), via: 'idNumber' };
    if (hit && hit.size > 1) return { ambiguous: hit.size, via: 'idNumber' };
  }
  for (const raw of [extra.phone, rep.phone, rep.arabicName, rep.englishName]) {
    if (!/^[\d٠-٩\s+()-]+$/.test(S(raw)) || looksLikeId(raw)) continue;
    const ph = index.byPhone.get(phoneKey(raw));
    if (ph && ph.size === 1) return { lt: one(ph), via: 'phone' };
  }

  const ids = new Set();
  for (const n of [rep.arabicName, rep.englishName]) {
    const hit = index.byName.get(fold(n));
    if (hit) hit.forEach((x) => ids.add(x));
  }
  if (ids.size === 1) return { lt: one(ids), via: 'name' };
  if (ids.size > 1) return { ambiguous: ids.size, via: 'name' };
  return null;
}

/** Links a new account when it is created if its owner is known with certainty. Returns the row id or null. */
async function linkAtCreate(rep, extra = {}) {
  if (rep.ltEmployee) return rep.ltEmployee;
  const m = matchRep(rep, await buildIndex(), extra);
  return m && m.lt ? m.lt : null;
}

/** Account identity as displayed: from the HR file if the row is linked to it, otherwise from the light transport row, otherwise what the sheet wrote. `lt` is populated with `employee`. */
function personOf(rep, lt) {
  const e = lt && lt.employee && typeof lt.employee === 'object' ? lt.employee : null;
  if (e && displayName(e)) {
    return { name: displayName(e), phone: S(e.phone) || S(lt.phone), idNumber: S(e.iqamaNumber) || S(e.nationalId) || S(lt.idNumber), source: 'hr' };
  }
  if (lt && S(lt.name)) return { name: S(lt.name), phone: S(lt.phone), idNumber: S(lt.idNumber), source: 'lt' };
  return { name: S(rep.arabicName) || S(rep.englishName), phone: S(rep.phone), idNumber: '', source: 'account' };
}

module.exports = { buildIndex, matchRep, linkAtCreate, personOf, phoneKey, looksLikeId };
