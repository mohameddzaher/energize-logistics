/**
 * Store issue requests (طلب صرف): both stores (light and heavy transport) issue stock only through these.
 * A request is the stock-out itself: saving it writes one outgoing movement per line, linked to the vehicle and the request number.
 * Stock is taken with conditional decrements (`quantity >= wanted`), so two requests racing for the last pieces cannot drive a balance below zero; a failure part-way is compensated before answering.
 * Posted requests are never edited. Cancelling reverses every movement on the record, like a movement reversal.
 */
const mongoose = require('mongoose');
const { Ls2StoreItem, Ls2StoreMovement } = require('../models/Ls2Store');
const { StoreIssueRequest, nextIssueNumber } = require('../models/StoreIssueRequest');
const { todayKey } = require('../utils/companyDay');
const logAudit = require('../utils/auditLogger');
const { resolveLs2Plate } = require('../services/ls2VehicleLink');
const { ISSUE_REASON_KEYS, ISSUE_REASONS, issueReasonLabel } = require('../utils/storeIssueReasons');

const MAX_LINES = 100;
const whOf = (req) => (String(req.query.warehouse || req.body?.warehouse || '').trim() === 'light' ? 'light' : 'heavy');
const whFilter = (wh) => (wh === 'light' ? { warehouse: 'light' } : { warehouse: { $ne: 'light' } });
const actor = (req) => ({
  id: req.user?._id,
  name: req.user ? `${req.user.firstName || ''} ${req.user.lastName || ''}`.trim() : '',
});
// Quantities may be fractional (litres); three decimals avoid float drift in balances.
const r3 = (n) => Math.round((Number(n) || 0) * 1000) / 1000;
const plateKeyOf = (v) => String(v ?? '').replace(/[^0-9A-Za-zء-ي]/g, '').toUpperCase();
const emit = () => { require('../utils/ls2Touch').touchLs2({ store: true, issueRequests: true }); };

/** Registry vehicle, rider and project behind a plate, as the store's vehicle picker shows them. Heavy trucks have no project; their driver comes from the fleet mirror. */
async function vehicleContext(plate, wh = 'light') {
  if (wh === 'heavy') {
    const vehicleMaster = await resolveLs2Plate(plate, { heavy: true }).catch(() => null);
    let rider = '';
    try {
      const { plateKey } = require('../utils/plateKey');
      const Ls2Vehicle = require('../models/Ls2Vehicle');
      const key = plateKey(plate);
      const v = key ? (await Ls2Vehicle.find({}).select('plate driver').lean()).find((x) => plateKey(x.plate) === key) : null;
      rider = v?.driver || '';
    } catch (_) { /* The plate is what is issued to. */ }
    return { vehicleMaster, rider, project: '' };
  }
  const vehicleMaster = await resolveLs2Plate(plate, { heavy: false }).catch(() => null);
  let rider = ''; let project = '';
  try {
    const { LightTransportEmployee } = require('../models/LightTransport');
    let emp = vehicleMaster
      ? await LightTransportEmployee.findOne({ vehicle: vehicleMaster, isActive: { $ne: false } }).select('name projectAr').lean()
      : null;
    if (!emp) {
      const key = plateKeyOf(plate);
      const rows = await LightTransportEmployee.find({ isActive: { $ne: false }, vehiclePlate: { $nin: ['', null] } }).select('name projectAr vehiclePlate').lean();
      emp = rows.find((e) => plateKeyOf(e.vehiclePlate) === key) || null;
    }
    if (emp) { rider = emp.name || ''; project = emp.projectAr || ''; }
    if (!rider && vehicleMaster) {
      const { VehicleMaster } = require('../models/VehicleMaster');
      const vm = await VehicleMaster.findById(vehicleMaster).select('authorizedPerson').lean();
      rider = vm?.authorizedPerson?.name || '';
    }
  } catch (_) { /* The request stands without the rider; the plate is what is issued to. */ }
  return { vehicleMaster, rider, project };
}

/** Adds back what was taken from each item; used when a request fails part-way. */
async function giveBack(taken) {
  for (const [id, qty] of taken) {
    // eslint-disable-next-line no-await-in-loop
    await Ls2StoreItem.updateOne({ _id: id }, { $inc: { quantity: qty } }).catch((e) => console.error('issue request give-back', id, e.message));
  }
}

