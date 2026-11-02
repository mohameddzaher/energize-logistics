/**
 * personLookup: which HR file is this person?
 * Rule: one record per person system-wide, and the person's file is HR `Employee`, identified by ID number: `iqamaNumber` for residents, `nationalId` for Saudis (the second is copied to the first on save, but older files were not saved since). So both columns are searched, or a written number would read as missing.
 * Relation to `utils/personRef`: the general person-link door lives there (ID number, then folded name, plus `displayName`). This file is a small same-meaning copy for sections written before it (shipment-order drivers, technicians, users). It is to be replaced by personRef when that arrives, and nothing is added here: two rules for one person drift apart silently.
 */
const S = (v) => String(v == null ? '' : v).trim();

/** ID number without spaces and with Latin digits, so the Arabic-digit and Latin forms are one number. */
const idKey = (v) => S(v).replace(/[٠-٩]/g, (d) => '٠١٢٣٤٥٦٧٨٩'.indexOf(d)).replace(/\s+/g, '');

/** Display name: full Arabic name if present, otherwise first and last. */
const displayName = (e) => (e ? (S(e.arabicName) || [S(e.firstName), S(e.lastName)].filter(Boolean).join(' ')) : '');

/** Fold a name for comparison: letter variants, spaces and Latin case do not make a second person. */
const foldName = (s) => S(s)
  .replace(/[ً-ْـ]/g, '')
  .replace(/[أإآٱ]/g, 'ا').replace(/ى/g, 'ي').replace(/ة/g, 'ه').replace(/ؤ/g, 'و').replace(/ئ/g, 'ي')
  .replace(/[^؀-ۿa-zA-Z0-9]+/g, ' ')
  .replace(/\s+/g, ' ')
  .trim()
  .toLowerCase();

const SELECT = '_id firstName lastName arabicName iqamaNumber nationalId idType phone nationality employmentStatus';

/** One file by ID number, or null. */
async function byIdNumber(id, select = SELECT) {
  const k = idKey(id);
  if (!k) return null;
  const Employee = require('../models/Employee');
  return Employee.findOne({ $or: [{ iqamaNumber: k }, { nationalId: k }] }).select(select).lean();
}

/** Batch lookup: Map from ID number to file. A number held by two files is skipped, not guessed. */
async function byIdNumbers(ids, select = SELECT) {
  const keys = [...new Set((ids || []).map(idKey).filter(Boolean))];
  const out = new Map();
  if (!keys.length) return out;
  const Employee = require('../models/Employee');
  const rows = await Employee.find({ $or: [{ iqamaNumber: { $in: keys } }, { nationalId: { $in: keys } }] })
    .select(select).lean();
  const seen = new Map();
  for (const e of rows) {
    for (const k of new Set([idKey(e.iqamaNumber), idKey(e.nationalId)])) {
      if (!k || !keys.includes(k)) continue;
      if (seen.has(k) && String(seen.get(k)._id) !== String(e._id)) { out.delete(k); seen.set(k, { _id: 'ambiguous' }); continue; }
      if (seen.get(k)?._id === 'ambiguous') continue;
      seen.set(k, e); out.set(k, e);
    }
  }
  return out;
}

module.exports = { idKey, displayName, foldName, byIdNumber, byIdNumbers, SELECT };
