// اجتماعات مراجعة الأعمال — shared types, vocabulary and client.
//
// The vocabularies (cadences, statuses, priorities, departments) all come from
// the SERVER via /meta, so adding a cadence or a department is a backend-only
// change. What lives here is only what the browser needs to render them.
import api from '@/lib/api';
import { getSectionLabel } from '@/lib/translations';

export type Lang = 'ar' | 'en';

// ── Who belongs in the room ─────────────────────────────────────────────────
// MIRRORS backend/src/config/businessReview.js. Kept as a rule, not a list, for
// the same reason it is a rule there: a role added tomorrow that ends in
// `_manager` is a meeting participant today, with no edit here. The server is
// still the authority — this only decides which sidebar links are worth showing.
const BR_EXECUTIVE_ROLES = ['super_admin', 'admin', 'it_manager', 'it_specialist', 'moderator'];
const BR_SECRETARY_ROLES = ['administrator'];
const BR_EXTRA_MANAGER_ROLES = ['b2c_head', 'operations', 'moderator'];

/** Runs the forum: schedules meetings, writes minutes, raises actions. */
export const isBrRunner = (role?: string | null) =>
  !!role && (BR_EXECUTIVE_ROLES.includes(role) || BR_SECRETARY_ROLES.includes(role));

/** Sits in the room — i.e. a department head or the board, not a team member. */
export const isBrParticipant = (role?: string | null) => {
  if (!role) return false;
  if (isBrRunner(role)) return true;
  if (BR_EXTRA_MANAGER_ROLES.includes(role)) return true;
  return /_manager$/.test(role);
};
export const tx = (lang: Lang, en: string, ar: string) => (lang === 'ar' ? ar : en);

export interface Vocab { key: string; ar: string; en: string; color?: string; days?: number | null }

export interface BrPerson {
  _id: string; name: string; role: string; department?: string; jobTitle?: string;
  /** The board tier — pre-selected as attendees and always offered as "requested by". */
  isExecutive?: boolean;
}

/**
 * Department keys come from the backend's section list and are English keys
 * ('Software & IT'). Never print them raw — the whole UI is Arabic by default.
 */
export const deptLabel = (key: string, lang: Lang) => getSectionLabel(key, lang);

export interface BrMeta {
  cadences: Vocab[];
  meetingStatuses: Vocab[];
  actionStatuses: Vocab[];
  priorities: Vocab[];
  departments: string[];
  participants: BrPerson[];
  people: BrPerson[];
  me: {
    _id: string; name: string; role: string;
    isExecutive: boolean; isSecretary: boolean;
    canRunMeetings: boolean; isParticipant: boolean;
  };
}

export interface BrAttendee {
  user: string; name: string; role: string; department?: string;
  attendance: 'invited' | 'attended' | 'absent' | 'excused';
  /** When the attendance was recorded, and by whom. */
  attendanceAt?: string | null;
  attendanceByName?: string;
  /** Why they were not there (اعتذر ليه). */
  excuseReason?: string;
  isChair?: boolean;
}

export const ATTENDANCE = [
  { key: 'attended', ar: 'حضر', en: 'Present', color: '#16a34a' },
  { key: 'absent', ar: 'لم يحضر', en: 'Absent', color: '#dc2626' },
  { key: 'excused', ar: 'اعتذر', en: 'Excused', color: '#d97706' },
  { key: 'invited', ar: 'مدعو', en: 'Invited', color: '#94a3b8' },
];
export const attendanceLabel = (k: string | undefined, lang: Lang) => {
  const a = ATTENDANCE.find((x) => x.key === (k || 'invited'));
  return a ? (lang === 'ar' ? a.ar : a.en) : (k || '—');
};
export const attendanceColor = (k: string | undefined) =>
  ATTENDANCE.find((x) => x.key === (k || 'invited'))?.color || '#94a3b8';

export interface BrAgendaItem { title: string; presenterName?: string; department?: string; order?: number }
export interface BrMinuteItem { heading: string; body: string; department?: string; order?: number }

