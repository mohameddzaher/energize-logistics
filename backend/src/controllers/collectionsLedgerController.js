/**
 * دفترُ التحصيل — الأعمارُ والفواتيرُ والتنبيهاتُ والخطّةُ وتقييمُ الفريق.
 *
 * ── لماذا مِلَفٌّ ثانٍ بجانب `collectionsDeptController` ─────────────────────
 * الأوّلُ يقرأ كشوفَ التشغيل: ما فُوتِر عندنا وما سُدِّد. وهذا يقرأ دفترَ
 * التحصيل نفسَه — تسعةُ آلافٍ من الفواتير ترجع إلى ٢٠٢٢، أكثرُها لا كشفَ له
 * عندنا. وهما سؤالان مختلفان لا يُخلَطان في ملفّ.
 *
 * ── والأعمارُ تُحسب من تاريخ الفوترة، والاستحقاقُ من تاريخ التسليم ─────────
 * سؤالان لا واحد:
 *
 *   «كم عمرُ هذا الدين؟»    يُقاس من يوم الفوترة — وهو ما يفعله دفترُهم،
 *                            قِيس عليه فطابقت شرائحُه (١٢٠+ و٦٠+ وسنة+
 *                            في حدود واحدٍ في المئة).
 *
 *   «متى يستحقّ؟»           يُقاس من يوم **تسليم** الفاتورة للعميل: مهلةُ
 *                            الثلاثين يومًا لا تبدأ قبل أن تصله الورقة.
 *
 * وخلطُهما يجعل عميلًا مهلتُه ثلاثون يومًا يبدو متأخّرًا وهو لم يستلم بعد.
 */
const CollectionsParty = require('../models/CollectionsParty');
const CollectionInvoice = require('../models/CollectionInvoice');
const CollectionTask = require('../models/CollectionTask');
const CreditAlertAck = require('../models/CreditAlertAck');
const PartyLinkSuggestion = require('../models/PartyLinkSuggestion');
const cache = require('../utils/ttlCache');

const CACHE_PREFIX = 'colledger:';
const DAY = 86400000;

/**
 * ── ولماذا تُخزَّن الإجاباتُ لدقيقة ────────────────────────────────────────
 * هذه شاشاتٌ تُقرأ ولا تُكتب: الأعمارُ والتنبيهاتُ والتقييمُ تُفتح كلَّ صباحٍ
 * من عدّة أجهزةٍ في الدقيقة الواحدة، ودفترُها لا يتغيّر إلّا باستيرادٍ أو
 * بتعديلٍ نادر. فحسابُها من جديدٍ لكلّ فتحةٍ عملٌ مكرَّرٌ بلا جوابٍ جديد.
 *
 * والمهلةُ قصيرةٌ عن قصد، والكتابةُ تُبطلها فورًا — فلا يرى أحدٌ رقمًا قديمًا
 * بعد أن يغيّره بيده. و«الطلعةُ الواحدة» تجعل عشرةً يفتحون معًا يكلّفون
 * حسابًا واحدًا لا عشرة.
 */
const TTL = 60000;
const keyOf = (name, req) => {
  const q = req.query || {};
  const parts = Object.keys(q).sort().map((k) => `${k}=${[].concat(q[k]).join(',')}`);
  // الدورُ جزءٌ من المفتاح: ما يُحجب عن قسم التحصيل لا يجوز أن يصله من ذاكرةٍ
  // ملأها مديرٌ يرى أكثرَ منه.
  return `${CACHE_PREFIX}${name}:${req.user?.role || ''}:${parts.join('&')}`;
};

/** شرائحُ العمر كما هي في دفترهم — حدودُها شاملةٌ من الأسفل (`>=`). */
const BANDS = [
  { key: '15-', label: '15-', min: 0 },
  { key: '30-', label: '30-', min: 15 },
  { key: '45-', label: '45-', min: 30 },
  { key: '60-', label: '60-', min: 45 },
  { key: '60+', label: '60+', min: 60 },
  { key: '90+', label: '90+', min: 90 },
  { key: '120+', label: '120+', min: 120 },
  { key: '1Y+', label: '1 Year +', min: 365 },
  // ── وشريحةٌ لما لا تاريخَ له ────────────────────────────────────────────
  // ثلاثُ فواتيرَ مفتوحةٍ بلا تاريخِ فوترةٍ ولا تسليم، فيها إشعارُ خصمٍ
  // بثلاثين ألفًا. لا عمرَ لها يُحسب، فكانت تدخل الإجماليَّ ولا تدخل شريحةً —
  // فتزيد الشرائحُ على الإجمالي بثلاثين ألفًا ولا يُعرف من أين.
  //
  // ومالٌ لا يظهر في أيّ شريحةٍ مالٌ لا يراه أحد. فله شريحتُه: تُجمَع الشرائحُ
  // فتساوي الإجماليَّ تمامًا، ويُرى ما ينقصه تاريخُه فيُكمَل.
  { key: 'noDate', label: 'بلا تاريخ', min: null },
];
const AGE_BANDS = BANDS.filter((b) => b.min !== null);
const bandOf = (days) => {
  if (days == null || Number.isNaN(days)) return 'noDate';
  for (let i = AGE_BANDS.length - 1; i >= 0; i -= 1) if (days >= AGE_BANDS[i].min) return AGE_BANDS[i].key;
  return AGE_BANDS[0].key;
};

const startOfToday = () => { const d = new Date(); return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())); };
const daysBetween = (from, to) => (from ? Math.floor((to - new Date(from)) / DAY) : null);

// «محصَّلة» هي الحالةُ الوحيدة التي تُخرج الفاتورة من الدين.
const OPEN = { status: { $ne: 'Collected' } };

/**
 * قسمُ التحصيل لا يرى ما علينا — يرى ما لنا.
 * (القاعدةُ نفسُها في `collectionsDeptController`، ومكرَّرةٌ هنا عن قصدٍ لأنّ
 *  الاعتمادَ المتبادل بين المِلَفّين يجعل تغييرَ أحدِهما يكسر الآخر.)
 */
