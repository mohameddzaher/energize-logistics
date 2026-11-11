/**
 * Customer invoice for a clearance transaction: derived, not stored, so it cannot go stale after a line edit.
 * Two parts go to finance: the expenses paid through payment stages, passed on at cost and without VAT (one line per item, repeated payments of an item summed),
 * and the lines typed in the invoicing request (`saleItems`), which carry VAT. Total = expenses + items x (1 + VAT).
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
  // Expenses: money stages not rejected or sent back, grouped by item.
  const { costFieldOf } = require('../models/CustomsClearance');
  const byKey = new Map();
  for (const p of clearance?.paymentStages || []) {
    if (!p || !costFieldOf(p.key) || ['rejected', 'returned'].includes(p.payStatus)) continue;
    const a = Number(p.amount);
    if (!Number.isFinite(a) || a === 0) continue;
    const k = String(p.key);
    if (!byKey.has(k)) byKey.set(k, { from: 'stage', key: k, label: p.label || k, amount: 0, taxable: false, vat: 0, total: 0, count: 0, notes: [], pending: 0 });
    const g = byKey.get(k);
    g.amount = round2(g.amount + a); g.total = g.amount; g.count += 1;
    if (p.note) g.notes.push(String(p.note));
    if (p.payStatus !== 'paid') g.pending = round2(g.pending + a);
  }
  for (const g of byKey.values()) lines.push({ ...g, note: g.notes.join(' · '), fileUrl: '', fileName: '' });
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
  const saleLines = lines.filter((l) => l.from === 'sale');
  const stageLines = lines.filter((l) => l.from === 'stage');
  const saleNet = round2(saleLines.reduce((a, l) => a + l.amount, 0));
  const vat = round2(saleNet * vatRate);
  const billed = { count: saleLines.length, net: saleNet, vat, total: round2(saleNet + vat) };
  const expNet = round2(stageLines.reduce((a, l) => a + l.amount, 0));
  const passThrough = { count: stageLines.length, net: expNet, vat: 0, total: expNet };
  const net = round2(saleNet + expNet);
  return {
    invoiceNumber: clearance?.saleInvoiceNumber || '',
    invoiceAt: clearance?.saleInvoiceAt || null,
    vatRate,
    lines,
    billed,
    // Expenses passed on at cost, no VAT.
    passThrough,
    totals: { net, vat, grand: round2(net + vat), expenses: expNet, items: saleNet },
    warnings: [],
  };
};

/**
 * Transaction money in analytics and department finance.
 * Cost = cost lines (paid stages summed into them) + stage requests not yet paid (rejected/returned excluded). Revenue = customer invoice total (`buildClearanceInvoice`), none until invoiced. Profit = revenue - its tax - cost, invoiced only.
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
  // Paid stages are already summed into their cost lines (applyPaidCosts), so cost = every cost line + requests not yet paid; typed lines without a stage (demurrage, yard) still count.
  const unpaid = stages.filter((p) => p.payStatus !== 'paid' && p.payStatus !== 'returned' && require('../models/CustomsClearance').costFieldOf(p.key));
  const cost = round2(num(c?.costs?.total) + unpaid.reduce((a, p) => a + Number(p.amount), 0));
  // Not invoiced: its cost stands and its revenue has not come, so no profit or loss is computed yet.
  if (!billed) return { legacy: false, cost, revenue: 0, vat: 0, profit: 0, pending: true };
  const inv = buildClearanceInvoice(c);
  return { legacy: false, cost, revenue: inv.totals.grand, vat: inv.totals.vat, profit: round2(inv.totals.grand - inv.totals.vat - cost) };
};
/** `moneyOf` fields other than `costs` and `revenue`; the caller selects those two whole (their sub-paths collide in `select`). */
const MONEY_SELECT = 'paymentStages.key paymentStages.label paymentStages.amount paymentStages.payStatus '
  + 'saleItems.key saleItems.label saleItems.amount saleInvoiceNumber saleVatRate';

module.exports = { buildClearanceInvoice, round2, moneyOf, MONEY_SELECT };
