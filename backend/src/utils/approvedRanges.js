/**
 * Approved purchase price per route, as a range (from–to), read by the routes page and by every shipment request.
 * A request carries no copy: its range is looked up when it is read, so an edit on the routes page shows on every
 * request at once, sent before or after. Matching folds Arabic spelling; an exact truck type wins over "any type".
 * Rows from before ranges keep their A/B/C tiers and read as min..max of them.
 */
const { VendorApprovedPrice } = require('../models/VendorsMgmt');
const { foldName } = require('../models/ShipmentOrderSupplier');

const num = (v) => (v === '' || v == null || !Number.isFinite(Number(v)) ? null : Number(v));
function rangeOf(ap) {
  if (!ap) return null;
  const tiers = [ap.priceA, ap.priceB, ap.priceC].map(num).filter((v) => v != null && v > 0);
  const min = num(ap.minPrice) ?? (tiers.length ? Math.min(...tiers) : null);
  const max = num(ap.maxPrice) ?? (tiers.length ? Math.max(...tiers) : null);
  if (min == null && max == null) return null;
  return { min: min ?? max, max: max ?? min };
}

let rows = []; let loadedAt = 0; let loading = null;
async function refresh() {
  if (!loading) {
    loading = VendorApprovedPrice.find({ isActive: { $ne: false } }).lean()
      .then((r) => { rows = r; loadedAt = Date.now(); })
      .finally(() => { loading = null; });
  }
  return loading;
}
/** Re-read when older than a few seconds: cheap (one small collection) and keeps both PM2 workers current. */
async function ensureFresh(maxAgeMs = 3000) { if (Date.now() - loadedAt > maxAgeMs) await refresh(); }
const invalidate = () => { loadedAt = 0; };

/**
 * { min, max, truckType, customer, id } for a route from what is loaded; null when the route has no approved price.
 * The customer's own price on the route wins over the route's general price; within each, an exact truck type wins.
 */
function lookup(fromCity, toCity, truckType, customerId) {
  const f = foldName(fromCity || ''); const t = foldName(toCity || '');
  if (!f || !t) return null;
  const same = rows.filter((a) => a.fromKey === f && a.toKey === t);
  if (!same.length) return null;
  const tt = foldName(truckType || '');
  const cid = customerId ? String(customerId) : '';
  const pick = (list) => (tt && list.find((a) => foldName(a.truckType || '') === tt)) || list.find((a) => !a.truckType) || list[0];
  const own = cid ? same.filter((a) => a.customer && String(a.customer) === cid) : [];
  const general = same.filter((a) => !a.customer);
  const hit = own.length ? pick(own) : general.length ? pick(general) : null;
  const r = rangeOf(hit);
  return r ? { ...r, truckType: hit.truckType || '', customer: !!hit.customer, id: String(hit._id) } : null;
}

module.exports = { rangeOf, ensureFresh, invalidate, lookup, refresh };
