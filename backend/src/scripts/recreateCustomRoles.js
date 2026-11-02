/**
 * Recreate the two custom user types (operations team and IT trainee). The types were created from the UI and their soundness was doubted, so they are recreated under new keys, holders are moved over,
 * and the old ones are deleted. Permissions are copied exactly from the old `RolePermission`: same section matrix, same ticked pages, same login page. Effective permissions (`effectivePermissions`/`effectivePages`)
 * are measured before and after and must be identical; otherwise the old type is kept and the difference reported. Order matters: deleting a type that an account still holds leaves a role the system
 * does not know. So create new, copy permissions, move people, measure, then delete old. Usage: node src/scripts/recreateCustomRoles.js [--apply] (dry run by default).
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

/** Old key to new key. Keys are lowercase Latin and must not end in `_manager` (see CustomRole). */
const PLAN = [
  { from: 'operation_team', to: 'ops_team', nameAr: 'فريق العمليات', nameEn: 'Operations Team',
    description: 'فريقُ العمليات — نوعٌ أُعيد صنعُه بمفتاحٍ جديد، بنفس أقسام النوع السابق وصفحاتِه.' },
  { from: 'it_trainee', to: 'it_intern', nameAr: 'متدرب تقنية المعلومات', nameEn: 'IT Intern',
    description: 'متدرّبُ تقنية المعلومات — نوعٌ أُعيد صنعُه بمفتاحٍ جديد، بنفس أقسام النوع السابق وصفحاتِه.' },
];

const sameJson = (a, b) => JSON.stringify(a) === JSON.stringify(b);

(async () => {
  await mongoose.connect(process.env.MONGODB_URI);

  // Who the entry is attributed to: the system owner's account, not anonymous.
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

    // 1) the new type
    await CustomRole.findOneAndUpdate(
      { key: step.to },
      { $set: { key: step.to, nameAr: step.nameAr, nameEn: step.nameEn, description: step.description, isActive: true, createdBy: actor?._id || null } },
      { upsert: true, new: true },
    );
    // 2) the same permissions, exactly
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

    // 3) move the people
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

    // 4) then delete the old type, now with no holder
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
    // Roles are read from `config/roles`, not `config/sections`: the latter is the matrix list and deliberately excludes `super_admin` (always has everything), so measuring against it would flag the owner as an unknown role.
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
