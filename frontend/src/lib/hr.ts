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
  'workshop_manager', 'workshop_employee', 'procurement_staff', 'b2c_manager', 'b2c_deputy', 'b2c_project_lead', 'b2c_rep_supervisor', 'b2c_inspection_supervisor',
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
  /** Extra branches the employee works in; the primary one above is the one attributed in reports. */
  branches?: (string | { _id: string; name?: string })[];
  employmentStatus?: 'active' | 'on_leave' | 'suspended' | 'terminated';
  terminatedAt?: string; terminationReason?: string;
  /** Not working, with the status: awaiting sponsorship transfer, sister company, or final exit. */
  terminationKind?: '' | 'transfer_pending' | 'sister_company' | 'final_exit';
  transferDeadline?: string | null;
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
  directManagerName?: string;
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
  // Valid or expired only; a terminated contract is expired and its reason is in terminationReason.
  status: 'active' | 'expired';
  terminatedAt?: string; terminationReason?: string; custodyReturned?: boolean;
  notes?: string; createdAt?: string;
  // What came from the employee contracts file: the contract is a paper with data that does not live in the employee file: the identity as written in it, the profession as in the contract (differs from the iqama profession and the job title), and the commercial registration issued under it.
  iqamaNumber?: string;
  employeeNameAr?: string;
  contractProfession?: string;
  sponsorRegistration?: string;
  // Its number in Qiwa; this, not the employee name, is what inspection and office correspondence ask for.
  contractNumber?: string;
  // Not required is a healthy state, not a missing zero, so the text accompanies the number.
  annualLeaveText?: string;
  probationText?: string;
}

export interface LeaveType {
  _id: string; code: string; nameEn: string; nameAr: string;
  paid: boolean; affectsBalance: boolean; color?: string; active: boolean;
  // Advance notice policy: planned leave must be requested this many days before it starts. Sick/emergency types carry requiresAdvanceNotice: false.
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

export type LeaveStage = 'manager' | 'finance' | 'hr' | 'executive' | 'chairman';

export interface LeaveDecision { by?: any; at?: string; decision?: string; note?: string }

export interface LeaveThreadEntry {
  kind: 'question' | 'reply';
  stage?: string; by?: any; byName?: string; text?: string;
  attachment?: string; attachmentName?: string; at?: string;
}

/** Chain stages in order; the progress bar on every page is drawn from this, so the order is not repeated in four places where two could diverge. */
export const LEAVE_STAGES: { key: LeaveStage; ar: string; en: string; decision: keyof LeaveRequest }[] = [
  { key: 'manager', ar: 'المدير المباشر', en: 'Direct Manager', decision: 'managerDecision' },
  { key: 'finance', ar: 'الإدارة المالية', en: 'Finance', decision: 'financeDecision' },
  { key: 'hr', ar: 'الموارد البشرية', en: 'HR', decision: 'hrDecision' },
  { key: 'executive', ar: 'الإدارة العليا', en: 'Top Management', decision: 'executiveDecision' },
  { key: 'chairman', ar: 'رئيس مجلس الإدارة', en: 'Chairman', decision: 'chairmanDecision' },
];

/** Statuses waiting at a stage, and the open set (waiting, or returned to the owner); mirrors utils/leaveChain on the server. */
export const LEAVE_PENDING: string[] = LEAVE_STAGES.map((s) => `pending_${s.key}`);
export const LEAVE_OPEN: string[] = [...LEAVE_PENDING, 'info_requested'];
/** Editable by its owner until any stage has acted, as the server's leaveIsUntouched. */
export const leaveUntouched = (l: any) => LEAVE_PENDING.includes(l?.status) && LEAVE_STAGES.every((s) => !l?.[s.decision]?.at);

export interface LeaveRequest {
  _id: string;
  employee: any; requester: any; manager?: any;
  leaveType: any; leaveTypeCode?: string;
  startDate: string; endDate: string; days: number; reason?: string;
  status: 'pending_manager' | 'pending_hr' | 'pending_finance' | 'pending_executive' | 'pending_chairman'
        | 'info_requested' | 'approved' | 'rejected' | 'cancelled';
  currentStage: 'manager' | 'hr' | 'finance' | 'executive' | 'chairman' | 'employee' | 'done';
  managerDecision?: LeaveDecision;
  hrDecision?: LeaveDecision;
  financeDecision?: LeaveDecision;
  executiveDecision?: LeaveDecision;
  chairmanDecision?: LeaveDecision;
  // Request dialogue: a stage's question and the requester's reply, oldest first.
  thread?: LeaveThreadEntry[];
  balanceSnapshot?: { accrued?: number; requested?: number; remainingAfter?: number };
  // HR's choice at its stage; null on older records, where the leave type decides (backend utils/leaveBalance.leaveDeducts).
  deductsBalance?: boolean | null;
  // Filed by a manager for someone under him; his stage was stamped at filing.
  filedByManager?: boolean;
  filedBy?: any;
  filedByName?: string;
  createdAt?: string;
  // Request attachments and its two decisions; the reviewer reads them before deciding, and they stay in the employee file.
  attachments?: { _id?: string; title?: string; fileUrl: string; fileName?: string; size?: number; mimeType?: string }[];
  // A leave that already happened and was recorded afterwards: it skips the manager and the notice period, but the log keeps that it is a retroactive entry and who recorded it.
  backdated?: boolean;
  recordedByName?: string;
  recordedAt?: string;
  // Return from leave (see backend utils/leaveReturn).
  plannedEndDate?: string;
  returnState?: '' | 'returned' | 'no_show';
  returnedOn?: string;
  workStartsOn?: string;
  returnCountsAsWork?: boolean;
  returnAuto?: boolean;
  returnRecordedByName?: string;
  returnRecordedAt?: string;
  extensions?: { fromEnd: string; toEnd: string; days: number; note?: string; byName?: string; at?: string }[];
  noShow?: { since?: string; note?: string; byName?: string; at?: string };
}

/** Does this leave come off the balance? Twin of backend utils/leaveBalance.leaveDeducts. */
export const leaveDeducts = (l?: Partial<LeaveRequest> | null) =>
  typeof l?.deductsBalance === 'boolean' ? l.deductsBalance : (l?.leaveType?.affectsBalance ?? true);

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
  // Claim actions; without these lines the raw key shows in the file history.
  create_vehicle_claim: { en: 'Claim opened', ar: 'تسجيل الحادثة' },
  update_vehicle_claim: { en: 'Claim edited', ar: 'تعديل المطالبة' },
  delete_vehicle_claim: { en: 'Claim removed', ar: 'حذف المطالبة' },
  add_claim_attachment: { en: 'Attachment added', ar: 'إرفاق ملفّ' },
  delete_claim_attachment: { en: 'Attachment removed', ar: 'حذف مرفق' },
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
  pending_finance: { bg: 'bg-violet-500/20', text: 'text-violet-700', en: 'With Finance', ar: 'عند الإدارة المالية' },
  pending_executive: { bg: 'bg-indigo-500/20', text: 'text-indigo-700', en: 'With Top Management', ar: 'عند الإدارة العليا' },
  pending_chairman: { bg: 'bg-fuchsia-500/20', text: 'text-fuchsia-700', en: 'With the Chairman', ar: 'عند رئيس مجلس الإدارة' },
  // Not a rejection: the request went back to its owner to reply or edit.
  info_requested: { bg: 'bg-orange-500/20', text: 'text-orange-700', en: 'Needs your reply', ar: 'بانتظار ردّك' },
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
  // Work status: on_leave is set and cleared by approved leaves (backend utils/leaveReturn).
  active: { bg: 'bg-green-500/20', text: 'text-green-700', en: 'Working', ar: 'يعمل' },
  on_leave: { bg: 'bg-blue-500/20', text: 'text-blue-700', en: 'On leave', ar: 'إجازة' },
  suspended: { bg: 'bg-amber-500/20', text: 'text-amber-700', en: 'Suspended (legacy)', ar: 'موقوف (قديم)' },
  terminated: { bg: 'bg-red-500/20', text: 'text-red-700', en: 'Not working', ar: 'لا يعمل' },
};

