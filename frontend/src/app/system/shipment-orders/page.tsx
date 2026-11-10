'use client';
// Shipment orders: the trial section's main list. Everything for running the day happens here without opening each order: search by waybill or customer, change status inline, download the waybill PDF per row.
import { readUploadFiles, type UploadFile } from '@/lib/uploadFiles';
import { useState, useEffect, useCallback, useRef, Suspense, useMemo } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { useAuth } from '@/context/AuthContext';
import { ContactButtons } from '@/components/crm/CrmKit';
import { useLanguage } from '@/context/LanguageContext';
import JpTaskPanel from '@/components/jp/JpTaskPanel';
import { useSocket } from '@/hooks/useSocket';
import api from '@/lib/api';
import { useDialog } from '@/components/system/DialogProvider';
import { ColumnFilter } from '@/components/ColumnFilter';
import ColumnChooser, { useVisibleColumns } from '@/components/system/ColumnChooser';
import { Ban, PackageSearch, Plus, Pencil, Eye, FileDown, Loader2, RefreshCw, X, Check, MessageSquareText, SlidersHorizontal, Trash2 } from 'lucide-react';
import {
  Spinner, PageHeader, SearchInput, PrimaryButton, ErrorNotice,
} from '@/components/hr/HRKit';
import ExportMenu, { exportScopeLabels, type ExportColumn } from '@/components/ls2/ExportMenu';
import {
  ShipmentOrder, OrderCustomer, orderStatus, statusLabel,
  fmtDT, money, canEditOrders, canAdminOrders, canDeleteShipments, Lang, vocabLabel,
} from '@/lib/shipmentOrders';
import { isSalesUser, isVendorUser } from '@/lib/shipmentRequests';
import { useOrderStatuses } from '@/hooks/useOrderStatuses';
import { useLatestRequest } from '@/hooks/useLatestRequest';
import ScrollX from '@/components/system/ScrollX';
import TablePager, { readPageSize, savePageSize } from '@/components/system/TablePager';
import ManagedSelect from '@/components/system/ManagedSelect';
import CustomsLinkBadge from '@/components/customs/CustomsLinkBadge';
import { paymentKindLabel } from '@/lib/paymentKind';
import {
  OrderCard, ownerKindLabel, ViewSwitcher, ViewMode, VIEW_MODES, VIEW_PREF_KEY, VIEW_PREF_READ_KEY,
  followUpNotes, relTime, orderRef,
} from '@/components/shipment-orders/OrderViews';
import NoteModal from '@/components/shipment-orders/NoteModal';


// Statuses that cannot be set without a document. Mirrors `REQUIRE_FILE` on the server (shipmentOrdersController), which is the real guard; this only helps the user before they are rejected.
// Download does not call a generator: the button used to import `lib/dispatchSheetGenerator` just for the download line, pulling JSZip, pdf-lib and the whole template (hundreds of KB parsed on first click), and the waybill is now rendered on the server.
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

/** Files on a status entry: the list, or the single file older entries carry. */
const logFiles = (l: any): { fileUrl: string; fileName?: string }[] => (Array.isArray(l?.files) && l.files.length ? l.files : l?.fileUrl ? [{ fileUrl: l.fileUrl, fileName: l.fileName }] : []);
const STATUS_NEEDS_FILE = new Set(['bond_sent']);

const fmtDate = (v?: string | null) => {
  if (!v) return '';
  // The company day (Riyadh), the same day the server filters by, whatever the reader's own time zone.
  const [y, m, d] = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Riyadh' }).format(new Date(v)).split('-');
  return `${Number(d)}/${Number(m)}/${y}`;
};

// The row is no longer built here. `toSheetRow` converted the order into a waybill row for the browser to draw; drawing is now on the server from the order itself (utils/waybillPdf, rowFromOrder), so a conversion here would be a second copy of the rule that ages alone: notes, sale price and the declaration were added there and never reached this one.

