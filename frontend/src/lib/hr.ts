// Shared helpers, types and bilingual labels for the HR section pages.
import { exportToExcel, fmt } from '@/utils/exportExcel';

export { exportToExcel, fmt };

import { canAccessSection, roleOf, permsOf, type RoleOrUser } from './sections';

export const HR_STAFF_ROLES = ['super_admin', 'admin', 'hr_manager', 'hr_specialist'];
// Staff by role OR by a grant from the permissions matrix — the backend and the
// sidebar both honour the grant, so a page gating on the role list alone shows
// a granted user the nav link and then a dead "not authorized" screen. Pass the
// USER (not the role string): only the user object carries the grants.
export const isHRStaff = (u: RoleOrUser) => HR_STAFF_ROLES.includes(roleOf(u)) || canAccessSection(permsOf(u), 'HR');

// Roles that get the HR self-service pages (their own profile/requests/leaves,
// and approving their team's leave when they manage others). Everyone with a
// login except external clients.
export const HR_SELF_SERVICE_ROLES = [
  'super_admin', 'admin', 'employee', 'operations_manager', 'operations_staff', 'moderator',
  'workshop_manager', 'workshop_employee', 'procurement_staff', 'b2c_manager', 'b2c_project_lead',
  'hr_manager', 'hr_specialist', 'remote_employee', 'remote_manager',
];

export type Lang = 'en' | 'ar';
const pick = (lang: Lang, en: string, ar: string) => (lang === 'ar' ? ar : en);

// ── Types (mirror the backend models) ────────────────────────────────────────
export interface Employee {
  _id: string;
  firstName: string; lastName: string; arabicName?: string;
  employeeNumber?: string; gender?: string; dateOfBirth?: string; nationality?: string; photo?: string;
  idType?: 'iqama' | 'national_id';
  iqamaNumber?: string; iqamaExpiry?: string; nationalId?: string;
  passportNumber?: string; passportExpiry?: string;
  qiwaContractNumber?: string; gosiNumber?: string; absherStatus?: string; sponsorName?: string; workPermitExpiry?: string;
  jobTitle?: string; department?: string; hireDate?: string; actualWorkStartDate?: string; workLocation?: string;
  branch?: { _id: string; name: string } | string;
  /** فروع إضافية يعمل عليها الموظف — والأساسي أعلاه هو المنسوب في التقارير. */
  branches?: (string | { _id: string; name?: string })[];
  employmentStatus?: 'active' | 'on_leave' | 'suspended' | 'terminated';
  terminatedAt?: string; terminationReason?: string;
  phone?: string; email?: string; address?: string; emergencyContactName?: string; emergencyContactPhone?: string;
  basicSalary?: number; allowances?: number;
  // Banking
  iban?: string; bank?: string;
  // Extra HR-sheet fields
  fileStatus?: string; absherNumber?: string; companyNumber?: string; originCountryNumber?: string;
  project?: string; registerNumber?: string; systemStatus?: string; workStatusText?: string;
  penaltyClause?: number; iqamaProfession?: string; classification?: string;
  insuranceCompany?: string; insuranceExpiry?: string; socialInsuranceStatus?: string;
  visaExpiry?: string; lastTravelDate?: string; lastReturnDate?: string;
  // Driving / vehicle eligibility
  vehiclePlate?: string; licenseNumber?: string; licenseType?: string; licenseExpiry?: string;
  driverCardNumber?: string; driverCardType?: string; driverCardStatus?: string; driverCardExpiry?: string;
  workCard?: string; ajeerStatus?: string; ajeerExpiry?: string;
  user?: { _id: string; firstName: string; lastName: string; email: string; role: string } | string;
  directManager?: { _id: string; firstName: string; lastName: string; email?: string } | string;
  notes?: string; createdAt?: string;
}

export interface Contract {
  _id: string;
  employee: any;
  type?: 'fixed' | 'unlimited';
  startDate: string; endDate?: string; durationMonths?: number;
  annualLeaveDays: number;
  jobTitle?: string; basicSalary?: number; allowances?: number; probationMonths?: number;
  status: 'active' | 'expired' | 'terminated';
  terminatedAt?: string; terminationReason?: string; custodyReturned?: boolean;
  notes?: string; createdAt?: string;
}

export interface LeaveType {
  _id: string; code: string; nameEn: string; nameAr: string;
  paid: boolean; affectsBalance: boolean; color?: string; active: boolean;
  // سياسة الإخطار المسبق: planned leave must be requested this many days before
  // it starts. Sick/emergency types carry requiresAdvanceNotice: false.
  requiresAdvanceNotice?: boolean;
  minAdvanceDays?: number;
}

