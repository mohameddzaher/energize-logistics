// Shared helpers, types, status maps and bilingual labels for the Vehicles &
// Authorizations (المركبات والتفاويض) section. UI chrome strings live in
// getVehiclesText(lang) so the whole section is fully bilingual from one place.
import { empName, fmtDate, fmtDateTime, today, daysUntil, expiryBadge, exportToExcel } from '@/lib/hr';
export { empName, fmtDate, fmtDateTime, today, daysUntil, expiryBadge, exportToExcel };

export type Lang = 'en' | 'ar';
const pick = (lang: Lang, en: string, ar: string) => (lang === 'ar' ? ar : en);

// ── Roles ──────────────────────────────────────────────────────────────────────
// By role OR by a grant from the permissions matrix (the backend honours the
// grant, so the pages must too). Pass the USER: only it carries the grants.
import { canAccessSection, canEditSection, roleOf, permsOf, type RoleOrUser } from './sections';
export const VEHICLE_STAFF_ROLES = ['super_admin', 'admin', 'hr_manager', 'hr_specialist', 'finance_manager', 'accountant'];
export const VEHICLE_ADMIN_ROLES = ['super_admin', 'admin', 'hr_manager', 'finance_manager'];
export const isVehicleStaff = (u: RoleOrUser) => VEHICLE_STAFF_ROLES.includes(roleOf(u)) || canAccessSection(permsOf(u), 'Vehicles');
export const isVehicleAdmin = (u: RoleOrUser) => VEHICLE_ADMIN_ROLES.includes(roleOf(u)) || canEditSection(permsOf(u), 'Vehicles');

// ── Types (mirror the backend models) ───────────────────────────────────────────
export interface EmployeeRef {
  _id: string; firstName?: string; lastName?: string; arabicName?: string;
  employeeNumber?: string; iqamaNumber?: string; jobTitle?: string; department?: string; phone?: string;
}

export interface Vehicle {
  _id: string;
  plateNumber: string;
  type: string;
  make?: string; model?: string; year?: number; color?: string;
  branch?: { _id: string; name: string } | string;
  department?: string; project?: string;
  registrationExpiry?: string; insuranceExpiry?: string;
  status: string;
  currentEmployee?: EmployeeRef | string | null;
  currentAuthorization?: VehicleAuthorization | string | null;
  accidentCount?: number;
  notes?: string; createdAt?: string;
}

export interface VehicleAuthorization {
  _id: string;
  vehicle: Vehicle | string;
  employee: EmployeeRef | string;
  status: 'active' | 'transferred' | 'revoked';
  startDate: string; endDate?: string;
  authorizationType?: string; documentNumber?: string; documentExpiry?: string; issuedBy?: string;
  endReason?: string;
  transferredTo?: EmployeeRef | string | null;
  transferredFrom?: EmployeeRef | string | null;
  revokedReason?: string;
  notes?: string;
  createdBy?: any; endedBy?: any;
  createdAt?: string; updatedAt?: string;
}

export interface VehicleAccident {
  _id: string;
  vehicle: Vehicle | string;
  employee?: EmployeeRef | string | null;
  date: string; location?: string; description: string;
  faultParty?: string; severity?: string;
  thirdPartyDetails?: string; injuries?: boolean; actionTaken?: string; reportNumber?: string;
  estimatedCost?: number; actualCost?: number;
  status?: string; resolution?: string;
  notes?: string; createdBy?: any; createdAt?: string;
}

// ── Status / enum maps (key → bilingual label + badge styles) ────────────────────
type Styled = { bg: string; text: string; en: string; ar: string };

export const VEHICLE_TYPES: { key: string; en: string; ar: string }[] = [
  { key: 'car', en: 'Car', ar: 'سيارة' },
  { key: 'motorcycle', en: 'Motorcycle', ar: 'دراجة نارية' },
  { key: 'heavy_truck', en: 'Heavy Truck', ar: 'نقل ثقيل' },
  { key: 'trailer', en: 'Trailer', ar: 'مقطورة' },
  { key: 'van', en: 'Van', ar: 'فان' },
  { key: 'equipment', en: 'Equipment', ar: 'معدة' },
  { key: 'other', en: 'Other', ar: 'أخرى' },
];

export const VEHICLE_STATUS: Record<string, Styled> = {
  available: { bg: 'bg-slate-500/20', text: 'text-slate-600', en: 'Available', ar: 'متاحة' },
  authorized: { bg: 'bg-green-500/20', text: 'text-green-600', en: 'Authorized', ar: 'مُفوَّضة' },
  parked: { bg: 'bg-amber-500/20', text: 'text-amber-700', en: 'Parked', ar: 'مركونة' },
  maintenance: { bg: 'bg-blue-500/20', text: 'text-blue-600', en: 'Maintenance', ar: 'صيانة' },
  out_of_service: { bg: 'bg-red-500/20', text: 'text-red-600', en: 'Out of Service', ar: 'خارج الخدمة' },
};

