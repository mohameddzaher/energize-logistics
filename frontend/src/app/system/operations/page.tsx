'use client';
import { FINANCE_FULL_ROLES } from '@/lib/financeAuthority';
import { useState, useEffect, useCallback, useRef } from 'react';
import MonthPicker from '@/components/system/MonthPicker';
import { useRouter } from 'next/navigation';
import { ColumnFilter, type ColumnFilterOption } from '@/components/ColumnFilter';
import { useAuth } from '@/context/AuthContext';
import { useLanguage } from '@/context/LanguageContext';
import { useDialog } from '@/components/system/DialogProvider';
import { getOperationsTranslations } from '@/lib/translations';
import { SHIPMENT_STATUSES, PAYMENT_METHODS } from '@/lib/ops';
import api from '@/lib/api';
import { PAYMENT_CHOICES, paymentFamily, paymentKindLabel, paymentKindOf } from '@/lib/paymentKind';
import { startBackgroundExport, type ExportJob } from '@/lib/backgroundExport';
import ExportMenu from '@/components/ls2/ExportMenu';
import DateRangeFilter, { DateField } from '@/components/system/DateRangeFilter';
import ManagedSelect from '@/components/system/ManagedSelect';
import { useSocket } from '@/hooks/useSocket';
import { useLatestRequest } from '@/hooks/useLatestRequest';
import {
  ClipboardList, Plus, Search, Filter, FilterX, Edit, Trash2, ArrowRight, Loader2, X, FileSpreadsheet, AlertCircle, CheckSquare, Check, Receipt, AlertTriangle } from 'lucide-react';
import ScrollX from '@/components/system/ScrollX';
import InvoiceImportButton from '@/components/operations/InvoiceImportButton';
import WorkflowFilterBar, { type FilterBarField } from '@/components/operations/WorkflowFilterBar';
import InvoiceCheckCards from '@/components/operations/InvoiceCheckCards';
import CustomsLinkBadge, { type CustomsLinkView } from '@/components/customs/CustomsLinkBadge';

interface Workflow {
  _id: string;
  reportNumber: string;
  reportDate: string;
  fromLocation: string;
  toLocation: string;
  branch: string;
  carOwner: string;
  carNumber: string;
  ownerType: string;
  executionStatus: string;
  applicationStatus: string;
  paymentMethod: string;
  username: string;
  userPhone: string;
  taxIndicator: string;
  purchaseValue: number;
  sellingValue: number;
  loadingTime: string;
  driverRentalType: string;
  reference: string;
  driverName: string;
  driverPhone: string;
  carName: string;
  plateNumber: string;
  truckType: string;
  truckSize: string;
  loadType: string;
  quantity: string;
  goodsValue: number;
  representativeName: string;
  country: string;
  operationsReview: string;
  paymentDate: string;
  /** آخرُ مَن كتب تاريخ السداد أو عدّله — يُكتب في الخادم. */
  paymentDateByName?: string;
  /**
   * ── مسؤولُ البيانات كما يحسبه الخادم ──────────────────────────────────────
   * من كتب تاريخَ السداد عندنا، فمن سجّل الشراءَ في المحفظة (هو من دفع
   * ساعتَها)، وإلّا فـ«منقول من منصّة الأوبريشن» — فلا تُقرأ خانةٌ فارغةٌ
   * «مجهولًا» وفي الصفّ تاريخٌ وفرعٌ ومبلغ. راجع workflowController.
   */
  dataOwnerShown?: string;
  dataOwnerFrom?: 'system' | 'wallet' | 'import' | '';
  paymentDateAt?: string;
  payingBranch: string;
  finalReportDestination: string;
  documentNumber: string;
  sendingDate: string;
  branchDeliveryDate: string;
  deliveryDate: string;
  accountingReview: string;
  paymentAmount: number;
  // العائلةُ (cash | tax) — وفي نسخة التعديل قد تحمل أحدَ الأنواع الأربعة قبل الحفظ.
  paymentType: string;
  /** النوعُ المختار: «آجل - فاتورة» و«آجل - كاش» و«نقدي - 3PL» و«نقدي - HT» — راجع lib/paymentKind. */
  paymentSubtype?: string;
  collectedAmount: number;
  invoiceNumber: string;
  netInvoice: number;
  tax: number;
  totalInvoice: number;
  invoiceDate: string;
  invoiceNotes: string;
  collectionDate: string;
  stage: string;
  lockedBy: { _id: string; firstName: string; lastName: string } | null;
  lockedByName: string;
  lockedAt: string | null;
  createdAt: string;
  /** معاملةُ التخليص المرتبطة — نسخةٌ يكتبها الخادم (services/customsOpsLink). */
  customsLink?: (CustomsLinkView & { clearance?: string | null }) | null;
  /** عمودُ «التخليص» في الفلاتر — يُحسب في الخادم من `customsLink.refNumber`. */
  customsRef?: string;
}

const STAGE_CONFIG: Record<string, { label: string; color: string; bg: string }> = {
  draft: { label: 'Draft', color: 'text-slate-500', bg: 'bg-slate-500/20' },
  submitted_to_ops: { label: 'Submitted to Ops', color: 'text-blue-600', bg: 'bg-blue-500/20' },
  ops_completed: { label: 'Ops Completed', color: 'text-yellow-700', bg: 'bg-yellow-500/20' },
  submitted_to_collections: { label: 'To Collections', color: 'text-purple-600', bg: 'bg-purple-500/20' },
  completed: { label: 'Completed', color: 'text-green-600', bg: 'bg-green-500/20' },
};

// مرجعان ثابتان: العمود غير المفلتر والعمود الذي لم تُفتح قائمته يشتركان فيهما،
// فلا يُنشأ في كل رسمةٍ مرجعٌ جديد يُبطل حسابات القائمة بلا سبب.
const EMPTY_SET = new Set<string>();
const EMPTY_OPTIONS: ColumnFilterOption[] = [];
// البطاقةُ الهادئة — نمطُ شجرة المديونيّة (components/collections/ReceivablesTree).
const CARD = 'flex w-full h-full min-w-0 items-center gap-3 rounded-2xl border border-slate-200 bg-white px-4 sm:px-5 py-3.5 text-start shadow-[0_1px_2px_rgba(15,23,42,0.04)] transition-colors hover:bg-slate-50/60';
const CARD_ON = '!border-slate-900 !bg-slate-50 ring-1 ring-slate-900/10';
const CARD_NUM = 'text-xl sm:text-2xl font-bold tabular-nums tracking-tight text-slate-900';
const CARD_LABEL = 'inline-flex items-start gap-1.5 text-xs font-medium text-slate-500 leading-snug';
const CARD_SUB = 'text-[10.5px] leading-snug text-slate-400';
// Columns whose filter-dropdown labels should be formatted as dates / money.
const DATE_FIELDS = new Set(['reportDate', 'paymentDate', 'sendingDate', 'branchDeliveryDate', 'deliveryDate', 'invoiceDate', 'collectionDate']);
const NUM_FIELDS = new Set(['purchaseValue', 'sellingValue', 'netInvoice', 'tax', 'totalInvoice', 'paymentAmount', 'collectedAmount']);

// ── أعمدة التصدير ────────────────────────────────────────────────────────────
// مكتوبةٌ هنا لا مشتقّةٌ من ترتيب الجدول، ليبقى الملفُّ ثابتَ الشكل.
//
// وأعمدةُ المال تُحذف منه لمن لا يملكها: الخادمُ لم يعد يرسلها أصلًا، فتركُها
// في القائمة يُخرج ثمانيةَ أعمدةٍ فارغةٍ بعناوينها — وعمودٌ فارغٌ بعنوانٍ
// يُقرأ «لا فاتورة لهذا الكشف»، وهو غيرُ «لا تُعرض لك».
const MONEY_EXPORT_KEYS = new Set([
  'accountingReview', 'invoiceNumber', 'netInvoice', 'tax', 'totalInvoice',
  'invoiceDate', 'invoiceNotes', 'collectionDate',
]);
const EXPORT_COLUMNS = [
  { header: 'رقم الطلب', key: 'reportNumber', width: 14 },
  { header: 'تاريخ الطلب', key: 'reportDate', width: 12 },
  { header: 'من', key: 'fromLocation', width: 14 },
  { header: 'إلى', key: 'toLocation', width: 14 },
  { header: 'الفرع', key: 'branch', width: 14 },
  { header: 'مالك السيارة', key: 'carOwner', width: 22 },
  { header: 'رقم السيارة', key: 'carNumber', width: 14 },
  { header: 'حالة الطلب', key: 'applicationStatus', width: 16 },
  { header: 'العميل', key: 'username', width: 20 },
  { header: 'هاتف العميل', key: 'userPhone', width: 14 },
  { header: 'قيمة الشراء', key: 'purchaseValue', width: 12 },
  { header: 'قيمة البيع', key: 'sellingValue', width: 12 },
  { header: 'السائق', key: 'driverName', width: 20 },
  { header: 'نوع الشاحنة', key: 'truckType', width: 14 },
  { header: 'حجم الشاحنة', key: 'truckSize', width: 12 },
  { header: 'المندوب', key: 'representativeName', width: 18 },
  { header: 'مراجعة العمليات', key: 'operationsReview', width: 14 },
  { header: 'تاريخ السداد', key: 'paymentDate', width: 12 },
  { header: 'مسؤول البيانات', key: 'dataOwnerShown', width: 22 },
  { header: 'فرع السداد', key: 'payingBranch', width: 14 },
  { header: 'نوع الدفع', key: 'paymentType', width: 14 },
  { header: 'وجهة الكشف النهائية', key: 'finalReportDestination', width: 18 },
  { header: 'رقم المستند', key: 'documentNumber', width: 14 },
  { header: 'معاملة التخليص', key: 'customsRef', width: 14 },
  { header: 'البوليصة', key: 'customsBl', width: 18 },
  { header: 'تاريخ الإرسال', key: 'sendingDate', width: 12 },
  { header: 'تاريخ التسليم للفرع', key: 'branchDeliveryDate', width: 14 },
  { header: 'تاريخ التسليم للعميل', key: 'deliveryDate', width: 14 },
  { header: 'مراجعة المحاسبة', key: 'accountingReview', width: 14 },
  { header: 'رقم الفاتورة', key: 'invoiceNumber', width: 14 },
  { header: 'صافي الفاتورة', key: 'netInvoice', width: 12 },
  { header: 'الضريبة', key: 'tax', width: 10 },
  { header: 'إجمالي الفاتورة', key: 'totalInvoice', width: 14 },
  { header: 'تاريخ الفاتورة', key: 'invoiceDate', width: 12 },
  { header: 'تاريخ التحصيل', key: 'collectionDate', width: 12 },
];

// ── أعمدةُ شريط الفلترة ──────────────────────────────────────────────────────
// ما يُسأل عنه كلَّ يوم: العميل، والفرع، والمسار، ونوعُ الدفع، والحالة، والسائق
// والسيارة، وهل على الكشف فاتورة. وبقيّةُ الأعمدة لها فلترُها على رأسها في الجدول.
// (`invoiceState` عمودٌ محسوبٌ في الخادم: موجود / فارغ / بديلٌ مثل «no inv».)
const BAR_FIELDS: (FilterBarField & { money?: boolean })[] = [
  { key: 'username', ar: 'العميل', en: 'Customer' },
  { key: 'branch', ar: 'الفرع', en: 'Branch' },
  { key: 'fromLocation', ar: 'من', en: 'From' },
  { key: 'toLocation', ar: 'إلى', en: 'To' },
  { key: 'paymentType', ar: 'نوع الدفع', en: 'Payment type' },
  { key: 'applicationStatus', ar: 'حالة الطلب', en: 'Status' },
  { key: 'driverName', ar: 'السائق', en: 'Driver' },
  { key: 'carNumber', ar: 'رقم السيارة', en: 'Vehicle' },
  { key: 'carOwner', ar: 'مالك السيارة', en: 'Car owner' },
  { key: 'truckType', ar: 'نوع الشاحنة', en: 'Truck type' },
  { key: 'payingBranch', ar: 'الفرع المسدِّد', en: 'Paying branch' },
  { key: 'invoiceState', ar: 'رقم الفاتورة', en: 'Invoice number', money: true },
  // معاملةُ التخليص: أرقامُ المعاملات، و«(فارغ)» = غيرُ مرتبط.
  { key: 'customsRef', ar: 'التخليص', en: 'Customs' },
];

