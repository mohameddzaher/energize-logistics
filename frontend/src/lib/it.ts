// Shared types, labels and formatters for the Software & IT section pages.

export type Lang = 'en' | 'ar';

export const IT_STAFF_ROLES = ['super_admin', 'admin', 'it_manager', 'it_specialist'];
export const IT_ADMIN_ROLES = ['super_admin', 'admin', 'it_manager'];

export const isItStaff = (role?: string | null) => !!role && IT_STAFF_ROLES.includes(role);
export const isItAdmin = (role?: string | null) => !!role && IT_ADMIN_ROLES.includes(role);

// ── Types ───────────────────────────────────────────────────────────────────

export interface EmployeeRef {
  _id: string;
  firstName?: string;
  lastName?: string;
  arabicName?: string;
  employeeNumber?: string;
  iqamaNumber?: string;
  department?: string;
}

export interface UserRef { _id: string; firstName?: string; lastName?: string }

export interface Ticket {
  _id: string;
  ticketNumber?: string;
  title: string;
  category: string;
  priority: string;
  status: string;
  requester?: EmployeeRef | string | null;
  requesterName?: string;
  requesterDepartment?: string;
  assignedTo?: UserRef | string | null;
  assignedToName?: string;
  reportedAt?: string;
  resolvedAt?: string;
  resolutionMinutes?: number;
  description?: string;
  resolution?: string;
  rootCause?: string;
  preventiveAction?: string;
  relatedAsset?: { _id: string; name?: string; serialNumber?: string; type?: string } | string | null;
  device?: string;
  isRecurring?: boolean;
  signature?: string;
  notes?: string;
  createdAt?: string;
}

export interface CustodyItem {
  _id: string;
  employee?: EmployeeRef | string | null;
  name: string;
  type: string;
  serialNumber?: string;
  brand?: string;
  model?: string;
  specs?: string;
  category?: string;
  condition?: string;
  value?: number;
  assignedDate?: string;
  status: string;
  returnedDate?: string;
  returnedCondition?: string;
  assignedBy?: UserRef | string | null;
  issuedBySection?: string;
  notes?: string;
}

export interface ItSystem {
  _id: string;
  name: string;
  nameAr?: string;
  type: string;
  status: string;
  owner?: UserRef | string | null;
  vendor?: string;
  url?: string;
  environment?: string;
  renewalDate?: string;
  cost?: number;
  costPeriod?: string;
  credentialsNote?: string;
  description?: string;
  notes?: string;
}

export interface RecurringGroup {
  signature: string;
  sampleTitle: string;
  category: string;
  count: number;
  firstReportedAt?: string | null;
  lastReportedAt?: string | null;
  avgResolutionMinutes: number;
  affectedDepartments: string[];
  ticketIds: string[];
}

export interface CountRow { key: string; count: number }

export interface Dashboard {
  totals: {
    openTickets: number;
    inProgress: number;
    resolvedThisPeriod: number;
    avgResolutionMinutes: number;
    ticketsByCategory: CountRow[];
    ticketsByPriority: CountRow[];
    ticketsByStatus: CountRow[];
    timeline: { date: string; opened: number; resolved: number }[];
    assetsAssigned: number;
    assetsInStock: number;
    systemsByStatus: CountRow[];
    renewalsDueSoon: ItSystem[];
  };
  topRecurring: RecurringGroup[];
  recentTickets: Ticket[];
  range?: { from: string; to: string };
}

// ── Label maps ──────────────────────────────────────────────────────────────

type Style = { en: string; ar: string; bg: string; text: string };

