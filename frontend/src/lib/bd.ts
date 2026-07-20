// Shared types, bilingual labels and formatters for the Business Development
// section. BD is the upstream, strategic layer above the CRM/Sales pipeline:
// market entries, partnerships, tenders and new service lines — not individual
// customer deals (those stay in /lib/crm.ts).
import { exportToExcel, fmt } from '@/utils/exportExcel';

export { exportToExcel, fmt };

export type Lang = 'en' | 'ar';
const pick = (lang: Lang, en: string, ar: string) => (lang === 'ar' ? ar : en);

// ── Roles (mirror backend/src/routes/businessDevelopment.js) ─────────────────
// Staff can read the section; the admin tier can create/update/delete.
export const BD_STAFF_ROLES = [
  'super_admin', 'admin', 'it_manager', 'it_specialist',
  'bd_manager', 'bd_specialist',
  'sales_manager', 'crm_manager', 'operations_manager',
];
export const BD_ADMIN_ROLES = [
  'super_admin', 'admin', 'it_manager', 'it_specialist', 'bd_manager', 'bd_specialist',
];
export const isBdStaff = (role?: string | null) => !!role && BD_STAFF_ROLES.includes(role);
export const isBdAdmin = (role?: string | null) => !!role && BD_ADMIN_ROLES.includes(role);

// ── Types (mirror the backend models) ────────────────────────────────────────
export type BdStage = 'identified' | 'researching' | 'qualified' | 'proposal' | 'negotiation' | 'won' | 'lost' | 'on_hold';
export type BdOppType = 'new_market' | 'new_service' | 'partnership' | 'tender' | 'expansion' | 'other';
export type BdPriority = 'low' | 'medium' | 'high';
export type BdPartnerType = 'carrier' | 'agent' | 'supplier' | 'technology' | 'government' | 'association' | 'other';
export type BdPartnerStatus = 'prospect' | 'in_discussion' | 'active' | 'paused' | 'ended';
export type BdTenderStatus = 'watching' | 'preparing' | 'submitted' | 'shortlisted' | 'won' | 'lost' | 'cancelled';
export type BdActivityType = 'meeting' | 'call' | 'email' | 'visit' | 'proposal' | 'research' | 'followup' | 'other';
export type BdEntityType = 'opportunity' | 'partner' | 'tender';

export interface BdOpportunity {
  _id: string;
  name: string; nameAr?: string;
  type: BdOppType; stage: BdStage; priority: BdPriority;
  estimatedValue?: number; currency?: string; probability?: number;
  expectedCloseDate?: string;
  owner?: any; ownerName?: string;
  crmCompany?: any; partnerName?: string;
  region?: string; city?: string;
  description?: string; nextStep?: string; nextStepDate?: string; source?: string;
  competitors?: string[]; risks?: string; notes?: string;
  status?: 'open' | 'won' | 'lost' | 'on_hold';
  closedAt?: string; lostReason?: string;
  createdBy?: any; createdAt?: string; updatedAt?: string;
}

export interface BdPartner {
  _id: string;
  name: string; nameAr?: string;
  type: BdPartnerType; status: BdPartnerStatus;
  country?: string; city?: string; website?: string;
  contactName?: string; contactEmail?: string; contactPhone?: string;
  agreementStart?: string; agreementEnd?: string;
  services?: string[]; description?: string; notes?: string;
  owner?: any; ownerName?: string;
  createdBy?: any; createdAt?: string; updatedAt?: string;
}

export interface BdTender {
  _id: string;
  title: string; titleAr?: string;
  entity?: string; referenceNumber?: string;
  submissionDeadline?: string; status: BdTenderStatus;
  estimatedValue?: number; bidBondAmount?: number;
  scope?: string; requirements?: string[]; documentsReady?: boolean;
  submittedAt?: string; result?: string;
  owner?: any; ownerName?: string; notes?: string;
  opportunity?: any;
  // Computed server-side on list/get.
  daysLeft?: number | null;
  createdBy?: any; createdAt?: string; updatedAt?: string;
}

export interface BdActivity {
  _id: string;
  date?: string;
  entityType: BdEntityType; refId: string;
  title: string; type: BdActivityType;
  summary?: string; outcome?: string; nextStep?: string;
  performedBy?: any; performedByName?: string;
  createdBy?: any; createdAt?: string;
}

