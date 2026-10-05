/**
 * إعادةُ صنعِ نوعَي المستخدم «فريق العمليات» و«متدرب تقنية المعلومات».
 *
 * ── لماذا ───────────────────────────────────────────────────────────────────
 * النوعان صُنعا من الشاشة ثمّ شُكّ في سلامتهما («لو صنعي بيكون فيهم مشاكل»).
 * فيُصنعان من جديد بمفتاحين جديدين، ويُنقَل إليهما حاملاهما، ويُحذف القديمان.
 *
 * ── وما يُحفَظ حرفًا ────────────────────────────────────────────────────────
 * الأخطرُ في هذا العمل أن يفقد إنسانٌ يعمل الآن ما كان يملكه. فما يُنقَل ليس
 * «أقسامًا تُشبه» بل **نفسَ** مصفوفة القسم ونفسَ الصفحات المؤشَّرة ونفسَ صفحة
 * الدخول، منسوخةً من `RolePermission` القديم كما هي. ثمّ تُقاس الصلاحيّةُ
 * الفعليّةُ (`effectivePermissions`/`effectivePages`) قبلَ النقل وبعدَه ويُشترَط
 * تساويها تمامًا — فلو اختلف حرفٌ لم يُحذف القديمُ وأُبلغ عن الفرق.
 *
 * ── والحذفُ بعد النقل لا قبلَه ──────────────────────────────────────────────
 * حذفُ نوعٍ يحمله حسابٌ يتركه بدورٍ لا يعرفه النظام: لا قسمَ ولا صفحة — أي
 * موظّفٌ يدخل فلا يجد شيئًا. فالترتيبُ: يُصنَع الجديدُ، ثمّ تُنسَخ الصلاحيّات،
 * ثمّ يُنقَل الناس، ثمّ يُقاس، ثمّ يُحذف القديم.
 *
 * الاستعمال:
 *   node src/scripts/recreateCustomRoles.js            # عرضٌ فقط
 *   node src/scripts/recreateCustomRoles.js --apply
 */
require('dotenv').config();
const mongoose = require('mongoose');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const CustomRole = require(`${ROOT}/models/CustomRole`);
const RolePermission = require(`${ROOT}/models/RolePermission`);
const User = require(`${ROOT}/models/User`);
const { effectivePermissions, effectivePages, invalidate } = require(`${ROOT}/utils/permissions`);
const logAudit = require(`${ROOT}/utils/auditLogger`);

const APPLY = process.argv.includes('--apply');

/** القديمُ ← الجديد. المفتاحُ لاتينيٌّ صغير، ولا ينتهي بـ`_manager` (راجع CustomRole). */
const PLAN = [
  { from: 'operation_team', to: 'ops_team', nameAr: 'فريق العمليات', nameEn: 'Operations Team',
    description: 'فريقُ العمليات — نوعٌ أُعيد صنعُه بمفتاحٍ جديد، بنفس أقسام النوع السابق وصفحاتِه.' },
  { from: 'it_trainee', to: 'it_intern', nameAr: 'متدرب تقنية المعلومات', nameEn: 'IT Intern',
    description: 'متدرّبُ تقنية المعلومات — نوعٌ أُعيد صنعُه بمفتاحٍ جديد، بنفس أقسام النوع السابق وصفحاتِه.' },
];

const sameJson = (a, b) => JSON.stringify(a) === JSON.stringify(b);

