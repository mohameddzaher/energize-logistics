/**
 * فحصُ وصولِ كلّ مستخدم: هل يدخل فيجد شيئًا؟
 *
 * ── لماذا ملفٌّ يُحفَظ ─────────────────────────────────────────────────────
 * الصلاحيّةُ ثلاثُ طبقاتٍ تتقاطع: الدورُ (وهل يعرفه النظام)، والقسمُ من مصفوفة
 * الصلاحيّات، والصفحةُ تحته. وكلُّ عطبٍ فيها **صامت**: لا خطأٌ في السجلّ، بل
 * موظّفٌ يدخل فلا يرى شيئًا — أو يرى قسمًا ولا تُفتَح له فيه صفحةٌ واحدة. ولا
 * يُكتشَف ذلك إلّا بشكوى.
 *
 * فيُقاس لكلّ حساب: دورُه معروف؟ وكم قسمًا يملك؟ وكم صفحةً تُفتَح له؟ وأوّلُ
 * شاشةٍ تُفتَح له موجودةٌ ومسموحة؟ ويُسمّى كلُّ من في حالةٍ لا تصلح للعمل.
 *
 * الاستعمال: node src/scripts/auditUserAccess.js [--all]
 *   بلا `--all` تُطبَع المشاكلُ وحدَها؛ ومعها كلُّ الحسابات.
 */
require('dotenv').config();
const mongoose = require('mongoose');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const User = require(`${ROOT}/models/User`);
const CustomRole = require(`${ROOT}/models/CustomRole`);
const { ALL_ROLE_DEFS } = require(`${ROOT}/config/roles`);
const { SECTION_KEYS } = require(`${ROOT}/config/sections`);
const { PAGES, isPage, PERSONAL_SECTIONS } = require(`${ROOT}/config/pages`);
const { FULL_ACCESS_ROLES } = require(`${ROOT}/config/constants`);
const { effectivePermissions, effectivePages, homePageFor } = require(`${ROOT}/utils/permissions`);

const ALL = process.argv.includes('--all');

(async () => {
  await mongoose.connect(process.env.MONGODB_URI);

  const custom = await CustomRole.find({}).select('key nameAr isActive').lean();
  const customByKey = new Map(custom.map((c) => [c.key, c]));
  const known = new Set([...ALL_ROLE_DEFS.map((d) => d.key), ...custom.filter((c) => c.isActive !== false).map((c) => c.key)]);

  const users = await User.find({})
    .select('firstName lastName email username role isActive accountType lastLogin')
    .sort({ role: 1 }).lean();

  // الصلاحيّةُ تُحسب للدور لا للحساب — فتُحسب مرّةً لكلّ دورٍ مستعمَل.
  const roles = [...new Set(users.map((u) => u.role))];
  const byRole = new Map();
  for (const r of roles) {
    const perms = await effectivePermissions(r);
    const pages = await effectivePages(r);
    const home = await homePageFor(r);
    byRole.set(r, {
      sections: Object.entries(perms).filter(([, v]) => v !== 'none'),
      edit: Object.entries(perms).filter(([, v]) => v === 'edit').length,
      pages: Object.entries(pages).filter(([, v]) => v).length,
      // ── وأضعفُ ما يملكه موظّفٌ: نفسُه ────────────────────────────────────
      // «ملفي» و«إجازاتي» و«طلباتي» و«الإعدادات» ليست قسمًا يُمنَح: هي ما
      // يراه كلُّ موظّفٍ عن نفسه. وقد أُغلقت مرّةً على نوعَين مصنوعَين بأثرِ
      // عطبٍ في الحفظ لا بقرار (راجع scripts/rebuildCustomRoleGrants)، فلم
      // يجد صاحبُها رصيدَ إجازاته ولا موضعَ كلمةِ مروره، ولا شكوى تُقال.
      // فيُقاس من اليوم في كلّ فحص.
      selfClosed: PAGES.filter((p) => PERSONAL_SECTIONS.has(p.section) && pages[p.key] === false),
      home,
      full: FULL_ACCESS_ROLES.includes(r),
    });
  }

  const problems = [];
  const name = (u) => [u.firstName, u.lastName].filter(Boolean).join(' ').trim() || u.email || u.username || String(u._id);

  console.log(`حسابات: ${users.length} · أدوارٌ مستعملة: ${roles.length} · أنواعٌ مصنوعة: ${custom.length}`);
  console.log(`أقسامٌ في المصفوفة: ${SECTION_KEYS.length} · صفحاتٌ في الفهرس: ${PAGES.length}\n`);

  for (const u of users) {
    const r = byRole.get(u.role);
    const issues = [];
    if (!known.has(u.role)) {
      const c = customByKey.get(u.role);
      issues.push(c ? `نوعٌ معطَّل: «${u.role}»` : `دورٌ لا يعرفه النظام: «${u.role}»`);
    }
    // الشريكُ (عميلٌ أو موردٌ) يدخل البوّابةَ لا النظام — فلا يُقاس بمصفوفة الأقسام.
    const partner = u.accountType && u.accountType !== 'employee';
    if (!partner && !r.full && u.isActive !== false) {
      if (!r.sections.length) issues.push('لا قسمَ ممنوحًا — يدخل فلا يرى شيئًا');
      else if (!r.pages) issues.push(`${r.sections.length} قسمًا ممنوحًا ولا صفحةَ تُفتَح`);
      if (r.home && !isPage(r.home)) issues.push(`صفحةُ الدخول «${r.home}» ليست في الفهرس`);
      if (r.selfClosed.length) {
        issues.push(`لا يرى عن نفسِه: ${r.selfClosed.map((p) => p.ar).join('، ')}`);
      }
    }
    if (issues.length) problems.push({ u, r, issues });
    if (ALL) {
      console.log(`${u.isActive === false ? '○' : '●'} ${name(u)} · ${u.email || u.username} · ${u.role}`
        + `${partner ? ' · شريك' : ''}${r.full ? ' · وصولٌ كامل' : ` · أقسام ${r.sections.length} (تعديل ${r.edit}) · صفحات ${r.pages}`}`
        + `${r.home ? ` · يفتح على ${r.home}` : ''}`);
    }
  }

  console.log(`\n── حساباتٌ فيها خلل: ${problems.length}`);
  for (const p of problems) {
    console.log(`   ✗ ${name(p.u)} · ${p.u.email || p.u.username} · «${p.u.role}»${p.u.isActive === false ? ' (معطّل)' : ''}`);
    p.issues.forEach((i) => console.log(`        ${i}`));
  }

  // ولا دورَ مستعمَلٌ بلا صلاحيّةٍ — يُقال بالدور لا بالحساب، فيُصلَح مرّةً.
  const emptyRoles = roles.filter((r) => {
    const x = byRole.get(r);
    return !x.full && !x.sections.length && users.some((u) => u.role === r && u.isActive !== false && (!u.accountType || u.accountType === 'employee'));
  });
  console.log(`\n── أدوارٌ يحملها عاملون ولا قسمَ لها: ${emptyRoles.length}`);
  emptyRoles.forEach((r) => {
    const who = users.filter((u) => u.role === r && u.isActive !== false).map(name);
    console.log(`   ✗ «${r}» — ${who.length} حسابًا: ${who.slice(0, 5).join(' · ')}`);
  });

  await mongoose.disconnect();
  process.exit(problems.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
