const { Ls2StoreItem, Ls2StoreMovement } = require('../models/Ls2Store');
const cache = require('../utils/ttlCache');
const { emitToAll } = require('../websocket/socketManager');

const emit = () => { try { emitToAll('ls2:store', {}); } catch (e) {} cache.clear('ls2store:'); };

const ITEM_FIELDS = ['code', 'name', 'category', 'groupAr', 'quantity', 'unit', 'unitPrice', 'minQuantity', 'compatibleModels', 'notes'];
const pick = (body) => { const o = {}; ITEM_FIELDS.forEach((f) => { if (body[f] !== undefined) o[f] = body[f]; }); return o; };

// حالة الصنف: نافد (0) / منخفض (≤ الحد) / متوفر.
const statusOf = (it) => (it.quantity <= 0 ? 'out' : (it.minQuantity > 0 && it.quantity <= it.minQuantity ? 'low' : 'ok'));

// ── قائمة الأصناف ────────────────────────────────────────────────────────────
exports.listItems = async (req, res) => {
  try {
    const cacheKey = `ls2store:items:${JSON.stringify(req.query || {})}`;
    const hit = cache.get(cacheKey);
    if (hit !== undefined) return res.json(hit);

    const filter = { isActive: { $ne: false } };
    if (req.query.category) filter.category = req.query.category;
    if (req.query.q && req.query.q.trim()) {
      const rx = new RegExp(req.query.q.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
      filter.$or = [{ name: rx }, { code: rx }, { category: rx }, { compatibleModels: rx }];
    }
    const items = (await Ls2StoreItem.find(filter).sort({ name: 1 }).limit(3000).lean())
      .map((it) => ({ ...it, status: statusOf(it), value: Math.round((Number(it.quantity) || 0) * (Number(it.unitPrice) || 0) * 100) / 100 }));
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

// ── لوحة/إحصاءات ──────────────────────────────────────────────────────────────
exports.dashboard = async (req, res) => {
  try {
    const hit = cache.get('ls2store:dash');
    if (hit !== undefined) return res.json(hit);
    const items = await Ls2StoreItem.find({ isActive: { $ne: false } }).lean();
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
      byCategory: Object.entries(byCategory).map(([key, count]) => ({ key, count })).sort((a, b) => b.count - a.count),
    };
    cache.set('ls2store:dash', body, 15000);
    res.json(body);
  } catch (e) { res.status(500).json({ message: 'Failed to load store dashboard' }); }
};

exports.createItem = async (req, res) => {
  try {
    const it = await Ls2StoreItem.create({ ...pick(req.body), isActive: true });
    emit();
    res.status(201).json({ item: it });
  } catch (e) { res.status(500).json({ message: 'Failed to create item' }); }
};

exports.updateItem = async (req, res) => {
  try {
    const it = await Ls2StoreItem.findByIdAndUpdate(req.params.id, { $set: pick(req.body) }, { new: true });
    if (!it) return res.status(404).json({ message: 'Not found' });
    emit();
    res.json({ item: it });
  } catch (e) { res.status(500).json({ message: 'Failed to update item' }); }
};

exports.deleteItem = async (req, res) => {
  try { await Ls2StoreItem.findByIdAndUpdate(req.params.id, { isActive: false }); emit(); res.json({ message: 'deleted' }); }
  catch (e) { res.status(500).json({ message: 'Failed to delete item' }); }
};

// ── حركة (وارد/صادر) ──────────────────────────────────────────────────────────
exports.addMovement = async (req, res) => {
  try {
    const item = await Ls2StoreItem.findById(req.params.id);
    if (!item) return res.status(404).json({ message: 'Not found' });
    const type = req.body.type === 'in' ? 'in' : req.body.type === 'out' ? 'out' : null;
    const qty = Math.abs(Number(req.body.quantity) || 0);
    if (!type) return res.status(400).json({ message: 'نوع الحركة غير صحيح' });
    if (qty <= 0) return res.status(400).json({ message: 'أدخل كمية صحيحة' });
    if (type === 'out' && qty > item.quantity) {
      return res.status(400).json({ message: `الكمية المطلوبة (${qty}) أكبر من الرصيد المتاح (${item.quantity})` });
    }
    item.quantity += type === 'in' ? qty : -qty;
    await item.save();
    const mv = await Ls2StoreMovement.create({
      item: item._id, itemName: item.name, type, quantity: qty,
      vehiclePlate: (req.body.vehiclePlate || '').trim(), reason: (req.body.reason || '').trim(),
      balanceAfter: item.quantity, performedBy: req.user?._id, performedByName: req.user ? `${req.user.firstName || ''} ${req.user.lastName || ''}`.trim() : '',
    });
    emit();
    res.status(201).json({ item, movement: mv });
  } catch (e) { console.error('ls2 store movement', e); res.status(500).json({ message: 'Failed to record movement' }); }
};

// ── سجل الحركات ───────────────────────────────────────────────────────────────
exports.listMovements = async (req, res) => {
  try {
    const filter = {};
    if (req.query.item) filter.item = req.query.item;
    if (req.query.type) filter.type = req.query.type;
    const limit = Math.min(Number(req.query.limit) || 200, 1000);
    const movements = await Ls2StoreMovement.find(filter).sort({ createdAt: -1 }).limit(limit).lean();
    res.json({ movements });
  } catch (e) { res.status(500).json({ message: 'Failed to load movements' }); }
};
