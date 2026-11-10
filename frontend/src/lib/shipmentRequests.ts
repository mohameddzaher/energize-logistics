// Shipment requests (sales asks, the vendors team places): roles, labels and helpers shared by the request pages in
// Shipment Orders, Sales and Vendors Management. Mirrors backend/src/controllers/shipmentRequestsController.js.
import { roleOf, type RoleOrUser } from './sections';

export const SALES_ROLES = ['sales_manager', 'sales_rep', 'sales_trainee'];
export const VENDOR_ROLES = ['vendors_manager', 'vendors_team_leader', 'vendors_staff', 'vendors_trainee'];
const TOP = ['super_admin', 'admin', 'it_manager', 'it_specialist'];
const DATA = ['data_manager', 'data_analyst', 'data_entry'];
const SO_TEAM = ['shipment_orders_manager', 'shipment_orders_staff', 'operations_manager', 'operations_staff'];
export const ASK_ROLES = [...TOP, ...DATA, ...SALES_ROLES, ...SO_TEAM];
export const PLACE_ROLES = [...TOP, ...DATA, ...VENDOR_ROLES, ...SO_TEAM];
export const READ_ROLES = [...new Set([...ASK_ROLES, ...PLACE_ROLES, 'shipment_orders_followup'])];
export const canAsk = (u: RoleOrUser) => ASK_ROLES.includes(roleOf(u));
export const canPlace = (u: RoleOrUser) => PLACE_ROLES.includes(roleOf(u));
export const isSalesUser = (u: RoleOrUser) => SALES_ROLES.includes(roleOf(u));
export const isVendorUser = (u: RoleOrUser) => VENDOR_ROLES.includes(roleOf(u));

export type RequestStatus = 'pending' | 'in_progress' | 'completed' | 'rejected' | 'cancelled';
export const REQUEST_STATUS: Record<RequestStatus, { ar: string; en: string; cls: string; dot: string }> = {
  pending: { ar: 'بانتظار الموردين', en: 'Waiting for vendors', cls: 'bg-amber-50 text-amber-800 border-amber-200', dot: 'bg-amber-500' },
  in_progress: { ar: 'قيد الإنجاز', en: 'In progress', cls: 'bg-sky-50 text-sky-800 border-sky-200', dot: 'bg-sky-500' },
  completed: { ar: 'مكتمل — أوامر نقل', en: 'Completed', cls: 'bg-emerald-50 text-emerald-800 border-emerald-200', dot: 'bg-emerald-500' },
  rejected: { ar: 'مرفوض', en: 'Rejected', cls: 'bg-red-50 text-red-700 border-red-200', dot: 'bg-red-500' },
  cancelled: { ar: 'مسحوب', en: 'Withdrawn', cls: 'bg-slate-100 text-slate-600 border-slate-200', dot: 'bg-slate-400' },
};

export const LOG_LABEL: Record<string, { ar: string; en: string }> = {
  created: { ar: 'أُنشئ الطلب', en: 'Created' },
  edited: { ar: 'عُدِّل', en: 'Edited' },
  resubmitted: { ar: 'أُعيد إرساله', en: 'Resent' },
  claimed: { ar: 'تولّاه', en: 'Taken by' },
  released: { ar: 'تخلّى عنه', en: 'Released' },
  placed: { ar: 'أُنشئ أمر نقل', en: 'Transport order created' },
  completed: { ar: 'اكتمل', en: 'Completed' },
  rejected: { ar: 'رُفض', en: 'Rejected' },
  cancelled: { ar: 'سُحب', en: 'Withdrawn' },
};

export interface ShipmentRequest {
  _id: string; number: number; status: RequestStatus;
  customer?: string; customerName: string; salesRep?: string; salesRepName?: string;
  fromCity: string; toCity: string; branch?: string; notes?: string; blNumber?: string; containerNumber?: string;
  truckType?: string; cargoType?: string; truckLength?: string; quantity?: number | null;
  pickupTime?: string | null; startTime?: string | null; arrivalTime?: string | null;
  sellPrice?: number | null; paymentSubtype?: string; customFields?: Record<string, any>;
  trucks: number; open: number;
  placed: { order: string; waybillNumber: number; supplierName: string; vehiclePlate: string; driverName: string; at: string; byName: string }[];
  handler?: string | null; handlerName?: string; handledAt?: string | null;
  rejectReason?: string; rejectNote?: string; rejectedAt?: string | null; rejectedByName?: string; resubmits?: number;
  log: { _id: string; action: string; note?: string; reason?: string; waybillNumber?: number | null; at: string; byName?: string }[];
  createdByName?: string; createdAt: string; updatedAt: string;
}

