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

  // ── العميلُ كما هو في كلّ الأقسام (services/customerHub، ٢٠٢٦/١٠/٢٤) ─────────
  // كان العميلُ يُعرَف باسمٍ واحد؛ فإن كُتب اسمُه في قسمٍ بصيغةٍ أخرى لم تظهر
  // رحلاتُه هناك. فتُجمع أسماؤه من الأمّ وكلِّ سجلٍّ مرتبطٍ بها وصيغِ اسمه في
  // التحصيل — مطابقةً تامّةً بعد الطيّ، لا تقريبًا (تقريبُ الأسماء يُري عميلًا
  // رحلاتِ غيره).
  let masterId = null;
  try {
    if (partner.source === 'crm_company') masterId = partner.refId;
    else if (partner.source === 'fleet_customer') masterId = (await FleetCustomer.findById(partner.refId).select('crmCompany').lean() || {}).crmCompany || null;
    else if (partner.source === 'shipment_order_customer') masterId = (await require('../models/ShipmentOrderCustomer').findById(partner.refId).select('crmCompany').lean() || {}).crmCompany || null;
  } catch (_) { /* */ }
  const names = new Set([name].filter(Boolean));
  const linkedFleet = [];
  if (masterId) {
    const hub = require('../services/customerHub');
    const m = await CrmCompany.findById(masterId).select('name').lean();
    if (m && m.name) names.add(m.name);
    for (const { reg, doc } of await hub.linkedRows(masterId)) {
      if (doc.name) names.add(doc.name);
      for (const a of doc.aliases || []) if (a) names.add(a);
      if (reg === 'fleet') linkedFleet.push(String(doc._id));
    }
  }
  const allNames = [...names];
  const keys = [...new Set([key, ...allNames.map((n) => nameKey(n))].filter(Boolean))];

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
    ? fleetCustomers.filter((c) => String(c._id) === String(partner.refId) || linkedFleet.includes(String(c._id)))
    : fleetCustomers.filter((c) => keys.includes(nameKey(c.name)) || linkedFleet.includes(String(c._id)));
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
    keys,
    names: allNames,
    masterId: masterId ? String(masterId) : null,
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
const owns = (identity, nm) => (identity.keys || [identity.key]).includes(nameKey(nm));
const byName = (rows, field, identity) => rows.filter((r) => owns(identity, r[field]));

const FLEET_LIMIT = 2000;

async function fleetShipmentsFor(identity) {
  const rows = await FleetShipment.find({
    $or: [
      ...(identity.fleetIds.length ? [{ customer: { $in: identity.fleetIds } }] : []),
      { customerName: { $nin: [null, ''] } },
    ],
  })
    // بلا سعرٍ ولا أجرة (٢٠٢٦/١٠/٢٤): «يشوف رحلاته من غير أسعار».
    .select('waybillNumber customerName customer vehiclePlate trailerType gpsType driverName driverPhone fromCity toCity status loadType rentType branch loadDate expectedArrival lastContactAt createdAt supervisorName notes customerType')
    .sort({ loadDate: -1, createdAt: -1 })
    .limit(FLEET_LIMIT)
    .lean();
  const ids = new Set(identity.fleetIds);
  return rows.filter((r) => (r.customer && ids.has(String(r.customer))) || owns(identity, r.customerName));
}

async function shipmentOrdersFor(identity) {
  const rows = await ShipmentOrder.find({ customerName: { $nin: [null, ''] } })
    .select('waybillNumber reference source graduationNumber customerName fromCity toCity addressFrom addressTo truckType cargoType truckLength quantity driverName driverPhone vehicleName agentName pickupTime startTime arrivalTime status branch notes createdAt')
    .sort({ createdAt: -1 })
    .limit(FLEET_LIMIT)
    .lean();
  return byName(rows, 'customerName', identity);
}

