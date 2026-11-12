import api from '@/lib/api';
import { canEditSection } from '@/lib/sections';
// Vehicle Registry types and helpers, mirroring /api/vehicle-registry.
export type DocStatus = { status: 'expired' | 'critical' | 'warning' | 'valid' | 'none'; days: number | null };

export type VReg = {
  _id: string;
  /** End of service: archived vehicles keep their history but leave every active list (backend utils/vehicleActive). */
  archived?: boolean;
  archive?: { endDate?: string | null; reason?: string; byName?: string; at?: string | null; lastRider?: string };
  archiveLog?: { action: 'end' | 'restore'; date?: string | null; reason?: string; byName?: string; at?: string }[];
  plateNumber: string; plateLettersAr?: string; plateDigits?: string;
  chassisNumber?: string; serialNumber?: string;
  sectorAr?: string; sectorCode?: string;
  // Added with the section files update.
  departmentAr?: string; cityAr?: string; possessionStatusAr?: string;
  authorizedPerson?: {
    name?: string; iqamaNumber?: string; jobTitleAr?: string;
    authorizationNumber?: string; startDate?: string | null; expiryDate?: string | null; statusCode?: string;
  };
  /**
   * Driver card of the authorized driver on this vehicle, looked up by iqama number.
   * Not a vehicle field: the server joins it from the driver cards register on every read, so the screen can show card validity and fidelity cover.
   */
  driverCard?: {
    _id: string; cardNumber?: string; cardType?: string; expiryDate?: string;
    daysLeft?: number | null; state?: string; fidelityStatus?: '' | 'covered' | 'required';
  };
  /** Whether the vehicle is operating at all: in service, unused or stolen. */
  serviceStatusAr?: string; serviceStatusCode?: string;
  /** Logisti platform requirements this vehicle does not meet; a work list, not a description. */
  logistiGaps?: string[];
  /** Missing items with the reason for each; none, required and held by the bank are distinct states. */
  missingItems?: { item: string; docKey: string; reason: string }[];
  insurancePolicy?: string | null;
  accidentCount?: number;
  registrationTypeAr?: string; registrationTypeCode?: string;
  /** Owning company; the group has two companies and the fleet is shared in operation but separate in ownership. */
  ownerCompanyAr?: string;
  brandAr?: string; modelAr?: string; modelYear?: number | null; colorAr?: string; colorCode?: string;
  ownerNameAr?: string; commercialRegistration?: string; tamStatusAr?: string; tamStatusCode?: string;
  insurance?: { policyNumber?: string; companyAr?: string; coverageTypeAr?: string; coverageTypeCode?: string; expiryDate?: string | null; premiumSar?: number | null; premiumStatusAr?: string; status?: string; statusCode?: string };
  fuelCard?: { provider?: string; cardNumber?: string; plateOnInvoiceAr?: string; statusAr?: string; statusCode?: string; consumptionTypeAr?: string; consumptionTypeCode?: string; limitSar?: number | null; limitStatus?: string };
  gps?: { deviceId?: string; deviceModel?: string; deviceStatusAr?: string; simNumber?: string; serialImei?: string; provider?: string; status?: string; statusCode?: string; expiryDate?: string | null };
  operatingCard?: { cardNumber?: string; expiryDate?: string | null; statusCode?: string };
  vehicleLicense?: { expiryDate?: string | null; expiryDateHijri?: string; statusCode?: string };
  inspection?: { statusAr?: string; statusCode?: string; expiryDate?: string | null; expiryDateHijri?: string };
  /** Renewals log; carries the previous and new number so the trail reads backwards. */
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

// Each document also carries its number: a renewed document may come out with a new one (operating card always, authorization sometimes).
// The renewal dialog needs to know this before rendering. Registration and inspection have no number, so numberAr is null and no field is shown.
export const DOC_TYPES = [
  // The insurance policy alone is a shared sheet: one policy covers many vehicles with one number and one renewal event.
  // Operating card and authorization are per vehicle. The flag mirrors sharedNumber in config/vehicleDocuments; the server rejects violations.
  { key: 'insurance', ar: 'التأمين', en: 'Insurance', datePath: (v: VReg) => v.insurance?.expiryDate,
    sharedNumber: true,
    numberAr: 'رقم وثيقة التأمين', numberEn: 'Policy number', numberOf: (v: VReg) => v.insurance?.policyNumber || '' },
  { key: 'operatingCard', ar: 'بطاقة التشغيل', en: 'Operating Card', datePath: (v: VReg) => v.operatingCard?.expiryDate,
    numberAr: 'رقم بطاقة التشغيل', numberEn: 'Operating card number', numberOf: (v: VReg) => v.operatingCard?.cardNumber || '' },
  { key: 'vehicleLicense', ar: 'رخصة السير', en: 'Vehicle License', datePath: (v: VReg) => v.vehicleLicense?.expiryDate,
    numberAr: null, numberEn: null, numberOf: () => '' },
  { key: 'inspection', ar: 'الفحص', en: 'Inspection', datePath: (v: VReg) => v.inspection?.expiryDate,
    numberAr: null, numberEn: null, numberOf: () => '' },
  { key: 'gps', ar: 'اشتراك GPS', en: 'GPS', datePath: (v: VReg) => v.gps?.expiryDate,
    numberAr: 'سريال جهاز التتبّع', numberEn: 'GPS serial', numberOf: (v: VReg) => v.gps?.serialImei || '' },
  // Driving authorization is a normal document on the server: its end date feeds the expiries screen, alert thresholds and renewal.
  // Omitting it here would send it in the response with no column or card to show it.
  { key: 'authorization', ar: 'التفويض', en: 'Authorisation', datePath: (v: VReg) => v.authorizedPerson?.expiryDate,
    numberAr: 'رقم التفويض', numberEn: 'Authorisation number', numberOf: (v: VReg) => v.authorizedPerson?.authorizationNumber || '' },
  // The driver card is the seventh document. It is not read from a vehicle row (datePath is always empty), but it is listed so the expiries screen has a column and card for it.
  { key: 'driverCard', ar: 'بطاقة السائق', en: 'Driver card', datePath: () => undefined,
    numberAr: 'رقم بطاقة السائق', numberEn: 'Driver card number', numberOf: () => '' },
] as const;

/** Name of the document number field, or null for a document with no separate number. */
export const docNumberLabel = (key: string, ar: boolean): string | null => {
  const d = DOC_TYPES.find((x) => x.key === key);
  return d ? (ar ? d.numberAr : d.numberEn) : null;
};

/**
 * Name of the document start date field, or null when it has none.
 * Authorization has a start and an end; the end alone cannot say how long a driver has been authorized. Other documents have no start, so no field.
 */
/**
 * Administrative status of a document: is it required at all.
 * The question is how many vehicles lack an operating card, which dates cannot answer: a vehicle without a date may not need one (motorbike) or may need one not yet issued.
 * So the status is recorded by hand in statusCode: required (not yet issued), not_required, none. Mixing them shows a shortage that does not exist.
 */
export type DocNeed = 'have' | 'required' | 'not_required' | 'unknown';

const DOC_BLOCK: Record<string, string> = {
  insurance: 'insurance', operatingCard: 'operatingCard', vehicleLicense: 'vehicleLicense',
  inspection: 'inspection', gps: 'gps', authorization: 'authorizedPerson',
};

/** Administrative status of this document on this vehicle. */
export const docNeed = (v: VReg, docKey: string): DocNeed => {
  const d = DOC_TYPES.find((x) => x.key === docKey);
  if (d && d.datePath(v)) return 'have';                       // Has a date: present.
  const block = DOC_BLOCK[docKey];
  const code = block ? String(((v as any)[block] || {}).statusCode || '') : '';
  if (code === 'not_required' || code === 'not_in_use') return 'not_required';
  if (code === 'required') return 'required';
  if (code === 'none' || code === '') return 'required';       // No date and no recorded status: missing.
  return 'unknown';                                            // Held by the bank, held by the lessor, or unknown.
};

export const DOC_NEED_META: Record<DocNeed, { ar: string; en: string; tone: string }> = {
  have: { ar: 'موجود', en: 'On file', tone: 'green' },
  required: { ar: 'مطلوب — غير موجود', en: 'Required — missing', tone: 'red' },
  not_required: { ar: 'غير مطلوب', en: 'Not required', tone: 'slate' },
  unknown: { ar: 'لدى جهةٍ أخرى / غير معروف', en: 'Held elsewhere / unknown', tone: 'blue' },
};

export const docStartLabel = (key: string, ar: boolean): string | null => {
  if (key !== 'authorization') return null;
  return ar ? 'تاريخ بداية التفويض' : 'Authorisation start date';
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
  // The server sends seven states (stateOf in config/vehicleDocuments) but this table knew five. A not_required operating card gave an undefined state, then reading its color crashed the whole page.
  // The cause was a missing key in this table, not vehicle data.
  not_required: { ar: 'غير مطلوب', en: 'Not required', color: '#64748b', bg: 'bg-slate-100', text: 'text-slate-500' },
  upcoming: { ar: 'قارب على الانتهاء', en: 'Due soon', color: '#0ea5e9', bg: 'bg-sky-100', text: 'text-sky-800' },
};

/**
 * State to its display; never empty.
 * Completing the table is not enough, since a future server state would break it again. Reads go through here and an unknown state renders grey under its own name.
 */
export const statusMeta = (s?: string | null) =>
  STATUS_META[s || 'none'] || { ...STATUS_META.none, ar: String(s || '—'), en: String(s || '—') };


export const statusLabel = (s: string, ar: boolean) => (STATUS_META[s] ? (ar ? STATUS_META[s].ar : STATUS_META[s].en) : s);
export const statusColor = (s: string) => STATUS_META[s]?.color || '#94a3b8';

/**
 * The Hijri date is derived, not stored.
 * A separate hand-filled column was empty everywhere and would drift after a renewal updates only the Gregorian date.
 * Intl carries the Umm al-Qura calendar used in the Kingdom, so the derived value matches the paper and always follows the Gregorian date.
 */
const HIJRI_FMT = new Intl.DateTimeFormat('ar-SA-u-ca-islamic-umalqura-nu-latn', {
  year: 'numeric', month: '2-digit', day: '2-digit', timeZone: 'UTC',
});

export const toHijri = (d?: string | null): string => {
  if (!d) return '';
  const date = new Date(d);
  if (Number.isNaN(date.getTime())) return '';
  try {
    // Stripped of direction marks so they do not mix with the text around the field.
    return HIJRI_FMT.format(date).replace(/[\u200e\u200f]/g, '');
  } catch { return ''; }
};

/** hijriParts: parses a Hijri date string like "04/04/1448" into { y, m, d }. Also accepts 1448-04-04, 4/4/1448 and Arabic-Indic digits. */
export function hijriParts(text?: string | null): { y: number; m: number; d: number } | null {
  if (!text) return null;
  // Arabic-Indic digits are converted to Latin before parsing.
  const t = String(text).replace(/[\u0660-\u0669]/g, (c) => String(c.charCodeAt(0) - 0x0660))
    .replace(/[\u06f0-\u06f9]/g, (c) => String(c.charCodeAt(0) - 0x06f0))
    .replace(/هـ|AH|H/gi, '').trim();
  const n = t.split(/[^\d]+/).filter(Boolean).map(Number);
  if (n.length < 3) return null;
  // The year is the four-digit part, so both 1448-04-04 and 04/04/1448 parse.
  const [a, b, c] = n;
  const y = a > 1000 ? a : c;
  const d = a > 1000 ? c : a;
  const m = b;
  if (!y || !m || !d || m > 12 || d > 30) return null;
  return { y, m, d };
}

/**
 * fromHijri: Hijri to Gregorian YYYY-MM-DD.
 * Umm al-Qura month lengths come from official tables, so a formula is off by a day or two in some years. Intl has the right table but only formats, so toHijri is inverted: estimate the Gregorian day, then walk around it until it matches.
 * This keeps round trips exact: what is typed in Hijri and shown in Hijri returns unchanged.
 */
export function fromHijri(text?: string | null): string {
  const p = hijriParts(text);
  if (!p) return '';
  const want = `${String(p.d).padStart(2, '0')}/${String(p.m).padStart(2, '0')}/${p.y}`;
  // Starting point: a Hijri year is 354.367 days and year 1 begins 16 July 622 CE.
  const approx = Date.UTC(622, 6, 16) + Math.round(((p.y - 1) * 354.367 + (p.m - 1) * 29.53 + (p.d - 1)) * 86400000);
  for (let step = 0; step <= 40; step += 1) {
    for (const dir of step === 0 ? [0] : [step, -step]) {
      const cand = new Date(approx + dir * 86400000);
      const got = toHijri(cand.toISOString().slice(0, 10)).replace(/\s*هـ\s*$/, '').trim();
      if (got === want) return cand.toISOString().slice(0, 10);
    }
  }
  return '';
}

/** Hijri date without the suffix, for an input field. */
export const toHijriPlain = (d?: string | null): string =>
  toHijri(d).replace(/\s*هـ\s*$/, '').trim();

export const money = (n: unknown) => (Number(n) || 0).toLocaleString('en-US');
export const fmtDate = (d?: string | null) => (d ? new Date(d).toISOString().slice(0, 10) : '—');
// Readable text for the time left until expiry.
export const daysText = (n: number | null | undefined, ar: boolean) => {
  if (n == null) return '—';
  if (n < 0) return ar ? `انتهى منذ ${Math.abs(n)} يوم` : `expired ${Math.abs(n)}d ago`;
  if (n === 0) return ar ? 'ينتهي اليوم' : 'expires today';
  if (n === 1) return ar ? 'باقي يوم واحد' : '1 day left';
  return ar ? `باقي ${n} يوم` : `${n} days left`;
};

export const CHART_COLORS = ['#f37121', '#12325c', '#16a34a', '#0ea5e9', '#8b5cf6', '#ec4899', '#ca8a04', '#dc2626', '#14b8a6', '#64748b'];


// Overview: each card returns a ready filter that the UI passes unchanged to the list page, so both sides agree on what an empty column means.
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
    // Logisti platform gaps: vehicle count and total missing items; the second is the workload, since one vehicle can miss several requirements.
    withLogistiGaps: number; logistiGapItems: number;
    // Data gaps; not_required is excluded because it is a healthy state.
    withMissing: number; missingItems: number;
  };
  breakdowns: Breakdown[];
  documents: DocCard[];
  /** Missing requirements sorted by frequency, showing where to start. */
  logistiGaps: { value: string; count: number; filter: Record<string, string> }[];
  /** Gaps grouped by item then reason; each group is one piece of work. */
  missingBreakdown: {
    item: string; docKey: string; reason: string; reasonAr: string; reasonEn: string;
    count: number; filter: Record<string, string>;
  }[];
  claims: { total: number; open: number; estimatedSar: number; expectedRecoverySar: number; ourFault: number; byInsurer: { value: string; count: number }[] };
  /** Derived buckets (expiry horizons, vehicle ages), each with its filter. */
  analytics: { key: string; ar: string; en: string; kind: 'bar' | 'horizon'; items: { label: string; labelEn: string; count: number; filter: Record<string, string> }[] }[];
  corporate: { _id: string; scopeAr: string; companyAr: string; expiryDate: string; premiumSar: number; policyNumbers: string[]; state: string; days: number | null }[];
  alerts: Record<string, any>;
}

