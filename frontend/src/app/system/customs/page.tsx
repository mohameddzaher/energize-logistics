'use client';

import UpcomingPanel, { DocChecklist, type UpcomingItem } from '@/components/customs/UpcomingPanel';
import { useState, useEffect, useCallback } from 'react';
import { useDialog } from '@/components/system/DialogProvider';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/context/AuthContext';
import { useSocket } from '@/hooks/useSocket';
import api from '@/lib/api';
import { useCustomsSearch, matchesSearch } from '@/components/customs/useCustomsSearch';
import { canEditSection } from '@/lib/sections';
import { motion, AnimatePresence } from 'framer-motion';
import { Ship, Plus, Search, X, Check, Trash2, Loader2, ScrollText, Container, Car, BarChart3, MessageSquarePlus, Bell, CalendarClock, CalendarPlus, ArrowRight } from 'lucide-react';
import Link from 'next/link';
import { useLanguage } from '@/context/LanguageContext';
import { getCustomsTranslations } from '@/lib/translations';
import ExportMenu, { exportScopeLabels, type ExportColumn } from '@/components/ls2/ExportMenu';
import { SearchableSelect, Modal } from '@/components/hr/HRKit';
import ClearanceNotes from '@/components/customs/ClearanceNotes';
import ManagedSelect from '@/components/system/ManagedSelect';
import PeriodFilter from '@/components/system/PeriodFilter';
import { useColumnFilters, ClearColumnFilters } from '@/components/useColumnFilters';
import { SlidersHorizontal } from 'lucide-react';
import ScrollX from '@/components/system/ScrollX';
import { stageName } from '@/lib/customsPipeline';

/** Table row, which is less than the transaction. The server sends only what this screen reads (see `DISPLAY_FIELDS` in customsClearanceController): fields with no column or Excel cell are not sent, and empty ones are omitted instead of sent as an empty string. The full transaction is read from `/api/customs-clearance/:id`, as the notes window below does. */
interface Clearance {
  _id: string;
  refNumber: string;
  branch: 'jeddah' | 'dammam';
  stage: string;
  cancelled: boolean;
  isCompleted?: boolean;
  blNumber?: string;
  unloadingAppointment?: string;
  customerName?: string;
  shippingAgent?: string;
  port?: string;
  /** Read by the browser search box; it has no column (see DISPLAY_FIELDS). */
  invoiceNumber?: string;
  containerCount?: number;
  createdAt: string;
  periodMonth?: number;
  periodYear?: number;
  city?: string;
  declarationNumber?: string;
  costs?: { total?: number };
  returnDeadline?: string;
  returnFreeDays?: number;
  stageDone?: Record<string, boolean>;
  revenue?: { totalInvoiced?: number; clearanceFee?: number; profit?: number };
  billing?: { invoiceStatus?: string; ourInvoiceNumber?: string };
  // Only the latest note arrives with the table; the full log is inside the transaction.
  lastNote?: { text: string; byName?: string; at?: string } | null;
  notesCount?: number;
  cargoType?: 'containers' | 'vehicles';
  /** The customer invoice number if issued; the invoice status is read from it. */
  saleInvoiceNumber?: string;
  /** Invoiced but its transport invoice has not arrived; coloured red. */
  awaitingTransportInvoice?: boolean;
  /** Stage percentage and next stage, computed on the server (pipelineOf). */
  pipeline?: { percent: number; done: number; total: number; next: string };
  /** The transaction date used for filtering: paper receipt, then declaration, then its month (see txDateOf on the server). */
  date?: string;
  invoiced?: boolean;
}

const MONTH_LABELS: [string, string][] = [
  ['يناير', 'January'], ['فبراير', 'February'], ['مارس', 'March'], ['أبريل', 'April'],
  ['مايو', 'May'], ['يونيو', 'June'], ['يوليو', 'July'], ['أغسطس', 'August'],
  ['سبتمبر', 'September'], ['أكتوبر', 'October'], ['نوفمبر', 'November'], ['ديسمبر', 'December'],
];

// Badge colour follows the share of stages completed, not the position in a fixed list: stages branch, so a stage's position does not say how many remain.
function stageBadge(percent: number, cancelled: boolean) {
  if (cancelled) return 'bg-slate-500/20 text-slate-600';
  if (percent >= 100) return 'bg-green-500/20 text-green-600';
  if (percent >= 60) return 'bg-blue-500/20 text-blue-600';
  if (percent >= 25) return 'bg-amber-500/20 text-amber-700';
  return 'bg-[#f37121]/20 text-[#f37121]';
}

// Port and agent email were removed from creation at the department's request; the email lives in the agent file.
const EMPTY = {
  branch: 'jeddah', blNumber: '', customerName: '', customerParty: '',
  shippingAgent: '', agentParty: '',
  // Transaction type is chosen at creation: containers or cars, and its stages are built on it.
  cargoType: 'containers',
  containerCount: 0,
};

