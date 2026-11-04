const mongoose = require('mongoose');
const ShipmentOrder = require('../models/ShipmentOrder');
const { sendMongooseError, stripEmpty } = require('../utils/mongooseError');
const { textIn, mergeOptions, normKey } = require('../utils/colFilter');
const { startOfDay, endOfDay } = require('../utils/companyDay');
const ShipmentOrderCustomer = require('../models/ShipmentOrderCustomer');
const ShipmentOrderField = require('../models/ShipmentOrderField');
const ShipmentOrderSupplier = require('../models/ShipmentOrderSupplier');
const ShipmentOrderVehicle = require('../models/ShipmentOrderVehicle');
const ShipmentOrderDriver = require('../models/ShipmentOrderDriver');
const { emitToAll } = require('../websocket/socketManager');
const logAudit = require('../utils/auditLogger');
const { createNotification } = require('../services/notificationService');
const { statusVocabulary, isValidStatus } = require('../utils/shipmentOrderStatuses');
const { saveUploadFile } = require('../utils/fileStore');
const cache = require('../utils/ttlCache');
const { flexSpaceRegex } = require('../utils/plateKey');
const { isSubtype } = require('../utils/paymentType');
const { termsOfSubtype, paymentSubtypeOptions } = require('../utils/shipmentOrderPayment');

// The trial section for creating shipments natively, instead of on the external
// UPL platform. Fully self-contained: nothing here reads or writes anything the
// Operations Platform mirror owns.

const emit = (event, payload = {}) => { try { emitToAll(event, payload); } catch (e) {} };

/**
 * A shipment changed: clear the cache, then notify screens.
 * Otherwise the number lags by exactly one change. The dashboard and analytics are built behind `wrapStale` with 60 seconds, and the write fired `shipmentOrders:updated` without touching the cache: the screen heard the event and re-requested at once, reading what was built before the write. So the order is part of the fix: clear before announcing, not after.
 */
// Link the shipment to the customs transaction after saving; does not delay or fail the response (services/customsOpsLink.afterShipmentSaved).
const linkCustomsSoon = (id) => {
  if (!id) return;
  setImmediate(() => {
    require('../services/customsOpsLink').afterShipmentSaved(id)
      .catch((e) => console.error('[shipment-orders] customs link:', e.message));
  });
};

const announceOrderChange = (id) => {
  cache.clear('so:dashboard:');
  cache.clear('so:analytics:');
  emit('shipmentOrders:updated', id ? { id: String(id) } : {});
  if (id) require('../services/shipmentOrderWorkflowLink').mirrorSoon(id);
};

const pick = (body, fields) => {
  const out = {};
  fields.forEach((f) => { if (body[f] !== undefined) out[f] = body[f]; });
  return out;
};

const rx = (s) => new RegExp(String(s).trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');

const fullName = (u) => (u ? `${u.firstName || ''} ${u.lastName || ''}`.trim() : '');

// Who edits money after a shipment is created.
// Selling price, buying price, advance and driver fare are written at creation by whoever creates the shipment, then only system managers and the operations manager change them. Another role is a one-line addition here; the web and phone screens read the same list from /api/shipment-orders/money-editors.
const MONEY_FIELDS = ['sellPrice', 'buyPrice', 'advanceAmount', 'driverRentPrice'];
const MONEY_EDIT_ROLES = ['super_admin', 'admin', 'operations_manager'];
const canEditMoney = (user) => !!user && MONEY_EDIT_ROLES.includes(user.role);
const { sellingByRequest } = require('../config/sellingPriceRequests');
// The data team writes the purchase price directly; its selling-price edits go to approval.
const moneyEditable = (user) => (canEditMoney(user) ? MONEY_FIELDS : sellingByRequest(user) ? ['buyPrice'] : []);
const moneyByRequest = (user) => (!canEditMoney(user) && sellingByRequest(user) ? ['sellPrice'] : []);
exports.MONEY_FIELDS = MONEY_FIELDS;
exports.MONEY_EDIT_ROLES = MONEY_EDIT_ROLES;

const ORDER_EDITABLE = [
  'fromCity', 'toCity', 'addressFrom', 'addressTo',
  'truckType', 'cargoType', 'truckLength', 'quantity',
  'customer', 'driverName', 'driverPhone', 'vehicleName', 'vehicle',
  'pickupTime', 'startTime', 'arrivalTime', 'sellPrice', 'buyPrice',
  'paymentSubtype', 'driverRentType', 'paymentMethod', 'driverRentPrice', 'branch',
  'status', 'notes', 'customFields',
  // Waybill, container (linked to customs) and advance.
  'blNumber', 'containerNumber', 'advanceAmount',
];

/**
 * Payment type on an incoming order: validated, and the payment method is written from it.
 * One of the four types or empty; anything else is rejected with 400, not saved silently, since an unknown type leaves nobody knowing whether it is collected on credit or cash. When a type is set, `paymentMethod` is written from it even if the form sent another: the waybill reads it to print the freight price for cash, so the contradiction is not left. See utils/shipmentOrderPayment.
 */
function applyPaymentSubtype(data) {
  if (data.paymentSubtype === undefined) return;
  const v = String(data.paymentSubtype == null ? '' : data.paymentSubtype).trim();
  if (v && !isSubtype(v)) {
    const err = new Error(`نوعُ دفعٍ غير معروف: ${v}`);
    err.status = 400;
    throw err;
  }
  data.paymentSubtype = v;
  if (v) data.paymentMethod = termsOfSubtype(v);
}

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

/**
 * Inline fresh truck (and its supplier when that is new too): the fleet register learns from the work. Shared by create and update.
 * A registered plate is not registered twice. The register holds ~13k trucks, so a plate typed in the free field is more likely existing than new, and the full list is not shown. Creating a new row silently gave two rows for one plate, each with its own driver and shipment history. So the typed plate is looked up first by plate key; if found, the existing row is used and attributed to the supplier if its owner was unknown, and nothing is created.
 */
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
  const plate = String(nv.plate).trim();
  const existing = await ShipmentOrderVehicle
    .findOne({ plate: flexSpaceRegex(plate) })
    .select('_id supplier ownership').lean();
  if (existing) {
    // A supplier's truck whose owner is now known: record the knowledge, do not copy the truck.
    if (supplierId && !existing.supplier && existing.ownership !== 'ours') {
      await ShipmentOrderVehicle.updateOne(
        { _id: existing._id }, { $set: { supplier: supplierId, ownership: 'supplier' } },
      );
      emit('shipmentOrders:fleet', {});
    }
    data.vehicle = existing._id;
    return;
  }
  const veh = await ShipmentOrderVehicle.create({
    plate,
    name: String(nv.name || '').trim(),
    truckType: data.truckType || '',
    supplier: supplierId,
    ownership: supplierId ? 'supplier' : 'unknown',
    defaultDriverName: data.driverName || '',
    defaultDriverPhone: data.driverPhone || '',
    createdBy: req.user._id,
  });
  // A truck with no supplier whose plate is in our register belongs to our fleet and is linked to it.
  if (!supplierId) await syncVehicleMaster(veh._id);
  data.vehicle = veh._id;
  emit('shipmentOrders:fleet', {});
}

/**
 * The denormalized snapshot an order carries of its truck: display label, supplier, and the truck's regular driver as a fallback. Must be refreshed whenever `vehicle` changes or the list/PDF keep printing the old plate.
 * The register learns from the work: thousands of imported trucks have no known owner. Whoever books the load knows the owner, so when he picks the supplier and then an unknown-owner truck the knowledge is written once.
 * It never overwrites known ownership: a truck with a registered supplier stays with it, and one from our fleet is not attributed to a supplier.
 */
/**
 * The supplier agreed with, not the truck's owner.
 * The screen separates them: the supplier is a party to the deal chosen with the customer, while the truck owner is a fact read from its record. They really differ (a supplier carrying our load on another's truck).
 * So the chosen supplier is returned if valid, and the truck owner is a fallback when none was chosen. The order used to always take the truck owner, overwriting the choice of whoever booked, so the shipment was saved to a supplier nobody agreed with and billed for what he did not carry.
 */
async function resolveSupplierChoice(req) {
  const chosen = req && req.body ? String(req.body.supplierChoice || '') : '';
  if (!/^[0-9a-f]{24}$/i.test(chosen)) return null;
  const sup = await ShipmentOrderSupplier.findById(chosen).select('_id').lean();
  return sup ? sup._id : null;
}

async function applyVehicleSnapshot(data, req) {
  const chosenId = await resolveSupplierChoice(req);
  // Written even when the truck is unknown: the supplier is agreed before naming a truck, and the function used to return here, saving the order without the chosen supplier.
  if (chosenId) data.supplier = chosenId;
  if (!data.vehicle) return applySupplierName(data);
  const veh = await ShipmentOrderVehicle.findById(data.vehicle).lean();
  if (!veh) return applySupplierName(data);
  data.vehicleName = [veh.plate, veh.name].filter(Boolean).join(' — ');
  // The plate goes in its own field.
  // It used to be written only inside `vehicleName`, leaving the plate field empty for every order made from our screen (only platform orders filled it). So our shipments fell out of the truck-column filter, the waybill could not find make and colour (looked up by plate in the truck register), and plate-based reports did not match.
  data.vehiclePlate = veh.plate || '';
  // The truck owner is a fallback when no choice was made, not a replacement for it.
  if (!chosenId) data.supplier = veh.supplier || null;
  // The register learns an unknown owner.
  // Thousands of registered trucks have no owner and whoever books the load knows it, so it is written. A known owner is never overwritten: agreeing with a supplier on another's truck does not change its ownership in the register.
  if (chosenId && !veh.supplier && veh.ownership !== 'ours') {
    await ShipmentOrderVehicle.updateOne(
      { _id: veh._id }, { $set: { supplier: chosenId, ownership: 'supplier' } },
    );
    emit('shipmentOrders:fleet', {});
  }
  if (!data.driverName && veh.defaultDriverName) data.driverName = veh.defaultDriverName;
  if (!data.driverPhone && veh.defaultDriverPhone) data.driverPhone = veh.defaultDriverPhone;
  await applySupplierName(data);
}

/** The supplier's name beside its id: the workflow's owner column and the transport order read the name, and it used to stay empty. */
async function applySupplierName(data) {
  if (!data.supplier) return;
  const sup = await ShipmentOrderSupplier.findById(data.supplier).select('name').lean();
  if (sup?.name) data.supplierName = sup.name;
}

/**
 * Waybills for several orders in one file: POST { ids: [...] }.
 * Bulk download used to render each waybill in the browser, freezing the screen once per statement. It is now one call returning one file, see renderWaybillsPdf.
 */
