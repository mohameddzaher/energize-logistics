'use client';
/**
 * Shipment requests board. `mode="sales"`: what sales asked for and where each request stands (edit, resend, withdraw).
 * `mode="vendors"`: the vendors team's inbox — take a request, place each truck (supplier, truck, driver, purchase
 * price) which turns it into a transport order on the normal serial, or reject it with a reason from the list.
 * Live on `shipmentRequests:changed`, so the three sections showing it never disagree.
 */
import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import Link from 'next/link';
import { useAuth } from '@/context/AuthContext';
import { useLanguage } from '@/context/LanguageContext';
import { useDialog } from '@/components/system/DialogProvider';
import { useSocket } from '@/hooks/useSocket';
import { useLatestRequest } from '@/hooks/useLatestRequest';
import api from '@/lib/api';
import { Spinner, SearchInput, Modal, SearchableSelect, ErrorNotice } from '@/components/hr/HRKit';
import SearchableManagedSelect from '@/components/system/SearchableManagedSelect';
import DriverPicker from '@/components/shipment-orders/DriverPicker';
import ShipmentRequestForm from '@/components/shipment-orders/ShipmentRequestForm';
import { PAYMENT_SUBTYPES } from '@/lib/paymentKind';
import type { OrderSupplier, OrderVehicle, OrderDriver } from '@/lib/shipmentOrders';
import { REQUEST_STATUS, LOG_LABEL, canAsk, canPlace, vendorProgress, statusLabel, type ShipmentRequest, type RequestStatus } from '@/lib/shipmentRequests';
import { useColumnFilters } from '@/hooks/useColumnFilters';
import ColumnChooser, { useVisibleColumns, type ChooserColumn } from '@/components/system/ColumnChooser';
import ExportMenu, { type ExportColumn } from '@/components/ls2/ExportMenu';
import {
  Truck, MapPin, Calendar, User as UserIcon, CheckCircle2, XCircle, Send, Pencil, Undo2, Hand, Loader2, Plus, Trash2, Copy, History, Package, AlertCircle, Inbox,
  LayoutGrid, Table2, RotateCcw, SlidersHorizontal, X,
} from 'lucide-react';

