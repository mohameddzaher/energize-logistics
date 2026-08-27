import api from '@/lib/api';
import { canEditSection } from '@/lib/sections';
// أنواع ومساعدات سجل المركبات (Vehicle Registry) — يقابل /api/vehicle-registry.
export type DocStatus = { status: 'expired' | 'critical' | 'warning' | 'valid' | 'none'; days: number | null };

export type VReg = {
  _id: string;
  plateNumber: string; plateLettersAr?: string; plateDigits?: string;
  chassisNumber?: string; serialNumber?: string;
  sectorAr?: string; sectorCode?: string;
  // جاءت مع تحديث ملفات القسم
  departmentAr?: string; cityAr?: string; possessionStatusAr?: string;
  authorizedPerson?: {
    name?: string; iqamaNumber?: string; jobTitleAr?: string;
    authorizationNumber?: string; startDate?: string | null; expiryDate?: string | null; statusCode?: string;
  };
  /** هل تعمل المركبة أصلًا: في الخدمة / غير مستخدمة / مسروقة. */
  serviceStatusAr?: string; serviceStatusCode?: string;
  /** شروط منصّة لوجستي التي لم تستوفِها هذه المركبة — قائمة عمل لا وصف. */
  logistiGaps?: string[];
  /** البنود الناقصة وسببُ كلٍّ منها: «لا يوجد» و«مطلوب» و«لدى البنك» أوضاع مختلفة. */
  missingItems?: { item: string; docKey: string; reason: string }[];
  insurancePolicy?: string | null;
  accidentCount?: number;
  registrationTypeAr?: string; registrationTypeCode?: string;
  brandAr?: string; modelAr?: string; modelYear?: number | null; colorAr?: string; colorCode?: string;
  ownerNameAr?: string; commercialRegistration?: string; tamStatusAr?: string; tamStatusCode?: string;
  insurance?: { policyNumber?: string; companyAr?: string; coverageTypeAr?: string; coverageTypeCode?: string; expiryDate?: string | null; premiumSar?: number | null; premiumStatusAr?: string; status?: string; statusCode?: string };
  fuelCard?: { provider?: string; cardNumber?: string; plateOnInvoiceAr?: string; statusAr?: string; statusCode?: string; consumptionTypeAr?: string; consumptionTypeCode?: string; limitSar?: number | null; limitStatus?: string };
  gps?: { deviceId?: string; deviceModel?: string; deviceStatusAr?: string; simNumber?: string; serialImei?: string; provider?: string; status?: string; statusCode?: string; expiryDate?: string | null };
  operatingCard?: { cardNumber?: string; expiryDate?: string | null; statusCode?: string };
  vehicleLicense?: { expiryDate?: string | null; expiryDateHijri?: string; statusCode?: string };
  inspection?: { statusAr?: string; statusCode?: string; expiryDate?: string | null; expiryDateHijri?: string };
  /** سجل التجديدات — يحمل الرقم السابق والجديد، فالأثر يُقرأ إلى الوراء. */
  renewals?: {
    document: string; previousExpiry?: string | null; newExpiry: string;
    previousNumber?: string; newNumber?: string;
    cost?: number | null; reference?: string; note?: string; at?: string; byName?: string;
  }[];
  notesAr?: string; isActive?: boolean;
  docStatuses?: Record<string, DocStatus>;
  overallStatus?: DocStatus['status']; overallDays?: number | null;
};

export type AlertItem = {
  vehicleId: string; plateNumber: string; brandAr?: string; modelAr?: string; sectorAr?: string; ownerNameAr?: string;
  docType: string; docAr: string; docEn: string; expiryDate: string; daysRemaining: number; status: 'expired' | 'critical' | 'warning';
};

export type RegConfig = { alerts: Record<string, { enabled: boolean; warnDays: number; criticalDays: number }> };

