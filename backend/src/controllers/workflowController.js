const OperationsWorkflow = require('../models/OperationsWorkflow');
const Customer = require('../models/Customer');
const Invoice = require('../models/Invoice');
const logAudit = require('../utils/auditLogger');
const { emitToAll } = require('../websocket/socketManager');
const XLSX = require('xlsx');
const cache = require('../utils/ttlCache');

// Field-level permission groups
const FIELD_GROUPS = {
  application: [
    'reportNumber', 'reportDate', 'fromLocation', 'toLocation', 'branch',
    'carOwner', 'carNumber', 'ownerType', 'executionStatus',
    'applicationStatus', 'paymentMethod', 'username', 'taxIndicator',
    'purchaseValue', 'sellingValue',
    'loadingTime', 'driverRentalType', 'reference', 'userPhone',
    'driverName', 'driverPhone', 'carName', 'plateNumber',
    'truckType', 'truckSize', 'loadType', 'quantity',
    'goodsValue', 'representativeName', 'country',
    'ownerName', 'ownerPhone', 'region', 'product', 'invoiceRef',
    'driverCost', 'loadNumber', 'volume',
  ],
  operations: [
    'operationsReview',
  ],
  manual_moderator: [
    'paymentDate', 'payingBranch', 'finalReportDestination',
    'documentNumber', 'sendingDate', 'deliveryDate', 'accountingReview',
  ],
  collections: [
    'invoiceNumber', 'netInvoice', 'tax', 'totalInvoice',
    'invoiceDate', 'invoiceNotes', 'collectionDate',
  ],
};

// Which roles can edit which field groups
const ROLE_FIELD_ACCESS = {
  super_admin: [...FIELD_GROUPS.application, ...FIELD_GROUPS.operations, ...FIELD_GROUPS.manual_moderator, ...FIELD_GROUPS.collections],
  moderator: [...FIELD_GROUPS.application, ...FIELD_GROUPS.manual_moderator],
  operations_manager: FIELD_GROUPS.operations,
  admin: [...FIELD_GROUPS.collections, 'accountingReview'],
  employee: FIELD_GROUPS.collections,
  // Finance/collections staff edit the money columns and tick accounting review.
  finance_manager: [...FIELD_GROUPS.collections, 'accountingReview'],
  accountant: [...FIELD_GROUPS.collections, 'accountingReview'],
};

// Filter update body to only include fields the role can edit
const filterFieldsByRole = (body, role) => {
  const allowedFields = ROLE_FIELD_ACCESS[role] || [];
  const filtered = {};
  for (const key of Object.keys(body)) {
    if (allowedFields.includes(key)) {
      filtered[key] = body[key];
    }
  }
  return filtered;
};

// Lock expiry time: 5 minutes
const LOCK_EXPIRY_MS = 5 * 60 * 1000;

const isLocked = (workflow, userId) => {
  if (!workflow.lockedBy) return false;
  // Lock expired
  if (workflow.lockedAt && Date.now() - new Date(workflow.lockedAt).getTime() > LOCK_EXPIRY_MS) {
    return false;
  }
  // Locked by someone else
  return workflow.lockedBy.toString() !== userId.toString();
};

// ═══════════════════════════════════════════════════════════════════════════
//  فلاتر الأعمدة — قيمُ العمود تُحسب في القاعدة، والتصفية تجري فيها
// ═══════════════════════════════════════════════════════════════════════════

/**
 * الأعمدة المسموح بالفلترة عليها.
 *
 * قائمةٌ بيضاء مقصودة: اسم العمود يدخل مباشرةً في مفتاح `$group` وفي شرط `$in`،
 * فلو قُبل أي اسمٍ يرسله المتصفح لأمكن استخراج قيم حقولٍ لا يعرضها الجدول أصلًا
 * — ومنها حقولٌ ماليّة محجوبة عن أكثر الأدوار.
 */
const FILTERABLE_COLUMNS = new Set([
  'reportNumber', 'reportDate', 'fromLocation', 'toLocation', 'branch', 'carOwner',
  'carNumber', 'ownerType', 'executionStatus', 'applicationStatus', 'paymentMethod',
  'username', 'userPhone', 'taxIndicator', 'purchaseValue', 'sellingValue',
  'driverName', 'truckType', 'truckSize', 'representativeName', 'operationsReview',
  'paymentDate', 'payingBranch', 'documentNumber', 'sendingDate', 'deliveryDate',
  'accountingReview', 'invoiceNumber', 'netInvoice', 'tax', 'totalInvoice',
  'invoiceDate', 'collectionDate', 'stage',
]);

// القيمة تصل من المتصفح نصًّا دائمًا، والحقل في القاعدة رقمٌ أو تاريخ. المقارنة
// بين نوعين مختلفين في BSON لا تُطابق شيئًا أبدًا، فالفلترة على «قيمة الشراء» أو
// «تاريخ السداد» كانت سترجع صفرًا من الصفوف بلا رسالة خطأ — لذلك يُعاد كل نوعٍ
// إلى نوعه قبل بناء الشرط.
const NUMERIC_COLUMNS = new Set(['purchaseValue', 'sellingValue', 'netInvoice', 'tax', 'totalInvoice']);
const DATE_COLUMNS = new Set(['reportDate', 'paymentDate', 'sendingDate', 'deliveryDate', 'invoiceDate', 'collectionDate']);

/**
 * أعمدة التواريخ تُجمَّع باليوم لا باللحظة.
 *
 * المخزَّن لحظةٌ بالثانية، والمعروض في الخانة يومٌ فقط؛ فالتجميع باللحظة كان يضع
 * في القائمة ثمانيةً وعشرين سطرًا مكتوبًا عليها كلّها «١٦/١٢/٢٠٢٥» لا يفرّق بينها
 * شيء، ويرفع عدد القيم المختلفة إلى ثلاثةٍ وعشرين ألفًا في عمودٍ واحد.
 *
 * والمنطقة الزمنية مثبَّتة على توقيت الرياض لأن الشركة كلّها فيه: التجميع بالتوقيت
 * العالمي يُلقي بكشوف ما بعد التاسعة مساءً في اليوم التالي، فلا يطابق اليومَ
 * المكتوب في الخانة نفسها.
 */
