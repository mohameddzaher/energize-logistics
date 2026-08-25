// عميل ماستر الموارد البشرية — يقابل /api/hr/master.
//
// «مطلوب» و«غير مطلوب» مفصولين في كل حتة عن قصد: «مطلوب» شغل لازم يتعمل،
// و«غير مطلوب» مش نقص أصلاً. خلطهم بيحوّل قايمة الشغل لأرقام مالهاش معنى.
import api from '@/lib/api';

export type StatusCode = 'required' | 'not_required' | 'none' | 'filled' | 'cash_payroll' | 'unparseable';
export type DocState = 'valid' | 'warning' | 'critical' | 'expired' | 'missing' | 'not_applicable';

export interface FieldDef { key: string; ar: string; en: string; type: 'text' | 'date' | 'bool'; groupable?: boolean }
export interface FieldCard extends FieldDef {
  group: string; total: number;
  counts: Record<string, number>;
  required: number;
  values?: { value: string; count: number }[];
}
export interface GroupCard {
  key: string; ar: string; en: string; icon: string; document: boolean;
  fields: FieldCard[]; required: number;
  states?: Record<DocState, number>;
  expiryField?: string; needsAttention?: number; nearestDays?: number | null;
}
/** شريحة تحليلية: عنوانها وعددها والفلتر الذي يفتح صفوفها بالضبط. */
export interface AnalyticItem { label: string; labelEn: string; count: number; filter: Record<string, string> }
export interface AnalyticBlock {
  key: string; ar: string; en: string; kind: 'bar' | 'horizon'; field?: string; items: AnalyticItem[];
}
export interface HrOverview {
  // employees/active/notActive = الملف الوظيفي كله (ما بيتأثروش بالفلتر)،
  // وfiltered = اللي الفلتر الحالي بيعرضه واللي الأرقام التانية محسوبة عليه.
  totals: { employees: number; active: number; notActive: number; filtered: number; required: number; expiringSoon: number; outsideKingdom: number; freelancers: number; cashPayroll: number; gosiRegistered: number };
  groups: GroupCard[];
  topRequired: (FieldCard & { groupAr: string; groupKey: string })[];
  analytics: AnalyticBlock[];
  alert: { warnDays: number; criticalDays: number };
}

export interface RecordRow {
  _id: string; employeeNumber: string; name: string;
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
  filled: { ar: 'مملي', en: 'Filled', color: '#16a34a', bg: 'bg-emerald-100 text-emerald-700' },
  cash_payroll: { ar: 'راتب نقدي', en: 'Cash payroll', color: '#8b5cf6', bg: 'bg-violet-100 text-violet-700' },
  unparseable: { ar: 'تاريخ غير مقروء', en: 'Unreadable', color: '#f59e0b', bg: 'bg-amber-100 text-amber-700' },
};
export const STATE_META: Record<string, { ar: string; en: string; color: string; bg: string }> = {
  valid: { ar: 'ساري', en: 'Valid', color: '#16a34a', bg: 'bg-emerald-100 text-emerald-700' },
  warning: { ar: 'قارب على الانتهاء', en: 'Due soon', color: '#f59e0b', bg: 'bg-amber-100 text-amber-700' },
  critical: { ar: 'ينتهي قريبًا جدًا', en: 'Critical', color: '#ea580c', bg: 'bg-orange-100 text-orange-700' },
  expired: { ar: 'منتهي', en: 'Expired', color: '#dc2626', bg: 'bg-red-100 text-red-700' },
  missing: { ar: 'بدون تاريخ', en: 'No date', color: '#94a3b8', bg: 'bg-slate-100 text-slate-600' },
  not_applicable: { ar: 'لا ينطبق', en: 'Not applicable', color: '#64748b', bg: 'bg-slate-100 text-slate-500' },
};
export const statusLabel = (c: string, ar: boolean) => (STATUS_META[c] ? (ar ? STATUS_META[c].ar : STATUS_META[c].en) : c);
export const stateLabel = (c: string, ar: boolean) => (STATE_META[c] ? (ar ? STATE_META[c].ar : STATE_META[c].en) : c);

export const fmtDate = (d?: string | Date | null) => (d ? new Date(d).toISOString().slice(0, 10) : '—');
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
  api.get<{ rows: any[]; summary: Record<string, number>; byDoc: { key: string; ar: string; en: string; count: number }[]; withinDays: number | null }>(
    `/api/hr/master/expiring${qs(q) ? `?${qs(q)}` : ''}`);

/** ملء حقول ناقصة. حالة «مطلوب» بتتشال لوحدها على السيرفر. */
export const updateEmployeeFields = (id: string, fields: Record<string, any>, markStatus?: Record<string, string>) =>
  api.patch<{ employee: any; statuses: Record<string, StatusCode>; rejected: string[] }>(
    `/api/hr/master/employees/${id}/fields`, { fields, markStatus });

export const getHrFieldConfig = () =>
  api.get<{ groups: (GroupCard & { fields: FieldDef[] })[]; statuses: any; states: any; alert: any }>('/api/hr/master/field-config');

/** الحقول القابلة للفلترة وقيمها بأعدادها — محسوبة على ما تبقّى بعد بقيّة الفلاتر. */
export const getHrFilters = (q: Record<string, any> = {}) =>
  api.get<{ filters: { key: string; ar: string; en: string; groupAr: string; groupEn: string; values: { value: string; count: number }[] }[]; dateFields: string[] }>(
    `/api/hr/master/filters${qs(q) ? `?${qs(q)}` : ''}`);

/** أسماء حقول التاريخ التي تقبل مدى — تُعرض في لوحة الفلترة. */
export const HR_DATE_FIELDS = [
  { key: 'hireDate', ar: 'تاريخ التعيين', en: 'Hire date' },
  { key: 'dateOfBirth', ar: 'تاريخ الميلاد', en: 'Date of birth' },
  { key: 'iqamaExpiry', ar: 'انتهاء الإقامة', en: 'Iqama expiry' },
  { key: 'passportExpiry', ar: 'انتهاء الجواز', en: 'Passport expiry' },
  { key: 'contractEndDate', ar: 'نهاية العقد', en: 'Contract end' },
  { key: 'insuranceExpiry', ar: 'انتهاء التأمين الطبي', en: 'Medical insurance expiry' },
  { key: 'healthCertExpiry', ar: 'انتهاء الشهادة الصحية', en: 'Health certificate expiry' },
  { key: 'driverCardExpiry', ar: 'انتهاء بطاقة السائق', en: 'Driver card expiry' },
  { key: 'licenseExpiry', ar: 'انتهاء رخصة القيادة', en: 'Licence expiry' },
];
