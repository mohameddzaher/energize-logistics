/**
 * فاتورةُ العميل لمعاملةِ تخليص — تُشتقّ ولا تُخزَّن.
 *
 * ── القاعدةُ كما قيلت ──────────────────────────────────────────────────────
 *   بنودُ «مراحل السداد» بمبالغها **كما هي** (بلا ضريبة)، إلّا بندًا له سعرُ
 *   بيعٍ عند الإقفال فيُؤخَذ من هناك ولا يُكرَّر هنا،
 *   + بنودُ الإقفال مجموعةً × (١ + الضريبة)
 *   = إجماليُّ الفاتورة.
 *
 * والفرقُ بين القائمتين هو الفرقُ بين ما ندفعه وما نقبضه: فاتورةُ النقل
 * نسدّدها ١٨٠٠ ونفوترها ٢٢٠٠. فلو جُمعت القائمتان كما هما لحُسِب النقلُ مرّتين.
 *
 * ── ولماذا تُحسَب عند القراءة ───────────────────────────────────────────────
 * الإجماليُّ دالّةُ البنود. فلو خُزِّن ثمّ عُدِّل بندٌ أو أُضيف مرحلةُ سدادٍ
 * متأخّرةٌ لصار الرقمُ المخزَّنُ كذبًا لا يُعلن عن نفسه. والحسابُ هنا، ومن
 * يقرأ الفاتورةَ يقرأ ما تقوله بنودُها اليوم.
 *
 * ── وما يُحسَب لا يُخفى ─────────────────────────────────────────────────────
 * كلُّ سطرٍ يقول من أين جاء (`from`: مرحلةُ سدادٍ أم بندُ إقفال) وأخاضعٌ
 * للضريبة أم لا — فمن يراجع الفاتورةَ يرى القاعدةَ مطبَّقةً سطرًا سطرًا، لا
 * رقمًا واحدًا يصدّقه أو يكذّبه.
 */

const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

/**
 * يبني فاتورةَ معاملةٍ من بنودها.
 * @param {object} clearance مستندُ `CustomsClearance` (lean أو وثيقة)
 * @returns {{lines:Array, cost:object, sale:object, totals:object, warnings:Array}}
 */
const buildClearanceInvoice = (clearance) => {
  const vatRate = Number(clearance?.saleVatRate ?? 0.15) || 0;
  const sale = (clearance?.saleItems || []).filter((x) => x && (x.key || x.label));
  const stages = (clearance?.paymentStages || []).filter((x) => x && (x.key || x.label));

  // ── البنودُ الثلاثةُ لا علاقةَ لها بمراحل السداد (صاحبُ الشركة، ٢٠٢٦/١٠/٢٢) ──
  // «حجزُ الموعد» في مراحل السداد ما ندفعه للمورّد، و«حجزُ الموعد» في الفاتورة ما
  // نفوتره للعميل — بندان لا يحلّ أحدُهما محلَّ الآخر. فلا يُستثنى من السداد شيء.
  const overridden = new Set();

  const lines = [];
  const warnings = [];

  // ① بنودُ مراحل السداد — بمبالغها كما هي، بلا ضريبة.
  for (const p of stages) {
    const key = String(p.key || '');
    if (key && overridden.has(key)) continue;          // سعرُه يأتي من بند البيع
    const amount = Number(p.amount);
    if (!Number.isFinite(amount) || amount === 0) {
      // مرحلةٌ بلا مبلغ ليست خطأً (ميلٌ أُرسل، إرجاعٌ تمّ) — لا تدخل الفاتورة
      // ويُقال عددُها كي لا يُظنّ أنّها سقطت.
      warnings.push({ code: 'STAGE_NO_AMOUNT', label: p.label || key });
      continue;
    }
    lines.push({
      from: 'stage',
      key,
      label: p.label || key,
      date: p.date || '',
      amount: round2(amount),
      taxable: false,
      vat: 0,
      total: round2(amount),
      fileUrl: p.fileUrl || '',
      payStatus: p.payStatus || '',
    });
  }

  // ② بنودُ الإقفال — مجموعةً ثمّ تُضاف الضريبة.
  for (const s of sale) {
    const amount = Number(s.amount);
    if (!Number.isFinite(amount)) continue;
    const vat = round2(amount * vatRate);
    lines.push({
      from: 'sale',
      key: String(s.key || ''),
      label: s.label || s.key || '',
      amount: round2(amount),
      taxable: true,
      vat,
      total: round2(amount + vat),
      fileUrl: s.fileUrl || '',
      note: s.note || '',
    });
  }

  const stageLines = lines.filter((l) => l.from === 'stage');
  const saleLines = lines.filter((l) => l.from === 'sale');
  const stageSum = round2(stageLines.reduce((a, l) => a + l.amount, 0));
  const saleNet = round2(saleLines.reduce((a, l) => a + l.amount, 0));
  const saleVat = round2(saleNet * vatRate);

  return {
    invoiceNumber: clearance?.saleInvoiceNumber || '',
    invoiceAt: clearance?.saleInvoiceAt || null,
    vatRate,
    lines,
    // الجانبان مفصولان في الجواب كما هما في القاعدة — فمن يراجع يرى القسمة.
    passThrough: { count: stageLines.length, net: stageSum, vat: 0, total: stageSum },
    billed: { count: saleLines.length, net: saleNet, vat: saleVat, total: round2(saleNet + saleVat) },
    totals: {
      net: round2(stageSum + saleNet),
      vat: saleVat,
      grand: round2(stageSum + saleNet + saleVat),
    },
    warnings,
  };
};

