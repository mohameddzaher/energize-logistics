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
import { PackageSearch, Plus, Pencil, Trash2, FileDown, Loader2, RefreshCw, X, Check } from 'lucide-react';
import {
  Spinner, PageHeader, SearchInput, PrimaryButton, StatCard, Select, ErrorNotice,
} from '@/components/hr/HRKit';
import ExportMenu, { exportScopeLabels, type ExportColumn } from '@/components/ls2/ExportMenu';
import {
  ShipmentOrder, OrderCustomer, ORDER_STATUSES, orderStatus, statusLabel,
  fmtDT, money, canEditOrders, canAdminOrders, Lang,
} from '@/lib/shipmentOrders';
import type { DispatchSheetRow } from '@/lib/dispatchSheetExcelParser';
import { useLatestRequest } from '@/hooks/useLatestRequest';

const fmtDate = (v?: string | null) => {
  if (!v) return '';
  const d = new Date(v);
  return `${d.getDate()}/${d.getMonth() + 1}/${d.getFullYear()}`;
};

// The بوليصة is the same letterhead sheet the dispatch page generates — one
// order maps onto one row of it. Fields we do not track stay blank on the
// sheet, exactly as a blank cell did in the Excel flow.
const toSheetRow = (o: ShipmentOrder): DispatchSheetRow => ({
  rowIndex: 1,
  rentalType: o.driverRentType || '',
  carBrand: '',
  carColor: '',
  carType: o.truckType || '',
  plateNumber: (o as any).vehiclePlate || o.vehicleName || '',
  driverAdvance: '',
  driverPhone: o.driverPhone || '',
  driverIqama: '',
  driverNationality: '',
  driverName: o.driverName || '',
  customerName: o.customerName || '',
  branch: o.branch || '',
  toLocation: o.toCity || '',
  fromLocation: o.fromCity || '',
  date: fmtDate(o.pickupTime || o.createdAt),
  // رقمُ البوليصة على الورقة: المنقولُ من المنصّة لا رقمَ بوليصةٍ له عندنا —
  // يحمل رقمَ كشف تخريجهم، وهو الرقمُ الذي يُسأل عنه. الورقةُ كانت تُطبع بخانةٍ
  // فارغةٍ في ثلاثةٍ وثلاثين ألفَ شحنة.
  dispatchNumber: String((o as any).reference || o.waybillNumber || ''),
  missingRequired: [],
});

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
  const [statusFilter, setStatusFilter] = useState('');
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

  const openFollowUp = (o: any) => setFu({ order: o, status: o.status, note: '' });

  const submitFollowUp = async () => {

    if (!fu) return;

    await changeStatus(fu.order, fu.status, fu.note.trim());

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
  const changeStatus = async (o: ShipmentOrder, status: string, note = '') => {
    setBusyId(o._id);
    try {
      await api.patch(`/api/shipment-orders/orders/${o._id}/status`, { status, note });
      load();
    } catch (e: any) { notify(e.message, 'error'); }
    setBusyId(null);
  };

  const remove = async (o: ShipmentOrder) => {
    if (!(await confirm(ar
      ? `حذف الشحنة بوليصة رقم ${(o as any).reference || o.waybillNumber} (${o.customerName || '—'})؟`
      : `Delete shipment, waybill ${(o as any).reference || o.waybillNumber} (${o.customerName || '—'})?`))) return;
    try { await api.delete(`/api/shipment-orders/orders/${o._id}`); load(); }
    catch (e: any) { notify(e.message, 'error'); }
  };

  // The dispatch generator is heavy (html2canvas + pdf-lib), so it loads only
  // when someone actually asks for a بوليصة.
  const downloadWaybill = async (o: ShipmentOrder) => {
    setDownloadingId(o._id);
    try {
      const gen = await import('@/lib/dispatchSheetGenerator');
      const { blob } = await gen.generateSingleDispatchPdf(toSheetRow(o));
      gen.triggerDownload(blob, `${waybillFileName(o)}.pdf`);
    } catch (e: any) { notify(e?.message || 'PDF failed', 'error'); }
    setDownloadingId(null);
  };

  const downloadPicked = async () => {
    const rows = orders.filter((o) => picked.has(o._id));
    if (!rows.length) return;
    setBulkBusy(true);
    try {
      const gen = await import('@/lib/dispatchSheetGenerator');
      const nameOf = new Map(rows.map((o) => [String((o as any).reference || o.waybillNumber), waybillFileName(o)]));
      const { blob, fileName } = await gen.generateDispatchSheetsZip({
        rows: rows.map(toSheetRow),
        fileNameOf: (r) => nameOf.get(r.dispatchNumber) || `بوليصة-${r.dispatchNumber}`,
        onProgress: (p) => setBulkProgress(`${p.current}/${p.total}`),
      });
      gen.triggerDownload(blob, fileName.replace('كشوف-التخريج', 'بوليصات-الشحن'));
      setPicked(new Set());
    } catch (e: any) { notify(e?.message || 'ZIP failed', 'error'); }
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
  const margin = (stats?.sellTotal || 0) - (stats?.buyTotal || 0);

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

      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
        <StatCard label={ar ? 'إجمالي الشحنات' : 'Total shipments'} value={total} accent="text-[#f37121]" />
        <StatCard label={ar ? 'قيد التنفيذ' : 'In flight'} value={inFlight} accent="text-blue-600" />
        <StatCard label={ar ? 'وصلت / مكتملة' : 'Arrived / done'} value={done} accent="text-emerald-600" />
        <StatCard label={ar ? 'إجمالي البيع' : 'Sell total'} value={money(stats?.sellTotal)} accent="text-slate-900" />
        <StatCard label={ar ? 'هامش الربح' : 'Margin'} value={money(margin)} accent={margin >= 0 ? 'text-emerald-600' : 'text-red-600'} />
      </div>

      <div className="flex flex-wrap gap-3 items-center">
        <div className="flex-1 min-w-[240px]">
          <SearchInput value={search} onChange={setSearch}
            placeholder={ar ? 'بحث برقم البوليصة أو كشف التخريج أو العميل أو المورّد أو السائق أو المدينة…' : 'waybill, graduation no., customer, supplier, driver, city…'} />
        </div>
        {/* ── مصدرُ الشحنة ─────────────────────────────────────────────────
            أزرارٌ لا قائمةٌ منسدلة: هذا سؤالٌ يُسأل في كلّ جلسة، وكلُّ زرٍّ
            يحمل عددَه تحت بقيّة الفلاتر — فيُعرف الحجمُ قبل الضغط. */}
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
        <div className="w-44 grow sm:grow-0">
          <Select value={statusFilter} onChange={(e) => { setStatusFilter(e.target.value); setPage(1); }}>
            <option value="">{ar ? 'كل الحالات' : 'All statuses'}</option>
            {ORDER_STATUSES.map((s) => <option key={s.key} value={s.key}>{ar ? s.ar : s.en}</option>)}
          </Select>
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

      <div className="bg-white border border-slate-200 rounded-xl overflow-x-auto shadow-sm">
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
              ar ? 'إجراءات' : 'Actions',
            ].map((h, i) => <th key={i} className="text-start font-semibold px-4 py-3 whitespace-nowrap">{h}</th>)}
          </tr></thead>
          <tbody>
            {orders.length === 0 ? (
              <tr><td colSpan={12} className="text-center text-slate-500 py-14">
                {ar ? 'لا توجد شحنات بعد — ابدأ من زر «إنشاء شحنة».' : 'No shipments yet — start with “Create shipment”.'}
              </td></tr>
            ) : orders.map((o) => {
              const st = orderStatus(o.status);
              return (
                <tr key={o._id} className="border-b border-slate-200/70 hover:bg-slate-50">
                  <td className="px-3 py-3">
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
                  <td className="px-4 py-3">
                    {/* ── المتابعةُ نقلةُ حالةٍ ومعها سببُها ──────────────────
                        القائمةُ المنسدلة تنقل الحالةَ بلا أن تسأل «لماذا»، ثمّ
                        يُسأل بعد أسبوع «مين أخّرها؟» فلا جواب. صارت تفتح نافذةً
                        تُختار فيها الحالةُ وتُكتب ملاحظةٌ **اختياريّة**، ويُقرأ
                        فيها سجلُّ الانتقالات السابقة. */}
                    {editor ? (
                      <button type="button" onClick={() => openFollowUp(o)} disabled={busyId === o._id}
                        className={`inline-flex items-center gap-1.5 text-xs font-medium rounded-full px-2.5 py-1.5 transition-opacity hover:opacity-80 ${st?.bg || 'bg-slate-100'} ${st?.text || 'text-slate-700'}`}
                        title={ar ? 'تسجيل متابعة' : 'Record a follow-up'}>
                        {busyId === o._id ? <Loader2 className="w-3 h-3 animate-spin" /> : <RefreshCw className="w-3 h-3 opacity-60" />}
                        {statusLabel(o.status, lang as Lang)}
                        {(o.statusLog || []).length ? <span className="opacity-60">· {(o.statusLog || []).length}</span> : null}
                      </button>
                    ) : (
                      <span className={`text-xs font-medium rounded-full px-2.5 py-1 ${st?.bg} ${st?.text}`}>{statusLabel(o.status, lang as Lang)}</span>
                    )}
                  </td>
                  <td className="px-4 py-3">
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
                      {canAdminOrders(user) && (
                        <button type="button" onClick={() => remove(o)}
                          className="p-1.5 rounded-lg text-slate-500 hover:text-red-600 hover:bg-slate-100" title={ar ? 'حذف' : 'Delete'}>
                          <Trash2 className="w-4 h-4" />
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {total > 25 && (
        <div className="flex items-center justify-end gap-2 text-sm">
          <button type="button" onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page === 1}
            className="px-3 py-1.5 rounded-lg bg-white border border-slate-200 text-slate-600 disabled:opacity-50">{ar ? 'السابق' : 'Prev'}</button>
          <span className="text-slate-500">{page} / {Math.ceil(total / 25)}</span>
          <button type="button" onClick={() => setPage((p) => Math.min(Math.ceil(total / 25), p + 1))} disabled={page >= Math.ceil(total / 25)}
            className="px-3 py-1.5 rounded-lg bg-white border border-slate-200 text-slate-600 disabled:opacity-50">{ar ? 'التالي' : 'Next'}</button>
        </div>
      )}

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
                  {ORDER_STATUSES.map((s2) => {
                    const on = fu.status === s2.key;
                    return (
                      <button key={s2.key} type="button" onClick={() => setFu({ ...fu, status: s2.key })}
                        className={`text-xs font-semibold rounded-lg px-2.5 py-2 border transition-colors ${
                          on ? `${s2.bg} ${s2.text} border-transparent ring-2 ring-[#f37121]` : 'bg-white text-slate-600 border-slate-200 hover:border-slate-300'}`}>
                        {ar ? s2.ar : s2.en}
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
