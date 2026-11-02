const { Ls2StoreItem, Ls2StoreMovement, Ls2Supplier } = require('../models/Ls2Store');
const { todayKey } = require('../utils/companyDay');
const cache = require('../utils/ttlCache');
const { emitToAll } = require('../websocket/socketManager');
const logAudit = require('../utils/auditLogger');
const { resolveLs2Plate, resolveLs2Plates } = require('../services/ls2VehicleLink');

// Clear the cache before announcing, section-wide: a store movement shows on the section dashboard and vehicle file too.
const { ISSUE_REASON_KEYS, ISSUE_REASONS } = require('../utils/storeIssueReasons');
// An issue is never recorded without its reason; it is read in the vehicle file (utils/storeIssueReasons).
const issueReasonOf = (body) => String(body?.issueReason || '').trim();
const ISSUE_REASON_ERROR = { code: 'ISSUE_REASON_REQUIRED', message: 'اختر سبب الصرف: صيانة دورية، حادث، صيانة وقائية، عطل على الطريق، أو صيانة عامة' };
exports.issueReasons = (req, res) => res.json({ reasons: ISSUE_REASONS });
const emit = () => { require('../utils/ls2Touch').touchLs2({ store: true }); };

/**
 * Request warehouse: heavy by default, light when explicitly requested.
 * Both screens call the same endpoints with `?warehouse=light`, so the store mechanism is shared while balances are separate. The heavy default keeps old links working.
 */
const whOf = (req) => (String(req.query.warehouse || req.body?.warehouse || '').trim() === 'light' ? 'light' : 'heavy');
/** Old rows were written before the field existed, so absence means heavy. */
const whFilter = (wh) => (wh === 'light' ? { warehouse: 'light' } : { warehouse: { $ne: 'light' } });

// Localized part categories.
const CATEGORY_AR = {
  air_system: 'نظام الهواء', lighting: 'الإضاءة', brakes: 'الفرامل', body_cabin: 'الهيكل والكابينة',
  uncategorised: 'غير مصنّف', fasteners: 'مسامير وتثبيت', engine: 'المحرك', suspension: 'التعليق (السوست)',
  electrical: 'الكهرباء', filters: 'الفلاتر', trailer: 'التريلة', fluids_oils: 'الزيوت والسوائل',
  hvac: 'التكييف', bearings: 'الرمان بلي',
};
const catAr = (c) => CATEGORY_AR[c] || c || 'غير مصنّف';

const ITEM_FIELDS = ['code', 'name', 'supplierItemName', 'category', 'groupAr', 'quantity', 'unit', 'unitPrice', 'minQuantity', 'compatibleModels', 'notes'];
// The light-transport store keeps no prices (owner's rule); only the heavy store requires one.
const needsPrice = (req) => whOf(req) !== 'light';
const pick = (body) => { const o = {}; ITEM_FIELDS.forEach((f) => { if (body[f] !== undefined) o[f] = body[f]; }); return o; };
/** Editing never writes the balance; the balance changes only through a movement. */
const pickEdit = (body) => { const o = pick(body); delete o.quantity; return o; };

const YMD = /^\d{4}-\d{2}-\d{2}$/;
const dayOf = (v) => (YMD.test(String(v || '').trim()) ? String(v).trim() : '');
const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
const foldName = (s) => String(s || '').trim().toLowerCase()
  .replace(/[أإآ]/g, 'ا').replace(/ى/g, 'ي').replace(/ة/g, 'ه').replace(/[\u064B-\u0652\u0640]/g, '').replace(/\s+/g, ' ');

/** Supplier as sent by the screen: an id (picked from the list) or a new name typed in the same field, which is created and selected in the same request. Returns `null` when no supplier is given. */
async function resolveSupplier(req, raw, rawName) {
  const wh = whOf(req);
  const id = String(raw || '').trim();
  if (/^[0-9a-f]{24}$/i.test(id)) {
    const s = await Ls2Supplier.findOne({ _id: id, ...whFilter(wh) }).select('name').lean();
    if (s) return { supplier: s._id, supplierName: s.name };
  }
  const name = String(rawName || (/^[0-9a-f]{24}$/i.test(id) ? '' : id) || '').trim().slice(0, 120);
  if (!name) return null;
  const nameKey = foldName(name);
  let s = await Ls2Supplier.findOne({ nameKey, ...whFilter(wh) });
  if (s && s.isActive === false) { s.isActive = true; await s.save(); }
  if (!s) s = await Ls2Supplier.create({ name, nameKey, warehouse: wh, createdByName: actorName(req) });
  return { supplier: s._id, supplierName: s.name };
}
const actorName = (req) => (req.user ? `${req.user.firstName || ''} ${req.user.lastName || ''}`.trim() : '');