// ── ولماذا يحمل كل مستندٍ هنا رقمَه أيضًا ────────────────────────────────────
// المستند الذي يُجدَّد قد يخرج برقمٍ جديد: بطاقة التشغيل دائمًا، والتفويض
// أحيانًا. فنافذة التجديد تحتاج أن تعرف — قبل أن تُرسَم — أتسأل عن رقمٍ جديد
// أم تسكت؛ ورخصةُ السير والفحص لا رقم لهما فـ`numberAr` فيهما `null`، وهو ما
// يمنع النافذة من عرض خانةٍ لا موضع لها في الخادم.
export const DOC_TYPES = [
  { key: 'insurance', ar: 'التأمين', en: 'Insurance', datePath: (v: VReg) => v.insurance?.expiryDate,
    numberAr: 'رقم وثيقة التأمين', numberEn: 'Policy number', numberOf: (v: VReg) => v.insurance?.policyNumber || '' },
  { key: 'operatingCard', ar: 'بطاقة التشغيل', en: 'Operating Card', datePath: (v: VReg) => v.operatingCard?.expiryDate,
    numberAr: 'رقم بطاقة التشغيل', numberEn: 'Operating card number', numberOf: (v: VReg) => v.operatingCard?.cardNumber || '' },
  { key: 'vehicleLicense', ar: 'رخصة السير', en: 'Vehicle License', datePath: (v: VReg) => v.vehicleLicense?.expiryDate,
    numberAr: null, numberEn: null, numberOf: () => '' },
  { key: 'inspection', ar: 'الفحص', en: 'Inspection', datePath: (v: VReg) => v.inspection?.expiryDate,
    numberAr: null, numberEn: null, numberOf: () => '' },
  { key: 'gps', ar: 'اشتراك GPS', en: 'GPS', datePath: (v: VReg) => v.gps?.expiryDate,
    numberAr: 'سريال جهاز التتبّع', numberEn: 'GPS serial', numberOf: (v: VReg) => v.gps?.serialImei || '' },
  // التفويض بالقيادة صار مستندًا كسائر المستندات في الخادم: تاريخُ نهايته يمرّ
  // على شاشة الانتهاءات وعتبات التنبيه والتجديد. وإغفالُه هنا كان يعني أن يظهر
  // في ردّ الخادم ولا يجد عمودًا ولا كارتًا يعرضه.
  { key: 'authorization', ar: 'التفويض', en: 'Authorisation', datePath: (v: VReg) => v.authorizedPerson?.expiryDate,
    numberAr: 'رقم التفويض', numberEn: 'Authorisation number', numberOf: (v: VReg) => v.authorizedPerson?.authorizationNumber || '' },
] as const;

/** اسمُ رقمِ المستند، أو null للمستند الذي لا رقم مستقلَّ له. */
export const docNumberLabel = (key: string, ar: boolean): string | null => {
  const d = DOC_TYPES.find((x) => x.key === key);
  return d ? (ar ? d.numberAr : d.numberEn) : null;
};

export const docLabel = (key: string, ar: boolean) => {
  const d = DOC_TYPES.find((x) => x.key === key);
  return d ? (ar ? d.ar : d.en) : key;
};

export const STATUS_META: Record<string, { ar: string; en: string; color: string; bg: string; text: string }> = {
  expired: { ar: 'منتهي', en: 'Expired', color: '#dc2626', bg: 'bg-red-100', text: 'text-red-700' },
  critical: { ar: 'حرج', en: 'Critical', color: '#ea580c', bg: 'bg-orange-100', text: 'text-orange-700' },
  warning: { ar: 'قريب الانتهاء', en: 'Expiring soon', color: '#ca8a04', bg: 'bg-amber-100', text: 'text-amber-700' },
  valid: { ar: 'ساري', en: 'Valid', color: '#16a34a', bg: 'bg-emerald-100', text: 'text-emerald-700' },
  none: { ar: 'غير مسجّل', en: 'None', color: '#94a3b8', bg: 'bg-slate-100', text: 'text-slate-500' },
};

export const statusLabel = (s: string, ar: boolean) => (STATUS_META[s] ? (ar ? STATUS_META[s].ar : STATUS_META[s].en) : s);
export const statusColor = (s: string) => STATUS_META[s]?.color || '#94a3b8';

