/**
 * employeeDateRepair: one pass over employee files at startup.
 * (1) Date fields written as day/month/year text (13/11/2026) become YYYY-MM-DD: until then the Gregorian box opened empty beside its Hijri and the date never counted for expiries or sorting.
 * (2) A «required» mark left on a field that holds a value is cleared, as the save hook does for edits.
 * Idempotent and diff-only: a clean file is not written.
 */
const DM = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/;
const pad = (n) => String(n).padStart(2, '0');
const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;
/** Any readable stored form as YYYY-MM-DD, or null: day/month/year, an ISO instant, or a `Date.toString()` line. */
const isoOf = (v) => {
  const s = String(v || '').trim();
  if (!s || ISO_DAY.test(s)) return null;
  const m = DM.exec(s);
  if (m) return (+m[2] >= 1 && +m[2] <= 12 && +m[1] >= 1 && +m[1] <= 31) ? `${m[3]}-${pad(m[2])}-${pad(m[1])}` : null;
  const iso = /^(\d{4})-(\d{2})-(\d{2})T/.exec(s);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  // `Date.toString()` text carries its own offset; the calendar day in Riyadh is the one meant.
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return null;
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Riyadh' }).format(d);
};

async function repairEmployeeDates() {
  const Employee = require('../models/Employee');
  const H = require('../config/hrFields');
  const dateKeys = [];
  for (const g of H.GROUPS) for (const f of g.fields) if (f.type === 'date' && !dateKeys.includes(f.key)) dateKeys.push(f.key);
  const stringKeys = dateKeys.filter((k) => Employee.schema.path(k)?.instance === 'String');
  const dateTypedKeys = dateKeys.filter((k) => Employee.schema.path(k)?.instance === 'Date');
  const allKeys = [...new Set(H.GROUPS.flatMap((g) => g.fields.filter((f) => !f.derived).map((f) => f.key)))];

  const q = { $or: [
    // Text that is not YYYY-MM-DD in a text date field, and text in a real date field.
    ...stringKeys.map((k) => ({ [k]: { $type: 'string', $nin: [''], $not: /^\d{4}-\d{2}-\d{2}$/ } })),
    ...dateTypedKeys.map((k) => ({ [k]: { $type: 'string', $nin: [''] } })),
    ...allKeys.map((k) => ({ [`fieldStatus.${H.statusKeyOf(k)}`]: 'required', [k]: { $nin: [null, ''] } })),
  ] };
  const rows = await Employee.collection.find(q).project(Object.fromEntries([...allKeys, 'fieldStatus'].map((k) => [k, 1]))).toArray();
  const ops = [];
  for (const e of rows) {
    const set = {}; const unset = {};
    for (const k of stringKeys) { const iso = isoOf(e[k]); if (iso) set[k] = iso; }
    for (const k of dateTypedKeys) {
      if (typeof e[k] !== 'string' || !e[k].trim()) continue;
      const iso = ISO_DAY.test(e[k].trim()) ? e[k].trim() : isoOf(e[k]);
      if (iso) set[k] = new Date(`${iso}T00:00:00.000Z`);
    }
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

/** Save-time guard: a date field never keeps a non-standard text form. Unreadable text is left for HR to see, not erased. */
function normalizeDoc(doc) {
  const H = require('../config/hrFields');
  for (const g of H.GROUPS) for (const f of g.fields) {
    if (f.type !== 'date') continue;
    const path = doc.schema.path(f.key);
    const v = doc.get(f.key);
    if (path?.instance === 'String' && typeof v === 'string') {
      const iso = isoOf(v);
      if (iso) doc.set(f.key, iso);
    }
  }
}

module.exports = { repairEmployeeDates, isoOf, normalizeDoc };
