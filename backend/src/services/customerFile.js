/**
 * The complete customer file: one customer read from every section through its CRM master (services/customerHub).
 * Sections see only their own customer page; this file is for top management (FULL_FILE_ROLES), so money is included.
 */
const mongoose = require('mongoose');
const hub = require('./customerHub');
const { TOP_ROLES } = require('../config/constants');

const FULL_FILE_ROLES = [...TOP_ROLES, 'cfo', 'moderator', 'collections_manager', 'collections_team_leader'];
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
      .select('reportNumber reportDate fromLocation toLocation applicationStatus executionStatus sellingValue purchaseValue totalInvoice invoiceNumber invoiceDate collectedAmount collectionDate plateNumber carNumber driverName branch customsLink.refNumber shipmentOrder fleetShipment externalSource truckType')
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

  // One list of transport orders. The operations sheet holds every order: the old platform's, ours from shipment requests (`shipmentOrder`) and fleet loads (`fleetShipment`), so a sheet row and its order are one order, never two.
  const SOURCE = { platform: ['المنصّة السابقة', 'Former platform'], orders: ['طلبات الشحنات', 'Shipment requests'], fleet: ['الأسطول', 'Fleet'], sheet: ['التشغيل', 'Operations'] };
  const inSheetOrders = new Set(platform.map((r) => String(r.shipmentOrder || '')).filter(Boolean));
  const inSheetLoads = new Set(platform.map((r) => String(r.fleetShipment || '')).filter(Boolean));
  const transport = [
    ...platformLive.map((r) => ({
      _id: r._id, source: r.shipmentOrder ? 'orders' : r.fleetShipment ? 'fleet' : r.externalSource ? 'platform' : 'sheet',
      number: r.reportNumber || '', date: r.reportDate, from: r.fromLocation || '', to: r.toLocation || '', status: r.applicationStatus || r.executionStatus || '',
      plate: r.plateNumber || r.carNumber || '', driver: r.driverName || '', truck: r.truckType || '',
      sell: n(r.sellingValue), buy: n(r.purchaseValue), invoiceNumber: r.invoiceNumber || '', invoiceTotal: n(r.totalInvoice),
      collected: n(r.collectedAmount), clearance: (r.customsLink && r.customsLink.refNumber) || '',
    })),
    ...ordersLive.filter((o) => !inSheetOrders.has(String(o._id))).map((o) => ({
      _id: o._id, source: 'orders', number: o.reference || (o.waybillNumber != null ? String(o.waybillNumber) : ''), date: o.pickupTime || o.createdAt,
      from: o.fromCity || '', to: o.toCity || '', status: o.status || '', plate: o.vehicleName || '', driver: o.driverName || '', truck: o.truckType || '',
      sell: n(o.sellPrice), buy: n(o.buyPrice), invoiceNumber: '', invoiceTotal: 0, collected: 0, clearance: (o.customsLink && o.customsLink.refNumber) || '',
    })),
    ...loadsLive.filter((l) => !inSheetLoads.has(String(l._id))).map((l) => ({
      _id: l._id, source: 'fleet', number: l.waybillNumber != null ? String(l.waybillNumber) : '', date: l.loadDate || l.createdAt,
      from: l.fromCity || '', to: l.toCity || '', status: l.status || '', plate: l.vehiclePlate || '', driver: l.driverName || '', truck: '',
      sell: n(l.price), buy: 0, invoiceNumber: '', invoiceTotal: 0, collected: 0, clearance: '',
    })),
  ].map((x) => ({ ...x, sourceAr: SOURCE[x.source][0], sourceEn: SOURCE[x.source][1] }))
    .sort((a, b) => new Date(b.date || 0) - new Date(a.date || 0));
  const bySource = {};
  for (const x of transport) bySource[x.source] = (bySource[x.source] || 0) + 1;
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
      transport: transport.length, bySource, transportSell: sum(transport, 'sell'), transportBuy: sum(transport, 'buy'),
      transportInvoiced: sum(transport, 'invoiceTotal'),
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
    transport, loads, customs: customsRows, invoices, requests, deals, activities, accounts,
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

