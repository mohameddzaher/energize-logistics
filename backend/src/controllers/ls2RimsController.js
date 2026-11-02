/**
 * ls2RimsController: rims (جنوط) on the tire side of the fleet-asset registry.
 * Counted stock, not serial assets: one row per brand/size/condition with a balance, and an immutable ledger of
 * movements (in, out, transfer between rim types, edits). Mistakes are reversed with a written reason, never edited,
 * the same rule as the store ledger. Balance changes are atomic ($inc guarded by the balance) so two workers racing
 * on the last rim cannot drive it negative.
 */
const mongoose = require('mongoose');
const { Ls2Rim, Ls2RimMovement, RIM_CONDITIONS, rimName, rimKey } = require('../models/Ls2Rim');
const { todayKey } = require('../utils/companyDay');
const { plateKey } = require('../utils/plateKey');
const logAudit = require('../utils/auditLogger');

const touch = () => require('../utils/ls2Touch').touchLs2({ assets: true, rims: true });
const actor = (req) => ({
  performedBy: req.user?._id || null,
  performedByName: req.user ? `${req.user.firstName || ''} ${req.user.lastName || ''}`.trim() : '',
});
const YMD = /^\d{4}-\d{2}-\d{2}$/;
const dayOf = (v) => (YMD.test(String(v || '').trim()) ? String(v).trim() : '');
const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
const str = (v, max = 300) => String(v ?? '').trim().slice(0, max);
const isId = (v) => /^[0-9a-f]{24}$/i.test(String(v || ''));

const CONDITION_LABELS = {
  new: { ar: 'جديد', en: 'New' },
  used: { ar: 'مستعمل', en: 'Used' },
  scrap: { ar: 'سكراب', en: 'Scrap' },
};
// What a user may pick per direction; the rest are written by the system.
const IN_REASONS = ['purchase', 'returned', 'count', 'other'];
const OUT_REASONS = ['mounted', 'sold', 'damaged', 'count', 'other'];
const REASON_LABELS = {
  purchase: { ar: 'شراء', en: 'Purchase' },
  returned: { ar: 'مرتجع من مركبة', en: 'Returned from a vehicle' },
  count: { ar: 'تسوية جرد', en: 'Stock-count adjustment' },
  mounted: { ar: 'تركيب على مركبة', en: 'Fitted to a vehicle' },
  sold: { ar: 'بيع', en: 'Sold' },
  damaged: { ar: 'تالف', en: 'Damaged' },
  transfer: { ar: 'تحويل بين الأصناف', en: 'Transfer between rim types' },
  from_store: { ar: 'رصيد منقول من المخزن', en: 'Balance moved from the store' },
  legacy: { ar: 'حركة سابقة في المخزن', en: 'Earlier store movement' },
  reversal: { ar: 'تراجع', en: 'Reversal' },
  created: { ar: 'إضافة صنف', en: 'Rim type added' },
  edited: { ar: 'تعديل بيانات', en: 'Details edited' },
  hidden: { ar: 'إخفاء الصنف', en: 'Rim type hidden' },
  other: { ar: 'أخرى', en: 'Other' },
};
// Reasons that tie a movement to a truck, so the plate is required.
const NEEDS_PLATE = new Set(['mounted', 'returned']);

const statusOf = (r) => (r.quantity <= 0 ? 'out' : (r.minQuantity > 0 && r.quantity <= r.minQuantity ? 'low' : 'ok'));
const decorate = (r) => ({
  ...r,
  conditionAr: CONDITION_LABELS[r.condition]?.ar || r.condition,
  status: statusOf(r),
  value: r2((Number(r.quantity) || 0) * (Number(r.unitPrice) || 0)),
});

async function plateLink(raw) {
  const vehiclePlate = str(raw, 40);
  if (!vehiclePlate) return { vehiclePlate: '', plateKey: null, vehicleMaster: null };
  const { resolveLs2Plate } = require('../services/ls2VehicleLink');
  const vehicleMaster = await resolveLs2Plate(vehiclePlate, { heavy: true }).catch(() => null);
  return { vehiclePlate, plateKey: plateKey(vehiclePlate) || null, vehicleMaster };
}

