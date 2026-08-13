const { Ls2StoreItem, Ls2StoreMovement } = require('../models/Ls2Store');
const cache = require('../utils/ttlCache');
const { emitToAll } = require('../websocket/socketManager');
const logAudit = require('../utils/auditLogger');

const emit = () => { try { emitToAll('ls2:store', {}); } catch (e) {} cache.clear('ls2store:'); };

// تعريب تصنيفات القطع.
const CATEGORY_AR = {
  air_system: 'نظام الهواء', lighting: 'الإضاءة', brakes: 'الفرامل', body_cabin: 'الهيكل والكابينة',
  uncategorised: 'غير مصنّف', fasteners: 'مسامير وتثبيت', engine: 'المحرك', suspension: 'التعليق (السوست)',
  electrical: 'الكهرباء', filters: 'الفلاتر', trailer: 'التريلة', fluids_oils: 'الزيوت والسوائل',
  hvac: 'التكييف', bearings: 'الرمان بلي',
};
const catAr = (c) => CATEGORY_AR[c] || c || 'غير مصنّف';

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
      byCategory: Object.entries(byCategory).map(([key, count]) => ({ key, ar: catAr(key), count })).sort((a, b) => b.count - a.count),
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

// ── صادر لأكتر من صنف مرة واحدة ───────────────────────────────────────────────
//
// الطلب: «أعمل سيليكت لأكتر من صنف، وأقول الصادر ده على أنهي عربية، ويتسجّل على
// كل اللي عملتله سيليكت». نفس الإنبوتس بتاعة الصادر المفرد بالظبط، بس بتتطبّق
// على المجموعة.
//
// **قطعة واحدة من كل صنف.** ده اللي اتطلب صراحةً: الصنف اللي فيه كمية بينزل منه
// عدد ١. اللي عايز كميات مختلفة بيستعمل الصادر المفرد — والحركتين بيدخلوا نفس
// السجل بنفس الشكل، فالمراجع مش هيفرّق بينهم.
//
// **الكل أو لا شيء.** لو صنف واحد رصيده صفر، العملية كلها بترفض بقايمة بأسماء
// الأصناف الناقصة. صادر نصّه اتنفّذ بيخلّي المخزن غلط واللي عمله مش عارف أنهي
// صنف نزل، فيعيده كله ويطلع بدل مرتين.
const actor = (req) => ({
  performedBy: req.user?._id,
  performedByName: req.user ? `${req.user.firstName || ''} ${req.user.lastName || ''}`.trim() : '',
});

