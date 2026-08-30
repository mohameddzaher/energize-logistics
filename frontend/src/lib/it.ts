import api from '@/lib/api';
import { canAccessSection, canEditSection } from '@/lib/sections';
// Shared types, labels and formatters for the Software & IT section pages.

export type Lang = 'en' | 'ar';

export const IT_STAFF_ROLES = ['super_admin', 'admin', 'it_manager', 'it_specialist'];
export const IT_ADMIN_ROLES = ['super_admin', 'admin', 'it_manager'];

export const isItStaff = (role?: string | null) => !!role && IT_STAFF_ROLES.includes(role);
export const isItAdmin = (role?: string | null) => !!role && IT_ADMIN_ROLES.includes(role);

// ── Types ───────────────────────────────────────────────────────────────────

export interface EmployeeRef {
  _id: string;
  firstName?: string;
  lastName?: string;
  arabicName?: string;
  employeeNumber?: string;
  iqamaNumber?: string;
  department?: string;
}

export interface UserRef { _id: string; firstName?: string; lastName?: string }

export interface Ticket {
  _id: string;
  ticketNumber?: string;
  title: string;
  category: string;
  priority: string;
  status: string;
  requester?: EmployeeRef | string | null;
  requesterName?: string;
  requesterDepartment?: string;
  assignedTo?: UserRef | string | null;
  assignedToName?: string;
  reportedAt?: string;
  resolvedDate?: string;
  resolvedAt?: string;
  resolutionMinutes?: number;
  description?: string;
  resolution?: string;
  rootCause?: string;
  preventiveAction?: string;
  relatedAsset?: { _id: string; name?: string; serialNumber?: string; type?: string } | string | null;
  device?: string;
  isRecurring?: boolean;
  signature?: string;
  notes?: string;
  createdAt?: string;
}

export interface CustodyItem {
  _id: string;
  employee?: EmployeeRef | string | null;
  name: string;
  type: string;
  serialNumber?: string;
  brand?: string;
  model?: string;
  specs?: string;
  category?: string;
  condition?: string;
  value?: number;
  assignedDate?: string;
  status: string;
  returnedDate?: string;
  returnedCondition?: string;
  assignedBy?: UserRef | string | null;
  issuedBySection?: string;
  notes?: string;
  quantity?: number;
  location?: string;
  returnedTo?: UserRef | string | null;
  createdBy?: UserRef | string | null;
}

// A stock item is the same Asset document as a custody item — it just has no
// holder yet — so it reuses the shape rather than inventing a parallel type.
export type StockItem = CustodyItem;

// ── أعداد شاشة العهد ────────────────────────────────────────────────────────
// الخادم يعيدها مع الصفوف محسوبةً على نفس الفلتر، فلا تشتقّها الشاشة ثانيةً.
// اشتقاقها هنا هو ما جعل الكارت يقول ٦٨ ويفتح ٦: العدّ كان يُحسب على السجل
// كله والجدول تحته مفلتر.
export interface CustodyCounts {
  buckets: { key: string; nameAr: string; nameEn: string; count: number }[];
  byStatus: { assigned: number; in_stock: number; returned: number };
  /** تفصيل دلو «أخرى» بعد بقية الفلاتر. */
  otherKinds: CountRow[];
  conditions: CountRow[];
  /** عدد الصفوف المعروضة وقيمتها — كلاهما يصف الجدول لا السجل. */
  total: number;
  value: number;
}

export interface CustodyListResponse {
  items: CustodyItem[];
  counts?: CustodyCounts;
  /** إجمالي السجل كله — يُعرض بجانب الرقم المفلتر ليُعرف من أيٍّ اقتُطع. */
  register?: { total: number; assigned: number };
}

export interface ItSystem {
  _id: string;
  name: string;
  nameAr?: string;
  type: string;
  status: string;
  owner?: UserRef | string | null;
  vendor?: string;
  url?: string;
  environment?: string;
  renewalDate?: string;
  cost?: number;
  costPeriod?: string;
  credentialsNote?: string;
  description?: string;
  notes?: string;
}

export interface RecurringGroup {
  signature: string;
  sampleTitle: string;
  category: string;
  count: number;
  firstReportedAt?: string | null;
  lastReportedAt?: string | null;
  avgResolutionMinutes: number;
  affectedDepartments: string[];
  ticketIds: string[];
}

export interface CountRow { key: string; count: number }