export interface BdDashboard {
  totals: {
    opportunities: number;
    openOpportunities: number;
    byStage: Record<string, number>;
    pipelineValue: number;
    weightedPipelineValue: number;
    won: number; lost: number; winRate: number;
    partners: Record<string, number>;
    tenders: Record<string, number>;
    tendersDueSoon: number;
    activitiesThisPeriod: number;
  };
  funnel: { stage: BdStage; count: number; value: number }[];
  timeline: BdActivity[];
  topOpportunities: BdOpportunity[];
  upcomingDeadlines: BdTender[];
  period: { from: string; to: string };
}

// ── Label / badge maps ───────────────────────────────────────────────────────
export type LabelStyle = { en: string; ar: string; bg: string; text: string };
type Map_ = Record<string, LabelStyle>;

export const OPP_TYPE: Map_ = {
  new_market: { en: 'New Market', ar: 'سوق جديد', bg: 'bg-indigo-100', text: 'text-indigo-700' },
  new_service: { en: 'New Service', ar: 'خدمة جديدة', bg: 'bg-sky-100', text: 'text-sky-700' },
  partnership: { en: 'Partnership', ar: 'شراكة', bg: 'bg-violet-100', text: 'text-violet-700' },
  tender: { en: 'Tender', ar: 'مناقصة', bg: 'bg-amber-100', text: 'text-amber-700' },
  expansion: { en: 'Expansion', ar: 'توسع', bg: 'bg-teal-100', text: 'text-teal-700' },
  other: { en: 'Other', ar: 'أخرى', bg: 'bg-slate-100', text: 'text-slate-600' },
};

export const OPP_STAGE: Map_ = {
  identified: { en: 'Identified', ar: 'تم تحديدها', bg: 'bg-slate-100', text: 'text-slate-700' },
  researching: { en: 'Researching', ar: 'قيد الدراسة', bg: 'bg-sky-100', text: 'text-sky-700' },
  qualified: { en: 'Qualified', ar: 'مؤهلة', bg: 'bg-indigo-100', text: 'text-indigo-700' },
  proposal: { en: 'Proposal', ar: 'عرض مقدم', bg: 'bg-violet-100', text: 'text-violet-700' },
  negotiation: { en: 'Negotiation', ar: 'تفاوض', bg: 'bg-amber-100', text: 'text-amber-700' },
  won: { en: 'Won', ar: 'تم الفوز', bg: 'bg-emerald-100', text: 'text-emerald-700' },
  lost: { en: 'Lost', ar: 'خسارة', bg: 'bg-red-100', text: 'text-red-700' },
  on_hold: { en: 'On Hold', ar: 'معلقة', bg: 'bg-slate-200', text: 'text-slate-600' },
};

// The clickable pipeline on the detail page — terminal stages are handled apart.
export const OPEN_STAGES: BdStage[] = ['identified', 'researching', 'qualified', 'proposal', 'negotiation'];
export const ALL_STAGES: BdStage[] = [...OPEN_STAGES, 'won', 'lost', 'on_hold'];

export const PRIORITY: Map_ = {
  low: { en: 'Low', ar: 'منخفضة', bg: 'bg-slate-100', text: 'text-slate-600' },
  medium: { en: 'Medium', ar: 'متوسطة', bg: 'bg-blue-100', text: 'text-blue-700' },
  high: { en: 'High', ar: 'عالية', bg: 'bg-red-100', text: 'text-red-700' },
};

export const PARTNER_TYPE: Map_ = {
  carrier: { en: 'Carrier', ar: 'ناقل', bg: 'bg-indigo-100', text: 'text-indigo-700' },
  agent: { en: 'Agent', ar: 'وكيل', bg: 'bg-sky-100', text: 'text-sky-700' },
  supplier: { en: 'Supplier', ar: 'مورد', bg: 'bg-teal-100', text: 'text-teal-700' },
  technology: { en: 'Technology', ar: 'تقنية', bg: 'bg-violet-100', text: 'text-violet-700' },
  government: { en: 'Government', ar: 'جهة حكومية', bg: 'bg-amber-100', text: 'text-amber-700' },
  association: { en: 'Association', ar: 'جمعية', bg: 'bg-cyan-100', text: 'text-cyan-700' },
  other: { en: 'Other', ar: 'أخرى', bg: 'bg-slate-100', text: 'text-slate-600' },
};