/** Brand, size and condition from a request, checked; returns { error } on bad input. */
function typeFields(body, current = {}) {
  const brand = body.brand !== undefined ? str(body.brand, 60) : current.brand;
  const size = body.size !== undefined ? str(body.size, 30) : current.size;
  const condition = body.condition !== undefined ? String(body.condition) : (current.condition || 'new');
  if (!brand) return { error: 'اختر نوع الجنط (الماركة)' };
  if (!size) return { error: 'اختر مقاس الجنط' };
  if (!RIM_CONDITIONS.includes(condition)) return { error: 'حالة الجنط غير صحيحة' };
  return { brand, size, condition };
}

async function activeTwin(fields, exceptId) {
  return Ls2Rim.findOne({ key: rimKey(fields), isActive: true, ...(exceptId ? { _id: { $ne: exceptId } } : {}) }).select('name').lean();
}

// GET /assets/rims
exports.listRims = async (req, res) => {
  try {
    const rows = (await Ls2Rim.find({ isActive: { $ne: false } }).sort({ brand: 1, size: 1, condition: 1 }).lean()).map(decorate);
    const byCondition = Object.fromEntries(RIM_CONDITIONS.map((c) => [c, rows.filter((r) => r.condition === c).reduce((a, r) => a + (r.quantity || 0), 0)]));
    res.json({
      rims: rows,
      totals: {
        types: rows.length,
        units: rows.reduce((a, r) => a + (r.quantity || 0), 0),
        value: r2(rows.reduce((a, r) => a + r.value, 0)),
        low: rows.filter((r) => r.status === 'low').length,
        out: rows.filter((r) => r.status === 'out').length,
        byCondition,
      },
      conditions: RIM_CONDITIONS.map((key) => ({ key, ...CONDITION_LABELS[key] })),
      reasons: {
        in: IN_REASONS.map((key) => ({ key, ...REASON_LABELS[key] })),
        out: OUT_REASONS.map((key) => ({ key, ...REASON_LABELS[key] })),
        all: Object.entries(REASON_LABELS).map(([key, v]) => ({ key, ...v })),
      },
    });
  } catch (e) { console.error('ls2 rims list', e); res.status(500).json({ message: 'تعذّر تحميل الجنوط' }); }
};