export interface Dashboard {
  totals: {
    openTickets: number;
    inProgress: number;
    resolvedThisPeriod: number;
    avgResolutionMinutes: number;
    ticketsByCategory: CountRow[];
    ticketsByPriority: CountRow[];
    ticketsByStatus: CountRow[];
    timeline: { date: string; opened: number; resolved: number }[];
    assetsAssigned: number;
    assetsInStock: number;
    stockCount?: number;
    stockByType?: CountRow[];
    lowStock?: CountRow[];
    systemsByStatus: CountRow[];
    renewalsDueSoon: ItSystem[];
  };
  // ملخّص العهد: نفس الكروت ونفس الأزرار المعروضة في صفحة العهد، محسوبة في
  // الخادم مرة واحدة حتى لا تختلف الأرقام بين الشاشتين.
  custody?: {
    buckets: { key: string; nameAr: string; nameEn: string; count: number }[];
    byStatus: { assigned: number; in_stock: number; returned: number };
    byCondition: CountRow[];
    otherKinds: CountRow[];
    total: number;
  };
  topRecurring: RecurringGroup[];
  recentTickets: Ticket[];
  range?: { from: string; to: string };
}

export interface ItAssignee { _id: string; firstName?: string; lastName?: string; role?: string; email?: string }

// ── Label maps ──────────────────────────────────────────────────────────────

type Style = { en: string; ar: string; bg: string; text: string };

export const TICKET_CATEGORIES: Record<string, Style> = {
  hardware: { en: 'Hardware', ar: 'أجهزة', bg: 'bg-slate-500/15', text: 'text-slate-700' },
  software: { en: 'Software', ar: 'برامج', bg: 'bg-indigo-500/15', text: 'text-indigo-700' },
  network: { en: 'Network', ar: 'الشبكة', bg: 'bg-cyan-500/15', text: 'text-cyan-700' },
  email: { en: 'Email', ar: 'البريد الإلكتروني', bg: 'bg-blue-500/15', text: 'text-blue-700' },
  printer: { en: 'Printer', ar: 'الطابعات', bg: 'bg-amber-500/15', text: 'text-amber-700' },
  account_access: { en: 'Account / Access', ar: 'الحسابات والصلاحيات', bg: 'bg-violet-500/15', text: 'text-violet-700' },
  erp_system: { en: 'ERP System', ar: 'نظام ERP', bg: 'bg-orange-500/15', text: 'text-orange-700' },
  phone: { en: 'Phone', ar: 'الهاتف', bg: 'bg-teal-500/15', text: 'text-teal-700' },
  security: { en: 'Security', ar: 'الأمن السيبراني', bg: 'bg-red-500/15', text: 'text-red-700' },
  other: { en: 'Other', ar: 'أخرى', bg: 'bg-slate-500/15', text: 'text-slate-700' },
};

export const TICKET_PRIORITIES: Record<string, Style> = {
  low: { en: 'Low', ar: 'منخفضة', bg: 'bg-slate-500/15', text: 'text-slate-700' },
  medium: { en: 'Medium', ar: 'متوسطة', bg: 'bg-blue-500/15', text: 'text-blue-700' },
  high: { en: 'High', ar: 'عالية', bg: 'bg-amber-500/20', text: 'text-amber-700' },
  urgent: { en: 'Urgent', ar: 'عاجلة', bg: 'bg-red-500/20', text: 'text-red-700' },
};

export const TICKET_STATUSES: Record<string, Style> = {
  open: { en: 'Open', ar: 'مفتوحة', bg: 'bg-amber-500/20', text: 'text-amber-700' },
  in_progress: { en: 'In Progress', ar: 'قيد التنفيذ', bg: 'bg-blue-500/20', text: 'text-blue-700' },
  resolved: { en: 'Resolved', ar: 'تم الحل', bg: 'bg-green-500/20', text: 'text-green-700' },
  closed: { en: 'Closed', ar: 'مغلقة', bg: 'bg-slate-500/20', text: 'text-slate-700' },
  reopened: { en: 'Reopened', ar: 'أعيد فتحها', bg: 'bg-red-500/20', text: 'text-red-700' },
};