export const PARTNER_STATUS: Map_ = {
  prospect: { en: 'Prospect', ar: 'محتمل', bg: 'bg-slate-100', text: 'text-slate-700' },
  in_discussion: { en: 'In Discussion', ar: 'قيد التفاوض', bg: 'bg-amber-100', text: 'text-amber-700' },
  active: { en: 'Active', ar: 'نشطة', bg: 'bg-emerald-100', text: 'text-emerald-700' },
  paused: { en: 'Paused', ar: 'متوقفة مؤقتاً', bg: 'bg-blue-100', text: 'text-blue-700' },
  ended: { en: 'Ended', ar: 'منتهية', bg: 'bg-red-100', text: 'text-red-700' },
};

export const TENDER_STATUS: Map_ = {
  watching: { en: 'Watching', ar: 'متابعة', bg: 'bg-slate-100', text: 'text-slate-700' },
  preparing: { en: 'Preparing', ar: 'قيد التجهيز', bg: 'bg-amber-100', text: 'text-amber-700' },
  submitted: { en: 'Submitted', ar: 'تم التقديم', bg: 'bg-sky-100', text: 'text-sky-700' },
  shortlisted: { en: 'Shortlisted', ar: 'القائمة المختصرة', bg: 'bg-violet-100', text: 'text-violet-700' },
  won: { en: 'Won', ar: 'تم الفوز', bg: 'bg-emerald-100', text: 'text-emerald-700' },
  lost: { en: 'Lost', ar: 'خسارة', bg: 'bg-red-100', text: 'text-red-700' },
  cancelled: { en: 'Cancelled', ar: 'ملغاة', bg: 'bg-slate-200', text: 'text-slate-600' },
};

export const ACTIVITY_TYPE: Map_ = {
  meeting: { en: 'Meeting', ar: 'اجتماع', bg: 'bg-indigo-100', text: 'text-indigo-700' },
  call: { en: 'Call', ar: 'مكالمة', bg: 'bg-sky-100', text: 'text-sky-700' },
  email: { en: 'Email', ar: 'بريد إلكتروني', bg: 'bg-cyan-100', text: 'text-cyan-700' },
  visit: { en: 'Visit', ar: 'زيارة', bg: 'bg-teal-100', text: 'text-teal-700' },
  proposal: { en: 'Proposal', ar: 'عرض', bg: 'bg-violet-100', text: 'text-violet-700' },
  research: { en: 'Research', ar: 'بحث', bg: 'bg-amber-100', text: 'text-amber-700' },
  followup: { en: 'Follow-up', ar: 'متابعة', bg: 'bg-blue-100', text: 'text-blue-700' },
  other: { en: 'Other', ar: 'أخرى', bg: 'bg-slate-100', text: 'text-slate-600' },
};

export const ENTITY_TYPE: Map_ = {
  opportunity: { en: 'Opportunity', ar: 'فرصة', bg: 'bg-indigo-100', text: 'text-indigo-700' },
  partner: { en: 'Partner', ar: 'شريك', bg: 'bg-teal-100', text: 'text-teal-700' },
  tender: { en: 'Tender', ar: 'مناقصة', bg: 'bg-amber-100', text: 'text-amber-700' },
};

// Look a key up in one of the maps above; unknown keys degrade to the raw key.
export const styleOf = (map: Map_, key?: string | null): LabelStyle | null =>
  (key && map[key]) || null;
export const labelOf = (map: Map_, key?: string | null, lang: Lang = 'en'): string => {
  if (!key) return '—';
  const s = map[key];
  return s ? (lang === 'ar' ? s.ar : s.en) : key;
};
// Options for a <Select>, in map order.
export const optionsOf = (map: Map_, lang: Lang = 'en') =>
  Object.keys(map).map((key) => ({ key, label: lang === 'ar' ? map[key].ar : map[key].en }));