// Rims of the heavy fleet are counted on the tire side (models/Ls2Rim); a store line for them would count them twice.
const isHeavyRim = (req, name) => whOf(req) === 'heavy' && /^جنط/.test(foldName(name));
const RIM_IN_STORE = { code: 'RIM_BELONGS_TO_TIRES', message: 'الجنوط تُدار من «السطحات والكاوتشات ← الجنوط»، لا من المخزن' };

// Item status: out of stock (0) / low (at or below threshold) / available.
const statusOf = (it) => (it.quantity <= 0 ? 'out' : (it.minQuantity > 0 && it.quantity <= it.minQuantity ? 'low' : 'ok'));

// Item list.
exports.listItems = async (req, res) => {
  try {
    const cacheKey = `ls2store:items:${JSON.stringify(req.query || {})}`;
    const hit = cache.get(cacheKey);
    if (hit !== undefined) return res.json(hit);

    const filter = { isActive: { $ne: false }, ...whFilter(whOf(req)) };
    if (req.query.category) filter.category = req.query.category;
    if (/^[0-9a-f]{24}$/i.test(String(req.query.supplier || ''))) filter.supplier = req.query.supplier;
    // Purchase date: a day, month or range. Items with no purchase date (created before the field existed) are excluded from date filters so they are not attributed to a day they were not bought.
    const from = dayOf(req.query.from); const to = dayOf(req.query.to);
    if (from || to) filter.purchaseDate = { ...(from ? { $gte: from } : {}), ...(to ? { $lte: to } : { $ne: '' }) };
    if (req.query.q && req.query.q.trim()) {
      const rx = new RegExp(req.query.q.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
      filter.$or = [{ name: rx }, { supplierItemName: rx }, { code: rx }, { category: rx }, { compatibleModels: rx }, { supplierName: rx }];
    }
    const items = (await Ls2StoreItem.find(filter).sort({ name: 1 }).limit(3000).lean())
      .map((it) => ({ ...it, categoryAr: catAr(it.category), status: statusOf(it), value: Math.round((Number(it.quantity) || 0) * (Number(it.unitPrice) || 0) * 100) / 100 }));
    if (req.query.status) {
      const body = { items: items.filter((i) => i.status === req.query.status) };
      cache.set(cacheKey, body, 15000);
      return res.json(body);
    }
    const body = { items };
    cache.set(cacheKey, body, 15000);
    res.json(body);
  } catch (e) { console.error('ls2 store list', e); res.status(500).json({ message: 'Failed to load store' }); }
};

// Dashboard / statistics.
exports.dashboard = async (req, res) => {
  try {
    // The cache key includes the warehouse. It used to be constant, so the first warehouse asked filled the cache and the other read it: the light-transport dashboard showed heavy numbers or the reverse, well-formed but wrong.
    const dashKey = `ls2store:dash:${whOf(req)}`;
    const hit = cache.get(dashKey);
    if (hit !== undefined) return res.json(hit);
    const items = await Ls2StoreItem.find({ isActive: { $ne: false }, ...whFilter(whOf(req)) }).lean();
    let totalValue = 0; let totalUnits = 0; let low = 0; let out = 0;
    const byCategory = {};
    for (const it of items) {
      const q = Number(it.quantity) || 0; const p = Number(it.unitPrice) || 0;
      totalValue += q * p; totalUnits += q;
      const s = statusOf(it); if (s === 'low') low += 1; if (s === 'out') out += 1;
      const c = it.category || 'أخرى'; byCategory[c] = (byCategory[c] || 0) + 1;
    }
    const body = {
      totals: { items: items.length, totalUnits, totalValue: Math.round(totalValue), lowStock: low, outOfStock: out },
      byCategory: Object.entries(byCategory).map(([key, count]) => ({ key, ar: catAr(key), count })).sort((a, b) => b.count - a.count),
    };
    cache.set(dashKey, body, 15000);
    res.json(body);
  } catch (e) { res.status(500).json({ message: 'Failed to load store dashboard' }); }
};

exports.createItem = async (req, res) => {
  try {
    const data = pick(req.body);
    if (!String(data.name || '').trim()) return res.status(400).json({ message: 'اسم الصنف مطلوب' });
    if (isHeavyRim(req, data.name)) return res.status(400).json(RIM_IN_STORE);
    // The part is added with its price. An item with no price is worth zero in the store however much stock it has, so the store total is understated and the cost of a part issued to a vehicle is unknown.
    if (needsPrice(req) && !(Number(data.unitPrice) > 0)) return res.status(400).json({ message: 'اكتب سعر القطعة الواحدة', code: 'PRICE_REQUIRED' });
    const [it] = await createItems(req, [req.body]);
    emit();
    res.status(201).json({ item: it });
  } catch (e) { console.error('ls2 store create', e); res.status(500).json({ message: 'Failed to create item' }); }
};

/**
 * Creates items together with their first incoming movement.
 * Items used to be created with a balance and no movement, so the log could not say where the stock came from, at what price or when. The initial quantity is an incoming movement like any other (supplier, price, purchase date), shown in the movement log and reversible like the rest.
 */
async function createItems(req, rows) {
  const wh = whOf(req);
  const who = { performedBy: req.user?._id, performedByName: actorName(req) };
  const out = [];
  for (const b of rows) {
    const data = pick(b);
    const qty = Math.max(0, Number(data.quantity) || 0);
    // eslint-disable-next-line no-await-in-loop
    const sup = await resolveSupplier(req, b.supplier, b.supplierName);
    const purchaseDate = dayOf(b.purchaseDate) || todayKey();
    // eslint-disable-next-line no-await-in-loop
    const it = await Ls2StoreItem.create({
      ...data, name: String(data.name).trim(), quantity: qty, unitPrice: r2(data.unitPrice),
      ...(sup || {}), purchaseDate, warehouse: wh, isActive: true,
    });
    if (qty > 0) {
      // eslint-disable-next-line no-await-in-loop
      await Ls2StoreMovement.create({
        item: it._id, itemName: it.name, warehouse: wh, type: 'in', quantity: qty, unitPrice: it.unitPrice,
        ...(sup || {}), date: purchaseDate, reason: 'إضافة صنف جديد', balanceAfter: qty, ...who,
      });
    }
    out.push(it);
  }
  return out;
}

/**
 * POST /store/bulk-create { items: [...], supplier?, supplierName?, purchaseDate? }
 * One purchase invoice with ten items is entered in one table with its supplier and date, instead of ten forms repeating them. Shared values are written once above the table, and a value on a line takes precedence.
 * All or nothing: one incomplete line rejects the whole batch, listing line numbers, because a half-entered batch leaves the author not knowing which half went in.
 */
exports.createItemsBulk = async (req, res) => {
  try {
    const rows = Array.isArray(req.body?.items) ? req.body.items : [];
    if (!rows.length) return res.status(400).json({ message: 'أضف صنفًا واحدًا على الأقل' });
    if (rows.length > 200) return res.status(400).json({ message: 'الحدّ الأقصى ٢٠٠ صنف في المرّة الواحدة' });
    const errors = [];
    const seen = new Set();
    rows.forEach((b, i) => {
      const line = i + 1; const name = String(b?.name || '').trim();
      if (!name) errors.push({ line, message: 'اسم الصنف مطلوب' });
      else if (seen.has(foldName(name))) errors.push({ line, message: `«${name}» مكرَّر في الجدول` });
      else if (isHeavyRim(req, name)) errors.push({ line, message: RIM_IN_STORE.message });
      seen.add(foldName(name));
      if (needsPrice(req) && !(Number(b?.unitPrice) > 0)) errors.push({ line, message: 'اكتب سعر القطعة الواحدة' });
      if (!(Number(b?.quantity) >= 0)) errors.push({ line, message: 'العدد غير صحيح' });
    });
    if (errors.length) return res.status(400).json({ message: 'رُفضت الدفعة — لم يُضَف أيّ صنف', errors });
    const shared = { supplier: req.body.supplier, supplierName: req.body.supplierName, purchaseDate: req.body.purchaseDate };
    const items = await createItems(req, rows.map((b) => ({
      ...b,
      supplier: b.supplier || (b.supplierName ? '' : shared.supplier),
      supplierName: b.supplierName || (b.supplier ? '' : shared.supplierName),
      purchaseDate: b.purchaseDate || shared.purchaseDate,
    })));
    logAudit({ user: req.user, action: 'store_items_bulk_create', entity: 'Ls2StoreItem', entityId: items[0]._id, changes: { after: { count: items.length, names: items.map((i) => i.name).slice(0, 30) } }, ipAddress: req.ip }).catch(() => {});
    emit();
    res.status(201).json({ items, summary: { count: items.length, value: r2(items.reduce((a, i) => a + i.quantity * i.unitPrice, 0)) } });
  } catch (e) { console.error('ls2 store bulk create', e); res.status(500).json({ message: 'تعذّر إضافة الأصناف' }); }
};

exports.updateItem = async (req, res) => {
  try {
    const set = pickEdit(req.body);
    if (set.name !== undefined && isHeavyRim(req, set.name)) return res.status(400).json(RIM_IN_STORE);
    if (req.body.supplier !== undefined || req.body.supplierName !== undefined) {
      const sup = await resolveSupplier(req, req.body.supplier, req.body.supplierName);
      Object.assign(set, sup || { supplier: null, supplierName: '' });
    }
    if (req.body.purchaseDate !== undefined) set.purchaseDate = dayOf(req.body.purchaseDate);
    const it = await Ls2StoreItem.findByIdAndUpdate(req.params.id, { $set: set }, { new: true });
    if (!it) return res.status(404).json({ message: 'Not found' });
    emit();
    res.json({ item: it });
  } catch (e) { res.status(500).json({ message: 'Failed to update item' }); }
};

exports.deleteItem = async (req, res) => {
  try { await Ls2StoreItem.findByIdAndUpdate(req.params.id, { isActive: false }); emit(); res.json({ message: 'deleted' }); }
  catch (e) { res.status(500).json({ message: 'Failed to delete item' }); }
};

// Movement (incoming / outgoing).
exports.addMovement = async (req, res) => {
  try {
    const item = await Ls2StoreItem.findById(req.params.id);
    if (!item) return res.status(404).json({ message: 'Not found' });
    const type = req.body.type === 'in' ? 'in' : req.body.type === 'out' ? 'out' : null;
    const qty = Math.abs(Number(req.body.quantity) || 0);
    if (!type) return res.status(400).json({ message: 'نوع الحركة غير صحيح' });
    if (qty <= 0) return res.status(400).json({ message: 'أدخل كمية صحيحة' });
    const issueReason = type === 'out' ? issueReasonOf(req.body) : '';
    if (type === 'out' && !ISSUE_REASON_KEYS.includes(issueReason)) return res.status(400).json(ISSUE_REASON_ERROR);
    if (type === 'out' && qty > item.quantity) {
      return res.status(400).json({ message: `الكمية المطلوبة (${qty}) أكبر من الرصيد المتاح (${item.quantity})` });
    }
    // An incoming movement enters at its piece price: the value typed now, or the item's registered price if unchanged.
    let price = null;
    if (type === 'in') {
      price = req.body.unitPrice !== undefined && req.body.unitPrice !== '' && req.body.unitPrice !== null
        ? Number(req.body.unitPrice) : Number(item.unitPrice);
      if (item.warehouse === 'light') price = null;
      else if (!(price > 0)) return res.status(400).json({ message: `اكتب سعر القطعة الواحدة من «${item.name}»`, code: 'PRICE_REQUIRED' });
      else item.unitPrice = price;
    }
    // Incoming from a supplier: recorded on the movement and becomes the item's last supply.
    const sup = type === 'in' ? await resolveSupplier(req, req.body.supplier, req.body.supplierName) : null;
    const date = dayOf(req.body.date) || todayKey();
    if (type === 'in') { if (sup) Object.assign(item, sup); item.purchaseDate = date; }
    item.quantity += type === 'in' ? qty : -qty;
    // The plate is typed as workshop staff know it and resolved to its register vehicle when known.
    const vehiclePlate = (req.body.vehiclePlate || '').trim();
    const vehicleMaster = await resolveLs2Plate(vehiclePlate, { heavy: (item.warehouse || 'heavy') === 'heavy' }).catch(() => null);
    await item.save();
    const mv = await Ls2StoreMovement.create({
      unitPrice: price, ...(sup || {}), date,
      item: item._id, itemName: item.name, warehouse: item.warehouse || 'heavy', type, quantity: qty,
      vehiclePlate, vehicleMaster, reason: (req.body.reason || '').trim(), issueReason,
      balanceAfter: item.quantity, performedBy: req.user?._id, performedByName: req.user ? `${req.user.firstName || ''} ${req.user.lastName || ''}`.trim() : '',
    });
    emit();
    res.status(201).json({ item, movement: mv });
  } catch (e) { console.error('ls2 store movement', e); res.status(500).json({ message: 'Failed to record movement' }); }
};

// Issue for several items in one request: the same inputs as a single issue, applied to the group.
// One piece of each item: an item with stock decrements by 1. Different quantities use the single issue; both produce identical log entries, so an auditor cannot tell them apart.
// All or nothing: if any item has zero balance the whole operation is rejected with the list of short items. A half-applied issue leaves the store wrong and the user not knowing which items went out, so they would retry and issue twice.
const actor = (req) => ({
  performedBy: req.user?._id,
  performedByName: req.user ? `${req.user.firstName || ''} ${req.user.lastName || ''}`.trim() : '',
});

// Bulk movement: issue or receipt for several items.
// Quantity is per item and defaults to 1. The same path serves receipts too (five pieces of one item and two of another in one supply).
// All or nothing: if any item's balance is insufficient, nothing is decremented and the response lists the short items. A half-applied issue leaves the store wrong and the user not knowing which items went out, so they would retry and issue double.
exports.addBulkMovement = async (req, res) => {
  try {
    const type = req.body?.type === 'in' ? 'in' : req.body?.type === 'out' ? 'out' : null;
    if (!type) return res.status(400).json({ message: 'نوع الحركة غير صحيح' });

    // Accepts two shapes with deliberately different meaning:
    // lines: explicit lines typed by the user; duplicates have their quantities summed.
    // items: a pick list; duplicates are a selection artifact, not intent, so they count once.
    const asLines = Array.isArray(req.body?.lines);
    const raw = asLines ? req.body.lines
      : (Array.isArray(req.body?.items) ? [...new Set(req.body.items.map(String))].map((id) => ({ item: id })) : []);
    if (!raw.length) return res.status(400).json({ message: 'اختر صنفًا واحدًا على الأقل' });
    if (raw.length > 300) return res.status(400).json({ message: 'الحد الأقصى ٣٠٠ صنف في المرة الواحدة' });

    const fallback = Math.max(1, Number(req.body?.quantityEach) || 1);
    const vehiclePlate = (req.body?.vehiclePlate || '').trim();
    const reason = (req.body?.reason || '').trim();
    const issueReason = type === 'out' ? issueReasonOf(req.body) : '';
    if (type === 'out' && !ISSUE_REASON_KEYS.includes(issueReason)) return res.status(400).json(ISSUE_REASON_ERROR);
    const sup = type === 'in' ? await resolveSupplier(req, req.body?.supplier, req.body?.supplierName) : null;
    const date = dayOf(req.body?.date) || todayKey();

    // A duplicated item in the selection has quantities summed, so lines are not each checked against the balance alone.
    const wanted = new Map();
    const errors = [];
    const prices = new Map();
    raw.forEach((l, i) => {
      const id = String(l.item || l.id || l);
      const q = l.quantity === undefined || l.quantity === null || l.quantity === ''
        ? fallback : Number(l.quantity);
      if (!id) { errors.push({ line: i + 1, message: 'الصنف غير محدَّد' }); return; }
      if (!Number.isInteger(q) || q < 1) {
        errors.push({ id, line: i + 1, message: `الكمية «${l.quantity}» غير صالحة — يلزم رقم صحيح لا يقل عن ١` });
        return;
      }
      wanted.set(id, asLines ? (wanted.get(id) || 0) + q : q);
      if (l && typeof l === 'object' && l.unitPrice !== undefined && l.unitPrice !== '' && l.unitPrice !== null) prices.set(id, Number(l.unitPrice));
    });

    const items = await Ls2StoreItem.find({ _id: { $in: [...wanted.keys()] } });
    const found = new Map(items.map((i) => [String(i._id), i]));
    for (const [id, total] of wanted) {
      const it = found.get(id);
      if (!it) { errors.push({ id, message: 'الصنف غير موجود' }); continue; }
      // A receipt is not limited by balance; only issues decrease it.
      if (type === 'out' && (Number(it.quantity) || 0) < total) {
        errors.push({ id, name: it.name, message: `${it.name}: الرصيد ${it.quantity} والمطلوب ${total}` });
      }
      // A receipt takes its piece price: the line's value or the item's registered price.
      if (type === 'in') {
        const p = prices.has(id) ? prices.get(id) : Number(it.unitPrice);
        if (it.warehouse === 'light') prices.set(id, null);
        else if (!(p > 0)) errors.push({ id, name: it.name, message: `${it.name}: اكتب سعر القطعة الواحدة` });
        else prices.set(id, p);
      }
    }
    if (errors.length) {
      return res.status(400).json({
        message: type === 'out' ? 'رُفضت العملية — لم يُصرَف أي صنف' : 'رُفضت العملية — لم يُسجَّل أي وارد',
        errors,
      });
    }

    // Vehicle for the plate in the register: digits only in the heavy-transport store (our fleet is unique by digits), letters included in both stores; see services/ls2VehicleLink.
    const vmFor = {};
    for (const wh of new Set(items.map((it) => it.warehouse || 'heavy'))) {
      // eslint-disable-next-line no-await-in-loop
      vmFor[wh] = await resolveLs2Plate(vehiclePlate, { heavy: wh === 'heavy' }).catch(() => null);
    }
    const movements = [];
    for (const [id, qty] of wanted) {
      const it = found.get(id);
      it.quantity += type === 'in' ? qty : -qty;
      if (type === 'in') { if (it.warehouse !== 'light') it.unitPrice = prices.get(id); if (sup) Object.assign(it, sup); it.purchaseDate = date; }
      await it.save();
      movements.push({
        unitPrice: type === 'in' ? prices.get(id) : null, ...(sup || {}), date,
        item: it._id, itemName: it.name, warehouse: it.warehouse || 'heavy', type, quantity: qty,
        vehiclePlate, vehicleMaster: vmFor[it.warehouse || 'heavy'] || null, reason, issueReason, balanceAfter: it.quantity, ...actor(req),
      });
    }
    const created = await Ls2StoreMovement.insertMany(movements);

    emit();
    res.status(201).json({
      movements: created,
      items: [...found.values()],
      summary: {
        type,
        items: wanted.size,
        totalQty: [...wanted.values()].reduce((a, b) => a + b, 0),
        vehiclePlate,
      },
    });
  } catch (e) {
    console.error('ls2 store bulk movement', e);
    res.status(500).json({ message: 'تعذّر تسجيل الحركة' });
  }
};

// Legacy name, still accepted and meaning issue.
exports.addBulkOut = (req, res) => exports.addBulkMovement({ ...req, body: { ...req.body, type: 'out' } }, res);

// Reversing a movement.
// Finance rule: a recorded movement is never edited. No endpoint changes the quantity or type of an existing movement; if staff could rewrite their work, the log would be their opinion of what happened instead of what happened.
// Mistakes are corrected by reversal: an opposite movement of the same quantity, linked to the original (reversalOf), with a mandatory reason and the actor's name. The original stays in the log struck through, so an auditor sees the error and the fix. If the right quantity differs, a normal new movement follows under its author's name.

/** Effect of a movement on balance: a receipt adds, an issue subtracts. */
const effectOf = (type, qty) => (type === 'in' ? +qty : -qty);

/** Whether this movement can be reversed. */
const guard = (mv) => {
  if (mv.reversed) return 'تم التراجع عن هذه الحركة من قبل';
  if (mv.reversalOf) return 'هذه حركة تراجع — لا يمكن التراجع عنها؛ سجّل حركة جديدة بدلاً من ذلك';
  return null;
};

exports.reverseMovement = async (req, res) => {
  try {
    const mv = await Ls2StoreMovement.findById(req.params.movementId);
    if (!mv) return res.status(404).json({ message: 'الحركة غير موجودة' });
    const blocked = guard(mv);
    if (blocked) return res.status(400).json({ message: blocked });

    const item = await Ls2StoreItem.findById(mv.item);
    if (!item) return res.status(404).json({ message: 'الصنف غير موجود' });

    // Reversing a receipt removes quantity from the store, so it fails if that stock was already issued.
    const after = item.quantity - effectOf(mv.type, mv.quantity);
    if (after < 0) {
      return res.status(400).json({
        message: `لا يمكن التراجع: العملية تحتاج سحب ${mv.quantity} ${item.unit} والرصيد الحالي ${item.quantity} فقط. سجّل وارد أولاً ثم أعد المحاولة.`,
      });
    }

    const who = actor(req);
    const reason = (req.body.reason || '').trim();
    // Without a written reason a reversal is a silent edit with an extra step, which is what the rule exists to prevent.
    if (reason.length < 3) {
      return res.status(400).json({ message: 'اكتب سبب التراجع — يُسجَّل في السجل باسمك' });
    }
    item.quantity = after;
    await item.save();

    const rev = await Ls2StoreMovement.create({
      item: item._id, itemName: item.name, warehouse: item.warehouse || 'heavy',
      type: mv.type === 'in' ? 'out' : 'in', quantity: mv.quantity,
      vehiclePlate: mv.vehiclePlate, vehicleMaster: mv.vehicleMaster || null,
      reason: `تراجع عن ${mv.type === 'in' ? 'وارد' : 'صادر'} ${mv.quantity} — ${reason}`,
      balanceAfter: after, reversalOf: mv._id, date: todayKey(), ...who,
    });

    mv.reversed = true;
    mv.reversedAt = new Date();
    mv.reversedBy = who.performedBy;
    mv.reversedByName = who.performedByName;
    mv.reversalReason = reason;
    await mv.save();

    logAudit({
      user: req.user, action: 'reverse_store_movement', entity: 'Ls2StoreMovement', entityId: mv._id,
      changes: { after: { item: item.name, type: mv.type, quantity: mv.quantity, reason } }, ipAddress: req.ip,
    }).catch(() => {});

    emit();
    res.json({ item, movement: mv, reversal: rev });
  } catch (e) { console.error('ls2 store reverse', e); res.status(500).json({ message: 'تعذّر التراجع عن الحركة' }); }
};

// Movement log.
exports.listMovements = async (req, res) => {
  try {
    const filter = { ...whFilter(whOf(req)) };
    if (req.query.item) filter.item = req.query.item;
    if (req.query.type) filter.type = req.query.type;
    if (ISSUE_REASON_KEYS.includes(String(req.query.issueReason || ''))) filter.issueReason = req.query.issueReason;
    if (/^[0-9a-f]{24}$/i.test(String(req.query.supplier || ''))) filter.supplier = req.query.supplier;
    // The day is the movement's `date`; movements recorded before the field existed use their recording time.
    const from = dayOf(req.query.from); const to = dayOf(req.query.to);
    if (from || to) {
      const span = { ...(from ? { $gte: from } : {}), ...(to ? { $lte: to } : {}) };
      const at = { ...(from ? { $gte: new Date(`${from}T00:00:00+03:00`) } : {}), ...(to ? { $lte: new Date(`${to}T23:59:59.999+03:00`) } : {}) };
      filter.$and = [{ $or: [{ date: span }, { date: { $in: ['', null] }, createdAt: at }] }];
    }
    if (req.query.q && String(req.query.q).trim()) {
      const rx = new RegExp(String(req.query.q).trim().slice(0, 60).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
      (filter.$and = filter.$and || []).push({ $or: [{ itemName: rx }, { vehiclePlate: rx }, { reason: rx }, { supplierName: rx }, { performedByName: rx }] });
    }
    const limit = Math.min(Number(req.query.limit) || 200, 3000);
    const rows = await Ls2StoreMovement.find(filter).sort({ createdAt: -1 }).limit(limit).lean();
    // Unit comes from the item; value is quantity times price, for receipts that have a price.
    const units = new Map((await Ls2StoreItem.find({ _id: { $in: [...new Set(rows.map((m) => String(m.item)))] } }).select('unit code').lean()).map((i) => [String(i._id), i]));
    // Vehicle plate as in the vehicle register, read now so edits there show here.
    const vmIds = [...new Set(rows.map((m) => m.vehicleMaster && String(m.vehicleMaster)).filter(Boolean))];
    const { VehicleMaster } = require('../models/VehicleMaster');
    const regPlate = new Map(vmIds.length ? (await VehicleMaster.find({ _id: { $in: vmIds } }).select('plateNumber').lean()).map((v) => [String(v._id), v.plateNumber]) : []);
    const movements = rows.map((m) => ({
      ...m,
      vehicleRegistryPlate: m.vehicleMaster ? regPlate.get(String(m.vehicleMaster)) || '' : '',
      date: m.date || new Date(new Date(m.createdAt).getTime() + 3 * 3600 * 1000).toISOString().slice(0, 10),
      unit: units.get(String(m.item))?.unit || '', itemCode: units.get(String(m.item))?.code || '',
      total: m.unitPrice != null ? r2(m.quantity * m.unitPrice) : null,
    }));
    // The UI needs to know whether a movement can be reversed and what it reverses, without rebuilding this rule in two places.
    const byId = new Map(movements.map((m) => [String(m._id), m]));
    res.json({
      movements: movements.map((m) => ({
        ...m,
        canReverse: !m.reversed && !m.reversalOf,
        isReversal: !!m.reversalOf,
        // A small snapshot of the original movement when it is on the same page.
        originalRef: m.reversalOf
          ? (() => { const o = byId.get(String(m.reversalOf)); return o ? { type: o.type, quantity: o.quantity, at: o.createdAt } : null; })()
          : null,
      })),
    });
  } catch (e) { res.status(500).json({ message: 'Failed to load movements' }); }
};

// Unknown plates.
// GET /store/unknown-plates - every plate written on a movement with no vehicle in the vehicle register: how many movements and the last day. Resolved again on each request, so anything added to the register leaves the list at once; the list is what needs correction here or there.
exports.unknownPlates = async (req, res) => {
  try {
    const wh = whOf(req);
    const agg = await Ls2StoreMovement.aggregate([
      { $match: { ...whFilter(wh), vehiclePlate: { $nin: ['', null] }, vehicleMaster: null } },
      { $group: { _id: '$vehiclePlate', movements: { $sum: 1 }, last: { $max: { $ifNull: ['$date', ''] } } } },
    ]);
    const resolved = await resolveLs2Plates(agg.map((a) => a._id), { heavy: wh === 'heavy' });
    const plates = agg.filter((a) => !resolved.get(String(a._id).trim()))
      .map((a) => ({ plate: a._id, movements: a.movements, last: a.last || '' }))
      .sort((a, b) => b.movements - a.movements || String(a.plate).localeCompare(String(b.plate)));
    res.json({ plates, total: plates.length, movements: plates.reduce((s, p) => s + p.movements, 0) });
  } catch (e) { res.status(500).json({ message: 'تعذّر تحميل اللوحات غير المعروفة' }); }
};

// Suppliers.
// GET /suppliers - each with what was bought from it: how many items, how many supplies and how much.
exports.listSuppliers = async (req, res) => {
  try {
    const wh = whOf(req);
    const [rows, agg, itemAgg] = await Promise.all([
      Ls2Supplier.find({ isActive: { $ne: false }, ...whFilter(wh) }).sort({ name: 1 }).lean(),
      Ls2StoreMovement.aggregate([
        { $match: { ...whFilter(wh), type: 'in', supplier: { $ne: null }, reversed: { $ne: true }, reversalOf: null } },
        { $group: { _id: '$supplier', purchases: { $sum: 1 }, units: { $sum: '$quantity' }, total: { $sum: { $multiply: ['$quantity', { $ifNull: ['$unitPrice', 0] }] } }, last: { $max: '$date' } } },
      ]),
      Ls2StoreItem.aggregate([
        { $match: { ...whFilter(wh), isActive: { $ne: false }, supplier: { $ne: null } } },
        { $group: { _id: '$supplier', items: { $sum: 1 } } },
      ]),
    ]);
    const a = new Map(agg.map((x) => [String(x._id), x])); const b = new Map(itemAgg.map((x) => [String(x._id), x.items]));
    res.json({
      suppliers: rows.map((s) => ({
        ...s, items: b.get(String(s._id)) || 0,
        purchases: a.get(String(s._id))?.purchases || 0, units: a.get(String(s._id))?.units || 0,
        total: r2(a.get(String(s._id))?.total), lastPurchase: a.get(String(s._id))?.last || '',
      })),
    });
  } catch (e) { console.error('ls2 suppliers', e); res.status(500).json({ message: 'تعذّر تحميل الموردين' }); }
};

const SUPPLIER_FIELDS = ['name', 'phone', 'taxNumber', 'city', 'notes'];
exports.createSupplier = async (req, res) => {
  try {
    const name = String(req.body?.name || '').trim();
    if (!name) return res.status(400).json({ message: 'اسم المورد مطلوب' });
    const wh = whOf(req); const nameKey = foldName(name);
    const dup = await Ls2Supplier.findOne({ nameKey, ...whFilter(wh) });
    if (dup && dup.isActive !== false) return res.status(409).json({ message: `المورد «${dup.name}» مسجَّل من قبل`, supplier: dup });
    const data = Object.fromEntries(SUPPLIER_FIELDS.filter((f) => req.body[f] !== undefined).map((f) => [f, String(req.body[f] || '').trim()]));
    // A deleted supplier with the same name is restored instead of creating a twin, so its old purchases stay with it.
    const s = dup ? await Ls2Supplier.findByIdAndUpdate(dup._id, { $set: { ...data, isActive: true } }, { new: true })
      : await Ls2Supplier.create({ ...data, name, nameKey, warehouse: wh, createdByName: actorName(req) });
    logAudit({ user: req.user, action: 'store_supplier_create', entity: 'Ls2Supplier', entityId: s._id, changes: { after: { name: s.name } }, ipAddress: req.ip }).catch(() => {});
    emit();
    res.status(201).json({ supplier: s });
  } catch (e) { console.error('ls2 supplier create', e); res.status(500).json({ message: 'تعذّر إضافة المورد' }); }
};

exports.updateSupplier = async (req, res) => {
  try {
    const s = await Ls2Supplier.findOne({ _id: req.params.id, ...whFilter(whOf(req)) });
    if (!s) return res.status(404).json({ message: 'المورد غير موجود' });
    const before = { name: s.name, phone: s.phone };
    for (const f of SUPPLIER_FIELDS) if (req.body[f] !== undefined) s[f] = String(req.body[f] || '').trim();
    if (!s.name) return res.status(400).json({ message: 'اسم المورد مطلوب' });
    const nameKey = foldName(s.name);
    if (nameKey !== s.nameKey) {
      const dup = await Ls2Supplier.findOne({ nameKey, _id: { $ne: s._id }, isActive: { $ne: false }, ...whFilter(whOf(req)) });
      if (dup) return res.status(409).json({ message: `المورد «${dup.name}» مسجَّل من قبل` });
      s.nameKey = nameKey;
    }
    await s.save();
    // The name is a snapshot on the item and movement; it follows when corrected, otherwise the table keeps the old one.
    if (before.name !== s.name) {
      await Promise.all([
        Ls2StoreItem.updateMany({ supplier: s._id }, { $set: { supplierName: s.name } }),
        Ls2StoreMovement.updateMany({ supplier: s._id }, { $set: { supplierName: s.name } }),
      ]);
    }
    logAudit({ user: req.user, action: 'store_supplier_update', entity: 'Ls2Supplier', entityId: s._id, changes: { before, after: { name: s.name, phone: s.phone } }, ipAddress: req.ip }).catch(() => {});
    emit();
    res.json({ supplier: s });
  } catch (e) { console.error('ls2 supplier update', e); res.status(500).json({ message: 'تعذّر تعديل المورد' }); }
};

// Deletion is hiding: past purchases keep the supplier's name in the log.
exports.deleteSupplier = async (req, res) => {
  try {
    const s = await Ls2Supplier.findOneAndUpdate({ _id: req.params.id, ...whFilter(whOf(req)) }, { $set: { isActive: false } }, { new: true });
    if (!s) return res.status(404).json({ message: 'المورد غير موجود' });
    logAudit({ user: req.user, action: 'store_supplier_delete', entity: 'Ls2Supplier', entityId: s._id, changes: { before: { name: s.name } }, ipAddress: req.ip }).catch(() => {});
    emit();
    res.json({ message: 'deleted' });
  } catch (e) { res.status(500).json({ message: 'تعذّر حذف المورد' }); }
};
