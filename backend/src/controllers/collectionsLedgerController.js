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
// يطوي فروقَ الرسم العربيّ والفراغات — هو نفسُه المستعمَل في صفحات الفواتير.
const { flexSpaceRegex } = require('../utils/plateKey');

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

// «مفتوحة» تعريفٌ واحدٌ للقسم كلِّه — راجع models/CollectionInvoice.OPEN.
const OPEN = CollectionInvoice.OPEN;

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
//
// ── ومن في السجلّ: صاحبُ كودٍ، أو صاحبُ فاتورةٍ مفتوحة ─────────────────────
// كان الشرطُ الكودَ وحدَه. وفي ورقة الشحنات النقديّة ٣٥٧ صفًّا بلا كود (المناولة
// للشحن وحدَها عليها ٤٩١ ألفًا)، فحساباتُها بلا كود — فكانت اللوحةُ تعدّ
// مديونيّتَها وسجلُّ الأعمار لا يراها، ويختلف الإجماليّان بـ٥٩٣ ألفًا.
// فمن عليه فاتورةٌ مفتوحةٌ في الدفتر يدخل السجلَّ بكودٍ أو بغير كود.
async function ledgerPartyBase() {
  return cache.wrap(`${CACHE_PREFIX}partybase`, TTL, async () => {
    const holders = (await CollectionInvoice.distinct('party', OPEN)).filter(Boolean);
    return { kind: 'customer', $or: [{ code: { $gt: '' } }, { _id: { $in: holders } }] };
  });
}