export interface ExpiringRow {
  vehicleId: string; plateNumber: string; brandAr: string; modelAr: string; sectorAr: string;
  ownerNameAr: string; modelYear: number | null;
  chassisNumber?: string; serialNumber?: string; registrationTypeAr?: string; ownerCompanyAr?: string; colorAr?: string;
  /** The authorized driver on a vehicle, or the driver card holder on a driver card row. */
  holder?: string; driverCardNumber?: string;
  /** A driver card row: has no vehicle and is renewed by card id. */
  driverCardId?: string;
  docKey: string; docAr: string; docEn: string;
  expiryDate: string | null; daysRemaining: number | null; state: string; statusCode: string;
  reference?: string; company?: string;
  /** Whether alerting is enabled for this type in settings. Sent with the row so a document with alerts off stays visible and flagged instead of silently dropped. */
  alertEnabled?: boolean;
}

/**
 * Three states shown to the user, not five.
 * The middle three (on radar, near expiry, very soon) are one state at three urgency levels, so the name is the same (near expiry) and only color differs: red-orange at seven days, pale blue at ninety.
 * publicState is the translation every screen and export goes through. Twin of backend/src/config/vehicleDocuments.js.
 */
export const STATE_META: Record<string, { ar: string; en: string; color: string; bg: string }> = {
  expired: { ar: 'منتهي', en: 'Expired', color: '#dc2626', bg: 'bg-red-100 text-red-700' },
  due: { ar: 'قارب على الانتهاء', en: 'Due soon', color: '#f59e0b', bg: 'bg-amber-100 text-amber-700' },
  valid: { ar: 'ساري', en: 'Valid', color: '#16a34a', bg: 'bg-emerald-100 text-emerald-700' },
  // Urgency levels are names, not colors: critical is today's work and near is next month's preparation. Thresholds are set per document in section settings; see config/vehicleDocuments.
  critical: { ar: 'حرج', en: 'Critical', color: '#ea580c', bg: 'bg-orange-100 text-orange-700' },
  warning: { ar: 'تحذير', en: 'Warning', color: '#f59e0b', bg: 'bg-amber-100 text-amber-700' },
  upcoming: { ar: 'قريب', en: 'Upcoming', color: '#0ea5e9', bg: 'bg-sky-100 text-sky-800' },
  // No date at all: pending work, not a document state.
  missing: { ar: 'مطلوب — بلا تاريخ', en: 'Needed — no date', color: '#94a3b8', bg: 'bg-slate-100 text-slate-600' },
  not_applicable: { ar: 'غير مطلوب', en: 'Not applicable', color: '#64748b', bg: 'bg-slate-100 text-slate-500' },
};