// Each item is labelled for what it is — nobody looking at a register wants to
// read "Tool" and guess whether it's a keyboard or a mouse.
export const CUSTODY_TYPES: Record<string, Style> = {
  laptop: { en: 'Laptop', ar: 'حاسب محمول', bg: 'bg-indigo-500/15', text: 'text-indigo-700' },
  desktop: { en: 'Desktop', ar: 'حاسب مكتبي', bg: 'bg-indigo-500/15', text: 'text-indigo-700' },
  phone: { en: 'Phone', ar: 'هاتف', bg: 'bg-teal-500/15', text: 'text-teal-700' },
  tablet: { en: 'Tablet', ar: 'جهاز لوحي', bg: 'bg-teal-500/15', text: 'text-teal-700' },
  sim: { en: 'SIM Card', ar: 'شريحة اتصال', bg: 'bg-cyan-500/15', text: 'text-cyan-700' },
  monitor: { en: 'Monitor', ar: 'شاشة', bg: 'bg-sky-500/15', text: 'text-sky-700' },
  keyboard: { en: 'Keyboard', ar: 'لوحة مفاتيح', bg: 'bg-emerald-500/15', text: 'text-emerald-700' },
  mouse: { en: 'Mouse', ar: 'فأرة', bg: 'bg-emerald-500/15', text: 'text-emerald-700' },
  keyboard_mouse: { en: 'Keyboard & Mouse', ar: 'لوحة مفاتيح وفأرة', bg: 'bg-emerald-500/15', text: 'text-emerald-700' },
  headset: { en: 'Headset', ar: 'سماعة رأس', bg: 'bg-emerald-500/15', text: 'text-emerald-700' },
  printer: { en: 'Printer', ar: 'طابعة', bg: 'bg-orange-500/15', text: 'text-orange-700' },
  router: { en: 'Router', ar: 'موجّه شبكة', bg: 'bg-orange-500/15', text: 'text-orange-700' },
  charger: { en: 'Charger', ar: 'شاحن', bg: 'bg-amber-500/15', text: 'text-amber-700' },
  cable: { en: 'Cable', ar: 'كبل', bg: 'bg-amber-500/15', text: 'text-amber-700' },
  laptop_bag: { en: 'Laptop Bag', ar: 'حقيبة حاسب', bg: 'bg-stone-500/15', text: 'text-stone-700' },
  accessory: { en: 'Accessory', ar: 'ملحق', bg: 'bg-stone-500/15', text: 'text-stone-700' },
  access_card: { en: 'Access Card', ar: 'بطاقة دخول', bg: 'bg-violet-500/15', text: 'text-violet-700' },
  vehicle: { en: 'Vehicle', ar: 'مركبة', bg: 'bg-slate-500/15', text: 'text-slate-700' },
  tool: { en: 'Tool', ar: 'أداة', bg: 'bg-slate-500/15', text: 'text-slate-700' },
  other: { en: 'Other', ar: 'أخرى', bg: 'bg-slate-500/15', text: 'text-slate-700' },
};

// ── دلاء العرض ──────────────────────────────────────────────────────────────
// خمس فئات تُعرض ككروت بإجمالياتها أعلى الصفحة. النوع المفصّل يبقى محفوظاً كما
// هو في قاعدة البيانات — الدلو طبقة عرض تُشتق منه، لأن سجلاً فيه خمسة عشر
// نوعاً وستة وستون اسماً حرّاً لا يمكن قراءة إجمالياته بالعين.
// مطابقة لـ BUCKETS في backend/src/config/itCustody.js.
export interface CustodyBucket {
  key: string;
  ar: string;
  en: string;
  /** النوع الذي يُكتب عند إضافة صنف جديد من هذا الدلو. */
  canonicalType: string;
  types: string[];
}

export const CUSTODY_BUCKETS: CustodyBucket[] = [
  { key: 'laptops', ar: 'لابتوبات', en: 'Laptops', canonicalType: 'laptop', types: ['laptop', 'desktop'] },
  { key: 'peripherals', ar: 'ماوس وكيبورد', en: 'Mouse & Keyboard', canonicalType: 'keyboard_mouse', types: ['mouse', 'keyboard', 'keyboard_mouse'] },
  { key: 'phones', ar: 'موبايلات', en: 'Phones', canonicalType: 'phone', types: ['phone', 'tablet'] },
  { key: 'monitors', ar: 'شاشات', en: 'Monitors', canonicalType: 'monitor', types: ['monitor'] },
  { key: 'other', ar: 'أخرى', en: 'Other', canonicalType: 'other', types: ['laptop_bag', 'charger', 'cable', 'headset', 'printer', 'router', 'access_card', 'accessory', 'other'] },
];

