// Customer registry: types and columns defined once.
// The same screen opens from three sections (shipment orders, operations, sales); per-section column copies would drift apart and the same figure would read as two different numbers.
import { canEditSection, roleOf, permsOf, type RoleOrUser } from './sections';
import { SO_EDIT_ROLES, SO_ADMIN_ROLES } from './shipmentOrders';

// Who edits a customer: one rule for the three entry points, identical to the /api/customer-registry guard: shipment-orders roles, the sales manager (agreed price is their job), and anyone granted shipment-orders edit in the matrix. Reps read only. Price tiers are outside this rule; the server decides in canEditTiers.
export const CUSTOMER_EDIT_ROLES = [...SO_EDIT_ROLES, 'sales_manager', 'sales_rep'];
/** Destination prices (agreed and tiers): operations manager and system admin only; the server is the guard. */
export const canEditRoutePrices = (u: RoleOrUser) => ['super_admin', 'admin', 'operations_manager'].includes(roleOf(u));
export const canEditCustomers = (u: RoleOrUser) =>
  CUSTOMER_EDIT_ROLES.includes(roleOf(u)) || canEditSection(permsOf(u), 'Shipment Orders');
/** Removing hides the customer, and re-adding the name restores it. */
export const canRemoveCustomers = (u: RoleOrUser) =>
  (roleOf(u) !== 'sales_rep' && CUSTOMER_EDIT_ROLES.includes(roleOf(u))) || canEditSection(permsOf(u), 'Shipment Orders');

/**
 * Registry row.
 * Empty fields do not arrive: the server omits a field with no value instead of sending "" or null hundreds of times (see shapeRow), so everything that can be empty is optional here and cellOf reads it as before. Zero does arrive: a count of 0 statements is a number and a tier is built on it.
 */
export interface RegistryRow {
  _id: string;
  customerCode?: string;
  name: string;
  phone?: string;
  email?: string;
  isActive: boolean;
  routesCount: number;
  pricedRoutes: number;
  unpricedRoutes: number;
  citiesCount: number;
  minPrice?: number | null;
  maxPrice?: number | null;
  avgPrice?: number | null;
  lastPriceAt?: string | null;
  sheets: number;
  /** Absent for users who do not see money: the column is hidden, not rendered as "undefined". */
  purchaseTotal?: number;
  firstSheetAt?: string | null;
  lastSheetAt?: string | null;
  orders: number;
  truckType?: string;
  cargoType?: string;
  paymentMethod?: string;
  branch?: string;
}

export interface RegistrySummary {
  total: number;
  active: number;
  withRoutes: number;
  withoutRoutes: number;
  unpricedRoutes: number;
  working: number;
  idle: number;
  sheets: number;
  purchaseTotal?: number;
}

export interface AgreedRoute {
  _id?: string;
  fromCity: string;
  toCity: string;
  price: number | null;
  at?: string | null;
  source?: string;
  hits?: number;
}

/** Price tier by vehicle count: from one count to another (an empty end means and above) at a price per vehicle. */
export interface PriceTier { minTrucks: number; maxTrucks: number | null; price: number }

/** A readable and exportable tier line, e.g. "1-5: 2,200 · 6 and above: 2,400". */
export const tiersText = (tiers: PriceTier[] | undefined, ar: boolean): string =>
  (tiers || []).map((t) => `${t.maxTrucks == null ? (ar ? `${t.minTrucks} فأكثر` : `${t.minTrucks}+`)
    : t.minTrucks === t.maxTrucks ? `${t.minTrucks}` : `${t.minTrucks}–${t.maxTrucks}`}: ${Number(t.price).toLocaleString('en-US')}`).join(' · ');

export interface RunRoute {
  tiers?: PriceTier[];
  tiersAt?: string | null;
  tiersBy?: string;
  from: string;
  to: string;
  sheets: number;
  purchase?: number;
  lastAt: string | null;
  price: number | null;
  priceAt: string | null;
  priceSource: string;
}

export interface ProfilePayload {
  customer: {
    _id: string; name: string; phone: string; email: string; notes: string; isActive: boolean;
    defaults: Record<string, string>;
    routes: AgreedRoute[];
  };
  analysis: {
    sheets: number; purchaseTotal?: number; avgPerSheet?: number;
    firstAt: string | null; lastAt: string | null;
    branches: string[]; routesCount: number; pricedRoutes: number; orders: number;
    monthly: { month: string; sheets: number; purchase?: number }[];
  };
  routes: RunRoute[];
  /** Operations manager and system admin only; the server enforces it. */
  canEditTiers?: boolean;
  sheets: { rows: any[]; total: number; page: number; pages: number };
  orders: any[];
}

