'use client';
import { useState, useEffect, useCallback, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { ColumnFilter, type ColumnFilterOption } from '@/components/ColumnFilter';
import { useAuth } from '@/context/AuthContext';
import { useLanguage } from '@/context/LanguageContext';
import { useDialog } from '@/components/system/DialogProvider';
import { getOperationsTranslations } from '@/lib/translations';
import { SHIPMENT_STATUSES, PAYMENT_METHODS } from '@/lib/ops';
import api from '@/lib/api';
import ExportMenu from '@/components/ls2/ExportMenu';
import DateRangeFilter, { DateField } from '@/components/system/DateRangeFilter';
import ManagedSelect from '@/components/system/ManagedSelect';
import { useSocket } from '@/hooks/useSocket';
import OpsLiveSummary from '@/components/ops/OpsLiveSummary';
import { useLatestRequest } from '@/hooks/useLatestRequest';
import {
  ClipboardList, Plus, Search, Filter, FilterX,
  Lock, Unlock, Edit, Trash2, ArrowRight, Loader2, X, FileSpreadsheet, AlertCircle,
  CheckSquare, Check
} from 'lucide-react';

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
  payingBranch: string;
  finalReportDestination: string;
  documentNumber: string;
  sendingDate: string;
  deliveryDate: string;
  accountingReview: string;
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
// Columns whose filter-dropdown labels should be formatted as dates / money.
const DATE_FIELDS = new Set(['reportDate', 'paymentDate', 'sendingDate', 'deliveryDate', 'invoiceDate', 'collectionDate']);
const NUM_FIELDS = new Set(['purchaseValue', 'sellingValue', 'netInvoice', 'tax', 'totalInvoice']);

// ── أعمدة التصدير ────────────────────────────────────────────────────────────
// مكتوبةٌ هنا لا مشتقّةٌ من الجدول: الجدول يُخفي الأعمدة المالية عمّن لا يراها،
// والملفّ يخرج بما طلبه صاحبه — فاشتقاقُه من الشاشة كان سيُسقط أعمدةً بحسب مَن
// ضغط الزرّ لا بحسب ما في البيانات.
const EXPORT_COLUMNS = [
  { header: 'رقم الطلب', key: 'reportNumber', width: 14 },
  { header: 'تاريخ الطلب', key: 'reportDate', width: 12 },
  { header: 'من', key: 'fromLocation', width: 14 },
  { header: 'إلى', key: 'toLocation', width: 14 },
  { header: 'الفرع', key: 'branch', width: 14 },
  { header: 'مالك السيارة', key: 'carOwner', width: 22 },
  { header: 'رقم السيارة', key: 'carNumber', width: 14 },
  { header: 'نوع الملكية', key: 'ownerType', width: 12 },
  { header: 'حالة التنفيذ', key: 'executionStatus', width: 16 },
  { header: 'حالة الطلب', key: 'applicationStatus', width: 16 },
  { header: 'طريقة الدفع', key: 'paymentMethod', width: 14 },
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
  { header: 'فرع السداد', key: 'payingBranch', width: 14 },
  { header: 'وجهة الكشف النهائية', key: 'finalReportDestination', width: 18 },
  { header: 'رقم المستند', key: 'documentNumber', width: 14 },
  { header: 'تاريخ الإرسال', key: 'sendingDate', width: 12 },
  { header: 'تاريخ التسليم', key: 'deliveryDate', width: 12 },
  { header: 'مراجعة المحاسبة', key: 'accountingReview', width: 14 },
  { header: 'رقم الفاتورة', key: 'invoiceNumber', width: 14 },
  { header: 'صافي الفاتورة', key: 'netInvoice', width: 12 },
  { header: 'الضريبة', key: 'tax', width: 10 },
  { header: 'إجمالي الفاتورة', key: 'totalInvoice', width: 14 },
  { header: 'تاريخ الفاتورة', key: 'invoiceDate', width: 12 },
  { header: 'تاريخ التحصيل', key: 'collectionDate', width: 12 },
  { header: 'المرحلة', key: 'stage', width: 16 },
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
  const [transitioningId, setTransitioningId] = useState<string | null>(null);
  const initialLoadDone = useRef(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkDeleting, setBulkDeleting] = useState(false);
  const [showPendingOnly, setShowPendingOnly] = useState(false);
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
    'username', 'userPhone', 'taxIndicator', 'purchaseValue', 'sellingValue', 'loadingTime',
    'driverName', 'driverPhone', 'truckType', 'truckSize', 'loadType', 'quantity',
    'reference', 'representativeName', 'stage',
  ]);
  const [confirmModal, setConfirmModal] = useState<{ message: string; onConfirm: () => void } | null>(null);
  const [showBulkReview, setShowBulkReview] = useState(false);
  // ── تسجيلُ سدادٍ لدفعةٍ واحدة ─────────────────────────────────────────────
  // السنداتُ تصل دفعةً بتاريخٍ واحدٍ وفرعٍ واحد، وكان يُفتح كلُّ صفٍّ ليُكتب
  // فيه التاريخُ نفسُه — مئةُ فرصةِ خطأٍ لعملٍ واحد.
  const [showBulkPay, setShowBulkPay] = useState(false);
  const [bulkPay, setBulkPay] = useState({ paymentDate: '', payingBranch: '', documentNumber: '', sendingDate: '', deliveryDate: '' });
  const [bulkPaying, setBulkPaying] = useState(false);
  const [bulkResult, setBulkResult] = useState<{ message: string; skipped: { reportNumber: string; reason: string }[] } | null>(null);
  const [bulkReviewText, setBulkReviewText] = useState('تم');
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
  const canCreate = role === 'super_admin' || role === 'moderator';
  const canDelete = role === 'super_admin';
  // Financial columns (invoice #, net, tax, total, invoice/collection dates,
  // stage) are only visible to owners + accounting. Everyone else never sees them.
  const canViewFinancials = ['super_admin', 'admin', 'finance_manager', 'accountant'].includes(role);
  // Who may tick the accounting-review checkbox (matches backend write access).
  const canEditAccountingReview = ['super_admin', 'admin', 'finance_manager', 'accountant'].includes(role);
  // Who may tick the operations-review checkbox (matches backend `operations` group).
  const canEditOperationsReview = ['super_admin', 'operations_manager'].includes(role);

  // Aggregates over the WHOLE matching dataset (all ~27k rows, not one page).
  const [stats, setStats] = useState<{ total: number; pendingInvoices: number; sumPurchaseValue: number; byStage: Record<string, number> }>({ total: 0, pendingInvoices: 0, sumPurchaseValue: 0, byStage: {} });

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
    for (const [field, vals] of Object.entries(colFilters)) {
      vals.forEach((v) => params.append(`cf_${field}`, v));
    }
    return params;
  }, [stageFilter, search, dateFrom, dateTo, showPendingOnly, colFilters]);

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
      if (guard.isCurrent(mySeq)) {
        setLoading(false);
        setSearching(false);
      }
      initialLoadDone.current = true;
    }
  }, [buildParams, page, guard]);

  // Initial load
  useEffect(() => { fetchWorkflows(); }, [fetchWorkflows]);

  // Fetch full-dataset aggregates (for the summary cards) whenever the server
  // filters change. Reflects all matching rows, not just the loaded page.
  const fetchStats = useCallback(async () => {
    try {
      const data = await api.get<any>(`/api/workflows/stats?${buildParams().toString()}`);
      setStats({
        total: data.total || 0,
        pendingInvoices: data.pendingInvoices || 0,
        sumPurchaseValue: data.sumPurchaseValue || 0,
        byStage: data.byStage || {},
      });
    } catch { /* non-critical */ }
  }, [buildParams]);
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
  useEffect(() => { setSelectedIds(new Set()); }, [stageFilter, search, page, dateFrom, dateTo, showPendingOnly, colFilters]);

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
    const filtered = !!search || !!dateFrom || !!dateTo || showPendingOnly || Object.keys(colFilters).length > 0;
    setTotal((t) => t + 1);
    if (filtered || page !== 1) return;
    setWorkflows((p) => [wf, ...p]);
  }, [search, dateFrom, dateTo, showPendingOnly, colFilters, page]);
  const handleUpdated = useCallback((wf: Workflow) => { setWorkflows((p) => p.map((w) => w._id === wf._id ? wf : w)); }, []);
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
      draft: [{ stage: 'submitted_to_ops', label: T.submitToOps, roles: ['moderator', 'super_admin'] }],
      submitted_to_ops: [
        { stage: 'ops_completed', label: T.markOpsComplete, roles: ['operations_manager', 'super_admin'] },
        { stage: 'draft', label: T.returnToDraft, roles: ['operations_manager', 'super_admin'] },
      ],
      ops_completed: [
        { stage: 'submitted_to_collections', label: T.submitToCollections, roles: ['operations_manager', 'super_admin'] },
        { stage: 'submitted_to_ops', label: T.returnToOps, roles: ['operations_manager', 'super_admin'] },
      ],
      submitted_to_collections: [
        { stage: 'completed', label: T.markComplete, roles: ['admin', 'employee', 'super_admin'] },
        { stage: 'ops_completed', label: T.returnToOps, roles: ['admin', 'employee', 'super_admin'] },
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

  const handleBulkDelete = () => {
    if (selectedIds.size === 0) return;
    setConfirmModal({
      message: T.deleteBulkConfirm.replace('{count}', String(selectedIds.size)),
      onConfirm: async () => {
        setConfirmModal(null);
        try {
          setBulkDeleting(true);
          await api.post('/api/workflows/bulk-delete', { ids: Array.from(selectedIds) });
          setSelectedIds(new Set());
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
      const r = await api.put<{ refusedMessage?: string }>(`/api/workflows/${editingId}`, patch);
      // ما رفضه الخادمُ يُقال، ولا يُترك المستخدم يظنّ أنّه حُفظ.
      if (r && r.refusedMessage) setError(r.refusedMessage);
      setEditingId(null);
      setEditData({});
      setEditBase({});
      setFocusField(null);
      fetchWorkflows(true);
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
  const beginEditField = (wf: Workflow, field: string) => {
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

  const handleBulkReview = async () => {
    try {
      await Promise.all(Array.from(selectedIds).map(id =>
        api.put(`/api/workflows/${id}`, { operationsReview: bulkReviewText })
      ));
      setSelectedIds(new Set());
      setShowBulkReview(false);
      fetchWorkflows(true);
    } catch (err: any) { setError(err.message); }
  };

  const handleBulkPay = async () => {
    // ما لم يُملأ لا يُرسَل: حقلٌ فارغٌ في الدفعة يعني «لا تلمس هذا العمود»،
    // لا «امسح ما فيه» — ومسحُ مئةِ صفٍّ بالخطأ أسوأ من عدم كتابتها.
    const fields = Object.fromEntries(Object.entries(bulkPay).filter(([, v]) => String(v || '').trim()));
    if (!Object.keys(fields).length) return;
    setBulkPaying(true); setBulkResult(null);
    try {
      const r = await api.post<{ message: string; skipped?: { reportNumber: string; reason: string }[] }>(
        '/api/workflows/bulk-update', { ids: Array.from(selectedIds), fields });
      setBulkResult({ message: r.message, skipped: r.skipped || [] });
      if (!(r.skipped || []).length) {
        setShowBulkPay(false); setSelectedIds(new Set());
        setBulkPay({ paymentDate: '', payingBranch: '', documentNumber: '', sendingDate: '', deliveryDate: '' });
      }
      fetchWorkflows(true);
    } catch (err: any) { setBulkResult({ message: err.message, skipped: [] }); }
    setBulkPaying(false);
  };

  const toggleSelect = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const toggleSelectAll = () => {
    const visibleIds = workflows.map((w) => w._id);
    const allSelected = visibleIds.length > 0 && visibleIds.every((id) => selectedIds.has(id));
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
    sendingDate: formatDate(w.sendingDate),
    deliveryDate: formatDate(w.deliveryDate),
    invoiceDate: formatDate(w.invoiceDate),
    collectionDate: formatDate(w.collectionDate),
    executionStatus: trStatus(w.executionStatus),
    applicationStatus: trStatus(w.applicationStatus),
    paymentMethod: trPayment(w.paymentMethod),
    stage: stageLabels[w.stage] || w.stage,
    operationsReview: w.operationsReview ? (lang === 'ar' ? 'تمّت' : 'Done') : '',
    accountingReview: w.accountingReview ? (lang === 'ar' ? 'تمّت' : 'Done') : '',
  });

  /** يجلب نطاقًا كاملًا من الخادم ويعيده شيتًا واحدًا جاهزًا للتصدير. */
  const exportSheets = async (scope: 'page' | 'filtered' | 'all') => {
    let data: Workflow[] = workflows;
    if (scope !== 'page') {
      const p = scope === 'all' ? new URLSearchParams() : buildParams();
      p.set('page', '1');
      p.set('limit', '100000');
      const d = await api.get<{ workflows: Workflow[] }>(`/api/workflows?${p.toString()}`);
      data = d.workflows || [];
    }
    return [{
      name: lang === 'ar' ? 'الطلبات' : 'Workflows',
      rows: data.map(exportRow) as unknown as Record<string, any>[],
      columns: EXPORT_COLUMNS,
    }];
  };

  const formatDate = (d: string) => d ? new Date(d).toLocaleDateString('en-GB') : '-';
  const formatMoney = (v: number) => v ? v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '-';

  // كل أرقام البطاقات محسوبةٌ في الخادم على مجموعة الصفوف المطابقة كاملةً — لا على
  // الخمسين صفًّا المعروضة. حسابُها من الصفوف المحمَّلة كان يجعلها تقول «٥٠» مهما
  // كان في القاعدة، أو يُلزمنا بتنزيل الجدول كلّه لتصحّ.
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

  if (loading && workflows.length === 0) {
    return <div className="flex items-center justify-center h-64"><div className="w-8 h-8 border-2 border-[#f37121] border-t-transparent rounded-full animate-spin" /></div>;
  }

  return (
    <div className="space-y-4">
      <OpsLiveSummary />

      {/* Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
        <h1 className="text-2xl font-bold text-slate-900 flex items-center gap-2">
          <ClipboardList className="w-6 h-6 text-[#f37121]" />
          {T.title}
        </h1>
        <div className="flex items-center gap-2 flex-wrap">
          {canDelete && selectedIds.size > 0 && (
            <button type="button" onClick={handleBulkDelete} disabled={bulkDeleting} className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-red-600 hover:bg-red-700 text-white text-sm font-medium transition-colors disabled:opacity-50">
              {bulkDeleting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />} {T.deleteCount} ({selectedIds.size})
            </button>
          )}
          {/* ── تسجيلُ سدادٍ لدفعةٍ واحدة ────────────────────────────────────
              يظهر حين يكون هناك ما هو محدَّد، ولا يُرسل إلّا ما مُلئ: الخانةُ
              الفارغة تعني «لا تلمس هذا العمود» لا «امسحه». والخادمُ يفحص كلَّ
              صفٍّ على حدة — ما لم يُستلم سندُه لا يُسجَّل سدادُه، ويُقال باسمه. */}
          {selectedIds.size > 0 && (
            <div className="relative">
              <button type="button" onClick={() => { setShowBulkPay((p) => !p); setBulkResult(null); }}
                className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-purple-600 hover:bg-purple-700 text-white text-sm font-medium transition-colors">
                <CheckSquare className="w-4 h-4" /> {lang === 'ar' ? 'تسجيل سداد' : 'Record payment'} ({selectedIds.size})
              </button>
              {showBulkPay && (
                <div className="absolute top-full mt-2 end-0 bg-white border border-slate-200 rounded-xl shadow-xl z-50 p-4 w-[320px]" onClick={(e) => e.stopPropagation()}>
                  <p className="text-sm font-bold text-slate-900 mb-1">
                    {lang === 'ar' ? `تطبيق على ${selectedIds.size} كشفًا` : `Apply to ${selectedIds.size} rows`}
                  </p>
                  <p className="text-[11px] text-slate-500 mb-3">
                    {lang === 'ar' ? 'ما تتركه فارغًا لا يُغيَّر.' : 'Blank fields are left unchanged.'}
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
                    <div>
                      <label className="block text-xs font-semibold text-slate-600 mb-1">{lang === 'ar' ? 'رقم السند' : 'Voucher no.'}</label>
                      <input value={bulkPay.documentNumber} onChange={(e) => setBulkPay((p) => ({ ...p, documentNumber: e.target.value }))}
                        placeholder={lang === 'ar' ? 'اختياري' : 'Optional'}
                        className="w-full px-2.5 py-2 rounded-lg bg-white border border-slate-200 text-slate-900 text-[13px] focus:outline-none focus:ring-2 focus:ring-[#f37121]/40" />
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <label className="block text-xs font-semibold text-slate-600 mb-1">{lang === 'ar' ? 'الإرسال' : 'Sent'}</label>
                        <DateField ar={lang === 'ar'} label={lang === 'ar' ? 'تاريخ الإرسال' : 'Sending date'}
                          value={bulkPay.sendingDate} onChange={(v) => setBulkPay((p) => ({ ...p, sendingDate: v }))} />
                      </div>
                      <div>
                        <label className="block text-xs font-semibold text-slate-600 mb-1">{lang === 'ar' ? 'التسليم' : 'Delivered'}</label>
                        <DateField ar={lang === 'ar'} label={lang === 'ar' ? 'تاريخ التسليم' : 'Delivery date'}
                          value={bulkPay.deliveryDate} onChange={(v) => setBulkPay((p) => ({ ...p, deliveryDate: v }))} />
                      </div>
                    </div>
                  </div>
                  {bulkResult && (
                    <div className="mt-3 p-2 rounded-lg bg-slate-50 border border-slate-200 max-h-40 overflow-auto">
                      <p className="text-xs font-semibold text-slate-800">{bulkResult.message}</p>
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
          {(role === 'operations_manager' || role === 'super_admin') && selectedIds.size > 0 && (
            <div className="relative">
              <button type="button" onClick={() => setShowBulkReview(prev => !prev)} className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-yellow-600 hover:bg-yellow-700 text-white text-sm font-medium transition-colors">
                <CheckSquare className="w-4 h-4" /> {lang === 'ar' ? 'مراجعة' : 'Review'} ({selectedIds.size})
              </button>
              {showBulkReview && (
                <div className="absolute top-full mt-2 end-0 bg-slate-50 border border-slate-200 rounded-lg shadow-xl z-50 p-3 min-w-[220px]">
                  <label className="block text-xs text-slate-500 mb-1">{lang === 'ar' ? 'نص المراجعة:' : 'Review text:'}</label>
                  <input
                    type="text"
                    value={bulkReviewText}
                    onChange={(e) => setBulkReviewText(e.target.value)}
                    placeholder={lang === 'ar' ? 'نص المراجعة' : 'Review text'}
                    title={lang === 'ar' ? 'نص المراجعة' : 'Review text'}
                    className="w-full px-2 py-1.5 rounded bg-white border border-slate-300 text-slate-900 text-sm focus:outline-none focus:ring-1 focus:ring-[#f37121] mb-2"
                  />
                  <div className="flex items-center gap-2">
                    <button type="button" onClick={handleBulkReview} className="flex-1 px-3 py-1.5 rounded bg-yellow-600 hover:bg-yellow-700 text-white text-xs font-medium transition-colors">
                      {lang === 'ar' ? 'تأكيد' : 'Confirm'}
                    </button>
                    <button type="button" onClick={() => setShowBulkReview(false)} className="px-3 py-1.5 rounded bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs transition-colors">
                      {lang === 'ar' ? 'إلغاء' : 'Cancel'}
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}
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
              { key: 'page', label: lang === 'ar' ? `الصفحة المعروضة (${workflows.length})` : `Current page (${workflows.length})`, resolve: () => exportSheets('page') },
              { key: 'filtered', label: lang === 'ar' ? `كلّ ما طابق الفلتر (${total})` : `Everything matching the filter (${total})`, resolve: () => exportSheets('filtered') },
              { key: 'all', label: lang === 'ar' ? 'الجدول كلّه (بلا فلتر)' : 'The whole table (no filter)', resolve: () => exportSheets('all') },
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

      {/* Filters */}
      <div className="flex flex-col gap-3">
        <div className="flex flex-col sm:flex-row gap-3">
          <div className="relative flex-1 min-w-[260px]">
            {searching ? (
              <Loader2 className="absolute start-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[#f37121] animate-spin" />
            ) : (
              <Search className="absolute start-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
            )}
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
            <input type="date" value={dayKey} onChange={(e) => applyDay(e.target.value)}
              aria-label={lang === 'ar' ? 'اختر اليوم' : 'Pick day'}
              className="px-3 py-2 rounded-lg bg-white border border-slate-200 text-slate-900 text-sm focus:outline-none focus:ring-2 focus:ring-[#f37121]/40" />
          )}
          {dateMode === 'month' && (
            <input type="month" value={monthKey} onChange={(e) => applyMonth(e.target.value)}
              aria-label={lang === 'ar' ? 'اختر الشهر' : 'Pick month'}
              className="px-3 py-2 rounded-lg bg-white border border-slate-200 text-slate-900 text-sm focus:outline-none focus:ring-2 focus:ring-[#f37121]/40" />
          )}
          {dateMode === 'range' && (
            <DateRangeFilter ar={lang === 'ar'} from={dateFrom} to={dateTo}
              onFrom={(v) => { setDateFrom(v); setPage(1); }}
              onTo={(v) => { setDateTo(v); setPage(1); }} />
          )}
        </div>
        {/* ── مِصفاةُ المراحل أُزيلت ────────────────────────────────────────
            «مسودة / مرسل للتشغيل / التشغيل مكتمل / للتحصيلات / مكتمل» مراحلُ
            صُمّمت حين كانت الكشوفُ تُنشأ عندنا وتتنقّل بين أقسامنا. وهي تصل
            الآن من منصّة التشغيل وقد جرت هناك، فيبقى الجميعُ في «مسودة» أبدًا:
            خمسةُ أزرارٍ أربعةٌ منها فارغةٌ دائمًا. والحالةُ الحقيقيّةُ عمودٌ في
            الجدول له مِصفاتُه. */}
      </div>

      {/* Summary cards */}
      <div className="flex items-stretch gap-3 flex-wrap">
        {/* Pending Invoices — over ALL matching rows (click to filter) */}
        <button
          type="button"
          onClick={() => { setShowPendingOnly(prev => !prev); setPage(1); }}
          className={`flex items-center gap-3 px-5 py-3.5 rounded-xl border transition-all duration-200 ${
            showPendingOnly
              ? 'bg-amber-500/20 border-amber-500/60 ring-2 ring-amber-500/30'
              : 'bg-amber-500/10 border-amber-500/30 hover:bg-amber-500/15 hover:border-amber-500/50'
          }`}
        >
          <div className={`p-2 rounded-lg ${showPendingOnly ? 'bg-amber-500/30' : 'bg-amber-500/20'}`}>
            <AlertCircle className="w-5 h-5 text-amber-700" />
          </div>
          {/* ── الرقمُ يقول قاعدتَه ──────────────────────────────────────────
              «فواتير لم تصل» وحدَها لا تكفي لمطابقة الرقم بشيتٍ خارجيّ: هل
              الملغاةُ داخلةٌ فيه؟ أربعةُ آلافٍ ومئةٌ وخمسةٌ وسبعون كشفًا ملغًى
              بلا تاريخ سداد، ولو دخلت لصار الرقمُ خمسةَ آلافٍ وستَّمئة. تُكتب
              القاعدةُ تحت الرقم فيُراجَع بلا سؤال. */}
          <div className="flex flex-col items-start">
            <span className="text-2xl font-bold text-amber-700">{pendingCount.toLocaleString()}</span>
            <span className="text-xs text-amber-700/80">{lang === 'ar' ? 'فواتير لم تصل' : 'Pending Invoices'}</span>
            <span className="text-[10px] text-amber-700/60 leading-tight">
              {lang === 'ar' ? 'بلا تاريخ سداد · عدا الملغاة' : 'no payment date · excludes cancelled'}
            </span>
          </div>
          {showPendingOnly && (
            <span className="ms-2 px-2 py-0.5 rounded text-[10px] font-medium bg-amber-500/30 text-amber-700">
              {lang === 'ar' ? 'مُفعّل' : 'ACTIVE'}
            </span>
          )}
        </button>

        {/* Filtered row count — live with the active filters */}
        <div className="flex items-center gap-3 px-5 py-3.5 rounded-xl border bg-blue-500/10 border-blue-500/30">
          <div className="p-2 rounded-lg bg-blue-500/20">
            <ClipboardList className="w-5 h-5 text-blue-700" />
          </div>
          <div className="flex flex-col items-start">
            <span className="text-2xl font-bold text-blue-700">{filteredRowsCount.toLocaleString()}</span>
            <span className="text-xs text-blue-700/80">{lang === 'ar' ? 'عدد الصفوف (حسب الفلتر)' : 'Rows (filtered)'}</span>
          </div>
        </div>

        {/* Sum of purchase value for the filtered rows — finance-only */}
        {canViewFinancials && (
          <div className="flex items-center gap-3 px-5 py-3.5 rounded-xl border bg-emerald-500/10 border-emerald-500/30">
            <div className="p-2 rounded-lg bg-emerald-500/20">
              <FileSpreadsheet className="w-5 h-5 text-emerald-700" />
            </div>
            <div className="flex flex-col items-start">
              <span className="text-2xl font-bold text-emerald-700">{filteredPurchaseSum.toLocaleString(undefined, { maximumFractionDigits: 2 })}</span>
              <span className="text-xs text-emerald-700/80">{lang === 'ar' ? 'مجموع قيمة الشراء (حسب الفلتر)' : 'Total purchase value (filtered)'}</span>
            </div>
          </div>
        )}

        {/* Clear all column filters */}
        {hasColFilters && (
          <button
            type="button"
            onClick={clearColFilters}
            title={lang === 'ar' ? 'مسح كل الفلاتر' : 'Clear all filters'}
            className="flex items-center gap-2 px-4 py-3.5 rounded-xl border border-slate-300 bg-white text-slate-600 hover:text-red-600 hover:border-red-300 hover:bg-red-50 transition-colors"
          >
            <FilterX className="w-5 h-5" />
            <span className="text-sm font-medium">{lang === 'ar' ? 'مسح الفلاتر' : 'Clear filters'}</span>
          </button>
        )}
      </div>

      {/* Table */}
      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[3200px]">
            <thead>
              <tr className="bg-slate-900 border-b border-slate-200">
                <th className="px-3 py-3 sticky start-0 bg-slate-900 z-10 w-20">
                  <div className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      title={T.selectAll}
                      checked={workflows.length > 0 && workflows.every((w) => selectedIds.has(w._id))}
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
                {ColHead('ownerType', T.thOwnerType)}
                {ColHead('executionStatus', T.thExecution)}
                {ColHead('applicationStatus', T.thApplication)}
                {ColHead('paymentMethod', T.thPaymentMethod)}
                {ColHead('username', T.thUsername)}
                {ColHead('userPhone', T.thUserPhone)}
                {ColHead('taxIndicator', T.thTaxIndicator)}
                {ColHead('purchaseValue', T.thPurchaseValue)}
                {ColHead('sellingValue', T.thSellingValue)}
                {ColHead('driverName', T.thDriverName)}
                {ColHead('truckType', T.thTruckType)}
                {ColHead('truckSize', T.thTruckSize)}
                {ColHead('representativeName', T.thRepresentative)}
                {/* Operations Review */}
                {ColHead('operationsReview', T.thOpsReview, 'text-yellow-400')}
                {/* Manual Moderator */}
                {ColHead('paymentDate', T.thPaymentDate, 'text-purple-300')}
                {ColHead('payingBranch', T.thPayingBranch, 'text-purple-300')}
                {/* وجهةُ الكشف النهائيّة — الفرعُ الذي يستقرّ عنده الملفّ في
                    آخره. سؤالٌ غيرُ «مَن سدّد»: قد يُسدَّد في فرعٍ ويستقرّ في غيره. */}
                {ColHead('finalReportDestination', lang === 'ar' ? 'وجهة الكشف النهائية' : 'Final destination', 'text-purple-300')}
                {ColHead('documentNumber', T.thDocNumber, 'text-purple-300')}
                {ColHead('sendingDate', T.thSendingDate, 'text-purple-300')}
                {ColHead('deliveryDate', T.thDeliveryDate, 'text-purple-300')}
                {ColHead('accountingReview', T.thAccountingReview, 'text-purple-300')}
                {/* Collections — financial columns, finance/owner roles only */}
                {canViewFinancials && ColHead('invoiceNumber', T.thInvoiceNumber, 'text-green-400')}
                {canViewFinancials && ColHead('netInvoice', T.thNetInvoice, 'text-green-400')}
                {canViewFinancials && ColHead('tax', T.thTax, 'text-green-400')}
                {canViewFinancials && ColHead('totalInvoice', T.thTotalInvoice, 'text-green-400')}
                {canViewFinancials && ColHead('invoiceDate', T.thInvoiceDate, 'text-green-400')}
                {canViewFinancials && ColHead('collectionDate', T.thCollectionDate, 'text-green-400')}
                {/* Meta — stage/المرحلة is treated as financial too */}
                {canViewFinancials && ColHead('stage', T.thStage)}
                <th className="px-3 py-3 text-start text-xs text-slate-300 font-semibold whitespace-nowrap w-10">{T.lock}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200">
              {workflows.length === 0 ? (
                <tr><td colSpan={42} className="px-4 py-12 text-center text-slate-800 text-sm">{showPendingOnly ? (lang === 'ar' ? 'لا توجد فواتير معلقة' : 'No pending invoices') : (hasColFilters ? (lang === 'ar' ? 'لا نتائج للفلتر المحدد' : 'No rows match the filters') : T.noWorkflows)}</td></tr>
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
                              <button type="button" onClick={() => { setEditingId(wf._id); setEditData({...wf}); setFocusField(null); }} className="p-1 text-slate-700 hover:text-[#f37121] rounded" title={T.edit}>
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
                      const cellClick = (field: keyof Workflow) => {
                        if (isEditing) return (e: any) => e.stopPropagation();
                        if (!SYSTEM_FIELDS.has(field as string) && !locked) return (e: any) => { e.stopPropagation(); beginEditField(wf, field as string); };
                        return undefined;
                      };
                      const spanCls = (field: keyof Workflow, color: string) =>
                        `${color} ${!isEditing && !SYSTEM_FIELDS.has(field as string) && !locked ? editableClass : ''}`;
                      // حقول كشف التخريج المسحوبة من النظام الخارجي غير قابلة للتعديل
                      const systemPulledFields = new Set(['fromLocation', 'toLocation', 'purchaseValue', 'sellingValue', 'branch', 'carOwner', 'carNumber', 'ownerType']);
                      const textCell = (field: keyof Workflow, color = 'text-slate-700') => {
                        const isSystemPulled = systemPulledFields.has(field as string) && wf.reportNumber;
                        return (
                          <td className="px-3 py-2.5 text-sm whitespace-nowrap" onClick={isSystemPulled ? (e) => e.stopPropagation() : cellClick(field)}
                            title={isSystemPulled ? 'البيانات المسحوبة من النظام لا تُعدّل' : undefined}>
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
                      // ── الفرعُ المسدِّد يُختار ولا يُكتب ───────────────────
                      // كان حقلًا حرًّا، فدخلت فيه «جد» و«جدهخ» بجانب «جده»:
                      // فرعٌ واحدٌ في ثلاثة صفوفٍ في كلّ تقرير. والقائمةُ تُدار
                      // من القوائم المرجعيّة، فتُضاف قيمةٌ جديدةٌ حين تلزم بلا
                      // أن يُفتح فيها بابُ الكتابة الحرّة ثانيةً.
                      const lookupCell = (field: keyof Workflow, type: string, color = 'text-slate-700') => (
                        <td className="px-3 py-2.5 text-sm whitespace-nowrap min-w-[140px]" onClick={cellClick(field)}>
                          {isEditing ? (
                            <ManagedSelect type={type} storeLabel noAdd
                              value={(editData as any)[field] || ''}
                              onChange={(v) => setEditData((prev) => ({ ...prev, [field]: v }))}
                              placeholder={lang === 'ar' ? 'اختر الفرع' : 'Pick branch'} />
                          ) : <span className={spanCls(field, color)}>{(wf as any)[field] || '-'}</span>}
                        </td>
                      );
                      const numCell = (field: keyof Workflow, color = 'text-slate-700') => {
                        const isSystemPulled = systemPulledFields.has(field as string) && wf.reportNumber;
                        return (
                          <td className="px-3 py-2.5 text-sm whitespace-nowrap" onClick={isSystemPulled ? (e) => e.stopPropagation() : cellClick(field)}
                            title={isSystemPulled ? 'البيانات المسحوبة من النظام لا تُعدّل' : undefined}>
                            {isEditing && !isSystemPulled ? <input type="number" autoFocus={focusField === field} title={field} className={ic} value={(editData as any)[field] || ''} onChange={(e) => setEditData(prev => ({...prev, [field]: e.target.value ? Number(e.target.value) : ''}))} /> : <span className={`${spanCls(field, color)}${isSystemPulled && wf.reportNumber ? ' opacity-60' : ''}`}>{formatMoney((wf as any)[field])}</span>}
                          </td>
                        );
                      };
                      // ── تاريخ السداد لا يُكتب قبل استلام السند ────────────────
                      // السداد يعني أن المال وصل، ولا يصل قبل استلام سند التسليم.
                      // كتابته قبله تجعل التقارير المالية تعدّ مبلغًا لم يُقبَض —
                      // فالحقل مقفل، ومكتوبٌ سببُ قفله لا مجرّد أنه مقفل.
                      const bondReceived = String(wf.applicationStatus || '').trim() === 'bond_received';
                      const dateCell = (field: keyof Workflow, color = 'text-slate-700') => {
                        const gated = field === 'paymentDate' && !bondReceived;
                        return (
                          <td className="px-3 py-2.5 text-sm whitespace-nowrap"
                            onClick={gated ? (e) => { e.stopPropagation(); notifyGate(); } : cellClick(field)}
                            title={gated ? gateMsg : undefined}>
                            {isEditing && !gated
                              ? <input type="date" autoFocus={focusField === field} title={field} className={ic} value={(editData as any)[field] ? (editData as any)[field].slice(0, 10) : ''} onChange={(e) => setEditData(prev => ({...prev, [field]: e.target.value}))} />
                              : <span className={`${spanCls(field, color)}${gated ? ' opacity-60 cursor-not-allowed' : ''}`}>
                                  {formatDate((wf as any)[field]) || (gated ? '—' : '')}
                                </span>}
                          </td>
                        );
                      };
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
                        {textCell('ownerType')}
                        {transCell('executionStatus', trStatus)}
                        {transCell('applicationStatus', trStatus)}
                        {transCell('paymentMethod', trPayment)}
                        {textCell('username')}
                        {textCell('userPhone')}
                        {textCell('taxIndicator')}
                        {numCell('purchaseValue')}
                        {numCell('sellingValue')}
                        {textCell('driverName')}
                        {textCell('truckType')}
                        {textCell('truckSize')}
                        {textCell('representativeName')}
                        {/* Operations Review */}
                        {operationsReviewCell()}
                        {/* Manual Moderator */}
                        {dateCell('paymentDate', 'text-purple-700')}
                        {lookupCell('payingBranch', 'workflow_paying_branch', 'text-purple-700')}
                        {lookupCell('finalReportDestination', 'workflow_final_destination', 'text-purple-700')}
                        {textCell('documentNumber', 'text-purple-700')}
                        {dateCell('sendingDate', 'text-purple-700')}
                        {dateCell('deliveryDate', 'text-purple-700')}
                        {accountingReviewCell()}
                        {/* Collections — financial, finance/owner roles only */}
                        {canViewFinancials && textCell('invoiceNumber', 'text-green-700')}
                        {canViewFinancials && numCell('netInvoice', 'text-green-700')}
                        {canViewFinancials && numCell('tax', 'text-green-700')}
                        {canViewFinancials && numCell('totalInvoice', 'text-green-700')}
                        {canViewFinancials && dateCell('invoiceDate', 'text-green-700')}
                        {canViewFinancials && dateCell('collectionDate', 'text-green-700')}
                      </>);
                    })()}
                    {/* Meta — stage/المرحلة, finance/owner roles only */}
                    {canViewFinancials && (
                      <td className="px-3 py-2.5 whitespace-nowrap"><span className={`px-2 py-0.5 rounded text-xs font-medium ${sc.bg} ${sc.color}`}>{stageLabels[wf.stage] || sc.label}</span></td>
                    )}
                    <td className="px-3 py-2.5">
                      {wf.lockedBy ? (
                        <div className="flex items-center gap-1" title={T.lockedByTooltip.replace('{name}', wf.lockedByName)}>
                          <Lock className="w-3.5 h-3.5 text-red-600" />
                        </div>
                      ) : <Unlock className="w-3.5 h-3.5 text-slate-600" />}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

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
