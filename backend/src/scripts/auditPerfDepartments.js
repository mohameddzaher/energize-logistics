/**
 * auditPerfDepartments — أقسامُ الموظّفين كما يقرؤها تقييمُ الأداء، وما يحتاج قرارًا.
 *
 *   node src/scripts/auditPerfDepartments.js            ← تقريرٌ فقط، لا يكتب شيئًا
 *   node src/scripts/auditPerfDepartments.js --apply    ← يوحّد صورَ الكتابة وحدَها
 *
 * ── ما يعرضه ────────────────────────────────────────────────────────────────
 * ١. كلُّ نصٍّ مكتوبٍ في خانة «القسم»، والقسمُ المعتمد الذي يُقرأ به
 *    (config/performanceDepartments)، وصفحةُ القسم التي يُقيَّم منها.
 * ٢. ما ليس في قائمة الأقسام المعتمدة (البيانات المرجعيّة ← الأقسام): يُضاف
 *    إليها، أو يُنقَل موظّفوه إلى قسمٍ منها — وهذا قرارُ الموارد البشريّة.
 * ٣. أقسامٌ لا تملكها صفحةُ قسم: يقيّم موظّفيها مديرُ النظام وحدَه.
 * ٤. من قسمُه في ملفّه غيرُ قسم مديره المباشر: لا يقيّمه مديرُه المباشر بل مديرُ
 *    قسمه. فإمّا القسمُ خطأ أو المديرُ المباشر.
 *
 * ── ما يكتبه `--apply` ──────────────────────────────────────────────────────
 * صورَ الكتابة فقط: نصٌّ يطابق اسمَ قسمٍ معتمدٍ بعد طيّ الهمزات و«ال» وكلمة
 * «إدارة» («تخليص جمركي» ← «التخليص الجمركي») يُكتب بالاسم المعتمد. ولا يدمج
 * قسمين: «B2C» و«ادارة B2C» يُقرآن «النقل الخفيف» في التقييم ويبقيان في الملفّات
 * كما هما — دمجُهما يمحو الفرقَ بين المندوب والإداريّ، وليس لسكربتٍ أن يقرّره.
 */
require('dotenv').config();
const mongoose = require('mongoose');

const APPLY = process.argv.includes('--apply');

(async () => {
  await mongoose.connect(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 60000 });
  const Employee = require('../models/Employee');
  const User = require('../models/User');
  const D = require('../config/performanceDepartments');
  const { canonicalRole, LABELS_AR } = require('../config/roles');
  const { sectionLabel } = require('../config/sections');

  const [index, employees, users] = await Promise.all([
    D.loadIndex(),
    Employee.find({ employmentStatus: { $ne: 'terminated' }, isHrRecord: { $ne: false } })
      .select('arabicName firstName lastName jobTitle department user directManager').lean(),
    User.find({ isActive: { $ne: false } }, { firstName: 1, lastName: 1, role: 1 }).lean(),
  ]);
  const roleOf = new Map(users.map((u) => [String(u._id), canonicalRole(u.role)]));
  const userName = new Map(users.map((u) => [String(u._id), `${u.firstName || ''} ${u.lastName || ''}`.trim()]));
  for (const e of employees) e.dept = D.resolveDepartment(e.department, index);
  const owner = D.sectionOwners(index, employees, roleOf);
  const nameOf = (e) => e.arabicName || `${e.firstName || ''} ${e.lastName || ''}`.trim();

  // ── ١. النصوصُ المكتوبة ─────────────────────────────────────────────────
  const byText = new Map();
  for (const e of employees) {
    const raw = e.department == null ? '' : String(e.department);
    if (!byText.has(raw)) byText.set(raw, { raw, dept: e.dept, count: 0 });
    byText.get(raw).count += 1;
  }
  const texts = [...byText.values()].sort((a, b) => b.count - a.count);
  console.log(`\n١. خانةُ القسم — ${employees.length} موظّفًا على رأس العمل، ${texts.length} نصًّا:`);
  for (const t of texts) {
    const sec = owner.get(t.dept.key);
    console.log(`   ${String(t.count).padStart(4)}  «${t.raw || '(فارغ)'}»  ←  ${t.dept.label}`
      + `${t.dept.known ? '' : '  [ليس في القائمة]'}  ·  ${sec ? `صفحة ${sectionLabel(sec, 'ar')}` : 'لا صفحةَ قسم'}`);
  }

  // ── ٢ و٣ ────────────────────────────────────────────────────────────────
  const unknown = texts.filter((t) => !t.dept.known && !t.dept.none);
  console.log(`\n٢. ليست في قائمة الأقسام المعتمدة (${unknown.length}): ${unknown.map((t) => `«${t.raw}» ${t.count}`).join(' · ') || '—'}`);
  const empty = texts.filter((t) => t.dept.none).reduce((s, t) => s + t.count, 0);
  console.log(`   بدون قسم: ${empty}`);
  const orphan = new Map();
  for (const e of employees) if (!owner.has(e.dept.key)) orphan.set(e.dept.label, (orphan.get(e.dept.label) || 0) + 1);
  console.log(`\n٣. أقسامٌ لا تملكها صفحةُ قسم (يقيّمها مديرُ النظام): ${[...orphan].map(([k, v]) => `${k} ${v}`).join(' · ') || '—'}`);

  // ── ٤. القسمُ يخالف المديرَ المباشر ──────────────────────────────────────
  const conflicts = [];
  for (const e of employees) {
    const bossSection = D.sectionOfManagerRole(roleOf.get(String(e.directManager || '')));
    const mine = owner.get(e.dept.key) || null;
    if (bossSection && bossSection !== mine) conflicts.push({ e, bossSection, mine });
  }
  console.log(`\n٤. قسمُه في ملفّه غيرُ قسم مديره المباشر (${conflicts.length}):`);
  for (const c of conflicts) {
    const boss = String(c.e.directManager);
    console.log(`   ${nameOf(c.e)} — ${c.e.jobTitle || '—'} · القسم «${c.e.dept.label}»`
      + ` (${c.mine ? `صفحة ${sectionLabel(c.mine, 'ar')}` : 'لا صفحة'})`
      + ` · مديرُه المباشر ${userName.get(boss) || boss} (${LABELS_AR[roleOf.get(boss)] || roleOf.get(boss)})`);
  }

  // ── توحيدُ صور الكتابة ──────────────────────────────────────────────────
  const spelling = texts.filter((t) => t.dept.known && t.raw !== t.dept.label
    && D.deptFold(t.raw) === D.deptFold(t.dept.label));
  console.log(`\nصورُ كتابةٍ تُوحَّد (${spelling.length}):`);
  for (const t of spelling) console.log(`   «${t.raw}» ← «${t.dept.label}»  (${t.count})`);

  if (!APPLY) {
    console.log('\nتجربة — لم يُكتب شيء. أعِد التشغيل مع ‎--apply لتوحيد صور الكتابة وحدَها.');
  } else {
    for (const t of spelling) {
      const r = await Employee.updateMany({ department: t.raw }, { $set: { department: t.dept.label } });
      console.log(`   كُتب «${t.dept.label}» على ${r.modifiedCount}`);
    }
  }
  await mongoose.disconnect();
})().catch((e) => { console.error(e); process.exit(1); });