const RECEIVABLES_ONLY = ['collections_manager', 'collections_staff'];
const receivablesOnly = (user) => RECEIVABLES_ONLY.includes(user?.role);

// ── فلاترُ السجلّ ───────────────────────────────────────────────────────────
// تُبنى في موضعٍ واحدٍ يقرؤه الجدولُ والإحصاءُ والتصدير، فلا يعرض أحدُها عددًا
// ويعرض الآخرُ صفوفَ شرطٍ غيرِه.
function partyFilter(q = {}) {
  const f = { kind: 'customer', code: { $gt: '' } };
  const { officer, grade, department, hoLocation, kind, creditDays, status, search, region } = q;
  const list = (v) => (Array.isArray(v) ? v : [v]).filter(Boolean);
  if (officer) f.collectionOfficer = { $in: list(officer) };
  if (grade) f.grade = { $in: list(grade) };
  if (department) f.department = { $in: list(department) };
  if (hoLocation) f.hoLocation = { $in: list(hoLocation) };
  if (region) f.region = { $in: list(region) };
  if (status) f.status = { $in: list(status) };
  if (kind) f.paymentType = { $in: list(kind) };
  if (creditDays) f.creditDays = { $in: list(creditDays).map(Number).filter(Number.isFinite) };
  if (search) {
    const rx = { $regex: String(search).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), $options: 'i' };
    f.$or = [{ name: rx }, { code: rx }, { collectionOfficer: rx }, { aliases: rx }];
  }
  return f;
}

/**
 * أعمارُ الديون لكلّ حساب — محسوبةٌ من الفواتير لا مخزَّنةً.
 *
 * لقطةُ الورقة رقمٌ يُكتب مرّةً في الشهر ويشيخ؛ والفواتيرُ هي التفصيل. قِيست
 * الاثنتان: ٢٣٧ حسابًا من ٢٥٤ تتطابقان إلى الهللة، والباقي فرقٌ بين لقطةٍ
 * ودفتر — يُعرَض ليُرى، لا يُخفى.
 */
/**
 * ── والمستحقُّ النقديُّ ليس في دفتر الفواتير ──────────────────────────────────
 *
 * `agingByParty` تقرأ `CollectionInvoice` وحدَها، وهي الفواتيرُ الضريبيّة. أمّا
 * الحسابُ النقديُّ فلا فاتورةَ له أصلًا — يُحصَّل بالكشف. فكان مئةٌ وسبعةٌ
 * وعشرون حسابًا نقديًّا تظهر في سجلّ الأعمار **بصفر**، وورقةُ «Aging Shipment»
 * تقول إنّ خمسةً وعشرين منها عليها ثلاثُمئةٍ وستّةٌ وثمانون ألفًا ومئتان.
 * أي أنّ الشاشةَ كانت تقول «لا شيءَ على العميل» عن عميلٍ عليه سبعةٌ وسبعون ألفًا.
 *
 * والمستحقُّ النقديُّ يُحسب من الكشوف نفسِها لا يُنسَخ رقمًا من ورقة: كشفٌ نقديٌّ
 * لم يُحصَّل هو دَينٌ قائم. وقد قِيس ذلك بالورقة حسابًا حسابًا فتطابقا — مكتب
 * الشيخ ٢١٥٠٠ في الاثنين، والزهراني ٩٠٠٠، والراجحي ٩٣٥٠ — فالرقمُ المحسوبُ حيٌّ
 * ويصحّ، ولا يجمُد يومَ صُدِّرت الورقة.
 *
 * والربطُ بالاسم المطويّ: أربعةٌ وسبعون ألفَ... بل ألفان وأربعةٌ وسبعون كشفًا من
 * ألفين وأربعةٍ وثمانين تجد حسابَها (١٠٠٪)، والعشرةُ الباقية بلا اسم عميلٍ أصلًا.
 */
async function cashAgingByParty(parties) {
  const OperationsWorkflow = require('../models/OperationsWorkflow');
  const { fold } = CollectionsParty;
  const byKey = new Map();
  for (const p of parties) {
    const k = p.nameKey || fold(p.name || '');
    if (k) byKey.set(k, String(p._id));
  }
  // الكشوفُ النقديّةُ غيرُ المحصَّلة قليلة (مئاتٌ لا آلاف)، فتُقرأ وتُجمَّع هنا:
  // الطيُّ العربيُّ لا يُكتب في القاعدة، فالمطابقةُ في العقدة أصدقُ من `$in`
  // على أسماءٍ خامّةٍ تختلف بهمزةٍ أو مسافة.
  const rows = await OperationsWorkflow.find({
    paymentType: 'cash',
    collectionDate: null,
    cashCollectionStatus: { $ne: 'collected' },
    username: { $nin: [null, ''] },
  }).select('username sellingValue reportDate paymentDate').lean();

  const today = startOfToday();
  const out = new Map();
  for (const w of rows) {
    const id = byKey.get(fold(w.username || ''));
    if (!id) continue;
    const base = w.reportDate || w.paymentDate || null;
    const days = base ? Math.floor((today - new Date(base)) / 86400000) : null;
    const band = days === null ? 'noDate'
      : days >= 365 ? '1Y+' : days >= 120 ? '120+' : days >= 90 ? '90+'
        : days >= 60 ? '60+' : days >= 45 ? '60-' : days >= 30 ? '45-'
          : days >= 15 ? '30-' : '15-';
    if (!out.has(id)) {
      out.set(id, {
        outstanding: 0, count: 0,
        bands: Object.fromEntries(BANDS.map((b) => [b.key, 0])),
        counts: Object.fromEntries(BANDS.map((b) => [b.key, 0])),
      });
    }
    const e = out.get(id);
    const v = Number(w.sellingValue) || 0;
    e.outstanding += v; e.count += 1;
    e.bands[band] += v; e.counts[band] += 1;
  }
  return out;
}

