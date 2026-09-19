/**
 * عملاءُ التشغيل بلا كود — مرّةً واحدةً للرصيد القائم؛ وما يأتي بعدها يمرّ
 * بـ ensureCollectionsParty تلقائيًّا.
 *   تطابقٌ شبهُ تامّ  ⇒ يُدمَج في حسابه القائم
 *   شبيهٌ غيرُ قاطع    ⇒ طابورُ الربط عند مدير التحصيل (ولا كود حتّى يقرّر)
 *   لا شبيه          ⇒ كودٌ جديدٌ بنوع حمولاته
 * تجربةٌ افتراضًا؛ `--apply` للكتابة.
 *
 * والتشابهُ بالكلمات لا يرى الاسمَ نفسَه بحرفين: «D H L» و«دي اتش ال»،
 * «نيشان» و«Nishan». فهذه تُعرَض على المدير بأيدينا لا بالقياس.
 */
require('dotenv').config();
const mongoose = require('mongoose');

const CROSS_SCRIPT = { 'D H L': '11040339', 'نيشان': '11040375', 'كومباشن': '11040436' };

(async () => {
  await mongoose.connect(process.env.MONGODB_URI);
  const apply = process.argv.includes('--apply');
  const P = require('../models/CollectionsParty');
  const PLS = require('../models/PartyLinkSuggestion');
  const { classifyCodelessParty } = require('../utils/ensureCollectionsParty');
  const W = mongoose.connection.collection('operationsworkflows');
  const loadsBy = new Map((await W.aggregate([{ $group: { _id: '$username', n: { $sum: 1 } } }]).toArray()).map((x) => [x._id, x.n]));
  const noCode = await P.find({ kind: 'customer', isActive: { $ne: false }, $or: [{ code: '' }, { code: null }, { code: { $exists: false } }] }).lean();
  const out = { auto: [], review: [], none: [], unknown: [] }; let noLoads = 0;
  for (const p of noCode) {
    const loads = [p.name, ...(p.aliases || [])].reduce((t, n) => t + (loadsBy.get(n) || 0), 0);
    if (!loads) { noLoads++; continue; }
    if (CROSS_SCRIPT[p.name]) {
      const acc = await P.findOne({ code: CROSS_SCRIPT[p.name] }).lean();
      const prior = await PLS.findOne({ code: acc.code, candidate: p._id }).lean();
      if (apply && !prior) {
        await PLS.create({ code: acc.code, accountName: acc.name, kind: acc.paymentType === 'cash' ? 'cash' : 'tax',
          candidate: p._id, candidateName: p.name, score: 0.5, decision: 'pending', party: acc._id });
      }
      out.review.push(`${p.name} (${loads}) → ${acc.code} ${acc.name} [اسمٌ بحرفين]${prior ? ' — للحساب اقتراحٌ سابق' : ''}`);
      continue;
    }
    const r = await classifyCodelessParty(p, { apply });
    out[r.level].push(`${p.name} (${loads})${r.best ? ` → ${r.best.code} ${r.best.name} ${r.score.toFixed(2)}` : ''}${r.code ? ` ⇒ ${r.code}` : r.type ? ` ⇒ ${r.type}` : ''}${r.level === 'review' && !r.queued ? ' — للحساب اقتراحٌ سابق، ينتظر' : ''}`);
  }
  for (const k of Object.keys(out)) { console.log(`\n== ${k} (${out[k].length})`); out[k].forEach((x) => console.log('  ', x)); }
  console.log('\nبلا حمولات (تُترك):', noLoads, '· applied:', apply);
  process.exit(0);
})();
