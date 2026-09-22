'use client';
/**
 * «التشغيل — خاصّ»: كشوفُ التشغيل نفسُها، بسعر بيعنا الحقيقيّ.
 *
 * سعرُ البيع في سير عمل التشغيل يأتي من منصّةٍ ليست لنا وهو مساوٍ لسعر الشراء
 * دائمًا — فريقُ العمليّات هناك لا يعرف هامشَنا. فهذه الصفحةُ تقرأ الكشوفَ من
 * موضعها حرفًا بحرف (فكلُّ ما يحدث هناك يظهر هنا في اللحظة) ولا تملك منها إلّا
 * عمودًا واحدًا: سعرَ البيع، محفوظًا عندنا ولا يُرسَل إلى أحد.
 *
 * والسعرُ يُملأ وحدَه من ملفّ العميل (آخرُ سعرٍ على هذا المسار)، ويُصحَّح هنا —
 * والتصحيحُ يصير هو الأحدثَ في الملفّ، فيرثه ما بعده وتقترحه شاشةُ الإنشاء.
 *
 * ── وهي تُقرأ كما يُقرأ سيرُ العمل ─────────────────────────────────────────
 * الأعمدةُ نفسُها، وفلاترُ الأعمدة نفسُها (`cf_<العمود>` تُطبَّق في الخادم،
 * وقيمُها من `/api/workflows/filters`)، والمدى نفسُه (يوم / شهر / مدى). فلا
 * يُرى في الشاشتين كشفٌ في واحدةٍ وليس في الأخرى، ولا مجموعٌ لا يساوي مجموعًا.
 * وفوقها ما لنا وحدَنا: البيعُ الحقيقيّ والربحُ والهامش.
 */
import { useState, useEffect, useCallback, useRef } from 'react';
import { useAuth } from '@/context/AuthContext';
import { useLanguage } from '@/context/LanguageContext';
import { useSocket } from '@/hooks/useSocket';
import { useLatestRequest } from '@/hooks/useLatestRequest';
import { useDialog } from '@/components/system/DialogProvider';
import { getOperationsTranslations } from '@/lib/translations';
import api from '@/lib/api';
import {
  Lock, Search, Loader2, Check, X, ChevronLeft, ChevronRight, FilterX,
  TrendingUp, Wallet, ShoppingCart, Tags,
} from 'lucide-react';
import { Spinner, PageHeader } from '@/components/hr/HRKit';
import ExportMenu, { type ExportColumn } from '@/components/ls2/ExportMenu';
import { ColumnFilter, type ColumnFilterOption } from '@/components/ColumnFilter';
import DateRangeFilter from '@/components/system/DateRangeFilter';
import ScrollX from '@/components/system/ScrollX';
import { SHIPMENT_STATUSES, PAYMENT_METHODS } from '@/lib/ops';

const LIMIT = 50;
const ROLES = ['super_admin', 'admin', 'it_manager', 'it_specialist', 'operations_manager', 'cfo', 'accounting_manager', 'accountant'];

// مرجعان ثابتان — كما في صفحة سير العمل: العمودُ غيرُ المفلتَر لا يصنع مرجعًا جديدًا في كلّ رسمة.
const EMPTY_SET = new Set<string>();
const EMPTY_OPTIONS: ColumnFilterOption[] = [];
// الأعمدةُ التي يقبل الخادمُ الفلترةَ عليها (`FILTERABLE_COLUMNS` في workflowController).
// ما سواها يُعرض بلا قائمة: قائمةٌ يردّها الخادمُ ٤٠٠ تبدو فارغةً فتُقرأ «لا قيم».
const FILTERABLE = new Set([
  'reportNumber', 'reportDate', 'fromLocation', 'toLocation', 'branch', 'carOwner',
  'carNumber', 'ownerType', 'executionStatus', 'applicationStatus', 'paymentMethod',
  'username', 'userPhone', 'taxIndicator', 'purchaseValue', 'sellingValue',
  'driverName', 'truckType', 'truckSize', 'representativeName', 'operationsReview',
  'paymentDate', 'payingBranch', 'documentNumber', 'sendingDate',
  'branchDeliveryDate', 'deliveryDate',
  'accountingReview', 'invoiceNumber', 'netInvoice', 'tax', 'totalInvoice',
  'invoiceDate', 'collectionDate', 'stage',
]);
const DATE_FIELDS = new Set(['reportDate', 'paymentDate', 'sendingDate', 'branchDeliveryDate', 'deliveryDate', 'invoiceDate', 'collectionDate']);
const NUM_FIELDS = new Set(['purchaseValue', 'sellingValue', 'netInvoice', 'tax', 'totalInvoice']);

type DateMode = 'range' | 'month' | 'day';
type Priced = '' | 'yes' | 'no';

interface Row {
  _id: string;
  [k: string]: any;
  platformSellingValue?: number; sellingValue?: number;
  priceSource?: string; priceSaved?: boolean; profit?: number | null; margin?: number | null;
}

interface Stats {
  total: number; priced: number; unpriced: number;
  sumSelling: number; sumPurchase: number; sumPurchaseAll: number; sumPurchaseUnpriced: number;
  profit: number; margin: number;
}