async function agingByParty(partyIds) {
  const today = startOfToday();
  // ── والحسابُ في القاعدة لا في العقدة ────────────────────────────────────
  // كانت تُقرأ الفواتيرُ المفتوحةُ كلُّها ثمّ تُجمَع بالجافاسكربت. قِيس ذلك
  // على الإنتاج: سجلُّ الأعمار ٢٫٧ ثانية، والتنبيهاتُ ٤٫٩، والتقييمُ **١٥٫٤** —
  // وصفحةُ الفريق كانت تبدو معطَّلةً لأنّ المتصفّح ينتظر خمسَ عشرةَ ثانية.
  //
  // والعملُ نفسُه في القاعدة يمرّ على الفهرس ولا ينقل صفًّا واحدًا إلى الشبكة
  // إلّا المجاميع. والشريحةُ تُحسب بـ`$switch` على فرق التاريخ، فهي حسابٌ
  // واحدٌ لا تسعةُ مقارناتٍ لكلّ صفّ.
  const rows = await CollectionInvoice.aggregate([
    { $match: { ...OPEN, party: { $in: partyIds } } },
    { $addFields: {
      _base: { $ifNull: ['$invoiceDate', '$deliveryDate'] },
    } },
    { $addFields: {
      _days: { $cond: [{ $eq: ['$_base', null] }, null, { $dateDiff: { startDate: '$_base', endDate: today, unit: 'day' } }] },
    } },
    { $addFields: {
      _band: { $switch: { branches: [
        { case: { $eq: ['$_days', null] }, then: 'noDate' },
        { case: { $gte: ['$_days', 365] }, then: '1Y+' },
        { case: { $gte: ['$_days', 120] }, then: '120+' },
        { case: { $gte: ['$_days', 90] }, then: '90+' },
        { case: { $gte: ['$_days', 60] }, then: '60+' },
        { case: { $gte: ['$_days', 45] }, then: '60-' },
        { case: { $gte: ['$_days', 30] }, then: '45-' },
        { case: { $gte: ['$_days', 15] }, then: '30-' },
      ], default: '15-' } },
    } },
    { $group: { _id: { p: '$party', b: '$_band' }, sum: { $sum: '$total' }, n: { $sum: 1 } } },
  ]);

  const out = new Map();
  const blank = () => ({
    outstanding: 0, count: 0,
    bands: Object.fromEntries(BANDS.map((b) => [b.key, 0])),
    counts: Object.fromEntries(BANDS.map((b) => [b.key, 0])),
  });
  for (const r of rows) {
    const k = String(r._id.p);
    if (!out.has(k)) out.set(k, blank());
    const e = out.get(k);
    e.outstanding += r.sum; e.count += r.n;
    e.bands[r._id.b] += r.sum; e.counts[r._id.b] += r.n;
  }
  return out;
}

// GET /api/collections-dept/ledger/aging
exports.aging = async (req, res) => {
  try {
    const { page = 1, limit = 50, band, sort = 'outstanding' } = req.query;
    const cacheKey = keyOf('aging', req);
    const cached = cache.get(cacheKey);
    if (cached) return res.json(cached);
    const filter = partyFilter(req.query);
    const parties = await CollectionsParty.find(filter)
      .select('code name paymentType collectionOfficer hoLocation grade salesManagers department region creditLimit creditDays status')
      .lean();

    // الضريبيُّ من دفتر الفواتير، والنقديُّ من الكشوف — راجع cashAgingByParty.
    const [ageMap, cashMap] = await Promise.all([
      agingByParty(parties.map((p) => p._id)),
      cashAgingByParty(parties),
    ]);
    let rows = parties.map((p) => {
      const blank = { outstanding: 0, count: 0, bands: Object.fromEntries(BANDS.map((b) => [b.key, 0])), counts: Object.fromEntries(BANDS.map((b) => [b.key, 0])) };
      const tax = ageMap.get(String(p._id)) || blank;
      const cash = cashMap.get(String(p._id)) || blank;
      // حسابٌ قد يكون له الوجهان (كودُه في الورقتين)، فيُجمَعان لا يُختار أحدُهما.
      const a = {
        outstanding: tax.outstanding + cash.outstanding,
        count: tax.count + cash.count,
        bands: Object.fromEntries(BANDS.map((b) => [b.key, (tax.bands[b.key] || 0) + (cash.bands[b.key] || 0)])),
        counts: Object.fromEntries(BANDS.map((b) => [b.key, (tax.counts[b.key] || 0) + (cash.counts[b.key] || 0)])),
        taxOutstanding: tax.outstanding,
        cashOutstanding: cash.outstanding,
      };
      const pct = p.creditLimit > 0 ? (a.outstanding / p.creditLimit) * 100 : null;
      return { ...p, outstanding: a.outstanding, taxOutstanding: a.taxOutstanding, cashOutstanding: a.cashOutstanding, invoiceCount: a.count, bands: a.bands, bandCounts: a.counts, limitUsedPct: pct };
    });
    // شريحةٌ بعينها: تُطبَّق بعد الجمع لا قبله، وإلّا لم تجمع الشرائحُ الإجماليَّ.
    if (band && BANDS.some((b) => b.key === band)) rows = rows.filter((r) => r.bands[band] !== 0);

    const totals = { outstanding: 0, invoices: 0, creditLimit: 0, bands: Object.fromEntries(BANDS.map((b) => [b.key, 0])) };
    for (const r of rows) {
      totals.outstanding += r.outstanding; totals.invoices += r.invoiceCount; totals.creditLimit += r.creditLimit || 0;
      for (const b of BANDS) totals.bands[b.key] += r.bands[b.key];
    }

    const dir = String(req.query.dir || 'desc') === 'asc' ? 1 : -1;
    const key = ['outstanding', 'creditLimit', 'creditDays', 'name', 'code', 'limitUsedPct'].includes(sort) ? sort : 'outstanding';
    rows.sort((a, b) => {
      const x = a[key]; const y = b[key];
      if (typeof x === 'string' || typeof y === 'string') return dir * String(x || '').localeCompare(String(y || ''));
      return dir * ((x || 0) - (y || 0));
    });

    const p = Math.max(1, parseInt(page, 10)); const l = Math.min(500, Math.max(1, parseInt(limit, 10)));
    const out = { rows: rows.slice((p - 1) * l, p * l), total: rows.length, page: p, pages: Math.ceil(rows.length / l), totals, bands: BANDS };
    cache.set(cacheKey, out, TTL);
    res.json(out);
  } catch (e) {
    console.error('aging error:', e);
    res.status(500).json({ message: 'تعذّر حسابُ أعمار الديون' });
  }
};

