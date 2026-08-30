/* eslint-disable no-console */
/**
 * مراجعةُ كلّ دورٍ في النظام: ماذا يفتح، وماذا يُمنع منه، وما الذي ينقصه.
 *
 *   node src/scripts/auditRoleAccess.js            # جدولٌ مختصر
 *   node src/scripts/auditRoleAccess.js --full     # تفصيلُ كلّ دور
 *
 * ── ما الذي يُفحَص ─────────────────────────────────────────────────────────
 *   ١. قسمُه: كلُّ دورٍ يملك قسمَه `edit`. دورٌ لا يملك قسمًا خطأٌ في التعريف.
 *   ٢. الأقسامُ الأخرى: ما فُتح له، وهل فُتح بقصدٍ أم بقاعدةٍ عامّة نسيت أحدًا.
 *   ٣. الخدمةُ الذاتيّة: كلُّ دورٍ داخليّ له ملفُّه وإجازاتُه وطلباتُه وإعداداتُه.
 *   ٤. التقارير: ما يستطيع طباعتَه — ولا يطبع أحدٌ تقريرَ قسمٍ لا يملكه.
 *   ٥. الشذوذ: قسمٌ بلا أدوار، دورٌ بلا قسم، صلاحيّةٌ محفوظةٌ لدورٍ لم يعد موجودًا.
 */
require('dotenv').config({ path: require('path').join(__dirname, '../../.env') });
const mongoose = require('mongoose');
const R = require('../config/roles');
const { SECTION_KEYS, defaultAccess, sectionLabel } = require('../config/sections');
const { FULL_ACCESS_ROLES } = require('../config/constants');
const { getOverride } = require('../utils/permissions');
const { SUBJECT_SECTIONS } = require('../controllers/reportController');
const { subjectMeta } = require('../services/reportSources');

const FULL = process.argv.includes('--full');
// `--fix` يعالج ما يُعالَج بأمان: أن يُمنح المديرُ ما مُنحه موظّفوه.
const FIX = process.argv.includes('--fix');
const EXTERNAL = ['client'];

const accessFor = async (role, key) => {
  if (FULL_ACCESS_ROLES.includes(role)) return 'edit';
  const o = await getOverride(role, key);
  return o == null ? defaultAccess(role, key) : o;
};