const TZ = 'Asia/Riyadh';
const TZ_OFFSET = '+03:00';
const DAY_MS = 24 * 60 * 60 * 1000;
const isDayString = (v) => /^\d{4}-\d{2}-\d{2}$/.test(v);

/**
 * سقف عدد القيم المُعادة في قائمة العمود الواحد.
 *
 * أعمدة مثل «رقم الكشف» و«رقم الفاتورة» فيها قيمةٌ مختلفة لكل صف — عشرات الآلاف
 * — وإرسالها كاملةً يعيد بالضبط التجمّد الذي جاء هذا الحلّ ليزيله. تُعاد الأكثر
 * تكرارًا، ويُطلب الباقي بالبحث داخل القائمة فيُنفَّذ على الخادم.
 */
const MAX_FILTER_VALUES = 500;

const decodeColumnValue = (field, v) => {
  if (NUMERIC_COLUMNS.has(field)) { const n = Number(v); return Number.isNaN(n) ? undefined : n; }
  if (DATE_COLUMNS.has(field)) { const d = new Date(v); return isNaN(d.getTime()) ? undefined : d; }
  return v;
};

/**
 * شروط فلاتر الأعمدة القادمة من الجدول: `cf_<العمود>` مكرَّرًا لكل قيمة مختارة.
 *
 * التكرار — لا الفصل بفاصلة — لأن القيم نفسها تحمل فواصل (أسماء ملّاك، ملاحظات
 * فواتير)، ففصلها بفاصلة كان يقطع القيمة نصفين فلا تطابق صفًّا واحدًا.
 *
 * `skipField` تستعمله قائمة القيم: قيم عمودٍ تُحسب بكل الفلاتر **إلا فلتره هو**،
 * وإلا لما ظهرت في القائمة إلا القيم التي اختارها المستخدم بالفعل فتعذّر توسيع
 * الاختيار.
 */
function columnFilters(query, skipField) {
  const conds = [];
  for (const key of Object.keys(query || {})) {
    if (!key.startsWith('cf_')) continue;
    const field = key.slice(3);
    if (!FILTERABLE_COLUMNS.has(field) || field === skipField) continue;
    const raw = Array.isArray(query[key]) ? query[key] : [query[key]];
    const vals = raw.map((v) => String(v == null ? '' : v));
    if (!vals.length) continue;
    // الخانة الفارغة فئةٌ حقيقية يُسأل عنها («الكشوف التي لم تُفوتر بعد»)، وهي في
    // القاعدة ثلاث صور: حقلٌ غير موجود، وnull، ونصٌّ فارغ — والثلاثة يجب أن يردّها
    // اختيارٌ واحد، وإلا بدا للمستخدم أن صفوفًا اختفت.
    const wantsBlank = vals.some((v) => v === '');
    const rest = vals.filter((v) => v !== '');

    if (DATE_COLUMNS.has(field)) {
      // اليوم مدًى لا لحظة: `$eq` على منتصف ليل اليوم لا يطابق كشفًا سُجّل الثالثة
      // عصرًا من اليوم نفسه، فيختفي من نتيجة فلترٍ اختاره المستخدم بالاسم.
      const clauses = [];
      if (wantsBlank) clauses.push({ [field]: { $in: ['', null] } });
      for (const v of rest) {
        if (isDayString(v)) {
          const start = new Date(`${v}T00:00:00${TZ_OFFSET}`);
          if (isNaN(start.getTime())) continue;
          clauses.push({ [field]: { $gte: start, $lt: new Date(start.getTime() + DAY_MS) } });
        } else {
          const exact = new Date(v);
          if (!isNaN(exact.getTime())) clauses.push({ [field]: exact });
        }
      }
      if (clauses.length) conds.push(clauses.length === 1 ? clauses[0] : { $or: clauses });
      continue;
    }

    const list = rest.map((v) => decodeColumnValue(field, v)).filter((v) => v !== undefined);
    if (wantsBlank) list.push('', null);
    if (list.length) conds.push({ [field]: { $in: list } });
  }
  return conds;
}

/**
 * إبطال قوائم القيم المخزَّنة بعد كل كتابة.
 *
 * القائمة تُخزَّن عشرين ثانية لتوحيد الطلبات المتزامنة؛ لكن حالةً جديدة أو كشفًا
 * محذوفًا لا يجوز أن ينتظر انتهاء المدة: المستخدم سيفلتر على قيمةٍ لم تعد موجودة
 * فيرى جدولًا فارغًا ويظنّ الفلتر معطوبًا.
 */
const bustFilterCache = () => { try { cache.clear('wf:'); } catch (e) {} };

// GET /api/workflows
exports.getWorkflows = async (req, res) => {
  try {
    const { page = 1, limit = 50 } = req.query;
    // شرطُ البحث يُبنى في مكانٍ واحد يقرأه الجدول والإحصاءات والتصدير معًا، فلا
    // يعرض عدّاد الصفوف رقمًا ويعرض الجدول تحته صفوف شرطٍ آخر.
    const filter = buildWorkflowFilter(req.query);

    const skip = (parseInt(page) - 1) * parseInt(limit);
    const [workflows, total] = await Promise.all([
      OperationsWorkflow.find(filter)
        .populate('createdBy', 'firstName lastName')
        .populate('lastModifiedBy', 'firstName lastName')
        .populate('lockedBy', 'firstName lastName')
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(parseInt(limit)),
      OperationsWorkflow.countDocuments(filter),
    ]);

    res.json({ workflows, total, page: parseInt(page), pages: Math.ceil(total / parseInt(limit)) });
  } catch (error) {
    console.error('Get workflows error:', error);
    res.status(500).json({ message: 'Failed to load workflows' });
  }
};

// Build the same match filter getWorkflows uses (stage/date/search/pendingOnly)
// so stats and the table always agree. Kept as a helper for the stats endpoint.
/** بلا تاريخ سداد — تعريفٌ واحد يستعمله العدّاد والفلتر معًا. */
const PENDING_PAYMENT = { $or: [{ paymentDate: null }, { paymentDate: '' }, { paymentDate: { $exists: false } }] };