// GET /api/collections-dept/ledger/aging/filters
exports.agingFilters = async (req, res) => {
  try {
    const key = `${CACHE_PREFIX}agingfilters`;
    const hit = cache.get(key);
    if (hit) return res.json(hit);
    const base = { kind: 'customer', code: { $gt: '' } };
    const [officers, grades, departments, locations, creditDays, statuses, regions] = await Promise.all([
      CollectionsParty.distinct('collectionOfficer', base),
      CollectionsParty.distinct('grade', base),
      CollectionsParty.distinct('department', base),
      CollectionsParty.distinct('hoLocation', base),
      CollectionsParty.distinct('creditDays', base),
      CollectionsParty.distinct('status', base),
      CollectionsParty.distinct('region', base),
    ]);
    const clean = (a) => a.filter((x) => x !== null && x !== undefined && x !== '').sort();
    const out = {
      officers: clean(officers), grades: clean(grades), departments: clean(departments),
      locations: clean(locations), creditDays: creditDays.filter((n) => n > 0).sort((a, b) => a - b),
      statuses: clean(statuses), regions: clean(regions), bands: BANDS,
    };
    cache.set(key, out, 300);
    res.json(out);
  } catch (e) { res.status(500).json({ message: 'تعذّر جلبُ قيم الفلاتر' }); }
};

// ── الفواتير ───────────────────────────────────────────────────────────────
function invoiceFilter(q = {}) {
  const f = {};
  const list = (v) => (Array.isArray(v) ? v : [v]).filter(Boolean);
  const { kind, status, partyCode, officer, from, to, dateField = 'invoiceDate', open, search, band } = q;
  if (kind) f.kind = { $in: list(kind) };
  if (status) f.status = { $in: list(status) };
  if (partyCode) f.partyCode = { $in: list(partyCode) };
  if (open === 'true') Object.assign(f, OPEN);
  if (open === 'false') f.status = 'Collected';
  if (from || to) {
    const field = ['invoiceDate', 'deliveryDate', 'collectionDate'].includes(dateField) ? dateField : 'invoiceDate';
    f[field] = {};
    if (from) f[field].$gte = new Date(`${from}T00:00:00.000Z`);
    if (to) f[field].$lte = new Date(`${to}T23:59:59.999Z`);
  }
  if (search) {
    const rx = { $regex: String(search).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), $options: 'i' };
    f.$or = [{ invoiceNumber: rx }, { partyName: rx }, { partyCode: rx }, { comments: rx }];
  }
  return f;
}

/** الأيّامُ الثلاثة التي يُقرأ بها عمرُ الفاتورة — تُحسب ولا تُخزَّن. */
function decorate(v, today, creditDaysOf) {
  const toDelivery = v.deliveryDate && v.invoiceDate ? Math.floor((new Date(v.deliveryDate) - new Date(v.invoiceDate)) / DAY) : null;
  const toCollection = v.collectionDate && v.deliveryDate ? Math.floor((new Date(v.collectionDate) - new Date(v.deliveryDate)) / DAY) : null;
  const ageDays = daysBetween(v.invoiceDate || v.deliveryDate, today);
  const cd = creditDaysOf ? creditDaysOf(v) : 0;
  // الاستحقاقُ من التسليم — لا تبدأ المهلةُ قبل أن تصل الفاتورةُ العميلَ.
  const dueDate = v.deliveryDate && cd ? new Date(new Date(v.deliveryDate).getTime() + cd * DAY) : null;
  const daysToDue = dueDate ? Math.floor((dueDate - today) / DAY) : null;
  return {
    ...v,
    ageDays, band: ageDays == null ? '' : bandOf(ageDays),
    daysInvoiceToDelivery: toDelivery,
    daysDeliveryToCollection: toCollection,
    daysTotal: v.collectionDate && v.invoiceDate ? Math.floor((new Date(v.collectionDate) - new Date(v.invoiceDate)) / DAY) : null,
    creditDays: cd, dueDate, daysToDue,
    overdue: daysToDue != null && daysToDue < 0 && v.status !== 'Collected',
  };
}

// GET /api/collections-dept/ledger/invoices
exports.invoices = async (req, res) => {
  try {
    const { page = 1, limit = 50, band } = req.query;
    const filter = invoiceFilter(req.query);

    // فلترُ الموظّف المسؤول يمرّ عبر الحساب — الفاتورةُ لا تحمل اسمَه.
    if (req.query.officer) {
      const codes = await CollectionsParty.distinct('code', {
        kind: 'customer',
        collectionOfficer: { $in: (Array.isArray(req.query.officer) ? req.query.officer : [req.query.officer]) },
      });
      filter.partyCode = filter.partyCode ? { $in: codes.filter((c) => filter.partyCode.$in.includes(c)) } : { $in: codes };
    }

    const today = startOfToday();
    const p = Math.max(1, parseInt(page, 10)); const l = Math.min(500, Math.max(1, parseInt(limit, 10)));

    // مهلةُ السداد صفةُ الحساب، فتُقرأ مرّةً وتُلصق بفواتيره.
    const cdByCode = new Map((await CollectionsParty.find({ kind: 'customer', code: { $gt: '' } })
      .select('code creditDays').lean()).map((x) => [x.code, x.creditDays || 0]));
    const creditDaysOf = (v) => cdByCode.get(v.partyCode) || 0;

    if (band && BANDS.some((b) => b.key === band)) {
      // الشريحةُ شرطٌ على قيمةٍ محسوبة، فتُطبَّق بعد القراءة — والمجموعُ عليها لا على الصفحة.
      const all = await CollectionInvoice.find(filter).select('-__v').lean();
      const dec = all.map((v) => decorate(v, today, creditDaysOf)).filter((v) => v.band === band);
      const sum = dec.reduce((s, v) => s + v.total, 0);
      return res.json({ rows: dec.slice((p - 1) * l, p * l), total: dec.length, page: p, pages: Math.ceil(dec.length / l), sum, bands: BANDS });
    }

    const [rows, total, agg] = await Promise.all([
      CollectionInvoice.find(filter).select('-__v').sort({ invoiceDate: -1, invoiceNumber: -1 }).skip((p - 1) * l).limit(l).lean(),
      CollectionInvoice.countDocuments(filter),
      CollectionInvoice.aggregate([{ $match: filter }, { $group: { _id: null, sum: { $sum: '$total' } } }]),
    ]);
    res.json({
      rows: rows.map((v) => decorate(v, today, creditDaysOf)),
      total, page: p, pages: Math.ceil(total / l), sum: agg[0]?.sum || 0, bands: BANDS,
    });
  } catch (e) {
    console.error('ledger invoices error:', e);
    res.status(500).json({ message: 'تعذّر جلبُ الفواتير' });
  }
};

