/**
 * Synthetic user for check scripts.
 * Using a real account attributed every script action in the audit log to a real person. This user has a valid id for populate and a role that passes guards, no stored record, and AUDIT_SUPPRESS so no audit entry is written.
 */
const mongoose = require('mongoose');

process.env.AUDIT_SUPPRESS = '1';

const testUser = (role = 'super_admin', extra = {}) => ({
  _id: new mongoose.Types.ObjectId(),
  firstName: 'فحص',
  lastName: 'آليّ',
  email: `zz-harness-${role}@example.invalid`,
  role,
  isActive: true,
  ...extra,
});

module.exports = { testUser };
