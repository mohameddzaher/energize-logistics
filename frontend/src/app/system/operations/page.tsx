'use client';
import { FINANCE_FULL_ROLES } from '@/lib/financeAuthority';
import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
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
import ColumnChooser, { useVisibleColumns, type ChooserColumn } from '@/components/system/ColumnChooser';
import DateRangeFilter, { DateField } from '@/components/system/DateRangeFilter';
import ManagedSelect from '@/components/system/ManagedSelect';
import { useSocket } from '@/hooks/useSocket';
import { useLatestRequest } from '@/hooks/useLatestRequest';
import {
  ClipboardList, Plus, Search, Filter, FilterX, Edit, Trash2, ArrowRight, Loader2, X, FileSpreadsheet, AlertCircle, CheckSquare, Check, Receipt, AlertTriangle, Ban, History as HistoryIcon } from 'lucide-react';
import ScrollX from '@/components/system/ScrollX';
import TablePager, { readPageSize, savePageSize } from '@/components/system/TablePager';
import InvoiceImportButton from '@/components/operations/InvoiceImportButton';
import { SellingRequestsButton } from '@/components/operations/SellingPriceRequests';
import WorkflowFilterBar, { type FilterBarField } from '@/components/operations/WorkflowFilterBar';
import InvoiceCheckCards from '@/components/operations/InvoiceCheckCards';
import CustomerNamePicker from '@/components/operations/CustomerNamePicker';
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
  /** Last user who wrote or edited the payment date; written by the server. */
  paymentDateByName?: string;
  /** Data owner as computed by the server: whoever wrote the payment date, else whoever recorded the wallet purchase (the payer at the time), else the value imported from the operations platform. This keeps a row with a date, branch and amount from reading as unknown. See workflowController. */
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
  // Payment family (cash | tax); in edit mode it may hold any of the four kinds before saving.
  paymentType: string;
  /** Selected payment kind: credit-invoice, credit-cash, cash-3PL or cash-HT. See lib/paymentKind. */
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
  /** Linked customs transaction; a copy written by the server (services/customsOpsLink). */
  customsLink?: (CustomsLinkView & { clearance?: string | null }) | null;
  /** Customs column in the filters; computed on the server from `customsLink.refNumber`. */
  customsRef?: string;
}

const STAGE_CONFIG: Record<string, { label: string; color: string; bg: string }> = {
  draft: { label: 'Draft', color: 'text-slate-500', bg: 'bg-slate-500/20' },
  submitted_to_ops: { label: 'Submitted to Ops', color: 'text-blue-600', bg: 'bg-blue-500/20' },
  ops_completed: { label: 'Ops Completed', color: 'text-yellow-700', bg: 'bg-yellow-500/20' },
  submitted_to_collections: { label: 'To Collections', color: 'text-purple-600', bg: 'bg-purple-500/20' },
  completed: { label: 'Completed', color: 'text-green-600', bg: 'bg-green-500/20' },
};

// Two stable references shared by the unfiltered column and the column whose list was never opened, so each render does not create a new reference that invalidates the list computations.
const EMPTY_SET = new Set<string>();
const EMPTY_OPTIONS: ColumnFilterOption[] = [];
// Quiet card style, same as the receivables tree (components/collections/ReceivablesTree).
const CARD = 'flex w-full h-full min-w-0 items-center gap-3 rounded-2xl border border-slate-200 bg-white px-4 sm:px-5 py-3.5 text-start shadow-[0_1px_2px_rgba(15,23,42,0.04)] transition-colors hover:bg-slate-50/60';
const CARD_ON = '!border-slate-900 !bg-slate-50 ring-1 ring-slate-900/10';
const CARD_NUM = 'text-xl sm:text-2xl font-bold tabular-nums tracking-tight text-slate-900';
const CARD_LABEL = 'inline-flex items-start gap-1.5 text-xs font-medium text-slate-500 leading-snug';
const CARD_SUB = 'text-[10.5px] leading-snug text-slate-400';
// Columns whose filter-dropdown labels should be formatted as dates / money.
const DATE_FIELDS = new Set(['reportDate', 'paymentDate', 'sendingDate', 'branchDeliveryDate', 'deliveryDate', 'invoiceDate', 'collectionDate']);
const NUM_FIELDS = new Set(['purchaseValue', 'sellingValue', 'netInvoice', 'tax', 'totalInvoice', 'paymentAmount', 'collectedAmount']);

// Export columns
// Listed explicitly rather than derived from table order so the file shape stays fixed. Money columns are dropped for users without access: the server no longer sends them, and empty titled columns would read as no invoice instead of not shown to you.
const MONEY_EXPORT_KEYS = new Set([
  'netInvoice', 'tax', 'totalInvoice', 'invoiceDate', 'invoiceNotes', 'collectedAmount', 'collectionDate',
]);
const EXPORT_COLUMNS = [
  { header: 'رقم الطلب', key: 'reportNumber', width: 14 },
  { header: 'تاريخ الطلب', key: 'reportDate', width: 12 },
  { header: 'من', key: 'fromLocation', width: 14 },
  { header: 'إلى', key: 'toLocation', width: 14 },
  { header: 'الفرع', key: 'branch', width: 14 },
  { header: 'مالك السيارة', key: 'carOwner', width: 22 },
  { header: 'جوال المالك', key: 'ownerPhone', width: 14 },
  { header: 'رقم السيارة', key: 'carNumber', width: 14 },
  { header: 'اسم السيارة', key: 'carName', width: 16 },
  { header: 'حالة الشحنة', key: 'applicationStatus', width: 16 },
  { header: 'العميل', key: 'username', width: 20 },
  { header: 'هاتف العميل', key: 'userPhone', width: 14 },
  { header: 'قيمة الشراء', key: 'purchaseValue', width: 12 },
  { header: 'قيمة البيع', key: 'sellingValue', width: 12 },
  { header: 'السائق', key: 'driverName', width: 20 },
  { header: 'جوال السائق', key: 'driverPhone', width: 14 },
  { header: 'نوع الشاحنة', key: 'truckType', width: 14 },
  { header: 'حجم الشاحنة', key: 'truckSize', width: 12 },
  { header: 'نوع الحمولة', key: 'loadType', width: 14 },
  { header: 'الكمية', key: 'quantity', width: 10 },
  { header: 'المندوب', key: 'representativeName', width: 18 },
  { header: 'مراجعة العمليات', key: 'operationsReview', width: 14 },
  { header: 'تاريخ السداد', key: 'paymentDate', width: 12 },
  { header: 'مسؤول البيانات', key: 'dataOwnerShown', width: 22 },
  { header: 'فرع السداد', key: 'payingBranch', width: 14 },
  { header: 'مبلغ السداد', key: 'paymentAmount', width: 12 },
  { header: 'نوع الدفع', key: 'paymentType', width: 14 },
  { header: 'وجهة أمر النقل النهائية', key: 'finalReportDestination', width: 18 },
  { header: 'رقم المستند', key: 'documentNumber', width: 14 },
  { header: 'معاملة التخليص', key: 'customsRef', width: 14 },
  { header: 'البوليصة', key: 'customsBl', width: 18 },
  { header: 'الحاويات', key: 'customsContainers', width: 22 },
  { header: 'تاريخ الإرسال', key: 'sendingDate', width: 12 },
  { header: 'تاريخ التسليم للفرع', key: 'branchDeliveryDate', width: 14 },
  { header: 'تاريخ التسليم للعميل', key: 'deliveryDate', width: 14 },
  { header: 'مراجعة المحاسبة', key: 'accountingReview', width: 14 },
  { header: 'رقم الفاتورة', key: 'invoiceNumber', width: 14 },
  { header: 'صافي الفاتورة', key: 'netInvoice', width: 12 },
  { header: 'الضريبة', key: 'tax', width: 10 },
  { header: 'إجمالي الفاتورة', key: 'totalInvoice', width: 14 },
  { header: 'تاريخ الفاتورة', key: 'invoiceDate', width: 12 },
  { header: 'مبلغ التحصيل', key: 'collectedAmount', width: 12 },
  { header: 'تاريخ التحصيل', key: 'collectionDate', width: 12 },
];

// Filter bar columns
// The questions asked daily: customer, branch, route, payment kind, status, driver, vehicle, and whether the statement has an invoice. Other columns keep their own header filter. `invoiceState` is computed on the server: present, empty, or a placeholder such as no inv.
const BAR_FIELDS: (FilterBarField & { money?: boolean })[] = [
  { key: 'username', ar: 'العميل', en: 'Customer' },
  { key: 'branch', ar: 'الفرع', en: 'Branch' },
  { key: 'fromLocation', ar: 'من', en: 'From' },
  { key: 'toLocation', ar: 'إلى', en: 'To' },
  { key: 'paymentType', ar: 'نوع الدفع', en: 'Payment type' },
  { key: 'applicationStatus', ar: 'حالة الشحنة', en: 'Status' },
  { key: 'driverName', ar: 'السائق', en: 'Driver' },
  { key: 'carNumber', ar: 'رقم السيارة', en: 'Vehicle' },
  { key: 'carOwner', ar: 'مالك السيارة', en: 'Car owner' },
  { key: 'truckType', ar: 'نوع الشاحنة', en: 'Truck type' },
  { key: 'payingBranch', ar: 'الفرع المسدِّد', en: 'Paying branch' },
  { key: 'invoiceState', ar: 'رقم الفاتورة', en: 'Invoice number' },
  // Customs transaction: transaction numbers, and empty means not linked.
  { key: 'customsRef', ar: 'التخليص', en: 'Customs' },
];

