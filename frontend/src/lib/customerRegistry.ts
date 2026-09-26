// سجلُّ العملاء — الأنواعُ والأعمدةُ مكتوبةٌ مرّةً واحدة.
//
// الشاشةُ نفسُها تُفتَح من قسمين (طلبات الشحنات والتشغيل)، فلو كُتب العمودُ في
// كلٍّ منهما افترقا بعد شهر: عمودٌ يُضاف هنا ولا يُضاف هناك، ومن يقرأ الرقمين
// يظنّهما رقمين مختلفين. فالمصدرُ واحد.

/**
 * صفُّ السجلّ.
 *
 * والفارغُ لا يصل: الخادمُ يحذف الحقلَ الذي لا قيمةَ فيه بدل أن يرسله `""` أو
 * `null` ستّمئةَ مرّة (راجع shapeRow) — فكلُّ ما قد يفرغ اختياريٌّ هنا، و`cellOf`
 * يقرؤه كما كان. أمّا الصفرُ فيصل: «٠ كشفًا» رقمٌ يُقرأ وشريحةٌ تُبنى عليه.
 */
export interface RegistryRow {
  _id: string;
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
  /** غائبٌ لمن لا يرى المال — لا يُرسَم «undefined»، يُخفى العمود. */
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

export interface RunRoute {
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
  sheets: { rows: any[]; total: number; page: number; pages: number };
  orders: any[];
}

/** الطيُّ العربيّ — «جده» تجد «جدة»، والهمزاتُ لا تُبحَث حرفًا بحرف. */
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

/** مصدرُ السعر يُقرأ كلامًا: «١٤٥٠» وحدَه لا يُعرَف من أين جاء. */
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
  /** رقمٌ: يُحاذى إلى النهاية ويُفرَز عدديًّا. */
  num?: boolean;
  date?: boolean;
  /** عمودُ مالٍ: يُخفى كلُّه عمّن لا يراه بدل أن يُرسَم فارغًا. */
  money?: boolean;
  width?: number;
};

export const REGISTRY_COLS: RegistryCol[] = [
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
  { key: 'sheets', ar: 'الكشوف', en: 'Sheets', num: true },
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

/** نصُّ الخليّة — هو نفسُه ما يُفلتَر عليه وما يُبحَث فيه. */
export const cellOf = (r: RegistryRow, c: RegistryCol, ar: boolean): string => {
  const v = r[c.key];
  if (c.key === 'isActive') return r.isActive ? (ar ? 'نشط' : 'Active') : (ar ? 'موقوف' : 'Inactive');
  if (c.date) return fmtDay(v as string | null);
  if (c.num) return fmtNum(v as number | null);
  return v == null || v === '' ? '' : String(v);
};

/** بطاقاتُ الأرقام فوق الجدول — كلُّ واحدةٍ شريحةٌ تُضغَط. */
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
