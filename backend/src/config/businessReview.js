/**
 * businessReview — قواعد اجتماعات مراجعة الأعمال.
 *
 * The section is a standing forum: department managers sit with the GM and the
 * administration on a fixed cadence, the secretary writes the minutes, and the
 * decisions become ACTIONS with an owner and a due date.
 *
 * ── The rule that had to survive the future ─────────────────────────────────
 * The brief was explicit: this must keep working when a new role type or a new
 * department is added. So nothing here is a frozen list of names.
 *
 *   • Who is a manager?  Any role whose key ends in `_manager`, plus a short
 *     list of department heads that are named differently. Add `logistics_manager`
 *     to the User enum tomorrow and that person is a participant today — no
 *     change here.
 *   • What are the departments?  Read from config/sections.js, which is already
 *     the single source of truth for the permission matrix. A new section appears
 *     in the meeting's department picker automatically.
 *
 * The only hard-coded tiers are the two that are genuinely about authority, not
 * about org shape: the executive tier and the secretariat.
 */
const { FULL_ACCESS_ROLES } = require('./constants');
const { SECTION_KEYS } = require('./sections');

// ── Cadences ────────────────────────────────────────────────────────────────
const CADENCES = [
  { key: 'weekly', ar: 'أسبوعي', en: 'Weekly', days: 7 },
  { key: 'monthly', ar: 'شهري', en: 'Monthly', days: 30 },
  { key: 'quarterly', ar: 'ربع سنوي', en: 'Quarterly', days: 91 },
  { key: 'semi_annual', ar: 'نصف سنوي', en: 'Semi-annual', days: 182 },
  { key: 'annual', ar: 'سنوي', en: 'Annual', days: 365 },
  { key: 'ad_hoc', ar: 'استثنائي', en: 'Ad-hoc', days: null },
];
const CADENCE_KEYS = CADENCES.map((c) => c.key);

const MEETING_STATUSES = [
  { key: 'scheduled', ar: 'مجدول', en: 'Scheduled', color: '#0ea5e9' },
  { key: 'in_progress', ar: 'منعقد الآن', en: 'In progress', color: '#f59e0b' },
  { key: 'held', ar: 'انعقد', en: 'Held', color: '#16a34a' },
  { key: 'cancelled', ar: 'ملغي', en: 'Cancelled', color: '#94a3b8' },
];
const MEETING_STATUS_KEYS = MEETING_STATUSES.map((s) => s.key);

const ACTION_STATUSES = [
  { key: 'open', ar: 'لم يبدأ', en: 'Not started', color: '#94a3b8' },
  { key: 'in_progress', ar: 'قيد التنفيذ', en: 'In progress', color: '#0ea5e9' },
  { key: 'blocked', ar: 'متعثر', en: 'Blocked', color: '#dc2626' },
  { key: 'done', ar: 'مكتمل', en: 'Completed', color: '#16a34a' },
  { key: 'cancelled', ar: 'ملغي', en: 'Cancelled', color: '#64748b' },
];
const ACTION_STATUS_KEYS = ACTION_STATUSES.map((s) => s.key);
const OPEN_ACTION_STATUSES = ['open', 'in_progress', 'blocked'];

const PRIORITIES = [
  { key: 'low', ar: 'منخفضة', en: 'Low', color: '#94a3b8' },
  { key: 'medium', ar: 'متوسطة', en: 'Medium', color: '#0ea5e9' },
  { key: 'high', ar: 'عالية', en: 'High', color: '#f59e0b' },
  { key: 'urgent', ar: 'عاجلة', en: 'Urgent', color: '#dc2626' },
];
const PRIORITY_KEYS = PRIORITIES.map((p) => p.key);

// ── Tiers ───────────────────────────────────────────────────────────────────
// The board: sees every meeting, every action, every delegation.
const EXECUTIVE_ROLES = [...new Set([...FULL_ACCESS_ROLES, 'admin', 'moderator'])];

// The secretariat: runs the meetings, writes the minutes, records the actions.
// asmaa@energize.com sits here via the `administrator` role.
const SECRETARY_ROLES = ['administrator'];

// Department heads whose role key does NOT end in `_manager`. Everything that
// does end in `_manager` is picked up automatically — that is the whole point.
const EXTRA_MANAGER_ROLES = ['b2c_head', 'operations', 'moderator'];

/** Is this role a department head who belongs in the room? */
const isManagerRole = (role) => {
  if (!role) return false;
  if (EXECUTIVE_ROLES.includes(role)) return true;
  if (SECRETARY_ROLES.includes(role)) return true;
  if (EXTRA_MANAGER_ROLES.includes(role)) return true;
  return /_manager$/.test(role); // ← any future *_manager role, for free
};

const isExecutive = (user) => !!user && EXECUTIVE_ROLES.includes(user.role);
const isSecretary = (user) => !!user && SECRETARY_ROLES.includes(user.role);
/** May run the forum: create meetings, write minutes, raise actions. */
const canRunMeetings = (user) => isExecutive(user) || isSecretary(user);
/** Belongs in the room at all (as opposed to only receiving delegated work). */
const isParticipant = (user) => !!user && isManagerRole(user.role);

/**
 * The departments a meeting can be about. Sourced from the permission matrix's
 * own section list, plus the standing ones the forum always covers, so a new
 * section is offered the moment it is added there.
 */
const departments = () => [
  ...SECTION_KEYS,
  'Executive',
  'Administration',
].filter((v, i, a) => a.indexOf(v) === i);

const meta = () => ({
  cadences: CADENCES,
  meetingStatuses: MEETING_STATUSES,
  actionStatuses: ACTION_STATUSES,
  priorities: PRIORITIES,
  departments: departments(),
});

module.exports = {
  CADENCES, CADENCE_KEYS,
  MEETING_STATUSES, MEETING_STATUS_KEYS,
  ACTION_STATUSES, ACTION_STATUS_KEYS, OPEN_ACTION_STATUSES,
  PRIORITIES, PRIORITY_KEYS,
  EXECUTIVE_ROLES, SECRETARY_ROLES, EXTRA_MANAGER_ROLES,
  isManagerRole, isExecutive, isSecretary, canRunMeetings, isParticipant,
  departments, meta,
};
