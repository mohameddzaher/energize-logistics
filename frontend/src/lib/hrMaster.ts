import { readGregorian } from '@/lib/hijri';
// HR master client for /api/hr/master.
// Required and not-required are kept apart everywhere: required is work to do, not-required is not a gap; mixing them makes the work list meaningless.
import api from '@/lib/api';

export type StatusCode = 'required' | 'not_required' | 'none' | 'filled' | 'cash_payroll' | 'inactive' | 'unparseable';
export type DocState = 'valid' | 'warning' | 'critical' | 'expired' | 'missing' | 'not_applicable';

// number: an amount (salary, allowances); readOnly: read but not written (vehicle data from the vehicle register).
export interface FieldDef { key: string; ar: string; en: string; type: 'text' | 'date' | 'bool' | 'number'; groupable?: boolean; readOnly?: boolean }
export interface FieldCard extends FieldDef {
  group: string; total: number;
  counts: Record<string, number>;
  required: number;
  /** Top 25 values only; the full list is in the filter panel. */
  values?: { value: string; count: number }[];
  /** Count of all distinct values, not just those returned. */
  valuesTotal?: number;
}
export interface GroupCard {
  key: string; ar: string; en: string; icon: string; document: boolean;
  fields: FieldCard[]; required: number;
  states?: Record<DocState, number>;
  expiryField?: string; needsAttention?: number; nearestDays?: number | null;
}
/** Analytics tile: its title, count and the exact filter that opens its rows. */
export interface AnalyticItem { label: string; labelEn: string; count: number; filter: Record<string, string> }
export interface AnalyticBlock {
  key: string; ar: string; en: string; kind: 'bar' | 'horizon'; field?: string; items: AnalyticItem[];
}
export interface HrOverview {
  // employees/active/notActive are what the current filter shows; roster is the total employment file, shown beside it to show what it was cut from.
  totals: { employees: number; active: number; notActive: number; terminated?: number; roster: number; filtered: number; required: number; expiringSoon: number; expiringStates?: Record<string, number>; outsideKingdom: number; freelancers: number; cashPayroll: number; gosiRegistered: number;
    /** In the sponsorship-transfer stage (suspended) and the archive. */
    transfer?: number; archived?: number; finalExit?: number; saudiEnd?: number; noKind?: number; sister?: number;
    /** The two halves of each card: sponsored vs freelance, from the commercial registration number. */
    halves?: Record<string, { sponsored: number; freelance: number }>;
    onDutyDetail?: Record<'sponsored' | 'freelance', { working: number; leave: number }>;
  };
  /** Daily work computed over the matching employees only. */
  work: { pendingLeaves: number; openRequests: number; assignedAssets: number };
  groups: GroupCard[];
  topRequired: (FieldCard & { groupAr: string; groupKey: string })[];
  analytics: AnalyticBlock[];
  alert: { warnDays: number; criticalDays: number };
  /** The condition the expiries were counted with (staff whose service has not ended, unless another is chosen). Carried in every link that opens an expiry number so it opens exactly those rows. */
  expiryScope?: Record<string, string>;
}

export interface RecordRow {
  _id: string; employeeNumber: string; name: string;
  /** Returned in every group even if not one of its fields; all department tables show it and search by it. */
  iqamaNumber?: string;
  department?: string; branchName?: string; project?: string;
  workStatusText?: string; employmentStatus?: string;
  values: Record<string, any>;
  statuses: Record<string, StatusCode>;
  state: DocState | null; daysRemaining: number | null;
  missing: { key: string; ar: string }[];
}