/** Twin of statusMeta for the states table; never returns empty for any key. */
export const stateMeta = (s?: string | null) =>
  STATE_META[s || 'valid'] || { ...STATE_META.not_applicable, ar: String(s || '—'), en: String(s || '—') };

/** State as displayed, now identical with no folding. Kept because many callers use it, and due stays a meaningful question: everything needing work and not expired is the sum of the three levels (isDue). */
export const publicState = (s: string): string => s;

/** Is it one of the three near-expiry levels? */
export const isDue = (s: string): boolean => ['critical', 'warning', 'upcoming'].includes(s);

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
 * documentNumber is optional; leaving it empty means the number stays the same.
 * It differs from reference: this is the number of the live paper written in its vehicle field, while reference is the payment receipt number kept only in the renewals log. Mixing them would replace operating card numbers with receipt numbers.
 */
export const renewDocument = (vehicleId: string, body: {
  document: string; newExpiry: string; documentNumber?: string;
  // A driver card is renewed by its id; it has no vehicle to attach to.
  driverCardId?: string; startDate?: string;
  cost?: number | null; reference?: string; note?: string;
}) => api.post<{ vehicle: VReg }>(`/api/vehicle-registry/${vehicleId}/renew`, body);

export const getClaims = (q: Record<string, string> = {}) =>
  api.get<{ claims: any[]; totals: { total: number; open: number; estimatedSar: number; expectedRecoverySar: number; gapSar: number; stale: number } }>(
    `/api/vehicle-registry/claims${qs(q) ? `?${qs(q)}` : ''}`);

