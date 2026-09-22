'use client';
// طلبات الشحنات — the trial section's main list. Everything the team needs to
// run the day happens HERE, without opening each order: search by بوليصة or
// customer, flip a status inline, download the بوليصة PDF per row.
import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/context/AuthContext';
import { ContactButtons } from '@/components/crm/CrmKit';
import { useLanguage } from '@/context/LanguageContext';
import { useSocket } from '@/hooks/useSocket';
import api from '@/lib/api';
import { useDialog } from '@/components/system/DialogProvider';
import { PackageSearch, Plus, Pencil, Eye, FileDown, Loader2, RefreshCw, X, Check } from 'lucide-react';
import {
  Spinner, PageHeader, SearchInput, PrimaryButton, StatCard, Select, ErrorNotice,
} from '@/components/hr/HRKit';
import ExportMenu, { exportScopeLabels, type ExportColumn } from '@/components/ls2/ExportMenu';
import {
  ShipmentOrder, OrderCustomer, orderStatus, statusLabel,
  fmtDT, money, canEditOrders, canAdminOrders, Lang, vocabLabel,
} from '@/lib/shipmentOrders';
import { useOrderStatuses } from '@/hooks/useOrderStatuses';
import { useLatestRequest } from '@/hooks/useLatestRequest';
import ScrollX from '@/components/system/ScrollX';


