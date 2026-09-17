/**
 * «مبلغ السداد» على الكشف = ما كتبه موظّفُ العهدة في المحفظة.
 *
 * ── لماذا المحفظةُ هي المرجع ─────────────────────────────────────────────────
 * مَن دفع للمورّد هو من يمسك المالَ ساعتَها، ويكتب المبلغَ في عهدة فرعه. فذلك
 * هو ما خرج فعلًا، لا ما يُكتب بعدُ في سير عمل التشغيل.
 *
 * وكانت المحفظةُ تملأ الخانةَ مرّةً واحدةً إن كانت فارغة، ثمّ لا شأنَ لها بها:
 * فعُدِّل مبلغُ العهدة فبقي الكشفُ على القديم، وحُذف القيدُ فبقي على الكشف
 * سدادٌ لم يُدفع، وفتح موظّفُ تشغيلٍ الكشفَ فحفظه والخانةُ فارغة فمسح المبلغ —
 * أربعةٌ وثلاثون كشفًا في سبتمبر وحده بقي عليها تاريخُ السداد وفرعُه ومبلغُه صفر.
 *
 * فصار المبلغُ يتبع المحفظةَ في الاتّجاهين: تُسجَّل مشترياتٌ أو تُعدَّل أو
 * تُحذف فيتبعها الكشف، ولا يُكتب فوقها من سير عمل التشغيل. والكشفُ الذي لا
 * مشترياتِ له في المحفظة (سُدِّد بتحويلٍ مثلًا) يبقى مبلغُه يُكتب بيد.
 */
const { flexSpaceRegex } = require('./plateKey');

const clean = (v) => String(v || '').trim();

/** مجموعُ مشتريات المحفظة لهذا الكشف، أو `null` إن لم تُسجَّل له مشتريات. */
async function walletPurchaseAmount(reportNumber) {
  const rn = clean(reportNumber);
  if (!rn) return null;
  const WalletTransaction = require('../models/WalletTransaction');
  const rows = await WalletTransaction.find({ type: 'purchase', purchaseDeliveryStatementNumber: flexSpaceRegex(rn) })
    .select('amount').lean();
  if (!rows.length) return null;
  return Math.round(rows.reduce((a, r) => a + (Number(r.amount) || 0), 0) * 100) / 100;
}

/** الكشوفُ ذاتُ المشتريات من قائمة أرقام — لقفل الخانة في الجدول دفعةً واحدة. */
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
 * يُطابق مبلغَ السداد على الكشف مع المحفظة ويكتبه إن اختلف.
 * `previousAmount` لقيدٍ حُذف أو نُقل: يُمسح مبلغُه من الكشف إن كان هو المكتوب.
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
  // الكشفُ النقديّ يُفوتَر بما دُفع (راجع deriveCashTotals): فإن كان صافيه
  // وإجماليُّه هما المبلغَ القديم تبعا الجديد، وإلّا فقد كُتبا بيدٍ ويُتركان.
  if (wf.paymentType === 'cash') {
    if (Math.abs((Number(wf.netInvoice) || 0) - current) < 0.01) patch.netInvoice = next;
    if (Math.abs((Number(wf.totalInvoice) || 0) - current) < 0.01) patch.totalInvoice = next;
  }
  await OperationsWorkflow.updateOne({ _id: wf._id }, { $set: patch });
  try { require('../websocket/socketManager').emitToAll('workflow:updated', { _id: wf._id, fromWallet: true }); } catch (_) { /* */ }
  return { _id: wf._id, from: current, to: next };
}

module.exports = { walletPurchaseAmount, walletPaidMap, syncSheetPayment };