/**
 * رحلاتُ المنصّة — كشوفُ التشغيل باسم العميل (أيٍّ من أسمائه)، بلا أيّ مبلغ.
 */
async function platformTripsFor(identity) {
  const names = identity.names && identity.names.length ? identity.names : [identity.name].filter(Boolean);
  if (!names.length) return [];
  const OperationsWorkflow = require('../models/OperationsWorkflow');
  const rows = await OperationsWorkflow.find({ username: { $in: names } })
    .select('reportNumber reportDate username fromLocation toLocation applicationStatus executionStatus plateNumber carNumber driverName truckType truckSize loadType branch deliveryDate branchDeliveryDate documentNumber createdAt invoiceNumber invoiceDate')
    .sort({ reportDate: -1, createdAt: -1 }).limit(FLEET_LIMIT).lean();
  return rows.map((r) => ({
    _id: r._id, waybillNumber: r.reportNumber, customerName: r.username, fromCity: r.fromLocation, toCity: r.toLocation,
    status: r.applicationStatus, vehiclePlate: r.plateNumber || r.carNumber, driverName: r.driverName, truckType: r.truckType,
    truckSize: r.truckSize, branch: r.branch, loadDate: r.reportDate, deliveredAt: r.deliveryDate || r.branchDeliveryDate,
    documentNumber: r.documentNumber, createdAt: r.createdAt, loadType: r.loadType, executionStatus: r.executionStatus,
    invoice: { number: r.invoiceNumber, date: r.invoiceDate },
  }));
}