const money = (n?: number | null) => (n == null ? '—' : Number(n).toLocaleString('en-US'));
const day = (v?: string | null) => (v ? new Date(v).toLocaleDateString('en-GB') : '—');
const when = (v?: string | null) => (v ? new Date(v).toLocaleString('en-GB', { hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit' }) : '');
const inputCls = 'w-full px-3 py-2 rounded-lg bg-white border border-slate-200 text-slate-900 text-sm focus:outline-none focus:ring-2 focus:ring-[#f37121]/50';

type Tab = 'open' | RequestStatus | 'all';

export default function ShipmentRequestsBoard({ mode }: { mode: 'sales' | 'vendors' }) {
  const { user, refreshUser } = useAuth() as any;
  const { lang, isRTL } = useLanguage();
  const ar = lang === 'ar';
  const t = (a: string, e: string) => (ar ? a : e);
  const { notify, confirm } = useDialog();
  const guard = useLatestRequest();
  const [tab, setTab] = useState<Tab>(mode === 'vendors' ? 'open' : 'all');
  const [q, setQ] = useState('');
  const [qd, setQd] = useState('');
  useEffect(() => { const h = setTimeout(() => setQd(q), 300); return () => clearTimeout(h); }, [q]);
  const [mine, setMine] = useState(false);
  // Request date range, filtered on the server; the other top filters narrow the loaded rows.
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [top, setTop] = useState<Record<string, string>>({});
  const [filtersOpen, setFiltersOpen] = useState(false);
  const filtersRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  // The panel is placed on the viewport (fixed) and clamped inside it, so a narrow window never cuts it off.
  const [panelPos, setPanelPos] = useState<{ top: number; left: number; width: number; maxHeight: number } | null>(null);
  useEffect(() => {
    if (!filtersOpen) { setPanelPos(null); return; }
    const place = () => {
      const btn = filtersRef.current?.getBoundingClientRect();
      if (!btn) return;
      const vw = window.innerWidth; const vh = window.innerHeight;
      const width = Math.min(680, vw - 24);
      const anchor = isRTL ? btn.right - width : btn.left;
      const left = Math.max(12, Math.min(anchor, vw - width - 12));
      const top = Math.min(btn.bottom + 8, vh - 160);
      setPanelPos({ top, left, width, maxHeight: vh - top - 12 });
    };
    place();
    const close = (e: MouseEvent) => {
      const t = e.target as Node;
      if (filtersRef.current?.contains(t) || panelRef.current?.contains(t)) return;
      setFiltersOpen(false);
    };
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    document.addEventListener('mousedown', close);
    return () => { window.removeEventListener('resize', place); window.removeEventListener('scroll', place, true); document.removeEventListener('mousedown', close); };
  }, [filtersOpen, isRTL]);
  // Cards or table, saved on the account per board (the same keys as mobile); the table is the default.
  const prefKey = `shipmentRequests.view.${mode === 'vendors' ? 'place' : 'ask'}`;
  const [viewLocal, setViewLocal] = useState<'cards' | 'table' | null>(null);
  const savedView = String((user as any)?.uiPrefs?.[prefKey.replace(/\./g, ':')] || '');
  const view: 'cards' | 'table' = viewLocal ?? (savedView === 'cards' ? 'cards' : 'table');
  const changeView = (v: 'cards' | 'table') => {
    if (v === view) return;
    setViewLocal(v);
    api.patch('/api/auth/me/prefs', { key: prefKey, value: v }).then(() => refreshUser?.().catch(() => {})).catch(() => {});
  };
  const [rows, setRows] = useState<ShipmentRequest[]>([]);
  const [byStatus, setByStatus] = useState<Record<string, number>>({});
  const [openTrucks, setOpenTrucks] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [placing, setPlacing] = useState<ShipmentRequest | null>(null);
  const [rejecting, setRejecting] = useState<ShipmentRequest | null>(null);
  const [editing, setEditing] = useState<ShipmentRequest | null>(null);
  const [history, setHistory] = useState<ShipmentRequest | null>(null);
  const [busyId, setBusyId] = useState('');
  const asker = canAsk(user);
  const placer = canPlace(user);

  const load = useCallback(async () => {
    const my = guard.begin();
    const p = new URLSearchParams({ limit: '200' });
    if (tab === 'open') p.set('status', 'pending,in_progress');
    else if (tab !== 'all') p.set('status', tab);
    if (qd.trim()) p.set('q', qd.trim());
    if (mine) p.set(mode === 'vendors' ? 'handler' : 'mine', mode === 'vendors' ? 'me' : '1');
    if (from) p.set('from', from);
    if (to) p.set('to', to);
    p.set('limit', '1000');
    try {
      const d = await api.get<{ requests: ShipmentRequest[]; byStatus: Record<string, number>; openTrucks: number }>(`/api/shipment-requests?${p}`);
      if (!guard.isCurrent(my)) return;
      setRows(d.requests || []); setByStatus(d.byStatus || {}); setOpenTrucks(d.openTrucks || 0); setError('');
    } catch (e: any) { if (guard.isCurrent(my)) setError(e?.message || t('تعذّر التحميل', 'Could not load')); }
    if (guard.isCurrent(my)) setLoading(false);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, qd, mine, mode, guard, from, to]);
  useEffect(() => { load(); }, [load]);
  const timer = useRef<any>(null);
  useSocket('shipmentRequests:changed', useCallback(() => { clearTimeout(timer.current); timer.current = setTimeout(load, 400); }, [load]));

  // Opened from a notification: ?id=… opens that request.
  useEffect(() => {
    const id = typeof window !== 'undefined' ? new URLSearchParams(window.location.search).get('id') : null;
    if (!id) return;
    api.get<{ request: ShipmentRequest }>(`/api/shipment-requests/${id}`).then((d) => setHistory(d.request)).catch(() => {});
  }, []);

  const act = async (r: ShipmentRequest, path: string, body?: any, ok?: string) => {
    setBusyId(r._id);
    try { await api.post(`/api/shipment-requests/${r._id}/${path}`, body || {}); if (ok) notify(ok, 'success'); load(); }
    catch (e: any) {
      if (e?.status === 409 && path === 'claim' && await confirm({ title: t('الطلب مع زميل', 'Held by a colleague'), message: `${e.message}. ${t('هل تتولّاه بدلًا منه؟', 'Take it over?')}` })) {
        await api.post(`/api/shipment-requests/${r._id}/claim`, { takeOver: true }).catch(() => {}); load();
      } else notify(e?.message || t('تعذّر التنفيذ', 'Failed'), 'error');
    }
    setBusyId('');
  };

  const counts = { open: (byStatus.pending || 0) + (byStatus.in_progress || 0), ...byStatus } as Record<string, number>;
  const all = Object.values(byStatus).reduce((s, n) => s + n, 0);
  const TABS: [Tab, string, string][] = mode === 'vendors'
    ? [['open', 'المفتوحة', 'Open'], ['pending', 'جديدة', 'New'], ['in_progress', 'قيد الإنجاز', 'In progress'], ['rejected', 'مرفوضة', 'Rejected'], ['completed', 'مكتملة', 'Completed'], ['cancelled', 'مسحوبة', 'Withdrawn'], ['all', 'الكلّ', 'All']]
    : [['all', 'كلّ طلباتي', 'All'], ['open', 'لدى الموردين', 'With vendors'], ['rejected', 'مرفوضة', 'Rejected'], ['completed', 'مكتملة', 'Completed'], ['cancelled', 'مسحوبة', 'Withdrawn']];

  // Top filters (as on the HR pages): each value list is read from the loaded rows.
  const TOP_FILTERS: { key: string; ar: string; en: string; read: (r: ShipmentRequest) => string }[] = [
    { key: 'customer', ar: 'العميل', en: 'Customer', read: (r) => r.customerName || '' },
    { key: 'salesRep', ar: 'السيلز', en: 'Sales rep', read: (r) => r.salesRepName || r.createdByName || '' },
    { key: 'handler', ar: 'مسؤول الموردين', en: 'Vendors handler', read: (r) => r.handlerName || '' },
    { key: 'progress', ar: mode === 'vendors' ? 'الإنجاز' : 'إنجاز الموردين', en: 'Progress', read: (r) => vendorProgress(r, ar, mode).label },
    { key: 'fromCity', ar: 'من', en: 'From', read: (r) => r.fromCity || '' },
    { key: 'toCity', ar: 'إلى', en: 'To', read: (r) => r.toCity || '' },
    { key: 'truckType', ar: 'نوع الشاحنة', en: 'Truck type', read: (r) => r.truckType || '' },
    { key: 'branch', ar: 'الفرع', en: 'Branch', read: (r) => r.branch || '' },
    { key: 'supplier', ar: 'المورّد', en: 'Supplier', read: (r) => (r.placed || []).map((p) => p.supplierName).filter(Boolean).join('، ') },
  ];
  const topActive = Object.values(top).filter(Boolean).length;
  const topRows = useMemo(() => rows.filter((r) => TOP_FILTERS.every((f) => !top[f.key] || (f.key === 'supplier'
    ? (r.placed || []).some((p) => p.supplierName === top[f.key]) : f.read(r) === top[f.key]))),
  // eslint-disable-next-line react-hooks/exhaustive-deps
  [rows, top, ar]);
  const topOptions = useMemo(() => {
    const out: Record<string, string[]> = {};
    for (const f of TOP_FILTERS) {
      const set = new Set<string>();
      for (const r of rows) {
        if (f.key === 'supplier') (r.placed || []).forEach((p) => p.supplierName && set.add(p.supplierName));
        else { const v = f.read(r); if (v) set.add(v); }
      }
      out[f.key] = [...set].sort((a, b) => a.localeCompare(b, 'ar'));
    }
    return out;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, ar]);

  // Table columns: one list drives the header, the Excel-style filter, the column chooser and the export.
  const showSell = rows.some((r) => r.sellPrice !== undefined);
  const COLS = useMemo(() => {
    const c: { key: string; ar: string; en: string; read: (r: ShipmentRequest) => any; num?: boolean; date?: boolean }[] = [
      { key: 'number', ar: 'رقم الطلب', en: 'Request', read: (r) => r.number, num: true },
      { key: 'status', ar: 'الحالة', en: 'Status', read: (r) => statusLabel(r.status, ar, mode) },
      { key: 'progress', ar: mode === 'vendors' ? 'الإنجاز' : 'إنجاز الموردين', en: 'Progress', read: (r) => vendorProgress(r, ar, mode).label },
      { key: 'trucks', ar: 'الشاحنات المطلوبة', en: 'Trucks asked', read: (r) => r.trucks, num: true },
      { key: 'placedCount', ar: 'أُسندت', en: 'Placed', read: (r) => (r.placed || []).length, num: true },
      { key: 'openCount', ar: 'متبقّية', en: 'Remaining', read: (r) => (['pending', 'in_progress'].includes(r.status) ? r.open : 0), num: true },
      { key: 'closedCount', ar: 'مرفوضة/مسحوبة', en: 'Rejected/withdrawn', read: (r) => (['rejected', 'cancelled'].includes(r.status) ? r.open : 0), num: true },
      { key: 'customer', ar: 'العميل', en: 'Customer', read: (r) => r.customerName || '' },
      { key: 'fromCity', ar: 'من', en: 'From', read: (r) => r.fromCity || '' },
      { key: 'toCity', ar: 'إلى', en: 'To', read: (r) => r.toCity || '' },
      { key: 'truckType', ar: 'نوع الشاحنة', en: 'Truck type', read: (r) => r.truckType || '' },
      { key: 'typesSent', ar: 'النوع المنفَّذ', en: 'Type sent', read: (r) => [...new Set((r.placed || []).map((p: any) => p.truckType).filter(Boolean))].join('، ') },
      { key: 'truckLength', ar: 'الطول', en: 'Length', read: (r) => r.truckLength || '' },
      { key: 'cargoType', ar: 'نوع الحمولة', en: 'Cargo', read: (r) => r.cargoType || '' },
      { key: 'pickup', ar: 'موعد التحميل', en: 'Pickup', read: (r) => day(r.pickupTime), date: true },
      ...(showSell ? [{ key: 'sellPrice', ar: 'سعر البيع للشاحنة', en: 'Sell / truck', read: (r: ShipmentRequest) => r.sellPrice ?? '', num: true }] : []),
      { key: 'payment', ar: 'طريقة الدفع', en: 'Payment', read: (r) => (r.paymentSubtype ? ((PAYMENT_SUBTYPES as any)[r.paymentSubtype]?.[ar ? 'ar' : 'en'] || r.paymentSubtype) : '') },
      { key: 'salesRep', ar: 'السيلز', en: 'Sales rep', read: (r) => r.salesRepName || '' },
      { key: 'createdBy', ar: 'أنشأه', en: 'Created by', read: (r) => r.createdByName || '' },
      { key: 'createdAt', ar: 'تاريخ الطلب', en: 'Requested', read: (r) => day(r.createdAt), date: true },
      { key: 'handler', ar: 'مسؤول الموردين', en: 'Vendors handler', read: (r) => r.handlerName || '' },
      { key: 'orders', ar: 'أوامر النقل', en: 'Transport orders', read: (r) => (r.placed || []).map((p) => p.waybillNumber).join('، ') },
      { key: 'supplier', ar: 'المورّدون', en: 'Suppliers', read: (r) => [...new Set((r.placed || []).map((p) => p.supplierName).filter(Boolean))].join('، ') },
      { key: 'plates', ar: 'السيارات', en: 'Trucks', read: (r) => (r.placed || []).map((p) => p.vehiclePlate).filter(Boolean).join('، ') },
      { key: 'drivers', ar: 'السائقون', en: 'Drivers', read: (r) => (r.placed || []).map((p) => p.driverName).filter(Boolean).join('، ') },
      { key: 'rejectReason', ar: 'سبب الرفض', en: 'Reject reason', read: (r) => r.rejectReason || '' },
      { key: 'branch', ar: 'الفرع', en: 'Branch', read: (r) => r.branch || '' },
      { key: 'blNumber', ar: 'رقم البوليصة', en: 'BL', read: (r) => r.blNumber || '' },
      { key: 'containerNumber', ar: 'رقم الحاوية', en: 'Container', read: (r) => r.containerNumber || '' },
      { key: 'notes', ar: 'ملاحظات', en: 'Notes', read: (r) => r.notes || '' },
    ];
    return c;
  }, [ar, showSell]);
  const readers = useMemo(() => Object.fromEntries(COLS.map((c) => [c.key, (r: ShipmentRequest) => { const v = c.read(r); return v === null || v === undefined ? '' : String(v); }])), [COLS]);
  const cf = useColumnFilters<ShipmentRequest>(readers, topRows, ar ? 'ar' : 'en');
  const shown = useMemo(() => cf.apply(topRows), [cf, topRows]);
  const chooserCols: ChooserColumn[] = useMemo(() => COLS.map((c) => ({ key: c.key, label: ar ? c.ar : c.en, locked: c.key === 'number' })), [COLS, ar]);
  const DEFAULT_COLS = ['number', 'status', 'progress', 'trucks', 'placedCount', 'openCount', 'customer', 'fromCity', 'toCity', 'truckType', 'pickup', 'sellPrice', 'salesRep', 'handler', 'orders', 'createdAt'];
  const { visible, setVisible } = useVisibleColumns(`shipmentRequests:cols:${mode}`, chooserCols, { defaults: DEFAULT_COLS });
  const visCols = COLS.filter((c) => visible.includes(c.key));
  const exportCols = (cols: typeof COLS): ExportColumn[] => cols.map((c) => ({ header: ar ? c.ar : c.en, key: c.key, transform: (_v: any, r: any) => c.read(r), type: c.num ? 'number' : 'text' }));
  const exportOptions = [
    { key: 'view', label: t('المعروض بعد الفلاتر — الأعمدة الظاهرة', 'Filtered view — visible columns'), sheets: [{ name: t('طلبات الشحن', 'Requests'), rows: shown, columns: exportCols(visCols) }] },
    { key: 'viewAll', label: t('المعروض بعد الفلاتر — كلّ الأعمدة', 'Filtered view — all columns'), sheets: [{ name: t('طلبات الشحن', 'Requests'), rows: shown, columns: exportCols(COLS) }] },
    { key: 'all', label: t('كلّ المُحمَّل بلا فلاتر', 'Everything loaded, no filters'), sheets: [{ name: t('طلبات الشحن', 'Requests'), rows, columns: exportCols(COLS) }] },
  ];
  const sum = useMemo(() => shown.reduce((a, r) => {
    const placed = (r.placed || []).length;
    const rest = Math.max(0, r.trucks - placed);
    const openReq = ['pending', 'in_progress'].includes(r.status);
    return { requests: a.requests + 1, asked: a.asked + r.trucks, placed: a.placed + placed, closed: a.closed + (openReq ? 0 : rest), waiting: a.waiting + (openReq ? rest : 0) };
  }, { requests: 0, asked: 0, placed: 0, closed: 0, waiting: 0 }), [shown]);
  const rDay = (back = 0) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Riyadh' }).format(new Date(Date.now() - back * 864e5));
  const QUICK: [string, string, string, string][] = [
    ['اليوم', 'Today', rDay(), rDay()], ['أمس', 'Yesterday', rDay(1), rDay(1)],
    ['آخر 7 أيام', 'Last 7 days', rDay(6), rDay()], ['هذا الشهر', 'This month', `${rDay().slice(0, 8)}01`, rDay()],
  ];
  const anyFilter = topActive + cf.activeCount + (from ? 1 : 0) + (to ? 1 : 0);
  const resetFilters = () => { setTop({}); cf.clear(); setFrom(''); setTo(''); };

  // The same actions on a card and in a table row; called as a function, not mounted as a component.
  const actions = (r: ShipmentRequest, compact = false) => {
    const open = ['pending', 'in_progress'].includes(r.status);
    const held = !!r.handler && String(r.handler) !== String(user?._id);
    return (
      <>
        {mode === 'vendors' && placer && open && (
          <>
            <Btn primary onClick={() => setPlacing(r)} icon={CheckCircle2}>{t('إكمال الشحنة', 'Complete')}</Btn>
            <Btn onClick={() => setRejecting(r)} icon={XCircle} danger>{t('رفض', 'Reject')}</Btn>
            {!r.handler || held
              ? <Btn onClick={() => act(r, 'claim', {}, t('تولّيتَ الطلب', 'Taken'))} icon={Hand} busy={busyId === r._id}>{held ? t('تولِّيه بدلًا من زميل', 'Take over') : t('أتولّاه', 'Take it')}</Btn>
              : <Btn onClick={() => act(r, 'release')} icon={Undo2} busy={busyId === r._id}>{t('تخلٍّ', 'Release')}</Btn>}
          </>
        )}
        {mode === 'sales' && asker && ['pending', 'in_progress', 'rejected'].includes(r.status) && (
          <>
            {r.status === 'rejected' && <Btn primary onClick={() => setEditing(r)} icon={Pencil}>{t('تعديل وإعادة الإرسال', 'Amend and resend')}</Btn>}
            {r.status !== 'rejected' && <Btn onClick={() => setEditing(r)} icon={Pencil}>{t('تعديل', 'Edit')}</Btn>}
            {r.status === 'rejected' && <Btn onClick={() => act(r, 'resubmit', {}, t('أُعيد الإرسال', 'Resent'))} icon={Send} busy={busyId === r._id}>{t('إعادة الإرسال كما هو', 'Resend as is')}</Btn>}
            <Btn danger icon={Trash2} busy={busyId === r._id} onClick={async () => {
              if (await confirm({ title: t('سحب الطلب', 'Withdraw'), message: r.placed.length ? t('أوامرُ النقل المُنشأة تبقى، ويُسحب الباقي فقط.', 'Created transport orders stay; only the rest is withdrawn.') : t('يُسحب الطلب من فريق الموردين.', 'The request is withdrawn.'), tone: 'danger' as any }))
                act(r, 'cancel', {}, t('سُحب الطلب', 'Withdrawn'));
            }}>{t('سحب', 'Withdraw')}</Btn>
          </>
        )}
        <button type="button" onClick={() => setHistory(r)} className={`${compact ? '' : 'ms-auto '}inline-flex items-center gap-1 text-[12px] font-semibold text-slate-500 hover:text-slate-900`}><History className="w-3.5 h-3.5" />{t('السجلّ', 'History')}</button>
      </>
    );
  };

  const activeChips = [
    ...(from || to ? [{ key: '__date', label: from === to ? `${t('يوم', 'Day')} ${from}` : `${from || '…'} → ${to || '…'}`, clear: () => { setFrom(''); setTo(''); } }] : []),
    ...TOP_FILTERS.filter((f) => top[f.key]).map((f) => ({ key: f.key, label: `${ar ? f.ar : f.en}: ${top[f.key]}`, clear: () => setTop((p) => ({ ...p, [f.key]: '' })) })),
  ];
  const inputSm = 'h-9 rounded-lg border border-slate-200 bg-white px-2.5 text-[12.5px] text-slate-800 focus:outline-none focus:ring-2 focus:ring-[#f37121]/40';

  return (
    <div className="space-y-3" dir={isRTL ? 'rtl' : 'ltr'}>
      {/* One toolbar on top: status, search, period, detail filters (in a panel), view, columns and export. */}
      <div className="rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div className="flex flex-wrap items-center gap-2 p-3">
          <div className="flex flex-wrap gap-1">
            {TABS.map(([k, a, e]) => (
              <button key={k} type="button" onClick={() => setTab(k)}
                className={`px-3 py-1.5 rounded-lg text-[12.5px] font-semibold ${tab === k ? 'bg-slate-900 text-white' : 'bg-slate-100 text-slate-700 hover:bg-slate-200'}`}>
                {ar ? a : e}<span className="ms-1.5 tabular-nums opacity-70">{k === 'all' ? all : (counts[k] || 0)}</span>
              </button>
            ))}
          </div>
          <label className="inline-flex items-center gap-1.5 text-[12.5px] text-slate-600 ms-1">
            <input type="checkbox" checked={mine} onChange={(e) => setMine(e.target.checked)} className="accent-[#f37121]" />
            {mode === 'vendors' ? t('التي أعمل عليها', 'Mine') : t('طلباتي أنا فقط', 'Only mine')}
          </label>
          <div className="flex-1 min-w-[220px]"><SearchInput value={q} onChange={setQ} placeholder={t('رقم الطلب، العميل، المدينة، رقم أمر النقل…', 'Request no., customer, city, order no.…')} /></div>
        </div>

        <div className="flex flex-wrap items-center gap-2 border-t border-slate-100 px-3 py-2.5">
          {/* Quick days: the range is the request date (when sales asked). */}
          <div className="inline-flex rounded-lg border border-slate-200 p-0.5">
            {QUICK.map(([a, e, f, tt]) => {
              const on = from === f && to === tt;
              return (
                <button key={a} type="button" onClick={() => { if (on) { setFrom(''); setTo(''); } else { setFrom(f); setTo(tt); } }}
                  className={`rounded-md px-2.5 py-1 text-[12.5px] font-semibold whitespace-nowrap ${on ? 'bg-[#f37121] text-white' : 'text-slate-600 hover:bg-slate-100'}`}>{ar ? a : e}</button>
              );
            })}
          </div>
          <div className="inline-flex items-center gap-1.5">
            <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} title={t('من تاريخ', 'From date')} className={inputSm} />
            <span className="text-slate-400">→</span>
            <input type="date" value={to} onChange={(e) => setTo(e.target.value)} title={t('إلى تاريخ', 'To date')} className={inputSm} />
          </div>
          <div className="relative" ref={filtersRef}>
            <button type="button" onClick={() => setFiltersOpen((v) => !v)}
              className={`inline-flex h-9 items-center gap-1.5 rounded-lg border px-3 text-[12.5px] font-semibold ${topActive ? 'border-[#f37121] bg-orange-50 text-[#c2410c]' : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50'}`}>
              <SlidersHorizontal className="h-4 w-4" />{t('الفلاتر', 'Filters')}
              {topActive > 0 && <span className="rounded-full bg-[#f37121] px-1.5 text-[11px] text-white tabular-nums">{topActive}</span>}
            </button>
            {filtersOpen && panelPos && (
              <div ref={panelRef} style={{ position: 'fixed', top: panelPos.top, left: panelPos.left, width: panelPos.width, maxHeight: panelPos.maxHeight }}
                className="z-50 overflow-auto rounded-2xl border border-slate-200 bg-white p-4 shadow-xl">
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                  {TOP_FILTERS.map((f) => (
                    <label key={f.key} className="block">
                      <span className="mb-1 block text-[11.5px] font-semibold text-slate-500">{ar ? f.ar : f.en}</span>
                      <select value={top[f.key] || ''} onChange={(e) => setTop((p) => ({ ...p, [f.key]: e.target.value }))}
                        className={`w-full ${inputSm} ${top[f.key] ? '!border-[#f37121] !bg-orange-50' : ''}`}>
                        <option value="">{t('الكلّ', 'All')}</option>
                        {(topOptions[f.key] || []).map((v) => <option key={v} value={v}>{v}</option>)}
                      </select>
                    </label>
                  ))}
                </div>
                <div className="mt-4 flex items-center justify-between border-t border-slate-100 pt-3">
                  <button type="button" onClick={() => setTop({})} disabled={!topActive} className="text-[12.5px] font-semibold text-slate-500 hover:text-[#f37121] disabled:opacity-40">{t('مسح هذه الفلاتر', 'Clear these filters')}</button>
                  <button type="button" onClick={() => setFiltersOpen(false)} className="rounded-lg bg-slate-900 px-4 py-1.5 text-[12.5px] font-semibold text-white">{t('تم', 'Done')}</button>
                </div>
              </div>
            )}
          </div>
          <div className="ms-auto flex flex-wrap items-center gap-2">
            <div className="inline-flex rounded-lg border border-slate-200 p-0.5">
              {([['cards', 'بطاقات', 'Cards', LayoutGrid], ['table', 'جدول', 'Table', Table2]] as const).map(([k, a, e, Icon]) => (
                <button key={k} type="button" onClick={() => changeView(k)}
                  className={`inline-flex items-center gap-1 rounded-md px-2.5 py-1 text-[12px] font-semibold ${view === k ? 'bg-slate-900 text-white' : 'text-slate-600 hover:text-slate-900'}`}>
                  <Icon className="h-3.5 w-3.5" />{ar ? a : e}
                </button>
              ))}
            </div>
            {view === 'table' && <ColumnChooser columns={chooserCols} visible={visible} onChange={setVisible} ar={ar} />}
            <ExportMenu fileName={mode === 'vendors' ? 'shipment-requests-vendors' : 'shipment-requests'} lang={ar ? 'ar' : 'en'} label={t('تصدير Excel', 'Export Excel')} options={exportOptions} />
          </div>
        </div>

        {/* Active filters as removable chips, so what narrows the list is always visible. */}
        {(activeChips.length > 0 || cf.activeCount > 0) && (
          <div className="flex flex-wrap items-center gap-1.5 border-t border-slate-100 px-3 py-2">
            {activeChips.map((c) => (
              <span key={c.key} className="inline-flex items-center gap-1 rounded-full bg-orange-50 px-2.5 py-0.5 text-[12px] font-semibold text-[#c2410c]">
                {c.label}<button type="button" onClick={c.clear} className="hover:text-red-600"><X className="h-3 w-3" /></button>
              </span>
            ))}
            {cf.activeCount > 0 && <span className="rounded-full bg-slate-100 px-2.5 py-0.5 text-[12px] font-semibold text-slate-700">{t(`فلاتر أعمدة: ${cf.activeCount}`, `Column filters: ${cf.activeCount}`)}</span>}
            <button type="button" onClick={resetFilters} className="ms-1 inline-flex items-center gap-1 text-[12px] font-semibold text-slate-500 hover:text-[#f37121]">
              <RotateCcw className="h-3.5 w-3.5" />{t('مسح الكلّ', 'Clear all')}
            </button>
          </div>
        )}
      </div>

      {/* What the shown requests came to, in trucks: asked, done by vendors, rejected or withdrawn, still waiting. */}
      <div className="grid grid-cols-2 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm sm:grid-cols-5 sm:divide-x sm:divide-slate-100 rtl:sm:divide-x-reverse">
        {([
          [t('طلبات', 'Requests'), sum.requests, 'text-slate-900'],
          [t('شاحنات مطلوبة', 'Trucks asked'), sum.asked, 'text-[#f37121]'],
          [t('نُفِّذت (أوامر نقل)', 'Done (orders)'), sum.placed, 'text-emerald-700'],
          [t('رُفضت أو سُحبت', 'Rejected or withdrawn'), sum.closed, 'text-red-600'],
          [t('لم تُنفَّذ بعد', 'Not done yet'), sum.waiting, 'text-amber-700'],
        ] as const).map(([label, value, cls]) => (
          <div key={label} className="px-4 py-2.5">
            <p className="text-[11.5px] font-semibold text-slate-500">{label}</p>
            <p className={`text-xl font-extrabold tabular-nums ${cls}`}>{Number(value).toLocaleString('en-US')}</p>
          </div>
        ))}
      </div>

      {error && <ErrorNotice error={error} onRetry={load} lang={ar ? 'ar' : 'en'} />}
      {loading ? <Spinner /> : !shown.length && !(view === 'table' && cf.activeCount) ? (
        <div className="rounded-2xl border border-dashed border-slate-300 bg-white py-14 text-center text-slate-500">
          <Inbox className="w-8 h-8 mx-auto mb-2 text-slate-300" />{rows.length ? t('لا طلبات تطابق الفلاتر', 'No requests match the filters') : t('لا طلبات هنا', 'No requests here')}
        </div>
      ) : view === 'table' ? (
        <div className="rounded-2xl border border-slate-200 bg-white shadow-sm overflow-auto max-h-[75vh]">
          <table className="w-full text-[12.5px]">
            <thead className="sticky top-0 z-10 bg-slate-900 text-slate-200">
              <tr>
                {visCols.map((c) => (
                  <th key={c.key} className={`whitespace-nowrap px-3 py-2 font-semibold ${c.num ? 'text-end' : 'text-start'}`}>{cf.head(c.key, ar ? c.ar : c.en)}</th>
                ))}
                <th className="px-3 py-2 text-start font-semibold">{t('إجراءات', 'Actions')}</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((r) => {
                const st = REQUEST_STATUS[r.status];
                const vp = vendorProgress(r, ar, mode);
                return (
                  <tr key={r._id} className={`border-t border-slate-100 hover:bg-slate-50/60 ${r.status === 'rejected' ? 'bg-red-50/40' : ''}`}>
                    {visCols.map((c) => {
                      if (c.key === 'number') return <td key={c.key} className="px-3 py-2 font-bold tabular-nums text-slate-900">{r.number}</td>;
                      if (c.key === 'status') return <td key={c.key} className="px-3 py-2"><StatusText dot={st.dot}>{statusLabel(r.status, ar, mode)}</StatusText></td>;
                      if (c.key === 'progress') return (
                        <td key={c.key} className="px-3 py-2 min-w-[150px]">
                          <p className={`whitespace-nowrap text-[12px] font-semibold ${vp.tone}`}>{vp.label}</p>
                          <div className="mt-1 h-1.5 rounded-full bg-slate-100"><div className="h-1.5 rounded-full bg-emerald-500" style={{ width: `${vp.pct}%` }} /></div>
                        </td>
                      );
                      if (c.key === 'orders') return (
                        <td key={c.key} className="px-3 py-2 min-w-[220px]">
                          <div className="flex flex-wrap gap-1">{(r.placed || []).map((p) => <Link key={p.order} href={`/system/shipment-orders?q=${p.waybillNumber}`} title={`${p.supplierName} · ${p.vehiclePlate} · ${p.driverName}`} className="rounded bg-emerald-50 px-1.5 py-0.5 font-semibold text-emerald-800 hover:bg-emerald-100">{p.waybillNumber}</Link>)}</div>
                        </td>
                      );
                      const v = c.read(r);
                      return <td key={c.key} className={`px-3 py-2 ${c.num ? 'text-end tabular-nums' : ''} ${['notes', 'drivers', 'plates', 'supplier'].includes(c.key) ? 'max-w-[220px] truncate' : 'whitespace-nowrap'}`} title={['notes', 'drivers', 'plates', 'supplier'].includes(c.key) ? String(v) : undefined}>{c.key === 'sellPrice' ? money(r.sellPrice) : (v === '' ? '—' : v)}</td>;
                    })}
                    <td className="px-3 py-2 whitespace-nowrap"><div className="flex flex-nowrap items-center gap-1.5">{actions(r, true)}</div></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {!shown.length && <p className="py-8 text-center text-slate-500">{t('لا طلبات تطابق الفلاتر', 'No requests match the filters')}</p>}
        </div>
      ) : (
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-3">
          {shown.map((r) => {
            const st = REQUEST_STATUS[r.status];
            const open = ['pending', 'in_progress'].includes(r.status);
            const pct = r.trucks ? Math.round((r.placed.length / r.trucks) * 100) : 0;
            return (
              <div key={r._id} className={`rounded-2xl border bg-white shadow-sm overflow-hidden ${r.status === 'rejected' ? 'border-red-200' : 'border-slate-200'}`}>
                <div className="px-4 py-3 flex flex-wrap items-center gap-2 border-b border-slate-100 bg-slate-50/60">
                  <span className="font-extrabold tabular-nums text-slate-900">{ar ? 'طلب رقم' : 'Request'} {r.number}</span>
                  <StatusText dot={st.dot}>{statusLabel(r.status, ar, mode)}</StatusText>
                  <span className={`text-[12px] font-semibold ${vendorProgress(r, ar, mode).tone}`}>{vendorProgress(r, ar, mode).label}</span>
                  {r.resubmits ? <span className="text-[11px] text-slate-500">{t(`أُعيد ${r.resubmits}×`, `resent ${r.resubmits}×`)}</span> : null}
                  <span className="ms-auto text-[11.5px] text-slate-500">{when(r.createdAt)} · {r.createdByName}</span>
                </div>
                <div className="p-4 space-y-3">
                  <div className="flex flex-wrap items-start gap-x-6 gap-y-2">
                    <div className="min-w-0">
                      <p className="text-[15px] font-bold text-slate-900 truncate">{r.customerName}</p>
                      <p className="mt-0.5 flex items-center gap-1.5 text-[13px] text-slate-700"><MapPin className="w-3.5 h-3.5 text-[#f37121]" />{r.fromCity} <span className="text-slate-400">←</span> {r.toCity}{r.branch ? <span className="text-slate-400"> · {r.branch}</span> : null}</p>
                    </div>
                    {r.sellPrice != null && <div className="ms-auto text-end"><p className="text-[11px] text-slate-500">{t('سعر البيع للشاحنة', 'Selling per truck')}</p><p className="text-[17px] font-extrabold tabular-nums text-[#f37121]">{money(r.sellPrice)}</p></div>}
                  </div>
                  <div className="flex flex-wrap gap-1.5 text-[12px]">
                    <Chip icon={Truck}>{r.truckType || '—'}{r.truckLength ? ` · ${r.truckLength}` : ''}</Chip>
                    {r.cargoType && <Chip icon={Package}>{r.cargoType}</Chip>}
                    <Chip icon={Calendar}>{t('التحميل', 'Pickup')} {day(r.pickupTime)}</Chip>
                    {r.paymentSubtype && <Chip>{(PAYMENT_SUBTYPES as any)[r.paymentSubtype]?.[ar ? 'ar' : 'en'] || r.paymentSubtype}</Chip>}
                    {r.salesRepName && <Chip icon={UserIcon}>{t('المبيعات', 'Sales')}: {r.salesRepName}</Chip>}
                    {r.handlerName && <Chip icon={Hand}>{t('يعمل عليه', 'Handled by')}: {r.handlerName}</Chip>}
                    {(r.blNumber || r.containerNumber) && <Chip>{[r.blNumber, r.containerNumber].filter(Boolean).join(' · ')}</Chip>}
                  </div>
                  {r.notes && <p className="text-[12.5px] text-slate-600 bg-slate-50 rounded-lg px-3 py-2">{r.notes}</p>}
                  <div>
                    <div className="flex items-center justify-between text-[12px] text-slate-600 mb-1">
                      <span>{t(`الشاحنات: أُسندت ${r.placed.length} من ${r.trucks}`, `Trucks placed: ${r.placed.length} of ${r.trucks}`)}</span>
                      {open && <span className="font-semibold text-amber-700">{t(`بقي ${r.open}`, `${r.open} open`)}</span>}
                    </div>
                    <div className="h-2 rounded-full bg-slate-100"><div className="h-2 rounded-full bg-emerald-500 transition-all" style={{ width: `${pct}%` }} /></div>
                    {!!r.placed.length && (
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        {r.placed.map((p) => (
                          <Link key={p.order} href={`/system/shipment-orders?q=${p.waybillNumber}`} title={`${p.supplierName} · ${p.vehiclePlate} · ${p.driverName}`}
                            className="inline-flex items-center gap-1 rounded-lg border border-emerald-200 bg-emerald-50 px-2 py-1 text-[11.5px] font-semibold text-emerald-800 hover:bg-emerald-100">
                            <CheckCircle2 className="w-3.5 h-3.5" />{t('أمر نقل', 'Order')} {p.waybillNumber}<span className="font-normal text-emerald-700/80 max-w-[160px] truncate">· {p.supplierName}</span>
                          </Link>
                        ))}
                      </div>
                    )}
                  </div>
                  {r.status === 'rejected' && (
                    <div className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-[12.5px]">
                      <p className="font-bold text-red-800 flex items-center gap-1.5"><XCircle className="w-4 h-4" />{t('سبب الرفض', 'Reason')}: {r.rejectReason}</p>
                      {r.rejectNote && <p className="text-red-700 mt-0.5">{r.rejectNote}</p>}
                      <p className="text-red-600/80 mt-0.5 text-[11.5px]">{r.rejectedByName} · {when(r.rejectedAt)}</p>
                    </div>
                  )}
                  <div className="flex flex-wrap items-center gap-1.5 pt-1">
                    {actions(r)}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {placing && <PlaceModal req={placing} onClose={() => setPlacing(null)} onDone={() => { setPlacing(null); load(); }} />}
      {rejecting && <RejectModal req={rejecting} onClose={() => setRejecting(null)} onDone={() => { setRejecting(null); load(); }} />}
      {editing && (
        <Modal open onClose={() => setEditing(null)} title={t(`تعديل طلب الشحنة رقم ${editing.number}`, `Edit request ${editing.number}`)} wide>
          <ShipmentRequestForm editId={editing._id} onDone={() => { setEditing(null); load(); }} />
        </Modal>
      )}
      {history && (
        <Modal open onClose={() => setHistory(null)} title={t(`سجلّ الطلب رقم ${history.number}`, `Request ${history.number} history`)}>
          <ol className="relative border-s border-slate-200 ms-2 space-y-3">
            {[...history.log].reverse().map((l) => (
              <li key={l._id} className="ms-4">
                <span className="absolute -start-1.5 mt-1.5 w-3 h-3 rounded-full bg-[#f37121] border-2 border-white" />
                <p className="text-[13px] font-semibold text-slate-900">{(LOG_LABEL[l.action] || { ar: l.action, en: l.action })[ar ? 'ar' : 'en']}{l.waybillNumber ? ` ${l.waybillNumber}` : ''}{l.reason ? ` — ${l.reason}` : ''}</p>
                {l.note && <p className="text-[12px] text-slate-600">{l.note}</p>}
                <p className="text-[11px] text-slate-400">{l.byName} · {when(l.at)}</p>
              </li>
            ))}
          </ol>
        </Modal>
      )}
    </div>
  );
}

/** Status as plain text with a small square marker: a work system, not coloured pills. */
function StatusText({ dot, children }: { dot: string; children: React.ReactNode }) {
  return <span className="inline-flex items-center gap-2 whitespace-nowrap text-[12.5px] font-semibold text-slate-700"><span className={`h-2 w-2 rounded-[2px] ${dot}`} />{children}</span>;
}
function Stat({ label, value, tone }: { label: string; value: number; tone: 'amber' | 'orange' | 'red' | 'green' }) {
  const c = tone === 'amber' ? 'text-amber-700' : tone === 'orange' ? 'text-[#f37121]' : tone === 'red' ? 'text-red-600' : 'text-emerald-700';
  return <div className="rounded-2xl border border-slate-200 bg-white px-4 py-3 shadow-sm"><p className="text-[12px] font-semibold text-slate-600">{label}</p><p className={`mt-1 text-2xl font-extrabold tabular-nums ${c}`}>{value.toLocaleString('en-US')}</p></div>;
}
function Chip({ icon: Icon, children }: { icon?: any; children: React.ReactNode }) {
  return <span className="inline-flex items-center gap-1 rounded-lg bg-slate-100 px-2 py-1 text-slate-700">{Icon && <Icon className="w-3.5 h-3.5 text-slate-500" />}{children}</span>;
}
function Btn({ onClick, children, icon: Icon, primary, danger, busy }: { onClick: () => void; children: React.ReactNode; icon?: any; primary?: boolean; danger?: boolean; busy?: boolean }) {
  return (
    <button type="button" onClick={onClick} disabled={busy}
      className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12.5px] font-semibold transition-colors disabled:opacity-50 ${primary ? 'bg-[#f37121] text-white hover:bg-[#e0641a]' : danger ? 'bg-white border border-red-200 text-red-600 hover:bg-red-50' : 'bg-white border border-slate-200 text-slate-700 hover:bg-slate-50'}`}>
      {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : Icon && <Icon className="w-3.5 h-3.5" />}{children}
    </button>
  );
}

type TruckRow = { truckType: string; sourcingRep: string; supplierId: string; supplierName: string; vehicleId: string; newPlate: string; driverName: string; driverPhone: string; buyPrice: string; advanceAmount: string; blNumber: string; containerNumber: string };
const typesOfReq = (r: ShipmentRequest) => ((r as any).truckTypes?.length ? (r as any).truckTypes as string[] : (r.truckType ? [r.truckType] : []));
const blankTruck = (r: ShipmentRequest, me = ''): TruckRow => ({ truckType: typesOfReq(r).length === 1 ? typesOfReq(r)[0] : '', sourcingRep: me, supplierId: '', supplierName: '', vehicleId: '', newPlate: '', driverName: '', driverPhone: '', buyPrice: '', advanceAmount: '', blNumber: r.blNumber || '', containerNumber: r.containerNumber || '' });

/** The vendors half: one row per truck, each becomes a transport order. */
function PlaceModal({ req, onClose, onDone }: { req: ShipmentRequest; onClose: () => void; onDone: () => void }) {
  const { lang } = useLanguage();
  const ar = lang === 'ar';
  const t = (a: string, e: string) => (ar ? a : e);
  const { notify } = useDialog();
  const { user } = useAuth();
  // Sourcing: who found the carrier for each truck; defaults to the vendors member placing it.
  const [reps, setReps] = useState<{ value: string; label: string; roleAr?: string }[]>([]);
  const me = String(user?._id || '');
  const [rows, setRows] = useState<TruckRow[]>([blankTruck(req)]);
  useEffect(() => {
    api.get<{ options: { value: string; label: string; roleAr?: string }[] }>('/api/shipment-orders/sourcing-reps').then((d) => {
      setReps(d.options || []);
      if ((d.options || []).some((o) => o.value === me)) setRows((p) => p.map((r) => (r.sourcingRep ? r : { ...r, sourcingRep: me })));
    }).catch(() => {});
  }, [me]);
  const defRep = reps.some((o) => o.value === me) ? me : '';
  const [saving, setSaving] = useState(false);
  const [tried, setTried] = useState(false);
  const setRow = (i: number, patch: Partial<TruckRow>) => setRows((p) => p.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  const reqTypes = typesOfReq(req);
  const problems = rows.map((r) => [reqTypes.length > 1 && !r.truckType && 'type', !r.supplierId && 'supplier', !r.vehicleId && !r.newPlate.trim() && 'vehicle', !r.driverName.trim() && 'driver', !(Number(r.buyPrice) > 0) && 'buy'].filter(Boolean) as string[]);
  const submit = async () => {
    setTried(true);
    if (problems.some((p) => p.length)) { notify(t('أكمِل نوع الشاحنة والمورّد والسيارة والسائق وسعر الشراء لكلّ شاحنة', 'Fill truck type, supplier, truck, driver and purchase price for each truck'), 'error'); return; }
    setSaving(true);
    try {
      const d = await api.post<{ waybills: number[]; failed: any[] }>(`/api/shipment-requests/${req._id}/place`, {
        trucks: rows.map((r) => ({
          supplierChoice: r.supplierId, ...(r.vehicleId ? { vehicle: r.vehicleId } : { newVehicle: { plate: r.newPlate.trim() } }),
          driverName: r.driverName.trim(), driverPhone: r.driverPhone, truckType: r.truckType || undefined, sourcingRep: r.sourcingRep || null, buyPrice: Number(r.buyPrice), advanceAmount: r.advanceAmount === '' ? null : Number(r.advanceAmount),
          blNumber: r.blNumber, containerNumber: r.containerNumber,
        })),
      });
      notify(t(`أُنشئت أوامر النقل: ${(d.waybills || []).join('، ')}${d.failed?.length ? ` · تعذّرت ${d.failed.length}` : ''}`, `Transport orders: ${(d.waybills || []).join(', ')}`), d.failed?.length ? 'error' : 'success');
      onDone();
    } catch (e: any) { notify(e?.message || t('تعذّر الإنشاء', 'Failed'), 'error'); }
    setSaving(false);
  };
  return (
    <Modal open onClose={onClose} wide title={t(`إكمال طلب الشحنة رقم ${req.number}`, `Complete request ${req.number}`)}
      footer={(
        <div className="flex flex-wrap items-center gap-2 w-full">
          <span className="text-[12.5px] text-slate-600">{t(`${rows.length} من ${req.open} شاحنة مفتوحة`, `${rows.length} of ${req.open} open trucks`)}</span>
          <button type="button" onClick={submit} disabled={saving} className="ms-auto inline-flex items-center gap-1.5 px-5 py-2.5 rounded-xl bg-[#f37121] text-white text-sm font-bold disabled:opacity-50">
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}{t('إتمام إنشاء الشحنة', 'Create the transport orders')}
          </button>
        </div>
      )}>
      <div className="space-y-3">
        <div className="rounded-xl bg-slate-50 border border-slate-200 px-3 py-2.5 text-[12.5px] text-slate-700 flex flex-wrap gap-x-4 gap-y-1">
          <span className="font-bold text-slate-900">{req.customerName}</span>
          <span>{req.fromCity} ← {req.toCity}</span><span>{req.truckType}{req.truckLength ? ` · ${req.truckLength}` : ''}</span>
          <span>{t('التحميل', 'Pickup')} {day(req.pickupTime)}</span>{req.branch && <span>{req.branch}</span>}
        </div>
        {rows.map((r, i) => (
          <TruckEditor key={i} i={i} row={r} reps={reps} types={reqTypes} miss={tried ? problems[i] : []} onChange={(p) => setRow(i, p)}
            onRemove={rows.length > 1 ? () => setRows((p) => p.filter((_, j) => j !== i)) : undefined} ar={ar} />
        ))}
        <div className="flex flex-wrap gap-2">
          {rows.length < req.open && <button type="button" onClick={() => setRows((p) => [...p, blankTruck(req, defRep)])} className="inline-flex items-center gap-1 px-3 py-2 rounded-lg border border-dashed border-slate-300 text-[12.5px] font-semibold text-slate-700 hover:border-[#f37121] hover:text-[#f37121]"><Plus className="w-4 h-4" />{t('شاحنةٌ أخرى', 'Another truck')}</button>}
          {rows.length < req.open && rows[0].supplierId && <button type="button" onClick={() => setRows((p) => [...p, { ...blankTruck(req, p[0].sourcingRep), supplierId: p[0].supplierId, supplierName: p[0].supplierName, buyPrice: p[0].buyPrice }])} className="inline-flex items-center gap-1 px-3 py-2 rounded-lg border border-dashed border-slate-300 text-[12.5px] font-semibold text-slate-700 hover:border-[#f37121] hover:text-[#f37121]"><Copy className="w-4 h-4" />{t('شاحنةٌ أخرى من نفس المورّد', 'Another from the same supplier')}</button>}
        </div>
      </div>
    </Modal>
  );
}

function TruckEditor({ i, row, reps, types, miss, onChange, onRemove, ar }: { i: number; row: TruckRow; reps: { value: string; label: string; roleAr?: string }[]; types: string[]; miss: string[]; onChange: (p: Partial<TruckRow>) => void; onRemove?: () => void; ar: boolean }) {
  const t = (a: string, e: string) => (ar ? a : e);
  const [sups, setSups] = useState<OrderSupplier[]>([]);
  const [vehs, setVehs] = useState<OrderVehicle[]>([]);
  const [drivers, setDrivers] = useState<OrderDriver[]>([]);
  const [supBusy, setSupBusy] = useState(false);
  const supGuard = useLatestRequest();
  const vehGuard = useLatestRequest();
  const searchSup = useCallback(async (q: string) => {
    const my = supGuard.begin(); setSupBusy(true);
    try { const d = await api.get<{ suppliers: OrderSupplier[] }>(`/api/shipment-orders/suppliers?limit=60&fresh=1${q ? `&q=${encodeURIComponent(q)}` : ''}`); if (supGuard.isCurrent(my)) setSups(d.suppliers || []); } catch { /* keep */ }
    if (supGuard.isCurrent(my)) setSupBusy(false);
  }, [supGuard]);
  useEffect(() => { searchSup(''); }, [searchSup]);
  const searchVeh = useCallback(async (q: string) => {
    const my = vehGuard.begin();
    const qs = new URLSearchParams({ limit: '80' });
    if (row.supplierId && !q) qs.set('supplier', row.supplierId);
    if (q) qs.set('q', q);
    try { const d = await api.get<{ vehicles: OrderVehicle[] }>(`/api/shipment-orders/vehicles?${qs}`); if (vehGuard.isCurrent(my)) setVehs(d.vehicles || []); } catch { /* keep */ }
  }, [vehGuard, row.supplierId]);
  useEffect(() => { searchVeh(''); }, [searchVeh]);
  useEffect(() => {
    if (!row.vehicleId && !row.supplierId) { setDrivers([]); return; }
    api.get<{ drivers: OrderDriver[] }>(`/api/shipment-orders/drivers?${row.vehicleId ? `vehicle=${row.vehicleId}` : `supplier=${row.supplierId}`}&limit=200`).then((d) => setDrivers(d.drivers || [])).catch(() => setDrivers([]));
  }, [row.vehicleId, row.supplierId]);
  const bad = (k: string) => miss.includes(k);
  const supOpts = sups.map((s) => ({ value: s._id, label: s.name, hint: s.type === 'freelancer' ? t('سائق فرد', 'Freelancer') : (s.phone || '') }));
  if (row.supplierId && !supOpts.some((o) => o.value === row.supplierId)) supOpts.unshift({ value: row.supplierId, label: row.supplierName || row.supplierId, hint: '' });
  return (
    <div className="rounded-2xl border border-slate-200 p-3 space-y-3">
      <div className="flex items-center gap-2">
        <span className="w-7 h-7 rounded-lg bg-[#f37121]/15 text-[#f37121] font-bold text-sm flex items-center justify-center">{i + 1}</span>
        <p className="font-bold text-slate-900 text-sm">{t('الشاحنة', 'Truck')} {i + 1}</p>
        {onRemove && <button type="button" onClick={onRemove} className="ms-auto text-slate-400 hover:text-red-600"><Trash2 className="w-4 h-4" /></button>}
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        <div className="sm:col-span-2 lg:col-span-3">
          <label className="block text-[12.5px] font-semibold mb-1 text-slate-700">{t('مسؤول التوريد — مَن جاء بالمورّد ومالك السيارة', 'Sourcing — who found the carrier and truck owner')}</label>
          <SearchableSelect value={row.sourcingRep} searchAfter={0} onChange={(v) => onChange({ sourcingRep: v })}
            placeholder={t('اختر من فرق الموردين أو المبيعات أو العمليات أو البيانات', 'Pick from vendors, sales, operations or data')}
            options={reps.map((o) => ({ value: o.value, label: o.label, hint: o.roleAr || '' }))} />
        </div>
        {/* Sales accepted these types; the vendors team states the one actually sent. */}
        {types.length > 0 && (
          <div className="sm:col-span-2 lg:col-span-3">
            <label className={`block text-[12.5px] font-semibold mb-1 ${bad('type') ? 'text-red-600' : 'text-slate-700'}`}>{t('نوع الشاحنة المنفَّذ', 'Truck type sent')}{types.length > 1 && ' *'}</label>
            <div className={`flex flex-wrap gap-1.5 ${bad('type') ? 'rounded-lg p-1 ring-2 ring-red-400/60' : ''}`}>
              {types.map((ty) => (
                <button key={ty} type="button" onClick={() => onChange({ truckType: ty })}
                  className={`rounded-lg border px-3 py-1.5 text-[12.5px] font-semibold ${row.truckType === ty ? 'border-[#f37121] bg-[#f37121] text-white' : 'border-slate-200 bg-white text-slate-700 hover:border-[#f37121]/50'}`}>{ty}</button>
              ))}
            </div>
          </div>
        )}
        <div>
          <label className={`block text-[12.5px] font-semibold mb-1 ${bad('supplier') ? 'text-red-600' : 'text-slate-700'}`}>{t('المورّد', 'Supplier')} *</label>
          <div className={bad('supplier') ? 'rounded-lg ring-2 ring-red-400/60' : ''}>
            <SearchableSelect value={row.supplierId} searchAfter={0} onSearch={searchSup} loading={supBusy}
              onChange={(v) => onChange({ supplierId: v, supplierName: sups.find((s) => s._id === v)?.name || '', vehicleId: '' })}
              placeholder={t('ابحث عن المورّد', 'Search the supplier')} options={supOpts} />
          </div>
        </div>
        <div>
          <label className={`block text-[12.5px] font-semibold mb-1 ${bad('vehicle') ? 'text-red-600' : 'text-slate-700'}`}>{t('السيارة (اللوحة)', 'Truck (plate)')} *</label>
          <div className={bad('vehicle') ? 'rounded-lg ring-2 ring-red-400/60' : ''}>
            <SearchableSelect value={row.vehicleId} searchAfter={0} onSearch={searchVeh}
              onChange={(v) => {
                const veh = vehs.find((x) => x._id === v);
                onChange({ vehicleId: v, newPlate: '', ...(veh?.defaultDriverName && !row.driverName ? { driverName: veh.defaultDriverName, driverPhone: veh.defaultDriverPhone || '' } : {}) });
              }}
              placeholder={t('اختر من سيارات المورّد', "Pick from the supplier's trucks")}
              options={vehs.map((v) => ({ value: v._id, label: v.plate, hint: [v.truckType, v.defaultDriverName].filter(Boolean).join(' · ') }))} />
          </div>
          {!row.vehicleId && <input value={row.newPlate} onChange={(e) => onChange({ newPlate: e.target.value })} placeholder={t('أو اكتب لوحةً جديدة', 'or type a new plate')} className={`${inputCls} mt-1.5`} />}
        </div>
        <div>
          <label className={`block text-[12.5px] font-semibold mb-1 ${bad('driver') ? 'text-red-600' : 'text-slate-700'}`}>{t('السائق', 'Driver')} *</label>
          <div className={bad('driver') ? 'rounded-lg ring-2 ring-red-400/60' : ''}>
            <DriverPicker value={row.driverName} ar={ar} contextDrivers={drivers} supplierId={row.supplierId} vehicleId={row.vehicleId}
              onPick={(d) => onChange({ driverName: d.name, driverPhone: d.phone || row.driverPhone })} />
          </div>
        </div>
        <div>
          <label className={`block text-[12.5px] font-semibold mb-1 ${bad('buy') ? 'text-red-600' : 'text-slate-700'}`}>{t('سعر الشراء', 'Purchase price')} *</label>
          <input type="number" min={0} value={row.buyPrice} onChange={(e) => onChange({ buyPrice: e.target.value })} className={`${inputCls} ${bad('buy') ? 'border-red-400 bg-red-50' : ''}`} />
        </div>
        <div>
          <label className="block text-[12.5px] font-semibold mb-1 text-slate-700">{t('السلفة', 'Advance')}</label>
          <input type="number" min={0} value={row.advanceAmount} onChange={(e) => onChange({ advanceAmount: e.target.value })} className={inputCls} />
        </div>
        <div className="grid grid-cols-2 gap-2">
          <div><label className="block text-[12.5px] font-semibold mb-1 text-slate-700">{t('البوليصة', 'B/L')}</label><input value={row.blNumber} onChange={(e) => onChange({ blNumber: e.target.value })} className={inputCls} /></div>
          <div><label className="block text-[12.5px] font-semibold mb-1 text-slate-700">{t('الحاوية', 'Container')}</label><input value={row.containerNumber} onChange={(e) => onChange({ containerNumber: e.target.value })} className={inputCls} /></div>
        </div>
      </div>
    </div>
  );
}

/** Reject what is still open, with a reason from the section's list (searchable, extendable in place). */
function RejectModal({ req, onClose, onDone }: { req: ShipmentRequest; onClose: () => void; onDone: () => void }) {
  const { lang } = useLanguage();
  const ar = lang === 'ar';
  const t = (a: string, e: string) => (ar ? a : e);
  const { notify } = useDialog();
  const [reason, setReason] = useState('');
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);
  const submit = async () => {
    if (!reason) { notify(t('اختر سبب الرفض', 'Pick a reason'), 'error'); return; }
    setSaving(true);
    try { await api.post(`/api/shipment-requests/${req._id}/reject`, { reason, note }); notify(t('رُفض الطلب وأُبلغ فريق المبيعات بالسبب', 'Rejected; sales was told why'), 'success'); onDone(); }
    catch (e: any) { notify(e?.message || t('تعذّر الرفض', 'Failed'), 'error'); }
    setSaving(false);
  };
  return (
    <Modal open onClose={onClose} title={t(`رفض طلب الشحنة رقم ${req.number}`, `Reject request ${req.number}`)}
      footer={<button type="button" onClick={submit} disabled={saving} className="ms-auto inline-flex items-center gap-1.5 px-5 py-2.5 rounded-xl bg-red-600 text-white text-sm font-bold disabled:opacity-50">{saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <XCircle className="w-4 h-4" />}{t('رفض الطلب', 'Reject')}</button>}>
      <div className="space-y-3">
        {!!req.placed.length && <p className="flex items-start gap-1.5 rounded-lg bg-amber-50 border border-amber-200 px-3 py-2 text-[12.5px] text-amber-800"><AlertCircle className="w-4 h-4 mt-0.5" />{t(`أُنشئ ${req.placed.length} أمرُ نقل من هذا الطلب ويبقى؛ يُرفض الباقي (${req.open}).`, `${req.placed.length} order(s) already created stay; the remaining ${req.open} are rejected.`)}</p>}
        <div>
          <label className="block text-sm font-semibold text-slate-800 mb-1.5">{t('سبب الرفض', 'Reason')} *</label>
          <SearchableManagedSelect storeLabel type="sr_reject_reason" value={reason} onChange={setReason} placeholder={t('اختر السبب أو ابحث', 'Pick or search a reason')} />
        </div>
        <div>
          <label className="block text-sm font-semibold text-slate-800 mb-1.5">{t('ملاحظة لفريق المبيعات', 'Note to sales')}</label>
          <textarea rows={3} value={note} onChange={(e) => setNote(e.target.value)} className={inputCls} placeholder={t('مثلًا: السعر المتاح في السوق 2,800 — أو التحميل بعد يومين', 'e.g. market price is 2,800')} />
        </div>
      </div>
    </Modal>
  );
}
