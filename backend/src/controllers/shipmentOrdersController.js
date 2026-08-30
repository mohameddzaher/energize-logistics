const ShipmentOrder = require('../models/ShipmentOrder');
const { startOfDay, endOfDay } = require('../utils/companyDay');
const ShipmentOrderCustomer = require('../models/ShipmentOrderCustomer');
const ShipmentOrderField = require('../models/ShipmentOrderField');
const ShipmentOrderSupplier = require('../models/ShipmentOrderSupplier');
const ShipmentOrderVehicle = require('../models/ShipmentOrderVehicle');
const { emitToAll } = require('../websocket/socketManager');
const logAudit = require('../utils/auditLogger');
const { createNotification } = require('../services/notificationService');

// The trial section for creating shipments natively, instead of on the external
// UPL platform. Fully self-contained: nothing here reads or writes anything the
// Operations Platform mirror owns.

const emit = (event, payload = {}) => { try { emitToAll(event, payload); } catch (e) {} };

const pick = (body, fields) => {
  const out = {};
  fields.forEach((f) => { if (body[f] !== undefined) out[f] = body[f]; });
  return out;
};

const rx = (s) => new RegExp(String(s).trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');

const fullName = (u) => (u ? `${u.firstName || ''} ${u.lastName || ''}`.trim() : '');

const ORDER_EDITABLE = [
  'fromCity', 'toCity', 'addressFrom', 'addressTo',
  'truckType', 'cargoType', 'truckLength', 'quantity',
  'customer', 'driverName', 'driverPhone', 'vehicleName', 'vehicle',
  'pickupTime', 'startTime', 'arrivalTime', 'sellPrice', 'buyPrice',
  'driverRentType', 'paymentMethod', 'driverRentPrice', 'branch',
  'status', 'notes', 'customFields',
];

const CUSTOMER_EDITABLE = ['name', 'phone', 'email', 'notes', 'routes', 'defaults', 'isActive'];

// ── Orders ──────────────────────────────────────────────────────────────────

// Inline "new customer" typed straight into the order form — register them and
// point the order at the new id. Shared by create AND update (an edit can switch
// an order to a first-time customer too).
async function resolveInlineCustomer(req, data) {
  if (data.customer || !req.body.newCustomer || !String(req.body.newCustomer.name || '').trim()) return;
  const c = await ShipmentOrderCustomer.create({
    name: String(req.body.newCustomer.name).trim(),
    phone: String(req.body.newCustomer.phone || '').trim(),
    createdBy: req.user._id,
  });
  data.customer = c._id;
  emit('shipmentOrders:customers', {});
}

// Inline fresh truck (and its supplier when that is new too) — the fleet
// register learns from the work. Shared by create AND update.
async function resolveInlineVehicle(req, data) {
  if (data.vehicle || !req.body.newVehicle || !String(req.body.newVehicle.plate || '').trim()) return;
  const nv = req.body.newVehicle;
  let supplierId = nv.supplierId || null;
  if (!supplierId && nv.newSupplier && String(nv.newSupplier.name || '').trim()) {
    const sup = await ShipmentOrderSupplier.create({
      name: String(nv.newSupplier.name).trim(),
      type: nv.newSupplier.type === 'freelancer' ? 'freelancer' : 'company',
      phone: String(nv.newSupplier.phone || '').trim(),
      createdBy: req.user._id,
    });
    supplierId = sup._id;
  }
  const veh = await ShipmentOrderVehicle.create({
    plate: String(nv.plate).trim(),
    name: String(nv.name || '').trim(),
    truckType: data.truckType || '',
    supplier: supplierId,
    defaultDriverName: data.driverName || '',
    defaultDriverPhone: data.driverPhone || '',
    createdBy: req.user._id,
  });
  data.vehicle = veh._id;
  emit('shipmentOrders:fleet', {});
}

// The denormalized snapshot an order carries of its truck: display label,
// supplier, and the truck's regular driver as a fallback. Must be refreshed
// whenever `vehicle` changes or the list/PDF keep printing the OLD plate.
async function applyVehicleSnapshot(data) {
  if (!data.vehicle) return;
  const veh = await ShipmentOrderVehicle.findById(data.vehicle).lean();
  if (!veh) return;
  data.vehicleName = [veh.plate, veh.name].filter(Boolean).join(' — ');
  data.supplier = veh.supplier || null;
  if (!data.driverName && veh.defaultDriverName) data.driverName = veh.defaultDriverName;
  if (!data.driverPhone && veh.defaultDriverPhone) data.driverPhone = veh.defaultDriverPhone;
}

exports.listOrders = async (req, res) => {
  try {
    const { q, status, customer, supplier, source, branch, from, to, page = 1, limit = 25 } = req.query;
    const filter = {};
    if (status) filter.status = status;
    if (customer) filter.customer = customer;
    if (supplier) filter.supplier = supplier;
    if (branch) filter.branch = branch;
    // ── من أين جاءت الشحنة؟ ───────────────────────────────────────────────
    // شحناتُ المنصّة تحمل رقمَ كشف تخريجٍ حقيقيًّا يُحاسَب عليه، وشحناتُنا —
    // تجريبيّةً اليوم — تحمل رقمًا يسبقه حرف. والفصلُ بينهما ليس ترتيبًا: من
    // يقرأ تقريرًا يجب أن يعرف أهو عن عملٍ جرى أم عن تجربة.
    if (source === 'system' || source === 'platform') filter.source = source;
    if (from || to) {
      filter.createdAt = {};
      if (from) filter.createdAt.$gte = startOfDay(from);
      if (to) filter.createdAt.$lte = endOfDay(to);
    }
    if (q && q.trim()) {
      const r = rx(q);
      const or = [
        { customerName: r }, { driverName: r }, { driverPhone: r }, { fromCity: r }, { toCity: r },
        { vehicleName: r }, { supplierName: r }, { agentName: r }, { notes: r },
        { truckType: r }, { branch: r }, { reference: r },
      ];
      // A run of digits is almost always a waybill lookup — match it exactly,
      // not as a substring of prices. ويُبحَث برقم كشف التخريج أيضًا: هو الرقمُ
      // الذي يعرفه الفريقُ عن شحنات المنصّة.
      const n = Number(String(q).trim());
      if (Number.isFinite(n)) { or.push({ waybillNumber: n }); or.push({ graduationNumber: n }); }
      filter.$or = or;
    }

    const skip = (parseInt(page) - 1) * parseInt(limit);
    const [orders, total, statusAgg, priceAgg] = await Promise.all([
      ShipmentOrder.find(filter)
        .populate('customer', 'name phone')
        .populate('createdBy', 'firstName lastName')
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(parseInt(limit))
        .lean(),
      ShipmentOrder.countDocuments(filter),
      // Header numbers respect the SAME filter as the table — a filtered list
      // with unfiltered totals reads as a bug.
      ShipmentOrder.aggregate([{ $match: filter }, { $group: { _id: '$status', n: { $sum: 1 } } }]),
      ShipmentOrder.aggregate([{ $match: filter }, {
        $group: { _id: null, sell: { $sum: '$sellPrice' }, buy: { $sum: '$buyPrice' } },
      }]),
    ]);

    const byStatus = {};
    statusAgg.forEach((r) => { byStatus[r._id] = r.n; });

    // عددُ كلٍّ من المصدرين تحت **بقيّة** الفلاتر لا تحته هو: من يقف على
    // «الخاصّ بنا» يريد أن يعرف كم في «المنصّة» بنفس الفترة والحالة، لا الكلّ.
    const sourceFilter = { ...filter };
    delete sourceFilter.source;
    const sourceAgg = await ShipmentOrder.aggregate([
      { $match: sourceFilter }, { $group: { _id: '$source', n: { $sum: 1 } } },
    ]);
    const bySource = { system: 0, platform: 0 };
    sourceAgg.forEach((r) => { bySource[r._id === 'platform' ? 'platform' : 'system'] = r.n; });
    bySource.total = bySource.system + bySource.platform;

    res.json({
      bySource,
      orders,
      total,
      stats: {
        byStatus,
        sellTotal: priceAgg[0]?.sell || 0,
        buyTotal: priceAgg[0]?.buy || 0,
      },
    });
  } catch (error) {
    console.error('Error listing shipment orders:', error);
    res.status(500).json({ message: 'Failed to load shipment orders' });
  }
};

// Creating an order can also create the customer it is for ("first time we work
// with them"), and a priced route the customer's profile does not know yet is
// written back to it — the profile learns from the work.
exports.createOrder = async (req, res) => {
  try {
    const data = pick(req.body, ORDER_EDITABLE);

    await resolveInlineCustomer(req, data);

    if (data.customer) {
      const c = await ShipmentOrderCustomer.findById(data.customer);
      if (c) {
        data.customerName = c.name;
        // Teach the profile this route if it is new and a sell price was given.
        const knows = (c.routes || []).some((r) => r.fromCity === data.fromCity && r.toCity === data.toCity);
        if (!knows && data.fromCity && data.toCity && data.sellPrice != null) {
          c.routes.push({ fromCity: data.fromCity, toCity: data.toCity, price: data.sellPrice });
          await c.save();
        }
      }
    }

    // The truck: one of ours, a known supplier's, or typed in fresh. A fresh
    // plate registers the vehicle (and its supplier when that is new too) as a
    // side effect — the fleet register learns from the work, like the customer
    // price list does.
    await resolveInlineVehicle(req, data);
    await applyVehicleSnapshot(data);

    data.agentName = fullName(req.user); // المندوب — stamped, never typed
    data.createdBy = req.user._id;

    const order = await ShipmentOrder.create(data);
    emit('shipmentOrders:updated', { id: String(order._id) });

    await logAudit({
      user: req.user, action: 'create', entity: 'ShipmentOrder', entityId: order._id,
      changes: { waybillNumber: order.waybillNumber, customerName: order.customerName },
      ipAddress: req.ip,
    });

    res.status(201).json({ order });
  } catch (error) {
    console.error('Error creating shipment order:', error);
    res.status(500).json({ message: 'Failed to create the shipment order' });
  }
};

// One order by id — the edit form's loader. Finding it by paging through the
// list capped at 1000 silently blanked the form for older orders.
exports.getOrder = async (req, res) => {
  try {
    const order = await ShipmentOrder.findById(req.params.id)
      .populate('customer', 'name phone')
      .lean();
    if (!order) return res.status(404).json({ message: 'Shipment order not found' });
    res.json({ order });
  } catch (error) {
    res.status(500).json({ message: 'Failed to load the shipment order' });
  }
};

exports.updateOrder = async (req, res) => {
  try {
    const order = await ShipmentOrder.findById(req.params.id);
    if (!order) return res.status(404).json({ message: 'Shipment order not found' });

    const data = pick(req.body, ORDER_EDITABLE);

    // An edit can introduce a first-time customer or a fresh truck exactly like
    // the create form — the same inline registration applies.
    await resolveInlineCustomer(req, data);
    if (data.customer && String(data.customer) !== String(order.customer)) {
      const c = await ShipmentOrderCustomer.findById(data.customer).select('name').lean();
      if (c) data.customerName = c.name;
    }

    await resolveInlineVehicle(req, data);
    // Truck swapped → refresh the denormalized plate/supplier snapshot, or the
    // list, the Excel export and the بوليصة keep printing the OLD truck.
    if (data.vehicle && String(data.vehicle) !== String(order.vehicle)) {
      await applyVehicleSnapshot(data);
    }

    // Answers of since-deleted custom fields must survive an unrelated edit —
    // the form only sends the currently-configured fields, so merge, don't replace.
    if (data.customFields) data.customFields = { ...(order.customFields || {}), ...data.customFields };

    Object.assign(order, data);
    await order.save();
    emit('shipmentOrders:updated', { id: String(order._id) });
    res.json({ order });
  } catch (error) {
    res.status(500).json({ message: 'Failed to update the shipment order' });
  }
};

// The one-click lifecycle change from the list — the whole point is not having
// to open an order to say "it arrived".
// ── تحليلاتُ القسم ─────────────────────────────────────────────────────────
//
// موديلُ العمل هنا وساطة: نشتري الحمولةَ من مورّدٍ بسعرٍ ونبيعها لعميلٍ بسعر،
// والفرقُ هو ربحُنا. فالسؤالُ الأوّل ليس «كم حملنا» بل **«كم كسبنا وممّن»**:
// أيُّ عميلٍ يشتري أكثر، وأيُّ مورّدٍ ينفّذ أرخص، وأيُّ مسارٍ هامشُه أعلى.
//
// ولذلك لا تصلح تحليلاتُ إدارة الأسطول هنا: هناك السيّارةُ سيّارتُنا فالسؤالُ
// «هل حقّقت هدفَها»، وهنا لا سيّارةَ لنا — السؤالُ «هل كان الفرقُ يستحقّ».

exports.getAnalytics = async (req, res) => {
  try {
    const { from, to, customer, supplier, status, branch, q, source } = req.query;
    const match = {};
    if (from || to) {
      match.pickupTime = {};
      if (from) match.pickupTime.$gte = startOfDay(from);
      // «إلى» مفتوحًا يعني حتى الآن — لا حتى منتصف ليل اليوم، وإلّا اختفت
      // شحناتُ اليوم من تقرير من طلب «من أوّل الشهر».
      match.pickupTime.$lte = to ? endOfDay(to) : new Date();
    }
    if (customer) match.customer = new mongoose.Types.ObjectId(String(customer));
    if (supplier) match.supplier = new mongoose.Types.ObjectId(String(supplier));
    if (status) match.status = status;
    if (branch) match.branch = branch;
    // الخاصُّ بنا أم المنصّة: التقريرُ عن عملٍ جرى غيرُ التقرير عن تجربة.
    if (source === 'system' || source === 'platform') match.source = source;
    if (q && String(q).trim()) {
      const r = rx(q);
      match.$or = [{ customerName: r }, { supplierName: r }, { fromCity: r }, { toCity: r },
        { driverName: r }, { truckType: r }, { branch: r }, { reference: r }];
    }

    // ── يُحسب في القاعدة لا في العقدة ────────────────────────────────────────
    // بعد نقل ثلاثةٍ وثلاثين ألف شحنة صارت القراءةُ الكاملة تستغرق دقيقتين —
    // ليست حسابًا بطيئًا بل نقلًا: أربعةٌ وثلاثون ألفَ صفٍّ تعبر الشبكةَ لتُجمَع
    // هنا. والتجميعُ يجري حيث تعيش البيانات، فيعود سطرٌ لكلّ مجموعة.
    //
    // والملغاةُ تُستثنى من المال وتُعدّ وحدَها: لم تُنفَّذ ولم تُفوتَر، لكنّ
    // نسبةَ الإلغاء رقمٌ يُدار.
    const CANCELLED = 'cancelled';
    const money = { $ne: [{ $ifNull: ['$status', ''] }, CANCELLED] };
    const sellOf = { $cond: [money, { $ifNull: ['$sellPrice', 0] }, 0] };
    const buyOf = { $cond: [money, { $ifNull: ['$buyPrice', 0] }, 0] };
    const liveOf = { $cond: [money, 1, 0] };

    const groupBy = (id) => ([
      { $match: match },
      { $group: {
        _id: id,
        orders: { $sum: liveOf },
        sell: { $sum: sellOf },
        buy: { $sum: buyOf },
      } },
      { $match: { orders: { $gt: 0 } } },
      { $addFields: { margin: { $subtract: ['$sell', '$buy'] } } },
      { $sort: { margin: -1 } },
      // سقفٌ أوسعُ قبل الطيّ: الصفُّ المقصوصُ عند المئتين قد يكون نصفَ صفٍّ
      // آخر، فيُقصّ ثمّ يُطوى فيضيع نصفُه. يُقصُّ بعد الطيّ لا قبلَه.
      { $limit: 600 },
    ]);

    const r2 = (v) => Math.round((Number(v) || 0) * 100) / 100;

    // ── الاسمُ الواحد صفٌّ واحد ──────────────────────────────────────────────
    // «شركة تنشيط للخدمات اللوجستية» و«…اللوچستية» مورّدٌ واحدٌ كُتب بحرفين،
    // فكان يُقرأ مورّدَين: ٤١٤٥ شحنةً في صفٍّ و١٧٩٧ في آخر، ولا يظهر حجمُه
    // الحقيقيّ في أيٍّ منهما. تُطوى الفروقُ الإملائيّةُ المعتادةُ في العربيّة
    // قبل الجمع، ويُعرض أكثرُ الكتابتين ورودًا.
    const fold = (v) => String(v || '')
      .replace(/[أإآٱ]/g, 'ا').replace(/ى/g, 'ي').replace(/ة/g, 'ه')
      .replace(/چ/g, 'ج').replace(/گ/g, 'ك').replace(/ڤ/g, 'ف').replace(/پ/g, 'ب')
      .replace(/[\u064B-\u0652\u0640]/g, '')
      .replace(/\s+/g, ' ').trim().toLowerCase();

    const merge = (rows) => {
      const byKey = new Map();
      rows.forEach((b) => {
        const k = fold(b._id) || '—';
        const cur = byKey.get(k);
        if (!cur) { byKey.set(k, { ...b, _variants: [{ name: b._id, orders: b.orders }] }); return; }
        cur.orders += b.orders; cur.sell += b.sell; cur.buy += b.buy; cur.margin += b.margin;
        cur._variants.push({ name: b._id, orders: b.orders });
      });
      return [...byKey.values()]
        // الاسمُ المعروض أكثرُ الكتابتين ورودًا — لا أوّلُها صدفةً.
        .map((b) => ({ ...b, _id: b._variants.sort((x, y) => y.orders - x.orders)[0].name }))
        .sort((x, y) => y.margin - x.margin)
        .slice(0, 200);
    };

    const shape = (rows) => merge(rows).map((b) => ({
      key: String(b._id || '—'),
      name: String(b._id || '—').trim() || '—',
      orders: b.orders,
      sell: r2(b.sell),
      buy: r2(b.buy),
      margin: r2(b.margin),
      marginPct: b.sell ? r2((b.margin / b.sell) * 100) : null,
      avgMargin: b.orders ? r2(b.margin / b.orders) : 0,
    }));

    const [totalsAgg, byCustomer, bySupplier, byRoute, byTruckType, byBranch, byMonthAgg, statusAgg, losingRows] =
      await Promise.all([
        ShipmentOrder.aggregate([
          { $match: match },
          { $group: {
            _id: null,
            orders: { $sum: 1 },
            live: { $sum: liveOf },
            sell: { $sum: sellOf },
            buy: { $sum: buyOf },
            // بلا سعرٍ لا يُحسب هامش — يُقال العددُ كي لا يُقرأ الربحُ ناقصًا.
            missingPrice: { $sum: { $cond: [{ $and: [money, { $or: [
              { $not: [{ $gt: [{ $ifNull: ['$sellPrice', 0] }, 0] }] },
              { $not: [{ $gt: [{ $ifNull: ['$buyPrice', 0] }, 0] }] },
            ] }] }, 1, 0] } },
          } },
        ]),
        ShipmentOrder.aggregate(groupBy('$customerName')),
        ShipmentOrder.aggregate(groupBy('$supplierName')),
        ShipmentOrder.aggregate(groupBy({ $concat: [{ $ifNull: ['$fromCity', '—'] }, ' → ', { $ifNull: ['$toCity', '—'] }] })),
        ShipmentOrder.aggregate(groupBy('$truckType')),
        ShipmentOrder.aggregate(groupBy('$branch')),
        ShipmentOrder.aggregate([
          { $match: { ...match, pickupTime: { ...(match.pickupTime || {}), $ne: null } } },
          { $group: {
            _id: { $dateToString: { format: '%Y-%m', date: '$pickupTime' } },
            orders: { $sum: liveOf }, sell: { $sum: sellOf }, buy: { $sum: buyOf },
          } },
          { $sort: { _id: 1 } },
        ]),
        ShipmentOrder.aggregate([{ $match: match }, { $group: { _id: '$status', n: { $sum: 1 } } }]),
        // الشحنةُ التي بيعُها أقلُّ من شرائها ليست رقمًا في متوسّط: بوليصةٌ
        // باسمها يُسأل عنها.
        ShipmentOrder.aggregate([
          { $match: { ...match, status: { $ne: CANCELLED }, sellPrice: { $gt: 0 } } },
          { $addFields: { margin: { $subtract: [{ $ifNull: ['$sellPrice', 0] }, { $ifNull: ['$buyPrice', 0] }] } } },
          { $match: { margin: { $lt: 0 } } },
          { $sort: { margin: 1 } },
          { $limit: 50 },
          { $project: { waybillNumber: 1, reference: 1, customerName: 1, supplierName: 1, fromCity: 1, toCity: 1, status: 1, sellPrice: 1, buyPrice: 1, margin: 1, pickupTime: 1 } },
        ]),
      ]);

    // قوائمُ المجموعات مقصوصةٌ عند مئتين للعرض، فلا يُؤخذ طولُها عددًا:
    // «٢٠٠ مسار» تقرأ رقمًا وهي في الحقيقة حدُّ الشاشة. تُعدُّ المميّزةُ وحدَها.
    const [distinctCustomers, distinctSuppliers, distinctRoutes, losingCount] = await Promise.all([
      ShipmentOrder.distinct('customerName', { ...match, status: { $ne: CANCELLED } }),
      ShipmentOrder.distinct('supplierName', { ...match, status: { $ne: CANCELLED } }),
      ShipmentOrder.aggregate([
        { $match: { ...match, status: { $ne: CANCELLED } } },
        { $group: { _id: { f: '$fromCity', t: '$toCity' } } },
        { $count: 'n' },
      ]).then((r) => (r[0] ? r[0].n : 0)),
      ShipmentOrder.countDocuments({ ...match, status: { $ne: CANCELLED }, sellPrice: { $gt: 0 },
        $expr: { $lt: [{ $ifNull: ['$sellPrice', 0] }, { $ifNull: ['$buyPrice', 0] }] } }),
    ]);

    const T = totalsAgg[0] || { orders: 0, live: 0, sell: 0, buy: 0, missingPrice: 0 };
    const margin = T.sell - T.buy;
    const byStatus = {};
    statusAgg.forEach((x) => { byStatus[x._id] = x.n; });

    res.json({
      totals: {
        orders: T.orders,
        live: T.live,
        cancelled: T.orders - T.live,
        cancelRate: T.orders ? r2(((T.orders - T.live) / T.orders) * 100) : 0,
        sell: r2(T.sell),
        buy: r2(T.buy),
        margin: r2(margin),
        marginPct: T.sell ? r2((margin / T.sell) * 100) : 0,
        avgMargin: T.live ? r2(margin / T.live) : 0,
        avgSell: T.live ? r2(T.sell / T.live) : 0,
        // يُعدُّ المطويُّ لا الخام: وإلّا عُدَّ المورّدُ المكتوبُ بحرفين اثنين.
        customers: new Set(distinctCustomers.map(fold).filter(Boolean)).size,
        suppliers: new Set(distinctSuppliers.map(fold).filter(Boolean)).size,
        routes: distinctRoutes,
        losing: losingCount,
        missingPrice: T.missingPrice,
      },
      byCustomer: shape(byCustomer),
      bySupplier: shape(bySupplier),
      byRoute: shape(byRoute),
      byTruckType: shape(byTruckType),
      byBranch: shape(byBranch),
      byMonth: byMonthAgg.map((b) => ({
        key: b._id, orders: b.orders, sell: r2(b.sell), buy: r2(b.buy), margin: r2(b.sell - b.buy),
      })),
      byStatus,
      losing: losingRows.map((o) => ({ ...o, margin: r2(o.margin) })),
    });
  } catch (error) {
    console.error('shipmentOrders analytics error:', error);
    res.status(500).json({ message: error.message || 'Failed to load analytics' });
  }
};

// ── عدّادُ البوالص ──────────────────────────────────────────────────────────
// رقمُ البوليصة يُكتب على ورقٍ يُسلَّم للسائق ويُحاسَب عليه. فلا يُعاد رقمٌ صُرف
// ولو حُذفت شحنتُه: بوليصتان بالرقم نفسِه في يدين خطأٌ لا يُصلَح لاحقًا. ولذلك
// العدّادُ يُقدَّم ولا يُرجَع.

const Counter = require('mongoose').models.ShipmentOrderCounter
  || require('mongoose').model('ShipmentOrderCounter');

exports.getCounter = async (req, res) => {
  try {
    const c = await Counter.findById('waybill').lean();
    const seq = c ? c.seq : 499;
    const next = Math.max(seq + 1, 500);
    res.json({ next, start: next });
  } catch (error) {
    res.status(500).json({ message: 'Failed to read the waybill counter' });
  }
};

exports.updateCounter = async (req, res) => {
  try {
    const start = Number(req.body.start);
    if (!Number.isFinite(start)) return res.status(400).json({ message: 'رقم غير صالح' });
    const c = await Counter.findById('waybill').lean();
    const seq = c ? c.seq : 499;
    const next = Math.max(seq + 1, 500);
    if (start < next) {
      return res.status(400).json({ message: `لا يقلّ عن ${next} — الأرقام التي صُرفت لا تُعاد` });
    }
    await Counter.findOneAndUpdate({ _id: 'waybill' }, { $set: { seq: start - 1 } }, { upsert: true });
    await logAudit({
      user: req.user._id, action: 'set_waybill_counter', entity: 'ShipmentOrder',
      changes: { before: { next }, after: { next: start } }, ipAddress: req.ip,
    });
    res.json({ next: start, start });
  } catch (error) {
    res.status(500).json({ message: 'Failed to set the waybill counter' });
  }
};

exports.patchStatus = async (req, res) => {
  try {
    const { status } = req.body;
    const order = await ShipmentOrder.findById(req.params.id);
    if (!order) return res.status(404).json({ message: 'Shipment order not found' });
    const from = order.status;
    const note = String(req.body.note || '').trim().slice(0, 500);
    // نقلةٌ بلا تغييرٍ ولا ملاحظةٍ لا تُقيَّد: السجلُّ يمتلئ بأسطرٍ لا تقول شيئًا.
    if (from === status && !note) return res.json({ order });
    order.status = status;
    order.statusLog.push({
      from, to: status, note, at: new Date(),
      by: req.user._id,
      byName: `${req.user.firstName || ''} ${req.user.lastName || ''}`.trim(),
    });
    await order.save(); // save() so the enum validates the value
    emit('shipmentOrders:updated', { id: String(order._id) });
    // Tell whoever created the order its status moved — unless they moved it.
    if (order.createdBy && String(order.createdBy) !== String(req.user._id)) {
      try {
        await createNotification({
          recipient: order.createdBy,
          type: 'status_changed',
          title: 'تغيّرت حالة الطلب',
          message: `بوليصة ${order.waybillNumber} — ${order.status}${note ? ` · ${note}` : ''}`,
          relatedEntity: 'ShipmentOrder',
          relatedEntityId: order._id,
        });
      } catch (e) {}
    }
    res.json({ order });
  } catch (error) {
    res.status(400).json({ message: 'Invalid status' });
  }
};

exports.deleteOrder = async (req, res) => {
  try {
    const order = await ShipmentOrder.findByIdAndDelete(req.params.id);
    if (!order) return res.status(404).json({ message: 'Shipment order not found' });
    emit('shipmentOrders:updated', { id: String(req.params.id) });
    await logAudit({
      user: req.user, action: 'delete', entity: 'ShipmentOrder', entityId: req.params.id,
      changes: { waybillNumber: order.waybillNumber, customerName: order.customerName },
      ipAddress: req.ip,
    });
    res.json({ message: 'Shipment order deleted' });
  } catch (error) {
    res.status(500).json({ message: 'Failed to delete the shipment order' });
  }
};

// ── Customers ───────────────────────────────────────────────────────────────

// ── البحثُ يجد بأيّ شيء ─────────────────────────────────────────────────────
// السجلّاتُ صارت آلافًا بعد نقلها من المنصّة: ٣٣٦٩ مورّدًا و١٣١٠٢ مركبة. وحدٌّ
// أعمى بخمسمئة يقطع القائمة، وبحثٌ بالاسم وحدَه يعجز عمّن يُذكر برقمه أو
// بسجلّه أو بلوحته. فالبحثُ يمرّ على كلّ ما يُعرَف به السجلّ، والحدُّ يُطلَب.
const askedLimit = (v, def, max) => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.min(Math.max(n, 1), max) : def;
};
const anyOf = (q, fields) => ({ $or: fields.map((f) => ({ [f]: rx(q) })) });

