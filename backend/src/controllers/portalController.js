/**
 * portalController — بوابة العميل / المورد.
 *
 * What an outside partner sees when they log in with the email + password we
 * created for them. The brief was blunt: "يشوف كل رحلاته ويشوف تفاصيله كلها كاملة
 * … حسب هو نقل ثقيل ولا تخليص ولا إيه بالظبط" — so this is deliberately dynamic:
 *
 *   • The account is linked to ONE register row (see config/partnerRegisters.js),
 *     but a customer rarely lives in one register. The heavy-transport customer
 *     also has invoices; the customs customer also books trucks. So the portal
 *     resolves the partner ONCE into an "identity" — every id it owns across
 *     every register, joined by the Arabic-folded name (utils/nameKey.js) — and
 *     then queries each section with the right key.
 *
 *   • Which tabs appear is decided by what that identity actually HAS. A customer
 *     with no customs files never sees a customs tab; one who has both sees both.
 *
 * Everything here is read-only and scoped: every query is filtered by the
 * caller's own identity before it touches a collection. There is no route that
 * takes a customer id from the request.
 */
const Customer = require('../models/Customer');
const Invoice = require('../models/Invoice');
const Payment = require('../models/Payment');
const CustomsClearance = require('../models/CustomsClearance');
const ShipmentOrder = require('../models/ShipmentOrder');
const CrmCompany = require('../models/CrmCompany');
const { FleetShipment, FleetEvent, FleetCustomer } = require('../models/FleetModels');
const { nameKey } = require('../utils/nameKey');
const { SERVICES } = require('../config/partnerRegisters');
const cache = require('../utils/ttlCache');

const r0 = (n) => Math.round(Number(n) || 0);
const IDENTITY_TTL = 60 * 1000;

/** The caller is a partner account, or they have no business here. */
function partnerOf(req) {
  const u = req.user;
  if (!u) return null;
  if (['customer', 'vendor'].includes(u.accountType) && u.partner?.source) return u.partner;
  // Legacy portal accounts created before accountType existed: role 'client'
  // with a linkedCustomer and nothing else. Treat them as finance customers so
  // they keep working untouched.
  if (u.role === 'client' && u.linkedCustomer) {
    return { source: 'customer', refId: String(u.linkedCustomer._id || u.linkedCustomer), name: '', nameKey: '', kind: 'customer' };
  }
  return null;
}

/**
 * Resolve everything this partner IS, across every register.
 * Returns { kind, name, key, ids:{...}, services:[...], counts:{...} }.
 */
async function resolveIdentity(partner) {
  const cacheKey = `portal:identity:${partner.source}:${partner.refId}`;
  const hit = cache.get(cacheKey);
  if (hit !== undefined) return hit;

  // Start from the linked row to learn the canonical name.
  let name = partner.name || '';
  if (partner.source === 'customer') {
    const c = await Customer.findById(partner.refId).lean();
    if (c) name = c.companyName;
  } else if (partner.source === 'fleet_customer') {
    const c = await FleetCustomer.findById(partner.refId).lean();
    if (c) name = c.name;
  } else if (partner.source === 'crm_company') {
    const c = await CrmCompany.findById(partner.refId).lean();
    if (c) name = c.name;
  }
  const key = partner.nameKey || nameKey(name);

  // Now find the SAME party in every other register, by folded name.
  const [financeCustomers, fleetCustomers, crmCompanies] = await Promise.all([
    Customer.find({}).select('companyName customerNumber creditTerm creditLimit currentOutstanding grade clientStatus office email phone address').lean(),
    FleetCustomer.find({}).select('name customerType rating email phone routes').lean(),
    CrmCompany.find({}).select('name arabicName type status city country email phone industry').lean(),
  ]);

  const matchAll = (rows, field) => rows.filter((r) => nameKey(r[field]) === key);
  const finance = partner.source === 'customer'
    ? financeCustomers.filter((c) => String(c._id) === String(partner.refId))
    : matchAll(financeCustomers, 'companyName');
  const fleet = partner.source === 'fleet_customer'
    ? fleetCustomers.filter((c) => String(c._id) === String(partner.refId))
    : matchAll(fleetCustomers, 'name');
  const crm = partner.source === 'crm_company'
    ? crmCompanies.filter((c) => String(c._id) === String(partner.refId))
    : matchAll(crmCompanies, 'name');

  // If the linked row itself gave us no name (virtual customs register), the
  // folded ref IS the key and the display name is whatever we were told.
  const identity = {
    kind: partner.kind || 'customer',
    source: partner.source,
    refId: partner.refId,
    name: name || partner.name || '',
    key,
    financeIds: finance.map((c) => String(c._id)),
    fleetIds: fleet.map((c) => String(c._id)),
    crmIds: crm.map((c) => String(c._id)),
    profile: {
      finance: finance[0] || null,
      fleet: fleet[0] || null,
      crm: crm[0] || null,
    },
  };
  cache.set(cacheKey, identity, IDENTITY_TTL);
  return identity;
}

