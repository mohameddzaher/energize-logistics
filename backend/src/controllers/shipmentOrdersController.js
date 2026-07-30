const ShipmentOrder = require('../models/ShipmentOrder');
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
exports.patchStatus = async (req, res) => {
  try {
    const { status } = req.body;
    const order = await ShipmentOrder.findById(req.params.id);
    if (!order) return res.status(404).json({ message: 'Shipment order not found' });
    order.status = status;
    await order.save(); // save() so the enum validates the value
    emit('shipmentOrders:updated', { id: String(order._id) });
    // Tell whoever created the order its status moved — unless they moved it.
    if (order.createdBy && String(order.createdBy) !== String(req.user._id)) {
      try {
        await createNotification({
          recipient: order.createdBy,
          type: 'status_changed',
          title: 'تغيّرت حالة الطلب',
          message: `بوليصة ${order.waybillNumber} — ${order.status}`,
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

// ── Suppliers & vehicles (الموردون والمركبات) ───────────────────────────────

const SUPPLIER_EDITABLE = ['name', 'type', 'phone', 'email', 'notes', 'isActive'];
const VEHICLE_EDITABLE = ['plate', 'name', 'truckType', 'supplier', 'defaultDriverName', 'defaultDriverPhone', 'notes', 'isActive'];

exports.listSuppliers = async (req, res) => {
  try {
    const suppliers = await ShipmentOrderSupplier.find({ isActive: { $ne: false } }).sort({ name: 1 }).limit(500).lean();
    // How many trucks each one runs — the number the team actually asks for.
    const counts = await ShipmentOrderVehicle.aggregate([
      { $match: { isActive: { $ne: false }, supplier: { $ne: null } } },
      { $group: { _id: '$supplier', n: { $sum: 1 } } },
    ]);
    const byId = {};
    counts.forEach((c) => { byId[String(c._id)] = c.n; });
    res.json({ suppliers: suppliers.map((s) => ({ ...s, vehicleCount: byId[String(s._id)] || 0 })) });
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
    const vehicles = await ShipmentOrderVehicle.find({ isActive: { $ne: false } })
      .populate('supplier', 'name type')
      .sort({ plate: 1 })
      .limit(1000)
      .lean();
    res.json({ vehicles });
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