const TYPE_TO_BUCKET = new Map<string, string>();
CUSTODY_BUCKETS.forEach((b) => b.types.forEach((t) => TYPE_TO_BUCKET.set(t, b.key)));

/** الدلو الذي ينتمي إليه نوع مفصّل — وأي نوع مجهول يسقط في «أخرى» بدل أن يختفي. */
export const bucketOf = (type?: string) => TYPE_TO_BUCKET.get(String(type || '').trim()) || 'other';

export const bucketLabel = (key: string, lang: Lang) => {
  const b = CUSTODY_BUCKETS.find((x) => x.key === key);
  return b ? b[lang] : key;
};

// أسماء الأنواع بالعربية لاشتقاق اسم العرض. مطابقة لـ TYPE_NAME_AR في
// backend/src/config/itCustody.js — الشاشة تعرض معاينة للاسم قبل الحفظ، وأي
// اختلاف بين النسختين يجعل المعاينة تَعِد باسم غير الذي يُحفظ.
export const TYPE_NAME_AR: Record<string, string> = {
  laptop: 'لابتوب', desktop: 'حاسب مكتبي', phone: 'موبايل', tablet: 'جهاز لوحي',
  monitor: 'شاشة', keyboard: 'كيبورد', mouse: 'ماوس', keyboard_mouse: 'ماوس وكيبورد',
  headset: 'سماعة رأس', printer: 'طابعة', router: 'راوتر', charger: 'شاحن',
  cable: 'كابل', laptop_bag: 'شنطة لابتوب', accessory: 'ملحق',
  access_card: 'بطاقة دخول', other: 'صنف آخر',
};

/**
 * اسم العرض مشتقّ من النوع والماركة بدل أن يُكتب باليد — «لابتوب Dell».
 * الاسم الحرّ هو ما أنتج ستة وستين تهجئة لنفس الأجهزة في السجل.
 */
export const deriveAssetName = (type?: string, brand?: string) => {
  const base = TYPE_NAME_AR[String(type || '').trim()] || TYPE_NAME_AR.other;
  const b = String(brand || '').trim();
  return b ? `${base} ${b}` : base;
};

/** الأنواع المفصّلة داخل دلو «أخرى» — تغذّي الفلتر الثاني الذي يظهر عند اختياره. */
export const OTHER_BUCKET_TYPES =
  CUSTODY_BUCKETS.find((b) => b.key === 'other')!.types;

// Types IT does NOT hand out (vehicles belong to the fleet section; `tool` is
// HR's — عدة, safety kit). An EXCLUDE list, mirroring `itHandsOut: false` in
// backend/src/config/assetDefaults.js: a frozen include-list silently hid every
// new type added through Reference Data from IT's own dropdowns.
// الشرائح انضمّت للقائمة: خطوط الأرقام ليست من عهدة القسم، وبقاؤها كان يضيف
// أربعة وستين صفاً لا يملكها أحد فينا إلى كل عدّ وكل تقرير.
// مطابقة لـ EXCLUDED_TYPES في backend/src/config/itCustody.js.
export const IT_CUSTODY_EXCLUDED_TYPE_KEYS = ['vehicle', 'tool', 'sim'];

// The custody page never lists warehouse stock (that has its own page), so its
// status filter must not offer `in_stock`.
export const CUSTODY_STATUS_KEYS = ['assigned', 'returned'];

// A consumable row can stand for many identical units; serial-tracked gear is 1.
export const unitsOf = (a: { quantity?: number }) => Math.max(1, Number(a?.quantity) || 1);

export const CONDITIONS: Record<string, Style> = {
  new: { en: 'New', ar: 'جديد', bg: 'bg-green-500/15', text: 'text-green-700' },
  good: { en: 'Good', ar: 'جيد', bg: 'bg-blue-500/15', text: 'text-blue-700' },
  fair: { en: 'Fair', ar: 'مقبول', bg: 'bg-amber-500/15', text: 'text-amber-700' },
  damaged: { en: 'Damaged', ar: 'تالف', bg: 'bg-red-500/15', text: 'text-red-700' },
};