exports.listCustomers = async (req, res) => {
  try {
    const { q } = req.query;
    const filter = { isActive: { $ne: false } };
    if (q && q.trim()) Object.assign(filter, anyOf(q, ['name', 'phone', 'email', 'city', 'address', 'externalId']));
    const customers = await ShipmentOrderCustomer.find(filter)
      .sort({ name: 1 })
      .limit(askedLimit(req.query.limit, 500, 5000))
      .lean();
    res.json({ customers, total: await ShipmentOrderCustomer.countDocuments(filter) });
  } catch (error) {
    res.status(500).json({ message: 'Failed to load customers' });
  }
};

exports.createCustomer = async (req, res) => {
  try {
    if (!req.body.name || !String(req.body.name).trim()) {
      return res.status(400).json({ message: 'Customer name is required' });
    }
    const data = pick(req.body, CUSTOMER_EDITABLE);
    data.createdBy = req.user._id;
    const customer = await ShipmentOrderCustomer.create(data);
    emit('shipmentOrders:customers', {});
    res.status(201).json({ customer });
  } catch (error) {
    res.status(500).json({ message: 'Failed to create the customer' });
  }
};

exports.updateCustomer = async (req, res) => {
  try {
    const customer = await ShipmentOrderCustomer.findById(req.params.id);
    if (!customer) return res.status(404).json({ message: 'Customer not found' });
    Object.assign(customer, pick(req.body, CUSTOMER_EDITABLE));
    await customer.save();
    // Orders show the snapshot name; keep future reads coherent after a rename.
    await ShipmentOrder.updateMany({ customer: customer._id }, { customerName: customer.name });
    emit('shipmentOrders:customers', {});
    res.json({ customer });
  } catch (error) {
    res.status(500).json({ message: 'Failed to update the customer' });
  }
};

