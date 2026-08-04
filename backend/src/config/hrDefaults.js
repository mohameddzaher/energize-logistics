// Default leave types seeded once on first run. Based on common Saudi labour-law
// categories. HR can edit/add/deactivate these freely afterwards.
//
// Advance notice (الإخطار المسبق): planned leave must be requested a MONTH ahead
// — you cannot ask on Sunday to travel on Tuesday. Leave nobody can plan (مرضية،
// طارئة، وفاة، وضع) carries `requiresAdvanceNotice: false` and can be filed for
// today. HR can change any of this per type from the leave-types page.
const ADVANCE_NOTICE_DAYS = 30;

const DEFAULT_LEAVE_TYPES = [
  { code: 'annual', nameEn: 'Annual Leave', nameAr: 'إجازة سنوية', paid: true, affectsBalance: true, color: '#22c55e', requiresAdvanceNotice: true, minAdvanceDays: ADVANCE_NOTICE_DAYS },
  { code: 'sick', nameEn: 'Sick Leave', nameAr: 'إجازة مرضية', paid: true, affectsBalance: false, color: '#eab308', requiresAdvanceNotice: false, minAdvanceDays: 0 },
  { code: 'emergency', nameEn: 'Emergency Leave', nameAr: 'إجازة طارئة', paid: true, affectsBalance: true, color: '#f97316', requiresAdvanceNotice: false, minAdvanceDays: 0 },
  { code: 'unpaid', nameEn: 'Unpaid Leave', nameAr: 'إجازة بدون راتب', paid: false, affectsBalance: false, color: '#94a3b8', requiresAdvanceNotice: true, minAdvanceDays: ADVANCE_NOTICE_DAYS },
  { code: 'hajj', nameEn: 'Hajj Leave', nameAr: 'إجازة حج', paid: true, affectsBalance: false, color: '#0ea5a4', requiresAdvanceNotice: true, minAdvanceDays: ADVANCE_NOTICE_DAYS },
  { code: 'marriage', nameEn: 'Marriage Leave', nameAr: 'إجازة زواج', paid: true, affectsBalance: false, color: '#ec4899', requiresAdvanceNotice: true, minAdvanceDays: ADVANCE_NOTICE_DAYS },
  { code: 'maternity', nameEn: 'Maternity Leave', nameAr: 'إجازة وضع', paid: true, affectsBalance: false, color: '#a855f7', requiresAdvanceNotice: false, minAdvanceDays: 0 },
  { code: 'paternity', nameEn: 'Paternity Leave', nameAr: 'إجازة أبوة', paid: true, affectsBalance: false, color: '#6366f1', requiresAdvanceNotice: false, minAdvanceDays: 0 },
  { code: 'bereavement', nameEn: 'Bereavement Leave', nameAr: 'إجازة وفاة', paid: true, affectsBalance: false, color: '#64748b', requiresAdvanceNotice: false, minAdvanceDays: 0 },
  { code: 'exam', nameEn: 'Exam Leave', nameAr: 'إجازة امتحانات', paid: true, affectsBalance: false, color: '#3b82f6', requiresAdvanceNotice: true, minAdvanceDays: 14 },
];

// Codes that are exempt from advance notice no matter what — used to backfill
// leave types that already existed before the policy shipped.
const NO_NOTICE_CODES = DEFAULT_LEAVE_TYPES.filter((t) => !t.requiresAdvanceNotice).map((t) => t.code);

// Ensure the default leave types exist. Idempotent — safe to call on every boot.
const ensureDefaultLeaveTypes = async () => {
  try {
    const LeaveType = require('../models/LeaveType');
    const count = await LeaveType.estimatedDocumentCount();
    if (count > 0) return;
    await LeaveType.insertMany(DEFAULT_LEAVE_TYPES);
    console.log('Seeded default HR leave types');
  } catch (err) {
    console.error('ensureDefaultLeaveTypes error:', err.message);
  }
};

// Backfill the advance-notice policy onto leave types created before it existed.
// Only touches documents where the field is genuinely absent, so anything HR has
// since tuned by hand is left exactly as they set it.
const ensureLeavePolicyDefaults = async () => {
  try {
    const LeaveType = require('../models/LeaveType');
    const missing = { requiresAdvanceNotice: { $exists: false } };
    const exempt = await LeaveType.updateMany(
      { ...missing, code: { $in: NO_NOTICE_CODES } },
      { $set: { requiresAdvanceNotice: false, minAdvanceDays: 0 } }
    );
    const planned = await LeaveType.updateMany(
      { ...missing, code: { $nin: NO_NOTICE_CODES } },
      { $set: { requiresAdvanceNotice: true, minAdvanceDays: ADVANCE_NOTICE_DAYS } }
    );
    const n = (exempt.modifiedCount || 0) + (planned.modifiedCount || 0);
    if (n) console.log(`Applied advance-notice policy to ${n} leave type(s)`);
  } catch (err) {
    console.error('ensureLeavePolicyDefaults error:', err.message);
  }
};

module.exports = {
  DEFAULT_LEAVE_TYPES,
  ADVANCE_NOTICE_DAYS,
  ensureDefaultLeaveTypes,
  ensureLeavePolicyDefaults,
};