function partyFilter(q = {}, base = { kind: 'customer', code: { $gt: '' } }) {
  const f = { $and: [base] };
  const { officer, grade, department, hoLocation, kind, creditDays, status, region } = q;
  // التطبيقُ يرسل البحثَ باسم `q` والموقعُ باسم `search` — يُقبَلان معًا.
  const search = q.search || q.q;
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
    // ── والبحثُ يطوي فروقَ الرسم كما في بقيّة النظام ──────────────────────
    // كان تعبيرًا نصّيًّا مهروبًا لا غير: مَن كتب «روابى» بالألف المقصورة أو
    // «شركه» بالهاء لا يجد شيئًا — والاسمُ نفسُه مخزَّنٌ بالياء والتاء
    // المربوطة. قِيس: «روابي التسويق» تردّ حسابًا، وبأشباه الحروف **صفرًا**.
    // و`flexSpaceRegex` هي التي تبحث بها صفحاتُ الفواتير والعملاء أصلًا.
    const rx = flexSpaceRegex(String(search));
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
 * ── والنقديُّ من الدفتر نفسِه، لا من كشوف التشغيل ───────────────────────────
 *
 * كان المستحقُّ النقديُّ يُجمَع من كشوف التشغيل ويُضاف فوق الدفتر — يومَ لم
 * تكن ورقةُ الشحنات النقديّة تدخل النظام. ثمّ دخلت (١٨٣٥ شحنةً في الدفتر)،
 * وبقيت الإضافة: فصار النقديُّ يُعَدّ مرّتين. مكتبُ الشيخ عليه في الدفتر
 * ٢١٬٥٠٠ وكان يظهر ١٠٣ آلاف، وإجماليُّ الأعمار ٢٢٫٠٥ مليونًا واللوحةُ ١٩٫٩٦.
 *
 * وقيمةُ الكشف في التشغيل هي سعرُ الشراء لا ما على العميل — راجع
 * real-selling-price. فالدفترُ وحدَه، بنوعَيه، وتتطابق الأعمارُ واللوحة.
 */
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
    { $group: { _id: { p: '$party', b: '$_band', k: '$kind' }, sum: { $sum: '$total' }, n: { $sum: 1 } } },
  ]);

  const out = new Map();
  const blank = () => ({
    outstanding: 0, count: 0, tax: 0, cash: 0,
    bands: Object.fromEntries(BANDS.map((b) => [b.key, 0])),
    counts: Object.fromEntries(BANDS.map((b) => [b.key, 0])),
  });
  for (const r of rows) {
    const k = String(r._id.p);
    if (!out.has(k)) out.set(k, blank());
    const e = out.get(k);
    e.outstanding += r.sum; e.count += r.n;
    if (r._id.k === 'cash') e.cash += r.sum; else e.tax += r.sum;
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
    const filter = partyFilter(req.query, await ledgerPartyBase());
    const parties = await CollectionsParty.find(filter)
      .select('code name paymentType collectionOfficer hoLocation grade salesManagers department region creditLimit creditDays status')
      .lean();

    // الدفترُ وحدَه بنوعَيه — راجع التعليق فوق agingByParty.
    const ageMap = await agingByParty(parties.map((p) => p._id));
    let rows = parties.map((p) => {
      const a = ageMap.get(String(p._id))
        || { outstanding: 0, count: 0, tax: 0, cash: 0, bands: Object.fromEntries(BANDS.map((b) => [b.key, 0])), counts: Object.fromEntries(BANDS.map((b) => [b.key, 0])) };
      const pct = p.creditLimit > 0 ? (a.outstanding / p.creditLimit) * 100 : null;
      return { ...p, outstanding: a.outstanding, taxOutstanding: a.tax, cashOutstanding: a.cash, invoiceCount: a.count, bands: a.bands, bandCounts: a.counts, limitUsedPct: pct };
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

    // السقفُ يسع ما تطلبه الشاشةُ للتصدير (٥٠٠٠)؛ كان ٥٠٠ فيخرج الملفُّ بأوّل خمسمئةٍ صامتًا.
    const p = Math.max(1, parseInt(page, 10)); const l = Math.min(20000, Math.max(1, parseInt(limit, 10)));
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
  const { kind, status, partyCode, officer, from, to, dateField = 'invoiceDate', open, band } = q;
  const search = q.search || q.q;
  if (kind) f.kind = { $in: list(kind) };
  if (status) f.status = { $in: list(status) };
  if (partyCode) f.partyCode = { $in: list(partyCode) };
  if (open === 'true') Object.assign(f, OPEN);
  if (open === 'false') Object.assign(f, CollectionInvoice.COLLECTED);
  if (from || to) {
    const field = ['invoiceDate', 'deliveryDate', 'collectionDate'].includes(dateField) ? dateField : 'invoiceDate';
    f[field] = {};
    if (from) f[field].$gte = new Date(`${from}T00:00:00.000Z`);
    if (to) f[field].$lte = new Date(`${to}T23:59:59.999Z`);
  }
  if (search) {
    // يطوي فروقَ الرسم العربيّ — راجع partyFilter أعلاه.
    const rx = flexSpaceRegex(String(search));
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
  // ما حُصِّل لا يُقال عنه «متأخّر» ولا «بقي له كذا» — انتهى أمرُه.
  const isCollected = CollectionInvoice.isCollected(v);
  const daysToDue = dueDate && !isCollected ? Math.floor((dueDate - today) / DAY) : null;
  return {
    ...v,
    ageDays, band: ageDays == null ? '' : bandOf(ageDays),
    daysInvoiceToDelivery: toDelivery,
    daysDeliveryToCollection: toCollection,
    daysTotal: v.collectionDate && v.invoiceDate ? Math.floor((new Date(v.collectionDate) - new Date(v.invoiceDate)) / DAY) : null,
    creditDays: cd, dueDate, daysToDue,
    collected: isCollected,
    overdue: daysToDue != null && daysToDue < 0 && !isCollected,
  };
}

/**
 * كشوفُ التشغيل تحت كلّ فاتورة — تُقرأ لحظةَ القراءة لا من نسخةٍ محفوظة.
 *
 * ── لماذا لا تُقرأ من `reportNumbers` المحفوظة ─────────────────────────────
 * الحقلُ موجودٌ ويُملأ عند الاستيراد، لكنّ كشوفَ التشغيل تصل كلَّ دقيقةٍ من
 * منصّةِ التشغيل: كشفٌ يُكتب عليه رقمُ فاتورةٍ اليومَ لا تعرفه نسخةٌ كُتبت في
 * آخر استيراد. فتُشتقّ هنا من الكشوف نفسِها، فلا يظهر عمودُ «كشوف التشغيل»
 * متأخّرًا عمّا في ملفّ الكشف.
 *
 * والفاتورةُ تجمع كشوفًا: من ٥٥٨ فاتورةً لها كشوف، ٣٥٨ تحتها ثلاثةٌ فأكثر.
 * والباقي بلا كشوفٍ عندنا بحقّ — أكثرُ دفتر التحصيل أقدمُ من نظام التشغيل.
 */
async function attachReportNumbers(rows) {
  const { invoiceNumberKey } = require('../utils/invoiceNumberKey');
  const OperationsWorkflow = require('../models/OperationsWorkflow');
  const keys = new Map();   // مفتاحٌ مطويّ → أرقامُ الفواتير كما كُتبت
  for (const r of rows) {
    const k = invoiceNumberKey(r.invoiceNumber);
    if (k) keys.set(k, true);
  }
  if (!keys.size) return rows;
  // الاستعلامُ بالأرقام كما كُتبت (فهرسٌ عليها)، والمطابقةُ بعده بالمفتاح
  // المطويّ — فلا يفوت رقمٌ كُتب بصفرٍ بادئٍ في أحد السجلَّين.
  const raw = rows.map((r) => String(r.invoiceNumber || '')).filter(Boolean);
  const sheets = await OperationsWorkflow.find({ invoiceNumber: { $in: raw } })
    .select('reportNumber invoiceNumber').lean();
  const byKey = new Map();
  for (const w of sheets) {
    const k = invoiceNumberKey(w.invoiceNumber);
    const rn = String(w.reportNumber || '').trim();
    if (!k || !rn) continue;
    if (!byKey.has(k)) byKey.set(k, new Set());
    byKey.get(k).add(rn);
  }
  for (const r of rows) {
    const k = invoiceNumberKey(r.invoiceNumber);
    const hit = k && byKey.get(k);
    if (hit) r.reportNumbers = [...hit].sort();
  }
  return rows;
}

// GET /api/collections-dept/ledger/invoices
exports.invoices = async (req, res) => {
  try {
    const { page = 1, limit = 50, band } = req.query;
    const filter = invoiceFilter(req.query);

    // فلترُ الموظّف المسؤول يمرّ عبر الحساب — الفاتورةُ لا تحمل اسمَه.
    if (req.query.officer) {
      // بالرابط لا بالكود: ٣٥٧ شحنةً نقديّةً في الدفتر بلا كود، وحسابُها معروف.
      filter.party = { $in: await CollectionsParty.distinct('_id', {
        kind: 'customer',
        collectionOfficer: { $in: (Array.isArray(req.query.officer) ? req.query.officer : [req.query.officer]) },
      }) };
    }

    const today = startOfToday();
    // السقفُ يسع ما تطلبه الشاشةُ للتصدير (٥٠٠٠)؛ كان ٥٠٠ فيخرج الملفُّ بأوّل خمسمئةٍ صامتًا.
    const p = Math.max(1, parseInt(page, 10)); const l = Math.min(20000, Math.max(1, parseInt(limit, 10)));

    // مهلةُ السداد صفةُ الحساب، فتُقرأ مرّةً وتُلصق بفواتيره.
    const cdById = new Map((await CollectionsParty.find({ kind: 'customer', creditDays: { $gt: 0 } })
      .select('creditDays').lean()).map((x) => [String(x._id), x.creditDays || 0]));
    const creditDaysOf = (v) => cdById.get(String(v.party)) || 0;

    if (band && BANDS.some((b) => b.key === band)) {
      // الشريحةُ شرطٌ على قيمةٍ محسوبة، فتُطبَّق بعد القراءة — والمجموعُ عليها لا على الصفحة.
      const all = await CollectionInvoice.find(filter).select('-__v').lean();
      const dec = all.map((v) => decorate(v, today, creditDaysOf)).filter((v) => v.band === band);
      const sum = dec.reduce((s, v) => s + v.total, 0);
      const slice = await attachReportNumbers(dec.slice((p - 1) * l, p * l));
      return res.json({ rows: slice, total: dec.length, page: p, pages: Math.ceil(dec.length / l), sum, bands: BANDS });
    }

    const [rows, total, agg] = await Promise.all([
      CollectionInvoice.find(filter).select('-__v').sort({ invoiceDate: -1, invoiceNumber: -1 }).skip((p - 1) * l).limit(l).lean(),
      CollectionInvoice.countDocuments(filter),
      CollectionInvoice.aggregate([{ $match: filter }, { $group: { _id: null, sum: { $sum: '$total' } } }]),
    ]);
    res.json({
      rows: await attachReportNumbers(rows.map((v) => decorate(v, today, creditDaysOf))),
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

/**
 * ── والشاشةُ تعرض خمسةً وتقول «وستُّمئةٍ غيرها» ──────────────────────────────
 * فواتيرُ الاستحقاق ستُّمئةٌ وستّةَ عشر — مئتا كيلوبايتٍ تُنقَل وتُحلَّل على
 * الهاتف ليُرسَم منها خمسةُ صفوف. فالعددُ يُحسَب على الكلّ كما كان (لا يتغيّر
 * رقمٌ يراه أحد)، والصفوفُ تُقتطَع عند `rows`.
 *
 * والقطعُ بعد الذاكرة لا قبلها: المفتاحُ لا يعرف `rows`، فمن طلب خمسةً ومن طلب
 * مئتين يقتسمان حسابًا واحدًا.
 */
const ALERT_ROWS_MAX = 1000;
/** الأعدادُ كما هي والصفوفُ مقتطعةٌ — الجوابُ المخزَّنُ كاملٌ لا يُمسّ. */
const sliceAlerts = (out, rows) => ({
  ...out,
  limit: out.limit.length > rows ? out.limit.slice(0, rows) : out.limit,
  due: out.due.length > rows ? out.due.slice(0, rows) : out.due,
  rows,
});
// GET /api/collections-dept/ledger/alerts
exports.alerts = async (req, res) => {
  try {
    // ومَن لم يطلب عددًا يأخذ الكلّ: القطعُ يُطلَب صراحةً، فلا تغيب صفوفٌ عن
    // نداءٍ قديمٍ لا يعرف هذا الوسيط.
    const { rows: rowsQ, ...rest } = req.query || {};
    const rows = Math.min(ALERT_ROWS_MAX, Math.max(1, parseInt(rowsQ, 10) || ALERT_ROWS_MAX));
    const cacheKey = keyOf('alerts', { query: rest, user: req.user });
    const cached = cache.get(cacheKey);
    if (cached) return res.json(sliceAlerts(cached, rows));
    const warnPct = Number(req.query.warnPct) || LIMIT_WARN_PCT;
    const warnDays = Number(req.query.warnDays) || DUE_WARN_DAYS;
    const today = startOfToday();

    const parties = await CollectionsParty.find({ ...partyFilter(req.query, await ledgerPartyBase()), isActive: { $ne: false } })
      .select('code name creditLimit creditDays collectionOfficer hoLocation grade paymentType').lean();
    const ids = parties.map((p) => p._id);
    // ── والثلاثةُ معًا لا واحدًا بعد واحد ────────────────────────────────────
    // لا يعتمد أيٌّ منها على نتيجة الآخر، وكانت تُطلب بالتتابع — فثلاثُ رحلاتٍ
    // إلى العنقود المشترك ثمنُها ثلاثةُ أضعاف الواحدة بلا سبب.
    // بالرابط لا بالكود المكتوب: كودُ الفاتورة قد يكون فارغًا وحسابُها معروف.
    const cdByCode = new Map(parties.filter((p) => p.creditDays > 0).map((p) => [String(p._id), p]));
    const [ageMap, acks, open] = await Promise.all([
      agingByParty(ids),
      CreditAlertAck.find({ party: { $in: ids } }).lean(),
      CollectionInvoice.find({ ...OPEN, party: { $in: [...cdByCode.keys()] }, deliveryDate: { $ne: null } })
        .select('invoiceNumber partyCode partyName party total deliveryDate invoiceDate').lean(),
    ]);

    // ── تنبيهُ الحدّ ────────────────────────────────────────────────────────
    const ackLimit = new Map(acks.filter((a) => a.kind === 'limit').map((a) => [String(a.party), a]));
    const limitAlerts = [];
    for (const p of parties) {
      if (!p.creditLimit || p.creditLimit <= 0) continue;
      // الحدُّ يُقاس على ما على العميل كلِّه — ضريبيًّا كان أم نقديًّا.
      const out = ageMap.get(String(p._id))?.outstanding || 0;
      const pct = (out / p.creditLimit) * 100;
      if (pct < warnPct) continue;
      // الإسكاتُ يسقط إذا ارتفعت المديونيّةُ بعده: «رأيتُه عند ٩٠٪» لا يُسكت ١٢٠٪.
      const ack = ackLimit.get(String(p._id));
      if (ack && out <= (ack.atOutstanding || 0)) continue;
      limitAlerts.push({
        kind: 'limit', party: p._id, code: p.code, name: p.name,
        officer: p.collectionOfficer, outstanding: out, creditLimit: p.creditLimit,
        pct, over: out > p.creditLimit,
      });
    }
    limitAlerts.sort((a, b) => b.pct - a.pct);

    // ── تنبيهُ الاستحقاق ────────────────────────────────────────────────────
    const ackDue = new Set(acks.filter((a) => a.kind === 'due').map((a) => `${a.party}::${a.invoiceNumber}`));
    const dueAlerts = [];
    for (const v of open) {
      const p = cdByCode.get(String(v.party)); if (!p) continue;
      const due = new Date(new Date(v.deliveryDate).getTime() + p.creditDays * DAY);
      const inDays = Math.floor((due - today) / DAY);
      if (inDays > warnDays) continue;                       // بعيدٌ بعد
      if (ackDue.has(`${v.party}::${v.invoiceNumber}`)) continue;
      // `dueDate` و`severity` و`code` مشتقّاتٌ لا تُعرَض: الشاشةُ تكتب المهلةَ
      // من `deliveryDate + creditDays`، وتلوّن من إشارة `daysToDue`.
      dueAlerts.push({
        kind: 'due', party: v.party, name: v.partyName,
        officer: p.collectionOfficer, invoiceNumber: v.invoiceNumber, total: v.total,
        deliveryDate: v.deliveryDate, creditDays: p.creditDays, daysToDue: inDays,
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
        // العددُ الكاملُ للصفوف — به تعرف الشاشةُ «وكم غيرها» بعد الاقتطاع.
        limitTotal: limitAlerts.length,
        dueTotal: dueAlerts.length,
      },
      settings: { warnPct, warnDays },
    };
    cache.set(cacheKey, out, TTL);
    res.json(sliceAlerts(out, rows));
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
    const parties = await CollectionsParty.find(await ledgerPartyBase())
      .select('code name collectionOfficer creditLimit paymentType').lean();
    const ageMap = await agingByParty(parties.map((p) => p._id));
    const byOfficer = new Map();
    for (const p of parties) {
      const k = p.collectionOfficer || '';
      if (!byOfficer.has(k)) byOfficer.set(k, { officer: k, accounts: 0, outstanding: 0, overLimit: 0, tax: 0, cash: 0 });
      const e = byOfficer.get(k);
      // الحدُّ يُقاس على ما على العميل كلِّه — ضريبيًّا كان أم نقديًّا.
      const out = ageMap.get(String(p._id))?.outstanding || 0;
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

    // ── ويُجمَع بالرابط لا بالكود المكتوب في الورقة ─────────────────────────
    //
    // `partyCode` نسخةٌ من الكود كما كتبته ورقةُ الفواتير، و`party` هو الرابطُ
    // الذي استقرّ عليه الاستيراد بعد مطابقة الاسم. وهما يفترقان: ورقةُ الأعمار
    // وورقةُ الفواتير تختلفان في كود عشرة عملاء، وثمانيةٌ وثمانون عميلًا عرفتهم
    // الفواتيرُ ولم تعرفهم ورقةُ الأعمار فلا كودَ لهم أصلًا.
    //
    // فكان الجمعُ بالكود يُسقط ٤٣٣ فاتورةً فيها ٢٫٣٩ مليونًا محصَّلةً و٦١٠ آلافٍ
    // مفتوحة — تخرج من حساب كلِّ موظّفٍ وكأنّها لم تكن. والرابطُ يَعرف صاحبَها.
    const partyQ = { kind: 'customer' };
    if (officer) partyQ.collectionOfficer = { $in: Array.isArray(officer) ? officer : [officer] };
    const parties = await CollectionsParty.find(partyQ).select('code collectionOfficer creditDays').lean();
    const officerOf = new Map(parties.map((p) => [String(p._id), p.collectionOfficer || '']));
    const cdOf = new Map(parties.map((p) => [String(p._id), p.creditDays || 0]));
    const ids = parties.map((p) => p._id);
    const today = startOfToday();

    // ── والمجاميعُ تُحسب في القاعدة ─────────────────────────────────────────
    // كانت تسعةُ آلاف فاتورةٍ تُنقَل إلى العقدة لتُجمَع هناك: خمسَ عشرةَ ثانيةً
    // على الإنتاج، تكفي لأن تبدو الصفحةُ معطَّلة. والمجموعُ عملُ القاعدة.
    // والأرقامُ المحجوزةُ في التسلسل ليست عملَ أحد — راجع models/CollectionInvoice.unused.
    const collectedMatch = { party: { $in: ids }, ...CollectionInvoice.COLLECTED };
    if (hasRange) collectedMatch.collectionDate = range;
    const [collected, open] = await Promise.all([
      CollectionInvoice.aggregate([
        { $match: collectedMatch },
        { $addFields: { _base: { $ifNull: ['$deliveryDate', '$invoiceDate'] } } },
        { $group: {
          _id: '$party', n: { $sum: 1 }, amount: { $sum: '$total' },
          // متوسّطُ أيّام التحصيل يُحسب هنا أيضًا: ما لا تاريخَ له يُهمَل ولا
          // يُحسب صفرًا — الصفرُ يجرّ المتوسّطَ إلى أسفلَ بلا سبب.
          days: { $avg: { $cond: [
            { $or: [{ $eq: ['$_base', null] }, { $eq: ['$collectionDate', null] }] }, null,
            { $dateDiff: { startDate: '$_base', endDate: '$collectionDate', unit: 'day' } },
          ] } },
        } },
      ]),
      CollectionInvoice.aggregate([
        { $match: { ...OPEN, party: { $in: ids } } },
        { $group: { _id: '$party', n: { $sum: 1 }, amount: { $sum: '$total' },
          // ولا يُقاس الاستحقاقُ بتاريخ التسليم وحدَه: فاتورةٌ لم تُسلَّم بعدُ لها
          // تاريخُ إصدارٍ على أيّ حال، وإسقاطُها تُخفي دَينًا قائمًا.
          overdue: { $push: { d: { $ifNull: ['$deliveryDate', '$invoiceDate'] }, t: '$total' } } } },
      ]),
    ]);

    const stats = new Map();
    const of = (id) => {
      const k = officerOf.get(String(id)) || '';
      if (!stats.has(k)) stats.set(k, { officer: k, accounts: 0, collectedCount: 0, collectedAmount: 0, openCount: 0, openAmount: 0, overdueCount: 0, overdueAmount: 0, withinTermsAmount: 0, agedOver60Amount: 0, _dayNum: 0, _dayDen: 0 });
      return stats.get(k);
    };
    for (const p of parties) of(p._id).accounts += 1;
    for (const c of collected) {
      const e = of(c._id);
      e.collectedCount += c.n; e.collectedAmount += c.amount;
      if (c.days != null) { e._dayNum += c.days * c.n; e._dayDen += c.n; }
    }
    for (const o of open) {
      const e = of(o._id);
      e.openCount += o.n; e.openAmount += o.amount;
      // ── وصفرُ الأيّام ليس «بلا أجل» ────────────────────────────────────────
      // كان `if (!cd) continue` يُخرج كلَّ حسابٍ أجلُه صفر — أي نقدًا عند
      // التسليم — من حساب المتأخّر. فأشدُّ الشروط صرامةً كان أقلَّها تأخّرًا في
      // الشاشة، وهو مقلوبٌ تمامًا.
      const cd = cdOf.get(String(o._id)) || 0;
      for (const x of o.overdue) {
        if (!x.d) continue;
        const due = new Date(new Date(x.d).getTime() + cd * DAY);
        if (due >= today) { e.withinTermsAmount += x.t; continue; }
        e.overdueCount += 1; e.overdueAmount += x.t;
        // وما جاوز الستّين يومًا بعد أجله دَينٌ يوشك أن يصير خسارة، لا تأخّرًا.
        if (due < new Date(today.getTime() - 60 * DAY)) e.agedOver60Amount += x.t;
      }
    }

    const rows = [...stats.values()].map((e) => {
      const avg = e._dayDen ? Math.round(e._dayNum / e._dayDen) : null;
      delete e._dayNum; delete e._dayDen;
      // ── نسبةُ التحصيل: ما حُصِّل ممّا **حان موعدُه** ──────────────────────
      //
      // كانت `المحصَّل ÷ (المحصَّل + المفتوح)`، وفيها خطآن جعلا الرقمَ يقلب
      // الترتيب رأسًا على عقب:
      //
      //   ① البسطُ تاريخٌ كامل والمقامُ لحظةٌ واحدة. المحصَّلُ يجمع كلَّ ما
      //     حُصِّل منذ ٢٠٢٢ (ما لم تُحدَّد فترة، وهو الوضعُ الافتراضيّ للشاشة)،
      //     والمفتوحُ رصيدُ اليوم. فمن طال عهدُه أو كبرت حساباتُه ارتفعت نسبتُه
      //     من تلقاء نفسها: ٦٣ مليونًا محصَّلةً عبر أربع سنواتٍ مقابل ٤٫٦
      //     ملايينَ قائمةً اليومَ تعطي ٩٣٪ مهما كان حالُ المحفظة.
      //
      //   ② والمقامُ يحسب على الموظّف مالًا **لم يحن موعدُه بعد**. فاتورةٌ
      //     سُلِّمت أمسِ بأجل ستّين يومًا ليست تقصيرًا، وعدُّها تقصيرًا يعاقب من
      //     يفوتر أكثر.
      //
      // فصارت: ما حُصِّل ÷ (ما حُصِّل + ما تأخّر عن أجله). الطرفان ممّا استُحقّ
      // فعلًا، والمالُ الذي في مهلته خارج الحساب لأنّه ليس دَينًا متعثّرًا.
      const due = e.collectedAmount + e.overdueAmount;
      // وسلامةُ المحفظة سؤالٌ آخرُ يُقرأ بجانبه: كم ممّا في يده لم يتأخّر بعد.
      // موظّفٌ يحصّل كثيرًا ومحفظتُه متكلّسةٌ ليس كمن يحصّل أقلَّ ودفترُه نظيف.
      return {
        ...e,
        avgDaysToCollect: avg,
        collectionRate: due > 0 ? (e.collectedAmount / due) * 100 : null,
        withinTermsRate: e.openAmount > 0 ? (e.withinTermsAmount / e.openAmount) * 100 : null,
        agedOver60Rate: e.overdueAmount > 0 ? (e.agedOver60Amount / e.overdueAmount) * 100 : null,
      };
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
      withinTermsAmount: a.withinTermsAmount + r.withinTermsAmount,
      agedOver60Amount: a.agedOver60Amount + r.agedOver60Amount,
      collectedCount: a.collectedCount + r.collectedCount, openCount: a.openCount + r.openCount,
    }), { accounts: 0, collectedAmount: 0, openAmount: 0, overdueAmount: 0, withinTermsAmount: 0, agedOver60Amount: 0, collectedCount: 0, openCount: 0 });

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
    // «حسابٌ مستقلّ» لعميلٍ من التشغيل بلا كود ⇒ يأخذ كودَه الآن بنوع حمولاته،
    // فلا يبقى خارج الأعمار بعد أن قيل إنّه عميلٌ جديد. راجع classifyCodelessParty.
    if (decision === 'separate' && sug.candidate) {
      const cand = await CollectionsParty.findById(sug.candidate).lean();
      if (cand && !cand.code && cand.isActive !== false) {
        const { classifyCodelessParty } = require('../utils/ensureCollectionsParty');
        try { await classifyCodelessParty(cand, { apply: true }); } catch (_) { /* */ }
      }
    }
    exports.invalidate();
    res.json({ ok: true, suggestion: sug });
  } catch (e) {
    console.error('decideLink error:', e);
    res.status(500).json({ message: 'تعذّر حفظُ القرار' });
  }
};

module.exports.BANDS = BANDS;
module.exports._internals = { partyFilter, invoiceFilter, agingByParty, decorate, bandOf, startOfToday, OPEN, receivablesOnly };
// واللوحةُ («cdr:») تقرأ الحساباتِ نفسَها: موظّفٌ يُنقَل أو حدٌّ يُرفَع يغيّرها.
module.exports.invalidate = () => { cache.clear(CACHE_PREFIX); cache.clear('cdr:'); };
