/**
 * Customer invoice for a clearance transaction: derived, not stored.
 * Total = payment-stage items at their amounts (no tax; an item with a closing sale price takes it from there) + closing items summed x (1 + tax). The lists differ because they are what we pay versus what we bill, so adding both would count transport twice.
 * Computed on read because a stored total would silently go stale after an item edit.
 * Each line states its source (`from`) and whether it is taxable.
 */

const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

/**
 * Builds a transaction invoice from its items.
 * @param {object} clearance `CustomsClearance` document (lean or document)
 * @returns {{lines:Array, cost:object, sale:object, totals:object, warnings:Array}}
 */
const buildClearanceInvoice = (clearance) => {
  const vatRate = Number(clearance?.saleVatRate ?? 0.15) || 0;
  const sale = (clearance?.saleItems || []).filter((x) => x && (x.key || x.label));
  const stages = (clearance?.paymentStages || []).filter((x) => x && (x.key || x.label));

  // The three items are unrelated to the payment stages. A stage such as appointment booking is what we pay the supplier, while the invoice item with the same name is what we bill the customer; neither replaces the other, so nothing is excluded from payment.
  const overridden = new Set();

  const lines = [];
  const warnings = [];

  // 1. Payment-stage items: at their amounts as they are, no tax.
  for (const p of stages) {
    const key = String(p.key || '');
    if (key && overridden.has(key)) continue;          // Its price comes from the sale item
    const amount = Number(p.amount);
    if (!Number.isFinite(amount) || amount === 0) {
      // A stage with no amount is not an error (a mile sent, a return done): it is left out of the invoice and counted so nobody assumes it was dropped.
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

  // 2. Closing items: summed together, then tax is added.
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
    // The two sides are separate in the response as in the rule, so a reviewer sees the split.
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
 * Transaction money in analytics and department finance.
 * Cost = sum of payment-stage amounts (rejected excluded). Revenue = customer invoice total (`buildClearanceInvoice`), none until invoiced. Profit = revenue - its tax - cost, invoiced only.
 * Transactions imported from master are read as written: `costs.total`, `revenue.totalInvoiced`, `revenue.profit`.
 * Needs: paymentStages.key/amount/payStatus, saleItems, saleInvoiceNumber, saleVatRate, costs.total, revenue.
 */
const moneyOf = (c) => {
  const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
  const stages = (c?.paymentStages || []).filter((p) => p && p.payStatus !== 'rejected'
    && p.amount !== null && p.amount !== undefined && p.amount !== '' && Number(p.amount) !== 0 && Number.isFinite(Number(p.amount)));
  // Invoiced when finance says it was invoiced (invoice number); an invoicing request alone is not revenue.
  const billed = !!c?.saleInvoiceNumber;
  if (!stages.length && !billed) {
    const revenue = num(c?.revenue?.totalInvoiced);
    const cost = num(c?.costs?.total);
    return { legacy: true, cost: round2(cost), revenue: round2(revenue), vat: 0, profit: round2(revenue - cost) };
  }
  const cost = stages.length ? round2(stages.reduce((a, p) => a + Number(p.amount), 0)) : round2(num(c?.costs?.total));
  // Not invoiced: its cost stands and its revenue has not come, so no profit or loss is computed yet.
  if (!billed) return { legacy: false, cost, revenue: 0, vat: 0, profit: 0, pending: true };
  const inv = buildClearanceInvoice(c);
  return { legacy: false, cost, revenue: inv.totals.grand, vat: inv.totals.vat, profit: round2(inv.totals.grand - inv.totals.vat - cost) };
};
/** `moneyOf` fields other than `costs` and `revenue`; the caller selects those two whole (their sub-paths collide in `select`). */
const MONEY_SELECT = 'paymentStages.key paymentStages.label paymentStages.amount paymentStages.payStatus '
  + 'saleItems.key saleItems.label saleItems.amount saleInvoiceNumber saleVatRate';

module.exports = { buildClearanceInvoice, round2, moneyOf, MONEY_SELECT };
