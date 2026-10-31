/**
 * The owner's corrected customer names (config/approvedCustomers) plus the customers page
 * are the only values a person may put in a customer-name field. Platform sync and imports are not gated.
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

/** Whatever is on the customers page is approved. */
const registerNames = async () => {
  const rows = await require('../models/ShipmentOrderCustomer')
    .find({ isActive: { $ne: false } })
    .select('name').lean();
  return rows.map((r) => r.name).filter(Boolean);
};

const allNames = async () => {
  const map = new Map(index());
  for (const n of await registerNames()) { const k = fold(n); if (k && !map.has(k)) map.set(k, n); }
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
