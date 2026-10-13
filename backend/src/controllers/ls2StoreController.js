const { Ls2StoreItem, Ls2StoreMovement, Ls2Supplier } = require('../models/Ls2Store');
const { todayKey } = require('../utils/companyDay');
const cache = require('../utils/ttlCache');
const { emitToAll } = require('../websocket/socketManager');
const logAudit = require('../utils/auditLogger');

// المسحُ قبل الإعلان، وللقسم كلِّه: حركةُ مخزنٍ تُقرأ في لوحة القسم وملفّ المركبة أيضًا.
const emit = () => { require('../utils/ls2Touch').touchLs2({ store: true }); };

/**
 * مخزنُ الطلب: الثقيلُ افتراضًا، والخفيفُ حين يُطلَب صراحةً.
 *
 * الشاشتان تنادِيان النقاطَ نفسَها بـ`?warehouse=light`، فآليّةُ المخزن واحدةٌ
 * ورصيدُ كلٍّ على حدة. والافتراضُ «ثقيل» يُبقي الروابطَ القديمةَ تعمل كما كانت.
 */
const whOf = (req) => (String(req.query.warehouse || req.body?.warehouse || '').trim() === 'light' ? 'light' : 'heavy');
/** الصفوفُ القديمةُ كُتبت قبل الحقل، فغيابُه يعني «ثقيل». */
const whFilter = (wh) => (wh === 'light' ? { warehouse: 'light' } : { warehouse: { $ne: 'light' } });

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
/** التعديلُ لا يكتب الرصيد: الرصيدُ يتغيّر بحركةٍ وحدَها. */
const pickEdit = (body) => { const o = pick(body); delete o.quantity; return o; };

const YMD = /^\d{4}-\d{2}-\d{2}$/;
const dayOf = (v) => (YMD.test(String(v || '').trim()) ? String(v).trim() : '');
const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
const foldName = (s) => String(s || '').trim().toLowerCase()
  .replace(/[أإآ]/g, 'ا').replace(/ى/g, 'ي').replace(/ة/g, 'ه').replace(/[\u064B-\u0652\u0640]/g, '').replace(/\s+/g, ' ');

/**
 * الموردُ كما يصل من الشاشة: معرّفُه (اختيارٌ من القائمة) أو اسمٌ جديدٌ يُكتب في
 * الخانة نفسِها — فيُنشأ ويُختار في الطلب ذاتِه. ويردّ `null` إن لم يُذكر مورد.
 */
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

// حالة الصنف: نافد (0) / منخفض (≤ الحد) / متوفر.
const statusOf = (it) => (it.quantity <= 0 ? 'out' : (it.minQuantity > 0 && it.quantity <= it.minQuantity ? 'low' : 'ok'));