// «خارج الخدمة» صارت «تالف» بطلب القسم: العبارة الأولى كانت تصف موقعاً، وما
// يعني المستودع فعلاً هو أن الصنف لم يعد صالحاً للتسليم.
export const CUSTODY_STATUSES: Record<string, Style> = {
  assigned: { en: 'Assigned', ar: 'بعهدة الموظف', bg: 'bg-amber-500/20', text: 'text-amber-700' },
  in_stock: { en: 'In Stock', ar: 'المستودع', bg: 'bg-blue-500/20', text: 'text-blue-700' },
  returned: { en: 'Faulty', ar: 'تالف', bg: 'bg-red-500/20', text: 'text-red-700' },
};

// الأزرار الثلاثة العريضة أعلى صفحة العهد، بالترتيب الذي تُقرأ به.
export const CUSTODY_STATE_KEYS = ['assigned', 'in_stock', 'returned'] as const;

export const SYSTEM_TYPES: Record<string, Style> = {
  erp: { en: 'ERP', ar: 'نظام ERP', bg: 'bg-orange-500/15', text: 'text-orange-700' },
  website: { en: 'Website', ar: 'موقع إلكتروني', bg: 'bg-blue-500/15', text: 'text-blue-700' },
  email: { en: 'Email', ar: 'البريد الإلكتروني', bg: 'bg-cyan-500/15', text: 'text-cyan-700' },
  server: { en: 'Server', ar: 'خادم', bg: 'bg-slate-500/15', text: 'text-slate-700' },
  network_device: { en: 'Network Device', ar: 'جهاز شبكة', bg: 'bg-teal-500/15', text: 'text-teal-700' },
  database: { en: 'Database', ar: 'قاعدة بيانات', bg: 'bg-violet-500/15', text: 'text-violet-700' },
  saas: { en: 'SaaS Subscription', ar: 'اشتراك سحابي', bg: 'bg-indigo-500/15', text: 'text-indigo-700' },
  backup: { en: 'Backup', ar: 'نسخ احتياطي', bg: 'bg-green-500/15', text: 'text-green-700' },
  other: { en: 'Other', ar: 'أخرى', bg: 'bg-slate-500/15', text: 'text-slate-700' },
};

export const SYSTEM_STATUSES: Record<string, Style> = {
  operational: { en: 'Operational', ar: 'يعمل', bg: 'bg-green-500/20', text: 'text-green-700' },
  degraded: { en: 'Degraded', ar: 'أداء منخفض', bg: 'bg-amber-500/20', text: 'text-amber-700' },
  down: { en: 'Down', ar: 'متوقف', bg: 'bg-red-500/20', text: 'text-red-700' },
  maintenance: { en: 'Maintenance', ar: 'صيانة', bg: 'bg-blue-500/20', text: 'text-blue-700' },
  retired: { en: 'Retired', ar: 'خارج الخدمة', bg: 'bg-slate-500/20', text: 'text-slate-700' },
};

export const ENVIRONMENTS: Record<string, Style> = {
  production: { en: 'Production', ar: 'الإنتاج', bg: 'bg-red-500/15', text: 'text-red-700' },
  staging: { en: 'Staging', ar: 'التجريبي', bg: 'bg-amber-500/15', text: 'text-amber-700' },
  development: { en: 'Development', ar: 'التطوير', bg: 'bg-blue-500/15', text: 'text-blue-700' },
};

export const COST_PERIODS: Record<string, Style> = {
  monthly: { en: 'Monthly', ar: 'شهري', bg: 'bg-slate-500/15', text: 'text-slate-700' },
  yearly: { en: 'Yearly', ar: 'سنوي', bg: 'bg-slate-500/15', text: 'text-slate-700' },
  one_time: { en: 'One-time', ar: 'مرة واحدة', bg: 'bg-slate-500/15', text: 'text-slate-700' },
};

// ── Label helpers ───────────────────────────────────────────────────────────

const labelFrom = (map: Record<string, Style>, key: string, lang: Lang) =>
  map[key] ? map[key][lang] : key || '—';

export const styleOf = (map: Record<string, Style>, key: string) => map[key] || null;

