/**
 * كشفُ حسابٍ لفواتير التحصيل — الضريبيّةِ والكاش — بما على الشاشة بالضبط.
 *
 * ── ما كان ناقصًا ──────────────────────────────────────────────────────────
 * كان زرُّ «طباعة PDF» في الصفحتين يطبع جدولَ الصفحة المعروضة وحدَها (مئةَ
 * صفٍّ من آلاف) بلا البطاقات التي فوقه، وبلا ترويسة الشركة، وبلا ذكرٍ لأكثر
 * الفلاتر. فمن فلتر على عميلٍ وأخرج «كشفَ حسابه» خرج بورقةٍ لا تقول كم عليه.
 *
 * ── ولماذا من الخادم ───────────────────────────────────────────────────────
 * الأرقامُ تُقرأ من الدالّتين نفسَيهما اللتين تملآن الشاشة (`cashInvoices` و
 * `taxInvoices`)، مستدعاتين في العمليّة نفسِها بالاستعلام نفسِه. فالبطاقاتُ في
 * الورقة هي بطاقاتُ الشاشة حرفًا برقم — لا حسابٌ ثانٍ يمكن أن يفترق عنها.
 * والورقةُ على ترويسة الشركة عبر محرّك التقارير (reportBuilder).
 *
 * ── وما لا يعرفه الخادم ─────────────────────────────────────────────────────
 * فلاترُ الأعمدة المحسوبة (العمر، القيمة، عدد الكشوف، المسار) تُطبَّق في
 * المتصفّح على الصفحة المعروضة؛ فتُرسَل هنا `lf_<key>` وتُطبَّق على الصفوف
 * كلِّها بالقاعدة نفسِها (`cellText`). والتحديدُ يُرسَل `sel`. وفي الحالين
 * تُحسب البطاقاتُ من الصفوف الباقية ويُقال ذلك في الورقة صراحةً.
 */
const ctrl = require('../controllers/collectionsDeptController');

/** أقصى ما يُطبَع صفوفًا في الكشف — والإجماليّاتُ تبقى للنتيجة كلِّها. */
// ألفا صفٍّ ≈ ستّون صفحة. كان الحدُّ خمسةَ آلاف: كشفٌ من مئةٍ وستٍّ وخمسين
// صفحةً يستغرق نصفَ دقيقةٍ على الخادم، ويُجمّد المتصفّحَ عند الطباعة. والإجماليّاتُ
// تشمل الكلَّ دائمًا، ومن أراد الصفوفَ كلَّها فعنده تصديرُ Excel.
const PRINT_ROW_CAP = 2000;

const TZ = 'Asia/Riyadh';
const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
const money2 = (n) => (Number(n) || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const count = (n) => (Number(n) || 0).toLocaleString('en-US');
const dt = (v) => (v ? new Date(v).toLocaleDateString('en-GB', { timeZone: TZ }) : '');
/** «YYYY-MM-DD» من فلتر الشاشة يُقرأ كما هو — لا يمرّ بـDate فيزيح يومًا. */
const ymd = (s) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(s || ''));
  return m ? `${m[3]}/${m[2]}/${m[1]}` : String(s || '');
};
/** نظيرُ `cellText` في useColumnFilters — النصُّ الذي يُفلتَر عليه. */
const cellText = (v) => (v === null || v === undefined || v === '' ? '' : String(v));
const list = (v) => (v === undefined ? [] : Array.isArray(v) ? v.map(String) : [String(v)]);

// بأرقامٍ غربيّةٍ كبقيّة الورقة — لا «١٥» في سطرٍ و«15» في الذي يليه.
const AGE_LABELS = {
  '0_15': ['حتى 15 يومًا', 'Up to 15 days'],
  '15_30': ['من 15 إلى 30 يومًا', '15 – 30 days'],
  '30_45': ['من 30 إلى 45 يومًا', '30 – 45 days'],
  '45_60': ['من 45 إلى 60 يومًا', '45 – 60 days'],
  '60_plus': ['أكثر من 60 يومًا', 'Over 60 days'],
};
/** الشريحةُ من عدد الأيّام — بحدود `ageCondition` نفسِها: [من، إلى). */
const bandOf = (d) => {
  for (const [k, [from, to]] of Object.entries(ctrl.AGE_BANDS)) {
    if ((from === 0 || d >= from) && (to == null || d < to)) return k;
  }
  return '0_15';
};