/** Badge for an employee: leave only when a recorded leave set it; an old imported "on_leave" reads as working. */
export const employmentBadge = (e: any) => {
  if (e?.leaveViolation?.since && e?.employmentStatus !== 'terminated') return LEAVE_NO_SHOW_STATUS;
  const st = e?.employmentStatus === 'on_leave' && e?.leaveStatusSource !== 'leave' ? 'active' : (e?.employmentStatus || 'active');
  return EMPLOYMENT_STATUS[st];
};

export const LEAVE_NO_SHOW_STATUS = { bg: 'bg-red-500/20', text: 'text-red-700', en: 'Violation — did not return from leave', ar: 'مخالفة — لم يعد من الإجازة' };

export const CONTRACT_STATUS: Record<string, { bg: string; text: string; en: string; ar: string }> = {
  active: { bg: 'bg-green-500/20', text: 'text-green-700', en: 'Active', ar: 'ساري' },
  expired: { bg: 'bg-gray-500/20', text: 'text-gray-600', en: 'Expired', ar: 'منتهي' },
};
// Two states, not four: valid and expired. The old terminated and renewed values read as expired, and the server folds them before they arrive.

/** Whether a contract is required for this employee. Freelancers and trainees have no contract, only a start date, so neither is reported as having no contract or no valid contract. Read from the commercial registration number as on the server (utils/hrEngagement), not from the type. */
export const contractRequired = (e?: { registerNumber?: string } | null) => {
  const r = String(e?.registerNumber ?? '').trim();
  return !(/فري\s*لانس|فريلانس|freelanc/i.test(r) || /تدريب|متدرب|trainee/i.test(r));
};
/**
 * What to display for the contract, not only what is stored.
 * Valid is written when the contract is created and time does not change it: a contract past its term and not renewed stays valid in the contracts tab while the expiries page calls it expired. Both read the same contract, so the display reads the date together with the status.
 */
export const CONTRACT_LAPSED = { bg: 'bg-red-500/20', text: 'text-red-700', en: 'Expired', ar: 'منتهي' };
export const contractBadge = (c?: { status?: string; endDate?: string | null } | null) => {
  if (!c) return null;
  const end = String(c.endDate || '').slice(0, 10);
  if (c.status === 'active' && end && end < new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Riyadh' })) return CONTRACT_LAPSED;
  if (!c.status) return null;
  return CONTRACT_STATUS[c.status === 'active' ? 'active' : 'expired'];
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
  { key: 'tablet', en: 'Tablet', ar: 'تابلت' },
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

// Date helpers. Today means the Riyadh day, not the Greenwich day: toISOString() gave yesterday between midnight and 03:00. The single reference is lib/companyDay.
export { today } from './companyDay';
import { today } from './companyDay';
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