export const AUTH_STATUS: Record<string, Styled> = {
  active: { bg: 'bg-green-500/20', text: 'text-green-600', en: 'Active', ar: 'سارٍ' },
  transferred: { bg: 'bg-blue-500/20', text: 'text-blue-600', en: 'Transferred', ar: 'تم نقله' },
  revoked: { bg: 'bg-red-500/20', text: 'text-red-600', en: 'Revoked', ar: 'ملغى' },
};

export const ACCIDENT_SEVERITY: Record<string, Styled> = {
  minor: { bg: 'bg-slate-500/20', text: 'text-slate-600', en: 'Minor', ar: 'بسيط' },
  moderate: { bg: 'bg-amber-500/20', text: 'text-amber-700', en: 'Moderate', ar: 'متوسط' },
  severe: { bg: 'bg-red-500/20', text: 'text-red-600', en: 'Severe', ar: 'بالغ' },
  total_loss: { bg: 'bg-red-700/20', text: 'text-red-700', en: 'Total Loss', ar: 'خسارة كلية' },
};

export const ACCIDENT_STATUS: Record<string, Styled> = {
  reported: { bg: 'bg-amber-500/20', text: 'text-amber-700', en: 'Reported', ar: 'مُبلّغ عنه' },
  investigating: { bg: 'bg-blue-500/20', text: 'text-blue-600', en: 'Investigating', ar: 'قيد التحقيق' },
  resolved: { bg: 'bg-green-500/20', text: 'text-green-600', en: 'Resolved', ar: 'تمت تسويته' },
  closed: { bg: 'bg-slate-500/20', text: 'text-slate-600', en: 'Closed', ar: 'مغلق' },
};

export const FAULT_PARTY: { key: string; en: string; ar: string }[] = [
  { key: 'employee', en: 'Employee', ar: 'الموظف' },
  { key: 'third_party', en: 'Third Party', ar: 'طرف ثالث' },
  { key: 'shared', en: 'Shared', ar: 'مشترك' },
  { key: 'none', en: 'No Fault', ar: 'بدون خطأ' },
  { key: 'unknown', en: 'Unknown', ar: 'غير محدد' },
];

const labelFrom = (list: { key: string; en: string; ar: string }[], key?: string, lang: Lang = 'en') =>
  !key ? '—' : (list.find((x) => x.key === key) || { en: key, ar: key })[lang === 'ar' ? 'ar' : 'en'];

export const vehicleTypeLabel = (k?: string, lang: Lang = 'en') => labelFrom(VEHICLE_TYPES, k, lang);
export const faultPartyLabel = (k?: string, lang: Lang = 'en') => labelFrom(FAULT_PARTY, k, lang);
export const styledLabel = (map: Record<string, Styled>, k?: string, lang: Lang = 'en') =>
  !k ? '—' : (map[k] ? map[k][lang === 'ar' ? 'ar' : 'en'] : k);

// Resolve a possibly-populated employee ref to a display name.
export const empRefName = (e: any, lang: Lang = 'en') => (!e || typeof e === 'string' ? '—' : empName(e, lang));
export const plateOf = (v: any) => (!v || typeof v === 'string' ? '—' : v.plateNumber || '—');

