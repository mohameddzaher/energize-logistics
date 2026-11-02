/**
 * Expiry of residence permit and driving licence for any driver.
 * Both dates are stored only on the HR employee file (`iqamaExpiry` / `licenseExpiry`), while every driver register (driver cards, fleet drivers, shipment-order drivers, light-transport reps, operations drivers) points to it by ID number or employee link. So they are read from there, once per list. A residence recorded in Hijri only is converted to Gregorian so it does not read as unrecorded.
 */
const Employee = require('../models/Employee');

const norm = (v) => String(v || '').replace(/\s+/g, '').trim();

/** Expiry state: expired / soon (30 days) / valid / missing. */
function docState(ymd) {
  const d = String(ymd || '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) return 'missing';
  const today = new Date().toISOString().slice(0, 10);
  if (d < today) return 'expired';
  const soon = new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10);
  return d <= soon ? 'soon' : 'valid';
}

/**
 * @param {Array<{ idNumber?: string, employee?: any }>} people - ID number and/or employee id.
 * @returns {Promise<(p) => { iqamaExpiry: string, licenseExpiry: string, iqamaState: string, licenseState: string }>}
 */
async function docDatesFor(people) {
  const ids = new Set(); const emps = new Set();
  for (const p of people || []) {
    const id = norm(p && p.idNumber);
    if (id) ids.add(id);
    const e = p && p.employee;
    const eid = e && (e._id || e);
    if (eid && /^[0-9a-f]{24}$/i.test(String(eid))) emps.add(String(eid));
  }
  if (!ids.size && !emps.size) return () => ({ iqamaExpiry: '', licenseExpiry: '', iqamaState: 'missing', licenseState: 'missing', docsState: 'missing' });
  const rows = await Employee.find({ $or: [
    ...(ids.size ? [{ iqamaNumber: { $in: [...ids] } }, { nationalId: { $in: [...ids] } }] : []),
    ...(emps.size ? [{ _id: { $in: [...emps] } }] : []),
  ] }).select('iqamaNumber nationalId iqamaExpiry iqamaExpiryHijri licenseExpiry').lean();
  const { fromHijriString } = require('./hijri');
  const val = (e) => ({
    iqamaExpiry: e.iqamaExpiry || (e.iqamaExpiryHijri ? (fromHijriString(e.iqamaExpiryHijri) || '') : ''),
    licenseExpiry: e.licenseExpiry || '',
  });
  const byId = new Map(); const byEmp = new Map();
  for (const e of rows) {
    const v = val(e);
    byEmp.set(String(e._id), v);
    for (const k of [e.iqamaNumber, e.nationalId]) if (norm(k)) byId.set(norm(k), v);
  }
  return (p) => {
    const eid = p && p.employee && String(p.employee._id || p.employee);
    const v = (eid && byEmp.get(eid)) || byId.get(norm(p && p.idNumber)) || { iqamaExpiry: '', licenseExpiry: '' };
    const iqamaState = docState(v.iqamaExpiry); const licenseState = docState(v.licenseExpiry);
    // Worse than either alone is a single filter chip in the app lists.
    const docsState = ['expired', 'soon', 'missing'].find((k) => iqamaState === k || licenseState === k) || 'valid';
    return { ...v, iqamaState, licenseState, docsState };
  };
}

module.exports = { docDatesFor, docState };