// GET /api/collections-dept/ledger/invoices/filters
exports.invoiceFilters = async (req, res) => {
  try {
    const key = `${CACHE_PREFIX}invfilters`;
    const hit = cache.get(key);
    if (hit) return res.json(hit);
    const [statuses, kinds] = await Promise.all([
      CollectionInvoice.distinct('status'),
      CollectionInvoice.distinct('kind'),
    ]);
    const officers = await CollectionsParty.distinct('collectionOfficer', { kind: 'customer', code: { $gt: '' } });
    const out = {
      statuses: statuses.filter(Boolean).sort(),
      kinds: kinds.filter(Boolean).sort(),
      officers: officers.filter(Boolean).sort(),
      bands: BANDS,
    };
    cache.set(key, out, 300);
    res.json(out);
  } catch (e) { res.status(500).json({ message: 'تعذّر جلبُ قيم الفلاتر' }); }
};

// ═══════════════════════════════════════════════════════════════════════════
//  التنبيهات — تُحسب ولا تُخزَّن
// ═══════════════════════════════════════════════════════════════════════════
/**
 * تنبيهان لا واحد:
 *
 *   **الحدُّ الائتمانيّ** — مديونيّةُ العميل قاربت السقفَ المتّفق عليه. يُنبَّه
 *   قبل بلوغه لا بعده: بعدَه تكون الشحنةُ قد خرجت.
 *
 *   **الاستحقاق** — فاتورةٌ سُلِّمت ومهلتُها تنتهي بعد أيّام. تُقاس من يوم
 *   التسليم لا الفوترة، فمهلةُ الثلاثين لا تبدأ قبل أن تصل الورقةُ العميل.
 *
 * ولا يُخزَّن تنبيهٌ قطّ: يُحسب من الرصيد والتواريخ في كلّ فتحة. المخزَّنُ
 * وحدَه هو الإسكات — قرارٌ بشريٌّ بأنّ فلانًا رآه.
 */
const LIMIT_WARN_PCT = 80;     // «قارب» = بلغ ثمانين في المئة من سقفه
const DUE_WARN_DAYS = 3;       // ينبَّه قبل الاستحقاق بثلاثة أيّام

// GET /api/collections-dept/ledger/alerts
exports.alerts = async (req, res) => {
  try {
    const cacheKey = keyOf('alerts', req);
    const cached = cache.get(cacheKey);
    if (cached) return res.json(cached);
    const warnPct = Number(req.query.warnPct) || LIMIT_WARN_PCT;
    const warnDays = Number(req.query.warnDays) || DUE_WARN_DAYS;
    const today = startOfToday();

    const parties = await CollectionsParty.find({ ...partyFilter(req.query), isActive: { $ne: false } })
      .select('code name creditLimit creditDays collectionOfficer hoLocation grade paymentType').lean();
    const ids = parties.map((p) => p._id);
    // ── والثلاثةُ معًا لا واحدًا بعد واحد ────────────────────────────────────
    // لا يعتمد أيٌّ منها على نتيجة الآخر، وكانت تُطلب بالتتابع — فثلاثُ رحلاتٍ
    // إلى العنقود المشترك ثمنُها ثلاثةُ أضعاف الواحدة بلا سبب.
    const cdByCode = new Map(parties.filter((p) => p.creditDays > 0).map((p) => [p.code, p]));
    const [ageMap, cashMap, acks, open] = await Promise.all([
      agingByParty(ids),
      cashAgingByParty(parties),
      CreditAlertAck.find({ party: { $in: ids } }).lean(),
      CollectionInvoice.find({ ...OPEN, partyCode: { $in: [...cdByCode.keys()] }, deliveryDate: { $ne: null } })
        .select('invoiceNumber partyCode partyName party total deliveryDate invoiceDate').lean(),
    ]);

    // ── تنبيهُ الحدّ ────────────────────────────────────────────────────────
    const ackLimit = new Map(acks.filter((a) => a.kind === 'limit').map((a) => [String(a.party), a]));
    const limitAlerts = [];
    for (const p of parties) {
      if (!p.creditLimit || p.creditLimit <= 0) continue;
      // الحدُّ يُقاس على ما على العميل كلِّه — ضريبيًّا كان أم نقديًّا.
      const out = (ageMap.get(String(p._id))?.outstanding || 0) + (cashMap.get(String(p._id))?.outstanding || 0);
      const pct = (out / p.creditLimit) * 100;
      if (pct < warnPct) continue;
      // الإسكاتُ يسقط إذا ارتفعت المديونيّةُ بعده: «رأيتُه عند ٩٠٪» لا يُسكت ١٢٠٪.
      const ack = ackLimit.get(String(p._id));
      if (ack && out <= (ack.atOutstanding || 0)) continue;
      limitAlerts.push({
        kind: 'limit', party: p._id, code: p.code, name: p.name,
        officer: p.collectionOfficer, outstanding: out, creditLimit: p.creditLimit,
        pct, over: out > p.creditLimit,
        severity: out > p.creditLimit ? 'over' : 'near',
      });
    }
    limitAlerts.sort((a, b) => b.pct - a.pct);

    // ── تنبيهُ الاستحقاق ────────────────────────────────────────────────────
    const ackDue = new Set(acks.filter((a) => a.kind === 'due').map((a) => `${a.party}::${a.invoiceNumber}`));
    const dueAlerts = [];
    for (const v of open) {
      const p = cdByCode.get(v.partyCode); if (!p) continue;
      const due = new Date(new Date(v.deliveryDate).getTime() + p.creditDays * DAY);
      const inDays = Math.floor((due - today) / DAY);
      if (inDays > warnDays) continue;                       // بعيدٌ بعد
      if (ackDue.has(`${v.party}::${v.invoiceNumber}`)) continue;
      dueAlerts.push({
        kind: 'due', party: v.party, code: v.partyCode, name: v.partyName,
        officer: p.collectionOfficer, invoiceNumber: v.invoiceNumber, total: v.total,
        deliveryDate: v.deliveryDate, creditDays: p.creditDays, dueDate: due, daysToDue: inDays,
        severity: inDays < 0 ? 'overdue' : 'soon',
      });
    }
    dueAlerts.sort((a, b) => a.daysToDue - b.daysToDue);

    const out = {
      limit: limitAlerts,
      due: dueAlerts,
      counts: {
        limitNear: limitAlerts.filter((a) => !a.over).length,
        limitOver: limitAlerts.filter((a) => a.over).length,
        dueSoon: dueAlerts.filter((a) => a.daysToDue >= 0).length,
        overdue: dueAlerts.filter((a) => a.daysToDue < 0).length,
      },
      settings: { warnPct, warnDays },
    };
    cache.set(cacheKey, out, TTL);
    res.json(out);
  } catch (e) {
    console.error('alerts error:', e);
    res.status(500).json({ message: 'تعذّر حسابُ التنبيهات' });
  }
};