// GET /store/issue-requests
exports.list = async (req, res) => {
  try {
    const wh = whOf(req);
    const filter = { ...whFilter(wh) };
    if (['posted', 'cancelled'].includes(String(req.query.status || ''))) filter.status = req.query.status;
    const ymd = /^\d{4}-\d{2}-\d{2}$/;
    const from = ymd.test(String(req.query.from || '')) ? req.query.from : '';
    const to = ymd.test(String(req.query.to || '')) ? req.query.to : '';
    if (from || to) filter.date = { ...(from ? { $gte: from } : {}), ...(to ? { $lte: to } : {}) };
    const q = String(req.query.q || '').trim().slice(0, 60);
    if (q) {
      const rx = new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
      filter.$or = [{ number: rx }, { vehiclePlate: rx }, { rider: rx }, { project: rx }, { 'lines.itemName': rx }, { 'lines.itemCode': rx }, { createdByName: rx }];
    }
    const limit = Math.min(Number(req.query.limit) || 300, 2000);
    const rows = await StoreIssueRequest.find(filter).sort({ seq: -1 }).limit(limit).lean();
    res.json({
      requests: rows.map((r) => ({
        ...r,
        issueReasonAr: issueReasonLabel(r.issueReason),
        lineCount: r.lines.length,
        totalQty: r3(r.lines.reduce((a, l) => a + (Number(l.quantity) || 0), 0)),
      })),
      reasons: ISSUE_REASONS,
    });
  } catch (e) { console.error('issue requests list', e); res.status(500).json({ message: 'تعذّر تحميل طلبات الصرف' }); }
};

// GET /store/issue-requests/:id
exports.get = async (req, res) => {
  try {
    const r = await StoreIssueRequest.findOne({ _id: req.params.id, ...whFilter(whOf(req)) }).lean();
    if (!r) return res.status(404).json({ message: 'طلب الصرف غير موجود' });
    res.json({ request: { ...r, issueReasonAr: issueReasonLabel(r.issueReason) } });
  } catch (e) { res.status(500).json({ message: 'تعذّر تحميل طلب الصرف' }); }
};

/**
 * POST /store/issue-requests { vehiclePlate, issueReason, note?, lines: [{ item, quantity }] }
 * All or nothing: any invalid line rejects the request with `errors: [{ line, message }]` and no balance changes.
 * Several lines of one item are checked against the balance together.
 */
exports.create = async (req, res) => {
  try {
    const out = await postIssue({ wh: whOf(req), who: actor(req), body: req.body || {}, user: req.user, ip: req.ip });
    res.status(out.status).json(out.body);
  } catch (e) { console.error('issue request create', e); res.status(500).json({ message: 'تعذّر حفظ طلب الصرف — لم يتغيّر أيّ رصيد' }); }
};

/**
 * Posts one issue request and its movements; shared by the store screen and maintenance records.
 * Returns `{ status, body }` with the HTTP status and payload; nothing is written unless status is 201.
 * `maintenanceRecord` links the request to the maintenance record that consumed the parts.
 */
