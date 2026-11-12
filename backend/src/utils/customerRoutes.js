/**
 * Customer routes and prices: learned from work, not typed in a table.
 * The real selling price is unknown to the platform (it carries the purchase price), so every priced shipment is recorded in the customer file as one route with its latest price, from any source.
 * The latest wins by the date of the work, not the write time, so a late import of an old shipment does not override a newer price.
 * Cities are matched by the same folded key as the rest of the system, so spelling variants do not split a route.
 */
const ShipmentOrderCustomer = require('../models/ShipmentOrderCustomer');

const S = (v) => String(v ?? '').trim();

/** City key: folds hamza, ta marbuta and spaces; see CollectionsParty.fold. */
const cityKey = (v) => require('../models/CollectionsParty').fold(v);

/** Route key; direction matters: A to B is not B to A. */
const routeKey = (from, to) => `${cityKey(from)}→${cityKey(to)}`;

const num = (v) => {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : null;
};

/**
 * Records a route in the customer file and updates its price if this one is newer.
 * @param {object} customer customer document (mongoose), saved here
 * @param {object} o { fromCity, toCity, price, at, source }
 * @returns {'created'|'priced'|'seen'|'skipped'} what happened
 */
function applyRoute(customer, { fromCity, toCity, price, at, source = '' }) {
  const from = S(fromCity);
  const to = S(toCity);
  if (!from || !to) return 'skipped';
  const p = num(price);
  const when = at ? new Date(at) : new Date();

  customer.routes = customer.routes || [];
  const k = routeKey(from, to);
  const found = customer.routes.find((r) => routeKey(r.fromCity, r.toCity) === k);

  if (!found) {
    customer.routes.push({
      fromCity: from, toCity: to, price: p, at: p ? when : null, source: p ? source : '', hits: 1,
    });
    return p ? 'created' : 'seen';
  }

  found.hits = (found.hits || 1) + 1;
  // No price: the route is known and seen again; its price is untouched.
  if (!p) return 'seen';
  // A price with no earlier date is accepted; the latest wins.
  const prev = found.at ? new Date(found.at) : null;
  if (found.price != null && prev && when < prev) return 'seen';
  found.price = p;
  found.at = when;
  found.source = source;
  return 'priced';
}

/** Finds a customer by name (or creates it) then records the route. Used by sync and import where only a name is available. */
async function learnRouteByName(customerName, route) {
  const name = S(customerName);
  if (!name) return null;
  const { fold } = require('../models/CollectionsParty');
  const key = fold(name);

  // The whole list is not read for every shipment: sync calls this about a hundred times per cycle, and reading the customer register each time would repeat the same read. The folded-name index is cached for a minute and only the customer document is read by id.
  const cache = require('./ttlCache');
  const index = await cache.wrap('so:customerNameIndex', 60000, async () => {
    const rows = await ShipmentOrderCustomer.find({ isActive: { $ne: false } }).select('name').lean();
    const out = {};
    for (const c of rows) { const k = fold(c.name); if (k && !out[k]) out[k] = String(c._id); }
    return out;
  });

  let customer = index[key] ? await ShipmentOrderCustomer.findById(index[key]) : null;
  if (!customer) {
    customer = await ShipmentOrderCustomer.create({ name, routes: [] });
    try { cache.clear('so:customerNameIndex'); } catch (_) { /* */ }
  }
  const res = applyRoute(customer, route);
  if (res !== 'skipped') await customer.save();
  return res;
}

/** Route price as in the customer file; `null` if not yet priced. */
function priceFor(customer, fromCity, toCity) {
  if (!customer) return null;
  const k = routeKey(fromCity, toCity);
  const r = (customer.routes || []).find((x) => routeKey(x.fromCity, x.toCity) === k);
  return r && r.price != null ? Number(r.price) : null;
}

/**
 * Price tiers by number of vehicles.
 * `cleanTiers` reads what was typed on the screen and returns it sorted, or throws a displayable message: whole number from one, an end not before its start, a positive price, and no two tiers on the same count (two prices for five vehicles is not a price). Only the last tier may be left open-ended ('and above').
 */
function cleanTiers(input) {
  const bad = (m) => Object.assign(new Error(m), { status: 400 });
  const rows = (Array.isArray(input) ? input : []).map((t) => ({
    minTrucks: Number(t && t.minTrucks),
    maxTrucks: t && t.maxTrucks !== null && t.maxTrucks !== undefined && t.maxTrucks !== '' ? Number(t.maxTrucks) : null,
    price: Number(t && t.price),
  }));
  for (const t of rows) {
    if (!Number.isInteger(t.minTrucks) || t.minTrucks < 1) throw bad('بدايةُ الشريحة عددٌ صحيحٌ من ١ فأكثر');
    if (t.maxTrucks !== null && (!Number.isInteger(t.maxTrucks) || t.maxTrucks < t.minTrucks)) throw bad('نهايةُ الشريحة لا تسبق بدايتَها');
    if (!Number.isFinite(t.price) || t.price <= 0) throw bad('اكتب سعرَ السيارة في كلّ شريحة');
  }
  rows.sort((a, b) => a.minTrucks - b.minTrucks);
  for (let i = 1; i < rows.length; i += 1) {
    const prev = rows[i - 1];
    if (prev.maxTrucks === null) throw bad('الشريحةُ المفتوحةُ («فما فوق») تكون الأخيرة');
    if (rows[i].minTrucks <= prev.maxTrucks) throw bad(`شريحتان على العدد ${rows[i].minTrucks} — لكلّ عددٍ سعرٌ واحد`);
  }
  return rows;
}

/** Per-vehicle price for a number of vehicles; `null` if no tier covers it. */
function tierPriceFor(tiers, trucks) {
  const n = Math.max(1, Number(trucks) || 1);
  for (const t of tiers || []) {
    if (n >= t.minTrucks && (t.maxTrucks == null || n <= t.maxTrucks)) return Number(t.price);
  }
  return null;
}

/**
 * Who writes a route price.
 * Destination prices (agreed price and vehicle-count tiers) are written only by the operations manager and the system admin. Others edit customer data (name, phone, preferences) but not prices. The check lives in one place read by every path that reaches a price.
 */
const PRICE_EDITORS = ['super_admin', 'admin', 'it_manager', 'it_team_leader', 'it_specialist', 'operations_manager', 'operations_team_leader'];
const canEditPrices = (role) => PRICE_EDITORS.includes(role);

module.exports = {
  cityKey, routeKey, applyRoute, learnRouteByName, priceFor, cleanTiers, tierPriceFor,
  PRICE_EDITORS, canEditPrices,
};