export const TICKET_CATEGORIES: Record<string, Style> = {
  hardware: { en: 'Hardware', ar: 'أجهزة', bg: 'bg-slate-500/15', text: 'text-slate-700' },
  software: { en: 'Software', ar: 'برامج', bg: 'bg-indigo-500/15', text: 'text-indigo-700' },
  network: { en: 'Network', ar: 'الشبكة', bg: 'bg-cyan-500/15', text: 'text-cyan-700' },
  email: { en: 'Email', ar: 'البريد الإلكتروني', bg: 'bg-blue-500/15', text: 'text-blue-700' },
  printer: { en: 'Printer', ar: 'الطابعات', bg: 'bg-amber-500/15', text: 'text-amber-700' },
  account_access: { en: 'Account / Access', ar: 'الحسابات والصلاحيات', bg: 'bg-violet-500/15', text: 'text-violet-700' },
  erp_system: { en: 'ERP System', ar: 'نظام ERP', bg: 'bg-orange-500/15', text: 'text-orange-700' },
  phone: { en: 'Phone', ar: 'الهاتف', bg: 'bg-teal-500/15', text: 'text-teal-700' },
  security: { en: 'Security', ar: 'الأمن السيبراني', bg: 'bg-red-500/15', text: 'text-red-700' },
  other: { en: 'Other', ar: 'أخرى', bg: 'bg-slate-500/15', text: 'text-slate-700' },
};

export const TICKET_PRIORITIES: Record<string, Style> = {
  low: { en: 'Low', ar: 'منخفضة', bg: 'bg-slate-500/15', text: 'text-slate-700' },
  medium: { en: 'Medium', ar: 'متوسطة', bg: 'bg-blue-500/15', text: 'text-blue-700' },
  high: { en: 'High', ar: 'عالية', bg: 'bg-amber-500/20', text: 'text-amber-700' },
  urgent: { en: 'Urgent', ar: 'عاجلة', bg: 'bg-red-500/20', text: 'text-red-700' },
};

export const TICKET_STATUSES: Record<string, Style> = {
  open: { en: 'Open', ar: 'مفتوحة', bg: 'bg-amber-500/20', text: 'text-amber-700' },
  in_progress: { en: 'In Progress', ar: 'قيد التنفيذ', bg: 'bg-blue-500/20', text: 'text-blue-700' },
  resolved: { en: 'Resolved', ar: 'تم الحل', bg: 'bg-green-500/20', text: 'text-green-700' },
  closed: { en: 'Closed', ar: 'مغلقة', bg: 'bg-slate-500/20', text: 'text-slate-700' },
  reopened: { en: 'Reopened', ar: 'أعيد فتحها', bg: 'bg-red-500/20', text: 'text-red-700' },
};

export const CUSTODY_TYPES: Record<string, Style> = {
  laptop: { en: 'Laptop', ar: 'لابتوب', bg: 'bg-indigo-500/15', text: 'text-indigo-700' },
  phone: { en: 'Phone', ar: 'هاتف', bg: 'bg-teal-500/15', text: 'text-teal-700' },
  sim: { en: 'SIM Card', ar: 'شريحة اتصال', bg: 'bg-cyan-500/15', text: 'text-cyan-700' },
  access_card: { en: 'Access Card', ar: 'بطاقة دخول', bg: 'bg-violet-500/15', text: 'text-violet-700' },
  tool: { en: 'Tool', ar: 'أداة', bg: 'bg-amber-500/15', text: 'text-amber-700' },
  vehicle: { en: 'Vehicle', ar: 'مركبة', bg: 'bg-slate-500/15', text: 'text-slate-700' },
  other: { en: 'Other', ar: 'أخرى', bg: 'bg-slate-500/15', text: 'text-slate-700' },
};

// The types IT actually hands out (everything but vehicles) — used for the
// create-modal dropdown and the filter bar.
export const IT_CUSTODY_TYPE_KEYS = ['laptop', 'phone', 'sim', 'access_card', 'tool', 'other'];

export const CONDITIONS: Record<string, Style> = {
  new: { en: 'New', ar: 'جديد', bg: 'bg-green-500/15', text: 'text-green-700' },
  good: { en: 'Good', ar: 'جيد', bg: 'bg-blue-500/15', text: 'text-blue-700' },
  fair: { en: 'Fair', ar: 'مقبول', bg: 'bg-amber-500/15', text: 'text-amber-700' },
  damaged: { en: 'Damaged', ar: 'تالف', bg: 'bg-red-500/15', text: 'text-red-700' },
};

