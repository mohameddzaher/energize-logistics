'use client';
// Loads & shipments board: every workflow row (shipment orders and fleet loads) without invoicing, collection, customs and selling columns. The server never sends those (config/opsBoard).
import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import Link from 'next/link';
import { useAuth } from '@/context/AuthContext';
import { useLanguage } from '@/context/LanguageContext';
import { useDialog } from '@/components/system/DialogProvider';
import { useSocket } from '@/hooks/useSocket';
import { useLatestRequest } from '@/hooks/useLatestRequest';
import api from '@/lib/api';
import { SHIPMENT_STATUSES, statusStyle } from '@/lib/ops';
import { paymentKindLabel } from '@/lib/paymentKind';
import { ColumnFilter, type ColumnFilterOption } from '@/components/ColumnFilter';
import DateRangeFilter from '@/components/system/DateRangeFilter';
import ColumnChooser, { useVisibleColumns, type ChooserColumn } from '@/components/system/ColumnChooser';
import TablePager, { readPageSize, savePageSize } from '@/components/system/TablePager';
import ScrollX from '@/components/system/ScrollX';
import { ViewSwitcher, VIEW_MODES, type ViewMode } from '@/components/shipment-orders/OrderViews';
import { PageHeader, Spinner } from '@/components/hr/HRKit';
import { Truck, Search, Wallet, FileDown, Loader2, MapPin, User, Phone, X } from 'lucide-react';

type Row = Record<string, any> & { _id: string; applicationStatus?: string; hasWaybill?: boolean; origin?: string };

const VIEW_PREF_KEY = 'opsBoard.view';
// Columns with an Excel-style filter; mirrors FILTER_FIELDS in backend config/opsBoard.
const FILTER_FIELDS = new Set([
  'reportNumber', 'reportDate', 'fromLocation', 'toLocation', 'branch', 'carOwner', 'carNumber',
  'applicationStatus', 'username', 'userPhone', 'driverName', 'truckType', 'representativeName',
  'operationsReview', 'paymentDate', 'payingBranch', 'paymentType', 'finalReportDestination',
  'documentNumber', 'sendingDate', 'branchDeliveryDate',
]);
const DATE_FIELDS = new Set(['reportDate', 'paymentDate', 'sendingDate', 'branchDeliveryDate']);
const EMPTY_SET = new Set<string>();
const EMPTY_OPTIONS: ColumnFilterOption[] = [];
const VIEW_PREF_READ_KEY = 'opsBoard:view';

const dayOf = (d: unknown) => {
  if (!d) return '';
  const t = new Date(String(d));
  return Number.isNaN(t.getTime()) ? String(d) : new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Riyadh' }).format(t);
};
const num = (v: unknown) => (v == null || v === '' ? '' : Number(v).toLocaleString('en-US'));