// ── Bilingual UI text for all Vehicles pages ─────────────────────────────────────
export function getVehiclesText(lang: Lang) {
  const ar = lang === 'ar';
  const t = (en: string, arr: string) => (ar ? arr : en);
  return {
    // shared
    notAuthorized: t('Not authorized', 'لا تملك صلاحية'),
    back: t('Back', 'رجوع'),
    save: t('Save', 'حفظ'),
    cancel: t('Cancel', 'إلغاء'),
    edit: t('Edit', 'تعديل'),
    delete: t('Delete', 'حذف'),
    confirm: t('Confirm', 'تأكيد'),
    search: t('Search...', 'بحث...'),
    all: t('All', 'الكل'),
    none: t('None', 'لا يوجد'),
    exportExcel: t('Export Excel', 'تصدير Excel'),
    actions: t('Actions', 'إجراءات'),
    status: t('Status', 'الحالة'),
    type: t('Type', 'النوع'),
    date: t('Date', 'التاريخ'),
    notes: t('Notes', 'ملاحظات'),
    employee: t('Employee', 'الموظف'),
    vehicle: t('Vehicle', 'المركبة'),
    plateNumber: t('Plate Number', 'رقم اللوحة'),
    deleteConfirm: t('Delete this item?', 'حذف هذا العنصر؟'),

    // sections / nav
    sectionTitle: t('Vehicles & Authorizations', 'المركبات والتفاويض'),

    // dashboard
    dashboardTitle: t('Vehicles Dashboard', 'لوحة المركبات'),
    dashboardSubtitle: t('Fleet, authorizations & accidents overview', 'نظرة عامة على الأسطول والتفاويض والحوادث'),
    totalVehicles: t('Total Vehicles', 'إجمالي المركبات'),
    authorized: t('Authorized', 'مُفوَّضة'),
    parked: t('Parked', 'مركونة'),
    available: t('Available', 'متاحة'),
    maintenance: t('In Maintenance', 'في الصيانة'),
    activeAuthorizations: t('Active Authorizations', 'تفاويض سارية'),
    openAccidents: t('Open Accidents', 'حوادث مفتوحة'),
    byType: t('By Type', 'حسب النوع'),
    byStatus: t('By Status', 'حسب الحالة'),
    byBranch: t('By Branch', 'حسب الفرع'),
    recentAccidents: t('Recent Accidents', 'أحدث الحوادث'),
    recentAuthorizations: t('Recent Authorizations', 'أحدث التفاويض'),
    noData: t('No data', 'لا توجد بيانات'),
    // dashboard extra
    outOfService: t('Out of Service', 'خارج الخدمة'),
    totalAccidents: t('Total Accidents', 'إجمالي الحوادث'),
    estimatedCostTotal: t('Estimated Accident Cost', 'التكلفة التقديرية للحوادث'),
    actualCostTotal: t('Actual Accident Cost', 'التكلفة الفعلية للحوادث'),
    expiringAuthorizations: t('Expiring Authorizations', 'تفاويض قاربت على الانتهاء'),
    expiringAuthsSubtitle: t('Active تفاويض expiring within 30 days', 'تفاويض سارية تنتهي خلال 30 يوماً'),
    accidentsBySeverity: t('Accidents by Severity', 'الحوادث حسب الخطورة'),
    accidentsByFault: t('Accidents by Fault', 'الحوادث حسب المتسبب'),
    accidentsByStatus: t('Accidents by Status', 'الحوادث حسب الحالة'),
    expired: t('Expired', 'منتهٍ'),

    // fleet list
    fleetTitle: t('Fleet & Authorizations', 'الأسطول والتفاويض'),
    vehiclesUnit: t('vehicles', 'مركبة'),
    addVehicle: t('Add Vehicle', 'إضافة مركبة'),
    editVehicle: t('Edit Vehicle', 'تعديل مركبة'),
    allTypes: t('All Types', 'كل الأنواع'),
    allStatuses: t('All Statuses', 'كل الحالات'),
    authorizedTo: t('Authorized To', 'مُفوَّضة لـ'),
    notAuthorizedYet: t('Not authorized', 'غير مُفوَّضة'),
    make: t('Make', 'الصانع'),
    model: t('Model', 'الطراز'),
    year: t('Year', 'سنة الصنع'),
    color: t('Color', 'اللون'),
    branch: t('Branch', 'الفرع'),
    department: t('Department', 'القسم'),
    project: t('Project', 'المشروع'),
    registrationExpiry: t('Registration Expiry', 'انتهاء الاستمارة'),
    insuranceExpiry: t('Insurance Expiry', 'انتهاء التأمين'),
    noVehicles: t('No vehicles yet', 'لا توجد مركبات بعد'),
    plateRequired: t('Plate number is required', 'رقم اللوحة مطلوب'),

    // vehicle detail
    vehicleDetails: t('Vehicle Details', 'تفاصيل المركبة'),
    currentAuthorization: t('Current Authorization', 'التفويض الحالي'),
    timeline: t('History & Timeline', 'السجل والتسلسل الزمني'),
    authHistory: t('Authorization History', 'سجل التفاويض'),
    accidents: t('Accidents', 'الحوادث'),
    tabOverview: t('Overview', 'نظرة عامة'),
    tabAuthorizations: t('Authorizations', 'التفاويض'),
    tabAccidents: t('Accidents', 'الحوادث'),
    authorize: t('Authorize', 'تفويض'),
    transfer: t('Transfer', 'نقل التفويض'),
    revoke: t('Revoke', 'إلغاء التفويض'),
    reportAccident: t('Report Accident', 'تسجيل حادث'),
    authorizeVehicle: t('Authorize Vehicle', 'تفويض المركبة'),
    transferAuthorization: t('Transfer Authorization', 'نقل التفويض'),
    revokeAuthorization: t('Revoke Authorization', 'إلغاء التفويض'),
    newHolder: t('New Holder', 'الموظف الجديد'),
    selectEmployee: t('Select employee...', 'اختر موظف...'),
    startDate: t('Start Date', 'تاريخ البدء'),
    endDate: t('End Date', 'تاريخ الانتهاء'),
    authType: t('Authorization Type', 'نوع التفويض'),
    documentNumber: t('Document Number', 'رقم الوثيقة'),
    documentExpiry: t('Document Expiry', 'انتهاء الوثيقة'),
    issuedBy: t('Issued By', 'جهة الإصدار'),
    revokedReason: t('Reason (parking / return)', 'السبب (ركن / تسليم)'),
    transferredTo: t('Transferred to', 'نُقل إلى'),
    transferredFrom: t('Transferred from', 'نُقل من'),
    issuedOn: t('Issued', 'صدر بتاريخ'),
    endedOn: t('Ended', 'انتهى بتاريخ'),
    by: t('by', 'بواسطة'),
    period: t('Period', 'الفترة'),
    noAuthorizations: t('No authorizations recorded', 'لا توجد تفاويض مسجلة'),
    noAccidents: t('No accidents recorded', 'لا توجد حوادث مسجلة'),
    parkedNoHolder: t('Vehicle is parked — no current holder', 'المركبة مركونة — لا يوجد مُفوَّض حالياً'),
    vehicleNotFound: t('Vehicle not found', 'المركبة غير موجودة'),

    // accident form / register
    accidentsTitle: t('Accidents Register', 'سجل الحوادث'),
    accidentsUnit: t('accidents', 'حادث'),
    newAccident: t('Report Accident', 'تسجيل حادث'),
    editAccident: t('Edit Accident', 'تعديل حادث'),
    location: t('Location', 'الموقع'),
    description: t('Description', 'الوصف'),
    whatHappened: t('What happened', 'ماذا حدث'),
    faultParty: t('At Fault', 'المتسبب'),
    severity: t('Severity', 'الخطورة'),
    thirdPartyDetails: t('Third Party Details', 'تفاصيل الطرف الثالث'),
    injuries: t('Injuries', 'إصابات'),
    actionTaken: t('Action Taken', 'الإجراء المتخذ'),
    reportNumber: t('Report / Police No.', 'رقم البلاغ / المحضر'),
    estimatedCost: t('Estimated Cost', 'التكلفة التقديرية'),
    actualCost: t('Actual Cost', 'التكلفة الفعلية'),
    resolution: t('Resolution', 'التسوية'),
    descriptionRequired: t('Date and description are required', 'التاريخ والوصف مطلوبان'),
    allAccidentStatuses: t('All Statuses', 'كل الحالات'),

    // employee profile tab
    empVehicleTab: t('Vehicles', 'المركبات'),
    empCurrentVehicle: t('Currently Authorized Vehicle', 'المركبة المُفوَّضة حالياً'),
    empNoCurrentVehicle: t('No vehicle currently authorized', 'لا توجد مركبة مُفوَّضة حالياً'),
    empAuthHistory: t('Authorization History', 'سجل التفاويض'),
    empAccidents: t('Accidents', 'الحوادث'),
    since: t('Since', 'منذ'),
    viewVehicle: t('View vehicle', 'عرض المركبة'),

    // overview extra (employee profile new fields section)
    sectionBankingDocs: t('Banking & Documents', 'البيانات البنكية والمستندات'),
    sectionDriving: t('Driving & Vehicle', 'القيادة والمركبة'),
    iban: t('IBAN', 'الآيبان'),
    bank: t('Bank', 'البنك'),
    project2: t('Project', 'المشروع'),
    registerNumber: t('CR Number', 'رقم السجل'),
    absherNumber: t('Absher Number', 'رقم أبشر'),
    penaltyClause: t('Penalty Clause', 'الشرط الجزائي'),
    iqamaProfession: t('Profession (Iqama)', 'المهنة في الإقامة'),
    insuranceCompany: t('Insurance Company', 'شركة التأمين'),
    socialInsuranceStatus: t('Social Insurance', 'التأمينات الاجتماعية'),
    visaExpiry: t('Visa Expiry', 'انتهاء التأشيرة'),
    classification: t('Classification', 'التصنيف'),
    licenseNumber: t('License No.', 'رقم الرخصة'),
    licenseType: t('License Type', 'نوع الرخصة'),
    licenseExpiry: t('License Expiry', 'انتهاء الرخصة'),
    driverCardNumber: t('Driver Card No.', 'رقم كارت السائق'),
    driverCardType: t('Driver Card Type', 'نوع كارت السائق'),
    driverCardExpiry: t('Driver Card Expiry', 'انتهاء كارت السائق'),
    vehiclePlate: t('Vehicle Plate', 'لوحة المركبة'),
    fileStatus: t('File Status', 'حالة الملف'),
  };
}