export const STATUS_META: Record<string, { ar: string; en: string; color: string; bg: string }> = {
  required: { ar: 'مطلوب', en: 'Required', color: '#dc2626', bg: 'bg-red-100 text-red-700' },
  not_required: { ar: 'غير مطلوب', en: 'Not required', color: '#64748b', bg: 'bg-slate-100 text-slate-600' },
  none: { ar: 'لا يوجد', en: 'None', color: '#94a3b8', bg: 'bg-slate-100 text-slate-500' },
  // Entered: the cell holds a written value; see its twin in config/hrFields.
  filled: { ar: 'مُدخَل', en: 'Filled', color: '#16a34a', bg: 'bg-emerald-100 text-emerald-700' },
  cash_payroll: { ar: 'راتب نقدي', en: 'Cash payroll', color: '#8b5cf6', bg: 'bg-violet-100 text-violet-700' },
  inactive: { ar: 'غير نشط', en: 'Inactive', color: '#b45309', bg: 'bg-amber-100 text-amber-800' },
  unparseable: { ar: 'تاريخ غير مقروء', en: 'Unreadable', color: '#f59e0b', bg: 'bg-amber-100 text-amber-700' },
};
export const STATE_META: Record<string, { ar: string; en: string; color: string; bg: string }> = {
  valid: { ar: 'ساري', en: 'Valid', color: '#16a34a', bg: 'bg-emerald-100 text-emerald-700' },
  warning: { ar: 'قارب على الانتهاء', en: 'Due soon', color: '#f59e0b', bg: 'bg-amber-100 text-amber-700' },
  critical: { ar: 'ينتهي قريبًا جدًا', en: 'Critical', color: '#ea580c', bg: 'bg-orange-100 text-orange-700' },
  expired: { ar: 'منتهي', en: 'Expired', color: '#dc2626', bg: 'bg-red-100 text-red-700' },
  missing: { ar: 'بدون تاريخ', en: 'No date', color: '#94a3b8', bg: 'bg-slate-100 text-slate-600' },
  not_applicable: { ar: 'لا ينطبق', en: 'Not applicable', color: '#64748b', bg: 'bg-slate-100 text-slate-500' },
  // A combined status for the three that need action. The strip number counts expired, critical and soon together; without a value that groups them, clicking the number would not open exactly those rows.
  attention: { ar: 'يحتاج انتباهًا', en: 'Needs attention', color: '#dc2626', bg: 'bg-rose-100 text-rose-700' },
};
/** Status to display, never empty. See its twin in lib/vehicleRegistry: reading a color from a missing key crashes the whole screen, not just the cell. */
export const statusMeta = (c?: string | null) =>
  STATUS_META[c || 'none'] || { ...STATUS_META.none, ar: String(c || '—'), en: String(c || '—') };
export const stateMeta = (c?: string | null) =>
  STATE_META[c || 'valid'] || { ...STATE_META.not_applicable, ar: String(c || '—'), en: String(c || '—') };

export const statusLabel = (c: string, ar: boolean) => (STATUS_META[c] ? (ar ? STATUS_META[c].ar : STATUS_META[c].en) : c);
export const stateLabel = (c: string, ar: boolean) => (STATE_META[c] ? (ar ? STATE_META[c].ar : STATE_META[c].en) : c);

export const fmtDate = (d?: string | Date | null) => {
  if (!d) return '—';
  const x = readGregorian(d);
  return x ? x.toISOString().slice(0, 10) : String(d);
};

/** Value as accepted by <input type="date">. Date fields here sometimes hold an administrative word instead of a date, and new Date(word).toISOString() throws, which would take down the whole screen. */
export const toDateInput = (v?: string | Date | null) => {
  if (!v) return '';
  const d = readGregorian(v);
  return d ? d.toISOString().slice(0, 10) : '';
};
/** Expiry fields and the name of each one's duration column. Five master columns share the title 'expiry date' and differ only by group, so each duration column gets an explicit unambiguous name, which also identifies which dates are expiries. */
export const EXPIRY_FIELDS: Record<string, { ar: string; en: string }> = {
  iqamaExpiry: { ar: 'المدة بالأيام — الإقامة', en: 'Days left — Iqama' },
  passportExpiry: { ar: 'المدة بالأيام — الجواز', en: 'Days left — Passport' },
  contractEndDate: { ar: 'المدة بالأيام — العقد', en: 'Days left — Contract' },
  workPermitExpiry: { ar: 'المدة بالأيام — رخصة العمل', en: 'Days left — Work permit' },
  insuranceExpiry: { ar: 'المدة بالأيام — التأمين', en: 'Days left — Insurance' },
  healthCertExpiry: { ar: 'المدة بالأيام — الشهادة الصحية', en: 'Days left — Health certificate' },
  driverCardExpiry: { ar: 'المدة بالأيام — بطاقة السائق', en: 'Days left — Driver card' },
  licenseExpiry: { ar: 'المدة بالأيام — رخصة القيادة', en: 'Days left — Driving licence' },
};

