/**
 * The payment amount on a statement mirrors what the custody clerk recorded in the wallet.
 * The wallet is the source because the payer holds the money and records what actually left; it follows purchases on create, edit and delete.
 * A statement with no wallet purchases (paid by transfer) keeps a hand-entered amount.
 */
const { flexSpaceRegex } = require('./plateKey');

const clean = (v) => String(v || '').trim();

/** Sum of wallet purchases for this statement, or null when none are recorded. */
async function walletPurchaseAmount(reportNumber) {
  const rn = clean(reportNumber);
  if (!rn) return null;
  const WalletTransaction = require('../models/WalletTransaction');
  const rows = await WalletTransaction.find({ type: 'purchase', purchaseDeliveryStatementNumber: flexSpaceRegex(rn) })
    .select('amount').lean();
  if (!rows.length) return null;
  return Math.round(rows.reduce((a, r) => a + (Number(r.amount) || 0), 0) * 100) / 100;
}

/** Statements that have wallet purchases, from a list of numbers; used to lock the field in the table in one call. */
async function walletPaidMap(reportNumbers) {
  const nums = [...new Set((reportNumbers || []).map(clean).filter(Boolean))];
  if (!nums.length) return new Map();
  const WalletTransaction = require('../models/WalletTransaction');
  const rows = await WalletTransaction.find({ type: 'purchase', purchaseDeliveryStatementNumber: { $in: nums } })
    .select('amount purchaseDeliveryStatementNumber').lean();
  const m = new Map();
  for (const r of rows) {
    const k = clean(r.purchaseDeliveryStatementNumber);
    m.set(k, Math.round(((m.get(k) || 0) + (Number(r.amount) || 0)) * 100) / 100);
  }
  return m;
}

/**
 * Who recorded the purchase in the wallet.
 * The workflow data owner was read only from paymentDateByName, which covers a tiny share of rows; the wallet holds the payer's name, so read it from there.
 */
async function walletRecorderMap(reportNumbers) {
  const nums = [...new Set((reportNumbers || []).map(clean).filter(Boolean))];
  if (!nums.length) return new Map();
  const WalletTransaction = require('../models/WalletTransaction');
  const rows = await WalletTransaction.find({ type: 'purchase', purchaseDeliveryStatementNumber: { $in: nums } })
    .populate('user', 'firstName lastName username')
    .select('purchaseDeliveryStatementNumber user date').lean();
  const m = new Map();
  for (const r of rows) {
    const k = clean(r.purchaseDeliveryStatementNumber);
    if (!k || m.has(k)) continue;
    const u = r.user;
    const name = u ? `${u.firstName || ''} ${u.lastName || ''}`.trim() || u.username || '' : '';
    if (name) m.set(k, name);
  }
  return m;
}

/**
 * Syncs the payment amount on the statement with the wallet and writes it if different.
 * `previousAmount` is for an entry that was deleted or moved: its amount is cleared from the statement if that is what was written.
 */
async function syncSheetPayment(reportNumber, { previousAmount = null } = {}) {
  const rn = clean(reportNumber);
  if (!rn) return null;
  const OperationsWorkflow = require('../models/OperationsWorkflow');
  const wf = await OperationsWorkflow.findOne({ reportNumber: flexSpaceRegex(rn) })
    .select('paymentAmount paymentType netInvoice totalInvoice').lean();
  if (!wf) return null;
  const amount = await walletPurchaseAmount(rn);
  const current = Number(wf.paymentAmount) || 0;
  let next;
  if (amount != null) next = amount;
  else if (previousAmount != null && Math.abs(current - Number(previousAmount)) < 0.01) next = 0;
  else return null;
  if (Math.abs(current - next) < 0.01) return null;

  const patch = { paymentAmount: next };
  // A cash statement is invoiced at what was paid (see deriveCashTotals): if net and gross equal the old amount they follow the new one, otherwise they were hand-written and are left alone.
  if (wf.paymentType === 'cash') {
    if (Math.abs((Number(wf.netInvoice) || 0) - current) < 0.01) patch.netInvoice = next;
    if (Math.abs((Number(wf.totalInvoice) || 0) - current) < 0.01) patch.totalInvoice = next;
  }
  await OperationsWorkflow.updateOne({ _id: wf._id }, { $set: patch });
  try { require('../websocket/socketManager').emitToAll('workflow:updated', { _id: wf._id, fromWallet: true }); } catch (_) { /* */ }
  return { _id: wf._id, from: current, to: next };
}

module.exports = {
  walletRecorderMap, walletPurchaseAmount, walletPaidMap, syncSheetPayment };