export const money = (n: unknown) => (Number(n) || 0).toLocaleString('en-US');
export const fmtDate = (d?: string | null) => (d ? new Date(d).toISOString().slice(0, 10) : '—');
// نص واضح للمدة المتبقية على الانتهاء.
export const daysText = (n: number | null | undefined, ar: boolean) => {
  if (n == null) return '—';
  if (n < 0) return ar ? `انتهى منذ ${Math.abs(n)} يوم` : `expired ${Math.abs(n)}d ago`;
  if (n === 0) return ar ? 'ينتهي اليوم' : 'expires today';
  if (n === 1) return ar ? 'باقي يوم واحد' : '1 day left';
  return ar ? `باقي ${n} يوم` : `${n} days left`;
};

export const CHART_COLORS = ['#f37121', '#12325c', '#16a34a', '#0ea5e9', '#8b5cf6', '#ec4899', '#ca8a04', '#dc2626', '#14b8a6', '#64748b'];


// ── النظرة الشاملة ──────────────────────────────────────────────────────────
// كل كارت بيرجع معاه `filter` جاهز — الواجهة بتبعته زي ما هو لصفحة القائمة بدل
// ما تبني الفلتر عندها وتختلف عن السيرفر في معنى «العمود ده فاضي».
export interface BreakdownItem { value: string; count: number; filter: Record<string, string> }
export interface Breakdown { key: string; ar: string; en: string; field: string; items: BreakdownItem[] }

export interface DocCard {
  key: string; ar: string; en: string; icon: string;
  alert: { enabled?: boolean; warnDays?: number; criticalDays?: number };
  states: Record<'valid' | 'warning' | 'critical' | 'expired' | 'missing' | 'not_applicable', number>;
  statuses: { code: string; ar: string; en: string; count: number }[];
  needsAttention: number;
  nearestDays: number | null;
}

export interface VehicleOverview {
  totals: {
    vehicles: number; insuredPremiumSar: number; withGps: number; activeFuelCards: number;
    withAccidents: number; needsAttention: number;
    // نواقص منصّة لوجستي: عدد المركبات، وعدد البنود الناقصة في المجموع —
    // والثاني هو حجم العمل، فالمركبة الواحدة قد ينقصها أكثر من شرط.
    withLogistiGaps: number; logistiGapItems: number;
    // نواقص البيانات — «غير مطلوب» غير محسوبة فيها لأنها حالة سليمة.
    withMissing: number; missingItems: number;
  };
  breakdowns: Breakdown[];
  documents: DocCard[];
  /** الشروط الناقصة مرتّبة بالأكثر تكرارًا — من أين يبدأ العمل. */
  logistiGaps: { value: string; count: number; filter: Record<string, string> }[];
  /** النواقص مجمَّعة بالبند ثم بالسبب — كل مجموعة بندٌ من العمل. */
  missingBreakdown: {
    item: string; docKey: string; reason: string; reasonAr: string; reasonEn: string;
    count: number; filter: Record<string, string>;
  }[];
  claims: { total: number; open: number; estimatedSar: number; expectedRecoverySar: number; ourFault: number; byInsurer: { value: string; count: number }[] };
  /** شرائح مشتقّة (آفاق الانتهاء، أعمار المركبات) — كلٌّ ومعها فلترها. */
  analytics: { key: string; ar: string; en: string; kind: 'bar' | 'horizon'; items: { label: string; labelEn: string; count: number; filter: Record<string, string> }[] }[];
  corporate: { _id: string; scopeAr: string; companyAr: string; expiryDate: string; premiumSar: number; policyNumbers: string[]; state: string; days: number | null }[];
  alerts: Record<string, any>;
}

export interface ExpiringRow {
  vehicleId: string; plateNumber: string; brandAr: string; modelAr: string; sectorAr: string;
  ownerNameAr: string; modelYear: number | null;
  docKey: string; docAr: string; docEn: string;
  expiryDate: string | null; daysRemaining: number | null; state: string; statusCode: string;
  reference?: string; company?: string;
  /** هل التنبيه مفعَّل لهذا النوع في الإعدادات؟ يصل مع الصف لأن المستند
   *  المتوقَّف تنبيهه يبقى معروضًا ومعلَّمًا لا محذوفًا في صمت. */
  alertEnabled?: boolean;
}