// The earliest start date a given leave type may be requested for, as YYYY-MM-DD.
// Types exempt from the notice rule can start today.
export function earliestStartDate(t?: LeaveType | null): string {
  if (!t || t.requiresAdvanceNotice === false) return today();
  const days = t.minAdvanceDays ?? 30;
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}


export interface LeaveBalance { entitlement: number; daysElapsed: number; accrued: number; taken: number; available: number; }

export interface LeaveRequest {
  _id: string;
  employee: any; requester: any; manager?: any;
  leaveType: any; leaveTypeCode?: string;
  startDate: string; endDate: string; days: number; reason?: string;
  status: 'pending_manager' | 'pending_hr' | 'approved' | 'rejected' | 'cancelled';
  currentStage: 'manager' | 'hr' | 'done';
  managerDecision?: { by?: any; at?: string; decision?: string; note?: string };
  hrDecision?: { by?: any; at?: string; decision?: string; note?: string };
  balanceSnapshot?: { accrued?: number; requested?: number; remainingAfter?: number };
  createdAt?: string;
}

export interface HRRequest {
  _id: string;
  requester: any; employee?: any; manager?: any;
  category: string; subject: string;
  thread: { _id?: string; sender: any; body?: string; link?: string; at?: string }[];
  status: 'open' | 'in_progress' | 'received' | 'resolved' | 'closed';
  assignedTo?: any; readByRequester?: boolean; readByHR?: boolean;
  createdAt?: string; updatedAt?: string;
}

export interface Asset {
  _id: string; employee: any; name: string; type: string;
  serialNumber?: string; brand?: string; model?: string; condition?: string; value?: number; assignedDate?: string;
  status: 'assigned' | 'returned'; returnedDate?: string; returnedCondition?: string;
  notes?: string; createdAt?: string;
  // Set by the Software & IT section when it hands an item out. HR reads these
  // but never writes them — IT custody is view-only on HR screens.
  issuedBySection?: string; assignedBy?: any; category?: string; specs?: string;
}

export interface EmployeeDocument {
  _id: string; employee: string; title: string; category?: string;
  fileUrl: string; fileName?: string; mimeType?: string; size?: number;
  expiryDate?: string; notes?: string; uploadedBy?: any; createdAt?: string;
}

export interface EmployeeRenewal {
  _id: string; employee: string; docType: string;
  previousExpiry?: string; newExpiry?: string; documentNumber?: string; notes?: string;
  renewedBy?: any; renewedAt?: string; createdAt?: string;
}

export interface AuditEntry {
  _id: string; user?: any; action: string; entity: string; entityId?: string;
  changes?: { before?: any; after?: any }; createdAt?: string;
}

// Renewable document types shown in the "Renew" action. `field`/`numberField`
// are informational; the backend owns the mapping.
export const RENEWAL_TYPES: { key: string; en: string; ar: string }[] = [
  { key: 'iqama', en: 'Iqama', ar: 'الإقامة' },
  { key: 'passport', en: 'Passport', ar: 'الجواز' },
  { key: 'workPermit', en: 'Work Permit', ar: 'رخصة العمل' },
  { key: 'insurance', en: 'Insurance', ar: 'التأمين' },
  { key: 'visa', en: 'Visa', ar: 'التأشيرة' },
  { key: 'license', en: 'Driving License', ar: 'رخصة القيادة' },
  { key: 'driverCard', en: 'Driver Card', ar: 'كارت السائق' },
  { key: 'ajeer', en: 'Ajeer', ar: 'أجير' },
  { key: 'other', en: 'Other', ar: 'أخرى' },
];

// Categories for an uploaded file. The user can still type a free-text title.
export const DOCUMENT_CATEGORIES: { key: string; en: string; ar: string }[] = [
  { key: 'iqama', en: 'Iqama', ar: 'صورة الإقامة' },
  { key: 'passport', en: 'Passport', ar: 'صورة الجواز' },
  { key: 'license', en: 'Driving License', ar: 'رخصة القيادة' },
  { key: 'driverCard', en: 'Driver Card', ar: 'كارت السائق' },
  { key: 'contract', en: 'Contract', ar: 'العقد' },
  { key: 'insurance', en: 'Insurance', ar: 'التأمين' },
  { key: 'national_id', en: 'National ID', ar: 'الهوية الوطنية' },
  { key: 'photo', en: 'Photo', ar: 'صورة شخصية' },
  { key: 'other', en: 'Other', ar: 'أخرى' },
];

export const renewalTypeLabel = (key: string, lang: Lang) => labelFrom(RENEWAL_TYPES, key, lang);
export const docCategoryLabel = (key: string, lang: Lang) => labelFrom(DOCUMENT_CATEGORIES, key, lang);

