const CustomsClearance = require('../models/CustomsClearance');
const { sendMongooseError, stripEmpty } = require('../utils/mongooseError');
const { recomputeTotals, COST_KEYS, MARGIN_KEYS } = require('../models/CustomsClearance');
const cache = require('../utils/ttlCache');
const { parseMonth, parseYear } = require('../utils/period');
const logAudit = require('../utils/auditLogger');
const { emitToAll } = require('../websocket/socketManager');
const { createNotification } = require('../services/notificationService');

// Scalar fields a client may set on create/update.
const EDITABLE = [
  'branch', 'stage', 'cancelled', 'assignedTo', 'customerName', 'customer',
  'shippingAgent', 'shippingAgentEmail', 'blNumber', 'invoiceNumber', 'invoiceDate',
  'port', 'invoiceType', 'containerCount', 'totalWeight', 'invoiceValue', 'currency',
  'exporterCompany', 'countryOfOrigin', 'hsCode', 'saberNumber', 'notes',
  // master-spreadsheet additions
  'legacySerial', 'periodMonth', 'periodYear', 'city',
  'declarationNumber', 'declarationDate', 'papersReceivedDate',
  'unloadingAppointment', 'unloadingLocation', 'doNumber', 'exitPermitNumber',
  'returnDeadline', 'returnFreeDays',
  // ما أُنجز من المراحل صراحةً — لا مشتقًّا من موضع الحاليّة.
  'stagesDone',
  // ربطُ المعاملة بملفَّي العميل والوكيل.
  'customerParty', 'agentParty',
  // المعاملةُ القادمة: علمُها وتاريخُها المرتقَب.
  'upcoming', 'expectedDate',
];

// Sub-documents. Sent as whole objects by the frontend but merged field-by-field
// here so a partial PUT can never wipe the sibling keys.
const NESTED = {
  documents: ['bl', 'commercialInvoice', 'certificateOfOrigin', 'packingList', 'saber'],
  agentPapers: ['blStamped', 'customerAuthorization', 'companyAuthorization'],
  stageDates: ['doInvoiceEmailed', 'doInvoicePaid', 'doLinkEmailed', 'dutyPaid', 'portFeesPaid', 'unloadingFeesPaid', 'containersReturned', 'returnInvoiceDate'],
  stageDone: ['doInvoiceEmailed', 'doInvoicePaid', 'doLinkEmailed', 'dutyPaid', 'portFeesPaid', 'unloadingFeesPaid', 'containersReturned', 'returnInvoiceDate'],
  costs: COST_KEYS,
  // totalInvoiced/profit مشتقّتان — لا تُقبلان من العميل مهما أرسل. ومثلُهما
  // `transportNet`: صارت فرقَ سعرِ النقل عن سعر المورد (recomputeTotals)،
  // فقبولُها من الشاشة يفتح بابَ رقمٍ يخالف بنودَه.
  revenue: [...MARGIN_KEYS.filter((k) => k !== 'transportNet'), 'transportSelling', 'yardTransportNet'],
  billing: ['invoiceStatus', 'ourInvoiceNumber', 'invoicedAt'],
};

const NUMERIC_NESTED = new Set(['costs', 'revenue']);

/**
 * Build an update payload from a request body.
 * `existing` (a lean doc) is merged under the incoming sub-documents so partial
 * updates keep untouched keys. costs.total / revenue.profit are always derived,
 * never taken from the client.
 */
function pick(body, existing) {
  const out = {};
  for (const k of EDITABLE) if (body[k] !== undefined) out[k] = body[k];
  if (out.customer === '' || out.customer === null) delete out.customer;

  for (const [group, keys] of Object.entries(NESTED)) {
    const incoming = body[group];
    if (incoming === undefined || incoming === null || typeof incoming !== 'object') continue;
    const base = (existing && existing[group]) || {};
    const merged = {};
    for (const k of keys) {
      const v = incoming[k] !== undefined ? incoming[k] : base[k];
      if (v === undefined) continue;
      merged[k] = NUMERIC_NESTED.has(group) ? (Number.isFinite(Number(v)) ? Number(v) : 0) : v;
    }
    out[group] = merged;
  }

  if (Array.isArray(body.containers)) {
    out.containers = body.containers
      .filter((r) => r && typeof r === 'object')
      .map((r) => ({
        containerNumber: String(r.containerNumber || '').trim(),
        exitPermit: Number.isFinite(Number(r.exitPermit)) ? Number(r.exitPermit) : 0,
        declaration: String(r.declaration || '').trim(),
        notes: String(r.notes || '').trim(),
      }));
  }

  // Derive totals from whichever cost/revenue values will end up stored.
  const merged = {
    costs: { ...((existing && existing.costs) || {}), ...(out.costs || {}) },
    revenue: { ...((existing && existing.revenue) || {}), ...(out.revenue || {}) },
  };
  recomputeTotals(merged);
  if (out.costs || (existing && existing.costs)) out.costs = merged.costs;
  if (out.revenue || (existing && existing.revenue)) out.revenue = merged.revenue;

  return out;
}

/**
 * ── وما لا يُعرَض ولا يُصدَّر ولا يُبحَث فيه لا يُنقَل ──────────────────────
 *
 * كانت القائمةُ تستثني الثقيلَ المعروف (المرفقات والحاويات ومراحل السداد)
 * وتأخذ ما بقي كلَّه — فبلغت حمولتُها **٤٥٥ كيلوبايت** لمئتين وثمانٍ وستّين
 * معاملة. وأثقلُ ما فيها لا يُقرأ في الجدول أصلًا: `costs` و`revenue` كاملين
 * (١٢٦ كيلوبايت ولا يُقرأ منهما إلّا أربعةُ أرقام)، و`stageDates` و`agentPapers`
 * (٦٥ كيلوبايت لا تُقرأ حرفًا).
 *
 * والوصلةُ إلى العنقود هي الثمنُ كلُّه لا الحساب (راجع dashboard-performance):
 * ستُّ ثوانٍ تنتظرها الشاشةُ عند كلّ فتحةٍ بعد انقضاء الذاكرة.
 *
 * فتُذكَر الحقولُ بأسمائها: ما يعرضه الجدول، وما يخرج في إكسل، وما يُبحَث فيه
 * (البحثُ يجري على هذه القائمة نفسِها في الذاكرة — فحقلٌ يسقط من هنا يسقط من
 * البحث بلا أن يُقال).
 */
const LIST_FIELDS = [
  // الجدول
  'refNumber', 'blNumber', 'customerName', 'shippingAgent', 'port', 'stage', 'branch', 'city',
  'containerCount', 'declarationNumber', 'periodYear', 'periodMonth', 'createdAt',
  'cancelled', 'isCompleted', 'returnDeadline', 'returnFreeDays', 'billing', 'notesLog',
  'stageDone.containersReturned', 'upcoming', 'expectedDate',
  // إكسل
  'costs.total', 'revenue.clearanceFee', 'revenue.totalInvoiced', 'revenue.profit',
  // البحث (راجع الفلترةَ في الذاكرة أسفلَ الدالّة)
  'invoiceNumber', 'doNumber', 'exitPermitNumber', 'saberNumber', 'hsCode',
  'exporterCompany', 'countryOfOrigin', 'legacySerial', 'notes', 'carrierName',
  'unloadingLocation', 'assignedTo', 'customerParty', 'agentParty',
].join(' ');