function buildWorkflowFilter(query, skipField) {
  const { stage, search, dateFrom, dateTo, pendingOnly } = query || {};
  const filter = {};
  // ── «فواتير لم تصل» = بلا تاريخ سداد، لا شيء غيره ──────────────────────────
  // كان الشرط يجمع غيابَ تاريخ السداد **ورقمِ الفاتورة** معًا، فكشفٌ سُدِّد ولم
  // تُسجَّل فاتورته يخرج من العدّ وهو ليس منتظَرًا، وكشفٌ لم يُسدَّد وله رقم فاتورة
  // يخرج كذلك. والسؤال الذي تُطرَح البطاقة لأجله واحد: «أيُّ كشفٍ لم يصل سداده؟»
  // فشرطُه واحد.
  if (pendingOnly === 'true') {
    filter.$and = [PENDING_PAYMENT];
  }
  if (stage) filter.stage = stage;
  if (dateFrom || dateTo) {
    filter.createdAt = {};
    if (dateFrom) filter.createdAt.$gte = new Date(dateFrom + 'T00:00:00.000Z');
    if (dateTo) filter.createdAt.$lte = new Date(dateTo + 'T23:59:59.999Z');
  }
  if (search) {
    filter.$or = [
      { reportNumber: { $regex: search, $options: 'i' } },
      { carOwner: { $regex: search, $options: 'i' } },
      { carNumber: { $regex: search, $options: 'i' } },
      { branch: { $regex: search, $options: 'i' } },
      { invoiceNumber: { $regex: search, $options: 'i' } },
    ];
  }
  // فلاتر الأعمدة تُطبَّق هنا لا في المتصفح: كانت الصفحة تنزّل الجدول كلّه لتفلتره
  // محليًّا، فكان الفلتر يكلّف عشرات الآلاف من الصفوف ويجمّد التبويب.
  //
  // وتُضاف داخل `$and` لا على الجذر، لأن فلتر اليوم يحتاج `$or` (مدى اليوم أو
  // خانة فارغة) وعلى الجذر `$or` واحدة يشغلها البحث فيمحو أحدهما الآخر بصمت.
  const conds = columnFilters(query, skipField);
  if (conds.length) filter.$and = [...(filter.$and || []), ...conds];
  return filter;
}

// GET /api/workflows/stats — aggregates over the WHOLE matching set (not one
// page): total rows, "invoices not arrived" count, and total purchase value.
// Powers the operations-page summary cards so they reflect all ~27k records.
exports.getWorkflowStats = async (req, res) => {
  try {
    const filter = buildWorkflowFilter(req.query);
    // نفس الشرط الذي يفلتر به الزرّ — من تعريفٍ واحد، فلا يقول العدّاد رقمًا
    // ويفتح الزرّ غيره.
    const pendingMatch = { ...filter, $and: [...(filter.$and || []), PENDING_PAYMENT] };
    const [total, pendingInvoices, agg, stages] = await Promise.all([
      OperationsWorkflow.countDocuments(filter),
      OperationsWorkflow.countDocuments(pendingMatch),
      OperationsWorkflow.aggregate([
        { $match: filter },
        { $group: { _id: null, sumPurchaseValue: { $sum: '$purchaseValue' } } },
      ]),
      // عدّاد كل مرحلة يُحسب هنا أيضًا: كان يُحسب في المتصفح من الصفوف المحمَّلة،
      // فيقول «مكتمل: ٤» وهو لا يرى إلا خمسين صفًّا من عشرات الآلاف.
      OperationsWorkflow.aggregate([
        { $match: filter },
        { $group: { _id: '$stage', count: { $sum: 1 } } },
      ]),
    ]);
    res.json({
      total,
      pendingInvoices,
      sumPurchaseValue: agg[0]?.sumPurchaseValue || 0,
      byStage: stages.reduce((acc, r) => { acc[r._id || 'draft'] = r.count; return acc; }, {}),
    });
  } catch (error) {
    console.error('Get workflow stats error:', error);
    res.status(500).json({ message: 'Failed to load workflow stats' });
  }
};

/**
 * GET /api/workflows/filters?field=<العمود> — قيمُ عمودٍ واحد مع عدد صفوف كل قيمة.
 *
 * كانت قائمة الفلتر تُبنى من الصفوف المحمَّلة في المتصفح، وهي خمسون صفًّا، فتعرض
 * ثلاث حالاتٍ من أصل تسع؛ ثم عولج ذلك بتنزيل الجدول كلّه عند أول فلتر، فصار فتح
 * القائمة ينقل عشرات الآلاف من الصفوف ويجمّد التبويب دقيقةً كاملة. العدّ في
 * القاعدة يُرجع القيم كلّها في استعلامٍ واحد وبحجمٍ لا يُذكر.
 *
 * القيم محسوبةٌ على الفلاتر النشطة (المرحلة/البحث/المدى/بقيّة الأعمدة) لأن قائمةً
 * تعرض قيمًا لا صفوف لها بعد الفلترة تدعو المستخدم إلى اختيارٍ يُرجع جدولًا فارغًا.
 */
