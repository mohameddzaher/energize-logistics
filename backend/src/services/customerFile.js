/**
 * The complete customer file: one customer read from every section through its CRM master (services/customerHub).
 * Sections see only their own customer page; this file is for top management (FULL_FILE_ROLES), so money is included.
 */
const mongoose = require('mongoose');
const hub = require('./customerHub');
const { TOP_ROLES } = require('../config/constants');

const FULL_FILE_ROLES = [...TOP_ROLES, 'cfo', 'moderator', 'collections_manager'];
const canSeeFullFile = (u) => !!u && FULL_FILE_ROLES.includes(String(u.role || ''));

const W = { withArchived: true };
const LIMIT = 1000;
const n = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
const r2 = (v) => Math.round(n(v) * 100) / 100;
const safe = (p) => p.catch((e) => { console.error('[customerFile]', e.message); return []; });

/** Master id behind any register row (or the master itself). */
async function masterOf(reg, id) {
  if (!mongoose.isValidObjectId(id)) return null;
  if (!reg || reg === 'crm') return id;
  if (!hub.REG[reg]) return null;
  const d = await hub.REG[reg].model().findById(id).setOptions(W).lean();
  if (!d) return null;
  return d.crmCompany || hub.ensureMaster(reg, d);
}

async function build(masterId) {
  const Crm = hub.REG.crm.model();
  const m = await Crm.findById(masterId).setOptions(W).lean();
  if (!m) return null;
  const linked = await hub.linkedRows(m._id);
  const ids = (reg) => linked.filter((x) => x.reg === reg).map((x) => x.doc._id);
  const rowOf = (reg) => (linked.find((x) => x.reg === reg) || {}).doc || null;
  const names = [...new Set([m.name, ...linked.map((x) => x.doc.name), ...linked.flatMap((x) => x.doc.aliases || [])].filter(Boolean))];

  const ShipmentOrder = require('../models/ShipmentOrder');
  const OperationsWorkflow = require('../models/OperationsWorkflow');
  const { FleetShipment } = require('../models/FleetModels');
  const CustomsClearance = require('../models/CustomsClearance');
  const CollectionInvoice = require('../models/CollectionInvoice');
  const ShipmentRequest = require('../models/ShipmentRequest');
  const { moneyOf, MONEY_SELECT } = require('../utils/customsInvoice');
  const req = (name) => { try { return require(`../models/${name}`); } catch (_) { return null; } };

  const [orders, platform, loads, clearances, invoices, requests, deals, activities, accounts] = await Promise.all([
    safe(ShipmentOrder.find({ customer: { $in: ids('shipment') } })
      .select('waybillNumber reference pickupTime createdAt fromCity toCity status sellPrice buyPrice supplierName vehicleName driverName truckType branch salesRepName customsLink.refNumber')
      .sort({ createdAt: -1 }).limit(LIMIT).lean()),
    safe(names.length ? OperationsWorkflow.find({ username: { $in: names } })
      .select('reportNumber reportDate fromLocation toLocation applicationStatus executionStatus sellingValue purchaseValue totalInvoice invoiceNumber invoiceDate collectedAmount collectionDate plateNumber driverName branch customsLink.refNumber')
      .sort({ reportDate: -1 }).limit(LIMIT).lean() : Promise.resolve([])),
    safe(FleetShipment.find({ customer: { $in: ids('fleet') } })
      .select('waybillNumber loadDate createdAt fromCity toCity status price vehiclePlate driverName loadType branch')
      .sort({ loadDate: -1 }).limit(LIMIT).lean()),
    safe(CustomsClearance.find({ customerParty: { $in: ids('customs') } })
      .select(`refNumber blNumber stage isCompleted cancelled upcoming createdAt completedAt containerCount cargoType port branch shippingAgent declarationNumber ${MONEY_SELECT} costs revenue`)
      .sort({ createdAt: -1 }).limit(LIMIT).lean()),
    safe(CollectionInvoice.find({ party: { $in: ids('collections') } })
      .select('invoiceNumber invoiceDate deliveryDate collectionDate total collectedAmount status branch')
      .sort({ invoiceDate: -1 }).limit(LIMIT).lean()),
    safe(ShipmentRequest.find({ customer: { $in: ids('shipment') } })
      .select('number status trucks placed createdAt dueDay fromCity toCity salesRepName')
      .sort({ createdAt: -1 }).limit(LIMIT).lean()),
    safe(req('CrmDeal') ? req('CrmDeal').find({ company: m._id }).select('title stage status value currency expectedCloseDate wonAt lostAt createdAt').sort({ createdAt: -1 }).lean() : Promise.resolve([])),
    safe(req('CrmActivity') ? req('CrmActivity').find({ company: m._id }).select('type subject title notes createdAt date').sort({ createdAt: -1 }).limit(50).lean() : Promise.resolve([])),
    safe(require('../models/User').find({ role: 'client', $or: [{ 'partner.master': String(m._id) }, { 'partner.source': 'crm_company', 'partner.refId': String(m._id) }] })
      .select('email firstName lastName isActive lastLogin createdAt partner.source').lean()),
  ]);

  const sum = (rows, f) => r2(rows.reduce((a, r) => a + n(typeof f === 'function' ? f(r) : r[f]), 0));
  const live = (rows) => rows.filter((r) => !/cancel|ملغ/i.test(String(r.status || '')));
  const ordersLive = live(orders);
  const platformLive = platform.filter((r) => !/cancel|ملغ/i.test(String(r.applicationStatus || '')) && !/cancel|ملغ/i.test(String(r.executionStatus || '')));
  const loadsLive = live(loads);
  const customsRows = clearances.map((c) => {
    const money = moneyOf(c);
    return {
      _id: c._id, refNumber: c.refNumber, blNumber: c.blNumber, stage: c.stage, createdAt: c.createdAt, completedAt: c.completedAt,
      state: c.cancelled ? 'cancelled' : c.upcoming ? 'upcoming' : c.isCompleted ? (c.saleInvoiceNumber ? 'closedInvoiced' : 'closedNotInvoiced') : 'open',
      containerCount: c.containerCount || 0, cargoType: c.cargoType || '', port: c.port || '', shippingAgent: c.shippingAgent || '',
      saleInvoiceNumber: c.saleInvoiceNumber || '', cost: money.cost, revenue: money.revenue, profit: money.profit,
    };
  });
  const customsLive = customsRows.filter((c) => c.state !== 'cancelled');
  const coll = rowOf('collections');
  const contract = rowOf('contracts');
  const invoiced = sum(invoices, 'total');
  const collected = sum(invoices, 'collectedAmount');
  const today = new Date();
  const dueDays = n(coll && coll.creditDays);
  const overdue = invoices.filter((i) => n(i.total) - n(i.collectedAmount) > 0.5 && i.deliveryDate && dueDays
    && (today - new Date(i.deliveryDate)) / 86400000 > dueDays);

  return {
    master: {
      _id: String(m._id), name: m.name, arabicName: m.arabicName || '', code: m.customerCode || '', status: m.status || '', type: m.type || '',
      phone: m.phone || '', emails: m.emails && m.emails.length ? m.emails : [m.email].filter(Boolean), contactPerson: m.contactPerson || '',
      taxNumber: m.taxNumber || '', commercialRegister: m.commercialRegister || '', address: m.address || '', city: m.city || '',
      rating: m.rating || 0, createdAt: m.createdAt, archivedAt: m.archivedAt || null,
    },
    names,
    places: (await hub.presence('crm', String(m._id)) || { places: [] }).places,
    summary: {
      orders: ordersLive.length, ordersSell: sum(ordersLive, 'sellPrice'), ordersBuy: sum(ordersLive, 'buyPrice'),
      platform: platformLive.length, platformSell: sum(platformLive, 'sellingValue'), platformInvoiced: sum(platformLive, 'totalInvoice'),
      loads: loadsLive.length, loadsIncome: sum(loadsLive, 'price'),
      clearances: customsLive.length, clearancesOpen: customsLive.filter((c) => c.state === 'open').length,
      customsRevenue: sum(customsLive, 'revenue'), customsProfit: sum(customsLive, 'profit'),
      invoices: invoices.length, invoiced, collected, outstanding: r2(invoiced - collected), overdue: overdue.length,
      requests: requests.length, openRequests: requests.filter((r) => ['pending', 'in_progress'].includes(r.status)).length,
      deals: deals.length, openDeals: deals.filter((d) => !d.wonAt && !d.lostAt).length, dealsValue: sum(deals.filter((d) => !d.lostAt), 'value'),
      lastActivity: [orders[0]?.createdAt, platform[0]?.reportDate, loads[0]?.loadDate, clearances[0]?.createdAt, invoices[0]?.invoiceDate]
        .filter(Boolean).map((d) => new Date(d)).sort((a, b) => b - a)[0] || null,
    },
    collections: coll ? { code: coll.code || '', creditDays: coll.creditDays || 0, officer: coll.collectionOfficer || '', paymentTerms: coll.paymentTerms || '' } : null,
    contract: contract ? {
      customerSideContract: !!contract.customerSideContract, ourSideContract: !!contract.ourSideContract,
      contractDate: contract.contractDate, startDate: contract.startDate, endDate: contract.endDate,
      paymentTermDays: contract.paymentTermDays, renewalPolicy: contract.renewalPolicy || '', operationalStatus: contract.operationalStatus || '',
      energizeRep: contract.energizeRep || '', sector: contract.sector || '',
    } : null,
    orders, platform, loads, customs: customsRows, invoices, requests, deals, activities, accounts,
  };
}

/** Customers list for the file's search page: masters with their code and where they appear. */
async function list(q = '') {
  const Crm = hub.REG.crm.model();
  const filter = { status: { $nin: ['lead', 'prospect'] } };
  const term = String(q || '').trim();
  if (term) {
    const rx = new RegExp(term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
    filter.$or = [{ name: rx }, { arabicName: rx }, { customerCode: rx }, { phone: rx }, { nameKey: new RegExp(require('../models/CollectionsParty').fold(term).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')) }];
  }
  const rows = await Crm.find(filter).select('name customerCode phone city status').sort({ name: 1 }).limit(term ? 200 : 5000).lean();
  return rows.map((r) => ({ _id: String(r._id), name: r.name, code: r.customerCode || '', phone: r.phone || '', city: r.city || '', status: r.status || '' }));
}

module.exports = { build, list, masterOf, canSeeFullFile, FULL_FILE_ROLES };