export const getCorporatePolicies = () =>
  api.get<{ policies: any[] }>('/api/vehicle-registry/corporate-policies');
export const renewCorporatePolicy = (id: string, body: any) =>
  api.post(`/api/vehicle-registry/corporate-policies/${id}/renew`, body);

/** Ending the contract with the company, distinct from renewal. An ended document stops asking for renewal on the expiries screen, and the end is logged with its date and reason. */
export const endCorporatePolicy = (id: string, body: { endDate?: string; reason?: string }) =>
  api.post<{ policy: any }>(`/api/vehicle-registry/corporate-policies/${id}/end`, body);
export const reopenCorporatePolicy = (id: string) =>
  api.post<{ policy: any }>(`/api/vehicle-registry/corporate-policies/${id}/reopen`, {});

// A document can be corrected, not only renewed. Previously fixing a number, installment or insurer needed database access.
export const createCorporatePolicy = (body: any) =>
  api.post<{ policy: any }>('/api/vehicle-registry/corporate-policies', body);
export const updateCorporatePolicy = (id: string, body: any) =>
  api.put<{ policy: any }>(`/api/vehicle-registry/corporate-policies/${id}`, body);
export const deleteCorporatePolicy = (id: string) =>
  api.delete(`/api/vehicle-registry/corporate-policies/${id}`);