// Chart fills, keyed by stage — the funnel bar chart colours each stage.
export const STAGE_COLOR: Record<string, string> = {
  identified: '#94a3b8', researching: '#38bdf8', qualified: '#6366f1', proposal: '#8b5cf6',
  negotiation: '#f37121', won: '#10b981', lost: '#ef4444', on_hold: '#cbd5e1',
};
export const TYPE_COLOR: Record<string, string> = {
  new_market: '#6366f1', new_service: '#38bdf8', partnership: '#8b5cf6',
  tender: '#f59e0b', expansion: '#14b8a6', other: '#94a3b8',
};

// ── Formatters ───────────────────────────────────────────────────────────────
export const bdName = (r: { name?: string; nameAr?: string } | null | undefined, lang: Lang = 'en') => {
  if (!r) return '—';
  if (lang === 'ar' && r.nameAr) return r.nameAr;
  return r.name || '—';
};
export const bdTitle = (r: { title?: string; titleAr?: string } | null | undefined, lang: Lang = 'en') => {
  if (!r) return '—';
  if (lang === 'ar' && r.titleAr) return r.titleAr;
  return r.title || '—';
};
export const userName = (u: any) =>
  !u ? '—' : typeof u === 'string' ? u : `${u.firstName || ''} ${u.lastName || ''}`.trim() || '—';
export const companyName = (c: any, lang: Lang = 'en') => {
  if (!c) return '—';
  if (typeof c === 'string') return c;
  if (lang === 'ar' && c.arabicName) return c.arabicName;
  return c.name || '—';
};

export const today = () => new Date().toISOString().slice(0, 10);
export const toDateInput = (v?: string | null) => (v ? String(v).slice(0, 10) : '');
export const fmtDate = (v?: string | null) => (v ? new Date(v).toLocaleDateString('en-GB') : '—');
export const fmtDateTime = (v?: string | null) =>
  v ? new Date(v).toLocaleString('en-GB', { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—';
export const money = (v?: number | null, currency = 'SAR') =>
  `${(Number(v) || 0).toLocaleString('en-US', { maximumFractionDigits: 0 })} ${currency}`;
// Compact form for stat cards (1.2M SAR rather than 1,200,000 SAR).
export const moneyShort = (v?: number | null, currency = 'SAR') => {
  const n = Number(v) || 0;
  if (Math.abs(n) >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M ${currency}`;
  if (Math.abs(n) >= 1_000) return `${(n / 1_000).toFixed(0)}K ${currency}`;
  return `${n.toLocaleString('en-US')} ${currency}`;
};

// Days until a YYYY-MM-DD date (negative = past). Drives the tender urgency colours.
export const daysUntil = (v?: string | null): number | null => {
  if (!v) return null;
  const d0 = new Date(); d0.setHours(0, 0, 0, 0);
  const d1 = new Date(String(v).slice(0, 10)); d1.setHours(0, 0, 0, 0);
  if (Number.isNaN(d1.getTime())) return null;
  return Math.round((d1.getTime() - d0.getTime()) / 86400000);
};

// Colour-coded "days remaining" badge for a tender deadline.
export const deadlineBadge = (v?: string | null, lang: Lang = 'en'): { bg: string; text: string; label: string } | null => {
  const d = daysUntil(v);
  if (d === null) return null;
  if (d < 0) return { bg: 'bg-slate-100', text: 'text-slate-500', label: pick(lang, `${-d}d ago`, `منذ ${-d} يوم`) };
  if (d === 0) return { bg: 'bg-red-100', text: 'text-red-700', label: pick(lang, 'Today', 'اليوم') };
  if (d <= 7) return { bg: 'bg-red-100', text: 'text-red-700', label: pick(lang, `${d}d left`, `باقي ${d} يوم`) };
  if (d <= 30) return { bg: 'bg-amber-100', text: 'text-amber-700', label: pick(lang, `${d}d left`, `باقي ${d} يوم`) };
  return { bg: 'bg-emerald-100', text: 'text-emerald-700', label: pick(lang, `${d}d left`, `باقي ${d} يوم`) };
};

// Textarea ⇄ string[] round-trip for the list fields (competitors, services, requirements).
export const listToText = (v?: string[] | null) => (v || []).join(', ');
export const textToList = (v?: string | null) =>
  (v || '').split(/[,\n]/).map((s) => s.trim()).filter(Boolean);