export const CUSTODY_STATUSES: Record<string, Style> = {
  assigned: { en: 'Assigned', ar: 'بعهدة الموظف', bg: 'bg-amber-500/20', text: 'text-amber-700' },
  returned: { en: 'Returned', ar: 'تم الاسترجاع', bg: 'bg-green-500/20', text: 'text-green-700' },
};

export const SYSTEM_TYPES: Record<string, Style> = {
  erp: { en: 'ERP', ar: 'نظام ERP', bg: 'bg-orange-500/15', text: 'text-orange-700' },
  website: { en: 'Website', ar: 'موقع إلكتروني', bg: 'bg-blue-500/15', text: 'text-blue-700' },
  email: { en: 'Email', ar: 'البريد الإلكتروني', bg: 'bg-cyan-500/15', text: 'text-cyan-700' },
  server: { en: 'Server', ar: 'خادم', bg: 'bg-slate-500/15', text: 'text-slate-700' },
  network_device: { en: 'Network Device', ar: 'جهاز شبكة', bg: 'bg-teal-500/15', text: 'text-teal-700' },
  database: { en: 'Database', ar: 'قاعدة بيانات', bg: 'bg-violet-500/15', text: 'text-violet-700' },
  saas: { en: 'SaaS Subscription', ar: 'اشتراك سحابي', bg: 'bg-indigo-500/15', text: 'text-indigo-700' },
  backup: { en: 'Backup', ar: 'نسخ احتياطي', bg: 'bg-green-500/15', text: 'text-green-700' },
  other: { en: 'Other', ar: 'أخرى', bg: 'bg-slate-500/15', text: 'text-slate-700' },
};

export const SYSTEM_STATUSES: Record<string, Style> = {
  operational: { en: 'Operational', ar: 'يعمل', bg: 'bg-green-500/20', text: 'text-green-700' },
  degraded: { en: 'Degraded', ar: 'أداء منخفض', bg: 'bg-amber-500/20', text: 'text-amber-700' },
  down: { en: 'Down', ar: 'متوقف', bg: 'bg-red-500/20', text: 'text-red-700' },
  maintenance: { en: 'Maintenance', ar: 'صيانة', bg: 'bg-blue-500/20', text: 'text-blue-700' },
  retired: { en: 'Retired', ar: 'خارج الخدمة', bg: 'bg-slate-500/20', text: 'text-slate-700' },
};

export const ENVIRONMENTS: Record<string, Style> = {
  production: { en: 'Production', ar: 'الإنتاج', bg: 'bg-red-500/15', text: 'text-red-700' },
  staging: { en: 'Staging', ar: 'التجريبي', bg: 'bg-amber-500/15', text: 'text-amber-700' },
  development: { en: 'Development', ar: 'التطوير', bg: 'bg-blue-500/15', text: 'text-blue-700' },
};

export const COST_PERIODS: Record<string, Style> = {
  monthly: { en: 'Monthly', ar: 'شهري', bg: 'bg-slate-500/15', text: 'text-slate-700' },
  yearly: { en: 'Yearly', ar: 'سنوي', bg: 'bg-slate-500/15', text: 'text-slate-700' },
  one_time: { en: 'One-time', ar: 'مرة واحدة', bg: 'bg-slate-500/15', text: 'text-slate-700' },
};

// ── Label helpers ───────────────────────────────────────────────────────────

const labelFrom = (map: Record<string, Style>, key: string, lang: Lang) =>
  map[key] ? map[key][lang] : key || '—';

export const styleOf = (map: Record<string, Style>, key: string) => map[key] || null;