(async () => {
  await mongoose.connect(process.env.MONGODB_URI);

  // مَن يُنسَب إليه القيد — حسابُ صاحب النظام، لا مجهول.
  const actor = await User.findOne({ role: 'super_admin', isActive: { $ne: false } }).select('_id firstName lastName').lean();

  let failed = false;
  for (const step of PLAN) {
    console.log(`\n── ${step.nameAr}: «${step.from}» → «${step.to}»`);
    const old = await CustomRole.findOne({ key: step.from }).lean();
    if (!old) { console.log('   النوعُ القديمُ غير موجود — يُتجاوَز.'); continue; }

    const oldPerm = await RolePermission.findOne({ role: step.from }).lean();
    const beforePerms = await effectivePermissions(step.from);
    const beforePages = await effectivePages(step.from);
    const holders = await User.find({ role: step.from }).select('_id firstName lastName email').lean();
    const grantedCount = Object.values(beforePerms).filter((v) => v !== 'none').length;
    const openCount = Object.values(beforePages).filter(Boolean).length;
    console.log(`   القديم: أقسامٌ ممنوحة ${grantedCount} · صفحاتٌ تُفتَح ${openCount} · صفحاتٌ مؤشَّرةٌ صراحةً ${Object.keys(oldPerm?.pages || {}).length} · دخول «${oldPerm?.homePage || '—'}»`);
    console.log(`   يحمله: ${holders.length ? holders.map((u) => `${[u.firstName, u.lastName].filter(Boolean).join(' ')} (${u.email})`).join(' · ') : 'لا أحد'}`);

    const clash = await CustomRole.findOne({ key: step.to }).lean();
    if (clash) console.log(`   (المفتاحُ الجديدُ موجودٌ بالفعل — سيُحدَّث لا يُكرَّر)`);

    if (!APPLY) { console.log('   (عرضٌ فقط)'); continue; }

    // ١) النوعُ الجديد
    await CustomRole.findOneAndUpdate(
      { key: step.to },
      { $set: { key: step.to, nameAr: step.nameAr, nameEn: step.nameEn, description: step.description, isActive: true, createdBy: actor?._id || null } },
      { upsert: true, new: true },
    );
    // ٢) نفسُ الصلاحيّات حرفًا
    await RolePermission.findOneAndUpdate(
      { role: step.to },
      { $set: { sections: oldPerm?.sections || {}, pages: oldPerm?.pages || {}, homePage: oldPerm?.homePage || '', updatedBy: actor?._id || null } },
      { upsert: true, new: true },
    );
    invalidate(step.to);

    const afterPerms = await effectivePermissions(step.to);
    const afterPages = await effectivePages(step.to);
    const permsEqual = sameJson(beforePerms, afterPerms);
    const pagesEqual = sameJson(beforePages, afterPages);
    console.log(`   الصلاحيّةُ الفعليّةُ متساوية: أقسام ${permsEqual ? '✓' : '✗'} · صفحات ${pagesEqual ? '✓' : '✗'}`);
    if (!permsEqual || !pagesEqual) {
      failed = true;
      console.log('   ✗ اختلفت — لا يُنقَل أحدٌ ولا يُحذف القديم.');
      continue;
    }

    // ٣) يُنقَل الناس
    if (holders.length) {
      const r = await User.updateMany({ role: step.from }, { $set: { role: step.to } });
      console.log(`   نُقل ${r.modifiedCount} حسابًا إلى النوع الجديد.`);
      for (const u of holders) {
        await logAudit({
          user: actor?._id, action: 'update', entity: 'User', entityId: u._id,
          changes: { before: { role: step.from }, after: { role: step.to } },
        }).catch(() => {});
      }
    }

    // ٤) ثمّ يُحذف القديم — وقد خلا من حامل
    const left = await User.countDocuments({ role: step.from });
    if (left > 0) {
      failed = true;
      console.log(`   ✗ بقي ${left} حسابًا على القديم — لم يُحذف.`);
      continue;
    }
    await CustomRole.deleteOne({ key: step.from });
    await RolePermission.deleteOne({ role: step.from });
    invalidate(step.from);
    await logAudit({
      user: actor?._id, action: 'delete', entity: 'CustomRole', entityId: old._id, entityKey: step.from,
      changes: { before: { key: step.from }, after: { replacedBy: step.to } },
    }).catch(() => {});
    console.log('   حُذف النوعُ القديم.');
  }

  if (APPLY) {
    console.log('\n── الحالةُ النهائيّة');
    const all = await CustomRole.find({}).select('key nameAr isActive').sort({ createdAt: 1 }).lean();
    for (const c of all) {
      const n = await User.countDocuments({ role: c.key });
      const p = await effectivePermissions(c.key);
      const g = Object.entries(p).filter(([, v]) => v !== 'none');
      const pg = Object.values(await effectivePages(c.key)).filter(Boolean).length;
      console.log(`   ${c.key} · ${c.nameAr} · حسابات ${n} · أقسام ${g.length} · صفحات ${pg}`);
    }
    // ── ولا حسابَ بدورٍ لا يعرفه النظام ──────────────────────────────────
    // تُقرأ الأدوارُ من `config/roles` لا من `config/sections`: الثانيةُ قائمةُ
    // المصفوفة وتستثني `super_admin` عمدًا (له كلُّ شيءٍ دائمًا ولا يُضبَط)،
    // فلو قيست بها لظهر صاحبُ النظام نفسُه «بدورٍ مجهول».
    const { ALL_ROLE_DEFS } = require(`${ROOT}/config/roles`);
    const known = new Set([...ALL_ROLE_DEFS.map((d) => d.key), ...all.map((c) => c.key)]);
    const orphan = await User.find({}).select('firstName lastName email role').lean();
    const bad = orphan.filter((u) => !known.has(u.role));
    console.log(`   حساباتٌ بدورٍ مجهول: ${bad.length}`);
    bad.forEach((u) => console.log(`      ✗ ${[u.firstName, u.lastName].join(' ')} · ${u.email} · «${u.role}»`));
    if (bad.length) failed = true;
  } else {
    console.log('\n(عرضٌ فقط — أضِف --apply)');
  }

  await mongoose.disconnect();
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
