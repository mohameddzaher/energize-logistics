/**
 * A carrier driver's mobile number: one value on his register row, copied to the shipments he is driving now.
 * Changed from the request completion form or the drivers register; every screen and call button then reads the new number.
 */
const ShipmentOrderDriver = require('../models/ShipmentOrderDriver');

// Shipments still on the road: their driver may be called now, so they carry the newest number. Closed ones keep what they had.
const LIVE_STATUSES = ['requesting', 'loading', 'uploaded', 'on_way', 'arrived', 'late'];

/** Saudi mobile in any common spelling → 05XXXXXXXX; '' when empty; null when not a Saudi mobile. */
function normalizeSaMobile(raw) {
  const s = String(raw ?? '').replace(/[٠-٩]/g, (d) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d))).replace(/[\s\-().]/g, '');
  if (!s) return '';
  const m = s.match(/^(?:\+?966|00966|0)?(5\d{8})$/);
  return m ? `0${m[1]}` : null;
}

/**
 * Sets the driver's mobile, keeps the previous one in his history, and moves the shipments he is driving to it.
 * Returns { driver, changed, orders } or throws a 400 with an Arabic message.
 */
async function setDriverPhone(driverId, raw, user) {
  const fail = (m) => { const e = new Error(m); e.status = 400; throw e; };
  const phone = normalizeSaMobile(raw);
  if (phone === null) fail('رقم جوال السائق غير صحيح: رقمٌ سعوديٌّ من عشرة أرقام يبدأ بـ 05');
  const d = await ShipmentOrderDriver.findById(driverId).lean();
  if (!d) fail('السائق غير موجود');
  const before = String(d.phone || '').trim();
  if ((normalizeSaMobile(before) || before) === phone) return { driver: d, changed: false, orders: 0 };
  const who = user ? `${user.firstName || ''} ${user.lastName || ''}`.trim() : '';
  await ShipmentOrderDriver.updateOne({ _id: d._id }, {
    $set: { phone },
    ...(before ? { $push: { phoneHistory: { $each: [{ phone: before, changedAt: new Date(), byName: who }], $slice: -20 } } } : {}),
  });
  const orders = await propagate(d.name, before, phone);
  return { driver: await ShipmentOrderDriver.findById(d._id).lean(), changed: true, orders };
}

/** The driver's live shipments (by his name, as orders record him) take the new number; each is announced so lists, the workflow and the fleet follow. */
async function propagate(name, before, phone) {
  const ShipmentOrder = require('../models/ShipmentOrder');
  const n = String(name || '').trim();
  if (!n) return 0;
  const rows = await ShipmentOrder.find({ driverName: n, status: { $in: LIVE_STATUSES }, driverPhone: { $ne: phone } }).select('_id').limit(500).lean();
  if (!rows.length) return 0;
  await ShipmentOrder.updateMany({ _id: { $in: rows.map((r) => r._id) } }, { $set: { driverPhone: phone } });
  const so = require('../controllers/shipmentOrdersController');
  for (const r of rows) so.announceOrderChange(r._id);
  return rows.length;
}

/** Tells every open screen the drivers register changed (vendors, drivers, shipment orders listen to it). */
function announce(driverId) {
  try {
    const { emitToAll } = require('../websocket/socketManager');
    emitToAll('shipmentOrders:fleet', { driver: String(driverId || '') });
    emitToAll('shipmentOrders:updated', {});
  } catch (_) { /* */ }
}

module.exports = { normalizeSaMobile, setDriverPhone, propagate, announce, LIVE_STATUSES };