export default function OperationsWorkflowPage() {
  const router = useRouter();
  const { user } = useAuth();
  const { lang } = useLanguage();
  const T = getOperationsTranslations(lang);
  const { notify } = useDialog();
  // One message text is used for both the tooltip and the alert so they cannot disagree.
  const gateMsg = lang === 'ar'
    ? 'لا يُسجَّل تاريخ السداد إلا بعد أن تصبح حالة الشحنة «استُلم السند». السداد إقرارٌ بوصول المال، ولا يصل قبل استلام السند — وتسجيله قبله يجعل التقارير المالية تَعُدُّ مبلغًا لم يُقبَض.'
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
  // The exclude-cancelled toggle persists until turned off and is saved per user.
  // Which section's rows to show; both by default.
  const [origin, setOrigin] = useState('');
  const [excludeCancelled, setExcludeCancelled] = useState<boolean>(() => {
    try { return localStorage.getItem('ops:excludeCancelled') === '1'; } catch { return false; }
  });
  const toggleExcludeCancelled = () => setExcludeCancelled((v) => {
    try { localStorage.setItem('ops:excludeCancelled', v ? '0' : '1'); } catch { /* */ }
    setPage(1);
    return !v;
  });
  // Rows per page is chosen by the user and saved for them. The server accepts at most 500; larger pages slow the table and nobody reads them.
  const [pageSize, setPageSize] = useState<number>(() => readPageSize('ops:pageSize'));
  const changePageSize = (n: number) => { setPageSize(n); setPage(1); savePageSize('ops:pageSize', n); };
  const [stageFilter, setStageFilter] = useState('');
  const [search, setSearch] = useState('');
  const [searchInput, setSearchInput] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  // Three period modes
  // This month and a given day are asked more often than a free range, and writing either as two endpoints is repetitive and error-prone (month ends, February, a day typed twice). The mode is chosen and the range derived from it; the free range remains.
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
  const riyadhToday = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Riyadh' }).format(new Date());
  const isToday = dateMode === 'day' && !!dayKey && dayKey === riyadhToday();
  const toggleToday = () => {
    if (isToday) { setDayKey(''); setDateFrom(''); setDateTo(''); setPage(1); return; }
    setDateMode('day'); setMonthKey(''); applyDay(riyadhToday());
  };
  const switchMode = (m: DateMode) => {
    setDateMode(m);
    // Switching mode clears the previous mode's selection; keeping it would leave a filter nobody can see.
    setDateFrom(''); setDateTo(''); setMonthKey(''); setDayKey(''); setPage(1);
  };
  const [error, setError] = useState('');
  const debounceRef = useRef<NodeJS.Timeout | null>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  // Scroll to the table from a count card: show these rows, not just how many.
  const tableRef = useRef<HTMLDivElement>(null);
  // The actions column changes width with its row icons, so the pinned column reads it live.
  const pinObserver = useRef<ResizeObserver | null>(null);
  const measurePinOffset = useCallback((th: HTMLTableCellElement | null) => {
    pinObserver.current?.disconnect();
    if (!th) return;
    const apply = () => th.closest('table')?.style.setProperty('--wf-pin', `${th.offsetWidth}px`);
    apply();
    pinObserver.current = new ResizeObserver(apply);
    pinObserver.current.observe(th);
  }, []);
  const [transitioningId, setTransitioningId] = useState<string | null>(null);
  const initialLoadDone = useRef(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkDeleting, setBulkDeleting] = useState(false);
  const [showPendingOnly, setShowPendingOnly] = useState(false);
  // Bonds not arrived as of the end of the filtered period (even if they arrived later).
  const [showPendingAsOf, setShowPendingAsOf] = useState(false);
  // Customs filter: all / linked / not linked / one transaction. `customs` in the URL lets the transaction page open the table on its statements (`?customs=<id>`).
  const [customsMode, setCustomsMode] = useState('');
  useEffect(() => {
    try {
      const v = new URLSearchParams(window.location.search).get('customs');
      if (v) setCustomsMode(v);
    } catch { /* */ }
  }, []);
  const [editingId, setEditingId] = useState<string | null>(null);
  // The row currently being edited; read by a save reply that arrives late (handleInlineSave).
  const editingRef = useRef<string | null>(null);
  useEffect(() => { editingRef.current = editingId; }, [editingId]);

  // Per-row save state
  // A choice that silently failed to stick kept recurring, so every save marks its row: saving, then done when the server replies, or a red failure with a retry button. Network failures are retried twice automatically before being reported. The page cannot be closed with a save pending or failed without a warning.
  const [saveState, setSaveState] = useState<Record<string, 'saving' | 'saved' | 'failed'>>({});
  const failedPatches = useRef<Record<string, Record<string, any>>>({});
  const markSave = useCallback((id: string, st: 'saving' | 'saved' | 'failed' | null) => {
    setSaveState((prev) => {
      const next = { ...prev };
      if (st) next[id] = st; else delete next[id];
      return next;
    });
    if (st === 'saved') setTimeout(() => setSaveState((prev) => (prev[id] === 'saved' ? (({ [id]: _x, ...rest }) => rest)(prev) : prev)), 2500);
  }, []);
  const pendingSaves = Object.values(saveState).filter((v) => v !== 'saved').length;
  useEffect(() => {
    if (!pendingSaves) return undefined;
    const warn = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ''; };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [pendingSaves]);
  const [editData, setEditData] = useState<Partial<Workflow>>({});
  // The row as it was before editing; compared on save so only changed fields are sent.
  const [editBase, setEditBase] = useState<Partial<Workflow>>({});
  // Which field's input to auto-focus after a click-to-edit (so a single click
  // on a cell drops you straight into typing).
  const [focusField, setFocusField] = useState<string | null>(null);
  // Fields pulled from the Operations Platform (read-only in this table; edit them at the source). Everything else is entered here and is click-to-edit. The stage is system-driven too.
  const SYSTEM_FIELDS = new Set<string>([
    'reportNumber', 'reportDate', 'fromLocation', 'toLocation', 'branch', 'carOwner',
    'carNumber', 'ownerType', 'executionStatus', 'applicationStatus', 'paymentMethod',
    // The selling value is not among them: its owner writes it here and it is pushed to the platform with it.
    'username', 'userPhone', 'taxIndicator', 'purchaseValue', 'loadingTime',
    'driverName', 'driverPhone', 'truckType', 'truckSize', 'loadType', 'quantity',
    'reference', 'representativeName', 'stage',
  ]);
  const [confirmModal, setConfirmModal] = useState<{ message: string; onConfirm: () => void } | null>(null);
  // Record payment for a batch
  // Receipts arrive in batches with one date and one branch; opening each row to type the same date was many chances for error.
  const [showBulkPay, setShowBulkPay] = useState(false);
  const [bulkPay, setBulkPay] = useState({ paymentDate: '', payingBranch: '', paymentType: '', finalReportDestination: '', documentNumber: '', sendingDate: '', branchDeliveryDate: '', deliveryDate: '', operationsReview: '' });
  // All filter results, not just the 50-row page
  // The table pages by 50 and selection covers the shown page. When this is chosen the table's own conditions are sent and the server selects everything that matches, with a confirmed count.
  const [allMatching, setAllMatching] = useState(false);
  const [bulkPaying, setBulkPaying] = useState(false);
  const [bulkResult, setBulkResult] = useState<{ message: string; skipped: { reportNumber: string; reason: string }[]; more?: number } | null>(null);
  // Excel-style column filters: column name to the set of allowed raw values. Sent to the server, which filters the whole table; not applied in the browser.
  const [colFilters, setColFilters] = useState<Record<string, Set<string>>>({});
  // Per-column values and row counts as computed by the server. Deriving them from the 50 loaded rows showed only some statuses, and downloading the whole table on the first filter froze the tab; the computation now runs in the database.
  const [colOptions, setColOptions] = useState<Record<string, { values: ColumnFilterOption[]; truncated: boolean }>>({});
  const [colLoading, setColLoading] = useState<Record<string, boolean>>({});
  const [openField, setOpenField] = useState<string | null>(null);
  // An open counter, not just the column name: reopening the same column must refetch its values, otherwise the list stays on a partial earlier search that the user takes for all values.
  const [openNonce, setOpenNonce] = useState(0);
  // Replies can arrive out of order: a fast search may return before an earlier one, showing an old keystroke's result over the latest. Only the last request is accepted.
  const optionsSeq = useRef<Record<string, number>>({});
  const hasColFilters = Object.keys(colFilters).length > 0;

  const role = user?.role || '';
  // Finance roles hold the same authority here as the system admin; see lib/financeAuthority.
  const full = ['super_admin', 'admin'].includes(role || '') || FINANCE_FULL_ROLES.includes(role || '');
  const canCreate = full || role === 'moderator';
  // role-only: the owner limited shipment deletion to these three; a section grant does not extend it.
  const canDelete = ['super_admin', 'admin', 'operations_manager'].includes(role);

  // Who sees what: ask the server, do not guess
  // These were three hand-written role lists next to a fourth map in `workflowController.ROLE_FIELD_ACCESS`, and four lists for one thing drift apart. For example Operations can write invoice columns on the server but could not see them in the table. They are now read from `/api/workflows/permissions`, the same map the server filters saves with, so a new role gets its fields from day one.
  const [myFields, setMyFields] = useState<Set<string> | null>(null);
  // What this reader may see (server-decided), independent of what it may write.
  const [view, setView] = useState<{ amounts?: boolean; selling?: boolean }>({});
  // Server-decided: whether this reader approves selling-price requests.
  const [canApproveSelling, setCanApproveSelling] = useState(false);
  useEffect(() => {
    if (!role) return;
    let alive = true;
    // `myFields` is this reader's fields as computed by the server; it alone knows roles created from the permissions screen (no key in `roleAccess`). `roleAccess` stays as a fallback for an older server.
    api.get<{ roleAccess: Record<string, string[]>; myFields?: string[]; view?: { amounts?: boolean; selling?: boolean }; canApproveSelling?: boolean }>('/api/workflows/permissions')
      .then((d) => { if (alive) { setMyFields(new Set(d?.myFields || d?.roleAccess?.[role] || [])); setView(d?.view || {}); setCanApproveSelling(!!d?.canApproveSelling); } })
      // A failed read opens nothing: an empty set means no fields, so financial columns stay hidden until the answer is known.
      .catch(() => { if (alive) setMyFields(new Set()); });
    return () => { alive = false; };
  }, [role]);
  const has = (f: string) => !!myFields?.has(f);

  // Invoice amounts (net invoice onward): finance, collections and top roles only — the server decides.
  const canViewFinancials = full || !!view.amounts;
  const canEditAccountingReview = full || has('accountingReview');
  const canEditOperationsReview = full || has('operationsReview');
  // Selling value: only for users on its list
  // The server neither sends it to others nor accepts writes from them, and the column is hidden with it so an empty cell is not read as no price.
  const canSeeSelling = has('sellingValue') || !!view.selling;

  // Columns a role may not see never reach the chooser, so it cannot offer them.
  const chooserColumns = useMemo<ChooserColumn[]>(() => {
    const ar = lang === 'ar';
    return [
      { key: 'reportNumber', label: T.thReportNumber, locked: true },
      { key: 'reportDate', label: T.thReportDate }, { key: 'fromLocation', label: T.thFrom }, { key: 'toLocation', label: T.thTo },
      { key: 'branch', label: T.thBranch }, { key: 'carOwner', label: T.thCarOwner }, { key: 'carNumber', label: T.thCarNumber },
      { key: 'applicationStatus', label: T.thApplication }, { key: 'username', label: T.thUsername }, { key: 'userPhone', label: T.thUserPhone },
      { key: 'purchaseValue', label: T.thPurchaseValue },
      ...(canSeeSelling ? [{ key: 'sellingValue', label: T.thSellingValue }] : []),
      { key: 'driverName', label: T.thDriverName }, { key: 'truckType', label: T.thTruckType }, { key: 'truckSize', label: T.thTruckSize },
      { key: 'representativeName', label: T.thRepresentative }, { key: 'operationsReview', label: T.thOpsReview },
      { key: 'paymentDate', label: T.thPaymentDate }, { key: 'dataOwnerShown', label: ar ? 'مسؤول البيانات' : 'Data owner' },
      { key: 'payingBranch', label: T.thPayingBranch }, { key: 'paymentAmount', label: T.thPaymentAmount }, { key: 'paymentType', label: T.thPaymentType },
      { key: 'finalReportDestination', label: ar ? 'وجهة أمر النقل النهائية' : 'Final destination' }, { key: 'documentNumber', label: T.thDocNumber },
      { key: 'customsRef', label: ar ? 'التخليص' : 'Customs' }, { key: 'sendingDate', label: T.thSendingDate },
      { key: 'branchDeliveryDate', label: T.thBranchDeliveryDate }, { key: 'accountingReview', label: T.thAccountingReview },
      { key: 'invoiceNumber', label: T.thInvoiceNumber },
      ...(canViewFinancials ? [{ key: 'netInvoice', label: T.thNetInvoice }, { key: 'tax', label: T.thTax }, { key: 'totalInvoice', label: T.thTotalInvoice }, { key: 'invoiceDate', label: T.thInvoiceDate }] : []),
      { key: 'deliveryDate', label: T.thDeliveryDate },
      ...(canViewFinancials ? [{ key: 'collectedAmount', label: T.thCollectedAmount }, { key: 'collectionDate', label: T.thCollectionDate }] : []),
    ];
  }, [T, lang, canSeeSelling, canViewFinancials]);
  const { visible: visibleCols, setVisible: setVisibleCols, isOn: colOn } = useVisibleColumns('ops:workflowColumns', chooserColumns);

  // Aggregates over the WHOLE matching dataset (all ~27k rows, not one page).
  const [stats, setStats] = useState<{
    total: number; pendingInvoices: number;
    pendingBondReceived: number; sumPurchaseValue: number; pendingAsOf: number; pendingAsOfDate: string; pendingAsOfFrom: string;
    byStage: Record<string, number>; byStatus: Record<string, number>; statusTotal: number;
    byOrigin: { orders: number; fleet: number };
  }>({ byOrigin: { orders: 0, fleet: 0 }, total: 0, pendingInvoices: 0, pendingBondReceived: 0, sumPurchaseValue: 0, pendingAsOf: 0, pendingAsOfDate: '', pendingAsOfFrom: '', byStage: {}, byStatus: {}, statusTotal: 0 });

  // Everything the server understands as a filter lives in one place, read by the table, stats, value lists and export, so none filters on a condition the others do not. Column values are sent repeated (`cf_x=a&cf_x=b`), not comma-joined, because values contain commas (owner names, invoice notes).
  const buildParams = useCallback(() => {
    const params = new URLSearchParams();
    if (stageFilter) params.append('stage', stageFilter);
    if (search) params.append('search', search);
    if (dateFrom) params.append('dateFrom', dateFrom);
    if (dateTo) params.append('dateTo', dateTo);
    if (showPendingOnly) params.append('pendingOnly', 'true');
    if (showPendingAsOf) params.append('pendingAsOf', 'true');
    if (customsMode) params.append('customs', customsMode);
    if (excludeCancelled) params.append('excludeCancelled', '1');
    if (origin) params.append('origin', origin);
    for (const [field, vals] of Object.entries(colFilters)) {
      // Accepts a set, array or string; an unexpected value shape used to throw inside the request, swallowing the error so the list was never returned.
      const list = vals instanceof Set || Array.isArray(vals) ? Array.from(vals as Iterable<string>) : (vals ? [String(vals)] : []);
      list.forEach((v) => params.append(`cf_${field}`, v));
    }
    return params;
  }, [origin, stageFilter, search, dateFrom, dateTo, showPendingOnly, showPendingAsOf, customsMode, colFilters, excludeCancelled]);

  // A stale reply must not overwrite a newer one
  // Search changes `search` and resets `page`, firing two requests: one with the new search and the old page, which returns empty. Whichever arrives last is shown, so a search could miss a statement until the page was reopened. The 6-second platform poll adds a third racing request that may carry pre-search state. Each request is numbered and only the latest reply is shown; any table that is filtered and live-updated needs this.
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
      params.append('limit', String(pageSize));
      const data = await api.get<any>(`/api/workflows?${params.toString()}`);
      if (!guard.isCurrent(mySeq)) return;   // A newer request superseded this one; ignore it.
      setWorkflows(data.workflows || []);
      setTotal(data.total || 0);
    } catch (err: any) {
      console.error(err);
    } finally {
      // The busy flag is always cleared
      // It was tied to the latest-wins guard, but they differ: the guard decides whose data is shown, the flag says the request that set it has finished. `workflow:updated` is broadcast to everyone on any edit, so with a team working a newer request nearly always supersedes, `isCurrent` never holds and the flag stays on forever.
      if (!isBackground) setSearching(false);
      if (guard.isCurrent(mySeq)) setLoading(false);
      initialLoadDone.current = true;
    }
  }, [buildParams, page, guard, pageSize]);

  // Initial load
  useEffect(() => { fetchWorkflows(); }, [fetchWorkflows]);

  // Fetch full-dataset aggregates for the summary cards whenever the server filters change; they reflect all matching rows, not just the loaded page.
  // The cards need the guard more than the table: the heaviest query is the unfiltered one (aggregating tens of thousands of rows), fired on first open. A quick filter returns first, then the older unfiltered reply overwrote it, so a card labelled by-filter showed the whole-table total. A wrong financial number labelled filtered is worse than none. The guard is independent of the table's, since a shared one would let each call invalidate the other.
  const statsGuard = useLatestRequest();
  const fetchStats = useCallback(async () => {
    const mine = statsGuard.begin();
    try {
      const data = await api.get<any>(`/api/workflows/stats?${buildParams().toString()}`);
      if (!statsGuard.isCurrent(mine)) return;   // A newer request superseded this one; ignore it.
      setStats({
        total: data.total || 0,
        byOrigin: { orders: data.byOrigin?.orders || 0, fleet: data.byOrigin?.fleet || 0 },
        pendingInvoices: data.pendingInvoices || 0,
        pendingBondReceived: data.pendingBondReceived || 0,
        pendingAsOf: data.pendingAsOf || 0,
        pendingAsOfDate: data.pendingAsOfDate || '',
        pendingAsOfFrom: data.pendingAsOfFrom || '',
        sumPurchaseValue: data.sumPurchaseValue || 0,
        byStage: data.byStage || {},
        byStatus: data.byStatus || {},
        statusTotal: data.statusTotal || 0,
      });
    } catch { /* non-critical */ }
  }, [buildParams, statsGuard]);
  useEffect(() => { fetchStats(); }, [fetchStats]);

  // Values of one column when its list opens. The request carries all active filters so the server returns only reachable values; a list of values with no rows invites a choice that yields an empty table.
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

  // Any filter change invalidates the cached lists; the open column's list is refetched immediately so the user sees the effect on available values.
  useEffect(() => {
    setColOptions((prev) => (openField && prev[openField] ? { [openField]: prev[openField] } : {}));
    if (openField) fetchColOptions(openField);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fetchColOptions, openField, openNonce]);

  // Selection is cleared on any filter or page change: ticked rows are no longer shown, and a bulk delete would hit rows the user cannot see.
  useEffect(() => { setSelectedIds(new Set()); setAllMatching(false); }, [stageFilter, search, page, dateFrom, dateTo, showPendingOnly, showPendingAsOf, customsMode, colFilters]);

  const setColFilter = (field: string, set: Set<string>) => {
    // Filtering changes the page count; staying on page 7 after a filter with two pages of results would show an empty table that looks like no matches.
    setPage(1);
    setColFilters((prev) => {
      const next = { ...prev };
      if (set.size === 0) delete next[field]; else next[field] = set;
      return next;
    });
  };

  const clearColFilters = () => { setColFilters({}); setPage(1); };

  // WebSocket real-time updates.
  // A new row is inserted at the top, which is right only in the full view; in a filtered result or on a later page it is wrong because a non-matching row would appear among matches. Leave it to the refresh to bring it if it belongs to the view.
  const handleCreated = useCallback((wf: Workflow) => {
    const filtered = !!search || !!dateFrom || !!dateTo || showPendingOnly || !!customsMode || Object.keys(colFilters).length > 0;
    setTotal((t) => t + 1);
    if (filtered || page !== 1) return;
    setWorkflows((p) => [wf, ...p]);
  }, [search, dateFrom, dateTo, showPendingOnly, customsMode, colFilters, page]);
  // Full row replaced, short notice reloads
  // Some broadcasts carry the whole row (an edit from the screen); others are a short notice such as `{ _id, fromWallet }` from the wallet or `{ bulk: true }` from collections. The short one used to replace the row, blanking it until refresh, and `bulk` updated nothing. Short notices now reload the page in the background, batched so a burst causes one reload.
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
      draft: [{ stage: 'submitted_to_ops', label: T.submitToOps, roles: ['moderator', 'super_admin', 'admin', ...FINANCE_FULL_ROLES] }],
      submitted_to_ops: [
        { stage: 'ops_completed', label: T.markOpsComplete, roles: ['operations_manager', 'super_admin', 'admin', ...FINANCE_FULL_ROLES] },
        { stage: 'draft', label: T.returnToDraft, roles: ['operations_manager', 'super_admin', 'admin', ...FINANCE_FULL_ROLES] },
      ],
      ops_completed: [
        { stage: 'submitted_to_collections', label: T.submitToCollections, roles: ['operations_manager', 'super_admin', 'admin', ...FINANCE_FULL_ROLES] },
        { stage: 'submitted_to_ops', label: T.returnToOps, roles: ['operations_manager', 'super_admin', 'admin', ...FINANCE_FULL_ROLES] },
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
   * Table conditions as the server reads them
   * Search, column filters, filter bar, range and cards all go through `buildParams`, the same one that fetched the table and count. Repeated values (`cf_x=a&cf_x=b`) are arrays.
   */
  const currentQuery = () => {
    const query: Record<string, string | string[]> = {};
    buildParams().forEach((v, k) => {
      const cur = query[k];
      query[k] = cur === undefined ? v : Array.isArray(cur) ? [...cur, v] : [cur, v];
    });
    return query;
  };
  // Number of rows a bulk action targets: the selection on the page, or all filter results.
  const selectedCount = allMatching ? total : selectedIds.size;
  // Sent with each bulk action: the ids, or the conditions plus the count the user confirmed (the server rejects if the filter now matches more; see idsForAllMatching).
  const selectionPayload = () => (allMatching
    ? { allMatching: true, query: currentQuery(), expectedCount: total }
    : { ids: Array.from(selectedIds) });

  const handleBulkDelete = () => {
    if (selectedCount === 0) return;
    const n = selectedCount;
    setConfirmModal({
      message: allMatching
        ? (lang === 'ar'
          ? `سيُحذف ${n.toLocaleString('en-US')} أمر نقل — كلُّ نتائج الفلتر الحاليّ في كلّ الصفحات، لا الصفحةُ المعروضة وحدَها. لا يمكن التراجع. متابعة؟`
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

  // `over`: values saved immediately along with the edit; a payment-kind choice is saved the moment it is chosen.
  const editDataState = editData;
  const handleInlineSave = async (over?: Record<string, any>) => {
    if (!editingId) return;
    const editData = { ...editDataState, ...(over || {}) };
    // Send what changed, not the whole row
    // The screen used to send the entire document, including id, creator, locks and system dates, rewriting thirty fields to change one and having half of them rejected as outside the role. Comparing with the pre-edit copy makes the request carry only what the user meant.
    const patch: Record<string, any> = {};
    for (const k of Object.keys(editData)) {
      const a = (editData as any)[k]; const b = (editBase as any)[k];
      if (a !== b && typeof a !== 'object') patch[k] = a;
    }
    if (!Object.keys(patch).length) { handleInlineCancel(); return; }
    // What was sent is not sent again nor awaited before opening another row
    // Moving to another row before the reply made the row look unsaved, so it was saved again and awaited, delaying the next row by two seconds or more and losing the user's choice. A sent row becomes the new baseline immediately.
    setEditBase((prev) => ({ ...prev, ...patch }));
    try {
      const savedId = editingId;
      const r = await putWithRetry(savedId, patch);
      // A server rejection is reported so the user does not assume it was saved.
      if (r && r.refusedMessage) setError(r.refusedMessage);
      // Held for approval: the row keeps its old price, the user is told why.
      if (r && (r as any).sellingRequestMessage) notify((r as any).sellingRequestMessage, 'info');
      // Selling value: report where it was written, the platform and here, or here only (a statement not from the platform).
      if (r && typeof (r as any).sellingPlatform === 'boolean') {
        notify((r as any).sellingPlatform
          ? (lang === 'ar' ? 'حُفظت قيمة البيع هنا وفي منصّة التشغيل' : 'Selling value saved here and on the platform')
          : (lang === 'ar' ? 'حُفظت قيمة البيع — أمر النقل ليس من منصّة التشغيل' : 'Selling value saved — not a platform shipment'), 'success');
      }
      // A reply must not close a row opened after it
      // The save reply for row A used to close all edit mode even if it arrived after the user moved to row B and opened its list, removing the list from under them and losing the choice. Edit mode closes only if it is still on the same row.
      if (editingRef.current === savedId) {
        setEditingId(null);
        setEditData({});
        setEditBase({});
        setFocusField(null);
      }
      // The row is written from the save reply, not a new fetch
      // Save used to be followed by a full page fetch. The save reply is the row after saving, including what the server derived (zeroed invoice columns for cash, payment kind from the customer file). A fetch asks for what is already in hand and opens a race: a reply fired before the save can arrive after it and wipe the edit from the screen.
      if (r && r._id) setWorkflows((prev) => prev.map((w) => (w._id === savedId ? { ...w, ...r } : w)));
      fetchStats();
    } catch (err: any) { setError(err.message); }
  };

  /** The save itself, marked on the row, with two more attempts if the network drops. A server error (permission, rule) is not retried: it is reported as is and the row stays red with a retry button until fixed. Success clears earlier failures on the same row. */
  const putWithRetry = async (id: string, patch: Record<string, any>) => {
    markSave(id, 'saving');
    let lastErr: any = null;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const r = await api.put<Workflow & { refusedMessage?: string }>(`/api/workflows/${id}`, patch);
        delete failedPatches.current[id];
        markSave(id, 'saved');
        return r;
      } catch (err: any) {
        lastErr = err;
        if (err && typeof err.status === 'number') break;     // The server rejected it; not retried.
        if (attempt < 2) await new Promise((res) => setTimeout(res, 1200 * (attempt + 1)));
      }
    }
    failedPatches.current[id] = { ...(failedPatches.current[id] || {}), ...patch };
    markSave(id, 'failed');
    throw lastErr;
  };
  const retrySave = async (id: string) => {
    const patch = failedPatches.current[id];
    if (!patch) { markSave(id, null); return; }
    try {
      const r = await putWithRetry(id, patch);
      if (r && r._id) setWorkflows((prev) => prev.map((w) => (w._id === id ? { ...w, ...r } : w)));
      fetchStats();
    } catch (err: any) { setError(err.message); }
  };

  const handleInlineCancel = () => {
    setEditingId(null);
    setEditData({});
    setEditBase({});
    setFocusField(null);
  };

  // Enter row-edit mode from a single cell click and remember which field to focus; skips locked rows.
  // Single entry to edit mode: the pen button used to set `editingId` and `editData` but forget `editBase`, so save compared against a stale or missing copy and sent the whole row (56 fields, some outside the role), and the server rejected most of them on a valid edit. The three are set together here or not at all.
  const beginEditField = async (wf: Workflow, field: string | null) => {
    if (isLockedByOther(wf)) return;
    // Edits made in another row are saved before moving
    // Clicking a cell in another row used to drop the edit unsaved: the choice showed at once then reverted, so payment kind seemed unchangeable.
    if (editingId && editingId !== wf._id) {
      const dirty = Object.keys(editData).some((k) => (editData as any)[k] !== (editBase as any)[k] && typeof (editData as any)[k] !== 'object');
      if (dirty) await handleInlineSave();
    }
    editingRef.current = wf._id;
    setEditingId(wf._id);
    setEditData({ ...wf });
    setEditBase({ ...wf });
    setFocusField(field);
  };

  // Accounting review is a one-click checklist toggle (done / not); no row edit.
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

  // Operations review is a one-click checklist toggle (done / not); no row edit.
  // Order status is changed here and written there
  // The column mirrors the operations platform: the write goes to it first (the server handles it), then our row returns with what settled there, so the cell does not change then revert on the next sync. Hence no optimistic display; the platform is awaited.
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
    // Unfilled fields are not sent: an empty field in a batch means leave this column alone, not clear it, and clearing a hundred rows by mistake is worse than not writing them.
    const fields: Record<string, any> = Object.fromEntries(
      Object.entries(bulkPay).filter(([, v]) => String(v || '').trim()));
    // Clearing the mark is a deliberate empty value
    // The rule above drops empties because they mean leave this column alone, but removing the review mark is a wanted empty, so it is passed explicitly with a special value that cannot be confused with an unfilled field.
    if (bulkPay.operationsReview === 'clear') fields.operationsReview = '';
    if (!Object.keys(fields).length) return;
    const run = async () => {
      setBulkPaying(true); setBulkResult(null);
      try {
        const picked = allMatching ? null : new Set(selectedIds);
        const r = await api.post<{ message: string; skipped?: { reportNumber: string; reason: string }[]; skippedCount?: number }>(
          '/api/workflows/bulk-update', { ...selectionPayload(), fields });
        const skipped = r.skipped || [];
        setBulkResult({ message: r.message, skipped, more: Math.max(0, (r.skippedCount || skipped.length) - skipped.length) });
        // Saved values show at once
        // After selecting fifty statements, operations review did not update: the server wrote them all but the page did not refetch the list, so old cells remained. The screen does not wait for the refetch: selected rows take the saved values immediately (unset ones stay), then the list is refetched twice for server-derived values.
        if (picked) {
          const skippedNos = new Set(skipped.map((x) => String(x.reportNumber)));
          const shown: Record<string, any> = { ...fields };
          if (shown.paymentType && !['cash', 'tax', ''].includes(String(shown.paymentType))) {
            shown.paymentSubtype = shown.paymentType;
            shown.paymentType = shown.paymentType === 'deferred_invoice' ? 'tax' : 'cash';
          }
          setWorkflows((prev) => prev.map((w) => (picked.has(w._id) && !skippedNos.has(String(w.reportNumber)) ? { ...w, ...shown } : w)));
        }
        notify(r.message || (lang === 'ar' ? 'تم الحفظ' : 'Saved'), skipped.length ? 'error' : 'success');
        if (!skipped.length) {
          setShowBulkPay(false); setSelectedIds(new Set()); setAllMatching(false);
          setBulkPay({ paymentDate: '', payingBranch: '', paymentType: '', finalReportDestination: '', documentNumber: '', sendingDate: '', branchDeliveryDate: '', deliveryDate: '', operationsReview: '' });
        }
        fetchWorkflows(true); fetchStats();
        // The other server worker clears its cache within a second; the second refetch catches what the first missed.
        setTimeout(() => { fetchWorkflows(true); fetchStats(); }, 1500);
      } catch (err: any) {
        // The count changed between confirmation and execution (409): report the new count and refresh; nothing is written.
        setBulkResult({ message: err.message, skipped: [] });
        fetchWorkflows(true); fetchStats();
      }
      setBulkPaying(false);
    };
    // All filter results are confirmed by count
    // Thousands of statements in one click: state the exact count and what will be written before writing.
    if (allMatching) {
      const names = Object.keys(fields).length;
      setConfirmModal({
        message: lang === 'ar'
          ? `سيُطبَّق التعديل (${names} ${names === 1 ? 'عمود' : 'أعمدة'}) على ${total.toLocaleString('en-US')} أمر نقل — كلُّ نتائج الفلتر الحاليّ في كلّ الصفحات. متابعة؟`
          : `Apply this change (${names} field${names === 1 ? '' : 's'}) to ${total.toLocaleString('en-US')} reports — every result of the current filter. Continue?`,
        onConfirm: () => { setConfirmModal(null); run(); },
      });
      return;
    }
    run();
  };

  const toggleSelect = (id: string) => {
    // Deselecting a row from all results reverts the selection to the page's rows; no rows are excluded from a condition of which only fifty are visible.
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
   * Export goes through the API client, not `window.open`.
   * The old way opened a tab on a relative path, but the server is on a different domain than the frontend and session cookies are bound to the server's, so the request arrived unauthenticated and returned Authentication required on a blank page. There are three scopes: the shown page, everything matching the filter, or the whole table. They differ: filtering to 200 rows while the screen shows 50 makes exporting the shown page give a fifth of what was asked.
   */
  /**
   * The row as read, not as stored.
   * Statuses are stored as raw keys (`bond_received`) and shown translated. The file goes to people who do not open the system (an accountant, an external reviewer), so raw keys would be unreadable to them.
   */
  const exportRow = (w: Workflow) => ({
    ...w,
    carOwner: w.carOwner || (w as any).ownerName || '',
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
    customsContainers: w.customsLink?.clearance ? (w.customsLink.containers || []).join('، ') : '',
    executionStatus: trStatus(w.executionStatus),
    applicationStatus: trStatus(w.applicationStatus),
    paymentMethod: trPayment(w.paymentMethod),
    paymentType: paymentKindLabel(paymentKindOf(w), lang === 'ar'),
    operationsReview: w.operationsReview ? (lang === 'ar' ? 'تمّت' : 'Done') : '',
    accountingReview: w.accountingReview ? (lang === 'ar' ? 'تمّت' : 'Done') : '',
  });

  /** The shown page only: its rows are in hand, so the file is built here immediately. */
  const exportSheets = async (onlySelected = false) => [{
    name: lang === 'ar' ? 'الطلبات' : 'Workflows',
    rows: (onlySelected ? workflows.filter((w) => selectedIds.has(w._id)) : workflows).map(exportRow) as unknown as Record<string, any>[],
    columns: EXPORT_COLUMNS.filter((c) => (canViewFinancials || !MONEY_EXPORT_KEYS.has(c.key)) && (canSeeSelling || c.key !== 'sellingValue')),
  }];

  /**
   * The large table is built on the server
   * Exporting the whole table fetched about 35,000 raw rows (37 MB of JSON) and built the workbook on the rendering thread, freezing the screen. The database is not slow (the indexed sort takes 42 ms). The server now builds a compressed file and only that crosses the browser. Columns and translations there match these exactly, and role-based hiding is applied on the server too, so no money leaves in the file that the screen hides.
   */
  const downloadServerFile = async (scope: 'filtered' | 'all') => {
    const p = scope === 'all' ? new URLSearchParams() : buildParams();
    p.delete('page'); p.delete('limit');
    if (scope === 'all') p.set('scope', 'all');

    // The whole table is built in the background
    // About 36,000 rows and half a minute of building: do not wait before a frozen screen, and do not lose the work if the page closes. The request is recorded, downloaded when ready, and a notification with the link is sent anyway. See lib/backgroundExport.
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

  // All card figures are computed on the server over the full matching row set, not the 50 shown rows. Computing from loaded rows would always show 50, or require downloading the whole table to be correct.
  /**
   * Shipment status cards
   * These were only on the platform shipments page, yet are the first question here too: how many are on the way, how many arrived without a returned bond. The old shortcut sent users to that page instead of answering.
   * Counts come from the server over the full row set under all other filters except the status filter itself: someone filtering on the way wants to see the other statuses to switch to, not zeros, as Excel does.
   */
  const statusSel = colFilters.applicationStatus || EMPTY_SET;
  /**
   * Cards are a multi-select, not a radio button
   * A click used to write `new Set([key])`, replacing the previous choice, so on the way plus arrived together was impossible, and it is the most common question. A click now adds or removes a status, an empty set means all (a filter with an empty set would read as nothing), and the all card clears them.
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

  // Display is translated while filtering uses the raw value: the database stores `bond_received` and the user reads its label, so filtering on displayed text would change results with the UI language.
  const colFormat = (field: string): ((v: any) => string) | undefined => {
    if (field === 'stage') return (v: any) => stageLabels[v] || v;
    if (field === 'executionStatus' || field === 'applicationStatus') return trStatus;
    if (field === 'paymentMethod') return trPayment;
    // The stored value is a key and the displayed one its name, for all six (the four kinds, plus the legacy tax and cash for rows with no kind). The list says what the cell says.
    if (field === 'paymentType') return (v: any) => paymentKindLabel(v, lang === 'ar') || String(v || '');
    // The server groups dates by Riyadh day and returns them as YYYY-MM-DD. Reinterpreting them in the browser timezone loses a day west of Greenwich, so they are shown as they are.
    if (DATE_FIELDS.has(field)) return (v: any) => {
      const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(v || ''));
      return m ? `${m[3]}/${m[2]}/${m[1]}` : formatDate(String(v || ''));
    };
    // Values arrive from the server as strings; money formatting needs a number, otherwise the raw number shows without separators or decimals and differs from the same figure in the table.
    if (NUM_FIELDS.has(field)) return (v: any) => formatMoney(Number(v));
    return undefined;
  };

  const ColHead = (field: keyof Workflow, label: string, color = 'text-slate-300', pinned = false) => (!colOn(field as string) ? null : (
    <th className={`px-3 py-3 text-start text-xs font-semibold whitespace-nowrap ${pinned ? 'sticky z-20 bg-slate-900' : ''}`}
      style={pinned ? { insetInlineStart: 'var(--wf-pin, 0px)' } : undefined}>
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
  ));

  /**
   * Select all results: the familiar pattern
   * The header checkbox selects the shown page (50). If filter results exceed it, that is stated under the search with an option to select them all; once selected, every bulk action (payment, edit, delete, export selection) runs on the condition on the server. (An element, not a component defined inside render; see inline-components-remount.)
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

      {/* The eleven status cards were removed. All, ordered, ..., cancelled became values in the filter bar under search (shipment status), each with its count, and one line fits customer, branch, route and payment kind too instead of eleven boxes for one column. */}

      {/* Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
        <h1 className="text-2xl font-bold text-slate-900 flex items-center gap-2">
          <ClipboardList className="w-6 h-6 text-[#f37121]" />
          {T.title}
        </h1>
        <div className="flex items-center gap-2 flex-wrap">
          {canApproveSelling && <SellingRequestsButton ar={lang === 'ar'} />}
          {canDelete && selectedCount > 0 && (
            <button type="button" onClick={handleBulkDelete} disabled={bulkDeleting} className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-red-600 hover:bg-red-700 text-white text-sm font-medium transition-colors disabled:opacity-50">
              {bulkDeleting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />} {T.deleteCount} ({selectedCount.toLocaleString('en-US')})
            </button>
          )}
          {/* Record payment for a batch Shown when something is selected, and only filled fields are sent: an empty field means leave this column alone, not clear it. The server checks each row separately: a row whose bond was not received gets no payment recorded and is reported by name. */}
          {selectedCount > 0 && (
            <div className="relative">
              <button type="button" onClick={() => { setShowBulkPay((p) => !p); setBulkResult(null); }}
                className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-purple-600 hover:bg-purple-700 text-white text-sm font-medium transition-colors">
                <CheckSquare className="w-4 h-4" /> {lang === 'ar' ? 'تسجيل سداد' : 'Record payment'} ({selectedCount.toLocaleString('en-US')})
              </button>
              {showBulkPay && (
                <div className="absolute top-full mt-2 end-0 bg-white border border-slate-200 rounded-xl shadow-xl z-50 p-4 w-[340px] max-w-[calc(100vw-2rem)] overflow-visible" onClick={(e) => e.stopPropagation()}>
                  {/* Applies to the selection on this page, or to all filter results across all pages. */}
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
                    {/* Payment kind, chosen for specific statements (a hand choice sticks and derivation does not overwrite it). */}
                    <div>
                      <label className="block text-xs font-semibold text-slate-600 mb-1">{lang === 'ar' ? 'نوع الدفع' : 'Payment type'}</label>
                      <select value={bulkPay.paymentType} onChange={(e) => setBulkPay((p) => ({ ...p, paymentType: e.target.value }))}
                        title={lang === 'ar' ? 'نوع الدفع' : 'Payment type'}
                        className="w-full px-2 py-2 rounded-lg border border-slate-300 text-sm bg-white">
                        <option value="">{lang === 'ar' ? '— لا يُغيَّر —' : '— leave unchanged —'}</option>
                        {/* Only the four; the legacy tax and cash can no longer be chosen (see lib/paymentKind). */}
                        {PAYMENT_CHOICES.map((k) => <option key={k} value={k}>{paymentKindLabel(k, lang === 'ar')}</option>)}
                      </select>
                    </div>
                    {/* Final destination with the paying branch Two adjacent questions answered in one session: who paid, and where the file ends up. The second used to be written row by row after the first was written to fifty at once. */}
                    <div>
                      <label className="block text-xs font-semibold text-slate-600 mb-1">{lang === 'ar' ? 'وجهة أمر النقل النهائية' : 'Final destination'}</label>
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
                    {/* The two dates stack, not side by side They were two columns inside a 320px card, and a date field cannot compress below a limit, so delivery overflowed the card edge. The card is slightly wider and the dates take two lines, so nothing overflows however narrow the screen. */}
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
                    {/* Operations review is a mark, not text A single row sets it with a click that writes done or clears it, and the export reads it as yes or no. The batch button was a free text box that wrote anything into the column, so a note naming a person read as done in the file and table. It is now a two-option list like the single row. Removing the mark is not an ignored empty; see handleBulkPay. */}
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
                    {/* Customer delivery is not bulk-filled from here The customer's payment term starts from it, so it is an event recorded per invoice on the day it reaches the customer, written by Collections from the Deliver button on the invoices page. Writing one date on fifty transport orders would start fifty terms on a day nobody received. */}
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
          {/* Upload invoice data from the sales sheet, for users who hold the invoice columns. */}
          {canViewFinancials && <InvoiceImportButton ar={lang === 'ar'} onDone={() => fetchWorkflows(true)} />}
          {/* Export: the shared button, not a hand-written one This screen alone drew its own menu, looking like a text strip next to the system's buttons. The shared button has the same icon, arrow and state across ninety screens, and one differing screen makes users hunt for export as if it were another system. Three scopes with a count beside each: filtering to 200 rows while the screen shows 50 means exporting the shown page gives a fifth of what was asked. */}
          <ColumnChooser columns={chooserColumns} visible={visibleCols} onChange={setVisibleCols} ar={lang === 'ar'} />
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

      {/* Quiet cards Each card used to have its own colour (amber, pink, blue, green), competing for the eye so the alert was unclear. They now match the receivables tree: white, ink-coloured numbers, a small type dot, and red only for a contradiction. The active card has a dark border. (The two bond-not-received cards for cash and tax were removed: the total is enough, and the split by kind is in the filter bar's payment kind column.) */}
      {/* Cards sit above the filters in an equal grid Numbers first, then filter and search tools. They were a wrapping row whose widths came out uneven, so they are now a grid: one column on very narrow screens, two on phones, four on wide screens. */}
      <div className="grid grid-cols-1 min-[420px]:grid-cols-2 lg:grid-cols-4 gap-3">
        {/* Pending Invoices — over ALL matching rows (click to filter) */}
        <button
          type="button"
          onClick={() => { setShowPendingOnly(!showPendingOnly); setShowPendingAsOf(false); setPage(1); }}
          className={`${CARD} ${showPendingOnly && !(statusSel.has('bond_received') && statusSel.size === 1) ? CARD_ON : ''}`}
        >
          {/* The figure states its rule Bonds not received alone does not let you reconcile the number with an external sheet: are cancelled ones included? The rule is written under the number so it can be checked without asking. */}
          <AlertCircle className="h-4 w-4 shrink-0 text-slate-400" />
          <div className="flex flex-col items-start">
            <span className={CARD_NUM}>{pendingCount.toLocaleString('en-US')}</span>
            <span className={CARD_LABEL}><span className="inline-block h-1.5 w-1.5 rounded-full bg-amber-500" />{lang === 'ar' ? 'سندات لم تصل' : 'Pending Bonds'}</span>
            <span className={CARD_SUB}>
              {lang === 'ar' ? 'بلا تاريخ سداد · عدا الملغاة' : 'no payment date · excludes cancelled'}
            </span>
          </div>
        </button>

        {/* Bonds not arrived AS OF the end of the filtered period — even if they arrived later. */}
        <button
          type="button"
          onClick={() => { const on = !showPendingAsOf; setShowPendingAsOf(on); if (on) setShowPendingOnly(false); setPage(1); }}
          title={lang === 'ar' ? 'أوامر النقل التي لم يصل سندُها حتى نهاية الفترة المفلترة — ولو وصل بعدها' : 'Bonds not arrived by the end of the filtered period — even if they arrived later'}
          className={`${CARD} !border-violet-200 !bg-violet-50/60 ${showPendingAsOf ? '!border-violet-600 ring-1 ring-violet-600' : ''}`}
        >
          <HistoryIcon className="h-4 w-4 shrink-0 text-violet-500" />
          <div className="flex flex-col items-start">
            <span className={`${CARD_NUM} !text-violet-800`}>{stats.pendingAsOf.toLocaleString('en-US')}</span>
            <span className={CARD_LABEL}><span className="inline-block h-1.5 w-1.5 rounded-full bg-violet-500" />{lang === 'ar' ? 'سندات لم تصل وقتها' : 'Bonds pending at the time'}</span>
            <span className={CARD_SUB}>
              {lang === 'ar'
                ? `${stats.pendingAsOfFrom ? `من ${stats.pendingAsOfFrom.split('-').reverse().join('/')} ` : ''}حتى ${stats.pendingAsOfDate ? new Date(stats.pendingAsOfDate).toLocaleDateString('en-GB', { timeZone: 'Asia/Riyadh' }) : 'الآن'}${dateTo ? '' : ' — اختر يومًا لتعود بالزمن'}`
                : `${stats.pendingAsOfFrom ? `from ${stats.pendingAsOfFrom.split('-').reverse().join('/')} ` : ''}to ${stats.pendingAsOfDate ? new Date(stats.pendingAsOfDate).toLocaleDateString('en-GB', { timeZone: 'Asia/Riyadh' }) : 'now'}${dateTo ? '' : ' — pick a day to go back in time'}`}
            </span>
          </div>
        </button>

        {/* Fourth card: bond received but no payment date The intersection of no payment date and bond received is where work is needed: a missing date to enter or a status to fix. It is the only contradiction here, so it gets red. */}
        <button
          type="button"
          onClick={() => {
            const on = showPendingOnly && statusSel.has('bond_received') && statusSel.size === 1;
            setShowPendingOnly(!on);
            toggleStatusCard(on ? '' : 'bond_received');
            if (!on) setTimeout(() => tableRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 60);
          }}
          title={lang === 'ar'
            ? 'صفّي على: سندات لم تصل + حالة الشحنة «استُلم السند»'
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

        {/* Clicking scrolls down to the rows it counts. */}
        <button
          type="button"
          onClick={() => tableRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })}
          title={lang === 'ar' ? 'اعرض هذه الصفوف في الجدول' : 'Show these rows in the table'}
          className={CARD}
        >
          <ClipboardList className="h-4 w-4 shrink-0 text-slate-400" />
          <div className="flex flex-col items-start">
            <span className={CARD_NUM}>{filteredRowsCount.toLocaleString('en-US')}</span>
            <span className={CARD_LABEL}><span className="inline-block h-1.5 w-1.5 rounded-full bg-slate-400" />{lang === 'ar' ? 'أوامر النقل (حسب الفلتر)' : 'Transport orders (filtered)'}</span>
            {(statusSel.size > 0 || showPendingOnly || showPendingAsOf) && (
              <span className={CARD_SUB}>
                {[
                  statusSel.size ? trStatus([...statusSel][0]) : '',
                  showPendingOnly ? (lang === 'ar' ? 'سندات لم تصل' : 'pending bonds') : '',
                  showPendingAsOf ? (lang === 'ar' ? 'سندات لم تصل وقتها' : 'pending at the time') : '',
                ].filter(Boolean).join(' · ')}
              </span>
            )}
          </div>
        </button>

        {/* Both sections keep their count while one is selected; a second click clears it. */}
        {([
          ['orders', lang === 'ar' ? 'طلبات الشحنات' : 'Shipment orders', stats.byOrigin.orders],
          ['fleet', lang === 'ar' ? 'إدارة الأسطول' : 'Fleet management', stats.byOrigin.fleet],
        ] as const).map(([key, label, count]) => (
          <button
            key={key}
            type="button"
            onClick={() => { setOrigin(origin === key ? '' : key); setPage(1); }}
            title={lang === 'ar' ? 'اعرض هذا القسم فقط' : 'Show this section only'}
            className={`${CARD} ${origin === key ? 'ring-2 ring-slate-400' : ''}`}
          >
            <ClipboardList className="h-4 w-4 shrink-0 text-slate-400" />
            <div className="flex flex-col items-start">
              <span className={CARD_NUM}>{count.toLocaleString('en-US')}</span>
              <span className={CARD_LABEL}><span className="inline-block h-1.5 w-1.5 rounded-full bg-slate-400" />{label}</span>
            </div>
          </button>
        ))}

        {/* Total purchase value, for users who hold the field itself (`purchaseValue`). */}
        {(full || has('purchaseValue')) && (
          <div className={`${CARD} cursor-default hover:bg-white`}>
            <FileSpreadsheet className="h-4 w-4 shrink-0 text-slate-400" />
            <div className="flex flex-col items-start">
              <span className={CARD_NUM}>{filteredPurchaseSum.toLocaleString('en-US', { maximumFractionDigits: 2 })}</span>
              <span className={CARD_LABEL}><span className="inline-block h-1.5 w-1.5 rounded-full bg-slate-400" />{lang === 'ar' ? 'مجموع قيمة الشراء (حسب الفلتر)' : 'Total purchase value (filtered)'}</span>
            </div>
          </div>
        )}

        {/* The four invoice-check cards, for users who hold the invoice columns. See InvoiceCheckCards. */}
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
        {/* The stage filter was removed The stages (draft / sent to operations / operations done / to collections / done) were designed when transport orders were created here and moved between our sections. They now arrive from the operations platform already past that, so everything stays draft: five buttons, four always empty. The real status is a table column with its own filters. */}
      </div>

      {/* Search directly above the table It was at the page top above the cards and bar, so the user typed then scrolled down to see the effect. It is a question about table rows, so it belongs where they change. */}
      <div className="flex flex-col gap-2">
        {/* Search, customs and range on one row Each was its own row, making the page long before the table; they are now one row that wraps on narrow screens. */}
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative min-w-[220px] flex-1 basis-[260px] max-w-xl" data-search-box>
            {/* The magnifier is not swapped for a spinner The icon turned into a spinner on every refresh, so the field flickered and lost its mark. It was also wrong: `searching` rises on page, filter and range changes, so it claimed a search was running for someone paging. Refresh is shown above the table, where things change. */}
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
          <select value={origin} onChange={(e) => { setOrigin(e.target.value); setPage(1); }} title={lang === 'ar' ? 'المصدر' : 'Source'}
          className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700">
          <option value="">{lang === 'ar' ? 'الشحنات والحمولات' : 'Shipments and loads'}</option>
          <option value="orders">{lang === 'ar' ? 'شحنات طلبات الشحنات' : 'Shipment orders'}</option>
          <option value="fleet">{lang === 'ar' ? 'حمولات إدارة الأسطول' : 'Fleet loads'}</option>
        </select>
        <button type="button" onClick={toggleExcludeCancelled}
          title={lang === 'ar' ? 'يبقى مفعّلًا حتى تلغيه — الأرقامُ والجدولُ والتصديرُ بلا الملغاة' : 'Stays on until you turn it off'}
          className={`inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-semibold ${excludeCancelled ? 'border-slate-900 bg-slate-900 text-white' : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'}`}>
          {excludeCancelled ? <Check className="h-3.5 w-3.5" /> : <Ban className="h-3.5 w-3.5" />}
          {lang === 'ar' ? 'باستثناء الملغاة' : 'Excluding cancelled'}
        </button>
        {/* Customs by a word: all, linked, not linked. The customs column filter selects one specific transaction. */}
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
                {lang === 'ar' ? 'أوامر نقل معاملةٍ محدّدة' : 'One clearance'} <X className="w-3 h-3" />
              </button>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {/* Date range: its calendar opens on click, and an empty To means until today. */}
            {/* The mode and then its picker; the chosen value is translated into a range the server understands. */}
            <button type="button" aria-pressed={isToday} onClick={toggleToday}
              className={`px-3 py-2 rounded-lg border text-sm font-semibold whitespace-nowrap shrink-0 ${isToday ? 'border-[#f37121] bg-[#f37121] text-white' : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50'}`}>
              {lang === 'ar' ? 'اليوم' : 'Today'}
            </button>
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
              /* Shared field: a visible clickable icon, a calendar opening from anywhere, and one dd/mm/yyyy text for everyone. It was a raw field whose format came from the user's device and whose calendar opened only by hitting the icon. */
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
        {/* Refresh bar: runs along the table edge without emptying what is under it. */}
        {searching && <div className="refresh-bar" aria-hidden="true" />}
        {/* Work is not blocked during refresh This first used `pointer-events-none` with half opacity to prevent opening a row about to be replaced. The flag then stuck on (see above) and the table was locked for the whole section. A status indicator must not remove the ability to work: the worst that happens when a row is clicked during refresh is a redraw, far better than an unresponsive screen. Only the bar says in progress; the table stays live. */}
        <ScrollX aria-busy={searching}>
          <div ref={tableRef} className="scroll-mt-4" />
          <table className="w-full" style={{ minWidth: Math.max(960, visibleCols.length * 80) }}>
            <thead>
              <tr className="bg-slate-900 border-b border-slate-200">
                <th ref={measurePinOffset} className="px-3 py-3 sticky start-0 bg-slate-900 z-10 w-20">
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
                {ColHead('reportNumber', T.thReportNumber, 'text-slate-300', true)}
                {ColHead('reportDate', T.thReportDate)}
                {ColHead('fromLocation', T.thFrom)}
                {ColHead('toLocation', T.thTo)}
                {ColHead('branch', T.thBranch)}
                {ColHead('carOwner', T.thCarOwner)}
                {ColHead('carNumber', T.thCarNumber)}
                {/* Ownership type, execution status, payment method and the tax / non-tax flag were removed: they come from the platform and are not used here; the replacements are payment kind and shipment status. */}
                {ColHead('applicationStatus', T.thApplication)}
                {ColHead('username', T.thUsername)}
                {ColHead('userPhone', T.thUserPhone)}
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
                {/* Who wrote the date Data owner: the last person who recorded or edited the payment date. It answers who owns a row without opening the edit log, and differs from who recorded purchases in the daily custody wallet. Written by the server, not editable here (see paymentDateBy). */}
                {ColHead('dataOwnerShown', lang === 'ar' ? 'مسؤول البيانات' : 'Data owner', 'text-purple-300')}
                {/* Filter on the displayed value, not on `paymentDateByName` alone: the cell is filled from the name, then the wallet recorder, then the import source, and a list on the raw field showed empty for about 38,000 rows that do have a name. See backend/src/utils/dataOwnerIndex. */}
                {ColHead('payingBranch', T.thPayingBranch, 'text-purple-300')}
                {/* What was paid to the vendor and in what capacity the customer is invoiced. The kind decides the rest of the row: cash is not invoiced, tax is. */}
                {ColHead('paymentAmount', T.thPaymentAmount, 'text-purple-300')}
                {ColHead('paymentType', T.thPaymentType, 'text-purple-300')}
                {/* Final destination of the statement: the branch where the file ends up. A different question from who paid, since payment may be at one branch and the file settle at another. */}
                {ColHead('finalReportDestination', lang === 'ar' ? 'وجهة أمر النقل النهائية' : 'Final destination', 'text-purple-300')}
                {ColHead('documentNumber', T.thDocNumber, 'text-purple-300')}
                {/* The customs transaction this statement serves: its number, waybill and containers. */}
                {ColHead('customsRef', lang === 'ar' ? 'التخليص' : 'Customs', 'text-sky-300')}
                {ColHead('sendingDate', T.thSendingDate, 'text-purple-300')}
                {/* Two deliveries, not one This is delivery of the transport order to the branch, Operations' work, coming from the follow-up sheet. Delivery of the invoice to the customer is another column among the collection columns, and only it starts the agreed payment term. */}
                {ColHead('branchDeliveryDate', T.thBranchDeliveryDate, 'text-purple-300')}
                {/* Accounts review is accounting's acknowledgement, so it sits with the money columns, not payment recording; users who cannot see it never receive it from the server. */}
                {ColHead('accountingReview', T.thAccountingReview, 'text-purple-300')}
                {/* Collections — financial columns, finance/owner roles only */}
                {ColHead('invoiceNumber', T.thInvoiceNumber, 'text-green-400')}
                {ColHead('netInvoice', T.thNetInvoice, 'text-green-400')}
                {ColHead('tax', T.thTax, 'text-green-400')}
                {ColHead('totalInvoice', T.thTotalInvoice, 'text-green-400')}
                {ColHead('invoiceDate', T.thInvoiceDate, 'text-green-400')}
                {/* Delivery date before collection date It was among the send dates, though it is the last thing awaited before collection, and the tax invoices page reads it next to collection. The eye now finds them together. */}
                {ColHead('deliveryDate', T.thDeliveryDate, 'text-green-400')}
                {ColHead('collectedAmount', T.thCollectedAmount, 'text-green-400')}
                {ColHead('collectionDate', T.thCollectionDate, 'text-green-400')}
                {/* Two columns removed: stage and lock Stage is a state the system computes from the row itself (which cells are filled); it is read in the workflow and decides nothing, since users here follow shipment status and payment date. Lock is an icon showing whether a colleague has the row open; the lock itself remains (it blocks concurrent editing and tells whoever tries), but a whole column in a forty-column table to say nobody is editing is a cost with no return. */}
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
                        {saveState[wf._id] === 'saving' && <Loader2 className="w-3.5 h-3.5 animate-spin text-slate-500" aria-label={lang === 'ar' ? 'يُحفظ' : 'Saving'} />}
                        {saveState[wf._id] === 'saved' && <Check className="w-3.5 h-3.5 text-emerald-600" aria-label={lang === 'ar' ? 'حُفظ' : 'Saved'} />}
                        {saveState[wf._id] === 'failed' && (
                          <button type="button" onClick={() => retrySave(wf._id)}
                            className="inline-flex items-center gap-0.5 rounded bg-red-600 px-1.5 py-0.5 text-[10.5px] font-bold text-white"
                            title={lang === 'ar' ? 'لم يُحفظ التعديل — اضغط لإعادة الحفظ' : 'Not saved — click to retry'}>
                            <AlertTriangle className="w-3 h-3" />{lang === 'ar' ? 'لم يُحفظ — أعِد' : 'Retry'}
                          </button>
                        )}
                        <input
                          type="checkbox"
                          title={T.selectRow}
                          checked={isSelected}
                          onChange={() => toggleSelect(wf._id)}
                          className="w-4 h-4 appearance-none rounded border border-slate-300 bg-transparent checked:bg-[#f37121] checked:border-[#f37121] cursor-pointer relative checked:after:content-['✓'] checked:after:text-white checked:after:text-[10px] checked:after:absolute checked:after:inset-0 checked:after:flex checked:after:items-center checked:after:justify-center"
                        />
                        {editingId === wf._id ? (
                          <>
                            <button type="button" onClick={() => handleInlineSave()} className="p-1 text-green-600 hover:text-green-700 rounded" title={lang === 'ar' ? 'حفظ' : 'Save'}>
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
                            {/* The stage-move arrow was removed with the work stages: statements arrive from the operations platform already in progress, so they are not moved between stages we invent. */}
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
                      // Do not show a cell that will not be saved
                      // The field opened for typing, then the server returned 403 because the role lacked it, so the user typed, pressed OK and nothing saved. It happened to operations staff and then accounting: field lists are written role by role and one gets forgotten. The screen now reads the same map the server filters with (`myFields`): a field the role lacks never opens, and the reason is shown on hover. The list is not patched again and again; the door the mistake enters through is closed.
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
                      // Fields of the external-system clearance sheet are not editable.
                      const systemPulledFields = new Set(['fromLocation', 'toLocation', 'purchaseValue', 'carOwner', 'carNumber', 'ownerType']);
                      const textCell = (field: keyof Workflow, color = 'text-slate-700') => {
                        const isSystemPulled = (systemPulledFields.has(field as string) && wf.reportNumber) || !owns(field);
                        return (
                          <td className={`px-3 py-2.5 text-sm whitespace-nowrap ${field === 'reportNumber' ? 'sticky z-10 bg-white border-e border-slate-200' : ''}`}
                            style={field === 'reportNumber' ? { insetInlineStart: 'var(--wf-pin, 0px)' } : undefined}
                            onClick={isSystemPulled ? (e) => e.stopPropagation() : cellClick(field)}
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
                      // Order status is a list, not a free text cell
                      // It is the shipment status in the operations platform and its values are a known finite set. Typed text meant a value the platform does not know, or an edit wiped on the first sync. It is chosen from a list and written to the platform itself (see changeApplicationStatus) so both screens see it.
                      const statusCell = () => {
                        const fromPlatform = (wf as any).externalSource === 'ops_upl' || !!(wf as any).shipmentOrder || !!(wf as any).fleetShipment;
                        const canSet = owns('applicationStatus') && fromPlatform && !locked;
                        const busy = statusSaving === wf._id;
                        const st = SHIPMENT_STATUSES.find((s) => s.key === wf.applicationStatus);
                        return (
                          <td className="px-3 py-2.5 text-sm whitespace-nowrap" onClick={(e) => e.stopPropagation()}
                            title={!owns('applicationStatus') ? noPermMsg
                              : !fromPlatform ? (lang === 'ar' ? 'أمر نقل ليس من منصّة التشغيل' : 'Not a platform shipment')
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
                      // Paying branch is chosen, not typed
                      // It was a free field, so variants of the same city name got in beside the correct one: one branch in three rows in every report. The list is managed from reference lists, so a new value is added when needed without reopening free typing.
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
                        // The payment amount for a statement paid by the wallet is what the custody clerk wrote; edit it from the wallet entry, not here (the server enforces this too).
                        const fromWallet = field === 'paymentAmount' && !!(wf as any).paidFromWallet;
                        // Tax and its total are computed from the net
                        // Tax is never typed (net x 15%), and the total is not typed in a tax statement (net + tax). In cash the total is typed. The server derives them the same way; see applyBillingRules. Family, not kind: cash-3PL counts as cash in this rule.
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
                      // Payment date is not typed before the bond is received
                      // Payment means the money arrived, which cannot be before the delivery bond is received. Writing it earlier makes financial reports count an unreceived amount, so the field is locked and shows why, not just that it is locked.
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
                      // Payment kind: cash or tax, typed by hand
                      // It decides the whole shape of the statement: cash is not invoiced and reaches collections the same day, tax is invoiced then collected by its invoice. The payment-method column from the platform decides none of this; this is the reference. It is not filled from the customer file, because one customer may say cash on one load and open an invoice on another, so the kind belongs to the shipment, not the party. Whoever knows what was agreed for this load writes it, and it stays on the statement so that a year later it is clear which was cash and which invoiced.
                      const paymentTypeCell = () => (
                        <td className="px-3 py-2.5 text-sm whitespace-nowrap min-w-[120px]" onClick={cellClick('paymentType')}
                          title={!owns('paymentType') ? noPermMsg
                            : (lang === 'ar'
                              ? 'يُكتب لكل أمر نقل على حدة — العميل قد يحاسب كاشًا في حمولة وضريبيًّا في أخرى'
                              : 'Set per report — a customer may settle one load in cash and another by invoice')}>
                          {isEditing && owns('paymentType') ? (() => {
                            // The four kinds are selectable; an existing legacy tax or cash value is visible in the list but cannot be chosen.
                            const cur = paymentKindOf(editData as any);
                            return (
                              <select title={T.thPaymentType} className={ic}
                                value={cur}
                                onChange={(e) => { const v = e.target.value; setEditData((prev) => ({ ...prev, paymentType: v })); handleInlineSave({ paymentType: v }); }}>
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

                      // A cash statement is not invoiced
                      // A cash customer pays on the spot: no bond, invoice or tax. The columns read zero and are locked, and the lock states its reason, otherwise it would look broken. Operations review is a one-click checkbox (checklist), not text.
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
                        {colOn('reportDate') && dateCell('reportDate')}
                        {colOn('fromLocation') && textCell('fromLocation')}
                        {colOn('toLocation') && textCell('toLocation')}
                        {colOn('branch') && lookupCell('branch', 'workflow_paying_branch')}
                        {colOn('carOwner') && textCell('carOwner', 'text-slate-900')}
                        {colOn('carNumber') && textCell('carNumber')}
                        {colOn('applicationStatus') && statusCell()}
                        {!colOn('username') ? null : isEditing && owns('username') ? (
                          <td className="px-3 py-2.5 text-sm min-w-[14rem]" onClick={(e) => e.stopPropagation()}>
                            <CustomerNamePicker value={(editData as any).username || ''} ar={lang === 'ar'}
                              onChange={(v) => setEditData(prev => ({ ...prev, username: v }))} />
                          </td>
                        ) : textCell('username')}
                        {colOn('userPhone') && textCell('userPhone')}
                        {colOn('purchaseValue') && numCell('purchaseValue')}
                        {/* Written to the operations platform first, then here; see pushSellingValue. */}
                        {colOn('sellingValue') && numCell('sellingValue', 'text-emerald-700')}
                        {colOn('driverName') && textCell('driverName')}
                        {colOn('truckType') && textCell('truckType')}
                        {colOn('truckSize') && textCell('truckSize')}
                        {colOn('representativeName') && textCell('representativeName')}
                        {/* Operations Review */}
                        {colOn('operationsReview') && operationsReviewCell()}
                        {/* Manual Moderator */}
                        {colOn('paymentDate') && dateCell('paymentDate', 'text-purple-700')}
                        {colOn('dataOwnerShown') && (() => {
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
                        {colOn('payingBranch') && lookupCell('payingBranch', 'workflow_paying_branch', 'text-purple-700')}
                        {colOn('paymentAmount') && numCell('paymentAmount', 'text-purple-700')}
                        {colOn('paymentType') && paymentTypeCell()}
                        {/* Everything after this locks on a cash statement, and the lock states its reason on hover so it is not read as a fault. */}
                        {colOn('finalReportDestination') && lookupCell('finalReportDestination', 'workflow_final_destination', 'text-purple-700')}
                        {colOn('documentNumber') && textCell('documentNumber', 'text-purple-700')}
                        {colOn('customsRef') && (
                          <td className="px-3 py-2.5 text-sm whitespace-nowrap" onClick={(e) => e.stopPropagation()}>
                            {wf.customsLink?.clearance ? (
                              <>
                                <CustomsLinkBadge link={wf.customsLink} ar={lang === 'ar'} />
                                {!!wf.customsLink.containers?.length && (
                                  <div className="mt-0.5 text-[11px] text-slate-500" dir="ltr">{wf.customsLink.containers.join(' · ')}</div>
                                )}
                              </>
                            ) : <span className="text-slate-300">-</span>}
                          </td>
                        )}
                        {colOn('sendingDate') && dateCell('sendingDate', 'text-purple-700')}
                        {colOn('branchDeliveryDate') && dateCell('branchDeliveryDate', 'text-purple-700')}
                        {colOn('accountingReview') && accountingReviewCell()}
                        {colOn('invoiceNumber') && textCell('invoiceNumber', 'text-green-700')}
                        {/* Invoice amounts — finance, collections and top roles only */}
                        {colOn('netInvoice') && numCell('netInvoice', 'text-green-700')}
                        {colOn('tax') && numCell('tax', 'text-green-700')}
                        {colOn('totalInvoice') && numCell('totalInvoice', 'text-green-700')}
                        {colOn('invoiceDate') && dateCell('invoiceDate', 'text-green-700')}
                        {colOn('deliveryDate') && dateCell('deliveryDate', 'text-green-700')}
                        {colOn('collectedAmount') && numCell('collectedAmount', 'text-green-700')}
                        {colOn('collectionDate') && dateCell('collectionDate', 'text-green-700')}
                      </>);
                    })()}

                  </tr>
                );
              })}
            </tbody>
          </table>
        </ScrollX>

        {/* Browsing is entirely on the server, including filter state. A page is fifty rows however many match, so the tab never renders a table of tens of thousands of rows that would freeze it. */}
        {total > 0 && (
          <TablePager className="px-4 py-2.5 border-t border-slate-200" page={page} pageSize={pageSize} total={total} ar={lang === 'ar'}
            onPage={setPage} onPageSize={changePageSize} note={hasColFilters ? (lang === 'ar' ? 'مُفلتر' : 'filtered') : undefined} />
        )}
      </div>

      {/* The stage counter was removed with them: four of five were always zero. The total remains. */}
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
