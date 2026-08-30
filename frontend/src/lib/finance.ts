// Shared helpers/types for the Accounting, Sales and KPI sections.
import { exportToExcel, fmt } from '@/utils/exportExcel';
import { canAccessSection, canEditSection, roleOf, permsOf, type RoleOrUser } from './sections';
export { exportToExcel, fmt };

export type Lang = 'en' | 'ar';

export const FINANCE_STAFF_ROLES = ['super_admin', 'admin', 'finance_manager', 'accountant'];
export const FINANCE_ADMIN_ROLES = ['super_admin', 'admin', 'finance_manager'];
export const SALES_STAFF_ROLES = ['super_admin', 'admin', 'sales_manager', 'sales_rep', 'operations_manager', 'operations_staff'];
export const SALES_ADMIN_ROLES = ['super_admin', 'admin', 'sales_manager'];
export const KPI_ROLES = ['super_admin', 'admin', 'moderator'];

// View AND act must both honour the permission matrix. Only the *Staff halves
// did, so a role the super admin granted «تعديل» on Accounting or Sales could
// open the section and then found every action hidden — while the API would
// have accepted the call (rbac lets a section grant through). Pass the whole
// user, not user.role: only the object carries the grants.
export const isFinanceStaff = (u: RoleOrUser) => FINANCE_STAFF_ROLES.includes(roleOf(u)) || canAccessSection(permsOf(u), 'Accounting');
export const isFinanceAdmin = (u: RoleOrUser) => FINANCE_ADMIN_ROLES.includes(roleOf(u)) || canEditSection(permsOf(u), 'Accounting');
export const isSalesStaff = (u: RoleOrUser) => SALES_STAFF_ROLES.includes(roleOf(u)) || canAccessSection(permsOf(u), 'Sales');
export const isSalesAdmin = (u: RoleOrUser) => SALES_ADMIN_ROLES.includes(roleOf(u)) || canEditSection(permsOf(u), 'Sales');
export const isKpiViewer = (r?: string | null) => !!r && KPI_ROLES.includes(r);

// ── Types ────────────────────────────────────────────────────────────────────
export interface ChartAccount {
  _id: string; code: string; nameEn: string; nameAr?: string;
  type: 'asset' | 'liability' | 'equity' | 'revenue' | 'expense';
  normalBalance: 'debit' | 'credit'; isActive?: boolean; system?: boolean; description?: string;
}
export interface JournalLine { account: any; debit: number; credit: number; description?: string; }
export interface JournalEntry {
  _id: string; entryNumber?: string; date?: string; memo?: string;
  lines: JournalLine[]; totalDebit: number; totalCredit: number; status: string;
  source?: { type: string; auto?: boolean }; createdBy?: any; createdAt?: string;
}
export interface SalesTarget {
  _id: string; rep?: any; period: string; amountTarget: number; dealsTarget: number; notes?: string;
}

export const ACCOUNT_TYPE_STYLE: Record<string, { bg: string; text: string; en: string; ar: string }> = {
  asset: { bg: 'bg-blue-500/20', text: 'text-blue-400', en: 'Asset', ar: 'أصل' },
  liability: { bg: 'bg-amber-500/20', text: 'text-amber-400', en: 'Liability', ar: 'التزام' },
  equity: { bg: 'bg-purple-500/20', text: 'text-purple-400', en: 'Equity', ar: 'حقوق ملكية' },
  revenue: { bg: 'bg-green-500/20', text: 'text-green-400', en: 'Revenue', ar: 'إيراد' },
  expense: { bg: 'bg-red-500/20', text: 'text-red-400', en: 'Expense', ar: 'مصروف' },
};

// ── Helpers ──────────────────────────────────────────────────────────────────
export const accountName = (a: any, lang: Lang = 'en') => {
  if (!a) return '—';
  if (typeof a === 'string') return a;
  const nm = lang === 'ar' && a.nameAr ? a.nameAr : a.nameEn;
  return a.code ? `${a.code} · ${nm}` : nm || '—';
};
export const userName = (u: any) => (!u ? '—' : typeof u === 'string' ? u : `${u.firstName || ''} ${u.lastName || ''}`.trim() || '—');
export const money = (v?: number | null, currency = 'SAR') =>
  `${(Number(v) || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${currency}`;
export const num = (v?: number | null) => (Number(v) || 0).toLocaleString('en-US');
export const pct = (v?: number | null) => `${Math.round((Number(v) || 0))}%`;
// «اليوم» يوم الرياض لا يوم غرينتش: `toISOString()` كانت تعطي أمسِ بين منتصف
// الليل والثالثة فجرًا. المرجعُ واحدٌ الآن في `lib/companyDay`.
export { today } from './companyDay';
export const thisPeriod = () => new Date().toISOString().slice(0, 7); // YYYY-MM
export const fmtDate = (v?: string | null) => (v ? new Date(v).toLocaleDateString('en-GB') : '—');
export const fmtMonth = (p?: string) => p || thisPeriod();
