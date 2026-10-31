/**
 * The owner's corrected customer names (config/approvedCustomers) as the only values
 * a person may type into a customer-name field. Platform sync and imports are not gated.
 */
const fold = (s) => require('../models/CollectionsParty').fold(String(s || ''));

let byKey = null;
const index = () => {
  if (!byKey) {
    byKey = new Map();
    for (const n of require('../config/approvedCustomers')) {
      const k = fold(n);
      if (k && !byKey.has(k)) byKey.set(k, n);
    }
  }
  return byKey;
};

/** Sorted list for pickers. */
const approvedNames = () => [...index().values()].sort((a, b) => a.localeCompare(b, 'ar'));

/**
 * Validate a typed name against the current value. Returns { value } (approved spelling)
 * or { error }. An unchanged value passes so old rows can still be saved.
 */
const checkCustomerName = (next, current) => {
  const v = String(next ?? '').trim();
  if (!v || fold(v) === fold(current)) return { value: v || next };
  const hit = index().get(fold(v));
  return hit ? { value: hit } : { error: `«${v}» ليس من أسماء العملاء المعتمدة — اختر الاسم من القائمة.` };
};

module.exports = { approvedNames, checkCustomerName };