// Human label for an audit action code.
export const AUDIT_ACTIONS: Record<string, { en: string; ar: string }> = {
  create_employee: { en: 'Created profile', ar: 'إنشاء الملف' },
  update_employee: { en: 'Edited profile', ar: 'تعديل البيانات' },
  delete_employee: { en: 'Deleted profile', ar: 'حذف الملف' },
  renew_document: { en: 'Renewed document', ar: 'تجديد مستند' },
  terminate_employee: { en: 'Ended service', ar: 'إنهاء الخدمة' },
  reactivate_employee: { en: 'Reactivated', ar: 'إعادة تفعيل' },
  add_employee_document: { en: 'Added file', ar: 'إضافة ملف' },
  update_employee_document: { en: 'Edited file', ar: 'تعديل ملف' },
  delete_employee_document: { en: 'Removed file', ar: 'حذف ملف' },
};
export const auditActionLabel = (key: string, lang: Lang) =>
  (AUDIT_ACTIONS[key] ? AUDIT_ACTIONS[key][lang === 'ar' ? 'ar' : 'en'] : key);

// ── Status styles & labels ───────────────────────────────────────────────────
export const LEAVE_STATUS: Record<string, { bg: string; text: string; en: string; ar: string }> = {
  pending_manager: { bg: 'bg-amber-500/20', text: 'text-amber-700', en: 'With Manager', ar: 'عند المدير' },
  pending_hr: { bg: 'bg-blue-500/20', text: 'text-blue-700', en: 'With HR', ar: 'عند الموارد البشرية' },
  approved: { bg: 'bg-green-500/20', text: 'text-green-700', en: 'Approved', ar: 'مقبولة' },
  rejected: { bg: 'bg-red-500/20', text: 'text-red-700', en: 'Rejected', ar: 'مرفوضة' },
  cancelled: { bg: 'bg-gray-500/20', text: 'text-gray-600', en: 'Cancelled', ar: 'ملغاة' },
};

export const REQUEST_STATUS: Record<string, { bg: string; text: string; en: string; ar: string }> = {
  open: { bg: 'bg-amber-500/20', text: 'text-amber-700', en: 'Open', ar: 'مفتوح' },
  in_progress: { bg: 'bg-blue-500/20', text: 'text-blue-700', en: 'In Progress', ar: 'قيد التنفيذ' },
  received: { bg: 'bg-purple-500/20', text: 'text-purple-700', en: 'Received', ar: 'تم الاستلام' },
  resolved: { bg: 'bg-green-500/20', text: 'text-green-700', en: 'Resolved', ar: 'تم التسليم' },
  closed: { bg: 'bg-gray-500/20', text: 'text-gray-600', en: 'Closed', ar: 'مغلق' },
};

export const EMPLOYMENT_STATUS: Record<string, { bg: string; text: string; en: string; ar: string }> = {
  active: { bg: 'bg-green-500/20', text: 'text-green-700', en: 'Active', ar: 'على رأس العمل' },
  on_leave: { bg: 'bg-blue-500/20', text: 'text-blue-700', en: 'On Leave', ar: 'في إجازة' },
  suspended: { bg: 'bg-amber-500/20', text: 'text-amber-700', en: 'Suspended', ar: 'موقوف' },
  terminated: { bg: 'bg-red-500/20', text: 'text-red-700', en: 'Terminated', ar: 'منتهي' },
};

export const CONTRACT_STATUS: Record<string, { bg: string; text: string; en: string; ar: string }> = {
  active: { bg: 'bg-green-500/20', text: 'text-green-700', en: 'Active', ar: 'ساري' },
  expired: { bg: 'bg-gray-500/20', text: 'text-gray-600', en: 'Expired', ar: 'منتهي' },
  terminated: { bg: 'bg-red-500/20', text: 'text-red-700', en: 'Terminated', ar: 'مفسوخ' },
};

export const REQUEST_CATEGORIES: { key: string; en: string; ar: string }[] = [
  { key: 'salary_certificate', en: 'Salary Certificate', ar: 'تعريف بالراتب' },
  { key: 'letter', en: 'Official Letter', ar: 'خطاب رسمي' },
  { key: 'document', en: 'Document', ar: 'مستند' },
  { key: 'data_update', en: 'Data Update', ar: 'تحديث بيانات' },
  { key: 'complaint', en: 'Complaint', ar: 'شكوى' },
  { key: 'other', en: 'Other', ar: 'أخرى' },
];