exports.getClearances = async (req, res) => {
  try {
    const q = req.query || {};
    const filter = {};
    // ── الفلاتر ─────────────────────────────────────────────────────────────
    // كانت أربعةً: الفرعُ والمرحلةُ والفترةُ وحالةُ الفوترة. وما يُسأل عنه في
    // العمل أكثر: عميلٌ بعينه، وكيلٌ بعينه، ميناءٌ، عملةٌ، بلدُ منشأ، مدًى
    // زمنيّ، ومَن مسؤولٌ عنها — وكلُّها أعمدةٌ موجودةٌ في الجدول تُقرأ ولا
    // يُفلتَر بها، فيُصدَّر الكلُّ ويُفلتَر في إكسل.
    const eq = {
      branch: 'branch', stage: 'stage', invoiceStatus: 'billing.invoiceStatus',
      port: 'port', currency: 'currency', invoiceType: 'invoiceType', city: 'city',
      countryOfOrigin: 'countryOfOrigin', assignedTo: 'assignedTo',
      customerParty: 'customerParty', agentParty: 'agentParty',
    };
    for (const [k, path] of Object.entries(eq)) if (q[k]) filter[path] = q[k];
    // ── والقادمةُ لا تُخلَط بالجارية ─────────────────────────────────────
    // كلُّ ما يُقرأ في هذه الشاشة معاملاتٌ وقعت: عددُها، وربحُها، وما تأخّر
    // منها. فصفٌّ لم يصل بعدُ يُفسد كلَّ عدٍّ فيها. ولها قائمتُها: `upcoming=true`.
    filter.upcoming = q.upcoming === 'true' ? true : { $ne: true };
    if (q.active === 'true') filter.cancelled = { $ne: true };
    if (q.cancelled === 'true') filter.cancelled = true;
    // الشهرُ يُقبل رقمًا أو «YYYY-MM»، وما لا يُفهَم يُهمَل — راجع utils/period.
    const yq = parseYear(q.year); if (yq) filter.periodYear = yq;
    const mq = parseMonth(q.month);
    if (mq.month) filter.periodMonth = mq.month;
    if (mq.year && !yq) filter.periodYear = mq.year;
    // مدًى زمنيٌّ بتوقيت الشركة — راجع utils/companyDay.
    if (q.from || q.to) {
      const { startOfDay, endOfDay } = require('../utils/companyDay');
      filter.createdAt = {};
      if (q.from) filter.createdAt.$gte = startOfDay(q.from);
      filter.createdAt.$lte = q.to ? endOfDay(q.to) : new Date();
    }
    // «لم تُفوتَر بعد» سؤالٌ ماليٌّ يُطرح كلَّ أسبوع، وكان يحتاج تصديرًا ليُجاب.
    if (q.uninvoiced === 'true') {
      filter.$and = [...(filter.$and || []), {
        $or: [{ 'billing.invoiceStatus': { $ne: 'invoiced' } }, { 'billing.invoiceStatus': { $exists: false } }],
      }];
    }

    const ck = `customs:list:${JSON.stringify(Object.keys(q).sort().reduce((o, k) => (k === 'search' ? o : (o[k] = q[k], o)), {}))}`;
    // نستبعد الحقول الثقيلة من القائمة — المرفقاتُ وحدَها قد تبلغ أربعين سطرًا
    // في المعاملة الواحدة، والقائمةُ لا تعرض منها شيئًا. تُحمَّل عند فتح
    // المعاملة فقط. يقلّل النقل بشكل كبير على Atlas المُقيَّد.
    let list = await cache.wrap(ck, 30000, async () => {
      const rows = await CustomsClearance.find(filter)
        .select(LIST_FIELDS).sort({ createdAt: -1 }).lean();
      // ── آخرُ ملاحظةٍ فقط تُرسَل ──────────────────────────────────────────
      // الجدولُ يعرض الأخيرةَ لا السجلَّ كلَّه، ونقلُ عشر ملاحظاتٍ لكلّ صفٍّ
      // على وصلةٍ مقيَّدة نقلٌ لا يُعرَض. والسجلُّ يُقرأ في المعاملة.
      return rows.map((r) => {
        const log = r.notesLog || [];
        const last = log.length ? log[log.length - 1] : null;
        const { notesLog, ...rest } = r;
        return { ...rest, lastNote: last ? { text: last.text, byName: last.byName, at: last.at } : null, notesCount: log.length };
      });
    });

    // ── والبحثُ بأيّ اسمٍ أو أيّ رقم ─────────────────────────────────────────
    // كان يقرأ ستّةَ حقول. والورقةُ التي في اليد قد تحمل رقمَ البيان أو رقمَ
    // الإذن أو رقمَ سابر أو الحاوية — والمعاملةُ هي المجهول. فيُقرأ كلُّ ما
    // يُكتب في الجدول، وتُطوى فروقُ الرسم والمسافات كما في بقيّة النظام.
    const search = String(q.search || '').trim();
    if (search) {
      const rx = partyRx(search);
      const has = (v) => v != null && v !== '' && rx.test(String(v));
      list = list.filter((c) => [
        c.refNumber, c.blNumber, c.customerName, c.shippingAgent, c.invoiceNumber, c.port,
        c.declarationNumber, c.doNumber, c.exitPermitNumber, c.saberNumber, c.hsCode,
        c.exporterCompany, c.countryOfOrigin, c.city, c.legacySerial, c.notes, c.lastNote?.text, c.carrierName,
        c.billing && c.billing.ourInvoiceNumber, c.unloadingLocation, c.assignedTo,
      ].some(has));
    }

    res.json({ clearances: list });
  } catch (error) {
    console.error('getClearances error:', error);
    res.status(500).json({ message: 'Failed to load clearances' });
  }
};

/** قيمُ كلّ فلترٍ مع عددِ صفوفه — تُبنى من المجموعة لا تُكتب يدًا. */
exports.getFilterOptions = async (req, res) => {
  try {
    const hit = cache.get('customs:filters');
    if (hit !== undefined) return res.json(hit);
    const FIELDS = ['branch', 'stage', 'port', 'currency', 'invoiceType', 'city', 'countryOfOrigin', 'assignedTo'];
    const facet = {};
    FIELDS.forEach((f, i) => {
      facet[`f${i}`] = [{ $group: { _id: `$${f}`, count: { $sum: 1 } } }, { $sort: { count: -1 } }];
    });
    facet.invoiceStatus = [{ $group: { _id: '$billing.invoiceStatus', count: { $sum: 1 } } }, { $sort: { count: -1 } }];
    facet.years = [{ $group: { _id: '$periodYear', count: { $sum: 1 } } }, { $sort: { _id: -1 } }];
    const [r] = await CustomsClearance.aggregate([{ $facet: facet }]);
    const shape = (rows) => (rows || []).filter((x) => x._id != null && x._id !== '')
      .map((x) => ({ value: String(x._id), count: x.count }));
    const out = { options: {} };
    FIELDS.forEach((f, i) => { out.options[f] = shape(r[`f${i}`]); });
    out.options.invoiceStatus = shape(r.invoiceStatus);
    out.options.years = shape(r.years);
    const parties = await CustomsParty.find({ isActive: { $ne: false } }).select('kind name').sort({ name: 1 }).lean();
    out.options.customers = parties.filter((p) => p.kind === 'customer').map((p) => ({ value: String(p._id), label: p.name }));
    out.options.agents = parties.filter((p) => p.kind === 'agent').map((p) => ({ value: String(p._id), label: p.name }));
    cache.set('customs:filters', out, 5 * 60 * 1000);
    res.json(out);
  } catch (e) {
    console.error('customs getFilterOptions error:', e);
    res.status(500).json({ message: 'تعذّر تحميل الفلاتر' });
  }
};

exports.getClearance = async (req, res) => {
  try {
    const clearance = await CustomsClearance.findById(req.params.id).populate('customer', 'name');
    if (!clearance) return res.status(404).json({ message: 'Clearance not found' });
    res.json({ clearance });
  } catch (error) {
    // معرّف مش صالح = «مش موجود»، مش عطل سيرفر. رابط قديم أو مقطوع كان بيرجع
    // 500 وكأن السيستم واقع.
    if (error.name === 'CastError') return res.status(404).json({ message: 'Clearance not found' });
    res.status(500).json({ message: 'Failed to load clearance' });
  }
};

exports.createClearance = async (req, res) => {
  try {
    const data = pick(req.body, null);
    data.createdBy = req.user._id;
    await attachPartyFields(data);
    const clearance = await CustomsClearance.create(data);

    await logAudit({ user: req.user._id, action: 'create_customs_clearance', entity: 'CustomsClearance', entityId: clearance._id, changes: { after: { refNumber: clearance.refNumber } }, ipAddress: req.ip });
    try { emitToAll('customs:created', { clearance }); } catch (e) {}

    res.status(201).json({ clearance });
  } catch (error) {
    return sendMongooseError(res, error, error.message || 'Failed to create clearance');
  }
};

/**
 * حين يُختار العميلُ أو الوكيلُ من ملفّه، يُنسَخ اسمُه إلى المعاملة — والبريدُ
 * معه إن كان للوكيل بريد.
 *
 * الاسمُ يبقى مخزَّنًا نصًّا لأنّ التصديراتِ والتقاريرَ تقرؤه، والبريدُ كان
 * يُكتب في كلّ معاملةٍ من الذاكرة فيُخطئ حرفٌ فيُرسَل الطلبُ إلى لا أحد.
 */
async function attachPartyFields(data) {
  if (data.customerParty) {
    const p = await CustomsParty.findById(data.customerParty).select('name').lean();
    if (p) data.customerName = p.name;
  }
  if (data.agentParty) {
    const p = await CustomsParty.findById(data.agentParty).select('name email').lean();
    if (p) {
      data.shippingAgent = p.name;
      // لا يُمحى بريدٌ مكتوبٌ يدويًّا إن كان ملفُّ الوكيل بلا بريد.
      if (p.email) data.shippingAgentEmail = p.email;
    }
  }
}

exports.updateClearance = async (req, res) => {
  try {
    const existing = await CustomsClearance.findById(req.params.id).lean();
    if (!existing) return res.status(404).json({ message: 'Clearance not found' });
    const data = pick(req.body, existing);
    data.lastModifiedBy = req.user._id;
    await attachPartyFields(data);
    const clearance = await CustomsClearance.findByIdAndUpdate(req.params.id, data, { new: true, runValidators: true });
    if (!clearance) return res.status(404).json({ message: 'Clearance not found' });

    await logAudit({ user: req.user._id, action: 'update_customs_clearance', entity: 'CustomsClearance', entityId: clearance._id, changes: { after: { refNumber: clearance.refNumber, stage: clearance.stage } }, ipAddress: req.ip });
    try { emitToAll('customs:updated', { clearance }); } catch (e) {}

    // Stage advance → notify the transaction's creator (unless they advanced it).
    if (data.stage && existing.stage !== clearance.stage
      && clearance.createdBy && String(clearance.createdBy) !== String(req.user._id)) {
      try {
        await createNotification({
          recipient: clearance.createdBy,
          type: 'status_changed',
          title: 'تحديث معاملة تخليص',
          message: `${clearance.refNumber} — المرحلة: ${clearance.stage}`,
          relatedEntity: 'CustomsClearance',
          relatedEntityId: clearance._id,
        });
      } catch (e) {}
    }

    res.json({ clearance });
  } catch (error) {
    return sendMongooseError(res, error, error.message || 'Failed to update clearance');
  }
};

/**
 * Dashboard metrics for /system/customs/analytics — mirrors the company's
 * "UI_AI_dashboard" sheet.
 *
 * Query: ?year=2026  or  ?from=YYYY-MM&to=YYYY-MM (inclusive, on periodYear/periodMonth).
 * Cancelled transactions are excluded from every figure.
 */
