/**
 * auditRoleStructure — الهيكل الوظيفي: كل قسم له مدير وموظف، وكل واحد فاتح قسمه.
 *
 *   node src/scripts/auditRoleStructure.js
 *
 * بيتأكد من:
 *   ١. كل قسم (عدا مراجعة الأعمال) له دور مدير ودور موظف على الأقل.
 *   ٢. كل دور مدير بينتهي بـ `_manager`، ومفيش دور موظف بينتهي بيها — القاعدة
 *      دي هي اللي businessReview بيعرف بيها مين يقعد مع الإدارة.
 *   ٣. المدير والموظف الاتنين ليهم **صلاحية كاملة** على قسمهم.
 *   ٤. كل دور له اسم عربي وإنجليزي، ومفيش اسم مكرّر بين دورين (اسمين متطابقين
 *      في قائمة اختيار = المستخدم مش هيعرف يفرّق).
 *   ٥. مفيش مستخدم حقيقي على دور مش في القائمة المعتمدة.
 *   ٦. مفيش مفتاح قديم فاضل في قاعدة البيانات.
 *
 * read-only تمامًا.
 */
require('dotenv').config();
const mongoose = require('mongoose');

const G = '\x1b[32m'; const R = '\x1b[31m'; const D = '\x1b[2m'; const O = '\x1b[0m';
let pass = 0; let fail = 0;
const ok = (l, c, x = '') => { console.log(`  ${c ? G + '✓' + O : R + '✗ FAIL' + O}  ${l}${x ? '  ' + D + x + O : ''}`); c ? pass++ : fail++; };

(async () => {
  await mongoose.connect(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 20000 });
  const Roles = require('../config/roles');
  const { SECTION_KEYS, defaultAccess, sectionLabel } = require('../config/sections');
  const { roleLabel } = require('../config/constants');
  const br = require('../config/businessReview');
  const User = require('../models/User');

  const EXEMPT = ['Business Review'];

  console.log('\n── كل قسم له مدير وموظف ──');
  const covered = new Set(Roles.SECTION_ROLES.map((s) => s.section));
  const missing = SECTION_KEYS.filter((k) => !covered.has(k) && !EXEMPT.includes(k));
  ok('كل الأقسام متغطّاة', missing.length === 0, missing.join(', ') || `${covered.size} قسم`);
  ok('«مراجعة الأعمال» مستثناة عن قصد (منتدى مشترك)', !covered.has('Business Review'));

  console.log('\n── قاعدة التسمية ──');
  ok('كل المديرين بينتهوا بـ _manager', Roles.MANAGER_ROLES.every((r) => /_manager$/.test(r)),
    `${Roles.MANAGER_ROLES.length} مدير`);
  const staffLooksManager = Roles.STAFF_ROLES.filter((r) => /_manager$/.test(r));
  ok('مفيش موظف بينتهي بـ _manager', staffLooksManager.length === 0, staffLooksManager.join(', ') || `${Roles.STAFF_ROLES.length} موظف`);

  console.log('\n── الوصول: كل واحد فاتح قسمه بالكامل ──');
  const noAccess = [];
  for (const s of Roles.SECTION_ROLES) {
    for (const role of [s.manager.key, ...s.staff.map((x) => x.key)]) {
      if (defaultAccess(role, s.section) !== 'edit') noAccess.push(`${role} → ${s.section}`);
    }
  }
  ok('المدير والموظف ليهم صلاحية كاملة على قسمهم', noAccess.length === 0, noAccess.join(' · ') || 'كل الأقسام');

  console.log('\n── الأسماء ──');
  const noLabel = Roles.ALL_ROLES.filter((r) => !roleLabel(r, 'ar') || !roleLabel(r, 'en'));
  ok('كل دور له اسم عربي وإنجليزي', noLabel.length === 0, noLabel.join(', ') || `${Roles.ALL_ROLES.length} دور`);
  for (const lang of ['ar', 'en']) {
    const names = Roles.ALL_ROLES.map((r) => roleLabel(r, lang));
    const dupes = [...new Set(names.filter((n, i) => names.indexOf(n) !== i))];
    ok(`مفيش اسمين متطابقين (${lang})`, dupes.length === 0, dupes.join(', ') || '—');
  }
  const vague = Roles.ALL_ROLES.filter((r) => ['operations', 'purchasing', 'administrator'].includes(r));
  ok('مفيش مفاتيح مبهمة زي operations/purchasing', vague.length === 0, vague.join(', ') || '—');

  console.log('\n── قاعدة اجتماعات الإدارة ──');
  const wrongMgr = Roles.STAFF_ROLES.filter((r) => br.isManagerRole(r) && !['it_specialist', 'administration_staff'].includes(r));
  ok('مفيش موظف بيتحسب مدير بالغلط', wrongMgr.length === 0, wrongMgr.join(', ') || '—');
  ok('كل مديري الأقسام معدودين', Roles.MANAGER_ROLES.every((r) => br.isManagerRole(r)));
  ok('it_specialist مدير لأنه صلاحية نظام كاملة (مقصود)', br.isManagerRole('it_specialist'));
  ok('administration_staff هو السكرتارية (مقصود)', br.isSecretary({ role: 'administration_staff' }));

  console.log('\n── قاعدة البيانات ──');
  const valid = new Set(User.schema.path('role').enumValues);
  const used = await User.distinct('role');
  const unknown = used.filter((r) => !valid.has(r));
  ok('كل أدوار المستخدمين معتمدة', unknown.length === 0, unknown.join(', ') || `${used.length} دور مستخدم فعلاً`);
  const stale = Object.keys(Roles.RENAMED);
  const left = [];
  for (const s of stale) if (await User.countDocuments({ role: s })) left.push(s);
  ok('مفيش مفاتيح قديمة فاضلة', left.length === 0, left.join(', ') || '—');

  // ── الجدول ─────────────────────────────────────────────────────────────────
  console.log(`\n${'─'.repeat(104)}`);
  console.log(`${'القسم'.padEnd(24)}${'المدير'.padEnd(30)}الموظف`);
  console.log('─'.repeat(104));
  const counts = Object.fromEntries((await User.aggregate([{ $group: { _id: '$role', n: { $sum: 1 } } }])).map((c) => [c._id, c.n]));
  const n = (r) => (counts[r] ? `${D}(${counts[r]})${O}` : '');
  for (const s of Roles.SECTION_ROLES) {
    console.log(
      `${sectionLabel(s.section).padEnd(24)}${(roleLabel(s.manager.key) + ' ' + n(s.manager.key)).padEnd(38)}` +
      s.staff.map((x) => roleLabel(x.key) + ' ' + n(x.key)).join('، ')
    );
  }
  console.log('─'.repeat(104));
  console.log(`${D}أدوار عامة: ${Roles.GLOBAL_ROLES.map((g) => roleLabel(g.key) + ' ' + n(g.key)).join(' · ')}${O}`);

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('FATAL', e); process.exit(1); });