// POST /api/collections-dept/ledger/alerts/ack — «رأيتُه»
exports.ackAlert = async (req, res) => {
  try {
    const { party, kind, invoiceNumber = '', note = '' } = req.body || {};
    if (!party || !['limit', 'due'].includes(kind)) return res.status(400).json({ message: 'بياناتٌ ناقصة' });
    const p = await CollectionsParty.findById(party).select('_id').lean();
    if (!p) return res.status(404).json({ message: 'الحساب غير موجود' });
    // يُقيَّد الرصيدُ لحظةَ الإسكات، فيعود التنبيهُ إن ارتفع بعده.
    const at = kind === 'limit'
      ? (await agingByParty([p._id])).get(String(p._id))?.outstanding || 0 : 0;
    exports.invalidate();
    await CreditAlertAck.findOneAndUpdate(
      { party: p._id, kind, invoiceNumber },
      { $set: { party: p._id, kind, invoiceNumber, atOutstanding: at, note, ackedBy: req.user._id, ackedAt: new Date() } },
      { upsert: true },
    );
    exports.invalidate();
    res.json({ ok: true, atOutstanding: at });
  } catch (e) { res.status(500).json({ message: 'تعذّر إغلاق التنبيه' }); }
};

// ═══════════════════════════════════════════════════════════════════════════
//  الخطّةُ اليوميّة
// ═══════════════════════════════════════════════════════════════════════════
// GET /api/collections-dept/ledger/tasks
exports.listTasks = async (req, res) => {
  try {
    const { from, to, officer, party, status, page = 1, limit = 200 } = req.query;
    const f = {};
    if (from || to) { f.date = {}; if (from) f.date.$gte = from; if (to) f.date.$lte = to; }
    if (officer) f.officerName = { $in: Array.isArray(officer) ? officer : [officer] };
    if (party) f.party = party;
    if (status) f.status = { $in: Array.isArray(status) ? status : [status] };
    const p = Math.max(1, parseInt(page, 10)); const l = Math.min(1000, Math.max(1, parseInt(limit, 10)));
    const [rows, total, agg] = await Promise.all([
      CollectionTask.find(f).sort({ date: -1, partyName: 1 }).skip((p - 1) * l).limit(l).lean(),
      CollectionTask.countDocuments(f),
      CollectionTask.aggregate([{ $match: f }, { $group: { _id: null, collected: { $sum: '$collected' } } }]),
    ]);
    res.json({ rows, total, page: p, pages: Math.ceil(total / l), collected: agg[0]?.collected || 0 });
  } catch (e) { res.status(500).json({ message: 'تعذّر جلبُ المهامّ' }); }
};

// POST /api/collections-dept/ledger/tasks
exports.createTask = async (req, res) => {
  try {
    const { party, date, requestType = '', officerName = '', action = '', status = '', collected = 0, notes = '' } = req.body || {};
    if (!party || !date) return res.status(400).json({ message: 'العميل والتاريخ مطلوبان' });
    const p = await CollectionsParty.findById(party).select('code name collectionOfficer').lean();
    if (!p) return res.status(404).json({ message: 'الحساب غير موجود' });
    const doc = await CollectionTask.findOneAndUpdate(
      { party: p._id, date, requestType },
      { $set: {
        party: p._id, partyCode: p.code, partyName: p.name, date, requestType,
        // مَن لم يُسمَّ له موظّفٌ يأخذ مسؤولَ الحساب — وهو الجوابُ الصحيح غالبًا.
        officerName: officerName || p.collectionOfficer || '',
        planned: true, action, status, collected: Number(collected) || 0, notes,
        createdBy: req.user._id,
      } },
      { upsert: true, new: true, setDefaultsOnInsert: true },
    );
    res.status(201).json({ task: doc });
  } catch (e) { res.status(500).json({ message: 'تعذّر إنشاءُ المهمّة' }); }
};

// PUT /api/collections-dept/ledger/tasks/:id
exports.updateTask = async (req, res) => {
  try {
    const allowed = ['requestType', 'officerName', 'status', 'collected', 'action', 'notes', 'planned', 'date'];
    const set = {};
    for (const k of allowed) if (req.body[k] !== undefined) set[k] = req.body[k];
    const t = await CollectionTask.findByIdAndUpdate(req.params.id, { $set: set }, { new: true });
    if (!t) return res.status(404).json({ message: 'المهمّة غير موجودة' });
    res.json({ task: t });
  } catch (e) { res.status(500).json({ message: 'تعذّر تعديلُ المهمّة' }); }
};

