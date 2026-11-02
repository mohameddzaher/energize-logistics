/**
 * b2cDriversToDeliveryReps: B2C employees whose job category is «سائق» become «مندوب توصيل», one time; afterwards HR edits it.
 * Shows only; --apply writes. Each changed file gets a history entry.
 */
require('dotenv').config();
const mongoose = require('mongoose');
const Employee = require('../models/Employee');

const APPLY = process.argv.includes('--apply');
const FROM = 'سائق';
const TO = 'مندوب توصيل';

(async () => {
  await mongoose.connect(process.env.MONGODB_URI || process.env.MONGO_URI);
  const Lookup = require('../models/Lookup');
  const dept = await Lookup.findOne({ type: 'hr_department', key: 'light_transport', deleted: { $ne: true } }).select('nameAr').lean();
  const department = String(dept?.nameAr || 'B2C').trim();
  const rows = await Employee.find({ department, staffCategory: FROM }).select('employeeNumber arabicName firstName lastName').lean();
  console.log(`القسم: ${department} · الفئة «${FROM}»: ${rows.length}`);
  if (!APPLY) { console.log('(عرضٌ فقط — أضِف --apply للتنفيذ)'); process.exit(0); }
  if (rows.length) {
    const ids = rows.map((r) => r._id);
    const r = await Employee.updateMany({ _id: { $in: ids }, staffCategory: FROM }, { $set: { staffCategory: TO } });
    await mongoose.connection.db.collection('auditlogs').insertMany(rows.map((e) => ({
      bySystem: true, userName: 'النظام', action: 'hr_staff_category', entity: 'Employee', entityId: e._id,
      changes: { details: `الفئة الوظيفية: ${FROM} ← ${TO}`, before: { staffCategory: FROM }, after: { staffCategory: TO } }, createdAt: new Date(),
    })));
    console.log(`Applied: ${r.modifiedCount}`);
  }
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