exports.getWaybillsPdf = async (req, res) => {
  try {
    const ids = Array.isArray(req.body?.ids) ? req.body.ids.filter(Boolean) : [];
    if (!ids.length) return res.status(400).json({ message: 'اختر طلبًا واحدًا على الأقلّ' });
    if (ids.length > 100) return res.status(400).json({ message: 'الحدُّ الأقصى مئةُ أمر نقل في المرّة' });

    const { renderWaybillsPdf, rowFromOrder } = require('../utils/waybillPdf');
    const ShipmentOrder = require('../models/ShipmentOrder');
    const orders = await ShipmentOrder.find({ _id: { $in: ids } }).lean();
    if (!orders.length) return res.status(404).json({ message: 'لا طلبات' });

    const order = new Map(ids.map((id, i) => [String(id), i]));
    orders.sort((a, b) => (order.get(String(a._id)) ?? 0) - (order.get(String(b._id)) ?? 0));

    // The waybill is filled from the registers, not only the order snapshot.
    // The order holds a snapshot of plate and driver name, and the make, colour, residency number and nationality fields printed empty on every sheet leaving with a driver, though gates verify those. The data exists in the truck register and the driver register, so it is read from them in two calls, not one per waybill.
    const plateKeyOf = (v) => require('../utils/plateKey').registryPlateKey(v);
    const plates = [...new Set(orders.map((o) => plateKeyOf(o.vehiclePlate)).filter(Boolean))];
    const refs = orders.map((o) => o.vehicle).filter(Boolean);
    const names = [...new Set(orders.map((o) => String(o.driverName || '').trim()).filter(Boolean))];
    const [vehRows, drvRows] = await Promise.all([
      // Trucks are requested by key, not by pulling the whole register: that read ~13.5k rows to filter three, on a sheet printed daily with a register that grows weekly. See `plateKey` in models/ShipmentOrderVehicle.
      plates.length || refs.length
        ? ShipmentOrderVehicle.find({ $or: [{ plateKey: { $in: plates } }, { _id: { $in: refs } }] })
          .select('_id plate plateKey brand color truckType vehicleMaster supplier').populate('vehicleMaster', VEHICLE_MASTER_FIELDS).lean()
          .then((rows) => rows.map(vehicleView))
        : [],
      names.length
        ? ShipmentOrderDriver.find({ name: { $in: names } }).select('name residenceNumber nationality phone employee')
          .populate('employee', EMPLOYEE_FIELDS).lean()
          // Matched by the name written on the order and printed from the file, so the original name stays the key.
          .then((rows) => rows.map((d) => ({ ...driverView(d), name: d.name })))
        : [],
    ]);
    // A plate can be registered twice; the row that holds the details wins.
    const vehById = new Map(vehRows.map((v) => [String(v._id), v]));
    const vehByPlate = new Map();
    for (const v of vehRows) {
      const k = v.plateKey || plateKeyOf(v.plate);
      const had = vehByPlate.get(k);
      vehByPlate.set(k, { ...v, brand: v.brand || had?.brand || '', color: v.color || had?.color || '', truckType: v.truckType || had?.truckType || '' });
    }
    const drvByName = new Map(drvRows.map((d) => [d.name.trim(), d]));
    // Supplier agreed with and the truck's owner, by id, so a renamed supplier prints its current name.
    const supIds = [...new Set([...orders.map((o) => o.supplier), ...vehRows.map((v) => v.supplier)].filter(Boolean).map(String))];
    const supName = new Map((supIds.length ? await ShipmentOrderSupplier.find({ _id: { $in: supIds } }).select('name').lean() : [])
      .map((s) => [String(s._id), s.name || '']));
    // The representative printed on the order is whoever created the shipment.
    const creators = new Map((await require('../models/User').find({ _id: { $in: orders.map((o) => o.createdBy).filter(Boolean) } })
      .select('firstName lastName').lean()).map((u) => [String(u._id), `${u.firstName || ''} ${u.lastName || ''}`.trim()]));

    const pdf = await renderWaybillsPdf(orders.map((o) => {
      const row = rowFromOrder(o);
      row.agentName = creators.get(String(o.createdBy)) || '';
      // The chosen truck's live record, so an edit on the suppliers page prints here.
      const own = o.vehicle ? vehById.get(String(o.vehicle)) : null;
      const v = own || vehByPlate.get(plateKeyOf(o.vehiclePlate));
      const twin = vehByPlate.get(plateKeyOf(own?.plate || o.vehiclePlate));
      row.supplierName = (o.supplier && supName.get(String(o.supplier))) || o.supplierName || '';
      const owner = v?.supplier ? supName.get(String(v.supplier)) || '' : '';
      if (owner && owner !== row.supplierName) row.ownerName = owner;
      if (v) {
        row.plateNumber = v.plate || row.plateNumber;
        row.carBrand = v.brand || twin?.brand || '';
        row.carColor = v.color || twin?.color || '';
        row.carType = v.truckType || row.carType || twin?.truckType || '';
      }
      const d = drvByName.get(String(o.driverName || '').trim());
      if (d) { row.driverIqama = d.residenceNumber || ''; row.driverNationality = d.nationality || ''; row.driverPhone = row.driverPhone || d.phone || ''; }
      return row;
    }));
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="waybills-${orders.length}.pdf"`);
    res.send(pdf);
  } catch (error) {
    res.status(500).json({ message: 'تعذّر إصدارُ أوامر النقل', error: error.message });
  }
};

/**
 * Excel-style column filter.
 * The table is paginated on the server (25 rows per page), so a value list built from arriving rows would show only that page's values; values are computed on the server with counts, and filtering happens there too.
 * Each column is computed after the filters of the other columns, not all: otherwise selectable values would produce an empty table.
 */
const ORDER_COLUMNS = {
  customerName: 'customerName',
  fromCity: 'fromCity',
  toCity: 'toCity',
  driverName: 'driverName',
  vehiclePlate: 'vehicleName',
  truckType: 'truckType',
  branch: 'branch',
  supplierName: 'supplierName',
  plate: 'vehiclePlate',
  truckLength: 'truckLength',
  containerNumber: 'containerNumber',
  paymentSubtype: 'paymentSubtype',
  agentName: 'agentName',
  driverRentType: 'driverRentType',
  paymentMethod: 'paymentMethod',
  // The rest of the table columns, with Excel-style filters
  reference: 'reference',
  status: 'status',
  notes: 'notes',
  salesRepName: 'salesRepName',
  cargoType: 'cargoType',
  blNumber: 'blNumber',
  containerNumber: 'containerNumber',
  pickupDay: 'pickupTime',     // A day, not an instant; see COLUMN_KIND
  buyPrice: 'buyPrice',
  sellPrice: 'sellPrice',
};
// Non-text columns: a date groups by its Riyadh day, a number by its value.
const COLUMN_KIND = { pickupDay: 'day', buyPrice: 'number', sellPrice: 'number' };
const RIYADH = 'Asia/Riyadh';

/** `col.<key>=a,b` becomes `{ field: { $in: [...] } }`. An empty value is requested with `__blank__`. */
const columnFilters = (query, skipKey = null) => {
  const out = {};
  for (const [key, field] of Object.entries(ORDER_COLUMNS)) {
    if (key === skipKey) continue;
    // `col_` not `col.`: the express-mongo-sanitize middleware drops any key containing a dot, so column filters never reached the server. The old form is still accepted for scripts.
    const raw = query[`col_${key}`] ?? query[`col.${key}`];
    if (!raw) continue;
    // Values arrive as repeated parameters (array). The comma-separated string is a legacy format still accepted for saved links; it is the one that cut names containing a comma.
    const vals = Array.isArray(raw) ? raw.map(String)
      : (String(raw).includes('\u0000') ? String(raw).split('\u0000') : String(raw).split(','));
    const list = vals.filter((v) => normKey(v) !== '');
    if (!list.length) continue;
    const kind = COLUMN_KIND[key];
    if (kind) {
      const blank = list.includes('__blank__');
      const or = [];
      if (kind === 'day') {
        for (const d of list.filter((v) => /^\d{4}-\d{2}-\d{2}$/.test(v))) {
          or.push({ [field]: { $gte: new Date(`${d}T00:00:00+03:00`), $lte: new Date(`${d}T23:59:59.999+03:00`) } });
        }
      } else {
        const nums = list.map(Number).filter((n) => Number.isFinite(n));
        if (nums.length) or.push({ [field]: { $in: nums } });
      }
      if (blank) or.push({ [field]: null });
      if (or.length) out.$and = [...(out.$and || []), { $or: or }];
      continue;
    }
    // A value is matched by a pattern tolerant of whitespace, and the blank label matches only empty, so what the list counts is what the selection returns. See utils/colFilter.
    const c = textIn(field, list.map((v) => (v === '__blank__' ? '' : v)));
    if (c) out[field] = c[field];
  }
  return out;
};

/**
 * The branches this user may see on the Shipments page, as a query, or null.
 * Read from the database each time: the auth cache is per worker and a change on
 * the permissions page must apply at once.
 */
async function branchScope(req) {
  const { SHIPMENT_BRANCH_ROLES } = require('../config/shipmentBranchRoles');
  if (!SHIPMENT_BRANCH_ROLES.includes(req.user?.role)) return null;
  const u = await require('../models/User').findById(req.user._id).select('shipmentBranches').lean();
  if (!u?.shipmentBranches?.length) return null;
  // Every branch open means no limit, so shipments without a branch show too.
  const all = await companyBranchOptions();
  if (all.every((b) => u.shipmentBranches.includes(b.key))) return null;
  return { branch: { $in: u.shipmentBranches } };
}

/** Marks each listed shipment's truck owner as company, freelancer or our fleet. */
async function attachOwnerKind(orders) {
  const ids = [...new Set(orders.map((o) => o.supplier && String(o.supplier._id || o.supplier)).filter(Boolean))];
  const names = [...new Set(orders.map((o) => String(o.supplierName || '').trim()).filter(Boolean))];
  const rows = ids.length || names.length
    ? await ShipmentOrderSupplier.find({ $or: [{ _id: { $in: ids } }, { name: { $in: names } }] }).select('name type').lean() : [];
  const byId = new Map(rows.map((r) => [String(r._id), r]));
  const byName = new Map(rows.map((r) => [String(r.name).trim(), r]));
  for (const o of orders) {
    const hit = (o.supplier && byId.get(String(o.supplier._id || o.supplier))) || byName.get(String(o.supplierName || '').trim());
    if (hit) { o.ownerKind = hit.type || 'company'; if (!o.supplierName) o.supplierName = hit.name; }
  }
  const noOwner = orders.filter((o) => !o.ownerKind && o.vehicle).map((o) => o.vehicle);
  if (!noOwner.length) return;
  const ours = new Set((await ShipmentOrderVehicle.find({ _id: { $in: noOwner }, ownership: 'ours' }).select('_id').lean()).map((v) => String(v._id)));
  for (const o of orders) if (!o.ownerKind && o.vehicle && ours.has(String(o.vehicle))) o.ownerKind = 'ours';
}

exports.listOrders = async (req, res) => {
  try {
    const { q, status, customer, supplier, source, branch, from, to, page = 1, limit = 25 } = req.query;
    const filter = { ...columnFilters(req.query) };
    // Status can be more than one.
    // The cards above the table accumulate: show overdue and in-transit together. So it arrives comma-separated.
    const byActivity = req.query.dateBy === 'activity' && (from || to);
    const range = {};
    if (from) range.$gte = startOfDay(from);
    if (to) range.$lte = endOfDay(to);
    const statusKeys = String(status || '').split(',').map((x) => x.trim()).filter(Boolean);
    // Kept in $and so the status cards obey it too; they ignore filter.status.
    if (req.query.excludeCancelled === '1') filter.$and = [...(filter.$and || []), { status: { $ne: 'cancelled' } }];
    if (!byActivity) {
      if (statusKeys.length === 1) [filter.status] = statusKeys;
      else if (statusKeys.length > 1) filter.status = { $in: statusKeys };
    }
    // A customer matches by reference or by name: only 3 of ~37k orders carry a reference, the rest came from the operations platform with a name snapshot (`customerName`), so reference-only returned zero rows.
    // The name matches folded (`flexSpaceRegex`); same for the supplier, whose snapshots vary more.
    // The id is guarded: a non-ObjectId threw `CastError` and returned 500 for bad input.
    const refOrName = async (Model, id, nameField) => {
      if (!mongoose.Types.ObjectId.isValid(String(id))) return null;
      const row = await Model.findById(id).select('name').lean();
      const or = [{ [nameField === 'customerName' ? 'customer' : 'supplier']: id }];
      if (row?.name) or.push({ [nameField]: flexSpaceRegex(row.name) });
      return { $or: or };
    };
    if (customer) {
      const cond = await refOrName(ShipmentOrderCustomer, customer, 'customerName');
      if (cond) filter.$and = [...(filter.$and || []), cond];
      else return res.status(400).json({ message: 'مُعرّفُ عميلٍ غيرُ صالح' });
    }
    if (supplier) {
      const cond = await refOrName(ShipmentOrderSupplier, supplier, 'supplierName');
      if (cond) filter.$and = [...(filter.$and || []), cond];
      else return res.status(400).json({ message: 'مُعرّفُ مورّدٍ غيرُ صالح' });
    }
    if (branch) filter.branch = branch;
    // Where the shipment came from.
    // Platform shipments carry a real settlement statement number that is billed; ours (trial for now) carry a number with a letter prefix. The split is not by order: a report reader must know whether it covers real work or a trial.
    if (source === 'system' || source === 'platform') filter.source = source;
    // Trip note: show what has a note; it prints on the waybill so it gets reviewed.
    // Linked to a customs transaction: the dashboard card opens it here in the same section.
    if (req.query.customs === 'linked') filter['customsLink.clearance'] = { $type: 'objectId' };
    const note = String(req.query.note || '').trim();
    if (note === 'yes') filter.notes = { $nin: ['', null] };
    else if (note === 'no') filter.$or = [{ notes: '' }, { notes: null }, { notes: { $exists: false } }];
    // «Today» asks what happened today, so it reads the status log: a shipment created
    // or moved in the period, and a status card counts moves into that status.
    if (byActivity) {
      filter.$and = [...(filter.$and || []), { $or: [{ createdAt: range }, { statusLog: { $elemMatch: { at: range } } }] }];
      if (statusKeys.length) {
        filter.$and.push({ $or: [
          { statusLog: { $elemMatch: { to: { $in: statusKeys }, at: range } } },
          { createdAt: range, status: { $in: statusKeys }, statusLog: { $not: { $elemMatch: { at: range } } } },
        ] });
      }
    } else if (from || to) {
      // The range is by receiving day, like the dashboard and analytics.
      // It used to be by registration day (`createdAt`) while the dashboard used the receiving day, so this month gave two numbers for one thing. For platform shipments the registration day is the day sync brought it, not its own day. `dateBy=created` keeps the old behaviour for those who ask.
      const dk = req.query.dateBy === 'created' ? 'createdAt' : 'pickupTime';
      filter[dk] = {};
      if (from) filter[dk].$gte = startOfDay(from);
      if (to) filter[dk].$lte = endOfDay(to);
    }
    if (q && q.trim()) {
      // Search by anything belonging to the shipment and its parties.
      // Names fold (variant spellings of the same letters), phones match by their last nine digits however written, and a long number is translated through the registers to its owners: a driver's residency number to his name and phone, a truck chassis to its plate, a customer phone to the customer, so their shipments match (utils/relatedPeopleSearch).
      const { arabicSearchRegex, westernDigits } = require('../utils/arabicSearch');
      const term = westernDigits(String(q).trim());
      const r = arabicSearchRegex(term);
      // The text fields are answered by the Atlas Search index (config/orderSearch) as an id list; when it cannot answer, the regex over the same fields is kept.
      const textIds = await require('../config/orderSearch').ids(ShipmentOrder, term);
      const or = textIds ? [{ _id: { $in: textIds } }] : [
        { customerName: r }, { driverName: r }, { driverPhone: r }, { fromCity: r }, { toCity: r },
        // The plate in its own field as well as in the vehicle name, so either finds it.
        { vehicleName: r }, { vehiclePlate: r }, { supplierName: r }, { agentName: r }, { notes: r },
        { truckType: r }, { branch: r }, { reference: r },
        { salesRepName: r }, { cargoType: r }, { addressFrom: r }, { addressTo: r }, { cancelReason: r },
        { externalRef: r }, { 'statusLog.note': r }, { 'statusLog.byName': r },
      ];
      // A run of digits is almost always a waybill lookup: match it exactly, not as a substring of prices. The settlement statement number is also searched, as it is the number the team knows for platform shipments.
      const n = Number(term);
      if (Number.isFinite(n)) { or.push({ waybillNumber: n }); or.push({ graduationNumber: n }); }
      const bare = term.replace(/\D/g, '');
      if (/^[\d\s+()\-]+$/.test(term) && bare.length >= 6) {
        const tail = bare.slice(-9);
        or.push({ driverPhone: new RegExp(`${tail}$`) });
        const { relatedClauses } = require('../utils/relatedPeopleSearch');
        or.push(...await relatedClauses(bare, { name: ['driverName'], phone: ['driverPhone'], plate: ['vehiclePlate', 'vehicleName'] }));
        // The customer's phone is in his record, not on the shipment.
        const custIds = await ShipmentOrderCustomer.find({ phone: new RegExp(`${tail}$`) }).select('_id').limit(20).lean().catch(() => []);
        if (custIds.length) or.push({ customer: { $in: custIds.map((c) => c._id) } });
      }
      // In `$and`, not directly `$or`: the no-note filter also writes `$or`, and search used to erase it.
      filter.$and = [...(filter.$and || []), { $or: or }];
    }

    // Beside, not over, any branch the user filtered by.
    const scope = await branchScope(req);
    if (scope) filter.$and = [...(filter.$and || []), scope];
    const statusFreeFilter = { ...filter };
    delete statusFreeFilter.status;
    // In activity mode the status condition sits in $and; the cards count without it.
    if (byActivity && statusKeys.length) statusFreeFilter.$and = filter.$and.filter((c) => !c.$or?.[0]?.statusLog?.$elemMatch?.to);

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
      // Header numbers respect the same filter as the table: a filtered list with unfiltered totals reads as a bug.
      // Card counts are under the other filters, not under status: someone who pressed overdue wants to see how many are in transit in the same period to add them, and counting under the chosen status would zero every other card.
      ShipmentOrder.aggregate(byActivity ? [
        { $match: statusFreeFilter },
        { $project: { status: 1, createdAt: 1, moves: { $filter: { input: { $ifNull: ['$statusLog', []] }, as: 'l', cond: { $and: [
          ...(range.$gte ? [{ $gte: ['$$l.at', range.$gte] }] : []), ...(range.$lte ? [{ $lte: ['$$l.at', range.$lte] }] : []),
        ] } } } } },
        { $project: { keys: { $cond: [{ $gt: [{ $size: '$moves' }, 0] }, { $setUnion: ['$moves.to', []] }, ['$status']] } } },
        { $unwind: '$keys' },
        { $group: { _id: '$keys', n: { $sum: 1 } } },
      ] : [{ $match: statusFreeFilter }, { $group: { _id: '$status', n: { $sum: 1 } } }]),
      ShipmentOrder.aggregate([{ $match: filter }, {
        $group: { _id: null, sell: { $sum: '$sellPrice' }, buy: { $sum: '$buyPrice' } },
      }]),
    ]);

    await attachOwnerKind(orders);
    // A search that finds nothing because of the branch limit says so.
    let otherBranches = [];
    if (scope && !total && q && q.trim()) {
      const open = { ...filter, $and: (filter.$and || []).filter((c) => c !== scope) };
      otherBranches = (await ShipmentOrder.distinct('branch', open)).filter(Boolean).slice(0, 5);
    }

    const byStatus = {};
    statusAgg.forEach((r) => { byStatus[r._id] = r.n; });

    // Each source's count is under the other filters, not its own: someone on ours wants to know how many the platform has in the same period and status, not the total.
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
      otherBranches,
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
/**
 * One column's values with counts, for the filter list.
 * One column per call, not all: the list opens by clicking a specific column's funnel, and computing all ten on every open is ten aggregations nobody reads. `q` narrows the list itself when it has hundreds of values.
 */
exports.orderFilterOptions = async (req, res) => {
  try {
    const key = String(req.query.field || '');
    const field = ORDER_COLUMNS[key];
    if (!field) return res.status(400).json({ message: 'عمودٌ غير معروف' });

    // Only the other columns' filters, so what is displayed can be selected.
    const base = { ...columnFilters(req.query, key) };
    const scope = await branchScope(req);
    if (scope) base.$and = [...(base.$and || []), scope];
    if (req.query.excludeCancelled === '1') base.$and = [...(base.$and || []), { status: { $ne: 'cancelled' } }];
    if (req.query.status) {
      const keys = String(req.query.status).split(',').map((x) => x.trim()).filter(Boolean);
      if (keys.length === 1) [base.status] = keys; else if (keys.length) base.status = { $in: keys };
    }
    if (req.query.from || req.query.to) {
      if (req.query.dateBy === 'activity') {
        const span = { ...(req.query.from ? { $gte: startOfDay(req.query.from) } : {}), ...(req.query.to ? { $lte: endOfDay(req.query.to) } : {}) };
        base.$and = [...(base.$and || []), { $or: [{ createdAt: span }, { statusLog: { $elemMatch: { at: span } } }] }];
      } else {
        const dk = req.query.dateBy === 'created' ? 'createdAt' : 'pickupTime';
        base[dk] = {};
        if (req.query.from) base[dk].$gte = startOfDay(req.query.from);
        if (req.query.to) base[dk].$lte = endOfDay(req.query.to);
      }
    }
    if (req.query.source === 'system' || req.query.source === 'platform') base.source = req.query.source;
    // The customer matches as in the table: by reference or folded name.
    if (req.query.customer && mongoose.Types.ObjectId.isValid(String(req.query.customer))) {
      const c = await ShipmentOrderCustomer.findById(req.query.customer).select('name').lean();
      const or = [{ customer: req.query.customer }];
      if (c?.name) or.push({ customerName: flexSpaceRegex(c.name) });
      base.$and = [...(base.$and || []), { $or: or }];
    }
    if (req.query.branch) base.branch = req.query.branch;

    // The list search is named `search`, not `q`: `q` is the table's own search, and using one name would let each filter the other. It matches the name used in the collections section's counterpart.
    const search = String(req.query.search || '').trim();
    const kind = COLUMN_KIND[key];
    const groupKey = kind === 'day'
      ? { $ifNull: [{ $dateToString: { format: '%Y-%m-%d', date: `$${field}`, timezone: RIYADH } }, ''] }
      : { $ifNull: [`$${field}`, ''] };
    const pipeline = [
      { $match: base },
      { $group: { _id: groupKey, count: { $sum: 1 } } },
    ];
    if (search) pipeline.push(kind === 'number' ? { $match: { $expr: { $regexMatch: { input: { $toString: '$_id' }, regex: search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') } } } } : { $match: { _id: flexSpaceRegex(search) } });
    // Dates newest first and numbers ascending as in Excel; text by frequency.
    pipeline.push(kind === 'day' ? { $sort: { _id: -1 } } : kind === 'number' ? { $sort: { _id: 1 } } : { $sort: { count: -1 } }, { $limit: 400 });

    const rows = await ShipmentOrder.aggregate(pipeline);
    // Values differing only by blanks are one row, and blank alone is the empty label.
    const values = (kind ? rows.map((r) => ({ value: r._id === '' || r._id == null ? '' : String(r._id), count: r.count }))
      : mergeOptions(rows.map((r) => ({ value: r._id, count: r.count }))).sort((a, b) => b.count - a.count))
      .map((o) => ({ value: o.value === '' ? '__blank__' : o.value, count: o.count }));
    res.json({ field: key, values });
  } catch (error) {
    res.status(500).json({ message: 'تعذّر تحميل قيم العمود' });
  }
};

/**
 * Waybill details typed on the shipment form go to their registers, so the suppliers
 * page and every waybill read the same values. A driver linked to HR keeps HR's data.
 */
async function saveWaybillDetails(order, details) {
  if (!details || typeof details !== 'object') return;
  const clean = (v) => String(v ?? '').trim();
  const brand = clean(details.vehicleBrand); const color = clean(details.vehicleColor);
  const nationality = clean(details.driverNationality); const residenceNumber = clean(details.driverIqama);
  if (order.vehicle && (brand || color)) {
    await ShipmentOrderVehicle.updateOne({ _id: order.vehicle }, { $set: { ...(brand ? { brand } : {}), ...(color ? { color } : {}) } });
  }
  const name = clean(order.driverName);
  if (name && (nationality || residenceNumber)) {
    const set = { ...(nationality ? { nationality } : {}), ...(residenceNumber ? { residenceNumber } : {}) };
    await ShipmentOrderDriver.updateOne({ name, employee: null }, { $set: set });
  }
  cache.clear('so:registry:');
}

/**
 * Records the route on the customer. Two people booking the same customer at once
 * collide on the document version, so it re-reads and retries; a price that still
 * misses is not worth failing a shipment for.
 */
async function learnRoute(customerId, route) {
  const { applyRoute } = require('../utils/customerRoutes');
  for (let attempt = 0; attempt < 6; attempt += 1) {
    try {
      const fresh = await ShipmentOrderCustomer.findById(customerId);
      if (!fresh || applyRoute(fresh, route) === 'skipped') return;
      await fresh.save();
      return;
    } catch (e) {
      if (e.name !== 'VersionError') throw e;
    }
  }
  console.warn('[shipment-orders] route not recorded, busy customer:', String(customerId));
}

/**
 * Create one order: the body of the work, called by the screen and by multi-create.
 * A function, not only a route handler: one load sometimes leaves on five trucks, with the same customer, route, price and date but a different supplier, truck and driver. Copying the creation logic into multi-create would give two ways to make an order that diverge at the first edit (route price recorded in one, truck snapshot taken in one). So the body is single and called repeatedly.
 */
async function createOneOrder(req, body) {
  const inner = { ...req, body };
  const data = pick(body, ORDER_EDITABLE);
  applyPaymentSubtype(data);
  const branchError = await require('../utils/branchList').applyBranchList(data);
  if (branchError) { const e = new Error(branchError); e.status = 400; throw e; }

  await resolveInlineCustomer(inner, data);

  if (data.customer) {
    const c = await ShipmentOrderCustomer.findById(data.customer);
    if (c) {
      data.customerName = c.name;
        // The file learns the latest price, not only the new route.
        // It used to add a route if unknown and leave it if known, so a price agreed today on an old route never reached the file and the suggestion stayed the customer's first-ever shipment price. The wanted value is always the last one used. See utils/customerRoutes; cities match folded so a variant spelling does not become a second route.
      await learnRoute(c._id, {
        fromCity: data.fromCity,
        toCity: data.toCity,
        price: data.sellPrice,
        at: data.pickupTime || new Date(),
        source: 'order',
      });
    }
  }

  // The truck: one of ours, a known supplier's, or typed in fresh. A fresh
  // plate registers the vehicle (and its supplier when that is new too) as a
  // side effect — the fleet register learns from the work, like the customer
  // price list does.
  await resolveInlineVehicle(inner, data);
  await applyVehicleSnapshot(data, inner);

  // Status is checked against the live vocabulary: the one in code plus what the section added.
  if (data.status && !(await isValidStatus(data.status))) {
    const err = new Error(`حالةٌ غير معروفة: ${data.status}`);
    err.status = 400;
    throw err;
  }

  await applySalesRep(data, body);
  data.agentName = fullName(req.user); // The sales rep (Arabic label): stamped, never typed
  data.createdBy = req.user._id;

  const order = await ShipmentOrder.create(data);
  await saveWaybillDetails(order, body.waybillDetails);
  announceOrderChange(order._id);
  linkCustomsSoon(order._id);

  await logAudit({
    user: req.user, action: 'create', entity: 'ShipmentOrder', entityId: order._id,
    changes: { waybillNumber: order.waybillNumber, customerName: order.customerName },
    ipAddress: req.ip,
  });

  return order;
}

/** Operational sales: eligible are the sales and operations teams (their managers and staff). Anyone whose service HR ended is not selectable. The name is taken from the account, not from what was sent. */
const SALES_REP_ROLES = () => {
  const { rolesOfSection } = require('../config/roles');
  return [...rolesOfSection('Sales'), ...rolesOfSection('Operations')];
};
async function salesRepOptions() {
  const User = require('../models/User');
  const { endedStaff, userEnded } = require('../utils/endedStaff');
  const [users, ended] = await Promise.all([
    User.find({ role: { $in: SALES_REP_ROLES() }, isActive: { $ne: false } }).select('firstName lastName role').lean(),
    endedStaff(),
  ]);
  const { LABELS_AR } = require('../config/roles');
  return users.filter((u) => !userEnded(ended, u))
    .map((u) => ({ value: String(u._id), label: fullName(u), role: u.role, roleAr: LABELS_AR[u.role] || u.role }))
    .sort((a, b) => a.label.localeCompare(b.label, 'ar'));
}
async function applySalesRep(data, body) {
  if (body.salesRep === undefined) return;
  if (!body.salesRep) { data.salesRep = null; data.salesRepName = ''; return; }
  const User = require('../models/User');
  const u = mongoose.isValidObjectId(body.salesRep)
    ? await User.findOne({ _id: body.salesRep, role: { $in: SALES_REP_ROLES() } }).select('firstName lastName').lean() : null;
  if (!u) { const e = new Error('السيلز التشغيلي يُختار من فريق المبيعات أو العمليات'); e.status = 400; throw e; }
  data.salesRep = u._id; data.salesRepName = fullName(u);
}
exports.salesReps = async (req, res) => {
  try { res.json({ options: await salesRepOptions() }); }
  catch (e) { res.status(500).json({ message: 'تعذّر تحميل القائمة' }); }
};

exports.createOrder = async (req, res) => {
  try {
    const order = await createOneOrder(req, req.body);
    res.status(201).json({ order });
  } catch (error) {
    if (error.status === 400) return res.status(400).json({ message: error.message });
    console.error('Error creating shipment order:', error);
    return sendMongooseError(res, error, 'Failed to create the shipment order');
  }
};

/**
 * One load on several trucks.
 * POST /orders/batch  { ...order, trucks: [ { supplier|newSupplier, vehicle|newVehicle, driverName, driverPhone }, ... ] }
 * Shared: customer, route, price, date, payment. Each truck is a fully independent order (own waybill number from the same counter, snapshot, status, follow-up); no parent link.
 * Created sequentially because the counter is sequential and parallelism yields duplicate numbers; earlier successes are kept on a later failure and the response says which failed and why.
 */
exports.createOrdersBatch = async (req, res) => {
  try {
    const trucks = Array.isArray(req.body?.trucks) ? req.body.trucks : [];
    if (!trucks.length) return res.status(400).json({ message: 'لا شاحناتٍ في الطلب' });
    if (trucks.length > 25) return res.status(400).json({ message: 'الحدُّ الأقصى خمسٌ وعشرون شاحنةً في المرّة' });

    // Shared fields: everything in the body except what belongs to the truck and its driver.
    // A B/L and a container belong to one truck, so they are per truck too.
    const TRUCK_FIELDS = ['vehicle', 'newVehicle', 'supplier', 'supplierChoice', 'driverName', 'driverPhone', 'blNumber', 'containerNumber', 'waybillDetails'];
    const shared = { ...req.body };
    delete shared.trucks;
    TRUCK_FIELDS.forEach((f) => delete shared[f]);

    const created = [];
    const failed = [];
    for (const [i, truck] of trucks.entries()) {
      const body = { ...shared };
      TRUCK_FIELDS.forEach((f) => { if (truck[f] !== undefined) body[f] = truck[f]; });
      try {
        // eslint-disable-next-line no-await-in-loop
        const order = await createOneOrder(req, body);
        created.push(order);
      } catch (e) {
        failed.push({ index: i, plate: truck.plateLabel || truck.newVehicle?.plate || '', message: e.message || 'تعذّر الإنشاء' });
      }
    }

    if (!created.length) {
      return res.status(400).json({ message: failed[0]?.message || 'لم تُنشأ أيُّ شحنة', failed });
    }
    return res.status(201).json({
      orders: created,
      waybills: created.map((o) => o.waybillNumber),
      created: created.length,
      failed,
    });
  } catch (error) {
    console.error('Error creating shipment batch:', error);
    return sendMongooseError(res, error, 'Failed to create the shipment orders');
  }
};

// One order by id — the edit form's loader. Finding it by paging through the
// list capped at 1000 silently blanked the form for older orders.
/**
 * Fetch an order by id, for the edit form.
 * Truck and supplier arrive fully named. The form's two lists are not fully loaded (~13k trucks, thousands of suppliers) but searched on the server. With bare ids the displayed list would not know them, so the editor would see two empty fields and an unnamed selected truck, and saving would clear them. So they are sent named and the form seeds them into its lists.
 */
exports.getOrder = async (req, res) => {
  try {
    const order = await ShipmentOrder.findById(req.params.id)
      .populate('customer', 'name phone')
      .populate('vehicle', 'plate name brand color truckType supplier ownership defaultDriverName defaultDriverPhone')
      .populate('supplier', 'name type phone')
      .lean();
    if (!order) return res.status(404).json({ message: 'Shipment order not found' });
    res.json({ order });
  } catch (error) {
    res.status(500).json({ message: 'Failed to load the shipment order' });
  }
};

/** Who edits money after saving; read by the create/edit screens (web and phone). */
exports.moneyEditors = (req, res) => res.json({
  fields: MONEY_FIELDS,
  roles: MONEY_EDIT_ROLES,
  canEdit: canEditMoney(req.user),
  // Per field: written directly after save, or sent for approval.
  editable: moneyEditable(req.user),
  byRequest: moneyByRequest(req.user),
});

/**
 * The selling-price write on a shipment, for an approved change request; the same
 * save, audit and announce as updateOrder. The link to the workflow row is the caller's.
 */
exports.writeSellPrice = async (order, value, user, { ip, note } = {}) => {
  const before = Number(order.sellPrice) || 0;
  order.sellPrice = value;
  await order.save();
  await logAudit({
    user, action: 'update_shipment_order', entity: 'ShipmentOrder', entityId: order._id, ipAddress: ip,
    changes: { before: { sellPrice: before }, after: { sellPrice: value, ...(note ? { note } : {}) } },
  });
  announceOrderChange(order._id);
  return { status: 200, body: { order } };
};

exports.updateOrder = async (req, res) => {
  try {
    const order = await ShipmentOrder.findById(req.params.id);
    if (!order) return res.status(404).json({ message: 'Shipment order not found' });

    const data = pick(req.body, ORDER_EDITABLE);

    // Money after creation: MONEY_EDIT_ROLES write all of it; the data team writes the purchase price and requests the selling price.
    // The form sends all its fields, so only what really changed counts: a value equal to the stored one (or empty equal to empty) passes.
    let requestedSell;
    if (!canEditMoney(req.user)) {
      const num = (v) => (v === '' || v === null || v === undefined ? null : Number(v));
      const editable = moneyEditable(req.user);
      const byRequest = moneyByRequest(req.user);
      const changed = MONEY_FIELDS.filter((f) => f in data && num(data[f]) !== num(order[f]));
      const locked = changed.filter((f) => !editable.includes(f) && !byRequest.includes(f));
      if (locked.length) {
        return res.status(403).json({
          message: 'أسعارُ الشحنة (البيع والشراء والسلفة وأجرة السائق) لا يعدّلها بعد الحفظ إلّا مديرُ النظام والإدارة ومديرُ التشغيل',
          code: 'MONEY_LOCKED', fields: locked,
        });
      }
      if (changed.includes('sellPrice') && byRequest.includes('sellPrice')) requestedSell = data.sellPrice;
      for (const f of MONEY_FIELDS) if (!editable.includes(f)) delete data[f];
    }
    try { applyPaymentSubtype(data); } catch (e) { return res.status(400).json({ message: e.message }); }
    const branchError = await require('../utils/branchList').applyBranchList(data, order);
    if (branchError) return res.status(400).json({ message: branchError });

    // An edit can introduce a first-time customer or a fresh truck exactly like
    // the create form — the same inline registration applies.
    try { await applySalesRep(data, req.body); } catch (e) { return res.status(400).json({ message: e.message }); }
    await resolveInlineCustomer(req, data);
    if (data.customer && String(data.customer) !== String(order.customer)) {
      const c = await ShipmentOrderCustomer.findById(data.customer).select('name').lean();
      if (c) data.customerName = c.name;
    }

    await resolveInlineVehicle(req, data);
    // Truck swapped: refresh the denormalized plate/supplier snapshot, or the list, the Excel export and the waybill keep printing the old truck.
    if (data.vehicle && String(data.vehicle) !== String(order.vehicle)) {
      await applyVehicleSnapshot(data, req);
    } else {
      // Changing only the supplier is a valid edit by itself: it is now chosen with the customer, not the truck, so swapping a truck is not required to save it.
      const chosenId = await resolveSupplierChoice(req);
      if (chosenId) data.supplier = chosenId;
      await applySupplierName(data);
    }

    if (data.status && !(await isValidStatus(data.status))) {
      return res.status(400).json({ message: `حالةٌ غير معروفة: ${data.status}` });
    }

    // Answers of since-deleted custom fields must survive an unrelated edit —
    // the form only sends the currently-configured fields, so merge, don't replace.
    if (data.customFields) data.customFields = { ...(order.customFields || {}), ...data.customFields };

    // Checked before saving so a bad price saves nothing.
    if (requestedSell !== undefined) {
      const v = requestedSell === '' || requestedSell === null ? 0 : Number(requestedSell);
      if (!Number.isFinite(v) || v < 0) return res.status(400).json({ code: 'BAD_SELLING_VALUE', fields: ['sellPrice'], message: 'سعر البيع يجب أن يكون رقمًا لا يقلّ عن صفر.' });
    }

    Object.assign(order, data);
    await order.save();
    await saveWaybillDetails(order, req.body.waybillDetails);
    let sellingRequest = null;
    if (requestedSell !== undefined) {
      const r = await require('../services/sellingPriceRequests')
        .createRequest({ order: order.toObject(), origin: 'shipment_order', raw: requestedSell, user: req.user });
      if (r.request) sellingRequest = r.request;
    }
    announceOrderChange(order._id);
    linkCustomsSoon(order._id);

    // The operations workflow row for this shipment follows at once: it is one shipment read on two screens, so it must not show two statuses. See syncShipmentsById.
    require('../services/shipmentOrderWorkflowLink').mirrorPlatformSoon(order._id, Object.keys(data));
    if (order.source === 'platform' && order.externalId && require('../services/uplClient').isConfigured()) {
      setImmediate(() => {
        require('../services/opsWorkflowSyncService')
          .syncShipmentsById([String(order.externalId)])
          .catch((e) => console.error('[shipment-orders] mirror after status:', e.message));
      });
    }
    if (sellingRequest) {
      return res.json({ order, sellingRequest, sellingRequestMessage: require('../services/sellingPriceRequests').PENDING_MESSAGE });
    }
    res.json({ order });
  } catch (error) {
    return sendMongooseError(res, error, 'Failed to update the shipment order');
  }
};

// The one-click lifecycle change from the list: the point is not having to open an order to say it arrived.
// Section analytics: the model is brokerage (buy at one price, sell at another), so the first question is who earned what: best customer, cheapest supplier, highest-margin route.
// Fleet management analytics do not fit: there the truck is ours and the question is its target.

/**
 * The analytics calculation is a single body.
 * Called by the analytics screen and the section dashboard (browser and phone). Copying it would give two monthly profit numbers that diverge at the first change to what cancelled means or to supplier-name folding, and nobody trusts two numbers.
 */
async function analyticsOf(query = {}) {
  {
    const { from, to, customer, supplier, status, branch, q, source } = query;
    const match = {};
    if (from || to) {
      match.pickupTime = {};
      if (from) match.pickupTime.$gte = startOfDay(from);
      // An open To means until now, not until the midnight of today, otherwise today's shipments vanish from a report requested from the start of the month.
      match.pickupTime.$lte = to ? endOfDay(to) : new Date();
    }
    if (customer) match.customer = new mongoose.Types.ObjectId(String(customer));
    if (supplier) match.supplier = new mongoose.Types.ObjectId(String(supplier));
    if (status) match.status = status;
    if (branch) match.branch = branch;
    // Ours or the platform: a report about work done differs from one about a trial.
    if (source === 'system' || source === 'platform') match.source = source;
    if (q && String(q).trim()) {
      const r = rx(q);
      match.$or = [{ customerName: r }, { supplierName: r }, { fromCity: r }, { toCity: r },
        { driverName: r }, { truckType: r }, { branch: r }, { reference: r }];
    }

    // Computed in the database, not in Node.
    // After moving ~33k shipments a full read took two minutes. The cost was transfer, not computation: ~34k rows crossing the network to be aggregated here. Aggregation runs where the data lives, returning one row per group.
    // Cancelled shipments are excluded from money and counted separately: they were not executed or billed, but the cancellation rate is a managed number.
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
      // A wider cap before folding: a row cut at 200 may be half of another row, which would be cut and then folded, losing half. Cut after folding, not before.
      { $limit: 600 },
    ]);

    const r2 = (v) => Math.round((Number(v) || 0) * 100) / 100;

    // One name is one row.
    // Two spellings of the same company name were one supplier read as two (4145 shipments in one row and 1797 in another, with the real size visible in neither). Common Arabic spelling differences are folded before grouping and the most frequent spelling is displayed.
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
        // The displayed name is the most frequent spelling, not whichever came first by chance.
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

    // Cancellation reasons and the operational sales ranking
    const [cancelAgg, salesAgg] = await Promise.all([
      ShipmentOrder.aggregate([
        { $match: { ...match, status: CANCELLED } },
        { $group: { _id: { $ifNull: ['$cancelReason', ''] }, n: { $sum: 1 } } },
        { $sort: { n: -1 } },
      ]),
      ShipmentOrder.aggregate([
        { $match: { ...match, salesRepName: { $nin: ['', null] } } },
        { $group: {
          _id: '$salesRepName',
          shipments: { $sum: 1 },
          live: { $sum: liveOf },
          sell: { $sum: sellOf },
          buy: { $sum: buyOf },
        } },
        { $sort: { live: -1, shipments: -1 } },
      ]),
    ]);

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
            // No margin is computed without a price: the count is reported so profit is not read as understated.
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
        // A shipment sold below its purchase is not a number in an average: its waybill is named so it can be asked about.
        ShipmentOrder.aggregate([
          { $match: { ...match, status: { $ne: CANCELLED }, sellPrice: { $gt: 0 } } },
          { $addFields: { margin: { $subtract: [{ $ifNull: ['$sellPrice', 0] }, { $ifNull: ['$buyPrice', 0] }] } } },
          { $match: { margin: { $lt: 0 } } },
          { $sort: { margin: 1 } },
          { $limit: 50 },
          { $project: { waybillNumber: 1, reference: 1, customerName: 1, supplierName: 1, fromCity: 1, toCity: 1, status: 1, sellPrice: 1, buyPrice: 1, margin: 1, pickupTime: 1 } },
        ]),
      ]);

    // Group lists are cut at 200 for display, so their length is not a count: 200 routes would be the screen limit read as a number. Only distinct ones are counted.
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

    return {
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
        // Count the folded name, not the raw one, or a supplier written two ways would count twice.
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
      // Cancelled with reasons; no reason means cancelled before a reason was required.
      cancelReasons: cancelAgg.map((x) => ({ reason: x._id || 'بلا سبب مسجّل', count: x.n, pct: (T.orders - T.live) ? r2((x.n / (T.orders - T.live)) * 100) : 0 })),
      // Operational sales ranked by executed shipments, with cancelled ones and their rate.
      salesRanking: salesAgg.map((x, i) => ({
        rank: i + 1, name: x._id, shipments: x.shipments, live: x.live, cancelled: x.shipments - x.live,
        cancelRate: x.shipments ? r2(((x.shipments - x.live) / x.shipments) * 100) : 0,
        sell: r2(x.sell), margin: r2(x.sell - x.buy),
      })),
      losing: losingRows.map((o) => ({ ...o, margin: r2(o.margin) })),
    };
  }
}

/**
 * Section analytics: GET /api/shipment-orders/analytics
 * The dashboard was cached but this called the same heavy `analyticsOf` (~37k shipments) with no cache, 0.9 to 2.4 s, alternating with two workers' separate memories.
 * Now cached under `wrapStale` with the dashboard's query keys: the last build is served at once and refreshed in the background.
 */
exports.getAnalytics = async (req, res) => {
  try {
    const key = `so:analytics:${JSON.stringify(req.query || {})}`;
    res.json(await cache.wrapStale(key, 60 * 1000, 10 * 60 * 1000, async () => analyticsOf(req.query)));
  } catch (error) {
    console.error('shipmentOrders analytics error:', error);
    res.status(500).json({ message: error.message || 'Failed to load analytics' });
  }
};

/**
 * Section dashboard: GET /api/shipment-orders/dashboard
 * The section's first page answers how it is doing: today, the month, shipment states, profit, the register to download from, latest records.
 * One call, not four, so phone and browser read the same response and no number differs between screens. The calculation is the analytics one (`analyticsOf`).
 */
// Dashboard period.
// Read for a period the viewer picks (today, 7 days, month, 30 days, year), with every number compared against the previous period of the same length, so the rise or fall is read, not only the value. Days are Riyadh days.
const DASH_PERIODS = ['today', '7d', 'month', '30d', 'year'];
function dashRange(period) {
  const { todayKey } = require('../utils/companyDay');
  const today = todayKey();
  const d = (ymd, n) => { const x = new Date(`${ymd}T12:00:00Z`); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };
  const span = (a, b) => Math.round((new Date(`${b}T12:00:00Z`) - new Date(`${a}T12:00:00Z`)) / 86400000) + 1;
  let from = today;
  let to = today;
  if (period === '7d') from = d(today, -6);
  else if (period === '30d') from = d(today, -29);
  else if (period === 'month') {
    // This month means the whole month: a shipment dated at the end of the month belongs to it, as on the shipments page.
    from = `${today.slice(0, 7)}-01`;
    const [y, m] = today.split('-').map(Number);
    to = new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
  } else if (period === 'year') { from = `${today.slice(0, 4)}-01-01`; to = `${today.slice(0, 4)}-12-31`; }
  const n = span(from, to);
  // The previous period has the same length; the month is compared with the same days of last month.
  const prevTo = d(from, -1);
  const prevFrom = d(prevTo, -(n - 1));
  return { from, to, prevFrom, prevTo, days: n };
}

/** Light totals for a period, for comparison only (no need for the detail of analyticsOf). */
async function dashTotals(from, to) {
  const match = { pickupTime: { $gte: startOfDay(from), $lte: endOfDay(to) } };
  const live = { $ne: [{ $ifNull: ['$status', ''] }, 'cancelled'] };
  const [r] = await ShipmentOrder.aggregate([
    { $match: match },
    { $group: {
      _id: null, orders: { $sum: 1 }, live: { $sum: { $cond: [live, 1, 0] } },
      sell: { $sum: { $cond: [live, { $ifNull: ['$sellPrice', 0] }, 0] } },
      buy: { $sum: { $cond: [live, { $ifNull: ['$buyPrice', 0] }, 0] } },
    } },
  ]);
  const t = r || { orders: 0, live: 0, sell: 0, buy: 0 };
  const r2 = (v) => Math.round((Number(v) || 0) * 100) / 100;
  return { orders: t.orders, live: t.live, cancelled: t.orders - t.live, sell: r2(t.sell), buy: r2(t.buy), margin: r2(t.sell - t.buy) };
}

/** What ties the dashboard to the rest of the company in the period: day by day, advances, customs, follow-up. */
async function dashExtras(from, to) {
  const range = { $gte: startOfDay(from), $lte: endOfDay(to) };
  const match = { pickupTime: range };
  const live = { $ne: [{ $ifNull: ['$status', ''] }, 'cancelled'] };
  const r2 = (v) => Math.round((Number(v) || 0) * 100) / 100;
  const [byDay, sums, followUps, lateNow, driversExpired] = await Promise.all([
    ShipmentOrder.aggregate([
      { $match: match },
      { $group: {
        _id: { $dateToString: { format: '%Y-%m-%d', date: '$pickupTime', timezone: 'Asia/Riyadh' } },
        orders: { $sum: 1 }, live: { $sum: { $cond: [live, 1, 0] } },
        sell: { $sum: { $cond: [live, { $ifNull: ['$sellPrice', 0] }, 0] } },
        buy: { $sum: { $cond: [live, { $ifNull: ['$buyPrice', 0] }, 0] } },
      } },
      { $sort: { _id: 1 } },
    ]),
    ShipmentOrder.aggregate([
      { $match: match },
      { $group: {
        _id: null,
        advances: { $sum: { $cond: [live, { $ifNull: ['$advanceAmount', 0] }, 0] } },
        withAdvance: { $sum: { $cond: [{ $and: [live, { $gt: [{ $ifNull: ['$advanceAmount', 0] }, 0] }] }, 1, 0] } },
        customsLinked: { $sum: { $cond: [{ $eq: [{ $type: '$customsLink.clearance' }, 'objectId'] }, 1, 0] } },
        platform: { $sum: { $cond: [{ $eq: ['$source', 'platform'] }, 1, 0] } },
        ours: { $sum: { $cond: [{ $ne: ['$source', 'platform'] }, 1, 0] } },
        noSalesRep: { $sum: { $cond: [{ $and: [live, { $in: [{ $ifNull: ['$salesRepName', ''] }, ['']] }] }, 1, 0] } },
      } },
    ]),
    // Follow-up notes written in the period (from log entries that carry a note).
    ShipmentOrder.aggregate([
      { $match: { statusLog: { $elemMatch: { at: range, note: { $nin: ['', null] } } } } },
      { $project: { n: { $size: { $filter: { input: '$statusLog', as: 'l', cond: { $and: [
        { $gte: ['$$l.at', range.$gte] }, { $lte: ['$$l.at', range.$lte] }, { $gt: [{ $strLenCP: { $ifNull: ['$$l.note', ''] } }, 0] },
      ] } } } } } },
      { $group: { _id: null, notes: { $sum: '$n' }, shipments: { $sum: 1 } } },
    ]),
    // And currently overdue: an existing state, not a period.
    ShipmentOrder.countDocuments({ status: 'late' }),
    ShipmentOrderDriver.countDocuments({ isActive: { $ne: false }, driverCardExpiry: { $regex: /^\d{4}-\d{2}-\d{2}/, $lt: require('../utils/companyDay').todayKey() } }),
  ]);
  const S = sums[0] || {};
  const F = followUps[0] || {};
  return {
    byDay: byDay.map((x) => ({ day: x._id, orders: x.orders, live: x.live, cancelled: x.orders - x.live, sell: r2(x.sell), buy: r2(x.buy), margin: r2(x.sell - x.buy) })),
    advances: r2(S.advances), withAdvance: S.withAdvance || 0,
    customsLinked: S.customsLinked || 0,
    platform: S.platform || 0, ours: S.ours || 0,
    noSalesRep: S.noSalesRep || 0,
    followUpNotes: F.notes || 0, followUpShipments: F.shipments || 0,
    lateNow, driversExpired,
  };
}

/**
 * Deeper analytics for the dashboard period, in one aggregation.
 * Money is counted on live (non-cancelled) shipments only.
 */
async function dashInsights(from, to) {
  const match = { pickupTime: { $gte: startOfDay(from), $lte: endOfDay(to) } };
  const live = { $ne: [{ $ifNull: ['$status', ''] }, 'cancelled'] };
  const sell = { $ifNull: ['$sellPrice', 0] };
  const buy = { $ifNull: ['$buyPrice', 0] };
  const r2 = (v) => Math.round((Number(v) || 0) * 100) / 100;
  const groupBy = (key, limit) => [
    { $match: { $expr: live } },
    { $group: { _id: { $ifNull: [key, ''] }, orders: { $sum: 1 }, sell: { $sum: sell }, margin: { $sum: { $subtract: [sell, buy] } } } },
    { $sort: { orders: -1 } },
    ...(limit ? [{ $limit: limit }] : []),
  ];
  const [f] = await ShipmentOrder.aggregate([
    { $match: match },
    { $facet: {
      // Margin as a share of the selling price, per shipment that has a price.
      marginBuckets: [
        { $match: { $expr: { $and: [live, { $gt: [sell, 0] }] } } },
        { $project: { pct: { $multiply: [{ $divide: [{ $subtract: [sell, buy] }, sell] }, 100] } } },
        { $bucket: { groupBy: '$pct', boundaries: [-1e9, 0, 10, 20, 30, 1e9], default: 'other', output: { n: { $sum: 1 } } } },
      ],
      byWeekday: [
        { $match: { $expr: live } },
        { $group: {
          _id: { $dayOfWeek: { date: '$pickupTime', timezone: 'Asia/Riyadh' } },
          orders: { $sum: 1 }, margin: { $sum: { $subtract: [sell, buy] } },
        } },
        { $sort: { _id: 1 } },
      ],
      byPayment: groupBy('$paymentSubtype'),
      byTruckType: groupBy('$truckType', 8),
      byBranch: groupBy('$branch', 10),
      // Pickup → arrival, for trips that have both and a sane duration (< 30 days).
      duration: [
        { $match: { $expr: { $and: [live, { $gt: ['$arrivalTime', '$pickupTime'] }] }, arrivalTime: { $ne: null } } },
        { $project: { h: { $divide: [{ $subtract: ['$arrivalTime', '$pickupTime'] }, 3600000] } } },
        { $match: { h: { $lt: 720 } } },
        { $bucket: { groupBy: '$h', boundaries: [0, 12, 24, 48, 96, 720], default: 'other', output: { n: { $sum: 1 }, h: { $sum: '$h' } } } },
      ],
      byCustomer: [
        { $match: { $expr: live } },
        { $group: { _id: '$customerName', sell: { $sum: sell } } },
        { $sort: { sell: -1 } },
      ],
    } },
  ]);
  const F = f || {};
  const bucketLabel = { '-1000000000': 'loss', 0: '0-10', 10: '10-20', 20: '20-30', 30: '30+' };
  const totalSell = (F.byCustomer || []).reduce((a, c) => a + (c.sell || 0), 0);
  const top5 = (F.byCustomer || []).slice(0, 5).reduce((a, c) => a + (c.sell || 0), 0);
  const durRows = (F.duration || []).filter((b) => b._id !== 'other');
  const durN = durRows.reduce((a, b) => a + b.n, 0);
  const durLabel = { 0: '<12h', 12: '12-24h', 24: '1-2d', 48: '2-4d', 96: '4d+' };
  const rows = (list) => (list || []).map((x) => ({ key: x._id || '', orders: x.orders, sell: r2(x.sell), margin: r2(x.margin) }));
  return {
    marginBuckets: (F.marginBuckets || []).filter((b) => b._id !== 'other').map((b) => ({ key: bucketLabel[b._id] || String(b._id), n: b.n })),
    // $dayOfWeek: 1 = Sunday … 7 = Saturday.
    byWeekday: (F.byWeekday || []).map((d) => ({ day: d._id, orders: d.orders, margin: r2(d.margin) })),
    byPayment: rows(F.byPayment),
    byTruckType: rows(F.byTruckType),
    byBranch: rows(F.byBranch),
    duration: {
      trips: durN,
      avgHours: durN ? r2(durRows.reduce((a, b) => a + b.h, 0) / durN) : null,
      buckets: durRows.map((b) => ({ key: durLabel[b._id] || String(b._id), n: b.n })),
    },
    concentration: {
      customers: (F.byCustomer || []).length,
      top5Share: totalSell > 0 ? r2((top5 / totalSell) * 100) : null,
    },
  };
}

exports.getDashboard = async (req, res) => {
  try {
    const now = new Date();
    const iso = (d) => d.toISOString().slice(0, 10);
    const monthFrom = iso(new Date(now.getFullYear(), now.getMonth(), 1));
    const todayFrom = iso(now);
    const period = DASH_PERIODS.includes(String(req.query.period)) ? String(req.query.period) : 'month';
    const R = dashRange(period);

    // Serve the stale value while refreshing.
    // Building takes ~2.5 seconds (~37k shipments aggregated in the database). Whoever opens the section does not wait: the last build's value is served at once and refreshed in the background, see utils/ttlCache.wrapStale.
    // The new dashboard does not carry the old one's calculation. Each period used to build the month and day analytics too (for app versions that send no period): four full analyses over tens of thousands of rows, ~5 seconds per switch, leaving the old number on screen so the filter seemed broken. Whoever sends a period gets only that period; the old build is for those who send none.
    const legacy = !req.query.period;
    const out = await cache.wrapStale(`so:dashboard:${monthFrom}:${todayFrom}:${period}:${legacy ? 'l' : 'p'}`, 60 * 1000, 10 * 60 * 1000, async () => {
      const [month, today, fleet, recent, cur, prev, extras, insights] = await Promise.all([
        legacy ? analyticsOf({ from: monthFrom }) : null,
        legacy ? analyticsOf({ from: todayFrom }) : null,
        registrySummary(),
        ShipmentOrder.find({}).sort({ createdAt: -1 }).limit(8)
          .select('waybillNumber reference customerName fromCity toCity status vehiclePlate driverName pickupTime createdAt salesRepName sellPrice buyPrice')
          .lean(),
        analyticsOf({ from: R.from, to: R.to }),
        dashTotals(R.prevFrom, R.prevTo),
        dashExtras(R.from, R.to),
        dashInsights(R.from, R.to),
      ]);
      return {
        // `period` is what the dashboard reads (web and app); the rest serves
        // older app versions.
        period: { key: period, ...R, cur, prev, ...extras, insights },
        month, today, fleet, recent,
        // Flat values for older mobile cards (one path per number).
        flat: !legacy ? undefined : {
          todayOrders: today.totals.orders,
          monthOrders: month.totals.orders,
          monthCancelled: month.totals.cancelled,
          monthMargin: month.totals.margin,
          monthSell: month.totals.sell,
          monthBuy: month.totals.buy,
          avgMargin: month.totals.avgMargin,
          customers: month.totals.customers,
          suppliers: fleet.suppliers,
          vehicles: fleet.vehicles,
          drivers: fleet.drivers,
          losing: month.totals.losing,
          missingPrice: month.totals.missingPrice,
          ownerUnknown: fleet.gaps ? fleet.gaps.unknown : 0,
        },
      };
    });
    res.json(out);
  } catch (error) {
    console.error('shipmentOrders dashboard error:', error);
    res.status(500).json({ message: 'تعذّر تحميل اللوحة' });
  }
};

// Waybill counter.
// A waybill number is written on paper handed to the driver and billed against, so an issued number is never reused even if its shipment is deleted: two waybills with the same number in two hands is an error that cannot be fixed later. So the counter only moves forward.

const Counter = require('mongoose').models.ShipmentOrderCounter
  || require('mongoose').model('ShipmentOrderCounter');

exports.getCounter = async (req, res) => {
  try {
    const c = await Counter.findById('waybill').lean();
    const next = (c ? c.seq : 0) + 1;
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
    const next = (c ? c.seq : 0) + 1;
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
    return sendMongooseError(res, error, 'Failed to set the waybill counter');
  }
};

// Statuses that cannot be set without a document.
// Currently only the receipt-sent status. It is a set, not an inline condition, because the section adds statuses from its settings and other statuses may need the document later.
const REQUIRE_FILE = new Set(['bond_sent']);

// POST /orders/:id/note { note }: a follow-up note without a status change.
// It is recorded in the shipment log like any follow-up (who, when, what) and is not sent to the operations platform, since the status did not change. It differs from the trip note (`notes`) that prints on the waybill.
exports.addNote = async (req, res) => {
  try {
    const note = String(req.body?.note || '').trim().slice(0, 500);
    if (!note) return res.status(400).json({ message: 'اكتب الملاحظة' });
    const by = req.user._id;
    const byName = `${req.user.firstName || ''} ${req.user.lastName || ''}`.trim();
    const cur = await ShipmentOrder.findById(req.params.id).select('status').lean();
    if (!cur) return res.status(404).json({ message: 'Shipment order not found' });
    // $push is atomic: it does not overwrite a follow-up written at the same moment, as saving the whole document would.
    const order = await ShipmentOrder.findByIdAndUpdate(req.params.id, {
      $push: { statusLog: { from: cur.status, to: cur.status, note, at: new Date(), by, byName } },
    }, { new: true });
    announceOrderChange(order._id);
    res.json({ order });
  } catch (error) {
    console.error('shipment order note:', error);
    res.status(500).json({ message: 'تعذّر حفظ الملاحظة' });
  }
};

// Edit and delete a follow-up note.
// Only the note entry is edited (`from === to` with no attachment): a status-transition entry is history and is not rewritten. The note's author or the section manager may edit it.
const NOTE_MANAGERS = new Set(['super_admin', 'admin', 'shipment_orders_manager', 'operations_manager']);
const noteEntry = async (req, res) => {
  if (!mongoose.Types.ObjectId.isValid(String(req.params.logId))) { res.status(400).json({ message: 'قيدٌ غير صالح' }); return null; }
  const order = await ShipmentOrder.findById(req.params.id).select('statusLog').lean();
  if (!order) { res.status(404).json({ message: 'Shipment order not found' }); return null; }
  const e = (order.statusLog || []).find((x) => String(x._id) === String(req.params.logId));
  if (!e) { res.status(404).json({ message: 'الملاحظة غير موجودة' }); return null; }
  if (e.from !== e.to || e.fileUrl) { res.status(400).json({ message: 'هذا قيدُ تغييرِ حالة، لا ملاحظة — لا يُعدَّل.' }); return null; }
  const mine = e.by && String(e.by) === String(req.user._id);
  if (!mine && !NOTE_MANAGERS.has(req.user.role)) { res.status(403).json({ message: 'يعدّل الملاحظةَ كاتبُها أو مديرُ القسم.' }); return null; }
  return e;
};

exports.editNote = async (req, res) => {
  try {
    const note = String(req.body?.note || '').trim().slice(0, 500);
    if (!note) return res.status(400).json({ message: 'اكتب الملاحظة' });
    const e = await noteEntry(req, res);
    if (!e) return undefined;
    const byName = `${req.user.firstName || ''} ${req.user.lastName || ''}`.trim();
    const order = await ShipmentOrder.findOneAndUpdate(
      { _id: req.params.id, 'statusLog._id': e._id },
      { $set: { 'statusLog.$.note': note, 'statusLog.$.editedAt': new Date(), 'statusLog.$.editedByName': byName } },
      { new: true },
    );
    await logAudit({ user: req.user._id, action: 'edit_note', entity: 'ShipmentOrder', entityId: req.params.id,
      changes: { before: { note: e.note }, after: { note } }, ipAddress: req.ip });
    announceOrderChange(order._id);
    return res.json({ order });
  } catch (error) {
    console.error('shipment order note edit:', error);
    return res.status(500).json({ message: 'تعذّر تعديل الملاحظة' });
  }
};

exports.deleteNote = async (req, res) => {
  try {
    const e = await noteEntry(req, res);
    if (!e) return undefined;
    const order = await ShipmentOrder.findByIdAndUpdate(req.params.id, { $pull: { statusLog: { _id: e._id } } }, { new: true });
    await logAudit({ user: req.user._id, action: 'delete_note', entity: 'ShipmentOrder', entityId: req.params.id,
      changes: { before: { note: e.note, byName: e.byName, at: e.at } }, ipAddress: req.ip });
    announceOrderChange(order._id);
    return res.json({ order });
  } catch (error) {
    console.error('shipment order note delete:', error);
    return res.status(500).json({ message: 'تعذّر حذف الملاحظة' });
  }
};

exports.patchStatus = async (req, res) => {
  try {
    const { status } = req.body;
    // What `enum` used to guard is guarded here.
    // The `enum` was dropped from the schema so the section can add its own statuses, making the live vocabulary the guard. Without this line any word would be saved as a status.
    if (!(await isValidStatus(status))) {
      return res.status(400).json({ message: `حالةٌ غير معروفة: ${status}` });
    }
    const order = await ShipmentOrder.findById(req.params.id);
    if (!order) return res.status(404).json({ message: 'Shipment order not found' });
    const from = order.status;
    const note = String(req.body.note || '').trim().slice(0, 500);

    // A status saying the receipt was sent requires the receipt.
    // Moving to that status asserts a document went out, and claims and collection rely on it. Without the document the assertion has no proof: asked a week later, it is requested from an employee who forgot which he sent. So the transition itself carries its attachment.
    let file = null;
    if (req.body.dataUrl) {
      try {
        file = saveUploadFile(String(req.body.dataUrl), 'shipment-orders', String(req.body.fileName || ''));
      } catch (e) {
        return res.status(400).json({ message: e.message || 'تعذّر حفظ المرفق' });
      }
    }
    if (REQUIRE_FILE.has(status) && from !== status && !file) {
      return res.status(400).json({
        code: 'ATTACHMENT_REQUIRED',
        message: 'حالة «أُرسل السند» تحتاج إرفاق صورة السند أو ملفه.',
      });
    }

    // A shipment is not cancelled without a reason
    const cancelReason = String(req.body.cancelReason || '').trim().slice(0, 200);
    if (status === 'cancelled' && from !== 'cancelled' && !cancelReason) {
      return res.status(400).json({ code: 'CANCEL_REASON_REQUIRED', message: 'اختر سببَ الإلغاء' });
    }

    // A transition with no change and no note is not recorded: the log would fill with lines that say nothing.
    if (from === status && !note && !file) return res.json({ order });

    // A platform shipment's status lives there.
    // ~36k of this section's orders mirror operations-platform shipments (`source: 'platform'`) and sync writes their status from the platform every pass. Changing it only here lasts minutes before sync erases it, and never reaches the platform; the employee sees it revert and thinks the system loses his work.
    // So it is written where it is read: the platform first; if it refuses, nothing changes here and the reason is reported. Keys are the same on both sides (see STATUS in services/shipmentOrderSyncService), so there is no translation.
    if (order.source === 'platform' && order.externalId && require('../services/uplClient').isConfigured()) {
      const CORE = ['requesting', 'loading', 'uploaded', 'on_way', 'arrived',
        'bond_sent', 'bond_received', 'late', 'invoiced', 'cancelled'];
      if (!CORE.includes(status)) {
        return res.status(400).json({
          code: 'NOT_A_PLATFORM_STATUS',
          message: `«${status}» حالةٌ من إعدادات القسم لا تعرفها منصّة التشغيل — وهذه الشحنة شحنتُها.`,
        });
      }
      try {
        const upl = require('../services/uplClient');
        await upl.patch('/admin/shipments/status', { body: { status, ids: [String(order.externalId)] } });
      } catch (e) {
        return res.status(e.status && e.status < 600 ? e.status : 502).json({
          code: 'PLATFORM_REJECTED',
          message: e.message || 'تعذّر تغيير الحالة في منصّة التشغيل — لم يُحفظ شيء.',
        });
      }
    }

    order.status = status;
    if (status === 'cancelled' && cancelReason) order.cancelReason = cancelReason;
    else if (status !== 'cancelled') order.cancelReason = '';
    order.statusLog.push({
      from, to: status, note: status === 'cancelled' && cancelReason ? [cancelReason, note].filter(Boolean).join(' — ') : note, at: new Date(),
      by: req.user._id,
      byName: `${req.user.firstName || ''} ${req.user.lastName || ''}`.trim(),
      ...(file || {}),
    });
    await order.save();
    announceOrderChange(order._id);
    require('../services/shipmentOrderWorkflowLink').mirrorPlatformSoon(order._id, ['status']);
    // Tell whoever created the order its status moved — unless they moved it.
    if (order.createdBy && String(order.createdBy) !== String(req.user._id)) {
      try {
        await createNotification({
          recipient: order.createdBy,
          type: 'status_changed',
          title: 'تغيّرت حالة الطلب',
          message: `أمر نقل ${order.waybillNumber} — ${order.status}${note ? ` · ${note}` : ''}`,
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

/**
 * Status vocabulary: GET /statuses
 * Read by every screen: list cards, the create form dropdown and the app. A label changed once in settings changes everywhere together.
 */
exports.listStatuses = async (req, res) => {
  try {
    const all = String(req.query.all || '') === '1';
    res.json({ statuses: await statusVocabulary({ includeInactive: all }) });
  } catch (error) {
    res.status(500).json({ message: 'Failed to load shipment statuses' });
  }
};

exports.deleteOrder = async (req, res) => {
  try {
    const order = await ShipmentOrder.findById(req.params.id).lean();
    if (!order) return res.status(404).json({ message: 'Shipment order not found' });
    const done = await require('../services/shipmentOrderWorkflowLink').deleteShipments({ orders: [order] });
    await logAudit({
      user: req.user, action: 'delete', entity: 'ShipmentOrder', entityId: order._id,
      changes: { reference: order.reference, customerName: order.customerName, ...done }, ipAddress: req.ip,
    });
    announceOrderChange();
    res.json({ deleted: true });
  } catch (error) {
    return sendMongooseError(res, error, 'Failed to delete the shipment');
  }
};

// ── Customers ───────────────────────────────────────────────────────────────

// Search finds by anything.
// The registers now hold thousands after the platform move (3369 suppliers, 13102 vehicles). A blind limit of 500 cuts the list, and name-only search misses one known by number, register or plate. So search covers everything the record is known by, and the limit is requested.
const askedLimit = (v, def, max) => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.min(Math.max(n, 1), max) : def;
};
// Search ignores spacing and hamza.
// `rx` escapes symbols and searches literally: someone who copied a plate from Absher with two spaces, or typed one spelling of a name stored another way, got an empty screen for an existing row. `flexSpaceRegex` is the search rule in the other sections, so it is used here too.
// Every word must match somewhere, in any order: reordered plate parts still find the plate.
const anyOf = (q, fields) => {
  const words = String(q).trim().split(/\s+/).filter(Boolean);
  if (words.length < 2) return { $or: fields.map((f) => ({ [f]: flexSpaceRegex(q) })) };
  return { $and: words.map((w) => ({ $or: fields.map((f) => ({ [f]: flexSpaceRegex(w) })) })) };
};

/** The same vehicle query narrowed to the plate field. */
const plateScope = (filter, q) => {
  const { $or, $and, ...rest } = filter;
  return { ...rest, ...anyOf(q, ['plate']) };
};

// The three lists: read-only fields, cached two minutes.
// The cluster delivers ~70 KB/s, so a list costs its size, not its computation: 500 full customers are 315 KB (~4.5 s) and 1000 trucks 463 KB (~5 s). Import fields (owner, IBAN, register, operating card, ...) are read by no screen or app, since the edit form sends only editable fields. Caching is safe because the three models' hooks clear `so:registry:` on every write.
const REGISTRY_TTL = 2 * 60 * 1000;
const CUSTOMER_LIST_FIELDS = 'customerCode name phone email notes routes defaults';
// Its financial papers are read from the row: commercial register, IBAN and its manager by number are what is requested at his first payment, and a card used to be opened for each supplier.
const SUPPLIER_LIST_FIELDS = 'name type phone email notes commercialRegister taxCard iban bankName managerName managerPhone paymentTerms';
const VEHICLE_LIST_FIELDS = 'plate name truckType brand color supplier ownership vehicleMaster defaultDriverName defaultDriverPhone operationCardNumber operationCardExpiry modelYear notes';
const DRIVER_LIST_FIELDS = 'name phone nationality residenceNumber driverCardNumber driverCardExpiry supplier vehicle employee sponsorName notes';
const registryKey = (kind, req, extra = '') => `so:registry:${kind}:${String(req.query.q || '')}:${req.query.limit || ''}:${extra}`;

// Truck ownership is requested explicitly.
// `ours` is not shown in the supplier-truck picker, and `unknown` is shown because those are carriers' trucks whose carrier is not yet known; hiding them hides over half.
const ownershipFilter = (v) => {
  const k = String(v || '').trim();
  if (k === 'supplier') return { supplier: { $ne: null } };
  if (k === 'ours') return { ownership: 'ours' };
  if (k === 'unknown') return { ownership: { $ne: 'ours' }, supplier: null };
  // `not_ours` is the shipment picker's filter: supplier trucks plus those with unknown owner. Limiting it to known owners hides most of the register from selection, though we did work on those trucks; an unknown owner becomes known by picking its supplier.
  if (k === 'not_ours') return { ownership: { $ne: 'ours' } };
  return null;
};

exports.listCustomers = async (req, res) => {
  try {
    const { q } = req.query;
    const filter = { isActive: { $ne: false } };
    if (q && q.trim()) Object.assign(filter, anyOf(q, ['customerCode', 'name', 'phone', 'email', 'city', 'address', 'externalId']));
    // The new-shipment picker is the customers page: every active row, read fresh
    // because the cache is per worker and an edit there must show at once.
    if (String(req.query.picker || '') === '1') {
      const customers = await ShipmentOrderCustomer.find(filter).select(CUSTOMER_LIST_FIELDS).sort({ name: 1 }).limit(5000).lean();
      return res.json({ customers, total: customers.length });
    }
    const out = await cache.wrap(registryKey('customers', req), REGISTRY_TTL, async () => {
      const [customers, total] = await Promise.all([
        ShipmentOrderCustomer.find(filter)
          .select(CUSTOMER_LIST_FIELDS)
          .sort({ name: 1 })
          .limit(askedLimit(req.query.limit, 500, 5000))
          .lean(),
        ShipmentOrderCustomer.countDocuments(filter),
      ]);
      return { customers, total };
    });
    res.json(out);
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
    // Destination prices belong only to the operations manager and the system admin, see customerRoutes.canEditPrices.
    if (!require('../utils/customerRoutes').canEditPrices(req.user.role)) delete data.routes;
    data.createdBy = req.user._id;
    // One row per name: a removed customer comes back with its history instead of a twin.
    const { fold } = require('../models/CollectionsParty');
    const key = fold(req.body.name);
    const same = (await ShipmentOrderCustomer.find({}).select('name isActive').lean()).filter((c) => fold(c.name) === key);
    if (same.some((c) => c.isActive !== false)) {
      return res.status(409).json({ code: 'CUSTOMER_EXISTS', message: `العميل «${String(req.body.name).trim()}» موجود بالفعل` });
    }
    let customer;
    if (same.length) {
      customer = await ShipmentOrderCustomer.findById(same[0]._id);
      const { createdBy, ...fields } = data;
      customer.set({ ...fields, isActive: true, nameManual: true, hiddenReason: undefined });
      await customer.save();
    } else {
      customer = await ShipmentOrderCustomer.create(data);
    }
    await logAudit({ user: req.user, action: 'create', entity: 'ShipmentOrderCustomer', entityId: customer._id, changes: { name: customer.name, restored: !!same.length }, ipAddress: req.ip });
    emit('shipmentOrders:customers', {});
    res.status(201).json({ customer });
  } catch (error) {
    return sendMongooseError(res, error, 'Failed to create the customer');
  }
};

exports.updateCustomer = async (req, res) => {
  try {
    const customer = await ShipmentOrderCustomer.findById(req.params.id);
    if (!customer) return res.status(404).json({ message: 'Customer not found' });
    const data = pick(req.body, CUSTOMER_EDITABLE);
    // Destination prices are written only by their owners.
    // Whoever edits the customer (sales, operations staff, ...) saves its name, phone and preferences; routes and their prices stay as they are whatever is sent, so it does not rely on the screen hiding the field.
    if (!require('../utils/customerRoutes').canEditPrices(req.user.role)) delete data.routes;
    // Saving the price list does not erase price tiers.
    // The edit-prices window sends all routes without their tiers, which the operations manager writes through another path (setRouteTiers). So they are carried onto the same route by its folded key, and are never accepted from this path.
    if (Array.isArray(data.routes)) {
      const { routeKey } = require('../utils/customerRoutes');
      const kept = new Map((customer.routes || []).map((r) => [routeKey(r.fromCity, r.toCity), r]));
      data.routes = data.routes.map((r) => {
        const old = kept.get(routeKey(r.fromCity, r.toCity));
        const { tiers, tiersAt, tiersBy, ...rest } = r || {};
        return old && (old.tiers || []).length
          ? { ...rest, tiers: old.tiers, tiersAt: old.tiersAt, tiersBy: old.tiersBy } : rest;
      });
    }
    if (data.name !== undefined && String(data.name).trim() !== customer.name) data.nameManual = true;
    const oldName = customer.name;
    Object.assign(customer, data);
    await customer.save();
    // Orders show the snapshot name; keep future reads coherent after a rename.
    await ShipmentOrder.updateMany({ customer: customer._id }, { customerName: customer.name });
    // The name also keys the workflow, collections and shipments without a customer ref.
    if (customer.name !== oldName) {
      await require('../utils/renameOpsCustomer').renameOpsCustomer(oldName, customer.name);
      require('../services/shipmentOrderWorkflowLink').announceRename();
    }
    emit('shipmentOrders:customers', {});
    res.json({ customer });
  } catch (error) {
    return sendMongooseError(res, error, 'Failed to update the customer');
  }
};

exports.deleteCustomer = async (req, res) => {
  try {
    // Soft — their orders keep the snapshot name either way, but keeping the
    // row means the trial's data can be resurrected while it is still a trial.
    const customer = await ShipmentOrderCustomer.findById(req.params.id);
    if (!customer) return res.status(404).json({ message: 'Customer not found' });
    customer.isActive = false;
    await customer.save();
    await logAudit({ user: req.user, action: 'delete', entity: 'ShipmentOrderCustomer', entityId: customer._id, changes: { name: customer.name }, ipAddress: req.ip });
    emit('shipmentOrders:customers', {});
    res.json({ message: 'Customer removed' });
  } catch (error) {
    res.status(500).json({ message: 'Failed to remove the customer' });
  }
};

// Suppliers and vehicles

const SUPPLIER_EDITABLE = ['name', 'type', 'phone', 'email', 'notes', 'isActive'];
const VEHICLE_EDITABLE = ['plate', 'name', 'truckType', 'brand', 'color', 'supplier', 'ownership', 'defaultDriverName', 'defaultDriverPhone', 'operationCardNumber', 'operationCardExpiry', 'modelYear', 'notes', 'isActive'];

// The two fields do not contradict.
// The supplier reference and the ownership flag are two facts about one thing; writing only one would leave a truck with a supplier marked as from our fleet. So one attributed to a supplier is `supplier`, and one said to be ours has no supplier.
const coherentOwnership = (data) => {
  if (!('supplier' in data) && !('ownership' in data)) return data;
  if (data.ownership === 'ours') return { ...data, supplier: null };
  if (data.supplier) return { ...data, ownership: 'supplier' };
  if ('supplier' in data && !data.supplier && data.ownership !== 'ours') {
    return { ...data, ownership: 'unknown' };
  }
  return data;
};

/**
 * Our truck refers to the vehicle register, and our driver to his file.
 * Rule: one record per vehicle and per person, and an edit shows everywhere. A truck not owned by a supplier is resolved by plate to `VehicleMaster` (utils/vehicleRef, Arabic to Latin), and anything resolved is certainly ours since a Saudi plate of letters and digits does not repeat. The driver resolves by residency number to his HR file. Both resolve on every create and update, not only on import.
 */
async function syncVehicleMaster(id) {
  const v = await ShipmentOrderVehicle.findById(id).select('plate supplier ownership vehicleMaster').lean();
  if (!v) return;
  const set = {};
  if (v.supplier || v.ownership === 'supplier') {
    if (v.vehicleMaster) set.vehicleMaster = null; // A supplier's truck that is not in our register
  } else {
    const hit = await require('../utils/vehicleRef').resolve(v.plate);
    if (String(v.vehicleMaster || '') !== String(hit?._id || '')) set.vehicleMaster = hit ? hit._id : null;
    if (hit && v.ownership !== 'ours') set.ownership = 'ours';
  }
  if (Object.keys(set).length) await ShipmentOrderVehicle.updateOne({ _id: id }, { $set: set });
}

async function syncDriverEmployee(id) {
  const d = await ShipmentOrderDriver.findById(id).select('residenceNumber employee').lean();
  if (!d) return;
  const e = await require('../utils/personLookup').byIdNumber(d.residenceNumber, '_id');
  if (String(d.employee || '') !== String(e?._id || '')) {
    await ShipmentOrderDriver.updateOne({ _id: id }, { $set: { employee: e ? e._id : null } });
  }
}

/** The truck as displayed: its identity from the vehicle register if linked. */
const vehicleView = (v) => {
  const m = v && v.vehicleMaster && typeof v.vehicleMaster === 'object' ? v.vehicleMaster : null;
  if (!m) return v;
  const year = m.modelYear ? String(m.modelYear) : '';
  return {
    ...v,
    vehicleMaster: m._id,
    registry: { _id: m._id, plateNumber: m.plateNumber || '', brand: m.brandAr || '', model: m.modelAr || '', modelYear: year, color: m.colorAr || '' },
    name: [m.brandAr, m.modelAr].filter(Boolean).join(' ') || v.name,
    brand: m.brandAr || v.brand, color: m.colorAr || v.color, modelYear: year || v.modelYear,
  };
};
const VEHICLE_MASTER_FIELDS = 'plateNumber brandAr modelAr modelYear colorAr';

/** The driver as displayed: name, mobile and nationality from his file if he is our employee. */
const driverView = (d) => {
  const e = d && d.employee && typeof d.employee === 'object' ? d.employee : null;
  if (!e) return d;
  const { displayName } = require('../utils/personLookup');
  return {
    ...d,
    employee: e._id,
    hr: { _id: e._id, name: displayName(e), phone: e.phone || '', nationality: e.nationality || '', idNumber: e.iqamaNumber || e.nationalId || '' },
    name: displayName(e) || d.name, phone: e.phone || d.phone, nationality: e.nationality || d.nationality,
  };
};
const EMPLOYEE_FIELDS = 'firstName lastName arabicName phone nationality iqamaNumber nationalId';

// The values 0 and - are not values.
// The imported register holds them where there is nothing, so 0 was displayed as a mobile, residency and card date, and the shipment mobile was filled with 0. They are blanked in what the screens (web and app) read, without touching the database.
const blankish = (v) => /^(0+|-+|null|undefined|nan|n\/a)$/i.test(String(v ?? '').trim());
const cleanFields = (o, keys) => {
  if (!o) return o;
  const out = { ...o };
  for (const k of keys) if (blankish(out[k])) out[k] = '';
  return out;
};
const cleanDriver = (d) => cleanFields(d, ['phone', 'residenceNumber', 'driverCardNumber', 'driverCardExpiry', 'nationality', 'sponsorName', 'companyName']);
const cleanVehicle = (v) => cleanFields(v, ['defaultDriverName', 'defaultDriverPhone', 'operationCardNumber', 'operationCardExpiry']);

exports.listSuppliers = async (req, res) => {
  try {
    const { q } = req.query;
    const filter = { isActive: { $ne: false } };
    if (q && q.trim()) {
      Object.assign(filter, anyOf(q, ['name', 'phone', 'email', 'ownerName', 'ownerPhone',
        'managerName', 'managerPhone', 'accountantName', 'commercialRegister', 'iban', 'externalId']));
    }
    // `fresh=1` (the new-shipment form) skips the per-worker cache so a supplier edit shows at once.
    const build = async () => {
      // How many trucks and drivers each one runs: the numbers asked about a supplier before opening his file. The four are independent so they are requested together: one round trip of one query's duration.
      const [suppliers, total, vCounts, dCounts] = await Promise.all([
        ShipmentOrderSupplier.find(filter)
          .select(SUPPLIER_LIST_FIELDS)
          .sort({ name: 1 })
          .limit(askedLimit(req.query.limit, 500, 5000))
          .lean(),
        ShipmentOrderSupplier.countDocuments(filter),
        ShipmentOrderVehicle.aggregate([
          { $match: { isActive: { $ne: false }, supplier: { $ne: null } } },
          { $group: { _id: '$supplier', n: { $sum: 1 } } },
        ]),
        ShipmentOrderDriver.aggregate([
          { $match: { isActive: { $ne: false }, supplier: { $ne: null } } },
          { $group: { _id: '$supplier', n: { $sum: 1 } } },
        ]),
      ]);
      const byId = {};
      vCounts.forEach((c) => { byId[String(c._id)] = c.n; });
      const drvById = {};
      dCounts.forEach((c) => { drvById[String(c._id)] = c.n; });
      return {
        suppliers: suppliers.map((s) => ({
          ...s,
          vehicleCount: byId[String(s._id)] || 0,
          driverCount: drvById[String(s._id)] || 0,
        })),
        total,
      };
    };
    const out = String(req.query.fresh || '') === '1' ? await build() : await cache.wrap(registryKey('suppliers', req), REGISTRY_TTL, build);
    res.json(out);
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
    return sendMongooseError(res, error, 'Failed to create the supplier');
  }
};

exports.updateSupplier = async (req, res) => {
  try {
    const before = await ShipmentOrderSupplier.findById(req.params.id).select('name').lean();
    const supplier = await ShipmentOrderSupplier.findByIdAndUpdate(req.params.id, pick(req.body, SUPPLIER_EDITABLE), { new: true });
    if (!supplier) return res.status(404).json({ message: 'Supplier not found' });
    if (before.name !== supplier.name) {
      // Shipments and workflow rows hold the name as a snapshot.
      await ShipmentOrder.updateMany({ $or: [{ supplier: supplier._id }, { supplierName: before.name }] }, { supplierName: supplier.name });
      const Workflow = require('../models/OperationsWorkflow');
      await Workflow.updateMany({ carOwner: before.name }, { carOwner: supplier.name });
      await Workflow.updateMany({ ownerName: before.name }, { ownerName: supplier.name });
      require('../services/shipmentOrderWorkflowLink').announceRename();
    }
    emit('shipmentOrders:fleet', {});
    res.json({ supplier });
  } catch (error) {
    return sendMongooseError(res, error, 'Failed to update the supplier');
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

// Merge two suppliers: POST /suppliers/:id/merge { from }. `:id` stays, `from` is merged into it.
// Empty fields in the survivor are filled from the merged one; on conflict the survivor's value stays and the other goes to its notes.
// Shipments, trucks, drivers and portal accounts move to the survivor; the platform id goes to its `externalIds` so import does not recreate it.
// The merged one is deactivated with `mergedInto`, and the merge is audited.
const MERGE_FIELDS = ['type', 'phone', 'email', 'externalId', 'commercialRegister', 'taxCard', 'nationalAddress', 'bankName', 'iban',
  'ownerName', 'ownerPhone', 'managerName', 'managerPhone', 'accountantName', 'accountantPhone', 'paymentTerms',
  'agreedPriceStatement', 'contractFile'];
const MERGE_LABELS = { phone: 'هاتف', email: 'بريد', commercialRegister: 'سجل تجاري', taxCard: 'بطاقة ضريبية', nationalAddress: 'عنوان وطني',
  bankName: 'بنك', iban: 'آيبان', ownerName: 'المالك', ownerPhone: 'جوال المالك', managerName: 'المدير', managerPhone: 'جوال المدير',
  accountantName: 'المحاسب', accountantPhone: 'جوال المحاسب', paymentTerms: 'شروط السداد', agreedPriceStatement: 'بيان الأسعار', contractFile: 'العقد' };

exports.mergeSupplier = async (req, res) => {
  try {
    const fromId = String(req.body?.from || '');
    if (!mongoose.Types.ObjectId.isValid(fromId) || fromId === String(req.params.id)) {
      return res.status(400).json({ message: 'اختر المورّد الآخر المراد دمجه' });
    }
    const [keep, from] = await Promise.all([
      ShipmentOrderSupplier.findById(req.params.id),
      ShipmentOrderSupplier.findById(fromId),
    ]);
    if (!keep || !from) return res.status(404).json({ message: 'Supplier not found' });
    if (from.mergedInto) return res.status(400).json({ message: 'هذا المورّد مدموجٌ من قبل' });

    const before = keep.toObject();
    const extraNotes = [];
    for (const f of MERGE_FIELDS) {
      const a = String(keep[f] ?? '').trim();
      const b = String(from[f] ?? '').trim();
      if (!b) continue;
      if (!a) keep[f] = from[f];
      else if (a !== b && f !== 'type' && f !== 'externalId') extraNotes.push(`${MERGE_LABELS[f] || f}: ${b}`);
    }
    const notes = [String(keep.notes || '').trim(), String(from.notes || '').trim(),
      extraNotes.length ? `من المورّد المدموج «${from.name}» — ${extraNotes.join(' · ')}` : ''];
    keep.notes = [...new Set(notes.filter(Boolean))].join('\n');
    const ext = new Set([...(keep.externalIds || []), ...(from.externalIds || []), from.externalId, keep.externalId].map((x) => String(x || '').trim()).filter(Boolean));
    ext.delete(String(keep.externalId || ''));
    keep.externalIds = [...ext];
    if (from.isActive !== false) keep.isActive = true;
    await keep.save();

    const ShipmentOrderVehicleM = require('../models/ShipmentOrderVehicle');
    const ShipmentOrderDriverM = require('../models/ShipmentOrderDriver');
    const User = require('../models/User');
    const [orders, vehicles, drivers, partners] = await Promise.all([
      ShipmentOrder.updateMany({ supplier: from._id }, { $set: { supplier: keep._id, supplierName: keep.name } }),
      ShipmentOrderVehicleM.updateMany({ supplier: from._id }, { $set: { supplier: keep._id } }),
      ShipmentOrderDriverM.updateMany({ supplier: from._id }, { $set: { supplier: keep._id } }),
      User.updateMany({ 'partner.source': 'shipment_order_supplier', 'partner.refId': String(from._id) }, { $set: { 'partner.refId': String(keep._id) } }),
    ]);
    // Shipments carrying the merged supplier's name as text (from the platform) take the survivor's name if different.
    if (String(from.name).trim() !== String(keep.name).trim()) {
      await ShipmentOrder.updateMany({ supplierName: from.name }, { $set: { supplierName: keep.name } });
    }
    from.isActive = false;
    from.mergedInto = keep._id;
    // Its platform id moved to the survivor's `externalIds` and is cleared here so import does not match it.
    from.externalId = '';
    await from.save();

    const moved = { orders: orders.modifiedCount || 0, vehicles: vehicles.modifiedCount || 0, drivers: drivers.modifiedCount || 0, partners: partners.modifiedCount || 0 };
    await logAudit({
      user: req.user._id, action: 'merge_supplier', entity: 'ShipmentOrderSupplier', entityId: keep._id,
      changes: { before: { keep: before, from: from.toObject() }, after: { keep: keep.toObject(), moved } }, ipAddress: req.ip,
    });
    emit('shipmentOrders:fleet', {});
    announceOrderChange();
    return res.json({ supplier: keep, moved });
  } catch (error) {
    console.error('merge supplier:', error);
    return res.status(500).json({ message: 'تعذّر دمج المورّدين' });
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
    const own = ownershipFilter(req.query.ownership);
    if (own && !req.query.supplier) Object.assign(filter, own);
    const out = await cache.wrap(
      registryKey('vehicles', req, `${req.query.supplier || ''}:${req.query.ownership || ''}`),
      REGISTRY_TTL, async () => {
      const limit = askedLimit(req.query.limit, 1000, 5000);
      const read = (where, max) => ShipmentOrderVehicle.find(where)
        .select(VEHICLE_LIST_FIELDS)
        .populate('supplier', 'name type')
        .populate('vehicleMaster', VEHICLE_MASTER_FIELDS)
        .sort({ plate: 1 })
        .limit(max)
        .lean();
      // A truck found by its plate comes first; a match on a phone or card number follows.
      const byPlate = q && q.trim() ? await read(plateScope(filter, q), limit) : [];
      const seen = new Set(byPlate.map((v) => String(v._id)));
      const rest = (await read(filter, limit)).filter((v) => !seen.has(String(v._id)));
      const total = await ShipmentOrderVehicle.countDocuments(filter);
      const vehicles = [...byPlate, ...rest].slice(0, limit);
      return { vehicles: vehicles.map(vehicleView).map(cleanVehicle), total };
    });
    res.json(out);
  } catch (error) {
    res.status(500).json({ message: 'Failed to load vehicles' });
  }
};

// Register counts: the page states what is in the database, not what reached it.
// The header used to count from the received array with a limit of 1000, so it said 1000 vehicles, 1000 of our fleet, when our fleet is 58 trucks. Counting is on the server.
/** Register summary, called by the suppliers page and the section dashboard so the number is the same. */
async function registrySummary() {
  {
    return cache.wrap('so:registry:summary', REGISTRY_TTL, async () => {
      const live = { isActive: { $ne: false } };
      const [byOwner, vehicles, suppliers, drivers] = await Promise.all([
        ShipmentOrderVehicle.aggregate([
          { $match: live },
          {
            $group: {
              _id: {
                $cond: [{ $ne: ['$supplier', null] }, 'supplier',
                  { $cond: [{ $eq: ['$ownership', 'ours'] }, 'ours', 'unknown'] }],
              },
              n: { $sum: 1 },
            },
          },
        ]),
        ShipmentOrderVehicle.countDocuments(live),
        ShipmentOrderSupplier.countDocuments(live),
        ShipmentOrderDriver.countDocuments(live),
      ]);
      const n = { supplier: 0, ours: 0, unknown: 0 };
      byOwner.forEach((r) => { n[r._id] = r.n; });

      // Register gaps are stated.
      // Tables open with many empty cells, read as breakage, but the platform imported from carries no make or colour at all (zero of ~13k), and hundreds of trucks have no known owner yet. The counts are stated explicitly: work waiting, not a hidden defect.
      const [noBrand, supNoVehicle] = await Promise.all([
        ShipmentOrderVehicle.countDocuments({ ...live, $or: [{ brand: '' }, { brand: null }, { color: '' }, { color: null }] }),
        ShipmentOrderSupplier.aggregate([
          { $match: live },
          {
            $lookup: {
              from: 'shipmentordervehicles',
              let: { s: '$_id' },
              pipeline: [{ $match: { $expr: { $eq: ['$supplier', '$$s'] }, isActive: { $ne: false } } }, { $count: 'n' }],
              as: 'v',
            },
          },
          { $match: { v: { $size: 0 } } },
          { $count: 'n' },
        ]).then((r) => r[0]?.n || 0),
      ]);

      return { vehicles, suppliers, drivers, ...n, gaps: { unknown: n.unknown, noBrand, supNoVehicle } };
    });
  }
}

exports.fleetSummary = async (req, res) => {
  try {
    res.json(await registrySummary());
  } catch (error) {
    res.status(500).json({ message: 'Failed to load the fleet summary' });
  }
};

exports.createVehicle = async (req, res) => {
  try {
    if (!req.body.plate || !String(req.body.plate).trim()) return res.status(400).json({ message: 'Plate is required' });
    const created = await ShipmentOrderVehicle.create({ ...coherentOwnership(pick(req.body, VEHICLE_EDITABLE)), createdBy: req.user._id });
    await syncVehicleMaster(created._id);
    const vehicle = await ShipmentOrderVehicle.findById(created._id);
    emit('shipmentOrders:fleet', {});
    res.status(201).json({ vehicle });
  } catch (error) {
    return sendMongooseError(res, error, 'Failed to create the vehicle');
  }
};

exports.updateVehicle = async (req, res) => {
  try {
    const updated = await ShipmentOrderVehicle.findByIdAndUpdate(req.params.id, coherentOwnership(pick(req.body, VEHICLE_EDITABLE)), { new: true });
    if (!updated) return res.status(404).json({ message: 'Vehicle not found' });
    await syncVehicleMaster(updated._id);
    // Shipments hold the plate as a snapshot; those on this truck follow an edit.
    await ShipmentOrder.updateMany({ vehicle: updated._id, vehiclePlate: { $ne: updated.plate } }, { vehiclePlate: updated.plate });
    const vehicle = await ShipmentOrderVehicle.findById(updated._id);
    emit('shipmentOrders:fleet', {});
    res.json({ vehicle });
  } catch (error) {
    return sendMongooseError(res, error, 'Failed to update the vehicle');
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

// Drivers of carrier trucks.
// The register was missing entirely: a driver was a name on a truck row, not a file. His file is what is asked for at assignment: residency number, operating card and expiry, who sponsors him, and on which truck and for which supplier.

const DRIVER_EDITABLE = [
  'name', 'phone', 'email', 'nationality', 'residenceNumber',
  'driverCardNumber', 'driverCardExpiry', 'companyName', 'sponsorName',
  'supplier', 'vehicle', 'notes', 'isActive',
];

exports.listDrivers = async (req, res) => {
  try {
    const { q } = req.query;
    const filter = { isActive: { $ne: false } };
    if (q && q.trim()) {
      Object.assign(filter, anyOf(q, ['name', 'phone', 'residenceNumber', 'driverCardNumber',
        'nationality', 'sponsorName', 'companyName', 'email', 'externalId']));
      // Mobile however written.
      // The three forms of the same Saudi mobile are one number: matched without the leading zero or country code, even if what was typed is a part of it.
      const { westernDigits } = require('../utils/arabicSearch');
      const t = westernDigits(String(q).trim());
      if (/^[\d\s+()\-]+$/.test(t)) {
        const bare = t.replace(/\D/g, '').replace(/^(00)?966/, '').replace(/^0/, '');
        if (bare.length >= 4) {
          const rxBare = new RegExp(bare.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
          filter.$or = [...filter.$or, { phone: rxBare }, { residenceNumber: rxBare }, { driverCardNumber: rxBare }];
        }
      }
    }
    // By a specific supplier's driver, or a specific truck's driver: the two questions this list is opened for from another screen.
    if (req.query.supplier) filter.supplier = req.query.supplier;
    if (req.query.vehicle) filter.vehicle = req.query.vehicle;
    const out = await cache.wrap(
      registryKey('drivers', req, `${req.query.supplier || ''}:${req.query.vehicle || ''}`),
      REGISTRY_TTL, async () => {
        const [drivers, total] = await Promise.all([
          ShipmentOrderDriver.find(filter)
            .select(DRIVER_LIST_FIELDS)
            .populate('supplier', 'name type')
            .populate('vehicle', 'plate name')
            .populate('employee', EMPLOYEE_FIELDS)
            .sort({ name: 1 })
            .limit(askedLimit(req.query.limit, 500, 5000))
            .lean(),
          ShipmentOrderDriver.countDocuments(filter),
        ]);
        // His residency and licence expiry come from his file (utils/personDocDates).
        const docs = await require('../utils/personDocDates').docDatesFor(drivers.map((d) => ({ idNumber: d.residenceNumber, employee: d.employee })));
        return { drivers: drivers.map(driverView).map(cleanDriver).map((d, i) => ({ ...d, ...docs({ idNumber: drivers[i].residenceNumber, employee: drivers[i].employee }) })), total };
      },
    );
    res.json(out);
  } catch (error) {
    res.status(500).json({ message: 'Failed to load drivers' });
  }
};

exports.createDriver = async (req, res) => {
  try {
    if (!req.body.name || !String(req.body.name).trim()) return res.status(400).json({ message: 'Driver name is required' });
    // New driver from the shipment creation screen (`reuse`) does not duplicate an existing one.
    // If the typed mobile or residency is registered, the existing driver is returned to be selected, instead of a second driver with the same number splitting his shipments.
    if (req.body.reuse) {
      // Also by name.
      // Identity used to be by mobile or residency only, so a driver typed twice with no mobile was registered twice. The folded name (spelling variants, spacing) is a third evidence, and the existing one is returned with the match reason so the screen asks whether to select it.
      const tail = String(req.body.phone || '').replace(/\D/g, '').slice(-9);
      const iq = String(req.body.residenceNumber || '').trim();
      const live = { isActive: { $ne: false } };
      let existing = null; let matchedBy = '';
      if (tail.length === 9) { existing = await ShipmentOrderDriver.findOne({ ...live, phone: new RegExp(`${tail}$`) }); matchedBy = existing ? 'phone' : ''; }
      if (!existing && iq) { existing = await ShipmentOrderDriver.findOne({ ...live, residenceNumber: iq }); matchedBy = existing ? 'iqama' : ''; }
      if (!existing) {
        const fold = (v) => String(v || '').replace(/[\u064B-\u0652\u0640]/g, '').replace(/[أإآ]/g, 'ا').replace(/ة/g, 'ه').replace(/ى/g, 'ي')
          .replace(/\s+/g, ' ').trim().toLowerCase();
        const want = fold(req.body.name);
        const near = await ShipmentOrderDriver.find({ ...live, name: require('../utils/arabicSearch').arabicSearchRegex(String(req.body.name).trim()) }).limit(30);
        existing = near.find((d) => fold(d.name) === want) || null;
        matchedBy = existing ? 'name' : '';
      }
      if (existing && !req.body.force) return res.json({ driver: existing, existed: true, matchedBy });
    }
    const created = await ShipmentOrderDriver.create({ ...pick(req.body, DRIVER_EDITABLE), createdBy: req.user._id });
    await syncDriverEmployee(created._id);
    const driver = await ShipmentOrderDriver.findById(created._id);
    emit('shipmentOrders:fleet', {});
    res.status(201).json({ driver });
  } catch (error) {
    return sendMongooseError(res, error, 'Failed to create the driver');
  }
};

exports.updateDriver = async (req, res) => {
  try {
    const updated = await ShipmentOrderDriver.findByIdAndUpdate(req.params.id, pick(req.body, DRIVER_EDITABLE), { new: true });
    if (!updated) return res.status(404).json({ message: 'Driver not found' });
    await syncDriverEmployee(updated._id);
    const driver = await ShipmentOrderDriver.findById(updated._id);
    emit('shipmentOrders:fleet', {});
    res.json({ driver });
  } catch (error) {
    return sendMongooseError(res, error, 'Failed to update the driver');
  }
};

exports.deleteDriver = async (req, res) => {
  try {
    const driver = await ShipmentOrderDriver.findByIdAndUpdate(req.params.id, { isActive: false }, { new: true });
    if (!driver) return res.status(404).json({ message: 'Driver not found' });
    emit('shipmentOrders:fleet', {});
    res.json({ message: 'Driver removed' });
  } catch (error) {
    res.status(500).json({ message: 'Failed to remove the driver' });
  }
};

// ── Form fields (the settings page) ─────────────────────────────────────────

/** Company branches in Arabic as written in statements, from reference data, in their order. */
async function companyBranchOptions() {
  return cache.wrap('so:branches', 60 * 1000, async () => {
    const Lookup = require('../models/Lookup');
    const rows = await Lookup.find({ type: 'workflow_paying_branch', deleted: { $ne: true }, isActive: { $ne: false } })
      .sort({ order: 1, nameAr: 1 }).select('nameAr nameEn').lean();
    return rows.filter((r) => String(r.nameAr || '').trim())
      .map((r) => ({ key: r.nameAr.trim(), ar: r.nameAr.trim(), en: (r.nameEn || r.nameAr).trim() }));
  });
}

const roleNames = () => require('../config/roles').LABELS_AR;

/** GET /branch-access — the people limited by branch and what each one has. */
exports.getBranchAccess = async (req, res) => {
  try {
    const { SHIPMENT_BRANCH_ROLES } = require('../config/shipmentBranchRoles');
    const users = await require('../models/User').find({ role: { $in: SHIPMENT_BRANCH_ROLES }, isActive: { $ne: false } })
      .select('firstName lastName role email shipmentBranches').sort({ firstName: 1 }).lean();
    res.json({
      branches: await companyBranchOptions(),
      users: users.map((u) => ({
        _id: u._id, name: fullName(u), email: u.email, role: u.role, roleAr: roleNames()[u.role] || u.role, branches: u.shipmentBranches || [],
      })),
    });
  } catch (error) {
    res.status(500).json({ message: 'تعذّر تحميل صلاحيات الفروع' });
  }
};

/** PUT /branch-access/:id { branches } — same field as the user form, so both always agree. */
exports.setBranchAccess = async (req, res) => {
  try {
    const { SHIPMENT_BRANCH_ROLES } = require('../config/shipmentBranchRoles');
    const User = require('../models/User');
    const target = await User.findById(req.params.id);
    if (!target || !SHIPMENT_BRANCH_ROLES.includes(target.role)) return res.status(404).json({ message: 'المستخدم غير موجود' });
    const known = new Set((await companyBranchOptions()).map((b) => b.key));
    const asked = [...new Set((Array.isArray(req.body.branches) ? req.body.branches : []).map((b) => String(b).trim()))];
    const unknown = asked.filter((b) => !known.has(b));
    if (unknown.length) return res.status(400).json({ message: `فرع غير معروف: ${unknown.join('، ')}` });
    const before = target.shipmentBranches || [];
    await User.updateOne({ _id: target._id }, { $set: { shipmentBranches: asked } });
    await logAudit({ user: req.user, action: 'update', entity: 'User', entityId: target._id, changes: { before: { shipmentBranches: before }, after: { shipmentBranches: asked } }, ipAddress: req.ip });
    emit('shipmentOrders:branchAccess', {});
    emit('shipmentOrders:updated', {});
    res.json({ branches: asked });
  } catch (error) {
    return sendMongooseError(res, error, 'تعذّر حفظ صلاحيات الفروع');
  }
};

/** «From / To» cities: the owner's list plus what the section settings added, the same list the shipment form shows. */
exports.cityOptions = async () => {
  const base = require('../config/shipmentCities');
  const rows = await ShipmentOrderField.find({ key: { $in: ['fromCity', 'toCity'] }, deleted: { $ne: true } }).select('options').lean();
  const out = [...base];
  for (const f of rows) for (const o of f.options || []) {
    const c = String(o?.ar || o?.key || '').trim();
    if (c && !out.includes(c)) out.push(c);
  }
  return out;
};

exports.listFields = async (req, res) => {
  try {
    // ?all=1 → the settings page (inactive rows included); default → the form.
    // Tombstoned system fields are gone from BOTH views — see the model.
    const filter = req.query.all ? { deleted: { $ne: true } } : { active: true, deleted: { $ne: true } };
    const fields = await ShipmentOrderField.find(filter).sort({ group: 1, order: 1 }).lean();
    // The branch field offers all our branches, not a list written here.
    // Its options are read from the company's branch list itself, Branches in reference data (workflow_paying_branch), which is the statement and payment branch, and branches cannot be added from the form.
    const branch = fields.find((f) => f.key === 'branch');
    if (branch) {
      branch.options = await companyBranchOptions();
      branch.locked = true;
    }
    // «From / To» start from the owner's list (config/shipmentCities); cities added in the section settings join it.
    const base = require('../config/shipmentCities');
    for (const f of fields) {
      if (f.key !== 'fromCity' && f.key !== 'toCity') continue;
      const added = (f.options || []).filter((o) => o && (o.ar || o.key) && !base.includes(o.ar || o.key));
      f.options = [...base.map((c) => ({ key: c, ar: c, en: c })), ...added];
      f.inputType = 'select';
    }
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
    return sendMongooseError(res, error, 'Failed to create the field');
  }
};

exports.updateField = async (req, res) => {
  try {
    const field = await ShipmentOrderField.findById(req.params.id);
    if (!field) return res.status(404).json({ message: 'Field not found' });
    const data = pick(req.body, FIELD_EDITABLE);
    // A system field's group is part of the wiring; its look and words are not.
    if (field.isSystem) delete data.group;
    // Payment type has four types keyed like the operations workflow; a fifth option or a renamed one would split the order from the statement. So its shape, label and requiredness are configurable, not its options.
    if (field.key === 'branch') delete data.options; // From the company branches, see listFields
    if (field.key === 'paymentSubtype') {
      delete data.options;
      if (data.inputType && !['cards', 'select'].includes(data.inputType)) delete data.inputType;
    }
    Object.assign(field, data);
    await field.save();
    emit('shipmentOrders:fields', {});
    res.json({ field });
  } catch (error) {
    return sendMongooseError(res, error, 'Failed to update the field');
  }
};

// The only questions that cannot be deleted: other logic reads their answers. fromCity/toCity/sellPrice drive the per-customer route pricing and the waybill sheet; pickupTime dates the waybill. Everything else, system-seeded or user-added, is the section owner's to remove.
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
  // Pickup and delivery
  { key: 'fromCity', labelAr: 'من المدينة', labelEn: 'From city', group: 'pickup_delivery', inputType: 'select', options: opts(CITIES), required: true, order: 1 },
  { key: 'toCity', labelAr: 'إلى المدينة', labelEn: 'To city', group: 'pickup_delivery', inputType: 'select', options: opts(CITIES), required: true, order: 2 },
  // Shipment details
  { key: 'truckType', labelAr: 'نوع الشاحنة', labelEn: 'Truck type', group: 'shipment', inputType: 'cards', options: opts(['سطحة', 'تريلا جوانب', 'تريلا ستارة', 'براد', 'دينا', 'لوبد', 'صهريج']), required: true, order: 1 },
  { key: 'cargoType', labelAr: 'نوع الحمولة', labelEn: 'Cargo type', group: 'shipment', inputType: 'select', options: opts(['بضائع عامة', 'مواد بناء', 'حديد', 'أسمنت', 'مواد غذائية', 'أجهزة ومعدات', 'أثاث', 'كيماويات', 'أخرى']), order: 2 },
  { key: 'truckLength', labelAr: 'طول الشاحنة', labelEn: 'Truck length', group: 'shipment', inputType: 'number', order: 3 },
  { key: 'quantity', labelAr: 'الكمية', labelEn: 'Quantity', group: 'shipment', inputType: 'number', order: 4 },
  { key: 'driverName', labelAr: 'السائق', labelEn: 'Driver', group: 'shipment', inputType: 'text', order: 5 },
  { key: 'driverPhone', labelAr: 'جوال السائق', labelEn: 'Driver phone', group: 'shipment', inputType: 'text', order: 6 },
  { key: 'vehicleName', labelAr: 'السيارة / رقم اللوحة', labelEn: 'Vehicle / plate', group: 'shipment', inputType: 'text', order: 7 },
  // Prices and timing
  // Shipment dates are by day, see `inputType` in models/ShipmentOrderField.
  { key: 'pickupTime', labelAr: 'تاريخ الاستلام', labelEn: 'Pickup date', group: 'pricing_time', inputType: 'date', required: true, order: 1 },
  { key: 'startTime', labelAr: 'تاريخ البداية', labelEn: 'Start date', group: 'pricing_time', inputType: 'date', order: 2 },
  { key: 'arrivalTime', labelAr: 'تاريخ الوصول', labelEn: 'Arrival date', group: 'pricing_time', inputType: 'date', order: 3 },
  // Buying price is required and selling optional, see migratePriceRequired.
  // Buying comes before selling, see migratePriceOrder.
  { key: 'buyPrice', labelAr: 'سعر الشراء', labelEn: 'Buy price', group: 'pricing_time', inputType: 'number', required: true, order: 4 },
  { key: 'sellPrice', labelAr: 'سعر البيع', labelEn: 'Sell price', group: 'pricing_time', inputType: 'number', order: 5 },
  // Advance to the driver: an optional number.
  { key: 'advanceAmount', labelAr: 'السلفة', labelEn: 'Advance', group: 'pricing_time', inputType: 'number', order: 6 },
  // Payments
  // Payment type replaced driver rental type and payment method, see migratePaymentSubtypeField. So the two are not seeded in a new database; they stay hidden in settings for anyone who wants to show them.
  { key: 'paymentSubtype', labelAr: 'نوع الدفع', labelEn: 'Payment type', group: 'payment', inputType: 'cards', options: paymentSubtypeOptions(), order: 1 },
  // The branch is in Pickup and delivery, not Payments, see migrateBranchGroup.
  { key: 'branch', labelAr: 'الفرع', labelEn: 'Branch', group: 'pickup_delivery', inputType: 'select', options: opts(['جدة', 'الرياض', 'الدمام', 'جازان']), order: 3 },
];

/**
 * Driver rental type becomes payment type, a one-time migration run while the payment type row does not exist.
 * Payment type is created at the old row's order, keeping its requiredness.
 * Driver rental type and payment method are hidden (`active: false`), not deleted: reversible from settings, and old orders keep and print their values. Payment method now follows payment type on the server, so its form field is redundant.
 * Never rerun, so a field shown by hand is not hidden again.
 */
async function migratePaymentSubtypeField() {
  if (await ShipmentOrderField.exists({ key: 'paymentSubtype' })) {
    // The four options are re-asserted at every startup: they are the workflow keys and names, and are locked in settings, see updateField.
    await ShipmentOrderField.updateOne({ key: 'paymentSubtype' }, { $set: { options: paymentSubtypeOptions() } });
    return;
  }
  const old = await ShipmentOrderField.findOne({ key: 'driverRentType' }).lean();
  await ShipmentOrderField.create({
    key: 'paymentSubtype',
    labelAr: 'نوع الدفع',
    labelEn: 'Payment type',
    group: 'payment',
    inputType: 'cards',
    options: paymentSubtypeOptions(),
    required: !!(old && old.required && !old.deleted),
    order: old && Number.isFinite(old.order) ? old.order : 1,
    isSystem: true,
  });
  await ShipmentOrderField.updateMany(
    { key: { $in: ['driverRentType', 'paymentMethod'] } },
    { $set: { active: false } },
  );
}

/**
 * Buying price required, selling not.
 * Buying is known at booking (it is what was agreed with the supplier), while selling may be priced later. The two fields' `required` is set from settings in the database and seeding does not touch an existing row, so the setting is flipped once with a flag in `migrations`, then belongs to whoever sets it in settings and startup does not redo it.
 */
async function migratePriceRequired() {
  const marks = mongoose.connection.collection('migrations');
  const id = 'so-buy-required-sell-optional-2026-10-26';
  if (await marks.findOne({ _id: id })) return;
  await ShipmentOrderField.updateOne({ key: 'sellPrice' }, { $set: { required: false } });
  await ShipmentOrderField.updateOne({ key: 'buyPrice' }, { $set: { required: true } });
  // upsert, not insert: both workers start together and the second insert threw a duplicate key error.
  await marks.updateOne({ _id: id }, { $setOnInsert: { at: new Date() } }, { upsert: true });
}

/**
 * The branch moves to Pickup and delivery.
 * It is the load's branch, not the payment branch, so it is asked with the two cities. The field's group in the database is set from settings, so it is moved once with a flag and startup does not redo it.
 */
/** Buying price before selling price: once with a flag, then belongs to whoever orders from settings. */
async function migratePriceOrder() {
  const marks = mongoose.connection.collection('migrations');
  const id = 'so-buy-before-sell-2026-10-26';
  if (await marks.findOne({ _id: id })) return;
  await ShipmentOrderField.updateOne({ key: 'buyPrice' }, { $set: { order: 4 } });
  await ShipmentOrderField.updateOne({ key: 'sellPrice' }, { $set: { order: 5 } });
  await marks.updateOne({ _id: id }, { $setOnInsert: { at: new Date() } }, { upsert: true });
}

async function migrateBranchGroup() {
  const marks = mongoose.connection.collection('migrations');
  const id = 'so-branch-to-pickup-delivery-2026-10-26';
  if (await marks.findOne({ _id: id })) return;
  await ShipmentOrderField.updateOne({ key: 'branch' }, { $set: { group: 'pickup_delivery', order: 3 } });
  // upsert, not insert: both workers start together and the second insert threw a duplicate key error.
  await marks.updateOne({ _id: id }, { $setOnInsert: { at: new Date() } }, { upsert: true });
}

exports.ensureShipmentOrderDefaults = async () => {
  // Dropped by request: the addresses added typing, not information. Removing them from the seed alone would leave the old rows; removing the rows alone would let the seed resurrect them. Both, idempotently.
  // Driver rental price is removed with them: the driver is not rented at a separate price in this section, the supplier purchase is the number, and a third field beside it is filled by guess or left empty in every row.
  await ShipmentOrderField.deleteMany({ key: { $in: ['addressFrom', 'addressTo', 'driverRentPrice'] } });

  // Dates seeded with an hour are converted to a day.
  // The three were seeded as `datetime` before this change and seeding does not touch an existing row, so the screen would keep asking for an hour forever. This corrects a question's type and cancels nobody's edit: label, order and settings stay.
  await ShipmentOrderField.updateMany(
    { key: { $in: ['pickupTime', 'startTime', 'arrivalTime'] }, inputType: 'datetime' },
    { $set: { inputType: 'date' } },
  );

  await migratePaymentSubtypeField();
  await migratePriceRequired();
  await migrateBranchGroup();
  await migratePriceOrder();

  for (const f of SYSTEM_FIELDS) {
    // eslint-disable-next-line no-await-in-loop
    const exists = await ShipmentOrderField.exists({ key: f.key });
    if (!exists) await ShipmentOrderField.create({ ...f, isSystem: true });
  }
  // Our own fleet: the Location Solutions trucks are our trucks, so they show in the vehicle picker as our fleet from day one instead of being retyped. Read-only from Ls2Vehicle; idempotent by plate; never overwrites an edit. The trial section stays independent of ops, but our own fleet is ours.
  try {
    const Ls2Vehicle = require('../models/Ls2Vehicle');
    const live = await Ls2Vehicle.find({}).select('plate name driver').lean();
    for (const v of live) {
      const plate = String(v.plate || '').trim() || String(v.name || '').trim();
      if (!plate) continue;
      // Looked up by plate key, not text.
      // The lookup used to be by text, so when the same truck came from the platform in another format it was created again: 58 trucks of our fleet were registered twice.
      const { registryPlateKey, formatPlate } = require('../utils/plateKey');
      // eslint-disable-next-line no-await-in-loop
      const exists = await ShipmentOrderVehicle.findOne({ $or: [{ plate }, { plateKey: registryPlateKey(formatPlate(plate)) || '-' }] }).select('_id').lean();
      if (!exists) {
        // eslint-disable-next-line no-await-in-loop
        const created = await ShipmentOrderVehicle.create({
          plate,
          name: '',
          truckType: 'سطحة', // the LS2 fleet is flatbed heavy trucks
          supplier: null,
          ownership: 'ours',  // Explicit: absence means unknown, not ours
          defaultDriverName: String(v.driver || '').trim(),
          notes: 'من لوكيشن سوليوشن',
        });
        // eslint-disable-next-line no-await-in-loop
        await syncVehicleMaster(created._id);
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


/**
 * A new option added from the shipment creation screen: POST /fields/:id/options
 * A city missing from the list would force the user out to settings and lose what he typed. The option is written into the same field definition, so it appears in settings and to everyone with the screen open (`so:fields`).
 * Add only, for those who may create shipments; it creates no field and deletes no option.
 */
exports.addFieldOption = async (req, res) => {
  try {
    const ShipmentOrderField = require('../models/ShipmentOrderField');
    const field = await ShipmentOrderField.findById(req.params.id);
    if (!field || field.deleted) return res.status(404).json({ message: 'الحقل غير موجود' });
    if (!['select', 'cards'].includes(field.inputType)) {
      return res.status(400).json({ message: 'هذا الحقل ليس قائمةَ اختيار' });
    }
    if (field.key === 'paymentSubtype') {
      return res.status(400).json({ message: 'أنواعُ الدفع أربعةٌ ثابتة — لا يُضاف إليها من هنا' });
    }
    if (field.key === 'branch') {
      return res.status(400).json({ message: 'الفروعُ فروعُ الشركة — تُضاف من البيانات المرجعيّة («الفروع المسدِّدة»)، لا من هنا' });
    }
    const ar = String(req.body.ar || req.body.label || '').trim();
    if (!ar) return res.status(400).json({ message: 'اكتب الاسم' });
    const key = String(req.body.key || ar).trim();
    const exists = (field.options || []).some((o) => String(o.key).trim() === key
      || String(o.ar || '').trim() === ar);
    if (exists) return res.status(409).json({ message: 'موجود في القائمة', field });
    field.options.push({
      key, ar, en: String(req.body.en || '').trim(),
      paymentMethod: String(req.body.paymentMethod || '').trim(),
    });
    await field.save();
    // The same event the screens hear for other form changes: it used to broadcast under a third name nobody listened to, so the option was added but a colleague with the page open did not see it.
    emit('shipmentOrders:fields', { id: String(field._id) });
    try { require('../utils/ttlCache').clear('so:'); } catch (_) { /* */ }
    res.status(201).json({ field });
  } catch (e) {
    console.error('addFieldOption', e);
    res.status(500).json({ message: 'تعذّرت الإضافة' });
  }
};