export const isExpiryField = (key: string): boolean => Object.hasOwn(EXPIRY_FIELDS, key);

/** Duration column name for this expiry. */
export const daysColLabel = (key: string, ar: boolean): string => {
  const m = EXPIRY_FIELDS[key];
  return m ? (ar ? m.ar : m.en) : (ar ? 'المدة بالأيام' : 'Days left');
};

/** Days until the date: negative if past, null if no date. Computed at read time, never stored, because a stored number is stale the next day. */
export const daysUntil = (d?: string | Date | null): number | null => {
  if (!d) return null;
  const x = new Date(d);
  if (Number.isNaN(x.getTime())) return null;
  const a = new Date(x); a.setHours(0, 0, 0, 0);
  const b = new Date(); b.setHours(0, 0, 0, 0);
  return Math.round((a.getTime() - b.getTime()) / 86400000);
};

export const daysText = (n: number | null | undefined, ar: boolean) => {
  if (n === null || n === undefined) return '—';
  if (n < 0) return ar ? `متأخر ${Math.abs(n)} يوم` : `${Math.abs(n)}d overdue`;
  return ar ? `${n} يوم` : `${n}d`;
};

const qs = (q: Record<string, any>) =>
  new URLSearchParams(Object.entries(q).filter(([, v]) => v !== undefined && v !== '' && v !== null).map(([k, v]) => [k, String(v)])).toString();

export const getHrOverview = (q: Record<string, any> = {}) =>
  api.get<HrOverview>(`/api/hr/master/overview${qs(q) ? `?${qs(q)}` : ''}`);

export const getHrRecords = (group: string, q: Record<string, any> = {}) =>
  api.get<{
    group: { key: string; ar: string; en: string; document: boolean; expiryField: string | null; fields: FieldDef[] };
    rows: RecordRow[];
    summary: Record<string, any>;
  }>(`/api/hr/master/records/${group}${qs(q) ? `?${qs(q)}` : ''}`);

export const getHrExpiring = (q: Record<string, any> = {}) =>
  api.get<{ rows: any[]; shown?: number; summary: Record<string, number>; byDoc: { key: string; ar: string; en: string; count: number }[]; withinDays: number | null;
    options?: Record<string, { value: string; count: number }[]>;
    alert?: { warnDays: number; criticalDays: number }; expiryScope?: Record<string, string> }>(
    `/api/hr/master/expiring${qs(q) ? `?${qs(q)}` : ''}`);

/** Fill in missing fields. The required status is cleared automatically on the server. */
export const updateEmployeeFields = (id: string, fields: Record<string, any>, markStatus?: Record<string, string>) =>
  api.patch<{ employee: any; statuses: Record<string, StatusCode>; rejected: string[] }>(
    `/api/hr/master/employees/${id}/fields`, { fields, markStatus });

/** Renew one document: writes the new date and leaves a trail of who renewed it and from which date. */
export const renewHrDocument = (body: {
  employee: string; group: string; newExpiry: string; documentNumber?: string; notes?: string;
}) => api.post<{ employee: any; renewal: any }>('/api/hr/master/renew', body);

/** Renew a batch with one date, all or nothing: if any row fails validation nothing is written and the error returns in `errors` with the row number, since a silent partial renewal is worse than a clear failure. */
export const renewHrBulk = (body: {
  items: { employee: string; group: string }[]; newExpiry: string; notes?: string;
}) => api.post<{ renewed: any[]; summary: { count: number; employees: number } }>(
  '/api/hr/master/renew-bulk', body);

/** Groups that have an expiry date and so can be renewed. */
export const RENEWABLE_GROUPS = new Set([
  'iqama', 'passport', 'contract', 'workPermit', 'medicalInsurance', 'healthCertificate', 'driverCard', 'drivingLicense',
  'visa', 'ajeer',
]);