// GET /assets/rims/movements?rim&type&reason&from&to&q&limit
exports.listMovements = async (req, res) => {
  try {
    const filter = {};
    if (isId(req.query.rim)) filter.rim = req.query.rim;
    if (['in', 'out', 'edit'].includes(String(req.query.type || ''))) filter.type = req.query.type;
    if (REASON_LABELS[String(req.query.reason || '')]) filter.reason = req.query.reason;
    if (req.query.legacy === '0') filter.legacy = { $ne: true };
    const from = dayOf(req.query.from); const to = dayOf(req.query.to);
    if (from || to) filter.date = { ...(from ? { $gte: from } : {}), ...(to ? { $lte: to } : {}) };
    if (req.query.q && String(req.query.q).trim()) {
      const rx = new RegExp(String(req.query.q).trim().slice(0, 60).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
      filter.$or = [{ rimName: rx }, { vehiclePlate: rx }, { notes: rx }, { supplierName: rx }, { performedByName: rx }, { counterpartName: rx }];
    }
    const limit = Math.min(Number(req.query.limit) || 500, 5000);
    const rows = await Ls2RimMovement.find(filter).sort({ at: -1, _id: -1 }).limit(limit).lean();
    res.json({
      movements: rows.map((m) => ({
        ...m,
        reasonAr: REASON_LABELS[m.reason]?.ar || m.reason,
        reasonEn: REASON_LABELS[m.reason]?.en || m.reason,
        total: m.unitPrice != null ? r2(m.quantity * m.unitPrice) : null,
        canReverse: reversible(m) === null,
      })),
    });
  } catch (e) { console.error('ls2 rims movements', e); res.status(500).json({ message: 'تعذّر تحميل سجل الحركات' }); }
};

// POST /assets/rims { brand, size, condition, quantity?, unitPrice?, minQuantity?, notes?, supplierName?, date? }
exports.createRim = async (req, res) => {
  try {
    const f = typeFields(req.body || {});
    if (f.error) return res.status(400).json({ message: f.error });
    const twin = await activeTwin(f);
    if (twin) return res.status(409).json({ code: 'RIM_EXISTS', message: `«${twin.name}» مسجَّل من قبل — أضف الكمية إليه بحركة وارد`, rimId: twin._id });
    const qty = Number(req.body.quantity || 0);
    if (!Number.isInteger(qty) || qty < 0) return res.status(400).json({ message: 'العدد يجب أن يكون رقمًا صحيحًا لا يقل عن صفر' });
    const unitPrice = r2(req.body.unitPrice);
    if (unitPrice < 0) return res.status(400).json({ message: 'السعر غير صحيح' });
    let rim;
    try {
      rim = await Ls2Rim.create({
        ...f, quantity: qty, unitPrice, minQuantity: Math.max(0, Number(req.body.minQuantity) || 0),
        notes: str(req.body.notes, 500), createdByName: actor(req).performedByName,
      });
    } catch (e) {
      if (e?.code === 11000) return res.status(409).json({ code: 'RIM_EXISTS', message: `«${rimName(f)}» مسجَّل من قبل` });
      throw e;
    }
    const date = dayOf(req.body.date) || todayKey();
    await Ls2RimMovement.create(qty > 0
      ? { rim: rim._id, rimName: rim.name, type: 'in', reason: 'purchase', quantity: qty, balanceAfter: qty, unitPrice: unitPrice || null, supplierName: str(req.body.supplierName, 120), date, notes: str(req.body.notes, 500) || 'إضافة صنف جديد', ...actor(req) }
      : { rim: rim._id, rimName: rim.name, type: 'edit', reason: 'created', quantity: 0, balanceAfter: 0, date, notes: 'إضافة صنف جديد', ...actor(req) });
    logAudit({ user: req.user, action: 'rim_create', entity: 'Ls2Rim', entityId: rim._id, changes: { after: { name: rim.name, quantity: qty } }, ipAddress: req.ip }).catch(() => {});
    touch();
    res.status(201).json({ rim: decorate(rim.toObject()) });
  } catch (e) { console.error('ls2 rims create', e); res.status(500).json({ message: 'تعذّر إضافة الجنط' }); }
};

// PATCH /assets/rims/:id - details only; the balance moves through movements.
exports.updateRim = async (req, res) => {
  try {
    const rim = await Ls2Rim.findOne({ _id: req.params.id, isActive: { $ne: false } });
    if (!rim) return res.status(404).json({ message: 'الجنط غير موجود' });
    if (req.body.quantity !== undefined && Number(req.body.quantity) !== rim.quantity) {
      return res.status(400).json({ code: 'USE_MOVEMENT', message: 'الكمية لا تُعدَّل من هنا — سجّل وارد أو صادر أو تسوية جرد' });
    }
    const f = typeFields(req.body || {}, rim);
    if (f.error) return res.status(400).json({ message: f.error });
    const twin = await activeTwin(f, rim._id);
    if (twin) return res.status(409).json({ code: 'RIM_EXISTS', message: `«${twin.name}» مسجَّل من قبل — لا يُكرَّر الصنف`, rimId: twin._id });
    const before = { name: rim.name, unitPrice: rim.unitPrice, minQuantity: rim.minQuantity, notes: rim.notes };
    Object.assign(rim, f);
    if (req.body.unitPrice !== undefined) {
      const p = r2(req.body.unitPrice);
      if (p < 0) return res.status(400).json({ message: 'السعر غير صحيح' });
      rim.unitPrice = p;
    }
    if (req.body.minQuantity !== undefined) rim.minQuantity = Math.max(0, Number(req.body.minQuantity) || 0);
    if (req.body.notes !== undefined) rim.notes = str(req.body.notes, 500);
    const after = { name: rimName(rim), unitPrice: rim.unitPrice, minQuantity: rim.minQuantity, notes: rim.notes };
    const changed = Object.keys(after).filter((k) => String(before[k] ?? '') !== String(after[k] ?? ''));
    if (!changed.length) return res.json({ rim: decorate(rim.toObject()), unchanged: true });
    try { await rim.save(); } catch (e) {
      if (e?.code === 11000) return res.status(409).json({ code: 'RIM_EXISTS', message: `«${after.name}» مسجَّل من قبل` });
      throw e;
    }
    const FIELD_AR = { name: 'الاسم', unitPrice: 'السعر', minQuantity: 'حد التنبيه', notes: 'الملاحظات' };
    await Ls2RimMovement.create({
      rim: rim._id, rimName: rim.name, type: 'edit', reason: 'edited', quantity: 0, balanceAfter: rim.quantity, date: todayKey(),
      notes: changed.map((k) => `${FIELD_AR[k]}: ${before[k] || '—'} ← ${after[k] || '—'}`).join(' · ').slice(0, 600), ...actor(req),
    });
    logAudit({ user: req.user, action: 'rim_update', entity: 'Ls2Rim', entityId: rim._id, changes: { before, after }, ipAddress: req.ip }).catch(() => {});
    touch();
    res.json({ rim: decorate(rim.toObject()) });
  } catch (e) { console.error('ls2 rims update', e); res.status(500).json({ message: 'تعذّر تعديل الجنط' }); }
};

// DELETE /assets/rims/:id - hide an empty rim type; stock must be moved out first so nothing vanishes silently.
exports.hideRim = async (req, res) => {
  try {
    const rim = await Ls2Rim.findOneAndUpdate({ _id: req.params.id, isActive: true, quantity: 0 }, { $set: { isActive: false } }, { new: true });
    if (!rim) {
      const cur = await Ls2Rim.findById(req.params.id).select('quantity isActive name').lean();
      if (!cur || cur.isActive === false) return res.status(404).json({ message: 'الجنط غير موجود' });
      return res.status(400).json({ code: 'HAS_STOCK', message: `لا يُحذف «${cur.name}» وفي رصيده ${cur.quantity} — أخرج الرصيد أولًا (صادر أو تحويل)` });
    }
    await Ls2RimMovement.create({ rim: rim._id, rimName: rim.name, type: 'edit', reason: 'hidden', quantity: 0, balanceAfter: 0, date: todayKey(), notes: str(req.body?.reason, 300), ...actor(req) });
    logAudit({ user: req.user, action: 'rim_hide', entity: 'Ls2Rim', entityId: rim._id, changes: { before: { name: rim.name } }, ipAddress: req.ip }).catch(() => {});
    touch();
    res.json({ message: 'hidden' });
  } catch (e) { console.error('ls2 rims hide', e); res.status(500).json({ message: 'تعذّر حذف الجنط' }); }
};

/** Atomically takes `qty` off a rim; null when the balance is short or the rim is gone. */
const takeStock = (id, qty) => Ls2Rim.findOneAndUpdate({ _id: id, isActive: { $ne: false }, quantity: { $gte: qty } }, { $inc: { quantity: -qty } }, { new: true });
const giveStock = (id, qty, extra = {}) => Ls2Rim.findOneAndUpdate({ _id: id, isActive: { $ne: false } }, { $inc: { quantity: qty }, ...(Object.keys(extra).length ? { $set: extra } : {}) }, { new: true });

async function shortMessage(id, qty) {
  const cur = await Ls2Rim.findById(id).select('quantity name isActive').lean();
  if (!cur || cur.isActive === false) return { status: 404, message: 'الجنط غير موجود' };
  return { status: 400, code: 'INSUFFICIENT', message: `الكمية المطلوبة (${qty}) أكبر من رصيد «${cur.name}» (${cur.quantity})` };
}

// POST /assets/rims/:id/movement { type: in|out, quantity, reason, vehiclePlate?, unitPrice?, supplierName?, date?, notes? }
exports.addMovement = async (req, res) => {
  try {
    const b = req.body || {};
    const type = b.type === 'in' ? 'in' : b.type === 'out' ? 'out' : null;
    if (!type) return res.status(400).json({ message: 'نوع الحركة غير صحيح' });
    const qty = Number(b.quantity);
    if (!Number.isInteger(qty) || qty < 1) return res.status(400).json({ message: 'العدد يجب أن يكون رقمًا صحيحًا لا يقل عن 1' });
    const reason = String(b.reason || '');
    if (!(type === 'in' ? IN_REASONS : OUT_REASONS).includes(reason)) {
      return res.status(400).json({ code: 'REASON_REQUIRED', message: type === 'in' ? 'اختر سبب الوارد' : 'اختر سبب الصادر' });
    }
    const notes = str(b.notes, 500);
    if (reason === 'other' && notes.length < 3) return res.status(400).json({ message: 'اكتب السبب في الملاحظات' });
    const link = await plateLink(b.vehiclePlate);
    if (NEEDS_PLATE.has(reason) && !link.vehiclePlate) return res.status(400).json({ code: 'PLATE_REQUIRED', message: 'اكتب لوحة المركبة' });
    let unitPrice = null;
    if (type === 'in' && b.unitPrice !== undefined && b.unitPrice !== null && b.unitPrice !== '') {
      unitPrice = r2(b.unitPrice);
      if (unitPrice < 0) return res.status(400).json({ message: 'السعر غير صحيح' });
    }

    const rim = type === 'out'
      ? await takeStock(req.params.id, qty)
      : await giveStock(req.params.id, qty, unitPrice > 0 ? { unitPrice } : {});
    if (!rim) { const m = await shortMessage(req.params.id, qty); return res.status(m.status).json(m); }

    const mv = await Ls2RimMovement.create({
      rim: rim._id, rimName: rim.name, type, reason, quantity: qty, balanceAfter: rim.quantity,
      unitPrice: type === 'in' ? (unitPrice ?? (rim.unitPrice || null)) : (rim.unitPrice || null),
      supplierName: type === 'in' ? str(b.supplierName, 120) : '',
      ...link, date: dayOf(b.date) || todayKey(), notes, ...actor(req),
    });
    touch();
    res.status(201).json({ rim: decorate(rim.toObject()), movement: mv });
  } catch (e) { console.error('ls2 rims movement', e); res.status(500).json({ message: 'تعذّر تسجيل الحركة' }); }
};

// POST /assets/rims/:id/transfer { toRimId, quantity, date?, notes? } - e.g. used rims declared scrap.
exports.transfer = async (req, res) => {
  try {
    const b = req.body || {};
    const qty = Number(b.quantity);
    if (!Number.isInteger(qty) || qty < 1) return res.status(400).json({ message: 'العدد يجب أن يكون رقمًا صحيحًا لا يقل عن 1' });
    if (!isId(b.toRimId)) return res.status(400).json({ message: 'اختر الصنف المحوَّل إليه' });
    if (String(b.toRimId) === String(req.params.id)) return res.status(400).json({ message: 'لا يُحوَّل الصنف إلى نفسه' });
    const target = await Ls2Rim.findOne({ _id: b.toRimId, isActive: { $ne: false } }).select('name').lean();
    if (!target) return res.status(404).json({ message: 'الصنف المحوَّل إليه غير موجود' });

    const src = await takeStock(req.params.id, qty);
    if (!src) { const m = await shortMessage(req.params.id, qty); return res.status(m.status).json(m); }
    const dst = await giveStock(target._id, qty);
    if (!dst) {
      // Target hidden between the check and the move: put the stock back.
      await Ls2Rim.updateOne({ _id: src._id }, { $inc: { quantity: qty } });
      return res.status(409).json({ message: 'الصنف المحوَّل إليه لم يعد متاحًا — لم يُحوَّل شيء' });
    }
    const group = new mongoose.Types.ObjectId();
    const base = { reason: 'transfer', quantity: qty, transferGroup: group, date: dayOf(b.date) || todayKey(), notes: str(b.notes, 500), at: new Date(), ...actor(req) };
    const [outMv, inMv] = await Ls2RimMovement.insertMany([
      { ...base, rim: src._id, rimName: src.name, type: 'out', balanceAfter: src.quantity, unitPrice: src.unitPrice || null, counterpartRim: dst._id, counterpartName: dst.name },
      { ...base, rim: dst._id, rimName: dst.name, type: 'in', balanceAfter: dst.quantity, unitPrice: src.unitPrice || null, counterpartRim: src._id, counterpartName: src.name },
    ]);
    logAudit({ user: req.user, action: 'rim_transfer', entity: 'Ls2Rim', entityId: src._id, changes: { after: { from: src.name, to: dst.name, quantity: qty } }, ipAddress: req.ip }).catch(() => {});
    touch();
    res.status(201).json({ from: decorate(src.toObject()), to: decorate(dst.toObject()), movements: [outMv, inMv] });
  } catch (e) { console.error('ls2 rims transfer', e); res.status(500).json({ message: 'تعذّر التحويل' }); }
};

/** Why a movement cannot be reversed, or null. */
function reversible(m) {
  if (m.type === 'edit') return 'تعديل البيانات ليس حركة رصيد';
  if (m.legacy) return 'حركة سابقة من المخزن للاطلاع فقط';
  if (m.reason === 'from_store') return 'رصيد منقول من المخزن — صحّحه بتسوية جرد';
  if (m.reversed) return 'تم التراجع عن هذه الحركة من قبل';
  if (m.reversalOf) return 'هذه حركة تراجع — لا يمكن التراجع عنها؛ سجّل حركة جديدة بدلاً من ذلك';
  return null;
}

// POST /assets/rims/movements/:movementId/reverse { reason } - a transfer is reversed as a whole (both legs).
exports.reverseMovement = async (req, res) => {
  try {
    const mv = await Ls2RimMovement.findById(req.params.movementId).lean();
    if (!mv) return res.status(404).json({ message: 'الحركة غير موجودة' });
    const blocked = reversible(mv);
    if (blocked) return res.status(400).json({ message: blocked });
    const why = str(req.body?.reason, 300);
    if (why.length < 3) return res.status(400).json({ message: 'اكتب سبب التراجع — يُسجَّل في السجل باسمك' });

    const legs = mv.transferGroup
      ? await Ls2RimMovement.find({ transferGroup: mv.transferGroup }).lean()
      : [mv];
    if (legs.some((l) => reversible(l))) return res.status(400).json({ message: reversible(legs.find((l) => reversible(l))) });

    const who = actor(req);
    const stamp = { reversed: true, reversedAt: new Date(), reversedByName: who.performedByName, reversalReason: why };
    // Claim the legs first so a double click on two workers reverses once.
    const claimed = await Ls2RimMovement.updateMany({ _id: { $in: legs.map((l) => l._id) }, reversed: { $ne: true } }, { $set: stamp });
    if (claimed.modifiedCount !== legs.length) {
      if (claimed.modifiedCount) await Ls2RimMovement.updateMany({ _id: { $in: legs.map((l) => l._id) }, reversedAt: stamp.reversedAt }, { $set: { reversed: false, reversedAt: null, reversedByName: '', reversalReason: '' } });
      return res.status(409).json({ message: 'تم التراجع عن هذه الحركة من قبل' });
    }
    const release = () => Ls2RimMovement.updateMany({ _id: { $in: legs.map((l) => l._id) } }, { $set: { reversed: false, reversedAt: null, reversedByName: '', reversalReason: '' } });

    // Take back what came in first: it is the step that can fail on a short balance.
    const ordered = [...legs].sort((a, b) => (a.type === 'in' ? 0 : 1) - (b.type === 'in' ? 0 : 1));
    const done = [];
    for (const l of ordered) {
      // eslint-disable-next-line no-await-in-loop
      const r = l.type === 'in' ? await takeStock(l.rim, l.quantity) : await giveStock(l.rim, l.quantity);
      if (!r) {
        // Undo the legs already applied, then refuse with the real balance.
        // eslint-disable-next-line no-await-in-loop
        for (const d of done) await Ls2Rim.updateOne({ _id: d.leg.rim }, { $inc: { quantity: d.leg.type === 'in' ? d.leg.quantity : -d.leg.quantity } });
        // eslint-disable-next-line no-await-in-loop
        await release();
        // eslint-disable-next-line no-await-in-loop
        const cur = await Ls2Rim.findById(l.rim).select('quantity name').lean();
        return res.status(400).json({
          code: 'INSUFFICIENT',
          message: `لا يمكن التراجع: يلزم سحب ${l.quantity} من «${cur?.name || l.rimName}» ورصيده الآن ${cur?.quantity ?? 0} فقط. سجّل وارد أولاً ثم أعد المحاولة.`,
        });
      }
      done.push({ leg: l, rim: r });
    }
    const reversals = await Ls2RimMovement.insertMany(done.map(({ leg, rim }) => ({
      rim: rim._id, rimName: rim.name, type: leg.type === 'in' ? 'out' : 'in', reason: 'reversal', quantity: leg.quantity,
      balanceAfter: rim.quantity, unitPrice: leg.unitPrice, vehiclePlate: leg.vehiclePlate, plateKey: leg.plateKey, vehicleMaster: leg.vehicleMaster,
      transferGroup: null, counterpartRim: leg.counterpartRim, counterpartName: leg.counterpartName,
      notes: `تراجع عن ${leg.type === 'in' ? 'وارد' : 'صادر'} ${leg.quantity} (${REASON_LABELS[leg.reason]?.ar || leg.reason}) — ${why}`,
      reversalOf: leg._id, date: todayKey(), at: new Date(), ...who,
    })));
    logAudit({ user: req.user, action: 'rim_reverse_movement', entity: 'Ls2RimMovement', entityId: mv._id, changes: { after: { rim: mv.rimName, type: mv.type, reason: mv.reason, quantity: mv.quantity, why } }, ipAddress: req.ip }).catch(() => {});
    touch();
    res.json({ reversals, rims: done.map((d) => decorate(d.rim.toObject())) });
  } catch (e) { console.error('ls2 rims reverse', e); res.status(500).json({ message: 'تعذّر التراجع عن الحركة' }); }
};

exports.REASON_LABELS = REASON_LABELS;