(async () => {
  await mongoose.connect(process.env.MONGODB_URI);
  console.log('\n' + '='.repeat(78));
  console.log('  مراجعةُ صلاحيّات الأدوار — كلُّ دورٍ على حدة');
  console.log('='.repeat(78));

  const problems = [];
  const fixed = [];
  const rows = [];

  for (const def of R.ALL_ROLE_DEFS) {
    const role = def.key;
    const own = R.sectionOfRole(role);
    const acc = {};
    for (const key of SECTION_KEYS) {
      // eslint-disable-next-line no-await-in-loop
      acc[key] = await accessFor(role, key);
    }
    const edit = SECTION_KEYS.filter((k) => acc[k] === 'edit');
    const view = SECTION_KEYS.filter((k) => acc[k] === 'view');
    const none = SECTION_KEYS.filter((k) => acc[k] === 'none');

    // التقارير
    // eslint-disable-next-line no-await-in-loop
    const subjects = [];
    for (const s of subjectMeta()) {
      const sections = SUBJECT_SECTIONS[s.key];
      if (!sections) { subjects.push(s.key); continue; }
      if (FULL_ACCESS_ROLES.includes(role)) { subjects.push(s.key); continue; }
      if (sections.some((k) => acc[k] === 'view' || acc[k] === 'edit')) subjects.push(s.key);
    }

    // ── الفحوصات ──────────────────────────────────────────────────────────
    const isGlobal = R.GLOBAL_ROLES.some((g) => g.key === role);
    const external = EXTERNAL.includes(role);

    if (!isGlobal && !own) problems.push(`«${def.ar}» (${role}) لا قسمَ له في التعريف`);
    if (own && acc[own] !== 'edit') problems.push(`«${def.ar}» لا يملك قسمَه «${sectionLabel(own)}» — وصولُه ${acc[own]}`);
    if (!external && !isGlobal && edit.length === 0) problems.push(`«${def.ar}» لا يفتح أيَّ قسم`);
    // موظّفٌ يفتح كلَّ شيء: قاعدةٌ عامّةٌ نسيت أن تستثنيه.
    if (!isGlobal && !FULL_ACCESS_ROLES.includes(role) && edit.length === SECTION_KEYS.length) {
      problems.push(`«${def.ar}» يفتح كلَّ الأقسام (${edit.length}) — قاعدةٌ عامّةٌ لم تستثنِه`);
    }
    // تقريرٌ يخصّ قسمًا لا يملكه
    for (const sub of subjects) {
      const sections = SUBJECT_SECTIONS[sub];
      if (!sections || FULL_ACCESS_ROLES.includes(role)) continue;
      if (!sections.some((k) => acc[k] !== 'none')) problems.push(`«${def.ar}» يطبع تقريرَ «${sub}» بلا قسمِه`);
    }

    rows.push({ role, ar: def.ar, own, edit, view, none, subjects, isGlobal, external });
  }

  // ── الموظّفُ لا يفتح أكثرَ من مديره ────────────────────────────────────────
  // القوائمُ المكتوبةُ باليد في `defaultRoles` كُتبت قسمًا قسمًا على مدى شهور،
  // فدخلها الموظّفُ حيث نُسي مديرُه. والنتيجةُ مقلوبة: مديرٌ ماليٌّ يفتح ثلاثة
  // أقسامٍ ومحاسبُه ستّة. ليست ثغرةً أمنيّةً بقدر ما هي علامةُ قائمةٍ شاخت،
  // ولا تُكتشف إلّا بمقارنةٍ كهذه.
  for (const sec of R.SECTION_ROLES) {
    const mgr = rows.find((r) => r.role === sec.manager.key);
    for (const st of sec.staff) {
      const stf = rows.find((r) => r.role === st.key);
      if (!mgr || !stf) continue;
      const extra = stf.edit.filter((k) => !mgr.edit.includes(k) && !mgr.view.includes(k));
      if (extra.length) {
        problems.push(`«${stf.ar}» يفتح ما لا يفتحه مديرُه «${mgr.ar}»: ${extra.map(sectionLabel).join('، ')}`);
        if (FIX) {
          // يُرفع المديرُ إلى مستوى موظّفه، ولا يُنزَل الموظّف: سحبُ وصولٍ
          // يعمل به أحدٌ اليومَ يكسر عملَه، ومنحُ المديرِ ما يراه فريقُه لا يكسر
          // شيئًا. والمصفوفةُ تبقى بيد مدير النظام يضيّق بعدها كيف شاء.
          // eslint-disable-next-line no-await-in-loop
          const RolePermission = require('../models/RolePermission');
          // eslint-disable-next-line no-await-in-loop
          const doc = await RolePermission.findOne({ role: mgr.role }) || new RolePermission({ role: mgr.role, sections: {} });
          for (const k of extra) doc.sections.set(k, 'edit');
          // ويُثبَّت ما كان يملكه أصلًا بالافتراض، وإلّا صار الصفُّ المحفوظ
          // هو كلَّ ما يملك — فيخسر بحفظِه ما كان يأخذه بلا حفظ.
          for (const k of mgr.edit) if (!doc.sections.get(k)) doc.sections.set(k, 'edit');
          for (const k of mgr.view) if (!doc.sections.get(k)) doc.sections.set(k, 'view');
          // eslint-disable-next-line no-await-in-loop
          await doc.save();
          fixed.push(`«${mgr.ar}» ← ${extra.map(sectionLabel).join('، ')}`);
        }
      }
    }
  }

  // ── جدولٌ مختصر ──────────────────────────────────────────────────────────
  console.log(`\n${'الدور'.padEnd(30)} ${'قسمه'.padEnd(22)} تعديل  عرض  تقارير`);
  console.log('─'.repeat(78));
  for (const r of rows) {
    const own = r.own ? sectionLabel(r.own) : (r.isGlobal ? '— عامّ —' : '؟');
    console.log(`${r.ar.padEnd(30)} ${own.padEnd(22)} ${String(r.edit.length).padEnd(6)} ${String(r.view.length).padEnd(5)} ${r.subjects.length}`);
  }

  if (FULL) {
    console.log('\n' + '='.repeat(78));
    for (const r of rows) {
      console.log(`\n■ ${r.ar}  (${r.role})`);
      console.log(`   قسمه: ${r.own ? sectionLabel(r.own) : '— عامّ —'}`);
      console.log(`   يفتح ويعدّل: ${r.edit.map(sectionLabel).join('، ') || '—'}`);
      if (r.view.length) console.log(`   يقرأ فقط: ${r.view.map(sectionLabel).join('، ')}`);
      console.log(`   تقارير: ${r.subjects.join('، ') || '—'}`);
    }
  }

  // ── شذوذاتٌ على مستوى النظام ────────────────────────────────────────────
  console.log('\n' + '='.repeat(78));
  const covered = new Set(R.SECTION_ROLES.map((s) => s.section));
  const orphanSections = SECTION_KEYS.filter((k) => !covered.has(k));
  if (orphanSections.length) console.log(`  أقسامٌ بلا أدوار (بقصدٍ): ${orphanSections.map(sectionLabel).join('، ')}`);

  const Permission = mongoose.connection.collection('sectionpermissions');
  let stored = [];
  try { stored = await Permission.find({}).toArray(); } catch (e) { /* لا مجموعة */ }
  const known = new Set(R.ALL_ROLES);
  const ghosts = [...new Set(stored.map((p) => p.role))].filter((x) => x && !known.has(x));
  if (ghosts.length) problems.push(`صلاحيّاتٌ محفوظةٌ لأدوارٍ لم تعد موجودة: ${ghosts.join('، ')}`);
  console.log(`  صلاحيّاتٌ محفوظةٌ في المصفوفة: ${stored.length} سطرًا · أدوارٌ شبحيّة: ${ghosts.length}`);

  if (fixed.length) {
    console.log(`\n  ✓ عُولج ${fixed.length}:`);
    fixed.forEach((f) => console.log('     ' + f));
    try { require('../utils/permissions').clearCache?.(); } catch (e) { /* noop */ }
  }
  console.log(`\n  المشكلات: ${problems.length}`);
  problems.forEach((p) => console.log('   ✗ ' + p));
  if (!problems.length) console.log('   ✓ لا شيء');
  console.log('');
  await mongoose.disconnect();
})().catch(async (e) => { console.error(e); try { await mongoose.disconnect(); } catch (_) {} process.exit(1); });