export interface BrMeeting {
  _id: string;
  refNumber: string;
  title: string;
  cadence: string;
  departments: string[];
  scheduledAt: string;
  durationMinutes?: number;
  location?: string;
  meetingLink?: string;
  status: string;
  heldAt?: string | null;
  // «اكتمل» غير «انعقد»: heldAt واقعة، completedAt حُكم من الإدارة إن كل شغل
  // الاجتماع خلص. الاتنين محفوظين منفصلين عن قصد.
  completedAt?: string | null;
  completedByName?: string;
  completionNote?: string;
  attendees: BrAttendee[];
  agenda: BrAgendaItem[];
  minutes?: BrMinuteItem[];
  summary?: string;
  scribeName?: string;
  createdByName?: string;
  actions?: { total: number; open: number };
}

export interface BrUpdate {
  _id?: string; by?: string; byName?: string; text?: string;
  statusFrom?: string; statusTo?: string; progress?: number | null; at: string;
}

export interface BrDelegation {
  _id: string;
  action: string;
  actionTitle?: string;
  assignee: string; assigneeName: string;
  assignedBy: string; assignedByName: string;
  title: string; instructions?: string;
  dueDate?: string | null; priority: string; status: string;
  progress: number; isOverdue?: boolean; completedAt?: string | null;
  department?: string;
  updates?: BrUpdate[];
}

export interface BrAction {
  _id: string;
  meeting: string; meetingRef: string; meetingTitle: string; meetingDate?: string;
  title: string; description?: string; department?: string;
  assignee: string; assigneeName: string; assigneeRole?: string;
  raisedBy?: string | null; raisedByName?: string;
  dueDate?: string | null; priority: string; status: string;
  progress: number; isOverdue?: boolean; completedAt?: string | null;
  updates?: BrUpdate[];
  delegations?: BrDelegation[];
}

// ── Client ──────────────────────────────────────────────────────────────────
export const brMeta = () => api.get<BrMeta>('/api/business-review/meta');
export const brDashboard = () => api.get<any>('/api/business-review/dashboard');

export const brMeetings = (q: Record<string, string> = {}) => {
  const qs = new URLSearchParams(Object.entries(q).filter(([, v]) => v)).toString();
  return api.get<{
    meetings: BrMeeting[];
    // محسوبة على النطاق كله مش على الصفحة المفلترة — البطاقة بتوصف الشغل، مش الفلتر.
    counts?: { total: number; completed: number; open: number; upcoming: number; cancelled: number };
    canRunMeetings: boolean; participant: boolean;
  }>(`/api/business-review/meetings${qs ? `?${qs}` : ''}`);
};
export const brMeeting = (id: string) =>
  api.get<{ meeting: BrMeeting; actions: BrAction[]; can: { edit: boolean; writeMinutes: boolean; raiseActions: boolean } }>(
    `/api/business-review/meetings/${id}`
  );
export const brCreateMeeting = (body: any) => api.post<{ meeting: BrMeeting }>('/api/business-review/meetings', body);
export const brUpdateMeeting = (id: string, body: any) => api.put<{ meeting: BrMeeting }>(`/api/business-review/meetings/${id}`, body);
/** إقفال الاجتماع — السيرفر بيرفض لو لسه فيه بند أو تكليف مفتوح. */
export const brCompleteMeeting = (id: string, note = '') =>
  api.post<{ meeting: BrMeeting }>(`/api/business-review/meetings/${id}/complete`, { note });
export const brReopenMeeting = (id: string) =>
  api.post<{ meeting: BrMeeting }>(`/api/business-review/meetings/${id}/reopen`, {});

