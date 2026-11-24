/**
 * A transport order cancelled anywhere (shipments page, operations workflow, fleet) leaves the shipment request it was placed from,
 * so the request's completed count drops and the truck can be placed again.
 * Wired from ShipmentOrder model hooks (every write path) and a periodic sweep for writes that bypass hooks.
 */
const mongoose = require('mongoose');

const CANCELLED_RX = /^(cancel+ed|ملغ[يىا]ة?|ملغاة)$/i;
const isCancelled = (s) => CANCELLED_RX.test(String(s || '').trim());

async function releaseOrders(orderIds) {
  const ids = [...new Set((orderIds || []).map(String))].filter(mongoose.isValidObjectId);
  if (!ids.length) return 0;
  const ShipmentOrder = require('../models/ShipmentOrder');
  const ShipmentRequest = require('../models/ShipmentRequest');
  const orders = await ShipmentOrder.find({ _id: { $in: ids }, shipmentRequest: { $ne: null } })
    .select('status cancelReason waybillNumber reference shipmentRequest').lean();
  const cancelled = orders.filter((o) => isCancelled(o.status));
  let n = 0;
  for (const o of cancelled) {
    // eslint-disable-next-line no-await-in-loop
    const r = await ShipmentRequest.findOne({ _id: o.shipmentRequest, 'placed.order': o._id });
    if (!r) continue;
    r.placed = r.placed.filter((p) => String(p.order) !== String(o._id));
    r.log.push({ action: 'order_cancelled', note: [`#${o.reference || o.waybillNumber || ''}`, o.cancelReason].filter(Boolean).join(' — '), waybillNumber: o.waybillNumber || null });
    if (r.status === 'completed' && r.placed.length < r.trucks) { r.status = 'in_progress'; r.closedAt = null; }
    if (r.status === 'in_progress' && !r.placed.length) r.status = 'pending';
    // eslint-disable-next-line no-await-in-loop
    await r.save();
    n += 1;
    try { require('../websocket/socketManager').emitToAll('shipmentRequests:changed', { id: String(r._id), status: r.status }); } catch (_) { /* */ }
  }
  if (n) { try { require('../utils/ttlCache').clear('so:analytics:'); } catch (_) { /* */ } }
  return n;
}

/** Hooks on the ShipmentOrder schema: a write that leaves an order cancelled releases it after the response. */
function attach(schema) {
  schema.post('save', function afterSave(doc) {
    if (doc && doc.shipmentRequest && isCancelled(doc.status)) setImmediate(() => releaseOrders([doc._id]).catch((e) => console.error('[request-release]', e.message)));
  });
  schema.post('findOneAndUpdate', function afterFoau(doc) {
    if (doc && doc.shipmentRequest && isCancelled(doc.status)) setImmediate(() => releaseOrders([doc._id]).catch((e) => console.error('[request-release]', e.message)));
  });
  for (const op of ['updateOne', 'updateMany']) {
    schema.post(op, function afterUpdate() {
      const u = this.getUpdate() || {};
      const status = (u.$set && u.$set.status) || u.status;
      if (!isCancelled(status)) return;
      const filter = this.getFilter();
      const Model = this.model;
      setImmediate(async () => {
        try {
          const rows = await Model.find({ ...filter, shipmentRequest: { $ne: null } }).select('_id').lean();
          await releaseOrders(rows.map((r) => r._id));
        } catch (e) { console.error('[request-release]', e.message); }
      });
    });
  }
}

/** Every ten minutes: placed orders that are cancelled but still counted on their request. */
async function sweep() {
  const ShipmentRequest = require('../models/ShipmentRequest');
  const ShipmentOrder = require('../models/ShipmentOrder');
  const reqs = await ShipmentRequest.find({ status: { $in: ['pending', 'in_progress', 'completed'] }, 'placed.0': { $exists: true } }).select('placed.order').lean();
  const ids = reqs.flatMap((r) => (r.placed || []).map((p) => p.order));
  if (!ids.length) return 0;
  const cancelled = await ShipmentOrder.find({ _id: { $in: ids }, status: { $in: ['cancelled', 'canceled', 'ملغي', 'ملغى', 'ملغاة'] } }).select('_id').lean();
  return releaseOrders(cancelled.map((o) => o._id));
}
function startSweep() {
  const run = () => sweep().then((n) => { if (n) console.log(`[request-release] released ${n}`); }).catch((e) => console.error('[request-release] sweep:', e.message));
  setTimeout(run, 60 * 1000);
  setInterval(run, 10 * 60 * 1000).unref();
}

module.exports = { releaseOrders, attach, sweep, startSweep, isCancelled };
