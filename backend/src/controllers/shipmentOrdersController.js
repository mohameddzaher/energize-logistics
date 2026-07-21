const ShipmentOrder = require('../models/ShipmentOrder');
const ShipmentOrderCustomer = require('../models/ShipmentOrderCustomer');
const ShipmentOrderField = require('../models/ShipmentOrderField');
const { emitToAll } = require('../websocket/socketManager');
const logAudit = require('../utils/auditLogger');

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
  'customer', 'driverName', 'driverPhone', 'vehicleName',
  'pickupTime', 'startTime', 'arrivalTime', 'sellPrice', 'buyPrice',
  'driverRentType', 'paymentMethod', 'driverRentPrice', 'branch',
  'status', 'notes', 'customFields',
];

const CUSTOMER_EDITABLE = ['name', 'phone', 'email', 'notes', 'routes', 'defaults', 'isActive'];

// ── Orders ──────────────────────────────────────────────────────────────────

exports.listOrders = async (req, res) => {
  try {
    const { q, status, customer, from, to, page = 1, limit = 25 } = req.query;
    const filter = {};
    if (status) filter.status = status;
    if (customer) filter.customer = customer;
    if (from || to) {
      filter.createdAt = {};
      if (from) filter.createdAt.$gte = new Date(`${from}T00:00:00`);
      if (to) filter.createdAt.$lte = new Date(`${to}T23:59:59`);
    }
    if (q && q.trim()) {
      const r = rx(q);
      const or = [
        { customerName: r }, { driverName: r }, { fromCity: r }, { toCity: r },
        { vehicleName: r }, { agentName: r }, { notes: r },
      ];
      // A run of digits is almost always a waybill lookup — match it exactly,
      // not as a substring of prices.
      const n = Number(String(q).trim());
      if (Number.isFinite(n)) or.push({ waybillNumber: n });
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
    res.json({
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

    // Inline new customer: { newCustomer: { name, phone } }.
    if (!data.customer && req.body.newCustomer && String(req.body.newCustomer.name || '').trim()) {
      const c = await ShipmentOrderCustomer.create({
        name: String(req.body.newCustomer.name).trim(),
        phone: String(req.body.newCustomer.phone || '').trim(),
        createdBy: req.user._id,
      });
      data.customer = c._id;
      emit('shipmentOrders:customers', {});
    }

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

exports.updateOrder = async (req, res) => {
  try {
    const order = await ShipmentOrder.findById(req.params.id);
    if (!order) return res.status(404).json({ message: 'Shipment order not found' });

    const data = pick(req.body, ORDER_EDITABLE);
    if (data.customer && String(data.customer) !== String(order.customer)) {
      const c = await ShipmentOrderCustomer.findById(data.customer).select('name').lean();
      if (c) data.customerName = c.name;
    }
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
exports.patchStatus = async (req, res) => {
  try {
    const { status } = req.body;
    const order = await ShipmentOrder.findById(req.params.id);
    if (!order) return res.status(404).json({ message: 'Shipment order not found' });
    order.status = status;
    await order.save(); // save() so the enum validates the value
    emit('shipmentOrders:updated', { id: String(order._id) });
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

exports.listCustomers = async (req, res) => {
  try {
    const { q } = req.query;
    const filter = { isActive: { $ne: false } };
    if (q && q.trim()) filter.$or = [{ name: rx(q) }, { phone: rx(q) }];
    const customers = await ShipmentOrderCustomer.find(filter).sort({ name: 1 }).limit(500).lean();
    res.json({ customers });
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

// ── Form fields (the settings page) ─────────────────────────────────────────

exports.listFields = async (req, res) => {
  try {
    // ?all=1 → the settings page (inactive rows included); default → the form.
    const filter = req.query.all ? {} : { active: true };
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

exports.deleteField = async (req, res) => {
  try {
    const field = await ShipmentOrderField.findById(req.params.id);
    if (!field) return res.status(404).json({ message: 'Field not found' });
    if (field.isSystem) {
      // Deleting sellPrice would not remove a question — it would break the
      // pricing logic. Hide it instead.
      return res.status(400).json({ message: 'System fields can be hidden (active=off) but not deleted' });
    }
    await field.deleteOne();
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
  { key: 'addressFrom', labelAr: 'العنوان من', labelEn: 'Address from', group: 'pickup_delivery', inputType: 'text', order: 3 },
  { key: 'addressTo', labelAr: 'العنوان إلى', labelEn: 'Address to', group: 'pickup_delivery', inputType: 'text', order: 4 },
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
  for (const f of SYSTEM_FIELDS) {
    // eslint-disable-next-line no-await-in-loop
    const exists = await ShipmentOrderField.exists({ key: f.key });
    if (!exists) await ShipmentOrderField.create({ ...f, isSystem: true });
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