exports.filterOptions = async (req, res) => {
  try {
    const field = String(req.query.field || '');
    if (!FILTERABLE_COLUMNS.has(field)) {
      return res.status(400).json({ message: 'Unknown filter column' });
    }
    const key = `wf:filters:${JSON.stringify(req.query || {})}`;
    const hit = cache.get(key);
    if (hit !== undefined) return res.json(hit);

    const match = buildWorkflowFilter(req.query, field);
    // البحث داخل القائمة يُنفَّذ هنا لا في المتصفح، لأن المتصفح لا يملك إلا القيم
    // التي بلغت السقف: البحث عن رقم كشفٍ ليس ضمن الخمسمئة الأكثر تكرارًا كان
    // يُرجع «لا توجد قيم» والقيمة موجودة في القاعدة.
    const q = String(req.query.q || '').trim();
    if (q && !NUMERIC_COLUMNS.has(field) && !DATE_COLUMNS.has(field)) {
      const rx = { $regex: q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), $options: 'i' };
      const prev = match[field];
      // الشرط القائم على العمود قد يكون قيمةً مفردة (اختيار المرحلة من الشريط
      // العلوي)؛ ونشرُ نصٍّ داخل كائن يفكّكه إلى حروف فيصير الشرط بلا معنى.
      match[field] = prev === undefined ? rx
        : (prev && typeof prev === 'object' && !(prev instanceof Date) ? { ...prev, ...rx } : { $eq: prev, ...rx });
    }

    const isDate = DATE_COLUMNS.has(field);
    // التواريخ تُرتَّب من الأحدث لا بالأكثر تكرارًا: مَن يفلتر بتاريخ يبحث عن أيامٍ
    // قريبة، لا عن اليوم الذي صادف أن فيه أكبر عدد كشوف.
    const sort = isDate ? { _id: -1 } : { count: -1, _id: 1 };
    const [agg] = await OperationsWorkflow.aggregate([
      { $match: match },
      {
        $group: {
          _id: isDate ? { $dateToString: { format: '%Y-%m-%d', date: `$${field}`, timezone: TZ } } : `$${field}`,
          count: { $sum: 1 },
        },
      },
      {
        $facet: {
          values: [{ $sort: sort }, { $limit: MAX_FILTER_VALUES + 1 }],
          meta: [{ $count: 'distinct' }],
        },
      },
    ]).allowDiskUse(true);

    // الحقل غير الموجود وnull ينتجان المفتاح نفسه (null)، والنصّ الفارغ ينتج ''،
    // وكلّها عند المستخدم شيءٌ واحد: «(فارغ)». دمجها هنا يمنع ظهور سطرين متطابقين
    // في القائمة لا يفرّق بينهما شيء.
    const merged = new Map();
    for (const r of (agg?.values || [])) {
      const id = r._id;
      const value = id === null || id === undefined || id === ''
        ? ''
        : (id instanceof Date ? id.toISOString() : String(id));
      merged.set(value, (merged.get(value) || 0) + r.count);
    }
    let values = [...merged.entries()].map(([value, count]) => ({ value, count }))
      .sort((a, b) => (isDate ? b.value.localeCompare(a.value) : (b.count - a.count || a.value.localeCompare(b.value, 'ar', { numeric: true }))));
    const distinct = agg?.meta?.[0]?.distinct || values.length;
    const truncated = values.length > MAX_FILTER_VALUES;
    if (truncated) values = values.slice(0, MAX_FILTER_VALUES);

    // الشكل نفسه الذي تتكلّمه فلاتر الموارد البشرية وسجلّ المركبات، حتى لا يتعلّم
    // كل قسمٍ لغةً خاصة به: { filters: [{ key, values: [{ value, count }] }] }.
    const body = { filters: [{ key: field, values, truncated, distinct }] };
    cache.set(key, body, 20000);
    res.json(body);
  } catch (error) {
    console.error('workflow filterOptions', error);
    res.status(500).json({ message: 'Failed to load column filter values' });
  }
};

// GET /api/workflows/:id
exports.getWorkflow = async (req, res) => {
  try {
    const workflow = await OperationsWorkflow.findById(req.params.id)
      .populate('createdBy', 'firstName lastName')
      .populate('lastModifiedBy', 'firstName lastName')
      .populate('lockedBy', 'firstName lastName');

    if (!workflow) {
      return res.status(404).json({ message: 'Workflow not found' });
    }

    res.json(workflow);
  } catch (error) {
    console.error('Get workflow error:', error);
    res.status(500).json({ message: 'Failed to load workflow details' });
  }
};