/** الشهرُ الجاري بتقويم الرياض: مفتاحُه وأوّلُه وآخرُه. */
const CURRENT_MONTH = () => {
  const key = new Date(Date.now() + 3 * 3600e3).toISOString().slice(0, 7);
  const [y, mo] = key.split('-').map(Number);
  const last = new Date(Date.UTC(y, mo, 0)).getUTCDate();
  return { key, from: `${key}-01`, to: `${key}-${String(last).padStart(2, '0')}` };
};

const money = (v?: number | null) => (v == null ? '—'
  : Number(v).toLocaleString('en-US', { maximumFractionDigits: 2 }));
const fmtDate = (d?: string) => (d ? new Date(d).toLocaleDateString('en-GB') : '—');

export default function OperationsPrivatePage() {
  const { user } = useAuth();
  const { lang, isRTL } = useLanguage();
  const ar = lang === 'ar';
  const T = getOperationsTranslations(lang);
  const { notify } = useDialog();

  const [rows, setRows] = useState<Row[]>([]);
  const [stats, setStats] = useState<Stats | null>(null);
  const [total, setTotal] = useState(0);
  const [pages, setPages] = useState(1);
  const [page, setPage] = useState(1);
  const [canMoney, setCanMoney] = useState(false);
  const [search, setSearch] = useState('');
  const [debounced, setDebounced] = useState('');
  // ── ثلاثةُ أوضاعٍ للفترة — كصفحة سير العمل ──────────────────────────────
  // اليومُ والشهرُ يُترجمان إلى مدًى يفهمه الخادم؛ و«إلى» تشمل يومَها كلَّه
  // (نهايةُ اليوم بتوقيت الشركة — `endOfDay` في الخادم).
  // ويُفتح على الشهر الجاري: سؤالُ «كم ربحنا هذا الشهر» هو الأكثرُ طرحًا، والشهرُ
  // مكتوبٌ في خانته فلا يُحسب فلترًا خفيًّا — ومَن أراد الكلَّ يمسحه.
  const [dateMode, setDateMode] = useState<DateMode>('month');
  const [monthKey, setMonthKey] = useState(() => CURRENT_MONTH().key);
  const [dayKey, setDayKey] = useState('');
  const [dateFrom, setDateFrom] = useState(() => CURRENT_MONTH().from);
  const [dateTo, setDateTo] = useState(() => CURRENT_MONTH().to);
  const [pendingOnly, setPendingOnly] = useState(false);
  const [priced, setPriced] = useState<Priced>('');
  const [colFilters, setColFilters] = useState<Record<string, Set<string>>>({});
  const [colOptions, setColOptions] = useState<Record<string, { values: ColumnFilterOption[]; truncated: boolean }>>({});
  const [colLoading, setColLoading] = useState<Record<string, boolean>>({});
  const [openField, setOpenField] = useState<string | null>(null);
  const [openNonce, setOpenNonce] = useState(0);
  const optionsSeq = useRef<Record<string, number>>({});
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [saving, setSaving] = useState(false);

  const allowed = ROLES.includes(String(user?.role || ''));
  const hasColFilters = Object.keys(colFilters).length > 0;

  useEffect(() => { const t = setTimeout(() => setDebounced(search.trim()), 350); return () => clearTimeout(t); }, [search]);
  useEffect(() => { setPage(1); }, [debounced, dateFrom, dateTo, pendingOnly, priced, colFilters]);

  const applyMonth = (mk: string) => {
    setMonthKey(mk);
    if (!mk) { setDateFrom(''); setDateTo(''); return; }
    const [y, mo] = mk.split('-').map(Number);
    const last = new Date(Date.UTC(y, mo, 0)).getUTCDate();
    setDateFrom(`${mk}-01`);
    setDateTo(`${mk}-${String(last).padStart(2, '0')}`);
  };
  const applyDay = (d: string) => { setDayKey(d); setDateFrom(d); setDateTo(d); };
  const switchMode = (m: DateMode) => {
    setDateMode(m);
    // تبديلُ الوضع يمسح ما اختاره الوضعُ السابق: بقاؤه يعني فلترًا لا يراه أحد.
    setDateFrom(''); setDateTo(''); setMonthKey(''); setDayKey('');
  };

  // ── شرطٌ واحدٌ يقرؤه الجدولُ والبطاقاتُ وقوائمُ الأعمدة والتصدير ─────────
  // بأسماء صفحة سير العمل نفسِها، فيفلتر الخادمُ هنا كما يفلتر هناك.
  const buildParams = useCallback(() => {
    const p = new URLSearchParams();
    if (debounced) p.set('search', debounced);
    if (dateFrom) p.set('dateFrom', dateFrom);
    if (dateTo) p.set('dateTo', dateTo);
    if (pendingOnly) p.set('pendingOnly', 'true');
    if (priced) p.set('priced', priced);
    for (const [field, vals] of Object.entries(colFilters)) vals.forEach((v) => p.append(`cf_${field}`, v));
    return p;
  }, [debounced, dateFrom, dateTo, pendingOnly, priced, colFilters]);

  // ── والردُّ القديم لا يكتب فوق الأحدث ──────────────────────────────────────
  const guard = useLatestRequest();
  const load = useCallback(async (background = false) => {
    const mine = guard.begin();
    if (!background) setRefreshing(true);
    try {
      const p = buildParams();
      p.set('page', String(page));
      p.set('limit', String(LIMIT));
      const d = await api.get<any>(`/api/operations-private?${p.toString()}`);
      if (!guard.isCurrent(mine)) return;
      setRows(d.workflows || []);
      setTotal(d.total || 0);
      setPages(d.pages || 1);
      setCanMoney(!!d.money);
    } catch (e: any) {
      if (guard.isCurrent(mine)) notify(e?.message || 'Failed', 'error');
    } finally {
      // الرايةُ تُطفأ دائمًا؛ والحارسُ يقرّر بياناتِ مَن تُعرض فقط.
      if (!background) setRefreshing(false);
      if (guard.isCurrent(mine)) setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [buildParams, page, guard]);

  // ── والبطاقاتُ بحارسٍ مستقلّ ─────────────────────────────────────────────
  // أثقلُ طلبٍ هو غيرُ المفلتَر، وهو أوّلُ ما يُطلق؛ فلو وصل بعد المفلتَر لكتب
  // مجموعَ الجدول كلِّه تحت عنوان «حسب الفلتر».
  const statsGuard = useLatestRequest();
  const loadStats = useCallback(async () => {
    const mine = statsGuard.begin();
    try {
      const d = await api.get<Stats>(`/api/operations-private/stats?${buildParams().toString()}`);
      if (statsGuard.isCurrent(mine)) setStats(d);
    } catch { /* الأرقامُ تحسينٌ لا شرط */ }
  }, [buildParams, statsGuard]);

  useEffect(() => { if (allowed) load(); }, [load, allowed]);
  useEffect(() => { if (allowed) loadStats(); }, [loadStats, allowed]);

  // قيمُ عمودٍ واحد عند فتح قائمته — من نقطة سير العمل نفسِها وبالفلاتر النشطة كلِّها.
  const fetchColOptions = useCallback(async (field: string, q = '') => {
    const seq = (optionsSeq.current[field] || 0) + 1;
    optionsSeq.current[field] = seq;
    setColLoading((prev) => ({ ...prev, [field]: true }));
    try {
      const p = buildParams();
      p.delete('priced');
      p.append('field', field);
      if (q) p.append('q', q);
      const data = await api.get<any>(`/api/workflows/filters?${p.toString()}`);
      if (optionsSeq.current[field] !== seq) return;
      const f = data?.filters?.[0];
      setColOptions((prev) => ({ ...prev, [field]: { values: f?.values || [], truncated: !!f?.truncated } }));
    } catch {
      if (optionsSeq.current[field] === seq) setColOptions((prev) => ({ ...prev, [field]: prev[field] || { values: [], truncated: false } }));
    } finally {
      if (optionsSeq.current[field] === seq) setColLoading((prev) => ({ ...prev, [field]: false }));
    }
  }, [buildParams]);

  useEffect(() => {
    setColOptions((prev) => (openField && prev[openField] ? { [openField]: prev[openField] } : {}));
    if (openField) fetchColOptions(openField);
  }, [fetchColOptions, openField, openNonce]);

  // ── حيٌّ مع سير عمل التشغيل ─────────────────────────────────────────────
  // نفسُ الأحداث التي تسمعها تلك الصفحة (عدا الأقفال — لا عمودَ لها هنا)، وحدثُ
  // أسعارنا. واستطلاعُ المنصّة يبثّ `workflow:updated` كلَّ بضع ثوانٍ، فتُجمَع
  // الأحداثُ المتلاحقة في تحديثٍ واحد بدل عشرة طلباتٍ للبطاقات في الدقيقة.
  const liveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const loadRef = useRef(load);
  const statsRef = useRef(loadStats);
  useEffect(() => { loadRef.current = load; statsRef.current = loadStats; }, [load, loadStats]);
  const onLive = useCallback(() => {
    if (liveTimer.current) clearTimeout(liveTimer.current);
    liveTimer.current = setTimeout(() => { loadRef.current(true); statsRef.current(); }, 1200);
  }, []);
  useEffect(() => () => { if (liveTimer.current) clearTimeout(liveTimer.current); }, []);
  useSocket('workflow:created', onLive);
  useSocket('workflow:updated', onLive);
  useSocket('workflow:deleted', onLive);
  useSocket('workflow:stageChanged', onLive);
  useSocket('workflow:bulkImported', onLive);
  useSocket('operationsPrivate:updated', onLive);

  const setColFilter = useCallback((field: string, set: Set<string>) => {
    setColFilters((prev) => {
      const next = { ...prev };
      if (set.size === 0) delete next[field]; else next[field] = set;
      return next;
    });
  }, []);

  const save = async (r: Row) => {
    const value = Number(draft);
    if (!Number.isFinite(value) || value < 0) { notify(ar ? 'سعرٌ غير صالح' : 'Invalid price', 'error'); return; }
    setSaving(true);
    try {
      const d = await api.put<any>(`/api/operations-private/${r._id}`, { sellingValue: value });
      setRows((p) => p.map((x) => (x._id === r._id
        ? {
          ...x, sellingValue: value, priceSource: 'manual', priceSaved: true, profit: d.profit,
          margin: value > 0 ? Math.round((d.profit / value) * 10000) / 100 : null,
        } : x)));
      setEditing(null);
      loadStats();
    } catch (e: any) { notify(e?.message || 'Failed', 'error'); }
    setSaving(false);
  };

  const trStatus = (v?: string) => { const s = SHIPMENT_STATUSES.find((x) => x.key === v); return s ? (ar ? s.ar : s.en) : (v || '—'); };
  const trPayment = (v?: string) => { const p = PAYMENT_METHODS.find((x) => x.value === v); return p ? (ar ? p.ar : p.en) : (v || '—'); };
  const stageLabels: Record<string, string> = {
    draft: T.draft, submitted_to_ops: T.submittedToOps, ops_completed: T.opsCompleted,
    submitted_to_collections: T.toCollections, completed: T.completedStage,
  };
  const sourceLabel = (s?: string) => (
    s === 'sheet' ? (ar ? 'تقرير الفروع' : 'branches report')
      : s === 'route' ? (ar ? 'ملفّ العميل' : 'customer profile')
        : s === 'manual' || s === 'private' ? (ar ? 'يدويّ' : 'manual') : '—');
  const payType = (v?: string) => (v === 'cash' ? (ar ? 'كاش' : 'Cash') : v === 'tax' ? (ar ? 'ضريبي' : 'Tax') : '—');
  const done = (v?: string) => (v ? (ar ? 'تمّت' : 'Done') : '—');

  // العرضُ يُترجَم والفلترةُ على القيمة الخام — كصفحة سير العمل.
  const colFormat = (field: string): ((v: any) => string) | undefined => {
    if (field === 'stage') return (v: any) => stageLabels[v] || v;
    if (field === 'executionStatus' || field === 'applicationStatus') return trStatus;
    if (field === 'paymentMethod') return trPayment;
    if (DATE_FIELDS.has(field)) return (v: any) => {
      const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(v || ''));
      return m ? `${m[3]}/${m[2]}/${m[1]}` : fmtDate(String(v || ''));
    };
    if (NUM_FIELDS.has(field)) return (v: any) => money(Number(v));
    return undefined;
  };

  // ── أعمدةُ سير العمل بترتيبها، وأعمدتُنا بعد سعر المنصّة ─────────────────
  // `kind` يقرّر رسمَ الخانة؛ و`money` = لا يُعرض إلّا لمن يملك أعمدةَ الفاتورة.
  type Col = { key: string; label: string; kind?: 'date' | 'num' | 'status' | 'pay' | 'stage' | 'done' | 'ptype'; money?: boolean; tone?: string };
  const COLS: Col[] = [
    { key: 'reportNumber', label: T.thReportNumber },
    { key: 'reportDate', label: T.thReportDate, kind: 'date' },
    { key: 'fromLocation', label: T.thFrom },
    { key: 'toLocation', label: T.thTo },
    { key: 'branch', label: T.thBranch },
    { key: 'carOwner', label: T.thCarOwner },
    { key: 'carNumber', label: T.thCarNumber },
    { key: 'ownerType', label: T.thOwnerType },
    { key: 'executionStatus', label: T.thExecution, kind: 'status' },
    { key: 'applicationStatus', label: T.thApplication, kind: 'status' },
    { key: 'paymentMethod', label: T.thPaymentMethod, kind: 'pay' },
    { key: 'username', label: T.thUsername },
    { key: 'userPhone', label: T.thUserPhone },
    { key: 'taxIndicator', label: T.thTaxIndicator },
    { key: 'purchaseValue', label: T.thPurchaseValue, kind: 'num' },
    // سعرُ المنصّة: عمودُ `sellingValue` في سير العمل — وفلترُه فلترُه.
    { key: 'sellingValue', label: ar ? 'سعر البيع (المنصّة)' : 'Selling (platform)', kind: 'num' },
  ];
  const ALL_AFTER: Col[] = [
    { key: 'driverName', label: T.thDriverName },
    { key: 'truckType', label: T.thTruckType },
    { key: 'truckSize', label: T.thTruckSize },
    { key: 'representativeName', label: T.thRepresentative },
    { key: 'operationsReview', label: T.thOpsReview, kind: 'done', tone: 'text-yellow-400' },
    { key: 'paymentDate', label: T.thPaymentDate, kind: 'date', tone: 'text-purple-300' },
    { key: 'paymentDateByName', label: ar ? 'مسؤول البيانات' : 'Data owner', tone: 'text-purple-300' },
    { key: 'payingBranch', label: T.thPayingBranch, tone: 'text-purple-300' },
    { key: 'paymentAmount', label: T.thPaymentAmount, kind: 'num', tone: 'text-purple-300' },
    { key: 'paymentType', label: T.thPaymentType, kind: 'ptype', tone: 'text-purple-300' },
    { key: 'finalReportDestination', label: ar ? 'وجهة الكشف النهائية' : 'Final destination', tone: 'text-purple-300' },
    { key: 'documentNumber', label: T.thDocNumber, tone: 'text-purple-300' },
    { key: 'sendingDate', label: T.thSendingDate, kind: 'date', tone: 'text-purple-300' },
    { key: 'branchDeliveryDate', label: T.thBranchDeliveryDate, kind: 'date', tone: 'text-purple-300' },
    { key: 'accountingReview', label: T.thAccountingReview, kind: 'done', money: true, tone: 'text-purple-300' },
    { key: 'invoiceNumber', label: T.thInvoiceNumber, money: true, tone: 'text-green-400' },
    { key: 'netInvoice', label: T.thNetInvoice, kind: 'num', money: true, tone: 'text-green-400' },
    { key: 'tax', label: T.thTax, kind: 'num', money: true, tone: 'text-green-400' },
    { key: 'totalInvoice', label: T.thTotalInvoice, kind: 'num', money: true, tone: 'text-green-400' },
    { key: 'invoiceDate', label: T.thInvoiceDate, kind: 'date', money: true, tone: 'text-green-400' },
    { key: 'deliveryDate', label: T.thDeliveryDate, kind: 'date', tone: 'text-green-400' },
    { key: 'collectedAmount', label: T.thCollectedAmount, kind: 'num', money: true, tone: 'text-green-400' },
    { key: 'collectionDate', label: T.thCollectionDate, kind: 'date', money: true, tone: 'text-green-400' },
    { key: 'stage', label: T.thStage, kind: 'stage', money: true },
  ];
  const COLS_AFTER = ALL_AFTER.filter((c) => !c.money || canMoney);

  const cellText = (c: Col, r: Row): string => {
    const v = r[c.key];
    if (c.key === 'sellingValue') return money(r.platformSellingValue);
    switch (c.kind) {
      case 'date': return fmtDate(v);
      case 'num': return v ? money(v) : '—';
      case 'status': return trStatus(v);
      case 'pay': return trPayment(v);
      case 'stage': return stageLabels[v] || v || '—';
      case 'done': return done(v);
      case 'ptype': return payType(v);
      default: return v == null || v === '' ? '—' : String(v);
    }
  };

  // رأسُ عمودٍ بقائمة فلتر — دالّةٌ تُنادى لا مكوّنٌ يُعرَّف في الرسم.
  const colHead = (c: Col) => (
    <th key={c.key} className="px-3 py-3 text-start text-xs font-semibold whitespace-nowrap">
      <span className={`inline-flex items-center ${c.tone || 'text-slate-300'}`}>
        {c.label}
        {FILTERABLE.has(c.key) && (
          <ColumnFilter
            field={c.key}
            selected={colFilters[c.key] || EMPTY_SET}
            onChange={(s) => setColFilter(c.key, s)}
            onOpen={() => { setOpenField(c.key); setOpenNonce((n) => n + 1); }}
            options={colOptions[c.key]?.values || EMPTY_OPTIONS}
            truncated={!!colOptions[c.key]?.truncated}
            loading={!!colLoading[c.key]}
            onQuery={(q) => fetchColOptions(c.key, q)}
            lang={ar ? 'ar' : 'en'}
            format={colFormat(c.key)}
          />
        )}
      </span>
    </th>
  );
  const plainHead = (label: string, tone = 'text-[#f37121]') => (
    <th key={label} className={`px-3 py-3 text-start text-xs font-semibold whitespace-nowrap ${tone}`}>{label}</th>
  );
  const td = (c: Col, r: Row) => (
    <td key={c.key} className={`px-3 py-2.5 whitespace-nowrap ${c.kind === 'num' ? 'tabular-nums' : ''} ${
      c.key === 'reportNumber' ? 'font-mono font-bold text-[#f37121]' : 'text-slate-700'}`}>
      {cellText(c, r)}
    </td>
  );

  // ── التصدير: ثلاثةُ نطاقات كصفحة سير العمل ───────────────────────────────
  // الصفحةُ المعروضة في اليد؛ و«كلُّ ما طابق الفلتر» و«الجدولُ كلُّه» يبنيهما
  // الخادمُ ملفًّا بأسعارنا المحلولة — لا تعبر عشراتُ الآلاف المتصفّحَ خامًا.
  const exportColumns: ExportColumn[] = [...COLS, ...COLS_AFTER].flatMap((c): ExportColumn[] => {
    const base: ExportColumn = { header: c.label, key: c.key, width: 14, transform: (_v, r) => cellText(c, r) };
    if (c.key !== 'sellingValue') return [base];
    return [
      { header: c.label, key: 'platformSellingValue', width: 14 },
      { header: ar ? 'سعر البيع (الحقيقي)' : 'Selling (real)', key: 'sellingValue', width: 16, transform: (v) => (v > 0 ? v : '') },
      { header: ar ? 'الربح' : 'Profit', key: 'profit', width: 14, transform: (v) => (v == null ? '' : v) },
      { header: ar ? 'الهامش %' : 'Margin %', key: 'margin', width: 10, transform: (v) => (v == null ? '' : v) },
      { header: ar ? 'مصدر السعر' : 'Price source', key: 'priceSource', width: 14, transform: (v) => sourceLabel(v) },
    ];
  });
  const downloadServerFile = async (scope: 'filtered' | 'all') => {
    const p = scope === 'all' ? new URLSearchParams() : buildParams();
    if (scope === 'all') p.set('scope', 'all');
    const blob = await api.getBlob(`/api/operations-private/export?${p.toString()}`);
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `operations-private-${new Date().toISOString().slice(0, 10)}.xlsx`;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  };

  if (!allowed) {
    return <div className="p-8 text-slate-500">{ar ? 'هذه الصفحة للإدارة فقط.' : 'Management only.'}</div>;
  }
  if (loading && rows.length === 0) return <Spinner />;

  const pricedShare = stats && stats.total ? Math.round((stats.priced / stats.total) * 100) : 0;
  const colCount = COLS.length + 4 + COLS_AFTER.length;

  return (
    <div className="space-y-4" dir={isRTL ? 'rtl' : 'ltr'}>
      <PageHeader icon={<Lock className="w-5 h-5 text-[#f37121]" />}
        title={ar ? 'التشغيل — خاصّ' : 'Operations — private'}
        subtitle={ar
          ? 'نفس كشوف سير عمل التشغيل، بسعر بيعنا الحقيقيّ — لا يُرسَل إلى منصّة التشغيل ولا يراه أحدٌ خارجها'
          : 'The same operations sheets with our real selling price — never sent to the platform'}>
        <ExportMenu lang={ar ? 'ar' : 'en'} fileName="operations-private" variant="subtle"
          options={[
            { key: 'page', label: ar ? `الصفحة المعروضة (${rows.length})` : `Current page (${rows.length})`, sheets: [{ name: 'Private', rows, columns: exportColumns }] },
            { key: 'filtered', label: ar ? `كلّ ما طابق الفلتر (${total})` : `Everything matching the filter (${total})`, download: () => downloadServerFile('filtered') },
            { key: 'all', label: ar ? 'الجدول كلّه (بلا فلتر)' : 'The whole table (no filter)', download: () => downloadServerFile('all') },
          ]} />
      </PageHeader>

      {/* ── البطاقاتُ على الفلتر كلِّه لا على الصفحة المعروضة ───────────────── */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3">
        <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          <div className="flex items-center justify-between">
            <p className="text-xs font-semibold text-slate-500">{ar ? 'إجمالي البيع (الحقيقي)' : 'Selling total (real)'}</p>
            <Wallet className="w-4 h-4 text-emerald-600" />
          </div>
          <p className="mt-2 text-2xl font-bold tabular-nums text-emerald-700">{stats ? money(stats.sumSelling) : '…'}</p>
          <p className="mt-1 text-[11px] text-slate-500">
            {stats ? (ar ? `على ${stats.priced.toLocaleString()} كشفًا مسعَّرًا` : `over ${stats.priced.toLocaleString()} priced sheets`) : ''}
          </p>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          <div className="flex items-center justify-between">
            <p className="text-xs font-semibold text-slate-500">{ar ? 'إجمالي الشراء' : 'Purchase total'}</p>
            <ShoppingCart className="w-4 h-4 text-slate-500" />
          </div>
          <p className="mt-2 text-2xl font-bold tabular-nums text-slate-800">{stats ? money(stats.sumPurchaseAll) : '…'}</p>
          <p className="mt-1 text-[11px] text-slate-500">
            {stats ? (ar
              ? `المسعَّر ${money(stats.sumPurchase)} · غير المسعَّر ${money(stats.sumPurchaseUnpriced)}`
              : `priced ${money(stats.sumPurchase)} · unpriced ${money(stats.sumPurchaseUnpriced)}`) : ''}
          </p>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          <div className="flex items-center justify-between">
            <p className="text-xs font-semibold text-slate-500">{ar ? 'الربح والهامش' : 'Profit & margin'}</p>
            <TrendingUp className="w-4 h-4 text-[#f37121]" />
          </div>
          <p className={`mt-2 text-2xl font-bold tabular-nums ${stats && stats.profit < 0 ? 'text-red-600' : 'text-[#f37121]'}`}>
            {stats ? money(stats.profit) : '…'}
            {stats && <span className="ms-2 text-sm font-semibold text-violet-700">{stats.margin}%</span>}
          </p>
          <p className="mt-1 text-[11px] text-slate-500">{ar ? 'على المسعَّر وحدَه — البيع ناقص شرائه' : 'priced rows only — selling minus their purchase'}</p>
        </div>
        {/* ── وما لم يُسعَّر يُقال ولا يُخفى — والضغطُ عليه يعرضه ────────────── */}
        <button type="button" onClick={() => setPriced((v) => (v === 'no' ? '' : 'no'))}
          className={`rounded-xl border p-4 text-start shadow-sm transition-colors ${
            priced === 'no' ? 'border-amber-400 bg-amber-50 ring-2 ring-amber-300/50' : 'border-slate-200 bg-white hover:border-amber-300'}`}>
          <div className="flex items-center justify-between">
            <p className="text-xs font-semibold text-slate-500">{ar ? 'مسعَّر / بلا سعر' : 'Priced / unpriced'}</p>
            <Tags className="w-4 h-4 text-amber-600" />
          </div>
          <p className="mt-2 text-2xl font-bold tabular-nums text-slate-800">
            {stats ? stats.priced.toLocaleString() : '…'}
            <span className="text-base text-slate-400"> / </span>
            <span className="text-amber-600">{stats ? stats.unpriced.toLocaleString() : '…'}</span>
          </p>
          <div className="mt-2 h-1.5 w-full rounded-full bg-amber-100 overflow-hidden">
            <div className="h-full bg-emerald-500" style={{ width: `${pricedShare}%` }} />
          </div>
          <p className="mt-1 text-[11px] text-slate-500">
            {priced === 'no' ? (ar ? 'تعرض غيرَ المسعَّر — اضغط للإلغاء' : 'Showing unpriced — click to clear')
              : (ar ? `${pricedShare}% مسعَّر — اضغط لعرض ما بلا سعر` : `${pricedShare}% priced — click to show unpriced`)}
          </p>
        </button>
      </div>

      {/* ── الفلاتر: البحث، والفترة (يوم/شهر/مدى)، ثمّ ما يخصّ هذه الصفحة ───── */}
      <div className="rounded-xl border border-slate-200 bg-white p-3 shadow-sm space-y-3">
        <div className="flex flex-col lg:flex-row lg:items-center gap-3 flex-wrap">
          <div className="relative flex-1 min-w-[220px]">
            <Search className="absolute start-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
            <input value={search} onChange={(e) => setSearch(e.target.value)}
              placeholder={T.searchPlaceholder}
              className="w-full ps-10 pe-8 py-2.5 rounded-lg bg-white border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-[#f37121]/50" />
            {search && (
              <button type="button" title={T.clearSearch} onClick={() => setSearch('')}
                className="absolute end-3 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-900">
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
          <div className="flex items-center rounded-lg border border-slate-200 overflow-hidden shrink-0">
            {([['day', 'يوم', 'Day'], ['month', 'شهر', 'Month'], ['range', 'مدى', 'Range']] as const).map(([k, arL, enL]) => (
              <button key={k} type="button" onClick={() => switchMode(k)}
                className={`px-3 py-2 text-sm font-medium transition-colors ${
                  dateMode === k ? 'bg-[#f37121] text-white' : 'bg-white text-slate-500 hover:text-slate-900'}`}>
                {ar ? arL : enL}
              </button>
            ))}
          </div>
          {dateMode === 'day' && (
            <input type="date" value={dayKey} onChange={(e) => applyDay(e.target.value)}
              aria-label={ar ? 'اختر اليوم' : 'Pick day'}
              className="px-3 py-2 rounded-lg bg-white border border-slate-200 text-slate-900 text-sm focus:outline-none focus:ring-2 focus:ring-[#f37121]/40" />
          )}
          {dateMode === 'month' && (
            <input type="month" value={monthKey} onChange={(e) => applyMonth(e.target.value)}
              aria-label={ar ? 'اختر الشهر' : 'Pick month'}
              className="px-3 py-2 rounded-lg bg-white border border-slate-200 text-slate-900 text-sm focus:outline-none focus:ring-2 focus:ring-[#f37121]/40" />
          )}
          {dateMode === 'range' && (
            <DateRangeFilter ar={ar} from={dateFrom} to={dateTo} onFrom={setDateFrom} onTo={setDateTo} />
          )}
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <div className="flex items-center rounded-lg border border-slate-200 overflow-hidden">
            {([['', 'الكل', 'All'], ['yes', 'مسعَّر', 'Priced'], ['no', 'بلا سعر', 'Unpriced']] as const).map(([k, arL, enL]) => (
              <button key={k || 'all'} type="button" onClick={() => setPriced(k)}
                className={`px-3 py-1.5 text-xs font-semibold transition-colors ${
                  priced === k ? 'bg-slate-800 text-white' : 'bg-white text-slate-500 hover:text-slate-900'}`}>
                {ar ? arL : enL}
              </button>
            ))}
          </div>
          <button type="button" onClick={() => setPendingOnly((v) => !v)}
            className={`px-3 py-1.5 rounded-lg border text-xs font-semibold transition-colors ${
              pendingOnly ? 'border-amber-400 bg-amber-50 text-amber-800' : 'border-slate-200 bg-white text-slate-500 hover:text-slate-900'}`}>
            {ar ? 'فواتير لم تصل' : 'Pending invoices'}
          </button>
          {hasColFilters && (
            <button type="button" onClick={() => setColFilters({})}
              className="flex items-center gap-1 px-3 py-1.5 rounded-lg border border-slate-200 bg-white text-xs font-semibold text-slate-600 hover:text-red-600 hover:border-red-300">
              <FilterX className="w-3.5 h-3.5" />
              {ar ? `مسح فلاتر الأعمدة (${Object.keys(colFilters).length})` : `Clear column filters (${Object.keys(colFilters).length})`}
            </button>
          )}
          <span className="ms-auto text-xs text-slate-500 tabular-nums">
            {ar ? `${total.toLocaleString()} كشفًا حسب الفلتر` : `${total.toLocaleString()} sheets match`}
          </span>
        </div>
      </div>

      <div className="relative bg-white border border-slate-200 rounded-xl overflow-hidden shadow-sm">
        {refreshing && <div className="refresh-bar" aria-hidden="true" />}
        <ScrollX aria-busy={refreshing}>
          <table className="w-full min-w-[3400px] text-sm">
            <thead>
              <tr className="bg-slate-900 border-b border-slate-200">
                {COLS.map(colHead)}
                {plainHead(ar ? 'سعر البيع (الحقيقي)' : 'Selling (real)')}
                {plainHead(ar ? 'الربح' : 'Profit')}
                {plainHead(ar ? 'الهامش %' : 'Margin %')}
                {plainHead(ar ? 'مصدر السعر' : 'Price source', 'text-slate-400')}
                {COLS_AFTER.map(colHead)}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200">
              {rows.length === 0 && (
                <tr><td colSpan={colCount} className="py-14 text-center text-slate-500">
                  {hasColFilters || priced || pendingOnly ? (ar ? 'لا نتائج للفلتر المحدد' : 'No rows match the filters') : (ar ? 'لا كشوف.' : 'No sheets.')}
                </td></tr>
              )}
              {rows.map((r) => (
                <tr key={r._id} className="hover:bg-slate-50">
                  {COLS.map((c) => td(c, r))}

                  {/* ── العمودُ الوحيدُ الذي نملكه ──────────────────────────── */}
                  <td className="px-3 py-2.5 whitespace-nowrap bg-[#f37121]/[0.03]">
                    {editing === r._id ? (
                      <span className="inline-flex items-center gap-1">
                        <input autoFocus type="number" value={draft} onChange={(e) => setDraft(e.target.value)}
                          onKeyDown={(e) => { if (e.key === 'Enter') save(r); if (e.key === 'Escape') setEditing(null); }}
                          className="w-28 px-2 py-1 rounded border border-[#f37121] text-sm tabular-nums focus:outline-none" />
                        <button type="button" onClick={() => save(r)} disabled={saving}
                          className="p-1 rounded text-emerald-600 hover:bg-emerald-50">
                          {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
                        </button>
                        <button type="button" onClick={() => setEditing(null)} className="p-1 rounded text-slate-400 hover:bg-slate-100">
                          <X className="w-4 h-4" />
                        </button>
                      </span>
                    ) : (
                      <button type="button"
                        onClick={() => { setEditing(r._id); setDraft(String(r.sellingValue || '')); }}
                        className={`rounded px-2 py-1 font-bold tabular-nums transition-colors hover:bg-[#f37121]/10 ${
                          r.sellingValue ? 'text-slate-900' : 'text-amber-600'}`}
                        title={ar ? 'اضغط للتعديل — ويصير هذا آخرَ سعرٍ في ملفّ العميل' : 'Click to edit — becomes the latest price in the customer profile'}>
                        {r.sellingValue ? money(r.sellingValue) : (ar ? 'بلا سعر' : 'not priced')}
                      </button>
                    )}
                  </td>
                  <td className={`px-3 py-2.5 tabular-nums font-semibold whitespace-nowrap bg-[#f37121]/[0.03] ${
                    r.profit == null ? 'text-slate-300' : (r.profit >= 0 ? 'text-emerald-700' : 'text-red-600')}`}>
                    {r.profit == null ? '—' : money(r.profit)}
                  </td>
                  <td className={`px-3 py-2.5 tabular-nums whitespace-nowrap bg-[#f37121]/[0.03] ${
                    r.margin == null ? 'text-slate-300' : (r.margin >= 0 ? 'text-violet-700' : 'text-red-600')}`}>
                    {r.margin == null ? '—' : `${r.margin}%`}
                  </td>
                  <td className="px-3 py-2.5 text-[11px] text-slate-400 whitespace-nowrap bg-[#f37121]/[0.03]">{sourceLabel(r.priceSource)}</td>

                  {COLS_AFTER.map((c) => td(c, r))}
                </tr>
              ))}
            </tbody>
          </table>
        </ScrollX>

        <div className="flex items-center justify-between px-4 py-3 border-t border-slate-200">
          <p className="text-xs text-slate-500">
            {ar ? `${total.toLocaleString()} كشفًا · صفحة ${page} من ${pages}` : `${total.toLocaleString()} sheets · page ${page} of ${pages}`}
          </p>
          <div className="flex items-center gap-1">
            <button type="button" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}
              title={T.previous}
              className="p-2 rounded-lg border border-slate-200 text-slate-600 disabled:opacity-40 hover:bg-slate-50">
              {isRTL ? <ChevronRight className="w-4 h-4" /> : <ChevronLeft className="w-4 h-4" />}
            </button>
            <button type="button" disabled={page >= pages} onClick={() => setPage((p) => p + 1)}
              title={T.next}
              className="p-2 rounded-lg border border-slate-200 text-slate-600 disabled:opacity-40 hover:bg-slate-50">
              {isRTL ? <ChevronLeft className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