/**
 * Adds a driver to the fidelity insurance policy or removes him.
 * Written on the driver card, not the policy: the list is one register, not two copies. See DriverCard.fidelity.
 */
export const setPolicyDriver = (policyId: string, body: { cardId: string; covered: boolean; addedDate?: string }) =>
  api.post(`/api/vehicle-registry/corporate-policies/${policyId}/drivers`, body);

export const getDocumentTypes = () =>
  api.get<{ documents: { key: string; ar: string; en: string; icon: string; alert: any }[]; corporatePolicyAlert: any; states: any; statuses: any }>(
    '/api/vehicle-registry/document-types');

// Who can edit in the section: one answer in one place.
// Each page had its own role list, and the section's own roles (vehicles_manager / vehicles_staff) were missing from some, so the section owner saw read-only pages. Scattered lists drift whenever a role is added.
const EDIT_ROLES = ['super_admin', 'admin', 'it_manager', 'it_team_leader', 'it_specialist', 'vehicles_manager', 'vehicles_team_leader', 'vehicles_staff',
  'hr_manager', 'hr_team_leader', 'hr_specialist', 'cfo', 'accounting_manager', 'accounting_team_leader', 'accountant'];
const ADMIN_ROLES = ['super_admin', 'admin', 'it_manager', 'it_team_leader', 'it_specialist', 'vehicles_manager', 'vehicles_team_leader', 'hr_manager', 'hr_team_leader'];