// ── حالاتٌ لا تُقال بلا ورقة ────────────────────────────────────────────────
// نظيرُ `REQUIRE_FILE` في الخادم (shipmentOrdersController) — وهو الحارس؛
// وهذه لتعين الموظّفَ قبل أن يُردَّ عليه.
// ── ونزولُ الملفّ لا يستدعي مولّدًا ─────────────────────────────────────────
// كان الزرُّ يجلب `lib/dispatchSheetGenerator` ليستعمل منه سطرَ التنزيل وحدَه —
// وهو ملفٌّ يجرّ معه JSZip وpdf-lib والقالبَ كلَّه: مئاتُ الكيلوبايتات تُحمَّل
// وتُفسَّر عند أوّل ضغطة، وقد صارت البوليصةُ تُرسَم في الخادم فلا حاجةَ إليه.
function downloadBlob(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

const STATUS_NEEDS_FILE = new Set(['bond_sent']);
type PickedFile = { dataUrl: string; fileName: string; size: number };
const MAX_UPLOAD = 20 * 1024 * 1024;

const fmtDate = (v?: string | null) => {
  if (!v) return '';
  const d = new Date(v);
  return `${d.getDate()}/${d.getMonth() + 1}/${d.getFullYear()}`;
};

// ── والصفُّ لم يعد يُبنى هنا ───────────────────────────────────────────────
// كان `toSheetRow` يحوّل الطلبَ إلى صفِّ بوليصةٍ ليرسمها المتصفّح. والرسمُ صار
// في الخادم من الطلب نفسِه (utils/waybillPdf · rowFromOrder)، فالتحويلُ هنا
// نسخةٌ ثانيةٌ من القاعدة تشيخ وحدَها: أُضيفت الملاحظاتُ وسعرُ البيع والإقرار
// إلى تلك ولم تصل هذه.

// بوليصة-501-اسم العميل-22-7-2026
const waybillFileName = (o: ShipmentOrder) => {
  const d = new Date(o.pickupTime || o.createdAt || Date.now());
  const ref = (o as any).reference || o.waybillNumber || '';
  return `بوليصة-${ref}-${o.customerName || 'عميل'}-${d.getDate()}-${d.getMonth() + 1}-${d.getFullYear()}`;
};

export default function ShipmentOrdersPage() {
  const { user } = useAuth();
  const { lang, isRTL } = useLanguage();
  const ar = lang === 'ar';
  const router = useRouter();
  const { confirm, notify } = useDialog();
  const editor = canEditOrders(user);

  const [orders, setOrders] = useState<ShipmentOrder[]>([]);
  const [customers, setCustomers] = useState<OrderCustomer[]>([]);
  const [stats, setStats] = useState<{ byStatus: Record<string, number>; sellTotal: number; buyTotal: number; bySource?: { system: number; platform: number; total: number } } | null>(null);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const [search, setSearch] = useState('');
  const [debounced, setDebounced] = useState('');
  // ── الحالةُ تُنتقى بالتراكم ───────────────────────────────────────────────
  // «أرِني المتأخّرةَ وما في الطريق معًا» سؤالٌ يُسأل كلَّ صباح، وقائمةٌ منسدلة
  // تجيب عن واحدةٍ فقط. فالبطاقاتُ فوق الجدول هي الفلتر — كما في شاشة شحنات
  // المنصّة، والفريقُ يعرفها.
  const [statuses, setStatuses] = useState<string[]>([]);
  // ملاحظةُ الرحلة: الكلّ · لها ملاحظة · بلا ملاحظة.
  const [noteFilter, setNoteFilter] = useState('');
  const statusVocab = useOrderStatuses();
  const statusFilter = statuses.join(',');
  const toggleStatus = (k: string) => {
    setStatuses((p) => (p.includes(k) ? p.filter((x) => x !== k) : [...p, k]));
    setPage(1);
  };
  // ── الخاصّ بنا أم المنصّة؟ ────────────────────────────────────────────────
  // شحناتُ المنصّة تحمل رقمَ كشف تخريجٍ حقيقيًّا يُحاسَب عليه، وشحناتُنا —
  // تجريبيّةً اليوم — يسبق رقمَها حرف. ومن يقرأ تقريرًا يجب أن يعرف أهو عن
  // عملٍ جرى أم عن تجربة.
  const [sourceFilter, setSourceFilter] = useState('');
  const [customerFilter, setCustomerFilter] = useState('');
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');
  const [page, setPage] = useState(1);

  const [busyId, setBusyId] = useState<string | null>(null);

  // نافذةُ المتابعة: الحالةُ الجديدة وملاحظةٌ اختياريّة.

  const [fu, setFu] = useState<{ order: any; status: string; note: string } | null>(null);
  const [detail, setDetail] = useState<ShipmentOrder | null>(null);
  const [fuFile, setFuFile] = useState<PickedFile | null>(null);

  const openFollowUp = (o: any) => { setFuFile(null); setFu({ order: o, status: o.status, note: '' }); };

  // ── وحالةٌ تقول «أُرسل السند» تُثبِت السند ────────────────────────────────
  // الشرطُ على الخادم (REQUIRE_FILE في shipmentOrdersController)، وهنا يُعان
  // الموظّفُ عليه: الزرُّ لا يعمل قبل الإرفاق ويُقال له لماذا — بدل أن يضغط
  // فيُردَّ عليه بخطأ.
  const submitFollowUp = async () => {
    if (!fu) return;
    if (STATUS_NEEDS_FILE.has(fu.status) && fu.status !== fu.order.status && !fuFile) {
      notify(ar ? 'أرفق صورة السند أو ملفه أولًا.' : 'Attach the bond file first.', 'error');
      return;
    }
    await changeStatus(fu.order, fu.status, fu.note.trim(), fuFile);
    setFuFile(null);
    setFu(null);
  };
  const [downloadingId, setDownloadingId] = useState<string | null>(null);
  // Tick rows → one ZIP of their بوليصات, named number-customer-date.
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [bulkBusy, setBulkBusy] = useState(false);
  const [bulkProgress, setBulkProgress] = useState('');

  useEffect(() => {
    const t = setTimeout(() => { setDebounced(search); setPage(1); }, 300);
    return () => clearTimeout(t);
  }, [search]);
  useEffect(() => { setPage(1); }, [noteFilter]);

  // لا يكتب ردٌّ قديمٌ فوق ردٍّ أحدث — راجع hooks/useLatestRequest.
  const guard = useLatestRequest();
  const load = useCallback(async () => {
    const mine = guard.begin();
    try {
      const qs = new URLSearchParams({ page: String(page), limit: '25' });
      if (debounced.trim()) qs.set('q', debounced.trim());
      if (statusFilter) qs.set('status', statusFilter);
      if (sourceFilter) qs.set('source', sourceFilter);
      if (customerFilter) qs.set('customer', customerFilter);
      if (fromDate) qs.set('from', fromDate);
      if (toDate) qs.set('to', toDate);
      if (noteFilter) qs.set('note', noteFilter);
      const d = await api.get<{ orders: ShipmentOrder[]; total: number; stats: any }>(`/api/shipment-orders/orders?${qs}`);
      if (!guard.isCurrent(mine)) return;
      setOrders(d.orders || []);
      setTotal(d.total || 0);
      setStats(d.stats || null);
      setError('');
    } catch (e: any) { setError(e?.message || 'Request failed'); }
    setLoading(false);
  }, [debounced, statusFilter, sourceFilter, customerFilter, fromDate, toDate, page, guard]);

  useEffect(() => { load(); }, [load]);
  useSocket('shipmentOrders:updated', useCallback(() => load(), [load]));
  useEffect(() => {
    api.get<{ customers: OrderCustomer[] }>('/api/shipment-orders/customers')
      .then((d) => setCustomers(d.customers || [])).catch(() => {});
  }, []);

  // The inline change — the reason nobody has to open an order to say "وصلت".
  const changeStatus = async (o: ShipmentOrder, status: string, note = '', file?: PickedFile | null) => {
    setBusyId(o._id);
    try {
      await api.patch(`/api/shipment-orders/orders/${o._id}/status`, {
        status, note, ...(file ? { dataUrl: file.dataUrl, fileName: file.fileName } : {}),
      });
      load();
    } catch (e: any) { notify(e.message, 'error'); }
    setBusyId(null);
  };

  // ── ولا يُمحى كشفٌ حدث ────────────────────────────────────────────────────
  // كان هنا زرُّ حذف: يُزيل البوليصةَ ورقمَها وسجلَّ حالاتها من القاعدة بلا
  // رجعة. والشحنةُ الملغاة حدثٌ وقع — له رقمٌ أُعطي للعميل وسجلٌّ يُسأل عنه —
  // فمحوُها يُخفي الواقعةَ لا يصحّحها، ويقطع تسلسلَ الأرقام. فمن أراد إلغاءَها
  // يضعها في حالة «ملغاة»: تبقى مقروءةً ومحسوبةً ومفلترةً بحالتها.

  // ── والبوليصةُ الواحدة تُرسَم حيث تُرسَم الكثيرة ─────────────────────────
  // كانت تُبنى في المتصفّح بقالبٍ ثانٍ (lib/dispatchSheetTemplate)، والجماعيّةُ
  // تُبنى في الخادم بقالبه. فقالبان لورقةٍ واحدة: ما يُضاف إلى أحدهما لا يظهر
  // في الآخر — الملاحظاتُ تُطبَع في الجماعيّة ولا تُطبَع في المفردة، والإقرارُ
  // كذلك. والورقةُ التي تُسلَّم للسائق يجب أن تكون واحدةً مهما كان زرُّها.
  const downloadWaybill = async (o: ShipmentOrder) => {
    setDownloadingId(o._id);
    try {
      const blob = await api.postBlob('/api/shipment-orders/orders/waybills.pdf', { ids: [o._id] });
      downloadBlob(blob, `${waybillFileName(o)}.pdf`);
    } catch (e: any) { notify(e?.message || 'PDF failed', 'error'); }
    setDownloadingId(null);
  };

  // ── والبوالصُ الكثيرةُ تُطلَب مرّةً وتُبنى في الخادم ──────────────────────
  //
  // كانت تُرسَم في المتصفّح واحدةً واحدة بـ`html2canvas`: يُركَّب الجدولُ في
  // الصفحة ويُرسَّم بمقياسٍ عالٍ ثمّ يُنزَع، مرّةً لكلّ كشف. والترسيمُ على
  // الخيط الرئيسيّ، فثلاثون كشفًا تعني ثلاثين تجمّدًا تبدو كإعادة تحميلٍ
  // متكرّرة.
  //
  // والخادمُ يرسم البوليصةَ الواحدة أصلًا بالملفّ نفسِه حرفًا بحرف. فصار
  // الجماعيُّ نداءً واحدًا يردّ **ملفًّا واحدًا** فيه صفحةٌ لكلّ بوليصة: لا
  // تجمّد، ولا ثلاثون ملفًّا يُفكّ ضغطُها، ويُطبَع دفعةً واحدة.
  const downloadPicked = async () => {
    const rows = orders.filter((o) => picked.has(o._id));
    if (!rows.length) return;
    setBulkBusy(true);
    setBulkProgress(ar ? `يجهّز ${rows.length}…` : `preparing ${rows.length}…`);
    try {
      const blob = await api.postBlob('/api/shipment-orders/orders/waybills.pdf', { ids: rows.map((o) => o._id) });
      downloadBlob(blob, `بوليصات-الشحن-${rows.length}.pdf`);
      setPicked(new Set());
    } catch (e: any) { notify(e?.message || 'PDF failed', 'error'); }
    setBulkBusy(false);
    setBulkProgress('');
  };

  const togglePick = (id: string) =>
    setPicked((p) => { const n = new Set(p); n.has(id) ? n.delete(id) : n.add(id); return n; });

  // التصديرُ يحمل ما يحمله الجدول: المرجعَ لا الرقمَ الخام، والمصدرَ والمورّدَ
  // والفرعَ — الملفُّ يُفتح خارج النظام ويُقرأ وحدَه.
  const exportColumns: ExportColumn[] = [
    { header: 'Reference', key: 'reference', width: 12, transform: (v: any, r: any) => v || r?.waybillNumber || '' },
    { header: 'Source', key: 'source', width: 10, transform: (v: any) => (v === 'platform' ? 'platform' : 'ours') },
    { header: 'Customer', key: 'customerName', width: 26 },
    { header: 'Supplier', key: 'supplierName', width: 26 },
    { header: 'From', key: 'fromCity', width: 14 },
    { header: 'To', key: 'toCity', width: 14 },
    { header: 'Truck', key: 'truckType', width: 12 },
    { header: 'Plate', key: 'vehiclePlate', width: 12 },
    { header: 'Driver', key: 'driverName', width: 18 },
    { header: 'Driver phone', key: 'driverPhone', width: 14 },
    { header: 'Branch', key: 'branch', width: 12 },
    { header: 'Pickup', key: 'pickupTime', transform: (v: any) => fmtDate(v), width: 14 },
    { header: 'Sell', key: 'sellPrice', width: 10 },
    { header: 'Buy', key: 'buyPrice', width: 10 },
    { header: 'Margin', key: 'margin', width: 10, transform: (_v: any, r: any) => ((Number(r?.sellPrice) || 0) - (Number(r?.buyPrice) || 0)) },
    { header: 'Status', key: 'status', transform: (v: any) => statusLabel(v, 'en'), width: 14 },
    { header: 'Agent', key: 'agentName', width: 16 },
    { header: 'Note', key: 'notes', width: 30 },
  ];
  // الترقيم على الخادم بخمسةٍ وعشرين صفًّا: فلترةُ مئتَي شحنة ثم التصدير كانت
  // تُخرج الصفحة الظاهرة وحدها بلا أيّ إنذار، فصار كلُّ نطاقٍ يُجلَب من الخادم بحدّه.
  const fetchForExport = async (withFilters: boolean) => {
    const qs = new URLSearchParams({ page: '1', limit: '100000' });
    if (withFilters) {
      if (debounced.trim()) qs.set('q', debounced.trim());
      if (statusFilter) qs.set('status', statusFilter);
      if (sourceFilter) qs.set('source', sourceFilter);
      if (customerFilter) qs.set('customer', customerFilter);
      if (fromDate) qs.set('from', fromDate);
      if (toDate) qs.set('to', toDate);
      if (noteFilter) qs.set('note', noteFilter);
    }
    const d = await api.get<{ orders: ShipmentOrder[]; total: number }>(`/api/shipment-orders/orders?${qs}`);
    return [{ name: 'Orders', rows: d.orders || [], columns: exportColumns }];
  };
  const hasActiveFilters = !!(debounced.trim() || statusFilter || sourceFilter || customerFilter || fromDate || toDate);
  const scope = exportScopeLabels(ar);
  const exportOptions = [
    { key: 'page', label: scope.page, sheets: [{ name: 'Orders', rows: orders, columns: exportColumns }] },
    { key: 'matching', label: hasActiveFilters ? scope.matching : scope.all, resolve: () => fetchForExport(true), hint: String(total) },
    ...(hasActiveFilters ? [{ key: 'all', label: scope.all, resolve: () => fetchForExport(false) }] : []),
  ];

  if (loading) return <Spinner />;

  const inFlight = ['loading', 'uploaded', 'on_way'].reduce((s, k) => s + (stats?.byStatus[k] || 0), 0);
  const done = ['arrived', 'bond_sent', 'bond_received', 'invoiced'].reduce((s, k) => s + (stats?.byStatus[k] || 0), 0);

  return (
    <div className="space-y-6" dir={isRTL ? 'rtl' : 'ltr'}>
      <PageHeader
        icon={<PackageSearch className="w-5 h-5" />}
        title={ar ? 'طلبات الشحنات' : 'Shipment Orders'}
        subtitle={ar ? 'إنشاء الشحنات ومتابعتها داخل نظامنا — قسم تجريبي مستقل' : 'Create and track shipments natively — standalone trial'}
      >
        {picked.size > 0 && (
          <button type="button" onClick={downloadPicked} disabled={bulkBusy}
            className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-semibold disabled:opacity-60">
            {bulkBusy ? <Loader2 className="w-4 h-4 animate-spin" /> : <FileDown className="w-4 h-4" />}
            {bulkBusy
              ? (ar ? `جارٍ التجهيز ${bulkProgress}…` : `Generating ${bulkProgress}…`)
              : (ar ? `تحميل ${picked.size} بوليصة` : `Download ${picked.size} waybills`)}
          </button>
        )}
        <ExportMenu fileName="shipment-orders" lang={ar ? 'ar' : 'en'} variant="subtle" options={exportOptions} />
        {editor && (
          <PrimaryButton onClick={() => router.push('/system/shipment-orders/new')}>
            <Plus className="w-4 h-4" /> {ar ? 'إنشاء شحنة' : 'Create shipment'}
          </PrimaryButton>
        )}
      </PageHeader>

      {error && <ErrorNotice error={error} lang={lang} onRetry={load} />}

      {/* ── بطاقاتُ الحالات: هي الفلتر ─────────────────────────────────────
          الرقمُ فوق الاسم يُقرأ من بعيد، والضغطُ ينتقي — وتنتقي أكثرَ من واحدة.
          والأعدادُ محسوبةٌ تحت بقيّة الفلاتر لا تحت الحالة، فمن ضغط «متأخرة»
          يظلّ يرى كم «في الطريق» ليضمّها. */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2.5">
        <button type="button" onClick={() => { setStatuses([]); setPage(1); }}
          className={`text-start rounded-xl p-3 border transition-all ${statuses.length === 0 ? 'bg-slate-900 text-white border-slate-900' : 'bg-white text-slate-700 border-slate-200 hover:border-slate-300'}`}>
          <p className="text-xl font-bold tabular-nums">{total}</p>
          <p className="text-[11px] mt-0.5">{ar ? 'كل الشحنات' : 'All shipments'}</p>
        </button>
        {statusVocab.map((s) => {
          const on = statuses.includes(s.key);
          return (
            <button key={s.key} type="button" onClick={() => toggleStatus(s.key)}
              className={`text-start rounded-xl p-3 border transition-all ${on ? 'text-white border-transparent ring-2 ring-offset-1' : 'bg-white text-slate-700 border-slate-200 hover:border-slate-300'}`}
              style={on ? { background: s.color, boxShadow: `0 0 0 2px ${s.color}` } : undefined}>
              <p className="text-xl font-bold tabular-nums">{stats?.byStatus?.[s.key] ?? 0}</p>
              <p className="text-[11px] mt-0.5 flex items-center gap-1">
                <span className="w-1.5 h-1.5 rounded-full" style={{ background: on ? '#fff' : s.color }} />
                {vocabLabel(s, lang as Lang)}
              </p>
            </button>
          );
        })}
      </div>
      {statuses.length > 0 && (
        <div className="text-xs text-slate-500">
          {ar ? 'محدد' : 'Selected'}: {statuses.length} · {ar ? 'إجمالي' : 'total'} {total}
          <button type="button" onClick={() => { setStatuses([]); setPage(1); }} className="ms-2 text-[#f37121] hover:underline">{ar ? 'مسح' : 'clear'}</button>
        </div>
      )}

      {/* ── والباقي عددان لا خمسة ─────────────────────────────────────────
          «إجمالي البيع» و«هامش الربح» كانا فوق شاشةٍ يفتحها فريقُ التشغيل كلَّ
          يوم — رقمان ماليّان لا يُقرآن هنا ولا يُتصرَّف بهما، ومكانُهما صفحةُ
          التحليلات. */}
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
        <StatCard label={ar ? 'إجمالي الشحنات' : 'Total shipments'} value={total} accent="text-[#f37121]" />
        <StatCard label={ar ? 'قيد التنفيذ' : 'In flight'} value={inFlight} accent="text-blue-600" />
        <StatCard label={ar ? 'وصلت / مكتملة' : 'Arrived / done'} value={done} accent="text-emerald-600" />
      </div>

      <div className="flex flex-wrap gap-3 items-center">
        <div className="flex-1 min-w-[240px]">
          <SearchInput value={search} onChange={setSearch}
            placeholder={ar ? 'بحث برقم البوليصة أو كشف التخريج أو العميل أو المورّد أو السائق أو المدينة…' : 'waybill, graduation no., customer, supplier, driver, city…'} />
        </div>
        {/* ── مصدرُ الشحنة ─────────────────────────────────────────────────
            أزرارٌ لا قائمةٌ منسدلة: هذا سؤالٌ يُسأل في كلّ جلسة، وكلُّ زرٍّ
            يحمل عددَه تحت بقيّة الفلاتر — فيُعرف الحجمُ قبل الضغط. */}
        {/* ── وفلترُ الملاحظة ──────────────────────────────────────────────
            «أرِني ما كُتبت عليه ملاحظة» سؤالٌ يُسأل قبل الطباعة: البوليصةُ
            تحمل الملاحظة، فيُراجَع ما سيُطبَع فيها. */}
        <div className="inline-flex rounded-lg bg-slate-100 p-1 gap-1 shrink-0">
          {([
            ['', ar ? 'الكل' : 'All'],
            ['yes', ar ? 'لها ملاحظة' : 'With note'],
            ['no', ar ? 'بلا ملاحظة' : 'No note'],
          ] as [string, string][]).map(([k, label]) => (
            <button key={k || 'all-note'} type="button" onClick={() => setNoteFilter(k)}
              className={`px-3 py-1.5 rounded-md text-[13px] font-semibold transition-colors ${noteFilter === k ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-800'}`}>
              {label}
            </button>
          ))}
        </div>
        <div className="inline-flex rounded-lg bg-slate-100 p-1 gap-1 shrink-0">
          {([
            ['', ar ? 'الكل' : 'All', stats?.bySource?.total],
            ['system', ar ? 'الخاص بنا' : 'Ours', stats?.bySource?.system],
            ['platform', ar ? 'المنصّة' : 'Platform', stats?.bySource?.platform],
          ] as [string, string, number | undefined][]).map(([k, label, count]) => (
            <button key={k || 'all'} type="button" onClick={() => { setSourceFilter(k); setPage(1); }}
              className={`px-3 py-1.5 rounded-md text-xs font-semibold whitespace-nowrap transition-colors ${
                sourceFilter === k ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-800'}`}>
              {label}
              {count != null && <span className="ms-1 text-slate-400 tabular-nums">{count}</span>}
            </button>
          ))}
        </div>
        <div className="w-56 grow sm:grow-0">
          <Select value={customerFilter} onChange={(e) => { setCustomerFilter(e.target.value); setPage(1); }}>
            <option value="">{ar ? 'كل العملاء' : 'All customers'}</option>
            {customers.map((c) => <option key={c._id} value={c._id}>{c.name}</option>)}
          </Select>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <input type="date" value={fromDate} onChange={(e) => { setFromDate(e.target.value); setPage(1); }}
            className="px-3 py-2 rounded-lg border border-slate-200 bg-white text-sm text-slate-900" />
          <span className="text-slate-400 text-sm">→</span>
          <input type="date" value={toDate} onChange={(e) => { setToDate(e.target.value); setPage(1); }}
            className="px-3 py-2 rounded-lg border border-slate-200 bg-white text-sm text-slate-900" />
        </div>
      </div>

      <ScrollX className="bg-white border border-slate-200 rounded-xl shadow-sm">
        <table className="w-full text-sm">
          <thead><tr className="bg-slate-900 border-b border-slate-200 text-slate-300">
            <th className="px-3 py-3">
              <input type="checkbox" className="w-4 h-4 accent-[#f37121]"
                checked={picked.size > 0 && orders.every((o) => picked.has(o._id))}
                onChange={(e) => setPicked(e.target.checked ? new Set(orders.map((o) => o._id)) : new Set())}
                aria-label={ar ? 'تحديد الكل' : 'Select all'} />
            </th>
            {[
              ar ? 'رقم البوليصة' : 'Waybill',
              ar ? 'العميل' : 'Customer',
              // ── «من» و«إلى» عمودان لا سهمٌ في عمود ─────────────────────────
              // «جدة ← الرياض» في خليّةٍ واحدة يُقرأ بالعينين لا بالعين، ويُخطئ
              // في العربيّة خاصّةً: السهمُ يشير إلى اليسار والنصُّ يجري إلى
              // اليمين، فيُقرأ عكسَه. وعمودان يُفرَزان ويُفلتَران ويُصدَّران.
              ar ? 'من' : 'From',
              ar ? 'إلى' : 'To',
              ar ? 'السائق' : 'Driver',
              ar ? 'تواصل' : 'Contact',
              ar ? 'الشاحنة' : 'Truck',
              ar ? 'وقت الاستلام' : 'Pickup',
              ar ? 'بيع / شراء' : 'Sell / buy',
              ar ? 'الحالة' : 'Status',
              ar ? 'ملاحظة' : 'Note',
              ar ? 'إجراءات' : 'Actions',
            ].map((h, i) => <th key={i} className="text-start font-semibold px-4 py-3 whitespace-nowrap">{h}</th>)}
          </tr></thead>
          <tbody>
            {orders.length === 0 ? (
              <tr><td colSpan={13} className="text-center text-slate-500 py-14">
                {ar ? 'لا توجد شحنات بعد — ابدأ من زر «إنشاء شحنة».' : 'No shipments yet — start with “Create shipment”.'}
              </td></tr>
            ) : orders.map((o) => {
              const st = orderStatus(o.status);
              // حالةٌ زادها القسمُ من إعداداته لا صفوفَ ألوانٍ لها في الشيفرة —
              // فتُلوَّن بلونها المضبوط بدل أن تظهر شارةً بلا لون.
              const sv = statusVocab.find((x) => x.key === o.status) || null;
              const pillStyle = st ? undefined : (sv ? { background: `${sv.color}1a`, color: sv.color } : undefined);
              const pillLabel = sv ? vocabLabel(sv, lang as Lang) : statusLabel(o.status, lang as Lang);
              return (
                <tr key={o._id} onClick={() => setDetail(o)}
                  className="border-b border-slate-200/70 hover:bg-slate-50 cursor-pointer">
                  <td className="px-3 py-3" onClick={(e) => e.stopPropagation()}>
                    <input type="checkbox" className="w-4 h-4 accent-[#f37121]"
                      checked={picked.has(o._id)} onChange={() => togglePick(o._id)}
                      aria-label={String(o.waybillNumber)} />
                  </td>
                  {/* المرجعُ لا الرقمُ الخام: «E-500» لنا و«86039» لهم — يُقرأ
                      الفرقُ بالعين قبل أن يُفلتَر. */}
                  <td className="px-4 py-3 text-slate-900 font-bold font-mono whitespace-nowrap">
                    {(o as any).reference || o.waybillNumber}
                    {(o as any).source === 'platform' && (
                      <span className="ms-1.5 text-[10px] font-normal text-slate-400">{ar ? 'منصّة' : 'platform'}</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-slate-900 font-medium max-w-[220px] truncate" title={o.customerName}>{o.customerName || '—'}</td>
                  <td className="px-4 py-3 text-slate-700 whitespace-nowrap">{o.fromCity || '—'}</td>
                  <td className="px-4 py-3 text-slate-700 whitespace-nowrap">{o.toCity || '—'}</td>
                  <td className="px-4 py-3 text-slate-700 max-w-[170px] truncate" title={o.driverName || ''}>{o.driverName || '—'}</td>
                  {/* ── عمودُ التواصل ────────────────────────────────────────
                      فريقُ التشغيل يتّصل بالسائق عشرَ مرّاتٍ في اليوم: كان
                      يفتح الحمولةَ لينسخ الرقمَ ثمّ يفتح واتساب ويلصقه. ضغطةٌ
                      واحدة تفتح المحادثةَ على رقمه، وأخرى تتّصل به — ورسالةٌ
                      جاهزةٌ تحمل رقمَ البوليصة فلا يُسأل «أيّ حمولة؟». */}
                  <td className="px-4 py-3">
                    {(o.driverPhone || '').trim()
                      ? <ContactButtons
                          phone={o.driverPhone}
                          size={15}
                          messageText={ar
                            ? `السلام عليكم، بخصوص البوليصة رقم ${(o as any).reference || o.waybillNumber}${o.fromCity ? ` (${o.fromCity} — ${o.toCity || ''})` : ''}`
                            : `Hello, regarding waybill ${(o as any).reference || o.waybillNumber}${o.fromCity ? ` (${o.fromCity} — ${o.toCity || ''})` : ''}`}
                        />
                      : <span className="text-slate-300 text-xs">{ar ? 'لا رقم' : 'no phone'}</span>}
                  </td>
                  <td className="px-4 py-3 text-slate-700">{o.truckType || '—'}</td>
                  <td className="px-4 py-3 text-slate-700 text-xs whitespace-nowrap">{fmtDT(o.pickupTime, lang as Lang)}</td>
                  <td className="px-4 py-3 text-slate-700 whitespace-nowrap">{money(o.sellPrice)} / {money(o.buyPrice)}</td>
                  {/* الحالةُ كلمتان («قيد الطلب») — وبلا `nowrap` تنكسر سطرين فيتباعد الصفّ. */}
                  <td className="px-4 py-3 whitespace-nowrap" onClick={(e) => e.stopPropagation()}>
                    {/* ── المتابعةُ نقلةُ حالةٍ ومعها سببُها ──────────────────
                        القائمةُ المنسدلة تنقل الحالةَ بلا أن تسأل «لماذا»، ثمّ
                        يُسأل بعد أسبوع «مين أخّرها؟» فلا جواب. صارت تفتح نافذةً
                        تُختار فيها الحالةُ وتُكتب ملاحظةٌ **اختياريّة**، ويُقرأ
                        فيها سجلُّ الانتقالات السابقة. */}
                    {editor ? (
                      <button type="button" onClick={() => openFollowUp(o)} disabled={busyId === o._id}
                        className={`inline-flex items-center gap-1.5 text-xs font-medium rounded-full px-2.5 py-1.5 transition-opacity hover:opacity-80 ${st ? `${st.bg} ${st.text}` : 'bg-slate-100 text-slate-700'}`}
                        style={pillStyle}
                        title={ar ? 'تسجيل متابعة' : 'Record a follow-up'}>
                        {busyId === o._id ? <Loader2 className="w-3 h-3 animate-spin" /> : <RefreshCw className="w-3 h-3 opacity-60" />}
                        {pillLabel}
                        {(o.statusLog || []).length ? <span className="opacity-60">· {(o.statusLog || []).length}</span> : null}
                      </button>
                    ) : (
                      <span className={`text-xs font-medium rounded-full px-2.5 py-1 ${st ? `${st.bg} ${st.text}` : 'bg-slate-100 text-slate-700'}`} style={pillStyle}>{pillLabel}</span>
                    )}
                  </td>
                  {/* ── ملاحظةُ الرحلة ───────────────────────────────────────
                      تُكتب مع المدن وتُطبَع في البوليصة، فتُقرأ هنا بلا فتح
                      الحمولة — ويُفلتَر بها أعلى الجدول. */}
                  <td className="px-4 py-3 max-w-[220px]">
                    {(o.notes || '').trim()
                      ? <span className="block truncate text-[13px] text-slate-700" title={o.notes}>{o.notes}</span>
                      : <span className="text-slate-300">—</span>}
                  </td>
                  <td className="px-4 py-3" onClick={(e) => e.stopPropagation()}>
                    <div className="flex items-center justify-end gap-1">
                      <button type="button" onClick={() => downloadWaybill(o)} disabled={downloadingId === o._id}
                        className="p-1.5 rounded-lg text-slate-500 hover:text-[#f37121] hover:bg-slate-100 disabled:opacity-50"
                        title={ar ? 'تحميل البوليصة PDF' : 'Download waybill PDF'}>
                        {downloadingId === o._id ? <Loader2 className="w-4 h-4 animate-spin" /> : <FileDown className="w-4 h-4" />}
                      </button>
                      {editor && (
                        <button type="button" onClick={() => router.push(`/system/shipment-orders/new?id=${o._id}`)}
                          className="p-1.5 rounded-lg text-slate-500 hover:text-blue-600 hover:bg-slate-100" title={ar ? 'تعديل' : 'Edit'}>
                          <Pencil className="w-4 h-4" />
                        </button>
                      )}
                      {/* ── والعرضُ مكانَ الحذف ──────────────────────────
                          الصفُّ يحمل خمسةَ عشرَ عمودًا لا يظهر منها في الجدول
                          إلّا ما يسع، والباقي يُعرَف بفتح التعديل — وهو بابُ
                          كتابةٍ يُفتَح لقراءة. فصار للقراءة بابُها. */}
                      <button type="button" onClick={() => setDetail(o)}
                        className="p-1.5 rounded-lg text-slate-500 hover:text-slate-900 hover:bg-slate-100"
                        title={ar ? 'عرض التفاصيل' : 'View details'}>
                        <Eye className="w-4 h-4" />
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </ScrollX>

      {total > 25 && (
        <div className="flex items-center justify-end gap-2 text-sm">
          <button type="button" onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page === 1}
            className="px-3 py-1.5 rounded-lg bg-white border border-slate-200 text-slate-600 disabled:opacity-50">{ar ? 'السابق' : 'Prev'}</button>
          <span className="text-slate-500">{page} / {Math.ceil(total / 25)}</span>
          <button type="button" onClick={() => setPage((p) => Math.min(Math.ceil(total / 25), p + 1))} disabled={page >= Math.ceil(total / 25)}
            className="px-3 py-1.5 rounded-lg bg-white border border-slate-200 text-slate-600 disabled:opacity-50">{ar ? 'التالي' : 'Next'}</button>
        </div>
      )}

      {/* ── نافذةُ التفاصيل ──────────────────────────────────────────────────
          الجدولُ يعرض ما يسعه، والحمولةُ فيها أربعون حقلًا: المدنُ والعناوينُ
          والسائقُ ومركبتُه والأسعارُ ونوعُ التأجير والحقولُ التي زادها القسمُ
          من إعداداته. وكانت تُقرأ بفتح شاشة التعديل — بابُ كتابةٍ يُفتَح
          لقراءة، فيُحفَظ منه تعديلٌ بالخطأ. فصار للقراءة بابُها. */}
      {detail && (() => {
        const d = detail;
        const sv2 = statusVocab.find((x) => x.key === d.status) || null;
        const st2 = orderStatus(d.status);
        const cust = typeof d.customer === 'object' && d.customer ? (d.customer as OrderCustomer) : null;
        const Row = ({ k, v }: { k: string; v: any }) => {
          const val = v === 0 ? '0' : (v || '').toString().trim();
          if (!val) return null;
          return (
            <div className="flex gap-3 py-1.5 border-b border-slate-100 last:border-0">
              <span className="w-40 shrink-0 text-xs text-slate-500">{k}</span>
              <span className="text-[13px] font-semibold text-slate-900 break-words">{val}</span>
            </div>
          );
        };
        const Group = ({ title, children }: { title: string; children: React.ReactNode }) => (
          <div className="rounded-xl border border-slate-200 bg-white">
            <p className="px-4 py-2 text-xs font-bold text-slate-600 bg-slate-50 rounded-t-xl border-b border-slate-200">{title}</p>
            <div className="px-4 py-2">{children}</div>
          </div>
        );
        return (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4" onClick={() => setDetail(null)}>
            <div className="w-full max-w-3xl bg-slate-50 rounded-2xl shadow-xl max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
              <div className="px-5 py-4 border-b border-slate-200 bg-white rounded-t-2xl flex items-center justify-between sticky top-0 z-10">
                <div className="min-w-0">
                  <p className="font-bold text-slate-900 flex items-center gap-2">
                    {ar ? 'بوليصة' : 'Waybill'} <span className="font-mono">{(d as any).reference || d.waybillNumber}</span>
                    <span className={`text-[11px] font-semibold rounded-full px-2 py-0.5 ${st2 ? `${st2.bg} ${st2.text}` : 'bg-slate-100 text-slate-700'}`}
                      style={st2 ? undefined : (sv2 ? { background: `${sv2.color}1a`, color: sv2.color } : undefined)}>
                      {sv2 ? vocabLabel(sv2, lang as Lang) : statusLabel(d.status, lang as Lang)}
                    </span>
                  </p>
                  <p className="text-xs text-slate-500 mt-0.5">{d.customerName || '—'}{d.fromCity ? ` · ${d.fromCity} → ${d.toCity || ''}` : ''}</p>
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  <button type="button" onClick={() => downloadWaybill(d)} disabled={downloadingId === d._id}
                    className="p-1.5 rounded-lg text-slate-500 hover:text-[#f37121] hover:bg-slate-100 disabled:opacity-50"
                    title={ar ? 'تحميل البوليصة PDF' : 'Download waybill PDF'}>
                    {downloadingId === d._id ? <Loader2 className="w-5 h-5 animate-spin" /> : <FileDown className="w-5 h-5" />}
                  </button>
                  {editor && (
                    <button type="button" onClick={() => router.push(`/system/shipment-orders/new?id=${d._id}`)}
                      className="p-1.5 rounded-lg text-slate-500 hover:text-blue-600 hover:bg-slate-100" title={ar ? 'تعديل' : 'Edit'}>
                      <Pencil className="w-5 h-5" />
                    </button>
                  )}
                  <button type="button" onClick={() => setDetail(null)} className="p-1.5 rounded-lg text-slate-400 hover:text-slate-900 hover:bg-slate-100">
                    <X className="w-5 h-5" />
                  </button>
                </div>
              </div>

              <div className="p-5 grid grid-cols-1 md:grid-cols-2 gap-4">
                <Group title={ar ? 'الرحلة' : 'Trip'}>
                  <Row k={ar ? 'من مدينة' : 'From city'} v={d.fromCity} />
                  <Row k={ar ? 'عنوان التحميل' : 'Pickup address'} v={d.addressFrom} />
                  <Row k={ar ? 'إلى مدينة' : 'To city'} v={d.toCity} />
                  <Row k={ar ? 'عنوان التسليم' : 'Delivery address'} v={d.addressTo} />
                  <Row k={ar ? 'موعد التحميل' : 'Pickup time'} v={fmtDT(d.pickupTime, lang as Lang)} />
                  <Row k={ar ? 'وقت الانطلاق' : 'Start time'} v={fmtDT(d.startTime, lang as Lang)} />
                  <Row k={ar ? 'وقت الوصول' : 'Arrival time'} v={fmtDT(d.arrivalTime, lang as Lang)} />
                  <Row k={ar ? 'ملاحظة الرحلة' : 'Trip note'} v={d.notes} />
                </Group>

                <Group title={ar ? 'الحمولة والمركبة' : 'Load & vehicle'}>
                  <Row k={ar ? 'نوع الشاحنة' : 'Truck type'} v={d.truckType} />
                  <Row k={ar ? 'طول الشاحنة' : 'Truck length'} v={d.truckLength} />
                  <Row k={ar ? 'نوع الحمولة' : 'Cargo type'} v={d.cargoType} />
                  <Row k={ar ? 'السائق' : 'Driver'} v={d.driverName} />
                  <Row k={ar ? 'جوال السائق' : 'Driver phone'} v={d.driverPhone} />
                  <Row k={ar ? 'المركبة' : 'Vehicle'} v={d.vehicleName} />
                  <Row k={ar ? 'اللوحة' : 'Plate'} v={(d as any).vehiclePlate} />
                  <Row k={ar ? 'الوسيط' : 'Agent'} v={d.agentName} />
                </Group>

                <Group title={ar ? 'العميل' : 'Customer'}>
                  <Row k={ar ? 'الاسم' : 'Name'} v={d.customerName} />
                  <Row k={ar ? 'الجوال' : 'Phone'} v={cust?.phone} />
                  <Row k={ar ? 'الفرع' : 'Branch'} v={d.branch} />
                  <Row k={ar ? 'المصدر' : 'Source'} v={(d as any).source === 'platform' ? (ar ? 'منصّة التشغيل' : 'Operations platform') : (ar ? 'النظام' : 'System')} />
                  <Row k={ar ? 'أنشأها' : 'Created by'} v={typeof d.createdBy === 'object' && d.createdBy ? `${d.createdBy.firstName || ''} ${d.createdBy.lastName || ''}`.trim() : ''} />
                  <Row k={ar ? 'تاريخ الإنشاء' : 'Created at'} v={fmtDT(d.createdAt, lang as Lang)} />
                </Group>

                {/* أرقامُ المال لمن يملكها — الجدولُ نفسُه يعرضها لهؤلاء. */}
                <Group title={ar ? 'الأجرة والدفع' : 'Fare & payment'}>
                  <Row k={ar ? 'سعر البيع' : 'Selling price'} v={money(d.sellPrice)} />
                  <Row k={ar ? 'سعر الشراء' : 'Buying price'} v={money(d.buyPrice)} />
                  <Row k={ar ? 'نوع تأجير السائق' : 'Driver rent type'} v={d.driverRentType} />
                  <Row k={ar ? 'أجرة السائق' : 'Driver rent'} v={money(d.driverRentPrice)} />
                  <Row k={ar ? 'طريقة الدفع' : 'Payment method'} v={d.paymentMethod} />
                </Group>

                {/* الحقولُ التي زادها القسمُ من إعداداته — تُقرأ بأسمائها لا بمفاتيحها. */}
                {d.customFields && Object.keys(d.customFields).length > 0 && (
                  <div className="md:col-span-2">
                    <Group title={ar ? 'حقول إضافية' : 'Extra fields'}>
                      {Object.entries(d.customFields).map(([k, v]) => <Row key={k} k={k} v={v as any} />)}
                    </Group>
                  </div>
                )}

                {/* سجلُّ الحالات — نفسُه المعروض في نافذة المتابعة. */}
                {(d.statusLog || []).length > 0 && (
                  <div className="md:col-span-2">
                    <Group title={ar ? 'سجلّ الحالات' : 'Status history'}>
                      <div className="space-y-1.5 py-1">
                        {[...(d.statusLog || [])].reverse().map((l, i) => (
                          <div key={i} className="flex flex-wrap items-center gap-2 text-[12px]">
                            <span className="font-semibold text-slate-900">{statusLabel(l.to || '', lang as Lang)}</span>
                            <span className="text-slate-400">·</span>
                            <span className="text-slate-500">{fmtDT(l.at, lang as Lang)}</span>
                            {l.byName ? <><span className="text-slate-400">·</span><span className="text-slate-500">{l.byName}</span></> : null}
                            {l.note ? <span className="text-slate-700">— {l.note}</span> : null}
                            {(l as any).fileUrl ? (
                              <a href={(l as any).fileUrl} target="_blank" rel="noreferrer"
                                className="inline-flex items-center gap-1 font-semibold text-[#f37121] hover:underline">
                                <FileDown className="w-3 h-3" />{(l as any).fileName || (ar ? 'المرفق' : 'Attachment')}
                              </a>
                            ) : null}
                          </div>
                        ))}
                      </div>
                    </Group>
                  </div>
                )}
              </div>
            </div>
          </div>
        );
      })()}

      {/* ── نافذةُ المتابعة ───────────────────────────────────────────────────
          الحالةُ تُنقَل، والملاحظةُ اختياريّة — تُكتب حين يكون للنقلة سبب
          («العميل أجّل التحميل»، «الشاحنة تعطّلت في الطريق») وتُترك حين لا
          يكون. والسجلُّ تحتها يقول من نقلها ومتى وبأيّ سبب. */}
      {fu && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4" onClick={() => setFu(null)}>
          <div className="w-full max-w-lg bg-white rounded-2xl shadow-xl max-h-[88vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between">
              <div className="min-w-0">
                <p className="font-bold text-slate-900">{ar ? 'تسجيل متابعة' : 'Record a follow-up'}</p>
                <p className="text-xs text-slate-500 mt-0.5">
                  {ar ? 'بوليصة' : 'Waybill'} <span className="font-mono font-bold">{fu.order.waybillNumber}</span>
                  {fu.order.customerName ? ` · ${fu.order.customerName}` : ''}
                  {fu.order.fromCity ? ` · ${fu.order.fromCity} → ${fu.order.toCity || ''}` : ''}
                </p>
              </div>
              <button type="button" onClick={() => setFu(null)} className="p-1.5 rounded-lg text-slate-400 hover:text-slate-900 hover:bg-slate-100 shrink-0">
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-5 space-y-4">
              <div>
                <label className="block text-sm font-semibold text-slate-800 mb-2">{ar ? 'الحالة' : 'Status'}</label>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                  {statusVocab.map((s2) => {
                    const on = fu.status === s2.key;
                    return (
                      <button key={s2.key} type="button" onClick={() => setFu({ ...fu, status: s2.key })}
                        // المختارُ يُعرَف بلونه — والحلقةُ البرتقاليّة فوقه تزاحمه.
                        className={`text-xs font-semibold rounded-lg px-2.5 py-2 border transition-colors ${
                          on ? 'text-white border-transparent' : 'bg-white text-slate-600 border-slate-200 hover:border-slate-300'}`}
                        style={on ? { background: s2.color } : undefined}>
                        {vocabLabel(s2, lang as Lang)}
                      </button>
                    );
                  })}
                </div>
              </div>

              <div>
                <label className="block text-sm font-semibold text-slate-800 mb-1.5">
                  {ar ? 'ملاحظة' : 'Note'}
                  <span className="text-slate-400 text-xs font-normal ms-1.5">{ar ? '(اختياري)' : '(optional)'}</span>
                </label>
                <textarea rows={2} value={fu.note} onChange={(e) => setFu({ ...fu, note: e.target.value })}
                  placeholder={ar ? 'سببُ النقلة إن كان لها سبب…' : 'Why it moved, if there is a reason…'}
                  className="w-full px-3 py-2 rounded-lg bg-white border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-[#f37121]/50" />
              </div>

              {/* المرفقُ يظهر حين تطلبه الحالة — ولا يُعرَض في غيرها فيُشغِل. */}
              {STATUS_NEEDS_FILE.has(fu.status) && (
                <div>
                  <label className="block text-sm font-semibold text-slate-800 mb-1.5">
                    {ar ? 'صورة السند أو ملفه' : 'Bond file'}
                    <span className="text-red-500 ms-1">*</span>
                  </label>
                  <input type="file" accept="image/*,application/pdf,.doc,.docx,.xls,.xlsx"
                    onChange={async (e) => {
                      const f = e.target.files?.[0];
                      if (!f) { setFuFile(null); return; }
                      if (f.size > MAX_UPLOAD) { notify(ar ? 'الملف أكبر من ٢٠ ميجابايت.' : 'File larger than 20MB.', 'error'); e.target.value = ''; return; }
                      const dataUrl: string = await new Promise((resolve, reject) => {
                        const r = new FileReader();
                        r.onload = () => resolve(String(r.result || ''));
                        r.onerror = () => reject(new Error('read failed'));
                        r.readAsDataURL(f);
                      });
                      setFuFile({ dataUrl, fileName: f.name, size: f.size });
                    }}
                    className="block w-full text-xs text-slate-600 file:me-3 file:py-2 file:px-3 file:rounded-lg file:border-0 file:text-xs file:font-semibold file:bg-slate-100 file:text-slate-700 hover:file:bg-slate-200" />
                  <p className="text-[11px] text-slate-500 mt-1">
                    {fuFile ? `${fuFile.fileName} · ${Math.round(fuFile.size / 1024)}KB`
                      : (ar ? 'لا تُحفَظ الحالة بلا إرفاق السند.' : 'The status is not saved without the bond file.')}
                  </p>
                </div>
              )}

              {!!(fu.order.statusLog || []).length && (
                <div className="border-t border-slate-200 pt-3">
                  <p className="text-xs font-semibold text-slate-500 mb-2">
                    {ar ? 'السجل' : 'History'} <span className="text-slate-400 font-normal">{fu.order.statusLog.length}</span>
                  </p>
                  <ul className="space-y-1.5 max-h-52 overflow-y-auto pe-1">
                    {[...fu.order.statusLog].reverse().map((h: any, i: number) => (
                      <li key={i} className="rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-2">
                        <div className="flex flex-wrap items-center gap-1.5 text-[11.5px]">
                          {h.from ? <span className="text-slate-500">{statusLabel(h.from, lang as Lang)}</span> : null}
                          {h.from ? <span className="text-slate-400">→</span> : null}
                          <span className="font-semibold text-slate-900">{statusLabel(h.to, lang as Lang)}</span>
                          <span className="ms-auto inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-white text-slate-700 font-semibold tabular-nums">
                            {fmtDT(h.at, lang as Lang)}
                          </span>
                        </div>
                        {h.note ? <p className="text-[12.5px] text-slate-700 mt-1">{h.note}</p> : null}
                        {/* المرفقُ يُقرأ من حيث قُيِّد — لا يُبحَث عنه في مكانٍ آخر. */}
                        {h.fileUrl ? (
                          <a href={h.fileUrl} target="_blank" rel="noreferrer"
                            className="inline-flex items-center gap-1 mt-1 text-[11.5px] font-semibold text-[#f37121] hover:underline">
                            <FileDown className="w-3 h-3" />{h.fileName || (ar ? 'المرفق' : 'Attachment')}
                          </a>
                        ) : null}
                        {h.byName ? <p className="text-[11px] text-slate-400 mt-0.5">{h.byName}</p> : null}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>

            <div className="px-5 py-4 border-t border-slate-200 flex items-center justify-end gap-2">
              <button type="button" onClick={() => setFu(null)} className="px-4 py-2 text-slate-500 hover:text-slate-900 text-sm">
                {ar ? 'إلغاء' : 'Cancel'}
              </button>
              <button type="button" onClick={submitFollowUp} disabled={busyId === fu.order._id}
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-[#f37121] text-white text-sm font-medium hover:bg-[#e06010] disabled:opacity-60">
                {busyId === fu.order._id ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
                {ar ? 'حفظ المتابعة' : 'Save follow-up'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
