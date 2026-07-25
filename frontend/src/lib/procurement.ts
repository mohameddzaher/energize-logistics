// Shared helpers/types for the Procurement section.
import { exportToExcel, fmt } from '@/utils/exportExcel';
export { exportToExcel, fmt };

export type Lang = 'en' | 'ar';

// Role lists OR a grant from the permissions matrix — the backend already
// honours grants (procurementController's grantedBySection), so the pages must
// too. Pass the USER, not the role string: only the user carries grants.
import { canAccessSection, canEditSection, roleOf, permsOf, type RoleOrUser } from './sections';
export const PROCUREMENT_STAFF_ROLES = ['super_admin', 'admin', 'procurement_manager', 'purchasing'];
export const PROCUREMENT_MANAGER_ROLES = ['super_admin', 'admin', 'procurement_manager'];
export const isProcStaff = (u: RoleOrUser) => PROCUREMENT_STAFF_ROLES.includes(roleOf(u)) || canAccessSection(permsOf(u), 'Procurement');
export const isProcManager = (u: RoleOrUser) => PROCUREMENT_MANAGER_ROLES.includes(roleOf(u)) || canEditSection(permsOf(u), 'Procurement');

export interface PRItem { description: string; quantity: number; unitPrice: number; total: number; }
export interface PurchaseRequest {
  _id: string; requestNumber?: string; title: string; category?: string; requester?: any; department?: string;
  items: PRItem[]; totalEstimate: number; justification?: string; neededBy?: string; priority: string;
  suggestedVendor?: any; status: string; approval?: { by?: any; at?: string; note?: string };
  purchaseOrder?: any; notes?: string; createdAt?: string;
}
export interface PurchaseOrder {
  _id: string; poNumber?: string; vendor?: any; purchaseRequest?: any; items: PRItem[];
  subtotal: number; vatRate: number; vatAmount: number; total: number; currency?: string;
  status: string; expectedDate?: string; receivedDate?: string; notes?: string; createdAt?: string;
}
export interface VendorBill {
  _id: string; billNumber?: string; vendorInvoiceNumber?: string; vendor?: any; purchaseOrder?: any;
  subtotal: number; vatAmount: number; total: number; paidAmount: number; balance: number;
  billDate?: string; dueDate?: string; category?: string; status: string; notes?: string; createdAt?: string;
}
export interface StatusBreakdown { status: string; count: number; value: number; }
export interface TopVendor { _id: string; name: string; total: number; count: number; }
export interface ProcDashRow {
  _id: string; status: string;
  requestNumber?: string; title?: string; priority?: string; totalEstimate?: number; requester?: any; // PR
  poNumber?: string; vendor?: any; total?: number; expectedDate?: string; // PO
  billNumber?: string; vendorInvoiceNumber?: string; balance?: number; dueDate?: string; // Bill
  createdAt?: string;
}
export interface ProcDashboard {
  prPending: number; openPOs: number; openPOValue: number;
  unpaidBills: number; unpaidBillsCount: number;
  overdueBills: number; overdueBillsCount: number;
  spendThisMonth: number; spendThisMonthCount: number;
  prByStatus: StatusBreakdown[]; poByStatus: StatusBreakdown[]; billByStatus: StatusBreakdown[];
  topVendors: TopVendor[];
  recentPRs: ProcDashRow[]; recentPOs: ProcDashRow[]; unpaidBillsList: ProcDashRow[];
}
export interface OptionItem { key: string; nameEn: string; nameAr: string; }
export interface ProcOptions {
  KSA_VAT_RATE: number;
  PR_STATUSES: OptionItem[]; PO_STATUSES: OptionItem[]; BILL_STATUSES: OptionItem[];
  PRIORITIES: OptionItem[]; CATEGORIES: OptionItem[];
  vendors: { _id: string; name: string }[];
}

const pick = (lang: Lang, en: string, ar: string) => (lang === 'ar' ? ar : en);
export const optLabel = (list: OptionItem[] | undefined, key?: string, lang: Lang = 'en') => {
  if (!key) return '—';
  const o = (list || []).find((x) => x.key === key);
  return o ? (lang === 'ar' ? o.nameAr : o.nameEn) : key;
};

export const PR_STATUS_STYLE: Record<string, { bg: string; text: string; en: string; ar: string }> = {
  draft: { bg: 'bg-gray-500/20', text: 'text-gray-400', en: 'Draft', ar: 'مسودة' },
  pending_approval: { bg: 'bg-amber-500/20', text: 'text-amber-400', en: 'Pending', ar: 'بانتظار الموافقة' },
  approved: { bg: 'bg-green-500/20', text: 'text-green-400', en: 'Approved', ar: 'معتمد' },
  rejected: { bg: 'bg-red-500/20', text: 'text-red-400', en: 'Rejected', ar: 'مرفوض' },
  ordered: { bg: 'bg-blue-500/20', text: 'text-blue-400', en: 'Ordered', ar: 'تم الطلب' },
};
export const PO_STATUS_STYLE: Record<string, { bg: string; text: string; en: string; ar: string }> = {
  draft: { bg: 'bg-gray-500/20', text: 'text-gray-400', en: 'Draft', ar: 'مسودة' },
  sent: { bg: 'bg-blue-500/20', text: 'text-blue-400', en: 'Sent', ar: 'مُرسل' },
  partially_received: { bg: 'bg-amber-500/20', text: 'text-amber-400', en: 'Partial', ar: 'جزئي' },
  received: { bg: 'bg-green-500/20', text: 'text-green-400', en: 'Received', ar: 'مستلم' },
  billed: { bg: 'bg-purple-500/20', text: 'text-purple-400', en: 'Billed', ar: 'مفوتر' },
  cancelled: { bg: 'bg-red-500/20', text: 'text-red-400', en: 'Cancelled', ar: 'ملغي' },
};
export const BILL_STATUS_STYLE: Record<string, { bg: string; text: string; en: string; ar: string }> = {
  unpaid: { bg: 'bg-red-500/20', text: 'text-red-400', en: 'Unpaid', ar: 'غير مدفوع' },
  partial: { bg: 'bg-amber-500/20', text: 'text-amber-400', en: 'Partial', ar: 'جزئي' },
  paid: { bg: 'bg-green-500/20', text: 'text-green-400', en: 'Paid', ar: 'مدفوع' },
};
export const PRIORITY_STYLE: Record<string, { bg: string; text: string; en: string; ar: string }> = {
  low: { bg: 'bg-gray-500/20', text: 'text-gray-400', en: 'Low', ar: 'منخفضة' },
  medium: { bg: 'bg-blue-500/20', text: 'text-blue-400', en: 'Medium', ar: 'متوسطة' },
  high: { bg: 'bg-orange-500/20', text: 'text-orange-400', en: 'High', ar: 'عالية' },
  urgent: { bg: 'bg-red-500/20', text: 'text-red-400', en: 'Urgent', ar: 'عاجلة' },
};

export const vendorName = (v: any) => (!v ? '—' : typeof v === 'string' ? v : v.name || v.companyName || v.vendorName || '—');
export const userName = (u: any) => (!u ? '—' : typeof u === 'string' ? u : `${u.firstName || ''} ${u.lastName || ''}`.trim() || '—');
export const money = (v?: number | null, currency = 'SAR') => `${(Number(v) || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${currency}`;
export const today = () => new Date().toISOString().slice(0, 10);
export const fmtDate = (v?: string | null) => (v ? new Date(v).toLocaleDateString('en-GB') : '—');
export { pick };