// DELETE /api/collections-dept/ledger/tasks/:id
exports.deleteTask = async (req, res) => {
  try {
    const t = await CollectionTask.findByIdAndDelete(req.params.id);
    if (!t) return res.status(404).json({ message: 'المهمّة غير موجودة' });
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ message: 'تعذّر حذفُ المهمّة' }); }
};

// ═══════════════════════════════════════════════════════════════════════════
//  الفريق — مَن يتولّى مَن، وكيف يعمل
// ═══════════════════════════════════════════════════════════════════════════
// GET /api/collections-dept/ledger/team
exports.team = async (req, res) => {
  try {
    const cacheKey = keyOf('team', req);
    const cached = cache.get(cacheKey);
    if (cached) return res.json(cached);
    const parties = await CollectionsParty.find({ kind: 'customer', code: { $gt: '' } })
      .select('code name collectionOfficer creditLimit paymentType').lean();
    // الضريبيُّ من دفتر الفواتير، والنقديُّ من الكشوف — راجع cashAgingByParty.
    const [ageMap, cashMap] = await Promise.all([
      agingByParty(parties.map((p) => p._id)),
      cashAgingByParty(parties),
    ]);
    // (رحلتان لا ثلاث: الثانيةُ تحتاج معرّفاتِ الأولى فلا تُوازى.)
    const byOfficer = new Map();
    for (const p of parties) {
      const k = p.collectionOfficer || '';
      if (!byOfficer.has(k)) byOfficer.set(k, { officer: k, accounts: 0, outstanding: 0, overLimit: 0, tax: 0, cash: 0 });
      const e = byOfficer.get(k);
      // الحدُّ يُقاس على ما على العميل كلِّه — ضريبيًّا كان أم نقديًّا.
      const out = (ageMap.get(String(p._id))?.outstanding || 0) + (cashMap.get(String(p._id))?.outstanding || 0);
      e.accounts += 1; e.outstanding += out;
      if (p.creditLimit > 0 && out > p.creditLimit) e.overLimit += 1;
      if (p.paymentType === 'cash') e.cash += 1; else e.tax += 1;
    }
    const out = { officers: [...byOfficer.values()].sort((a, b) => b.outstanding - a.outstanding) };
    cache.set(cacheKey, out, TTL);
    res.json(out);
  } catch (e) { res.status(500).json({ message: 'تعذّر جلبُ الفريق' }); }
};

// PUT /api/collections-dept/ledger/team/assign — مَن يتولّى هذه الحسابات
exports.assignOfficer = async (req, res) => {
  try {
    const { parties, officer } = req.body || {};
    if (!Array.isArray(parties) || !parties.length) return res.status(400).json({ message: 'اختر حسابًا واحدًا على الأقلّ' });
    const r = await CollectionsParty.updateMany({ _id: { $in: parties } }, { $set: { collectionOfficer: String(officer || '').trim() } });
    exports.invalidate();
    res.json({ ok: true, updated: r.modifiedCount });
  } catch (e) { res.status(500).json({ message: 'تعذّر إسنادُ الحسابات' }); }
};