/** Can create and edit (vehicles, renewals, accidents). */
export const canEditVehicles = (user: any): boolean =>
  !!user && (EDIT_ROLES.includes(user.role) || canEditSection(user?.permissions, 'Vehicles'));

/** Can delete and change alert settings. */
export const canAdminVehicles = (user: any): boolean =>
  !!user && (ADMIN_ROLES.includes(user.role) || (user.role !== 'client' && canEditSection(user?.permissions, 'Vehicles')));

/**
 * Editing and deleting accidents is limited to management, the finance manager and the accounts manager. The server guards it with authorize.strict, so a section grant does not open it.
 * Recording a new accident and attaching its papers stay with section editors (canEditVehicles).
 */
// Mirrors CLAIM_EDIT in backend/src/routes/vehicleRegistry.js, vehicles manager included.
export const CLAIM_EDIT_ROLES = ['super_admin', 'admin', 'it_manager', 'it_team_leader', 'it_specialist', 'cfo', 'accounting_manager', 'accounting_team_leader', 'vehicles_manager', 'vehicles_team_leader'];
export const canEditClaims = (user: any): boolean => !!user && CLAIM_EDIT_ROLES.includes(user.role);

// Accidents: create, edit, delete.
export const createClaim = (body: any) => api.post<{ claim: any }>('/api/vehicle-registry/claims', body);
export const updateClaim = (id: string, body: any) => api.put<{ claim: any }>(`/api/vehicle-registry/claims/${id}`, body);
export const deleteClaim = (id: string) => api.delete(`/api/vehicle-registry/claims/${id}`);