exports.getAnalytics = async (req, res) => {
  try {
    const q = req.query || {};
    const { year, from, to } = q;
    // والقادمةُ خارجَ الأرقام: لم تقع بعدُ فلا إيرادَ لها ولا تكلفة.
    const filter = { cancelled: { $ne: true }, upcoming: { $ne: true } };
    if (year) filter.periodYear = Number(year);
    // ── التحليلاتُ تقبل ما تقبله القائمة ────────────────────────────────────
    // كانت تقبل السنةَ والمدى وحدَها، فمن أراد «ربحُنا مع هذا العميل في هذا
    // الميناء» صدّر وحسب بنفسه. والأسئلةُ التي تُطرح على الجدول هي التي تُطرح
    // على التحليل — فالفلاترُ واحدة.
    const eq = {
      branch: 'branch', stage: 'stage', port: 'port', currency: 'currency',
      invoiceType: 'invoiceType', city: 'city', countryOfOrigin: 'countryOfOrigin',
      customerParty: 'customerParty', agentParty: 'agentParty',
      invoiceStatus: 'billing.invoiceStatus',
    };
    for (const [k, path] of Object.entries(eq)) if (q[k]) filter[path] = q[k];
    const mq2 = parseMonth(q.month);
    if (mq2.month) filter.periodMonth = mq2.month;
    if (mq2.year && !year) filter.periodYear = mq2.year;

    // ── ولا يُنقَل من الحقل إلّا ما يُجمَع ────────────────────────────────
    // كانت تُقرأ `costs` و`revenue` و`billing` كاملةً — وهي أثقلُ ثلاثةِ حقولٍ
    // في السجلّ (مئةٌ وستّةٌ وعشرون كيلوبايت من مئتين)، والحسابُ لا يمسّ منها
    // إلّا ثلاثةَ أرقامٍ وحالةَ الفوترة. والوصلةُ إلى العنقود هي الثمنُ كلُّه
    // لا الحساب — راجع dashboard-performance.
    //
    // ── وتُحفَظ دقيقةً ────────────────────────────────────────────────────
    // اللوحةُ تُقرأ ولا تُكتب، وتُفتح مع كلّ فتحةٍ للصفحة ومع كلّ تحديثٍ حيّ.
    // وكانت تُحسب من أوّلها في كلّ مرّة: ثلاثُ ثوانٍ ينتظرها كلُّ من يفتح.
    // والكتابةُ في القسم تمسح `customs:` فلا تُقرأ أرقامٌ سبقت التعديل.
    const ak = `customs:analytics:${JSON.stringify(q)}`;
    const hit = cache.get(ak);
    if (hit !== undefined) return res.json(hit);

    // والمدى يُصفّى في القاعدة أيضًا — لا تُنقَل سنتان ليُعرَض شهر. والتصفيةُ
    // في الذاكرة بعده تبقى كما هي: هي التي تحكم، وهذه تُخفّف الحمولةَ فقط.
    if (from || to) {
      const lo0 = from ? Number(String(from).slice(0, 4)) * 100 + Number(String(from).slice(5, 7) || 1) : 0;
      const hi0 = to ? Number(String(to).slice(0, 4)) * 100 + Number(String(to).slice(5, 7) || 12) : 999999;
      const pk = { $add: [{ $multiply: [{ $ifNull: ['$periodYear', 0] }, 100] }, { $ifNull: ['$periodMonth', 0] }] };
      filter.$expr = { $and: [{ $gte: [pk, lo0] }, { $lte: [pk, hi0] }] };
    }
    let list = await CustomsClearance.find(filter)
      .select('blNumber refNumber customerName shippingAgent port stage city branch containerCount periodMonth periodYear costs.total revenue.totalInvoiced revenue.clearanceFee billing.invoiceStatus')
      .lean();

    // from/to are month keys (YYYY-MM); filter in JS so rows with no period survive
    // an unbounded request but are excluded from an explicitly bounded one.
    const key = (r) => (r.periodYear && r.periodMonth ? r.periodYear * 100 + r.periodMonth : null);
    if (from || to) {
      const lo = from ? Number(String(from).slice(0, 4)) * 100 + Number(String(from).slice(5, 7) || 1) : -Infinity;
      const hi = to ? Number(String(to).slice(0, 4)) * 100 + Number(String(to).slice(5, 7) || 12) : Infinity;
      list = list.filter((r) => { const k = key(r); return k !== null && k >= lo && k <= hi; });
    }

    const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
    const add = (bucket, r) => {
      bucket.count += 1;
      bucket.containers += num(r.containerCount);
      bucket.revenue += num(r.revenue && r.revenue.totalInvoiced);
      bucket.costs += num(r.costs && r.costs.total);
      bucket.clearanceFee += num(r.revenue && r.revenue.clearanceFee);
      if (r.branch === 'dammam') bucket.dammam += 1; else bucket.jeddah += 1;
      return bucket;
    };
    const blank = () => ({ count: 0, containers: 0, revenue: 0, costs: 0, clearanceFee: 0, jeddah: 0, dammam: 0 });
    const group = (rows, keyFn) => {
      const m = new Map();
      for (const r of rows) {
        const k = (keyFn(r) || '').toString().trim() || '—';
        if (!m.has(k)) m.set(k, { key: k, ...blank() });
        add(m.get(k), r);
      }
      return [...m.values()];
    };
    const round = (x) => Math.round(x * 100) / 100;
    const finish = (arr, totalContainers) => arr
      .map((b) => ({
        ...b,
        revenue: round(b.revenue),
        costs: round(b.costs),
        clearanceFee: round(b.clearanceFee),
        profit: round(b.revenue - b.costs),
        avgContainers: b.count ? round(b.containers / b.count) : 0,
        containerShare: totalContainers ? b.containers / totalContainers : 0,
      }))
      .sort((a, b) => b.containers - a.containers || b.count - a.count)
      .map((b, i) => ({ ...b, rank: i + 1 }));

    const totalContainers = list.reduce((a, r) => a + num(r.containerCount), 0);
    const totalRevenue = round(list.reduce((a, r) => a + num(r.revenue && r.revenue.totalInvoiced), 0));
    const totalCosts = round(list.reduce((a, r) => a + num(r.costs && r.costs.total), 0));
    const clearanceFees = round(list.reduce((a, r) => a + num(r.revenue && r.revenue.clearanceFee), 0));
    const invoiced = list.filter((r) => (r.billing && String(r.billing.invoiceStatus || '').trim()) || num(r.revenue && r.revenue.totalInvoiced) > 0).length;
    const months = new Set(list.filter((r) => key(r) !== null).map((r) => key(r)));

    const byMonth = group(list.filter((r) => key(r) !== null), (r) => `${r.periodYear}-${String(r.periodMonth).padStart(2, '0')}`)
      .map((b) => ({
        ...b,
        revenue: round(b.revenue),
        costs: round(b.costs),
        profit: round(b.revenue - b.costs),
        year: Number(b.key.slice(0, 4)),
        month: Number(b.key.slice(5, 7)),
      }))
      .sort((a, b) => (a.year - b.year) || (a.month - b.month));

    const payload = {
      totals: {
        clearances: list.length,
        containers: totalContainers,
        customers: new Set(list.map((r) => (r.customerName || '').trim()).filter(Boolean)).size,
        agents: new Set(list.map((r) => (r.shippingAgent || '').trim()).filter(Boolean)).size,
        invoiced,
        notInvoiced: list.length - invoiced,
        avgContainersPerBl: list.length ? round(totalContainers / list.length) : 0,
        totalRevenue,
        clearanceFees,
        totalCosts,
        netProfit: round(totalRevenue - totalCosts),
        margin: totalRevenue ? (totalRevenue - totalCosts) / totalRevenue : 0,
        jeddah: list.filter((r) => r.branch !== 'dammam').length,
        dammam: list.filter((r) => r.branch === 'dammam').length,
        avgInvoice: list.length ? round(totalRevenue / list.length) : 0,
        monthsCovered: months.size,
        avgPerMonth: months.size ? round(list.length / months.size) : 0,
      },
      byCustomer: finish(group(list, (r) => r.customerName), totalContainers),
      byAgent: finish(group(list, (r) => r.shippingAgent), totalContainers),
      byCity: finish(group(list, (r) => r.city || (r.branch === 'dammam' ? 'الدمام' : 'جدة')), totalContainers),
      // أبعادٌ أخرى تُسأل ولم تكن تُجمَع: أين نعمل (الميناء)، وأين تتعثّر
      // المعاملاتُ (المرحلة)، وأيُّ فرعٍ يحمل أكثر.
      byPort: finish(group(list, (r) => r.port), totalContainers),
      byStage: finish(group(list, (r) => r.stage), totalContainers),
      byBranch: finish(group(list, (r) => (r.branch === 'dammam' ? 'الدمام' : 'جدة')), totalContainers),
      byMonth,
      // أعلى المعاملات ربحًا وأدناها — الرقمُ المجمَّع لا يقول أيَّ صفقةٍ صنعته.
      topDeals: list.map((r) => ({
        refNumber: r.refNumber, blNumber: r.blNumber, customerName: r.customerName,
        shippingAgent: r.shippingAgent, port: r.port, containers: num(r.containerCount),
        revenue: round(num(r.revenue && r.revenue.totalInvoiced)),
        costs: round(num(r.costs && r.costs.total)),
        profit: round(num(r.revenue && r.revenue.totalInvoiced) - num(r.costs && r.costs.total)),
      })).sort((a, b) => b.profit - a.profit).slice(0, 20),
      losingDeals: list.map((r) => ({
        refNumber: r.refNumber, blNumber: r.blNumber, customerName: r.customerName,
        revenue: round(num(r.revenue && r.revenue.totalInvoiced)),
        costs: round(num(r.costs && r.costs.total)),
        profit: round(num(r.revenue && r.revenue.totalInvoiced) - num(r.costs && r.costs.total)),
      })).filter((d) => d.profit < 0).sort((a, b) => a.profit - b.profit).slice(0, 20),
    };
    cache.set(ak, payload, 60000);
    res.json(payload);
  } catch (error) {
    res.status(500).json({ message: error.message || 'Failed to load customs analytics' });
  }
};