export default function CustomsPage() {
  const { confirm, notify } = useDialog();
  const { user } = useAuth();
  const router = useRouter();
  // Profits are for the system manager and department manager only; the server does not send them to anyone else.
  const seesMoney = ['super_admin', 'admin', 'customs_manager'].includes(user?.role || '');
  const canEdit = ['super_admin', 'admin', 'operations_manager', 'customs_manager', 'customs_officer'].includes(user?.role || '') || canEditSection((user as any)?.permissions, 'Customs'); // matrix edit grants count too
  // Deletion is for the department manager and staff, matching the route guard on the server.
  const canDelete = ['super_admin', 'admin', 'customs_manager', 'customs_officer'].includes(user?.role || '') || canEditSection((user as any)?.permissions, 'Customs');
  const { lang } = useLanguage();
  const T = getCustomsTranslations(lang);

  const [list, setList] = useState<Clearance[]>([]);
  // The transaction a table note is written for; see ClearanceNotes.
  const [noteFor, setNoteFor] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [form, setForm] = useState<any>({ ...EMPTY });
  // Party files are loaded once: lists are chosen from them, not typed.
  const [parties, setParties] = useState<{ customers: any[]; agents: any[] }>({ customers: [], agents: [] });
  useEffect(() => {
    Promise.all([
      api.get<{ parties: any[] }>('/api/customs-clearance/parties?kind=customer'),
      api.get<{ parties: any[] }>('/api/customs-clearance/parties?kind=agent'),
    ]).then(([c, a]) => setParties({ customers: c.parties || [], agents: a.parties || [] })).catch(() => {});
  }, []);
  const [saving, setSaving] = useState(false);
  // The two lists are separate. Current is the main one and upcoming opens with its button; mixing them would make every count on the screen include what has not happened yet. The upcoming page was removed: the window holds it all (see UpcomingPanel).
  const [creatingUpcoming, setCreatingUpcoming] = useState(false);
  const [alerts, setAlerts] = useState<{ count: number; days: number; items: any[]; upcoming: UpcomingItem[]; total: number }>({ count: 0, days: 2, items: [], upcoming: [], total: 0 });
  const [showAlerts, setShowAlerts] = useState(false);
  const [search, setSearch] = useState('');
  // The server answers with what the row does not carry, and the question is repeated whenever the list is re-read.
  const searchHits = useCustomsSearch(search, list);
  const [fYear, setFYear] = useState('');
  const [fMonth, setFMonth] = useState('');
  const [fInvoice, setFInvoice] = useState('');
  // Transaction status with invoicing: closed has two parts that are not mixed (invoiced, not invoiced).
  const [fState, setFState] = useState('');
  const [fReturn, setFReturn] = useState('');
  const [showFilters, setShowFilters] = useState(false);
  const cf = useColumnFilters<Clearance>();
  // Column filters that used to be read but not filterable: customer, agent, port, branch and stage are columns in front of the user, and anyone wanting to narrow the list by them had to export all and filter in Excel.
  const [fCustomer, setFCustomer] = useState('');
  const [fAgent, setFAgent] = useState('');
  const [fPort, setFPort] = useState('');
  const [fBranch, setFBranch] = useState('');
  const [fStage, setFStage] = useState('');
  const [fFrom, setFFrom] = useState('');
  const [fTo, setFTo] = useState('');
  const resetFilters = () => {
    setFState(''); setFYear(''); setFMonth(''); setFInvoice(''); setFReturn('');
    setFCustomer(''); setFAgent(''); setFPort(''); setFBranch(''); setFStage(''); setFFrom(''); setFTo('');
  };
  const activeFilters = [fState, fYear, fMonth, fInvoice, fReturn, fCustomer, fAgent, fPort, fBranch, fStage, fFrom, fTo].filter(Boolean).length;
  const ar = lang === 'ar';

  const fetchList = useCallback(async () => {
    try {
      const data = await api.get<any>('/api/customs-clearance');
      setList(data.clearances || []);
    } catch {}
    setLoading(false);
  }, []);

  // The due-soon badge: its period comes from the department settings, read on every call.
  const fetchAlerts = useCallback(async () => {
    try {
      const d = await api.get<any>('/api/customs-clearance/upcoming-alerts');
      setAlerts({ count: d.count || 0, days: d.days ?? 2, items: d.items || [], upcoming: d.upcoming || [], total: d.total || 0 });
    } catch { /* */ }
  }, []);

  useEffect(() => { fetchList(); }, [fetchList]);
  useEffect(() => { fetchAlerts(); }, [fetchAlerts]);
  useSocket('customs:created', useCallback(() => fetchList(), [fetchList]));
  // Editing an upcoming transaction (a paper marked, a date changed) does not touch the current table, so it is not fully reloaded on every mark; the window is enough (fetchAlerts below).
  useSocket('customs:updated', useCallback((d: any) => { if (!d?.clearance?.upcoming) fetchList(); }, [fetchList]));
  useSocket('customs:deleted', useCallback(() => fetchList(), [fetchList]));
  useSocket('customs:created', useCallback(() => fetchAlerts(), [fetchAlerts]));
  useSocket('customs:updated', useCallback(() => fetchAlerts(), [fetchAlerts]));

  // The notes window reads the transaction. The notes log and the old note are not in the table row, which shows the latest and the count, so the window used to open on an empty log even if the transaction had ten notes. So the transaction is read on open while the row shows immediately.
  const openNotes = useCallback(async (c: Clearance) => {
    setNoteFor(c);
    const d = await api.get<any>(`/api/customs-clearance/${c._id}`).catch(() => null);
    // A closed window is not reopened: the user may close before the reply arrives.
    if (d?.clearance) setNoteFor((cur: any) => (cur && cur._id === c._id ? d.clearance : cur));
  }, []);

  const openCreate = (upcoming = false) => {
    setCreatingUpcoming(upcoming);
    // An upcoming transaction is created with its five papers: the ones already received are marked now.
    setForm({ ...EMPTY, ...(upcoming ? { upcoming: true, expectedDate: '', documents: {} } : {}) });
    setShowModal(true);
  };

  const handleSave = async () => {
    if (creatingUpcoming && !String(form.expectedDate || '').trim()) {
      notify(ar ? 'اختر تاريخ المعاملة المتوقَّع.' : 'Pick the expected date.', 'error');
      return;
    }
    setSaving(true);
    try {
      const data = await api.post<any>('/api/customs-clearance', form);
      setShowModal(false);
      fetchList();
      fetchAlerts();
      // Upcoming stays in its window, where its papers and date are followed; a current one opens.
      if (creatingUpcoming) setShowAlerts(true);
      else if (data?.clearance?._id) router.push(`/system/customs/${data.clearance._id}`);
    } catch (e: any) { notify(e?.message || 'Failed to save', 'error'); }
    setSaving(false);
  };

  const handleDelete = async (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    if (!(await confirm(T.deleteClearance))) return;
    try { await api.delete(`/api/customs-clearance/${id}`); fetchList(); }
    catch (err: any) { notify(err?.message || 'Failed to delete', 'error'); }
  };

  const years = Array.from(new Set(list.map((c) => c.periodYear).filter(Boolean) as number[])).sort((a, b) => b - a);
  // Invoice status follows its issuing. It used to be a hand-typed field saying not invoiced for a transaction whose invoice had been issued. So one invoiced by the system is invoiced with its number, and what predates the system is read as its text.
  const invoiceState = (c: Clearance): { text: string; number: string } => {
    if (c.saleInvoiceNumber) return { text: ar ? 'مفوترة' : 'Invoiced', number: c.saleInvoiceNumber };
    return { text: (c.billing?.invoiceStatus || '').trim(), number: c.billing?.ourInvoiceNumber || '' };
  };
  const invoiceStatuses = Array.from(new Set(list.map((c) => invoiceState(c).text).filter(Boolean))).sort();
  const awaitingCount = list.filter((c) => c.awaitingTransportInvoice).length;
  const isInvoiced = (c: Clearance) => !!c.invoiced || !!c.saleInvoiceNumber;
  const stateOf = (c: Clearance) => (c.cancelled ? 'cancelled' : (c as any).upcoming ? 'upcoming'
    : c.isCompleted ? (isInvoiced(c) ? 'closedInvoiced' : 'closedNotInvoiced') : (isInvoiced(c) ? 'openInvoiced' : 'openNotInvoiced'));
  const stageText = (c: Clearance) => (c.cancelled ? T.cancelled
    : c.isCompleted ? (isInvoiced(c) ? (ar ? 'مغلقة مفوترة' : 'Closed · invoiced') : (ar ? 'مغلقة لم تُفوتَر' : 'Closed · not invoiced'))
      : c.pipeline?.next ? `${ar ? 'تنتظر' : 'Next'}: ${stageName(T.stages, c.pipeline.next, c.cargoType)}`
        : stageName(T.stages, c.stage, c.cargoType));

  // Container return status. Passing the last return date is not an administrative delay: it starts a floor-charge meter that eats the whole transaction profit. So it is computed here, not in the reader's head, and can be filtered on.
  const today = new Date().toISOString().slice(0, 10);
  const returnState = (c: Clearance): 'returned' | 'overdue' | 'due' | 'open' | 'none' => {
    if (c.stageDone?.containersReturned) return 'returned';
    const d = (c.returnDeadline || '').slice(0, 10);
    if (!d) return 'none';
    if (d < today) return 'overdue';
    const soon = new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10);
    return d <= soon ? 'due' : 'open';
  };
  const RETURN_LABEL: Record<string, [string, string]> = {
    returned: ['أُرجعت', 'Returned'], overdue: ['متأخّرة الإرجاع', 'Overdue'],
    due: ['يقترب موعدها', 'Due soon'], open: ['في المهلة', 'Within window'], none: ['بلا موعد', 'No deadline'],
  };
  const RETURN_BADGE: Record<string, string> = {
    returned: 'bg-green-500/20 text-green-700', overdue: 'bg-red-500/20 text-red-700',
    due: 'bg-amber-500/20 text-amber-700', open: 'bg-slate-200 text-slate-600', none: 'bg-slate-100 text-slate-500',
  };
  const overdueCount = list.filter((c) => returnState(c) === 'overdue').length;

  const filtered = list.filter((c) => {
    // Search over everything in the transaction: what is in the row is matched here instantly, and the rest (each container's declaration, return, disbursement requests, notes) is answered by the server.
    if (search.trim() && !matchesSearch(search, [c.refNumber, c.blNumber, c.customerName, c.shippingAgent, c.invoiceNumber, c.port,
      c.declarationNumber, c.billing?.ourInvoiceNumber, (c as any).saleInvoiceNumber, (c as any).exporterCompany, (c as any).city,
      (c as any).containerNumbers, c.lastNote?.text])
      && !searchHits?.ids.has(String(c._id))) return false;
    if (fState && (fState === 'closed' ? !c.isCompleted || c.cancelled : fState === 'open' ? c.isCompleted || c.cancelled || (c as any).upcoming : stateOf(c) !== fState)) return false;
    if (fYear && String(c.periodYear || '') !== fYear) return false;
    if (fMonth && String(c.periodMonth || '') !== fMonth) return false;
    if (fInvoice === '__none') { if (invoiceState(c).text) return false; }
    else if (fInvoice === '__awaiting') { if (!c.awaitingTransportInvoice) return false; }
    else if (fInvoice && invoiceState(c).text !== fInvoice) return false;
    if (fReturn && returnState(c) !== fReturn) return false;
    if (fCustomer && String((c as any).customerParty || '') !== fCustomer) return false;
    if (fAgent && String((c as any).agentParty || '') !== fAgent) return false;
    if (fPort && (c.port || '') !== fPort) return false;
    if (fBranch && (c.branch || '') !== fBranch) return false;
    if (fStage && (c.isCompleted || c.cancelled || (c.pipeline?.next || '') !== fStage)) return false;
    // The range is by transaction date, not entry day: imported records were all entered on one day.
    if (fFrom || fTo) {
      const d = c.date || (c.createdAt ? String(c.createdAt).slice(0, 10) : '');
      if (!d) return false;
      if (fFrom && d < fFrom) return false;
      if (fTo && d > fTo) return false;
    }
    return true;
  });

  const money = (v: any) => (Number.isFinite(Number(v)) ? Number(v) : 0);
  // Excel-style column filters, applied last on what the search and the filters above left, using the value read in the cell itself.
  const colGetters: Record<string, (c: Clearance) => any> = {
    bl: (c) => c.blNumber, ref: (c) => c.refNumber, customer: (c) => c.customerName,
    decl: (c) => c.declarationNumber || '',
    // Month, not day, so the filter list stays short and readable.
    unloading: (c) => String(c.unloadingAppointment || '').slice(0, 7),
    branch: (c) => (c.branch === 'dammam' ? T.dammam : T.jeddah),
    period: (c) => (c.periodMonth ? `${MONTH_LABELS[c.periodMonth - 1][ar ? 0 : 1]} ${c.periodYear || ''}`.trim() : (c.periodYear || '')),
    units: (c) => `${c.cargoType === 'vehicles' ? (ar ? 'سيّارات' : 'Vehicles') : (ar ? 'حاويات' : 'Containers')} · ${c.containerCount || 0}`,
    ret: (c) => RETURN_LABEL[returnState(c)][ar ? 0 : 1],
    invoice: (c) => (c.awaitingTransportInvoice ? (ar ? 'بانتظار فاتورة النقل' : 'Awaiting transport invoice') : invoiceState(c).text || (ar ? 'غير مفوترة' : 'Not invoiced')),
    stage: (c) => stageText(c),
  };
  const shownRows = cf.apply(filtered, colGetters);
  const th = (k: string, label: string) => (
    <th key={k} className="text-start text-slate-300 font-semibold px-4 py-3 whitespace-nowrap">
      <span className="inline-flex items-center gap-1">{label}{cf.header(k, filtered, colGetters[k], ar)}</span>
    </th>
  );
  const withReturn = (c: Clearance) => ({
    ...c, _returnState: RETURN_LABEL[returnState(c)][ar ? 0 : 1],
    _invoiceState: invoiceState(c).text ? `${invoiceState(c).text}${c.awaitingTransportInvoice ? (ar ? ' — بانتظار فاتورة النقل' : ' — awaiting transport invoice') : ''}` : (ar ? 'غير مفوترة' : 'Not invoiced'),
    _invoiceNumber: invoiceState(c).number || '—',
    _stage: stageText(c),
    _cargo: c.cargoType === 'vehicles' ? (ar ? 'سيّارات' : 'Vehicles') : (ar ? 'حاويات' : 'Containers'),
    _percent: `${c.pipeline?.percent ?? 0}%`,
  });

  const exportColumns: ExportColumn[] = [
    { header: T.blNumber, key: 'blNumber', width: 18, transform: (v) => v || '—' },
    { header: T.refNumber, key: 'refNumber', width: 18 },
    { header: T.customerName, key: 'customerName', width: 22, transform: (v) => v || '—' },
    { header: T.branch, key: 'branch', width: 14, transform: (v) => (v === 'dammam' ? T.dammam : T.jeddah) },
    { header: ar ? 'المدينة' : 'City', key: 'city', width: 14, transform: (v) => v || '—' },
    { header: ar ? 'الشهر' : 'Month', key: 'periodMonth', width: 12, transform: (v) => (v ? MONTH_LABELS[v - 1][ar ? 0 : 1] : '—') },
    { header: ar ? 'السنة' : 'Year', key: 'periodYear', width: 10, transform: (v) => v || '—' },
    { header: ar ? 'وكيل الشحن' : 'Shipping agent', key: 'shippingAgent', width: 20, transform: (v) => v || '—' },
    { header: ar ? 'رقم البيان' : 'Declaration no.', key: 'declarationNumber', width: 16, transform: (v) => v || '—' },
    { header: ar ? 'تاريخ التفريغ' : 'Unloading date', key: 'unloadingAppointment', width: 14, transform: (v) => (v ? String(v).slice(0, 10) : '—') },
    { header: ar ? 'نوع المعاملة' : 'Type', key: '_cargo', width: 12 },
    { header: ar ? 'العدد' : 'Units', key: 'containerCount', width: 10, transform: (v) => v || 0 },
    { header: ar ? 'إجمالي المصروفات' : 'Total costs', key: 'costs.total', width: 16, transform: money },
    { header: ar ? 'أجور التخليص' : 'Clearance fee', key: 'revenue.clearanceFee', width: 16, transform: money },
    { header: ar ? 'إجمالي الفاتورة' : 'Total invoiced', key: 'revenue.totalInvoiced', width: 16, transform: money },
    ...(seesMoney ? [{ header: ar ? 'صافي الربح' : 'Net profit', key: 'revenue.profit', width: 14, transform: money } as ExportColumn] : []),
    { header: ar ? 'أيّام السماح للإرجاع' : 'Return free days', key: 'returnFreeDays', width: 16, transform: (v) => v || '—' },
    { header: ar ? 'آخر موعد إرجاع' : 'Return deadline', key: 'returnDeadline', width: 16, transform: (v) => v || '—' },
    { header: ar ? 'حالة الإرجاع' : 'Return state', key: '_returnState', width: 16 },
    { header: ar ? 'حالة الفاتورة' : 'Invoice status', key: '_invoiceState', width: 30 },
    { header: ar ? 'رقم فاتورتنا' : 'Our invoice no.', key: '_invoiceNumber', width: 16 },
    { header: T.stage, key: '_stage', width: 36 },
    { header: ar ? 'نسبة المراحل' : 'Progress', key: '_percent', width: 12 },
  ];
  // All transactions arrive at once and the year, month, invoice status and search filters run in the browser, so someone exporting while on a single month filter would carry a file they call the year's register.
  const scope = exportScopeLabels(ar);
  const exportOptions = [
    { key: 'shown', label: scope.shown, sheets: [{ name: T.title, rows: shownRows.map(withReturn), columns: exportColumns }] },
    { key: 'all', label: scope.all, sheets: [{ name: T.title, rows: list.map(withReturn), columns: exportColumns }] },
  ];

  if (loading) {
    return (
      <div className="min-h-[60vh] flex items-center justify-center">
        <div className="w-8 h-8 border-2 border-[#f37121] border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg bg-[#f37121]/20 flex items-center justify-center">
            <Ship className="w-5 h-5 text-[#f37121]" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-slate-900">
              {T.title}
            </h1>
            <p className="text-slate-500 text-sm">
              {shownRows.length !== list.length ? `${shownRows.length} ${ar ? 'من' : 'of'} ` : ''}{list.length} {T.xTransactions}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {/* The dashboard and guide buttons were removed: analytics became a navigation page and the guide was hidden from the department. A header button to a page already in the sidebar is duplication competing with what belongs to this screen. */}
          <ExportMenu fileName="customs-clearances" lang={ar ? 'ar' : 'en'} variant="subtle" label={ar ? 'تصدير Excel' : 'Export Excel'} options={exportOptions} />

          {/* Due-soon badge: a number on a button, not a closable message; it stays in view as long as there is work, and opening it shows the list. The period comes from the department settings. */}
          <button type="button" onClick={() => setShowAlerts(true)}
            className={`relative inline-flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-semibold transition-colors ${
              alerts.count ? 'bg-amber-50 text-amber-800 hover:bg-amber-100' : 'bg-white text-slate-600 hover:bg-slate-50 border border-slate-200'}`}
            title={ar ? `المعاملات القادمة — ${alerts.count} قرُب موعدها (خلال ${alerts.days} يوم)` : `Upcoming — ${alerts.count} due within ${alerts.days} days`}>
            <Bell className="w-4 h-4" />
            <span className="hidden sm:inline">{ar ? `المعاملات القادمة (${alerts.total})` : `Upcoming (${alerts.total})`}</span>
            {alerts.count > 0 && (
              <span className="inline-flex items-center justify-center min-w-[20px] h-5 px-1 rounded-full bg-amber-500 text-white text-[11px] font-bold">
                {alerts.count}
              </span>
            )}
          </button>

          {canEdit && (
            <button type="button" onClick={() => openCreate(true)}
              className="flex items-center gap-2 px-3 py-2 rounded-lg border border-[#f37121] text-[#f37121] text-sm font-medium hover:bg-[#f37121]/10 transition-colors">
              <CalendarPlus className="w-4 h-4" /> {ar ? 'إنشاء معاملة قادمة' : 'New upcoming'}
            </button>
          )}
          {canEdit && (
            <button type="button" onClick={() => openCreate(false)} className="flex items-center gap-2 px-4 py-2 bg-[#f37121] text-white rounded-lg text-sm font-medium hover:bg-[#e06010] transition-colors">
              <Plus className="w-4 h-4" /> {T.addClearance}
            </button>
          )}
        </div>
      </div>

      {/* Search visible, filters behind a button. Eleven filters spread over two rows crowd the table the user came for, and most are not touched in one session. So search stays visible, being used every time, and the rest fold behind a button carrying the count of active ones, so they do not vanish for those who use them nor crowd those who do not. */}
      <div className="flex flex-col lg:flex-row gap-3">
        <div className="relative flex-1">
          <Search className="absolute start-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
          <input type="text" placeholder={T.searchClearance} value={search} onChange={(e) => setSearch(e.target.value)}
            className="w-full ps-10 pe-4 py-2.5 rounded-lg bg-white border border-slate-200 text-slate-900 text-sm focus:outline-none focus:ring-2 focus:ring-[#f37121]/50" />
        </div>
        <button type="button" onClick={() => setShowFilters((v) => !v)}
          className={`inline-flex items-center gap-1.5 px-4 py-2.5 rounded-lg text-sm font-semibold transition-colors ${
            activeFilters > 0 ? 'bg-[#f37121] text-white' : 'bg-white border border-slate-200 text-slate-700 hover:border-[#f37121]/50'}`}>
          <SlidersHorizontal className="w-4 h-4" />
          {ar ? 'فلتر' : 'Filter'}{activeFilters > 0 ? ` (${activeFilters})` : ''}
        </button>
        <ClearColumnFilters count={cf.count} onClear={cf.clear} ar={ar} />
        {activeFilters > 0 && (
          <button type="button" onClick={resetFilters}
            className="inline-flex items-center gap-1.5 px-3 py-2.5 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-600 text-sm">
            <X className="w-4 h-4" /> {ar ? 'مسح' : 'Clear'}
          </button>
        )}
      </div>

      {showFilters && (
      <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-sm grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
        <select value={fYear} onChange={(e) => setFYear(e.target.value)} className="cc-filter" aria-label={ar ? 'السنة' : 'Year'}>
          <option value="">{ar ? 'جميع السنوات' : 'All years'}</option>
          {years.map((y) => <option key={y} value={String(y)}>{y}</option>)}
        </select>
        <select value={fMonth} onChange={(e) => setFMonth(e.target.value)} className="cc-filter" aria-label={ar ? 'الشهر' : 'Month'}>
          <option value="">{ar ? 'جميع الأشهر' : 'All months'}</option>
          {MONTH_LABELS.map((m, i) => <option key={i} value={String(i + 1)}>{m[ar ? 0 : 1]}</option>)}
        </select>
        <select value={fState} onChange={(e) => setFState(e.target.value)} className="cc-filter" aria-label={ar ? 'حالة المعاملة' : 'Transaction state'}>
          <option value="">{ar ? 'كلّ الحالات' : 'All states'}</option>
          <option value="open">{ar ? 'مفتوحة' : 'Open'}</option>
          <option value="openNotInvoiced">{ar ? 'مفتوحة لم تُفوتَر' : 'Open · not invoiced'}</option>
          <option value="openInvoiced">{ar ? 'مفتوحة مفوترة' : 'Open · invoiced'}</option>
          <option value="closed">{ar ? 'مغلقة (الكلّ)' : 'Closed (all)'}</option>
          <option value="closedInvoiced">{ar ? 'مغلقة مفوترة' : 'Closed · invoiced'}</option>
          <option value="closedNotInvoiced">{ar ? 'مغلقة لم تُفوتَر' : 'Closed · not invoiced'}</option>
          <option value="upcoming">{ar ? 'قادمة' : 'Upcoming'}</option>
          <option value="cancelled">{ar ? 'ملغاة' : 'Cancelled'}</option>
        </select>
        <select value={fInvoice} onChange={(e) => setFInvoice(e.target.value)} className="cc-filter" aria-label={ar ? 'حالة الفاتورة' : 'Invoice status'}>
          <option value="">{ar ? 'جميع حالات الفاتورة' : 'All invoice statuses'}</option>
          {invoiceStatuses.map((s) => <option key={s} value={s}>{s}</option>)}
          <option value="__awaiting">{ar ? `مفوترة بانتظار فاتورة النقل${awaitingCount ? ` (${awaitingCount})` : ''}` : `Invoiced — awaiting transport invoice${awaitingCount ? ` (${awaitingCount})` : ''}`}</option>
          <option value="__none">{ar ? 'غير مفوترة' : 'Not invoiced'}</option>
        </select>
        <select value={fReturn} onChange={(e) => setFReturn(e.target.value)} className="cc-filter" aria-label={ar ? 'حالة الإرجاع' : 'Return state'}>
          <option value="">{ar ? 'جميع حالات الإرجاع' : 'All return states'}</option>
          {(['overdue', 'due', 'open', 'returned', 'none'] as const).map((k) => (
            <option key={k} value={k}>{RETURN_LABEL[k][ar ? 0 : 1]}{k === 'overdue' && overdueCount ? ` (${overdueCount})` : ''}</option>
          ))}
        </select>
        {/* Second row: table columns that could not be filtered before. */}
        <select value={fCustomer} onChange={(e) => setFCustomer(e.target.value)} className="cc-filter" aria-label={ar ? 'العميل' : 'Customer'}>
          <option value="">{ar ? 'جميع العملاء' : 'All customers'}</option>
          {parties.customers.map((p) => <option key={p._id} value={p._id}>{p.name}</option>)}
        </select>
        <select value={fAgent} onChange={(e) => setFAgent(e.target.value)} className="cc-filter" aria-label={ar ? 'وكيل الشحن' : 'Agent'}>
          <option value="">{ar ? 'جميع الوكلاء' : 'All agents'}</option>
          {parties.agents.map((p) => <option key={p._id} value={p._id}>{p.name}</option>)}
        </select>
        <select value={fPort} onChange={(e) => setFPort(e.target.value)} className="cc-filter" aria-label={ar ? 'الميناء' : 'Port'}>
          <option value="">{ar ? 'جميع الموانئ' : 'All ports'}</option>
          {[...new Set(list.map((c) => c.port).filter(Boolean) as string[])].map((v) => <option key={v} value={v}>{v}</option>)}
        </select>
        <select value={fBranch} onChange={(e) => setFBranch(e.target.value)} className="cc-filter" aria-label={ar ? 'الفرع' : 'Branch'}>
          <option value="">{ar ? 'جميع الفروع' : 'All branches'}</option>
          <option value="jeddah">{T.jeddah}</option>
          <option value="dammam">{T.dammam}</option>
        </select>
        <select value={fStage} onChange={(e) => setFStage(e.target.value)} className="cc-filter" aria-label={ar ? 'المرحلة' : 'Stage'}>
          <option value="">{ar ? 'جميع المراحل' : 'All stages'}</option>
          {[...new Set(list.map((c) => c.pipeline?.next).filter(Boolean) as string[])].map((v) => (
            <option key={v} value={v}>{`${ar ? 'تنتظر' : 'Next'}: ${(T.stages as any)?.[v] || v}`}</option>
          ))}
        </select>
        <div className="sm:col-span-2 lg:col-span-4 flex items-center gap-2">
          <span className="text-[12px] font-bold text-slate-600">{ar ? 'المدّة (بتاريخ المعاملة):' : 'Period (transaction date):'}</span>
          <PeriodFilter ar={ar} from={fFrom} to={fTo} onChange={(a, b) => { setFFrom(a); setFTo(b); }} />
        </div>
      </div>
      )}

      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden shadow-sm">
        <ScrollX>
          <table className="w-full text-sm min-w-[1380px]">
            <thead>
              <tr className="bg-slate-900">
                {/* Waybill number before the transaction number: it identifies the transaction in the department. */}
                {th('bl', T.blNumber)}
                {th('ref', T.refNumber)}
                {th('customer', T.customerName)}
                {th('decl', ar ? 'رقم البيان' : 'Declaration no.')}
                {th('unloading', ar ? 'تاريخ التفريغ' : 'Unloading date')}
                {th('branch', T.branch)}
                {th('period', ar ? 'الفترة' : 'Period')}
                {th('units', ar ? 'الحاويات / السيّارات' : 'Units')}
                <th className="text-start text-slate-300 font-semibold px-4 py-3">{ar ? 'إجمالي الفاتورة' : 'Invoiced'}</th>
                {th('ret', ar ? 'الإرجاع' : 'Return')}
                {th('invoice', ar ? 'حالة الفاتورة' : 'Invoice status')}
                {th('stage', T.stage)}
                <th className="text-start text-slate-300 font-semibold px-4 py-3">{ar ? 'ملاحظات' : 'Notes'}</th>
                {canDelete && <th className="text-end text-slate-300 font-semibold px-4 py-3">{T.actions}</th>}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200">
              {shownRows.length === 0 ? (
                <tr><td colSpan={canDelete ? 14 : 13} className="text-center text-slate-800 py-12">{T.noClearances}</td></tr>
              ) : shownRows.map((c) => (
                <tr key={c._id} onClick={() => router.push(`/system/customs/${c._id}`)}
                  className="bg-white hover:bg-slate-50 transition-colors cursor-pointer">
                  <td className="px-4 py-3 text-slate-900 font-semibold">{c.blNumber || '—'}</td>
                  <td className="px-4 py-3 text-slate-600">{c.refNumber}</td>
                  <td className="px-4 py-3 text-slate-700">{c.customerName || '—'}</td>
                  <td className="px-4 py-3 text-slate-700 whitespace-nowrap"><bdi>{c.declarationNumber || '—'}</bdi></td>
                  <td className="px-4 py-3 text-slate-700 whitespace-nowrap">{c.unloadingAppointment ? String(c.unloadingAppointment).slice(0, 10).split('-').reverse().join('/') : '—'}</td>
                  <td className="px-4 py-3 text-slate-700">{c.branch === 'dammam' ? T.dammam : T.jeddah}</td>
                  <td className="px-4 py-3 text-slate-700 whitespace-nowrap">
                    {c.periodMonth ? `${MONTH_LABELS[c.periodMonth - 1][ar ? 0 : 1]} ${c.periodYear || ''}`.trim() : (c.periodYear || '—')}
                  </td>
                  <td className="px-4 py-3 text-slate-700">
                    <span className="inline-flex items-center gap-1" title={c.cargoType === 'vehicles' ? (ar ? 'سيّارات' : 'Vehicles') : (ar ? 'حاويات' : 'Containers')}>
                      {c.cargoType === 'vehicles' ? <Car className="w-3.5 h-3.5 text-slate-700" /> : <Container className="w-3.5 h-3.5 text-slate-700" />}{c.containerCount || 0}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-slate-700 whitespace-nowrap">
                    {money(c.revenue?.totalInvoiced) ? money(c.revenue?.totalInvoiced).toLocaleString('en-US', { maximumFractionDigits: 2 }) : '—'}
                  </td>
                  <td className="px-4 py-3 whitespace-nowrap">
                    <span className={`px-2 py-1 rounded-full text-xs font-medium ${RETURN_BADGE[returnState(c)]}`} title={c.returnDeadline || ''}>
                      {RETURN_LABEL[returnState(c)][ar ? 0 : 1]}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    {/* Invoiced but its transport invoice has not arrived: red until attached. */}
                    {c.awaitingTransportInvoice
                      ? (
                        <span className="inline-flex flex-col items-start gap-0.5">
                          <span className="px-2 py-1 rounded-full text-xs font-bold bg-red-600 text-white whitespace-nowrap">{ar ? 'بانتظار فاتورة النقل' : 'Awaiting transport invoice'}</span>
                          <span className="text-[11px] text-slate-500 whitespace-nowrap">{ar ? 'مفوترة' : 'Invoiced'} · <bdi>{c.saleInvoiceNumber}</bdi></span>
                        </span>
                      )
                      : invoiceState(c).text
                        ? <span className="px-2 py-1 rounded-full text-xs font-medium bg-green-500/20 text-green-700 whitespace-nowrap">{invoiceState(c).text}{c.saleInvoiceNumber ? <> · <bdi>{c.saleInvoiceNumber}</bdi></> : null}</span>
                        : <span className="px-2 py-1 rounded-full text-xs font-medium bg-slate-200 text-slate-600 whitespace-nowrap">{ar ? 'غير مفوترة' : 'Not invoiced'}</span>}
                  </td>
                  <td className="px-4 py-3">
                    {/* Closed precedes the stage: a closed transaction has left the procedure cycle. For an open one, the stage it waits on and the percentage done are shown, not the last thing marked. */}
                    <span className={`inline-block max-w-[15rem] truncate align-middle px-2 py-1 rounded-full text-xs font-medium ${
                      c.isCompleted && !c.cancelled ? 'bg-green-500/20 text-green-700' : stageBadge(c.pipeline?.percent ?? 0, c.cancelled)}`}
                      title={stageText(c)}>
                      {stageText(c)}
                    </span>
                    {!c.cancelled && !c.isCompleted && (
                      <span className="ms-1.5 text-[11px] tabular-nums text-slate-400">{c.pipeline?.percent ?? 0}%</span>
                    )}
                  </td>
                  {/* Last note, written from here: a column showing the latest thing said about the transaction without opening it, and a button that writes a new note in place. The full log is inside the transaction. */}
                  <td className="px-4 py-3 max-w-[280px]" onClick={(e) => e.stopPropagation()}>
                    <button type="button" onClick={() => openNotes(c)} disabled={!canEdit}
                      title={canEdit ? (ar ? 'اضغط لإضافة ملاحظة' : 'Click to add a note') : ''}
                      className="w-full text-start group/note disabled:cursor-default">
                      {c.lastNote?.text ? (
                        <>
                          <span className="block truncate text-[13px] text-slate-700 group-hover/note:text-[#f37121]">{c.lastNote.text}</span>
                          <span className="block text-[11px] text-slate-400 truncate">
                            {c.lastNote.byName || ''}{(c.notesCount || 0) > 1 ? ` · ${ar ? `${c.notesCount} ملاحظات` : `${c.notesCount} notes`}` : ''}
                          </span>
                        </>
                      ) : (
                        <span className="inline-flex items-center gap-1 text-[12px] text-slate-400 group-hover/note:text-[#f37121]">
                          <MessageSquarePlus className="w-3.5 h-3.5" />{ar ? 'أضف ملاحظة' : 'Add note'}
                        </span>
                      )}
                    </button>
                  </td>
                  {canDelete && (
                    <td className="px-4 py-3 text-end">
                      <button type="button" onClick={(e) => handleDelete(e, c._id)} className="p-1.5 rounded-lg text-slate-700 hover:text-red-600 hover:bg-slate-100 transition-colors" title={T.delete}>
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </ScrollX>
      </div>

      {/* Create modal */}
      <AnimatePresence>
        {showAlerts && (
          <UpcomingPanel items={alerts.upcoming} days={alerts.days} canEdit={canEdit} canDelete={canDelete} ar={ar} notify={notify} confirm={confirm}
            onClose={() => setShowAlerts(false)} onChanged={(full) => { fetchAlerts(); if (full) fetchList(); }} />
        )}

        {showModal && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm" onClick={() => setShowModal(false)}>
            <motion.div initial={{ opacity: 0, scale: 0.95, y: 20 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0, scale: 0.95, y: 20 }}
              onClick={(e) => e.stopPropagation()} className="w-full max-w-lg bg-slate-50 border border-slate-200 rounded-2xl shadow-xl overflow-hidden">
              <div className="px-6 py-4 bg-slate-900 flex items-center justify-between">
                <h2 className="text-white font-bold text-lg">
                  {creatingUpcoming ? (ar ? 'إنشاء معاملة قادمة' : 'New upcoming transaction') : T.addClearance}
                </h2>
                <button type="button" onClick={() => setShowModal(false)} className="text-slate-300 hover:text-white" aria-label={T.close}><X className="w-5 h-5" /></button>
              </div>
              <div className="p-6 grid grid-cols-1 sm:grid-cols-2 gap-4 max-h-[70vh] overflow-y-auto">
                <Field label={T.branch}>
                  <select value={form.branch} onChange={(e) => setForm((f: any) => ({ ...f, branch: e.target.value }))} className="cc-input">
                    <option value="jeddah">{T.jeddah}</option>
                    <option value="dammam">{T.dammam}</option>
                  </select>
                </Field>
                {/* The clearance-agent field was removed. Who created the transaction is recorded in the audit log and in `createdBy`, so asking in the form requests what is known and invites wrong entry. */}
                <Field label={T.blNumber}><input className="cc-input" value={form.blNumber} onChange={(e) => setForm((f: any) => ({ ...f, blNumber: e.target.value }))} /></Field>
                {/* Customer and agent are chosen from their files. They used to be free text: one name typed in two forms became two parties in analytics, and it was unknown how many times we dealt with this customer. The email comes from the agent's file instead of being typed from memory. */}
                <Field label={T.customerName}>
                  <SearchableSelect value={form.customerParty || ''} searchAfter={0}
                    onChange={(v) => setForm((f: any) => ({ ...f, customerParty: v, customerName: (parties.customers.find((p) => p._id === v) || {}).name || '' }))}
                    placeholder={ar ? 'اختر العميل — اكتب للبحث…' : 'Pick customer — type to search…'}
                    searchPlaceholder={ar ? 'اكتب اسم العميل…' : 'Type customer name…'}
                    emptyLabel={ar ? 'لا نتائج — أضِفه من صفحة العملاء' : 'No match — add from customers page'}
                    options={parties.customers.map((p) => ({ value: p._id, label: p.name }))} />
                </Field>
                <Field label={T.shippingAgent}>
                  <SearchableSelect value={form.agentParty || ''} searchAfter={0}
                    onChange={(v) => {
                      const a = parties.agents.find((p) => p._id === v);
                      // The agent's email is taken from their file, with no field to type.
                      setForm((f: any) => ({ ...f, agentParty: v, shippingAgent: a?.name || '', shippingAgentEmail: a?.email || '' }));
                    }}
                    placeholder={ar ? 'اختر الوكيل — اكتب للبحث…' : 'Pick agent — type to search…'}
                    searchPlaceholder={ar ? 'اكتب اسم الوكيل…' : 'Type agent name…'}
                    emptyLabel={ar ? 'لا نتائج — أضِفه من صفحة الوكلاء' : 'No match — add from agents page'}
                    options={parties.agents.map((p) => ({ value: p._id, label: p.name, hint: p.email || '' }))} />
                </Field>
                {/* Transaction type and unit count: containers or cars, chosen here because the transaction cycle is built on it (cars have no container return). The count opens a slot for each container inside the transaction. */}
                <Field label={ar ? 'نوع المعاملة' : 'Transaction type'}>
                  <select value={form.cargoType} onChange={(e) => setForm((f: any) => ({ ...f, cargoType: e.target.value }))} className="cc-input">
                    <option value="containers">{ar ? 'حاويات' : 'Containers'}</option>
                    <option value="vehicles">{ar ? 'سيّارات' : 'Vehicles'}</option>
                  </select>
                </Field>
                <Field label={form.cargoType === 'vehicles' ? (ar ? 'عدد السيّارات' : 'Number of vehicles') : T.containerCount}>
                  <input type="number" min={0} className="cc-input" value={form.containerCount} onChange={(e) => setForm((f: any) => ({ ...f, containerCount: Number(e.target.value) }))} />
                </Field>
                {/* The expected date is the whole difference between an upcoming and a current transaction, and the alert rests on it, so an upcoming one is not saved without it. */}
                {creatingUpcoming && (
                  <Field label={ar ? 'تاريخ المعاملة المتوقَّع' : 'Expected date'}>
                    <input type="date" className="cc-input" value={form.expectedDate || ''}
                      onChange={(e) => setForm((f: any) => ({ ...f, expectedDate: e.target.value }))} />
                  </Field>
                )}
                {/* Required papers: which are received now. The same required-papers list is inside the transaction; marked here at creation, then from the upcoming window or inside the transaction. */}
                {creatingUpcoming && (
                  <div className="sm:col-span-2">
                    <label className="text-slate-500 text-xs mb-1.5 block">{ar ? 'الأوراق المطلوبة — علِّم ما استُلِم' : 'Required papers — tick what has been received'}</label>
                    <DocChecklist value={form.documents} ar={ar}
                      onToggle={(k, on) => setForm((f: any) => ({ ...f, documents: { ...(f.documents || {}), [k]: on } }))} />
                  </div>
                )}
              </div>
              <div className="px-6 py-4 border-t border-slate-200 flex justify-end gap-3">
                <button type="button" onClick={() => setShowModal(false)} className="px-4 py-2 text-slate-500 hover:text-slate-900 text-sm">{T.cancel}</button>
                <button type="button" onClick={handleSave} disabled={saving}
                  className="flex items-center gap-2 px-4 py-2 bg-[#f37121] text-white rounded-lg text-sm font-medium hover:bg-[#e06010] transition-colors disabled:opacity-50">
                  {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
                  {T.create}
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      <style jsx>{`
        :global(.cc-input) {
          width: 100%;
          padding: 0.55rem 0.75rem;
          border-radius: 0.5rem;
          background: #ffffff;
          border: 1px solid #e2e8f0;
          color: #0f172a;
          font-size: 0.875rem;
        }
        :global(.cc-input:focus) { outline: none; box-shadow: 0 0 0 2px rgba(243,113,33,0.4); }
        :global(.cc-filter) {
          padding: 0.6rem 0.75rem;
          border-radius: 0.5rem;
          background: #ffffff;
          border: 1px solid #e2e8f0;
          color: #0f172a;
          font-size: 0.875rem;
          min-width: 10rem;
        }
        :global(.cc-filter:focus) { outline: none; box-shadow: 0 0 0 2px rgba(243,113,33,0.4); }
      `}</style>

      {/* A note written from the table: the same transaction log, not a second field. */}
      <Modal open={!!noteFor} onClose={() => setNoteFor(null)}
        title={`${ar ? 'ملاحظات' : 'Notes'} · ${noteFor?.refNumber || ''}`}>
        {noteFor && (
          <ClearanceNotes compact clearance={noteFor} canEdit={canEdit} ar={ar} notify={notify}
            onChanged={async () => {
              const d = await api.get<any>(`/api/customs-clearance/${noteFor._id}`).catch(() => null);
              if (d?.clearance) setNoteFor(d.clearance);
              fetchList();
            }} />
        )}
      </Modal>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="text-slate-500 text-xs mb-1 block">{label}</label>
      {children}
    </div>
  );
}
