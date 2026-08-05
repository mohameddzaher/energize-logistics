/**
 * migrateRoleKeys — تحويل مفاتيح الأدوار القديمة للأسماء الجديدة.
 *
 *   node src/scripts/migrateRoleKeys.js --dry     يعرض بس، من غير كتابة
 *   node src/scripts/migrateRoleKeys.js           ينفّذ
 *
 * التحويلات معرّفة في config/roles.js → RENAMED، فمفيش قائمة تانية تتنسى.
 *
 *   operations           → operations_staff        (كان اسم مبهم: القسم ولا الشخص؟)
 *   purchasing           → procurement_staff       (يتماشى مع قسمه)
 *   administrator        → administration_staff    (القسم بقى له مدير وموظف)
 *   b2c_head             → b2c_manager             (كل المديرين بينتهوا بـ _manager)
 *   b2c_project_manager  → b2c_project_lead        (كان بيتحسب مدير بالغلط)
 *
 * idempotent: تشغيله تاني ما بيعملش حاجة لأن مفيش مفاتيح قديمة فاضلة.
 * بيغطي كل مكان بيتخزّن فيه اسم دور: المستخدمين، مصفوفة الصلاحيات، وحضور
 * الاجتماعات (بيخزّن لقطة من دور الحاضر).
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

  // ── ١. المستخدمون ──────────────────────────────────────────────────────────
  console.log('المستخدمون:');
  let users = 0;
  for (const [from, to] of pairs) {
    const who = await User.find({ role: from }).select('firstName lastName email').lean();
    if (!who.length) { console.log(`  ${from.padEnd(22)} → ${to.padEnd(22)} (لا أحد)`); continue; }
    console.log(`  ${from.padEnd(22)} → ${to.padEnd(22)} ${who.length} حساب`);
    who.forEach((u) => console.log(`      · ${`${u.firstName || ''} ${u.lastName || ''}`.trim()}  ${u.email}`));
    if (!DRY) {
      // updateMany بيتخطّى الـ validators، وده المطلوب: القيمة القديمة مش في
      // الـ enum الجديد، فحفظ عادي كان هيترفض.
      const r = await User.updateMany({ role: from }, { $set: { role: to } });
      users += r.modifiedCount;
    } else users += who.length;
  }

  // ── ٢. مصفوفة الصلاحيات ────────────────────────────────────────────────────
  // وثيقة لكل دور. لو الدور الجديد عنده وثيقة أصلاً بنسيبها ونمسح القديمة، عشان
  // ما نكتبش فوق إعداد أحدث.
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

  // ── ٣. لقطات الدور داخل حضور الاجتماعات ────────────────────────────────────
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

  // ── التحقق ─────────────────────────────────────────────────────────────────
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
    // وكل دور موجود دلوقتي لازم يكون في الـ enum الجديد.
    const roles = await User.distinct('role');
    const valid = new Set(User.schema.path('role').enumValues);
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