exports.deleteClearance = async (req, res) => {
  try {
    const clearance = await CustomsClearance.findByIdAndDelete(req.params.id);
    if (!clearance) return res.status(404).json({ message: 'Clearance not found' });

    await logAudit({ user: req.user._id, action: 'delete_customs_clearance', entity: 'CustomsClearance', entityId: clearance._id, changes: { before: { refNumber: clearance.refNumber } }, ipAddress: req.ip });
    try { emitToAll('customs:deleted', { clearanceId: clearance._id }); } catch (e) {}

    res.json({ message: 'Clearance deleted' });
  } catch (error) {
    res.status(500).json({ message: 'Failed to delete clearance' });
  }
};

// ---------------------------------------------------------------- المرفقات
//
// ورقُ المعاملة يُرفَع مع المعاملة نفسِها، ويُوسَم بالمرحلة التي أُنتج فيها،
// فيُقرأ في موضعه من دورة الإجراءات. الرفعُ base64 في نفس الطلب — لا multer،
// كما في بقيّة النظام.

const { saveUploadFile, deleteStoredFile } = require('../utils/fileStore');
const { STAGES } = require('../models/CustomsClearance');

exports.addAttachments = async (req, res) => {
  try {
    const clearance = await CustomsClearance.findById(req.params.id);
    if (!clearance) return res.status(404).json({ message: 'Clearance not found' });

    const incoming = Array.isArray(req.body.files) ? req.body.files : [req.body];
    if (!incoming.length) return res.status(400).json({ message: 'No files' });
    if ((clearance.attachments || []).length + incoming.length > 40) {
      return res.status(400).json({ message: 'لا يُرفَق أكثر من ٤٠ ملفًّا للمعاملة' });
    }

    const added = [];
    for (const f of incoming) {
      if (!f || !f.dataUrl) continue;
      let stored;
      try { stored = saveUploadFile(f.dataUrl, 'customs', f.fileName || ''); }
      catch (e) { return res.status(400).json({ message: e.message }); }
      const stage = STAGES.includes(String(f.stage || '')) ? String(f.stage) : '';
      const doc = {
        ...stored,
        title: String(f.title || '').trim().slice(0, 200),
        stage,
        uploadedBy: req.user._id,
        uploadedByName: req.user.name || '',
        uploadedAt: new Date(),
      };
      clearance.attachments.push(doc);
      added.push(doc);
    }
    if (!added.length) return res.status(400).json({ message: 'No files' });

    clearance.lastModifiedBy = req.user._id;
    await clearance.save();

    await logAudit({ user: req.user._id, action: 'add_customs_attachment', entity: 'CustomsClearance', entityId: clearance._id, changes: { after: { refNumber: clearance.refNumber, files: added.map((a) => a.fileName) } }, ipAddress: req.ip });
    try { emitToAll('customs:updated', { clearance }); } catch (e) {}

    res.status(201).json({ clearance });
  } catch (error) {
    return sendMongooseError(res, error, error.message || 'Failed to attach file');
  }
};

exports.updateAttachment = async (req, res) => {
  try {
    const clearance = await CustomsClearance.findById(req.params.id);
    if (!clearance) return res.status(404).json({ message: 'Clearance not found' });
    const att = clearance.attachments.id(req.params.attId);
    if (!att) return res.status(404).json({ message: 'Attachment not found' });

    if (req.body.title !== undefined) att.title = String(req.body.title).trim().slice(0, 200);
    if (req.body.stage !== undefined) att.stage = STAGES.includes(String(req.body.stage)) ? String(req.body.stage) : '';
    clearance.lastModifiedBy = req.user._id;
    await clearance.save();
    try { emitToAll('customs:updated', { clearance }); } catch (e) {}
    res.json({ clearance });
  } catch (error) {
    return sendMongooseError(res, error, error.message || 'Failed to update attachment');
  }
};

exports.deleteAttachment = async (req, res) => {
  try {
    const clearance = await CustomsClearance.findById(req.params.id);
    if (!clearance) return res.status(404).json({ message: 'Clearance not found' });
    const att = clearance.attachments.id(req.params.attId);
    if (!att) return res.status(404).json({ message: 'Attachment not found' });

    const url = att.fileUrl;
    att.deleteOne();
    clearance.lastModifiedBy = req.user._id;
    await clearance.save();
    deleteStoredFile(url);

    await logAudit({ user: req.user._id, action: 'delete_customs_attachment', entity: 'CustomsClearance', entityId: clearance._id, changes: { before: { fileName: att.fileName } }, ipAddress: req.ip });
    try { emitToAll('customs:updated', { clearance }); } catch (e) {}

    res.json({ clearance });
  } catch (error) {
    res.status(500).json({ message: error.message || 'Failed to delete attachment' });
  }
};

// ═══════════════════════════════════════════════════════════════════════════
//  أطرافُ التخليص — العملاءُ ووكلاءُ الشحن
// ═══════════════════════════════════════════════════════════════════════════
const CustomsParty = require('../models/CustomsParty');
const CustomsContract = require('../models/CustomsContract');
const { fold: foldName } = require('../models/CustomsParty');

