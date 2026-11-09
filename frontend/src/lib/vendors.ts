// Vendors management: roles and labels shared by the section's pages. Mirrors backend/src/config/priceView.js and
// controllers/vendorsMgmtController.js.
import { roleOf, canEditSection, permsOf, type RoleOrUser } from './sections';

export const VENDOR_ROLES = ['vendors_manager', 'vendors_team_leader', 'vendors_staff', 'vendors_trainee'];
export const VENDOR_LEADS = ['vendors_manager', 'vendors_team_leader'];
const TOP = ['super_admin', 'admin', 'it_manager', 'it_specialist'];
export const VENDOR_NAV_ROLES = [...TOP, ...VENDOR_ROLES, 'operations_manager', 'data_manager', 'data_analyst', 'data_entry'];
export const isVendorLead = (u: RoleOrUser) => [...TOP, ...VENDOR_LEADS, 'operations_manager', 'data_manager'].includes(roleOf(u));
export const canEditVendors = (u: RoleOrUser) => VENDOR_NAV_ROLES.includes(roleOf(u)) || canEditSection(permsOf(u), 'Vendors Management');

export const KIND: Record<string, { ar: string; en: string; cls: string; color: string }> = {
  master: { ar: 'معتمد', en: 'On the master', cls: 'bg-orange-50 text-orange-800 border-orange-200', color: '#f37121' },
  outside: { ar: 'غير معتمد', en: 'Outside the master', cls: 'bg-amber-50 text-amber-800 border-amber-200', color: '#fbbf77' },
  freelancer: { ar: 'سائق فرد', en: 'Freelance driver', cls: 'bg-slate-50 text-slate-700 border-slate-200', color: '#cbd5e1' },
  fleet: { ar: 'أسطول تنشيط', en: 'Our fleet', cls: 'bg-slate-100 text-slate-800 border-slate-300', color: '#334155' },
  none: { ar: 'غير محدّد', en: 'Unknown', cls: 'bg-slate-50 text-slate-500 border-slate-200', color: '#94a3b8' },
};
export const kindLabel = (k: string, ar: boolean) => (KIND[k] ? (ar ? KIND[k].ar : KIND[k].en) : k);

export const MONTHS_AR = ['يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو', 'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر'];
export const MONTHS_EN = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export const monthName = (m: number, ar: boolean) => (ar ? MONTHS_AR : MONTHS_EN)[(m - 1 + 12) % 12];

export const contractTone = (s?: string) => (/موقع/.test(s || '') ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
  : /ارسال|إرسال/.test(s || '') ? 'bg-sky-50 text-sky-700 border-sky-200'
    : /متابعة/.test(s || '') ? 'bg-amber-50 text-amber-800 border-amber-200'
      : /معتذر|غير/.test(s || '') ? 'bg-red-50 text-red-700 border-red-200'
        : 'bg-slate-50 text-slate-600 border-slate-200');

/** Link to a carrier's card: by id when registered, by name otherwise. */
export const vendorHref = (v: { id?: string | null; name?: string }) => (v.id ? `/system/vendors-mgmt/vendors/${v.id}` : `/system/vendors-mgmt/vendors/name?n=${encodeURIComponent(v.name || '')}`);

export const CHANNELS: Record<string, { ar: string; en: string }> = {
  call: { ar: 'اتصال', en: 'Call' }, whatsapp: { ar: 'واتساب', en: 'WhatsApp' }, visit: { ar: 'زيارة', en: 'Visit' },
  email: { ar: 'بريد', en: 'Email' }, meeting: { ar: 'اجتماع', en: 'Meeting' }, other: { ar: 'أخرى', en: 'Other' },
};
