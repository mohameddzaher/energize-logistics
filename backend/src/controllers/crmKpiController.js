/**
 * crmKpiController — مؤشرات أداء العملاء والموردين.
 *
 * A CRM company is not just a row with a phone number: it is a relationship with
 * a revenue history, a payment habit, a shipping volume and a level of contact.
 * Those live in FIVE different collections owned by five different sections, and
 * nothing links them by id — each register was filled in independently. So the
 * join is `nameKey` (see utils/nameKey.js): the Arabic-folded company name.
 *
 * The scorecard answers, for every customer:  هل ده عميل كويس؟ بيشحن كام؟ بيدفع
 * امتى؟ بنكلّمه امتى آخر مرة؟ — and for every vendor: بيشتغل معانا قد إيه، وعقده
 * مظبوط ولا لأ.
 *
 * Everything is READ-ONLY and computed on request. Cached briefly: the numbers
 * come from six collections and the page reloads on every CRM socket event.
 */
const CrmCompany = require('../models/CrmCompany');
const { startOfDay, endOfDay } = require('../utils/companyDay');
const CrmVendor = require('../models/CrmVendor');
const CrmDeal = require('../models/CrmDeal');
const CrmActivity = require('../models/CrmActivity');
const CrmTask = require('../models/CrmTask');
const Customer = require('../models/Customer');
const Invoice = require('../models/Invoice');
const Payment = require('../models/Payment');
const Dispute = require('../models/Dispute');
const CustomsClearance = require('../models/CustomsClearance');
const ShipmentOrder = require('../models/ShipmentOrder');
const { FleetShipment } = require('../models/FleetModels');
const { nameKey } = require('../utils/nameKey');
const cache = require('../utils/ttlCache');

const CACHE_TTL = 60 * 1000;
const DAY = 86400000;
const r0 = (n) => Math.round(Number(n) || 0);
const r1 = (n) => Math.round((Number(n) || 0) * 10) / 10;
const clamp01 = (n) => Math.max(0, Math.min(1, Number(n) || 0));
const daysAgo = (d) => (d ? Math.floor((Date.now() - new Date(d).getTime()) / DAY) : null);

const BANDS = [
  { min: 85, key: 'strategic', ar: 'عميل استراتيجي', en: 'Strategic', color: '#16a34a' },
  { min: 70, key: 'strong', ar: 'عميل قوي', en: 'Strong', color: '#22c55e' },
  { min: 50, key: 'stable', ar: 'مستقر', en: 'Stable', color: '#eab308' },
  { min: 30, key: 'at_risk', ar: 'يحتاج متابعة', en: 'Needs attention', color: '#f97316' },
  { min: 0, key: 'dormant', ar: 'خامل', en: 'Dormant', color: '#94a3b8' },
];
const VENDOR_BANDS = [
  { min: 85, key: 'preferred', ar: 'مورد معتمد', en: 'Preferred', color: '#16a34a' },
  { min: 70, key: 'reliable', ar: 'مورد موثوق', en: 'Reliable', color: '#22c55e' },
  { min: 50, key: 'occasional', ar: 'مورد عرضي', en: 'Occasional', color: '#eab308' },
  { min: 30, key: 'onboarding', ar: 'تحت التأسيس', en: 'Onboarding', color: '#f97316' },
  { min: 0, key: 'inactive', ar: 'غير نشط', en: 'Inactive', color: '#94a3b8' },
];
const bandOf = (bands, score) => bands.find((b) => score >= b.min) || bands[bands.length - 1];

// Resolve the reporting window. Default = last 12 months, which is the span a
// customer relationship is actually judged over.
function resolvePeriod(query) {
  // ── الحدُّ بتوقيت الرياض لا بتوقيت الخادم ──────────────────────────────────
  // `new Date('2026-01-01T00:00:00')` بلا منطقةٍ تُقرأ بتوقيت الجهاز الذي
  // يشغّل الخادم: نتيجةٌ على حاسوب المطوّر وأخرى على الخادم، وكلتاهما ليست
  // منتصفَ ليل الرياض. فيُبنى الحدُّ من تقويم الشركة صراحةً.
  const to = (query.to && endOfDay(query.to)) || new Date();
  const from = (query.from && startOfDay(query.from))
    || new Date(new Date(to).setFullYear(to.getFullYear() - 1));
  const months = Math.max(1, Math.round((to - from) / (30 * DAY)));
  return { from, to, months };
}

// Build a name → bucket index over any list of rows, keyed by the folded name.
function indexByName(rows, nameOf) {
  const map = new Map();
  for (const row of rows) {
    const k = nameKey(nameOf(row));
    if (!k) continue;
    if (!map.has(k)) map.set(k, []);
    map.get(k).push(row);
  }
  return map;
}