/** أوعية البطاقات — نفس مفاتيح الـ bucket اللي السيرفر بيفهمها. */
export const MEETING_BUCKETS = [
  { key: '', ar: 'كل الاجتماعات', en: 'All meetings', countKey: 'total', color: '#0f172a' },
  { key: 'open', ar: 'لسه مفتوحة', en: 'Still open', countKey: 'open', color: '#f37121' },
  { key: 'completed', ar: 'مكتملة', en: 'Completed', countKey: 'completed', color: '#0f766e' },
  { key: 'upcoming', ar: 'قادمة', en: 'Upcoming', countKey: 'upcoming', color: '#0ea5e9' },
  { key: 'cancelled', ar: 'ملغاة', en: 'Cancelled', countKey: 'cancelled', color: '#94a3b8' },
] as const;
export const brSaveMinutes = (id: string, body: any) => api.put<{ meeting: BrMeeting }>(`/api/business-review/meetings/${id}/minutes`, body);
export const brDeleteMeeting = (id: string) => api.delete(`/api/business-review/meetings/${id}`);

export const brCreateAction = (meetingId: string, body: any) =>
  api.post<{ action: BrAction }>(`/api/business-review/meetings/${meetingId}/actions`, body);
export const brUpdateAction = (actionId: string, body: any) =>
  api.patch<{ action: BrAction }>(`/api/business-review/actions/${actionId}`, body);
export const brDeleteAction = (actionId: string) => api.delete(`/api/business-review/actions/${actionId}`);
export const brDelegate = (actionId: string, assignments: any[]) =>
  api.post<{ assignments: BrDelegation[] }>(`/api/business-review/actions/${actionId}/delegate`, { assignments });

export const brMyActions = (open = false) =>
  api.get<{ actions: BrAction[]; summary: any }>(`/api/business-review/my-actions${open ? '?open=1' : ''}`);
export const brAllActions = (q: Record<string, string> = {}) => {
  const qs = new URLSearchParams(Object.entries(q).filter(([, v]) => v)).toString();
  return api.get<{ actions: BrAction[]; summary: any; byPerson: any[] }>(
    `/api/business-review/actions${qs ? `?${qs}` : ''}`
  );
};
export const brMyTasks = (open = false) =>
  api.get<{ assignments: BrDelegation[]; summary: any }>(`/api/business-review/my-tasks${open ? '?open=1' : ''}`);
export const brUpdateTask = (id: string, body: any) =>
  api.patch<{ assignment: BrDelegation }>(`/api/business-review/assignments/${id}`, body);
export const brDeleteTask = (id: string) => api.delete(`/api/business-review/assignments/${id}`);

// ── Display helpers ─────────────────────────────────────────────────────────
export const vocabLabel = (list: Vocab[] | undefined, key: string, lang: Lang) => {
  const v = list?.find((x) => x.key === key);
  return v ? (lang === 'ar' ? v.ar : v.en) : key || '—';
};
export const vocabColor = (list: Vocab[] | undefined, key: string) =>
  list?.find((x) => x.key === key)?.color || '#94a3b8';

export const fmtDate = (d?: string | null) => (d ? new Date(d).toLocaleDateString('en-GB') : '—');
export const fmtDateTime = (d?: string | null) =>
  (d ? new Date(d).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' }) : '—');

/** How a due date should read: overdue, today, or days left. */
export function dueLabel(due: string | null | undefined, lang: Lang) {
  if (!due) return { text: '—', tone: 'muted' as const };
  const days = Math.ceil((new Date(due).getTime() - Date.now()) / 86400000);
  if (days < 0) return { text: tx(lang, `${Math.abs(days)}d overdue`, `متأخر ${Math.abs(days)} يوم`), tone: 'danger' as const };
  if (days === 0) return { text: tx(lang, 'Due today', 'اليوم'), tone: 'warn' as const };
  if (days <= 2) return { text: tx(lang, `${days}d left`, `باقي ${days} يوم`), tone: 'warn' as const };
  return { text: tx(lang, `${days}d left`, `باقي ${days} يوم`), tone: 'muted' as const };
}

export const TONE_CLASS = {
  danger: 'bg-red-100 text-red-700',
  warn: 'bg-amber-100 text-amber-700',
  muted: 'bg-slate-100 text-slate-600',
  ok: 'bg-green-100 text-green-700',
} as const;

export const OPEN_STATUSES = ['open', 'in_progress', 'blocked'];

/** Local YYYY-MM-DD (never via toISOString — that shifts the day in +03). */
export const isoDay = (d: Date) => {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
};