export const categoryLabel = (k: string, lang: Lang) => labelFrom(TICKET_CATEGORIES, k, lang);
export const priorityLabel = (k: string, lang: Lang) => labelFrom(TICKET_PRIORITIES, k, lang);
export const ticketStatusLabel = (k: string, lang: Lang) => labelFrom(TICKET_STATUSES, k, lang);
export const custodyTypeLabel = (k: string, lang: Lang) => labelFrom(CUSTODY_TYPES, k, lang);
export const custodyStatusLabel = (k: string, lang: Lang) => labelFrom(CUSTODY_STATUSES, k, lang);
export const conditionLabel = (k: string, lang: Lang) => labelFrom(CONDITIONS, k, lang);
export const systemTypeLabel = (k: string, lang: Lang) => labelFrom(SYSTEM_TYPES, k, lang);
export const systemStatusLabel = (k: string, lang: Lang) => labelFrom(SYSTEM_STATUSES, k, lang);
export const environmentLabel = (k: string, lang: Lang) => labelFrom(ENVIRONMENTS, k, lang);
export const costPeriodLabel = (k: string, lang: Lang) => labelFrom(COST_PERIODS, k, lang);

// Turn a label map into [{key,en,ar}] for <option> lists.
export const optionsOf = (map: Record<string, Style>, only?: string[]) =>
  Object.entries(map)
    .filter(([k]) => !only || only.includes(k))
    .map(([key, v]) => ({ key, en: v.en, ar: v.ar }));

// ── Formatters ──────────────────────────────────────────────────────────────

export const today = () => new Date().toISOString().slice(0, 10);

export const daysAgo = (n: number) =>
  new Date(Date.now() - n * 86400000).toISOString().slice(0, 10);

export const fmtDate = (v?: string | null) => (v ? new Date(v).toLocaleDateString('en-GB') : '—');

export const fmtDateTime = (v?: string | Date | null) =>
  v ? new Date(v).toLocaleString('en-GB', { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—';

export const fmtMoney = (v?: number | null) =>
  typeof v === 'number' ? v.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 2 }) : '—';

// Minutes → "2d 3h" / "٢ ي ٣ س". Resolution times span minutes to weeks, so the
// unit has to adapt or the number becomes unreadable.
export const fmtDuration = (minutes?: number | null, lang: Lang = 'en') => {
  if (minutes === undefined || minutes === null || !Number.isFinite(minutes)) return '—';
  const m = Math.max(0, Math.round(minutes));
  if (m < 60) return lang === 'ar' ? `${m} د` : `${m}m`;
  const h = Math.floor(m / 60);
  const mm = m % 60;
  if (h < 24) {
    if (lang === 'ar') return mm ? `${h} س ${mm} د` : `${h} س`;
    return mm ? `${h}h ${mm}m` : `${h}h`;
  }
  const d = Math.floor(h / 24);
  const hh = h % 24;
  if (lang === 'ar') return hh ? `${d} ي ${hh} س` : `${d} ي`;
  return hh ? `${d}d ${hh}h` : `${d}d`;
};

export const daysUntil = (v?: string | null): number | null => {
  if (!v) return null;
  const t = new Date(`${v}T00:00:00`).getTime();
  if (!Number.isFinite(t)) return null;
  return Math.ceil((t - new Date(new Date().toDateString()).getTime()) / 86400000);
};

// Renewal urgency colouring: overdue → red, ≤30d → amber, else calm.
export const renewalTone = (v?: string | null) => {
  const d = daysUntil(v);
  if (d === null) return 'text-slate-500';
  if (d < 0) return 'text-red-600 font-semibold';
  if (d <= 30) return 'text-amber-600 font-semibold';
  return 'text-slate-700';
};

export const empName = (e: any, lang: Lang = 'en'): string => {
  if (!e) return '—';
  if (typeof e === 'string') return e;
  if (lang === 'ar' && e.arabicName) return e.arabicName;
  const n = `${e.firstName || ''} ${e.lastName || ''}`.trim();
  return n || e.arabicName || '—';
};

export const userName = (u: any): string => {
  if (!u) return '—';
  if (typeof u === 'string') return u;
  return `${u.firstName || ''} ${u.lastName || ''}`.trim() || '—';
};

export const idOf = (v: any): string => (!v ? '' : typeof v === 'string' ? v : v._id || '');