// ─────────────────────────────────────────────────────────────────────────────
// مؤشرات العملاء — customer scorecards
// ─────────────────────────────────────────────────────────────────────────────
//
// Weights. Revenue and volume dominate (that IS the relationship), payment
// behaviour is next (a big customer who never pays is not a good customer), and
// engagement/growth round it out.
const CUSTOMER_WEIGHTS = {
  revenue: 25,     // إجمالي الإيرادات
  volume: 20,      // عدد الشحنات/المعاملات
  payment: 20,     // الانضباط في السداد
  recency: 15,     // آخر تعامل
  engagement: 10,  // التواصل والأنشطة
  growth: 10,      // النمو مقارنة بالفترة السابقة
};

exports.getCustomerKpis = async (req, res) => {
  try {
    const key = `crm:kpi:customers:${JSON.stringify(req.query || {})}`;
    const hit = cache.get(key);
    if (hit !== undefined) return res.json(hit);

    const { from, to, months } = resolvePeriod(req.query);
    // Previous window of the same length — the growth metric compares the two.
    const prevFrom = new Date(from.getTime() - (to - from));

    const [
      companies, customers, invoices, payments, disputes,
      fleetTrips, orderTrips, customsJobs, deals, activities, tasks,
    ] = await Promise.all([
      CrmCompany.find({}).select('name arabicName type status rating score industry city country phone email owner tags createdAt linkedCustomer externalSource').populate('owner', 'firstName lastName').lean(),
      Customer.find({}).select('companyName customerNumber creditTerm creditLimit currentOutstanding grade clientStatus riskLevel isStopped isActive lastPaymentDate').lean(),
      Invoice.find({ invoiceDate: { $gte: prevFrom, $lte: to } }).select('customer amount paidAmount balance invoiceDate dueDate status').lean(),
      Payment.find({ paymentDate: { $gte: prevFrom, $lte: to } }).select('customer invoice amount paymentDate').lean(),
      Dispute.find({}).select('customer status createdAt').lean(),
      FleetShipment.find({ createdAt: { $gte: prevFrom, $lte: to } }).select('customerName customer price status loadDate createdAt').lean(),
      ShipmentOrder.find({ createdAt: { $gte: prevFrom, $lte: to } }).select('customerName customer sellPrice status createdAt').lean(),
      CustomsClearance.find({ createdAt: { $gte: prevFrom, $lte: to } }).select('customerName customer stage cancelled containerCount createdAt').lean(),
      CrmDeal.find({}).select('company status value wonAt lostAt createdAt').lean(),
      CrmActivity.find({ date: { $gte: prevFrom } }).select('company type date').lean(),
      CrmTask.find({}).select('company status dueDate').lean(),
    ]);

    // Indexes. Customers/invoices/payments are id-linked; the shipment registers
    // only carry a name, hence the folded-name index.
    const custById = new Map(customers.map((c) => [String(c._id), c]));
    const custByKey = indexByName(customers, (c) => c.companyName);
    const invByCustomer = new Map();
    for (const i of invoices) {
      const k = String(i.customer || '');
      if (!invByCustomer.has(k)) invByCustomer.set(k, []);
      invByCustomer.get(k).push(i);
    }
    const payByCustomer = new Map();
    for (const p of payments) {
      const k = String(p.customer || '');
      if (!payByCustomer.has(k)) payByCustomer.set(k, []);
      payByCustomer.get(k).push(p);
    }
    const invById = new Map(invoices.map((i) => [String(i._id), i]));
    const disputeByCustomer = new Map();
    for (const d of disputes) {
      const k = String(d.customer || '');
      disputeByCustomer.set(k, (disputeByCustomer.get(k) || 0) + 1);
    }
    const fleetByKey = indexByName(fleetTrips, (s) => s.customerName);
    const ordersByKey = indexByName(orderTrips, (s) => s.customerName);
    const customsByKey = indexByName(customsJobs, (s) => s.customerName);

    const dealsByCompany = new Map();
    for (const d of deals) {
      const k = String(d.company || '');
      if (!dealsByCompany.has(k)) dealsByCompany.set(k, []);
      dealsByCompany.get(k).push(d);
    }
    const actByCompany = new Map();
    for (const a of activities) {
      const k = String(a.company || '');
      if (!actByCompany.has(k)) actByCompany.set(k, []);
      actByCompany.get(k).push(a);
    }
    const openTasksByCompany = new Map();
    for (const t of tasks) {
      if (!['todo', 'in_progress'].includes(t.status)) continue;
      const k = String(t.company || '');
      openTasksByCompany.set(k, (openTasksByCompany.get(k) || 0) + 1);
    }

    const inWindow = (d) => d && new Date(d) >= from && new Date(d) <= to;
    const inPrev = (d) => d && new Date(d) >= prevFrom && new Date(d) < from;

    const rows = companies.map((co) => {
      const k = nameKey(co.name) || nameKey(co.arabicName);
      const cid = String(co._id);
      // The finance customer behind this CRM company: the explicit link if set,
      // otherwise the same-name row in the logistics customer register.
      const linked = co.linkedCustomer
        ? custById.get(String(co.linkedCustomer))
        : (custByKey.get(k) || [])[0];
      const linkedId = linked ? String(linked._id) : null;

      // ── Finance ──────────────────────────────────────────────────────────
      const myInvoices = linkedId ? (invByCustomer.get(linkedId) || []) : [];
      const myPayments = linkedId ? (payByCustomer.get(linkedId) || []) : [];
      const periodInvoices = myInvoices.filter((i) => inWindow(i.invoiceDate));
      const prevInvoices = myInvoices.filter((i) => inPrev(i.invoiceDate));
      const invoiced = periodInvoices.reduce((s, i) => s + (Number(i.amount) || 0), 0);
      const prevInvoiced = prevInvoices.reduce((s, i) => s + (Number(i.amount) || 0), 0);
      const collected = myPayments.filter((p) => inWindow(p.paymentDate)).reduce((s, p) => s + (Number(p.amount) || 0), 0);
      const outstanding = myInvoices.reduce((s, i) => s + (Number(i.balance) || 0), 0);
      const overdueInvoices = myInvoices.filter((i) => i.status !== 'paid' && new Date(i.dueDate) < new Date());
      const overdueAmount = overdueInvoices.reduce((s, i) => s + (Number(i.balance) || 0), 0);

      // Payment habit: for each payment, how many days after the invoice's due
      // date did it land? Negative = early. This is the honest "بيدفع امتى".
      let lateSum = 0; let lateCount = 0; let onTimePayments = 0;
      for (const p of myPayments) {
        const inv = p.invoice ? invById.get(String(p.invoice)) : null;
        if (!inv || !inv.dueDate) continue;
        const delta = Math.round((new Date(p.paymentDate) - new Date(inv.dueDate)) / DAY);
        lateSum += delta; lateCount += 1;
        if (delta <= 0) onTimePayments += 1;
      }
      const avgDaysLate = lateCount ? Math.round(lateSum / lateCount) : null;
      const onTimeRate = lateCount ? onTimePayments / lateCount : null;

      // ── Volume across the operational sections ───────────────────────────
      const fleet = (fleetByKey.get(k) || []).filter((s) => s.status !== 'cancelled');
      const orders = (ordersByKey.get(k) || []).filter((s) => s.status !== 'cancelled');
      const customs = (customsByKey.get(k) || []).filter((s) => !s.cancelled);
      const fleetNow = fleet.filter((s) => inWindow(s.loadDate || s.createdAt));
      const ordersNow = orders.filter((s) => inWindow(s.createdAt));
      const customsNow = customs.filter((s) => inWindow(s.createdAt));
      const fleetPrev = fleet.filter((s) => inPrev(s.loadDate || s.createdAt));
      const ordersPrev = orders.filter((s) => inPrev(s.createdAt));
      const customsPrev = customs.filter((s) => inPrev(s.createdAt));

      const shipments = fleetNow.length + ordersNow.length + customsNow.length;
      const prevShipments = fleetPrev.length + ordersPrev.length + customsPrev.length;
      const shipmentRevenue = fleetNow.reduce((s, x) => s + (Number(x.price) || 0), 0)
        + ordersNow.reduce((s, x) => s + (Number(x.sellPrice) || 0), 0);
      const prevShipmentRevenue = fleetPrev.reduce((s, x) => s + (Number(x.price) || 0), 0)
        + ordersPrev.reduce((s, x) => s + (Number(x.sellPrice) || 0), 0);

      // Which of our services this customer actually buys — drives the portal too.
      const services = [];
      if (fleet.length) services.push('heavy_transport');
      if (orders.length) services.push('shipment_orders');
      if (customs.length) services.push('customs');
      if (myInvoices.length) services.push('finance');

      // ── Engagement ───────────────────────────────────────────────────────
      const myDeals = dealsByCompany.get(cid) || [];
      const wonDeals = myDeals.filter((d) => d.status === 'won');
      const lostDeals = myDeals.filter((d) => d.status === 'lost');
      const openDeals = myDeals.filter((d) => d.status === 'open');
      const myActs = actByCompany.get(cid) || [];
      const actsNow = myActs.filter((a) => inWindow(a.date));
      const lastActivity = myActs.reduce((m, a) => (!m || new Date(a.date) > new Date(m) ? a.date : m), null);

      const lastShipment = [
        ...fleet.map((s) => s.loadDate || s.createdAt),
        ...orders.map((s) => s.createdAt),
        ...customs.map((s) => s.createdAt),
      ].reduce((m, d) => (!m || new Date(d) > new Date(m) ? d : m), null);
      const lastPayment = myPayments.reduce((m, p) => (!m || new Date(p.paymentDate) > new Date(m) ? p.paymentDate : m), null);
      const lastTouch = [lastActivity, lastShipment, lastPayment]
        .filter(Boolean)
        .reduce((m, d) => (!m || new Date(d) > new Date(m) ? d : m), null);

      const totalRevenue = invoiced || shipmentRevenue;
      const prevRevenue = prevInvoiced || prevShipmentRevenue;

      return {
        _id: cid,
        name: co.name,
        arabicName: co.arabicName || '',
        type: co.type || 'customer',
        status: co.status,
        industry: co.industry || '',
        city: co.city || '',
        country: co.country || '',
        phone: co.phone || '',
        email: co.email || '',
        rating: co.rating || 0,
        owner: co.owner ? `${co.owner.firstName || ''} ${co.owner.lastName || ''}`.trim() : '',
        tags: co.tags || [],
        fromOperations: co.externalSource === 'ops_upl',
        // Finance identity
        linkedCustomer: linkedId,
        customerNumber: linked?.customerNumber || '',
        creditTerm: linked?.creditTerm ?? null,
        creditLimit: linked?.creditLimit ?? null,
        grade: linked?.grade || '',
        clientStatus: linked?.clientStatus || '',
        riskLevel: linked?.riskLevel || '',
        isStopped: !!linked?.isStopped,
        // Money
        revenue: r0(totalRevenue),
        invoiced: r0(invoiced),
        collected: r0(collected),
        outstanding: r0(outstanding),
        overdueAmount: r0(overdueAmount),
        overdueInvoices: overdueInvoices.length,
        invoiceCount: periodInvoices.length,
        avgDaysLate,
        onTimePaymentRate: onTimeRate == null ? null : r0(onTimeRate * 100),
        disputes: linkedId ? (disputeByCustomer.get(linkedId) || 0) : 0,
        // Volume
        shipments,
        fleetTrips: fleetNow.length,
        shipmentOrders: ordersNow.length,
        customsJobs: customsNow.length,
        containers: customsNow.reduce((s, c) => s + (Number(c.containerCount) || 0), 0),
        services,
        // Relationship
        openDeals: openDeals.length,
        openPipeline: r0(openDeals.reduce((s, d) => s + (Number(d.value) || 0), 0)),
        wonDeals: wonDeals.length,
        wonValue: r0(wonDeals.reduce((s, d) => s + (Number(d.value) || 0), 0)),
        lostDeals: lostDeals.length,
        winRate: (wonDeals.length + lostDeals.length)
          ? r0((wonDeals.length / (wonDeals.length + lostDeals.length)) * 100) : null,
        activities: actsNow.length,
        openTasks: openTasksByCompany.get(cid) || 0,
        lastActivity, lastShipment, lastPayment, lastTouch,
        daysSinceLastTouch: daysAgo(lastTouch),
        // Growth
        prevRevenue: r0(prevRevenue),
        prevShipments,
        revenueGrowthPct: prevRevenue ? r0(((totalRevenue - prevRevenue) / prevRevenue) * 100) : null,
        shipmentGrowthPct: prevShipments ? r0(((shipments - prevShipments) / prevShipments) * 100) : null,
      };
    });

    // Score against the CRM's own best — "top of the book", not an invented target.
    const maxRevenue = Math.max(1, ...rows.map((r) => r.revenue));
    const maxShipments = Math.max(1, ...rows.map((r) => r.shipments));
    const maxActivities = Math.max(1, ...rows.map((r) => r.activities));

    for (const r of rows) {
      // Payment: 100 when everything landed on or before the due date, sliding to
      // 0 at 45 days late. No payment history at all → neutral 60, so a brand-new
      // customer isn't punished for a habit they haven't had a chance to form.
      const paymentValue = r.avgDaysLate == null
        ? 60
        : r0(clamp01((45 - Math.max(0, r.avgDaysLate)) / 45) * 100);
      // Recency: full marks inside 30 days, zero past 180.
      const d = r.daysSinceLastTouch;
      const recencyValue = d == null ? 0 : r0(clamp01((180 - d) / 150) * 100);
      const growthValue = r.revenueGrowthPct == null
        ? 50
        : r0(clamp01((r.revenueGrowthPct + 50) / 100) * 100); // −50% → 0, +50% → 100

      const breakdown = [
        { key: 'revenue', ar: 'الإيرادات', en: 'Revenue', weight: CUSTOMER_WEIGHTS.revenue, value: r0(clamp01(r.revenue / maxRevenue) * 100), detail: { revenue: r.revenue, best: r0(maxRevenue) } },
        { key: 'volume', ar: 'حجم التعاملات', en: 'Volume', weight: CUSTOMER_WEIGHTS.volume, value: r0(clamp01(r.shipments / maxShipments) * 100), detail: { shipments: r.shipments, best: maxShipments } },
        { key: 'payment', ar: 'انضباط السداد', en: 'Payment discipline', weight: CUSTOMER_WEIGHTS.payment, value: paymentValue, detail: { avgDaysLate: r.avgDaysLate, onTimeRate: r.onTimePaymentRate, overdue: r.overdueAmount } },
        { key: 'recency', ar: 'آخر تعامل', en: 'Recency', weight: CUSTOMER_WEIGHTS.recency, value: recencyValue, detail: { daysSince: d } },
        { key: 'engagement', ar: 'التواصل', en: 'Engagement', weight: CUSTOMER_WEIGHTS.engagement, value: r0(clamp01(r.activities / maxActivities) * 100), detail: { activities: r.activities, openTasks: r.openTasks } },
        { key: 'growth', ar: 'النمو', en: 'Growth', weight: CUSTOMER_WEIGHTS.growth, value: growthValue, detail: { revenueGrowthPct: r.revenueGrowthPct, shipmentGrowthPct: r.shipmentGrowthPct } },
      ];
      const totalWeight = breakdown.reduce((s, b) => s + b.weight, 0);
      r.score = r0(breakdown.reduce((s, b) => s + (b.value / 100) * b.weight, 0) * (100 / totalWeight));
      const band = bandOf(BANDS, r.score);
      r.band = band.key; r.bandAr = band.ar; r.bandEn = band.en; r.bandColor = band.color;
      r.breakdown = breakdown;
      // The one-line "what should we do about this account".
      r.flags = [
        r.isStopped && { key: 'stopped', ar: 'موقوف', en: 'Stopped' },
        r.overdueAmount > 0 && { key: 'overdue', ar: 'عليه متأخرات', en: 'Has overdue' },
        d != null && d > 90 && { key: 'stale', ar: 'بلا تواصل > 90 يوم', en: 'No contact 90d+' },
        r.shipments === 0 && r.revenue === 0 && { key: 'no_activity', ar: 'بلا نشاط في الفترة', en: 'No activity' },
        r.revenueGrowthPct != null && r.revenueGrowthPct <= -30 && { key: 'shrinking', ar: 'انخفاض حاد', en: 'Sharp decline' },
      ].filter(Boolean);
    }

    rows.sort((a, b) => b.score - a.score || b.revenue - a.revenue);

    const payload = {
      period: { from, to, months },
      weights: CUSTOMER_WEIGHTS,
      bands: BANDS,
      summary: {
        customers: rows.length,
        active: rows.filter((r) => r.shipments > 0 || r.revenue > 0).length,
        dormant: rows.filter((r) => r.shipments === 0 && r.revenue === 0).length,
        averageScore: rows.length ? r0(rows.reduce((s, r) => s + r.score, 0) / rows.length) : 0,
        totalRevenue: r0(rows.reduce((s, r) => s + r.revenue, 0)),
        totalOutstanding: r0(rows.reduce((s, r) => s + r.outstanding, 0)),
        totalOverdue: r0(rows.reduce((s, r) => s + r.overdueAmount, 0)),
        totalShipments: rows.reduce((s, r) => s + r.shipments, 0),
        atRisk: rows.filter((r) => r.flags.length > 0).length,
      },
      items: rows,
    };
    cache.set(key, payload, CACHE_TTL);
    res.json(payload);
  } catch (error) {
    console.error('getCustomerKpis error:', error);
    res.status(500).json({ message: 'Failed to load customer KPIs' });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// مؤشرات الموردين — vendor (3PL carrier) scorecards
// ─────────────────────────────────────────────────────────────────────────────
//
// A vendor is judged on whether we can actually give them work: do they take
// loads, at what cost, is the contract signed and the paperwork in, how much
// capacity do they have, and is anyone following them up.
const VENDOR_WEIGHTS = {
  volume: 30,      // الحمولات المنفّذة فعليًا
  contract: 25,    // اكتمال العقد والأوراق
  capacity: 15,    // حجم الأسطول
  utilisation: 15, // نسبة تشغيلهم من طاقتهم المتاحة
  recency: 15,     // آخر تشغيل
};

exports.getVendorKpis = async (req, res) => {
  try {
    const key = `crm:kpi:vendors:${JSON.stringify(req.query || {})}`;
    const hit = cache.get(key);
    if (hit !== undefined) return res.json(hit);

    const { from, to, months: months2 } = resolvePeriod(req.query);
    const prevFrom = new Date(from.getTime() - (to - from));

    const ShipmentOrderSupplier = require('../models/ShipmentOrderSupplier');
    // How much work a 3PL carrier ACTUALLY got is recorded by the Contracts
    // section as one row per vendor per month (VendorUtilisation) — that is the
    // company's real volume ledger. The shipment-orders trial has its own
    // supplier orders, but the trial is young and mostly empty, so it is a
    // SECOND source rather than the only one: whichever has data wins, and both
    // are joined on the same folded name.
    const { VendorUtilisation, ContractVendor } = require('../models/ContractModels');
    const [vendors, suppliers, orders, utilisation, contractVendors] = await Promise.all([
      CrmVendor.find({}).select('-__v').lean(),
      ShipmentOrderSupplier.find({}).select('name type phone email isActive').lean(),
      ShipmentOrder.find({ createdAt: { $gte: prevFrom, $lte: to } })
        .select('supplier customerName sellPrice buyPrice status createdAt fromCity toCity driverName vehicleName').lean(),
      VendorUtilisation.find({}).select('nameKey vendorName year month orders fleetSize expectedMonthlyCapacity hasContract vendorType isExternal').lean(),
      ContractVendor.find({}).select('nameKey name fleetSize monthlyCapacity vendorSideContract ourSideContract documentsReceived contractDate destinations headquarters energizeRep vendorType').lean(),
    ]);

    // Utilisation rows carry (year, month); turn each into a comparable date so
    // the same from/to window applies to them as to everything else.
    const monthDate = (u) => new Date(Date.UTC(u.year, (u.month || 1) - 1, 1));
    const utilByKey = new Map();
    for (const u of utilisation) {
      if (u.isExternal || !u.nameKey) continue; // the «أفراد خارجية» bucket is not a vendor
      if (!utilByKey.has(u.nameKey)) utilByKey.set(u.nameKey, []);
      utilByKey.get(u.nameKey).push({ ...u, at: monthDate(u) });
    }
    const contractByKey = new Map(contractVendors.map((c) => [c.nameKey, c]));

    const supById = new Map(suppliers.map((s) => [String(s._id), s]));
    // Orders indexed by the folded SUPPLIER name — the CRM vendor register and
    // the shipment-orders supplier register are separate collections filled in
    // by different teams, so the name is again the only bridge.
    const ordersByKey = new Map();
    for (const o of orders) {
      const sup = o.supplier ? supById.get(String(o.supplier)) : null;
      const k = nameKey(sup?.name);
      if (!k) continue;
      if (!ordersByKey.has(k)) ordersByKey.set(k, []);
      ordersByKey.get(k).push(o);
    }

    const inWindow = (d) => d && new Date(d) >= from && new Date(d) <= to;
    const inPrev = (d) => d && new Date(d) >= prevFrom && new Date(d) < from;

    // Every vendor we know about: the CRM register plus any shipment-orders
    // supplier that has no CRM row yet (they exist — suppliers are usually born
    // on the create-shipment form).
    const seenKeys = new Set();
    const base = vendors.map((v) => {
      const k = nameKey(v.name);
      seenKeys.add(k);
      return { key: k, crm: v, supplier: suppliers.find((s) => nameKey(s.name) === k) || null };
    });
    for (const s of suppliers) {
      const k = nameKey(s.name);
      if (!k || seenKeys.has(k)) continue;
      seenKeys.add(k);
      base.push({ key: k, crm: null, supplier: s });
    }
    // …and the Contracts register, which is the fuller 3PL master list.
    for (const c of contractVendors) {
      if (!c.nameKey || seenKeys.has(c.nameKey)) continue;
      seenKeys.add(c.nameKey);
      base.push({ key: c.nameKey, crm: null, supplier: null });
    }

    const rows = base.map(({ key: k, crm: v, supplier }) => {
      const cv = contractByKey.get(k) || null;

      // ── Volume ──────────────────────────────────────────────────────────
      // Preferred source: the Contracts section's monthly ledger (real orders
      // executed). Second source: the shipment-orders trial. They are added,
      // not max'd — a vendor can legitimately appear in both, and double-
      // counting is impossible because the trial books its OWN orders.
      const months = (utilByKey.get(k) || []);
      const utilNow = months.filter((u) => u.at >= from && u.at <= to);
      const utilPrev = months.filter((u) => u.at >= prevFrom && u.at < from);
      const ledgerLoads = utilNow.reduce((s2, u) => s2 + (Number(u.orders) || 0), 0);
      const ledgerPrev = utilPrev.reduce((s2, u) => s2 + (Number(u.orders) || 0), 0);
      const ledgerCapacity = utilNow.reduce((s2, u) => s2 + (Number(u.expectedMonthlyCapacity) || 0), 0);
      // Recency must mean "last month they actually MOVED something" — a zero
      // row for last month is a record of them being idle, not of them working.
      const lastLedgerMonth = months
        .filter((u) => (Number(u.orders) || 0) > 0)
        .reduce((m, u) => (!m || u.at > m ? u.at : m), null);

      const all = ordersByKey.get(k) || [];
      const live = all.filter((o) => o.status !== 'cancelled');
      const now = live.filter((o) => inWindow(o.createdAt));
      const prev = live.filter((o) => inPrev(o.createdAt));
      const cost = now.reduce((s2, o) => s2 + (Number(o.buyPrice) || 0), 0);
      const revenue = now.reduce((s2, o) => s2 + (Number(o.sellPrice) || 0), 0);
      const margin = revenue - cost;
      const lastOrder = live.reduce((m, o) => (!m || new Date(o.createdAt) > new Date(m) ? o.createdAt : m), null);
      const routes = [...new Set(now.map((o) => `${o.fromCity || '؟'} → ${o.toCity || '؟'}`))].slice(0, 12);

      const loads = ledgerLoads + now.length;
      const prevLoads = ledgerPrev + prev.length;
      // "Last time we used them" — whichever source saw them most recently.
      const lastLoad = [lastLedgerMonth, lastOrder ? new Date(lastOrder) : null]
        .filter(Boolean).reduce((m, d) => (!m || d > m ? d : m), null);

      // ── Capacity & utilisation ──────────────────────────────────────────
      // Fleet size: CRM's carsCount, else the contracts register's fleetSize,
      // else whatever the monthly rows recorded.
      const fleetSize = v?.carsCount ?? cv?.fleetSize ?? (utilNow[0]?.fleetSize ?? null);
      const capacity = ledgerCapacity || (cv?.monthlyCapacity ? cv.monthlyCapacity * utilNow.length : 0);
      const utilisationPct = capacity ? r0((ledgerLoads / capacity) * 100) : null;

      // ── Contract completeness ───────────────────────────────────────────
      // Four things have to be true before we can lean on a carrier: papers on
      // file and both signatures, plus a dated contract. The CRM register and
      // the contracts register track the same facts under different names, so
      // either one saying yes counts.
      const checks = {
        hasPapers: v?.hasPapers === true || cv?.documentsReceived === true,
        vendorSigned: v?.vendorSideSigned === true || cv?.vendorSideContract === true,
        ourSigned: v?.ourSideSigned === true || cv?.ourSideContract === true,
        contractDated: !!(v?.contractDate || cv?.contractDate),
      };
      const contractScore = r0((Object.values(checks).filter(Boolean).length / 4) * 100);

      return {
        _id: v ? String(v._id) : null,
        supplierId: supplier ? String(supplier._id) : null,
        name: v?.name || cv?.name || supplier?.name || '—',
        inCrm: !!v,
        inContracts: !!cv,
        isNewVendor: v?.isNewVendor === true,
        energizeRep: v?.energizeRep || cv?.energizeRep || '',
        vendorType: v?.vendorType || cv?.vendorType || '',
        representative: v?.representative || cv?.contactPerson || '',
        mobile: v?.mobile || cv?.phone || supplier?.phone || '',
        email: v?.email || supplier?.email || '',
        headOffice: v?.headOffice || cv?.headquarters || '',
        destinations: v?.destinations || cv?.destinations || '',
        carsCount: fleetSize,
        followUpStatus: v?.followUpStatus || '',
        contractDate: v?.contractDate || (cv?.contractDate ? new Date(cv.contractDate).toISOString().slice(0, 10) : ''),
        checks,
        contractScore,
        // Work
        loads,
        ledgerLoads,
        trialLoads: now.length,
        prevLoads,
        loadGrowthPct: prevLoads ? r0(((loads - prevLoads) / prevLoads) * 100) : null,
        activeMonths: utilNow.filter((u) => (Number(u.orders) || 0) > 0).length,
        monthlyCapacity: capacity,
        utilisationPct,
        cost: r0(cost),
        revenue: r0(revenue),
        margin: r0(margin),
        marginPct: revenue ? r0((margin / revenue) * 100) : null,
        avgCostPerLoad: now.length ? r0(cost / now.length) : 0,
        routes,
        lastLoad,
        daysSinceLastLoad: daysAgo(lastLoad),
        loadsPerMonth: r1(loads / months2),
      };
    });

    const maxLoads = Math.max(1, ...rows.map((r) => r.loads));
    const maxCars = Math.max(1, ...rows.map((r) => r.carsCount || 0));
    // Median margin across vendors the trial priced — informational only now.
    const margins = rows.filter((r) => r.marginPct != null).map((r) => r.marginPct).sort((a, b) => a - b);
    const medianMargin = margins.length ? margins[Math.floor(margins.length / 2)] : 0;
    const totalLoads = rows.reduce((s2, r) => s2 + r.loads, 0);

    for (const r of rows) {
      const d = r.daysSinceLastLoad;
      const recencyValue = d == null ? 0 : r0(clamp01((120 - d) / 100) * 100);
      // Utilisation: how much of the capacity they told us they have did we
      // actually fill? 80%+ is a fully-worked partner. Unknown capacity → 50,
      // so a vendor isn't punished for a number nobody recorded.
      const utilValue = r.utilisationPct == null ? 50 : r0(clamp01(r.utilisationPct / 80) * 100);
      // Share of the company's total 3PL volume — shown, not scored (it is
      // already implicit in `volume`).
      r.sharePct = totalLoads ? r0((r.loads / totalLoads) * 100) : 0;

      const breakdown = [
        { key: 'volume', ar: 'الحمولات المنفذة', en: 'Loads carried', weight: VENDOR_WEIGHTS.volume, value: r0(clamp01(r.loads / maxLoads) * 100), detail: { loads: r.loads, best: maxLoads } },
        { key: 'contract', ar: 'اكتمال العقد', en: 'Contract completeness', weight: VENDOR_WEIGHTS.contract, value: r.contractScore, detail: r.checks },
        { key: 'capacity', ar: 'حجم الأسطول', en: 'Fleet capacity', weight: VENDOR_WEIGHTS.capacity, value: r0(clamp01((r.carsCount || 0) / maxCars) * 100), detail: { cars: r.carsCount, best: maxCars } },
        { key: 'utilisation', ar: 'نسبة التشغيل من الطاقة', en: 'Capacity utilisation', weight: VENDOR_WEIGHTS.utilisation, value: utilValue, detail: { utilisationPct: r.utilisationPct, capacity: r.monthlyCapacity, loads: r.ledgerLoads } },
        { key: 'recency', ar: 'آخر تشغيل', en: 'Recency', weight: VENDOR_WEIGHTS.recency, value: recencyValue, detail: { daysSince: d } },
      ];
      const totalWeight = breakdown.reduce((s2, b) => s2 + b.weight, 0);
      r.score = r0(breakdown.reduce((s2, b) => s2 + (b.value / 100) * b.weight, 0) * (100 / totalWeight));
      const band = bandOf(VENDOR_BANDS, r.score);
      r.band = band.key; r.bandAr = band.ar; r.bandEn = band.en; r.bandColor = band.color;
      r.breakdown = breakdown;
      r.flags = [
        !r.inCrm && { key: 'not_in_crm', ar: 'غير مسجل في CRM', en: 'Not in CRM' },
        r.contractScore < 100 && { key: 'contract_gap', ar: 'العقد/الأوراق ناقصة', en: 'Contract incomplete' },
        d != null && d > 90 && { key: 'idle', ar: 'بلا تشغيل > 90 يوم', en: 'Idle 90d+' },
        r.loads === 0 && { key: 'never_used', ar: 'لم يُشغَّل في الفترة', en: 'No loads in period' },
        r.utilisationPct != null && r.utilisationPct < 25 && r.loads > 0 && { key: 'under_used', ar: 'مستغَل أقل من طاقته', en: 'Under-used' },
      ].filter(Boolean);
    }

    rows.sort((a, b) => b.score - a.score || b.loads - a.loads);

    const payload = {
      period: { from, to, months: months2 },
      weights: VENDOR_WEIGHTS,
      bands: VENDOR_BANDS,
      medianMarginPct: medianMargin,
      summary: {
        vendors: rows.length,
        working: rows.filter((r) => r.loads > 0).length,
        idle: rows.filter((r) => r.loads === 0).length,
        contractComplete: rows.filter((r) => r.contractScore === 100).length,
        totalLoads,
        totalCost: r0(rows.reduce((s, r) => s + r.cost, 0)),
        totalMargin: r0(rows.reduce((s, r) => s + r.margin, 0)),
        underUsed: rows.filter((r) => r.utilisationPct != null && r.utilisationPct < 25 && r.loads > 0).length,
        averageScore: rows.length ? r0(rows.reduce((s, r) => s + r.score, 0) / rows.length) : 0,
        totalCars: rows.reduce((s, r) => s + (r.carsCount || 0), 0),
      },
      items: rows,
    };
    cache.set(key, payload, CACHE_TTL);
    res.json(payload);
  } catch (error) {
    console.error('getVendorKpis error:', error);
    res.status(500).json({ message: 'Failed to load vendor KPIs' });
  }
};
