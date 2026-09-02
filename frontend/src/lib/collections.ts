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
