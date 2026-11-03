/**
 * employeeDateRepair: one pass over employee files at startup.
 * (1) Date fields written as day/month/year text (13/11/2026) become YYYY-MM-DD: until then the Gregorian box opened empty beside its Hijri and the date never counted for expiries or sorting.
 * (2) A «required» mark left on a field that holds a value is cleared, as the save hook does for edits.
 * Idempotent and diff-only: a clean file is not written.
 */
const DM = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/;
const pad = (n) => String(n).padStart(2, '0');
const isoOf = (v) => {
  const m = DM.exec(String(v || '').trim());
  if (!m || +m[2] < 1 || +m[2] > 12 || +m[1] < 1 || +m[1] > 31) return null;
  return `${m[3]}-${pad(m[2])}-${pad(m[1])}`;
};

async function repairEmployeeDates() {
  const Employee = require('../models/Employee');
  const H = require('../config/hrFields');
  const dateKeys = [];
  for (const g of H.GROUPS) for (const f of g.fields) if (f.type === 'date' && !dateKeys.includes(f.key)) dateKeys.push(f.key);
  const stringKeys = dateKeys.filter((k) => Employee.schema.path(k)?.instance === 'String');
  const allKeys = [...new Set(H.GROUPS.flatMap((g) => g.fields.filter((f) => !f.derived).map((f) => f.key)))];

  const rx = /^\d{1,2}[/.-]\d{1,2}[/.-]\d{4}$/;
  const q = { $or: [
    ...stringKeys.map((k) => ({ [k]: rx })),
    ...allKeys.map((k) => ({ [`fieldStatus.${H.statusKeyOf(k)}`]: 'required', [k]: { $nin: [null, ''] } })),
  ] };
  const rows = await Employee.collection.find(q).project(Object.fromEntries([...allKeys, 'fieldStatus'].map((k) => [k, 1]))).toArray();
  const ops = [];
  for (const e of rows) {
    const set = {}; const unset = {};
    for (const k of stringKeys) { const iso = isoOf(e[k]); if (iso) set[k] = iso; }
    for (const k of allKeys) {
      const sk = H.statusKeyOf(k);
      const v = set[k] ?? e[k];
      if (e.fieldStatus?.[sk] === 'required' && v != null && String(v).trim() !== '') unset[`fieldStatus.${sk}`] = '';
    }
    if (Object.keys(set).length || Object.keys(unset).length) {
      ops.push({ updateOne: { filter: { _id: e._id }, update: { ...(Object.keys(set).length ? { $set: set } : {}), ...(Object.keys(unset).length ? { $unset: unset } : {}) } } });
    }
  }
  if (ops.length) {
    await Employee.collection.bulkWrite(ops, { ordered: false });
    try { require('./hrLists').bust({ datesRepaired: ops.length }); } catch (_) { /* */ }
  }
  return ops.length;
}

module.exports = { repairEmployeeDates, isoOf };