async function postIssue({ wh, who, body, user, ip, maintenanceRecord = null }) {
  const b = body || {};
  const vehiclePlate = String(b.vehiclePlate || '').trim().slice(0, 40);
  const issueReason = String(b.issueReason || '').trim();
  const note = String(b.note || '').trim().slice(0, 500);
  const raw = Array.isArray(b.lines) ? b.lines : [];
  // The day the parts were actually issued, picked by the storekeeper (entry often follows the paper); createdAt keeps when it was recorded.
  const today = todayKey();
  const date = /^\d{4}-\d{2}-\d{2}$/.test(String(b.date || '')) ? String(b.date) : '';

  if (!date) return reply(400, { code: 'ISSUE_DATE_REQUIRED', message: 'اختر تاريخ الصرف' });
  if (date > today) return reply(400, { code: 'ISSUE_DATE_FUTURE', message: 'تاريخ الصرف لا يكون بعد اليوم' });
  if (!vehiclePlate) return reply(400, { message: 'اختر المركبة' });
  if (!ISSUE_REASON_KEYS.includes(issueReason)) return reply(400, { code: 'ISSUE_REASON_REQUIRED', message: 'اختر سبب الصرف' });
  if (!raw.length) return reply(400, { message: 'أضف صنفًا واحدًا على الأقل' });
  if (raw.length > MAX_LINES) return reply(400, { message: `الحدّ الأقصى ${MAX_LINES} سطر في الطلب الواحد` });

  const errors = [];
  const lines = [];
  raw.forEach((l, i) => {
    const line = i + 1;
    const id = String(l?.item || '').trim();
    const qty = r3(l?.quantity);
    if (!mongoose.isValidObjectId(id)) { errors.push({ line, message: 'اختر الصنف' }); return; }
    if (!(Number(l?.quantity) > 0) || !(qty > 0)) { errors.push({ line, item: id, message: 'الكمية يجب أن تكون أكبر من صفر' }); return; }
    lines.push({ line, item: id, quantity: qty });
  });

  const ids = [...new Set(lines.map((l) => l.item))];
  const items = ids.length ? await Ls2StoreItem.find({ _id: { $in: ids }, ...whFilter(wh), isActive: { $ne: false } }).lean() : [];
  const byId = new Map(items.map((it) => [String(it._id), it]));
  const wanted = new Map();
  for (const l of lines) {
    if (!byId.has(l.item)) { errors.push({ line: l.line, item: l.item, message: 'الصنف غير موجود في هذا المخزن' }); continue; }
    wanted.set(l.item, r3((wanted.get(l.item) || 0) + l.quantity));
  }
  for (const [id, total] of wanted) {
    const it = byId.get(id);
    if ((Number(it.quantity) || 0) < total) {
      lines.filter((l) => l.item === id).forEach((l) => errors.push({
        line: l.line, item: id, message: `${it.name}: الرصيد ${r3(it.quantity)} ${it.unit || ''} والمطلوب ${total}`.replace(/\s+/g, ' '),
      }));
    }
  }
  if (errors.length) {
    errors.sort((a, b2) => a.line - b2.line);
    return reply(400, { message: 'رُفض الطلب — لم يُصرَف أيّ صنف', errors });
  }

  // Take the stock: each item once, for the total of its lines, only if the balance still covers it.
  const taken = new Map();
  const after = new Map();
  for (const [id, total] of wanted) {
    // eslint-disable-next-line no-await-in-loop
    const upd = await Ls2StoreItem.findOneAndUpdate(
      { _id: id, quantity: { $gte: total } },
      { $inc: { quantity: -total } },
      { new: true },
    ).lean();
    if (!upd) {
      await giveBack(taken);
      // eslint-disable-next-line no-await-in-loop
      const now = await Ls2StoreItem.findById(id).select('name quantity unit').lean();
      return reply(409, {
        message: 'تغيّر الرصيد أثناء الحفظ — لم يُصرَف أيّ صنف',
        errors: lines.filter((l) => l.item === id).map((l) => ({ line: l.line, item: id, message: `${now?.name || ''}: الرصيد الآن ${r3(now?.quantity)} والمطلوب ${total}` })),
      });
    }
    taken.set(id, total);
    after.set(id, r3(upd.quantity));
  }

  let request = null;
  try {
    const ctx = await vehicleContext(vehiclePlate, wh);
    const { seq, number } = await nextIssueNumber(wh);
    // Balance after each line, in line order: the item's balance before the request minus what this and earlier lines took.
    const running = new Map([...wanted].map(([id, total]) => [id, r3(after.get(id) + total)]));
    const docLines = lines.map((l) => {
      const it = byId.get(l.item);
      const bal = r3(running.get(l.item) - l.quantity);
      running.set(l.item, bal);
      return { item: it._id, itemName: it.name, itemCode: it.code || '', unit: it.unit || '', quantity: l.quantity, balanceAfter: bal };
    });
    request = await StoreIssueRequest.create({
      warehouse: wh, seq, number, date, vehiclePlate, ...ctx, issueReason, note, maintenanceRecord,
      lines: docLines, createdBy: who.id, createdByName: who.name,
    });
    const reason = `طلب صرف ${number}${note ? ` — ${note}` : ''}`;
    const mvs = await Ls2StoreMovement.insertMany(request.lines.map((l) => ({
      item: l.item, itemName: l.itemName, warehouse: wh, type: 'out', quantity: l.quantity,
      vehiclePlate, vehicleMaster: ctx.vehicleMaster || null, reason, issueReason, date,
      balanceAfter: l.balanceAfter, issueRequest: request._id, issueRequestNo: number,
      performedBy: who.id, performedByName: who.name,
    })));
    request.lines.forEach((l, i) => { l.movement = mvs[i]._id; });
    await request.save();
  } catch (e) {
    console.error('issue request create', e);
    // Undo whatever was written so the store is as it was before the request.
    await giveBack(taken);
    if (request) {
      await Ls2StoreMovement.deleteMany({ issueRequest: request._id }).catch(() => {});
      await StoreIssueRequest.deleteOne({ _id: request._id }).catch(() => {});
    }
    return reply(500, { message: 'تعذّر حفظ طلب الصرف — لم يتغيّر أيّ رصيد' });
  }

  logAudit({
    user, action: 'store_issue_request_create', entity: 'StoreIssueRequest', entityId: request._id,
    changes: { after: { number: request.number, vehiclePlate, lines: request.lines.map((l) => `${l.itemName} × ${l.quantity}`) } }, ipAddress: ip,
  }).catch(() => {});
  emit();
  return reply(201, { request: { ...request.toObject(), issueReasonAr: issueReasonLabel(issueReason) } });
}
const reply = (status, body) => ({ status, body });
exports.postIssue = postIssue;