exports.deleteCustomer = async (req, res) => {
  try {
    // Soft — their orders keep the snapshot name either way, but keeping the
    // row means the trial's data can be resurrected while it is still a trial.
    const customer = await ShipmentOrderCustomer.findByIdAndUpdate(
      req.params.id, { isActive: false }, { new: true },
    );
    if (!customer) return res.status(404).json({ message: 'Customer not found' });
    emit('shipmentOrders:customers', {});
    res.json({ message: 'Customer removed' });
  } catch (error) {
    res.status(500).json({ message: 'Failed to remove the customer' });
  }
};

// ── Suppliers & vehicles (الموردون والمركبات) ───────────────────────────────

const SUPPLIER_EDITABLE = ['name', 'type', 'phone', 'email', 'notes', 'isActive'];
const VEHICLE_EDITABLE = ['plate', 'name', 'truckType', 'supplier', 'defaultDriverName', 'defaultDriverPhone', 'notes', 'isActive'];

exports.listSuppliers = async (req, res) => {
  try {
    const { q } = req.query;
    const filter = { isActive: { $ne: false } };
    if (q && q.trim()) {
      Object.assign(filter, anyOf(q, ['name', 'phone', 'email', 'ownerName', 'ownerPhone',
        'managerName', 'managerPhone', 'accountantName', 'commercialRegister', 'iban', 'externalId']));
    }
    const suppliers = await ShipmentOrderSupplier.find(filter)
      .sort({ name: 1 })
      .limit(askedLimit(req.query.limit, 500, 5000))
      .lean();
    // How many trucks each one runs — the number the team actually asks for.
    const counts = await ShipmentOrderVehicle.aggregate([
      { $match: { isActive: { $ne: false }, supplier: { $ne: null } } },
      { $group: { _id: '$supplier', n: { $sum: 1 } } },
    ]);
    const byId = {};
    counts.forEach((c) => { byId[String(c._id)] = c.n; });
    res.json({
      suppliers: suppliers.map((s) => ({ ...s, vehicleCount: byId[String(s._id)] || 0 })),
      total: await ShipmentOrderSupplier.countDocuments(filter),
    });
  } catch (error) {
    res.status(500).json({ message: 'Failed to load suppliers' });
  }
};

