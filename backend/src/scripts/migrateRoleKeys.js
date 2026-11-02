/**
 * Converts old role keys to the new names.
 * Usage: node src/scripts/migrateRoleKeys.js [--dry]
 * Mappings are defined in config/roles.js RENAMED so no second list drifts: operations to operations_staff, purchasing to procurement_staff, administrator to administration_staff, b2c_head to b2c_manager, b2c_project_manager to b2c_project_lead.
 * Idempotent. Covers users, the permission matrix and meeting attendance (which snapshots the attendee's role).
 */
require('dotenv').config();
const mongoose = require('mongoose');

const DRY = process.argv.includes('--dry');

(async () => {
  await mongoose.connect(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 20000 });
  const { RENAMED } = require('../config/roles');
  const User = require('../models/User');
  const RolePermission = require('../models/RolePermission');
  const { BrMeeting } = require('../models/BusinessReview');

  const pairs = Object.entries(RENAMED);
  console.log(`${pairs.length} تحويل${DRY ? '  (تجربة — لن يُكتب شيء)' : ''}\n`);

  // 1. Users.
  console.log('المستخدمون:');
  let users = 0;
  for (const [from, to] of pairs) {
    const who = await User.find({ role: from }).select('firstName lastName email').lean();
    if (!who.length) { console.log(`  ${from.padEnd(22)} → ${to.padEnd(22)} (لا أحد)`); continue; }
    console.log(`  ${from.padEnd(22)} → ${to.padEnd(22)} ${who.length} حساب`);
    who.forEach((u) => console.log(`      · ${`${u.firstName || ''} ${u.lastName || ''}`.trim()}  ${u.email}`));
    if (!DRY) {
      // updateMany skips validators, which is needed: the old value is not in the new enum, so a normal save would be rejected.
      const r = await User.updateMany({ role: from }, { $set: { role: to } });
      users += r.modifiedCount;
    } else users += who.length;
  }

  // 2. Permission matrix: one document per role. If the new role already has one, keep it and delete the old, so a newer setting is not overwritten.
  console.log('\nمصفوفة الصلاحيات:');
  let perms = 0;
  for (const [from, to] of pairs) {
    const old = await RolePermission.findOne({ role: from });
    if (!old) { console.log(`  ${from.padEnd(22)} (لا يوجد override محفوظ)`); continue; }
    const already = await RolePermission.findOne({ role: to });
    console.log(`  ${from.padEnd(22)} → ${to}${already ? '  (الجديد له إعداد بالفعل — القديم يُحذف)' : ''}`);
    if (!DRY) {
      if (!already) { old.role = to; await old.save(); }
      else await RolePermission.deleteOne({ _id: old._id });
      perms++;
    } else perms++;
  }

  // 3. Role snapshots inside meeting attendance.
  console.log('\nحضور الاجتماعات (لقطة الدور):');
  let attendees = 0;
  for (const [from, to] of pairs) {
    const n = await BrMeeting.countDocuments({ 'attendees.role': from });
    if (!n) continue;
    console.log(`  ${from.padEnd(22)} → ${to.padEnd(22)} في ${n} اجتماع`);
    if (!DRY) {
      const r = await BrMeeting.updateMany(
        { 'attendees.role': from },
        { $set: { 'attendees.$[a].role': to } },
        { arrayFilters: [{ 'a.role': from }] }
      );
      attendees += r.modifiedCount;
    } else attendees += n;
  }
  if (!attendees) console.log('  (لا شيء)');

  // Verification.
  if (!DRY) {
    const leftover = [];
    for (const [from] of pairs) {
      const u = await User.countDocuments({ role: from });
      const p = await RolePermission.countDocuments({ role: from });
      const a = await BrMeeting.countDocuments({ 'attendees.role': from });
      if (u || p || a) leftover.push(`${from}: ${u} مستخدم، ${p} صلاحية، ${a} اجتماع`);
    }
    console.log(`\nالنتيجة: ${users} حساب · ${perms} إعداد صلاحيات · ${attendees} اجتماع`);
    if (leftover.length) {
      console.log('\n✗ فاضل مفاتيح قديمة:');
      leftover.forEach((l) => console.log('    ' + l));
      process.exit(1);
    }
    // Every existing role must now be in the new enum.
    const roles = await User.distinct('role');
    const valid = new Set(require('../config/roles').ALL_ROLES);
    const unknown = roles.filter((r) => !valid.has(r));
    if (unknown.length) {
      console.log(`\n✗ أدوار مش في القائمة المعتمدة: ${unknown.join(', ')}`);
      process.exit(1);
    }
    console.log('✓ مفيش مفاتيح قديمة، وكل أدوار المستخدمين معتمدة.');
  } else {
    console.log(`\nلو اتنفّذ: ${users} حساب · ${perms} إعداد صلاحيات · ${attendees} اجتماع`);
  }
  process.exit(0);
})().catch((e) => { console.error('FATAL', e); process.exit(1); });