export default function OperationsWorkflowPage() {
  const router = useRouter();
  const { user } = useAuth();
  const { lang } = useLanguage();
  const T = getOperationsTranslations(lang);
  const { notify } = useDialog();
  // الرسالة نصٌّ واحد يُستعمل في التلميح وفي التنبيه — فلا يقول أحدهما شيئًا
  // ويقول الآخر غيره.
  const gateMsg = lang === 'ar'
    ? 'لا يُسجَّل تاريخ السداد إلا بعد أن تصبح حالة الطلب «استُلم السند». السداد إقرارٌ بوصول المال، ولا يصل قبل استلام السند — وتسجيله قبله يجعل التقارير المالية تَعُدُّ مبلغًا لم يُقبَض.'
    : 'The payment date can only be recorded once the application status is “Bond received”. Recording it earlier makes the financial reports count money that has not arrived.';
  const notifyGate = () => notify(gateMsg, 'error');
  // Translate raw UPL status/payment values for DISPLAY only (stored raw, so new
  // values the vendor adds still show — falling back to the raw value).
  const trStatus = (v: string) => { const s = SHIPMENT_STATUSES.find((x) => x.key === v); return s ? (lang === 'ar' ? s.ar : s.en) : v; };
  const trPayment = (v: string) => { const p = PAYMENT_METHODS.find((x) => x.value === v); return p ? (lang === 'ar' ? p.ar : p.en) : v; };

  const stageLabels: Record<string, string> = {
    draft: T.draft,
    submitted_to_ops: T.submittedToOps,
    ops_completed: T.opsCompleted,
    submitted_to_collections: T.toCollections,
    completed: T.completedStage,
  };
  const [workflows, setWorkflows] = useState<Workflow[]>([]);
  const [loading, setLoading] = useState(true);
  const [searching, setSearching] = useState(false);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [stageFilter, setStageFilter] = useState('');
  const [search, setSearch] = useState('');
  const [searchInput, setSearchInput] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  // ── ثلاثةُ أوضاعٍ للفترة ────────────────────────────────────────────────────
  // «كشوفُ هذا الشهر» و«كشوفُ يومِ كذا» سؤالان يُطرحان أكثرَ من المدى الحرّ،
  // وكتابةُ كلٍّ منهما مدًى من طرفين عملٌ يتكرّر: آخرُ الشهر يُحسب باليد فيُخطأ
  // في الثلاثين والواحد والثلاثين وشباط، واليومُ الواحد يُكتب مرّتين.
  // فيُختار الوضعُ ويُشتقّ المدى منه — والمدى الحرُّ باقٍ لمن يريده.
  type DateMode = 'range' | 'month' | 'day';
  const [dateMode, setDateMode] = useState<DateMode>('range');
  const [monthKey, setMonthKey] = useState('');
  const [dayKey, setDayKey] = useState('');
  const applyMonth = (mk: string) => {
    setMonthKey(mk);
    if (!mk) { setDateFrom(''); setDateTo(''); setPage(1); return; }
    const [y, mo] = mk.split('-').map(Number);
    const last = new Date(Date.UTC(y, mo, 0)).getUTCDate();
    setDateFrom(`${mk}-01`);
    setDateTo(`${mk}-${String(last).padStart(2, '0')}`);
    setPage(1);
  };
  const applyDay = (d: string) => {
    setDayKey(d);
    setDateFrom(d); setDateTo(d); setPage(1);
  };
  const switchMode = (m: DateMode) => {
    setDateMode(m);
    // تبديلُ الوضع يمسح ما اختاره الوضعُ السابق: بقاؤه يعني فلترًا لا يراه أحد.
    setDateFrom(''); setDateTo(''); setMonthKey(''); setDayKey(''); setPage(1);
  };
  const [error, setError] = useState('');
  const debounceRef = useRef<NodeJS.Timeout | null>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  // الجدولُ يُنزَل إليه من بطاقة العدد: «أرِني هذه الصفوف» لا «كم هي».
  const tableRef = useRef<HTMLDivElement>(null);
  const [transitioningId, setTransitioningId] = useState<string | null>(null);
  const initialLoadDone = useRef(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkDeleting, setBulkDeleting] = useState(false);
  const [showPendingOnly, setShowPendingOnly] = useState(false);
  // ── التخليص: الكلّ / المرتبطة / غيرُ المرتبطة / معاملةٌ بعينها ────────────
  // `customs` في الرابط: صفحةُ المعاملة تفتح الجدولَ على كشوفها (`?customs=<معرّفها>`).
  const [customsMode, setCustomsMode] = useState('');
  useEffect(() => {
    try {
      const v = new URLSearchParams(window.location.search).get('customs');
      if (v) setCustomsMode(v);
    } catch { /* */ }
  }, []);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editData, setEditData] = useState<Partial<Workflow>>({});
  // الصفُّ كما كان قبل التعديل — يُقارَن به عند الحفظ فلا يُرسَل إلّا ما تغيّر.
  const [editBase, setEditBase] = useState<Partial<Workflow>>({});
  // Which field's input to auto-focus after a click-to-edit (so a single click
  // on a cell drops you straight into typing).
  const [focusField, setFocusField] = useState<string | null>(null);
  // Fields pulled from the Operations Platform (read-only in this table — you
  // edit them at the source). Everything else is manually entered here and is
  // click-to-edit. المرحلة/stage is system-driven too.
  const SYSTEM_FIELDS = new Set<string>([
    'reportNumber', 'reportDate', 'fromLocation', 'toLocation', 'branch', 'carOwner',
    'carNumber', 'ownerType', 'executionStatus', 'applicationStatus', 'paymentMethod',
    // (قيمةُ البيع ليست منها: يكتبها مَن يملكها هنا، وتُكتب في المنصّة معها.)
    'username', 'userPhone', 'taxIndicator', 'purchaseValue', 'loadingTime',
    'driverName', 'driverPhone', 'truckType', 'truckSize', 'loadType', 'quantity',
    'reference', 'representativeName', 'stage',
  ]);
  const [confirmModal, setConfirmModal] = useState<{ message: string; onConfirm: () => void } | null>(null);
  // ── تسجيلُ سدادٍ لدفعةٍ واحدة ─────────────────────────────────────────────
  // السنداتُ تصل دفعةً بتاريخٍ واحدٍ وفرعٍ واحد، وكان يُفتح كلُّ صفٍّ ليُكتب
  // فيه التاريخُ نفسُه — مئةُ فرصةِ خطأٍ لعملٍ واحد.
  const [showBulkPay, setShowBulkPay] = useState(false);
  const [bulkPay, setBulkPay] = useState({ paymentDate: '', payingBranch: '', paymentType: '', finalReportDestination: '', documentNumber: '', sendingDate: '', branchDeliveryDate: '', deliveryDate: '', operationsReview: '' });
  // ── «كلُّ نتائج الفلتر» لا صفحةُ الخمسين وحدَها ─────────────────────────────
  // الجدولُ صفحاتٌ من خمسين؛ والتحديدُ يطال الصفحةَ المعروضة. فإن اختير هذا
  // أُرسلت شروطُ الجدول نفسُها، ويستخرج الخادمُ منها كلَّ ما يطابق — بعدده المؤكَّد.
  const [allMatching, setAllMatching] = useState(false);
  const [bulkPaying, setBulkPaying] = useState(false);
  const [bulkResult, setBulkResult] = useState<{ message: string; skipped: { reportNumber: string; reason: string }[]; more?: number } | null>(null);
  // فلاتر الأعمدة على طريقة إكسل: اسم العمود ← مجموعة القيم الخام المسموح بها.
  // تُرسَل إلى الخادم فيفلتر بها الجدولَ كلَّه، ولا تُطبَّق في المتصفح.
  const [colFilters, setColFilters] = useState<Record<string, Set<string>>>({});
  // قيم كل عمود كما يحسبها الخادم، مع عدد صفوف كل قيمة.
  //
  // كانت تُشتقّ من الصفوف المحمَّلة — وهي خمسون صفًّا — فتعرض «حالة الابلكيشن» ثلاثَ
  // حالاتٍ من تسع؛ ثم عولج ذلك بتنزيل الجدول كلّه عند أول فلتر فصار فتحُ القائمة
  // ينقل عشرات الآلاف من الصفوف ويجمّد التبويب. الحساب صار في القاعدة.
  const [colOptions, setColOptions] = useState<Record<string, { values: ColumnFilterOption[]; truncated: boolean }>>({});
  const [colLoading, setColLoading] = useState<Record<string, boolean>>({});
  const [openField, setOpenField] = useState<string | null>(null);
  // عدّادُ فتحاتٍ لا مجرّد اسم العمود: إعادةُ فتح العمود نفسه يجب أن تُعيد طلب قيمه،
  // وإلا بقيت القائمة على نتيجة بحثٍ سابق جزئية والمستخدم يظنّها كلَّ القيم.
  const [openNonce, setOpenNonce] = useState(0);
  // ترتيبُ وصول الردود ليس ترتيبَ إرسالها: بحثٌ سريع قد يسبق ردُّه ردَّ ما قبله،
  // فتُعرض نتيجةُ حرفٍ قديم فوق نتيجة ما كتبه المستخدم. آخر طلبٍ وحده يُقبل.
  const optionsSeq = useRef<Record<string, number>>({});
  const hasColFilters = Object.keys(colFilters).length > 0;

  const role = user?.role || '';
  // أهلُ المال يملكون في هذه الصفحة ما يملكه مديرُ النظام — راجع lib/financeAuthority.
  const full = role === 'super_admin' || FINANCE_FULL_ROLES.includes(role || '');
  const canCreate = full || role === 'moderator';
  const canDelete = full;

  // ── مَن يرى ماذا: يُسأل الخادمُ ولا يُخمَّن ───────────────────────────────
  //
  // كانت هذه الأسطرُ ثلاثَ قوائمِ أدوارٍ مكتوبةً بالإيد بجانب خريطةٍ رابعةٍ في
  // `workflowController.ROLE_FIELD_ACCESS`. وأربعُ قوائمَ لشيءٍ واحدٍ تفترق
  // حتمًا: قسمُ العمليات يملك الكتابةَ في أعمدة الفاتورة على الخادم منذ
  // إصلاحِ «صح كانت تحفظ لا شيء»، ولا يراها في الجدول أصلًا — يكتب في عمودٍ
  // لا يظهر له.
  //
  // فصارت تُقرأ من `/api/workflows/permissions`، وهي الخريطةُ نفسُها التي
  // يفلتر بها الخادمُ ما يُحفظ. فلا يظهر عمودٌ لا يملكه أحد، ولا يُخفى عمودٌ
  // يكتب فيه — وأيُّ دورٍ جديدٍ يأخذ حقولَه من أوّل يومٍ بلا سطرٍ يُضاف هنا.
  const [myFields, setMyFields] = useState<Set<string> | null>(null);
  useEffect(() => {
    if (!role) return;
    let alive = true;
    // `myFields` حقولُ هذا القارئ كما حسبها الخادم — وهي وحدَها التي تعرف
    // الدورَ المصنوعَ من شاشة الصلاحيّات (لا مفتاحَ له في `roleAccess`).
    // و`roleAccess` تبقى احتياطًا لنسخةِ خادمٍ أقدم.
    api.get<{ roleAccess: Record<string, string[]>; myFields?: string[] }>('/api/workflows/permissions')
      .then((d) => { if (alive) setMyFields(new Set(d?.myFields || d?.roleAccess?.[role] || [])); })
      // تعذّرُ القراءة لا يفتح شيئًا: مجموعةٌ فارغةٌ تعني «لا حقول» فتبقى
      // الأعمدةُ الماليّةُ مخفيّةً حتى يُعرف الجواب.
      .catch(() => { if (alive) setMyFields(new Set()); });
    return () => { alive = false; };
  }, [role]);
  const has = (f: string) => !!myFields?.has(f);

  // الأعمدةُ الماليّة (رقمُ الفاتورة وصافيها وضريبتها وإجماليها وتواريخُها):
  // تُعرض لمن يملك الكتابةَ فيها. و`super_admin` يرى كلَّ شيءٍ دائمًا.
  const canViewFinancials = full || has('invoiceNumber') || has('totalInvoice');
  const canEditAccountingReview = full || has('accountingReview');
  const canEditOperationsReview = full || has('operationsReview');
  // ── قيمةُ البيع: لمن في قائمتها وحدَه ─────────────────────────────────────
  // الخادمُ لا يرسلها لغيرهم أصلًا ولا يقبل كتابتَها منهم؛ والعمودُ يُخفى معها
  // كي لا يُقرأ فراغُه «لا سعرَ لهذا الكشف».
  const canSeeSelling = has('sellingValue');

  // Aggregates over the WHOLE matching dataset (all ~27k rows, not one page).
  const [stats, setStats] = useState<{
    total: number; pendingInvoices: number;
    pendingBondReceived: number; sumPurchaseValue: number;
    purchaseSplit?: { own: number; external: number; ownRows: number; externalRows: number };
    byStage: Record<string, number>; byStatus: Record<string, number>; statusTotal: number;
  }>({ total: 0, pendingInvoices: 0, pendingBondReceived: 0, sumPurchaseValue: 0, byStage: {}, byStatus: {}, statusTotal: 0 });

  // كل ما يفهمه الخادم من فلترة في مكانٍ واحد: يقرؤه الجدولُ والإحصاءاتُ وقوائمُ
  // القيم والتصدير، فلا يفلتر أحدها على شرطٍ ويعرض الآخر نتيجة شرطٍ غيره.
  //
  // قيم كل عمود تُرسَل مكرَّرةً (`cf_x=a&cf_x=b`) لا مفصولةً بفاصلة، لأن القيم نفسها
  // تحمل فواصل — أسماء ملّاك وملاحظات فواتير — فالفصل بفاصلة يقطعها نصفين.
  const buildParams = useCallback(() => {
    const params = new URLSearchParams();
    if (stageFilter) params.append('stage', stageFilter);
    if (search) params.append('search', search);
    if (dateFrom) params.append('dateFrom', dateFrom);
    if (dateTo) params.append('dateTo', dateTo);
    if (showPendingOnly) params.append('pendingOnly', 'true');
    if (customsMode) params.append('customs', customsMode);
    for (const [field, vals] of Object.entries(colFilters)) {
      vals.forEach((v) => params.append(`cf_${field}`, v));
    }
    return params;
  }, [stageFilter, search, dateFrom, dateTo, showPendingOnly, customsMode, colFilters]);

  // ── ولا يكتب ردٌّ قديمٌ فوق ردٍّ أحدث ────────────────────────────────────
  //
  // البحثُ يغيّر `search` ويعيد `page` إلى الأولى، فينطلق طلبان: أحدهما بالبحث
  // الجديد ورقمِ الصفحة القديم — ويعود فارغًا لأنّ نتيجةً واحدةً لا صفحةَ ثالثةَ
  // لها. ومَن يصل أخيرًا هو الذي يُعرض. فيبحث المستخدم عن كشفٍ فلا يجده، ثمّ
  // يخرج من الصفحة ويعود (فتصير الصفحةُ الأولى) فيجده.
  //
  // ويزيد الأمرَ أنّ استطلاع منصّة التشغيل يعمل كلَّ ستّ ثوانٍ، فيطلق طلبَ
  // تحديثٍ ثالثًا يسابق الاثنين — وقد يحمل حالةً سابقةً للبحث فتُعرض القائمةُ
  // كلُّها فوق نتيجةٍ مفلترة.
  //
  // فيُرقَّم كلُّ طلب، ولا يُعرض إلّا ردُّ آخرِ رقمٍ أُطلق. وهو شرطٌ لا يستغني
  // عنه أيُّ جدولٍ يُفلتَر ويُحدَّث لحظيًّا في آن.
  const guard = useLatestRequest();
  const fetchWorkflows = useCallback(async (isBackground = false) => {
    const mySeq = guard.begin();
    try {
      if (!isBackground) {
        if (!initialLoadDone.current) setLoading(true);
        else setSearching(true);
      }
      const params = buildParams();
      params.append('page', String(page));
      params.append('limit', '50');
      const data = await api.get<any>(`/api/workflows?${params.toString()}`);
      if (!guard.isCurrent(mySeq)) return;   // سبقَه أحدثُ منه — يُهمَل
      setWorkflows(data.workflows || []);
      setTotal(data.total || 0);
    } catch (err: any) {
      console.error(err);
    } finally {
      // ── ورايةُ الانشغال تُطفأ دائمًا ────────────────────────────────────
      // كانت مربوطةً بحارس «الأحدث يفوز»، وهما أمران مختلفان: الحارسُ يقرّر
      // **بياناتِ مَن** تُعرض، والرايةُ تقول إنّ الطلبَ الذي أشعلها انتهى.
      //
      // و`workflow:updated` يُبَثّ إلى كلّ من يفتح الصفحة عند أيّ تعديل، فمع
      // فريقٍ يعمل عليها معًا لا يكاد طلبٌ ينتهي إلّا وقد سبقه أحدث — فلا
      // يتحقّق `isCurrent` أبدًا، وتبقى الرايةُ مشتعلةً إلى الأبد.
      if (!isBackground) setSearching(false);
      if (guard.isCurrent(mySeq)) setLoading(false);
      initialLoadDone.current = true;
    }
  }, [buildParams, page, guard]);

  // Initial load
  useEffect(() => { fetchWorkflows(); }, [fetchWorkflows]);

  // Fetch full-dataset aggregates (for the summary cards) whenever the server
  // filters change. Reflects all matching rows, not just the loaded page.
  // ── والبطاقاتُ تحتاج الحارسَ أكثرَ من الجدول ─────────────────────────────
  //
  // الجدولُ كان محروسًا (`guard` أعلاه) والبطاقاتُ بلا حارس. وهي أحقُّ به:
  // أثقلُ استعلامٍ في الشاشة هو **بلا فلتر** — جمعٌ على خمسةٍ وثلاثين ألف صفّ —
  // وهو الذي يُطلق عند أوّل فتحٍ للصفحة. فمن فتح الصفحةَ ثمّ فلتر بسرعة وصله
  // ردُّ المفلتَر أوّلًا (صفوفُه قليلة) ثمّ وصل ردُّ ما قبل الفلتر فكتب فوقه.
  //
  // فتقول البطاقةُ «مجموع قيمة الشراء (حسب الفلتر) = ٦١ مليونًا» وهو مجموعُ
  // الجدول كلِّه، والصحيحُ أربعةُ ملايين. ورقمٌ ماليٌّ مكتوبٌ عليه «حسب الفلتر»
  // وهو غيرُ مفلتَرٍ أسوأُ من غياب البطاقة: يُقرأ ويُبنى عليه.
  //
  // وحارسُه مستقلٌّ عن حارس الجدول: مشترَكٌ واحدٌ يُبطل كلُّ نداءٍ فيه نداءَ
  // الآخر، فيُسقِط أحدُهما ردَّ صاحبه.
  const statsGuard = useLatestRequest();
  const fetchStats = useCallback(async () => {
    const mine = statsGuard.begin();
    try {
      const data = await api.get<any>(`/api/workflows/stats?${buildParams().toString()}`);
      if (!statsGuard.isCurrent(mine)) return;   // سبقَه أحدثُ منه — يُهمَل
      setStats({
        total: data.total || 0,
        pendingInvoices: data.pendingInvoices || 0,
        pendingBondReceived: data.pendingBondReceived || 0,
        sumPurchaseValue: data.sumPurchaseValue || 0,
        purchaseSplit: data.purchaseSplit,
        byStage: data.byStage || {},
        byStatus: data.byStatus || {},
        statusTotal: data.statusTotal || 0,
      });
    } catch { /* non-critical */ }
  }, [buildParams, statsGuard]);
  useEffect(() => { fetchStats(); }, [fetchStats]);

  // قيم عمودٍ واحد عند فتح قائمته. الطلب يحمل الفلاتر النشطة كلَّها فيُرجع الخادم
  // القيم القابلة للوصول فعلًا — قائمةٌ تعرض قيمًا لا صفوف لها تدعو المستخدم إلى
  // اختيارٍ يُرجع جدولًا فارغًا.
  const fetchColOptions = useCallback(async (field: string, q = '') => {
    const seq = (optionsSeq.current[field] || 0) + 1;
    optionsSeq.current[field] = seq;
    setColLoading((prev) => ({ ...prev, [field]: true }));
    try {
      const params = buildParams();
      params.append('field', field);
      if (q) params.append('q', q);
      const data = await api.get<any>(`/api/workflows/filters?${params.toString()}`);
      if (optionsSeq.current[field] !== seq) return;
      const f = data?.filters?.[0];
      setColOptions((prev) => ({ ...prev, [field]: { values: f?.values || [], truncated: !!f?.truncated } }));
    } catch {
      if (optionsSeq.current[field] === seq) setColOptions((prev) => ({ ...prev, [field]: prev[field] || { values: [], truncated: false } }));
    } finally {
      if (optionsSeq.current[field] === seq) setColLoading((prev) => ({ ...prev, [field]: false }));
    }
  }, [buildParams]);

  // تغيُّرُ أي فلتر يُبطل القوائم المحفوظة؛ وقائمةُ العمود المفتوح تُعاد فورًا حتى
  // يرى المستخدم أثرَ اختياره في القيم المتاحة بدل أن يبقى ينظر إلى قائمةٍ قديمة.
  useEffect(() => {
    setColOptions((prev) => (openField && prev[openField] ? { [openField]: prev[openField] } : {}));
    if (openField) fetchColOptions(openField);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fetchColOptions, openField, openNonce]);

  // اختيارُ الصفوف يُلغى مع كل تغيّر في الفلاتر أو الصفحة: الصفوف المؤشَّرة لم تعد
  // معروضة، وحذفٌ جماعيّ يقع على صفوفٍ لا يراها المستخدم.
  useEffect(() => { setSelectedIds(new Set()); setAllMatching(false); }, [stageFilter, search, page, dateFrom, dateTo, showPendingOnly, customsMode, colFilters]);

  const setColFilter = (field: string, set: Set<string>) => {
    // الفلترة تُغيّر عدد الصفحات كلّه، والبقاءُ على الصفحة السابعة بعد فلترٍ نتيجته
    // صفحتان يُظهر جدولًا فارغًا يبدو معه أن الفلتر لم يجد شيئًا.
    setPage(1);
    setColFilters((prev) => {
      const next = { ...prev };
      if (set.size === 0) delete next[field]; else next[field] = set;
      return next;
    });
  };

  const clearColFilters = () => { setColFilters({}); setPage(1); };

  // WebSocket real-time
  // الصفُّ الجديد يُقحَم في أعلى القائمة — وهو صحيحٌ في العرض الكامل وحدَه.
  // في نتيجةٍ مفلترةٍ أو في صفحةٍ غير الأولى يكون كذبًا: صفٌّ لا يطابق الشرطَ
  // يظهر بين ما يطابقه. فيُترك للتحديث أن يأتي به إن كان يخصّ العرض.
  const handleCreated = useCallback((wf: Workflow) => {
    const filtered = !!search || !!dateFrom || !!dateTo || showPendingOnly || !!customsMode || Object.keys(colFilters).length > 0;
    setTotal((t) => t + 1);
    if (filtered || page !== 1) return;
    setWorkflows((p) => [wf, ...p]);
  }, [search, dateFrom, dateTo, showPendingOnly, customsMode, colFilters, page]);
  // ── صفٌّ كاملٌ يُستبدَل، وإشعارٌ مختصرٌ يُعيد التحميل ─────────────────────
  // بعضُ البثّ يحمل الصفَّ كلَّه (تعديلٌ من الشاشة)، وبعضُه إشعارٌ قصير:
  // `{ _id, fromWallet }` من المحفظة أو `{ bulk: true }` من التحصيل. كان القصيرُ
  // يُوضَع مكانَ الصفّ فيفرغ الصفُّ على الشاشة حتّى التحديث، و`bulk` لا يحدّث
  // شيئًا. فالقصيرُ يُعيد تحميلَ الصفحة في الخلفية — مجمَّعًا، فدفعةُ إشعاراتٍ = تحميلٌ واحد.
  const refetchSoon = useRef<ReturnType<typeof setTimeout> | null>(null);
  const handleUpdated = useCallback((wf: Workflow) => {
    if (wf && wf._id && (wf as any).reportNumber !== undefined) {
      setWorkflows((p) => p.map((w) => w._id === wf._id ? wf : w));
      return;
    }
    if (refetchSoon.current) clearTimeout(refetchSoon.current);
    refetchSoon.current = setTimeout(() => fetchWorkflows(true), 600);
  }, [fetchWorkflows]);
  const handleDeleted = useCallback((d: { _id: string }) => {
    setWorkflows((p) => p.filter((w) => w._id !== d._id));
    setTotal((t) => Math.max(0, t - 1));
    setSelectedIds((prev) => { const next = new Set(prev); next.delete(d._id); return next; });
  }, []);
  const handleLocked = useCallback((d: any) => { setWorkflows((p) => p.map((w) => w._id === d._id ? { ...w, lockedBy: d.lockedBy, lockedByName: d.lockedByName, lockedAt: d.lockedAt } : w)); }, []);
  const handleUnlocked = useCallback((d: { _id: string }) => { setWorkflows((p) => p.map((w) => w._id === d._id ? { ...w, lockedBy: null, lockedByName: '', lockedAt: null } : w)); }, []);
  const handleUnlockAll = useCallback((d: { userId: string }) => { setWorkflows((p) => p.map((w) => w.lockedBy && w.lockedBy._id === d.userId ? { ...w, lockedBy: null, lockedByName: '', lockedAt: null } : w)); }, []);
  const handleBulkImported = useCallback(() => { fetchWorkflows(true); }, [fetchWorkflows]);

  useSocket('workflow:created', handleCreated);
  useSocket('workflow:updated', handleUpdated);
  useSocket('workflow:deleted', handleDeleted);
  useSocket('workflow:locked', handleLocked);
  useSocket('workflow:unlocked', handleUnlocked);
  useSocket('workflow:unlockAll', handleUnlockAll);
  useSocket('workflow:stageChanged', handleUpdated);
  useSocket('workflow:bulkImported', handleBulkImported);

  const isLockedByOther = (wf: Workflow) => {
    if (!wf.lockedBy) return false;
    if (wf.lockedAt && Date.now() - new Date(wf.lockedAt).getTime() > 5 * 60 * 1000) return false;
    return wf.lockedBy._id !== user?._id;
  };

  const getTransitions = (wf: Workflow) => {
    const map: Record<string, { stage: string; label: string; roles: string[] }[]> = {
      draft: [{ stage: 'submitted_to_ops', label: T.submitToOps, roles: ['moderator', 'super_admin', ...FINANCE_FULL_ROLES] }],
      submitted_to_ops: [
        { stage: 'ops_completed', label: T.markOpsComplete, roles: ['operations_manager', 'super_admin', ...FINANCE_FULL_ROLES] },
        { stage: 'draft', label: T.returnToDraft, roles: ['operations_manager', 'super_admin', ...FINANCE_FULL_ROLES] },
      ],
      ops_completed: [
        { stage: 'submitted_to_collections', label: T.submitToCollections, roles: ['operations_manager', 'super_admin', ...FINANCE_FULL_ROLES] },
        { stage: 'submitted_to_ops', label: T.returnToOps, roles: ['operations_manager', 'super_admin', ...FINANCE_FULL_ROLES] },
      ],
      submitted_to_collections: [
        { stage: 'completed', label: T.markComplete, roles: ['admin', 'employee', 'super_admin', ...FINANCE_FULL_ROLES] },
        { stage: 'ops_completed', label: T.returnToOps, roles: ['admin', 'employee', 'super_admin', ...FINANCE_FULL_ROLES] },
      ],
      completed: [],
    };
    return (map[wf.stage] || []).filter((t) => t.roles.includes(role));
  };

  const handleTransition = async (wfId: string, stage: string) => {
    try {
      setTransitioningId(wfId);
      await api.put(`/api/workflows/${wfId}/stage`, { stage });
    } catch (err: any) {
      setError(err.message);
    } finally {
      setTransitioningId(null);
    }
  };

  const handleDelete = (wfId: string) => {
    setConfirmModal({
      message: T.deleteWorkflowConfirm,
      onConfirm: async () => {
        setConfirmModal(null);
        try { await api.delete(`/api/workflows/${wfId}`); } catch (err: any) { setError(err.message); }
      },
    });
  };

  /**
   * ── شروطُ الجدول كما يقرؤها الخادم ──────────────────────────────────────
   * البحثُ وفلاترُ الأعمدة وشريطُ الفلترة والمدى والبطاقات — كلُّها في
   * `buildParams`، وهي نفسُها التي جلبت الجدولَ والعدد. والقيمُ المكرَّرة
   * (`cf_x=a&cf_x=b`) مصفوفة.
   */
  const currentQuery = () => {
    const query: Record<string, string | string[]> = {};
    buildParams().forEach((v, k) => {
      const cur = query[k];
      query[k] = cur === undefined ? v : Array.isArray(cur) ? [...cur, v] : [cur, v];
    });
    return query;
  };
  // عددُ ما يقع عليه الإجراءُ الجماعيّ: المحدَّدُ في الصفحة، أو نتائجُ الفلتر كلُّها.
  const selectedCount = allMatching ? total : selectedIds.size;
  // ما يُرسَل مع كلّ إجراءٍ جماعيّ: المعرّفات، أو الشروطُ والعددُ الذي أكّده المستخدم
  // (الخادمُ يرفض إن صار الفلترُ يطابق أكثرَ منه — راجع idsForAllMatching).
  const selectionPayload = () => (allMatching
    ? { allMatching: true, query: currentQuery(), expectedCount: total }
    : { ids: Array.from(selectedIds) });

  const handleBulkDelete = () => {
    if (selectedCount === 0) return;
    const n = selectedCount;
    setConfirmModal({
      message: allMatching
        ? (lang === 'ar'
          ? `سيُحذف ${n.toLocaleString('en-US')} كشفًا — كلُّ نتائج الفلتر الحاليّ في كلّ الصفحات، لا الصفحةُ المعروضة وحدَها. لا يمكن التراجع. متابعة؟`
          : `This deletes ${n.toLocaleString('en-US')} reports — every result of the current filter across all pages. This cannot be undone. Continue?`)
        : T.deleteBulkConfirm.replace('{count}', String(n)),
      onConfirm: async () => {
        setConfirmModal(null);
        try {
          setBulkDeleting(true);
          await api.post('/api/workflows/bulk-delete', selectionPayload());
          setSelectedIds(new Set()); setAllMatching(false);
          fetchWorkflows(true); fetchStats();
        } catch (err: any) {
          setError(err.message);
        } finally {
          setBulkDeleting(false);
        }
      },
    });
  };

  const handleInlineSave = async () => {
    if (!editingId) return;
    // ── يُرسَل ما تغيّر لا الصفُّ كلُّه ──────────────────────────────────────
    // كانت الشاشة تبعث المستندَ بأكمله — بمعرّفه ومُنشئه وأقفاله وتواريخ
    // نظامه — فيُعاد كتابةُ ثلاثين حقلًا بقيمها نفسِها لتغيير حقلٍ واحد، ويُقرأ
    // نصفُها «خارج صلاحيّتك» بلا داعٍ. والمقارنةُ بالنسخة قبل التعديل تجعل
    // الطلبَ يحمل ما قصده المستخدم فقط.
    const patch: Record<string, any> = {};
    for (const k of Object.keys(editData)) {
      const a = (editData as any)[k]; const b = (editBase as any)[k];
      if (a !== b && typeof a !== 'object') patch[k] = a;
    }
    if (!Object.keys(patch).length) { handleInlineCancel(); return; }
    try {
      const savedId = editingId;
      const r = await api.put<Workflow & { refusedMessage?: string }>(`/api/workflows/${savedId}`, patch);
      // ما رفضه الخادمُ يُقال، ولا يُترك المستخدم يظنّ أنّه حُفظ.
      if (r && r.refusedMessage) setError(r.refusedMessage);
      // قيمةُ البيع: يُقال أين كُتبت — في المنصّة وهنا، أم هنا وحدَه (كشفٌ ليس منها).
      if (r && typeof (r as any).sellingPlatform === 'boolean') {
        notify((r as any).sellingPlatform
          ? (lang === 'ar' ? 'حُفظت قيمة البيع هنا وفي منصّة التشغيل' : 'Selling value saved here and on the platform')
          : (lang === 'ar' ? 'حُفظت قيمة البيع — الكشف ليس من منصّة التشغيل' : 'Selling value saved — not a platform shipment'), 'success');
      }
      setEditingId(null);
      setEditData({});
      setEditBase({});
      setFocusField(null);
      // ── والصفُّ يُكتب من ردِّ الحفظ، لا من طلبٍ جديد ────────────────────
      // كان الحفظُ يُتبَع بجلب الصفحة كلِّها. وردُّ الحفظ **هو** الصفُّ بعد
      // الحفظ — فيه ما كتبه المستخدمُ وما اشتقّه الخادمُ معه (تصفيرُ أعمدة
      // الفاتورة في النقديّ، ونوعُ الدفع من ملفّ العميل). فالجلبُ يطلب ما في
      // اليد، ويفتح معه سباقًا: ردٌّ أُطلق قبل الحفظ قد يصل بعده فيمسح
      // التعديلَ من الشاشة — فيبدو أنّه لم يُحفظ وقد حُفظ.
      if (r && r._id) setWorkflows((prev) => prev.map((w) => (w._id === savedId ? { ...w, ...r } : w)));
      fetchStats();
    } catch (err: any) { setError(err.message); }
  };

  const handleInlineCancel = () => {
    setEditingId(null);
    setEditData({});
    setEditBase({});
    setFocusField(null);
  };

  // Enter row-edit mode from a single cell click and remember which field to
  // focus. Skips locked rows.
  //
  // ── ومَدخلٌ واحدٌ إلى وضع التعديل ────────────────────────────────────────
  // كان زرُّ القلم يفتح الوضعَ بنفسِه: يضبط `editingId` و`editData` **وينسى**
  // `editBase`. فيقارن الحفظُ بنسخةٍ من صفٍّ سابقٍ أو بلا شيء، فيُرسل الصفَّ
  // كلَّه — ستّةً وخمسين حقلًا فيها ما لا يملكه الدور — فيردّ الخادمُ أكثرَها
  // ويظهر «رُفض» على تعديلٍ صحيح.
  //
  // فلا يُفتح الوضعُ إلّا من هنا: الثلاثةُ تُضبط معًا أو لا تُضبط.
  const beginEditField = (wf: Workflow, field: string | null) => {
    if (isLockedByOther(wf)) return;
    setEditingId(wf._id);
    setEditData({ ...wf });
    setEditBase({ ...wf });
    setFocusField(field);
  };

  // Accounting review is a one-click checklist toggle (تم / not) — no row edit.
  const toggleAccountingReview = async (wf: Workflow) => {
    const next = wf.accountingReview ? '' : 'تم';
    // Optimistic update so the tick feels instant.
    setWorkflows((p) => p.map((w) => w._id === wf._id ? { ...w, accountingReview: next } : w));
    try {
      await api.put(`/api/workflows/${wf._id}`, { accountingReview: next });
    } catch (err: any) {
      setError(err.message);
      fetchWorkflows(true);
    }
  };

  // Operations review is a one-click checklist toggle (تم / not) — no row edit.
  // ── حالةُ الطلب تُغيَّر من هنا، وتُكتب هناك ───────────────────────────────
  // العمودُ مرآةُ منصّة التشغيل: الكتابةُ تذهب إليها أوّلًا (الخادم يتكفّل)،
  // ثمّ يعود صفُّنا بما استقرّ هناك — فلا تتغيّر الخانةُ أمام العين ثمّ تعود
  // في أوّل مزامنة. ولذلك لا تفاؤلَ في العرض هنا: تُنتظَر المنصّة.
  const [statusSaving, setStatusSaving] = useState<string | null>(null);
  const changeApplicationStatus = async (wf: Workflow, status: string) => {
    if (!status || status === wf.applicationStatus) return;
    setStatusSaving(wf._id);
    try {
      const row = await api.patch<any>(`/api/workflows/${wf._id}/application-status`, { status });
      setWorkflows((p) => p.map((w) => w._id === wf._id
        ? { ...w, ...(row && row._id ? row : { applicationStatus: status }) } : w));
    } catch (err: any) {
      setError(err.message);
      fetchWorkflows(true);
    }
    setStatusSaving(null);
  };

  const toggleOperationsReview = async (wf: Workflow) => {
    const next = wf.operationsReview ? '' : 'تم';
    // Optimistic update so the tick feels instant.
    setWorkflows((p) => p.map((w) => w._id === wf._id ? { ...w, operationsReview: next } : w));
    try {
      await api.put(`/api/workflows/${wf._id}`, { operationsReview: next });
    } catch (err: any) {
      setError(err.message);
      fetchWorkflows(true);
    }
  };

  const handleBulkPay = async () => {
    // ما لم يُملأ لا يُرسَل: حقلٌ فارغٌ في الدفعة يعني «لا تلمس هذا العمود»،
    // لا «امسح ما فيه» — ومسحُ مئةِ صفٍّ بالخطأ أسوأ من عدم كتابتها.
    const fields: Record<string, any> = Object.fromEntries(
      Object.entries(bulkPay).filter(([, v]) => String(v || '').trim()));
    // ── و«إزالة العلامة» فراغٌ مقصود ────────────────────────────────────
    // القاعدةُ أعلاه تُسقط الفارغَ لأنّه يعني «لا تلمس هذا العمود». ورفعُ
    // علامة المراجعة فراغٌ **مطلوب**، فيُمرَّر صراحةً بقيمةٍ خاصّةٍ لا تلتبس
    // بالخانة التي لم تُملأ.
    if (bulkPay.operationsReview === 'clear') fields.operationsReview = '';
    if (!Object.keys(fields).length) return;
    const run = async () => {
      setBulkPaying(true); setBulkResult(null);
      try {
        const r = await api.post<{ message: string; skipped?: { reportNumber: string; reason: string }[]; skippedCount?: number }>(
          '/api/workflows/bulk-update', { ...selectionPayload(), fields });
        const skipped = r.skipped || [];
        setBulkResult({ message: r.message, skipped, more: Math.max(0, (r.skippedCount || skipped.length) - skipped.length) });
        if (!skipped.length) {
          setShowBulkPay(false); setSelectedIds(new Set()); setAllMatching(false);
          setBulkPay({ paymentDate: '', payingBranch: '', paymentType: '', finalReportDestination: '', documentNumber: '', sendingDate: '', branchDeliveryDate: '', deliveryDate: '', operationsReview: '' });
        }
        fetchWorkflows(true); fetchStats();
      } catch (err: any) {
        // تغيّر العددُ بين التأكيد والتنفيذ (409): يُقال الجديدُ ويُحدَّث، ولا يُكتب شيء.
        setBulkResult({ message: err.message, skipped: [] });
        fetchWorkflows(true); fetchStats();
      }
      setBulkPaying(false);
    };
    // ── «كلُّ نتائج الفلتر» تُؤكَّد بعددها ─────────────────────────────────
    // آلافُ الكشوف بضغطة: يُقال العددُ بالضبط وما يُكتب، قبل أن يُكتب.
    if (allMatching) {
      const names = Object.keys(fields).length;
      setConfirmModal({
        message: lang === 'ar'
          ? `سيُطبَّق التعديل (${names} ${names === 1 ? 'عمود' : 'أعمدة'}) على ${total.toLocaleString('en-US')} كشفًا — كلُّ نتائج الفلتر الحاليّ في كلّ الصفحات. متابعة؟`
          : `Apply this change (${names} field${names === 1 ? '' : 's'}) to ${total.toLocaleString('en-US')} reports — every result of the current filter. Continue?`,
        onConfirm: () => { setConfirmModal(null); run(); },
      });
      return;
    }
    run();
  };

  const toggleSelect = (id: string) => {
    // إلغاءُ صفٍّ من «كلّ النتائج» يعيد التحديدَ إلى ما في الصفحة: لا تُستثنى
    // صفوفٌ من شرطٍ لا يُرى إلّا خمسون منه.
    setAllMatching(false);
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const toggleSelectAll = () => {
    const visibleIds = workflows.map((w) => w._id);
    const allSelected = visibleIds.length > 0 && visibleIds.every((id) => selectedIds.has(id));
    if (allSelected) setAllMatching(false);
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (allSelected) visibleIds.forEach((id) => next.delete(id));
      else visibleIds.forEach((id) => next.add(id));
      return next;
    });
  };

  /**
   * التصدير يمرّ بعميل الـAPI لا بـ`window.open`.
   *
   * كان يفتح تبويبًا على مسارٍ نسبيّ، والخادم على نطاقٍ غير نطاق الواجهة وكوكيز
   * الجلسة مربوطةٌ بنطاقه وحده — فيصل الطلب إلى المستضيف بلا مصادقة ويردّ
   * «Authentication required» في صفحةٍ بيضاء بدل أن ينزّل ملفًّا.
   *
   * وثلاثة نطاقات لا واحد: الصفحة المعروضة، أو ما طابق الفلتر كلَّه مهما بلغ
   * عدده، أو الجدول كلّه. والفرق ليس ترفًا: تفلتر فيبقى مئتا صفٍّ وتعرض الشاشة
   * خمسين، فتصديرُ «المعروض» يعطيك خُمس ما طلبتَ وأنت تحسبه كلَّه.
   */
  /**
   * الصفّ كما يُقرأ لا كما يُخزَّن.
   *
   * الحالات تُحفَظ بمفاتيحها الخام (`bond_received`) وتُعرَض مترجمة. والملفّ
   * يذهب إلى مَن لا يفتح النظام — محاسبٍ أو مراجعٍ خارجيّ — فخروجُه بالمفاتيح
   * يجعله غير مقروء لمن كُتب له.
   */
  const exportRow = (w: Workflow) => ({
    ...w,
    reportDate: formatDate(w.reportDate),
    paymentDate: formatDate(w.paymentDate),
    dataOwnerShown: (w as any).dataOwnerShown || w.paymentDateByName || '',
    sendingDate: formatDate(w.sendingDate),
    branchDeliveryDate: formatDate(w.branchDeliveryDate),
    deliveryDate: formatDate(w.deliveryDate),
    invoiceDate: formatDate(w.invoiceDate),
    collectionDate: formatDate(w.collectionDate),
    customsRef: w.customsLink?.clearance ? w.customsLink.refNumber || '' : '',
    customsBl: w.customsLink?.clearance ? w.customsLink.blNumber || '' : '',
    executionStatus: trStatus(w.executionStatus),
    applicationStatus: trStatus(w.applicationStatus),
    paymentMethod: trPayment(w.paymentMethod),
    paymentType: paymentKindLabel(paymentKindOf(w), lang === 'ar'),
    operationsReview: w.operationsReview ? (lang === 'ar' ? 'تمّت' : 'Done') : '',
    accountingReview: w.accountingReview ? (lang === 'ar' ? 'تمّت' : 'Done') : '',
  });

  /** الصفحةُ المعروضةُ وحدَها — صفوفُها في اليد، فتُبنى هنا في لحظة. */
  const exportSheets = async (onlySelected = false) => [{
    name: lang === 'ar' ? 'الطلبات' : 'Workflows',
    rows: (onlySelected ? workflows.filter((w) => selectedIds.has(w._id)) : workflows).map(exportRow) as unknown as Record<string, any>[],
    columns: EXPORT_COLUMNS.filter((c) => (canViewFinancials || !MONEY_EXPORT_KEYS.has(c.key)) && (canSeeSelling || c.key !== 'sellingValue')),
  }];

  /**
   * ── والجدولُ الكبيرُ يُبنى في الخادم ──────────────────────────────────────
   * كان «الجدول كلّه» يطلب خمسةً وثلاثين ألفَ صفٍّ صفوفًا خامًا — سبعةً وثلاثين
   * ميغابايتًا من JSON — ثمّ يبني المصنَّفَ في الخيط الذي يرسم الصفحة، فتتجمّد
   * الشاشةُ حتى يفرغ. والقاعدةُ ليست البطيئة: الفرزُ على فهرسه اثنتان وأربعون
   * ميلي‌ثانية.
   *
   * فصار الخادمُ يبنيه ويردُّ ملفًّا مضغوطًا، ولا يعبر المتصفّحَ إلّا الملفُّ
   * نفسُه. والأعمدةُ والترجماتُ هناك هي هذه حرفًا بحرف، والحجبُ بالدور مطبَّقٌ
   * في الخادم أيضًا — فلا يخرج في الملفّ مالٌ لا يُعرض على الشاشة.
   */
  const downloadServerFile = async (scope: 'filtered' | 'all') => {
    const p = scope === 'all' ? new URLSearchParams() : buildParams();
    p.delete('page'); p.delete('limit');
    if (scope === 'all') p.set('scope', 'all');

    // ── «الجدولُ كلُّه» يُبنى في الخلفيّة ──────────────────────────────────
    // ستّةٌ وثلاثون ألفَ صفٍّ ونصفُ دقيقةِ بناء: لا يُنتظَر أمام شاشةٍ جامدة،
    // ولا يضيع العملُ إن أُغلقت الصفحة. يُسجَّل الطلبُ، ويُنزَّل حين يجهز،
    // ويصل إشعارٌ بالرابط على كلّ حال. راجع lib/backgroundExport.
    if (scope === 'all') {
      notify(lang === 'ar' ? 'جارٍ تجهيز الملف… سيُنزَّل تلقائياً، وسيصلك إشعار عند جهوزه.'
        : 'Preparing the file… it will download automatically, and you will get a notification.', 'info');
      await startBackgroundExport('workflows', Object.fromEntries(p.entries()), {
        onReady: (j: ExportJob) => notify(lang === 'ar' ? `جهز الملف — ${j.rows.toLocaleString('en-US')} صفًّا` : `Ready — ${j.rows.toLocaleString('en-US')} rows`, 'success'),
        onFailed: (msg: string) => notify(msg || (lang === 'ar' ? 'تعذّر التصدير' : 'Export failed'), 'error'),
      });
      return;
    }

    const blob = await api.getBlob(`/api/workflows/export?${p.toString()}`);
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `operations-${new Date().toISOString().slice(0, 10)}.xlsx`;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  };

  const formatDate = (d: string) => d ? new Date(d).toLocaleDateString('en-GB') : '-';
  const formatMoney = (v: number) => v ? v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '-';

  // كل أرقام البطاقات محسوبةٌ في الخادم على مجموعة الصفوف المطابقة كاملةً — لا على
  // الخمسين صفًّا المعروضة. حسابُها من الصفوف المحمَّلة كان يجعلها تقول «٥٠» مهما
  // كان في القاعدة، أو يُلزمنا بتنزيل الجدول كلّه لتصحّ.
  /**
   * ── بطاقاتُ حالة الأبلكيشن ───────────────────────────────────────────────
   *
   * كانت في صفحة شحنات المنصّة وحدَها، وهي السؤالُ الأوّل هنا أيضًا: كم في
   * الطريق؟ وكم وصلت ولم يصل سندُها؟ وكان مكانَها اختصارٌ إلى تلك الصفحة —
   * بطاقةٌ تُنقَل إليها بدل أن تُجيب.
   *
   * والعددُ من الخادم على مجموعة الصفوف كاملةً، ويُحسَب تحت بقيّة الفلاتر عدا
   * فلترِ الحالة نفسِه: من صفّى «في الطريق» يريد أن يرى بقيّةَ الحالات لينتقل
   * إليها لا أصفارًا — وهذا ما يفعله إكسل.
   */
  const statusSel = colFilters.applicationStatus || EMPTY_SET;
  /**
   * ── والبطاقاتُ قائمةُ اختيارٍ لا زرُّ راديو ────────────────────────────────
   * كانت الضغطةُ تكتب `new Set([key])` — أي تمسح ما قبلها وتضع واحدةً. فمن
   * أراد «في الطريق» و«وصلت» معًا لم يكن له سبيل، وهو أوّلُ ما يُسأل عنه:
   * «أرني ما هو خارجٌ الآن». والبنيةُ مجموعةٌ أصلًا؛ المنطقُ وحدَه كان مفردًا.
   *
   * فصارت تُضيف وتحذف: ضغطةٌ تُدخل الحالةَ، وأخرى تُخرجها، وإفراغُ المجموعة
   * يعني «الكلّ» — ولا يُترك فلترٌ بمجموعةٍ فارغةٍ تُقرأ «لا شيء».
   * و«الكلّ» تمسحها جميعًا.
   */
  const toggleStatusCard = (key: string) => {
    setColFilters((prev) => {
      const next = { ...prev };
      if (!key) { delete next.applicationStatus; return next; }
      const cur = new Set(next.applicationStatus || []);
      if (cur.has(key)) cur.delete(key); else cur.add(key);
      if (cur.size === 0) delete next.applicationStatus;
      else next.applicationStatus = cur;
      return next;
    });
    setPage(1);
  };

  const pendingCount = stats.pendingInvoices;
  const filteredRowsCount = stats.total || total;
  const filteredPurchaseSum = stats.sumPurchaseValue;

  // عرضُ القيمة يُترجَم والفلترةُ تجري على القيمة الخام: القاعدة تخزّن `bond_received`
  // والمستخدم يقرأ «استُلم السند»، فلو فلترنا على النصّ المعروض لتغيّرت نتيجةُ الفلتر
  // بتغيّر لغة الواجهة.
  const colFormat = (field: string): ((v: any) => string) | undefined => {
    if (field === 'stage') return (v: any) => stageLabels[v] || v;
    if (field === 'executionStatus' || field === 'applicationStatus') return trStatus;
    if (field === 'paymentMethod') return trPayment;
    // المخزَّنُ مفتاحٌ والمعروضُ اسمُه — الستُّ كلُّها (الأنواعُ الأربعة، و«ضريبي»/«كاش»
    // لما بقي بلا نوع). والقائمةُ تقول ما تقوله الخانة.
    if (field === 'paymentType') return (v: any) => paymentKindLabel(v, lang === 'ar') || String(v || '');
    // الخادم يجمّع التواريخ بيوم الرياض ويردّها «YYYY-MM-DD». إعادةُ تفسيرها
    // بمنطقة المتصفح تُنقص يومًا لمن يفتح الصفحة غربَ غرينتش، فتُعرض كما هي.
    if (DATE_FIELDS.has(field)) return (v: any) => {
      const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(v || ''));
      return m ? `${m[3]}/${m[2]}/${m[1]}` : formatDate(String(v || ''));
    };
    // القيم تصل من الخادم نصوصًا؛ وتنسيقُ المال يحتاج رقمًا وإلا عُرض الرقم خامًّا
    // بلا فواصل ولا كسور فبدا مختلفًا عن الرقم نفسه في الجدول.
    if (NUM_FIELDS.has(field)) return (v: any) => formatMoney(Number(v));
    return undefined;
  };

  const ColHead = (field: keyof Workflow, label: string, color = 'text-slate-300') => (
    <th className="px-3 py-3 text-start text-xs font-semibold whitespace-nowrap">
      <span className={`inline-flex items-center ${color}`}>
        {label}
        <ColumnFilter
          field={field as string}
          selected={colFilters[field as string] || EMPTY_SET}
          onChange={(s) => setColFilter(field as string, s)}
          onOpen={() => { setOpenField(field as string); setOpenNonce((n) => n + 1); }}
          options={colOptions[field as string]?.values || EMPTY_OPTIONS}
          truncated={!!colOptions[field as string]?.truncated}
          loading={!!colLoading[field as string]}
          onQuery={(q) => fetchColOptions(field as string, q)}
          lang={lang}
          format={colFormat(field as string)}
        />
      </span>
    </th>
  );

  /**
   * ── «تحديد كلّ النتائج» — النمطُ المعروف ─────────────────────────────────
   * مربّعُ الرأس يحدّد الصفحةَ المعروضة (خمسين). فإن كانت نتائجُ الفلتر أكثرَ
   * قيل ذلك تحت البحث وعُرض تحديدُها كلِّها؛ ومتى حُدِّدت صار كلُّ إجراءٍ
   * جماعيٍّ (السدادُ والتعديلُ والحذفُ وتصديرُ المحدَّد) على الشرط في الخادم.
   * (عنصرٌ لا مكوّنٌ معرَّفٌ داخل الرسم — راجع inline-components-remount.)
   */
  const pageAllSelected = workflows.length > 0 && workflows.every((w) => selectedIds.has(w._id));
  const selectionBanner = (pageAllSelected || allMatching) && total > workflows.length ? (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-xl border border-slate-200 bg-slate-50 px-4 py-2 text-sm text-slate-700">
      {allMatching ? (
        <span>
          {lang === 'ar'
            ? <>تم تحديد كلّ الـ <b className="tabular-nums text-slate-900">{total.toLocaleString('en-US')}</b> نتيجة للفلتر الحاليّ — في كلّ الصفحات.</>
            : <>All <b className="tabular-nums text-slate-900">{total.toLocaleString('en-US')}</b> results of the current filter are selected — across all pages.</>}
        </span>
      ) : (
        <>
          <span>
            {lang === 'ar'
              ? <>تم تحديد <b className="tabular-nums text-slate-900">{selectedIds.size.toLocaleString('en-US')}</b> صفًّا في هذه الصفحة.</>
              : <><b className="tabular-nums text-slate-900">{selectedIds.size.toLocaleString('en-US')}</b> rows on this page are selected.</>}
          </span>
          <button type="button" onClick={() => setAllMatching(true)} className="font-semibold text-slate-900 underline underline-offset-4 hover:text-[#f37121]">
            {lang === 'ar' ? `تحديد كلّ الـ ${total.toLocaleString('en-US')} نتيجة؟` : `Select all ${total.toLocaleString('en-US')} results?`}
          </button>
        </>
      )}
      <button type="button" onClick={() => { setSelectedIds(new Set()); setAllMatching(false); }} className="ms-auto text-slate-500 hover:text-slate-900">
        {lang === 'ar' ? 'إلغاء التحديد' : 'Clear selection'}
      </button>
    </div>
  ) : null;

  if (loading && workflows.length === 0) {
    return <div className="flex items-center justify-center h-64"><div className="w-8 h-8 border-2 border-[#f37121] border-t-transparent rounded-full animate-spin" /></div>;
  }

  return (
    <div className="space-y-4">

      {/* ── بطاقاتُ الحالات الإحدى عشرة أُزيلت (صاحبُ الشركة، ٢٠٢٦/١٠/٢١) ──────
          «الكل · قيد الطلب · … · ملغاة» صارت قيمًا في شريط الفلترة تحت البحث
          («حالة الطلب»)، بعددها بجانب كلٍّ منها — والسطرُ الواحد يتّسع للعميل
          والفرع والمسار ونوع الدفع معها بدل أحد عشر مربّعًا لعمودٍ واحد. */}

      {/* Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
        <h1 className="text-2xl font-bold text-slate-900 flex items-center gap-2">
          <ClipboardList className="w-6 h-6 text-[#f37121]" />
          {T.title}
        </h1>
        <div className="flex items-center gap-2 flex-wrap">
          {canDelete && selectedCount > 0 && (
            <button type="button" onClick={handleBulkDelete} disabled={bulkDeleting} className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-red-600 hover:bg-red-700 text-white text-sm font-medium transition-colors disabled:opacity-50">
              {bulkDeleting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />} {T.deleteCount} ({selectedCount.toLocaleString('en-US')})
            </button>
          )}
          {/* ── تسجيلُ سدادٍ لدفعةٍ واحدة ────────────────────────────────────
              يظهر حين يكون هناك ما هو محدَّد، ولا يُرسل إلّا ما مُلئ: الخانةُ
              الفارغة تعني «لا تلمس هذا العمود» لا «امسحه». والخادمُ يفحص كلَّ
              صفٍّ على حدة — ما لم يُستلم سندُه لا يُسجَّل سدادُه، ويُقال باسمه. */}
          {selectedCount > 0 && (
            <div className="relative">
              <button type="button" onClick={() => { setShowBulkPay((p) => !p); setBulkResult(null); }}
                className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-purple-600 hover:bg-purple-700 text-white text-sm font-medium transition-colors">
                <CheckSquare className="w-4 h-4" /> {lang === 'ar' ? 'تسجيل سداد' : 'Record payment'} ({selectedCount.toLocaleString('en-US')})
              </button>
              {showBulkPay && (
                <div className="absolute top-full mt-2 end-0 bg-white border border-slate-200 rounded-xl shadow-xl z-50 p-4 w-[340px] max-w-[calc(100vw-2rem)] overflow-visible" onClick={(e) => e.stopPropagation()}>
                  {/* على المحدَّد في هذه الصفحة، أم على كلّ نتائج الفلتر في كلّ الصفحات. */}
                  <p className="text-sm font-bold text-slate-900 mb-1.5">{lang === 'ar' ? 'يُطبَّق على' : 'Apply to'}</p>
                  <div className="mb-2 flex overflow-hidden rounded-lg border border-slate-200 text-[12px] font-semibold">
                    <button type="button" onClick={() => setAllMatching(false)}
                      className={`flex-1 px-2 py-1.5 ${!allMatching ? 'bg-purple-600 text-white' : 'bg-white text-slate-600 hover:bg-slate-50'}`}>
                      {lang === 'ar' ? `المحدَّد (${selectedIds.size})` : `Selected (${selectedIds.size})`}
                    </button>
                    <button type="button" onClick={() => setAllMatching(true)} disabled={total <= selectedIds.size}
                      className={`flex-1 px-2 py-1.5 disabled:opacity-40 ${allMatching ? 'bg-purple-600 text-white' : 'bg-white text-slate-600 hover:bg-slate-50'}`}>
                      {lang === 'ar' ? `كل نتائج الفلتر (${total})` : `All filter results (${total})`}
                    </button>
                  </div>
                  <p className="text-[11px] text-slate-500 mb-3">
                    {lang === 'ar' ? 'غيِّر ما تريد فقط — ما تتركه فارغًا لا يُغيَّر.' : 'Change only what you need — blank fields are left unchanged.'}
                  </p>
                  <div className="space-y-2.5">
                    <div>
                      <label className="block text-xs font-semibold text-slate-600 mb-1">{lang === 'ar' ? 'تاريخ السداد' : 'Payment date'}</label>
                      <DateField ar={lang === 'ar'} label={lang === 'ar' ? 'تاريخ السداد' : 'Payment date'}
                        value={bulkPay.paymentDate} onChange={(v) => setBulkPay((p) => ({ ...p, paymentDate: v }))} />
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-slate-600 mb-1">{lang === 'ar' ? 'الفرع المسدِّد' : 'Paying branch'}</label>
                      <ManagedSelect type="workflow_paying_branch" storeLabel noAdd value={bulkPay.payingBranch}
                        onChange={(v) => setBulkPay((p) => ({ ...p, payingBranch: v }))}
                        placeholder={lang === 'ar' ? 'اختر الفرع' : 'Pick branch'} />
                    </div>
                    {/* نوعُ الدفع — يُختار لكشوفٍ بعينها (اختيارُ يدٍ يثبت ولا يعيد الاشتقاقُ كتابتَه). */}
                    <div>
                      <label className="block text-xs font-semibold text-slate-600 mb-1">{lang === 'ar' ? 'نوع الدفع' : 'Payment type'}</label>
                      <select value={bulkPay.paymentType} onChange={(e) => setBulkPay((p) => ({ ...p, paymentType: e.target.value }))}
                        title={lang === 'ar' ? 'نوع الدفع' : 'Payment type'}
                        className="w-full px-2 py-2 rounded-lg border border-slate-300 text-sm bg-white">
                        <option value="">{lang === 'ar' ? '— لا يُغيَّر —' : '— leave unchanged —'}</option>
                        {/* الأربعةُ وحدَها — «ضريبي»/«كاش» لا يُختاران بعد اليوم (راجع lib/paymentKind). */}
                        {PAYMENT_CHOICES.map((k) => <option key={k} value={k}>{paymentKindLabel(k, lang === 'ar')}</option>)}
                      </select>
                    </div>
                    {/* ── ووجهةُ الكشف النهائيّة مع الفرع المسدِّد ─────────
                        سؤالان متجاوران يُجابان في الجلسة الواحدة: مَن سدّد،
                        وأين يستقرّ الملفُّ بعدها. وكان الثاني يُكتب صفًّا صفًّا
                        بعد أن يُكتب الأوّلُ للخمسين دفعةً. */}
                    <div>
                      <label className="block text-xs font-semibold text-slate-600 mb-1">{lang === 'ar' ? 'وجهة الكشف النهائية' : 'Final destination'}</label>
                      <ManagedSelect type="workflow_final_destination" storeLabel noAdd value={bulkPay.finalReportDestination}
                        onChange={(v) => setBulkPay((p) => ({ ...p, finalReportDestination: v }))}
                        placeholder={lang === 'ar' ? 'اختر الوجهة' : 'Pick destination'} />
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-slate-600 mb-1">{lang === 'ar' ? 'رقم السند' : 'Voucher no.'}</label>
                      <input value={bulkPay.documentNumber} onChange={(e) => setBulkPay((p) => ({ ...p, documentNumber: e.target.value }))}
                        placeholder={lang === 'ar' ? 'اختياري' : 'Optional'}
                        className="w-full px-2.5 py-2 rounded-lg bg-white border border-slate-200 text-slate-900 text-[13px] focus:outline-none focus:ring-2 focus:ring-[#f37121]/40" />
                    </div>
                    {/* ── والتاريخان تحت بعضهما لا جنبَ بعضهما ────────────────
                        كانا في عمودين داخل بطاقةٍ عرضُها ٣٢٠ بكسل، وخانةُ
                        التاريخ لا تنضغط أكثرَ من حدٍّ — فيخرج «التسليم» من
                        حافّة البطاقة. البطاقةُ أوسعُ قليلًا والتاريخان في سطرين،
                        فلا يخرج شيءٌ مهما ضاقت الشاشة. */}
                    <div>
                      <label className="block text-xs font-semibold text-slate-600 mb-1">{lang === 'ar' ? 'تاريخ الإرسال' : 'Sending date'}</label>
                      <DateField ar={lang === 'ar'} label={lang === 'ar' ? 'تاريخ الإرسال' : 'Sending date'}
                        value={bulkPay.sendingDate} onChange={(v) => setBulkPay((p) => ({ ...p, sendingDate: v }))} />
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-slate-600 mb-1">{lang === 'ar' ? 'تاريخ التسليم للفرع' : 'Delivered to branch'}</label>
                      <DateField ar={lang === 'ar'} label={lang === 'ar' ? 'تاريخ التسليم للفرع' : 'Delivered to branch'}
                        value={bulkPay.branchDeliveryDate} onChange={(v) => setBulkPay((p) => ({ ...p, branchDeliveryDate: v }))} />
                    </div>
                    {/* ── ومراجعةُ التشغيل علامةٌ لا نصّ ──────────────────────
                        الصفُّ الواحد يضعها بضغطةٍ تكتب «تم» أو تمسحها، والتصديرُ
                        يقرؤها نعمًا أو لا. وكان زرُّ الدفعة صندوقَ نصٍّ حرًّا
                        يكتب في العمود ما شاء — «راجعه أحمد» تُقرأ «تمّت» في
                        الملفّ وفي الجدول. فصارت قائمةً بخيارين كالصفّ الواحد.
                        و«إزالة العلامة» ليست فراغًا مُهمَلًا — راجع handleBulkPay. */}
                    {canEditOperationsReview && (
                      <div>
                        <label className="block text-xs font-semibold text-slate-600 mb-1">{T.thOpsReview}</label>
                        <select value={bulkPay.operationsReview}
                          onChange={(e) => setBulkPay((p) => ({ ...p, operationsReview: e.target.value }))}
                          title={T.thOpsReview}
                          className="w-full px-2 py-2 rounded-lg border border-slate-300 text-sm bg-white">
                          <option value="">{lang === 'ar' ? '— لا تُغيَّر —' : '— leave unchanged —'}</option>
                          <option value="تم">{lang === 'ar' ? 'تمّت المراجعة' : 'Reviewed'}</option>
                          <option value="clear">{lang === 'ar' ? 'إزالة العلامة' : 'Clear the mark'}</option>
                        </select>
                      </div>
                    )}
                    {/* ── وتسليمُ العميل لا يُملأ جماعةً من هنا ────────────────
                        منه تبدأ مهلةُ السداد لكلّ عميلٍ بمدّته، فهو واقعةٌ
                        تُسجَّل لفاتورةٍ بعينها يوم تصل صاحبَها — يكتبها قسمُ
                        التحصيل من زرّ «تسليم» في صفحة الفواتير. وكتابتُه على
                        خمسين كشفًا بتاريخٍ واحد تجعل خمسين مهلةً تبدأ في يومٍ
                        لم يستلم فيه أحد. */}
                  </div>
                  {bulkResult && (
                    <div className="mt-3 p-2 rounded-lg bg-slate-50 border border-slate-200 max-h-40 overflow-auto">
                      <p className="text-xs font-semibold text-slate-800">{bulkResult.message}</p>
                      {!!bulkResult.more && (
                        <p className="text-[11px] text-slate-500">{lang === 'ar' ? `و${bulkResult.more.toLocaleString('en-US')} أخرى لم تُحفظ` : `and ${bulkResult.more.toLocaleString('en-US')} more not saved`}</p>
                      )}
                      {bulkResult.skipped.map((sk) => (
                        <p key={sk.reportNumber} className="text-[11px] text-amber-700 mt-0.5">{sk.reportNumber} — {sk.reason}</p>
                      ))}
                    </div>
                  )}
                  <div className="flex items-center gap-2 mt-3">
                    <button type="button" onClick={handleBulkPay} disabled={bulkPaying}
                      className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg bg-purple-600 hover:bg-purple-700 text-white text-xs font-bold transition-colors disabled:opacity-50">
                      {bulkPaying ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : null}
                      {lang === 'ar' ? 'حفظ' : 'Save'}
                    </button>
                    <button type="button" onClick={() => { setShowBulkPay(false); setBulkResult(null); }}
                      className="px-3 py-2 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs transition-colors">
                      {lang === 'ar' ? 'إغلاق' : 'Close'}
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}
          {/* رفعُ بيانات الفواتير من ورقة المبيعات — لمن يملك أعمدةَ الفاتورة. */}
          {canViewFinancials && <InvoiceImportButton ar={lang === 'ar'} onDone={() => fetchWorkflows(true)} />}
          {/* ── التصدير: الزرّ الموحَّد لا زرٌّ تكتبه هذه الصفحة بيدها ───────
              كانت هذه الشاشة وحدها ترسم قائمتها الخاصّة، فبدت شريطَ نصٍّ بجانب
              أزرار بقيّة النظام. والزرّ الموحَّد يحمل الأيقونة والسهم والحالة
              نفسها في تسعين شاشة — واختلافُ شاشةٍ واحدة يجعل المستخدم يبحث عن
              التصدير فيها كأنّها نظامٌ آخر.
              وثلاثة نطاقات لا واحد، وعددُ كلٍّ بجانبه: تفلتر فيبقى مئتا صفّ
              وتعرض الشاشة خمسين، فتصديرُ «المعروض» يعطيك خُمس ما طلبتَ. */}
          <ExportMenu
            fileName="operations"
            lang={lang === 'ar' ? 'ar' : 'en'}
            variant="subtle"
            label={T.exportExcel}
            options={[
              ...(selectedCount > 0 ? [allMatching
                ? { key: 'selected', label: lang === 'ar' ? `المحدَّد — كلّ نتائج الفلتر (${total})` : `Selected — all filter results (${total})`, download: () => downloadServerFile('filtered') }
                : { key: 'selected', label: lang === 'ar' ? `المحدَّد (${selectedIds.size})` : `Selected (${selectedIds.size})`, resolve: () => exportSheets(true) }] : []),
              { key: 'page', label: lang === 'ar' ? `الصفحة المعروضة (${workflows.length})` : `Current page (${workflows.length})`, resolve: () => exportSheets() },
              { key: 'filtered', label: lang === 'ar' ? `كلّ ما طابق الفلتر (${total})` : `Everything matching the filter (${total})`, download: () => downloadServerFile('filtered') },
              { key: 'all', label: lang === 'ar' ? 'الجدول كلّه (بلا فلتر)' : 'The whole table (no filter)', download: () => downloadServerFile('all') },
            ]} />
          {canCreate && (
            <>
              <button type="button" onClick={() => router.push('/system/operations/new')} className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-[#f37121] hover:bg-[#e06010] text-white text-sm font-medium transition-colors">
                <Plus className="w-4 h-4" /> {T.newRequest}
              </button>
            </>
          )}
        </div>
      </div>

      {error && (
        <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-3 text-red-600 text-sm flex items-center justify-between">
          <span>{error}</span>
          <button type="button" onClick={() => setError('')}><X className="w-4 h-4" /></button>
        </div>
      )}

      {/* ── البطاقاتُ هادئة ─────────────────────────────────────────────────
          كانت كلُّ بطاقةٍ بلونها (كهرمانيٌّ ووردٌ وأزرقُ وأخضر) فتتنافس على
          العين ولا يُعرف أيُّها الإنذار — «لسنا في مدينة ملاهٍ» (صاحبُ الشركة).
          فصارت كبطاقات شجرة المديونيّة: بيضاءُ وأرقامٌ بلون الحبر ونقطةٌ صغيرةٌ
          للنوع، والأحمرُ للتناقض وحدَه. والمُفعَّلةُ يُحيطها إطارٌ داكن.
          (وبطاقتا «سندات لم تصل — كاش/ضريبي» أُزيلتا: الإجماليُّ يكفي، والقسمةُ
          على النوع في شريط الفلترة بعمود «نوع الدفع».) */}
      {/* ── والبطاقاتُ فوق الفلاتر، في شبكةٍ متساوية ─────────────────────────
          (صاحبُ الشركة، ٢٠٢٦/١٠/٢٢): الأرقامُ أوّلًا ثمّ أدواتُ الفلترة والبحث.
          وكانت صفًّا يلتفّ بعرض كلّ بطاقة فيخرج متفاوتًا؛ فصارت شبكةً: عمودٌ على
          الشاشة الضيّقة جدًّا، واثنان على الهاتف، وأربعةٌ على الشاشة الواسعة. */}
      <div className="grid grid-cols-1 min-[420px]:grid-cols-2 lg:grid-cols-4 gap-3">
        {/* Pending Invoices — over ALL matching rows (click to filter) */}
        <button
          type="button"
          onClick={() => { setShowPendingOnly(!showPendingOnly); setPage(1); }}
          className={`${CARD} ${showPendingOnly && !(statusSel.has('bond_received') && statusSel.size === 1) ? CARD_ON : ''}`}
        >
          {/* ── الرقمُ يقول قاعدتَه ──────────────────────────────────────────
              «سندات لم تصل» وحدَها لا تكفي لمطابقة الرقم بشيتٍ خارجيّ: هل
              الملغاةُ داخلةٌ فيه؟ تُكتب القاعدةُ تحت الرقم فيُراجَع بلا سؤال. */}
          <AlertCircle className="h-4 w-4 shrink-0 text-slate-400" />
          <div className="flex flex-col items-start">
            <span className={CARD_NUM}>{pendingCount.toLocaleString('en-US')}</span>
            <span className={CARD_LABEL}><span className="inline-block h-1.5 w-1.5 rounded-full bg-amber-500" />{lang === 'ar' ? 'سندات لم تصل' : 'Pending Bonds'}</span>
            <span className={CARD_SUB}>
              {lang === 'ar' ? 'بلا تاريخ سداد · عدا الملغاة' : 'no payment date · excludes cancelled'}
            </span>
          </div>
        </button>

        {/* ── والرابعةُ: السندُ «وصل» ولا تاريخَ لسداده ───────────────────────
            تقاطعُ «بلا تاريخ سداد» و«استُلم السند» هو موضعُ العمل: إمّا تاريخٌ
            ناقصٌ يُكتب أو حالةٌ تُصحَّح. وهي التناقضُ الوحيد هنا — فلها الأحمر. */}
        <button
          type="button"
          onClick={() => {
            const on = showPendingOnly && statusSel.has('bond_received') && statusSel.size === 1;
            setShowPendingOnly(!on);
            toggleStatusCard(on ? '' : 'bond_received');
            if (!on) setTimeout(() => tableRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 60);
          }}
          title={lang === 'ar'
            ? 'صفّي على: سندات لم تصل + حالة الطلب «استُلم السند»'
            : 'Filter: pending bonds whose status says the bond was received'}
          className={`${CARD} ${showPendingOnly && statusSel.has('bond_received') && statusSel.size === 1 ? CARD_ON : ''}`}
        >
          <AlertTriangle className={`h-4 w-4 shrink-0 ${stats.pendingBondReceived ? 'text-red-500' : 'text-slate-400'}`} />
          <div className="flex flex-col items-start">
            <span className={`${CARD_NUM} ${stats.pendingBondReceived ? '!text-red-600' : ''}`}>{stats.pendingBondReceived.toLocaleString('en-US')}</span>
            <span className={CARD_LABEL}>
              <span className={`inline-block h-1.5 w-1.5 rounded-full ${stats.pendingBondReceived ? 'bg-red-500' : 'bg-slate-300'}`} />
              {lang === 'ar' ? 'سند لم يصل وحالته «استُلم السند»' : 'Pending bond, status says received'}
            </span>
            <span className={CARD_SUB}>
              {lang === 'ar' ? 'تناقض: تاريخُ السداد ناقص أو الحالة خطأ' : 'mismatch: missing payment date or wrong status'}
            </span>
          </div>
        </button>

        {/* ── وعددُ الناتج بابٌ لا خبرٌ ── الضغطةُ تنزل إلى الجدول حيث هي. */}
        <button
          type="button"
          onClick={() => tableRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })}
          title={lang === 'ar' ? 'اعرض هذه الصفوف في الجدول' : 'Show these rows in the table'}
          className={CARD}
        >
          <ClipboardList className="h-4 w-4 shrink-0 text-slate-400" />
          <div className="flex flex-col items-start">
            <span className={CARD_NUM}>{filteredRowsCount.toLocaleString('en-US')}</span>
            <span className={CARD_LABEL}><span className="inline-block h-1.5 w-1.5 rounded-full bg-slate-400" />{lang === 'ar' ? 'عدد الصفوف (حسب الفلتر)' : 'Rows (filtered)'}</span>
            {(statusSel.size > 0 || showPendingOnly) && (
              <span className={CARD_SUB}>
                {[
                  statusSel.size ? trStatus([...statusSel][0]) : '',
                  showPendingOnly ? (lang === 'ar' ? 'سندات لم تصل' : 'pending bonds') : '',
                ].filter(Boolean).join(' · ')}
              </span>
            )}
          </div>
        </button>

        {/* ── مجموعُ قيمة الشراء — لمن يملك الحقلَ نفسَه (`purchaseValue`). */}
        {(full || has('purchaseValue')) && (
          /* ── المجموعُ فوق، وتحته نصفان: سيّاراتُ تنشيط · سيّاراتٌ خارجيّة (٢٠٢٦/١٠/٢٢).
              سيّارةُ الشركة: مالكُها «تنشيط» أو لوحتُها من شاحنات لوكيشن سوليوشن — راجع
              purchaseSplit في getWorkflowStats. */
          <div className={`${CARD} cursor-default hover:bg-white !items-stretch flex-col !gap-2`}>
            <div className="flex items-center gap-3">
              <FileSpreadsheet className="h-4 w-4 shrink-0 text-slate-400" />
              <div className="flex flex-col items-start">
                <span className={CARD_NUM}>{filteredPurchaseSum.toLocaleString('en-US', { maximumFractionDigits: 2 })}</span>
                <span className={CARD_LABEL}><span className="inline-block h-1.5 w-1.5 rounded-full bg-slate-400" />{lang === 'ar' ? 'مجموع قيمة الشراء (حسب الفلتر)' : 'Total purchase value (filtered)'}</span>
              </div>
            </div>
            <div className="grid grid-cols-2 divide-x divide-slate-100 rtl:divide-x-reverse border-t border-slate-100 pt-2 text-start">
              {([['own', 'سيّارات تنشيط', 'Tanshit cars', 'bg-[#f37121]'], ['external', 'سيّارات خارجية', 'External cars', 'bg-slate-500']] as const).map(([k, ar, en, dot]) => (
                <div key={k} className="min-w-0 px-2 first:ps-0 last:pe-0">
                  <p className="truncate text-[14px] font-bold tabular-nums text-slate-900">{(stats.purchaseSplit?.[k] || 0).toLocaleString('en-US', { maximumFractionDigits: 0 })}</p>
                  <p className="flex items-center gap-1 truncate text-[11px] text-slate-500"><span className={`inline-block h-1.5 w-1.5 rounded-full ${dot}`} />{lang === 'ar' ? ar : en}</p>
                  <p className="text-[10.5px] tabular-nums text-slate-400">{(stats.purchaseSplit?.[k === 'own' ? 'ownRows' : 'externalRows'] || 0).toLocaleString('en-US')} {lang === 'ar' ? 'رحلة' : 'trips'}</p>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* بطاقاتُ فحص الفواتير الأربع — لمن يملك أعمدةَ الفاتورة. راجع InvoiceCheckCards. */}
        {canViewFinancials && <InvoiceCheckCards ar={lang === 'ar'} />}

        {/* Clear all column filters */}
        {hasColFilters && (
          <button
            type="button"
            onClick={clearColFilters}
            title={lang === 'ar' ? 'مسح كل الفلاتر' : 'Clear all filters'}
            className="flex w-full h-full items-center justify-center gap-2 px-4 py-3.5 rounded-2xl border border-slate-200 bg-white text-slate-600 hover:text-slate-900 hover:bg-slate-50 transition-colors"
          >
            <FilterX className="w-5 h-5" />
            <span className="text-sm font-medium">{lang === 'ar' ? 'مسح الفلاتر' : 'Clear filters'}</span>
          </button>
        )}
      </div>

      {/* Filters */}
      <div className="flex flex-col gap-3">
        <WorkflowFilterBar
          ar={lang === 'ar'}
          fields={BAR_FIELDS.filter((f) => !f.money || canViewFinancials)}
          value={colFilters}
          onChange={setColFilter}
          params={buildParams}
          format={(f) => (f === 'invoiceState'
            ? (v: any) => ({ has: lang === 'ar' ? 'عليه رقم فاتورة' : 'Has a number', none: lang === 'ar' ? 'فارغ' : 'Blank', placeholder: lang === 'ar' ? 'بديل (no inv / بدون)' : 'Placeholder (no inv)' } as Record<string, string>)[String(v)] || String(v)
            : colFormat(f))}
        />
        {/* ── مِصفاةُ المراحل أُزيلت ────────────────────────────────────────
            «مسودة / مرسل للتشغيل / التشغيل مكتمل / للتحصيلات / مكتمل» مراحلُ
            صُمّمت حين كانت الكشوفُ تُنشأ عندنا وتتنقّل بين أقسامنا. وهي تصل
            الآن من منصّة التشغيل وقد جرت هناك، فيبقى الجميعُ في «مسودة» أبدًا:
            خمسةُ أزرارٍ أربعةٌ منها فارغةٌ دائمًا. والحالةُ الحقيقيّةُ عمودٌ في
            الجدول له مِصفاتُه. */}
      </div>

      {/* ── البحثُ فوق الجدول مباشرةً ──────────────────────────────────────────
          كان في أعلى الصفحة فوق البطاقات والشريط، فيكتب المستخدمُ ثمّ ينزل ليرى
          أثرَه. وهو سؤالٌ عن صفوف الجدول — فمكانُه حيث تتغيّر. */}
      <div className="flex flex-col gap-2">
        {/* ── البحثُ والتخليصُ والمدى في صفٍّ واحد (صاحبُ الشركة، ٢٠٢٦/١٠/٢٢) ─────
            كان كلٌّ منها صفًّا وحدَه فطالت الصفحةُ قبل الجدول؛ فصارت صفًّا يلتفّ
            على الشاشة الضيّقة. */}
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative min-w-[220px] flex-1 basis-[260px] max-w-xl">
            {/* ── والمكبّرُ لا يُبدَّل بدوّارة ──────────────────────────────
                كانت الأيقونةُ تصير دوّارةً عند كلّ تحديث، فترفرف الخانةُ وتفقد
                علامتَها. وهي تكذب فوق ذلك: `searching` ترتفع مع تغيير الصفحة
                والفلتر والمدى، فيُقال «البحثُ يعمل» لمن يقلّب الصفحات.
                التحديثُ يُقال فوق الجدول — حيث يتغيّر ما يتغيّر. */}
            <Search className="absolute start-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
            <input
              ref={searchInputRef}
              type="text"
              value={searchInput}
              onChange={(e) => {
                const val = e.target.value;
                setSearchInput(val);
                if (debounceRef.current) clearTimeout(debounceRef.current);
                debounceRef.current = setTimeout(() => { setSearch(val); setPage(1); }, 300);
              }}
              placeholder={T.searchPlaceholder}
              className="w-full ps-10 pe-8 py-2.5 rounded-lg bg-white border border-slate-200 text-slate-900 text-sm placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-[#f37121]/50"
            />
            {searchInput && (
              <button type="button" title={T.clearSearch} onClick={() => { setSearchInput(''); setSearch(''); setPage(1); searchInputRef.current?.focus(); }} className="absolute end-3 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-900">
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
          {/* ── التخليص بكلمة: الكلّ · المرتبطة · غيرُ المرتبطة ─────────────────
              وفلترُ العمود «التخليص» يختار معاملةً بعينها. */}
          <div className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white p-0.5 text-xs">
            <span className="px-2 text-slate-500">{lang === 'ar' ? 'التخليص' : 'Customs'}</span>
            {([['', lang === 'ar' ? 'الكلّ' : 'All'], ['linked', lang === 'ar' ? 'مرتبطة' : 'Linked'], ['unlinked', lang === 'ar' ? 'غير مرتبطة' : 'Not linked']] as const).map(([k, label]) => (
              <button key={k || 'all'} type="button" onClick={() => { setCustomsMode(k); setPage(1); }}
                className={`rounded-md px-2.5 py-1 ${customsMode === k ? 'bg-slate-900 text-white' : 'text-slate-600 hover:bg-slate-100'}`}>
                {label}
              </button>
            ))}
            {customsMode && !['linked', 'unlinked'].includes(customsMode) && (
              <button type="button" onClick={() => { setCustomsMode(''); setPage(1); }}
                className="inline-flex items-center gap-1 rounded-md bg-sky-50 px-2.5 py-1 text-sky-800 hover:bg-sky-100"
                title={lang === 'ar' ? 'إزالة' : 'Clear'}>
                {lang === 'ar' ? 'كشوف معاملةٍ محدّدة' : 'One clearance'} <X className="w-3 h-3" />
              </button>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {/* المدى الزمنيّ: يُفتح تقويمُه بالضغط، و«إلى» الفارغة تعني «حتى اليوم». */}
            {/* الوضعُ ثمّ منتقيه — والمُختارُ يُترجَم إلى مدًى يفهمه الخادم. */}
            <div className="flex items-center rounded-lg border border-slate-200 overflow-hidden shrink-0">
              {([['day', 'يوم', 'Day'], ['month', 'شهر', 'Month'], ['range', 'مدى', 'Range']] as const).map(([k, arL, enL]) => (
                <button key={k} type="button" onClick={() => switchMode(k)}
                  className={`px-3 py-2 text-sm font-medium transition-colors ${
                    dateMode === k ? 'bg-[#f37121] text-white' : 'bg-white text-slate-500 hover:text-slate-900'}`}>
                  {lang === 'ar' ? arL : enL}
                </button>
              ))}
            </div>
            {dateMode === 'day' && (
              /* الحقلُ المشترك: أيقونةٌ ظاهرةٌ تُضغَط، وتقويمٌ يُفتَح من أيّ موضع،
                 ونصٌّ واحدٌ «dd/mm/yyyy» عند كلّ الناس — وكان حقلًا خامًا تُقرأ
                 صيغتُه من جهاز المستخدم ولا يفتح تقويمَه إلّا بإصابة الأيقونة. */
              <DateField value={dayKey} onChange={applyDay} ar={lang === 'ar'}
                label={lang === 'ar' ? 'اختر اليوم' : 'Pick day'} />
            )}
            {dateMode === 'month' && (
              <MonthPicker value={monthKey} onChange={applyMonth} ar={lang === 'ar'} />
            )}
            {dateMode === 'range' && (
              <DateRangeFilter ar={lang === 'ar'} from={dateFrom} to={dateTo}
                onFrom={(v) => { setDateFrom(v); setPage(1); }}
                onTo={(v) => { setDateTo(v); setPage(1); }} />
            )}
          </div>
        </div>
        {selectionBanner}
      </div>

      {/* Table */}
      <div className="relative bg-white border border-slate-200 rounded-xl overflow-hidden shadow-sm">
        {/* شريطُ التحديث: يجري على حافّة الجدول ولا يُفرغ ما تحته. */}
        {searching && <div className="refresh-bar" aria-hidden="true" />}
        {/* ── والعملُ لا يُمنع في أثناء التحديث ──────────────────────────────
            كُتب هنا أوّلًا `pointer-events-none` مع تعتيمٍ إلى النصف، ليُمنع
            فتحُ صفٍّ يوشك أن يُستبدَل. فعلقت الرايةُ مشتعلةً (انظر أعلاه)
            وأُقفل الجدولُ في وجه القسم كلِّه.
            
            والدرسُ أكبرُ من العطل: مؤشّرُ حالةٍ لا يجوز أن يسحب القدرةَ على
            العمل. أسوأُ ما يقع حين يُضغط صفٌّ أثناء التحديث أن يُعاد رسمُه —
            وذلك أهونُ ألفَ مرّةٍ من شاشةٍ لا تستجيب. فالشريطُ وحدَه يقول
            «جارٍ»، والجدولُ يبقى حيًّا. */}
        <ScrollX aria-busy={searching}>
          <div ref={tableRef} className="scroll-mt-4" />
          <table className="w-full min-w-[3200px]">
            <thead>
              <tr className="bg-slate-900 border-b border-slate-200">
                <th className="px-3 py-3 sticky start-0 bg-slate-900 z-10 w-20">
                  <div className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      title={T.selectAll}
                      checked={pageAllSelected}
                      onChange={toggleSelectAll}
                      className="w-4 h-4 appearance-none rounded border border-slate-300 bg-transparent checked:bg-[#f37121] checked:border-[#f37121] cursor-pointer relative checked:after:content-['✓'] checked:after:text-white checked:after:text-[10px] checked:after:absolute checked:after:inset-0 checked:after:flex checked:after:items-center checked:after:justify-center"
                    />
                    <span className="text-xs text-slate-300 font-semibold">{T.actions}</span>
                  </div>
                </th>
                {/* Application Details */}
                {ColHead('reportNumber', T.thReportNumber)}
                {ColHead('reportDate', T.thReportDate)}
                {ColHead('fromLocation', T.thFrom)}
                {ColHead('toLocation', T.thTo)}
                {ColHead('branch', T.thBranch)}
                {ColHead('carOwner', T.thCarOwner)}
                {ColHead('carNumber', T.thCarNumber)}
                {/* «نوع الملكية» و«حالة التنفيذ» و«طريقة الدفع» و«ض / غ ض» أُزيلت (صاحبُ الشركة، ٢٠٢٦/١٠/٢٢):
                    تصل من المنصّة ولا يُعمَل بها هنا — بدائلُها «نوع الدفع» و«حالة الطلب». */}
                {ColHead('applicationStatus', T.thApplication)}
                {ColHead('username', T.thUsername)}
                {ColHead('userPhone', T.thUserPhone)}
                {ColHead('purchaseValue', T.thPurchaseValue)}
                {canSeeSelling && ColHead('sellingValue', T.thSellingValue)}
                {ColHead('driverName', T.thDriverName)}
                {ColHead('truckType', T.thTruckType)}
                {ColHead('truckSize', T.thTruckSize)}
                {ColHead('representativeName', T.thRepresentative)}
                {/* Operations Review */}
                {ColHead('operationsReview', T.thOpsReview, 'text-yellow-400')}
                {/* Manual Moderator */}
                {ColHead('paymentDate', T.thPaymentDate, 'text-purple-300')}
                {/* ── ومَن كتب التاريخ ─────────────────────────────────────
                    «مسؤول البيانات»: آخرُ مَن سجّل تاريخ السداد أو عدّله. يُسأل
                    عن صفٍّ فيُعرف صاحبُه بلا فتح سجلّ التعديلات — وهو غيرُ مَن
                    سجّل المشتريات في العهدة اليوميّة. يُكتب في الخادم ولا يُعدَّل
                    بيدٍ هنا (راجع paymentDateBy). */}
                {ColHead('dataOwnerShown', lang === 'ar' ? 'مسؤول البيانات' : 'Data owner', 'text-purple-300')}
                {/* الفلترُ على المعروض لا على `paymentDateByName` وحدَه: الخانةُ
                    تُملأ من الاسم ثمّ مسجّلِ المحفظة ثمّ مصدرِ الاستيراد، وكانت
                    القائمةُ على الحقل الخام «(فارغ)» لثمانيةٍ وثلاثين ألفًا مكتوبٌ
                    فيها اسم. راجع backend/src/utils/dataOwnerIndex. */}
                {ColHead('payingBranch', T.thPayingBranch, 'text-purple-300')}
                {/* ما دُفع للمورّد، وبأيّ صفةٍ يُفوتَر العميل. والنوعُ هو ما
                    يقرّر شكلَ بقيّة الصفّ: نقديٌّ لا يُفوتَر، وضريبيٌّ يُفوتَر. */}
                {ColHead('paymentAmount', T.thPaymentAmount, 'text-purple-300')}
                {ColHead('paymentType', T.thPaymentType, 'text-purple-300')}
                {/* وجهةُ الكشف النهائيّة — الفرعُ الذي يستقرّ عنده الملفّ في
                    آخره. سؤالٌ غيرُ «مَن سدّد»: قد يُسدَّد في فرعٍ ويستقرّ في غيره. */}
                {ColHead('finalReportDestination', lang === 'ar' ? 'وجهة الكشف النهائية' : 'Final destination', 'text-purple-300')}
                {ColHead('documentNumber', T.thDocNumber, 'text-purple-300')}
                {/* معاملةُ التخليص التي يخدمها الكشف — رقمُها · البوليصة · الحاويات. */}
                {ColHead('customsRef', lang === 'ar' ? 'التخليص' : 'Customs', 'text-sky-300')}
                {ColHead('sendingDate', T.thSendingDate, 'text-purple-300')}
                {/* ── تسليمان لا تسليمٌ واحد ────────────────────────────────
                    هذا تسليمُ الكشف إلى الفرع — عملُ التشغيل، ويأتي من شيت
                    المتابعة. وتسليمُ الفاتورة إلى العميل عمودٌ آخرُ عند أعمدة
                    التحصيل، ومنه وحدَه تبدأ مهلةُ السداد المتّفق عليها. */}
                {ColHead('branchDeliveryDate', T.thBranchDeliveryDate, 'text-purple-300')}
                {/* مراجعةُ الحسابات إقرارُ المحاسبة، فمكانُها مع أعمدة المال لا مع
                    تسجيل السداد — ومَن لا يراها لا تصله من الخادم أصلًا. */}
                {canViewFinancials && ColHead('accountingReview', T.thAccountingReview, 'text-purple-300')}
                {/* Collections — financial columns, finance/owner roles only */}
                {canViewFinancials && ColHead('invoiceNumber', T.thInvoiceNumber, 'text-green-400')}
                {canViewFinancials && ColHead('netInvoice', T.thNetInvoice, 'text-green-400')}
                {canViewFinancials && ColHead('tax', T.thTax, 'text-green-400')}
                {canViewFinancials && ColHead('totalInvoice', T.thTotalInvoice, 'text-green-400')}
                {canViewFinancials && ColHead('invoiceDate', T.thInvoiceDate, 'text-green-400')}
                {/* ── وتاريخُ التسليم قبل تاريخ التحصيل ──────────────────────
                    كان بين تواريخ الإرسال، وهو آخرُ ما يُنتظر قبل التحصيل —
                    وصفحةُ الفواتير الضريبيّة تقرؤه بجانبه. فالعينُ تجدهما معًا. */}
                {ColHead('deliveryDate', T.thDeliveryDate, 'text-green-400')}
                {canViewFinancials && ColHead('collectedAmount', T.thCollectedAmount, 'text-green-400')}
                {canViewFinancials && ColHead('collectionDate', T.thCollectionDate, 'text-green-400')}
                {/* ── عمودان حُذفا: «المرحلة» و«قفل» ──────────────────────────
                    «المرحلة» حالةٌ يحسبها النظامُ من الصفّ نفسِه (أيَّ خاناتٍ
                    مُلئت) — تُقرأ في سير العمل فلا تُقرّر شيئًا: مَن يعمل هنا
                    يتابع «حالة الطلب» و«تاريخ السداد»، لا مرحلةً مشتقّة.
                    و«قفل» أيقونةٌ تقول إن كان الصفُّ مفتوحًا عند زميلٍ الآن؛
                    والقفلُ نفسُه لم يُلغَ — هو يمنع التحريرَ المتزامن ويُقال
                    لمن يحاول حينها — لكنّ عمودًا كاملًا في جدولٍ بأربعين
                    عمودًا ليُقال «لا أحدَ يحرّره» ثمنٌ لا مقابلَ له. */}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200">
              {workflows.length === 0 ? (
                <tr><td colSpan={40} className="px-4 py-12 text-center text-slate-800 text-sm">{showPendingOnly ? (lang === 'ar' ? 'لا توجد فواتير معلقة' : 'No pending invoices') : (hasColFilters ? (lang === 'ar' ? 'لا نتائج للفلتر المحدد' : 'No rows match the filters') : T.noWorkflows)}</td></tr>
              ) : workflows.map((wf) => {
                const locked = isLockedByOther(wf);
                const transitions = getTransitions(wf);
                const sc = STAGE_CONFIG[wf.stage] || STAGE_CONFIG.draft;
                const isSelected = selectedIds.has(wf._id);
                return (
                  <tr key={wf._id} className={`hover:bg-slate-100 transition-colors ${editingId === wf._id ? '' : 'cursor-pointer'} ${locked ? 'opacity-60' : ''} ${isSelected ? 'bg-[#f37121]/5' : ''} ${editingId === wf._id ? 'ring-1 ring-[#f37121]/40' : ''}`}
                    onClick={() => { if (editingId !== wf._id) router.push(`/system/operations/${wf._id}`); }}>
                    {/* Checkbox + Actions */}
                    <td className="px-3 py-2.5 sticky start-0 bg-white z-10" onClick={(e) => e.stopPropagation()}>
                      <div className="flex items-center gap-1.5">
                        <input
                          type="checkbox"
                          title={T.selectRow}
                          checked={isSelected}
                          onChange={() => toggleSelect(wf._id)}
                          className="w-4 h-4 appearance-none rounded border border-slate-300 bg-transparent checked:bg-[#f37121] checked:border-[#f37121] cursor-pointer relative checked:after:content-['✓'] checked:after:text-white checked:after:text-[10px] checked:after:absolute checked:after:inset-0 checked:after:flex checked:after:items-center checked:after:justify-center"
                        />
                        {editingId === wf._id ? (
                          <>
                            <button type="button" onClick={handleInlineSave} className="p-1 text-green-600 hover:text-green-700 rounded" title={lang === 'ar' ? 'حفظ' : 'Save'}>
                              <Check className="w-3.5 h-3.5" />
                            </button>
                            <button type="button" onClick={handleInlineCancel} className="p-1 text-red-600 hover:text-red-700 rounded" title={lang === 'ar' ? 'إلغاء' : 'Cancel'}>
                              <X className="w-3.5 h-3.5" />
                            </button>
                          </>
                        ) : (
                          <>
                            {!locked && (
                              <button type="button" onClick={() => beginEditField(wf, null)} className="p-1 text-slate-700 hover:text-[#f37121] rounded" title={T.edit}>
                                <Edit className="w-3.5 h-3.5" />
                              </button>
                            )}
                            {canDelete && (
                              <button type="button" onClick={() => handleDelete(wf._id)} className="p-1 text-slate-700 hover:text-red-600 rounded" title={T.delete}>
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            )}
                            {/* سهمُ نقل المرحلة أُزيل مع مراحل العمل: الكشوفُ
                                تصل من منصّة التشغيل جاريةً، فلا تُنقَل بيننا
                                بين مراحلَ نصنعها نحن. */}
                          </>
                        )}
                      </div>
                    </td>
                    {(() => {
                      const isEditing = editingId === wf._id;
                      const ic = "w-full px-1.5 py-1 rounded bg-slate-50 border border-slate-300 text-slate-900 text-xs focus:ring-1 focus:ring-[#f37121] focus:outline-none";
                      // Click-to-edit: a single click on a manual (non-system) cell
                      // enters edit mode for the row and focuses that field. System
                      // cells keep the row's navigate-on-click behaviour.
                      const editableClass = 'cursor-text hover:bg-amber-50 rounded px-1 -mx-1';
                      // ── ولا تُعرَض خانةٌ لن تُحفَظ ──────────────────────────
                      // كان الحقلُ يُفتح للكتابة ثمّ يردّه الخادمُ ٤٠٣ لأنّ الدورَ
                      // لا يملكه — فيكتب المستخدمُ ويضغط «صح» فلا يُحفظ شيء.
                      // وقعت مع موظّف العمليات ثمّ مع المحاسب: قائمةُ الحقول
                      // تُكتب دورًا دورًا فيُنسى فيها ما يعمله صاحبُها كلَّ يوم.
                      //
                      // فالشاشةُ تقرأ الخريطةَ نفسَها التي يفلتر بها الخادمُ
                      // (`myFields`): ما لا يملكه الدورُ لا يُفتح أصلًا، ويُقال
                      // سببُه عند المرور عليه. ولا تُصلَح القائمةُ مرّةً بعد
                      // مرّة — يُقفل البابُ الذي منه تدخل الغلطة.
                      const owns = (field: keyof Workflow) =>
                        myFields === null || full || myFields.has(field as string);
                      const noPermMsg = lang === 'ar'
                        ? 'صلاحيّتك لا تسمح بتعديل هذا العمود'
                        : 'Your role cannot edit this column';
                      const cellClick = (field: keyof Workflow) => {
                        if (isEditing) return (e: any) => e.stopPropagation();
                        if (!SYSTEM_FIELDS.has(field as string) && !locked && owns(field)) {
                          return (e: any) => { e.stopPropagation(); beginEditField(wf, field as string); };
                        }
                        return undefined;
                      };
                      const spanCls = (field: keyof Workflow, color: string) =>
                        `${color} ${!isEditing && !SYSTEM_FIELDS.has(field as string) && !locked && owns(field) ? editableClass : ''}`;
                      // حقول كشف التخريج المسحوبة من النظام الخارجي غير قابلة للتعديل
                      const systemPulledFields = new Set(['fromLocation', 'toLocation', 'purchaseValue', 'branch', 'carOwner', 'carNumber', 'ownerType']);
                      const textCell = (field: keyof Workflow, color = 'text-slate-700') => {
                        const isSystemPulled = (systemPulledFields.has(field as string) && wf.reportNumber) || !owns(field);
                        return (
                          <td className="px-3 py-2.5 text-sm whitespace-nowrap" onClick={isSystemPulled ? (e) => e.stopPropagation() : cellClick(field)}
                            title={!owns(field) ? noPermMsg : isSystemPulled ? 'البيانات المسحوبة من النظام لا تُعدّل' : undefined}>
                            {isEditing && !isSystemPulled ? <input type="text" autoFocus={focusField === field} title={field} className={ic} value={(editData as any)[field] || ''} onChange={(e) => setEditData(prev => ({...prev, [field]: e.target.value}))} /> : <span className={`${spanCls(field, color)}${isSystemPulled && wf.reportNumber ? ' opacity-60' : ''}`}>{(wf as any)[field] || '-'}</span>}
                          </td>
                        );
                      };
                      // Like textCell but translates the value for display (edits the raw value).
                      const transCell = (field: keyof Workflow, tr: (v: string) => string, color = 'text-slate-700') => {
                        const isSystemPulled = systemPulledFields.has(field as string) && wf.reportNumber;
                        return (
                          <td className="px-3 py-2.5 text-sm whitespace-nowrap" onClick={isSystemPulled ? (e) => e.stopPropagation() : cellClick(field)}
                            title={isSystemPulled ? 'البيانات المسحوبة من النظام لا تُعدّل' : undefined}>
                            {isEditing && !isSystemPulled ? <input type="text" autoFocus={focusField === field} title={field} className={ic} value={(editData as any)[field] || ''} onChange={(e) => setEditData(prev => ({...prev, [field]: e.target.value}))} /> : <span className={`${spanCls(field, color)}${isSystemPulled && wf.reportNumber ? ' opacity-60' : ''}`}>{(wf as any)[field] ? tr((wf as any)[field]) : '-'}</span>}
                          </td>
                        );
                      };
                      // ── وحالةُ الطلب قائمةٌ لا خانةَ كتابة ──────────────────
                      // هي حالةُ الشحنة في منصّة التشغيل، وقيمُها معروفةٌ
                      // محصورة. وكتابتُها نصًّا كانت تعني شيئين كلاهما خطأ:
                      // قيمةٌ لا تعرفها المنصّة، أو تعديلٌ يُمسح في أوّل
                      // مزامنة. فتُختار من قائمةٍ، وتُكتب في المنصّة نفسِها
                      // (راجع changeApplicationStatus) فتراها الشاشتان معًا.
                      const statusCell = () => {
                        const fromPlatform = (wf as any).externalSource === 'ops_upl';
                        const canSet = owns('applicationStatus') && fromPlatform && !locked;
                        const busy = statusSaving === wf._id;
                        const st = SHIPMENT_STATUSES.find((s) => s.key === wf.applicationStatus);
                        return (
                          <td className="px-3 py-2.5 text-sm whitespace-nowrap" onClick={(e) => e.stopPropagation()}
                            title={!owns('applicationStatus') ? noPermMsg
                              : !fromPlatform ? (lang === 'ar' ? 'كشفٌ ليس من منصّة التشغيل' : 'Not a platform shipment')
                                : (lang === 'ar' ? 'يُكتب في منصّة التشغيل مباشرة' : 'Writes straight to the operations platform')}>
                            {canSet ? (
                              <select
                                aria-label={T.thApplication}
                                disabled={busy}
                                value={wf.applicationStatus || ''}
                                onChange={(e) => changeApplicationStatus(wf, e.target.value)}
                                className={`rounded-lg border px-2 py-1 text-xs font-semibold outline-none focus:ring-2 focus:ring-[#f37121]/40 disabled:opacity-50 ${st ? `${st.bg} ${st.text} border-transparent` : 'bg-white text-slate-700 border-slate-300'}`}
                              >
                                {!wf.applicationStatus && <option value="">-</option>}
                                {SHIPMENT_STATUSES.map((s) => (
                                  <option key={s.key} value={s.key}>{lang === 'ar' ? s.ar : s.en}</option>
                                ))}
                              </select>
                            ) : (
                              <span className="text-slate-700">{wf.applicationStatus ? trStatus(wf.applicationStatus) : '-'}</span>
                            )}
                          </td>
                        );
                      };
                      // ── الفرعُ المسدِّد يُختار ولا يُكتب ───────────────────
                      // كان حقلًا حرًّا، فدخلت فيه «جد» و«جدهخ» بجانب «جده»:
                      // فرعٌ واحدٌ في ثلاثة صفوفٍ في كلّ تقرير. والقائمةُ تُدار
                      // من القوائم المرجعيّة، فتُضاف قيمةٌ جديدةٌ حين تلزم بلا
                      // أن يُفتح فيها بابُ الكتابة الحرّة ثانيةً.
                      const lookupCell = (field: keyof Workflow, type: string, color = 'text-slate-700') => (
                        <td className="px-3 py-2.5 text-sm whitespace-nowrap min-w-[140px]" onClick={cellClick(field)}
                          title={!owns(field) ? noPermMsg : undefined}>
                          {isEditing && owns(field) ? (
                            <ManagedSelect type={type} storeLabel noAdd className={ic}
                              value={(editData as any)[field] || ''}
                              onChange={(v) => setEditData((prev) => ({ ...prev, [field]: v }))}
                              placeholder={lang === 'ar' ? 'اختر الفرع' : 'Pick branch'} />
                          ) : <span className={spanCls(field, color)}>{(wf as any)[field] || '-'}</span>}
                        </td>
                      );
                      const numCell = (field: keyof Workflow, color = 'text-slate-700') => {
                        // مبلغُ السداد لكشفٍ دفعته المحفظة هو ما كتبه موظّفُ العهدة — يُعدَّل
                        // من قيد المحفظة لا من هنا (والخادمُ يفرض ذلك أيضًا).
                        const fromWallet = field === 'paymentAmount' && !!(wf as any).paidFromWallet;
                        // ── الضريبةُ وإجماليُّها يُحسبان من الصافي ─────────────────────
                        // الضريبةُ لا تُكتب أبدًا (صافٍ × ١٥٪)، والإجماليُّ لا يُكتب في الكشف
                        // الضريبيّ (صافٍ + ضريبة). وفي الكاش يُكتب الإجماليُّ (صاحبُ الشركة،
                        // ٢٠٢٦/١٠/٢٠). والخادمُ يشتقّهما كذلك — راجع applyBillingRules.
                        // العائلةُ لا النوع: «نقدي - 3PL» كاشٌ في هذه القاعدة.
                        const rowType = paymentFamily(paymentKindOf(isEditing ? (editData as any) : wf));
                        const derivedTax = field === 'tax' || (field === 'totalInvoice' && rowType !== 'cash');
                        const isSystemPulled = (systemPulledFields.has(field as string) && wf.reportNumber) || !owns(field) || fromWallet || derivedTax;
                        if (derivedTax && isEditing && rowType !== 'cash') {
                          const net = Number((editData as any).netInvoice ?? wf.netInvoice) || 0;
                          const vat = Math.round(net * 0.15 * 100) / 100;
                          const val = field === 'tax' ? vat : Math.round((net + vat) * 100) / 100;
                          return (
                            <td className="px-3 py-2.5 text-sm whitespace-nowrap" onClick={(e) => e.stopPropagation()}
                              title={lang === 'ar' ? 'تُحسب من صافي الفاتورة — لا تُكتب' : 'Computed from the net — not typed'}>
                              <span className={spanCls(field, color)}>{formatMoney(val)}</span>
                            </td>
                          );
                        }
                        return (
                          <td className="px-3 py-2.5 text-sm whitespace-nowrap" onClick={isSystemPulled ? (e) => e.stopPropagation() : cellClick(field)}
                            title={!owns(field) ? noPermMsg : fromWallet ? 'من المحفظة — يُعدَّل من قيد المشتريات في المحفظة' : derivedTax ? (lang === 'ar' ? 'تُحسب من صافي الفاتورة — لا تُكتب' : 'Computed from the net — not typed') : isSystemPulled ? 'البيانات المسحوبة من النظام لا تُعدّل' : field === 'sellingValue' ? (lang === 'ar' ? 'تُكتب هنا وفي منصّة التشغيل معًا' : 'Saved here and on the operations platform') : undefined}>
                            {isEditing && !isSystemPulled ? <input type="number" autoFocus={focusField === field} title={field} className={ic} value={(editData as any)[field] || ''} onChange={(e) => setEditData(prev => ({...prev, [field]: e.target.value ? Number(e.target.value) : ''}))} /> : <span className={`${spanCls(field, color)}${isSystemPulled && wf.reportNumber && !fromWallet && !derivedTax ? ' opacity-60' : ''}`}>{formatMoney((wf as any)[field])}{fromWallet && <span className="ms-1 text-[10px] font-semibold text-emerald-600">{lang === 'ar' ? 'محفظة' : 'wallet'}</span>}</span>}
                          </td>
                        );
                      };
                      // ── تاريخ السداد لا يُكتب قبل استلام السند ────────────────
                      // السداد يعني أن المال وصل، ولا يصل قبل استلام سند التسليم.
                      // كتابته قبله تجعل التقارير المالية تعدّ مبلغًا لم يُقبَض —
                      // فالحقل مقفل، ومكتوبٌ سببُ قفله لا مجرّد أنه مقفل.
                      const bondReceived = String(wf.applicationStatus || '').trim() === 'bond_received';
                      const dateCell = (field: keyof Workflow, color = 'text-slate-700') => {
                        const gated = (field === 'paymentDate' && !bondReceived) || !owns(field);
                        return (
                          <td className="px-3 py-2.5 text-sm whitespace-nowrap"
                            onClick={gated ? (e) => { e.stopPropagation(); if (owns(field)) notifyGate(); } : cellClick(field)}
                            title={!owns(field) ? noPermMsg : gated ? gateMsg : undefined}>
                            {isEditing && !gated
                              ? <input type="date" autoFocus={focusField === field} title={field} className={ic} value={(editData as any)[field] ? (editData as any)[field].slice(0, 10) : ''} onChange={(e) => setEditData(prev => ({...prev, [field]: e.target.value}))} />
                              : <span className={`${spanCls(field, color)}${gated ? ' opacity-60 cursor-not-allowed' : ''}`}>
                                  {formatDate((wf as any)[field]) || (gated ? '—' : '')}
                                </span>}
                          </td>
                        );
                      };
                      // ── نوعُ الدفع: كاشٌ أم ضريبيّ — يُكتب بيد ────────────
                      // هو ما يقرّر شكلَ الكشف كلَّه: النقديُّ لا يُفوتَر ويصل
                      // التحصيلَ في يومه، والضريبيُّ يُفوتَر ثمّ يُحصَّل بفاتورته.
                      // وعمودُ «طريقة الدفع» القادمُ من المنصّة لا يقرّر شيئًا
                      // من هذا — هذا هو المرجع.
                      //
                      // ولا يُملأ من ملفّ العميل: العميلُ الواحد يقول في حمولةٍ
                      // «حاسبوني كاش» وفي أخرى «افتحوا فاتورة»، فالنوعُ صفةُ
                      // الشحنة لا صفةُ الطرف. يكتبه مَن يعرف ما اتُّفق عليه في
                      // هذه الحمولة، ويبقى مكتوبًا على الكشف فيُعرَف بعد سنةٍ
                      // أيُّها كان نقدًا وأيُّها فاتورة.
                      const paymentTypeCell = () => (
                        <td className="px-3 py-2.5 text-sm whitespace-nowrap min-w-[120px]" onClick={cellClick('paymentType')}
                          title={!owns('paymentType') ? noPermMsg
                            : (lang === 'ar'
                              ? 'يُكتب لكل كشف على حدة — العميل قد يحاسب كاشًا في حمولة وضريبيًّا في أخرى'
                              : 'Set per report — a customer may settle one load in cash and another by invoice')}>
                          {isEditing && owns('paymentType') ? (() => {
                            // الأربعةُ تُختار؛ و«ضريبي»/«كاش» القائمُ يُرى في القائمة ولا يُختار.
                            const cur = paymentKindOf(editData as any);
                            return (
                              <select title={T.thPaymentType} className={ic}
                                value={cur}
                                onChange={(e) => setEditData((prev) => ({ ...prev, paymentType: e.target.value }))}>
                                <option value="" disabled>{lang === 'ar' ? '— اختر —' : '— select —'}</option>
                                {(cur === 'cash' || cur === 'tax') && (
                                  <option value={cur} disabled>{paymentKindLabel(cur, lang === 'ar')}</option>
                                )}
                                {PAYMENT_CHOICES.map((k) => <option key={k} value={k}>{paymentKindLabel(k, lang === 'ar')}</option>)}
                              </select>
                            );
                          })() : (
                            <span className={spanCls('paymentType', 'text-purple-700')}>
                              {paymentKindLabel(paymentKindOf(wf), lang === 'ar') || '-'}
                            </span>
                          )}
                        </td>
                      );

                      // ── والكشفُ النقديُّ لا يُفوتَر ──────────────────────────
                      // عميلُ الكاش يدفع في يده: لا سندَ ولا فاتورةَ ولا ضريبة.
                      // فالأعمدةُ تُقرأ صفرًا وتُقفَل — والقفلُ يقول سببَه لا
                      // مجرّدَ أنّه قفل، وإلّا حُسب عطلًا.
                                            // Operations review is a one-click checkbox (checklist), not text.
                      const operationsReviewCell = () => (
                        <td className="px-3 py-2.5 text-sm whitespace-nowrap" onClick={(e) => e.stopPropagation()}>
                          <input
                            type="checkbox"
                            aria-label={T.thOpsReview}
                            title={T.thOpsReview}
                            disabled={!canEditOperationsReview || locked}
                            checked={!!wf.operationsReview}
                            onChange={() => toggleOperationsReview(wf)}
                            className="w-4 h-4 appearance-none rounded border border-slate-300 bg-white checked:bg-yellow-500 checked:border-yellow-500 cursor-pointer relative checked:after:content-['✓'] checked:after:text-white checked:after:text-[10px] checked:after:absolute checked:after:inset-0 checked:after:flex checked:after:items-center checked:after:justify-center disabled:opacity-40 disabled:cursor-not-allowed"
                          />
                        </td>
                      );
                      // Accounting review is a one-click checkbox (checklist), not text.
                      const accountingReviewCell = () => (
                        <td className="px-3 py-2.5 text-sm whitespace-nowrap" onClick={(e) => e.stopPropagation()}>
                          <input
                            type="checkbox"
                            aria-label={T.thAccountingReview}
                            title={T.thAccountingReview}
                            disabled={!canEditAccountingReview || locked}
                            checked={!!wf.accountingReview}
                            onChange={() => toggleAccountingReview(wf)}
                            className="w-4 h-4 appearance-none rounded border border-slate-300 bg-white checked:bg-purple-600 checked:border-purple-600 cursor-pointer relative checked:after:content-['✓'] checked:after:text-white checked:after:text-[10px] checked:after:absolute checked:after:inset-0 checked:after:flex checked:after:items-center checked:after:justify-center disabled:opacity-40 disabled:cursor-not-allowed"
                          />
                        </td>
                      );
                      return (<>
                        {/* Application Details */}
                        {textCell('reportNumber', 'text-[#f37121] font-medium')}
                        {dateCell('reportDate')}
                        {textCell('fromLocation')}
                        {textCell('toLocation')}
                        {textCell('branch')}
                        {textCell('carOwner', 'text-slate-900')}
                        {textCell('carNumber')}
                        {statusCell()}
                        {textCell('username')}
                        {textCell('userPhone')}
                        {numCell('purchaseValue')}
                        {/* تُكتب في منصّة التشغيل أوّلًا ثمّ هنا — راجع pushSellingValue. */}
                        {canSeeSelling && numCell('sellingValue', 'text-emerald-700')}
                        {textCell('driverName')}
                        {textCell('truckType')}
                        {textCell('truckSize')}
                        {textCell('representativeName')}
                        {/* Operations Review */}
                        {operationsReviewCell()}
                        {/* Manual Moderator */}
                        {dateCell('paymentDate', 'text-purple-700')}
                        {(() => {
                          const owner = (wf as any).dataOwnerShown || (wf as any).paymentDateByName || '';
                          const from = (wf as any).dataOwnerFrom || '';
                          const at = (wf as any).paymentDateAt;
                          return (
                            <td className="px-3 py-2.5 text-sm whitespace-nowrap" onClick={(e) => e.stopPropagation()}
                              title={[
                                from === 'wallet' ? (lang === 'ar' ? 'سجّل الشراء في المحفظة' : 'recorded the purchase in the wallet') : '',
                                from === 'import' ? (lang === 'ar' ? 'صفٌّ منقولٌ من المنصّة — لا أحدَ كتبه عندنا' : 'synced from the platform') : '',
                                at ? new Date(at).toLocaleString('en-GB') : '',
                              ].filter(Boolean).join(' · ') || undefined}>
                              <span className={from === 'import' ? 'text-slate-500 text-xs' : 'text-purple-700'}>
                                {owner || '-'}
                                {from === 'wallet' && (
                                  <span className="ms-1 text-[10px] text-slate-400">{lang === 'ar' ? '· المحفظة' : '· wallet'}</span>
                                )}
                              </span>
                            </td>
                          );
                        })()}
                        {lookupCell('payingBranch', 'workflow_paying_branch', 'text-purple-700')}
                        {numCell('paymentAmount', 'text-purple-700')}
                        {paymentTypeCell()}
                        {/* ما بعده يُقفَل على الكشف النقديّ — والقفلُ يقول سببَه
                            عند المرور عليه، فلا يُقرأ عطلًا. */}
                        {lookupCell('finalReportDestination', 'workflow_final_destination', 'text-purple-700')}
                        {textCell('documentNumber', 'text-purple-700')}
                        <td className="px-3 py-2.5 text-sm whitespace-nowrap" onClick={(e) => e.stopPropagation()}>
                          {wf.customsLink?.clearance
                            ? <CustomsLinkBadge link={wf.customsLink} ar={lang === 'ar'} />
                            : <span className="text-slate-300">-</span>}
                        </td>
                        {dateCell('sendingDate', 'text-purple-700')}
                        {dateCell('branchDeliveryDate', 'text-purple-700')}
                        {canViewFinancials && accountingReviewCell()}
                        {/* Collections — financial, finance/owner roles only */}
                        {canViewFinancials && textCell('invoiceNumber', 'text-green-700')}
                        {canViewFinancials && numCell('netInvoice', 'text-green-700')}
                        {canViewFinancials && numCell('tax', 'text-green-700')}
                        {canViewFinancials && numCell('totalInvoice', 'text-green-700')}
                        {canViewFinancials && dateCell('invoiceDate', 'text-green-700')}
                        {dateCell('deliveryDate', 'text-green-700')}
                        {canViewFinancials && numCell('collectedAmount', 'text-green-700')}
                        {canViewFinancials && dateCell('collectionDate', 'text-green-700')}
                      </>);
                    })()}

                  </tr>
                );
              })}
            </tbody>
          </table>
        </ScrollX>

        {/* التصفّح كلّه في الخادم — بما في ذلك حالة الفلترة. الصفحة الواحدة خمسون
            صفًّا مهما بلغ عدد المطابق، فلا يُرسم في التبويب جدولٌ بعشرات الآلاف من
            الصفوف يجمّده. */}
        {total > 50 && (
          <div className="flex items-center justify-between px-4 py-3 border-t border-slate-200">
            <span className="text-slate-500 text-sm">{T.showing} {(page - 1) * 50 + 1}-{Math.min(page * 50, total)} {T.of} {total}{hasColFilters ? ` (${lang === 'ar' ? 'مُفلتر' : 'filtered'})` : ''}</span>
            <div className="flex gap-2">
              <button type="button" onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page === 1} className="px-3 py-1 rounded bg-slate-100 text-slate-700 text-sm disabled:opacity-50">{T.previous}</button>
              <button type="button" onClick={() => setPage((p) => p + 1)} disabled={page * 50 >= total} className="px-3 py-1 rounded bg-slate-100 text-slate-700 text-sm disabled:opacity-50">{T.next}</button>
            </div>
          </div>
        )}
      </div>

      {/* عدّادُ المراحل أُزيل معها — أربعةٌ من خمسةٍ صفرٌ دائمًا. والإجماليُّ يبقى. */}
      <div className="flex flex-wrap gap-3 items-center">
        <div className="px-3 py-2 rounded-lg bg-slate-100 text-slate-700 text-xs font-medium">{T.total}: {(stats.total || total).toLocaleString()}</div>
        {hasColFilters && (
          <button type="button" onClick={clearColFilters} className="flex items-center gap-1 px-3 py-2 rounded-lg bg-[#f37121]/10 text-[#f37121] text-xs font-medium hover:bg-[#f37121]/20 transition-colors">
            <X className="w-3.5 h-3.5" /> {lang === 'ar' ? `مسح كل الفلاتر (${Object.keys(colFilters).length})` : `Clear all filters (${Object.keys(colFilters).length})`}
          </button>
        )}
      </div>

      {/* Confirm Modal */}
      {confirmModal && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
          <div className="bg-white border border-slate-200 rounded-xl w-full max-w-sm shadow-xl">
            <div className="p-6">
              <div className="flex items-center gap-3 mb-4">
                <div className="w-10 h-10 rounded-full bg-[#f37121]/20 flex items-center justify-center">
                  <AlertCircle className="w-5 h-5 text-[#f37121]" />
                </div>
                <h3 className="bg-slate-900 px-3 py-2 rounded-lg text-white font-semibold mb-3">{lang === 'ar' ? 'تأكيد' : 'Confirm'}</h3>
              </div>
              <p className="text-slate-700 text-sm">{confirmModal.message}</p>
            </div>
            <div className="px-6 py-4 border-t border-slate-200 flex justify-end gap-3">
              <button type="button" onClick={() => setConfirmModal(null)} className="px-4 py-2 text-slate-500 hover:text-slate-900 text-sm">{T.cancel || 'Cancel'}</button>
              <button type="button" onClick={confirmModal.onConfirm} className="px-4 py-2 bg-[#f37121] text-white rounded-lg text-sm font-medium hover:bg-[#e06010] transition-colors">
                {lang === 'ar' ? 'تأكيد' : 'Confirm'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