exports.createSupplier = async (req, res) => {
  try {
    if (!req.body.name || !String(req.body.name).trim()) return res.status(400).json({ message: 'Supplier name is required' });
    const supplier = await ShipmentOrderSupplier.create({ ...pick(req.body, SUPPLIER_EDITABLE), createdBy: req.user._id });
    emit('shipmentOrders:fleet', {});
    res.status(201).json({ supplier });
  } catch (error) {
    res.status(500).json({ message: 'Failed to create the supplier' });
  }
};

exports.updateSupplier = async (req, res) => {
  try {
    const supplier = await ShipmentOrderSupplier.findByIdAndUpdate(req.params.id, pick(req.body, SUPPLIER_EDITABLE), { new: true });
    if (!supplier) return res.status(404).json({ message: 'Supplier not found' });
    emit('shipmentOrders:fleet', {});
    res.json({ supplier });
  } catch (error) {
    res.status(500).json({ message: 'Failed to update the supplier' });
  }
};

exports.deleteSupplier = async (req, res) => {
  try {
    const supplier = await ShipmentOrderSupplier.findByIdAndUpdate(req.params.id, { isActive: false }, { new: true });
    if (!supplier) return res.status(404).json({ message: 'Supplier not found' });
    emit('shipmentOrders:fleet', {});
    res.json({ message: 'Supplier removed' });
  } catch (error) {
    res.status(500).json({ message: 'Failed to remove the supplier' });
  }
};