export const STATE_META: Record<string, { ar: string; en: string; color: string; bg: string }> = {
  upcoming: { ar: 'على الرادار', en: 'Upcoming', color: '#0ea5e9', bg: 'bg-sky-100 text-sky-800' },
  valid: { ar: 'ساري', en: 'Valid', color: '#16a34a', bg: 'bg-emerald-100 text-emerald-700' },
  warning: { ar: 'قارب على الانتهاء', en: 'Due soon', color: '#f59e0b', bg: 'bg-amber-100 text-amber-700' },
  critical: { ar: 'ينتهي قريبًا جدًا', en: 'Critical', color: '#ea580c', bg: 'bg-orange-100 text-orange-700' },
  expired: { ar: 'منتهي', en: 'Expired', color: '#dc2626', bg: 'bg-red-100 text-red-700' },
  missing: { ar: 'بدون تاريخ', en: 'No date', color: '#94a3b8', bg: 'bg-slate-100 text-slate-600' },
  not_applicable: { ar: 'غير مطلوب', en: 'Not applicable', color: '#64748b', bg: 'bg-slate-100 text-slate-500' },
};
export const stateLabel = (s: string, ar: boolean) => (STATE_META[s] ? (ar ? STATE_META[s].ar : STATE_META[s].en) : s);

const qs = (q: Record<string, string | number | undefined>) =>
  new URLSearchParams(Object.entries(q).filter(([, v]) => v !== undefined && v !== '').map(([k, v]) => [k, String(v)])).toString();

export const getOverview = (q: Record<string, string> = {}) =>
  api.get<VehicleOverview>(`/api/vehicle-registry/overview${qs(q) ? `?${qs(q)}` : ''}`);

export const getExpiring = (q: Record<string, string | number | undefined> = {}) =>
  api.get<{
    rows: ExpiringRow[];
    summary: Record<string, number>;
    byDoc: { key: string; ar: string; en: string; count: number }[];
    withinDays: number | null;
    docs: { key: string; ar: string; en: string }[];
  }>(`/api/vehicle-registry/expiring${qs(q) ? `?${qs(q)}` : ''}`);

/**
 * `documentNumber` اختياريّ، وتركُه فارغًا يعني «الرقم هو هو».
 *
 * وهو غيرُ `reference`: هذا رقمُ الورقة الجاري به العمل ويُكتب في خانتها على
 * المركبة، وذاك رقمُ إيصال السداد ويبقى في سجل التجديد وحده. خلطُهما كان
 * سيجعل رقمَ إيصالٍ يحلّ محلَّ رقم بطاقة التشغيل على مئتي مركبة.
 */
export const renewDocument = (vehicleId: string, body: {
  document: string; newExpiry: string; documentNumber?: string;
  cost?: number | null; reference?: string; note?: string;
}) => api.post<{ vehicle: VReg }>(`/api/vehicle-registry/${vehicleId}/renew`, body);

export const getClaims = (q: Record<string, string> = {}) =>
  api.get<{ claims: any[]; totals: { total: number; open: number; estimatedSar: number; expectedRecoverySar: number; gapSar: number; stale: number } }>(
    `/api/vehicle-registry/claims${qs(q) ? `?${qs(q)}` : ''}`);

export const getCorporatePolicies = () =>
  api.get<{ policies: any[] }>('/api/vehicle-registry/corporate-policies');
export const renewCorporatePolicy = (id: string, body: any) =>
  api.post(`/api/vehicle-registry/corporate-policies/${id}/renew`, body);

export const getDocumentTypes = () =>
  api.get<{ documents: { key: string; ar: string; en: string; icon: string; alert: any }[]; corporatePolicyAlert: any; states: any; statuses: any }>(
    '/api/vehicle-registry/document-types');

// ── مين يقدر يعدّل في القسم ──────────────────────────────────────────────────
//
// سؤال واحد، إجابة واحدة، في مكان واحد. كل صفحة كانت بتكتب قايمة أدوارها بنفسها،
// فأدوار القسم نفسه (vehicles_manager / vehicles_staff) كانوا ناقصين من بعضها —
// صاحب القسم يفتح صفحة الحوادث ويلاقيها للقراءة بس. القوايم المتفرّقة دي بتفضل
// تفرق مع بعضها كل ما دور جديد يتضاف.
const EDIT_ROLES = ['super_admin', 'admin', 'vehicles_manager', 'vehicles_staff',
  'hr_manager', 'hr_specialist', 'finance_manager', 'accountant'];
