/**
 * ربطُ حسابات تطبيق التوصيل (`B2CRep`) غيرِ المربوطة بأصحابها في سجلّ النقل الخفيف،
 * ومزامنةُ الاسم العربيّ والجوال للمربوط منها.
 *
 * ── لماذا ─────────────────────────────────────────────────────────────────
 * قاعدةُ صاحب الشركة: «سجلٌّ واحدٌ للشخص». والحسابُ المربوطُ يُعرَض باسم صاحبه
 * وتُجمَع طلباتُه له؛ وغيرُ المربوط اسمٌ كتبه الشيتُ يومًا، ويُعَدّ «مندوبًا نشطًا»
 * وصاحبُه قد ترك العمل.
 *
 * ── ما يفعله ───────────────────────────────────────────────────────────────
 *   ١. يطابق كلَّ حسابٍ بلا صفٍّ بمفاتيح utils/b2cRepLink (هويّة · جوال · اسمٌ
 *      مطويٌّ تامّ لا يلتبس). ولا مطابقةَ تقريبيّة: ربطُ حسابٍ بغير صاحبه أسوأُ
 *      من تركه «غير مرتبط».
 *   ٢. يكتب الاسمَ العربيّ والجوالَ للمربوط من سجلّه (`syncRepOf` بالقاعدة نفسِها).
 *   ٣. ما لم يُربط يبقى «غير مرتبط» (فلترٌ في إعدادات القسم ← حسابات التطبيق)،
 *      ويُطبَع **اقتراحُ** إيقافٍ لمن لا طلبَ له منذ ستّين يومًا. لا يُوقَف شيء.
 *
 * الاستعمال:
 *   node src/scripts/linkB2cRepsToLt.js                 # معاينة (الافتراضيّ)
 *   node src/scripts/linkB2cRepsToLt.js --apply         # كتابة
 *   node src/scripts/linkB2cRepsToLt.js --csv=/path.csv # قائمةُ غير المرتبط للمراجعة
 *
 * تشغيلُه مرّتين لا يفعل شيئًا في الثانية.
 */
require('dotenv').config();
const fs = require('fs');
const mongoose = require('mongoose');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const APPLY = process.argv.includes('--apply');
const CSV = (process.argv.find((a) => a.startsWith('--csv=')) || '').slice(6);
const S = (v) => String(v == null ? '' : v).trim();