exports.listVehicles = async (req, res) => {
  try {
    const { q } = req.query;
    const filter = { isActive: { $ne: false } };
    if (q && q.trim()) {
      Object.assign(filter, anyOf(q, ['plate', 'name', 'truckType', 'defaultDriverName',
        'defaultDriverPhone', 'operationCardNumber', 'recordNumber', 'modelYear', 'externalId']));
    }
    if (req.query.supplier) filter.supplier = req.query.supplier;
    const vehicles = await ShipmentOrderVehicle.find(filter)
      .populate('supplier', 'name type')
      .sort({ plate: 1 })
      .limit(askedLimit(req.query.limit, 1000, 5000))
      .lean();
    res.json({ vehicles, total: await ShipmentOrderVehicle.countDocuments(filter) });
  } catch (error) {
    res.status(500).json({ message: 'Failed to load vehicles' });
  }
};

exports.createVehicle = async (req, res) => {
  try {
    if (!req.body.plate || !String(req.body.plate).trim()) return res.status(400).json({ message: 'Plate is required' });
    const vehicle = await ShipmentOrderVehicle.create({ ...pick(req.body, VEHICLE_EDITABLE), createdBy: req.user._id });
    emit('shipmentOrders:fleet', {});
    res.status(201).json({ vehicle });
  } catch (error) {
    res.status(500).json({ message: 'Failed to create the vehicle' });
  }
};

