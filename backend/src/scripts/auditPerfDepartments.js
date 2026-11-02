/**
 * Employee departments as the performance rating reads them. No flag: report only. --apply: unifies spellings only, rewriting text that matches an approved department after folding hamza, the article and the word for department.
 * Reports unapproved texts, departments with no page and employees whose department differs from their manager's.
 * It never merges two departments (B2C vs B2C administration): that is an HR decision.
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

  // 1. Written texts
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

  // 2 and 3
  const unknown = texts.filter((t) => !t.dept.known && !t.dept.none);
  console.log(`\n٢. ليست في قائمة الأقسام المعتمدة (${unknown.length}): ${unknown.map((t) => `«${t.raw}» ${t.count}`).join(' · ') || '—'}`);
  const empty = texts.filter((t) => t.dept.none).reduce((s, t) => s + t.count, 0);
  console.log(`   بدون قسم: ${empty}`);
  const orphan = new Map();
  for (const e of employees) if (!owner.has(e.dept.key)) orphan.set(e.dept.label, (orphan.get(e.dept.label) || 0) + 1);
  console.log(`\n٣. أقسامٌ لا تملكها صفحةُ قسم (يقيّمها مديرُ النظام): ${[...orphan].map(([k, v]) => `${k} ${v}`).join(' · ') || '—'}`);

  // 4. Department differs from direct manager
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

  // Unify spellings
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