(async () => {
  await mongoose.connect(process.env.MONGODB_URI);
  const B2CRep = require(`${ROOT}/models/B2CRep`);
  const B2CDailyOrder = require(`${ROOT}/models/B2CDailyOrder`);
  const RL = require(`${ROOT}/utils/b2cRepLink`);

  const reps = await B2CRep.find({}).select('repId englishName arabicName phone ltEmployee isActive').lean();
  const index = await RL.buildIndex();
  const orphans = reps.filter((r) => !r.ltEmployee);
  console.log(`الحسابات=${reps.length} · نشطة=${reps.filter((r) => r.isActive !== false).length} · مربوطة=${reps.length - orphans.length} · غير مربوطة=${orphans.length}`);
  console.log(`سجلُّ النقل الخفيف (نشط)=${index.lts.size}`);

  // ١. الربط
  const links = []; const ambiguous = []; const none = [];
  for (const r of orphans) {
    const m = RL.matchRep(r, index);
    if (m && m.lt) links.push({ rep: r, lt: m.lt, via: m.via });
    else if (m && m.ambiguous) ambiguous.push({ rep: r, n: m.ambiguous, via: m.via });
    else none.push(r);
  }
  const byVia = links.reduce((a, l) => ({ ...a, [l.via]: (a[l.via] || 0) + 1 }), {});
  const ltTargets = new Set(links.map((l) => l.lt));
  const alreadyClaimed = new Set(reps.filter((r) => r.ltEmployee).map((r) => String(r.ltEmployee)));
  console.log(`\nربطٌ جديد=${links.length} (${Object.entries(byVia).map(([k, v]) => `${k}=${v}`).join(' · ') || '—'}) على ${ltTargets.size} صفًّا`);
  console.log(`  منها على صفٍّ له حسابٌ مربوطٌ سلفًا (حسابٌ ثانٍ للرجل نفسِه)=${links.filter((l) => alreadyClaimed.has(l.lt)).length}`);
  console.log(`ملتبس (اسمٌ يدلّ على أكثر من رجل)=${ambiguous.length}`);
  ambiguous.slice(0, 15).forEach((a) => console.log(`  ${S(a.rep.englishName)} / ${S(a.rep.arabicName)} — ${a.n} صفوف`));
  console.log(`لا صاحبَ له في السجلّ=${none.length}`);
  links.slice(0, 10).forEach((l) => console.log(`  [${l.via}] ${S(l.rep.englishName).padEnd(28)} / ${S(l.rep.arabicName).padEnd(24)} ← ${S(index.lts.get(l.lt)?.name)}`));

  // ٢. مزامنةُ الاسم والجوال للمربوط (بعد الربط الجديد)
  const ltById = index.lts;
  const linkedAfter = [
    ...reps.filter((r) => r.ltEmployee).map((r) => ({ rep: r, lt: String(r.ltEmployee) })),
    ...links.map((l) => ({ rep: l.rep, lt: l.lt })),
  ];
  const syncs = [];
  for (const { rep, lt } of linkedAfter) {
    const row = ltById.get(lt);
    if (!row) continue; // صفٌّ موقوف — لا يُكتب منه
    const set = {};
    if (S(row.name) && S(row.name) !== S(rep.arabicName)) set.arabicName = S(row.name);
    if (S(row.phone) && S(row.phone) !== S(rep.phone)) set.phone = S(row.phone);
    if (Object.keys(set).length) syncs.push({ id: rep._id, set });
  }
  console.log(`\nمزامنةُ الاسم/الجوال من السجلّ: ${syncs.length} حسابًا (اسم=${syncs.filter((s) => s.set.arabicName).length} · جوال=${syncs.filter((s) => s.set.phone).length})`);

  // ٣. غيرُ المرتبط واقتراحُ الإيقاف
  const unlinked = [...ambiguous.map((a) => a.rep), ...none];
  const act = await B2CDailyOrder.aggregate([
    { $match: { rep: { $in: unlinked.map((r) => r._id) }, orders: { $gt: 0 } } },
    { $group: { _id: '$rep', last: { $max: '$dateKey' }, days: { $sum: 1 } } },
  ]);
  const actBy = new Map(act.map((a) => [String(a._id), a]));
  const cutoff = new Date(Date.now() - 60 * 86400000).toISOString().slice(0, 10);
  const propose = unlinked.filter((r) => r.isActive !== false && (!actBy.get(String(r._id)) || actBy.get(String(r._id)).last < cutoff));
  const recent = unlinked.filter((r) => actBy.get(String(r._id))?.last >= cutoff);
  console.log(`\nيبقى غيرَ مرتبط=${unlinked.length}`);
  console.log(`  عمل في آخر ستّين يومًا (يحتاج ربطًا بيد)=${recent.length}`);
  console.log(`  مقترحٌ إيقافُه (لا طلبَ منذ ${cutoff})=${propose.length} — بلا طلبٍ أبدًا=${propose.filter((r) => !actBy.get(String(r._id))).length}`);
  if (CSV) {
    const esc = (v) => `"${S(v).replace(/"/g, '""')}"`;
    const lines = ['id,repId,englishName,arabicName,lastOrder,orderDays,proposeDeactivate'];
    for (const r of unlinked) {
      const a = actBy.get(String(r._id));
      lines.push([r._id, r.repId, r.englishName, r.arabicName, a?.last || '', a?.days || 0, propose.includes(r) ? 'yes' : ''].map(esc).join(','));
    }
    fs.writeFileSync(CSV, `﻿${lines.join('\n')}\n`);
    console.log(`  كُتبت القائمة: ${CSV}`);
  }

  if (!APPLY) { console.log('\n(معاينةٌ فقط — أضِف --apply)'); await mongoose.disconnect(); return; }

  // نسخةُ ما قبل الكتابة: الاسمُ العربيُّ الذي كتبه الشيتُ يُستبدَل باسم صاحبه،
  // فيُحفَظ ما كان — للرجوع إليه إن ظهر ربطٌ خاطئ.
  const touched = new Set([...links.map((l) => String(l.rep._id)), ...syncs.map((s) => String(s.id))]);
  const backup = path.join(require('os').tmpdir(), `b2c-rep-link-backup-${Date.now()}.json`);
  fs.writeFileSync(backup, JSON.stringify(reps.filter((r) => touched.has(String(r._id)))
    .map((r) => ({ _id: r._id, ltEmployee: r.ltEmployee || null, arabicName: r.arabicName || '', phone: r.phone || '' })), null, 1));
  console.log(`نسخةُ ما قبل الكتابة: ${backup}`);

  const ops = [
    ...links.map((l) => ({ updateOne: { filter: { _id: l.rep._id, ltEmployee: null }, update: { $set: { ltEmployee: l.lt } } } })),
    ...syncs.map((s) => ({ updateOne: { filter: { _id: s.id }, update: { $set: s.set } } })),
  ];
  if (ops.length) await B2CRep.bulkWrite(ops, { ordered: false });
  try { require(`${ROOT}/utils/ttlCache`).clear('b2c:'); } catch (_) { /* */ }
  const total = await B2CRep.countDocuments({ ltEmployee: { $ne: null } });
  console.log(`\nكُتب: ربط=${links.length} · مزامنة=${syncs.length} · المربوطُ الآن=${total}`);
  await mongoose.disconnect();
})().catch((e) => { console.error('ERR', e.message); process.exit(1); });
