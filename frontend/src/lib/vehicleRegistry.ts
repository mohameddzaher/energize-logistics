import api from '@/lib/api';
// أنواع ومساعدات سجل المركبات (Vehicle Registry) — يقابل /api/vehicle-registry.
export type DocStatus = { status: 'expired' | 'critical' | 'warning' | 'valid' | 'none'; days: number | null };

export type VReg = {
  _id: string;
  plateNumber: string; plateLettersAr?: string; plateDigits?: string;
  chassisNumber?: string; serialNumber?: string;
  sectorAr?: string; sectorCode?: string;
  registrationTypeAr?: string; registrationTypeCode?: string;
  brandAr?: string; modelAr?: string; modelYear?: number | null; colorAr?: string; colorCode?: string;
  ownerNameAr?: string; commercialRegistration?: string; tamStatusAr?: string; tamStatusCode?: string;
  insurance?: { policyNumber?: string; companyAr?: string; coverageTypeAr?: string; coverageTypeCode?: string; expiryDate?: string | null; premiumSar?: number | null; status?: string };
  fuelCard?: { provider?: string; cardNumber?: string; statusAr?: string; statusCode?: string; consumptionTypeAr?: string; consumptionTypeCode?: string; limitSar?: number | null; limitStatus?: string };
  gps?: { deviceId?: string; simNumber?: string; provider?: string; status?: string; expiryDate?: string | null };
  operatingCard?: { cardNumber?: string; expiryDate?: string | null };
  vehicleLicense?: { expiryDate?: string | null };
  inspection?: { statusAr?: string; statusCode?: string; expiryDate?: string | null };
  notesAr?: string; isActive?: boolean;
  docStatuses?: Record<string, DocStatus>;
  overallStatus?: DocStatus['status']; overallDays?: number | null;
};

export type AlertItem = {
  vehicleId: string; plateNumber: string; brandAr?: string; modelAr?: string; sectorAr?: string; ownerNameAr?: string;
  docType: string; docAr: string; docEn: string; expiryDate: string; daysRemaining: number; status: 'expired' | 'critical' | 'warning';
};

export type RegConfig = { alerts: Record<string, { enabled: boolean; warnDays: number; criticalDays: number }> };

export const DOC_TYPES = [
  { key: 'insurance', ar: 'التأمين', en: 'Insurance', datePath: (v: VReg) => v.insurance?.expiryDate },
  { key: 'operatingCard', ar: 'بطاقة التشغيل', en: 'Operating Card', datePath: (v: VReg) => v.operatingCard?.expiryDate },
  { key: 'vehicleLicense', ar: 'رخصة السير', en: 'Vehicle License', datePath: (v: VReg) => v.vehicleLicense?.expiryDate },
  { key: 'inspection', ar: 'الفحص', en: 'Inspection', datePath: (v: VReg) => v.inspection?.expiryDate },
  { key: 'gps', ar: 'اشتراك GPS', en: 'GPS', datePath: (v: VReg) => v.gps?.expiryDate },
] as const;

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
  totals: { vehicles: number; insuredPremiumSar: number; withGps: number; activeFuelCards: number; withAccidents: number; needsAttention: number };
  breakdowns: Breakdown[];
  documents: DocCard[];
  claims: { total: number; open: number; estimatedSar: number; expectedRecoverySar: number; ourFault: number; byInsurer: { value: string; count: number }[] };
  corporate: { _id: string; scopeAr: string; companyAr: string; expiryDate: string; premiumSar: number; policyNumbers: string[]; state: string; days: number | null }[];
  alerts: Record<string, any>;
}

export interface ExpiringRow {
  vehicleId: string; plateNumber: string; brandAr: string; modelAr: string; sectorAr: string;
  ownerNameAr: string; modelYear: number | null;
  docKey: string; docAr: string; docEn: string;
  expiryDate: string | null; daysRemaining: number | null; state: string; statusCode: string;
  reference?: string; company?: string;
}

export const STATE_META: Record<string, { ar: string; en: string; color: string; bg: string }> = {
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

export const renewDocument = (vehicleId: string, body: { document: string; newExpiry: string; cost?: number | null; reference?: string; note?: string }) =>
  api.post<{ vehicle: VReg }>(`/api/vehicle-registry/${vehicleId}/renew`, body);

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