// ── قائمة الأصناف ────────────────────────────────────────────────────────────
exports.listItems = async (req, res) => {
  try {
    const cacheKey = `ls2store:items:${JSON.stringify(req.query || {})}`;
    const hit = cache.get(cacheKey);
    if (hit !== undefined) return res.json(hit);

    const filter = { isActive: { $ne: false }, ...whFilter(whOf(req)) };
    if (req.query.category) filter.category = req.query.category;
    if (/^[0-9a-f]{24}$/i.test(String(req.query.supplier || ''))) filter.supplier = req.query.supplier;
    // يومُ الشراء: يومٌ أو شهرٌ أو فترة. وما لا تاريخَ شراءٍ له (أصنافُ ما قبل
    // الخانة) لا يدخل فلترًا زمنيًّا — فلا يُنسَب إلى يومٍ لم يُشترَ فيه.
    const from = dayOf(req.query.from); const to = dayOf(req.query.to);
    if (from || to) filter.purchaseDate = { ...(from ? { $gte: from } : {}), ...(to ? { $lte: to } : { $ne: '' }) };
    if (req.query.q && req.query.q.trim()) {
      const rx = new RegExp(req.query.q.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
      filter.$or = [{ name: rx }, { code: rx }, { category: rx }, { compatibleModels: rx }, { supplierName: rx }];
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
    // ── ومفتاحُ الحفظ يحمل المخزن ─────────────────────────────────────────
    // كان ثابتًا، فأوّلُ مخزنٍ يُسأل عنه يملأ الحفظَ ويقرؤه الآخر: لوحةُ النقل
    // الخفيف تعرض أرقامَ الثقيل أو بالعكس، وكلاهما صحيحُ الشكل كاذبُ المعنى.
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
    // ── والقطعةُ تُضاف بسعرها ─────────────────────────────────────────────
    // صنفٌ بلا سعرٍ قيمتُه في المخزن صفر مهما كان رصيدُه — فيُجمَع المخزنُ كلُّه
    // برقمٍ أقلَّ ممّا فيه، ولا يُعرَف كم كلّفت القطعةُ حين تُصرَف على عربيّة.
    if (!(Number(data.unitPrice) > 0)) return res.status(400).json({ message: 'اكتب سعر القطعة الواحدة', code: 'PRICE_REQUIRED' });
    const [it] = await createItems(req, [req.body]);
    emit();
    res.status(201).json({ item: it });
  } catch (e) { console.error('ls2 store create', e); res.status(500).json({ message: 'Failed to create item' }); }
};

/**
 * ينشئ الأصنافَ ومعها حركةُ واردِها الأولى.
 *
 * كان الصنفُ يُنشأ برصيده ولا حركةَ له: قطعٌ في المخزن لا يقول السجلُّ من أين
 * جاءت ولا بكم ولا متى. فالعددُ عند الإنشاء واردٌ كأيّ وارد — بمورده وسعره
 * ويوم شرائه — يُقرأ في سجلّ الحركات ويُعكَس كغيره.
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
 *
 * فاتورةُ شراءٍ واحدةٌ فيها عشرةُ أصناف: تُكتب في جدولٍ واحدٍ بموردها ويومها بدل
 * عشر استماراتٍ يُعاد فيها الموردُ والتاريخُ عشرَ مرّات. والمشترَكُ يُكتب مرّةً
 * فوق الجدول، وما كُتب في السطر يُقدَّم عليه.
 *
 * الكلُّ أو لا شيء: سطرٌ ناقصٌ يرفض الدفعةَ كلَّها بأرقام الأسطر — دفعةٌ نصفُها
 * دخل لا يعرف كاتبُها أيَّ نصف.
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
      seen.add(foldName(name));
      if (!(Number(b?.unitPrice) > 0)) errors.push({ line, message: 'اكتب سعر القطعة الواحدة' });
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
    // الواردُ يدخل بسعر قطعته: ما كُتب الآن، أو سعرُ الصنف المسجَّل إن لم يتغيّر.
    let price = null;
    if (type === 'in') {
      price = req.body.unitPrice !== undefined && req.body.unitPrice !== '' && req.body.unitPrice !== null
        ? Number(req.body.unitPrice) : Number(item.unitPrice);
      if (!(price > 0)) return res.status(400).json({ message: `اكتب سعر القطعة الواحدة من «${item.name}»`, code: 'PRICE_REQUIRED' });
      item.unitPrice = price;
    }
    // الواردُ من مورد: يُكتب على الحركة، ويصير آخرَ توريدٍ للصنف.
    const sup = type === 'in' ? await resolveSupplier(req, req.body.supplier, req.body.supplierName) : null;
    const date = dayOf(req.body.date) || todayKey();
    if (type === 'in') { if (sup) Object.assign(item, sup); item.purchaseDate = date; }
    item.quantity += type === 'in' ? qty : -qty;
    await item.save();
    const mv = await Ls2StoreMovement.create({
      unitPrice: price, ...(sup || {}), date,
      item: item._id, itemName: item.name, warehouse: item.warehouse || 'heavy', type, quantity: qty,
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
    const sup = type === 'in' ? await resolveSupplier(req, req.body?.supplier, req.body?.supplierName) : null;
    const date = dayOf(req.body?.date) || todayKey();

    // الصنف المكرَّر في الاختيار تُجمَع كمياته، فلا يُقاس كل سطر وحده على الرصيد.
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
      // الوارد لا يُقيَّد برصيد؛ الصادر وحده هو الذي يَنقص.
      if (type === 'out' && (Number(it.quantity) || 0) < total) {
        errors.push({ id, name: it.name, message: `${it.name}: الرصيد ${it.quantity} والمطلوب ${total}` });
      }
      // الواردُ بسعر قطعته: المكتوبُ في السطر، أو سعرُ الصنف المسجَّل.
      if (type === 'in') {
        const p = prices.has(id) ? prices.get(id) : Number(it.unitPrice);
        if (!(p > 0)) errors.push({ id, name: it.name, message: `${it.name}: اكتب سعر القطعة الواحدة` });
        else prices.set(id, p);
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
      if (type === 'in') { it.unitPrice = prices.get(id); if (sup) Object.assign(it, sup); it.purchaseDate = date; }
      await it.save();
      movements.push({
        unitPrice: type === 'in' ? prices.get(id) : null, ...(sup || {}), date,
        item: it._id, itemName: it.name, warehouse: it.warehouse || 'heavy', type, quantity: qty,
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
      item: item._id, itemName: item.name, warehouse: item.warehouse || 'heavy',
      type: mv.type === 'in' ? 'out' : 'in', quantity: mv.quantity,
      vehiclePlate: mv.vehiclePlate,
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

// ── سجل الحركات ───────────────────────────────────────────────────────────────
exports.listMovements = async (req, res) => {
  try {
    const filter = { ...whFilter(whOf(req)) };
    if (req.query.item) filter.item = req.query.item;
    if (req.query.type) filter.type = req.query.type;
    if (/^[0-9a-f]{24}$/i.test(String(req.query.supplier || ''))) filter.supplier = req.query.supplier;
    // اليومُ يومُ الحركة (`date`)، وما سُجِّل قبل الخانة يُقرأ من لحظة تسجيله.
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
    // الوحدةُ من الصنف، والقيمةُ عددٌ × سعر — للوارد الذي كُتب سعرُه.
    const units = new Map((await Ls2StoreItem.find({ _id: { $in: [...new Set(rows.map((m) => String(m.item)))] } }).select('unit code').lean()).map((i) => [String(i._id), i]));
    const movements = rows.map((m) => ({
      ...m,
      date: m.date || new Date(new Date(m.createdAt).getTime() + 3 * 3600 * 1000).toISOString().slice(0, 10),
      unit: units.get(String(m.item))?.unit || '', itemCode: units.get(String(m.item))?.code || '',
      total: m.unitPrice != null ? r2(m.quantity * m.unitPrice) : null,
    }));
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

// ═══════════════════════════════════════════════════════════════════════════
//  الموردون
// ═══════════════════════════════════════════════════════════════════════════
// GET /suppliers — ومع كلٍّ ما اشتُري منه: كم صنفًا، وكم توريدًا، وبكم.
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
    // محذوفٌ بالاسم نفسِه يُعاد بدل أن يُنشأ توأمُه — فتبقى مشترياتُه القديمةُ معه.
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
    // الاسمُ لقطةٌ على الصنف والحركة — تتبعه حين يُصحَّح، وإلّا بقي الجدولُ على القديم.
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

// الحذفُ إخفاءٌ: مشترياتُه السابقةُ تبقى باسمه في السجلّ.
exports.deleteSupplier = async (req, res) => {
  try {
    const s = await Ls2Supplier.findOneAndUpdate({ _id: req.params.id, ...whFilter(whOf(req)) }, { $set: { isActive: false } }, { new: true });
    if (!s) return res.status(404).json({ message: 'المورد غير موجود' });
    logAudit({ user: req.user, action: 'store_supplier_delete', entity: 'Ls2Supplier', entityId: s._id, changes: { before: { name: s.name } }, ipAddress: req.ip }).catch(() => {});
    emit();
    res.json({ message: 'deleted' });
  } catch (e) { res.status(500).json({ message: 'تعذّر حذف المورد' }); }
};
