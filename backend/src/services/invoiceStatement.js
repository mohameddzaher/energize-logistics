/**
 * Statement of account for collection invoices (tax and cash), matching the screen exactly.
 * The print button used to print only the displayed page (100 rows of thousands), without the cards above, the company letterhead or most filters, so a statement for one customer did not say how much he owes.
 * Generated on the server: figures come from the same functions that fill the screen (`cashInvoices`, `taxInvoices`), called in-process with the same query, so the sheet's cards equal the screen's with no second computation to drift. The sheet uses the company letterhead via the report engine (reportBuilder).
 * Computed-column filters (age, value, report count, route) are applied in the browser on the displayed page; here `lf_<key>` is sent and applied to all rows by the same rule (`cellText`), and a selection is sent as `sel`. In both cases the cards are computed from the remaining rows and the sheet says so.
 */
const ctrl = require('../controllers/collectionsDeptController');

/** Maximum printed rows in the statement; totals still cover the whole result. */
// 2000 rows is about 60 pages. The limit was 5000: a 156-page statement took half a minute on the server and froze the browser on print. Totals always cover everything; Excel export gives all rows.
const PRINT_ROW_CAP = 2000;

const TZ = 'Asia/Riyadh';
const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
const money2 = (n) => (Number(n) || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const count = (n) => (Number(n) || 0).toLocaleString('en-US');
const dt = (v) => (v ? new Date(v).toLocaleDateString('en-GB', { timeZone: TZ }) : '');
/** "YYYY-MM-DD" from the screen filter is read as is; going through Date would shift a day. */
const ymd = (s) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(s || ''));
  return m ? `${m[3]}/${m[2]}/${m[1]}` : String(s || '');
};
/** Counterpart of `cellText` in useColumnFilters: the text that is filtered on. */
const cellText = (v) => (v === null || v === undefined || v === '' ? '' : String(v));
const list = (v) => (v === undefined ? [] : Array.isArray(v) ? v.map(String) : [String(v)]);

// Western digits like the rest of the sheet, not mixed with Indic digits.
const AGE_LABELS = {
  '0_15': ['حتى 15 يومًا', 'Up to 15 days'],
  '15_30': ['من 15 إلى 30 يومًا', '15 – 30 days'],
  '30_45': ['من 30 إلى 45 يومًا', '30 – 45 days'],
  '45_60': ['من 45 إلى 60 يومًا', '45 – 60 days'],
  '60_plus': ['أكثر من 60 يومًا', 'Over 60 days'],
};
/** Age bucket from days, with the same bounds as `ageCondition`: [from, to). */
const bandOf = (d) => {
  for (const [k, [from, to]] of Object.entries(ctrl.AGE_BANDS)) {
    if ((from === 0 || d >= from) && (to == null || d < to)) return k;
  }
  return '0_15';
};

