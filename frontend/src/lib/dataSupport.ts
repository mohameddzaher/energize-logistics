/** Data & Decision Support: analysis pages per company section and the payload the server returns. See backend/src/controllers/dataSupportController.js. */
import type { FinCard, FinTable, FinFormat } from '@/lib/financeDept';

export const DATA_ROLES = ['data_manager', 'data_analyst', 'data_entry'];
export const isDataRole = (u?: { role?: string | null } | null) => DATA_ROLES.includes(u?.role || '');

export interface DsCard extends FinCard { prev?: number | null; lowerIsBetter?: boolean }
export interface DsSeries { key: string; ar: string; en: string; format: FinFormat }
export interface DsChart {
  key: string; ar: string; en: string; kind: 'line' | 'bar'; x: string;
  series: DsSeries[]; rows: Record<string, any>[]; stacked?: boolean;
}
export interface DsSection {
  section: string; ar: string; en: string; period: { from: string; to: string };
  branch: string | null; hasBranch: boolean; generatedAt: string;
  branchOptions: { value: string; label: string }[];
  cards: DsCard[]; charts: DsChart[]; tables: FinTable[];
  notes: { ar: string; en: string }[];
  sources: { ar: string; en: string; endpoint: string }[];
}

/** Analysis pages in sidebar order; `key` is the server key, `href` the page. */
export const DS_SECTIONS: { key: string; ar: string; en: string; href: string }[] = [
  { key: 'operations', ar: 'تحليل العمليات والشحنات', en: 'Operations & Shipments', href: '/system/data-support/operations' },
  { key: 'heavy', ar: 'تحليل النقل الثقيل', en: 'Heavy Transport', href: '/system/data-support/heavy-transport' },
  { key: 'light', ar: 'تحليل النقل الخفيف', en: 'Light Transport', href: '/system/data-support/light-transport' },
  { key: 'sales', ar: 'تحليل المبيعات والعلاقات', en: 'Sales & CRM', href: '/system/data-support/sales' },
  { key: 'vendors', ar: 'تحليل الموردين', en: 'Vendors', href: '/system/data-support/vendors' },
  { key: 'customs', ar: 'تحليل التخليص الجمركي', en: 'Customs', href: '/system/data-support/customs' },
  { key: 'collections', ar: 'تحليل التحصيل', en: 'Collections', href: '/system/data-support/collections' },
  { key: 'hr', ar: 'تحليل الموارد البشرية', en: 'Human Resources', href: '/system/data-support/hr' },
  { key: 'finance', ar: 'التحليل المالي', en: 'Finance', href: '/system/data-support/finance' },
];

/** Data-entry screens the data team works in; each opens only if the user's page permissions allow it. */
export const DS_WORK_SCREENS: { href: string; ar: string; en: string }[] = [
  { href: '/system/shipment-orders', ar: 'الشحنات', en: 'Shipments' },
  { href: '/system/shipment-orders/request', ar: 'طلب شحنة', en: 'Shipment request' },
  { href: '/system/shipment-orders/requests', ar: 'الطلبات من المبيعات', en: 'Requests from sales' },
  { href: '/system/shipment-orders/customers', ar: 'عملاء الشحنات', en: 'Shipment customers' },
  { href: '/system/fleet', ar: 'حمولات الأسطول', en: 'Fleet loads' },
  { href: '/system/fleet/requests', ar: 'طلبات الأسطول من المبيعات', en: 'Fleet requests from sales' },
  { href: '/system/operations', ar: 'سير عمل التشغيل', en: 'Operations workflow' },
  { href: '/system/operations/loads', ar: 'متابعة الحمولات والشحنات', en: 'Loads & shipments' },
  { href: '/system/vendors-mgmt/vendors', ar: 'سجلّ الموردين', en: 'Carriers register' },
];

/** Change against the previous span, in percent; null when there is nothing to compare. */
export const deltaPct = (value: number | null | undefined, prev: number | null | undefined): number | null => {
  if (value == null || prev == null || !Number.isFinite(Number(prev)) || Number(prev) === 0) return null;
  return ((Number(value) - Number(prev)) / Math.abs(Number(prev))) * 100;
};