/**
 * The complete file as a printed report (reporting engine subject `customerFile`, branded letterhead PDF).
 * Same data as the screen; the period (from/to) narrows the lists and totals, the customer card stays whole.
 */
const CUSTOMS_STATE_AR = { open: ['مفتوحة', 'Open'], upcoming: ['قادمة', 'Upcoming'], closedInvoiced: ['مغلقة ومفوترة', 'Closed, invoiced'], closedNotInvoiced: ['مغلقة لم تُفوتَر', 'Closed, not invoiced'], cancelled: ['ملغاة', 'Cancelled'] };
const PRINT_ROWS = 300;

async function buildReport(id, query, lang, user) {
  if (!canSeeFullFile(user)) { const e = new Error(lang === 'en' ? 'The complete file is for top management only' : 'الملف الشامل للإدارة العليا فقط'); e.status = 403; throw e; }
  const { money, dt } = require('./reportBuilder');
  const t = (ar, en) => (lang === 'en' ? en : ar);
  const [rawId, reg] = String(id).split(':');
  const masterId = await masterOf(reg || 'crm', rawId);
  const d = masterId ? await build(masterId) : null;
  if (!d) return null;
  const from = query && query.from ? new Date(`${String(query.from).slice(0, 10)}T00:00:00+03:00`) : null;
  const to = query && query.to ? new Date(`${String(query.to).slice(0, 10)}T23:59:59+03:00`) : null;
  const inP = (v) => { if (!from && !to) return true; if (!v) return false; const x = new Date(v); return (!from || x >= from) && (!to || x <= to); };
  const m = d.master;
  const transport = d.transport.filter((x) => inP(x.date));
  const customs = d.customs.filter((c) => inP(c.createdAt));
  const invoices = d.invoices.filter((i) => inP(i.invoiceDate));
  const requests = d.requests.filter((r) => inP(r.createdAt));
  const sum = (rows, f) => rows.reduce((a, r) => a + (Number(typeof f === 'function' ? f(r) : r[f]) || 0), 0);
  const invoiced = sum(invoices, 'total'); const collected = sum(invoices, 'collectedAmount');
  const customsLive = customs.filter((c) => c.state !== 'cancelled');
  const bySource = {};
  for (const x of transport) bySource[x.source] = (bySource[x.source] || 0) + 1;
  const SRC = { platform: t('المنصّة السابقة', 'Former platform'), orders: t('طلبات الشحنات', 'Shipment requests'), fleet: t('الأسطول', 'Fleet'), sheet: t('التشغيل', 'Operations') };
  const capped = (rows) => rows.slice(0, PRINT_ROWS);
  const more = (rows) => (rows.length > PRINT_ROWS ? t(`يظهر أحدث ${PRINT_ROWS} من ${rows.length}؛ الكلّ في تصدير Excel.`, `Latest ${PRINT_ROWS} of ${rows.length} shown; Excel export has all.`) : '');

  const blocks = [];
  blocks.push({
    kind: 'callout', title: t('بطاقة العميل', 'Customer card'),
    lines: [
      [t('العميل', 'Customer'), m.name], [t('كود العميل', 'Customer code'), m.code || '—'], [t('الجوال', 'Phone'), m.phone || '—'],
      [t('البريد', 'Email'), (m.emails || []).join('، ') || '—'], [t('جهة الاتصال', 'Contact'), m.contactPerson || '—'],
      [t('الرقم الضريبي', 'Tax number'), m.taxNumber || '—'], [t('السجل التجاري', 'Commercial register'), m.commercialRegister || '—'],
      [t('العنوان', 'Address'), [m.address, m.city].filter(Boolean).join('، ') || '—'],
      [t('موجود في', 'Present in'), d.places.map((p) => p.ar).join('، ')],
    ].filter(([, v]) => v && v !== '—'),
  });
  blocks.push({
    kind: 'stats', items: [
      // Only the services the customer has: a customs-only customer gets no transport boxes and the other way round.
      { label: t('أوامر النقل', 'Transport orders'), value: transport.length.toLocaleString('en-US'), accent: true, sub: Object.entries(bySource).map(([k, v]) => `${SRC[k]} ${v}`).join(' · ') },
      { label: t('إيراد النقل', 'Transport revenue'), value: money(sum(transport, 'sell')) },
      { label: t('معاملات التخليص', 'Customs files'), value: customsLive.length, sub: t(`ربح ${money(sum(customsLive, 'profit'))}`, `profit ${money(sum(customsLive, 'profit'))}`) },
      { label: t('المتبقّي للتحصيل', 'Outstanding'), value: money(invoiced - collected), sub: t(`مفوتَر ${money(invoiced)} · مُحصَّل ${money(collected)}`, `invoiced ${money(invoiced)} · collected ${money(collected)}`) },
    ].filter((x, i) => [transport.length, transport.length, customsLive.length, invoices.length][i] > 0),
  });
  if (d.collections || d.contract) {
    blocks.push({ kind: 'section', text: t('التحصيل والعقد', 'Collections & contract') });
    const c = d.contract || {};
    blocks.push({ kind: 'kv', items: [
      [t('مسؤول التحصيل', 'Collections officer'), d.collections && d.collections.officer],
      [t('مدة الائتمان', 'Credit days'), d.collections && d.collections.creditDays ? `${d.collections.creditDays} ${t('يومًا', 'days')}` : null],
      [t('شروط الدفع', 'Payment terms'), d.collections && d.collections.paymentTerms],
      [t('العقد', 'Contract'), d.contract ? (c.customerSideContract && c.ourSideContract ? t('موقَّع من الطرفين', 'Signed by both') : t('غير مكتمل التوقيع', 'Not fully signed')) : null],
      [t('بداية العقد', 'Contract start'), c.startDate ? dt(c.startDate) : null], [t('نهاية العقد', 'Contract end'), c.endDate ? dt(c.endDate) : null],
      [t('مدة السداد في العقد', 'Contract payment term'), c.paymentTermDays ? `${c.paymentTermDays} ${t('يومًا', 'days')}` : null],
      [t('حساب البوابة', 'Portal account'), d.accounts.length ? d.accounts.map((a) => a.email).join('، ') : t('لا يوجد', 'None')],
    ] });
  }
  blocks.push({ kind: 'section', text: t('أوامر النقل', 'Transport orders') });
  blocks.push({
    kind: 'table', small: true,
    head: [t('الرقم', 'No.'), t('التاريخ', 'Date'), t('المصدر', 'Source'), t('من', 'From'), t('إلى', 'To'), t('اللوحة', 'Plate'), t('البيع', 'Sell'), t('الفاتورة', 'Invoice'), t('التخليص', 'Customs')],
    align: ['start', 'start', 'start', 'start', 'start', 'start', 'end', 'start', 'start'],
    rows: capped(transport).map((x) => [x.number || '—', dt(x.date), SRC[x.source], x.from || '—', x.to || '—', x.plate || '—', money(x.sell), x.invoiceNumber || '—', x.clearance || '—']),
    foot: transport.length ? [t('الإجمالي', 'Total'), '', '', '', '', '', money(sum(transport, 'sell')), '', ''] : undefined,
    emptyText: t('لا أوامر نقل في هذه الفترة.', 'No transport orders in this period.'),
  });
  if (more(transport)) blocks.push({ kind: 'note', text: more(transport) });
  if (customs.length) {
    blocks.push({ kind: 'section', text: t('التخليص الجمركي', 'Customs clearance') });
    blocks.push({
      kind: 'table', small: true,
      head: [t('المرجع', 'Reference'), t('البوليصة', 'BL'), t('الفتح', 'Opened'), t('الحالة', 'State'), t('الوحدات', 'Units'), t('الإيراد', 'Revenue'), t('التكلفة', 'Cost'), t('الربح', 'Profit')],
      align: ['start', 'start', 'start', 'start', 'center', 'end', 'end', 'end'],
      rows: capped(customs).map((c) => [c.refNumber || '—', c.blNumber || '—', dt(c.createdAt), (CUSTOMS_STATE_AR[c.state] || CUSTOMS_STATE_AR.open)[lang === 'en' ? 1 : 0], c.containerCount || 0, money(c.revenue), money(c.cost), { t: money(c.profit), color: c.profit < 0 ? '#dc2626' : '#047857' }]),
      foot: [t('الإجمالي', 'Total'), '', '', '', '', money(sum(customsLive, 'revenue')), money(sum(customsLive, 'cost')), money(sum(customsLive, 'profit'))],
    });
  }
  if (invoices.length) {
    blocks.push({ kind: 'section', text: t('فواتير التحصيل', 'Collections invoices') });
    blocks.push({
      kind: 'table', small: true,
      head: [t('الفاتورة', 'Invoice'), t('التاريخ', 'Date'), t('التسليم', 'Delivered'), t('الإجمالي', 'Total'), t('المُحصَّل', 'Collected'), t('المتبقّي', 'Remaining'), t('الحالة', 'Status')],
      align: ['start', 'start', 'start', 'end', 'end', 'end', 'start'],
      rows: capped(invoices).map((i) => [i.invoiceNumber || '—', dt(i.invoiceDate), dt(i.deliveryDate), money(i.total), money(i.collectedAmount), money((i.total || 0) - (i.collectedAmount || 0)), i.status || '—']),
      foot: [t('الإجمالي', 'Total'), '', '', money(invoiced), money(collected), money(invoiced - collected), ''],
    });
    if (more(invoices)) blocks.push({ kind: 'note', text: more(invoices) });
  }
  if (requests.length) {
    blocks.push({ kind: 'section', text: t('طلبات الشحن', 'Shipment requests') });
    blocks.push({
      kind: 'table', small: true,
      head: [t('الطلب', 'Request'), t('التاريخ', 'Date'), t('من', 'From'), t('إلى', 'To'), t('الشاحنات', 'Trucks'), t('السيلز', 'Sales rep')],
      rows: capped(requests).map((r) => [r.number, dt(r.createdAt), r.fromCity || '—', r.toCity || '—', `${(r.placed || []).length}/${r.trucks || 0}`, r.salesRepName || '—']),
    });
  }
  if (d.deals.length) {
    blocks.push({ kind: 'section', text: t('صفقات إدارة العلاقات', 'CRM deals') });
    blocks.push({ kind: 'table', small: true, head: [t('الصفقة', 'Deal'), t('المرحلة', 'Stage'), t('القيمة', 'Value'), t('الإغلاق المتوقّع', 'Expected close')], align: ['start', 'start', 'end', 'start'],
      rows: d.deals.map((x) => [x.title || '—', x.stage || '—', money(x.value), x.expectedCloseDate ? dt(x.expectedCloseDate) : '—']) });
  }
  const period = from || to ? `${query.from || '…'} → ${query.to || '…'}` : t('كلّ الفترات', 'All time');
  return {
    title: t('الملف الشامل للعميل', 'Complete customer file'),
    subtitle: `${m.name}${m.code ? ` · ${m.code}` : ''}`,
    meta: { period },
    blocks,
  };
}

/** Customers for the report picker (same list as the files page). */
async function reportOptions(q) {
  const rows = await list(q);
  return rows.map((r) => ({ id: r._id, name: r.name, detail: [r.code, r.phone, r.city].filter(Boolean).join(' · ') }));
}

module.exports = { build, list, masterOf, canSeeFullFile, FULL_FILE_ROLES, buildReport, reportOptions };
