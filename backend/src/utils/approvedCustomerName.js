/**
 * The customers page is the only source of customer names a person may enter.
 * Platform sync and imports are not gated.
 */
const fold = (s) => require('../models/CollectionsParty').fold(String(s || ''));

const allNames = async () => {
  const rows = await require('../models/ShipmentOrderCustomer').find({ isActive: { $ne: false } }).select('name').lean();
  const map = new Map();
  for (const { name } of rows) { const k = fold(name); if (k && !map.has(k)) map.set(k, name); }
  return map;
};

/** Sorted list for pickers. */
const approvedNames = async () => [...(await allNames()).values()].sort((a, b) => a.localeCompare(b, 'ar'));

/**
 * Validate a typed name against the current value. Returns { value } (approved spelling)
 * or { error }. An unchanged value passes so old rows can still be saved.
 */
const checkCustomerName = async (next, current) => {
  const v = String(next ?? '').trim();
  if (!v || fold(v) === fold(current)) return { value: v || next };
  const hit = (await allNames()).get(fold(v));
  return hit ? { value: hit } : { error: `«${v}» ليس من أسماء العملاء المعتمدة — اختر الاسم من القائمة.` };
};

module.exports = { approvedNames, checkCustomerName };