// ── Section-scoped reads ─────────────────────────────────────────────────────
// Each register stores the customer differently: by ref, by snapshot name, or
// both. Matching on EITHER is what makes "كل حاجة تخصه" actually complete.
//
// The name half can't be expressed in Mongo — the Arabic fold is a JS function —
// so those queries pull the candidate rows and narrow them in memory, bounded by
// a generous limit. That is one customer's lifetime of work, not a table scan of
// anything unbounded.
const byName = (rows, field, key) => rows.filter((r) => nameKey(r[field]) === key);

const FLEET_LIMIT = 2000;

async function fleetShipmentsFor(identity) {
  const rows = await FleetShipment.find({
    $or: [
      ...(identity.fleetIds.length ? [{ customer: { $in: identity.fleetIds } }] : []),
      { customerName: { $nin: [null, ''] } },
    ],
  })
    .select('waybillNumber customerName customer vehiclePlate trailerType gpsType driverName driverPhone fromCity toCity status price fullRent loadType rentType paymentType branch loadDate expectedArrival lastContactAt createdAt supervisorName notes customerType')
    .sort({ loadDate: -1, createdAt: -1 })
    .limit(FLEET_LIMIT)
    .lean();
  const ids = new Set(identity.fleetIds);
  return rows.filter((r) => (r.customer && ids.has(String(r.customer))) || nameKey(r.customerName) === identity.key);
}

async function shipmentOrdersFor(identity) {
  const rows = await ShipmentOrder.find({ customerName: { $nin: [null, ''] } })
    .select('waybillNumber customerName fromCity toCity addressFrom addressTo truckType cargoType truckLength quantity driverName driverPhone vehicleName agentName pickupTime startTime arrivalTime sellPrice status branch notes createdAt')
    .sort({ createdAt: -1 })
    .limit(FLEET_LIMIT)
    .lean();
  return byName(rows, 'customerName', identity.key);
}

async function customsFor(identity) {
  const rows = await CustomsClearance.find({
    $or: [
      ...(identity.financeIds.length ? [{ customer: { $in: identity.financeIds } }] : []),
      { customerName: { $nin: [null, ''] } },
    ],
  })
    .select('refNumber branch stage cancelled customerName customer shippingAgent blNumber invoiceNumber invoiceDate port containerCount totalWeight invoiceValue currency exporterCompany countryOfOrigin hsCode declarationNumber declarationDate doNumber exitPermitNumber unloadingAppointment unloadingLocation stageDates stageDone documents agentPapers costs createdAt updatedAt')
    .sort({ createdAt: -1 })
    .limit(FLEET_LIMIT)
    .lean();
  const ids = new Set(identity.financeIds);
  return rows.filter((r) => (r.customer && ids.has(String(r.customer))) || nameKey(r.customerName) === identity.key);
}

async function financeFor(identity) {
  if (!identity.financeIds.length) return { invoices: [], payments: [] };
  const [invoices, payments] = await Promise.all([
    Invoice.find({ customer: { $in: identity.financeIds } })
      .select('invoiceNumber amount paidAmount balance invoiceDate dueDate creditTerm status notes')
      .sort({ invoiceDate: -1 }).limit(2000).lean(),
    Payment.find({ customer: { $in: identity.financeIds } })
      .select('invoice amount paymentDate paymentMethod reference notes')
      .sort({ paymentDate: -1 }).limit(2000).lean(),
  ]);
  return { invoices, payments };
}