async function customsFor(identity) {
  const rows = await CustomsClearance.find({
    $or: [
      ...(identity.financeIds.length ? [{ customer: { $in: identity.financeIds } }] : []),
      { customerName: { $nin: [null, ''] } },
    ],
  })
    .select('refNumber branch stage cancelled customerName customer shippingAgent blNumber invoiceNumber invoiceDate port containerCount totalWeight invoiceValue currency exporterCompany countryOfOrigin hsCode declarationNumber declarationDate doNumber exitPermitNumber unloadingAppointment unloadingLocation stageDates stageDone documents agentPapers createdAt updatedAt cargoType isCompleted stagesDone transportRoute pipelineVersion saleInvoiceNumber containers.route containers.stagesDone')
    .sort({ createdAt: -1 })
    .limit(FLEET_LIMIT)
    .lean();
  const ids = new Set(identity.financeIds);
  // ── والعميلُ يرى مراحلَ معاملته كما هي ───────────────────────────────────
  // الدورةُ تتفرّع (ساحةٌ أو عميلٌ مباشرة، وسيّاراتٌ بلا إرجاع)، فالمرحلةُ
  // الحاليّةُ وحدَها لا تقول ما مضى وما بقي. فتُرسَل المراحلُ محسوبةً بقاعدة
  // القسم نفسِها (pipelineOf) — بلا سببِ الإغلاق الداخليّ ولا الحقولِ الخام.
  return rows
    .filter((r) => (r.customer && ids.has(String(r.customer))) || owns(identity, r.customerName))
    .map(({ stagesDone, transportRoute, pipelineVersion, saleInvoiceNumber, containers, ...r }) => {
      const p = CustomsClearance.pipelineOf({ ...r, containers, stagesDone, transportRoute, pipelineVersion, saleInvoiceNumber });
      return {
        ...r,
        cargoType: p.cargoType,
        pipeline: {
          ...p,
          steps: p.steps.map(({ key, done, locked, unitsDone, unitsOf }) => ({ key, done, locked, ...(unitsOf ? { unitsDone, unitsOf } : {}) })),
          units: undefined,
        },
      };
    });
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

// ── One shipment list for the customer ─────────────────────────────────────
// The customer used to see «رحلات النقل» (platform manifests) and «طلبات الشحن»
// (our shipment orders) as two lists — and an order pulled from the platform is
// the SAME manifest, so it showed twice. Now: one list, duplicates dropped,
// cancelled requests left out, and only what concerns the customer — no status,
// driver phone, quantity, branch, expected arrival or delivery date (those are
// operations' working data, owner's rule 2026-10-28).
const CANCELLED_RX = /^(cancel+ed|ملغ[يىا]ة?|ملغاة)$/i;
const isCancelled = (status) => CANCELLED_RX.test(String(status || '').trim());
const ymd = (d) => (d ? new Date(d).toISOString().slice(0, 10) : '');

function publicRow(kind, r) {
  if (kind === 'platform') {
    return {
      id: String(r._id), kind, number: r.waybillNumber ? String(r.waybillNumber) : '', date: ymd(r.loadDate || r.createdAt),
      from: r.fromCity || '', to: r.toCity || '', truck: [r.truckType, r.truckSize].filter(Boolean).join(' · '),
      plate: r.vehiclePlate || '', driver: r.driverName || '', cargo: r.loadType || '',
    };
  }
  if (kind === 'orders') {
    return {
      id: String(r._id), kind, number: r.reference || (r.waybillNumber != null ? String(r.waybillNumber) : ''), date: ymd(r.pickupTime || r.createdAt),
      from: r.fromCity || r.addressFrom || '', to: r.toCity || r.addressTo || '', truck: [r.truckType, r.truckLength].filter(Boolean).join(' · '),
      plate: r.vehicleName || '', driver: r.driverName || '', cargo: r.cargoType || '',
    };
  }
  return {
    id: String(r._id), kind: 'heavy', number: r.waybillNumber != null ? String(r.waybillNumber) : '', date: ymd(r.loadDate || r.createdAt),
    from: r.fromCity || '', to: r.toCity || '', truck: r.trailerType || '',
    plate: r.vehiclePlate || '', driver: r.driverName || '', cargo: r.loadType || '', waybill: true,
  };
}

function myShipments(data) {
  const platform = (data.platform || []).filter((r) => !isCancelled(r.status) && !isCancelled(r.executionStatus));
  const platformNos = new Set(platform.map((r) => String(r.waybillNumber || '')).filter(Boolean));
  const orders = (data.orders || []).filter((r) => !isCancelled(r.status)
    && !(r.graduationNumber != null && platformNos.has(String(r.graduationNumber))));
  const fleet = (data.fleet || []).filter((r) => !isCancelled(r.status));
  return [
    ...platform.map((r) => publicRow('platform', r)),
    ...orders.map((r) => publicRow('orders', r)),
    ...fleet.map((r) => publicRow('heavy', r)),
  ].sort((a, b) => String(b.date).localeCompare(String(a.date)));
}

/**
 * The customer's invoices: one row per invoice number on his manifests (no placeholders like «no inv»).
 * No money at all reaches the customer — no amounts, VAT or paid state (owner's rule).
 */
function myInvoices(data) {
  const { NO_INVOICE_RX } = require('../utils/paymentType');
  const by = new Map();
  for (const r of data.platform || []) {
    const inv = r.invoice || {};
    const no = String(inv.number || '').trim();
    if (!no || NO_INVOICE_RX.test(no) || isCancelled(r.status)) continue;
    const cur = by.get(no) || { number: no, date: '', shipments: 0, from: new Set(), to: new Set() };
    cur.shipments += 1;
    if (inv.date && (!cur.date || ymd(inv.date) > cur.date)) cur.date = ymd(inv.date);
    if (r.fromCity) cur.from.add(r.fromCity);
    if (r.toCity) cur.to.add(r.toCity);
    by.set(no, cur);
  }
  return [...by.values()].map((i) => ({
    number: i.number, date: i.date, shipments: i.shipments,
    routes: `${[...i.from].slice(0, 2).join('، ')} ← ${[...i.to].slice(0, 2).join('، ')}`,
  })).sort((a, b) => String(b.date).localeCompare(String(a.date)));
}

/** Everything, once — the overview and every tab read from this. */
// Every portal page reads the same lists: kept 30 s per partner.
async function loadAll(identity) {
  return cache.wrap(`portal:data:${identity.source}:${identity.refId}`, 30 * 1000, () => loadAllFresh(identity));
}
async function loadAllFresh(identity) {
  if (identity.kind === 'vendor') {
    const loads = await vendorLoadsFor(identity);
    return { fleet: [], orders: [], customs: [], invoices: [], payments: [], vendorLoads: loads };
  }
  // والفواتيرُ والمدفوعاتُ لا تُعرض للعميل — البوابةُ بلا أسعار (٢٠٢٦/١٠/٢٤).
  const [fleet, orders, customs, platform] = await Promise.all([
    fleetShipmentsFor(identity).catch(() => []),
    shipmentOrdersFor(identity).catch(() => []),
    customsFor(identity).catch(() => []),
    platformTripsFor(identity).catch(() => []),
  ]);
  return { fleet, orders, customs, platform, invoices: [], payments: [], vendorLoads: [] };
}

/** Which portal tabs this partner gets — driven by what they actually have. */
function servicesFor(identity, data) {
  const out = [];
  const add = (key, count) => { if (count > 0) out.push({ key, count, ar: SERVICES[key].ar, en: SERVICES[key].en }); };
  if (identity.kind === 'vendor') {
    add('shipment_orders', data.vendorLoads.length);
    return out;
  }
  add('shipments', myShipments(data).length);
  add('invoices', myInvoices(data).length);
  add('operations', (data.platform || []).length);
  add('heavy_transport', data.fleet.length);
  add('shipment_orders', data.orders.length);
  add('customs', data.customs.length);
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

    const shipments = myShipments(data);
    const invoices = myInvoices(data);
    const activeCustoms = data.customs.filter((c) => !c.cancelled);
    const monthKey = (d) => String(d || '').slice(0, 7);
    const now = new Date();
    const thisMonth = now.toISOString().slice(0, 7);
    const prev = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 15)).toISOString().slice(0, 7);
    const top = (list, keyOf, n) => {
      const m = new Map();
      for (const x of list) { const k = keyOf(x); if (k) m.set(k, (m.get(k) || 0) + 1); }
      return [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, n).map(([label, count]) => ({ label, count }));
    };

    res.json({
      kind: 'customer',
      name: identity.name,
      profile: identity.profile,
      services,
      totals: {
        shipments: shipments.length,
        thisMonth: shipments.filter((x) => monthKey(x.date) === thisMonth).length,
        lastMonth: shipments.filter((x) => monthKey(x.date) === prev).length,
        routes: new Set(shipments.map((x) => `${x.from}→${x.to}`)).size,
        destinations: new Set(shipments.map((x) => x.to).filter(Boolean)).size,
        customsFiles: activeCustoms.length,
        containers: activeCustoms.reduce((a, c) => a + (Number(c.containerCount) || 0), 0),
        invoices: invoices.length,
      },
      topRoutes: top(shipments, (x) => (x.from || x.to ? `${x.from || '—'} ← ${x.to || '—'}` : ''), 6),
      trucks: top(shipments, (x) => x.truck, 5),
      recent: { shipments: shipments.slice(0, 8), invoices: invoices.slice(0, 5), customs: activeCustoms.slice(0, 5) },
      monthly: monthlySeries(shipments, (x) => x.date, () => 0),
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
    const type = req.query.type || (identity.kind === 'vendor' ? 'vendor' : 'all');

    if (type === 'all' && identity.kind !== 'vendor') {
      let items = myShipments(await loadAll(identity));
      if (req.query.q) {
        const q = String(req.query.q).toLowerCase();
        items = items.filter((x) => `${x.number} ${x.from} ${x.to} ${x.driver} ${x.plate} ${x.truck}`.toLowerCase().includes(q));
      }
      return res.json({ type, total: items.length, items });
    }

    let items = [];
    if (type === 'vendor') items = await vendorLoadsFor(identity);
    else if (type === 'orders') items = await shipmentOrdersFor(identity);
    else if (type === 'platform') items = await platformTripsFor(identity);
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
      const events = await FleetEvent.find({ shipment: found._id, type: 'followup' })
        .select('type data createdAt').sort({ createdAt: -1 }).limit(200).lean();
      return res.json({
        type, shipment: publicRow('heavy', found),
        // Where the truck was and when — no status, no author.
        timeline: events.filter((e) => e.data?.currentLocation).map((e) => ({ at: e.createdAt, location: e.data.currentLocation })),
        waybillUrl: `/api/portal/waybill/heavy/${found._id}`,
      });
    }
    if (type === 'platform') {
      const all = await platformTripsFor(identity);
      const found = all.find((s) => String(s._id) === String(id));
      if (!found) return res.status(404).json({ message: 'الرحلة غير موجودة' });
      return res.json({ type, shipment: publicRow('platform', found), timeline: [], waybillUrl: null });
    }
    if (type === 'orders' || type === 'vendor') {
      const all = type === 'vendor' ? await vendorLoadsFor(identity) : await shipmentOrdersFor(identity);
      const found = all.find((s) => String(s._id) === String(id));
      if (!found) return res.status(404).json({ message: 'الشحنة غير موجودة' });
      return res.json({ type, shipment: type === 'vendor' ? found : publicRow('orders', found), timeline: [], waybillUrl: null });
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
    // البوليصةُ للعميل بلا قيمة النقل ولا عهدة السائق.
    const pdf = await renderWaybillPdf({ ...rowFromShipment(shipment), sellPrice: '', driverAdvance: '' });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="waybill-${shipment.waybillNumber || shipment._id}.pdf"`);
    res.send(pdf);
  } catch (error) {
    console.error('portal waybill error:', error.message);
    res.status(500).json({ message: 'تعذّر توليد أمر النقل' });
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

/** GET /api/portal/invoices — the customer's own invoices (from his manifests). */
exports.invoices = async (req, res) => {
  try {
    const partner = partnerOf(req);
    if (!partner) return res.status(403).json({ message: 'هذا الحساب غير مرتبط بعميل أو مورد' });
    const identity = await resolveIdentity(partner);
    if (identity.kind === 'vendor') return res.json({ items: [], totals: {} });
    const items = myInvoices(await loadAll(identity));
    res.json({ items, totals: { count: items.length, shipments: items.reduce((a, x) => a + x.shipments, 0) } });
  } catch (error) {
    console.error('portal invoices error:', error);
    res.status(500).json({ message: 'تعذّر تحميل الفواتير' });
  }
};

/** Invoices, payments and the running balance. */
exports.finance = async (req, res) => {
  try {
    const partner = partnerOf(req);
    if (!partner) return res.status(403).json({ message: 'هذا الحساب غير مرتبط بعميل أو مورد' });
    const identity = await resolveIdentity(partner);
    // البوابةُ بلا أسعار ولا مبالغ للعميل (صاحبُ الشركة، ٢٠٢٦/١٠/٢٤).
    if (identity.kind !== 'vendor') return res.json({ invoices: [], payments: [], totals: {}, hidden: true });
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

/** Numbers a customer request can refer to: his own invoices and shipments. */
module.exports.referenceOptions = async (identity) => {
  const data = await loadAll(identity);
  return {
    invoices: myInvoices(data).map((i) => ({ value: i.number, label: `${i.number} · ${i.date}` })),
    shipments: myShipments(data).slice(0, 1500).map((x) => ({ value: x.number, label: `#${x.number} · ${x.date} · ${x.from} ← ${x.to}` })).filter((x) => x.value),
  };
};
module.exports.partnerOf = partnerOf;
module.exports.resolveIdentity = resolveIdentity;
