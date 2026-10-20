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
const PRINT_ROW_CAP = 5000;

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

const AGE_LABELS = {
  '0_15': ['حتى ١٥ يومًا', 'Up to 15 days'],
  '15_30': ['من ١٥ إلى ٣٠', '15 – 30 days'],
  '30_45': ['من ٣٠ إلى ٤٥', '30 – 45 days'],
  '45_60': ['من ٤٥ إلى ٦٠', '45 – 60 days'],
  '60_plus': ['أكثر من ٦٠', 'Over 60 days'],
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
  return kind === 'cash'
    ? [
      C('reportNumber', 'رقم كشف التخريج', 'Report no.', { cf: 'reportNumber', w: 9 }),
      C('customer', 'العميل', 'Customer', { cf: 'username', w: 17 }),
      C('route', 'المسار', 'Route', { local: true, w: 14 }),
      C('paymentDate', 'تاريخ السداد', 'Paid on', { cf: 'paymentDate', fmt: dt, w: 8 }),
      C('payingBranch', 'الفرع المسدد', 'Paying branch', { cf: 'payingBranch', w: 8 }),
      C('ageDays', 'العمر (يوم)', 'Age (days)', { local: true, end: true, w: 5 }),
      C('value', 'قيمة الكشف', 'Value', { local: true, end: true, money: true, w: 9 }),
      C('collectedAmount', 'مبلغ التحصيل', 'Collected', { local: true, end: true, money: true, w: 9 }),
      C('deliveryDate', 'التسليم للعميل', 'To customer', { cf: 'deliveryDate', fmt: dt, w: 8 }),
      C('collectionDetail', 'التفاصيل', 'Detail', { cf: 'collectionDetail', w: 8 }),
      C('collectionDate', 'تاريخ التحصيل', 'Collected on', {
        cf: 'collectionDate', w: 9,
        fmt: (v, r) => (v ? dt(v) : r.collectedNoDate ? t('محصَّل — بلا تاريخ', 'Collected — no date') : t('لم يُحصَّل', 'open')),
        color: (r) => (r.collectionDate || r.collectedNoDate ? '#047857' : '#dc2626'),
      }),
    ]
    : [
      C('invoiceNumber', 'رقم الفاتورة', 'Invoice no.', { cf: 'invoiceNumber', w: 9 }),
      C('customer', 'العميل', 'Customer', { cf: 'partyName', w: 22 }),
      C('partyCode', 'كود الحساب', 'Account code', { cf: 'partyCode', w: 9 }),
      C('reports', 'عدد الكشوفات', 'Reports', { local: true, end: true, w: 6 }),
      C('value', 'القيمة', 'Value', { local: true, end: true, money: true, w: 11 }),
      C('invoiceDate', 'تاريخ الفاتورة', 'Invoice date', { cf: 'invoiceDate', fmt: dt, w: 9 }),
      C('deliveryDate', 'التسليم للعميل', 'To customer', { cf: 'deliveryDate', fmt: dt, w: 9 }),
      C('ageDays', 'العمر (يوم)', 'Age (days)', { local: true, end: true, w: 6 }),
      C('collectionDate', 'تاريخ التحصيل', 'Collected on', {
        cf: 'collectionDate', w: 9,
        fmt: (v, r) => (r.fullyCollected ? dt(v) : t('لم تُحصَّل', 'open')),
        color: (r) => (r.fullyCollected ? '#047857' : '#dc2626'),
      }),
      C('status', 'الحالة', 'Status', { cf: 'status', w: 10 }),
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
      : { count: data.total || 0, value: tt.value, fullyCollected: tt.fullyCollected, pending: tt.pending };
  } else {
    const done = rows.filter(isCollected).length;
    cards = isCash
      ? { count: rows.length, value: sum(rows, 'value'), collected: sum(rows, 'collectedAmount'), collectedCount: done, pendingCount: rows.length - done }
      : { count: rows.length, value: sum(rows, 'value'), fullyCollected: done, pending: rows.length - done };
  }

  // ── الرصيد وأعمارُ المفتوح ───────────────────────────────────────────────
  // ليست على الشاشة بطاقاتٍ، لكنّها ما يُقرأ في كشف الحساب أوّلًا: كم حُصِّل
  // وكم بقي، ومنذ متى. والمفتوحُ = القيمةُ − المحصَّل (لا مجموعٌ ثانٍ مقرَّب)،
  // فيلتقي المجموعان على قيمة البطاقة بالهللة.
  const fullSet = !truncatedAtCap || narrowed;
  const open = rows.filter((r) => !isCollected(r));
  const openValue = sum(open, 'value');
  const bands = Object.keys(ctrl.AGE_BANDS).map((k) => ({ k, n: 0, v: 0 }));
  for (const r of open) {
    if (r.ageDays == null) continue;
    const b = bands.find((x) => x.k === bandOf(r.ageDays));
    b.n += 1; b.v += Number(r.value) || 0;
  }

  // ── الأعمدةُ المختارة على الشاشة ─────────────────────────────────────────
  const wanted = String(query.cols || '').split(',').map((s) => s.trim()).filter(Boolean);
  let cols = wanted.length ? allCols.filter((c) => wanted.includes(c.key)) : allCols;
  if (!cols.length) cols = allCols;
  // الأوّلُ مقفولٌ على الشاشة (لا يُخفى) — فيبقى في الورقة أيضًا.
  if (!cols.includes(allCols[0])) cols = [allCols[0], ...cols];

  // ── الفلاترُ مكتوبةً ──────────────────────────────────────────────────────
  const filters = [];
  if (query.customer) filters.push([t('العميل', 'Customer'), String(query.customer)]);
  if (query.branch) filters.push([t('الفرع المسدد', 'Paying branch'), String(query.branch)]);
  if (query.from || query.to) {
    filters.push([
      isCash ? t('مدى تاريخ السداد', 'Payment date range') : t('مدى تاريخ الفاتورة', 'Invoice date range'),
      `${t('من', 'From')} ${query.from ? ymd(query.from) : '…'} · ${t('إلى', 'to')} ${query.to ? ymd(query.to) : '…'}`,
    ]);
  }
  if (query.age && AGE_LABELS[query.age]) filters.push([t('عمر الفاتورة', 'Invoice age'), t(...AGE_LABELS[query.age])]);
  if (isCash && query.detail) filters.push([t('التفاصيل', 'Detail'), String(query.detail)]);
  if (query.q) filters.push([t('البحث', 'Search'), String(query.q)]);
  for (const c of allCols) {
    const vals = c.cf ? list(query[`cf_${c.cf}`]) : [];
    if (!vals.length) continue;
    const shown = vals.map((v) => (v === '' ? t('(فارغ)', '(blank)') : c.fmt && /^\d{4}-\d{2}-\d{2}$/.test(v) ? ymd(v) : v));
    filters.push([`${t('فلتر عمود', 'Column filter')} · ${c.header}`, shown.join(t('، ', ', '))]);
  }
  for (const { col, set } of local) {
    filters.push([`${t('فلتر عمود', 'Column filter')} · ${col.header}`, [...set].map((v) => (v === '' ? t('(فارغ)', '(blank)') : v)).join(t('، ', ', '))]);
  }

  const who = `${user?.firstName || ''} ${user?.lastName || ''}`.trim() || user?.email || '';
  const now = new Date();
  const stamp = now.toLocaleString('en-GB', { timeZone: TZ, dateStyle: 'short', timeStyle: 'short' });

  const status = query.collected === 'yes' ? t('المحصَّل فقط', 'Collected only')
    : query.collected === 'no' ? t('غير المحصَّل فقط', 'Not collected only') : t('الكل', 'All');
  const scope = sel.length
    ? t(`الصفوف المحدَّدة فقط (${count(rows.length)})`, `Selected rows only (${count(rows.length)})`)
    : t('نتيجة الفلتر كاملةً — كل الصفحات', 'The whole filtered result — every page');

  const head = [
    [t('العميل', 'Customer'), query.customer ? String(query.customer) : t('جميع العملاء', 'All customers')],
    [t('حالة التحصيل', 'Collection status'), status],
    ...filters.filter(([k]) => k !== t('العميل', 'Customer')),
    [t('النطاق', 'Scope'), scope],
    [t('تاريخ الإصدار', 'Issued on'), stamp],
    [t('أصدره', 'Issued by'), who || '—'],
  ];

  // ── البطاقات كما على الشاشة ──────────────────────────────────────────────
  const statItems = isCash
    ? [
      { label: t('كشوف', 'Reports'), value: count(cards.count) },
      { label: t('المحصَّل', 'Collected'), value: money2(cards.collected), accent: true },
      { label: t('عدد المحصَّل', 'Collected count'), value: count(cards.collectedCount) },
      { label: t('لم يُحصَّل بعد', 'Outstanding count'), value: count(cards.pendingCount) },
    ]
    : [
      { label: t('فواتير', 'Invoices'), value: count(cards.count) },
      { label: t('قيمة الفواتير', 'Invoiced value'), value: money2(cards.value), accent: true },
      { label: t('محصَّلة بالكامل', 'Fully collected'), value: count(cards.fullyCollected) },
      { label: t('لم تُحصَّل بعد', 'Still open'), value: count(cards.pending) },
    ];

  const balance = fullSet ? [
    { label: isCash ? t('قيمة الكشوف', 'Reports value') : t('قيمة الفواتير', 'Invoiced value'), value: money2(cards.value) },
    { label: t('قيمة المحصَّل', 'Collected value'), value: money2(r2((cards.value || 0) - openValue)) },
    { label: t('الرصيد غير المحصَّل', 'Outstanding balance'), value: money2(openValue), accent: true },
  ] : [];
  if (isCash && fullSet) {
    // في الكاش يكتب المحصِّلُ ما قبضه بيده — وقد يخالف قيمةَ الكشف.
    balance.splice(2, 0, { label: t('المبالغ المقبوضة فعلًا', 'Amounts actually received'), value: money2(cards.collected) });
  }

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
      if (fullSet && c.key === 'collectedAmount') return money2(cards.collected);
      return money2(sum(rows, c.key));
    }
    if (i === 0) return t(`الإجمالي (${count(fullSet ? cards.count : rows.length)})`, `Total (${count(fullSet ? cards.count : rows.length)})`);
    return '';
  });
  const totalW = cols.reduce((s, c) => s + c.w, 0);

  const blocks = [
    { kind: 'section', text: t('بيانات الكشف', 'Statement details') },
    { kind: 'kv', items: head, isolate: true },
    { kind: 'section', text: t('الملخّص', 'Summary') },
    { kind: 'stats', items: statItems },
    ...(balance.length ? [{ kind: 'stats', items: balance }] : []),
    ...(narrowed ? [{ kind: 'note', tone: 'warn', text: t(
      'الأرقام أعلاه محسوبة على الصفوف الظاهرة بعد فلاتر الأعمدة المحلّية أو التحديد، لا على نتيجة الفلتر كلّها.',
      'The figures above are computed on the rows left after the local column filters or the selection, not on the whole filtered result.') }] : []),
    ...(truncatedAtCap && !narrowed ? [{ kind: 'note', tone: 'warn', text: t(
      `النتيجة أكبر من ${count(rows.length)} صف — البطاقات للنتيجة كلّها، والجدول لأول ${count(rows.length)} صف. ضيّق الفلتر لكشفٍ كامل.`,
      `The result exceeds ${count(rows.length)} rows — the cards cover all of it, the table the first ${count(rows.length)}. Narrow the filter for a full statement.`) }] : []),
  ];

  if (open.length) {
    blocks.push(
      { kind: 'section', text: t('أعمار غير المحصَّل', 'Ageing of the outstanding') },
      {
        kind: 'table',
        head: [t('العمر', 'Age'), isCash ? t('عدد الكشوف', 'Reports') : t('عدد الفواتير', 'Invoices'), t('القيمة', 'Value')],
        align: ['start', 'end', 'end'],
        widths: ['50%', '20%', '30%'],
        rows: bands.map((b) => [t(...AGE_LABELS[b.k]), count(b.n), money2(r2(b.v))]),
        foot: [t('الإجمالي', 'Total'), count(bands.reduce((s, b) => s + b.n, 0)), money2(r2(bands.reduce((s, b) => s + b.v, 0)))],
      },
    );
  }

  blocks.push(
    { kind: 'section', text: isCash ? t('تفصيل الكشوف', 'Reports in detail') : t('تفصيل الفواتير', 'Invoices in detail') },
    {
      kind: 'table',
      head: cols.map((c) => c.header),
      align: cols.map((c) => (c.end ? 'end' : 'start')),
      widths: cols.map((c) => `${((c.w / totalW) * 100).toFixed(1)}%`),
      rows: printed.map((r) => cols.map((c) => cellOf(c, r))),
      foot,
      small: true,
      isolate: true,
      emptyText: t('لا صفوف تطابق الفلتر.', 'No rows match the filter.'),
    },
  );
  if (rows.length > printed.length) {
    blocks.push({ kind: 'note', tone: 'warn', text: t(
      `طُبع أوّل ${count(printed.length)} صف من ${count(rows.length)} — والإجماليّات للكلّ. ضيّق الفلتر لطباعة الباقي.`,
      `Printed the first ${count(printed.length)} of ${count(rows.length)} rows — totals cover all. Narrow the filter to print the rest.`) });
  }
  blocks.push({ kind: 'signatures', items: [
    { name: who, title: t('أعدّه', 'Prepared by') },
    { name: '', title: t('راجعه', 'Reviewed by') },
    { name: '', title: t('اعتمده', 'Approved by') },
  ] });

  const kindLabel = isCash ? t('فواتير كاش', 'Cash invoices') : t('فواتير ضريبية', 'Tax invoices');
  const doc = {
    title: t(`كشف حساب — ${kindLabel}`, `Statement of account — ${kindLabel}`),
    subtitle: query.customer ? String(query.customer) : t('جميع العملاء', 'All customers'),
    blocks,
    lang: ar ? 'ar' : 'en',
    footerNote: `${t('إنرجايز للخدمات اللوجستية', 'Energize Logistics')} · ${t('أصدره', 'Issued by')} ${who} · ${stamp}`,
  };
  return { doc, check: { cards, narrowed, rows: rows.length, printed: printed.length, openValue, screenTotals: data.totals, screenTotal: data.total } };
}

module.exports = { buildInvoiceStatement, PRINT_ROW_CAP };