/**
 * ── مالُ المعاملة في التحليلات وماليّات القسم (صاحبُ الشركة، ٢٠٢٦/١٠/٢٢) ─────
 *   التكلفةُ = مجموعُ مبالغ «مراحل السداد» (ما ندفعه) — والمرفوضُ منها ليس تكلفة.
 *   الإيرادُ = إجماليُّ فاتورة العميل (`buildClearanceInvoice`) — ولا إيرادَ لمعاملةٍ
 *             لم تُفوتَر بعد.
 *   الربحُ  = الإيرادُ − ضريبتُه − التكلفة (الضريبةُ للدولة لا لنا)، للمفوتَرة وحدَها.
 * كان الإيرادُ «التكاليف + بنود الهامش القديمة»، وتلك البنودُ لا تُملأ في المعاملات
 * الجديدة، فخرج الإيرادُ مساويًا للتكاليف والربحُ صفرًا دائمًا.
 * والمعاملاتُ المستوردةُ من الماستر (بلا مبالغَ في مراحلها ولا فاتورة) تُقرأ كما
 * كُتبت: `costs.total` و`revenue.totalInvoiced` و`revenue.profit`.
 * يحتاج من المعاملة: paymentStages.key/amount/payStatus، saleItems، saleInvoiceNumber،
 * saleVatRate، costs.total، revenue.totalInvoiced/profit.
 */
const moneyOf = (c) => {
  const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
  const stages = (c?.paymentStages || []).filter((p) => p && p.payStatus !== 'rejected'
    && p.amount !== null && p.amount !== undefined && p.amount !== '' && Number(p.amount) !== 0 && Number.isFinite(Number(p.amount)));
  // مفوترةٌ حين تقول الماليّةُ «تمّت الفوترة» (رقمُ الفاتورة) — طلبُ الفوترة وحدَه ليس إيرادًا.
  const billed = !!c?.saleInvoiceNumber;
  if (!stages.length && !billed) {
    const revenue = num(c?.revenue?.totalInvoiced);
    const cost = num(c?.costs?.total);
    return { legacy: true, cost: round2(cost), revenue: round2(revenue), vat: 0, profit: round2(revenue - cost) };
  }
  const cost = stages.length ? round2(stages.reduce((a, p) => a + Number(p.amount), 0)) : round2(num(c?.costs?.total));
  // لم تُفوتَر: تكلفتُها قائمةٌ وإيرادُها لم يأتِ — فلا ربحَ يُحسب لها ولا خسارة بعد.
  if (!billed) return { legacy: false, cost, revenue: 0, vat: 0, profit: 0, pending: true };
  const inv = buildClearanceInvoice(c);
  return { legacy: false, cost, revenue: inv.totals.grand, vat: inv.totals.vat, profit: round2(inv.totals.grand - inv.totals.vat - cost) };
};
/** حقولُ `moneyOf` سوى `costs` و`revenue` — يختارهما المستدعي كاملتين (ومعهما تتصادم أجزاؤهما في `select`). */
const MONEY_SELECT = 'paymentStages.key paymentStages.label paymentStages.amount paymentStages.payStatus '
  + 'saleItems.key saleItems.label saleItems.amount saleInvoiceNumber saleVatRate';

module.exports = { buildClearanceInvoice, round2, moneyOf, MONEY_SELECT };