// POST /api/workflows
exports.createWorkflow = async (req, res) => {
  try {
    const filteredBody = filterFieldsByRole(req.body, req.user.role);
    filteredBody.createdBy = req.user._id;
    filteredBody.lastModifiedBy = req.user._id;
    filteredBody.stage = 'draft';

    const workflow = await OperationsWorkflow.create(filteredBody);

    // Create invoice and update customer outstanding if username matches a customer
    const sellingVal = Number(filteredBody.sellingValue) || 0;
    if (filteredBody.username && sellingVal > 0) {
      let customer = await Customer.findOne({
        companyName: { $regex: `^${filteredBody.username.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, $options: 'i' },
        isActive: true,
      });

      if (!customer && filteredBody.username) {
        // Auto-create customer from operations workflow
        customer = await Customer.create({
          companyName: filteredBody.username.trim(),
          creditTerm: 30,
          isActive: true,
          clientStatus: 'new_client',
          notes: 'Auto-created from operations workflow',
        });
        try { emitToAll('customer:created', { customer }); } catch (e) { console.error('WebSocket emit error:', e); }
      }

      if (customer) {
        const invoiceNumber = filteredBody.reportNumber || `WF-${workflow._id.toString().slice(-8)}`;
        const invoiceDate = filteredBody.reportDate ? new Date(filteredBody.reportDate) : new Date();
        const dueDate = new Date(invoiceDate);
        dueDate.setDate(dueDate.getDate() + (customer.creditTerm || 30));

        const existingInvoice = await Invoice.findOne({ invoiceNumber });
        if (!existingInvoice) {
          const invoice = await Invoice.create({
            invoiceNumber,
            customer: customer._id,
            amount: sellingVal,
            paidAmount: 0,
            balance: sellingVal,
            invoiceDate,
            dueDate,
            creditTerm: customer.creditTerm || 30,
            status: 'pending',
            notes: `Auto-created from operations workflow - ${filteredBody.fromLocation || ''} → ${filteredBody.toLocation || ''}`,
            createdBy: req.user._id,
          });
          try { emitToAll('invoice:created', { invoice }); } catch (e) { console.error('WebSocket emit error:', e); }
        }

        customer.currentOutstanding = (Number(customer.currentOutstanding) || 0) + sellingVal;
        await customer.save();
        try { emitToAll('customer:updated', { customer }); } catch (e) { console.error('WebSocket emit error:', e); }
      }
    }

    const populated = await OperationsWorkflow.findById(workflow._id)
      .populate('createdBy', 'firstName lastName')
      .populate('lastModifiedBy', 'firstName lastName');

    await logAudit({
      user: req.user._id,
      action: 'create_workflow',
      entity: 'OperationsWorkflow',
      entityId: workflow._id,
      changes: { after: filteredBody },
      ipAddress: req.ip,
    });

    bustFilterCache();
    try { emitToAll('workflow:created', populated); } catch (e) { console.error('WebSocket emit error:', e); }

    res.status(201).json(populated);
  } catch (error) {
    console.error('Create workflow error:', error);
    res.status(500).json({ message: 'Failed to create workflow' });
  }
};

// PUT /api/workflows/:id
exports.updateWorkflow = async (req, res) => {
  try {
    const workflow = await OperationsWorkflow.findById(req.params.id);
    if (!workflow) {
      return res.status(404).json({ message: 'Workflow not found' });
    }

    // Check lock
    if (isLocked(workflow, req.user._id)) {
      return res.status(423).json({
        message: `This record is currently being edited by ${workflow.lockedByName || 'another user'}`,
      });
    }

    const filteredBody = filterFieldsByRole(req.body, req.user.role);

    // ── تاريخ السداد لا يُسجَّل قبل استلام السند ──────────────────────────────
    // السداد إقرارٌ بوصول المال، ولا يصل قبل استلام سند التسليم. تسجيله قبله
    // يجعل التقارير المالية تَعُدُّ مبلغًا لم يُقبَض.
    //
    // الشرط هنا لا في الشاشة وحدها: الشاشة تمنع الخطأ، والخادم يمنع الاحتيال —
    // وأي مسار آخر (الموبايل، استيراد، طلب مباشر) يمرّ من هنا أيضًا.
    const settingPayment = Object.prototype.hasOwnProperty.call(filteredBody, 'paymentDate')
      && filteredBody.paymentDate && String(filteredBody.paymentDate).trim();
    if (settingPayment) {
      const statusAfter = String(
        Object.prototype.hasOwnProperty.call(filteredBody, 'applicationStatus')
          ? filteredBody.applicationStatus
          : workflow.applicationStatus || '',
      ).trim();
      if (statusAfter !== 'bond_received') {
        return res.status(400).json({
          code: 'BOND_NOT_RECEIVED',
          message: 'لا يُسجَّل تاريخ السداد إلا بعد أن تصبح حالة الطلب «استُلم السند».'
            + ' السداد إقرارٌ بوصول المال، ولا يصل قبل استلام السند.',
          applicationStatus: statusAfter || null,
        });
      }
    }

    filteredBody.lastModifiedBy = req.user._id;

    const before = workflow.toObject();
    const hadCollectionDate = !!workflow.collectionDate;
    Object.assign(workflow, filteredBody);
    await workflow.save();

    // ─── AUTO-PAYMENT: If collectionDate was just set, record payment ───
    if (!hadCollectionDate && workflow.collectionDate && workflow.username) {
      const paymentAmount = Number(workflow.totalInvoice) || Number(workflow.sellingValue) || 0;
      if (paymentAmount > 0) {
        const custName = workflow.username.trim();
        const customer = await Customer.findOne({
          companyName: { $regex: `^${custName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, $options: 'i' },
          isActive: true,
        });

        if (customer) {
          // Find the matching invoice
          const invNumber = workflow.invoiceNumber || workflow.reportNumber;
          const invoice = invNumber ? await Invoice.findOne({ invoiceNumber: invNumber, customer: customer._id }) : null;

          // Record payment
          const Payment = require('../models/Payment');
          await Payment.create({
            invoice: invoice?._id || undefined,
            customer: customer._id,
            amount: paymentAmount,
            paymentDate: new Date(workflow.collectionDate),
            paymentMethod: 'bank_transfer',
            receivedBy: req.user._id,
            reference: `OPS-${workflow.reportNumber}`,
            notes: `Auto-payment from operations collection - ${workflow.reportNumber}`,
          });

          // Update invoice if found
          if (invoice) {
            invoice.paidAmount = (invoice.paidAmount || 0) + paymentAmount;
            invoice.balance = invoice.amount - invoice.paidAmount;
            if (invoice.balance <= 0) { invoice.status = 'paid'; invoice.balance = 0; }
            else { invoice.status = 'partial'; }
            await invoice.save();
            try { emitToAll('invoice:updated', { invoice }); } catch (e) { console.error('WebSocket emit error:', e); }
          }

          // Update customer outstanding
          customer.currentOutstanding = Math.max(0, (Number(customer.currentOutstanding) || 0) - paymentAmount);
          customer.lastPaymentDate = new Date(workflow.collectionDate);
          customer.lastPaymentAmount = paymentAmount;
          await customer.save();

          try { emitToAll('payment:logged', { workflowPayment: true }); } catch (e) { console.error('WebSocket emit error:', e); }
          try { emitToAll('customer:updated', { customer }); } catch (e) { console.error('WebSocket emit error:', e); }
        }
      }
    }

    const populated = await OperationsWorkflow.findById(workflow._id)
      .populate('createdBy', 'firstName lastName')
      .populate('lastModifiedBy', 'firstName lastName')
      .populate('lockedBy', 'firstName lastName');

    await logAudit({
      user: req.user._id,
      action: 'update_workflow',
      entity: 'OperationsWorkflow',
      entityId: workflow._id,
      changes: { before, after: filteredBody },
      ipAddress: req.ip,
    });

    bustFilterCache();
    try { emitToAll('workflow:updated', populated); } catch (e) { console.error('WebSocket emit error:', e); }

    res.json(populated);
  } catch (error) {
    console.error('Update workflow error:', error);
    res.status(500).json({ message: 'Failed to update workflow' });
  }
};