// Mirrors the Asset `type` enum. Kept in the same order as lib/it.ts
// CUSTODY_TYPES so a device reads the same on both sections' screens.
export const ASSET_TYPES: { key: string; en: string; ar: string }[] = [
  { key: 'laptop', en: 'Laptop', ar: 'حاسب محمول' },
  { key: 'desktop', en: 'Desktop', ar: 'حاسب مكتبي' },
  { key: 'phone', en: 'Phone', ar: 'هاتف' },
  { key: 'tablet', en: 'Tablet', ar: 'جهاز لوحي' },
  { key: 'sim', en: 'SIM Card', ar: 'شريحة اتصال' },
  { key: 'monitor', en: 'Monitor', ar: 'شاشة' },
  { key: 'keyboard', en: 'Keyboard', ar: 'لوحة مفاتيح' },
  { key: 'mouse', en: 'Mouse', ar: 'فأرة' },
  { key: 'keyboard_mouse', en: 'Keyboard & Mouse', ar: 'لوحة مفاتيح وفأرة' },
  { key: 'headset', en: 'Headset', ar: 'سماعة رأس' },
  { key: 'printer', en: 'Printer', ar: 'طابعة' },
  { key: 'router', en: 'Router', ar: 'موجّه شبكة' },
  { key: 'charger', en: 'Charger', ar: 'شاحن' },
  { key: 'cable', en: 'Cable', ar: 'كبل' },
  { key: 'laptop_bag', en: 'Laptop Bag', ar: 'حقيبة حاسب' },
  { key: 'accessory', en: 'Accessory', ar: 'ملحق' },
  { key: 'access_card', en: 'Access Card', ar: 'بطاقة دخول' },
  { key: 'vehicle', en: 'Vehicle', ar: 'مركبة' },
  { key: 'tool', en: 'Tool', ar: 'أداة' },
  { key: 'other', en: 'Other', ar: 'أخرى' },
];

export const ASSET_CONDITIONS: { key: string; en: string; ar: string }[] = [
  { key: 'new', en: 'New', ar: 'جديد' },
  { key: 'good', en: 'Good', ar: 'جيد' },
  { key: 'fair', en: 'Fair', ar: 'مقبول' },
  { key: 'damaged', en: 'Damaged', ar: 'تالف' },
];

const labelFrom = (list: { key: string; en: string; ar: string }[], key: string, lang: Lang) =>
  (list.find((x) => x.key === key) || { en: key, ar: key })[lang === 'ar' ? 'ar' : 'en'];

export const categoryLabel = (key: string, lang: Lang) => labelFrom(REQUEST_CATEGORIES, key, lang);
export const assetTypeLabel = (key: string, lang: Lang) => labelFrom(ASSET_TYPES, key, lang);
export const conditionLabel = (key: string, lang: Lang) => labelFrom(ASSET_CONDITIONS, key, lang);
export const leaveTypeLabel = (lt: any, lang: Lang) => (!lt ? '—' : lang === 'ar' ? (lt.nameAr || lt.code) : (lt.nameEn || lt.code));

export const empName = (e: any, lang: Lang = 'en') => {
  if (!e) return '—';
  if (typeof e === 'string') return e;
  if (lang === 'ar' && e.arabicName) return e.arabicName;
  return `${e.firstName || ''} ${e.lastName || ''}`.trim() || '—';
};

export const userName = (u: any) => (!u ? '—' : typeof u === 'string' ? u : `${u.firstName || ''} ${u.lastName || ''}`.trim() || '—');

// ── Date helpers ─────────────────────────────────────────────────────────────
export const today = () => new Date().toISOString().slice(0, 10);
export const fmtDate = (v?: string | null) => (v ? new Date(v).toLocaleDateString('en-GB') : '—');
export const fmtDateTime = (v?: string | null) =>
  v ? new Date(v).toLocaleString('en-GB', { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—';

// Days until a YYYY-MM-DD date (negative = past). Used for expiry badges.
export const daysUntil = (v?: string | null): number | null => {
  if (!v) return null;
  const ms = new Date(v + 'T00:00:00').getTime() - new Date(today() + 'T00:00:00').getTime();
  return Math.round(ms / 86400000);
};

export const expiryBadge = (v?: string | null, lang: Lang = 'en') => {
  const d = daysUntil(v);
  if (d === null) return null;
  if (d < 0) return { bg: 'bg-red-500/20', text: 'text-red-700', label: pick(lang, 'Expired', 'منتهية') };
  if (d <= 30) return { bg: 'bg-red-500/20', text: 'text-red-700', label: pick(lang, `${d}d left`, `باقي ${d} يوم`) };
  if (d <= 60) return { bg: 'bg-amber-500/20', text: 'text-amber-700', label: pick(lang, `${d}d left`, `باقي ${d} يوم`) };
  return { bg: 'bg-green-500/20', text: 'text-green-700', label: pick(lang, `${d}d left`, `باقي ${d} يوم`) };
};