exports.updateVehicle = async (req, res) => {
  try {
    const vehicle = await ShipmentOrderVehicle.findByIdAndUpdate(req.params.id, pick(req.body, VEHICLE_EDITABLE), { new: true });
    if (!vehicle) return res.status(404).json({ message: 'Vehicle not found' });
    emit('shipmentOrders:fleet', {});
    res.json({ vehicle });
  } catch (error) {
    res.status(500).json({ message: 'Failed to update the vehicle' });
  }
};

exports.deleteVehicle = async (req, res) => {
  try {
    const vehicle = await ShipmentOrderVehicle.findByIdAndUpdate(req.params.id, { isActive: false }, { new: true });
    if (!vehicle) return res.status(404).json({ message: 'Vehicle not found' });
    emit('shipmentOrders:fleet', {});
    res.json({ message: 'Vehicle removed' });
  } catch (error) {
    res.status(500).json({ message: 'Failed to remove the vehicle' });
  }
};

// ── Form fields (the settings page) ─────────────────────────────────────────

exports.listFields = async (req, res) => {
  try {
    // ?all=1 → the settings page (inactive rows included); default → the form.
    // Tombstoned system fields are gone from BOTH views — see the model.
    const filter = req.query.all ? { deleted: { $ne: true } } : { active: true, deleted: { $ne: true } };
    const fields = await ShipmentOrderField.find(filter).sort({ group: 1, order: 1 }).lean();
    res.json({ fields });
  } catch (error) {
    res.status(500).json({ message: 'Failed to load form fields' });
  }
};