// Example file name: waybill-501-customer-22-7-2026
const DEFAULT_COLS = ['reference', 'customerName', 'pickup', 'fromCity', 'toCity', 'branch', 'driverName', 'contact', 'status', 'owner', 'truck', 'plate', 'cargo', 'payment', 'sales', 'buy', 'sell', 'notes', 'followup', 'actions'];
const dayOf = (d: unknown) => (d ? new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Riyadh' }).format(new Date(String(d))) : '—');

const waybillFileName = (o: ShipmentOrder) => {
  const ref = (o as any).reference || o.waybillNumber || '';
  const parts = [o.customerName || 'عميل', (o as any).vehiclePlate, ref].filter(Boolean);
  return parts.join(' - ').replace(/[\\/:*?"<>|]/g, ' ');
};

/** Constant, so they are not rebuilt each render and the filter panel is not reset for no reason. */
const EMPTY_SET: Set<string> = new Set();
const EMPTY_OPTIONS: { value: string; count: number }[] = [];

/**
 * The filter is inherited from the URL. Dashboard cards link here, so clicking "14 late" opens those late shipments, not the whole table; the page used to start with empty filters, ending every number on the first page of tens of thousands of rows.
 * Read once at open, after which the screen holds its own state; otherwise the URL would overwrite what the user changes.
 */
function ShipmentOrdersInner() {
  const { user, refreshUser } = useAuth();
  const sp = useSearchParams();
  const { lang, isRTL } = useLanguage();
  const ar = lang === 'ar';
  const router = useRouter();
  const { confirm, notify } = useDialog();
  const editor = canEditOrders(user);

  const [orders, setOrders] = useState<ShipmentOrder[]>([]);
  const [customers, setCustomers] = useState<OrderCustomer[]>([]);
  const [otherBranches, setOtherBranches] = useState<string[]>([]);
  // The number searched is a fleet shipment or an operations report, not a shipment order.
  const [elsewhere, setElsewhere] = useState<{ kind: 'fleet' | 'operations'; number: string; customerName?: string }[]>([]);
  const [stats, setStats] = useState<{ byStatus: Record<string, number>; sellTotal: number; buyTotal: number } | null>(null);
  // Which side of the price this reader sees, as the server decided (sales: selling only; vendors team: purchase only).
  const [pv, setPv] = useState<{ sell: boolean; buy: boolean }>({ sell: true, buy: true });
  const hiddenCol = (key: string) => (!pv.buy && ['buy', 'advance', 'rent', 'margin'].includes(key)) || (!pv.sell && ['sell', 'margin'].includes(key));
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const [search, setSearch] = useState(() => sp?.get('q') || '');
  const [debounced, setDebounced] = useState(() => sp?.get('q') || '');
  // Status is picked cumulatively. "Show me late and in-transit together" is a daily question that a dropdown cannot answer, so the cards above the table are the filter, as in the platform shipments screen the team knows.
  const [statuses, setStatuses] = useState<string[]>(() => (sp?.get('status') || '').split(',').filter(Boolean));
  // Trip note: all, has a note, no note.
  const [noteFilter, setNoteFilter] = useState('');
  const statusVocab = useOrderStatuses();
  const statusFilter = statuses.join(',');
  const [excludeCancelled, setExcludeCancelled] = useState<boolean>(() => {
    try { return localStorage.getItem('shipments:excludeCancelled') === '1'; } catch { return false; }
  });
  const toggleExcludeCancelled = () => {
    const next = !excludeCancelled;
    try { localStorage.setItem('shipments:excludeCancelled', next ? '1' : '0'); } catch { /* */ }
    setExcludeCancelled(next);
    setPage(1);
  };
  const toggleStatus = (k: string) => {
    setStatuses((p) => (p.includes(k) ? p.filter((x) => x !== k) : [...p, k]));
    setPage(1);
    revealList();
  };
  /** A clickable card: filters, then scrolls down to the list. */
  const pickStatuses = (next: string[]) => { setStatuses(next); setPage(1); revealList(); };
  const revealList = () => {
    if (typeof window === 'undefined') return;
    window.requestAnimationFrame(() => listRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
  };
  // Ours or the platform's? Platform shipments carry a real manifest number that is billed against, while ours (trial for now) are prefixed with a letter. A report reader must know whether it is about real work or a trial.
  const [customerFilter, setCustomerFilter] = useState(() => sp?.get('customer') || '');
  const [fromDate, setFromDate] = useState(() => sp?.get('from') || '');
  const [toDate, setToDate] = useState(() => sp?.get('to') || '');
  // `dateBy=pickup`: the range is by pickup day, not registration day, which is how the dashboard counts, so its number opens its own rows. Cleared when the range is cleared.
  const [dateBy, setDateBy] = useState(() => (['pickup', 'created', 'activity'].includes(sp?.get('dateBy') || '') ? sp!.get('dateBy')! : 'pickup'));
  // Quick periods fill the range only; the date basis stays the one shown in the selector. They used to switch it silently to «activity», so a period showed and exported shipments whose pickup date fell outside it (moved in the period).
  const riyadhDay = (back = 0) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Riyadh' }).format(new Date(Date.now() - back * 86400000));
  const setPeriod = (from: string, to: string) => { setFromDate(from); setToDate(to); setPage(1); };
  const today = riyadhDay();
  const monthStart = `${today.slice(0, 8)}01`;
  // `customs=linked`: shipments linked to a customs file, from a dashboard card.
  const [customsOnly, setCustomsOnly] = useState(() => sp?.get('customs') === 'linked');
  const [page, setPage] = useState(1);
  // One button empties every filter on the page: search, status cards, customer, period, note, customs, cancelled and every column filter.
  const clearAllFilters = () => {
    setSearch(''); setDebounced(''); setStatuses([]); setNoteFilter(''); setCustomerFilter('');
    setFromDate(''); setToDate(''); setDateBy('pickup'); setCustomsOnly(false); setColFilters({});
    if (excludeCancelled) { try { localStorage.setItem('shipments:excludeCancelled', '0'); } catch { /* */ } setExcludeCancelled(false); }
    setPage(1);
  };
  const [pageSize, setPageSize] = useState<number>(() => readPageSize('so:pageSize'));
  const changePageSize = (n: number) => { setPageSize(n); setPage(1); savePageSize('so:pageSize', n); };

  const [busyId, setBusyId] = useState<string | null>(null);

  // Follow-up dialog: the new status and an optional note.

  const [fu, setFu] = useState<{ order: any; status: string; note: string; reason?: string } | null>(null);
  const [detail, setDetail] = useState<ShipmentOrder | null>(null);
  // ?open=<id>: a JP task link opens the shipment itself, then the param is removed from the URL.
  const openId = sp?.get('open') || '';
  useEffect(() => {
    if (!openId) return;
    api.get<{ order: ShipmentOrder }>(`/api/shipment-orders/orders/${openId}`)
      .then((r) => { if (r?.order) setDetail(r.order); })
      .catch(() => { /* Deleted or no permission: the list stays. */ });
    const q = new URLSearchParams(window.location.search);
    q.delete('open');
    router.replace(`${window.location.pathname}${q.toString() ? `?${q}` : ''}`, { scroll: false });
  }, [openId, router]);
  // The bond can be several pages or photos, so the transition takes several files.
  const [fuFiles, setFuFiles] = useState<UploadFile[]>([]);

  const openFollowUp = (o: any) => { setFuFiles([]); setFu({ order: o, status: o.status, note: '' }); };

  // A status meaning the bond was sent requires the bond file. The condition is on the server (REQUIRE_FILE in shipmentOrdersController); here the button stays disabled until attached and says why, instead of failing after a click.
  const submitFollowUp = async () => {
    if (!fu) return;
    if (STATUS_NEEDS_FILE.has(fu.status) && fu.status !== fu.order.status && !fuFiles.length) {
      notify(ar ? 'أرفق صورة السند أو ملفه أولًا.' : 'Attach the bond file first.', 'error');
      return;
    }
    // A shipment is not cancelled without a reason; the server is the guard.
    if (fu.status === 'cancelled' && fu.order.status !== 'cancelled' && !String(fu.reason || '').trim()) {
      notify(ar ? 'اختر سببَ الإلغاء.' : 'Choose the cancellation reason.', 'error');
      return;
    }
    await changeStatus(fu.order, fu.status, fu.note.trim(), fuFiles, String(fu.reason || '').trim());
    setFuFiles([]);
    setFu(null);
  };
  const [downloadingId, setDownloadingId] = useState<string | null>(null);
  // Ticked rows download as one ZIP of their waybills, named number-customer-date.
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [bulkBusy, setBulkBusy] = useState(false);
  const [bulkProgress, setBulkProgress] = useState('');

  // The view mode is saved on the account. It is read from the user (uiPrefs) so it follows them across devices, switches immediately and saves in the background. With no saved choice, follow-up users get cards (mobile first) and everyone else a table.
  const [viewLocal, setViewLocal] = useState<ViewMode | null>(null);
  const savedView = String(user?.uiPrefs?.[VIEW_PREF_READ_KEY] || '') as ViewMode;
  const view: ViewMode = viewLocal
    ?? (VIEW_MODES.includes(savedView) ? savedView : (String(user?.role || '') === 'shipment_orders_followup' ? 'cards' : 'table'));
  const changeView = (v: ViewMode) => {
    if (v === view) return;
    setViewLocal(v);
    api.patch('/api/auth/me/prefs', { key: VIEW_PREF_KEY, value: v })
      .then(() => { refreshUser().catch(() => {}); })
      .catch(() => notify(ar ? 'تعذّر حفظ طريقة العرض في حسابك — ستبقى لهذه الجلسة.' : 'Could not save the view to your account — kept for this session.', 'error'));
  };
  // Quick follow-up note, from the card or the table.
  const [noteFor, setNoteFor] = useState<ShipmentOrder | null>(null);
  // Clicking a card scrolls to the list so the in-transit rows are seen below it, not above.
  const listRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const t = setTimeout(() => { setDebounced(search); setPage(1); }, 300);
    return () => clearTimeout(t);
  }, [search]);
  useEffect(() => { setPage(1); }, [noteFilter]);

  // An older reply never overwrites a newer one; see hooks/useLatestRequest.
  const guard = useLatestRequest();
  /** Excel-style column filters. The table is paginated on the server (25 rows), so building a column list from the received rows would show this page's values only (three cities of four hundred). Values are requested from the server with counts when the funnel opens, and filtering runs there. */
  // `col_` not `col.`: the server strips dotted keys (express-mongo-sanitize).
  const COL_PREFIX = 'col_';
  // Column filters are also read from the URL (`col_<column>`), so a rep or customer number on the dashboard opens that rep's or customer's shipments.
  const [colFilters, setColFilters] = useState<Record<string, Set<string>>>(() => {
    const o: Record<string, Set<string>> = {};
    sp?.forEach((v, k) => { if (k.startsWith('col_') && v) (o[k.slice(4)] ||= new Set()).add(v); });
    return o;
  });
  const [colOptions, setColOptions] = useState<Record<string, { values: { value: string; count: number }[] }>>({});
  const [colLoading, setColLoading] = useState<Record<string, boolean>>({});
  const colSeq = useRef<Record<string, number>>({});

  /** Current page params, shared by the table, the list and the export. */
  const colParams = useCallback((into: URLSearchParams, skip?: string) => {
    if (excludeCancelled) into.set('excludeCancelled', '1');
    Object.entries(colFilters).forEach(([k, set]) => {
      if (!set.size || k === skip) return;
      // Each value is a repeated param, not comma-separated: a customer name containing a comma used to become two names matching nothing (see shipmentOrdersController.columnFilters).
      into.delete(`${COL_PREFIX}${k}`);
      set.forEach((v) => into.append(`${COL_PREFIX}${k}`, v));
    });
  }, [colFilters, excludeCancelled]);

  const setColFilter = useCallback((key: string, sel: Set<string>) => {
    setColFilters((prev) => {
      const next = { ...prev };
      if (sel.size) next[key] = sel; else delete next[key];
      return next;
    });
    setPage(1);
  }, []);

  const fetchColOptions = useCallback(async (field: string, search = '') => {
    const seq = (colSeq.current[field] || 0) + 1;
    colSeq.current[field] = seq;
    setColLoading((p) => ({ ...p, [field]: true }));
    try {
      const qs = new URLSearchParams({ field });
      // Filters of the other columns only: someone who filtered "Jeddah" under from wants to see under to only where Jeddah's shipments went, which is what Excel does.
      colParams(qs, field);
      if (statusFilter) qs.set('status', statusFilter);
      if (customerFilter) qs.set('customer', customerFilter);
      if (fromDate) qs.set('from', fromDate);
      if (toDate) qs.set('to', toDate);
      if (dateBy && (fromDate || toDate)) qs.set('dateBy', dateBy);
      if (customsOnly) qs.set('customs', 'linked');
      if (search.trim()) qs.set('search', search.trim());
      const d = await api.get<{ values: { value: string; count: number }[] }>(`/api/shipment-orders/orders/filter-options?${qs}`);
      if (colSeq.current[field] !== seq) return;   // A reply already superseded by a newer one.
      setColOptions((p) => ({ ...p, [field]: d }));
    } catch { /* The list is left as is. */ }
    finally { if (colSeq.current[field] === seq) setColLoading((p) => ({ ...p, [field]: false })); }
  }, [colParams, statusFilter, customerFilter, fromDate, toDate, dateBy, customsOnly]);

  const load = useCallback(async () => {
    const mine = guard.begin();
    try {
      const qs = new URLSearchParams({ page: String(page), limit: String(pageSize) });
      colParams(qs);
      if (debounced.trim()) qs.set('q', debounced.trim());
      if (statusFilter) qs.set('status', statusFilter);
      if (customerFilter) qs.set('customer', customerFilter);
      if (fromDate) qs.set('from', fromDate);
      if (toDate) qs.set('to', toDate);
      if (dateBy && (fromDate || toDate)) qs.set('dateBy', dateBy);
      if (customsOnly) qs.set('customs', 'linked');
      if (noteFilter) qs.set('note', noteFilter);
      const d = await api.get<{ orders: ShipmentOrder[]; total: number; stats: any }>(`/api/shipment-orders/orders?${qs}`);
      if (!guard.isCurrent(mine)) return;
      setOrders(d.orders || []);
      setTotal(d.total || 0);
      setStats(d.stats || null);
      if ((d as any).priceView) setPv((d as any).priceView);
      setOtherBranches((d as any).otherBranches || []);
      setElsewhere((d as any).elsewhere || []);
      setError('');
    } catch (e: any) { setError(e?.message || 'Request failed'); }
    setLoading(false);
  }, [debounced, statusFilter, customerFilter, fromDate, toDate, dateBy, customsOnly, noteFilter, page, pageSize, colParams, guard]);

  useEffect(() => { load(); }, [load]);
  useSocket('shipmentOrders:updated', useCallback(() => load(), [load]));
  useEffect(() => {
    api.get<{ customers: OrderCustomer[] }>('/api/shipment-orders/customers')
      .then((d) => setCustomers(d.customers || [])).catch(() => {});
  }, []);

  // The inline change: nobody needs to open an order just to mark it arrived.
  const changeStatus = async (o: ShipmentOrder, status: string, note = '', files: UploadFile[] = [], cancelReason = '') => {
    setBusyId(o._id);
    try {
      await api.patch(`/api/shipment-orders/orders/${o._id}/status`, {
        status, note, cancelReason, ...(files.length ? { files: files.map((f) => ({ dataUrl: f.dataUrl, fileName: f.fileName })) } : {}),
      });
      load();
    } catch (e: any) { notify(e.message, 'error'); }
    setBusyId(null);
  };

  // The note shows on its card at once (the record as the server returned it), then the list reloads; other screens update from the shipmentOrders:updated event the server fires.
  const onNoteSaved = (u: ShipmentOrder) => {
    if (!u?._id) return;
    const merge = (o: ShipmentOrder) => (o._id === u._id ? { ...o, statusLog: u.statusLog, status: u.status } : o);
    setOrders((p) => p.map(merge));
    setDetail((d) => (d ? merge(d) : d));
    load();
  };

  // A manifest that happened is never erased. A delete button used to remove the waybill, its number and its status history permanently. A cancelled shipment is an event that occurred, with a number given to the customer and a record to answer for, so deleting hides the fact and breaks the number sequence. To cancel, set the cancelled status: it stays readable, counted and filterable by status.

  // A single waybill is drawn where many are. It used to be built in the browser with a second template (lib/dispatchSheetTemplate) while bulk is built on the server with its own, so one sheet had two templates and anything added to one was missing from the other (notes and the declaration printed in bulk but not single). The sheet handed to the driver must be one regardless of the button.
  const downloadWaybill = async (o: ShipmentOrder) => {
    setDownloadingId(o._id);
    try {
      const blob = await api.postBlob('/api/shipment-orders/orders/waybills.pdf', { ids: [o._id] });
      downloadBlob(blob, `${waybillFileName(o)}.pdf`);
    } catch (e: any) { notify(e?.message || 'PDF failed', 'error'); }
    setDownloadingId(null);
  };

  // Each waybill is its own file: the team sends them one by one.
  const downloadPicked = async () => {
    const rows = orders.filter((o) => picked.has(o._id));
    if (!rows.length) return;
    setBulkBusy(true);
    try {
      for (let i = 0; i < rows.length; i += 1) {
        setBulkProgress(`${i + 1}/${rows.length}`);
        const blob = await api.postBlob('/api/shipment-orders/orders/waybills.pdf', { ids: [rows[i]._id] });
        downloadBlob(blob, `${waybillFileName(rows[i])}.pdf`);
        // Browsers drop downloads that fire in the same instant.
        await new Promise((r) => setTimeout(r, 350));
      }
      setPicked(new Set());
    } catch (e: any) { notify(e?.message || 'PDF failed', 'error'); }
    setBulkBusy(false);
    setBulkProgress('');
  };

  // Columns the viewer chose, kept in this browser until changed. Waybill number and
  // actions always stay.
  const HEADS: readonly (readonly [string, string | null, string])[] = [
    [ar ? 'أمر النقل' : 'Transport order', 'reference', 'reference'],
    [ar ? 'العميل' : 'Customer', 'customerName', 'customerName'],
    [ar ? 'تاريخ الاستلام' : 'Pickup date', 'pickupDay', 'pickup'],
    [ar ? 'من' : 'From', 'fromCity', 'fromCity'],
    [ar ? 'إلى' : 'To', 'toCity', 'toCity'],
    [ar ? 'الفرع' : 'Branch', 'branch', 'branch'],
    [ar ? 'السائق' : 'Driver', 'driverName', 'driverName'],
    [ar ? 'تواصل' : 'Contact', null, 'contact'],
    [ar ? 'الحالة' : 'Status', 'status', 'status'],
    [ar ? 'مالك السيارة' : 'Truck owner', 'supplierName', 'owner'],
    [ar ? 'نوع الشاحنة' : 'Truck type', 'truckType', 'truck'],
    [ar ? 'رقم الشاحنة' : 'Truck no.', 'plate', 'plate'],
    [ar ? 'طول الشاحنة' : 'Truck length', 'truckLength', 'length'],
    [ar ? 'نوع الحمولة' : 'Cargo', 'cargoType', 'cargo'],
    [ar ? 'الكمية' : 'Quantity', null, 'quantity'],
    [ar ? 'نوع الدفع' : 'Payment', 'paymentSubtype', 'payment'],
    [ar ? 'مندوب المبيعات' : 'Sales rep', 'salesRepName', 'sales'],
    [ar ? 'مسؤول التوريد' : 'Sourcing', 'sourcingRepName', 'sourcing'],
    [ar ? 'المندوب' : 'Agent', 'agentName', 'agent'],
    [ar ? 'سعر الشراء' : 'Buy', 'buyPrice', 'buy'],
    [ar ? 'سعر البيع' : 'Sell', 'sellPrice', 'sell'],
    [ar ? 'الهامش' : 'Margin', null, 'margin'],
    [ar ? 'السلفة' : 'Advance', null, 'advance'],
    [ar ? 'أجرة السائق' : 'Driver rent', null, 'rent'],
    [ar ? 'رقم البوليصة' : 'B/L no.', 'blNumber', 'bl'],
    [ar ? 'رقم الحاوية' : 'Container no.', 'containerNumber', 'container'],
    [ar ? 'وقت الانطلاق' : 'Start date', null, 'start'],
    [ar ? 'وقت الوصول' : 'Arrival date', null, 'arrival'],
    [ar ? 'جوال السائق' : 'Driver phone', null, 'phone'],
    [ar ? 'عنوان التحميل' : 'Pickup address', null, 'addrFrom'],
    [ar ? 'عنوان التسليم' : 'Delivery address', null, 'addrTo'],
    [ar ? 'ملاحظة أمر النقل' : 'Transport order note', 'notes', 'notes'],
    [ar ? 'آخر متابعة' : 'Latest follow-up', null, 'followup'],
    [ar ? 'تاريخ الإنشاء' : 'Created', null, 'created'],
    [ar ? 'إجراءات' : 'Actions', null, 'actions'],
  ];
  const chooserCols = useMemo(() => HEADS.filter(([, , key]) => !hiddenCol(key)).map(([label, , key]) => ({ key, label, locked: key === 'reference' || key === 'actions' })),
    [ar, pv]); // eslint-disable-line react-hooks/exhaustive-deps
  const { visible, setVisible, isOn: shownOn } = useVisibleColumns('so:shipments:columns', chooserCols, { defaults: DEFAULT_COLS });
  const on = (key: string) => !hiddenCol(key) && shownOn(key);
  const shownHeads = HEADS.filter(([, , key]) => key === 'reference' || key === 'actions' || on(key));

  const togglePick = (id: string) =>
    setPicked((p) => { const n = new Set(p); n.has(id) ? n.delete(id) : n.add(id); return n; });

  // The export carries what the table shows: the reference, not the raw number, plus source, supplier and branch, since the file is opened outside the system and read alone.
  const exportColumns: ExportColumn[] = [
    { header: 'Reference', key: 'reference', width: 12, transform: (v: any, r: any) => v || r?.waybillNumber || '' },
    { header: 'Customer', key: 'customerName', width: 26 },
    { header: 'Supplier', key: 'supplierName', width: 26 },
    { header: 'From', key: 'fromCity', width: 14 },
    { header: 'To', key: 'toCity', width: 14 },
    { header: 'Truck', key: 'truckType', width: 12 },
    { header: 'Plate', key: 'vehiclePlate', width: 12 },
    { header: 'Driver', key: 'driverName', width: 18 },
    { header: 'Driver phone', key: 'driverPhone', width: 14 },
    { header: 'Driver nationality', key: 'driverNationality', width: 14 },
    { header: 'Driver iqama', key: 'driverIqama', width: 14 },
    { header: 'Branch', key: 'branch', width: 12 },
    { header: 'Pickup', key: 'pickupTime', transform: (v: any) => fmtDate(v), width: 14 },
    { header: 'Created', key: 'createdAt', transform: (v: any) => fmtDate(v), width: 14 },
    { header: 'Last status change', key: 'statusLog', transform: (v: any) => { const l = Array.isArray(v) && v.length ? v[v.length - 1] : null; return l?.at ? fmtDate(l.at) : ''; }, width: 16 },
    ...(pv.sell ? [{ header: 'Sell', key: 'sellPrice', width: 10 }] : []),
    ...(pv.buy ? [{ header: 'Buy', key: 'buyPrice', width: 10 }] : []),
    ...(pv.sell && pv.buy ? [{ header: 'Margin', key: 'margin', width: 10, transform: (_v: any, r: any) => ((Number(r?.sellPrice) || 0) - (Number(r?.buyPrice) || 0)) }] : []),
    { header: 'Status', key: 'status', transform: (v: any) => statusLabel(v, 'en'), width: 14 },
    { header: 'Agent', key: 'agentName', width: 16 },
    { header: 'Sales rep', key: 'salesRepName', width: 16 },
    { header: 'Sourcing', key: 'sourcingRepName', width: 16 },
    { header: 'Note', key: 'notes', width: 30 },
  ];
  // Pagination is on the server (25 rows): filtering 200 shipments then exporting used to output only the visible page with no warning, so every range is now fetched from the server up to its limit.
  const fetchForExport = async (withFilters: boolean) => {
    const qs = new URLSearchParams({ page: '1', limit: '100000' });
    if (withFilters) {
      // Column filters are part of it: a file that differs from the screen is worse than no file.
      colParams(qs);
      if (debounced.trim()) qs.set('q', debounced.trim());
      if (statusFilter) qs.set('status', statusFilter);
      if (customerFilter) qs.set('customer', customerFilter);
      if (fromDate) qs.set('from', fromDate);
      if (toDate) qs.set('to', toDate);
      if (dateBy && (fromDate || toDate)) qs.set('dateBy', dateBy);
      if (customsOnly) qs.set('customs', 'linked');
      if (noteFilter) qs.set('note', noteFilter);
    }
    const d = await api.get<{ orders: ShipmentOrder[]; total: number }>(`/api/shipment-orders/orders?${qs}`);
    // The file states which date the range filtered on, so a pickup date outside it (activity or created basis) is explained.
    const basis = dateBy === 'activity' ? (ar ? 'حركة الشحنة (أُنشئت أو تغيّرت حالتها في الفترة)' : 'Activity (created or status changed in the period)')
      : dateBy === 'created' ? (ar ? 'تاريخ الإنشاء' : 'Created date') : (ar ? 'تاريخ الاستلام' : 'Pickup date');
    const title = withFilters && (fromDate || toDate) ? `${ar ? 'الفترة حسب' : 'Range by'} ${basis}: ${fromDate || '…'} → ${toDate || '…'}` : undefined;
    return [{ name: 'Orders', rows: d.orders || [], columns: exportColumns, title }];
  };
  const hasActiveFilters = !!(debounced.trim() || statusFilter || customerFilter || fromDate || toDate || customsOnly);
  const scope = exportScopeLabels(ar);
  const exportOptions = [
    { key: 'page', label: scope.page, sheets: [{ name: 'Orders', rows: orders, columns: exportColumns }] },
    { key: 'matching', label: hasActiveFilters ? scope.matching : scope.all, resolve: () => fetchForExport(true), hint: String(total) },
    ...(hasActiveFilters ? [{ key: 'all', label: scope.all, resolve: () => fetchForExport(false) }] : []),
  ];

  // On mobile the status strip scrolls horizontally and secondary filters sit behind a button. Eleven boxes and three cards filled the first screen so no shipment showed before a long scroll. The selected status scrolls into view in the strip.
  const [showFilters, setShowFilters] = useState(false);
  const chipStripRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const strip = chipStripRef.current;
    if (!strip || !statuses.length) return;
    const chip = strip.querySelector<HTMLElement>(`[data-chip="${statuses[statuses.length - 1]}"]`);
    if (!chip) return;
    const cr = chip.getBoundingClientRect();
    const sr = strip.getBoundingClientRect();
    // Uses the difference between the rectangles, not offsetLeft, which is correct in both directions (RTL and LTR).
    strip.scrollBy({ left: (cr.left - sr.left) - (sr.width - cr.width) / 2, behavior: 'smooth' });
  }, [statuses]);
  const secondaryActive = [noteFilter, customerFilter, fromDate, toDate].filter(Boolean).length;

  if (loading) return <Spinner />;

  return (
    <div className="space-y-3 sm:space-y-6" dir={isRTL ? 'rtl' : 'ltr'}>
      <PageHeader
        icon={<PackageSearch className="w-5 h-5" />}
        title={ar ? 'طلبات الشحنات' : 'Shipment Orders'}
        subtitle={<span className="hidden sm:inline">{ar ? 'إنشاء الشحنات ومتابعتها داخل نظامنا — قسم تجريبي مستقل' : 'Create and track shipments natively — standalone trial'}</span>}
      >
        {picked.size > 0 && (
          <button type="button" onClick={downloadPicked} disabled={bulkBusy}
            className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-semibold disabled:opacity-60">
            {bulkBusy ? <Loader2 className="w-4 h-4 animate-spin" /> : <FileDown className="w-4 h-4" />}
            {bulkBusy
              ? (ar ? `جارٍ التجهيز ${bulkProgress}…` : `Generating ${bulkProgress}…`)
              : (ar ? `تحميل ${picked.size} أمر نقل` : `Download ${picked.size} waybills`)}
          </button>
        )}
        {/* Columns sit with the page's actions in the header, so less stands between the filters and the table. */}
        {view === 'table' && <ColumnChooser columns={chooserCols} visible={visible} onChange={setVisible} ar={ar} />}
        <ExportMenu fileName="shipment-orders" lang={ar ? 'ar' : 'en'} variant="subtle" options={exportOptions} />
        {/* Sales and the vendors team create in two steps (request, then placing), so their button opens their step. */}
        {editor && isSalesUser(user) && (
          <PrimaryButton onClick={() => router.push('/system/shipment-orders/request')}>
            <Plus className="w-4 h-4" /> {ar ? 'طلب شحنة' : 'Shipment request'}
          </PrimaryButton>
        )}
        {editor && isVendorUser(user) && (
          <PrimaryButton onClick={() => router.push('/system/shipment-orders/requests')}>
            <Plus className="w-4 h-4" /> {ar ? 'الطلبات من المبيعات' : 'Requests from sales'}
          </PrimaryButton>
        )}
        {editor && !isSalesUser(user) && !isVendorUser(user) && (
          <PrimaryButton onClick={() => router.push('/system/shipment-orders/new')}>
            <Plus className="w-4 h-4" /> {ar ? 'إنشاء شحنة' : 'Create shipment'}
          </PrimaryButton>
        )}
      </PageHeader>

      {error && <ErrorNotice error={error} lang={lang} onRetry={load} />}

      {/* Status cards are the filter. The number above the name reads from afar and a click selects, several at once. Counts are computed under the other filters, not under the status, so someone who clicked late still sees how many are in transit to add them. */}
      {/* Mobile: one strip scrolled horizontally, with the same click and highlight. */}
      <div ref={chipStripRef} className="sm:hidden flex gap-2 overflow-x-auto pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        <button type="button" onClick={() => pickStatuses([])}
          className={`shrink-0 inline-flex items-center gap-1.5 rounded-full px-3 min-h-[36px] text-xs font-semibold border whitespace-nowrap ${
            statuses.length === 0 ? 'bg-slate-900 text-white border-slate-900' : 'bg-white text-slate-700 border-slate-200'}`}>
          {ar ? 'الكل' : 'All'}<span className="tabular-nums opacity-70">{total}</span>
        </button>
        {statusVocab.map((s) => {
          const on = statuses.includes(s.key);
          return (
            <button key={s.key} data-chip={s.key} type="button" onClick={() => toggleStatus(s.key)}
              className={`shrink-0 inline-flex items-center gap-1.5 rounded-full px-3 min-h-[36px] text-xs font-semibold border whitespace-nowrap ${
                on ? 'text-white border-transparent' : 'bg-white text-slate-700 border-slate-200'}`}
              style={on ? { background: s.color } : undefined}>
              <span className="w-1.5 h-1.5 rounded-full" style={{ background: on ? '#fff' : s.color }} />
              {vocabLabel(s, lang as Lang)}
              <span className="tabular-nums opacity-70">{stats?.byStatus?.[s.key] ?? 0}</span>
            </button>
          );
        })}
      </div>
      <div className="hidden sm:grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2.5">
        <button type="button" onClick={() => pickStatuses([])}
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
        <div className="hidden sm:block text-xs text-slate-500">
          {ar ? 'محدد' : 'Selected'}: {statuses.length} · {ar ? 'إجمالي' : 'total'} {total}
          <button type="button" onClick={() => { setStatuses([]); setPage(1); }} className="ms-2 text-[#f37121] hover:underline">{ar ? 'مسح' : 'clear'}</button>
        </div>
      )}

      <div className="flex flex-wrap gap-3 items-center">
        <div className="flex-1 min-w-[240px]">
          <SearchInput value={search} onChange={setSearch}
            placeholder={ar ? 'بحث برقم أمر النقل، العميل، السائق، الإقامة، الجوال، اللوحة، الهيكل، المدينة…' : 'waybill, customer, driver, iqama, phone, plate, chassis, city…'} />
        </div>
        <div className="flex items-center gap-2 w-full sm:w-auto">
          {/* Mobile: secondary filters behind a button showing how many are active. */}
          <button type="button" onClick={() => setShowFilters((v) => !v)} aria-expanded={showFilters}
            className={`sm:hidden ms-auto inline-flex items-center gap-1.5 min-h-[38px] px-3 rounded-lg border text-[13px] font-semibold ${
              showFilters || secondaryActive ? 'border-[#f37121] text-[#f37121] bg-orange-50' : 'border-slate-200 text-slate-600 bg-white'}`}>
            <SlidersHorizontal className="w-4 h-4" />
            {ar ? 'فلاتر' : 'Filters'}
            {secondaryActive > 0 && <span className="tabular-nums">{secondaryActive}</span>}
          </button>
        </div>
        <div className={`${showFilters ? 'flex flex-wrap gap-3 items-center w-full' : 'hidden'} sm:contents`}>
        {/* Shipment source: buttons rather than a dropdown, since this is asked every session; each button carries its count under the other filters, so the size is known before clicking. */}
        {/* Note filter: show shipments with a note is asked before printing, since the transport order carries the note and what will print is reviewed. */}
        {(search || statuses.length || noteFilter || customerFilter || fromDate || toDate || customsOnly || excludeCancelled || Object.keys(colFilters).length > 0) && (
          <button type="button" onClick={clearAllFilters}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-red-200 bg-red-50 text-red-700 text-sm font-semibold hover:bg-red-100">
            <X className="w-4 h-4" />{ar ? 'مسح كل الفلاتر' : 'Clear all filters'}
          </button>
        )}
        <div className="w-full flex flex-wrap gap-2">
          {([
            [ar ? 'الفرع' : 'Branch', 'branch'], [ar ? 'من' : 'From', 'fromCity'], [ar ? 'إلى' : 'To', 'toCity'],
            [ar ? 'العميل' : 'Customer', 'customerName'], [ar ? 'المورد' : 'Supplier', 'supplierName'],
            [ar ? 'السائق' : 'Driver', 'driverName'], [ar ? 'اللوحة' : 'Plate', 'plate'],
            [ar ? 'نوع الشاحنة' : 'Truck type', 'truckType'], [ar ? 'نوع الحمولة' : 'Cargo', 'cargoType'],
            [ar ? 'نوع الدفع' : 'Payment', 'paymentSubtype'], [ar ? 'مندوب المبيعات' : 'Sales rep', 'salesRepName'],
            [ar ? 'المندوب' : 'Agent', 'agentName'],
          ] as const).map(([label, col]) => {
            return (
              <ColumnFilter key={col} label={label} field={col} selected={colFilters[col] || EMPTY_SET}
                onChange={(set) => setColFilter(col, set)} onOpen={() => fetchColOptions(col)}
                onQuery={(query) => fetchColOptions(col, query)} options={colOptions[col]?.values || EMPTY_OPTIONS}
                loading={!!colLoading[col]} lang={ar ? 'ar' : 'en'}
                format={(v: any) => (v === '__blank__' ? (ar ? '(فارغ)' : '(blank)')
                  : col === 'paymentSubtype' ? (paymentKindLabel(v, ar) || String(v ?? '')) : String(v ?? ''))} />
            );
          })}
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <div className="inline-flex rounded-lg border border-slate-200 bg-white p-0.5">
            {([
              [ar ? 'اليوم' : 'Today', today, today],
              [ar ? 'أمس' : 'Yesterday', riyadhDay(1), riyadhDay(1)],
              [ar ? 'آخر 7 أيام' : '7 days', riyadhDay(6), today],
              [ar ? 'هذا الشهر' : 'This month', monthStart, today],
            ] as const).map(([label, f, t]) => {
              const on = fromDate === f && toDate === t;
              return (
                <button key={label} type="button" aria-pressed={on}
                  onClick={() => (on ? setPeriod('', '') : setPeriod(f, t))}
                  className={`px-3 py-1.5 rounded-md text-[13px] font-semibold whitespace-nowrap ${on ? 'bg-[#f37121] text-white' : 'text-slate-700 hover:bg-slate-100'}`}>
                  {label}
                </button>
              );
            })}
          </div>
          <button type="button" onClick={toggleExcludeCancelled} aria-pressed={excludeCancelled}
            title={ar ? 'يبقى مفعّلًا حتى تلغيه — الأرقام والجدول والتصدير بلا الملغاة' : 'Stays on until you turn it off'}
            className={`inline-flex items-center gap-1.5 rounded-lg border px-3 py-2 text-xs font-semibold whitespace-nowrap ${excludeCancelled ? 'border-slate-900 bg-slate-900 text-white' : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'}`}>
            {excludeCancelled ? <Check className="h-3.5 w-3.5" /> : <Ban className="h-3.5 w-3.5" />}
            {ar ? 'باستثناء الملغاة' : 'Excluding cancelled'}
          </button>
          <select value={dateBy} onChange={(e) => { setDateBy(e.target.value); setPage(1); }} title={ar ? 'نوع التاريخ' : 'Date basis'}
            className="px-2 py-2 rounded-lg border border-slate-200 bg-white text-sm text-slate-900">
            <option value="activity">{ar ? 'حركة الشحنة' : 'Activity'}</option>
            <option value="pickup">{ar ? 'تاريخ الاستلام' : 'Pickup date'}</option>
            <option value="created">{ar ? 'تاريخ الإنشاء' : 'Created date'}</option>
          </select>
          <input type="date" value={fromDate} onChange={(e) => { setFromDate(e.target.value); setPage(1); }}
            title={ar ? 'من تاريخ' : 'From'}
            className="px-3 py-2 rounded-lg border border-slate-200 bg-white text-sm text-slate-900" />
          <span className="text-slate-400 text-sm">→</span>
          <input type="date" value={toDate} onChange={(e) => { setToDate(e.target.value); setPage(1); }}
            className="px-3 py-2 rounded-lg border border-slate-200 bg-white text-sm text-slate-900" />
          {customsOnly && (
            <button type="button" onClick={() => { setCustomsOnly(false); setPage(1); }}
              className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-full bg-cyan-50 border border-cyan-200 text-cyan-800 text-[12px] font-semibold hover:bg-cyan-100"
              title={ar ? 'إزالة الفلتر' : 'Clear filter'}>
              {ar ? 'المربوطة بالتخليص' : 'Linked to customs'} <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
        </div>
      </div>

      <div ref={listRef} className="scroll-mt-4 pt-1 sm:pt-0">
      {/* Shown with no results too: the view switcher lives in it. */}
      {(
        <TablePager className="mb-2 rounded-xl border border-slate-200 bg-white px-4 py-2.5 shadow-sm"
          page={page} pageSize={pageSize} total={total} ar={ar} onPage={setPage} onPageSize={changePageSize}
          extra={<ViewSwitcher value={view} onChange={changeView} ar={ar} />} />
      )}
      {view !== 'table' ? (
        <>
          {orders.length > 0 && (
            <div className="flex items-center gap-2 mb-2 text-xs text-slate-500">
              <label className="inline-flex items-center gap-2 min-h-[40px] px-2 rounded-lg hover:bg-slate-100 cursor-pointer">
                <input type="checkbox" className="w-4 h-4 accent-[#f37121]"
                  checked={picked.size > 0 && orders.every((o) => picked.has(o._id))}
                  onChange={(e) => setPicked(e.target.checked ? new Set(orders.map((o) => o._id)) : new Set())} />
                {ar ? 'تحديد الصفحة كلّها' : 'Select this page'}
              </label>
            </div>
          )}
          {orders.length === 0 ? (
            <div className="bg-white border border-slate-200 rounded-xl text-center text-slate-500 py-14 px-4 text-sm">
              {ar ? 'لا توجد شحنات بهذا الفلتر.' : 'No shipments match this filter.'}
            </div>
          ) : (
            <div className={view === 'grid'
              ? 'grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4 gap-3'
              : 'grid grid-cols-1 lg:grid-cols-2 gap-4'}>
              {orders.map((o) => (
                <OrderCard key={o._id} order={o} compact={view === 'grid'} ar={ar} lang={lang as Lang}
                  vocab={statusVocab} editor={editor} picked={picked.has(o._id)}
                  busy={busyId === o._id} downloading={downloadingId === o._id}
                  onTogglePick={togglePick} onOpen={setDetail} onFollowUp={openFollowUp}
                  onNote={setNoteFor} onDownload={downloadWaybill}
                  onEdit={(x) => router.push(`/system/shipment-orders/new?id=${x._id}`)} />
              ))}
            </div>
          )}
        </>
      ) : (
      <ScrollX className="bg-white border border-slate-200 rounded-xl shadow-sm">
        <table className="w-full text-sm [&_tbody_td]:text-[14px] [&_tbody_td]:font-medium [&_tbody_td]:text-slate-900">
          <thead><tr className="bg-slate-900 border-b border-slate-200 text-slate-300">
            <th className="px-3 py-3 w-[44px] sticky start-0 z-10 bg-slate-900">
              <input type="checkbox" className="w-4 h-4 accent-[#f37121]"
                checked={picked.size > 0 && orders.every((o) => picked.has(o._id))}
                onChange={(e) => setPicked(e.target.checked ? new Set(orders.map((o) => o._id)) : new Set())}
                aria-label={ar ? 'تحديد الكل' : 'Select all'} />
            </th>
            {shownHeads.map(([h, col], i) => (
              <th key={i} className={`font-semibold px-4 py-3 whitespace-nowrap ${i === 0 ? 'text-center sticky start-[44px] z-10 bg-slate-900' : 'text-start'}`}>
                <span className="inline-flex items-center">
                  {h}
                  {/* Opening the funnel requests only its own column, not all ten. */}
                  {col && (
                    <ColumnFilter
                      field={col}
                      selected={colFilters[col] || EMPTY_SET}
                      onChange={(set) => setColFilter(col, set)}
                      onOpen={() => fetchColOptions(col)}
                      onQuery={(query) => fetchColOptions(col, query)}
                      options={colOptions[col]?.values || EMPTY_OPTIONS}
                      loading={!!colLoading[col]}
                      lang={ar ? 'ar' : 'en'}
                      format={(v: any) => (v === '__blank__' ? (ar ? '(فارغ)' : '(blank)')
                        : col === 'status' ? (() => { const sv = statusVocab.find((x) => x.key === v); return sv ? vocabLabel(sv, lang as Lang) : statusLabel(String(v), lang as Lang); })()
                          : col === 'pickupDay' ? String(v).split('-').reverse().join('/')
                            : col === 'paymentSubtype' ? (paymentKindLabel(v, ar) || String(v ?? ''))
                              : String(v ?? ''))} />
                  )}
                </span>
              </th>
            ))}
          </tr></thead>
          <tbody>
            {orders.length === 0 ? (
              <tr><td colSpan={shownHeads.length + 1} className="text-center text-slate-500 py-14">
                {elsewhere.length ? (
                  <span className="inline-flex flex-col items-center gap-2">
                    <span className="font-semibold text-slate-700">
                      {elsewhere.some((x) => x.kind === 'fleet')
                        ? (ar ? `الرقم ${elsewhere[0].number} ليس طلبَ شحنة؛ هو شحنةٌ من «إدارة الأسطول»${elsewhere.find((x) => x.customerName)?.customerName ? ` للعميل ${elsewhere.find((x) => x.customerName)!.customerName}` : ''}.` : `${elsewhere[0].number} is not a shipment order; it is a fleet shipment.`)
                        : (ar ? `الرقم ${elsewhere[0].number} ليس طلبَ شحنة؛ هو تقريرٌ في «سير عمل التشغيل».` : `${elsewhere[0].number} is not a shipment order; it is an operations report.`)}
                    </span>
                    {elsewhere.some((x) => x.kind === 'operations') && (
                      <Link href={`/system/operations?search=${encodeURIComponent(elsewhere[0].number)}`} className="rounded-lg bg-[#f37121] px-3 py-1.5 text-[12.5px] font-bold text-white hover:bg-[#e06010]">
                        {ar ? 'فتحه في «سير عمل التشغيل»' : 'Open in operations workflow'}
                      </Link>
                    )}
                  </span>
                ) : otherBranches.length
                  ? (ar ? `موجودة في فرع غير مفتوح لك: ${otherBranches.join('، ')}` : `Found in a branch not open to you: ${otherBranches.join(', ')}`)
                  : (ar ? 'لا توجد شحنات بعد — ابدأ من زر «إنشاء شحنة».' : 'No shipments yet — start with “Create shipment”.')}
              </td></tr>
            ) : orders.map((o) => {
              const st = orderStatus(o.status);
              // A status added by the section in its settings has no color row in code, so it is colored with its configured color instead of showing as a colorless badge.
              const sv = statusVocab.find((x) => x.key === o.status) || null;
              const pillStyle = st ? undefined : (sv ? { background: `${sv.color}1a`, color: sv.color } : undefined);
              const pillLabel = sv ? vocabLabel(sv, lang as Lang) : statusLabel(o.status, lang as Lang);
              return (
                <tr key={o._id} onClick={() => setDetail(o)}
                  className="border-b border-slate-200/70 hover:bg-slate-50 cursor-pointer">
                  <td className="px-3 py-3 w-[44px] sticky start-0 z-10 bg-white" onClick={(e) => e.stopPropagation()}>
                    <input type="checkbox" className="w-4 h-4 accent-[#f37121]"
                      checked={picked.has(o._id)} onChange={() => togglePick(o._id)}
                      aria-label={String(o.waybillNumber)} />
                  </td>
                  <td className="px-4 py-3 text-center text-slate-900 !font-extrabold !text-[15px] tabular-nums whitespace-nowrap sticky start-[44px] z-10 bg-white shadow-[inset_-1px_0_0_#e2e8f0]">
                    {(o as any).reference || o.waybillNumber}
                  </td>
                  {on('customerName') && (
                  <td className="px-4 py-3 text-slate-900 font-medium max-w-[220px] truncate" title={o.customerName}>{o.customerName || '—'}</td>
                  )}
                  {on('pickup') && (
                  <td className="px-4 py-3 text-slate-700 whitespace-nowrap tabular-nums">{dayOf(o.pickupTime)}</td>
                  )}
                  {on('fromCity') && (
                  <td className="px-4 py-3 text-slate-700 whitespace-nowrap">{o.fromCity || '—'}</td>
                  )}
                  {on('toCity') && (
                  <td className="px-4 py-3 text-slate-700 whitespace-nowrap">{o.toCity || '—'}</td>
                  )}
                  {on('branch') && (
                  <td className="px-4 py-3 text-slate-700 whitespace-nowrap">{o.branch || '—'}</td>
                  )}
                  {on('driverName') && (
                  <td className="px-4 py-3 text-slate-700 max-w-[170px] truncate" title={o.driverName || ''}>{o.driverName || '—'}</td>
                  )}
                  {on('contact') && (
                  <td className="px-4 py-3">
                    {(o.driverPhone || '').trim()
                      ? <ContactButtons
                          phone={o.driverPhone}
                          size={15}
                        />
                      : <span className="text-slate-300 text-xs">{ar ? 'لا رقم' : 'no phone'}</span>}
                  </td>
                  )}
                  {on('status') && (
                  <td className="px-4 py-3 whitespace-nowrap" onClick={(e) => e.stopPropagation()}>
                    {/* Follow-up is a status move with its reason. The dropdown moved status without asking why, and a week later nobody could say who delayed it. It now opens a dialog to choose the status and write an optional note, and shows the history of earlier transitions. */}
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
                  )}
                  {on('owner') && (
                  <td className="px-4 py-3 text-slate-700 max-w-[220px] truncate" title={(o as any).supplierName || ''}>
                    {(o as any).supplierName || '—'}
                    {ownerKindLabel((o as any).ownerKind, ar) && <span className="ms-1.5 text-[11px] font-semibold text-slate-500">({ownerKindLabel((o as any).ownerKind, ar)})</span>}
                  </td>
                  )}
                  {on('truck') && (
                  <td className="px-4 py-3 text-slate-700 whitespace-nowrap">{o.truckType || '—'}</td>
                  )}
                  {on('plate') && (
                  <td className="px-4 py-3 text-slate-700 whitespace-nowrap font-mono" dir="ltr">{(o as any).vehiclePlate || '—'}</td>
                  )}
                  {on('length') && (
                  <td className="px-4 py-3 text-slate-700 whitespace-nowrap">{o.truckLength || '—'}</td>
                  )}
                  {on('cargo') && (
                  <td className="px-4 py-3 text-slate-700 whitespace-nowrap">{o.cargoType || '—'}</td>
                  )}
                  {on('quantity') && (
                  <td className="px-4 py-3 text-slate-700 whitespace-nowrap">{o.quantity ?? '—'}</td>
                  )}
                  {on('payment') && (
                  <td className="px-4 py-3 text-slate-700 whitespace-nowrap">{paymentKindLabel((o as any).paymentSubtype, ar) || (o as any).paymentMethod || '—'}</td>
                  )}
                  {on('sales') && (
                  <td className="px-4 py-3 text-slate-700 whitespace-nowrap">{(o as any).salesRepName || '—'}</td>
                  )}
                  {on('sourcing') && (
                  <td className="px-4 py-3 text-slate-700 whitespace-nowrap">{(o as any).sourcingRepName || '—'}</td>
                  )}
                  {on('agent') && (
                  <td className="px-4 py-3 text-slate-700 whitespace-nowrap">{o.agentName || '—'}</td>
                  )}
                  {on('buy') && (
                  <td className="px-4 py-3 text-slate-700 whitespace-nowrap tabular-nums">{money(o.buyPrice)}</td>
                  )}
                  {on('sell') && (
                  <td className="px-4 py-3 text-slate-700 whitespace-nowrap tabular-nums">{money(o.sellPrice)}</td>
                  )}
                  {on('margin') && (
                  <td className="px-4 py-3 text-slate-700 whitespace-nowrap">{money((Number(o.sellPrice) || 0) - (Number(o.buyPrice) || 0))}</td>
                  )}
                  {on('advance') && (
                  <td className="px-4 py-3 text-slate-700 whitespace-nowrap">{money((o as any).advanceAmount)}</td>
                  )}
                  {on('rent') && (
                  <td className="px-4 py-3 text-slate-700 whitespace-nowrap">{money((o as any).driverRentPrice)}</td>
                  )}
                  {on('bl') && (
                  <td className="px-4 py-3 text-slate-700 whitespace-nowrap">{(o as any).blNumber || '—'}</td>
                  )}
                  {on('container') && (
                  <td className="px-4 py-3 text-slate-700 whitespace-nowrap">{(o as any).containerNumber || '—'}</td>
                  )}
                  {on('start') && (
                  <td className="px-4 py-3 text-slate-700 whitespace-nowrap">{dayOf((o as any).startTime)}</td>
                  )}
                  {on('arrival') && (
                  <td className="px-4 py-3 text-slate-700 whitespace-nowrap">{dayOf((o as any).arrivalTime)}</td>
                  )}
                  {on('phone') && (
                  <td className="px-4 py-3 text-slate-700 whitespace-nowrap"><bdi dir="ltr">{o.driverPhone || '—'}</bdi></td>
                  )}
                  {on('addrFrom') && (
                  <td className="px-4 py-3 text-slate-700 whitespace-nowrap">{(o as any).addressFrom || '—'}</td>
                  )}
                  {on('addrTo') && (
                  <td className="px-4 py-3 text-slate-700 whitespace-nowrap">{(o as any).addressTo || '—'}</td>
                  )}
                  {on('notes') && (
                  <td className="px-4 py-3 max-w-[220px]">
                    {(o.notes || '').trim()
                      ? <span className="block truncate text-[13px] text-slate-700" title={o.notes}>{o.notes}</span>
                      : <span className="text-slate-300">—</span>}
                  </td>
                  )}
                  {on('followup') && (
                  <td className="px-4 py-3 max-w-[240px]">
                    {(() => {
                      const all = followUpNotes(o);
                      const f = all[0];
                      if (!f) return <span className="text-slate-300">—</span>;
                      // All notes open from here, for edit, delete and add afterwards.
                      return (
                        <button type="button" onClick={(e) => { e.stopPropagation(); setNoteFor(o); }}
                          className="block w-full text-start rounded-md hover:bg-sky-50 -mx-1 px-1" title={`${f.note}${f.byName ? ` — ${f.byName}` : ''}`}>
                          <span className="block truncate text-[13px] text-slate-800">{f.note}</span>
                          <span className="block truncate text-[11px] text-slate-500">
                            {f.byName ? `${f.byName} · ` : ''}{relTime(f.at, ar)}
                            {all.length > 1 ? <span className="text-sky-700 font-semibold"> · {ar ? `${all.length} ملاحظات` : `${all.length} notes`}</span> : null}
                          </span>
                        </button>
                      );
                    })()}
                  </td>
                  )}
                  {on('created') && (
                  <td className="px-4 py-3 text-slate-700 whitespace-nowrap">{dayOf((o as any).createdAt)}</td>
                  )}
                  <td className="px-4 py-3" onClick={(e) => e.stopPropagation()}>
                    <div className="flex items-center justify-end gap-1">
                      {editor && (
                        <button type="button" onClick={() => setNoteFor(o)}
                          className="p-1.5 rounded-lg text-slate-500 hover:text-[#12325C] hover:bg-slate-100"
                          title={ar ? 'ملاحظة متابعة' : 'Follow-up note'}>
                          <MessageSquareText className="w-4 h-4" />
                        </button>
                      )}
                      <button type="button" onClick={() => downloadWaybill(o)} disabled={downloadingId === o._id}
                        className="p-1.5 rounded-lg text-slate-500 hover:text-[#f37121] hover:bg-slate-100 disabled:opacity-50"
                        title={ar ? 'تحميل أمر النقل PDF' : 'Download transport order PDF'}>
                        {downloadingId === o._id ? <Loader2 className="w-4 h-4 animate-spin" /> : <FileDown className="w-4 h-4" />}
                      </button>
                      {editor && (
                        <button type="button" onClick={() => router.push(`/system/shipment-orders/new?id=${o._id}`)}
                          className="p-1.5 rounded-lg text-slate-500 hover:text-blue-600 hover:bg-slate-100" title={ar ? 'تعديل' : 'Edit'}>
                          <Pencil className="w-4 h-4" />
                        </button>
                      )}
                      {/* View instead of delete. A row has fifteen columns of which the table shows only what fits and the rest were seen by opening edit, a write door opened for reading. Reading has its own door now. */}
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
      )}
      </div>

      {total > pageSize && <TablePager compact page={page} pageSize={pageSize} total={total} ar={ar} onPage={setPage} />}

      {/* Details dialog. The table shows what fits while a load has about forty fields: cities, addresses, driver and vehicle, prices, rental type and fields the section added in settings. These were read by opening the edit screen, a write door opened for reading that could save an accidental edit; reading has its own door now. */}
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
                    {ar ? 'أمر نقل' : 'Transport order'} <span className="font-mono">{(d as any).reference || d.waybillNumber}</span>
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
                    title={ar ? 'تحميل أمر النقل PDF' : 'Download transport order PDF'}>
                    {downloadingId === d._id ? <Loader2 className="w-5 h-5 animate-spin" /> : <FileDown className="w-5 h-5" />}
                  </button>
                  {editor && (
                    <button type="button" onClick={() => router.push(`/system/shipment-orders/new?id=${d._id}`)}
                      className="p-1.5 rounded-lg text-slate-500 hover:text-blue-600 hover:bg-slate-100" title={ar ? 'تعديل' : 'Edit'}>
                      <Pencil className="w-5 h-5" />
                    </button>
                  )}
                  {canDeleteShipments(user) && (
                    <button type="button" title={ar ? 'حذف الشحنة' : 'Delete shipment'}
                      onClick={async () => {
                        const no = (d as any).reference || d.waybillNumber;
                        if (!window.confirm(ar ? `حذف الشحنة ${no} نهائيًا من صفحة الشحنات وسير عمل التشغيل؟` : `Delete shipment ${no} from Shipments and the workflow?`)) return;
                        await api.delete(`/api/shipment-orders/orders/${d._id}`);
                        setDetail(null);
                        load();
                      }}
                      className="p-1.5 rounded-lg text-slate-400 hover:text-red-600 hover:bg-red-50">
                      <Trash2 className="w-5 h-5" />
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
                  <Row k={ar ? 'جنسية السائق' : 'Driver nationality'} v={(d as any).driverNationality} />
                  <Row k={ar ? 'رقم إقامة السائق' : 'Driver iqama no.'} v={(d as any).driverIqama} />
                  <Row k={ar ? 'المركبة' : 'Vehicle'} v={d.vehicleName} />
                  <Row k={ar ? 'اللوحة' : 'Plate'} v={(d as any).vehiclePlate} />
                  <Row k={ar ? 'الوسيط' : 'Agent'} v={d.agentName} />
                </Group>

                {((d as any).blNumber || (d as any).containerNumber || (d as any).customsLink?.clearance) && (
                  <Group title={ar ? 'التخليص الجمركي' : 'Customs'}>
                    <Row k={ar ? 'رقم البوليصة' : 'B/L number'} v={(d as any).blNumber} />
                    <Row k={ar ? 'رقم الحاوية' : 'Container number'} v={(d as any).containerNumber} />
                    <div className="flex gap-3 py-1.5 border-b border-slate-100 last:border-0">
                      <span className="w-40 shrink-0 text-xs text-slate-500">{ar ? 'معاملة التخليص' : 'Clearance'}</span>
                      {(d as any).customsLink?.clearance
                        ? <CustomsLinkBadge link={(d as any).customsLink} ar={ar} />
                        : <span className="text-sm text-amber-700">{ar ? 'لا توجد معاملة بهذا الرقم' : 'No clearance has this number'}</span>}
                    </div>
                  </Group>
                )}

                <Group title={ar ? 'العميل' : 'Customer'}>
                  <Row k={ar ? 'الاسم' : 'Name'} v={d.customerName} />
                  <Row k={ar ? 'الجوال' : 'Phone'} v={cust?.phone} />
                  <Row k={ar ? 'الفرع' : 'Branch'} v={d.branch} />
                  <Row k={ar ? 'أنشأها' : 'Created by'} v={typeof d.createdBy === 'object' && d.createdBy ? `${d.createdBy.firstName || ''} ${d.createdBy.lastName || ''}`.trim() : ''} />
                  <Row k={ar ? 'تاريخ الإنشاء' : 'Created at'} v={fmtDT(d.createdAt, lang as Lang)} />
                </Group>

                {/* Money figures only for those who have them; the table shows them to the same people. */}
                <Group title={ar ? 'الأجرة والدفع' : 'Fare & payment'}>
                  {pv.sell && <Row k={ar ? 'سعر البيع' : 'Selling price'} v={money(d.sellPrice)} />}
                  {pv.buy && <Row k={ar ? 'سعر الشراء' : 'Buying price'} v={money(d.buyPrice)} />}
                  <Row k={ar ? 'نوع الدفع' : 'Payment type'} v={paymentKindLabel(d.paymentSubtype, ar)} />
                  <Row k={ar ? 'نوع تأجير السائق' : 'Driver rent type'} v={d.driverRentType} />
                  {pv.buy && <Row k={ar ? 'أجرة السائق' : 'Driver rent'} v={money(d.driverRentPrice)} />}
                  <Row k={ar ? 'طريقة الدفع' : 'Payment method'} v={d.paymentMethod} />
                </Group>

                {/* Fields the section added in its settings, read by their names, not their keys. */}
                {d.customFields && Object.keys(d.customFields).length > 0 && (
                  <div className="md:col-span-2">
                    <Group title={ar ? 'حقول إضافية' : 'Extra fields'}>
                      {Object.entries(d.customFields).map(([k, v]) => <Row key={k} k={k} v={v as any} />)}
                    </Group>
                  </div>
                )}

                {/* Status history, the same shown in the follow-up dialog. */}
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
                            {logFiles(l).map((f, j) => (
                              <a key={j} href={f.fileUrl} target="_blank" rel="noreferrer"
                                className="inline-flex items-center gap-1 font-semibold text-[#f37121] hover:underline">
                                <FileDown className="w-3 h-3" />{f.fileName || (ar ? 'المرفق' : 'Attachment')}
                              </a>
                            ))}
                          </div>
                        ))}
                      </div>
                    </Group>
                  </div>
                )}
                {/* JP tasks linked to this shipment, added from here. */}
                <JpTaskPanel section="shipment-orders" kind="shipment" refId={String(d._id)} ar={ar} />
              </div>
            </div>
          </div>
        );
      })()}

      {/* Follow-up dialog. The status moves and the note is optional: written when the move has a reason (customer postponed loading, truck broke down) and left when not. The history below says who moved it, when and why. */}
      {noteFor && (
        <NoteModal order={noteFor} ar={ar} onClose={() => setNoteFor(null)} onSaved={onNoteSaved} />
      )}

      {fu && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-slate-900/50 sm:p-4" onClick={() => setFu(null)}>
          <div className="w-full sm:max-w-lg bg-white rounded-t-2xl sm:rounded-2xl shadow-xl max-h-[92vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between">
              <div className="min-w-0">
                <p className="text-lg font-bold text-slate-900">{ar ? 'تغيير الحالة' : 'Change status'}</p>
                <p className="text-sm text-slate-500 mt-0.5">
                  {ar ? 'أمر نقل' : 'Transport order'} <span className="font-mono font-bold">{orderRef(fu.order)}</span>
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
                <label className="block text-base font-bold text-slate-800 mb-2">{ar ? 'الحالة' : 'Status'}</label>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                  {statusVocab.map((s2) => {
                    const on = fu.status === s2.key;
                    return (
                      <button key={s2.key} type="button" onClick={() => setFu({ ...fu, status: s2.key })}
                        // The selected one is identified by its color; an orange ring on top competes with it.
                        className={`min-h-[48px] text-[15px] font-bold rounded-xl px-3 py-2.5 border-2 transition-colors ${
                          on ? 'text-white border-transparent' : 'bg-white text-slate-600 border-slate-200 hover:border-slate-300'}`}
                        style={on ? { background: s2.color } : undefined}>
                        {vocabLabel(s2, lang as Lang)}
                      </button>
                    );
                  })}
                </div>
              </div>

              {fu.status === 'cancelled' && fu.order.status !== 'cancelled' && (
                <div>
                  <label className="block text-sm font-semibold text-slate-800 mb-1.5">
                    {ar ? 'سبب الإلغاء' : 'Cancellation reason'}<span className="text-red-500 ms-1">*</span>
                  </label>
                  {/* From cancellation reasons in section settings; a reason not in the list is added here and appears there. */}
                  <ManagedSelect type="so_cancel_reason" storeLabel value={fu.reason || ''} onChange={(v) => setFu({ ...fu, reason: v })}
                    placeholder={ar ? 'اختر السبب' : 'Choose the reason'}
                    className="w-full px-3 py-2 rounded-lg bg-white border border-slate-200 text-sm" />
                </div>
              )}

              <div>
                <label className="block text-base font-bold text-slate-800 mb-1.5">
                  {ar ? 'ملاحظة' : 'Note'}
                  <span className="text-slate-400 text-xs font-normal ms-1.5">{ar ? '(اختياري)' : '(optional)'}</span>
                </label>
                <textarea rows={2} value={fu.note} onChange={(e) => setFu({ ...fu, note: e.target.value })}
                  placeholder={ar ? 'سببُ النقلة إن كان لها سبب…' : 'Why it moved, if there is a reason…'}
                  className="w-full px-4 py-3 rounded-xl bg-white border border-slate-300 text-base focus:outline-none focus:ring-2 focus:ring-[#f37121]/50" />
              </div>

              {/* The attachment appears when the status requires it, and is not shown otherwise since it would clutter. */}
              {STATUS_NEEDS_FILE.has(fu.status) && (
                <div>
                  <label className="block text-sm font-semibold text-slate-800 mb-1.5">
                    {ar ? 'صورة السند أو ملفه' : 'Bond file'}
                    <span className="text-red-500 ms-1">*</span>
                  </label>
                  <input type="file" multiple accept="image/*,application/pdf,.doc,.docx,.xls,.xlsx"
                    onChange={async (e) => {
                      const picked = Array.from(e.target.files || []);
                      e.target.value = '';
                      if (!picked.length) return;
                      try {
                        const read = await readUploadFiles(picked, ar);
                        setFuFiles((p) => [...p, ...read].slice(0, 10));
                      } catch (err: any) { notify(err?.message || 'Failed', 'error'); }
                    }}
                    className="block w-full text-xs text-slate-600 file:me-3 file:py-2 file:px-3 file:rounded-lg file:border-0 file:text-xs file:font-semibold file:bg-slate-100 file:text-slate-700 hover:file:bg-slate-200" />
                  {fuFiles.length > 0 ? (
                    <ul className="mt-1.5 space-y-1">
                      {fuFiles.map((f, i) => (
                        <li key={i} className="flex items-center justify-between gap-2 rounded-md bg-slate-50 px-2 py-1 text-[11.5px] text-slate-700">
                          <span className="truncate">{f.fileName} · {Math.round(f.size / 1024)}KB</span>
                          <button type="button" onClick={() => setFuFiles((p) => p.filter((_, j) => j !== i))} className="shrink-0 text-red-600 hover:underline">{ar ? 'إزالة' : 'Remove'}</button>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="text-[11px] text-slate-500 mt-1">{ar ? 'لا تُحفَظ الحالة بلا إرفاق السند — يمكن رفع أكثر من ملف.' : 'The status is not saved without the bond file — several files are allowed.'}</p>
                  )}
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
                        <div className="flex flex-wrap items-center gap-1.5 text-[13px]">
                          {h.from ? <span className="text-slate-500">{statusLabel(h.from, lang as Lang)}</span> : null}
                          {h.from ? <span className="text-slate-400">→</span> : null}
                          <span className="font-semibold text-slate-900">{statusLabel(h.to, lang as Lang)}</span>
                          <span className="ms-auto inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-white text-slate-700 font-semibold tabular-nums">
                            {fmtDT(h.at, lang as Lang)}
                          </span>
                        </div>
                        {h.note ? <p className="text-sm text-slate-800 mt-1 whitespace-pre-wrap break-words">{h.note}</p> : null}
                        {/* The attachment is read from where it was attached, not searched for elsewhere. */}
                        {logFiles(h).length > 0 && (
                          <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1">
                            {logFiles(h).map((f, j) => (
                              <a key={j} href={f.fileUrl} target="_blank" rel="noreferrer"
                                className="inline-flex items-center gap-1 text-[11.5px] font-semibold text-[#f37121] hover:underline">
                                <FileDown className="w-3 h-3" />{f.fileName || (ar ? 'المرفق' : 'Attachment')}
                              </a>
                            ))}
                          </div>
                        )}
                        {h.byName ? <p className="text-xs text-slate-500 mt-0.5">{h.byName}</p> : null}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>

            <div className="px-5 py-4 border-t border-slate-200 flex items-center justify-end gap-2">
              <button type="button" onClick={() => setFu(null)} className="min-h-[48px] px-5 text-slate-500 hover:text-slate-900 text-base">
                {ar ? 'إلغاء' : 'Cancel'}
              </button>
              <button type="button" onClick={submitFollowUp} disabled={busyId === fu.order._id}
                className="min-h-[48px] inline-flex items-center gap-1.5 px-6 rounded-xl bg-[#f37121] text-white text-base font-bold hover:bg-[#e06010] disabled:opacity-60">
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

export default function ShipmentOrdersPage() {
  // useSearchParams needs a Suspense boundary in the app router.
  return <Suspense fallback={<Spinner />}><ShipmentOrdersInner /></Suspense>;
}
