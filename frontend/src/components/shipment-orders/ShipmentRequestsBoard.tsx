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
import ShipmentRequestForm from '@/components/shipment-orders/ShipmentRequestForm';
import { PlaceModal, FleetPlaceModal, SourcingModal } from '@/components/shipment-orders/ShipmentRequestComplete';
import { PAYMENT_SUBTYPES } from '@/lib/paymentKind';
import { REQUEST_STATUS, LOG_LABEL, APPROVAL_LABEL, approvalOf, sourcingLine, canAsk, canPlace, canFleetPlace, vendorProgress, statusLabel, type ShipmentRequest, type RequestStatus } from '@/lib/shipmentRequests';
import { useColumnFilters } from '@/hooks/useColumnFilters';
import ColumnChooser, { useVisibleColumns, type ChooserColumn } from '@/components/system/ColumnChooser';
import ExportMenu, { type ExportColumn } from '@/components/ls2/ExportMenu';
import {
  Truck, MapPin, Calendar, User as UserIcon, CheckCircle2, XCircle, Send, Pencil, Undo2, Hand, Loader2, Plus, Trash2, Copy, History, Package, AlertCircle, Inbox,
  LayoutGrid, Table2, RotateCcw, SlidersHorizontal, X, Building2, ClipboardCheck,
} from 'lucide-react';

