/**
 * hrDepartmentsUnify — قائمةُ الأقسام وملفّاتُ الموظّفين على أقسامها (صاحبُ الشركة، ٢٠٢٦/١٠/١٩).
 *
 *   node src/scripts/hrDepartmentsUnify.js            ← عرضٌ فقط
 *   node src/scripts/hrDepartmentsUnify.js --apply
 *
 *   MD · CEO          ← الإدارة
 *   الكافية           ← الموارد البشرية
 *   ادارة B2C         ← B2C
 *   بدون مشروع        ← بدون قسم
 *   غير مطلوب         ← بدون قسم   (ليس قسمًا — علامةُ خانةٍ كُتبت في خانة القسم)
 *
 * والقائمةُ (`Lookup` hr_department) تصير بذورَ config/lookupTypes بأسمائها، وما
 * سواها يُعلَّم محذوفًا (شاهدة: لا يعيده البذرُ عند الإقلاع). والقسمُ الذي ما زال
 * عليه موظّفٌ بعد التوحيد لا يُحذَف — يُطبَع ليُقرَّر فيه.
 * ولكلّ موظّفٍ نُقل سطرٌ في سجلّه (تبويب «السجلّ») بقسمه القديم.
 */
require('dotenv').config();
const mongoose = require('mongoose');
const Employee = require('../models/Employee');
const Lookup = require('../models/Lookup');
const { byType } = require('../config/lookupTypes');

const APPLY = process.argv.includes('--apply');
const MOVES = {
  MD: 'الإدارة', CEO: 'الإدارة',
  'الكافية': 'الموارد البشرية', 'الكافيه': 'الموارد البشرية',
  'ادارة B2C': 'B2C', 'إدارة B2C': 'B2C',
  'بدون مشروع': 'بدون قسم', 'غير مطلوب': 'بدون قسم',
};

(async () => {
  await mongoose.connect(process.env.MONGODB_URI || process.env.MONGO_URI);
  const seed = byType('hr_department').seed;

  // ── ١. الموظّفون ───────────────────────────────────────────────────────────
  const rows = await Employee.find({ department: { $in: Object.keys(MOVES) } }).select('employeeNumber arabicName firstName lastName department').lean();
  const tally = {};
  for (const e of rows) { const k = `«${e.department}» ← «${MOVES[e.department]}»`; tally[k] = (tally[k] || 0) + 1; }
  console.log(`موظّفون يُنقَلون: ${rows.length}`);
  for (const [k, n] of Object.entries(tally)) console.log(`  ${String(n).padStart(4)}  ${k}`);

  // ── ٢. القائمة ─────────────────────────────────────────────────────────────
  const existing = await Lookup.find({ type: 'hr_department' }).lean();
  const byKey = new Map(existing.map((r) => [r.key, r]));
  const plan = [];
  seed.forEach((s, i) => {
    const r = byKey.get(s.key);
    if (!r) plan.push({ op: 'create', s, i });
    else if (r.nameAr !== s.nameAr || r.nameEn !== s.nameEn || r.deleted || !r.isActive || r.order !== i) plan.push({ op: 'set', r, s, i });
  });
  const keep = new Set(seed.map((s) => s.key));
  const drop = existing.filter((r) => !keep.has(r.key) && !r.deleted);
  console.log(`\nالقائمة: ${seed.map((s) => s.nameAr).join(' · ')}`);
  for (const p of plan) console.log(`  ${p.op === 'create' ? '+' : '~'} ${p.op === 'create' ? '' : `«${p.r.nameAr}» → `}«${p.s.nameAr}»`);
  console.log(`  تُحذف: ${drop.map((r) => r.nameAr).join(' · ') || '—'}`);

  // ما سيبقى عليه موظّفون وليس في القائمة.
  const names = new Set(seed.map((s) => s.nameAr));
  const after = await Employee.aggregate([
    { $match: { isHrRecord: { $ne: false }, department: { $nin: [null, ''] } } },
    { $group: { _id: '$department', n: { $sum: 1 } } },
  ]);
  const orphans = after.filter((x) => !names.has(MOVES[x._id] || x._id));
  if (orphans.length) console.log(`\n⚠ أقسامٌ في الملفّات وليست في القائمة: ${orphans.map((o) => `«${o._id}» ${o.n}`).join(' · ')}`);

  if (!APPLY) { console.log('\n(عرضٌ فقط — أضِف --apply للتنفيذ)'); process.exit(0); }

  const audits = rows.map((e) => ({
    bySystem: true, userName: 'النظام', action: 'hr_department_unified', entity: 'Employee', entityId: e._id,
    changes: { details: `توحيد الأقسام: «${e.department}» ← «${MOVES[e.department]}»`, before: { department: e.department }, after: { department: MOVES[e.department] } },
    createdAt: new Date(),
  }));
  for (const [from, to] of Object.entries(MOVES)) await Employee.updateMany({ department: from }, { $set: { department: to } });
  if (audits.length) await mongoose.connection.db.collection('auditlogs').insertMany(audits);

  for (const p of plan) {
    if (p.op === 'create') await Lookup.create({ type: 'hr_department', key: p.s.key, nameEn: p.s.nameEn, nameAr: p.s.nameAr, order: p.i, isActive: true, isSystem: true });
    else await Lookup.updateOne({ _id: p.r._id }, { $set: { nameAr: p.s.nameAr, nameEn: p.s.nameEn, order: p.i, isActive: true, deleted: false } });
  }
  if (drop.length) await Lookup.updateMany({ _id: { $in: drop.map((r) => r._id) } }, { $set: { deleted: true, isActive: false } });
  console.log(`\nApplied: ${rows.length} موظّف · ${plan.length} صفّ قائمة · ${drop.length} حُذف`);
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
