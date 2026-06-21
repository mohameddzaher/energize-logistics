// Shared helpers, types and bilingual labels for the CRM section pages.
import { exportToExcel, fmt } from '@/utils/exportExcel';

export { exportToExcel, fmt };

export const CRM_STAFF_ROLES = ['super_admin', 'admin', 'crm_manager', 'crm_specialist'];
export const CRM_ADMIN_ROLES = ['super_admin', 'admin', 'crm_manager'];
export const isCrmStaff = (role?: string | null) => !!role && CRM_STAFF_ROLES.includes(role);
export const isCrmAdmin = (role?: string | null) => !!role && CRM_ADMIN_ROLES.includes(role);

export type Lang = 'en' | 'ar';
const pick = (lang: Lang, en: string, ar: string) => (lang === 'ar' ? ar : en);

// ── Types (mirror the backend models) ────────────────────────────────────────
export interface CrmCompany {
  _id: string;
  name: string; arabicName?: string;
  status: 'lead' | 'prospect' | 'active' | 'inactive' | 'churned';
  type?: 'customer' | 'partner' | 'vendor' | 'reseller' | 'other';
  rating?: number; score?: number;
  industry?: string; size?: string; website?: string;
  phone?: string; whatsapp?: string; email?: string;
  address?: string; city?: string; country?: string;
  source?: string; tags?: string[];
  owner?: any; linkedCustomer?: any;
  notes?: string; createdBy?: any; createdAt?: string; updatedAt?: string;
}

export interface CrmContact {
  _id: string;
  company?: any;
  firstName: string; lastName?: string; arabicName?: string;
  title?: string; department?: string;
  email?: string; phone?: string; mobile?: string; whatsapp?: string; linkedinUrl?: string;
  isPrimary?: boolean; rating?: number; tags?: string[];
  owner?: any; notes?: string; createdAt?: string;
}

export interface CrmActivity {
  _id: string;
  type: 'call' | 'meeting' | 'email' | 'whatsapp' | 'visit' | 'note';
  subject: string; body?: string;
  company?: any; contact?: any; deal?: any;
  direction?: 'inbound' | 'outbound' | '';
  outcome?: string; date?: string; durationMinutes?: number;
  createdBy?: any; createdAt?: string;
}

export interface CrmTask {
  _id: string;
  title: string; description?: string;
  company?: any; contact?: any; deal?: any;
  assignedTo?: any; dueDate?: string; dueTime?: string;
  priority: 'low' | 'medium' | 'high' | 'urgent';
  status: 'todo' | 'in_progress' | 'done' | 'cancelled';
  completedAt?: string; createdBy?: any; createdAt?: string;
}

export interface CrmDeal {
  _id: string;
  title: string; company?: any; contact?: any;
  stage: string; status: 'open' | 'won' | 'lost';
  value?: number; currency?: string; probability?: number; expectedCloseDate?: string;
  wonAt?: string; lostAt?: string; lostReason?: string;
  source?: string; owner?: any; notes?: string; createdAt?: string; updatedAt?: string;
}

export interface OptionItem { key: string; nameEn: string; nameAr: string; probability?: number; color?: string; }
export interface CrmOptions {
  PIPELINE_STAGES: OptionItem[];
  COMPANY_STATUSES: OptionItem[];
  COMPANY_TYPES: OptionItem[];
  COMPANY_SIZES: OptionItem[];
  SOURCES: OptionItem[];
  INDUSTRIES: OptionItem[];
  ACTIVITY_TYPES: OptionItem[];
  TASK_PRIORITIES: OptionItem[];
  TASK_STATUSES: OptionItem[];
  owners: { _id: string; firstName: string; lastName: string; email: string; role: string }[];
}

export const optLabel = (list: OptionItem[] | undefined, key?: string, lang: Lang = 'en') => {
  if (!key) return '—';
  const o = (list || []).find((x) => x.key === key);
  return o ? (lang === 'ar' ? o.nameAr : o.nameEn) : key;
};

// ── Status / badge styles ────────────────────────────────────────────────────
export const COMPANY_STATUS_STYLE: Record<string, { bg: string; text: string; en: string; ar: string }> = {
  lead: { bg: 'bg-slate-500/20', text: 'text-slate-300', en: 'Lead', ar: 'عميل محتمل' },
  prospect: { bg: 'bg-blue-500/20', text: 'text-blue-400', en: 'Prospect', ar: 'مهتم' },
  active: { bg: 'bg-green-500/20', text: 'text-green-400', en: 'Active', ar: 'نشط' },
  inactive: { bg: 'bg-gray-500/20', text: 'text-gray-400', en: 'Inactive', ar: 'غير نشط' },
  churned: { bg: 'bg-red-500/20', text: 'text-red-400', en: 'Churned', ar: 'منسحب' },
};

export const DEAL_STATUS_STYLE: Record<string, { bg: string; text: string; en: string; ar: string }> = {
  open: { bg: 'bg-blue-500/20', text: 'text-blue-400', en: 'Open', ar: 'مفتوحة' },
  won: { bg: 'bg-green-500/20', text: 'text-green-400', en: 'Won', ar: 'تم الفوز' },
  lost: { bg: 'bg-red-500/20', text: 'text-red-400', en: 'Lost', ar: 'خسارة' },
};

