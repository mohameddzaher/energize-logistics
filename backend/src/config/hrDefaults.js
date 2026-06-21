// Default leave types seeded once on first run. Based on common Saudi labour-law
// categories. HR can edit/add/deactivate these freely afterwards.
const DEFAULT_LEAVE_TYPES = [
  { code: 'annual', nameEn: 'Annual Leave', nameAr: 'إجازة سنوية', paid: true, affectsBalance: true, color: '#22c55e' },
  { code: 'sick', nameEn: 'Sick Leave', nameAr: 'إجازة مرضية', paid: true, affectsBalance: false, color: '#eab308' },
  { code: 'emergency', nameEn: 'Emergency Leave', nameAr: 'إجازة طارئة', paid: true, affectsBalance: true, color: '#f97316' },
  { code: 'unpaid', nameEn: 'Unpaid Leave', nameAr: 'إجازة بدون راتب', paid: false, affectsBalance: false, color: '#94a3b8' },
  { code: 'hajj', nameEn: 'Hajj Leave', nameAr: 'إجازة حج', paid: true, affectsBalance: false, color: '#0ea5a4' },
  { code: 'marriage', nameEn: 'Marriage Leave', nameAr: 'إجازة زواج', paid: true, affectsBalance: false, color: '#ec4899' },
  { code: 'maternity', nameEn: 'Maternity Leave', nameAr: 'إجازة وضع', paid: true, affectsBalance: false, color: '#a855f7' },
  { code: 'paternity', nameEn: 'Paternity Leave', nameAr: 'إجازة أبوة', paid: true, affectsBalance: false, color: '#6366f1' },
  { code: 'bereavement', nameEn: 'Bereavement Leave', nameAr: 'إجازة وفاة', paid: true, affectsBalance: false, color: '#64748b' },
  { code: 'exam', nameEn: 'Exam Leave', nameAr: 'إجازة امتحانات', paid: true, affectsBalance: false, color: '#3b82f6' },
];

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

module.exports = { DEFAULT_LEAVE_TYPES, ensureDefaultLeaveTypes };