const money = (n?: number | null) => (n == null ? '—' : Number(n).toLocaleString('en-US'));
const day = (v?: string | null) => (v ? new Date(v).toLocaleDateString('en-GB') : '—');
const hhmm = (v?: string | null) => (v ? new Date(v).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }) : '');
const when = (v?: string | null) => (v ? new Date(v).toLocaleString('en-GB', { hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit' }) : '');
const inputCls = 'w-full px-3 py-2 rounded-lg bg-white border border-slate-200 text-slate-900 text-sm focus:outline-none focus:ring-2 focus:ring-[#f37121]/50';
const OPEN_ST = ['pending', 'in_progress'];
/** Open requests first, same-branch rows together (branch, then newest); finished ones after, newest first. */
const defaultOrder = (list: ShipmentRequest[]) => [...list].sort((a, b) => {
  const oa = OPEN_ST.includes(a.status) ? 0 : 1;
  const ob = OPEN_ST.includes(b.status) ? 0 : 1;
  if (oa !== ob) return oa - ob;
  if (!oa) {
    const br = (a.branch || '\uffff').localeCompare(b.branch || '\uffff', 'ar');
    if (br) return br;
  }
  return +new Date(b.createdAt) - +new Date(a.createdAt);
});

type Tab = 'open' | RequestStatus | 'all';

export type BoardMode = 'sales' | 'vendors' | 'fleet';

export default function ShipmentRequestsBoard({ mode }: { mode: BoardMode }) {
  const { user, refreshUser } = useAuth() as any;
  const { lang, isRTL } = useLanguage();
  const ar = lang === 'ar';
  const t = (a: string, e: string) => (ar ? a : e);
  const { notify, confirm } = useDialog();
  const guard = useLatestRequest();
  // The vendors and fleet boards are the working side: same list, same claim and sourcing; completion differs.
  const work = mode !== 'sales';
  const fleet = mode === 'fleet';
  const pmode: 'sales' | 'vendors' = work ? 'vendors' : 'sales';
  const [tab, setTab] = useState<Tab>(work ? 'open' : 'all');
  // The branch filter stands alone (used most) and is kept per board on this browser.
  const branchKey = `shipmentRequests:branch:${mode}`;
  const [branch, setBranchState] = useState('');
  useEffect(() => { try { setBranchState(localStorage.getItem(branchKey) || ''); } catch { /* */ } }, [branchKey]);
  const setBranch = (b: string) => { setBranchState(b); try { localStorage.setItem(branchKey, b); } catch { /* */ } };
  const [branches, setBranches] = useState<string[]>([]);
  // Every company branch with its open requests (server: branchList).
  const [branchList, setBranchList] = useState<{ name: string; open: number }[]>([]);
  const [canLead, setCanLead] = useState(false);
  const [sourcingOf, setSourcingOf] = useState<ShipmentRequest | null>(null);
  const [fleetPlacing, setFleetPlacing] = useState<ShipmentRequest | null>(null);
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
  const prefKey = `shipmentRequests.view.${fleet ? 'fleet' : mode === 'vendors' ? 'place' : 'ask'}`;
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
  const fleetPlacer = canFleetPlace(user);

  const load = useCallback(async () => {
    const my = guard.begin();
    const p = new URLSearchParams({ limit: '200' });
    if (tab === 'open') p.set('status', 'pending,in_progress');
    else if (tab !== 'all') p.set('status', tab);
    if (qd.trim()) p.set('q', qd.trim());
    if (mine) p.set(work ? 'handler' : 'mine', work ? 'me' : '1');
    if (work) p.set('view', 'work');
    if (branch) p.set('branch', branch);
    if (from) p.set('from', from);
    if (to) p.set('to', to);
    p.set('limit', '1000');
    try {
      const d = await api.get<{ requests: ShipmentRequest[]; byStatus: Record<string, number>; openTrucks: number; branches?: string[]; branchList?: { name: string; open: number }[]; can?: { lead?: boolean } }>(`/api/shipment-requests?${p}`);
      if (!guard.isCurrent(my)) return;
      setRows(d.requests || []); setByStatus(d.byStatus || {}); setOpenTrucks(d.openTrucks || 0); setError('');
      setBranches(d.branches || []); setBranchList(d.branchList || (d.branches || []).map((name) => ({ name, open: 0 }))); setCanLead(!!d.can?.lead);
    } catch (e: any) { if (guard.isCurrent(my)) setError(e?.message || t('تعذّر التحميل', 'Could not load')); }
    if (guard.isCurrent(my)) setLoading(false);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, qd, mine, mode, guard, from, to, branch, work]);
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
    const teamBody = fleet ? { team: 'fleet' } : {};
    try { await api.post(`/api/shipment-requests/${r._id}/${path}`, { ...teamBody, ...(body || {}) }); if (ok) notify(ok, 'success'); load(); }
    catch (e: any) {
      if (e?.status === 409 && path === 'claim' && await confirm({ title: t('الطلب مع زميل', 'Held by a colleague'), message: `${e.message}. ${t('هل تتولّاه بدلًا منه؟', 'Take it over?')}` })) {
        await api.post(`/api/shipment-requests/${r._id}/claim`, { ...teamBody, takeOver: true }).catch(() => {}); load();
      } else notify(e?.message || t('تعذّر التنفيذ', 'Failed'), 'error');
    }
    setBusyId('');
  };

  const counts = { open: (byStatus.pending || 0) + (byStatus.in_progress || 0), ...byStatus } as Record<string, number>;
  const all = Object.values(byStatus).reduce((s, n) => s + n, 0);
  const TABS: [Tab, string, string][] = work
    ? [['open', 'المفتوحة', 'Open'], ['pending', 'جديدة', 'New'], ['in_progress', 'قيد الإنجاز', 'In progress'], ['rejected', 'مرفوضة', 'Rejected'], ['completed', 'مكتملة', 'Completed'], ['cancelled', 'مسحوبة', 'Withdrawn'], ['all', 'الكلّ', 'All']]
    : [['all', 'كلّ طلباتي', 'All'], ['open', 'لدى الموردين', 'With vendors'], ['rejected', 'مرفوضة', 'Rejected'], ['completed', 'مكتملة', 'Completed'], ['cancelled', 'مسحوبة', 'Withdrawn']];

  // Top filters (as on the HR pages): each value list is read from the loaded rows.
  const TOP_FILTERS: { key: string; ar: string; en: string; read: (r: ShipmentRequest) => string }[] = [
    { key: 'customer', ar: 'العميل', en: 'Customer', read: (r) => r.customerName || '' },
    { key: 'salesRep', ar: 'السيلز', en: 'Sales rep', read: (r) => r.salesRepName || r.createdByName || '' },
    { key: 'handler', ar: 'مسؤول الموردين', en: 'Vendors handler', read: (r) => r.handlerName || '' },
    { key: 'progress', ar: work ? 'الإنجاز' : 'إنجاز الموردين', en: 'Progress', read: (r) => vendorProgress(r, ar, pmode).label },
    { key: 'fromCity', ar: 'من', en: 'From', read: (r) => r.fromCity || '' },
    { key: 'toCity', ar: 'إلى', en: 'To', read: (r) => r.toCity || '' },
    { key: 'truckType', ar: 'نوع الشاحنة', en: 'Truck type', read: (r) => r.truckType || '' },
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
      { key: 'status', ar: 'الحالة', en: 'Status', read: (r) => statusText(r) },
      { key: 'progress', ar: work ? 'الإنجاز' : 'إنجاز الموردين', en: 'Progress', read: (r) => vendorProgress(r, ar, pmode).label },
      { key: 'sourcing', ar: 'تحصيل السيارات', en: 'Trucks sourced', read: (r) => sourcingLine(r, ar) },
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
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ar, showSell, work]);
  const readers = useMemo(() => Object.fromEntries(COLS.map((c) => [c.key, (r: ShipmentRequest) => { const v = c.read(r); return v === null || v === undefined ? '' : String(v); }])), [COLS]);
  const cf = useColumnFilters<ShipmentRequest>(readers, topRows, ar ? 'ar' : 'en');
  const shown = useMemo(() => defaultOrder(cf.apply(topRows)), [cf, topRows]);
  const chooserCols: ChooserColumn[] = useMemo(() => COLS.map((c) => ({ key: c.key, label: ar ? c.ar : c.en, locked: c.key === 'number' })), [COLS, ar]);
  const DEFAULT_COLS = ['number', 'status', 'progress', 'sourcing', 'trucks', 'placedCount', 'openCount', 'customer', 'fromCity', 'toCity', 'truckType', 'pickup', 'sellPrice', 'salesRep', 'handler', 'orders', 'createdAt'];
  const { visible, setVisible } = useVisibleColumns(`shipmentRequests:cols:${mode}:v2`, chooserCols, { defaults: DEFAULT_COLS });
  const visCols = COLS.filter((c) => visible.includes(c.key));
  const exportCols = (cols: typeof COLS): ExportColumn[] => cols.map((c) => ({ header: ar ? c.ar : c.en, key: c.key, transform: (_v: any, r: any) => c.read(r), type: c.num ? 'number' : 'text' }));
  const exportOptions = [
    { key: 'view', label: t('المعروض بعد الفلاتر — الأعمدة الظاهرة', 'Filtered view — visible columns'), sheets: [{ name: t('طلبات الشحن', 'Requests'), rows: shown, columns: exportCols(visCols) }] },
    { key: 'sourcing', label: t('تحصيل السيارات — كلّ التسجيلات', 'Trucks sourced — all records'), sheets: [{ name: t('تحصيل السيارات', 'Sourced'), rows: shown.flatMap((r) => (r.sourcing || []).map((e) => ({ ...e, number: r.number, customerName: r.customerName, route: `${r.fromCity} ← ${r.toCity}` }))), columns: [
      { header: t('رقم الطلب', 'Request'), key: 'number', type: 'number' as const }, { header: t('العميل', 'Customer'), key: 'customerName' }, { header: t('المسار', 'Route'), key: 'route' },
      { header: t('سجّله', 'By'), key: 'byName' }, { header: t('العدد', 'Count'), key: 'count', type: 'number' as const }, { header: t('بمساعدة', 'Helped by'), key: 'helperName' },
      { header: t('التاريخ', 'Date'), key: 'at', transform: (v: any) => (v ? new Date(v).toLocaleString('en-GB') : '') }, { header: t('ملاحظة', 'Note'), key: 'note' },
    ] }] },
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
  const resetFilters = () => { setTop({}); cf.clear(); setFrom(''); setTo(''); };
  // A sales rep's request waiting on the sales manager reads as that, not as a vendors status.
  function statusText(r: ShipmentRequest) {
    const a = approvalOf(r);
    if (!work && a !== 'approved') return ar ? APPROVAL_LABEL[a].ar : APPROVAL_LABEL[a].en;
    return statusLabel(r.status, ar, pmode);
  }
  const claimLeft = (r: ShipmentRequest) => (r.claimedUntil ? Math.max(0, Math.round((+new Date(r.claimedUntil) - Date.now()) / 60000)) : null);

  // The same actions on a card and in a table row; called as a function, not mounted as a component.
  const actions = (r: ShipmentRequest, compact = false) => {
    const open = ['pending', 'in_progress'].includes(r.status);
    const mineHeld = !!r.handler && (String(r.handler) === String(user?._id) || (fleet && r.handlerTeam === 'fleet'));
    const held = !!r.handler && !mineHeld;
    const left = claimLeft(r);
    const canWork = fleet ? fleetPlacer : placer;
    const returned = approvalOf(r) === 'returned';
    return (
      <>
        {work && canWork && open && (
          <>
            {fleet
              ? <Btn primary onClick={() => setFleetPlacing(r)} icon={CheckCircle2}>{t('إكمال على سياراتنا', 'Complete on our trucks')}</Btn>
              : <Btn primary onClick={() => setPlacing(r)} icon={CheckCircle2}>{t('إكمال الشحنة', 'Complete')}</Btn>}
            {!fleet && <Btn onClick={() => setRejecting(r)} icon={XCircle} danger>{t('رفض', 'Reject')}</Btn>}
            {!r.handler || held
              ? <Btn onClick={() => act(r, 'claim', {}, t('تولّيتَ الطلب لمدّة ساعة', 'Taken for one hour'))} icon={Hand} busy={busyId === r._id}>{held ? t('تولِّيه بدلًا من زميل', 'Take over') : t('أتولّاه (ساعة)', 'Take it (1h)')}</Btn>
              : (
                <>
                  <Btn onClick={() => act(r, 'claim', {}, t('جُدِّد التولّي ساعةً', 'Renewed for one hour'))} icon={Hand} busy={busyId === r._id}>{t(`تجديد (${left ?? 0} د)`, `Renew (${left ?? 0}m)`)}</Btn>
                  <Btn onClick={() => act(r, 'release')} icon={Undo2} busy={busyId === r._id}>{t('تخلٍّ', 'Release')}</Btn>
                </>
              )}
          </>
        )}
        {work && canWork && ['pending', 'in_progress', 'completed'].includes(r.status) && (
          <Btn onClick={() => setSourcingOf(r)} icon={Truck}>{t('تحصيل السيارات', 'Sourced')}</Btn>
        )}
        {mode === 'sales' && asker && ['pending', 'in_progress', 'rejected'].includes(r.status) && approvalOf(r) !== 'rejected' && (
          <>
            {(r.status === 'rejected' || returned) && <Btn primary onClick={() => setEditing(r)} icon={Pencil}>{t('تعديل وإعادة الإرسال', 'Amend and resend')}</Btn>}
            {r.status !== 'rejected' && !returned && <Btn onClick={() => setEditing(r)} icon={Pencil}>{t('تعديل', 'Edit')}</Btn>}
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
    ...(branch ? [{ key: '__branch', label: `${t('الفرع', 'Branch')}: ${branch}`, clear: () => setBranch('') }] : []),
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
            {work ? t('التي أعمل عليها', 'Mine') : t('طلباتي أنا فقط', 'Only mine')}
          </label>
          <div className="flex-1 min-w-[220px]"><SearchInput value={q} onChange={setQ} placeholder={t('رقم الطلب، العميل، المدينة، رقم أمر النقل…', 'Request no., customer, city, order no.…')} /></div>
        </div>

        {/* Branches on their own row: every company branch with its open requests, one click to filter. */}
        <div className="flex items-center gap-2 border-t border-slate-100 bg-slate-50/60 px-3 py-2.5">
          <span className="inline-flex shrink-0 items-center gap-1.5 text-[12.5px] font-bold text-slate-700"><Building2 className="h-4 w-4 text-[#f37121]" />{t('الفرع', 'Branch')}</span>
          <div className="flex flex-1 gap-1.5 overflow-x-auto pb-0.5">
            {[{ name: '', open: branchList.reduce((a, b) => a + b.open, 0) }, ...branchList].map((b) => {
              const on = branch === b.name;
              return (
                <button key={b.name || '__all'} type="button" onClick={() => setBranch(b.name)}
                  className={`inline-flex shrink-0 items-center gap-1.5 rounded-full border px-3 py-1.5 text-[12.5px] font-bold transition ${on ? 'border-[#f37121] bg-[#f37121] text-white shadow-sm' : 'border-slate-200 bg-white text-slate-700 hover:border-[#f37121]/60'}`}>
                  {b.name || t('كلّ الفروع', 'All branches')}
                  <span className={`rounded-full px-1.5 text-[11px] tabular-nums ${on ? 'bg-white/25 text-white' : b.open ? 'bg-orange-100 text-[#c2410c]' : 'bg-slate-100 text-slate-400'}`}>{b.open}</span>
                </button>
              );
            })}
          </div>
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
            <ExportMenu fileName={work ? `shipment-requests-${mode}` : 'shipment-requests'} lang={ar ? 'ar' : 'en'} label={t('تصدير Excel', 'Export Excel')} options={exportOptions} />
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
                const vp = vendorProgress(r, ar, pmode);
                return (
                  <tr key={r._id} className={`border-t border-slate-100 hover:bg-slate-50/60 ${r.status === 'rejected' ? 'bg-red-50/40' : ''}`}>
                    {visCols.map((c) => {
                      if (c.key === 'number') return <td key={c.key} className="px-3 py-2 font-bold tabular-nums text-slate-900">{r.number}</td>;
                      if (c.key === 'status') return (
                        <td key={c.key} className="px-3 py-2">
                          <StatusText dot={!work && approvalOf(r) !== 'approved' ? 'bg-orange-400' : st.dot}>{statusText(r)}</StatusText>
                          {work && r.handlerName && OPEN_ST.includes(r.status) && <p className="text-[11px] text-slate-500 whitespace-nowrap">{r.handlerName}{r.claimedUntil ? t(` · حتى ${hhmm(r.claimedUntil)}`, ` · until ${hhmm(r.claimedUntil)}`) : ''}</p>}
                          {!work && approvalOf(r) === 'returned' && r.approvalReason && <p className="text-[11px] text-orange-700 max-w-[220px] truncate" title={r.approvalReason}>{r.approvalReason}</p>}
                        </td>
                      );
                      if (c.key === 'sourcing') return (
                        <td key={c.key} className="px-3 py-2 whitespace-nowrap">
                          <button type="button" onClick={() => setSourcingOf(r)} className={`rounded-md px-2 py-0.5 text-[12px] font-bold tabular-nums hover:bg-emerald-100 ${(r.sourced || 0) >= r.trucks ? 'bg-emerald-50 text-emerald-800' : 'bg-slate-100 text-slate-700'}`}>{sourcingLine(r, ar)}</button>
                        </td>
                      );
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
                  <StatusText dot={st.dot}>{statusText(r)}</StatusText>
                  <span className={`text-[12px] font-semibold ${vendorProgress(r, ar, pmode).tone}`}>{vendorProgress(r, ar, pmode).label}</span>
                  <button type="button" onClick={() => setSourcingOf(r)} className="rounded-md bg-slate-100 px-2 py-0.5 text-[11.5px] font-semibold text-slate-700 hover:bg-emerald-50">{t('تحصيل السيارات', 'Sourced')} {sourcingLine(r, ar)}</button>
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
                    {r.handlerName && <Chip icon={Hand}>{t('يعمل عليه', 'Handled by')}: {r.handlerName}{r.claimedUntil && OPEN_ST.includes(r.status) ? t(` · حتى ${hhmm(r.claimedUntil)}`, ` · until ${hhmm(r.claimedUntil)}`) : ''}</Chip>}
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
                  {!work && approvalOf(r) !== 'approved' && (
                    <div className="rounded-xl border border-orange-200 bg-orange-50 px-3 py-2 text-[12.5px]">
                      <p className={`font-bold flex items-center gap-1.5 ${APPROVAL_LABEL[approvalOf(r)].tone}`}><ClipboardCheck className="w-4 h-4" />{ar ? APPROVAL_LABEL[approvalOf(r)].ar : APPROVAL_LABEL[approvalOf(r)].en}</p>
                      {r.approvalReason && <p className="text-orange-800 mt-0.5">{r.approvalReason}</p>}
                      {r.approvalByName && <p className="text-orange-700/80 mt-0.5 text-[11.5px]">{r.approvalByName} · {when(r.approvalAt)}</p>}
                    </div>
                  )}
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
      {fleetPlacing && <FleetPlaceModal req={fleetPlacing} onClose={() => setFleetPlacing(null)} onDone={() => { setFleetPlacing(null); load(); }} />}
      {sourcingOf && <SourcingModal req={sourcingOf} team={fleet ? 'fleet' : 'vendors'} canLead={canLead} onClose={() => setSourcingOf(null)}
        onChanged={(nr) => { setSourcingOf(nr); setRows((p) => p.map((x) => (x._id === nr._id ? nr : x))); }} />}
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

/** Reject what is still open, with a reason from the section's list (searchable, extendable in place). */
function RejectModal({ req, onClose, onDone }: { req: ShipmentRequest; onClose: () => void; onDone: () => void }) {
  const { lang } = useLanguage();
  const ar = lang === 'ar';
  const t = (a: string, e: string) => (ar ? a : e);
  const { notify } = useDialog();
  const [reason, setReason] = useState('');
  // A reason missing from the list is typed here and joins the list on submit.
  const [typed, setTyped] = useState(false);
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);
  const submit = async () => {
    if (!reason.trim()) { notify(t('اختر سبب الرفض', 'Pick a reason'), 'error'); return; }
    setSaving(true);
    try { await api.post(`/api/shipment-requests/${req._id}/reject`, { reason: reason.trim(), note }); notify(t('رُفض الطلب وأُبلغ فريق المبيعات بالسبب', 'Rejected; sales was told why'), 'success'); onDone(); }
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
          {typed
            ? <input autoFocus value={reason} onChange={(e) => setReason(e.target.value)} className={inputCls} placeholder={t('اكتب السبب — يُضاف إلى القائمة', 'Type the reason — it joins the list')} />
            : <SearchableManagedSelect storeLabel type="sr_reject_reason" value={reason} onChange={setReason} placeholder={t('اختر السبب أو ابحث', 'Pick or search a reason')} />}
          <button type="button" onClick={() => { setTyped((v) => !v); setReason(''); }} className="mt-1.5 inline-flex items-center gap-1 text-[12.5px] font-semibold text-[#f37121] hover:underline">
            {typed ? t('الاختيار من القائمة', 'Pick from the list') : <><Plus className="w-3.5 h-3.5" />{t('سببٌ غير موجود في القائمة', 'Reason not in the list')}</>}
          </button>
        </div>
        <div>
          <label className="block text-sm font-semibold text-slate-800 mb-1.5">{t('ملاحظة لفريق المبيعات', 'Note to sales')}</label>
          <textarea rows={3} value={note} onChange={(e) => setNote(e.target.value)} className={inputCls} placeholder={t('مثلًا: السعر المتاح في السوق 2,800 — أو التحميل بعد يومين', 'e.g. market price is 2,800')} />
        </div>
      </div>
    </Modal>
  );
}
