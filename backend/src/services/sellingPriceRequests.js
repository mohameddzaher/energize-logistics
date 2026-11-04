/**
 * Selling-price change requests: created instead of the write when a REQUEST_ROLES
 * user edits the selling price, and applied on approval through the origin side's
 * normal write path, so the workflow, the shipment order and their caches/sockets
 * move exactly as for a direct edit. See config/sellingPriceRequests.
 */
const mongoose = require('mongoose');
const Request = require('../models/SellingPriceChangeRequest');
const OperationsWorkflow = require('../models/OperationsWorkflow');
const ShipmentOrder = require('../models/ShipmentOrder');
const logAudit = require('../utils/auditLogger');
const { emitToAll } = require('../websocket/socketManager');
const { canApproveSelling, EVENT } = require('../config/sellingPriceRequests');

const str = (v) => String(v == null ? '' : v).trim();
const round = (v) => Math.round(Number(v) * 100) / 100;
const fullName = (u) => (u ? `${u.firstName || ''} ${u.lastName || ''}`.trim() : '');

const announce = (payload) => { try { emitToAll(EVENT, payload); } catch (_) { /* */ } };

/** The other half of a shipment: workflow row → order, or order → row. */
async function orderOfRow(w) {
  if (!w) return null;
  if (w.shipmentOrder) return ShipmentOrder.findById(w.shipmentOrder).lean();
  if (w.externalSource === 'ops_upl' && w.externalId) {
    return ShipmentOrder.findOne({ source: 'platform', externalId: String(w.externalId) }).lean();
  }
  return null;
}
async function rowOfOrder(o) {
  if (!o) return null;
  const linked = await OperationsWorkflow.findOne({ shipmentOrder: o._id }).lean();
  if (linked) return linked;
  if (o.source === 'platform' && o.externalId) {
    return OperationsWorkflow.findOne({ externalSource: 'ops_upl', externalId: String(o.externalId) }).lean();
  }
  return null;
}

/** Order details for the approver's list, from whichever side is at hand. */
function snapshot(w, o) {
  return {
    reportNumber: str(w?.reportNumber) || str(o?.graduationNumber || o?.waybillNumber || o?.reference),
    customerName: str(w?.username) || str(o?.customerName),
    fromCity: str(w?.fromLocation) || str(o?.fromCity),
    toCity: str(w?.toLocation) || str(o?.toCity),
    orderDate: w?.reportDate || o?.pickupTime || o?.createdAt || null,
    driverName: str(w?.driverName) || str(o?.driverName),
    plate: str(w?.plateNumber || w?.carNumber) || str(o?.vehiclePlate),
  };
}

/**
 * Records a requested selling price instead of writing it.
 * Returns { unchanged } when the value equals the current one, { error } for a bad value,
 * otherwise { request }. One pending request per order: a second edit replaces the first.
 */
async function createRequest({ workflow = null, order = null, origin, raw, user }) {
  const v = raw === '' || raw === null || raw === undefined ? 0 : Number(raw);
  if (!Number.isFinite(v) || v < 0) {
    return { error: { status: 400, body: { code: 'BAD_SELLING_VALUE', fields: [origin === 'workflow' ? 'sellingValue' : 'sellPrice'], message: 'سعر البيع يجب أن يكون رقمًا لا يقلّ عن صفر.' } } };
  }
  const value = round(v);
  const w = workflow || await rowOfOrder(order);
  const o = order || await orderOfRow(workflow);
  const current = origin === 'workflow' ? Number(w?.sellingValue) || 0 : Number(o?.sellPrice) || 0;
  if (value === round(current)) return { unchanged: true, value };

  const key = w ? { workflow: w._id } : { shipmentOrder: o._id };
  const fields = {
    workflow: w?._id || null,
    shipmentOrder: o?._id || null,
    origin,
    ...snapshot(w, o),
    oldPrice: round(current),
    requestedPrice: value,
    requestedBy: user._id,
    requestedByName: fullName(user),
    requestedByRole: user.role,
    requestedAt: new Date(),
  };
  const request = await Request.findOneAndUpdate(
    { ...key, status: 'pending' },
    { $set: fields },
    { new: true, upsert: true, setDefaultsOnInsert: true },
  );
  await logAudit({
    user, action: 'selling_price_request', entity: 'SellingPriceChangeRequest', entityId: request._id,
    changes: { before: { sellingPrice: fields.oldPrice }, after: { requestedPrice: value, reportNumber: fields.reportNumber } },
  });
  announce({ id: String(request._id), status: 'pending' });
  return { request };
}

const PENDING_MESSAGE = 'أُرسل طلب تعديل سعر البيع للاعتماد — يبقى السعر الحالي حتى يعتمده مدير المبيعات أو الإدارة.';

