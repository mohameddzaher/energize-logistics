'use client';
// طلبات الشحنات — the trial section's main list. Everything the team needs to
// run the day happens HERE, without opening each order: search by بوليصة or
// customer, flip a status inline, download the بوليصة PDF per row.
import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/context/AuthContext';
import { useLanguage } from '@/context/LanguageContext';
import { useSocket } from '@/hooks/useSocket';
import api from '@/lib/api';
import { useDialog } from '@/components/system/DialogProvider';
import { PackageSearch, Plus, Pencil, Trash2, FileDown, Loader2 } from 'lucide-react';
import {
  Spinner, PageHeader, SearchInput, ExportButton, PrimaryButton, StatCard, Select, ErrorNotice,
} from '@/components/hr/HRKit';
import { exportToExcel } from '@/utils/exportExcel';
import {
  ShipmentOrder, OrderCustomer, ORDER_STATUSES, orderStatus, statusLabel,
  fmtDT, money, canEditOrders, canAdminOrders, Lang,
} from '@/lib/shipmentOrders';
import type { DispatchSheetRow } from '@/lib/dispatchSheetExcelParser';

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
  plateNumber: o.vehicleName || '',
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
  dispatchNumber: String(o.waybillNumber || ''),
  missingRequired: [],
});

// بوليصة-501-اسم العميل-22-7-2026
const waybillFileName = (o: ShipmentOrder) => {
  const d = new Date(o.pickupTime || o.createdAt || Date.now());
  return `بوليصة-${o.waybillNumber}-${o.customerName || 'عميل'}-${d.getDate()}-${d.getMonth() + 1}-${d.getFullYear()}`;
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
  const [stats, setStats] = useState<{ byStatus: Record<string, number>; sellTotal: number; buyTotal: number } | null>(null);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const [search, setSearch] = useState('');
  const [debounced, setDebounced] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [customerFilter, setCustomerFilter] = useState('');
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');
  const [page, setPage] = useState(1);

  const [busyId, setBusyId] = useState<string | null>(null);
  const [downloadingId, setDownloadingId] = useState<string | null>(null);
  // Tick rows → one ZIP of their بوليصات, named number-customer-date.
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [bulkBusy, setBulkBusy] = useState(false);
  const [bulkProgress, setBulkProgress] = useState('');

  useEffect(() => {
    const t = setTimeout(() => { setDebounced(search); setPage(1); }, 300);
    return () => clearTimeout(t);
  }, [search]);

  const load = useCallback(async () => {
    try {
      const qs = new URLSearchParams({ page: String(page), limit: '25' });
      if (debounced.trim()) qs.set('q', debounced.trim());
      if (statusFilter) qs.set('status', statusFilter);
      if (customerFilter) qs.set('customer', customerFilter);
      if (fromDate) qs.set('from', fromDate);
      if (toDate) qs.set('to', toDate);
      const d = await api.get<{ orders: ShipmentOrder[]; total: number; stats: any }>(`/api/shipment-orders/orders?${qs}`);
      setOrders(d.orders || []);
      setTotal(d.total || 0);
      setStats(d.stats || null);
      setError('');
    } catch (e: any) { setError(e?.message || 'Request failed'); }
    setLoading(false);
  }, [debounced, statusFilter, customerFilter, fromDate, toDate, page]);

  useEffect(() => { load(); }, [load]);
  useSocket('shipmentOrders:updated', useCallback(() => load(), [load]));
  useEffect(() => {
    api.get<{ customers: OrderCustomer[] }>('/api/shipment-orders/customers')
      .then((d) => setCustomers(d.customers || [])).catch(() => {});
  }, []);

  // The inline change — the reason nobody has to open an order to say "وصلت".
  const changeStatus = async (o: ShipmentOrder, status: string) => {
    setBusyId(o._id);
    try {
      await api.patch(`/api/shipment-orders/orders/${o._id}/status`, { status });
      load();
    } catch (e: any) { notify(e.message, 'error'); }
    setBusyId(null);
  };

  const remove = async (o: ShipmentOrder) => {
    if (!(await confirm(ar
      ? `حذف الشحنة بوليصة رقم ${o.waybillNumber} (${o.customerName || '—'})؟`
      : `Delete shipment, waybill ${o.waybillNumber} (${o.customerName || '—'})?`))) return;
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
      const nameOf = new Map(rows.map((o) => [String(o.waybillNumber), waybillFileName(o)]));
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
        <ExportButton label={ar ? 'تصدير Excel' : 'Export Excel'} onClick={() => exportToExcel(orders, [
          { header: 'Waybill', key: 'waybillNumber', width: 10 },
          { header: 'Customer', key: 'customerName', width: 26 },
          { header: 'From', key: 'fromCity', width: 14 },
          { header: 'To', key: 'toCity', width: 14 },
          { header: 'Truck', key: 'truckType', width: 12 },
          { header: 'Driver', key: 'driverName', width: 18 },
          { header: 'Pickup', key: 'pickupTime', transform: (v: any) => fmtDate(v), width: 14 },
          { header: 'Sell', key: 'sellPrice', width: 10 },
          { header: 'Buy', key: 'buyPrice', width: 10 },
          { header: 'Status', key: 'status', transform: (v: any) => statusLabel(v, 'en'), width: 14 },
          { header: 'Agent', key: 'agentName', width: 16 },
        ], `shipment-orders-${new Date().toISOString().slice(0, 10)}`, 'Orders')} />
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
            placeholder={ar ? 'بحث برقم البوليصة أو العميل أو السائق أو المدينة…' : 'Search waybill, customer, driver, city…'} />
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
              ar ? 'المسار' : 'Route',
              ar ? 'السائق' : 'Driver',
              ar ? 'الشاحنة' : 'Truck',
              ar ? 'وقت الاستلام' : 'Pickup',
              ar ? 'بيع / شراء' : 'Sell / buy',
              ar ? 'الحالة' : 'Status',
              ar ? 'إجراءات' : 'Actions',
            ].map((h, i) => <th key={i} className="text-start font-semibold px-4 py-3 whitespace-nowrap">{h}</th>)}
          </tr></thead>
          <tbody>
            {orders.length === 0 ? (
              <tr><td colSpan={10} className="text-center text-slate-500 py-14">
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
                  <td className="px-4 py-3 text-slate-900 font-bold font-mono">{o.waybillNumber}</td>
                  <td className="px-4 py-3 text-slate-900 font-medium max-w-[220px] truncate" title={o.customerName}>{o.customerName || '—'}</td>
                  <td className="px-4 py-3 text-slate-700 whitespace-nowrap">{o.fromCity || '—'} ← {o.toCity || '—'}</td>
                  <td className="px-4 py-3 text-slate-700">{o.driverName || '—'}</td>
                  <td className="px-4 py-3 text-slate-700">{o.truckType || '—'}</td>
                  <td className="px-4 py-3 text-slate-700 text-xs whitespace-nowrap">{fmtDT(o.pickupTime, lang as Lang)}</td>
                  <td className="px-4 py-3 text-slate-700 whitespace-nowrap">{money(o.sellPrice)} / {money(o.buyPrice)}</td>
                  <td className="px-4 py-3">
                    {/* Inline lifecycle: coloured like the badge, editable like a select. */}
                    {editor ? (
                      <select
                        value={o.status}
                        disabled={busyId === o._id}
                        onChange={(e) => changeStatus(o, e.target.value)}
                        className={`text-xs font-medium rounded-full px-2.5 py-1.5 border-0 cursor-pointer focus:outline-none focus:ring-2 focus:ring-[#f37121]/40 ${st?.bg || 'bg-slate-100'} ${st?.text || 'text-slate-700'}`}
                      >
                        {ORDER_STATUSES.map((s) => <option key={s.key} value={s.key}>{ar ? s.ar : s.en}</option>)}
                      </select>
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
    </div>
  );
}
