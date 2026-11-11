/**
 * Persists platform shipments into the shipment orders section, so our system stays complete, filterable and printable even if the platform stops.
 * The release sheet number stays the platform's number; migrated shipments are not renumbered and system shipments continue on the same series.
 * Called from `opsPoll` every cycle.
 */
const n = (v) => (v === null || v === undefined ? '' : String(v).trim());
const num = (v) => { const x = Number(v); return Number.isFinite(x) ? x : null; };
const date = (v) => { if (!v) return null; const d = new Date(v); return Number.isNaN(d.getTime()) ? null : d; };
// The platform writes a name in two shapes: `{ar,en}` directly, and `{name:{ar,en}}` for references (type, branch, load). Reading only the first shape emptied every reference column, and those columns are filtered and aggregated in analytics.
const label = (v) => {
  if (!v) return '';
  if (typeof v !== 'object') return n(v);
  const t = v.name && typeof v.name === 'object' ? v.name : v;
  return n(t.ar) || n(t.en) || n(v.name);
};

const STATUS = {
  requesting: 'requesting', loading: 'loading', uploaded: 'uploaded', on_way: 'on_way',
  arrived: 'arrived', bond_sent: 'bond_sent', bond_received: 'bond_received',
  late: 'late', invoiced: 'invoiced', cancelled: 'cancelled', canceled: 'cancelled',
};

/** Platform row to our section's document. */
function mapShipment(x) {
  const car = x.car || {};
  const owner = car.owner || {};
  const user = x.user || {};
  return {
    externalId: n(x.id),
    source: 'platform',
    graduationNumber: num(x.graduation_statement_num),
    reference: n(x.graduation_statement_num),
    fromCity: label(x.address_from),
    toCity: label(x.address_to),
    quantity: num(x.qty),
    customerName: n(user.name),
    // Driver name and number.
    // The platform driver row has no `name`: it carries nationality, residence number and `company_name`, which is the displayed name. His number comes from the linked user account if there is one; otherwise he has no number and none is invented.
    driverName: n(x.driver && (x.driver.company_name || x.driver.sponsor_name))
      || n(x.driver && x.driver.user && x.driver.user.name)
      || n(x.driver && x.driver.admin && x.driver.admin.name),
    driverPhone: n(x.driver && x.driver.user && x.driver.user.phone)
      || n(x.driver && x.driver.admin && x.driver.admin.phone),
    vehicleName: label(car.name) || n(car.plate_number),
    vehiclePlate: n(car.plate_number) || n(car.car_number),
    // The supplier in this model is not a field: it is the truck owner, the company we buy the trip from, with its commercial register and payment terms.
    supplierName: require('../utils/arLetters').arLetters(n(owner.owner_name)),
    // The rep is `delegate`, not `reference_num`. The latter is their reference number and was written into the name field, showing a number as the rep.
    agentName: n(x.delegate && x.delegate.name),
    externalRef: n(x.reference_num),
    // Analytics grouping fields that were not carried over.
    // Type, branch, load and length are columns filtered and aggregated on our pages, and were empty on every migrated row because they were simply not read from the payload.
    truckType: label(x.truck_type),
    truckLength: label(x.truck_size),
    cargoType: label(x.load_type),
    branch: label(x.branch),
    addressFrom: label(x.address_from),
    addressTo: label(x.address_to),
    pickupTime: date(x.pick_time),
    startTime: date(x.starting_time),
    arrivalTime: date(x.access_time),
    sellPrice: num(x.selling_price),
    buyPrice: num(x.purchase_price),
    driverRentType: n(x.driver_rental_type),
    driverRentPrice: num(x.driver_rental_price),
    paymentMethod: n(x.payment_method),
    status: STATUS[n(x.status)] || 'requesting',
    notes: n(x.notes),
  };
}

