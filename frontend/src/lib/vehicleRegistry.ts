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

export type RegConfig = { alerts: Record<string, { enabled: boolean; warnDays: number }> };

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
  critical: { ar: 'حرج (≤30 يوم)', en: 'Critical (≤30d)', color: '#ea580c', bg: 'bg-orange-100', text: 'text-orange-700' },
  warning: { ar: 'تنبيه', en: 'Warning', color: '#ca8a04', bg: 'bg-amber-100', text: 'text-amber-700' },
  valid: { ar: 'سارٍ', en: 'Valid', color: '#16a34a', bg: 'bg-emerald-100', text: 'text-emerald-700' },
  none: { ar: 'غير مسجّل', en: 'None', color: '#94a3b8', bg: 'bg-slate-100', text: 'text-slate-500' },
};

export const statusLabel = (s: string, ar: boolean) => (STATUS_META[s] ? (ar ? STATUS_META[s].ar : STATUS_META[s].en) : s);
export const statusColor = (s: string) => STATUS_META[s]?.color || '#94a3b8';

export const money = (n: unknown) => (Number(n) || 0).toLocaleString('en-US');
export const fmtDate = (d?: string | null) => (d ? new Date(d).toISOString().slice(0, 10) : '—');
export const daysText = (n: number | null | undefined, ar: boolean) =>
  n == null ? '—' : n < 0 ? (ar ? `منذ ${Math.abs(n)} يوم` : `${Math.abs(n)}d ago`) : (ar ? `بعد ${n} يوم` : `in ${n}d`);

export const CHART_COLORS = ['#f37121', '#12325c', '#16a34a', '#0ea5e9', '#8b5cf6', '#ec4899', '#ca8a04', '#dc2626', '#14b8a6', '#64748b'];
