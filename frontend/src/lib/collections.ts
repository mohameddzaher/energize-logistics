// قسمُ التحصيل — الأنواعُ والصلاحيّاتُ في موضعٍ واحد.
//
// البوّابةُ قاعدةٌ واحدة: قائمةُ الأدوار الثابتة **أو** منحٌ من مصفوفة
// الصلاحيّات. ونسخُها في كلّ صفحةٍ هو ما جعل أقسامًا تُفتح لمن مُنحها ثمّ
// يجدها للقراءة فقط لأنّ أزرارَها كانت محروسةً بقائمةٍ أخرى.
import { canAccessSection, canEditSection, roleOf, permsOf, type RoleOrUser } from './sections';

export const SECTION = 'Collections';

export const COLLECTIONS_ROLES = [
  'super_admin', 'admin', 'it_manager', 'it_specialist',
  'collections_manager', 'collections_staff',
  'operations_manager', 'finance_manager', 'accountant',
];

export const COLLECTIONS_EDIT_ROLES = [
  'super_admin', 'admin', 'it_manager', 'it_specialist',
  'collections_manager', 'collections_staff', 'finance_manager',
];

// إعداداتُ القسم وحذفُ الأطراف لمديره: تعطيلُ طرفٍ يُخفي دَينًا من كلّ تقرير.
export const COLLECTIONS_ADMIN_ROLES = ['super_admin', 'admin', 'it_manager', 'collections_manager'];

export const canViewCollections = (u: RoleOrUser): boolean =>
  COLLECTIONS_ROLES.includes(roleOf(u)) || canAccessSection(permsOf(u), SECTION);

export const canEditCollections = (u: RoleOrUser): boolean =>
  COLLECTIONS_EDIT_ROLES.includes(roleOf(u)) || canEditSection(permsOf(u), SECTION);

export const isCollectionsAdmin = (u: RoleOrUser): boolean =>
  COLLECTIONS_ADMIN_ROLES.includes(roleOf(u));

/**
 * ── مَن يرى «ما علينا» ─────────────────────────────────────────────────────
 *
 * قسمُ التحصيل يُحصِّل، ولا شأنَ له بما ندفعه للموردين ولا بالصافي ولا بالربح.
 * فالمستحقُّ علينا والصافي يُخفَيان عن دورَيه — لا عن القسم، فالإدارةُ والماليةُ
 * ومديرُ العمليات يفتحون القسمَ نفسَه ويرَون الوجهين.
 *
 * والقاعدةُ بالدور لا بالقسم: القسمُ واحدٌ ومن فيه يختلفون.
 */
const RECEIVABLES_ONLY_ROLES = ['collections_manager', 'collections_staff'];

/** هل يقتصر هذا المستخدم على «ما لنا»؟ */
export const receivablesOnly = (u: RoleOrUser): boolean =>
  RECEIVABLES_ONLY_ROLES.includes(roleOf(u));

export type PartyKind = 'customer' | 'supplier';

export interface CollectionsParty {
  _id: string;
  kind: PartyKind;
  name: string;
  nameKey?: string;
  phone?: string;
  email?: string;
  contactPerson?: string;
  contactPhone?: string;
  accountantName?: string;
  accountantPhone?: string;
  commercialRegister?: string;
  taxNumber?: string;
  iban?: string;
  bankName?: string;
  address?: string;
  city?: string;
  partyType?: string;
  // ── بياناتُ الحساب في دفتر التحصيل ────────────────────────────────────────
  // كودُه المحاسبيّ (وهو هويّتُه لا اسمُه)، ومَن يتولّاه، وتقييمُه، ومَن يبيع
  // له من عندنا، ومهلةُ السداد المتّفق عليها.
  code?: string;
  aliases?: string[];
  collectionOfficer?: string;
  hoLocation?: string;
  grade?: string;
  salesManagers?: string[];
  department?: string;
  region?: string;
  creditDays?: number;
  // نوعُ دفع العميل — منه يُملأ «نوع الدفع» على كشوفه من نفسِه.
  paymentType?: '' | 'cash' | 'tax';
  paymentTerms?: string;
  creditLimit?: number;
  status?: string;
  assignedTo?: { _id: string; firstName?: string; lastName?: string } | string | null;
  lastContactAt?: string | null;
  nextFollowUpAt?: string | null;
  notes?: string;
  isActive?: boolean;
  source?: string;
  // مشتقّةٌ من الكشوف لا مخزَّنةٌ على السجلّ — فلا يقول الملفُّ رقمًا والكشفُ
  // رقمًا آخر لشيءٍ واحد.
  reports: number;
  total: number;
  settled: number;
  outstanding: number;
  openReports: number;
  invoiced: number;
  lastReportAt?: string | null;
  lastSettledAt?: string | null;
  nameVariants?: string[];
}