// ── حركة جماعية: صادر أو وارد لعدة أصناف ─────────────────────────────────────
//
// الطلب: «أعمل سيليكت لأكتر من صنف وأقول الصادر ده على أنهي عربية»، ثم: «العدد
// جنب كل عنصر تلقائي ١، لكن فيه عناصر هيعمل لها صادر أكتر من ١ فيكتب عددها».
//
// فالكمية **لكل صنف على حدة**، وافتراضها ١. ونفس المسار يخدم الوارد أيضًا: قد
// تدخل خمس قطع من صنف وقطعتان من آخر في نفس التوريد.
//
// **الكل أو لا شيء.** إن كان رصيد صنف واحد لا يكفي، لا يَنقص أي صنف والرد يحمل
// أسماء الأصناف الناقصة. صرف نُفِّذ نصفه يترك المخزن على رقم خاطئ، ولا يعرف من
// نفّذه أي صنف نزل — فيعيده كاملًا ويصرف ضِعف الكمية.
exports.addBulkMovement = async (req, res) => {
  try {
    const type = req.body?.type === 'in' ? 'in' : req.body?.type === 'out' ? 'out' : null;
    if (!type) return res.status(400).json({ message: 'نوع الحركة غير صحيح' });

    // يقبل الشكلين، ومعناهما مختلف عن قصد:
    //   lines: أسطر صريحة كتبها المستخدم — الصنف المكرَّر فيها تُجمَع كمياته.
    //   items: قائمة اختيار — التكرار فيها أثر انتقاء لا نيّة، فيُحسَب مرة واحدة.
    const asLines = Array.isArray(req.body?.lines);
    const raw = asLines ? req.body.lines
      : (Array.isArray(req.body?.items) ? [...new Set(req.body.items.map(String))].map((id) => ({ item: id })) : []);
    if (!raw.length) return res.status(400).json({ message: 'اختر صنفًا واحدًا على الأقل' });
    if (raw.length > 300) return res.status(400).json({ message: 'الحد الأقصى ٣٠٠ صنف في المرة الواحدة' });

    const fallback = Math.max(1, Number(req.body?.quantityEach) || 1);
    const vehiclePlate = (req.body?.vehiclePlate || '').trim();
    const reason = (req.body?.reason || '').trim();

    // الصنف المكرَّر في الاختيار تُجمَع كمياته، فلا يُقاس كل سطر وحده على الرصيد.
    const wanted = new Map();
    const errors = [];
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
    });

    const items = await Ls2StoreItem.find({ _id: { $in: [...wanted.keys()] } });
    const found = new Map(items.map((i) => [String(i._id), i]));
    for (const [id, total] of wanted) {
      const it = found.get(id);
      if (!it) { errors.push({ id, message: 'الصنف غير موجود' }); continue; }
      // الوارد لا يُقيَّد برصيد؛ الصادر وحده هو الذي يَنقص.
      if (type === 'out' && (Number(it.quantity) || 0) < total) {
        errors.push({ id, name: it.name, message: `${it.name}: الرصيد ${it.quantity} والمطلوب ${total}` });
      }
    }
    if (errors.length) {
      return res.status(400).json({
        message: type === 'out' ? 'رُفضت العملية — لم يُصرَف أي صنف' : 'رُفضت العملية — لم يُسجَّل أي وارد',
        errors,
      });
    }

    const movements = [];
    for (const [id, qty] of wanted) {
      const it = found.get(id);
      it.quantity += type === 'in' ? qty : -qty;
      await it.save();
      movements.push({
        item: it._id, itemName: it.name, type, quantity: qty,
        vehiclePlate, reason, balanceAfter: it.quantity, ...actor(req),
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

// الاسم القديم — يظل عاملًا ويعني «صادر».
exports.addBulkOut = (req, res) => exports.addBulkMovement({ ...req, body: { ...req.body, type: 'out' } }, res);

// ── التراجع عن حركة ───────────────────────────────────────────────────────────
//
// قرار الإدارة المالية: الحركة اللي اتسجّلت متتعدّلش. مفيش endpoint بيغيّر كمية
// أو نوع حركة قائمة، وده مقصود — لو الموظف يقدر يرجع يظبط اللي عمله، السجل
// بيبقى رأيه في اللي حصل مش اللي حصل.
//
// الغلط بيتصحّح بالتراجع: حركة معاكسة بنفس الكمية، مربوطة بالأصلية
// (reversalOf)، بسبب إجباري وباسم اللي عملها. الأصلية بتفضل في السجل مشطوبة،
// فالمراجع بيشوف الغلطة والتصحيح مش النتيجة النهائية بس. لو الكمية الصح مختلفة،
// بيتسجّل بعدها حركة جديدة عادية — وديه كمان بتبان باسم صاحبها.

/** أثر الحركة على الرصيد: وارد يزوّد، صادر ينقّص. */
const effectOf = (type, qty) => (type === 'in' ? +qty : -qty);

/** الحركة دي ينفع يتراجع عنها؟ */
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

    // التراجع عن «وارد» بيشيل كمية من المخزن — لو اتصرفت خلاص مينفعش.
    const after = item.quantity - effectOf(mv.type, mv.quantity);
    if (after < 0) {
      return res.status(400).json({
        message: `لا يمكن التراجع: العملية تحتاج سحب ${mv.quantity} ${item.unit} والرصيد الحالي ${item.quantity} فقط. سجّل وارد أولاً ثم أعد المحاولة.`,
      });
    }

    const who = actor(req);
    const reason = (req.body.reason || '').trim();
    // بدون سبب مكتوب، التراجع بيبقى تعديل صامت بخطوة زيادة — وده بالظبط اللي
    // القاعدة موجودة عشانه.
    if (reason.length < 3) {
      return res.status(400).json({ message: 'اكتب سبب التراجع — يُسجَّل في السجل باسمك' });
    }
    item.quantity = after;
    await item.save();

    const rev = await Ls2StoreMovement.create({
      item: item._id, itemName: item.name,
      type: mv.type === 'in' ? 'out' : 'in', quantity: mv.quantity,
      vehiclePlate: mv.vehiclePlate,
      reason: `تراجع عن ${mv.type === 'in' ? 'وارد' : 'صادر'} ${mv.quantity} — ${reason}`,
      balanceAfter: after, reversalOf: mv._id, ...who,
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

// ── سجل الحركات ───────────────────────────────────────────────────────────────
exports.listMovements = async (req, res) => {
  try {
    const filter = {};
    if (req.query.item) filter.item = req.query.item;
    if (req.query.type) filter.type = req.query.type;
    const limit = Math.min(Number(req.query.limit) || 200, 1000);
    const movements = await Ls2StoreMovement.find(filter).sort({ createdAt: -1 }).limit(limit).lean();
    // الواجهة محتاجة تعرف: ده ينفع يترجع فيه؟ وده تراجع عن إيه؟ من غير ما تعيد
    // بناء القاعدة دي في مكانين.
    const byId = new Map(movements.map((m) => [String(m._id), m]));
    res.json({
      movements: movements.map((m) => ({
        ...m,
        canReverse: !m.reversed && !m.reversalOf,
        isReversal: !!m.reversalOf,
        // لقطة صغيرة من الحركة الأصلية لو كانت لسه في نفس الصفحة.
        originalRef: m.reversalOf
          ? (() => { const o = byId.get(String(m.reversalOf)); return o ? { type: o.type, quantity: o.quantity, at: o.createdAt } : null; })()
          : null,
      })),
    });
  } catch (e) { res.status(500).json({ message: 'Failed to load movements' }); }
};