// PUT /api/workflows/:id/stage
exports.updateStage = async (req, res) => {
  try {
    const { stage } = req.body;
    const validTransitions = {
      draft: ['submitted_to_ops'],
      submitted_to_ops: ['ops_completed', 'draft'],
      ops_completed: ['submitted_to_collections', 'submitted_to_ops'],
      submitted_to_collections: ['completed', 'ops_completed'],
      completed: [],
    };

    const workflow = await OperationsWorkflow.findById(req.params.id);
    if (!workflow) {
      return res.status(404).json({ message: 'Workflow not found' });
    }

    // Check lock
    if (isLocked(workflow, req.user._id)) {
      return res.status(423).json({
        message: `This record is currently being edited by ${workflow.lockedByName || 'another user'}`,
      });
    }

    const allowed = validTransitions[workflow.stage] || [];
    // Super admin can force any transition
    if (req.user.role !== 'super_admin' && !allowed.includes(stage)) {
      return res.status(400).json({
        message: `Cannot transition from "${workflow.stage}" to "${stage}"`,
      });
    }

    // Role-based stage transition authorization
    const stageRoleMap = {
      submitted_to_ops: ['moderator', 'super_admin'],
      ops_completed: ['operations_manager', 'super_admin'],
      submitted_to_collections: ['operations_manager', 'super_admin'],
      completed: ['admin', 'employee', 'super_admin'],
      draft: ['moderator', 'operations_manager', 'super_admin'], // rollback
    };

    const allowedRoles = stageRoleMap[stage] || [];
    if (!allowedRoles.includes(req.user.role)) {
      return res.status(403).json({ message: 'You do not have permission to perform this stage transition' });
    }

    const before = { stage: workflow.stage };
    workflow.stage = stage;
    workflow.lastModifiedBy = req.user._id;
    await workflow.save();

    // Release lock only after stage transition saved successfully
    workflow.lockedBy = null;
    workflow.lockedByName = '';
    workflow.lockedAt = null;
    await workflow.save();

    const populated = await OperationsWorkflow.findById(workflow._id)
      .populate('createdBy', 'firstName lastName')
      .populate('lastModifiedBy', 'firstName lastName')
      .populate('lockedBy', 'firstName lastName');

    await logAudit({
      user: req.user._id,
      action: 'workflow_stage_change',
      entity: 'OperationsWorkflow',
      entityId: workflow._id,
      changes: { before, after: { stage } },
      ipAddress: req.ip,
    });

    bustFilterCache();
    try { emitToAll('workflow:stageChanged', populated); } catch (e) { console.error('WebSocket emit error:', e); }

    res.json(populated);
  } catch (error) {
    console.error('Update stage error:', error);
    res.status(500).json({ message: 'Failed to update workflow stage' });
  }
};

// POST /api/workflows/:id/lock
exports.lockWorkflow = async (req, res) => {
  try {
    const workflow = await OperationsWorkflow.findById(req.params.id);
    if (!workflow) {
      return res.status(404).json({ message: 'Workflow not found' });
    }

    if (isLocked(workflow, req.user._id)) {
      return res.status(423).json({
        message: `This record is currently being edited by ${workflow.lockedByName || 'another user'}`,
      });
    }

    workflow.lockedBy = req.user._id;
    workflow.lockedByName = `${req.user.firstName} ${req.user.lastName}`;
    workflow.lockedAt = new Date();
    await workflow.save();

    try {
      emitToAll('workflow:locked', {
        _id: workflow._id,
        lockedBy: { _id: req.user._id, firstName: req.user.firstName, lastName: req.user.lastName },
        lockedByName: workflow.lockedByName,
        lockedAt: workflow.lockedAt,
      });
    } catch (e) { console.error('WebSocket emit error:', e); }

    res.json({ message: 'Row locked successfully' });
  } catch (error) {
    console.error('Lock workflow error:', error);
    res.status(500).json({ message: 'Failed to lock workflow' });
  }
};

// POST /api/workflows/:id/unlock
exports.unlockWorkflow = async (req, res) => {
  try {
    const workflow = await OperationsWorkflow.findById(req.params.id);
    if (!workflow) {
      return res.status(404).json({ message: 'Workflow not found' });
    }

    // Only the locker or super_admin can unlock
    if (
      workflow.lockedBy &&
      workflow.lockedBy.toString() !== req.user._id.toString() &&
      req.user.role !== 'super_admin'
    ) {
      return res.status(403).json({ message: 'Only the locking user or super admin can unlock' });
    }

    workflow.lockedBy = null;
    workflow.lockedByName = '';
    workflow.lockedAt = null;
    await workflow.save();

    try { emitToAll('workflow:unlocked', { _id: workflow._id }); } catch (e) { console.error('WebSocket emit error:', e); }

    res.json({ message: 'Row unlocked successfully' });
  } catch (error) {
    console.error('Unlock workflow error:', error);
    res.status(500).json({ message: 'Failed to unlock workflow' });
  }
};

// DELETE /api/workflows/:id
exports.deleteWorkflow = async (req, res) => {
  try {
    const workflow = await OperationsWorkflow.findById(req.params.id);
    if (!workflow) {
      return res.status(404).json({ message: 'Workflow not found' });
    }

    if (isLocked(workflow, req.user._id)) {
      return res.status(423).json({
        message: `This record is currently being edited by ${workflow.lockedByName || 'another user'}`,
      });
    }

    await OperationsWorkflow.findByIdAndDelete(req.params.id);

    await logAudit({
      user: req.user._id,
      action: 'delete_workflow',
      entity: 'OperationsWorkflow',
      entityId: req.params.id,
      changes: { before: workflow.toObject() },
      ipAddress: req.ip,
    });

    bustFilterCache();
    try { emitToAll('workflow:deleted', { _id: req.params.id }); } catch (e) { console.error('WebSocket emit error:', e); }

    res.json({ message: 'Workflow deleted successfully' });
  } catch (error) {
    console.error('Delete workflow error:', error);
    res.status(500).json({ message: 'Failed to delete workflow' });
  }
};

// POST /api/workflows/bulk-delete
exports.bulkDelete = async (req, res) => {
  try {
    const { ids } = req.body;
    if (!Array.isArray(ids) || ids.length === 0) {
      return res.status(400).json({ message: 'ids must be a non-empty array' });
    }

    // Check for locked workflows
    const workflows = await OperationsWorkflow.find({ _id: { $in: ids } });
    const lockedIds = workflows.filter((w) => isLocked(w, req.user._id)).map((w) => w._id.toString());
    if (lockedIds.length > 0) {
      return res.status(423).json({ message: `${lockedIds.length} workflow(s) are locked and cannot be deleted` });
    }

    await OperationsWorkflow.deleteMany({ _id: { $in: ids } });

    await logAudit({
      user: req.user._id,
      action: 'bulk_delete_workflows',
      entity: 'OperationsWorkflow',
      entityId: null,
      changes: { before: { count: ids.length, ids } },
      ipAddress: req.ip,
    });

    bustFilterCache();
    ids.forEach((id) => {
      try { emitToAll('workflow:deleted', { _id: id }); } catch (e) { console.error('WebSocket emit error:', e); }
    });

    res.json({ message: `${ids.length} workflow(s) deleted successfully`, deleted: ids.length });
  } catch (error) {
    console.error('Bulk delete workflows error:', error);
    res.status(500).json({ message: 'Failed to bulk delete workflows' });
  }
};