const ADMIN_ROLES = ['super_admin', 'admin', 'vehicles_manager', 'hr_manager'];

/** يقدر ينشئ ويعدّل (مركبات، تجديدات، حوادث). */
export const canEditVehicles = (user: any): boolean =>
  !!user && (EDIT_ROLES.includes(user.role) || canEditSection(user?.permissions, 'Vehicles'));

/** يقدر يحذف ويغيّر إعدادات التنبيهات. */
export const canAdminVehicles = (user: any): boolean =>
  !!user && (ADMIN_ROLES.includes(user.role) || (user.role !== 'client' && canEditSection(user?.permissions, 'Vehicles')));

// ── الحوادث: إنشاء وتعديل وحذف ───────────────────────────────────────────────
export const createClaim = (body: any) => api.post<{ claim: any }>('/api/vehicle-registry/claims', body);
export const updateClaim = (id: string, body: any) => api.put<{ claim: any }>(`/api/vehicle-registry/claims/${id}`, body);
export const deleteClaim = (id: string) => api.delete(`/api/vehicle-registry/claims/${id}`);

// ── تجديد أكتر من مستند بنفس التاريخ ─────────────────────────────────────────
// والرقم هنا **سطريّ لا مشترك**: بطاقةُ كل مركبة تخرج برقمها هي، ورقمٌ واحد
// يُكتب على مئةٍ منها يجعل المئة نسخةً من ورقة واحدة.
export const renewBulk = (body: {
  items: { vehicle: string; document: string; documentNumber?: string }[];
  newExpiry: string; reference?: string; note?: string;
}) => api.post<{ renewed: any[]; summary: { count: number; vehicles: number } }>(
  '/api/vehicle-registry/renew-bulk', body);

// ── وثائق تأمين المركبات ─────────────────────────────────────────────────────
// وثيقة واحدة تغطّي حتى ٢٣٩ مركبة؛ تجديدها يسري عليها كلها دفعةً واحدة.
export type InsurancePolicy = {
  _id: string; policyNumber: string; companyAr: string; coverageTypeAr: string;
  expiryDate: string | null; totalPremiumSar: number | null;
  vehicles: number; state: string; daysRemaining: number | null;
  renewals?: { newExpiry: string; vehiclesUpdated: number; byName: string; at: string }[];
};

export const getInsurancePolicies = () =>
  api.get<{
    policies: InsurancePolicy[];
    totals: { total: number; vehiclesCovered: number; premiumSar: number; expired: number; soon: number };
  }>('/api/vehicle-registry/insurance-policies');

export const renewInsurancePolicy = (id: string, body: {
  newExpiry: string; policyNumber?: string; cost?: number | null; reference?: string; note?: string;
}) => api.post<{ policy: InsurancePolicy; vehiclesUpdated: number }>(
  `/api/vehicle-registry/insurance-policies/${id}/renew`, body);

// ── سجلّات القسم ─────────────────────────────────────────────────────────────
// المُلّاك والمفوَّضون ومزوّدو التتبّع تُبنى من المركبات نفسها لا من جداول موازية،
// فعددُ مركبات أي منها لا يمكن أن يخالف ما تفتحه بالضغط عليه.
export type RegisterGroup = {
  ar: string; en: string; filterKey: string;
  items: any[];
};
export const getRegisters = () =>
  api.get<{ registers: Record<string, RegisterGroup>; totals: Record<string, number> }>(
    '/api/vehicle-registry/registers');

/** الحقول القابلة للفلترة وقيمها بأعدادها — محسوبة على ما تبقّى بعد بقيّة الفلاتر. */
export const getVehicleFilters = (q: Record<string, string> = {}) =>
  api.get<{ filters: { key: string; ar: string; en: string; groupAr: string; groupEn: string; values: { value: string; count: number }[] }[] }>(
    `/api/vehicle-registry/filters${qs(q) ? `?${qs(q)}` : ''}`);