/**
 * أعمدةُ الكشف — بأسماء الشاشة وترتيبها (InvoicesPage.tsx · allCols).
 * `cf` اسمُ الحقل في فلتر الأعمدة من الخادم، و`local` عمودٌ يُفلتَر في المتصفّح.
 */
function columnsOf(kind, t) {
  const C = (key, ar, en, extra = {}) => ({ key, header: t(ar, en), ...extra });
  // العناوينُ بلغة العميل لا بلغة القسم: الكشفُ يُرسَل إليه. و`internal`
  // عمودٌ يخصّنا (فرعُنا المسدِّد، مصدرُ المال، حالةُ الدفتر) فلا يُطبَع أبدًا،
  // و`party` يُطوى حين يكون الكشفُ لعميلٍ واحد — اسمُه وكودُه في الترويسة.
  return kind === 'cash'
    ? [
      C('reportNumber', 'رقم الكشف', 'Reference', { cf: 'reportNumber', w: 9 }),
      C('customer', 'العميل', 'Customer', { cf: 'username', w: 17, party: true }),
      C('route', 'المسار', 'Route', { local: true, w: 16 }),
      C('paymentDate', 'التاريخ', 'Date', { cf: 'paymentDate', fmt: dt, w: 9 }),
      C('payingBranch', 'الفرع المسدد', 'Paying branch', { cf: 'payingBranch', w: 8, internal: true }),
      C('ageDays', 'العمر (يوم)', 'Age (days)', { local: true, end: true, w: 6 }),
      C('value', 'القيمة', 'Amount', { local: true, end: true, money: true, w: 10 }),
      C('collectedAmount', 'المبلغ المسدَّد', 'Paid amount', { local: true, end: true, money: true, w: 10 }),
      // والمتبقّي بجانب المسدَّد: الجزئيُّ يُطالَب بباقيه لا بقيمته.
      C('remaining', 'المتبقّي', 'Balance', { local: true, end: true, money: true, w: 10 }),
      C('deliveryDate', 'تاريخ الاستلام', 'Received on', { cf: 'deliveryDate', fmt: dt, w: 9 }),
      C('collectionDetail', 'التفاصيل', 'Detail', { cf: 'collectionDetail', w: 8, internal: true }),
      C('collectionDate', 'تاريخ السداد', 'Paid on', {
        cf: 'collectionDate', w: 10,
        fmt: (v, r) => (v ? dt(v) : r.collectedNoDate ? t('مسدَّد', 'Paid')
          : r.collectionState === 'partial' ? t('مسدَّد جزئيًّا', 'Part-paid') : t('غير مسدَّد', 'Unpaid')),
        color: (r) => (r.collectionDate || r.collectedNoDate ? '#047857' : r.collectionState === 'partial' ? '#b45309' : '#dc2626'),
      }),
    ]
    : [
      C('invoiceNumber', 'رقم الفاتورة', 'Invoice no.', { cf: 'invoiceNumber', w: 10 }),
      C('customer', 'العميل', 'Customer', { cf: 'partyName', w: 22, party: true }),
      C('partyCode', 'كود الحساب', 'Account code', { cf: 'partyCode', w: 9, party: true }),
      C('reports', 'عدد الكشوف', 'Waybills', { local: true, end: true, w: 7 }),
      C('value', 'قيمة الفاتورة', 'Invoice amount', { local: true, end: true, money: true, w: 12 }),
      // المسدَّدُ والمتبقّي — الفاتورةُ الجزئيّة تُطالَب بباقيها.
      C('collectedAmount', 'المسدَّد', 'Paid', { local: true, end: true, money: true, w: 10 }),
      C('remaining', 'المتبقّي', 'Balance', { local: true, end: true, money: true, w: 10 }),
      C('invoiceDate', 'تاريخ الفاتورة', 'Invoice date', { cf: 'invoiceDate', fmt: dt, w: 10 }),
      C('deliveryDate', 'تاريخ الاستلام', 'Received on', { cf: 'deliveryDate', fmt: dt, w: 10 }),
      C('ageDays', 'العمر (يوم)', 'Age (days)', { local: true, end: true, w: 7 }),
      C('collectionDate', 'تاريخ السداد', 'Paid on', {
        cf: 'collectionDate', w: 10,
        fmt: (v, r) => (r.fullyCollected ? (dt(v) || t('مسدَّدة', 'Paid'))
          : r.collectionState === 'partial' ? t('مسدَّدة جزئيًّا', 'Part-paid') : t('غير مسدَّدة', 'Unpaid')),
        color: (r) => (r.fullyCollected ? '#047857' : r.collectionState === 'partial' ? '#b45309' : '#dc2626'),
      }),
      C('status', 'الحالة', 'Status', { cf: 'status', w: 10, internal: true }),
    ];
}