// GET /api/workflows/export
exports.exportWorkflows = async (req, res) => {
  try {
    // التصدير يقرأ الشرط نفسه الذي يقرأه الجدول — بما فيه فلاتر الأعمدة والبحث.
    // كان يتجاهلها فيُنزّل الجدول كلّه بينما الشاشة تعرض المُفلتَر، فيظنّ المستخدم
    // أن الملف نسخةٌ ممّا يراه.
    const filter = buildWorkflowFilter(req.query);

    // Use lean() + select only needed fields for speed — no populate needed
    const workflows = await OperationsWorkflow.find(filter)
      .select('-lockedBy -lockedByName -lockedAt -lastModifiedBy -__v')
      .sort({ createdAt: -1 })
      .lean();

    const formatDate = (d) => d ? new Date(d).toLocaleDateString('en-US') : '';
    const stageLabels = { draft: 'مسودة', submitted_to_ops: 'مرسل للتشغيل', ops_completed: 'تم التشغيل', submitted_to_collections: 'مرسل للتحصيل', completed: 'مكتمل' };

    // Build AOA (array of arrays) directly — much faster than JSON objects
    const headers = [
      'رقم الكشف', 'تاريخ الكشف', 'من', 'الي', 'الفرع', 'مالك السياره', 'رقم السياره',
      'نوع المالك', 'حاله التنفيذ', 'حاله الابلكيشن', 'طريقه الدفع', 'اسم المستخدم',
      'هاتف المستخدم', 'ض / غ ض', 'قيمه الشراء', 'قيمه البيع', 'وقت التحميل',
      'نوع تأجير السائق', 'رقم المرجع', 'اسم السائق', 'هاتف السائق', 'اسم السيارة',
      'رقم اللوحة', 'نوع الشاحنة', 'حجم الشاحنة', 'نوع الحمولة', 'الكمية',
      'قيمة البضائع', 'اسم المندوب', 'اسم الدولة', 'مراجعه التشغيل',
      'تاريخ السداد', 'الفرع المسدد', 'وجهه الكشف النهائي', 'رقم السند',
      'تاريخ الارسال', 'تاريخ التسليم', 'مراجعه الحسابات',
      'رقم الفاتوره', 'صافي الفاتوره', 'ضريبه', 'اجمالى الفاتوره',
      'تاريخ الفاتوره', 'ملاحظات الفاتوره', 'تاريخ التحصيل',
      'المرحلة', 'تاريخ الإنشاء',
    ];

    const rows = workflows.map((w) => [
      w.reportNumber || '', formatDate(w.reportDate), w.fromLocation || '', w.toLocation || '',
      w.branch || '', w.carOwner || '', w.carNumber || '', w.ownerType || '',
      w.executionStatus || '', w.applicationStatus || '', w.paymentMethod || '',
      w.username || '', w.userPhone || '', w.taxIndicator || '',
      w.purchaseValue || 0, w.sellingValue || 0, w.loadingTime || '',
      w.driverRentalType || '', w.reference || '', w.driverName || '', w.driverPhone || '',
      w.carName || '', w.plateNumber || '', w.truckType || '', w.truckSize || '',
      w.loadType || '', w.quantity || '', w.goodsValue || 0,
      w.representativeName || '', w.country || '', w.operationsReview || '',
      formatDate(w.paymentDate), w.payingBranch || '', w.finalReportDestination || '',
      w.documentNumber || '', formatDate(w.sendingDate), formatDate(w.deliveryDate),
      w.accountingReview || '', w.invoiceNumber || '', w.netInvoice || 0,
      w.tax || 0, w.totalInvoice || 0, formatDate(w.invoiceDate),
      w.invoiceNotes || '', formatDate(w.collectionDate),
      stageLabels[w.stage] || w.stage, new Date(w.createdAt).toLocaleDateString('en-US'),
    ]);

    const aoa = [headers, ...rows];
    const ws = XLSX.utils.aoa_to_sheet(aoa);
    ws['!cols'] = headers.map((h) => ({ wch: Math.max(h.length + 4, 14) }));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'العمليات');
    const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename=operations-${new Date().toISOString().split('T')[0]}.xlsx`);
    res.send(buf);
  } catch (error) {
    console.error('Export workflows error:', error);
    res.status(500).json({ message: 'Failed to export workflows' });
  }
};

// POST /api/workflows/bulk-import
exports.bulkImport = async (req, res) => {
  try {
    const { rows } = req.body;

    if (!Array.isArray(rows) || rows.length === 0) {
      return res.status(400).json({ message: 'rows must be a non-empty array' });
    }

    // Moderator can import application + manual_moderator fields
    const allowedImportFields = [...FIELD_GROUPS.application, ...FIELD_GROUPS.manual_moderator];

    const workflowsToCreate = rows.map((row) => {
      const workflow = {};
      allowedImportFields.forEach((field) => {
        if (row[field] !== undefined && row[field] !== null && row[field] !== '') {
          workflow[field] = row[field];
        }
      });
      workflow.stage = 'draft';
      workflow.createdBy = req.user._id;
      workflow.lastModifiedBy = req.user._id;
      return workflow;
    });

    // Use save() instead of insertMany to trigger pre-save hooks (auto reportNumber)
    // and handle duplicates gracefully.
    // ONE $in resolves every duplicate up front — the per-row findOne was a
    // round trip per row (~200 imports ≈ 20s of pure latency at 90ms RTT).
    const wanted = workflowsToCreate.map((w) => w.reportNumber).filter(Boolean);
    const dupes = new Set(
      (await OperationsWorkflow.find({ reportNumber: { $in: wanted } }).select('reportNumber').lean())
        .map((w) => w.reportNumber)
    );
    const createdWorkflows = [];
    const skipped = [];
    for (const wfData of workflowsToCreate) {
      try {
        if (wfData.reportNumber && dupes.has(wfData.reportNumber)) {
          skipped.push(wfData.reportNumber);
          continue;
        }
        const wf = new OperationsWorkflow(wfData);
        await wf.save();
        createdWorkflows.push(wf);
      } catch (err) {
        if (err.code === 11000) {
          skipped.push(wfData.reportNumber || 'unknown');
          continue;
        }
        throw err;
      }
    }

    // Create invoices and update customer outstanding based on sellingValue.
    // username (اسم المستخدم) maps to the customer companyName.
    //
    // Batched: customers and existing invoices are prefetched with two queries
    // (the per-row case-insensitive-regex findOne could not use the index and
    // collection-scanned per row); outstanding increments are accumulated and
    // written once per customer; emits are coalesced AFTER the loop — the
    // per-row broadcasts made every connected client refetch mid-import,
    // hundreds of times.
    const updatedCustomers = [];
    const rowsWithMoney = workflowsToCreate.filter((row) => {
      if (!row.username || (Number(row.sellingValue) || 0) <= 0) return false;
      return createdWorkflows.some((w) => w.reportNumber === row.reportNumber);
    });

    const names = [...new Set(rowsWithMoney.map((r) => r.username.trim()))];
    const invoiceNumbers = [...new Set(rowsWithMoney.map((r) => r.reportNumber).filter(Boolean))];
    const [existingCustomers, existingInvoices] = await Promise.all([
      names.length
        ? Customer.find({ isActive: true, companyName: { $in: names } })
          .collation({ locale: 'en', strength: 2 }) // case-insensitive equality, ONE query
        : [],
      invoiceNumbers.length
        ? Invoice.find({ invoiceNumber: { $in: invoiceNumbers } }).select('invoiceNumber').lean()
        : [],
    ]);
    const customerCache = {};
    for (const c of existingCustomers) customerCache[c.companyName.trim().toLowerCase()] = c;
    const invoiceExists = new Set(existingInvoices.map((i) => i.invoiceNumber));
    let createdCustomers = 0;
    let createdInvoices = 0;
    const outstandingAdd = new Map(); // customerId -> total added

    for (const row of rowsWithMoney) {
      const createdWf = createdWorkflows.find((w) => w.reportNumber === row.reportNumber);
      const sellingVal = Number(row.sellingValue) || 0;
      const name = row.username.trim();

      let customer = customerCache[name.toLowerCase()];
      if (!customer) {
        customer = await Customer.create({
          companyName: name,
          creditTerm: 30,
          isActive: true,
          clientStatus: 'new_client',
          notes: 'Auto-created from operations import',
        });
        customerCache[name.toLowerCase()] = customer;
        createdCustomers += 1;
      }

      // Create invoice using reportNumber as invoice number
      const invoiceNumber = row.reportNumber || `WF-${createdWf._id.toString().slice(-8)}`;
      if (!invoiceExists.has(invoiceNumber)) {
        const invoiceDate = row.reportDate ? new Date(row.reportDate) : new Date();
        const dueDate = new Date(invoiceDate);
        dueDate.setDate(dueDate.getDate() + (customer.creditTerm || 30));
        await Invoice.create({
          invoiceNumber,
          customer: customer._id,
          amount: sellingVal,
          paidAmount: 0,
          balance: sellingVal,
          invoiceDate,
          dueDate,
          creditTerm: customer.creditTerm || 30,
          status: 'pending',
          notes: `Auto-created from operations import - ${row.fromLocation || ''} → ${row.toLocation || ''}`,
          createdBy: req.user._id,
        });
        invoiceExists.add(invoiceNumber);
        createdInvoices += 1;
      }

      outstandingAdd.set(String(customer._id), (outstandingAdd.get(String(customer._id)) || 0) + sellingVal);
    }

    // One write per customer, one broadcast per entity type for the whole batch.
    if (outstandingAdd.size) {
      await Customer.bulkWrite([...outstandingAdd.entries()].map(([id, add]) => ({
        updateOne: { filter: { _id: id }, update: { $inc: { currentOutstanding: add } } },
      })), { ordered: false });
      for (const [id, add] of outstandingAdd.entries()) {
        const c = Object.values(customerCache).find((x) => String(x._id) === id);
        if (c) updatedCustomers.push({ companyName: c.companyName, added: add });
      }
    }
    if (createdCustomers) { try { emitToAll('customer:created', { bulk: true, count: createdCustomers }); } catch (e) {} }
    if (createdInvoices) { try { emitToAll('invoice:created', { bulk: true, count: createdInvoices }); } catch (e) {} }
    if (outstandingAdd.size) { try { emitToAll('customer:updated', { bulk: true, count: outstandingAdd.size }); } catch (e) {} }

    // Populate user references
    const populated = await OperationsWorkflow.find({
      _id: { $in: createdWorkflows.map((w) => w._id) },
    })
      .populate('createdBy', 'firstName lastName')
      .populate('lastModifiedBy', 'firstName lastName');

    await logAudit({
      user: req.user._id,
      action: 'bulk_import_workflows',
      entity: 'OperationsWorkflow',
      entityId: null,
      changes: { after: { count: createdWorkflows.length, customerUpdates: updatedCustomers } },
      ipAddress: req.ip,
    });

    bustFilterCache();
    try {
      emitToAll('workflow:bulkImported', {
        count: createdWorkflows.length,
        workflows: populated,
      });
    } catch (e) { console.error('WebSocket emit error:', e); }

    res.status(201).json({
      imported: createdWorkflows.length,
      skipped: skipped.length,
      skippedReports: skipped,
      workflows: populated,
      customerUpdates: updatedCustomers,
    });
  } catch (error) {
    console.error('Bulk import workflows error:', error);
    res.status(500).json({ message: 'Failed to bulk import workflows' });
  }
};

// GET /api/workflows/pending-by-customer/:customerId
exports.getPendingByCustomer = async (req, res) => {
  try {
    const customer = await Customer.findById(req.params.customerId);
    if (!customer) {
      return res.status(404).json({ message: 'Customer not found' });
    }

    const workflows = await OperationsWorkflow.find({
      username: { $regex: `^${customer.companyName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, $options: 'i' },
      $and: [
        { $or: [{ paymentDate: null }, { paymentDate: '' }, { paymentDate: { $exists: false } }] },
        { $or: [{ invoiceNumber: null }, { invoiceNumber: '' }, { invoiceNumber: { $exists: false } }] },
      ],
    })
      .select('reportNumber reportDate fromLocation toLocation branch carOwner sellingValue stage createdAt')
      .sort({ createdAt: -1 })
      .lean();

    res.json({ workflows, total: workflows.length });
  } catch (error) {
    console.error('Get pending invoices by customer error:', error);
    res.status(500).json({ message: 'Failed to load pending invoices' });
  }
};

// Return field permissions info for the frontend
exports.getFieldPermissions = async (req, res) => {
  res.json({
    groups: FIELD_GROUPS,
    roleAccess: ROLE_FIELD_ACCESS,
  });
};