/** بحثٌ لا يبالي بالمسافات ولا بفروق الرسم العربيّ — كما في بقيّة النظام. */
const partyRx = (s) => {
  const bare = String(s || '').replace(/\s+/g, '');
  if (!bare) return null;
  const cls = { ا: '[اأإآٱ]', ه: '[هة]', ي: '[يىئ]', و: '[وؤ]' };
  const parts = [...bare].map((ch) => cls[ch] || ch.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  return new RegExp(parts.join('\\s*'), 'i');
};

// ── ثلاثةُ أدوار، وحقلٌ في المعاملة لكلٍّ ──────────────────────────────────
// العميلُ صاحبُ البضاعة، والوكيلُ يخلّصها، والناقلُ ينقلها. راجع CustomsParty.
const PARTY_KINDS = ['customer', 'agent', 'carrier'];
const partyField = (kind) => (kind === 'agent' ? 'agentParty' : kind === 'carrier' ? 'carrierParty' : 'customerParty');

exports.listParties = async (req, res) => {
  try {
    // `kind=all` — الأطرافُ كلُّها بأدوارها، لاختيار صاحب العقد من قائمةٍ واحدة.
    const all = req.query.kind === 'all';
    const kind = PARTY_KINDS.includes(req.query.kind) ? req.query.kind : 'customer';
    const filter = all ? {} : { kind };
    if (req.query.active !== 'all') filter.isActive = { $ne: false };
    const q = String(req.query.q || '').trim();
    if (q) {
      const rx = partyRx(q);
      // يُبحَث بالاسم وبكلّ رقمٍ في الملفّ — «أيّ اسمٍ أو أيّ رقم».
      filter.$or = [{ name: rx }, { email: rx }, { phone: rx }, { contactPerson: rx },
        { commercialRegister: rx }, { taxNumber: rx }, { city: rx }];
    }
    const parties = await CustomsParty.find(filter).sort({ name: 1 }).lean();

    // مع كلّ طرفٍ حجمُه: القائمةُ بلا أرقامٍ أسماءٌ لا تُقارَن.
    const ids = parties.map((p) => p._id);
    if (all) return res.json({ parties });          // القائمةُ للاختيار، بلا أرقامٍ تُحسب
    const field = partyField(kind);
    const agg = await CustomsClearance.aggregate([
      { $match: { [field]: { $in: ids }, cancelled: { $ne: true } } },
      { $group: {
        _id: `$${field}`,
        deals: { $sum: 1 },
        revenue: { $sum: { $ifNull: ['$revenue.totalInvoiced', 0] } },
        profit: { $sum: { $ifNull: ['$revenue.profit', 0] } },
        containers: { $sum: { $ifNull: ['$containerCount', 0] } },
        last: { $max: '$createdAt' },
      } },
    ]);
    const stats = new Map(agg.map((a) => [String(a._id), a]));
    res.json({
      parties: parties.map((p) => {
        const s = stats.get(String(p._id)) || {};
        return { ...p, deals: s.deals || 0, revenue: Math.round(s.revenue || 0), profit: Math.round(s.profit || 0), containers: s.containers || 0, lastDealAt: s.last || null };
      }),
    });
  } catch (e) {
    console.error('listParties error:', e);
    res.status(500).json({ message: 'تعذّر تحميل القائمة' });
  }
};

exports.createParty = async (req, res) => {
  try {
    const kind = PARTY_KINDS.includes(req.body.kind) ? req.body.kind : 'customer';
    const name = String(req.body.name || '').trim();
    if (!name) return res.status(400).json({ message: 'الاسم مطلوب' });
    const exists = await CustomsParty.findOne({ kind, nameKey: foldName(name) }).lean();
    if (exists) return res.status(409).json({ message: 'موجودٌ بالاسم نفسِه', party: exists });
    const party = await CustomsParty.create({ ...req.body, kind, name, createdBy: req.user._id });
    cache.clear('customs:');
    res.status(201).json({ party });
  } catch (e) {
    return sendMongooseError(res, e, e.message || 'تعذّر الحفظ');
  }
};

exports.updateParty = async (req, res) => {
  try {
    const { kind, _id, __v, ...body } = req.body;
    const party = await CustomsParty.findByIdAndUpdate(req.params.id, { $set: body }, { new: true });
    if (!party) return res.status(404).json({ message: 'غير موجود' });
    // الاسمُ مخزَّنٌ نصًّا في المعاملات أيضًا (تقرؤه التصديرات) — يُحدَّث معه
    // وإلّا عُرض الاسمُ القديم في الجدول والجديدُ في الملفّ.
    const field = party.kind === 'agent' ? 'shippingAgent' : 'customerName';
    const link = party.kind === 'agent' ? 'agentParty' : 'customerParty';
    await CustomsClearance.updateMany({ [link]: party._id }, { $set: { [field]: party.name } });
    cache.clear('customs:');
    res.json({ party });
  } catch (e) {
    return sendMongooseError(res, e, e.message || 'تعذّر الحفظ');
  }
};

exports.deleteParty = async (req, res) => {
  try {
    const party = await CustomsParty.findById(req.params.id);
    if (!party) return res.status(404).json({ message: 'غير موجود' });
    const link = party.kind === 'agent' ? 'agentParty' : 'customerParty';
    const used = await CustomsClearance.countDocuments({ [link]: party._id });
    // لا يُحذَف مَن له تاريخ: حذفُه يقطع معاملاتِه عن ملفّها. يُعطَّل فيختفي من
    // القوائم ويبقى تاريخُه مقروءًا.
    if (used > 0) {
      party.isActive = false;
      await party.save();
      cache.clear('customs:');
      return res.json({ deactivated: true, used, message: `له ${used} معاملة — عُطِّل ولم يُحذَف كي لا ينقطع تاريخُه.` });
    }
    await party.deleteOne();
    cache.clear('customs:');
    res.json({ deleted: true });
  } catch (e) {
    res.status(500).json({ message: e.message || 'تعذّر الحذف' });
  }
};

/** ملفُّ طرفٍ واحد: بياناتُه، وأرقامُه، وكلُّ معاملاته. */
exports.getPartyProfile = async (req, res) => {
  try {
    const party = await CustomsParty.findById(req.params.id).lean();
    if (!party) return res.status(404).json({ message: 'غير موجود' });
    const field = partyField(party.kind);

    const deals = await CustomsClearance.find({ [field]: party._id })
      .select('-documents -attachments -containers -paymentStages').sort({ createdAt: -1 }).lean();

    const live = deals.filter((d) => !d.cancelled);
    const sum = (f) => Math.round(live.reduce((t, d) => t + (Number(f(d)) || 0), 0));
    const revenue = sum((d) => d.revenue?.totalInvoiced);
    const profit = sum((d) => d.revenue?.profit);
    const cost = sum((d) => d.costs?.total);

    // بالشهر — ليُقرأ النموّ لا المجموعُ وحدَه.
    const byMonth = {};
    live.forEach((d) => {
      const k = d.periodYear && d.periodMonth
        ? `${d.periodYear}-${String(d.periodMonth).padStart(2, '0')}`
        : (d.createdAt ? new Date(d.createdAt).toISOString().slice(0, 7) : '—');
      if (!byMonth[k]) byMonth[k] = { key: k, deals: 0, revenue: 0, profit: 0, containers: 0 };
      byMonth[k].deals += 1;
      byMonth[k].revenue += Number(d.revenue?.totalInvoiced) || 0;
      byMonth[k].profit += Number(d.revenue?.profit) || 0;
      byMonth[k].containers += Number(d.containerCount) || 0;
    });

    const tally = (get) => {
      const m = new Map();
      live.forEach((d) => { const v = String(get(d) || '—'); m.set(v, (m.get(v) || 0) + 1); });
      return [...m.entries()].map(([name, n]) => ({ name, n })).sort((a, b) => b.n - a.n).slice(0, 12);
    };

    res.json({
      party,
      totals: {
        deals: live.length,
        cancelled: deals.length - live.length,
        containers: sum((d) => d.containerCount),
        weight: sum((d) => d.totalWeight),
        revenue, cost, profit,
        margin: revenue ? Math.round((profit / revenue) * 1000) / 10 : 0,
        avgProfit: live.length ? Math.round(profit / live.length) : 0,
        firstDealAt: deals.length ? deals[deals.length - 1].createdAt : null,
        lastDealAt: deals.length ? deals[0].createdAt : null,
        // ما لم يُفوتَر بعد — أوّلُ ما يُسأل عنه في ملفّ عميل.
        uninvoiced: live.filter((d) => (d.billing?.invoiceStatus || 'not_invoiced') !== 'invoiced').length,
      },
      byMonth: Object.values(byMonth).sort((a, b) => a.key.localeCompare(b.key))
        .map((b) => ({ ...b, revenue: Math.round(b.revenue), profit: Math.round(b.profit) })),
      byStage: tally((d) => d.stage),
      byPort: tally((d) => d.port),
      byCounterparty: tally((d) => (party.kind === 'customer' ? d.shippingAgent : d.customerName)),
      // عقودُنا معه — تُقرأ في ملفّه لا في شاشةٍ أخرى. راجع CustomsContract.
      contracts: await CustomsContract.find({ party: party._id }).sort({ createdAt: -1 }).lean(),
      deals,
    });
  } catch (e) {
    console.error('getPartyProfile error:', e);
    res.status(500).json({ message: 'تعذّر تحميل الملفّ' });
  }
};

// ═══════════════════════════════════════════════════════════════════════════
//  إعداداتُ القسم · المعاملاتُ القادمة · طلباتُ الصرف
// ═══════════════════════════════════════════════════════════════════════════

const CustomsSettings = require('../models/CustomsSettings');

/** إعداداتُ القسم — رقمُ أيّام التنبيه اليوم. */
exports.getSettings = async (req, res) => {
  try {
    res.json({ settings: await CustomsSettings.get() });
  } catch (e) {
    res.status(500).json({ message: 'تعذّر تحميل الإعدادات' });
  }
};

exports.updateSettings = async (req, res) => {
  try {
    const days = Number(req.body.upcomingAlertDays);
    if (!Number.isFinite(days) || days < 0 || days > 60) {
      return res.status(400).json({ message: 'عدد الأيّام بين صفر وستّين' });
    }
    const who = [req.user.firstName, req.user.lastName].filter(Boolean).join(' ') || '';
    const settings = await CustomsSettings.findOneAndUpdate(
      { key: 'customs' },
      { $set: { upcomingAlertDays: Math.round(days), updatedBy: req.user._id, updatedByName: who } },
      { new: true, upsert: true },
    ).lean();
    try { cache.clear('customs:'); } catch (_) { /* */ }
    res.json({ settings });
  } catch (e) {
    res.status(500).json({ message: 'تعذّر حفظ الإعدادات' });
  }
};

/**
 * ── شارةُ المعاملات القادمة ────────────────────────────────────────────────
 * عددُ ما اقترب موعدُه — والمدّةُ من إعدادات القسم لا من رقمٍ في الشيفرة، فمن
 * غيّرها إلى ثلاثة أيّامٍ رأى أثرَها في النداء التالي بلا نشر.
 *
 * وما فات موعدُه يبقى في العدّ: معاملةٌ حان وقتُها ولم تُحوَّل هي أحقُّ بالتنبيه
 * من معاملةٍ بعد يومين.
 */
exports.upcomingAlerts = async (req, res) => {
  try {
    const { upcomingAlertDays } = await CustomsSettings.get();
    const days = Number.isFinite(Number(upcomingAlertDays)) ? Number(upcomingAlertDays) : 2;
    // ── اليومُ بتوقيت الشركة لا بتوقيت الخادم ────────────────────────────
    // `todayKey` تردّ «YYYY-MM-DD» بالرياض، وهو نفسُ شكلِ `expectedDate`
    // المخزَّن — فالمقارنةُ نصّيّةٌ مباشرةٌ بلا تحويلِ مناطق. راجع
    // utils/companyDay (و`startOfDay` تأخذ مفتاحَ يومٍ لا كائنَ تاريخ).
    const { todayKey, DAY_MS, startOfDay } = require('../utils/companyDay');
    const today = todayKey();
    const until = new Date(startOfDay(today).getTime() + days * DAY_MS)
      .toISOString().slice(0, 10);

    const rows = await CustomsClearance.find({
      upcoming: true,
      cancelled: { $ne: true },
      expectedDate: { $gt: '', $lte: until },
    }).select('refNumber blNumber customerName shippingAgent port expectedDate containerCount branch')
      .sort({ expectedDate: 1 }).lean();

    res.json({
      days,
      count: rows.length,
      today,
      // وما فات موعدُه أحقُّ بالتنبيه ممّا لم يحِن — فيُعلَّم.
      items: rows.map((r) => ({ ...r, overdue: r.expectedDate < today })),
    });
  } catch (e) {
    console.error('customs upcomingAlerts:', e);
    res.status(500).json({ message: 'تعذّر قراءة المعاملات القادمة' });
  }
};

/**
 * تحويلُ معاملةٍ قادمةٍ إلى جارية — هي هي، غيّر أنّها وقعت.
 *
 * ولا تُنشأ من جديد: كلُّ ما كُتب فيها (العميلُ والوكيلُ والميناءُ والحاويات)
 * كُتب مرّةً — وإعادةُ كتابته بابُ خطأٍ ونسخةٌ ثانية.
 */
exports.activateClearance = async (req, res) => {
  try {
    const clearance = await CustomsClearance.findById(req.params.id);
    if (!clearance) return res.status(404).json({ message: 'Clearance not found' });
    if (!clearance.upcoming) return res.json({ clearance });
    const who = [req.user.firstName, req.user.lastName].filter(Boolean).join(' ') || '';
    clearance.upcoming = false;
    clearance.activatedAt = new Date();
    clearance.activatedBy = req.user._id;
    clearance.activatedByName = who;
    await clearance.save();
    try { cache.clear('customs:'); } catch (_) { /* */ }
    try { emitToAll('customs:updated', { clearance }); } catch (_) { /* */ }
    await logAudit({
      user: req.user._id, action: 'update_customs_clearance', entity: 'CustomsClearance',
      entityId: clearance._id, changes: { after: { upcoming: false } }, ipAddress: req.ip,
    });
    res.json({ clearance });
  } catch (e) {
    res.status(500).json({ message: 'تعذّر تحويل المعاملة' });
  }
};

/**
 * ── طلباتُ الصرف كما تراها الإدارةُ الماليّة ───────────────────────────────
 * مدخلاتُ مراحل السداد في كلّ المعاملات، مسطَّحةً في قائمةٍ واحدة: كلُّ سطرٍ
 * يقول أيَّ معاملةٍ وأيَّ مرحلةٍ وكم ومرفقَه — فيُقرأ العملُ كلُّه في شاشةٍ
 * واحدةٍ بدل فتح المعاملات واحدةً واحدة.
 */
/**
 * ── والعدُّ والتصفيةُ في القاعدة لا هنا ──────────────────────────────────────
 * كانت تُحمَّل المعاملاتُ كلُّها بمراحلها كلّها (١٤٠٠ إدخالٍ، ميجابايت) في كلّ
 * فتحٍ وكلّ نقرةِ تبويبٍ وبعد كلّ قرار — سبعُ ثوانٍ تنتظرها الشاشة، ولا يُعرَض
 * منها إلّا عشرات. فصار التجميعُ في القاعدة: العدّاداتُ في مرور، والصفحةُ
 * المعروضةُ وحدَها في مرور، ولا يعبر الشبكةَ إلّا ما يُقرأ.
 *
 * ── والسجلُّ المنقول ليس دفعًا ─────────────────────────────────────────────
 * الاستيرادُ حوّل كلَّ «تم» في الماستر إلى إدخالٍ «مدفوع» بلا مبلغ (سجلّ سابق)
 * — ليُرى تاريخُ المعاملة في شاشتها. لكنّه ليس قرارًا من الماليّة، وعدُّه مع
 * المدفوع يجعل «مدفوعة: ١٤٠٣» رقمًا لا يعني شيئًا. فيُعدّ وحدَه ولا يُعرَض إلّا
 * إن طُلب.
 */
const LEGACY_DECIDER = 'سجلّ سابق';

exports.listPaymentRequests = async (req, res) => {
  try {
    const status = ['pending', 'paid', 'returned', 'rejected', 'all'].includes(String(req.query.status))
      ? String(req.query.status) : 'pending';
    const legacy = String(req.query.legacy || '') === '1';
    const q = String(req.query.search || '').trim().slice(0, 80);
    const page = Math.max(1, Number(req.query.page) || 1);
    const limit = Math.min(200, Math.max(1, Number(req.query.limit) || 50));
    const key = `customs:payreq:${status}:${legacy ? 1 : 0}:${q}:${page}:${limit}`;

    const body = await cache.wrap(key, 30000, async () => {
      const rx = q ? new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i') : null;
      const rowMatch = {
        ...(status !== 'all' ? { st: status } : {}),
        ...(legacy ? {} : { legacy: false }),
        ...(rx ? { $or: [
          { refNumber: rx }, { blNumber: rx }, { customerName: rx },
          { 'paymentStages.label': rx }, { 'paymentStages.addedByName': rx },
        ] } : {}),
      };
      const [agg] = await CustomsClearance.aggregate([
        { $match: { cancelled: { $ne: true }, 'paymentStages.0': { $exists: true } } },
        { $project: { refNumber: 1, blNumber: 1, customerName: 1, shippingAgent: 1, port: 1, branch: 1, paymentStages: 1 } },
        { $unwind: '$paymentStages' },
        { $addFields: {
          st: { $ifNull: ['$paymentStages.payStatus', 'pending'] },
          legacy: { $eq: ['$paymentStages.decidedByName', LEGACY_DECIDER] },
        } },
        { $facet: {
          counts: [
            { $group: {
              _id: { st: '$st', legacy: '$legacy' },
              n: { $sum: 1 },
              amount: { $sum: { $ifNull: ['$paymentStages.amount', 0] } },
            } },
          ],
          total: [{ $match: rowMatch }, { $count: 'n' }],
          page: [
            { $match: rowMatch },
            { $sort: { 'paymentStages.addedAt': -1, _id: -1 } },
            { $skip: (page - 1) * limit },
            { $limit: limit },
          ],
        } },
      ]);

      const counts = { pending: 0, paid: 0, returned: 0, rejected: 0, legacy: 0, amountPending: 0, amountPaid: 0 };
      for (const c of agg?.counts || []) {
        if (c._id.legacy) { counts.legacy += c.n; continue; }
        if (counts[c._id.st] !== undefined) counts[c._id.st] += c.n;
        if (c._id.st === 'pending') counts.amountPending += c.amount;
        if (c._id.st === 'paid') counts.amountPaid += c.amount;
      }
      counts.amountPending = Math.round(counts.amountPending * 100) / 100;
      counts.amountPaid = Math.round(counts.amountPaid * 100) / 100;

      const total = agg?.total?.[0]?.n || 0;
      const requests = (agg?.page || []).map((c) => {
        const e = c.paymentStages;
        return {
          clearanceId: String(c._id),
          refNumber: c.refNumber,
          blNumber: c.blNumber,
          customerName: c.customerName,
          shippingAgent: c.shippingAgent,
          port: c.port,
          branch: c.branch,
          entryId: String(e._id),
          key: e.key,
          label: e.label,
          date: e.date,
          amount: e.amount,
          note: e.note,
          fileUrl: e.fileUrl,
          fileName: e.fileName,
          addedByName: e.addedByName,
          addedAt: e.addedAt,
          payStatus: c.st,
          legacy: c.legacy,
          decisionNote: e.decisionNote || '',
          decidedByName: e.decidedByName || '',
          decidedAt: e.decidedAt || null,
          proofFiles: e.proofFiles || [],
        };
      });
      return { requests, counts, total, page, pages: Math.max(1, Math.ceil(total / limit)) };
    });
    res.json(body);
  } catch (e) {
    console.error('customs listPaymentRequests:', e);
    res.status(500).json({ message: 'تعذّر تحميل طلبات الصرف' });
  }
};

/**
 * قرارُ الإدارة الماليّة على طلبِ صرف.
 *
 * ثلاثةُ أجوبةٍ لا واحد: دُفع (ومعه إثباتٌ اختياريّ)، أو يُعاد لتصحيحٍ (ومعه
 * سببُه)، أو يُرفَض. والسببُ اختياريٌّ في الحالتين لأنّه قد يُقال مشافهةً —
 * لكنّه يُحفَظ حيث يُقرأ: بجانب الإدخال نفسِه في شاشة التخليص، لا في بريد.
 */
exports.decidePaymentStage = async (req, res) => {
  try {
    const decision = String(req.body.decision || '').trim();
    if (!['paid', 'returned', 'rejected'].includes(decision)) {
      return res.status(400).json({ message: 'قرارٌ غير معروف' });
    }
    const clearance = await CustomsClearance.findById(req.params.id);
    if (!clearance) return res.status(404).json({ message: 'Clearance not found' });
    const entry = (clearance.paymentStages || []).id(req.params.entryId);
    if (!entry) return res.status(404).json({ message: 'الإدخال غير موجود' });

    const who = [req.user.firstName, req.user.lastName].filter(Boolean).join(' ') || '';
    const files = Array.isArray(req.body.files) ? req.body.files.slice(0, 10) : [];
    const stored = [];
    for (const f of files) {
      if (!f || !f.dataUrl) continue;
      try { stored.push(saveUploadFile(f.dataUrl, 'customs', f.fileName || '')); }
      catch (e) { return res.status(400).json({ message: e.message }); }
    }

    entry.payStatus = decision;
    entry.decisionNote = String(req.body.note || '').trim().slice(0, 500);
    entry.decidedBy = req.user._id;
    entry.decidedByName = who;
    entry.decidedAt = new Date();
    if (stored.length) entry.proofFiles = [...(entry.proofFiles || []), ...stored];

    // وإثباتُ الدفع يُوجَد مع ورق المعاملة كذلك — حيث يبحث عنه من لا يعرف
    // من أيّ مرحلةٍ جاء (نفسُ قاعدة مرفق الإدخال).
    for (const f of stored) {
      clearance.attachments.push({
        ...f, title: `إثبات دفع · ${entry.label || entry.key}`, stage: '',
        uploadedBy: req.user._id, uploadedByName: who, uploadedAt: new Date(),
      });
    }

    await clearance.save();
    try { cache.clear('customs:'); cache.clear('finance:'); } catch (_) { /* */ }
    try { emitToAll('customs:updated', { clearance }); } catch (_) { /* */ }

    // ── والجوابُ قبل الذيول ────────────────────────────────────────────────
    // الإشعارُ والتدقيقُ نداءان إلى القاعدة (٩٠ مللي ثانيةٍ لكلٍّ منهما من
    // الخادم) لا ينتظرهما المحاسبُ في شيء. فيُردّ عليه بما قرّر، ويكتملان بعد.
    res.json({ ok: true, clearanceId: String(clearance._id), entryId: String(entry._id), payStatus: decision });

    // ومن طلب الصرف يُخبَر بما صار إليه طلبُه — لا يفتح الشاشة ليعرف.
    try {
      const { createNotification } = require('../services/notificationService');
      const label = { paid: 'تمّ الدفع', returned: 'أُعيد للتصحيح', rejected: 'رُفض' }[decision];
      if (entry.addedBy && String(entry.addedBy) !== String(req.user._id)) {
        await createNotification({
          recipient: entry.addedBy,
          type: 'status_changed',
          title: `طلب صرف: ${label}`,
          message: `${clearance.refNumber || ''} · ${entry.label || entry.key}${entry.decisionNote ? ` — ${entry.decisionNote}` : ''}`,
          relatedEntity: 'CustomsClearance',
          relatedEntityId: clearance._id,
        });
      }
    } catch (_) { /* */ }

    await logAudit({
      user: req.user._id, action: 'update_customs_clearance', entity: 'CustomsClearance',
      entityId: clearance._id, changes: { after: { paymentDecision: decision, entry: String(entry._id) } }, ipAddress: req.ip,
    }).catch(() => { /* */ });
  } catch (e) {
    console.error('customs decidePaymentStage:', e);
    if (res.headersSent) return;
    res.status(500).json({ message: 'تعذّر تسجيل القرار' });
  }
};

// ═══════════════════════════════════════════════════════════════════════════
//  مراحلُ السداد — إدخالٌ بتاريخه ومرفقه، يتكرّر
// ═══════════════════════════════════════════════════════════════════════════
/**
 * المرحلةُ التي لا تُقفَل المعاملةُ بدونها. مفتاحُها يُقرأ في الشيفرة، واسمُها
 * يُعدَّل من إعدادات القسم — راجع `customs_payment_stage` في lookupTypes.
 */
const REQUIRED_STAGE_KEY = 'transportInvoice';

/** المراحلُ المسموحة كما هي في إعدادات القسم الآن. */
const allowedStages = async () => {
  const Lookup = require('../models/Lookup');
  const rows = await Lookup.find({ type: 'customs_payment_stage', deleted: { $ne: true } })
    .sort({ order: 1 }).lean();
  return rows;
};

/**
 * إضافةُ إدخالِ مرحلة — تاريخٌ ومرفقٌ وربّما مبلغ.
 *
 * والمرفقُ يُكتب في مكانين: في الإدخال ليُقرأ في موضعه من المرحلة، وفي
 * `attachments` ليُوجَد مع بقيّة ورق المعاملة حيث يبحث عنه من لا يعرف من أيّ
 * مرحلةٍ جاء. وهو ملفٌّ واحدٌ على القرص، مذكورٌ مرّتين — لا نسختان.
 */
exports.addPaymentStage = async (req, res) => {
  try {
    const clearance = await CustomsClearance.findById(req.params.id);
    if (!clearance) return res.status(404).json({ message: 'Clearance not found' });

    const stages = await allowedStages();
    const key = String(req.body.key || '').trim();
    const def = stages.find((s) => s.key === key);
    if (!def) return res.status(400).json({ message: 'مرحلة غير معروفة — أضِفها من إعدادات القسم' });
    if ((clearance.paymentStages || []).length >= 60) {
      return res.status(400).json({ message: 'بلغت المعاملةُ حدَّ إدخالات المراحل' });
    }

    const date = String(req.body.date || '').trim();
    if (date && !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return res.status(400).json({ message: 'التاريخ غير صالح' });
    }

    let stored = null;
    if (req.body.dataUrl) {
      try { stored = saveUploadFile(req.body.dataUrl, 'customs', req.body.fileName || ''); }
      catch (e) { return res.status(400).json({ message: e.message }); }
    }
    if (!date && !stored) {
      return res.status(400).json({ message: 'اختر تاريخًا أو ارفع ملفًّا — الإدخال الفارغ لا يُسجَّل' });
    }

    const who = [req.user.firstName, req.user.lastName].filter(Boolean).join(' ') || req.user.name || '';
    const entry = {
      key,
      label: def.nameAr || def.nameEn || key,
      date,
      amount: req.body.amount != null && req.body.amount !== '' ? Number(req.body.amount) : null,
      note: String(req.body.note || '').trim().slice(0, 500),
      ...(stored || {}),
      addedBy: req.user._id,
      addedByName: who,
      addedAt: new Date(),
    };
    clearance.paymentStages.push(entry);

    if (stored) {
      clearance.attachments.push({
        ...stored,
        title: entry.label,
        stage: '',   // مرحلةُ السداد ليست من `STAGES` (دورةُ الإجراءات) فتبقى عامّة
        uploadedBy: req.user._id,
        uploadedByName: who,
        uploadedAt: new Date(),
      });
    }

    clearance.lastModifiedBy = req.user._id;
    await clearance.save();
    await logAudit({
      user: req.user._id, action: 'add_customs_payment_stage', entity: 'CustomsClearance',
      entityId: clearance._id,
      changes: { after: { refNumber: clearance.refNumber, stage: entry.label, date, file: entry.fileName || '' } },
      ipAddress: req.ip,
    });
    try { emitToAll('customs:updated', { clearance }); } catch (e) {}
    cache.clear('customs:');
    res.status(201).json({ clearance });
  } catch (error) {
    return sendMongooseError(res, error, 'تعذّر إضافة المرحلة');
  }
};

/** تعديلُ إدخالٍ قائم — تاريخُه أو مبلغُه أو ملاحظتُه. */
exports.updatePaymentStage = async (req, res) => {
  try {
    const clearance = await CustomsClearance.findById(req.params.id);
    if (!clearance) return res.status(404).json({ message: 'Clearance not found' });
    const entry = clearance.paymentStages.id(req.params.entryId);
    if (!entry) return res.status(404).json({ message: 'الإدخال غير موجود' });

    if (req.body.date !== undefined) {
      const d = String(req.body.date || '').trim();
      if (d && !/^\d{4}-\d{2}-\d{2}$/.test(d)) return res.status(400).json({ message: 'التاريخ غير صالح' });
      entry.date = d;
    }
    if (req.body.amount !== undefined) {
      entry.amount = req.body.amount === '' || req.body.amount == null ? null : Number(req.body.amount);
    }
    if (req.body.note !== undefined) entry.note = String(req.body.note).trim().slice(0, 500);

    // ملفٌّ جديدٌ يحلُّ محلَّ القديم، والقديمُ يُمحى من القرص لا يبقى يتيمًا.
    if (req.body.dataUrl) {
      let stored;
      try { stored = saveUploadFile(req.body.dataUrl, 'customs', req.body.fileName || ''); }
      catch (e) { return res.status(400).json({ message: e.message }); }
      const old = entry.fileUrl;
      Object.assign(entry, stored);
      clearance.attachments.push({
        ...stored,
        title: entry.label,
        stage: '',
        uploadedBy: req.user._id,
        uploadedByName: [req.user.firstName, req.user.lastName].filter(Boolean).join(' '),
        uploadedAt: new Date(),
      });
      if (old) {
        // لا يُمحى من القرص إن كان مذكورًا في مرفقاتٍ أخرى — الذكرُ مرّتان
        // لملفٍّ واحد، ومحوُه يُفرِغ السطرَ الآخر أيضًا.
        const stillUsed = clearance.attachments.some((a) => a.fileUrl === old)
          || clearance.paymentStages.some((p) => String(p._id) !== String(entry._id) && p.fileUrl === old);
        if (!stillUsed) { try { deleteStoredFile(old); } catch (e) { /* */ } }
      }
    }

    clearance.lastModifiedBy = req.user._id;
    await clearance.save();
    try { emitToAll('customs:updated', { clearance }); } catch (e) {}
    cache.clear('customs:');
    res.json({ clearance });
  } catch (error) {
    return sendMongooseError(res, error, 'تعذّر تعديل المرحلة');
  }
};

/** حذفُ إدخال. ورقتُه تبقى في مرفقات المعاملة — الورقةُ وقعت ولا تُنكَر. */
exports.deletePaymentStage = async (req, res) => {
  try {
    const clearance = await CustomsClearance.findById(req.params.id);
    if (!clearance) return res.status(404).json({ message: 'Clearance not found' });
    const entry = clearance.paymentStages.id(req.params.entryId);
    if (!entry) return res.status(404).json({ message: 'الإدخال غير موجود' });
    const label = entry.label;
    entry.deleteOne();
    clearance.lastModifiedBy = req.user._id;
    await clearance.save();
    await logAudit({
      user: req.user._id, action: 'delete_customs_payment_stage', entity: 'CustomsClearance',
      entityId: clearance._id, changes: { before: { stage: label } }, ipAddress: req.ip,
    });
    try { emitToAll('customs:updated', { clearance }); } catch (e) {}
    cache.clear('customs:');
    res.json({ clearance });
  } catch (error) {
    return sendMongooseError(res, error, 'تعذّر حذف المرحلة');
  }
};

/**
 * إقفالُ المعاملة — ومعه الشرطُ الذي طُلب صراحةً.
 *
 * لا تُقفَل قبل أن تكون «فاتورة النقل» لها **تاريخٌ ومرفق** معًا. والإقفالُ
 * يُخرج المعاملةَ من قوائم المتابعة، فإقفالُها بلا فاتورةِ نقلٍ يُخرجها وفيها
 * مالٌ لم يُطالَب به — ولا يُكتشَف ذلك إلّا عند الجرد.
 *
 * والسببُ يُقال صريحًا: «ارفع فاتورة النقل واختر تاريخها» لا «غير مسموح».
 */
exports.completeClearance = async (req, res) => {
  try {
    const clearance = await CustomsClearance.findById(req.params.id);
    if (!clearance) return res.status(404).json({ message: 'Clearance not found' });

    const reopen = req.body.completed === false;
    if (reopen) {
      clearance.isCompleted = false;
      clearance.completedAt = null;
      clearance.completedBy = null;
      clearance.completedByName = '';
    } else {
      const stages = await allowedStages();
      const def = stages.find((s) => s.key === REQUIRED_STAGE_KEY);
      const name = def?.nameAr || 'فاتورة النقل';
      const ok = (clearance.paymentStages || []).some(
        (p) => p.key === REQUIRED_STAGE_KEY && String(p.date || '').trim() && String(p.fileUrl || '').trim(),
      );
      if (!ok) {
        return res.status(400).json({
          message: `لا تُقفَل المعاملة قبل «${name}»: أضِفها بتاريخٍ ومرفقٍ معًا ثمّ أعِد المحاولة.`,
          missingStage: REQUIRED_STAGE_KEY,
        });
      }
      clearance.isCompleted = true;
      clearance.completedAt = new Date();
      clearance.completedBy = req.user._id;
      clearance.completedByName = [req.user.firstName, req.user.lastName].filter(Boolean).join(' ') || req.user.name || '';
    }

    clearance.lastModifiedBy = req.user._id;
    await clearance.save();
    await logAudit({
      user: req.user._id, action: reopen ? 'reopen_customs_clearance' : 'complete_customs_clearance',
      entity: 'CustomsClearance', entityId: clearance._id,
      changes: { after: { refNumber: clearance.refNumber } }, ipAddress: req.ip,
    });
    try { emitToAll('customs:updated', { clearance }); } catch (e) {}
    cache.clear('customs:');
    res.json({ clearance });
  } catch (error) {
    return sendMongooseError(res, error, 'تعذّر إقفال المعاملة');
  }
};

module.exports.REQUIRED_STAGE_KEY = REQUIRED_STAGE_KEY;


// ═══════════════════════════════════════════════════════════════════════════
//  الملاحظات — سطرٌ يُضاف، وآخرُه يُقرأ في الجدول
// ═══════════════════════════════════════════════════════════════════════════
const touchCustoms = (id) => {
  try { cache.clear('customs:'); } catch (_) { /* */ }
  try { emitToAll('customs:updated', { id: String(id || '') }); } catch (_) { /* */ }
};

exports.addNote = async (req, res) => {
  try {
    const text = String(req.body.text || '').trim().slice(0, 2000);
    if (!text) return res.status(400).json({ message: 'اكتب الملاحظة' });
    const clearance = await CustomsClearance.findById(req.params.id);
    if (!clearance) return res.status(404).json({ message: 'المعاملة غير موجودة' });
    const note = {
      text,
      by: req.user._id,
      byName: `${req.user.firstName || ''} ${req.user.lastName || ''}`.trim() || req.user.name || '',
      at: new Date(),
    };
    clearance.notesLog.push(note);
    clearance.lastModifiedBy = req.user._id;
    await clearance.save();
    await logAudit({ user: req.user._id, action: 'customs_note', entity: 'CustomsClearance', entityId: clearance._id, changes: { after: { note: text } }, ipAddress: req.ip });
    touchCustoms(clearance._id);
    res.status(201).json({ note, notesLog: clearance.notesLog });
  } catch (e) { sendMongooseError(res, e, 'تعذّرت إضافة الملاحظة'); }
};

exports.deleteNote = async (req, res) => {
  try {
    const clearance = await CustomsClearance.findById(req.params.id);
    if (!clearance) return res.status(404).json({ message: 'المعاملة غير موجودة' });
    const note = clearance.notesLog.id(req.params.noteId);
    if (!note) return res.status(404).json({ message: 'الملاحظة غير موجودة' });
    // ملاحظةُ غيرِك لا تُحذف إلّا للمدير: هي أثرٌ لصاحبها.
    const boss = ['super_admin', 'admin', 'customs_manager'].includes(req.user.role);
    if (!boss && String(note.by || '') !== String(req.user._id)) {
      return res.status(403).json({ message: 'لا تُحذف ملاحظةُ غيرك' });
    }
    note.deleteOne();
    await clearance.save();
    touchCustoms(clearance._id);
    res.json({ notesLog: clearance.notesLog });
  } catch (e) { sendMongooseError(res, e, 'تعذّر حذف الملاحظة'); }
};

// ═══════════════════════════════════════════════════════════════════════════
//  العقود — عقدُنا مع عميلٍ أو وكيلٍ أو ناقل
// ═══════════════════════════════════════════════════════════════════════════
const CONTRACT_FIELDS = ['title', 'contractNumber', 'startDate', 'endDate', 'value', 'valueBasis',
  'paymentTermDays', 'autoRenew', 'status', 'scope', 'notes'];

/** العقدُ المنتهي يُقرأ منتهيًا وإن كُتب «ساري»: التاريخُ أصدقُ من الخانة. */
const withState = (c) => {
  const end = c.endDate ? new Date(c.endDate) : null;
  const expired = !!end && end.getTime() < Date.now();
  const daysLeft = end ? Math.ceil((end.getTime() - Date.now()) / 86400000) : null;
  return { ...c, expired, daysLeft, state: c.status === 'terminated' ? 'terminated' : expired ? 'expired' : c.status };
};

exports.listContracts = async (req, res) => {
  try {
    const filter = {};
    if (PARTY_KINDS.includes(req.query.kind)) filter.partyKind = req.query.kind;
    if (req.query.party) filter.party = req.query.party;
    if (req.query.status) filter.status = req.query.status;
    const q = String(req.query.q || '').trim();
    if (q) {
      const rx = partyRx(q);
      filter.$or = [{ title: rx }, { contractNumber: rx }, { partyName: rx }, { scope: rx }];
    }
    const rows = await CustomsContract.find(filter).sort({ createdAt: -1 }).lean();
    res.json({ contracts: rows.map(withState) });
  } catch (e) {
    console.error('listContracts error:', e);
    res.status(500).json({ message: 'تعذّر تحميل العقود' });
  }
};

exports.createContract = async (req, res) => {
  try {
    const party = await CustomsParty.findById(req.body.party).lean();
    if (!party) return res.status(400).json({ message: 'اختر الطرف' });
    if (!String(req.body.title || '').trim()) return res.status(400).json({ message: 'اسم العقد مطلوب' });
    const body = stripEmpty(req.body, CustomsContract.schema);
    const doc = await CustomsContract.create({
      ...Object.fromEntries(CONTRACT_FIELDS.map((f) => [f, body[f]]).filter(([, v]) => v !== undefined)),
      party: party._id,
      partyKind: party.kind,
      partyName: party.name,
      createdBy: req.user._id,
      createdByName: `${req.user.firstName || ''} ${req.user.lastName || ''}`.trim(),
    });
    await logAudit({ user: req.user._id, action: 'create_customs_contract', entity: 'CustomsContract', entityId: doc._id, changes: { after: { title: doc.title, party: party.name } }, ipAddress: req.ip });
    try { emitToAll('customs:contract', { id: String(doc._id) }); } catch (_) { /* */ }
    res.status(201).json({ contract: withState(doc.toObject()) });
  } catch (e) { sendMongooseError(res, e, 'تعذّر حفظ العقد'); }
};

exports.updateContract = async (req, res) => {
  try {
    const doc = await CustomsContract.findById(req.params.id);
    if (!doc) return res.status(404).json({ message: 'العقد غير موجود' });
    if (req.body.party && String(req.body.party) !== String(doc.party)) {
      const party = await CustomsParty.findById(req.body.party).lean();
      if (!party) return res.status(400).json({ message: 'الطرف غير موجود' });
      doc.party = party._id; doc.partyKind = party.kind; doc.partyName = party.name;
    }
    for (const f of CONTRACT_FIELDS) if (req.body[f] !== undefined) doc[f] = req.body[f] === '' ? (doc.schema.path(f)?.instance === 'Number' ? null : '') : req.body[f];
    doc.lastModifiedBy = req.user._id;
    await doc.save();
    try { emitToAll('customs:contract', { id: String(doc._id) }); } catch (_) { /* */ }
    res.json({ contract: withState(doc.toObject()) });
  } catch (e) { sendMongooseError(res, e, 'تعذّر حفظ العقد'); }
};

exports.deleteContract = async (req, res) => {
  try {
    const doc = await CustomsContract.findById(req.params.id);
    if (!doc) return res.status(404).json({ message: 'العقد غير موجود' });
    // الورقُ يُحذف مع صفّه، وإلّا بقي ملفٌّ لا يشير إليه شيء.
    for (const a of doc.attachments || []) { try { deleteStoredFile(a.fileUrl); } catch (_) { /* */ } }
    await doc.deleteOne();
    await logAudit({ user: req.user._id, action: 'delete_customs_contract', entity: 'CustomsContract', entityId: doc._id, changes: { before: { title: doc.title, party: doc.partyName } }, ipAddress: req.ip });
    try { emitToAll('customs:contract', { id: String(doc._id) }); } catch (_) { /* */ }
    res.json({ ok: true });
  } catch (e) { sendMongooseError(res, e, 'تعذّر حذف العقد'); }
};

exports.addContractFiles = async (req, res) => {
  try {
    const doc = await CustomsContract.findById(req.params.id);
    if (!doc) return res.status(404).json({ message: 'العقد غير موجود' });
    const incoming = Array.isArray(req.body.files) ? req.body.files : [req.body];
    const added = [];
    for (const f of incoming) {
      if (!f || !f.dataUrl) continue;
      let stored;
      try { stored = saveUploadFile(f.dataUrl, 'customs', f.fileName || ''); }
      catch (e) { return res.status(400).json({ message: e.message }); }
      const att = {
        ...stored,
        title: String(f.title || '').trim().slice(0, 200),
        uploadedBy: req.user._id,
        uploadedByName: `${req.user.firstName || ''} ${req.user.lastName || ''}`.trim(),
        uploadedAt: new Date(),
      };
      doc.attachments.push(att);
      added.push(att);
    }
    if (!added.length) return res.status(400).json({ message: 'لا ملفات' });
    await doc.save();
    try { emitToAll('customs:contract', { id: String(doc._id) }); } catch (_) { /* */ }
    res.status(201).json({ contract: withState(doc.toObject()) });
  } catch (e) { sendMongooseError(res, e, 'تعذّر رفع الملف'); }
};

exports.deleteContractFile = async (req, res) => {
  try {
    const doc = await CustomsContract.findById(req.params.id);
    if (!doc) return res.status(404).json({ message: 'العقد غير موجود' });
    const att = doc.attachments.id(req.params.attId);
    if (!att) return res.status(404).json({ message: 'الملف غير موجود' });
    try { deleteStoredFile(att.fileUrl); } catch (_) { /* */ }
    att.deleteOne();
    await doc.save();
    try { emitToAll('customs:contract', { id: String(doc._id) }); } catch (_) { /* */ }
    res.json({ contract: withState(doc.toObject()) });
  } catch (e) { sendMongooseError(res, e, 'تعذّر حذف الملف'); }
};