// ═══════════════════════════════════════════════════════════════════════════
//  تقييمُ الفريق
// ═══════════════════════════════════════════════════════════════════════════
// GET /api/collections-dept/ledger/performance
exports.performance = async (req, res) => {
  try {
    const cacheKey = keyOf('performance', req);
    const cached = cache.get(cacheKey);
    if (cached) return res.json(cached);
    const { from, to, officer } = req.query;
    const range = {};
    if (from) range.$gte = new Date(`${from}T00:00:00.000Z`);
    if (to) range.$lte = new Date(`${to}T23:59:59.999Z`);
    const hasRange = !!(from || to);

    const partyQ = { kind: 'customer', code: { $gt: '' } };
    if (officer) partyQ.collectionOfficer = { $in: Array.isArray(officer) ? officer : [officer] };
    const parties = await CollectionsParty.find(partyQ).select('code collectionOfficer creditDays').lean();
    const officerOf = new Map(parties.map((p) => [p.code, p.collectionOfficer || '']));
    const cdOf = new Map(parties.map((p) => [p.code, p.creditDays || 0]));
    const codes = parties.map((p) => p.code);
    const today = startOfToday();

    // ── والمجاميعُ تُحسب في القاعدة ─────────────────────────────────────────
    // كانت تسعةُ آلاف فاتورةٍ تُنقَل إلى العقدة لتُجمَع هناك: خمسَ عشرةَ ثانيةً
    // على الإنتاج، تكفي لأن تبدو الصفحةُ معطَّلة. والمجموعُ عملُ القاعدة.
    const collectedMatch = { partyCode: { $in: codes }, status: 'Collected' };
    if (hasRange) collectedMatch.collectionDate = range;
    const [collected, open] = await Promise.all([
      CollectionInvoice.aggregate([
        { $match: collectedMatch },
        { $addFields: { _base: { $ifNull: ['$deliveryDate', '$invoiceDate'] } } },
        { $group: {
          _id: '$partyCode', n: { $sum: 1 }, amount: { $sum: '$total' },
          // متوسّطُ أيّام التحصيل يُحسب هنا أيضًا: ما لا تاريخَ له يُهمَل ولا
          // يُحسب صفرًا — الصفرُ يجرّ المتوسّطَ إلى أسفلَ بلا سبب.
          days: { $avg: { $cond: [
            { $or: [{ $eq: ['$_base', null] }, { $eq: ['$collectionDate', null] }] }, null,
            { $dateDiff: { startDate: '$_base', endDate: '$collectionDate', unit: 'day' } },
          ] } },
        } },
      ]),
      CollectionInvoice.aggregate([
        { $match: { ...OPEN, partyCode: { $in: codes } } },
        { $group: { _id: '$partyCode', n: { $sum: 1 }, amount: { $sum: '$total' },
          overdue: { $push: { d: '$deliveryDate', t: '$total' } } } },
      ]),
    ]);

    const stats = new Map();
    const of = (code) => {
      const k = officerOf.get(code) || '';
      if (!stats.has(k)) stats.set(k, { officer: k, accounts: 0, collectedCount: 0, collectedAmount: 0, openCount: 0, openAmount: 0, overdueCount: 0, overdueAmount: 0, _dayNum: 0, _dayDen: 0 });
      return stats.get(k);
    };
    for (const p of parties) of(p.code).accounts += 1;
    for (const c of collected) {
      const e = of(c._id);
      e.collectedCount += c.n; e.collectedAmount += c.amount;
      if (c.days != null) { e._dayNum += c.days * c.n; e._dayDen += c.n; }
    }
    for (const o of open) {
      const e = of(o._id);
      e.openCount += o.n; e.openAmount += o.amount;
      const cd = cdOf.get(o._id) || 0;
      if (!cd) continue;
      for (const x of o.overdue) {
        if (!x.d) continue;
        if (new Date(new Date(x.d).getTime() + cd * DAY) < today) { e.overdueCount += 1; e.overdueAmount += x.t; }
      }
    }

    const rows = [...stats.values()].map((e) => {
      const avg = e._dayDen ? Math.round(e._dayNum / e._dayDen) : null;
      delete e._dayNum; delete e._dayDen;
      // ── نسبةُ التحصيل: ما حُصِّل من مجموع ما حُصِّل وما بقي ─────────────
      // لا «من الإجمالي» وحدَه: موظّفٌ حساباتُه صغيرةٌ يبدو ضعيفًا وهو حصّل
      // كلَّ ما لديه.
      const denom = e.collectedAmount + e.openAmount;
      return { ...e, avgDaysToCollect: avg, collectionRate: denom > 0 ? (e.collectedAmount / denom) * 100 : null };
    }).sort((a, b) => b.collectedAmount - a.collectedAmount);

    const taskQ = {};
    if (from || to) { taskQ.date = {}; if (from) taskQ.date.$gte = from; if (to) taskQ.date.$lte = to; }
    const tasks = await CollectionTask.aggregate([
      { $match: taskQ },
      { $group: { _id: '$officerName', total: { $sum: 1 }, done: { $sum: { $cond: [{ $eq: ['$status', 'Done'] }, 1, 0] } }, collected: { $sum: '$collected' } } },
    ]);
    const taskBy = new Map(tasks.map((t) => [t._id || '', t]));
    for (const r of rows) {
      const t = taskBy.get(r.officer);
      r.tasks = t?.total || 0; r.tasksDone = t?.done || 0; r.tasksCollected = t?.collected || 0;
    }

    const totals = rows.reduce((a, r) => ({
      accounts: a.accounts + r.accounts, collectedAmount: a.collectedAmount + r.collectedAmount,
      openAmount: a.openAmount + r.openAmount, overdueAmount: a.overdueAmount + r.overdueAmount,
      collectedCount: a.collectedCount + r.collectedCount, openCount: a.openCount + r.openCount,
    }), { accounts: 0, collectedAmount: 0, openAmount: 0, overdueAmount: 0, collectedCount: 0, openCount: 0 });

    const out = { rows, totals, range: { from: from || null, to: to || null } };
    cache.set(cacheKey, out, TTL);
    res.json(out);
  } catch (e) {
    console.error('performance error:', e);
    res.status(500).json({ message: 'تعذّر حسابُ التقييم' });
  }
};

// ═══════════════════════════════════════════════════════════════════════════
//  مراجعةُ الربط
// ═══════════════════════════════════════════════════════════════════════════
// GET /api/collections-dept/ledger/link-suggestions
exports.linkSuggestions = async (req, res) => {
  try {
    const decision = req.query.decision || 'pending';
    const rows = await PartyLinkSuggestion.find(decision === 'all' ? {} : { decision })
      .sort({ score: -1 }).limit(500).lean();
    const counts = await PartyLinkSuggestion.aggregate([{ $group: { _id: '$decision', n: { $sum: 1 } } }]);
    res.json({ rows, counts: Object.fromEntries(counts.map((c) => [c._id, c.n])) });
  } catch (e) { res.status(500).json({ message: 'تعذّر جلبُ الاقتراحات' }); }
};

// POST /api/collections-dept/ledger/link-suggestions/:id — قرارُ إنسان
exports.decideLink = async (req, res) => {
  try {
    const { decision } = req.body || {};
    if (!['linked', 'separate'].includes(decision)) return res.status(400).json({ message: 'قرارٌ غير معروف' });
    const sug = await PartyLinkSuggestion.findById(req.params.id);
    if (!sug) return res.status(404).json({ message: 'الاقتراح غير موجود' });

    if (decision === 'linked' && sug.candidate && sug.party && String(sug.candidate) !== String(sug.party)) {
      // ── الدمجُ ينقل ما على السجلّ القديم إلى الحساب ────────────────────
      // اسمُ القديم يصير صيغةً أخرى للحساب، فيُقرأ به كشفُ التشغيل إليه. ثمّ
      // يُعطَّل القديمُ ولا يُحذف: حذفُه يقطع ما يشير إليه، والتعطيلُ يُخرجه
      // من القوائم ويُبقي أثرَه.
      const old = await CollectionsParty.findById(sug.candidate).select('name nameKey').lean();
      if (old) {
        await CollectionsParty.updateOne({ _id: sug.party }, {
          $addToSet: { aliases: old.name, aliasKeys: old.nameKey || old.name },
        });
        await CollectionsParty.updateOne({ _id: sug.candidate }, { $set: { isActive: false, notes: `دُمج في الحساب ${sug.code}` } });
      }
    }
    sug.decision = decision; sug.decidedBy = req.user._id; sug.decidedAt = new Date(); sug.decidedHow = 'manual';
    await sug.save();
    exports.invalidate();
    res.json({ ok: true, suggestion: sug });
  } catch (e) {
    console.error('decideLink error:', e);
    res.status(500).json({ message: 'تعذّر حفظُ القرار' });
  }
};

module.exports.BANDS = BANDS;
module.exports._internals = { partyFilter, invoiceFilter, agingByParty, decorate, bandOf, startOfToday, OPEN, receivablesOnly };
module.exports.invalidate = () => cache.clear(CACHE_PREFIX);