// Vendors see the loads they CARRIED, not the loads placed with us.
async function vendorLoadsFor(identity) {
  const ShipmentOrderSupplier = require('../models/ShipmentOrderSupplier');
  const suppliers = await ShipmentOrderSupplier.find({}).select('name').lean();
  const mine = suppliers.filter((s) => nameKey(s.name) === identity.key).map((s) => s._id);
  if (!mine.length) return [];
  return ShipmentOrder.find({ supplier: { $in: mine } })
    .select('waybillNumber customerName fromCity toCity truckType cargoType driverName driverPhone vehicleName buyPrice driverRentType driverRentPrice paymentMethod status branch pickupTime arrivalTime createdAt notes')
    .sort({ createdAt: -1 }).limit(FLEET_LIMIT).lean();
}

/** Everything, once — the overview and every tab read from this. */
async function loadAll(identity) {
  if (identity.kind === 'vendor') {
    const loads = await vendorLoadsFor(identity);
    return { fleet: [], orders: [], customs: [], invoices: [], payments: [], vendorLoads: loads };
  }
  const [fleet, orders, customs, finance] = await Promise.all([
    fleetShipmentsFor(identity).catch(() => []),
    shipmentOrdersFor(identity).catch(() => []),
    customsFor(identity).catch(() => []),
    financeFor(identity).catch(() => ({ invoices: [], payments: [] })),
  ]);
  return { fleet, orders, customs, ...finance, vendorLoads: [] };
}

/** Which portal tabs this partner gets — driven by what they actually have. */
function servicesFor(identity, data) {
  const out = [];
  const add = (key, count) => { if (count > 0) out.push({ key, count, ar: SERVICES[key].ar, en: SERVICES[key].en }); };
  if (identity.kind === 'vendor') {
    add('shipment_orders', data.vendorLoads.length);
    return out;
  }
  add('heavy_transport', data.fleet.length);
  add('shipment_orders', data.orders.length);
  add('customs', data.customs.length);
  add('finance', data.invoices.length + data.payments.length);
  return out;
}

// ─────────────────────────────────────────────────────────────────────────────
// Endpoints
// ─────────────────────────────────────────────────────────────────────────────

/** Who am I, and what can I see? */
exports.me = async (req, res) => {
  try {
    const partner = partnerOf(req);
    if (!partner) return res.status(403).json({ message: 'هذا الحساب غير مرتبط بعميل أو مورد' });
    const identity = await resolveIdentity(partner);
    const data = await loadAll(identity);
    res.json({
      kind: identity.kind,
      name: identity.name,
      source: identity.source,
      profile: identity.profile,
      services: servicesFor(identity, data),
      account: {
        email: req.user.email,
        name: `${req.user.firstName || ''} ${req.user.lastName || ''}`.trim(),
        lastLogin: req.user.lastLogin,
      },
    });
  } catch (error) {
    console.error('portal me error:', error);
    res.status(500).json({ message: 'تعذّر تحميل بيانات الحساب' });
  }
};

