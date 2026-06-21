/**
 * Backfill an HR Employee profile for every login User that doesn't already
 * have one, and link them two-way (User.linkedEmployee ↔ Employee.user).
 *
 * SAFE TO RE-RUN (idempotent): users already linked are skipped. Clients are
 * skipped (they're external, not staff). All generated values are PLACEHOLDERS
 * meant to be edited later from the HR → Employees screen.
 *
 * Usage (from backend/):
 *   node src/scripts/backfillEmployeeProfiles.js          # apply
 *   node src/scripts/backfillEmployeeProfiles.js --dry    # preview only
 */
require('dotenv').config();
const mongoose = require('mongoose');
const connectDB = require('../config/db');
const User = require('../models/User');
const Employee = require('../models/Employee');
const { ROLE_HIERARCHY } = require('../config/constants');

const DRY = process.argv.includes('--dry');

// Reasonable default job title + department per role (placeholder).
const ROLE_PROFILE = {
  super_admin: { jobTitle: 'Chief Executive Officer', department: 'Executive' },
  admin: { jobTitle: 'General Manager', department: 'Management' },
  moderator: { jobTitle: 'Moderator', department: 'Management' },
  employee: { jobTitle: 'Collections Officer', department: 'Finance' },
  operations_manager: { jobTitle: 'Operations Manager', department: 'Operations' },
  operations: { jobTitle: 'Operations Officer', department: 'Operations' },
  workshop_manager: { jobTitle: 'Workshop Manager', department: 'Workshop' },
  workshop_employee: { jobTitle: 'Workshop Technician', department: 'Workshop' },
  purchasing: { jobTitle: 'Purchasing Officer', department: 'Procurement' },
  b2c_head: { jobTitle: 'B2C Head', department: 'B2C' },
  b2c_project_manager: { jobTitle: 'B2C Project Manager', department: 'B2C' },
  hr_manager: { jobTitle: 'HR Manager', department: 'Human Resources' },
  hr_specialist: { jobTitle: 'HR Specialist', department: 'Human Resources' },
  crm_manager: { jobTitle: 'CRM Manager', department: 'CRM' },
  crm_specialist: { jobTitle: 'CRM Specialist', department: 'CRM' },
  finance_manager: { jobTitle: 'Finance Manager', department: 'Finance' },
  accountant: { jobTitle: 'Accountant', department: 'Finance' },
  sales_manager: { jobTitle: 'Sales Manager', department: 'Sales' },
  sales_rep: { jobTitle: 'Sales Representative', department: 'Sales' },
  remote_manager: { jobTitle: 'Remote Team Manager', department: 'Remote' },
  remote_employee: { jobTitle: 'Remote Employee', department: 'Remote' },
};

const pad = (n, len) => String(n).padStart(len, '0');
const randInt = (min, max) => Math.floor(Math.random() * (max - min + 1)) + min;
const randomDateWithin = (yearsBack) => {
  const d = new Date();
  d.setFullYear(d.getFullYear() - randInt(0, yearsBack));
  d.setMonth(randInt(0, 11));
  d.setDate(randInt(1, 28));
  return d.toISOString().slice(0, 10);
};

const run = async () => {
  await connectDB();
  console.log(`\n=== Employee profile backfill ${DRY ? '(DRY RUN)' : ''} ===`);

  const users = await User.find({ role: { $ne: 'client' } }).lean();
  let created = 0, linked = 0, skipped = 0;
  let seq = (await Employee.countDocuments({})) + 1;

  for (const u of users) {
    // Already linked to an employee that still exists → skip.
    if (u.linkedEmployee) {
      const exists = await Employee.exists({ _id: u.linkedEmployee });
      if (exists) { skipped++; continue; }
    }
    // An employee already points at this user → just fix the back-link.
    let emp = await Employee.findOne({ user: u._id });
    if (emp) {
      if (String(u.linkedEmployee || '') !== String(emp._id)) {
        if (!DRY) await User.findByIdAndUpdate(u._id, { linkedEmployee: emp._id });
        linked++;
        console.log(`  link  ${u.email} → existing employee ${emp._id}`);
      } else {
        skipped++;
      }
      continue;
    }

    const profile = ROLE_PROFILE[u.role] || { jobTitle: 'Staff', department: 'General' };
    const data = {
      firstName: u.firstName || 'New',
      lastName: u.lastName || 'Employee',
      employeeNumber: `EMP-${pad(seq++, 4)}`,
      email: u.email,
      phone: `+9665${randInt(10000000, 99999999)}`,
      jobTitle: profile.jobTitle,
      department: profile.department,
      hireDate: randomDateWithin(5),
      employmentStatus: 'active',
      idType: 'iqama',
      iqamaNumber: `2${randInt(100000000, 999999999)}`,
      iqamaExpiry: (() => { const d = new Date(); d.setFullYear(d.getFullYear() + randInt(1, 3)); return d.toISOString().slice(0, 10); })(),
      nationality: 'Saudi Arabia',
      basicSalary: randInt(4, 25) * 1000,
      allowances: randInt(0, 5) * 500,
      branch: u.branch || undefined,
      user: u._id,
      directManager: u.manager || undefined,
      notes: 'Auto-generated placeholder profile — please review and update.',
    };

    if (DRY) {
      console.log(`  would create ${data.employeeNumber} for ${u.email} (${u.role})`);
      created++;
      continue;
    }
    emp = await Employee.create(data);
    await User.findByIdAndUpdate(u._id, { linkedEmployee: emp._id });
    created++;
    console.log(`  create ${data.employeeNumber} ← ${u.email} (${u.role})`);
  }

  console.log(`\nDone. created=${created} relinked=${linked} skipped=${skipped} (of ${users.length} non-client users)`);
  if (DRY) console.log('DRY RUN — nothing was written. Re-run without --dry to apply.');
  await mongoose.disconnect();
  process.exit(0);
};

run().catch((e) => { console.error('Backfill failed:', e); process.exit(1); });