/**
 * POST /store/issue-requests/:id/cancel { reason }
 * Returns every line to stock with an opposite movement linked to the original, under the canceller's name and reason; the request stays listed as cancelled.
 */
exports.cancel = async (req, res) => {
  try {
    // A request written by a maintenance record is cancelled from that record, so the record and the store never disagree.
    const linked = await StoreIssueRequest.findOne({ _id: req.params.id, maintenanceRecord: { $ne: null } }).select('number').lean();
    if (linked) {
      return res.status(400).json({ code: 'ISSUE_FROM_MAINTENANCE', message: `طلب الصرف ${linked.number} ناتج عن سجل صيانة — ألغِ سجل الصيانة من ملف المركبة` });
    }
    const out = await cancelIssue({ id: req.params.id, wh: whOf(req), who: actor(req), reason: req.body?.reason, user: req.user, ip: req.ip });
    res.status(out.status).json(out.body);
  } catch (e) { console.error('issue request cancel', e); res.status(500).json({ message: 'تعذّر إلغاء طلب الصرف' }); }
};

/** Cancels one posted request and returns its stock; shared by the store screen and maintenance records. Returns `{ status, body }`. */
async function cancelIssue({ id, wh, who, reason: rawReason, user, ip }) {
  const reason = String(rawReason || '').trim().slice(0, 300);
  if (reason.length < 3) return reply(400, { message: 'اكتب سبب الإلغاء — يُسجَّل في السجل باسمك' });
  // The status flips first and atomically, so a double click cannot return the stock twice.
  const request = await StoreIssueRequest.findOneAndUpdate(
    { _id: id, ...whFilter(wh), status: 'posted' },
    { $set: { status: 'cancelled', cancelledAt: new Date(), cancelledBy: who.id, cancelledByName: who.name, cancelReason: reason } },
    { new: true },
  );
  if (!request) {
    const exists = await StoreIssueRequest.exists({ _id: id, ...whFilter(wh) });
    return reply(exists ? 400 : 404, { message: exists ? 'الطلب ملغى من قبل' : 'طلب الصرف غير موجود' });
  }
  const originals = await Ls2StoreMovement.find({ issueRequest: request._id, type: 'out', reversed: { $ne: true }, reversalOf: null });
  const date = todayKey();
  for (const mv of originals) {
    // eslint-disable-next-line no-await-in-loop
    const it = await Ls2StoreItem.findByIdAndUpdate(mv.item, { $inc: { quantity: mv.quantity } }, { new: true }).lean();
    // eslint-disable-next-line no-await-in-loop
    await Ls2StoreMovement.create({
      item: mv.item, itemName: mv.itemName, warehouse: mv.warehouse, type: 'in', quantity: mv.quantity,
      vehiclePlate: mv.vehiclePlate, vehicleMaster: mv.vehicleMaster || null,
      reason: `إلغاء طلب الصرف ${request.number} — ${reason}`, date,
      balanceAfter: it ? r3(it.quantity) : 0, reversalOf: mv._id,
      issueRequest: request._id, issueRequestNo: request.number,
      performedBy: who.id, performedByName: who.name,
    });
    mv.reversed = true; mv.reversedAt = new Date(); mv.reversedBy = who.id; mv.reversedByName = who.name; mv.reversalReason = reason;
    // eslint-disable-next-line no-await-in-loop
    await mv.save();
  }
  logAudit({
    user, action: 'store_issue_request_cancel', entity: 'StoreIssueRequest', entityId: request._id,
    changes: { before: { status: 'posted' }, after: { status: 'cancelled', number: request.number, reason, movements: originals.length } }, ipAddress: ip,
  }).catch(() => {});
  emit();
  return reply(200, { request });
}
exports.cancelIssue = cancelIssue;

// GET /store/issue-requests/:id/pdf
exports.pdf = async (req, res) => {
  try {
    const r = await StoreIssueRequest.findOne({ _id: req.params.id, ...whFilter(whOf(req)) }).lean();
    if (!r) return res.status(404).json({ message: 'طلب الصرف غير موجود' });
    const { renderIssueRequestPdf } = require('../utils/issueRequestPdf');
    const pdf = await renderIssueRequestPdf({ ...r, issueReasonAr: issueReasonLabel(r.issueReason) });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="issue-request-${r.number}.pdf"`);
    res.send(pdf);
  } catch (e) { console.error('issue request pdf', e); res.status(500).json({ message: 'تعذّر توليد ملف طلب الصرف' }); }
};