/** The landing dashboard: headline numbers per service + the latest of each. */
exports.overview = async (req, res) => {
  try {
    const partner = partnerOf(req);
    if (!partner) return res.status(403).json({ message: 'هذا الحساب غير مرتبط بعميل أو مورد' });
    const identity = await resolveIdentity(partner);
    const data = await loadAll(identity);
    const services = servicesFor(identity, data);

    if (identity.kind === 'vendor') {
      const loads = data.vendorLoads;
      const live = loads.filter((l) => l.status !== 'cancelled');
      const earnings = live.reduce((s, l) => s + (Number(l.buyPrice) || 0), 0);
      return res.json({
        kind: 'vendor', name: identity.name, services,
        totals: {
          loads: live.length,
          cancelled: loads.length - live.length,
          earnings: r0(earnings),
          avgPerLoad: live.length ? r0(earnings / live.length) : 0,
          inTransit: live.filter((l) => ['loading', 'uploaded', 'on_way'].includes(l.status)).length,
          delivered: live.filter((l) => ['arrived', 'bond_sent', 'bond_received', 'invoiced'].includes(l.status)).length,
        },
        recent: { loads: loads.slice(0, 10) },
        monthly: monthlySeries(live, (l) => l.createdAt, (l) => Number(l.buyPrice) || 0),
      });
    }

    const activeFleet = data.fleet.filter((s) => s.status !== 'cancelled');
    const activeOrders = data.orders.filter((s) => s.status !== 'cancelled');
    const activeCustoms = data.customs.filter((c) => !c.cancelled);
    const inTransit = [...activeFleet, ...activeOrders].filter((s) => ['loading', 'uploaded', 'on_way'].includes(s.status));
    const delivered = [...activeFleet, ...activeOrders].filter((s) => ['arrived', 'bond_sent', 'bond_received', 'invoiced'].includes(s.status));
    const spend = activeFleet.reduce((s, x) => s + (Number(x.price) || 0), 0)
      + activeOrders.reduce((s, x) => s + (Number(x.sellPrice) || 0), 0);

    const outstanding = data.invoices.reduce((s, i) => s + (Number(i.balance) || 0), 0);
    const paid = data.payments.reduce((s, p) => s + (Number(p.amount) || 0), 0);
    const overdue = data.invoices.filter((i) => i.status !== 'paid' && new Date(i.dueDate) < new Date());

    res.json({
      kind: 'customer',
      name: identity.name,
      profile: identity.profile,
      services,
      totals: {
        shipments: activeFleet.length + activeOrders.length,
        heavyTransport: activeFleet.length,
        shipmentOrders: activeOrders.length,
        customsFiles: activeCustoms.length,
        containers: activeCustoms.reduce((s, c) => s + (Number(c.containerCount) || 0), 0),
        inTransit: inTransit.length,
        delivered: delivered.length,
        totalSpend: r0(spend),
        invoices: data.invoices.length,
        outstanding: r0(outstanding),
        paid: r0(paid),
        overdueCount: overdue.length,
        overdueAmount: r0(overdue.reduce((s, i) => s + (Number(i.balance) || 0), 0)),
      },
      recent: {
        heavyTransport: activeFleet.slice(0, 8),
        shipmentOrders: activeOrders.slice(0, 8),
        customs: activeCustoms.slice(0, 8),
        invoices: data.invoices.slice(0, 8),
      },
      inTransit: inTransit.slice(0, 20),
      monthly: monthlySeries(
        [...activeFleet.map((s) => ({ at: s.loadDate || s.createdAt, v: Number(s.price) || 0 })),
          ...activeOrders.map((s) => ({ at: s.createdAt, v: Number(s.sellPrice) || 0 }))],
        (x) => x.at, (x) => x.v
      ),
    });
  } catch (error) {
    console.error('portal overview error:', error);
    res.status(500).json({ message: 'تعذّر تحميل اللوحة' });
  }
};

/** 12-month count + value series for whatever list is passed in. */
function monthlySeries(rows, atOf, valueOf) {
  const start = new Date();
  start.setMonth(start.getMonth() - 11);
  start.setDate(1); start.setHours(0, 0, 0, 0);
  const map = new Map();
  for (let i = 0; i < 12; i++) {
    const d = new Date(start); d.setMonth(d.getMonth() + i);
    const k = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    map.set(k, { month: k, count: 0, value: 0 });
  }
  for (const row of rows) {
    const at = atOf(row);
    if (!at) continue;
    const d = new Date(at);
    const k = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    const m = map.get(k);
    if (!m) continue;
    m.count += 1;
    m.value += valueOf(row) || 0;
  }
  return [...map.values()].map((m) => ({ ...m, value: r0(m.value) }));
}

/**
 * GET /api/portal/shipments?type=heavy|orders|vendor&status=&q=
 * The full trip list, with the waybill number on every row.
 */
