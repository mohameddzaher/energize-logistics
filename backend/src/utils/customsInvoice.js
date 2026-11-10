/**
 * Customer invoice for a clearance transaction: derived, not stored, so it cannot go stale after a line edit.
 * Total = the lines typed in the invoicing request (`saleItems`, the prices billed to the customer) x (1 + VAT).
 * Payment stages are what we pay out and are not part of the customer invoice (owner, 2026-11-10); they stay the transaction's cost in `moneyOf`.
 */

const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

/**
 * @param {object} clearance `CustomsClearance` document (lean or document)
 * @returns {{lines:Array, billed:object, totals:object, warnings:Array}}
 */
const buildClearanceInvoice = (clearance) => {
  const vatRate = Number(clearance?.saleVatRate ?? 0.15) || 0;
  const sale = (clearance?.saleItems || []).filter((x) => x && (x.key || x.label));
  const lines = [];
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
      fileName: s.fileName || '',
      note: s.note || '',
    });
  }
  const net = round2(lines.reduce((a, l) => a + l.amount, 0));
  const vat = round2(net * vatRate);
  const billed = { count: lines.length, net, vat, total: round2(net + vat) };
  return {
    invoiceNumber: clearance?.saleInvoiceNumber || '',
    invoiceAt: clearance?.saleInvoiceAt || null,
    vatRate,
    lines,
    billed,
    // Kept for readers of the older two-sided shape; nothing passes through any more.
    passThrough: { count: 0, net: 0, vat: 0, total: 0 },
    totals: { net, vat, grand: billed.total },
    warnings: [],
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
