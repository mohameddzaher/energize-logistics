/**
 * Restore accounts wrongly disabled: each keeps its own code and is not merged into another.
 * Name matching (renameOpsCustomersFromSheet) merged every party whose new name matched an existing account. That is right for a party with no code and wrong for an account with a code: one company has a cash account (Cxxxx) and a tax account (1104xxxx), each with its own balance and invoices, so merging hides an account with what it owes.
 * Each coded account is reactivated, renamed to the approved name, and keeps its old name as an alias. What was added to the other account from its alias is removed.
 * Dry run by default; `--apply` writes.
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
    // The account that swallowed it: the one the alias was added to.
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
