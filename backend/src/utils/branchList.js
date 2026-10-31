/**
 * The company branch list (lookup workflow_paying_branch) is the only value a person
 * may store as a branch, on shipments and on the workflow. Spelling variants become
 * the list's spelling; an old value left unchanged still saves.
 */
const { foldAr } = require('./payingBranch');
const Lookup = require('../models/Lookup');

const FIELDS = ['branch', 'payingBranch'];

async function applyBranchList(body, current = {}) {
  const fields = FIELDS.filter((f) => body[f] !== undefined && String(body[f] ?? '').trim());
  if (!fields.length) return null;
  const rows = await Lookup.find({ type: 'workflow_paying_branch', deleted: { $ne: true }, isActive: { $ne: false } }).select('nameAr').lean();
  const byKey = new Map(rows.map((r) => [foldAr(r.nameAr), String(r.nameAr).trim()]));
  for (const f of fields) {
    const v = String(body[f]).trim();
    const hit = byKey.get(foldAr(v));
    if (hit) body[f] = hit;
    else if (foldAr(v) === foldAr(current[f])) body[f] = current[f];
    else return `«${v}» ليس من قائمة الفروع — اختر الفرع من القائمة.`;
  }
  return null;
}

module.exports = { applyBranchList };