const FIELD_EDITABLE = ['labelAr', 'labelEn', 'group', 'inputType', 'options', 'required', 'order', 'active'];

const slugify = (s) => String(s || '')
  .trim().toLowerCase().replace(/[^a-z0-9؀-ۿ]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 40) || 'field';

exports.createField = async (req, res) => {
  try {
    if (!req.body.labelAr || !String(req.body.labelAr).trim()) {
      return res.status(400).json({ message: 'Arabic label is required' });
    }
    const data = pick(req.body, FIELD_EDITABLE);
    // A new field goes to the END of its group with a REAL order number. Letting
    // it default to 0 puts it above the system fields AND breaks the settings
    // page's reorder arrows, which work by swapping neighbours' order values —
    // swapping 0 with 0 moves nothing.
    if (data.order == null) {
      const last = await ShipmentOrderField.findOne({ group: data.group || 'general', deleted: { $ne: true } })
        .sort({ order: -1 }).select('order').lean();
      data.order = ((last && last.order) || 0) + 1;
    }
    // Unique key derived from the label — the value's address in customFields.
    let key = slugify(req.body.labelEn || req.body.labelAr);
    let n = 1;
    // eslint-disable-next-line no-await-in-loop
    while (await ShipmentOrderField.exists({ key })) { n += 1; key = `${slugify(req.body.labelEn || req.body.labelAr)}_${n}`; }
    const field = await ShipmentOrderField.create({ ...data, key, isSystem: false });
    emit('shipmentOrders:fields', {});
    res.status(201).json({ field });
  } catch (error) {
    res.status(500).json({ message: 'Failed to create the field' });
  }
};

exports.updateField = async (req, res) => {
  try {
    const field = await ShipmentOrderField.findById(req.params.id);
    if (!field) return res.status(404).json({ message: 'Field not found' });
    const data = pick(req.body, FIELD_EDITABLE);
    // A system field's group is part of the wiring; its look and words are not.
    if (field.isSystem) delete data.group;
    Object.assign(field, data);
    await field.save();
    emit('shipmentOrders:fields', {});
    res.json({ field });
  } catch (error) {
    res.status(500).json({ message: 'Failed to update the field' });
  }
};

// The only questions that CANNOT be deleted: other logic reads their answers.
// fromCity/toCity/sellPrice drive the per-customer route pricing and the
// بوليصة sheet; pickupTime dates the بوليصة. Everything else — system-seeded or
// user-added — is the section owner's to remove.
const CORE_FIELD_KEYS = new Set(['fromCity', 'toCity', 'sellPrice', 'pickupTime']);

exports.deleteField = async (req, res) => {
  try {
    const field = await ShipmentOrderField.findById(req.params.id);
    if (!field) return res.status(404).json({ message: 'Field not found' });
    if (CORE_FIELD_KEYS.has(field.key)) {
      return res.status(400).json({ message: 'This field feeds pricing/waybill logic — hide it instead of deleting it' });
    }
    if (field.isSystem) {
      // Tombstone, not delete: the boot seed re-creates missing system keys, so
      // a hard delete would come back on the next restart.
      field.deleted = true;
      field.active = false;
      await field.save();
    } else {
      await field.deleteOne();
    }
    emit('shipmentOrders:fields', {});
    res.json({ message: 'Field deleted' });
  } catch (error) {
    res.status(500).json({ message: 'Failed to delete the field' });
  }
};

// ── Seed ────────────────────────────────────────────────────────────────────
// Idempotent: inserts what is missing, never overwrites an edit.

const CITIES = [
  'الرياض', 'جدة', 'الدمام', 'مكة المكرمة', 'المدينة المنورة', 'الخبر', 'الجبيل',
  'ينبع', 'الطائف', 'جازان', 'أبها', 'خميس مشيط', 'نجران', 'تبوك', 'حائل',
  'بريدة', 'الأحساء', 'رابغ', 'عرعر', 'القصيم',
];
const opts = (arr) => arr.map((a) => ({ key: a, ar: a, en: a }));

