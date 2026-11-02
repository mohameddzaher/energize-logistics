/**
 * rederiveAmountOnlyTax: statements that became 'tax' with only an amount and no invoice number are returned to their base rule. Usage: node src/scripts/rederiveAmountOnlyTax.js [--apply] [--list] (dry run by default; --list adds statement numbers). Why: 'has a tax
 * invoice' used to be inferred from invoice number, computed tax, or net. The cash path itself writes net (the payment amount is copied to it), so every cash statement with a payment amount flipped to 'tax' on first sync. The rule is now that tax requires an invoice
 * number (fixed in utils/paymentType); this re-derives what the old rule flipped. Selects rows that: - are type tax with a derived source (`auto` or empty); manual and unified choices are untouched. - have no real invoice number. - have net or tax (the only thing
 * that made them tax). - derive to a non-tax type under the new rule (customer attribute, platform payment method for new ones). Amounts are not touched (net, tax, total stay). No invoice-ledger entry is affected because none has an invoice number.
 */
require('dotenv').config({ quiet: true });
const mongoose = require('mongoose');

const APPLY = process.argv.includes('--apply');
const LIST = process.argv.includes('--list');

(async () => {
  await mongoose.connect(process.env.MONGODB_URI || process.env.MONGO_URI);
  const OperationsWorkflow = require('../models/OperationsWorkflow');
  const CollectionsParty = require('../models/CollectionsParty');
  const { derivePaymentTypeFor, ISSUED_INVOICE_QUERY, underNewRule, methodIsCash } = require('../utils/paymentType');

  const parties = await CollectionsParty.find({ kind: 'customer' }).select('name nameKey paymentType').lean();
  const card = new Map();
  for (const p of parties) {
    const k = p.nameKey || CollectionsParty.fold(p.name || '');
    if (k && !card.has(k)) card.set(k, p.paymentType || '');
  }

  const rows = await OperationsWorkflow.find({
    paymentType: 'tax',
    paymentTypeSource: { $nin: ['manual', 'unified'] },
    $nor: [ISSUED_INVOICE_QUERY],
    $or: [{ netInvoice: { $gt: 0 } }, { tax: { $gt: 0 } }],
  }).select('reportNumber username reportDate paymentMethod paymentType paymentTypeSource invoiceNumber netInvoice tax totalInvoice paymentAmount').lean();

  const moves = {}; const why = {}; const ops = []; const sample = [];
  let stays = 0;
  for (const w of rows) {
    const cardType = card.get(CollectionsParty.fold(w.username || '')) || '';
    const next = derivePaymentTypeFor(w, cardType);
    if (!next || next === 'tax') {
      stays += 1;
      const k = !next ? 'لا صفةَ لعميله ولا تقول المنصّةُ «cash» — يبقى ضريبيًّا' : 'يبقى ضريبيًّا بصفة عميله';
      why[k] = (why[k] || 0) + 1;
      continue;
    }
    const k = `tax → ${next}`;
    moves[k] = (moves[k] || 0) + 1;
    const reason = underNewRule(w) && methodIsCash(w.paymentMethod) ? 'المنصّةُ تقول cash (كشفٌ من سبتمبر فما بعد)' : `صفةُ العميل «${cardType}»`;
    why[reason] = (why[reason] || 0) + 1;
    if (sample.length < 15) sample.push(`${w.reportNumber} · ${w.username} · صافي ${w.netInvoice || 0} ضريبة ${w.tax || 0} مبلغ سداد ${w.paymentAmount || 0} · ${reason}`);
    ops.push({ updateOne: { filter: { _id: w._id, paymentType: 'tax', paymentTypeSource: w.paymentTypeSource ?? { $exists: false } },
      update: { $set: { paymentType: next, paymentTypeSource: 'auto' } } } });
    if (LIST) console.log(`  ${w.reportNumber}  ${w.username}  → ${next}`);
  }

  console.log(`كشوفٌ «ضريبي» بلا رقم فاتورةٍ وعليها مبلغ (مصدرُها مشتقّ): ${rows.length}`);
  console.log(`  تُعاد إلى قاعدتها: ${ops.length}`, moves);
  console.log(`  تبقى «ضريبي»: ${stays}`);
  console.log('  الأسباب:', why);
  if (sample.length) console.log(`\nأمثلة:\n  ${sample.join('\n  ')}`);

  if (APPLY && ops.length) {
    let changed = 0;
    for (let i = 0; i < ops.length; i += 500) {
      const r = await OperationsWorkflow.bulkWrite(ops.slice(i, i + 500), { ordered: false });
      changed += r.modifiedCount || 0;
    }
    console.log(`\n✓ كُتب ${changed} كشفًا. أعد تحميل الخادم أو انتظر انتهاء ذاكرة wf:/colledger: (٢٠–٦٠ ثانية).`);
  } else if (!APPLY) {
    console.log('\n(عرضٌ فقط — أضف --apply للكتابة)');
  }
  await mongoose.disconnect();
})().catch((e) => { console.error(e); process.exit(1); });