function downloadBlob(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = fileName;
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export default function OpsBoardPage() {
  const { user, refreshUser } = useAuth();
  const { lang } = useLanguage();
  const ar = lang === 'ar';
  const t = (a: string, e: string) => (ar ? a : e);
  const { notify } = useDialog();

  const [rows, setRows] = useState<Row[]>([]);
  const [total, setTotal] = useState(0);
  const [byStatus, setByStatus] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(() => readPageSize('opsBoard'));
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  // Excel-style column filters, sent to the server (cf_<field>, repeated per value); the status chips write the status column's filter.
  const [colFilters, setColFilters] = useState<Record<string, Set<string>>>({});
  const [colOptions, setColOptions] = useState<Record<string, { values: ColumnFilterOption[]; truncated: boolean }>>({});
  const [colLoading, setColLoading] = useState<Record<string, boolean>>({});
  const [openField, setOpenField] = useState<string | null>(null);
  const [openNonce, setOpenNonce] = useState(0);
  const optionsSeq = useRef<Record<string, number>>({});
  const statusSel = colFilters.applicationStatus;
  const status = statusSel && statusSel.size === 1 ? [...statusSel][0] : '';
  const setColFilter = (field: string, set: Set<string>) => {
    setPage(1);
    setColFilters((prev) => {
      const next = { ...prev };
      if (set.size) next[field] = set; else delete next[field];
      return next;
    });
  };
  const setStatus = (k: string) => setColFilter('applicationStatus', k ? new Set([k]) : new Set());
  const [origin, setOrigin] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [excludeCancelled, setExcludeCancelled] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [pdfId, setPdfId] = useState<string | null>(null);

  // View mode follows the account across devices, like the shipment orders page.
  const [viewLocal, setViewLocal] = useState<ViewMode | null>(null);
  const savedView = String(user?.uiPrefs?.[VIEW_PREF_READ_KEY] || '') as ViewMode;
  const view: ViewMode = viewLocal ?? (VIEW_MODES.includes(savedView) ? savedView : 'table');
  const changeView = (v: ViewMode) => {
    if (v === view) return;
    setViewLocal(v);
    api.patch('/api/auth/me/prefs', { key: VIEW_PREF_KEY, value: v })
      .then(() => { refreshUser().catch(() => {}); })
      .catch(() => notify(t('تعذّر حفظ طريقة العرض في حسابك — ستبقى لهذه الجلسة.', 'Could not save the view to your account.'), 'error'));
  };

  const columns = useMemo<ChooserColumn[]>(() => [
    { key: 'reportNumber', label: t('رقم أمر النقل', 'Transport order'), locked: true },
    { key: 'reportDate', label: t('تاريخ الأمر', 'Order date') },
    { key: 'applicationStatus', label: t('حالة الشحنة', 'Shipment status') },
    { key: 'origin', label: t('المصدر', 'Source') },
    { key: 'username', label: t('العميل', 'Customer') },
    { key: 'userPhone', label: t('جوال العميل', 'Customer phone') },
    { key: 'fromLocation', label: t('من', 'From') },
    { key: 'toLocation', label: t('إلى', 'To') },
    { key: 'branch', label: t('الفرع', 'Branch') },
    { key: 'loadingTime', label: t('وقت التحميل', 'Loading time') },
    { key: 'driverName', label: t('السائق', 'Driver') },
    { key: 'driverPhone', label: t('جوال السائق', 'Driver phone') },
    { key: 'carOwner', label: t('مالك السيارة', 'Car owner') },
    { key: 'carNumber', label: t('رقم السيارة', 'Car number') },
    { key: 'plateNumber', label: t('اللوحة', 'Plate') },
    { key: 'carName', label: t('السيارة', 'Car') },
    { key: 'truckType', label: t('نوع الشاحنة', 'Truck type') },
    { key: 'loadType', label: t('نوع الحمولة', 'Load type') },
    { key: 'quantity', label: t('الكمية', 'Quantity') },
    { key: 'driverRentalType', label: t('نوع تأجير السائق', 'Driver rental type') },
    { key: 'paymentType', label: t('نوع الدفع', 'Payment type') },
    { key: 'purchaseValue', label: t('قيمة الشراء', 'Purchase value') },
    { key: 'representativeName', label: t('المندوب', 'Representative') },
    { key: 'reference', label: t('المرجع', 'Reference') },
    { key: 'operationsReview', label: t('مراجعة التشغيل', 'Operations review') },
    { key: 'paymentDate', label: t('تاريخ السداد', 'Payment date') },
    { key: 'payingBranch', label: t('الفرع المسدِّد', 'Paying branch') },
    { key: 'finalReportDestination', label: t('وجهة أمر النقل النهائية', 'Final destination') },
    { key: 'documentNumber', label: t('رقم المستند', 'Document no.') },
    { key: 'sendingDate', label: t('تاريخ الإرسال', 'Sending date') },
    { key: 'branchDeliveryDate', label: t('تاريخ التسليم للفرع', 'Branch delivery date') },
  // eslint-disable-next-line react-hooks/exhaustive-deps
  ], [lang]);
  const { visible, setVisible } = useVisibleColumns('ops:boardColumns', columns);
  const shownCols = useMemo(() => columns.filter((c) => visible.includes(c.key)), [columns, visible]);

  const statusLabel = (k?: string) => {
    const s = statusStyle(k);
    return s ? (ar ? s.ar : s.en) : (k || '—');
  };
  const originLabel = (k?: string) => (k === 'fleet' ? t('إدارة الأسطول', 'Fleet') : k === 'orders' ? t('طلبات الشحنات', 'Shipment orders') : t('المنصّة', 'Platform'));

  const cell = (r: Row, key: string): string => {
    switch (key) {
      case 'reportDate': case 'paymentDate': case 'sendingDate': case 'branchDeliveryDate': return dayOf(r[key]);
      // Stored as an ISO instant; shown as the Riyadh date and time.
      case 'loadingTime': {
        const d = r[key] ? new Date(String(r[key])) : null;
        return d && !Number.isNaN(d.getTime()) ? new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Riyadh', dateStyle: 'short', timeStyle: 'short' }).format(d) : (r[key] || '');
      }
      case 'purchaseValue': return num(r[key]);
      case 'paymentType': return paymentKindLabel(r.paymentSubtype || r.paymentType, ar);
      case 'origin': return originLabel(r.origin);
      case 'operationsReview': return r[key] ? t('تمّت', 'Done') : '';
      default: return r[key] == null ? '' : String(r[key]);
    }
  };

  // Debounced search: one request per pause, not per keystroke.
  useEffect(() => {
    const h = setTimeout(() => { setSearch(searchInput.trim()); setPage(1); }, 350);
    return () => clearTimeout(h);
  }, [searchInput]);

  // One place builds the filter, for the table and for every column's value list, so a list never counts rows the table hides.
  const buildParams = useCallback(() => {
    const p = new URLSearchParams();
    if (search) p.append('search', search);
    if (origin) p.append('origin', origin);
    if (dateFrom) p.append('dateFrom', dateFrom);
    if (dateTo) p.append('dateTo', dateTo);
    if (excludeCancelled) p.append('excludeCancelled', '1');
    for (const [f, set] of Object.entries(colFilters)) set.forEach((v) => p.append(`cf_${f}`, v));
    return p;
  }, [search, origin, dateFrom, dateTo, excludeCancelled, colFilters]);

  const fetchColOptions = useCallback(async (field: string, q = '') => {
    const seq = (optionsSeq.current[field] || 0) + 1;
    optionsSeq.current[field] = seq;
    setColLoading((prev) => ({ ...prev, [field]: true }));
    try {
      const p = buildParams();
      p.append('field', field);
      if (q) p.append('q', q);
      const d = await api.get<any>(`/api/ops-board/filters?${p.toString()}`);
      if (optionsSeq.current[field] !== seq) return;
      const f = d?.filters?.[0];
      setColOptions((prev) => ({ ...prev, [field]: { values: f?.values || [], truncated: !!f?.truncated } }));
    } catch {
      if (optionsSeq.current[field] === seq) setColOptions((prev) => ({ ...prev, [field]: prev[field] || { values: [], truncated: false } }));
    } finally {
      if (optionsSeq.current[field] === seq) setColLoading((prev) => ({ ...prev, [field]: false }));
    }
  }, [buildParams]);
  // A filter change makes cached value lists stale; the open column refetches at once.
  useEffect(() => {
    setColOptions((prev) => (openField && prev[openField] ? { [openField]: prev[openField] } : {}));
    if (openField) fetchColOptions(openField);
  }, [fetchColOptions, openField, openNonce]);

  const colFormat = (field: string): ((v: any) => string) | undefined => {
    if (field === 'applicationStatus') return (v: any) => statusLabel(String(v || ''));
    if (field === 'paymentType') return (v: any) => paymentKindLabel(v, ar) || String(v || '');
    if (field === 'operationsReview') return (v: any) => (String(v) === 'true' ? t('تمّت', 'Done') : t('لم تتمّ', 'Not done'));
    if (DATE_FIELDS.has(field)) return (v: any) => {
      const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(v || ''));
      return m ? `${m[3]}/${m[2]}/${m[1]}` : dayOf(v);
    };
    return undefined;
  };

  const guard = useLatestRequest();
  const load = useCallback(async (background = false) => {
    const seq = guard.begin();
    if (!background) setLoading(true);
    try {
      const p = buildParams();
      p.append('page', String(page));
      p.append('limit', String(pageSize));
      const d = await api.get<any>(`/api/ops-board?${p.toString()}`);
      if (!guard.isCurrent(seq)) return;
      setRows(d.rows || []);
      setTotal(d.total || 0);
      setByStatus(d.byStatus || {});
      setError('');
    } catch (e: any) {
      if (guard.isCurrent(seq)) setError(e?.message || t('تعذّر التحميل', 'Load failed'));
    } finally {
      if (guard.isCurrent(seq)) setLoading(false);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [buildParams, page, pageSize, guard]);
  useEffect(() => { load(); }, [load]);

  // Any change on the workflow, shipment orders or fleet loads reloads this page; a burst becomes one reload.
  const soon = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reloadSoon = useCallback(() => {
    if (soon.current) clearTimeout(soon.current);
    soon.current = setTimeout(() => load(true), 600);
  }, [load]);
  useEffect(() => () => { if (soon.current) clearTimeout(soon.current); }, []);
  useSocket('workflow:created', reloadSoon);
  useSocket('workflow:updated', reloadSoon);
  useSocket('workflow:deleted', reloadSoon);
  useSocket('workflow:stageChanged', reloadSoon);
  useSocket('workflow:bulkImported', reloadSoon);
  useSocket('ops:shipments:changed', reloadSoon);
  useSocket('shipmentOrders:updated', reloadSoon);
  useSocket('fleet:updated', reloadSoon);

  const changeStatus = async (r: Row, next: string) => {
    if (!next || next === r.applicationStatus) return;
    setBusyId(r._id);
    try {
      const row = await api.patch<Row>(`/api/ops-board/${r._id}/status`, { status: next });
      setRows((p) => p.map((x) => (x._id === r._id ? { ...x, ...(row && row._id ? row : { applicationStatus: next }) } : x)));
      reloadSoon();
    } catch (e: any) {
      notify(e?.message || t('تعذّر تغيير الحالة', 'Could not change status'), 'error');
    }
    setBusyId(null);
  };

  const downloadWaybill = async (r: Row) => {
    setPdfId(r._id);
    try {
      const blob = await api.getBlob(`/api/ops-board/${r._id}/waybill.pdf?lang=${ar ? 'ar' : 'en'}`);
      const name = [r.username, r.plateNumber || r.carNumber, r.reportNumber].filter(Boolean).join(' - ').replace(/[\\/:*?"<>|]/g, ' ');
      downloadBlob(blob, `${name || 'waybill'}.pdf`);
    } catch (e: any) { notify(e?.message || t('تعذّر تنزيل أمر النقل', 'Could not download'), 'error'); }
    setPdfId(null);
  };

  const statusSelect = (r: Row, compact = false) => {
    const s = statusStyle(r.applicationStatus);
    return (
      <div className="relative inline-flex items-center">
        <select value={r.applicationStatus || ''} disabled={busyId === r._id} aria-label={t('حالة الشحنة', 'Shipment status')}
          onClick={(e) => e.stopPropagation()} onChange={(e) => changeStatus(r, e.target.value)}
          className={`rounded-lg border px-2 py-1 text-xs font-semibold cursor-pointer outline-none focus:ring-2 focus:ring-[#f37121]/40 disabled:opacity-50 ${s ? `${s.bg} ${s.text} border-transparent` : 'bg-white text-slate-700 border-slate-300'}`}>
          {!r.applicationStatus && <option value="">-</option>}
          {r.applicationStatus && !s && <option value={r.applicationStatus}>{statusLabel(r.applicationStatus)}</option>}
          {SHIPMENT_STATUSES.map((x) => <option key={x.key} value={x.key}>{ar ? x.ar : x.en}</option>)}
        </select>
        {busyId === r._id && <Loader2 className="w-3.5 h-3.5 animate-spin text-slate-400 ms-1" />}
      </div>
    );
  };

  const waybillBtn = (r: Row) => (
    <button type="button" onClick={() => downloadWaybill(r)} disabled={!r.hasWaybill || pdfId === r._id}
      title={r.hasWaybill ? t('تنزيل أمر النقل', 'Download transport order') : t('سطر من المنصّة القديمة — لا أمر نقل له في النظام', 'Old platform row — no transport order here')}
      className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-semibold border border-slate-200 text-[#12325C] hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed">
      {pdfId === r._id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <FileDown className="w-3.5 h-3.5" />}
      {t('أمر النقل', 'Order')}
    </button>
  );

  const card = (r: Row, small: boolean) => (
    <div key={r._id} className={`bg-white border border-slate-200 rounded-xl ${small ? 'p-3' : 'p-4'} flex flex-col gap-2`}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="font-bold text-slate-900 tabular-nums">{r.reportNumber || '—'}</p>
          <p className="text-xs text-slate-500">{dayOf(r.reportDate)} · {originLabel(r.origin)}</p>
        </div>
        {statusSelect(r, small)}
      </div>
      <p className="text-sm font-semibold text-slate-800 truncate">{r.username || '—'}</p>
      <p className="text-xs text-slate-600 flex items-center gap-1"><MapPin className="w-3.5 h-3.5 text-[#f37121]" />{r.fromLocation || '—'} ← {r.toLocation || '—'}</p>
      <p className="text-xs text-slate-600 flex items-center gap-1"><User className="w-3.5 h-3.5" />{r.driverName || '—'}{r.plateNumber || r.carNumber ? ` · ${r.plateNumber || r.carNumber}` : ''}</p>
      {!small && r.driverPhone && <p className="text-xs text-slate-600 flex items-center gap-1"><Phone className="w-3.5 h-3.5" /><span dir="ltr">{r.driverPhone}</span></p>}
      {!small && (r.truckType || r.loadType) && <p className="text-xs text-slate-500">{[r.truckType, r.loadType].filter(Boolean).join(' · ')}</p>}
      <div className="flex items-center justify-between gap-2 mt-auto pt-1">
        <span className="text-[11px] text-slate-500">{r.branch || ''}</span>
        {waybillBtn(r)}
      </div>
    </div>
  );

  const statusTotal = Object.values(byStatus).reduce((a, b) => a + b, 0);

  return (
    <div className="space-y-4">
      <PageHeader icon={<Truck className="w-6 h-6" />} title={t('متابعة الحمولات والشحنات', 'Loads & Shipments')}
        subtitle={t('كل الحمولات والشحنات من سير عمل التشغيل، بلا أعمدة الفوترة والتحصيل', 'Every load and shipment from the operations workflow, without billing and collection columns')}>
        <Link href="/system/wallet" className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-semibold bg-[#12325C] text-white hover:bg-[#0e2849]">
          <Wallet className="w-4 h-4" />{t('المحفظة', 'Wallet')}
        </Link>
      </PageHeader>

      <div className="bg-white border border-slate-200 rounded-xl p-3 space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative flex-1 min-w-[220px]">
            <Search className="w-4 h-4 text-slate-400 absolute top-1/2 -translate-y-1/2 start-3" />
            <input value={searchInput} onChange={(e) => setSearchInput(e.target.value)}
              placeholder={t('ابحث برقم أمر النقل، العميل، السائق، اللوحة…', 'Search order no., customer, driver, plate…')}
              className="w-full ps-9 pe-8 py-2 rounded-lg border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-[#f37121]/30" />
            {searchInput && <button type="button" onClick={() => setSearchInput('')} className="absolute top-1/2 -translate-y-1/2 end-2 text-slate-400"><X className="w-4 h-4" /></button>}
          </div>
          <select value={origin} onChange={(e) => { setOrigin(e.target.value); setPage(1); }} className="px-3 py-2 rounded-lg border border-slate-200 text-sm">
            <option value="">{t('كل المصادر', 'All sources')}</option>
            <option value="orders">{t('طلبات الشحنات', 'Shipment orders')}</option>
            <option value="fleet">{t('إدارة الأسطول', 'Fleet')}</option>
          </select>
          <DateRangeFilter ar={ar} from={dateFrom} to={dateTo}
            onFrom={(v) => { setDateFrom(v); setPage(1); }} onTo={(v) => { setDateTo(v); setPage(1); }} />
          {(Object.keys(colFilters).length > 0 || origin || dateFrom || dateTo || searchInput || excludeCancelled) && (
            <button type="button" onClick={() => { setColFilters({}); setOrigin(''); setDateFrom(''); setDateTo(''); setSearchInput(''); setExcludeCancelled(false); setPage(1); }}
              className="inline-flex items-center gap-1 px-3 py-2 rounded-lg text-sm font-semibold text-red-600 hover:bg-red-50">
              <X className="w-4 h-4" />{t('مسح الفلاتر', 'Clear filters')}
            </button>
          )}
          <label className="inline-flex items-center gap-1.5 text-sm text-slate-700">
            <input type="checkbox" checked={excludeCancelled} onChange={(e) => { setExcludeCancelled(e.target.checked); setPage(1); }} />
            {t('بدون الملغاة', 'Hide cancelled')}
          </label>
          <div className="flex items-center gap-2 ms-auto">
            {view === 'table' && <ColumnChooser columns={columns} visible={visible} onChange={setVisible} ar={ar} />}
            <ViewSwitcher value={view} onChange={changeView} ar={ar} />
          </div>
        </div>
        <div className="flex flex-wrap gap-1.5">
          <button type="button" onClick={() => { setStatus(''); setPage(1); }}
            className={`px-3 py-1 rounded-full text-xs font-semibold ${status === '' ? 'bg-[#12325C] text-white' : 'bg-slate-100 text-slate-700'}`}>
            {t('الكل', 'All')} <span className="tabular-nums">{statusTotal.toLocaleString('en-US')}</span>
          </button>
          {SHIPMENT_STATUSES.map((s) => (
            <button key={s.key} type="button" onClick={() => { setStatus(status === s.key ? '' : s.key); setPage(1); }}
              className={`px-3 py-1 rounded-full text-xs font-semibold ${status === s.key ? 'ring-2 ring-[#12325C]' : ''} ${s.bg} ${s.text}`}>
              {ar ? s.ar : s.en} <span className="tabular-nums">{(byStatus[s.key] || 0).toLocaleString('en-US')}</span>
            </button>
          ))}
        </div>
      </div>

      {error && <div className="p-3 rounded-lg bg-red-50 text-red-700 text-sm">{error}</div>}

      {loading ? <Spinner /> : rows.length === 0 ? (
        <div className="bg-white border border-slate-200 rounded-xl p-10 text-center text-slate-500">{t('لا توجد حمولات مطابقة', 'No matching loads')}</div>
      ) : view === 'table' ? (
        <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
          <ScrollX>
            <table className="w-full text-sm" style={{ minWidth: Math.max(960, shownCols.length * 110) }}>
              <thead>
                <tr className="bg-slate-900 border-b border-slate-200">
                  {shownCols.map((c) => {
                    const pinned = c.key === 'reportNumber';
                    return (
                      <th key={c.key} className={`px-3 py-3 text-start text-xs font-semibold whitespace-nowrap text-slate-300 ${pinned ? 'sticky start-0 z-20 bg-slate-900' : ''}`}>
                        <span className="inline-flex items-center">
                          {c.label}
                          {FILTER_FIELDS.has(c.key) && (
                            <ColumnFilter field={c.key}
                              selected={colFilters[c.key] || EMPTY_SET}
                              onChange={(set) => setColFilter(c.key, set)}
                              onOpen={() => { setOpenField(c.key); setOpenNonce((n) => n + 1); }}
                              options={colOptions[c.key]?.values || EMPTY_OPTIONS}
                              truncated={!!colOptions[c.key]?.truncated}
                              loading={!!colLoading[c.key]}
                              onQuery={(q) => fetchColOptions(c.key, q)}
                              lang={lang} format={colFormat(c.key)} />
                          )}
                        </span>
                      </th>
                    );
                  })}
                  <th className="px-3 py-3 text-start text-xs font-semibold whitespace-nowrap text-slate-300">{t('أمر النقل', 'Order')}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {rows.map((r) => (
                  <tr key={r._id} className="hover:bg-slate-100 transition-colors">
                    {shownCols.map((c) => (
                      <td key={c.key} className={`px-3 py-2.5 whitespace-nowrap text-slate-700 ${c.key === 'reportNumber' ? 'sticky start-0 z-10 bg-white border-e border-slate-200' : ''}`}>
                        {c.key === 'applicationStatus' ? statusSelect(r, true)
                          : c.key === 'reportNumber' ? <span className="font-semibold text-slate-900 tabular-nums">{r.reportNumber}</span>
                            : (cell(r, c.key) || <span className="text-slate-300">—</span>)}
                      </td>
                    ))}
                    <td className="px-3 py-2 whitespace-nowrap">{waybillBtn(r)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </ScrollX>
        </div>
      ) : (
        <div className={view === 'grid' ? 'grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3' : 'grid grid-cols-1 lg:grid-cols-2 gap-3'}>
          {rows.map((r) => card(r, view === 'grid'))}
        </div>
      )}

      <TablePager page={page} pageSize={pageSize} total={total} ar={ar} onPage={setPage}
        onPageSize={(n) => { setPageSize(n); savePageSize('opsBoard', n); setPage(1); }} />
    </div>
  );
}
