const CustomsClearance = require('../models/CustomsClearance');
const { recomputeTotals, COST_KEYS, MARGIN_KEYS } = require('../models/CustomsClearance');
const cache = require('../utils/ttlCache');
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
];

// Sub-documents. Sent as whole objects by the frontend but merged field-by-field
// here so a partial PUT can never wipe the sibling keys.
const NESTED = {
  documents: ['bl', 'commercialInvoice', 'certificateOfOrigin', 'packingList', 'saber'],
  agentPapers: ['blStamped', 'customerAuthorization', 'companyAuthorization'],
  stageDates: ['doInvoiceEmailed', 'doInvoicePaid', 'doLinkEmailed', 'dutyPaid', 'portFeesPaid', 'unloadingFeesPaid', 'containersReturned', 'returnInvoiceDate'],
  stageDone: ['doInvoiceEmailed', 'doInvoicePaid', 'doLinkEmailed', 'dutyPaid', 'portFeesPaid', 'unloadingFeesPaid', 'containersReturned', 'returnInvoiceDate'],
  costs: COST_KEYS,
  // totalInvoiced/profit مشتقّتان — لا تُقبلان من العميل مهما أرسل.
  revenue: [...MARGIN_KEYS, 'transportSelling', 'yardTransportNet'],
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
    if (q.active === 'true') filter.cancelled = { $ne: true };
    if (q.cancelled === 'true') filter.cancelled = true;
    if (q.year) filter.periodYear = Number(q.year);
    if (q.month) filter.periodMonth = Number(q.month);
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
    let list = await cache.wrap(ck, 30000, () => CustomsClearance.find(filter)
      .select('-documents -attachments -containers').sort({ createdAt: -1 }).lean());

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
        c.exporterCompany, c.countryOfOrigin, c.city, c.legacySerial, c.notes,
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
    res.status(500).json({ message: error.message || 'Failed to create clearance' });
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
    res.status(500).json({ message: error.message || 'Failed to update clearance' });
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
    const { year, from, to } = req.query;
    const filter = { cancelled: { $ne: true } };
    if (year) filter.periodYear = Number(year);

    let list = await CustomsClearance.find(filter)
      .select('blNumber customerName shippingAgent city branch containerCount periodMonth periodYear costs revenue billing')
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

    res.json({
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
      byMonth,
    });
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
    res.status(500).json({ message: error.message || 'Failed to attach file' });
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
    res.status(500).json({ message: error.message || 'Failed to update attachment' });
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
const { fold: foldName } = require('../models/CustomsParty');

/** بحثٌ لا يبالي بالمسافات ولا بفروق الرسم العربيّ — كما في بقيّة النظام. */
const partyRx = (s) => {
  const bare = String(s || '').replace(/\s+/g, '');
  if (!bare) return null;
  const cls = { ا: '[اأإآٱ]', ه: '[هة]', ي: '[يىئ]', و: '[وؤ]' };
  const parts = [...bare].map((ch) => cls[ch] || ch.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  return new RegExp(parts.join('\\s*'), 'i');
};

exports.listParties = async (req, res) => {
  try {
    const kind = req.query.kind === 'agent' ? 'agent' : 'customer';
    const filter = { kind };
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
    const field = kind === 'agent' ? 'agentParty' : 'customerParty';
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
    const kind = req.body.kind === 'agent' ? 'agent' : 'customer';
    const name = String(req.body.name || '').trim();
    if (!name) return res.status(400).json({ message: 'الاسم مطلوب' });
    const exists = await CustomsParty.findOne({ kind, nameKey: foldName(name) }).lean();
    if (exists) return res.status(409).json({ message: 'موجودٌ بالاسم نفسِه', party: exists });
    const party = await CustomsParty.create({ ...req.body, kind, name, createdBy: req.user._id });
    cache.clear('customs:');
    res.status(201).json({ party });
  } catch (e) {
    res.status(500).json({ message: e.message || 'تعذّر الحفظ' });
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
    res.status(500).json({ message: e.message || 'تعذّر الحفظ' });
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
    const field = party.kind === 'agent' ? 'agentParty' : 'customerParty';

    const deals = await CustomsClearance.find({ [field]: party._id })
      .select('-documents -attachments -containers').sort({ createdAt: -1 }).lean();

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
      byCounterparty: tally((d) => (party.kind === 'agent' ? d.customerName : d.shippingAgent)),
      deals,
    });
  } catch (e) {
    console.error('getPartyProfile error:', e);
    res.status(500).json({ message: 'تعذّر تحميل الملفّ' });
  }
};