export const categoryLabel = (k: string, lang: Lang) => labelFrom(TICKET_CATEGORIES, k, lang);
export const priorityLabel = (k: string, lang: Lang) => labelFrom(TICKET_PRIORITIES, k, lang);
export const ticketStatusLabel = (k: string, lang: Lang) => labelFrom(TICKET_STATUSES, k, lang);
export const custodyTypeLabel = (k: string, lang: Lang) => labelFrom(CUSTODY_TYPES, k, lang);
export const custodyStatusLabel = (k: string, lang: Lang) => labelFrom(CUSTODY_STATUSES, k, lang);
export const conditionLabel = (k: string, lang: Lang) => labelFrom(CONDITIONS, k, lang);
export const systemTypeLabel = (k: string, lang: Lang) => labelFrom(SYSTEM_TYPES, k, lang);
export const systemStatusLabel = (k: string, lang: Lang) => labelFrom(SYSTEM_STATUSES, k, lang);
export const environmentLabel = (k: string, lang: Lang) => labelFrom(ENVIRONMENTS, k, lang);
export const costPeriodLabel = (k: string, lang: Lang) => labelFrom(COST_PERIODS, k, lang);

// Turn a label map into [{key,en,ar}] for <option> lists.
export const optionsOf = (map: Record<string, Style>, only?: string[]) =>
  Object.entries(map)
    .filter(([k]) => !only || only.includes(k))
    .map(([key, v]) => ({ key, en: v.en, ar: v.ar }));

// ── Formatters ──────────────────────────────────────────────────────────────

// «اليوم» يوم الرياض لا يوم غرينتش: `toISOString()` كانت تعطي أمسِ بين منتصف
// الليل والثالثة فجرًا. المرجعُ واحدٌ الآن في `lib/companyDay`.
export { today } from './companyDay';
import { dayOffset } from './companyDay';

export const daysAgo = (n: number) => dayOffset(-n);

export const fmtDate = (v?: string | null) => (v ? new Date(v).toLocaleDateString('en-GB') : '—');

export const fmtDateTime = (v?: string | Date | null) =>
  v ? new Date(v).toLocaleString('en-GB', { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—';

export const fmtMoney = (v?: number | null) =>
  typeof v === 'number' ? v.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 2 }) : '—';

// زمن الحل يُخزَّن بالدقائق لكنه دائماً من مضاعفات اليوم الكامل، لأن تاريخ
// البلاغ بلا وقت. صفر يعني أن البلاغ حُلّ في يومه — لا أنه استغرق صفر دقيقة،
// و«٠ د» كانت تقرأ كأن شيئاً لم يحدث.
export const fmtDuration = (minutes?: number | null, lang: Lang = 'en') => {
  if (minutes === undefined || minutes === null || !Number.isFinite(minutes)) return '—';
  const m = Math.max(0, Math.round(minutes));
  if (m === 0) return lang === 'ar' ? 'نفس اليوم' : 'Same day';
  if (m < 60) return lang === 'ar' ? `${m} د` : `${m}m`;
  const h = Math.floor(m / 60);
  const mm = m % 60;
  if (h < 24) {
    if (lang === 'ar') return mm ? `${h} س ${mm} د` : `${h} س`;
    return mm ? `${h}h ${mm}m` : `${h}h`;
  }
  const d = Math.floor(h / 24);
  const hh = h % 24;
  if (lang === 'ar') return hh ? `${d} ي ${hh} س` : `${d} ي`;
  return hh ? `${d}d ${hh}h` : `${d}d`;
};

export const daysUntil = (v?: string | null): number | null => {
  if (!v) return null;
  const t = new Date(`${v}T00:00:00`).getTime();
  if (!Number.isFinite(t)) return null;
  return Math.ceil((t - new Date(new Date().toDateString()).getTime()) / 86400000);
};

// Renewal urgency colouring: overdue → red, ≤30d → amber, else calm.
export const renewalTone = (v?: string | null) => {
  const d = daysUntil(v);
  if (d === null) return 'text-slate-500';
  if (d < 0) return 'text-red-600 font-semibold';
  if (d <= 30) return 'text-amber-600 font-semibold';
  return 'text-slate-700';
};

export const empName = (e: any, lang: Lang = 'en'): string => {
  if (!e) return '—';
  if (typeof e === 'string') return e;
  if (lang === 'ar' && e.arabicName) return e.arabicName;
  const n = `${e.firstName || ''} ${e.lastName || ''}`.trim();
  return n || e.arabicName || '—';
};

export const userName = (u: any): string => {
  if (!u) return '—';
  if (typeof u === 'string') return u;
  return `${u.firstName || ''} ${u.lastName || ''}`.trim() || '—';
};

export const idOf = (v: any): string => (!v ? '' : typeof v === 'string' ? v : v._id || '');