/** Folded city key: two spellings of one city are one city. */
export const cityFold = (s: string) => String(s || '')
  .replace(/[أإآٱ]/g, 'ا').replace(/ة/g, 'ه').replace(/[ىئ]/g, 'ي').replace(/ؤ/g, 'و')
  .replace(/[ً-ْـ]/g, '')
  .replace(/\s+/g, ' ')
  .trim()
  .toLowerCase();
export const findRoute = (c: any, from: string, to: string) => {
  if (!c || !from || !to) return null;
  const k = `${cityFold(from)}→${cityFold(to)}`;
  return (c.routes || []).find((r: any) => `${cityFold(r.fromCity)}→${cityFold(r.toCity)}` === k) || null;
};

/** Keys of the shipment form that the vendors team answers when placing; the request form never shows them. */
export const VENDOR_FORM_KEYS = new Set(['buyPrice', 'advanceAmount', 'driverRentPrice', 'driverName', 'driverPhone', 'vehicleName', 'driverRentType', 'status', 'customer', 'waybillNumber', 'agentName']);

/**
 * Where the vendors team stands on a request, in one line for sales: not started, partly placed (x of y), done,
 * rejected (with how many were placed first) or withdrawn. Read by the table, its filter and the export.
 */
export function vendorProgress(r: Pick<ShipmentRequest, 'status' | 'trucks' | 'placed' | 'handlerName'>, ar: boolean, mode: 'sales' | 'vendors' = 'sales') {
  const n = (r.placed || []).length;
  const of = r.trucks || 0;
  const pct = of ? Math.round((n / of) * 100) : 0;
  const t = (a: string, e: string) => (ar ? a : e);
  // The vendors team reads its own work, so the words name the work, not "the vendors".
  const v = mode === 'vendors';
  switch (r.status) {
    case 'completed': return { label: v ? t(`اكتمل (${n} من ${of})`, `Done (${n} of ${of})`) : t(`أنجزها الموردون (${n} من ${of})`, `Done by vendors (${n} of ${of})`), tone: 'text-emerald-700', pct: 100 };
    case 'in_progress': return { label: t(`جارٍ: أُسندت ${n} من ${of}`, `In progress: ${n} of ${of}`), tone: 'text-sky-700', pct };
    case 'rejected': return { label: n ? t(`رُفض الباقي بعد إسناد ${n} من ${of}`, `Rest rejected after ${n} of ${of}`) : (v ? t('مرفوض', 'Rejected') : t('رفضها الموردون', 'Rejected by vendors')), tone: 'text-red-700', pct };
    case 'cancelled': return { label: n ? t(`سحب فريق المبيعات الباقي بعد إسناد ${n} من ${of}`, `Sales withdrew the rest after ${n} of ${of}`) : t('سحبه فريق المبيعات', 'Withdrawn by sales'), tone: 'text-slate-500', pct };
    default: return r.handlerName
      ? { label: t(`يعمل عليه ${r.handlerName} — 0 من ${of}`, `With ${r.handlerName} — 0 of ${of}`), tone: 'text-amber-700', pct: 0 }
      : { label: v ? t(`لم يبدأ بعد — 0 من ${of}`, `Not started — 0 of ${of}`) : t(`لم يبدأ الموردون — 0 من ${of}`, `Not started by vendors — 0 of ${of}`), tone: 'text-amber-700', pct: 0 };
  }
}

/** Status words as each side reads them: on the vendors page a pending request is simply new. */
export const statusLabel = (st: RequestStatus, ar: boolean, mode: 'sales' | 'vendors') => {
  if (mode === 'vendors' && st === 'pending') return ar ? 'جديد' : 'New';
  if (mode === 'vendors' && st === 'cancelled') return ar ? 'سحبه فريق المبيعات' : 'Withdrawn by sales';
  const d = REQUEST_STATUS[st];
  return d ? (ar ? d.ar : d.en) : st;
};