/** Employment status labels in the filter panel, one source for all master pages. 'On the workforce' means everyone whose service has not ended (active, on leave or suspended) and is the scope for expiry counts. See EXPIRY_SCOPE on the server. */
export const HR_EMPLOYMENT_LABELS = {
  ar: 'حالة التوظيف', en: 'Employment', values: {
    active: { ar: 'على رأس العمل', en: 'Active' },
    inactive: { ar: 'ليس على رأس العمل', en: 'Not active' },
    current: { ar: 'على قوّة العمل (لم تنتهِ خدمته)', en: 'Current workforce' },
    terminated: { ar: 'منتهية خدمته', en: 'Service ended' },
    all: { ar: 'الجميع بمن انتهت خدمتهم', en: 'Everyone incl. ended' },
  },
};

export const getHrFieldConfig = () =>
  api.get<{ groups: (GroupCard & { fields: FieldDef[] })[]; statuses: any; states: any; alert: any }>('/api/hr/master/field-config');

/** Filterable fields and their values with counts, computed over what remains after the other filters. */
export const getHrFilters = (q: Record<string, any> = {}) =>
  api.get<{ filters: { key: string; ar: string; en: string; groupAr: string; groupEn: string; values: { value: string; count: number }[] }[]; dateFields: string[] }>(
    `/api/hr/master/filters${qs(q) ? `?${qs(q)}` : ''}`);

/** Names of date fields that accept a range; shown in the filter panel. */
/** Numeric range filters read in years or days, not dates. Ranges written in years stay valid tomorrow while date ranges go stale. */
export interface NumRangeDef { key: string; ar: string; en: string; unitAr: string; unitEn: string; min?: number; max?: number }
export const HR_NUM_RANGES: NumRangeDef[] = [
  { key: 'age', ar: 'العمر', en: 'Age', unitAr: 'سنة', unitEn: 'years', min: 15, max: 90 },
  { key: 'tenure', ar: 'سنوات الخدمة', en: 'Years of service', unitAr: 'سنة', unitEn: 'years', min: 0, max: 50 },
  // Remaining days: negative is past, so 'expired a month ago to expiring in a month' is -30 to 30.
  { key: 'iqamaExpiryDays', ar: 'الإقامة — الأيام المتبقّية', en: 'Iqama — days left', unitAr: 'يوم', unitEn: 'days' },
  { key: 'contractEndDateDays', ar: 'العقد — الأيام المتبقّية', en: 'Contract — days left', unitAr: 'يوم', unitEn: 'days' },
  { key: 'passportExpiryDays', ar: 'الجواز — الأيام المتبقّية', en: 'Passport — days left', unitAr: 'يوم', unitEn: 'days' },
  { key: 'insuranceExpiryDays', ar: 'التأمين الطبي — الأيام المتبقّية', en: 'Medical — days left', unitAr: 'يوم', unitEn: 'days' },
  { key: 'licenseExpiryDays', ar: 'رخصة القيادة — الأيام المتبقّية', en: 'Licence — days left', unitAr: 'يوم', unitEn: 'days' },
  { key: 'workPermitExpiryDays', ar: 'رخصة العمل — الأيام المتبقّية', en: 'Work permit — days left', unitAr: 'يوم', unitEn: 'days' },
];

export const HR_DATE_FIELDS = [
  { key: 'hireDate', ar: 'تاريخ التعيين', en: 'Hire date' },
  { key: 'dateOfBirth', ar: 'تاريخ الميلاد', en: 'Date of birth' },
  { key: 'iqamaExpiry', ar: 'انتهاء الإقامة', en: 'Iqama expiry' },
  { key: 'passportExpiry', ar: 'انتهاء الجواز', en: 'Passport expiry' },
  { key: 'contractStartDate', ar: 'بداية العقد', en: 'Contract start' },
  { key: 'contractEndDate', ar: 'نهاية العقد', en: 'Contract end' },
  { key: 'workPermitExpiry', ar: 'انتهاء رخصة العمل', en: 'Work permit expiry' },
  { key: 'insuranceExpiry', ar: 'انتهاء التأمين الطبي', en: 'Medical insurance expiry' },
  { key: 'healthCertExpiry', ar: 'انتهاء الشهادة الصحية', en: 'Health certificate expiry' },
  { key: 'driverCardExpiry', ar: 'انتهاء بطاقة السائق', en: 'Driver card expiry' },
  { key: 'licenseExpiry', ar: 'انتهاء رخصة القيادة', en: 'Licence expiry' },
];