/** يستدعي دالّةَ القائمة كما يستدعيها المتصفّح — ويردّ جسمَ ردّها. */
function callList(handler, query, user) {
  return new Promise((resolve, reject) => {
    const res = {
      statusCode: 200,
      status(c) { this.statusCode = c; return this; },
      json(body) {
        if (this.statusCode === 200) resolve(body);
        else reject(Object.assign(new Error(body?.message || 'list failed'), { status: this.statusCode }));
        return this;
      },
      setHeader() { return this; },
    };
    Promise.resolve(handler({ query, user, allRows: true }, res)).catch(reject);
  });
}

/**
 * يبني مستندَ الكشف (كتلَ محرّك التقارير).
 *
 * @param {'cash'|'tax'} kind
 * @param {object} query  استعلامُ الشاشة كما هو + `lf_<key>` + `sel` + `cols`
 * @returns {{ doc, check }}  `check` أرقامُ البطاقات كما خرجت — للتحقّق.
 */
async function buildInvoiceStatement(kind, query, user, lang = 'ar') {
  const ar = lang !== 'en';
  const t = (a, e) => (ar ? a : e);
  const isCash = kind === 'cash';

  // استعلامُ الشاشة وحدَه يصل إلى الدالّة — لا page/limit ولا ما يخصّ الكشف.
  const screenQuery = {};
  for (const [k, v] of Object.entries(query || {})) {
    if (['page', 'limit', 'sel', 'cols', 'lang', 'format'].includes(k) || k.startsWith('lf_')) continue;
    screenQuery[k] = v;
  }
  const data = await callList(isCash ? ctrl.cashInvoices : ctrl.taxInvoices, screenQuery, user);
  let rows = data.invoices || [];
  const truncatedAtCap = (data.total || 0) > rows.length;

  const allCols = columnsOf(kind, t);

  // ── فلاترُ الأعمدة المحلّيّة والتحديد ─────────────────────────────────────
  const local = [];
  for (const c of allCols.filter((x) => x.local)) {
    const vals = list(query[`lf_${c.key}`]);
    if (vals.length) local.push({ col: c, set: new Set(vals) });
  }
  if (local.length) rows = rows.filter((r) => local.every(({ col, set }) => set.has(cellText(r[col.key]))));
  const sel = list(query.sel).filter(Boolean);
  if (sel.length) {
    const want = new Set(sel);
    rows = rows.filter((r) => want.has(isCash ? String(r._id) : String(r.invoiceNumber)));
  }
  const narrowed = local.length > 0 || sel.length > 0;

  // ── البطاقات ─────────────────────────────────────────────────────────────
  // بلا تضييقٍ محلّيّ: أرقامُ الخادم نفسُها التي على الشاشة. ومع التضييق: تُعدّ
  // من الصفوف الباقية بالتعريفات نفسِها التي في تجميع الخادم.
  const isCollected = (r) => (isCash ? !!(r.collectionDate || r.collectedNoDate) : !!r.fullyCollected);
  const sum = (arr, k) => r2(arr.reduce((s, r) => s + (Number(r[k]) || 0), 0));
  let cards;
  if (!narrowed) {
    const tt = data.totals || {};
    cards = isCash
      ? { count: data.total || 0, value: tt.value, collected: tt.collected, collectedCount: tt.collectedCount, pendingCount: tt.pendingCount }
      : { count: data.total || 0, value: tt.value, collected: tt.collected, fullyCollected: tt.fullyCollected, pending: tt.pending, partial: tt.partial || 0 };
    if (isCash) cards.partial = tt.partialCount || 0;
  } else {
    const done = rows.filter(isCollected).length;
    cards = isCash
      ? { count: rows.length, value: sum(rows, 'value'), collected: sum(rows, 'collectedAmount'), collectedCount: done, pendingCount: rows.length - done }
      : { count: rows.length, value: sum(rows, 'value'), collected: sum(rows, 'collectedAmount'), fullyCollected: done, pending: rows.length - done };
    cards.partial = rows.filter((r) => r.collectionState === 'partial').length;
  }

  // ── الرصيد وأعمارُ المفتوح ───────────────────────────────────────────────
  // ليست على الشاشة بطاقاتٍ، لكنّها ما يُقرأ في كشف الحساب أوّلًا: كم حُصِّل
  // وكم بقي، ومنذ متى. والمفتوحُ = القيمةُ − المحصَّل (لا مجموعٌ ثانٍ مقرَّب)،
  // فيلتقي المجموعان على قيمة البطاقة بالهللة.
  const fullSet = !truncatedAtCap || narrowed;
  const open = rows.filter((r) => !isCollected(r));
  // والمفتوحُ بباقيه: الجزئيّةُ تُطالَب بما لم يُسدَّد منها — لا بقيمتها كلِّها.
  const openValue = sum(open, 'remaining');
  const bands = Object.keys(ctrl.AGE_BANDS).map((k) => ({ k, n: 0, v: 0 }));
  for (const r of open) {
    if (r.ageDays == null) continue;
    const b = bands.find((x) => x.k === bandOf(r.ageDays));
    b.n += 1; b.v += Number(r.remaining) || 0;
  }

  // ── الأعمدةُ المختارة على الشاشة — بلا ما يخصّنا ─────────────────────────
  // العميلُ من الصفوف نفسِها لا من خانة البحث وحدَها: فلترُ عمود «العميل» على
  // عميلٍ واحد كان يُخرج «جميع العملاء» في الترويسة وعمودَ العميل في الجدول.
  // والمسافاتُ تُوحَّد قبل المقارنة: الاسمُ نفسُه محفوظٌ بمسافةٍ مزدوجة أو غيرِ
  // منكسرة (NBSP) في بعض الفواتير، فكان العميلُ الواحدُ يُقرأ عميلَين.
  const partyNames = [...new Set(rows.map((r) => cellText(r.customer).replace(/[\s\u00a0\u200b-\u200f]+/g, ' ').trim()).filter((x) => x && x !== '—'))];
  // والاسمُ كما في السجلّ لا كما كُتب في البحث (قد يُكتب جزءٌ منه). وبحثٌ يطابق
  // أكثرَ من عميل = كشفٌ لعدّة عملاء، فيبقى عمودُ العميل.
  const partyName = partyNames.length === 1 ? partyNames[0] : (!rows.length && query.customer ? String(query.customer) : '');
  const singleParty = !!partyName;
  // «المبلغ المسدَّد» في الكاش لا يُكتب في أغلب الكشوف (يُعرَف السدادُ بتاريخه)؛
  // عمودٌ كلُّه «—» يربك العميلَ أمام «مسدَّد» في الخانة المجاورة — فيُطوى حين يكون صفرًا كلَّه.
  const noPaidAmounts = isCash && !rows.some((r) => Number(r.collectedAmount));
  const printable = allCols.filter((c) => !c.internal && !(singleParty && c.party)
    && !(noPaidAmounts && c.key === 'collectedAmount'));
  const wanted = String(query.cols || '').split(',').map((s) => s.trim()).filter(Boolean);
  let cols = wanted.length ? printable.filter((c) => wanted.includes(c.key)) : printable;
  // رقمُ الفاتورة/الكشف مقفولٌ على الشاشة (لا يُخفى) — فيبقى في الورقة أيضًا.
  if (!cols.includes(allCols[0])) cols = [allCols[0], ...cols];

  const today = dt(new Date());

  // ── الترويسة: لمن الكشف، ومتى، وعن أيّ فترة ──────────────────────────────
  // لا شيءَ من أدوات القسم (حالةُ التحصيل، فلاترُ الأعمدة، النطاق، اسمُ مُصدِره):
  // الكشفُ يُرسَل إلى العميل.
  const codes = [...new Set(rows.map((r) => r.partyCode).filter(Boolean))];
  const head = [
    [t('العميل', 'Customer'), partyName || t('جميع العملاء', 'All customers')],
    ...(singleParty && codes.length === 1 ? [[t('رقم الحساب', 'Account no.'), codes[0]]] : []),
    ...(query.from || query.to ? [[t('فترة الكشف', 'Statement period'),
      `${t('من', 'From')} ${query.from ? ymd(query.from) : '…'} · ${t('إلى', 'to')} ${query.to ? ymd(query.to) : today}`]] : []),
    [t('تاريخ الكشف', 'Statement date'), today],
  ];

  // ── ملخّصُ الحساب: ما يسأل عنه العميل ────────────────────────────────────
  // عددٌ وقيمةٌ (بطاقتا الشاشة نفسُهما)، وما سُدِّد، وما بقي — ومع الباقي عددُ
  // ما لم يُسدَّد (بطاقةُ «لم تُحصَّل بعد» على الشاشة). والمسدَّدُ = القيمة −
  // المستحقّ، فيلتقي المجموعان على قيمة البطاقة بالهللة.
  const pendingCount = isCash ? cards.pendingCount : cards.pending;
  const summary = [
    { label: isCash ? t('عدد الكشوف', 'Items') : t('عدد الفواتير', 'Invoices'), value: count(cards.count) },
    { label: isCash ? t('إجمالي قيمة الكشوف', 'Total billed') : t('إجمالي قيمة الفواتير', 'Total billed'), value: money2(cards.value) },
    ...(fullSet ? [
      { label: t('المسدَّد', 'Paid'), value: money2(r2((cards.value || 0) - openValue)) },
      { label: t('الرصيد المستحقّ', 'Balance due'), value: money2(openValue), accent: true,
        sub: pendingCount
          ? t(`${isCash ? 'كشوف' : 'فواتير'} غير مسدَّدة: ${count(pendingCount)}${cards.partial ? ` (منها ${count(cards.partial)} مسدَّدة جزئيًّا)` : ''}`,
            `${count(pendingCount)} unpaid${cards.partial ? ` (${count(cards.partial)} part-paid)` : ''}`)
          : t('لا مستحقّات', 'Nothing due') },
    ] : []),
  ];

  // ── الجدول ───────────────────────────────────────────────────────────────
  const printed = rows.slice(0, PRINT_ROW_CAP);
  const cellOf = (c, r) => {
    const raw = r[c.key];
    let text;
    // كالشاشة: قيمةُ الفاتورة الضريبيّة تُكتب ولو صفرًا، وخاناتُ الكاش الفارغةُ «—».
    if (c.money) text = raw || !isCash ? money2(raw) : '—';
    else if (c.fmt) text = c.fmt(raw, r) || '—';
    else text = cellText(raw) || '—';
    return c.color ? { t: text, color: c.color(r) } : text;
  };
  const foot = cols.map((c, i) => {
    // مع النتيجة كلِّها: مجموعُ العمود هو رقمُ البطاقة نفسُه (تجميعُ الخادم)،
    // لا مجموعُ قيمٍ مقرَّبةٍ صفًّا صفًّا قد يفترق عنه بهللة.
    if (c.money) {
      if (fullSet && c.key === 'value') return money2(cards.value);
      if (fullSet && c.key === 'collectedAmount' && isCash) return money2(cards.collected);
      if (fullSet && c.key === 'remaining') return money2(openValue);
      return money2(sum(rows, c.key));
    }
    if (i === 0) return t(`الإجمالي (${count(fullSet ? cards.count : rows.length)})`, `Total (${count(fullSet ? cards.count : rows.length)})`);
    return '';
  });
  const totalW = cols.reduce((s, c) => s + c.w, 0);

  const blocks = [
    { kind: 'section', text: t('بيانات الكشف', 'Statement details') },
    { kind: 'kv', items: head, isolate: true },
    { kind: 'section', text: t('ملخّص الحساب', 'Account summary') },
    { kind: 'stats', items: summary },
  ];

  if (open.length) {
    blocks.push(
      { kind: 'section', text: t('المستحقّات حسب العمر', 'Amounts due by age') },
      {
        kind: 'table',
        head: [t('عمر المستحقّ', 'Age'), isCash ? t('عدد الكشوف', 'Items') : t('عدد الفواتير', 'Invoices'), t('المبلغ المستحقّ', 'Amount due')],
        align: ['start', 'end', 'end'],
        widths: ['50%', '20%', '30%'],
        rows: bands.filter((b) => b.n).map((b) => [t(...AGE_LABELS[b.k]), count(b.n), money2(r2(b.v))]),
        foot: [t('الإجمالي', 'Total'), count(bands.reduce((s, b) => s + b.n, 0)), money2(r2(bands.reduce((s, b) => s + b.v, 0)))],
      },
    );
  }

  blocks.push(
    { kind: 'section', text: t('تفاصيل الفواتير', 'Invoice details') },
    {
      kind: 'table',
      head: cols.map((c) => c.header),
      align: cols.map((c) => (c.end ? 'end' : 'start')),
      widths: cols.map((c) => `${((c.w / totalW) * 100).toFixed(1)}%`),
      rows: printed.map((r) => cols.map((c) => cellOf(c, r))),
      foot,
      small: true,
      isolate: true,
      emptyText: t('لا فواتير في هذا الكشف.', 'No invoices in this statement.'),
    },
  );
  if (rows.length > printed.length) {
    blocks.push({ kind: 'note', text: t(
      `يعرض الجدول أوّل ${count(printed.length)} من ${count(rows.length)} — والإجماليّات تشمل الكلّ. وللقائمة كاملةً استخدم تصدير Excel.`,
      `The table lists the first ${count(printed.length)} of ${count(rows.length)} — totals include all. Use the Excel export for the full list.`) });
  }

  // ── خاتمةٌ للعميل لا توقيعاتُ مراجعةٍ داخليّة ───────────────────────────
  // في كتلةٍ واحدةٍ مع خانة الختم، فلا تنفصلان على صفحتين.
  blocks.push({
    kind: 'signatures',
    lead: [
      t('في حال وجود أيّ ملاحظةٍ على هذا الكشف يُرجى التواصل مع إدارة التحصيل على الرقم 920031911 خلال 14 يومًا من تاريخه، وإلّا عُدَّ الكشف صحيحًا ومعتمدًا.',
        'Should you have any query on this statement, please contact our Collections team on 920031911 within 14 days of its date; otherwise it will be deemed correct.'),
      t('شاكرين لكم حسن تعاملكم.', 'Thank you for your business.'),
    ].filter(Boolean).join(' '),
    items: [{ name: t('إدارة التحصيل', 'Collections Department'), title: t('الختم والتوقيع', 'Stamp & signature') }],
  });

  const kindLabel = isCash ? t('فواتير كاش', 'Cash invoices') : t('فواتير ضريبية', 'Tax invoices');
  const doc = {
    title: t(`كشف حساب — ${kindLabel}`, `Statement of account — ${kindLabel}`),
    subtitle: partyName || t('جميع العملاء', 'All customers'),
    blocks,
    lang: ar ? 'ar' : 'en',
    footerNote: `${t('إنرجايز للخدمات اللوجستية', 'Energize Logistics')} · ${t('كشف حساب بتاريخ', 'Statement dated')} ${today}`,
  };
  return { doc, check: { cards, narrowed, rows: rows.length, printed: printed.length, openValue, screenTotals: data.totals, screenTotal: data.total } };
}

module.exports = { buildInvoiceStatement, PRINT_ROW_CAP };
