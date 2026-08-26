const ItTicket = require('../models/ItTicket');
const ItSystem = require('../models/ItSystem');
// Custody deliberately reuses the HR Asset collection — an IT-issued laptop must
// appear on the employee's HR profile automatically, so there is exactly ONE
// custody collection in the system. /api/hr/* is gated to HR roles, which is the
// only reason these IT-facing endpoints exist at all.
const Asset = require('../models/Asset');
const Employee = require('../models/Employee');
const User = require('../models/User');
const AssetEvent = require('../models/AssetEvent');
const {
  BUCKETS, BUCKET_KEYS, EXCLUDED_TYPES, bucketOf, typesInBucket,
  deriveAssetName, normalizeBrand,
} = require('../config/itCustody');
const { emitToAll } = require('../websocket/socketManager');

// ── Helpers ─────────────────────────────────────────────────────────────────

const emit = (event, payload) => {
  try { emitToAll(event, payload); } catch (e) {}
};

// Custody writes touch data both sections display, so both must refresh.
const emitCustody = (payload) => {
  emit('hr:asset', payload);
  emit('it:updated', payload);
};

const pick = (body, fields) => {
  const out = {};
  fields.forEach((f) => { if (body[f] !== undefined) out[f] = body[f]; });
  return out;
};

const rx = (s) => new RegExp(String(s).trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');

// الشركة تعمل بتوقيت الرياض (UTC+3). الاعتماد على تاريخ UTC كان يقيّد أي عملية
// تحدث بعد التاسعة مساءً على تاريخ اليوم السابق، فتظهر العهدة مُسلَّمة قبل يوم
// من تسليمها الفعلي ويظهر البلاغ مفتوحاً قبل أن يُبلَّغ عنه.
const RIYADH_OFFSET_MS = 3 * 60 * 60 * 1000;

const dateInRiyadh = (t) => new Date(new Date(t).getTime() + RIYADH_OFFSET_MS).toISOString().slice(0, 10);

const today = () => dateInRiyadh(Date.now());

// The repeat key. Same category + same normalized title ⇒ same signature ⇒ the
// two tickets are treated as occurrences of one recurring problem. Arabic and
// Latin letters/digits are kept, everything else collapses to a single dash, so
// "Printer jam — 2nd floor!!" and "printer jam 2nd floor" match.
const buildSignature = (category, title) => {
  const slug = String(title || '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
  return `${String(category || 'other').toLowerCase()}:${slug}`;
};

/**
 * زمن الحل بالأيام الكاملة بين يوم البلاغ ويوم الحل.
 *
 * الحساب السابق كان يطرح لحظة الحفظ من منتصف ليل يوم البلاغ بتوقيت UTC، وينتج
 * عن ذلك رقمان كاذبان معاً: بلاغ يُغلق في يومه يظهر بعشر ساعات ونصف لأن منتصف
 * ليل UTC يسبق بداية دوام الرياض بثلاث ساعات، وبلاغ قديم يُدخَل اليوم كمحلول
 * يقيس المدة حتى لحظة إدخاله لا حتى لحظة إصلاحه. وتاريخ البلاغ أصلاً بلا وقت،
 * فأي رقم بالدقائق دقّة لا يملكها المصدر — واليوم الكامل هو أصدق ما يُقاس.
 */
const daysBetweenDates = (fromDateStr, toDateStr) => {
  if (!fromDateStr || !toDateStr) return undefined;
  const a = Date.parse(`${fromDateStr}T00:00:00Z`);
  const b = Date.parse(`${toDateStr}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return undefined;
  return Math.max(0, Math.round((b - a) / 86400000));
};

// التخزين يبقى بالدقائق لأن لوحة المعلومات وتقرير التكرار يحسبان المتوسط منه،
// لكن القيمة صارت دائماً من مضاعفات اليوم الكامل.
const resolutionMinutesOf = (reportedAt, resolvedDate) => {
  const d = daysBetweenDates(reportedAt, resolvedDate);
  return d === undefined ? undefined : d * 1440;
};

const CLOSED_STATUSES = new Set(['resolved', 'closed']);

// الأدوار التي يجوز إسناد بلاغ إليها. مطابقة لقائمة الصلاحيات في routes/it.js:
// إسناد بلاغ إلى من لا يملك صلاحية تعديله يترك البلاغ بلا من يقدر على إغلاقه.
const EDIT_ROLES = ['super_admin', 'admin', 'it_manager', 'it_specialist'];

const TICKET_EDITABLE = [
  'title', 'category', 'priority', 'status', 'requester', 'requesterName',
  'requesterDepartment', 'assignedTo', 'assignedToName', 'reportedAt', 'resolvedDate',
  'description', 'resolution', 'rootCause', 'preventiveAction',
  'relatedAsset', 'device', 'notes',
];


// Append to an item's movement log. Never throws into the caller: a failed log
// line must not roll back a handover that physically already happened — but it
// is logged loudly, because a gap in the trail is a real problem.
const logEvent = async (req, asset, action, extra = {}) => {
  try {
    await AssetEvent.create({
      asset: asset._id,
      action,
      date: extra.date || today(),
      by: req.user._id,
      byName: `${req.user.firstName || ''} ${req.user.lastName || ''}`.trim(),
      section: 'it',
      ...extra,
    });
  } catch (e) {
    console.error('[custody] failed to log', action, 'for', String(asset._id), e.message);
  }
};

// `name` غير مذكور عمداً: يُشتق من النوع والماركة في المتحكّم، وقبوله من الطلب
// يعيد فتح باب الأسماء الحرّة الذي جاءت منه ستة وستون تهجئة لأربعمئة صنف.
const CUSTODY_EDITABLE = [
  'employee', 'type', 'serialNumber', 'brand', 'condition',
  'value', 'assignedDate', 'notes', 'category', 'specs', 'quantity',
];

// Stock items have no employee and no assignedDate — they gain both the moment
// they are handed out via assignFromStock.
// كما في العهدة: الاسم مشتقّ لا مُدخَل. والموديل والموقع أُسقطا لأنهما كانا
// يُترَكان فارغين في أغلب الصفوف فيتحوّل حقلان إلى عمودين فارغين في كل تقرير.
const STOCK_EDITABLE = [
  'type', 'serialNumber', 'brand', 'condition', 'value',
  'notes', 'category', 'specs', 'quantity',
];

const SYSTEM_EDITABLE = [
  'name', 'nameAr', 'type', 'status', 'owner', 'vendor', 'url', 'environment',
  'renewalDate', 'cost', 'costPeriod', 'credentialsNote', 'description', 'notes',
];

// الأنواع التي يسلّمها القسم: كل ما تعرفه الدلاء الخمسة. المركبات تخص الأسطول،
// و`tool` عهدة الموارد البشرية، وشرائح الاتصال ليست من عهدتنا — والثلاثة
// مستبعدة من مصدر واحد في config/itCustody حتى لا تعود من شاشة نسيها أحد.
const IT_CUSTODY_TYPES = BUCKETS
  .flatMap((b) => b.types)
  .filter((t) => !EXCLUDED_TYPES.includes(t));

// استعلام يُستثنى منه ما لا يخص القسم. يُستخدم في كل قراءة للأصول حتى تتطابق
// أعداد الكروت مع أعداد الجداول — كارت يعدّ صفوفاً لا يظهرها الجدول هو خطأ.
const NOT_EXCLUDED = { type: { $nin: EXCLUDED_TYPES } };

const EMP_FIELDS = 'firstName lastName arabicName iqamaNumber employeeNumber department';

// ── Dashboard ───────────────────────────────────────────────────────────────

exports.getDashboard = async (req, res) => {
  try {
    const to = req.query.to || today();
    const from = req.query.from || new Date(Date.now() - 89 * 86400000).toISOString().slice(0, 10);
    const inPeriod = { reportedAt: { $gte: from, $lte: to } };

    const [tickets, periodTickets, assets, systems] = await Promise.all([
      ItTicket.find({}).select('status category priority signature title reportedAt resolutionMinutes requesterDepartment ticketNumber createdAt isRecurring').sort({ createdAt: -1 }).limit(5000).lean(),
      ItTicket.find(inPeriod).select('status reportedAt resolvedAt resolutionMinutes').lean(),
      Asset.find(NOT_EXCLUDED).select('status type quantity condition value').lean(),
      ItSystem.find({}).select('name nameAr status renewalDate cost costPeriod type').lean(),
    ]);

    // صف واحد قد يمثّل عدة وحدات متطابقة (كابلات، شواحن)، فالعدّ بالوحدات لا
    // بالصفوف — صف فيه عشرون كابلاً هو عشرون كابلاً.
    const units = (a) => Math.max(1, Number(a.quantity) || 1);

    const countBy = (rows, key) => {
      const m = new Map();
      rows.forEach((r) => m.set(r[key] || 'other', (m.get(r[key] || 'other') || 0) + 1));
      return Array.from(m, ([k, count]) => ({ key: k, count })).sort((a, b) => b.count - a.count);
    };

    const resolvedInPeriod = periodTickets.filter((t) => CLOSED_STATUSES.has(t.status));
    const durations = resolvedInPeriod.map((t) => t.resolutionMinutes).filter((n) => typeof n === 'number');

    // Opened-vs-resolved per day across the window.
    const days = new Map();
    const touch = (d) => { if (!days.has(d)) days.set(d, { date: d, opened: 0, resolved: 0 }); return days.get(d); };
    periodTickets.forEach((t) => { if (t.reportedAt) touch(t.reportedAt).opened += 1; });
    resolvedInPeriod.forEach((t) => {
      const d = t.resolvedAt ? new Date(t.resolvedAt).toISOString().slice(0, 10) : t.reportedAt;
      if (d) touch(d).resolved += 1;
    });
    const timeline = Array.from(days.values()).sort((a, b) => a.date.localeCompare(b.date));

    // Renewals inside the next 60 days (or already overdue).
    const horizon = new Date(Date.now() + 60 * 86400000).toISOString().slice(0, 10);
    const renewalsDueSoon = systems
      .filter((s) => s.renewalDate && s.renewalDate <= horizon && s.status !== 'retired')
      .sort((a, b) => a.renewalDate.localeCompare(b.renewalDate))
      .slice(0, 15);

    // Warehouse view. A consumable row can stand for many units, so stock is
    // counted in units (quantity) rather than documents — 1 row of 20 cables is
    // 20 cables, and the low-stock warning has to know that.
    const stockItems = assets.filter((a) => a.status === 'in_stock');
    const stockCount = stockItems.reduce((s, a) => s + units(a), 0);

    const stockMap = new Map();
    stockItems.forEach((a) => {
      const k = a.type || 'other';
      stockMap.set(k, (stockMap.get(k) || 0) + units(a));
    });
    const stockByType = Array.from(stockMap, ([key, count]) => ({ key, count }))
      .sort((a, b) => b.count - a.count);

    // "We're about to run out" — any IT type with fewer than 3 units on the
    // shelf, including the types that have hit zero and so never appear above.
    const LOW_STOCK_THRESHOLD = 3;
    const lowStock = IT_CUSTODY_TYPES
      .map((key) => ({ key, count: stockMap.get(key) || 0 }))
      .filter((r) => r.count < LOW_STOCK_THRESHOLD)
      .sort((a, b) => a.count - b.count);

    // ── ملخّص العهد: نفس الكروت ونفس الأزرار المعروضة في صفحة العهد ──────────
    // اللوحة تقرأ نفس التجميع الذي تقرأه الصفحة حتى لا يختلف رقمان لشيء واحد
    // على شاشتين — وهو أسرع طريق لفقدان الثقة في الاثنتين معاً.
    const custodyBuckets = BUCKETS.map((b) => ({ key: b.key, nameAr: b.nameAr, nameEn: b.nameEn, count: 0 }));
    const bucketIndex = new Map(custodyBuckets.map((b) => [b.key, b]));
    const custodyByStatus = { assigned: 0, in_stock: 0, returned: 0 };
    const conditionMap = new Map();
    const otherKindMap = new Map();

    assets.forEach((a) => {
      const n = units(a);
      const b = bucketIndex.get(bucketOf(a.type));
      if (b) b.count += n;
      if (custodyByStatus[a.status] !== undefined) custodyByStatus[a.status] += n;
      const c = a.condition || 'good';
      conditionMap.set(c, (conditionMap.get(c) || 0) + n);
      // تفصيل دلو «أخرى» — الفلتر الثاني على الشاشة يعرض ما فيه فعلاً فقط، لا
      // كل نوع ممكن، حتى لا يختار المستخدم فلتراً نتيجته صفر.
      if (bucketOf(a.type) === 'other') otherKindMap.set(a.type, (otherKindMap.get(a.type) || 0) + n);
    });

    const sortedCount = (m) => Array.from(m, ([key, count]) => ({ key, count })).sort((a, b) => b.count - a.count);

    const custody = {
      buckets: custodyBuckets,
      byStatus: custodyByStatus,
      byCondition: sortedCount(conditionMap),
      otherKinds: sortedCount(otherKindMap),
      total: custodyBuckets.reduce((s2, b) => s2 + b.count, 0),
    };

    const totals = {
      openTickets: tickets.filter((t) => t.status === 'open' || t.status === 'reopened').length,
      inProgress: tickets.filter((t) => t.status === 'in_progress').length,
      resolvedThisPeriod: resolvedInPeriod.length,
      avgResolutionMinutes: durations.length
        ? Math.round(durations.reduce((s, n) => s + n, 0) / durations.length)
        : 0,
      ticketsByCategory: countBy(tickets, 'category'),
      ticketsByPriority: countBy(tickets, 'priority'),
      ticketsByStatus: countBy(tickets, 'status'),
      timeline,
      assetsAssigned: assets.filter((a) => a.status === 'assigned').length,
      // Kept for the existing dashboard card: retired / out-of-circulation gear.
      assetsInStock: assets.filter((a) => a.status === 'returned').length,
      stockCount,
      stockByType,
      lowStock,
      systemsByStatus: countBy(systems, 'status'),
      renewalsDueSoon,
    };

    res.json({
      totals,
      custody,
      topRecurring: groupRecurring(tickets).slice(0, 6),
      recentTickets: tickets.slice(0, 8),
      range: { from, to },
    });
  } catch (error) {
    res.status(500).json({ message: 'Failed to load IT dashboard' });
  }
};

// ── Tickets ─────────────────────────────────────────────────────────────────

exports.listTickets = async (req, res) => {
  try {
    const { status, category, priority, assignedTo, q, from, to } = req.query;
    const filter = {};
    if (status) filter.status = status;
    if (category) filter.category = category;
    if (priority) filter.priority = priority;
    if (assignedTo) filter.assignedTo = assignedTo;
    if (from || to) {
      filter.reportedAt = {};
      if (from) filter.reportedAt.$gte = from;
      if (to) filter.reportedAt.$lte = to;
    }
    if (q && q.trim()) {
      const r = rx(q);
      filter.$or = [{ title: r }, { ticketNumber: r }, { description: r }, { requesterName: r }, { device: r }];
    }

    const tickets = await ItTicket.find(filter)
      .populate('requester', EMP_FIELDS)
      .populate('assignedTo', 'firstName lastName')
      .sort({ reportedAt: -1, createdAt: -1 })
      .limit(2000)
      .lean();

    res.json({ tickets });
  } catch (error) {
    res.status(500).json({ message: 'Failed to load tickets' });
  }
};

exports.getTicket = async (req, res) => {
  try {
    const ticket = await ItTicket.findById(req.params.id)
      .populate('requester', EMP_FIELDS)
      .populate('assignedTo', 'firstName lastName')
      .populate('relatedAsset', 'name serialNumber type')
      .lean();
    if (!ticket) return res.status(404).json({ message: 'Ticket not found' });

    // Every other ticket that shares this signature — the problem's repeat
    // history, which is the whole reason the signature exists.
    const siblings = ticket.signature
      ? await ItTicket.find({ signature: ticket.signature, _id: { $ne: ticket._id } })
          .select('ticketNumber title status priority reportedAt resolvedAt resolutionMinutes resolution rootCause requesterName requesterDepartment')
          .sort({ reportedAt: -1 })
          .limit(100)
          .lean()
      : [];

    res.json({ ticket, siblings });
  } catch (error) {
    res.status(500).json({ message: 'Failed to load ticket' });
  }
};

exports.createTicket = async (req, res) => {
  try {
    if (!req.body.title || !String(req.body.title).trim()) {
      return res.status(400).json({ message: 'Title is required' });
    }
    const data = pick(req.body, TICKET_EDITABLE);
    if (!data.reportedAt) data.reportedAt = today();
    data.signature = buildSignature(data.category, data.title);
    data.createdBy = req.user._id;

    // Third strike and it's officially a recurring problem — flag this one AND
    // retro-flag the earlier occurrences so the report catches them all.
    const priorCount = await ItTicket.countDocuments({ signature: data.signature });
    if (priorCount >= 2) {
      data.isRecurring = true;
      await ItTicket.updateMany({ signature: data.signature }, { $set: { isRecurring: true } });
    }

    if (CLOSED_STATUSES.has(data.status)) {
      // يوم الحل يُدخله المستخدم؛ لحظة الحفظ ليست لحظة الإصلاح، وأغلب البلاغات
      // تُسجَّل بعد إغلاقها بأيام.
      if (!data.resolvedDate) data.resolvedDate = today();
      data.resolvedAt = new Date(`${data.resolvedDate}T00:00:00Z`);
      data.resolutionMinutes = resolutionMinutesOf(data.reportedAt, data.resolvedDate);
    }

    const ticket = await ItTicket.create(data);
    emit('it:updated', { type: 'ticket', id: String(ticket._id) });
    res.status(201).json({ ticket });
  } catch (error) {
    res.status(500).json({ message: 'Failed to create ticket' });
  }
};

exports.updateTicket = async (req, res) => {
  try {
    const ticket = await ItTicket.findById(req.params.id);
    if (!ticket) return res.status(404).json({ message: 'Ticket not found' });

    const wasClosed = CLOSED_STATUSES.has(ticket.status);
    const data = pick(req.body, TICKET_EDITABLE);
    Object.assign(ticket, data);

    // Retitling or recategorising re-points the ticket at a different problem.
    if (data.title !== undefined || data.category !== undefined) {
      ticket.signature = buildSignature(ticket.category, ticket.title);
    }

    const nowClosed = CLOSED_STATUSES.has(ticket.status);
    if (nowClosed) {
      // يُعاد الحساب مع كل حفظ مُغلق، لا عند الإغلاق أول مرة فقط: تصحيح تاريخ
      // بلاغ سبق إغلاقه كان يترك زمن الحل على قيمته القديمة الخاطئة.
      if (!ticket.resolvedDate) ticket.resolvedDate = today();
      ticket.resolvedAt = new Date(`${ticket.resolvedDate}T00:00:00Z`);
      ticket.resolutionMinutes = resolutionMinutesOf(ticket.reportedAt, ticket.resolvedDate);
    } else if (!nowClosed && wasClosed) {
      ticket.resolvedDate = undefined;
      ticket.resolvedAt = undefined;
      ticket.resolutionMinutes = undefined;
    }

    await ticket.save();
    emit('it:updated', { type: 'ticket', id: String(ticket._id) });
    res.json({ ticket });
  } catch (error) {
    res.status(500).json({ message: 'Failed to update ticket' });
  }
};

exports.deleteTicket = async (req, res) => {
  try {
    await ItTicket.findByIdAndDelete(req.params.id);
    emit('it:updated', { type: 'ticket', id: String(req.params.id) });
    res.json({ message: 'Ticket deleted' });
  } catch (error) {
    res.status(500).json({ message: 'Failed to delete ticket' });
  }
};

// Group tickets into repeat-clusters by signature. Shared by the dashboard's
// "top recurring" panel and the full recurring report.
function groupRecurring(tickets) {
  const groups = new Map();
  tickets.forEach((t) => {
    const sig = t.signature;
    if (!sig) return;
    if (!groups.has(sig)) {
      groups.set(sig, {
        signature: sig,
        sampleTitle: t.title,
        category: t.category,
        count: 0,
        lastReportedAt: null,
        firstReportedAt: null,
        _durations: [],
        _departments: new Set(),
        ticketIds: [],
      });
    }
    const g = groups.get(sig);
    g.count += 1;
    g.ticketIds.push(String(t._id));
    if (t.reportedAt) {
      if (!g.lastReportedAt || t.reportedAt > g.lastReportedAt) g.lastReportedAt = t.reportedAt;
      if (!g.firstReportedAt || t.reportedAt < g.firstReportedAt) g.firstReportedAt = t.reportedAt;
    }
    if (typeof t.resolutionMinutes === 'number') g._durations.push(t.resolutionMinutes);
    if (t.requesterDepartment) g._departments.add(t.requesterDepartment);
  });

  return Array.from(groups.values())
    .filter((g) => g.count >= 2)
    .map((g) => ({
      signature: g.signature,
      sampleTitle: g.sampleTitle,
      category: g.category,
      count: g.count,
      lastReportedAt: g.lastReportedAt,
      firstReportedAt: g.firstReportedAt,
      avgResolutionMinutes: g._durations.length
        ? Math.round(g._durations.reduce((s, n) => s + n, 0) / g._durations.length)
        : 0,
      affectedDepartments: Array.from(g._departments),
      ticketIds: g.ticketIds,
    }))
    .sort((a, b) => b.count - a.count);
}

// The "this problem keeps coming back" report — the signal that a permanent
// root-cause fix is overdue.
exports.getRecurring = async (req, res) => {
  try {
    const filter = {};
    if (req.query.category) filter.category = req.query.category;
    if (req.query.from || req.query.to) {
      filter.reportedAt = {};
      if (req.query.from) filter.reportedAt.$gte = req.query.from;
      if (req.query.to) filter.reportedAt.$lte = req.query.to;
    }

    const tickets = await ItTicket.find(filter)
      .select('title category signature reportedAt resolutionMinutes requesterDepartment ticketNumber status priority')
      .limit(5000)
      .lean();

    const groups = groupRecurring(tickets);
    const byId = new Map(tickets.map((t) => [String(t._id), t]));

    res.json({
      groups,
      // Lets the page expand a group without a second round-trip.
      tickets: groups.flatMap((g) => g.ticketIds.map((id) => byId.get(id)).filter(Boolean)),
    });
  } catch (error) {
    res.status(500).json({ message: 'Failed to load recurring report' });
  }
};

// ── Custody (العهد) — the SAME Asset collection HR uses ─────────────────────

// طيّ حروف العربية المتغيّرة الرسم قبل المقارنة: «أحمد» و«احمد»، «شاشه»
// و«شاشة». من دونه يبحث المستخدم بالاسم كما يكتبه هو فلا يجد صفّاً كُتب
// بهمزةٍ أخرى، فيظنّ أن الصنف غير مسجَّل أصلاً فيُدخله مرة ثانية.
const fold = (s) => String(s || '')
  .replace(/[أإآ]/g, 'ا')
  .replace(/ى/g, 'ي')
  .replace(/ة/g, 'ه')
  .toLowerCase()
  .trim();

// النص الذي يجري عليه البحث. اسم الموظف جزء منه لأن أكثر ما يُسأل عنه في سجل
// العهد هو «مَن يحمل هذا الجهاز» لا اسم الجهاز — وهو ما كانت الشاشة تبحث فيه
// وحدها قبل أن ينتقل البحث إلى الخادم.
const custodyHaystack = (a) => fold([
  a.name, a.serialNumber, a.brand, a.model, a.specs,
  a.employee && [a.employee.firstName, a.employee.lastName, a.employee.arabicName, a.employee.employeeNumber]
    .filter(Boolean).join(' '),
].filter(Boolean).join(' '));

/**
 * GET /custody — الصفوف المعروضة وأعدادُ الكروت والأزرار في ردٍّ واحد.
 *
 * الأعداد كانت تُحسب في الشاشة على السجل كلّه بينما الجدول تحتها مفلتر: يضغط
 * المستخدم «المستودع» فتتبدّل الصفوف ويبقى كارت «لابتوبات» على ٦٨ وتحته ستة
 * صفوف. رقمٌ لا يصف ما تحته ليس معلومة، ويسحب معه الثقة في بقيّة الأرقام.
 *
 * فصار كل شيء يُشتق هنا من تعريفٍ واحد: المطابِقات تُبنى مرّة، ومنها يخرج
 * المعروضُ وتخرج الأعداد — العدّ هو طول المجموعة التي يفتحها الضغط لا حساباً
 * موازياً لها.
 *
 * وكل عدّ تُطبَّق عليه الفلاتر كلها **إلا البُعد الذي يخصّه**: عدد كارت
 * «لابتوبات» يُحسب بعد فلتر الحالة والحالة الفنية والبحث ودون فلتر الفئة —
 * وإلا لعرضت الكروت الأربعة الأخرى صفراً بمجرّد اختيار واحدٍ منها فلا يستطيع
 * أحد أن ينتقل بينها. وهو شكل hrMasterController.filterOptions نفسه.
 */
exports.listCustody = async (req, res) => {
  try {
    const { status, type, bucket, otherType, condition, employee, q, scope } = req.query;

    // القراءة تتم مرّة واحدة بلا فلاتر الواجهة، ثم تُفلتَر وتُعدّ في الذاكرة:
    // السجل بضع مئات من الصفوف، وفصلُ الفلترة عن الاستعلام هو ما يضمن أن يخرج
    // العدّ والصفوف من نفس المطابِقات بالحرف.
    // `scope=all` يضم المستودع، لأن زر «المستودع» وكارت كل فئة يعدّان المخزون
    // أيضاً: عدٌّ ينقصه ثلث السجل ليس إجمالياً.
    const base = { type: { $in: IT_CUSTODY_TYPES } };
    if (scope !== 'all') base.status = { $ne: 'in_stock' };
    if (employee) base.employee = employee;

    const runQuery = () => Asset.find(base)
      .populate('employee', EMP_FIELDS)
      .populate('assignedBy', 'firstName lastName')
      .sort({ createdAt: -1 })
      .limit(2000)
      .lean();

    // المفتاح لا يحمل فلاتر الواجهة: المخزَّن هو السجل الخام، والفلترة تجري
    // فوقه في كل طلب. وكتابات Asset تُبطل البادئة 'it:custody' من الـ hooks.
    const cache = require('../utils/ttlCache');
    const rows = await cache.wrap(`it:custody:rows:${scope || ''}:${employee || ''}`, 20000, runQuery);

    const wantedBucket = BUCKET_KEYS.includes(bucket) ? bucket : '';
    // `otherType` هو الفلتر الثاني داخل «أخرى»، و`type` يبقى مقبولاً لأن روابط
    // اللوحة القديمة تستعمله.
    const exactType = String(otherType || type || '').trim();
    const needle = fold(q);

    // مطابِق لكل بُعد على حدة — وعليها يقوم استثناءُ كل عدٍّ من فلتره هو.
    const byCat = (a) => (!wantedBucket || bucketOf(a.type) === wantedBucket)
      && (!exactType || a.type === exactType);
    const byState = (a) => !status || a.status === status;
    const byCondition = (a) => !condition || a.condition === condition;
    const bySearch = (a) => !needle || custodyHaystack(a).includes(needle);

    const items = rows.filter((a) => byCat(a) && byState(a) && byCondition(a) && bySearch(a));

    const tally = (pred) => rows.reduce((n, a) => n + (pred(a) ? 1 : 0), 0);

    // كروت الفئات الخمس: كل الفلاتر عدا الفئة.
    const buckets = BUCKETS.map((b) => ({
      key: b.key,
      nameAr: b.nameAr,
      nameEn: b.nameEn,
      count: tally((a) => byState(a) && byCondition(a) && bySearch(a) && bucketOf(a.type) === b.key),
    }));

    // أزرار الحالة الثلاثة: كل الفلاتر عدا الحالة.
    const byStatus = { assigned: 0, in_stock: 0, returned: 0 };
    rows.forEach((a) => {
      if (byCat(a) && byCondition(a) && bySearch(a) && byStatus[a.status] !== undefined) byStatus[a.status] += 1;
    });

    // تفصيل «أخرى»: كل الفلاتر عدا النوع المفصّل، وداخل الدلو وحده.
    const kindMap = new Map();
    rows.forEach((a) => {
      if (bucketOf(a.type) !== 'other') return;
      if (!byState(a) || !byCondition(a) || !bySearch(a)) return;
      kindMap.set(a.type, (kindMap.get(a.type) || 0) + 1);
    });
    // النوع المختار يبقى ظاهراً ولو صار صفراً بعد فلترٍ آخر: إخفاؤه وهو مفعَّل
    // يترك المستخدم أمام قائمة فارغة بلا زرٍّ يرفع الفلتر الذي أفرغها.
    if (exactType && bucketOf(exactType) === 'other' && !kindMap.has(exactType)) kindMap.set(exactType, 0);
    const otherKinds = typesInBucket('other')
      .filter((t) => kindMap.has(t))
      .map((t) => ({ key: t, count: kindMap.get(t) }));

    // الحالات الفنية: كل الفلاتر عدا الحالة الفنية.
    const condMap = new Map();
    rows.forEach((a) => {
      if (!byCat(a) || !byState(a) || !bySearch(a)) return;
      const c = a.condition || 'good';
      condMap.set(c, (condMap.get(c) || 0) + 1);
    });
    if (condition && !condMap.has(condition)) condMap.set(condition, 0);
    const conditions = Array.from(condMap, ([key, count]) => ({ key, count })).sort((x, y) => y.count - x.count);

    res.json({
      items,
      counts: {
        buckets,
        byStatus,
        otherKinds,
        conditions,
        // «المعروض الآن» وقيمته: كلاهما يصف الجدول الذي تحته، لا السجل كله.
        total: items.length,
        value: items.reduce((s, a) => s + (Number(a.value) || 0), 0),
      },
      // إجمالي السجل يبقى معروضاً بجانب الرقم المفلتر ليُعرف من أيٍّ اقتُطع، لا
      // ليحلّ محلّه.
      register: {
        total: rows.length,
        assigned: rows.filter((a) => a.status === 'assigned').length,
      },
    });
  } catch (error) {
    res.status(500).json({ message: 'Failed to load custody items' });
  }
};

exports.createCustody = async (req, res) => {
  try {
    if (!req.body.employee) {
      return res.status(400).json({ message: 'Employee is required' });
    }
    const data = pick(req.body, CUSTODY_EDITABLE);
    // الاسم لم يعد يُكتب باليد — يُشتق من النوع والماركة كما في المستودع تماماً،
    // فيخرج الصنف باسم واحد أياً كان من أدخله ومن أي شاشة.
    data.brand = normalizeBrand(data.brand);
    data.name = deriveAssetName(data.type, data.brand);
    if (!data.assignedDate) data.assignedDate = today();
    if (!data.category) data.category = 'IT';
    if (data.quantity === undefined || Number(data.quantity) < 1) data.quantity = 1;
    data.issuedBySection = 'it';
    data.assignedBy = req.user._id;
    data.createdBy = req.user._id;

    const item = await Asset.create(data);
    // جهاز يُسلَّم مباشرة دون المرور بالرف يجب أن يُقيَّد في السجل بنفس الطريقة:
    // من دون قيد الدخول يبدأ تاريخ الصنف من لحظة تسليمه، فلا يظهر في السجل أنه
    // دخل ملك الشركة أصلاً ولا كيف دخل.
    await logEvent(req, item, 'added_to_store', { condition: item.condition, date: item.assignedDate });
    await logEvent(req, item, 'assigned', { toEmployee: item.employee, date: item.assignedDate, condition: item.condition });
    emitCustody({ type: 'custody', id: String(item._id) });
    res.status(201).json({ item });
  } catch (error) {
    res.status(500).json({ message: 'Failed to create custody item' });
  }
};

exports.updateCustody = async (req, res) => {
  try {
    const item = await Asset.findById(req.params.id);
    if (!item) return res.status(404).json({ message: 'Custody item not found' });
    Object.assign(item, pick(req.body, CUSTODY_EDITABLE));
    // الاسم مشتقّ، فلا بد أن يتبع أي تعديل على النوع أو الماركة — وإلا بقي صنف
    // صار «شاشة Dell» معروضاً باسم «لابتوب Dell» الذي اشتُقّ له أول مرة.
    item.brand = normalizeBrand(item.brand);
    item.name = deriveAssetName(item.type, item.brand);
    await item.save();
    emitCustody({ type: 'custody', id: String(item._id) });
    res.json({ item });
  } catch (error) {
    res.status(500).json({ message: 'Failed to update custody item' });
  }
};

// Mirrors hrController.returnAsset — returning custody is the gate that unlocks
// contract termination, so HR screens must see it immediately.
//
// A returned device normally goes back on the shelf and gets handed to the next
// person, so the default lands it in stock rather than retiring it. Pass
// `{ retire: true }` for gear that is genuinely out of circulation (dead,
// written off, sold) — that keeps the old `status: 'returned'` terminal state.
exports.returnCustody = async (req, res) => {
  try {
    const item = await Asset.findById(req.params.id);
    if (!item) return res.status(404).json({ message: 'Custody item not found' });

    // Captured before we clear it — HR's employee screen needs the refresh.
    const previousEmployee = item.employee ? String(item.employee) : null;

    item.returnedDate = req.body.returnedDate || today();
    if (req.body.returnedCondition) {
      item.returnedCondition = req.body.returnedCondition;
      // The condition it came back in is the condition it now sits in.
      item.condition = req.body.returnedCondition;
    }
    item.returnedTo = req.user._id;

    if (req.body.retire) {
      item.status = 'returned';
    } else {
      item.status = 'in_stock';
      item.employee = null;
      item.assignedDate = undefined;
      if (req.body.location !== undefined) item.location = req.body.location;
    }

    await item.save();
    await logEvent(req, item, req.body.retire ? 'retired' : 'returned', {
      fromEmployee: previousEmployee,
      date: item.returnedDate,
      condition: item.returnedCondition || item.condition,
      notes: req.body.notes,
    });
    emitCustody({ type: 'custody', id: String(item._id) });
    if (previousEmployee) emit('hr:employee', { id: previousEmployee });
    res.json({ item });
  } catch (error) {
    res.status(500).json({ message: 'Failed to return custody item' });
  }
};

// ── Custody movements: transfer, report, retire, batch handover ─────────────
// A device's life is one Asset document plus an AssetEvent trail. Each endpoint
// below moves the document and appends the matching event, so "who had this and
// when" is always answerable.

// Employee → employee, without a trip through the store. The receiving side is
// validated first: half a transfer is worse than none.
exports.transferCustody = async (req, res) => {
  try {
    const { toEmployee, date, condition, notes } = req.body;
    if (!toEmployee) return res.status(400).json({ message: 'Receiving employee is required' });

    const item = await Asset.findById(req.params.id);
    if (!item) return res.status(404).json({ message: 'Custody item not found' });
    if (item.status !== 'assigned') {
      return res.status(400).json({ message: 'Only an item currently held by an employee can be transferred' });
    }
    if (String(item.employee) === String(toEmployee)) {
      return res.status(400).json({ message: 'The item is already held by that employee' });
    }

    const receiver = await Employee.findById(toEmployee).select('_id user').lean();
    if (!receiver) return res.status(404).json({ message: 'Receiving employee not found' });

    const fromEmployee = item.employee;
    item.employee = receiver._id;
    item.assignedDate = date || today();
    item.assignedBy = req.user._id;
    if (condition) item.condition = condition;
    await item.save();

    await logEvent(req, item, 'transferred', { fromEmployee, toEmployee: receiver._id, date, condition, notes });

    emitCustody({ type: 'custody', id: String(item._id) });
    // Both profiles changed — the giver lost an item, the receiver gained one.
    if (fromEmployee) emit('hr:employee', { id: String(fromEmployee) });
    emit('hr:employee', { id: String(receiver._id) });
    res.json({ item });
  } catch (error) {
    res.status(500).json({ message: 'Failed to transfer custody item' });
  }
};

// ── تالف: إجراءٌ واحد لا اثنان ─────────────────────────────────────────────
//
// كان في الشاشة زرّان يفعلان الشيء نفسه في نظر مَن يستعملها: «الإبلاغ عن تالف»
// يكتب بلاغاً بسببه وقيمة الخصم لكنه يترك الصنف بعهدة الموظف كأنّ شيئاً لم
// يقع، و«التحويل إلى تالف» ينقل الحالة إلى تالف لكنه لا يسجّل سبباً ولا خصماً.
// فمن ضغط الأول ظنّ أنه أخرج الجهاز وهو ما زال محسوباً عهدةً قائمة، ومن ضغط
// الثاني أخرجه بلا أثرٍ يقول لماذا ولا كم كلّف.
//
// صارا واحداً يفعل الاثنين: يكتب البلاغ بسببه وخصمه، وينقل الصنف إلى «تالف»
// فيظهر تحت الزر الذي يحمل الاسم نفسه.
//
// والموظف يبقى مقيَّداً على الصنف عمداً — السجل يجب أن يقول من كان يحمله حين
// تلف — ولا يُحسب عليه بعد ذلك، لأن كل بوابات الموارد البشرية (إنهاء العقد،
// إخلاء الطرف، جرد العهدة) تسأل عن `status: 'assigned'` وحدها.
exports.markFaulty = async (req, res) => {
  try {
    // بلاغٌ بلا نوع يُقرأ «تالف»: المسار القديم /retire كان يُنادى بجسمٍ فارغ،
    // وما زالت نسخ الموبايل المثبَّتة تناديه.
    const kind = req.body.kind || 'damaged';
    const { notes, cost, date } = req.body;
    if (!['damaged', 'lost'].includes(kind)) {
      return res.status(400).json({ message: 'kind must be "damaged" or "lost"' });
    }

    const item = await Asset.findById(req.params.id);
    if (!item) return res.status(404).json({ message: 'Custody item not found' });
    if (item.status === 'returned') {
      return res.status(400).json({ message: 'This item is already out of service' });
    }

    const holder = item.employee ? String(item.employee) : null;

    // التالف لا يبقى موصوفاً بأنه «جيد». أما المفقود فحالته الفنية تبقى كما
    // كانت: هو لم يتلف — اختفى، ووصفه بالتلف ادّعاءٌ لا يعرفه أحد.
    if (kind === 'damaged') item.condition = 'damaged';
    item.status = 'returned';
    item.returnedDate = date || today();
    item.returnedCondition = item.condition;
    item.returnedTo = req.user._id;
    await item.save();

    await logEvent(req, item, kind, {
      fromEmployee: holder,
      date: item.returnedDate,
      condition: item.condition,
      cost: Number(cost) || 0,
      notes,
    });

    emitCustody({ type: 'custody', id: String(item._id) });
    if (holder) emit('hr:employee', { id: holder });
    res.json({ item });
  } catch (error) {
    res.status(500).json({ message: 'Failed to record the item as faulty' });
  }
};

// المساران القديمان صارا اسمين لمعالجٍ واحد: بقاؤهما تنفيذين منفصلين هو ما
// أنتج زرّين لشيء واحد أصلاً، وحذف أحدهما يكسر نسخ الموبايل المثبَّتة التي
// تناديه.
exports.reportCustody = exports.markFaulty;
exports.retireCustody = exports.markFaulty;

// The handover desk: an employee walks in with some of their gear. Pick what
// they actually handed back; whatever is not ticked stays on them, and the
// response says exactly what is still outstanding.
exports.handoverCustody = async (req, res) => {
  try {
    const { employee, items, date, condition, notes, retire } = req.body;
    if (!employee) return res.status(400).json({ message: 'Employee is required' });
    if (!Array.isArray(items) || !items.length) {
      return res.status(400).json({ message: 'Select at least one item that was handed back' });
    }

    // Scoped to this employee's own assigned items, so a stray id in the list
    // can never return someone else's device.
    const held = await Asset.find({ _id: { $in: items }, employee, status: 'assigned' });
    if (!held.length) return res.status(404).json({ message: 'None of those items are currently held by this employee' });

    for (const item of held) {
      item.returnedDate = date || today();
      item.returnedTo = req.user._id;
      if (condition) {
        item.returnedCondition = condition;
        item.condition = condition;
      }
      if (retire) {
        item.status = 'returned';
      } else {
        item.status = 'in_stock';
        item.employee = null;
        item.assignedDate = undefined;
      }
      await item.save();
      await logEvent(req, item, retire ? 'retired' : 'returned', {
        fromEmployee: employee, date, condition, notes,
      });
      emitCustody({ type: 'custody', id: String(item._id) });
    }

    const outstanding = await Asset.find({ employee, status: 'assigned' })
      .select('name type serialNumber brand model assignedDate')
      .lean();

    emit('hr:employee', { id: String(employee) });
    res.json({ returned: held.length, outstanding });
  } catch (error) {
    res.status(500).json({ message: 'Failed to record the handover' });
  }
};

// Everything an employee holds right now plus what they have already handed
// back — the two halves of the handover screen.
exports.custodyByEmployee = async (req, res) => {
  try {
    const employee = req.params.employeeId;
    const [assigned, history] = await Promise.all([
      Asset.find({ employee, status: 'assigned' }).sort({ assignedDate: -1 }).lean(),
      AssetEvent.find({ $or: [{ fromEmployee: employee }, { toEmployee: employee }] })
        .populate('asset', 'name type serialNumber brand model')
        .populate('fromEmployee toEmployee', EMP_FIELDS)
        .sort({ createdAt: -1 })
        .limit(200)
        .lean(),
    ]);
    res.json({ assigned, history });
  } catch (error) {
    res.status(500).json({ message: 'Failed to load the employee custody record' });
  }
};

// One item's full timeline.
exports.custodyHistory = async (req, res) => {
  try {
    const events = await AssetEvent.find({ asset: req.params.id })
      .populate('fromEmployee toEmployee', EMP_FIELDS)
      .populate('by', 'firstName lastName')
      .sort({ createdAt: -1 })
      .limit(200)
      .lean();
    res.json({ events });
  } catch (error) {
    res.status(500).json({ message: 'Failed to load the item history' });
  }
};

exports.deleteCustody = async (req, res) => {
  try {
    await Asset.findByIdAndDelete(req.params.id);
    emitCustody({ type: 'custody', id: String(req.params.id) });
    res.json({ message: 'Custody item deleted' });
  } catch (error) {
    res.status(500).json({ message: 'Failed to delete custody item' });
  }
};

// ── Stock (المستودع) — same Asset collection, held by nobody ────────────────
// One document per physical device for its whole life: it moves between
// `in_stock` and `assigned` so its serial and history never fragment across two
// collections. HR only ever sees the `assigned`/`returned` half.

exports.listStock = async (req, res) => {
  try {
    const { type, q, condition } = req.query;
    // HR keeps its own shelf in this collection (`issuedBySection: 'hr'`) — it
    // is a different store and must not show up here. Legacy stock with no flag
    // set stays with IT, which is where it has always been.
    const filter = { status: 'in_stock', issuedBySection: { $ne: 'hr' }, ...NOT_EXCLUDED };
    if (type) filter.type = type;
    else if (req.query.bucket && BUCKET_KEYS.includes(req.query.bucket)) {
      filter.type = { $in: typesInBucket(req.query.bucket).filter((t) => !EXCLUDED_TYPES.includes(t)) };
    }
    if (condition) filter.condition = condition;
    if (q && q.trim()) {
      const r = rx(q);
      filter.$or = [{ name: r }, { serialNumber: r }, { brand: r }, { specs: r }];
    }

    const items = await Asset.find(filter)
      .populate('createdBy', 'firstName lastName')
      .sort({ createdAt: -1 })
      .limit(2000)
      .lean();

    res.json({ items });
  } catch (error) {
    res.status(500).json({ message: 'Failed to load stock items' });
  }
};

exports.createStock = async (req, res) => {
  try {
    if (!req.body.type || !String(req.body.type).trim()) {
      return res.status(400).json({ message: 'Item type is required' });
    }
    const data = pick(req.body, STOCK_EDITABLE);
    data.brand = normalizeBrand(data.brand);
    data.name = deriveAssetName(data.type, data.brand);
    if (!data.category) data.category = 'IT';
    if (data.quantity === undefined || Number(data.quantity) < 1) data.quantity = 1;
    data.status = 'in_stock';
    data.employee = null;
    data.issuedBySection = 'it';
    data.createdBy = req.user._id;

    const item = await Asset.create(data);
    await logEvent(req, item, 'added_to_store', { condition: item.condition });
    emitCustody({ type: 'stock', id: String(item._id) });
    res.status(201).json({ item });
  } catch (error) {
    res.status(500).json({ message: 'Failed to create stock item' });
  }
};

exports.updateStock = async (req, res) => {
  try {
    const item = await Asset.findById(req.params.id);
    if (!item) return res.status(404).json({ message: 'Stock item not found' });
    if (item.status !== 'in_stock') {
      return res.status(400).json({ message: 'This item is no longer in stock — edit it from the custody page instead' });
    }
    Object.assign(item, pick(req.body, STOCK_EDITABLE));
    item.brand = normalizeBrand(item.brand);
    item.name = deriveAssetName(item.type, item.brand);
    await item.save();
    emitCustody({ type: 'stock', id: String(item._id) });
    res.json({ item });
  } catch (error) {
    res.status(500).json({ message: 'Failed to update stock item' });
  }
};

exports.deleteStock = async (req, res) => {
  try {
    const item = await Asset.findById(req.params.id);
    if (!item) return res.status(404).json({ message: 'Stock item not found' });
    // Deleting an assigned item here would silently wipe an employee's custody
    // record, so this endpoint only ever touches shelf stock.
    if (item.status !== 'in_stock') {
      return res.status(400).json({ message: 'Only in-stock items can be deleted here' });
    }
    await Asset.findByIdAndDelete(req.params.id);
    emitCustody({ type: 'stock', id: String(req.params.id) });
    res.json({ message: 'Stock item deleted' });
  } catch (error) {
    res.status(500).json({ message: 'Failed to delete stock item' });
  }
};

// The handover: in_stock → assigned. Same document, so the device keeps its
// serial and its history, and it appears on the employee's HR profile at once.
exports.assignFromStock = async (req, res) => {
  try {
    if (!req.body.employee) return res.status(400).json({ message: 'Employee is required' });

    const item = await Asset.findById(req.params.id);
    if (!item) return res.status(404).json({ message: 'Stock item not found' });
    if (item.status !== 'in_stock') {
      return res.status(400).json({
        message: item.status === 'assigned'
          ? 'This item is already assigned to an employee'
          : 'This item is not in stock and cannot be assigned',
      });
    }

    const employee = await Employee.findById(req.body.employee).select('_id').lean();
    if (!employee) return res.status(404).json({ message: 'Employee not found' });

    item.employee = employee._id;
    item.status = 'assigned';
    item.assignedDate = req.body.assignedDate || today();
    item.assignedBy = req.user._id;
    // الحالة الفنية لا تُسأل عند التسليم من المستودع: الصنف يحملها بالفعل من
    // لحظة إضافته، وسؤالها ثانيةً يفتح باب حقيقتين لشيء واحد.
    if (req.body.notes) item.notes = req.body.notes;
    // The item has left the shelf — clear the leftovers from its last return.
    item.returnedDate = undefined;
    item.returnedCondition = undefined;
    item.returnedTo = undefined;

    await item.save();
    await logEvent(req, item, 'assigned', {
      toEmployee: item.employee, date: item.assignedDate, condition: item.condition, notes: req.body.notes,
    });
    emitCustody({ type: 'custody', id: String(item._id) });
    emit('hr:employee', { id: String(item.employee) });
    res.json({ item });
  } catch (error) {
    res.status(500).json({ message: 'Failed to assign stock item' });
  }
};

// Employee picker for the custody modal. /api/hr/employees is restricted to HR
// roles, so IT gets this read-only minimal projection instead.
exports.listEmployees = async (req, res) => {
  try {
    const filter = { isHrRecord: { $ne: false } };   // من غير سجلات الأرشيف
    if (req.query.q && req.query.q.trim()) {
      const r = rx(req.query.q);
      filter.$or = [{ firstName: r }, { lastName: r }, { arabicName: r }, { employeeNumber: r }, { iqamaNumber: r }];
    }
    const employees = await Employee.find(filter)
      .select(EMP_FIELDS)
      .sort({ firstName: 1 })
      .limit(2000)
      .lean();
    res.json({ employees });
  } catch (error) {
    res.status(500).json({ message: 'Failed to load employees' });
  }
};

// ── قوائم نموذج البلاغ ──────────────────────────────────────────────────────

/**
 * أقسام الشركة كما هي فعلاً في ملفات الموظفين.
 *
 * القسم كان حقلاً نصياً حرّاً في نموذج البلاغ، فكان «الموارد البشرية» و«الموارد
 * البشريه» و«HR» ثلاثة أقسام مختلفة في أي تقرير يجمّع حسب القسم. المصدر هنا هو
 * قيم Employee.department نفسها لا قائمة مكتوبة يدوياً، فلا يظهر قسم غير موجود
 * ولا يغيب قسم أُنشئ أمس.
 */
exports.listDepartments = async (req, res) => {
  try {
    const values = await Employee.distinct('department', { isHrRecord: { $ne: false } });
    const departments = values
      .map((v) => String(v || '').trim())
      .filter(Boolean)
      .sort((a, b) => a.localeCompare(b, 'ar'));
    res.json({ departments: Array.from(new Set(departments)) });
  } catch (error) {
    res.status(500).json({ message: 'Failed to load departments' });
  }
};

/**
 * من يجوز إسناد حل البلاغ إليه: مديرو النظام وموظفو تقنية المعلومات.
 *
 * الاسم كان يُكتب نصاً حرّاً، فلم يكن ممكناً معرفة كم بلاغاً على أحدهم ولا فتح
 * البلاغات المسندة إليه — الإسناد إلى مستخدم حقيقي هو ما يجعل ذلك ممكناً.
 */
exports.listAssignees = async (req, res) => {
  try {
    const users = await User.find({ role: { $in: EDIT_ROLES }, isActive: { $ne: false } })
      .select('firstName lastName role email')
      .sort({ firstName: 1 })
      .limit(500)
      .lean();
    res.json({ users });
  } catch (error) {
    res.status(500).json({ message: 'Failed to load assignees' });
  }
};

// ── Systems & services ──────────────────────────────────────────────────────

exports.listSystems = async (req, res) => {
  try {
    const { status, type, q } = req.query;
    const filter = {};
    if (status) filter.status = status;
    if (type) filter.type = type;
    if (q && q.trim()) {
      const r = rx(q);
      filter.$or = [{ name: r }, { nameAr: r }, { vendor: r }, { url: r }, { description: r }];
    }
    const systems = await ItSystem.find(filter)
      .populate('owner', 'firstName lastName')
      .sort({ name: 1 })
      .limit(2000)
      .lean();
    res.json({ systems });
  } catch (error) {
    res.status(500).json({ message: 'Failed to load systems' });
  }
};

exports.createSystem = async (req, res) => {
  try {
    if (!req.body.name || !String(req.body.name).trim()) {
      return res.status(400).json({ message: 'Name is required' });
    }
    const data = pick(req.body, SYSTEM_EDITABLE);
    data.createdBy = req.user._id;
    const system = await ItSystem.create(data);
    emit('it:updated', { type: 'system', id: String(system._id) });
    res.status(201).json({ system });
  } catch (error) {
    res.status(500).json({ message: 'Failed to create system' });
  }
};

exports.updateSystem = async (req, res) => {
  try {
    const system = await ItSystem.findById(req.params.id);
    if (!system) return res.status(404).json({ message: 'System not found' });
    Object.assign(system, pick(req.body, SYSTEM_EDITABLE));
    await system.save();
    emit('it:updated', { type: 'system', id: String(system._id) });
    res.json({ system });
  } catch (error) {
    res.status(500).json({ message: 'Failed to update system' });
  }
};

exports.deleteSystem = async (req, res) => {
  try {
    await ItSystem.findByIdAndDelete(req.params.id);
    emit('it:updated', { type: 'system', id: String(req.params.id) });
    res.json({ message: 'System deleted' });
  } catch (error) {
    res.status(500).json({ message: 'Failed to delete system' });
  }
};