/** Writes the approved price through the origin side's normal path, then aligns the other side. */
async function applyPrice(reqDoc, user, ip) {
  const link = require('./shipmentOrderWorkflowLink');
  const note = `اعتماد طلب تعديل سعر البيع ${reqDoc._id}`;
  if (reqDoc.origin === 'workflow' && reqDoc.workflow) {
    const r = await require('../controllers/workflowController')
      .writeSellingValue(reqDoc.workflow, reqDoc.requestedPrice, user, { ip, note });
    if (r.status !== 200) return r;
    // Awaited so the shipment order agrees before the approver's reply.
    await link.pullWorkflow(reqDoc.workflow, user).catch((e) => console.error('[selling-req] pull:', e.message));
    await link.pullPlatformRow(reqDoc.workflow, ['sellingValue']).catch((e) => console.error('[selling-req] pull platform:', e.message));
    return r;
  }
  const order = reqDoc.shipmentOrder && await ShipmentOrder.findById(reqDoc.shipmentOrder);
  if (!order) return { status: 404, body: { message: 'أمر النقل غير موجود' } };
  const r = await require('../controllers/shipmentOrdersController').writeSellPrice(order, reqDoc.requestedPrice, user, { ip, note });
  if (r.status !== 200) return r;
  if (order.source === 'platform') await link.mirrorPlatformOrder(order._id, ['sellPrice']).catch((e) => console.error('[selling-req] mirror platform:', e.message));
  else await link.mirrorOrder(order._id).catch((e) => console.error('[selling-req] mirror:', e.message));
  return r;
}

async function currentPrice(reqDoc) {
  if (reqDoc.origin === 'workflow' && reqDoc.workflow) {
    const w = await OperationsWorkflow.findById(reqDoc.workflow).select('sellingValue').lean();
    return w ? Number(w.sellingValue) || 0 : null;
  }
  const o = reqDoc.shipmentOrder && await ShipmentOrder.findById(reqDoc.shipmentOrder).select('sellPrice').lean();
  return o ? Number(o.sellPrice) || 0 : null;
}

async function decide(id, user, { approve, reason = '', ip } = {}) {
  if (!canApproveSelling(user)) {
    return { status: 403, body: { code: 'NOT_APPROVER', message: 'اعتماد طلبات سعر البيع لمدير المبيعات والإدارة العليا ومدير النظام فقط.' } };
  }
  if (!mongoose.isValidObjectId(id)) return { status: 404, body: { message: 'الطلب غير موجود' } };
  const reqDoc = await Request.findById(id);
  if (!reqDoc) return { status: 404, body: { message: 'الطلب غير موجود' } };
  if (reqDoc.status !== 'pending') {
    return { status: 409, body: { code: 'ALREADY_DECIDED', message: 'هذا الطلب قد بُتّ فيه من قبل.', request: reqDoc } };
  }
  // Claimed before writing so two approvers cannot apply it twice.
  const claimed = await Request.findOneAndUpdate(
    { _id: reqDoc._id, status: 'pending' },
    { $set: { status: approve ? 'approved' : 'rejected', decidedBy: user._id, decidedByName: fullName(user), decidedAt: new Date(), reason: str(reason) } },
    { new: true },
  );
  if (!claimed) return { status: 409, body: { code: 'ALREADY_DECIDED', message: 'هذا الطلب قد بُتّ فيه من قبل.' } };
  claimed.priceAtDecision = await currentPrice(claimed);

  if (approve) {
    const r = await applyPrice(claimed, user, ip);
    if (r.status !== 200) {
      // Nothing was written, so the request goes back to the queue.
      await Request.updateOne({ _id: claimed._id }, { $set: { status: 'pending', decidedBy: null, decidedByName: '', decidedAt: null, reason: '' } });
      return r;
    }
  }
  await claimed.save();
  await logAudit({
    user, action: approve ? 'selling_price_request_approve' : 'selling_price_request_reject',
    entity: 'SellingPriceChangeRequest', entityId: claimed._id, ipAddress: ip,
    changes: {
      before: { sellingPrice: claimed.priceAtDecision },
      after: { sellingPrice: approve ? claimed.requestedPrice : claimed.priceAtDecision, reportNumber: claimed.reportNumber, ...(claimed.reason ? { reason: claimed.reason } : {}) },
    },
  });
  announce({ id: String(claimed._id), status: claimed.status });
  return { status: 200, body: { request: claimed } };
}

const pendingCount = () => Request.countDocuments({ status: 'pending' });

/** Pending first, newest first inside each status. */
async function list({ status, q, limit } = {}) {
  const filter = {};
  if (['pending', 'approved', 'rejected'].includes(status)) filter.status = status;
  if (str(q)) {
    const rx = new RegExp(str(q).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
    filter.$or = [{ reportNumber: rx }, { customerName: rx }, { requestedByName: rx }, { fromCity: rx }, { toCity: rx }, { plate: rx }, { driverName: rx }];
  }
  const cap = Math.min(Math.max(Number(limit) || 300, 1), 1000);
  const rows = await Request.aggregate([
    { $match: filter },
    { $addFields: { _pending: { $cond: [{ $eq: ['$status', 'pending'] }, 0, 1] } } },
    { $sort: { _pending: 1, requestedAt: -1 } },
    { $limit: cap },
    { $project: { _pending: 0 } },
  ]);
  return { requests: rows, pending: await pendingCount() };
}

module.exports = { createRequest, decide, list, pendingCount, PENDING_MESSAGE };
