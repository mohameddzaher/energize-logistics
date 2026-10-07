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

  // مفاتيحُ البنود التي لها سعرُ بيع — تُستثنى من جانب التكلفة كي لا تُحسب مرّتين.
  const overridden = new Set(sale.map((x) => String(x.key || '')).filter(Boolean));

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

module.exports = { buildClearanceInvoice, round2 };
