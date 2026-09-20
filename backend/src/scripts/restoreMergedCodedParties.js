/**
 * ردُّ الحسابات المعطَّلة خطأً — لكلٍّ كودُه فلا يُدمَج في غيره.
 *
 * مطابقةُ الأسماء (renameOpsCustomersFromSheet) دمجت كلَّ طرفٍ اتّفق اسمُه
 * الجديد مع حسابٍ قائم. وذلك صحيحٌ لطرفٍ بلا كود، وخطأٌ لحسابٍ له كودُه:
 * الشركةُ الواحدة تحمل حسابًا نقديًّا (Cxxxx) وآخرَ ضريبيًّا (1104xxxx)، لكلٍّ
 * رصيدُه وفواتيرُه — فالدمجُ يُخفي حسابًا بما عليه.
 *
 * فيُعاد كلُّ حسابٍ له كود: يُفعَّل، ويُصحَّح اسمُه إلى الاسم المعتمَد، ويبقى
 * اسمُه القديم صيغةً له. ويُنزَع من الحساب الآخر ما أُضيف إليه من صيغته.
 * تجربةٌ افتراضًا؛ `--apply` للكتابة.
 */
require('dotenv').config({ quiet: true });
const mongoose = require('mongoose');

const MARK = /بعد تعديل الاسم في منصّة التشغيل/;

(async () => {
  const apply = process.argv.includes('--apply');
  await mongoose.connect(process.env.MONGODB_URI);
  const P = require('../models/CollectionsParty');
  const { fold } = P;
  const merged = await P.find({ notes: MARK, isActive: false }).lean();
  const coded = merged.filter((p) => String(p.code || '').trim());
  console.log(`عُطِّلت بالدمج: ${merged.length} · منها بكودٍ خاصّ يُعاد: ${coded.length}`);

  let fixed = 0;
  for (const p of coded) {
    // الحسابُ الذي ابتلعه: هو الذي أُضيفت إليه صيغةُ اسمه.
    const target = await P.findOne({ kind: 'customer', isActive: { $ne: false }, aliasKeys: fold(p.name) }).lean();
    const to = target ? target.name : p.name;
    console.log(`  ${p.code} «${p.name}» ← يُفعَّل${target ? ` ويُسمّى «${to}» (كان مدموجًا في ${target.code || '—'})` : ''}`);
    if (!apply) continue;
    if (target) {
      await P.updateOne({ _id: target._id }, { $pull: { aliases: p.name, aliasKeys: fold(p.name) } });
    }
    await P.updateOne({ _id: p._id }, {
      $set: { isActive: true, notes: '', name: to, nameKey: fold(to) },
      $addToSet: { aliases: p.name, aliasKeys: fold(p.name) },
    });
    fixed += 1;
  }
  console.log(apply ? `\n✓ أُعيد ${fixed} حسابًا` : '\n— تجربةٌ فقط —');
  process.exit(0);
})();