/** Arabic folding: searching one spelling finds the other, and hamza variants are not matched letter by letter. */
export const foldAr = (x: any): string => String(x ?? '')
  .replace(/ /g, ' ')
  .replace(/\s+/g, ' ')
  .trim()
  .toLowerCase()
  .replace(/[أإآ]/g, 'ا')
  .replace(/ى/g, 'ي')
  .replace(/ة/g, 'ه')
  .replace(/ؤ/g, 'و')
  .replace(/ئ/g, 'ي')
  .replace(/[ًٌٍَُِّْ]/g, '');

export const fmtDay = (v?: string | null): string => {
  if (!v) return '—';
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleDateString('en-GB');
};

export const fmtNum = (n?: number | null): string =>
  (n == null ? '—' : Number(n).toLocaleString('en-US', { maximumFractionDigits: 2 }));

/** Price source in words: a bare number alone does not say where it came from. */
export const priceSourceLabel = (s: string | undefined, ar: boolean): string => {
  switch (s) {
    case 'sheet': return ar ? 'من تقرير الفروع' : 'branches report';
    case 'order': return ar ? 'من شحنة أُنشئت' : 'created shipment';
    case 'private': return ar ? 'من التشغيل — خاصّ' : 'Operations — private';
    case 'platform': return ar ? 'من منصّة التشغيل' : 'ops platform';
    case 'manual': return ar ? 'أُدخل يدويًّا' : 'entered by hand';
    default: return s || '';
  }
};

export type RegistryCol = {
  key: keyof RegistryRow;
  ar: string;
  en: string;
  /** Number: end-aligned and sorted numerically. */
  num?: boolean;
  date?: boolean;
  /** Money column: hidden entirely for those who cannot see it instead of rendering empty. */
  money?: boolean;
  width?: number;
};

export const REGISTRY_COLS: RegistryCol[] = [
  { key: 'customerCode', ar: 'كود العميل', en: 'Code', width: 12 },
  { key: 'name', ar: 'العميل', en: 'Customer', width: 28 },
  { key: 'phone', ar: 'الجوال', en: 'Phone', width: 16 },
  { key: 'email', ar: 'البريد', en: 'Email', width: 24 },
  { key: 'routesCount', ar: 'المسارات', en: 'Routes', num: true },
  { key: 'pricedRoutes', ar: 'مُسعَّرة', en: 'Priced', num: true },
  { key: 'unpricedRoutes', ar: 'بلا سعر', en: 'Unpriced', num: true },
  { key: 'citiesCount', ar: 'المدن', en: 'Cities', num: true },
  { key: 'minPrice', ar: 'أقلّ سعر', en: 'Min price', num: true },
  { key: 'avgPrice', ar: 'متوسّط السعر', en: 'Avg price', num: true },
  { key: 'maxPrice', ar: 'أعلى سعر', en: 'Max price', num: true },
  { key: 'lastPriceAt', ar: 'آخر تسعير', en: 'Last priced', date: true },
  { key: 'sheets', ar: 'أوامر النقل', en: 'Sheets', num: true },
  { key: 'purchaseTotal', ar: 'قيمة الشراء', en: 'Purchase total', num: true, money: true, width: 16 },
  { key: 'firstSheetAt', ar: 'أوّل عمل', en: 'First work', date: true },
  { key: 'lastSheetAt', ar: 'آخر عمل', en: 'Last work', date: true },
  { key: 'orders', ar: 'طلباتنا', en: 'Our orders', num: true },
  { key: 'truckType', ar: 'نوع الشاحنة', en: 'Truck type' },
  { key: 'cargoType', ar: 'نوع الحمولة', en: 'Cargo type' },
  { key: 'paymentMethod', ar: 'طريقة الدفع', en: 'Payment' },
  { key: 'branch', ar: 'الفرع', en: 'Branch' },
  { key: 'isActive', ar: 'الحالة', en: 'Status' },
];

/** Cell text; the same text is filtered and searched. */
export const cellOf = (r: RegistryRow, c: RegistryCol, ar: boolean): string => {
  const v = r[c.key];
  if (c.key === 'isActive') return r.isActive ? (ar ? 'نشط' : 'Active') : (ar ? 'موقوف' : 'Inactive');
  if (c.date) return fmtDay(v as string | null);
  if (c.num) return fmtNum(v as number | null);
  return v == null || v === '' ? '' : String(v);
};

/** Number cards above the table; each one is a clickable filter. */
export type KpiKey = 'all' | 'working' | 'idle' | 'withRoutes' | 'withoutRoutes' | 'unpriced' | 'sheets' | 'purchase';

export const kpiMatches = (k: KpiKey, r: RegistryRow): boolean => {
  switch (k) {
    case 'working': return r.sheets > 0;
    case 'idle': return r.sheets === 0;
    case 'withRoutes': return r.routesCount > 0;
    case 'withoutRoutes': return r.routesCount === 0;
    case 'unpriced': return r.unpricedRoutes > 0;
    case 'sheets': return r.sheets > 0;
    case 'purchase': return (r.purchaseTotal || 0) > 0;
    default: return true;
  }
};