export const TASK_STATUS_STYLE: Record<string, { bg: string; text: string; en: string; ar: string }> = {
  todo: { bg: 'bg-amber-500/20', text: 'text-amber-400', en: 'To Do', ar: 'للتنفيذ' },
  in_progress: { bg: 'bg-blue-500/20', text: 'text-blue-400', en: 'In Progress', ar: 'قيد التنفيذ' },
  done: { bg: 'bg-green-500/20', text: 'text-green-400', en: 'Done', ar: 'مكتملة' },
  cancelled: { bg: 'bg-gray-500/20', text: 'text-gray-400', en: 'Cancelled', ar: 'ملغاة' },
};

export const PRIORITY_STYLE: Record<string, { bg: string; text: string; en: string; ar: string }> = {
  low: { bg: 'bg-gray-500/20', text: 'text-gray-400', en: 'Low', ar: 'منخفضة' },
  medium: { bg: 'bg-blue-500/20', text: 'text-blue-400', en: 'Medium', ar: 'متوسطة' },
  high: { bg: 'bg-orange-500/20', text: 'text-orange-400', en: 'High', ar: 'عالية' },
  urgent: { bg: 'bg-red-500/20', text: 'text-red-400', en: 'Urgent', ar: 'عاجلة' },
};

export const ACTIVITY_ICON: Record<string, string> = {
  call: 'phone', meeting: 'users', email: 'mail', whatsapp: 'message-circle', visit: 'map-pin', note: 'sticky-note',
};

// ── Name / ref helpers ───────────────────────────────────────────────────────
export const companyName = (c: any, lang: Lang = 'en') => {
  if (!c) return '—';
  if (typeof c === 'string') return c;
  if (lang === 'ar' && c.arabicName) return c.arabicName;
  return c.name || '—';
};
export const contactName = (c: any, lang: Lang = 'en') => {
  if (!c) return '—';
  if (typeof c === 'string') return c;
  if (lang === 'ar' && c.arabicName) return c.arabicName;
  return `${c.firstName || ''} ${c.lastName || ''}`.trim() || '—';
};
export const userName = (u: any) => (!u ? '—' : typeof u === 'string' ? u : `${u.firstName || ''} ${u.lastName || ''}`.trim() || '—');

// ── Contact-link helpers (drive the WhatsApp / call / email icons) ────────────
// Strip everything but digits; drop a leading 00 (international prefix).
const digits = (v?: string | null) => (v || '').replace(/\D/g, '').replace(/^00/, '');
export const waLink = (phone?: string | null, text?: string) => {
  const n = digits(phone);
  if (!n) return null;
  return `https://wa.me/${n}${text ? `?text=${encodeURIComponent(text)}` : ''}`;
};
export const telLink = (phone?: string | null) => {
  const n = (phone || '').replace(/[^\d+]/g, '');
  return n ? `tel:${n}` : null;
};
export const mailLink = (email?: string | null, subject?: string) => {
  if (!email) return null;
  return `mailto:${email}${subject ? `?subject=${encodeURIComponent(subject)}` : ''}`;
};

// ── Date / money helpers ─────────────────────────────────────────────────────
export const today = () => new Date().toISOString().slice(0, 10);
export const toDateInput = (v?: string | null) => (v ? new Date(v).toISOString().slice(0, 10) : '');
export const fmtDate = (v?: string | null) => (v ? new Date(v).toLocaleDateString('en-GB') : '—');
export const fmtDateTime = (v?: string | null) =>
  v ? new Date(v).toLocaleString('en-GB', { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—';
export const money = (v?: number | null, currency = 'SAR') =>
  `${(Number(v) || 0).toLocaleString('en-US', { maximumFractionDigits: 0 })} ${currency}`;

// Days until a date (negative = overdue). Used for task due badges.
export const daysUntil = (v?: string | null): number | null => {
  if (!v) return null;
  const d0 = new Date(); d0.setHours(0, 0, 0, 0);
  const d1 = new Date(v); d1.setHours(0, 0, 0, 0);
  return Math.round((d1.getTime() - d0.getTime()) / 86400000);
};
export const dueBadge = (v?: string | null, lang: Lang = 'en') => {
  const d = daysUntil(v);
  if (d === null) return null;
  if (d < 0) return { bg: 'bg-red-500/20', text: 'text-red-400', label: pick(lang, `${-d}d overdue`, `متأخرة ${-d} يوم`) };
  if (d === 0) return { bg: 'bg-amber-500/20', text: 'text-amber-400', label: pick(lang, 'Today', 'اليوم') };
  if (d <= 3) return { bg: 'bg-amber-500/20', text: 'text-amber-400', label: pick(lang, `${d}d left`, `باقي ${d} يوم`) };
  return { bg: 'bg-green-500/20', text: 'text-green-400', label: pick(lang, `${d}d left`, `باقي ${d} يوم`) };
};