/** Statement columns, with the screen's names and order (InvoicesPage.tsx allCols). `cf` is the field name in the server column filter; `local` is a column filtered in the browser. */
function columnsOf(kind, t) {
  const C = (key, ar, en, extra = {}) => ({ key, header: t(ar, en), ...extra });
  // Headings are in the customer's language, not the department's, since the statement is sent to him. `internal` columns (paying branch, money source, ledger status) are never printed. `party` is dropped when the statement is for one customer, whose name and code are in the header.
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
      // Remaining beside paid: a partial invoice is claimed for its remainder, not its value.
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
      // Paid and remaining: a partial invoice is claimed for its remainder.
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

/** Calls the list function as the browser does and returns its response body. */
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
 * Builds the statement document (report engine blocks).
 * @param {'cash'|'tax'} kind
 * @param {object} query  screen query as is, plus `lf_<key>`, `sel` and `cols`
 * @returns {{ doc, check }}  `check` holds the card figures as produced, for verification.
 */
async function buildInvoiceStatement(kind, query, user, lang = 'ar') {
  const ar = lang !== 'en';
  const t = (a, e) => (ar ? a : e);
  const isCash = kind === 'cash';

  // Only the screen query reaches the function: no page/limit and nothing statement-specific.
  const screenQuery = {};
  for (const [k, v] of Object.entries(query || {})) {
    if (['page', 'limit', 'sel', 'cols', 'lang', 'format'].includes(k) || k.startsWith('lf_')) continue;
    screenQuery[k] = v;
  }
  const data = await callList(isCash ? ctrl.cashInvoices : ctrl.taxInvoices, screenQuery, user);
  let rows = data.invoices || [];
  const truncatedAtCap = (data.total || 0) > rows.length;

  const allCols = columnsOf(kind, t);

  // Local column filters and selection
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

  // Cards. Without local narrowing, the server figures are the same as on the screen. With narrowing, they are counted from the remaining rows with the same definitions as the server aggregation.
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

  // Balance and open ageing. Not cards on the screen, but what a statement is read for first: how much was collected, how much remains, and since when. Open = value minus collected (not a second rounded sum), so both totals meet at the card value to the halala.
  const fullSet = !truncatedAtCap || narrowed;
  const open = rows.filter((r) => !isCollected(r));
  // Open uses the remainder: a partial invoice is claimed for what was not paid, not its full value.
  const openValue = sum(open, 'remaining');
  const bands = Object.keys(ctrl.AGE_BANDS).map((k) => ({ k, n: 0, v: 0 }));
  for (const r of open) {
    if (r.ageDays == null) continue;
    const b = bands.find((x) => x.k === bandOf(r.ageDays));
    b.n += 1; b.v += Number(r.remaining) || 0;
  }

  // Columns selected on screen, without internal ones. The customer comes from the rows, not only the search box: a customer-column filter on one customer used to print "all customers" in the header and keep the customer column. Whitespace is normalised before comparing, since the same name is stored with double or non-breaking spaces in some invoices, which read as two customers.
  const partyNames = [...new Set(rows.map((r) => cellText(r.customer).replace(/[\s\u00a0\u200b-\u200f]+/g, ' ').trim()).filter((x) => x && x !== '—'))];
  // The name as in the registry, not as typed in search (it may be partial). A search matching more than one customer is a multi-customer statement, so the customer column stays.
  const partyName = partyNames.length === 1 ? partyNames[0] : (!rows.length && query.customer ? String(query.customer) : '');
  const singleParty = !!partyName;
  // Cash "paid amount" is not filled on most statements (payment is known by its date); an all-dash column confuses the customer next to a "paid" cell, so it is dropped when all zero.
  const noPaidAmounts = isCash && !rows.some((r) => Number(r.collectedAmount));
  const printable = allCols.filter((c) => !c.internal && !(singleParty && c.party)
    && !(noPaidAmounts && c.key === 'collectedAmount'));
  const wanted = String(query.cols || '').split(',').map((s) => s.trim()).filter(Boolean);
  let cols = wanted.length ? printable.filter((c) => wanted.includes(c.key)) : printable;
  // Invoice/report number is locked on screen (cannot be hidden), so it stays on the sheet too.
  if (!cols.includes(allCols[0])) cols = [allCols[0], ...cols];

  const today = dt(new Date());

  // Header: whom the statement is for, when, and for which period. None of the department's tools (collection status, column filters, range, issuer name); the statement goes to the customer.
  const codes = [...new Set(rows.map((r) => r.partyCode).filter(Boolean))];
  const head = [
    [t('العميل', 'Customer'), partyName || t('جميع العملاء', 'All customers')],
    ...(singleParty && codes.length === 1 ? [[t('رقم الحساب', 'Account no.'), codes[0]]] : []),
    ...(query.from || query.to ? [[t('فترة الكشف', 'Statement period'),
      `${t('من', 'From')} ${query.from ? ymd(query.from) : '…'} · ${t('إلى', 'to')} ${query.to ? ymd(query.to) : today}`]] : []),
    [t('تاريخ الكشف', 'Statement date'), today],
  ];

  // Account summary: what the customer asks about. Count and value (the same two screen cards), paid, and remaining with the count of unpaid (the "not yet collected" card). Paid = value minus due, so both totals meet at the card value to the halala.
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

  // Table
  const printed = rows.slice(0, PRINT_ROW_CAP);
  const cellOf = (c, r) => {
    const raw = r[c.key];
    let text;
    // As on screen: a tax invoice value is written even if zero, and empty cash cells show a dash.
    if (c.money) text = raw || !isCash ? money2(raw) : '—';
    else if (c.fmt) text = c.fmt(raw, r) || '—';
    else text = cellText(raw) || '—';
    return c.color ? { t: text, color: c.color(r) } : text;
  };
  const foot = cols.map((c, i) => {
    // With the whole result: the column total is the card figure itself (server aggregation), not a sum of per-row rounded values which could differ by a halala.
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

  // Closing for the customer, not internal review signatures. In one block with the stamp box so they do not split across two pages.
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
  // What emailing the statement needs (collectionsMailController): recipient, amount remaining, since when, and the full invoice table with the same columns as the sheet for the attached Excel file.
  const oldestDays = open.reduce((mx, r) => (r.ageDays != null && r.ageDays > mx ? r.ageDays : mx), 0);
  const mail = {
    partyName, codes, kindLabel, openCount: open.length, openValue, oldestDays, today,
    sheet: { head: cols.map((c) => c.header), rows: rows.map((r) => cols.map((c) => cellOf(c, r))) },
  };
  return { doc, check: { cards, narrowed, rows: rows.length, printed: printed.length, openValue, screenTotals: data.totals, screenTotal: data.total }, mail };
}

module.exports = { buildInvoiceStatement, PRINT_ROW_CAP };