/** Persists a batch of platform shipments. It never touches our own shipments: matching is by platform id and ours have no external id. */
async function upsertPlatformShipments(items) {
  if (!Array.isArray(items) || !items.length) return { created: 0, updated: 0 };
  const ShipmentOrder = require('../models/ShipmentOrder');
  const mapped = items.map(mapShipment).filter((m) => m.externalId);
  // Use the approved customer name, not the incoming one.
  // An old payload carrying the pre-correction spelling would overwrite the correct one, so every name is mapped back to the approved collections party name through its alternate forms; see utils/renameOpsCustomer and opsWorkflowSyncService.
  try {
    const CollectionsParty = require('../models/CollectionsParty');
    const { fold } = CollectionsParty;
    const cache = require('../utils/ttlCache');
    const canon = await cache.wrap('so:canonicalCustomerName', 60000, async () => {
      const rows = await CollectionsParty.find({ kind: 'customer', isActive: { $ne: false } })
        .select('name nameKey aliasKeys').lean();
      const out = {};
      for (const p of rows) {
        const nm = String(p.name || '').trim();
        if (!nm) continue;
        for (const k of [p.nameKey || fold(nm), ...(p.aliasKeys || [])]) if (k && !out[k]) out[k] = nm;
      }
      return out;
    });
    for (const m2 of mapped) {
      const c = canon[fold(m2.customerName || '')];
      if (c) m2.customerName = c;
    }
  } catch (_) { /* The name as received. */ }
  if (!mapped.length) return { created: 0, updated: 0 };

  // The platform route is recorded without its price.
  // A platform shipment carries a route that may be missing from the customer's file, so it is added; whoever creates a shipment later finds the route there instead of typing it.
  // Its price is NOT taken: the platform writes selling equal to purchase, so learning it would corrupt every correct price in the file and make the create screen suggest the cost price. Price comes from our own work: a shipment we price, a correction in private operations, or the branches report.
  try {
    const { learnRouteByName } = require('../utils/customerRoutes');
    const seen = new Set();
    for (const m2 of mapped) {
      const k = `${m2.customerName}|${m2.fromCity}|${m2.toCity}`;
      if (!m2.customerName || !m2.fromCity || !m2.toCity || seen.has(k)) continue;
      seen.add(k);
      // eslint-disable-next-line no-await-in-loop
      await learnRouteByName(m2.customerName, {
        fromCity: m2.fromCity, toCity: m2.toCity, price: null, at: m2.pickupTime, source: 'platform',
      });
    }
  } catch (e) { /* Learning the route is an improvement, not a requirement for persisting the shipment. */ }

  const ids = mapped.map((m) => m.externalId);
  const have = new Set(
    (await ShipmentOrder.find({ externalId: { $in: ids } }).select('externalId').lean())
      .map((d) => String(d.externalId)),
  );

  const ops = mapped.map((m) => {
    // The trip note is not erased by an empty platform value.
    // Every sync wrote `notes` as received, usually empty for platform shipments, which wiped notes our team had written within minutes. An empty value is written only on create; a note the platform actually wrote is written as it is.
    const set = { ...m };
    const onInsert = { createdAt: new Date() };
    if (!String(set.notes || '').trim()) { delete set.notes; onInsert.notes = ''; }
    return { updateOne: {
      filter: { externalId: m.externalId },
      // `$setOnInsert` on createdAt only: a migrated shipment keeps its original creation date and is not rewritten on every sync, which would make it look new each time.
      update: { $set: set, $setOnInsert: onInsert },
      upsert: true,
    } };
  });
  const r = await ShipmentOrder.bulkWrite(ops, { ordered: false });
  // Every caller announces `shipmentOrders:updated` after this; the dashboards it wakes must not read a cache built before the write.
  if (r.upsertedCount || r.modifiedCount) {
    try { const cache = require('../utils/ttlCache'); cache.clear('so:analytics:'); cache.clear('so:dashboard:'); } catch (_) { /* */ }
  }
  return {
    created: r.upsertedCount || 0,
    updated: (r.modifiedCount || 0),
    seen: mapped.length,
    known: have.size,
  };
}

module.exports = { upsertPlatformShipments, mapShipment };
