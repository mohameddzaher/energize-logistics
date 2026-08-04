// Shared helpers for the Remote (work-from-home) section pages.
import { canAccessSection, roleOf, permsOf, type RoleOrUser } from './sections';

export const REMOTE_STAFF_ROLES = ['super_admin', 'admin', 'remote_manager'];

// Role list OR a grant from the permissions matrix — a granted role otherwise
// gets the nav link and then the employee view whose API calls 403.
export const isRemoteStaff = (u: RoleOrUser) =>
  REMOTE_STAFF_ROLES.includes(roleOf(u)) || canAccessSection(permsOf(u), 'Remote');

export const isRemoteEmployee = (role?: string | null) => role === 'remote_employee';

// Minutes → "Xh Ym" / "X س Y د"
export const fmtDuration = (minutes: number, lang: 'en' | 'ar' = 'en') => {
  const m = Math.max(0, Math.round(minutes || 0));
  const h = Math.floor(m / 60);
  const mm = m % 60;
  if (lang === 'ar') {
    if (h && mm) return `${h} س ${mm} د`;
    if (h) return `${h} س`;
    return `${mm} د`;
  }
  if (h && mm) return `${h}h ${mm}m`;
  if (h) return `${h}h`;
  return `${mm}m`;
};

export const fmtTime = (date?: string | Date | null) => {
  if (!date) return '—';
  return new Date(date).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
};

export const fmtDateTime = (date?: string | Date | null) => {
  if (!date) return '—';
  return new Date(date).toLocaleString('en-GB', {
    year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
  });
};

// Today's Cairo-local date as YYYY-MM-DD (for date inputs).
export const cairoToday = () =>
  new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Cairo' }).format(new Date());

// `noNotice` marks the kinds you cannot plan — they are exempt from the
// advance-notice rule and can be filed for today. Mirrors REMOTE_LEAVE_NO_NOTICE
// on the backend, which is what actually enforces it.
export const LEAVE_TYPES: { key: string; en: string; ar: string; noNotice?: boolean }[] = [
  { key: 'annual', en: 'Annual', ar: 'سنوية' },
  { key: 'sick', en: 'Sick', ar: 'مرضية', noNotice: true },
  { key: 'emergency', en: 'Emergency', ar: 'طارئة', noNotice: true },
  { key: 'personal', en: 'Personal', ar: 'شخصية' },
  { key: 'unpaid', en: 'Unpaid', ar: 'بدون راتب' },
  { key: 'other', en: 'Other', ar: 'أخرى' },
];

// The company rule: a planned leave is requested a month ahead.
export const LEAVE_ADVANCE_NOTICE_DAYS = 30;

export const leaveNeedsNotice = (key: string) =>
  !(LEAVE_TYPES.find((t) => t.key === key)?.noNotice);

/** Earliest legal start date (YYYY-MM-DD) for a remote leave of this kind. */
export const earliestLeaveStart = (key: string) => {
  if (!leaveNeedsNotice(key)) return cairoToday();
  const d = new Date();
  d.setDate(d.getDate() + LEAVE_ADVANCE_NOTICE_DAYS);
  return d.toISOString().slice(0, 10);
};

export const leaveTypeLabel = (key: string, lang: 'en' | 'ar') =>
  (LEAVE_TYPES.find((t) => t.key === key) || { en: key, ar: key })[lang];

export const STATUS_STYLES: Record<string, { bg: string; text: string; en: string; ar: string }> = {
  pending: { bg: 'bg-amber-500/20', text: 'text-amber-400', en: 'Pending', ar: 'قيد المراجعة' },
  approved: { bg: 'bg-green-500/20', text: 'text-green-400', en: 'Approved', ar: 'مقبولة' },
  rejected: { bg: 'bg-red-500/20', text: 'text-red-400', en: 'Rejected', ar: 'مرفوضة' },
};