// Access is the ROLE list OR whatever the super-admin granted this role in the
// permissions matrix. Guarding on the role list alone would make a granted role
// see the sidebar link and be allowed by the API, then be refused by the page.
type UserLike = { role?: string | null; permissions?: Record<string, 'none' | 'view' | 'edit'> } | null | undefined;
export const canViewIt = (u: UserLike) => isItStaff(u?.role) || canAccessSection(u?.permissions, 'Software & IT');
export const canEditIt = (u: UserLike) => isItAdmin(u?.role) || canEditSection(u?.permissions, 'Software & IT');


// ── قوائم نموذج البلاغ ──────────────────────────────────────────────────────
// الأقسام تأتي من ملفات الموظفين نفسها، ومن يُسند إليه الحل من مستخدمي النظام:
// الحقلان كانا نصاً حرّاً، فكان كل تقرير يجمّع حسب القسم أو حسب المسؤول ينقسم
// على اختلاف تهجئة الاسم.
export const listItDepartments = () => api.get<{ departments: string[] }>('/api/it/departments');
export const listItAssignees = () => api.get<{ users: ItAssignee[] }>('/api/it/assignees');


// ── بريد الشركة (@energize-logistics.com) ───────────────────────────────────
// صناديق بريد على هوستنجر — مش حسابات الدخول للسيستم. كلمة المرور بترجع من
// endpoint الكشف بس، ومع كل كشف بيتسجّل مين وامتى.
export interface CompanyEmail {
  _id: string;
  email: string;
  localPart?: string;
  domain?: string;
  displayName?: string;
  employee?: string | null;
  employeeNumber?: string;
  employeeName?: string;
  department?: string;
  mailboxType: 'personal' | 'functional';
  functionAr?: string;
  status: 'active' | 'suspended' | 'closed';
  passwordSetAt?: string | null;
  passwordSetByName?: string;
  lastRevealedAt?: string | null;
  lastRevealedByName?: string;
  revealCount?: number;
  notes?: string;
  createdAt?: string;
}

export interface EmailEmployee {
  _id: string; name: string; employeeNumber: string; department: string; jobTitle: string; inactive?: boolean;
}

export const COMPANY_DOMAIN = 'energize-logistics.com';

export const MAILBOX_STATUS: Record<string, { ar: string; en: string; cls: string }> = {
  active: { ar: 'نشط', en: 'Active', cls: 'bg-emerald-100 text-emerald-700' },
  suspended: { ar: 'موقوف', en: 'Suspended', cls: 'bg-amber-100 text-amber-700' },
  closed: { ar: 'مغلق', en: 'Closed', cls: 'bg-slate-200 text-slate-600' },
};

export const listCompanyEmails = (q: Record<string, string> = {}) => {
  const qs = new URLSearchParams(Object.entries(q).filter(([, v]) => v)).toString();
  return api.get<{
    emails: CompanyEmail[];
    counts: { total: number; active: number; personal: number; functional: number; linked: number; unlinked: number; withPassword: number; withoutPassword: number };
    vaultReady: boolean; canReveal: boolean; companyDomain: string;
  }>(`/api/it/emails${qs ? `?${qs}` : ''}`);
};
export const searchEmailEmployees = (q: string) =>
  api.get<{ employees: EmailEmployee[] }>(`/api/it/emails/employees${q ? `?q=${encodeURIComponent(q)}` : ''}`);
export const createCompanyEmail = (body: any) => api.post<{ email: CompanyEmail }>('/api/it/emails', body);
export const updateCompanyEmail = (id: string, body: any) => api.put<{ email: CompanyEmail }>(`/api/it/emails/${id}`, body);
export const deleteCompanyEmail = (id: string) => api.delete(`/api/it/emails/${id}`);
/** الكشف حدث مسجَّل — مش قراءة عادية. */
export const revealCompanyEmailPassword = (id: string) =>
  api.post<{ password: string; email: string; revealCount: number }>(`/api/it/emails/${id}/reveal`, {});

/**
 * تصدير بكلمات المرور. مسار مستقل بنفس صلاحية الكشف ومسجَّل في سجل التدقيق —
 * ملف إكسل فيه كلمات مرور بيسيب الخزنة ويقعد على ديسك توب حد.
 */
export const exportCompanyEmailsWithPasswords = (q: Record<string, string> = {}) => {
  const qs = new URLSearchParams(Object.entries(q).filter(([, v]) => v)).toString();
  return api.get<{ rows: any[]; exported: number; withPassword: number }>(
    `/api/it/emails/export${qs ? `?${qs}` : ''}`
  );
};