/** A single claim file; uncached so what is written is seen. */
export const getClaim = (id: string) => api.get<{ claim: any }>(`/api/vehicle-registry/claims/${id}`);
/** History of what happened to it, from audit entries, newest first. */
export const getClaimAudit = (id: string) =>
  api.get<{ logs: any[] }>(`/api/vehicle-registry/claims/${id}/audit`);
/** Attachments: the response carries the full claim, which replaces the screen state. */
export const addClaimAttachments = (id: string, files: { dataUrl: string; fileName: string; title: string }[]) =>
  api.post<{ claim: any }>(`/api/vehicle-registry/claims/${id}/attachments`, { files });
export const renameClaimAttachment = (id: string, attId: string, title: string) =>
  api.put<{ claim: any }>(`/api/vehicle-registry/claims/${id}/attachments/${attId}`, { title });
export const deleteClaimAttachment = (id: string, attId: string) =>
  api.delete<{ claim: any }>(`/api/vehicle-registry/claims/${id}/attachments/${attId}`);

// Renewing several documents with the same date. The number here is per row, not shared: each vehicle's card comes out with its own number, and one number written on a hundred of them would make them copies of one paper.
export const renewBulk = (body: {
  items: { vehicle: string; document: string; documentNumber?: string; driverCardId?: string }[];
  newExpiry: string; reference?: string; note?: string;
}) => api.post<{ renewed: any[]; summary: { count: number; vehicles: number } }>(
  '/api/vehicle-registry/renew-bulk', body);

/** Renews a shared sheet in one action: one insurance policy covering many vehicles is renewed once. The new number is legitimately shared here; the server rejects it for any document that has one paper per vehicle. */
export const renewSharedPolicy = (body: {
  document: string; number: string; newExpiry: string; newNumber?: string;
  cost?: number | null; reference?: string; note?: string;
}) => api.post<{ renewed: any[]; summary: { count: number; policyUpdated: boolean; number: string } }>(
  '/api/vehicle-registry/renew-shared', body);

/** Is this document a single paper covering several vehicles? */
export const isSharedPaper = (key: string): boolean =>
  !!(DOC_TYPES.find((d) => d.key === key) as any)?.sharedNumber;

// Vehicle insurance policies: one policy covers up to 239 vehicles and its renewal applies to all of them at once.
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

// Section registers: owners, authorized persons and tracking providers are built from the vehicles themselves, not parallel tables, so their vehicle counts always match what opens when clicked.
export type RegisterGroup = {
  ar: string; en: string; filterKey: string;
  items: any[];
};
export const getRegisters = () =>
  api.get<{ registers: Record<string, RegisterGroup>; totals: Record<string, number> }>(
    '/api/vehicle-registry/registers');

/** Filterable fields and their values with counts, computed over what remains after the other filters. */
export const getVehicleFilters = (q: Record<string, string> = {}) =>
  api.get<{ filters: { key: string; ar: string; en: string; groupAr: string; groupEn: string; values: { value: string; count: number }[] }[] }>(
    `/api/vehicle-registry/filters${qs(q) ? `?${qs(q)}` : ''}`);