const SYSTEM_FIELDS = [
  // الاستلام والتسليم
  { key: 'fromCity', labelAr: 'من المدينة', labelEn: 'From city', group: 'pickup_delivery', inputType: 'select', options: opts(CITIES), required: true, order: 1 },
  { key: 'toCity', labelAr: 'إلى المدينة', labelEn: 'To city', group: 'pickup_delivery', inputType: 'select', options: opts(CITIES), required: true, order: 2 },
  // تفاصيل الشحنة
  { key: 'truckType', labelAr: 'نوع الشاحنة', labelEn: 'Truck type', group: 'shipment', inputType: 'cards', options: opts(['سطحة', 'تريلا جوانب', 'تريلا ستارة', 'براد', 'دينا', 'لوبد', 'صهريج']), required: true, order: 1 },
  { key: 'cargoType', labelAr: 'نوع الحمولة', labelEn: 'Cargo type', group: 'shipment', inputType: 'select', options: opts(['بضائع عامة', 'مواد بناء', 'حديد', 'أسمنت', 'مواد غذائية', 'أجهزة ومعدات', 'أثاث', 'كيماويات', 'أخرى']), order: 2 },
  { key: 'truckLength', labelAr: 'طول الشاحنة', labelEn: 'Truck length', group: 'shipment', inputType: 'number', order: 3 },
  { key: 'quantity', labelAr: 'الكمية', labelEn: 'Quantity', group: 'shipment', inputType: 'number', order: 4 },
  { key: 'driverName', labelAr: 'السائق', labelEn: 'Driver', group: 'shipment', inputType: 'text', order: 5 },
  { key: 'driverPhone', labelAr: 'جوال السائق', labelEn: 'Driver phone', group: 'shipment', inputType: 'text', order: 6 },
  { key: 'vehicleName', labelAr: 'السيارة / رقم اللوحة', labelEn: 'Vehicle / plate', group: 'shipment', inputType: 'text', order: 7 },
  // الأسعار والتوقيت
  { key: 'pickupTime', labelAr: 'وقت الاستلام', labelEn: 'Pickup time', group: 'pricing_time', inputType: 'datetime', required: true, order: 1 },
  { key: 'startTime', labelAr: 'وقت البداية', labelEn: 'Start time', group: 'pricing_time', inputType: 'datetime', order: 2 },
  { key: 'arrivalTime', labelAr: 'وقت الوصول', labelEn: 'Arrival time', group: 'pricing_time', inputType: 'datetime', order: 3 },
  { key: 'sellPrice', labelAr: 'سعر البيع', labelEn: 'Sell price', group: 'pricing_time', inputType: 'number', required: true, order: 4 },
  { key: 'buyPrice', labelAr: 'سعر الشراء', labelEn: 'Buy price', group: 'pricing_time', inputType: 'number', order: 5 },
  // المدفوعات
  { key: 'driverRentType', labelAr: 'نوع تأجير السائق', labelEn: 'Driver rent type', group: 'payment', inputType: 'cards', options: opts(['راجعة', 'ذهاب فقط', 'ذهاب وعودة']), order: 1 },
  { key: 'paymentMethod', labelAr: 'طريقة الدفع', labelEn: 'Payment method', group: 'payment', inputType: 'cards', options: opts(['آجل', 'نقدي', 'تحويل بنكي']), order: 2 },
  { key: 'driverRentPrice', labelAr: 'سعر تأجير السائق', labelEn: 'Driver rent price', group: 'payment', inputType: 'number', order: 3 },
  { key: 'branch', labelAr: 'الفرع', labelEn: 'Branch', group: 'payment', inputType: 'select', options: opts(['جدة', 'الرياض', 'الدمام', 'جازان']), order: 4 },
];

exports.ensureShipmentOrderDefaults = async () => {
  // Dropped by request — the addresses added typing, not information. Removing
  // them from the seed alone would leave the old rows; removing the rows alone
  // would let the seed resurrect them. Both, idempotently.
  await ShipmentOrderField.deleteMany({ key: { $in: ['addressFrom', 'addressTo'] } });

  for (const f of SYSTEM_FIELDS) {
    // eslint-disable-next-line no-await-in-loop
    const exists = await ShipmentOrderField.exists({ key: f.key });
    if (!exists) await ShipmentOrderField.create({ ...f, isSystem: true });
  }
  // Our own fleet: the Location Solutions trucks ARE our trucks, so they show
  // in the vehicle picker as أسطولنا from day one instead of being retyped.
  // Read-only from Ls2Vehicle; idempotent by plate; never overwrites an edit —
  // the trial section stays independent of ops, but our own fleet is ours.
  try {
    const Ls2Vehicle = require('../models/Ls2Vehicle');
    const live = await Ls2Vehicle.find({}).select('plate name driver').lean();
    for (const v of live) {
      const plate = String(v.plate || '').trim() || String(v.name || '').trim();
      if (!plate) continue;
      // eslint-disable-next-line no-await-in-loop
      const exists = await ShipmentOrderVehicle.findOne({ plate });
      if (!exists) {
        // eslint-disable-next-line no-await-in-loop
        await ShipmentOrderVehicle.create({
          plate,
          name: '',
          truckType: 'سطحة', // the LS2 fleet is flatbed heavy trucks
          supplier: null,     // ours
          defaultDriverName: String(v.driver || '').trim(),
          notes: 'من لوكيشن سوليوشن',
        });
      }
    }
  } catch (e) {
    // The trucks are convenience, not a dependency — a missing ls2 model or a
    // slow read must never block boot.
    console.error('[shipment-orders] LS2 fleet seed skipped:', e.message);
  }

  // Two trial customers, so the section demos end-to-end on first open.
  if (await ShipmentOrderCustomer.countDocuments({}) === 0) {
    await ShipmentOrderCustomer.create([
      {
        name: 'مصنع اليمامة لانتاج ابراج الطاقة الكهربائية',
        routes: [{ fromCity: 'جدة', toCity: 'الرياض', price: 1100 }],
        defaults: { truckType: 'سطحة', cargoType: 'بضائع عامة', paymentMethod: 'آجل', driverRentType: 'راجعة', branch: 'جدة' },
        notes: 'عميل تجريبي — من أمثلة نظام التشغيل',
      },
      {
        name: 'شركة البحر الأحمر للتنمية',
        routes: [{ fromCity: 'جدة', toCity: 'ينبع', price: 900 }],
        defaults: { truckType: 'تريلا جوانب', cargoType: 'مواد بناء', paymentMethod: 'آجل', driverRentType: 'ذهاب فقط', branch: 'جدة' },
        notes: 'عميل تجريبي',
      },
    ]);
  }
};