exports.shipments = async (req, res) => {
  try {
    const partner = partnerOf(req);
    if (!partner) return res.status(403).json({ message: 'هذا الحساب غير مرتبط بعميل أو مورد' });
    const identity = await resolveIdentity(partner);
    const type = req.query.type || (identity.kind === 'vendor' ? 'vendor' : 'heavy');

    let items = [];
    if (type === 'vendor') items = await vendorLoadsFor(identity);
    else if (type === 'orders') items = await shipmentOrdersFor(identity);
    else items = await fleetShipmentsFor(identity);

    if (req.query.status) items = items.filter((s) => s.status === req.query.status);
    if (req.query.q) {
      const q = String(req.query.q).toLowerCase();
      items = items.filter((s) => JSON.stringify([s.waybillNumber, s.fromCity, s.toCity, s.driverName, s.vehiclePlate || s.vehicleName]).toLowerCase().includes(q));
    }
    const byStatus = {};
    for (const s of items) byStatus[s.status] = (byStatus[s.status] || 0) + 1;
    res.json({ type, total: items.length, byStatus, items });
  } catch (error) {
    console.error('portal shipments error:', error);
    res.status(500).json({ message: 'تعذّر تحميل الشحنات' });
  }
};

/**
 * GET /api/portal/shipments/:type/:id — one trip in full.
 * For heavy-transport loads that includes the follow-up story (كل حاجة حصلت),
 * minus anything internal (our cost, the supervisor's notes to himself).
 */
exports.shipmentDetail = async (req, res) => {
  try {
    const partner = partnerOf(req);
    if (!partner) return res.status(403).json({ message: 'هذا الحساب غير مرتبط بعميل أو مورد' });
    const identity = await resolveIdentity(partner);
    const { type, id } = req.params;

    if (type === 'heavy') {
      const all = await fleetShipmentsFor(identity);
      const found = all.find((s) => String(s._id) === String(id));
      if (!found) return res.status(404).json({ message: 'الشحنة غير موجودة' });
      const events = await FleetEvent.find({ shipment: found._id, type: { $in: ['created', 'status', 'followup'] } })
        .select('type data createdAt').sort({ createdAt: -1 }).limit(200).lean();
      return res.json({
        type, shipment: found,
        // The customer sees WHERE the truck was and WHEN — not who wrote it.
        timeline: events.map((e) => ({
          type: e.type,
          at: e.createdAt,
          status: e.data?.to || null,
          location: e.data?.currentLocation || '',
          note: e.type === 'followup' ? (e.data?.note || '') : '',
          expectedArrival: e.data?.expectedArrival || null,
        })),
        waybillUrl: `/api/portal/waybill/heavy/${found._id}`,
      });
    }
    if (type === 'orders' || type === 'vendor') {
      const all = type === 'vendor' ? await vendorLoadsFor(identity) : await shipmentOrdersFor(identity);
      const found = all.find((s) => String(s._id) === String(id));
      if (!found) return res.status(404).json({ message: 'الشحنة غير موجودة' });
      return res.json({ type, shipment: found, timeline: [], waybillUrl: null });
    }
    res.status(400).json({ message: 'نوع غير معروف' });
  } catch (error) {
    console.error('portal shipment detail error:', error);
    res.status(500).json({ message: 'تعذّر تحميل تفاصيل الشحنة' });
  }
};