// «ما لنا» و«ما علينا»: الكلمتان تختلفان باختلاف الجهة، والخلطُ بينهما يجعل
// دَينًا علينا يُقرأ مالًا لنا.
export const kindWords = (kind: PartyKind, ar: boolean) =>
  kind === 'customer'
    ? {
      title: ar ? 'العملاء' : 'Customers',
      one: ar ? 'عميل' : 'customer',
      totalLabel: ar ? 'إجمالي المبيعات' : 'Total billed',
      settledLabel: ar ? 'المحصَّل' : 'Collected',
      dueLabel: ar ? 'المستحق لنا' : 'Receivable',
      openLabel: ar ? 'كشوف لم تُحصَّل' : 'Uncollected reports',
      newOne: ar ? 'عميل جديد' : 'New customer',
    }
    : {
      title: ar ? 'الموردون' : 'Suppliers',
      one: ar ? 'مورد' : 'supplier',
      totalLabel: ar ? 'إجمالي المشتريات' : 'Total purchased',
      settledLabel: ar ? 'المسدَّد' : 'Paid',
      dueLabel: ar ? 'المستحق عليه' : 'Payable',
      openLabel: ar ? 'كشوف لم تُسدَّد' : 'Unpaid reports',
      newOne: ar ? 'مورد جديد' : 'New supplier',
    };

export const money = (n?: number | null) =>
  (Number(n) || 0).toLocaleString('en-US', { maximumFractionDigits: 0 });

export const dt = (v?: string | null) => (v ? new Date(v).toLocaleDateString('en-GB') : '—');

/** اسمُ نوع الدفع كما يُقرأ. */
export const paymentTypeLabel = (t: string | undefined, ar: boolean) =>
  t === 'cash' ? (ar ? 'كاش' : 'Cash') : t === 'tax' ? (ar ? 'ضريبي' : 'Tax') : '—';

// ═══════════════════════════════════════════════════════════════════════════
//  دفترُ التحصيل
// ═══════════════════════════════════════════════════════════════════════════

/** شريحةُ عمرٍ كما يقرؤها الفريق في ورقته. */
export interface AgeBand { key: string; label: string; min: number | null }

export interface AgingRow extends CollectionsParty {
  /**
   * المديونيّةُ وجهان: فواتيرُ ضريبيّةٌ من دفتر الفواتير، وكشوفٌ نقديّةٌ لم
   * تُحصَّل. وكان النقديُّ لا يُحسب أصلًا فيظهر الحسابُ النقديُّ بصفرٍ وعليه
   * عشراتُ الآلاف — راجع cashAgingByParty في الخادم.
   */
  taxOutstanding?: number;
  cashOutstanding?: number;
  outstanding: number;
  invoiceCount: number;
  bands: Record<string, number>;
  bandCounts: Record<string, number>;
  /** نسبةُ ما عليه إلى حدّه الائتمانيّ — `null` حين لا حدَّ له. */
  limitUsedPct: number | null;
}

export interface LedgerInvoice {
  _id: string;
  invoiceNumber: string;
  kind: 'tax' | 'cash';
  partyCode?: string;
  partyName?: string;
  party?: string;
  total: number;
  invoiceDate?: string | null;
  deliveryDate?: string | null;
  collectionDate?: string | null;
  status?: string;
  comments?: string;
  reportNumbers?: string[];
  // ── محسوبةٌ عند القراءة لا مخزَّنة ──────────────────────────────────────
  // الرقمُ المخزَّن يصدق يومَ كُتب ويكذب في اليوم التالي.
  ageDays?: number | null;
  band?: string;
  daysInvoiceToDelivery?: number | null;
  daysDeliveryToCollection?: number | null;
  daysTotal?: number | null;
  creditDays?: number;
  dueDate?: string | null;
  daysToDue?: number | null;
  overdue?: boolean;
}

export interface CollectionTask {
  _id: string;
  party?: string;
  partyCode?: string;
  partyName?: string;
  officerName?: string;
  date: string;
  requestType?: string;
  planned?: boolean;
  status?: string;
  collected?: number;
  action?: string;
  notes?: string;
}

export interface OfficerStat {
  officer: string;
  accounts: number;
  collectedCount: number;
  collectedAmount: number;
  openCount: number;
  openAmount: number;
  overdueCount: number;
  overdueAmount: number;
  avgDaysToCollect: number | null;
  collectionRate: number | null;
  tasks?: number;
  tasksDone?: number;
  tasksCollected?: number;
}

/** تقييمُ العميل — يُلوَّن ليُقرأ في لمحة. */
export const gradeTone = (g?: string) => {
  const k = String(g || '').toUpperCase();
  if (k.startsWith('A')) return 'bg-emerald-50 text-emerald-700 border-emerald-200';
  if (k.startsWith('B')) return 'bg-amber-50 text-amber-700 border-amber-200';
  if (k.startsWith('C')) return 'bg-red-50 text-red-700 border-red-200';
  return 'bg-slate-100 text-slate-600 border-slate-200';
};

/**
 * لونُ استهلاك الحدّ الائتمانيّ.
 * لا لونَ لمن لا حدَّ له: الرماديُّ يقول «لا سقفَ مضبوطٌ لهذا العميل»، وهو
 * خبرٌ في نفسِه — لا يُقرأ «سليم».
 */
export const limitTone = (pct: number | null | undefined) => {
  if (pct == null) return 'text-slate-400';
  if (pct >= 100) return 'text-red-600 font-semibold';
  if (pct >= 80) return 'text-amber-600 font-semibold';
  return 'text-emerald-600';
};

/** أيّامٌ حتى الاستحقاق، مقروءةً بكلامٍ لا برقمٍ سالب. */
export const dueWords = (d: number | null | undefined, ar: boolean) => {
  if (d == null) return '—';
  if (d < 0) return ar ? `متأخّرة ${Math.abs(d)} يومًا` : `${Math.abs(d)}d overdue`;
  if (d === 0) return ar ? 'تستحقّ اليوم' : 'due today';
  return ar ? `بعد ${d} يومًا` : `in ${d}d`;
};