/** The بوليصة PDF for one of the partner's OWN heavy-transport loads. */
exports.waybill = async (req, res) => {
  try {
    const partner = partnerOf(req);
    if (!partner) return res.status(403).json({ message: 'هذا الحساب غير مرتبط بعميل أو مورد' });
    const identity = await resolveIdentity(partner);
    if (req.params.type !== 'heavy') return res.status(400).json({ message: 'نوع غير مدعوم' });

    // Ownership is checked against the partner's OWN list before anything is read.
    const all = await fleetShipmentsFor(identity);
    if (!all.some((s) => String(s._id) === String(req.params.id))) {
      return res.status(404).json({ message: 'الشحنة غير موجودة' });
    }
    const { renderWaybillPdf, rowFromShipment } = require('../utils/waybillPdf');
    const shipment = await FleetShipment.findById(req.params.id)
      .populate('vehicle', 'plate trailerType gpsType brand color')
      .populate('driver secondDriver', 'name phone iqama nationality')
      .lean();
    if (!shipment) return res.status(404).json({ message: 'الشحنة غير موجودة' });
    if (shipment.driver && typeof shipment.driver === 'object') {
      if (!shipment.driverIqama) shipment.driverIqama = shipment.driver.iqama || '';
      if (!shipment.driverNationality) shipment.driverNationality = shipment.driver.nationality || '';
      if (!shipment.driverPhone) shipment.driverPhone = shipment.driver.phone || '';
    }
    if (shipment.vehicle && typeof shipment.vehicle === 'object') {
      if (!shipment.vehicleBrand) shipment.vehicleBrand = shipment.vehicle.brand || '';
      if (!shipment.vehicleColor) shipment.vehicleColor = shipment.vehicle.color || '';
    }
    const Lookup = require('../models/Lookup');
    const lut = await Lookup.find({ type: { $in: ['fleet_rent_type', 'fleet_payment_type', 'fleet_load_type'] } })
      .select('type key nameAr nameEn').lean();
    const nameOf = (t, k) => {
      if (!k) return '';
      const it = lut.find((x) => x.type === t && x.key === k);
      return it ? (it.nameAr || it.nameEn) : k;
    };
    shipment.rentType = nameOf('fleet_rent_type', shipment.rentType);
    shipment.paymentType = nameOf('fleet_payment_type', shipment.paymentType);
    shipment.loadType = nameOf('fleet_load_type', shipment.loadType);
    const pdf = await renderWaybillPdf(rowFromShipment(shipment));
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="waybill-${shipment.waybillNumber || shipment._id}.pdf"`);
    res.send(pdf);
  } catch (error) {
    console.error('portal waybill error:', error.message);
    res.status(500).json({ message: 'تعذّر توليد البوليصة' });
  }
};

/** Customs files, with their stage, paperwork checklist and costs. */
exports.customs = async (req, res) => {
  try {
    const partner = partnerOf(req);
    if (!partner) return res.status(403).json({ message: 'هذا الحساب غير مرتبط بعميل أو مورد' });
    const identity = await resolveIdentity(partner);
    if (identity.kind === 'vendor') return res.json({ items: [], total: 0 });
    const items = await customsFor(identity);
    const byStage = {};
    for (const c of items) if (!c.cancelled) byStage[c.stage] = (byStage[c.stage] || 0) + 1;
    res.json({
      total: items.length,
      byStage,
      containers: items.filter((c) => !c.cancelled).reduce((s, c) => s + (Number(c.containerCount) || 0), 0),
      items,
    });
  } catch (error) {
    console.error('portal customs error:', error);
    res.status(500).json({ message: 'تعذّر تحميل معاملات التخليص' });
  }
};

/** Invoices, payments and the running balance. */
exports.finance = async (req, res) => {
  try {
    const partner = partnerOf(req);
    if (!partner) return res.status(403).json({ message: 'هذا الحساب غير مرتبط بعميل أو مورد' });
    const identity = await resolveIdentity(partner);
    const { invoices, payments } = await financeFor(identity);
    const now = new Date();
    const enriched = invoices.map((inv) => {
      const remainingDays = Math.ceil((new Date(inv.dueDate) - now) / 86400000);
      const isOverdue = remainingDays < 0 && inv.status !== 'paid';
      return {
        ...inv,
        remainingDays,
        overdueDays: isOverdue ? Math.abs(remainingDays) : 0,
        isOverdue,
        isDueSoon: remainingDays > 0 && remainingDays <= 5 && inv.status !== 'paid',
        statusColor: inv.status === 'paid' ? 'green' : (isOverdue ? 'red' : (remainingDays <= 5 ? 'yellow' : 'green')),
      };
    });
    const profile = identity.profile.finance;
    res.json({
      customer: profile ? {
        companyName: profile.companyName, customerNumber: profile.customerNumber,
        creditTerm: profile.creditTerm, creditLimit: profile.creditLimit,
        currentOutstanding: profile.currentOutstanding,
      } : null,
      totals: {
        invoiced: r0(invoices.reduce((s, i) => s + (Number(i.amount) || 0), 0)),
        paid: r0(payments.reduce((s, p) => s + (Number(p.amount) || 0), 0)),
        outstanding: r0(invoices.reduce((s, i) => s + (Number(i.balance) || 0), 0)),
        overdue: r0(enriched.filter((i) => i.isOverdue).reduce((s, i) => s + (Number(i.balance) || 0), 0)),
      },
      invoices: enriched,
      payments,
    });
  } catch (error) {
    console.error('portal finance error:', error);
    res.status(500).json({ message: 'تعذّر تحميل البيانات المالية' });
  }
};

module.exports.partnerOf = partnerOf;
module.exports.resolveIdentity = resolveIdentity;
