'use client';
/** Collection invoices, cash and tax, in one page with two types. Collections collects invoices, not statements; an unbilled statement is not the department's business unless it is cash, which is collected the same day without an invoice and identified by its statement number. The two faces differ in substance: a cash row is a statement and the collector writes what was received; a tax row is an invoice that may include several statements and carries its value. */
import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/context/AuthContext';
import { useLanguage } from '@/context/LanguageContext';
import { useDialog } from '@/components/system/DialogProvider';
import api from '@/lib/api';
import { useLatestRequest } from '@/hooks/useLatestRequest';
import { useSocket } from '@/hooks/useSocket';
import CustomsLinkBadge, { CustomsLinkBadges, type CustomsLinkView } from '@/components/customs/CustomsLinkBadge';
import { canEditCollections, canEditInvoiceAmount, money, dt } from '@/lib/collections';
import { Spinner, PageHeader, SearchInput, PrimaryButton, Modal, Field, TextInput, Select, Loader2 } from '@/components/hr/HRKit';
import DateRangeFilter from '@/components/system/DateRangeFilter';
import ExportMenu, { type ExportColumn } from '@/components/ls2/ExportMenu';
import ManagedSelect from '@/components/system/ManagedSelect';
import { ColumnFilter, type ColumnFilterOption } from '@/components/ColumnFilter';
import ColumnChooser, { useVisibleColumns, type ChooserColumn } from '@/components/system/ColumnChooser';
import { useColumnFilters, ClearColumnFilters } from '@/components/useColumnFilters';
import SearchSelect from '@/components/system/SearchSelect';
import { openPdf, printPdf } from '@/utils/pdfActions';
import { Banknote, Receipt, SlidersHorizontal, X, CheckCircle2, ChevronLeft, Truck, Printer, FileText, Mail } from 'lucide-react';
import SendStatementModal from '@/components/collections/SendStatementModal';
import ScrollX from '@/components/system/ScrollX';
import { AttachmentsButton } from '@/components/collections/InvoiceAttachments';

const EMPTY_SET: Set<string> = new Set();
const EMPTY_OPTIONS: ColumnFilterOption[] = [];

export type InvoiceKind = 'cash' | 'tax';

/** Collection state as the server derives it; see backend/src/utils/collectionState. */
type CollectionState = 'none' | 'partial' | 'full';
/** A collection payment, full or partial, with its writer and day. */
interface Payment { _id: string; amount: number; date: string | null; byName: string; note: string; mode: 'partial' | 'full'; at: string | null }

interface CashRow {
  _id: string; reportNumber: string; customer: string; partyId?: string; branch: string; payingBranch: string;
  paymentDate: string | null; route: string; value: number; collectedAmount: number; collectionDate: string | null;
  /** Date the invoice reached the customer, like tax; the term counts from it. */
  deliveryDate: string | null;
  /** Where the money came from: branch collection, cash or customer, from department settings. */
  collectionDetail?: string;
  /** The ledger says collected but not on which day; shown as is, not as uncollected. */
  collectedNoDate?: boolean;
  ageDays: number | null;
  /** Statement attachment count; see InvoiceAttachments. */
  attachments?: number;
  collectionState?: CollectionState; remaining?: number; payments?: Payment[];
  /** Customs transaction served by the statement; see services/customsOpsLink. */
  customs?: CustomsLinkView | null;
}
interface TaxRow {
  invoiceNumber: string; customer: string; partyId?: string; value: number; net: number; vat: number;
  invoiceDate: string | null; deliveryDate: string | null; branch: string; payingBranch: string;
  reports: number; collectedReports: number; fullyCollected: boolean;
  collectionDate: string | null; ageDays: number | null;
  /** Account code in the collections ledger and its state as the ledger states it. */
  partyCode?: string; status?: string;
  attachments?: number;
  /** Amount received (full value if collected, sum of payments if partial) and the remainder. */
  collectionState?: CollectionState; collectedAmount?: number; remaining?: number; payments?: Payment[];
  /** Customs transactions served by the invoice's statements. */
  customs?: CustomsLinkView[];
}

/** Age buckets, non-overlapping. "Over 15 days" means 15 to 30, not everything beyond: overlapping buckets count one invoice in four figures, so the per-age count is unknown and the bucket total exceeds the whole. */
const AGE_BANDS: [string, string, string][] = [
  ['0_15', 'حتى 15 يومًا', 'Up to 15 days'],
  ['15_30', 'من 15 إلى 30', '15 – 30 days'],
  ['30_45', 'من 30 إلى 45', '30 – 45 days'],
  ['45_60', 'من 45 إلى 60', '45 – 60 days'],
  ['60_plus', 'أكثر من 60', 'Over 60 days'],
];

export default function CollectionsInvoicesPage({ kind }: { kind: InvoiceKind }) {
  const { user } = useAuth();
  const { lang, isRTL } = useLanguage();
  const ar = lang === 'ar';
  const t = (a: string, e: string) => (ar ? a : e);
  const { notify, prompt } = useDialog();
  const router = useRouter();
  const canEdit = canEditCollections(user);
  // Edit value is narrower than edit: by role only; see lib/collections.
  const canEditAmount = canEditInvoiceAmount(user);
  const isCash = kind === 'cash';

  const [rows, setRows] = useState<(CashRow | TaxRow)[]>([]);
  // "I searched for the number and did not find it": where it is and why it is not here, returned by the server with the empty result.
  const [elsewhere, setElsewhere] = useState<Elsewhere | null>(null);
  const [totals, setTotals] = useState<any>({});
  const [total, setTotal] = useState(0);
  const [pages, setPages] = useState(1);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  // Collection state sits above the table, not inside filters. Both faces are asked every day what is left and how much was collected, so the choice is visible and not hidden behind a button, and the cards above move with it. There are three states, not two: partial stays so until the amount received reaches the value.
  const [collected, setCollected] = useState<'' | 'no' | 'partial' | 'yes'>('');
  const [stateCounts, setStateCounts] = useState<{ all?: number; no?: number; partial?: number; yes?: number }>({});
  const [debt, setDebt] = useState<{ total: number; none: number; partial: number; openCount: number; partialCount: number } | null>(null);
  const [q, setQ] = useState('');
  const [age, setAge] = useState('');
  const [customer, setCustomer] = useState('');
  const [branch, setBranch] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [detail, setDetail] = useState('');
  const [showFilters, setShowFilters] = useState(false);
  const [opts, setOpts] = useState<{ customers: string[]; branches: string[] }>({ customers: [], branches: [] });

  // Row selection: pick specific invoices then export or print; selection is by row key (invoice number for tax, statement id for cash).
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const rowKey = (r: any) => (isCash ? String(r._id) : String(r.invoiceNumber));

  // Excel-style column filters, sent to the server which filters the whole set, not the hundred displayed rows.
  const [colFilters, setColFilters] = useState<Record<string, Set<string>>>({});
  const [colOptions, setColOptions] = useState<Record<string, { values: ColumnFilterOption[]; truncated: boolean }>>({});
  const [colLoading, setColLoading] = useState<Record<string, boolean>>({});
  const optionsSeq = useRef<Record<string, number>>({});
  const colCount = Object.keys(colFilters).length;

  const activeCount = [age, customer, branch, from, to, detail].filter(Boolean).length + colCount;

  // Recording a collection, full or partial. Full collects the whole remainder; partial writes what was received and reduces the remainder. The row's value, received amount and payments come with it, so the remainder is shown before saving.
  const [collecting, setCollecting] = useState<{
    label: string; invoiceNumber?: string; ids?: string[]; needAmount: boolean; collected?: boolean;
    value: number; paid: number; remaining: number; state: CollectionState; payments: Payment[]; full: boolean;
  } | null>(null);
  const [collectMode, setCollectMode] = useState<'full' | 'partial'>('full');
  const [collectNote, setCollectNote] = useState('');
  // Edit a payment in place: its amount and day.
  const [editingPay, setEditingPay] = useState<{ id: string; amount: string; date: string } | null>(null);
  // Not collected: reverses a collection recorded by mistake, with a reason.
  const [undoReason, setUndoReason] = useState('');
  const [undoOpen, setUndoOpen] = useState(false);
  // Delivery is a step before collection. The invoice is sent, received and signed, and the agreed term counts from then. The screen used to record only collection, leaving "when did it reach the customer" with no answer except a paper outside the system, which is the first question in any claim.
  const [delivering, setDelivering] = useState<{ label: string; invoiceNumber?: string; ids?: string[]; numbers?: string[] } | null>(null);
  // Several selected rows collected in full, one date for all.
  const [bulkCollect, setBulkCollect] = useState<{ rows: any[]; total: number } | null>(null);
  const [deliveryDate, setDeliveryDate] = useState('');
  const [collectForm, setCollectForm] = useState({ collectionDate: '', collectedAmount: '' });
  const [saving, setSaving] = useState(false);

  const guard = useLatestRequest();

  /** Everything the server understands as filtering, in one place. Read by the table, column value lists and export together, so none filters on a condition while another shows the result of a different one. Column values are sent repeated (cf_x=a&cf_x=b), not comma-separated, since a value can contain a comma and a customer name with a comma would become two customers. */
  const queryParams = useCallback(() => {
    const p = new URLSearchParams();
    if (q.trim()) p.set('q', q.trim());
    if (collected) p.set('collected', collected);
    if (age) p.set('age', age);
    if (customer) p.set('customer', customer);
    if (branch) p.set('branch', branch);
    if (isCash && detail) p.set('detail', detail);
    if (from) p.set('from', from);
    if (to) p.set('to', to);
    for (const [field, vals] of Object.entries(colFilters)) {
      for (const v of vals) p.append(`cf_${field}`, v);
    }
    return p;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q, collected, age, customer, branch, from, to, detail, isCash, colFilters]);

  const load = useCallback(async (background = false) => {
    const mine = guard.begin();
    if (!background) setRefreshing(true);
    try {
      const p = queryParams();
      p.set('page', String(page));
      p.set('limit', '100');
      const d = await api.get<any>(`/api/collections-dept/invoices/${kind}?${p.toString()}`);
      if (!guard.isCurrent(mine)) return;
      setRows(d.invoices || []);
      setElsewhere(d.elsewhere || null);
      setTotals(d.totals || {});
      setStateCounts(d.stateCounts || {});
      setDebt(d.debt || null);
      setTotal(d.total || 0);
      setPages(d.pages || 1);
    } catch (e: any) {
      if (guard.isCurrent(mine)) notify(e?.message || t('تعذّر التحميل', 'Could not load'), 'error');
    } finally {
      // The flag is always cleared: tying it to latest-wins would leave it on forever on a page a team works in.
      if (!background) setRefreshing(false);
      setLoading(false);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kind, page, queryParams]);

  const first = useRef(true);
  useEffect(() => {
    if (first.current) { first.current = false; load(); return; }
    const id = setTimeout(() => load(), 300);
    return () => clearTimeout(id);
  }, [load]);

  useEffect(() => { setPage(1); }, [q, collected, age, customer, branch, from, to, detail, colFilters]);
  // Selection does not cross a filter: a row selected then filtered out would stay selected invisibly and export something not seen.
  useEffect(() => { setSelected(new Set()); }, [q, collected, age, customer, branch, from, to, detail, colFilters, page]);

  // Collection is written on the statement, so any edit there updates here at once.
  useSocket('workflow:updated', useCallback(() => { load(true); }, [load]));
  // Linking statements to customs transactions is announced by this event (the server cleared its cache first). Any statement field that moves it onto or off the screen (operations review, payment date, type, invoice...) is announced to both workers via this event, after the server cleared its cache. Events within one second are coalesced.
  const liveTick = useRef<ReturnType<typeof setTimeout> | null>(null);
  const soon = useCallback(() => {
    if (liveTick.current) clearTimeout(liveTick.current);
    liveTick.current = setTimeout(() => load(true), 800);
  }, [load]);
  useEffect(() => () => { if (liveTick.current) clearTimeout(liveTick.current); }, []);
  useSocket('collections:changed', soon);
  useSocket('workflow:bulkImported', soon);

  // Attachment count updates in place: the event carries the new count, so the whole page is not reread for a clip.
  const setAttachCount = useCallback((key: string, n: number) => {
    setRows((prev) => prev.map((r: any) => ((isCash ? String(r._id) : String(r.invoiceNumber)) === key ? { ...r, attachments: n } : r)));
  }, [isCash]);
  useSocket('collections:attachments', useCallback((d: any) => {
    if (d?.kind === kind && d?.key) setAttachCount(String(d.key), Number(d.count) || 0);
  }, [kind, setAttachCount]));

  useEffect(() => {
    api.get<{ customers: string[]; branches: string[] }>(`/api/collections-dept/invoices/filters?kind=${kind}`)
      .then(setOpts).catch(() => {});
  }, [kind]);

  const openCollect = (r: any) => {
    setUndoOpen(false); setUndoReason(''); setCollectNote(''); setEditingPay(null);
    const today = new Date().toISOString().slice(0, 10);
    const value = Number(r.value) || 0;
    const paid = Number(r.collectedAmount) || 0;
    const state: CollectionState = r.collectionState || (isCash ? (r.collectionDate || r.collectedNoDate ? 'full' : paid > 0 ? 'partial' : 'none') : (r.fullyCollected ? 'full' : 'none'));
    const full = state === 'full';
    const remaining = r.remaining != null ? Number(r.remaining) : Math.max(0, value - paid);
    const base = { value, paid, remaining, state, full, payments: (r.payments || []) as Payment[] };
    // For cash with no known value the collector writes what was received (as before); no partial applies.
    setCollectMode('full');
    if (isCash) {
      setCollecting({ ...base, label: r.reportNumber, ids: [r._id], needAmount: !(value > 0), collected: full || paid > 0 });
      setCollectForm({ collectionDate: (full && r.collectionDate?.slice(0, 10)) || today, collectedAmount: !(value > 0) && paid ? String(paid) : '' });
    } else {
      setCollecting({ ...base, label: r.invoiceNumber, invoiceNumber: r.invoiceNumber, needAmount: false,
        collected: full || paid > 0 || !!r.collectionDate || /collected/i.test(String(r.status || '')) });
      setCollectForm({ collectionDate: (full && r.collectionDate?.slice(0, 10)) || today, collectedAmount: '' });
    }
  };

  const openDeliver = (r: any) => {
    const today = new Date().toISOString().slice(0, 10);
    setDelivering(isCash
      ? { label: r.reportNumber, ids: [r._id] }
      : { label: r.invoiceNumber, invoiceNumber: r.invoiceNumber });
    setDeliveryDate(r.deliveryDate?.slice(0, 10) || today);
  };

  const saveDeliver = async () => {
    if (!deliveryDate) { notify(t('تاريخ التسليم للعميل مطلوب', 'Customer delivery date required'), 'error'); return; }
    setSaving(true);
    try {
      let message = '';
      if (delivering?.numbers) {
        // Tax invoices are written by number, one at a time.
        for (const invoiceNumber of delivering.numbers) {
          await api.post('/api/collections-dept/invoices/deliver', { invoiceNumber, deliveryDate });
        }
        message = t(`سُجِّل تسليم ${delivering.numbers.length} فاتورة`, `${delivering.numbers.length} invoices delivered`);
      } else {
        const r = await api.post<{ message: string }>('/api/collections-dept/invoices/deliver', {
          invoiceNumber: delivering?.invoiceNumber,
          ids: delivering?.ids,
          deliveryDate,
        });
        message = r?.message || '';
      }
      notify(message || t('سُجِّل التسليم', 'Delivery recorded'));
      if ((delivering?.ids?.length || 0) > 1 || delivering?.numbers) setSelected(new Set());
      setDelivering(null);
      load();
    } catch (e: any) { notify(e?.message || t('تعذّر الحفظ', 'Could not save'), 'error'); }
    setSaving(false);
  };

  // Collection detail saved in place. It is an attribute, not an event: no date or amount, so it does not merit a dialog. It is chosen from the row and saved, the row stays, and the list itself comes from department settings.
  const [detailSaving, setDetailSaving] = useState<string | null>(null);
  const saveDetail = async (row: CashRow, v: string) => {
    setRows((prev) => prev.map((r: any) => (r._id === row._id ? { ...r, collectionDetail: v } : r)));
    setDetailSaving(row._id);
    try {
      await api.put('/api/collections-dept/invoices/detail', { ids: [row._id], detail: v });
    } catch (e: any) {
      setRows((prev) => prev.map((r: any) => (r._id === row._id ? { ...r, collectionDetail: row.collectionDetail || '' } : r)));
      notify(e?.message || t('تعذّر الحفظ', 'Could not save'), 'error');
    }
    setDetailSaving(null);
  };

  const openBulkDeliver = () => {
    setDelivering(isCash
      ? { label: t(`${selectedRows.length} أمر نقل`, `${selectedRows.length} sheets`), ids: selectedRows.map((r: any) => r._id) }
      : { label: t(`${selectedRows.length} فاتورة`, `${selectedRows.length} invoices`), numbers: selectedRows.map((r: any) => r.invoiceNumber) });
    setDeliveryDate(new Date().toISOString().slice(0, 10));
  };
  const openBulkCollect = () => {
    const open = selectedRows.filter((r: any) => r.collectionState !== 'full');
    if (!open.length) { notify(t('كل المحدَّد محصَّل بالفعل', 'Everything selected is already collected'), 'error'); return; }
    const remaining = (r: any) => (r.remaining != null ? Number(r.remaining) : Math.max(0, Number(r.value || 0) - Number(r.collectedAmount || 0)));
    setBulkCollect({ rows: open, total: open.reduce((a: number, r: any) => a + remaining(r), 0) });
    setCollectForm({ collectionDate: new Date().toISOString().slice(0, 10), collectedAmount: '' });
    setCollectNote('');
  };
  const saveBulkCollect = async () => {
    if (!bulkCollect) return;
    if (!collectForm.collectionDate) { notify(t('تاريخ التحصيل مطلوب', 'Collection date required'), 'error'); return; }
    setSaving(true);
    try {
      const r = await api.post<{ message: string; failed: { label: string; message: string }[] }>('/api/collections-dept/invoices/collect-bulk', {
        items: bulkCollect.rows.map((x: any) => (isCash ? { id: x._id, label: x.reportNumber } : { invoiceNumber: x.invoiceNumber, label: x.invoiceNumber })),
        collectionDate: collectForm.collectionDate,
        note: collectNote.trim(),
      });
      const first = r.failed?.[0];
      notify(first ? `${r.message} — ${first.label}: ${first.message}` : r.message, first ? 'error' : undefined);
      setBulkCollect(null);
      setSelected(new Set());
      load();
    } catch (e: any) { notify(e?.message || t('تعذّر الحفظ', 'Could not save'), 'error'); }
    setSaving(false);
  };

  const saveCollect = async () => {
    if (!collecting) return;
    if (!collectForm.collectionDate) { notify(t('تاريخ التحصيل مطلوب', 'Collection date required'), 'error'); return; }
    const partial = collectMode === 'partial';
    const amount = Number(String(collectForm.collectedAmount).replace(/,/g, '').trim());
    // Same validation as the server, before sending: partial is greater than zero and less than the remainder.
    if (partial) {
      if (!Number.isFinite(amount) || amount <= 0) { notify(t('اكتب المبلغ المحصَّل رقمًا أكبر من صفر', 'Enter an amount greater than zero'), 'error'); return; }
      if (amount >= collecting.remaining - 0.005) {
        notify(t(`المبلغ الجزئي يجب أن يكون أقل من الباقي (${money(collecting.remaining)}) — ولتحصيل الباقي كله اختر «تحصيل بالكامل»`,
          `A partial amount must be below the balance (${money(collecting.remaining)}) — choose “Collect in full” for all of it`), 'error');
        return;
      }
    } else if (collecting.needAmount && !(Number.isFinite(amount) && amount > 0)) {
      notify(t('مبلغ التحصيل مطلوب', 'Collected amount required'), 'error'); return;
    }
    setSaving(true);
    try {
      const r = await api.post<{ message: string }>('/api/collections-dept/invoices/collect', {
        invoiceNumber: collecting.invoiceNumber,
        ids: collecting.ids,
        mode: collectMode,
        collectionDate: collectForm.collectionDate,
        note: collectNote.trim(),
        ...(partial || collecting.needAmount ? { amount } : {}),
      });
      notify(r?.message || t('سُجِّل التحصيل', 'Collection recorded'));
      setCollecting(null);
      load();
    } catch (e: any) { notify(e?.message || t('تعذّر الحفظ', 'Could not save'), 'error'); }
    setSaving(false);
  };

  /** Edit or add a payment; status is recomputed on the server. */
  const target = () => (collecting?.invoiceNumber ? { invoiceNumber: collecting.invoiceNumber } : { id: collecting?.ids?.[0] });
  const savePayment = async () => {
    if (!editingPay) return;
    const amount = Number(String(editingPay.amount).replace(/,/g, '').trim());
    if (!Number.isFinite(amount) || amount <= 0) { notify(t('اكتب المبلغ رقمًا أكبر من صفر', 'Enter an amount greater than zero'), 'error'); return; }
    setSaving(true);
    try {
      const r = await api.put<{ message: string }>('/api/collections-dept/invoices/payments', {
        ...target(), paymentId: editingPay.id, amount, date: editingPay.date,
      });
      notify(r?.message || t('عُدِّلت الدفعة', 'Payment updated'));
      setCollecting(null); setEditingPay(null);
      load();
    } catch (e: any) { notify(e?.message || t('تعذّر الحفظ', 'Could not save'), 'error'); }
    setSaving(false);
  };
  const removePayment = async (p: Payment) => {
    const reason = await prompt({
      title: t('رفع الدفعة', 'Remove payment'),
      message: t(`تُرفع دفعة ${money(p.amount)} ويُعاد حساب الباقي. السبب (اختياري):`, `Remove the ${money(p.amount)} payment and recompute the balance. Reason (optional):`),
      defaultValue: '',
      confirmLabel: t('رفع الدفعة', 'Remove'),
    } as any);
    if (reason === null || reason === undefined) return;
    setSaving(true);
    try {
      const r = await api.post<{ message: string }>('/api/collections-dept/invoices/payments/remove', {
        ...target(), paymentId: p._id, reason: String(reason).trim(),
      });
      notify(r?.message || t('رُفعت الدفعة', 'Payment removed'));
      setCollecting(null);
      load();
    } catch (e: any) { notify(e?.message || t('تعذّر الحفظ', 'Could not save'), 'error'); }
    setSaving(false);
  };

  /** Not collected: removes collection from the invoice (or cash statement), clearing its date and amount from the operations statements, and it returns to the collections ledger as uncollected. The reason is optional. */
  const saveUndo = async () => {
    setSaving(true);
    try {
      const r = await api.post<{ message: string }>('/api/collections-dept/invoices/uncollect', {
        invoiceNumber: collecting?.invoiceNumber, ids: collecting?.ids, reason: undoReason.trim(),
      });
      notify(r?.message || t('رُفع التحصيل', 'Collection undone'));
      setCollecting(null); setUndoOpen(false); setUndoReason('');
      load();
    } catch (e: any) { notify(e?.message || t('تعذّر الحفظ', 'Could not save'), 'error'); }
    setSaving(false);
  };

  /** Edit a tax invoice's value: a ledger correction (negative allowed), locked to what was written. */
  const editAmount = async (r: any) => {
    const v = await prompt({
      title: t(`تعديل قيمة الفاتورة ${r.invoiceNumber}`, `Edit invoice ${r.invoiceNumber} amount`),
      message: t(`القيمة الحالية ${Number(r.value || 0).toLocaleString('en-US')} — اكتب القيمة الجديدة (ويجوز بالسالب).`, `Current ${r.value} — enter the new amount (negative allowed).`),
      defaultValue: String(r.value ?? ''),
      confirmLabel: t('حفظ', 'Save'),
    } as any);
    if (v === null || v === undefined || String(v).trim() === '') return;
    const total = Number(String(v).replace(/,/g, '').trim());
    if (!Number.isFinite(total)) { notify(t('اكتب رقمًا', 'Enter a number'), 'error'); return; }
    try {
      await api.put(`/api/collections-dept/invoices/tax/${encodeURIComponent(r.invoiceNumber)}/amount`, { total });
      notify(t('عُدِّلت القيمة', 'Amount updated'));
      load();
    } catch (e: any) { notify(e?.message || t('تعذّر الحفظ', 'Could not save'), 'error'); }
  };

  /** Column values from the server, under existing filters except the column's own filter. */
  const fetchColOptions = useCallback(async (field: string, search = '') => {
    const seq = (optionsSeq.current[field] || 0) + 1;
    optionsSeq.current[field] = seq;
    setColLoading((p) => ({ ...p, [field]: true }));
    try {
      const p2 = queryParams();
      p2.delete(`cf_${field}`);
      p2.set('field', field);
      // List search is named search and page search stays q, so neither filters by the other.
      if (search.trim()) p2.set('search', search.trim());
      const d = await api.get<{ values: ColumnFilterOption[]; truncated: boolean }>(
        `/api/collections-dept/invoices/${kind}/column-options?${p2.toString()}`);
      // Responses can arrive out of order: only the last request is accepted.
      if (optionsSeq.current[field] !== seq) return;
      setColOptions((p3) => ({ ...p3, [field]: d }));
    } catch { /* The list is left as is. */ }
    finally { if (optionsSeq.current[field] === seq) setColLoading((p3) => ({ ...p3, [field]: false })); }
  }, [kind, queryParams]);

  const setColFilter = (field: string, set: Set<string>) => {
    setColFilters((prev) => {
      const next = { ...prev };
      if (set.size) next[field] = set; else delete next[field];
      return next;
    });
  };
  const clearColFilters = () => setColFilters({});

  // Single source of columns. Screen, export and print read from here, so what is seen is what leaves. filter is the DB field name when the column accepts an Excel filter.
  type Col = ExportColumn & {
    filter?: string;
    align?: 'start' | 'end' | 'center';
    cell?: (r: any) => React.ReactNode;
  };
  // Attachments: clip and count, opening the row's files dialog. The count is exported to Excel as a column named for it (attachment count).
  const attachCol: Col = {
    header: t('المرفقات', 'Files'), key: 'attachments', width: 12, type: 'number', align: 'center',
    cell: (r) => (
      <AttachmentsButton kind={kind} invKey={rowKey(r)} label={isCash ? r.reportNumber : r.invoiceNumber}
        count={r.attachments || 0} onCount={(n) => setAttachCount(rowKey(r), n)} />
    ),
  };
  // Three-state status as a word and color. Defined before the columns: the collection-state column filter calls stateLabel from transform during cf.apply, and defining it after crashed the screen (Cannot access before initialization) for anyone filtering by state.
  const stateLabel = (s: CollectionState | undefined) => (s === 'full'
    ? t('تم تحصيلها بالكامل', 'Fully collected')
    : s === 'partial' ? t('تم تحصيلها جزئيًّا', 'Partially collected') : t('لم تُحصَّل بعد', 'Not collected'));
  const stateChip = (s: CollectionState | undefined) => (
    <span className={`px-2 py-0.5 rounded-full text-[11px] font-semibold whitespace-nowrap ${
      s === 'full' ? 'bg-emerald-50 text-emerald-700' : s === 'partial' ? 'bg-amber-50 text-amber-700' : 'bg-red-50 text-red-600'}`}>
      {stateLabel(s)}
    </span>
  );
  const allCols: Col[] = isCash
    ? [
      { header: t('رقم أمر النقل', 'Report no.'), key: 'reportNumber', width: 18, filter: 'reportNumber',
        cell: (r) => (
          <button type="button" onClick={(e) => { e.stopPropagation(); router.push(`/system/operations/${r._id}`); }}
            className="font-semibold text-[#f37121] hover:underline">{r.reportNumber || '—'}</button>
        ) },
      { header: t('العميل', 'Customer'), key: 'customer', width: 30, filter: 'username', cell: (r) => customerCell(r) },
      { header: t('المسار', 'Route'), key: 'route', width: 24 },
      { header: t('التخليص', 'Customs'), key: 'customs', width: 16,
        transform: (v: any) => (v && v.refNumber ? `${v.refNumber}${v.blNumber ? ` · ${v.blNumber}` : ''}` : ''),
        cell: (r) => (r.customs ? <CustomsLinkBadge link={r.customs} ar={ar} compact /> : <span className="text-slate-300">—</span>) },
      { header: t('تاريخ السداد', 'Paid on'), key: 'paymentDate', width: 14, type: 'date', filter: 'paymentDate', transform: (v: any) => dt(v) },
      { header: t('الفرع المسدد', 'Paying branch'), key: 'payingBranch', width: 14, filter: 'payingBranch' },
      { header: t('العمر (يوم)', 'Age (days)'), key: 'ageDays', width: 12, align: 'end', cell: (r) => ageChip(r.ageDays) },
      { header: t('قيمة أمر النقل', 'Value'), key: 'value', width: 14, type: 'number', align: 'end',
        cell: (r) => <span className="tabular-nums font-semibold text-slate-900">{r.value ? money(r.value) : '—'}</span> },
      { header: t('مبلغ التحصيل', 'Collected'), key: 'collectedAmount', width: 14, type: 'number', align: 'end',
        cell: (r) => <span className="tabular-nums font-semibold text-emerald-700">{r.collectedAmount ? money(r.collectedAmount) : '—'}</span> },
      { header: t('المتبقي', 'Balance'), key: 'remaining', width: 14, type: 'number', align: 'end',
        cell: (r) => remainingCell(r) },
      { header: t('حالة التحصيل', 'Collection status'), key: 'collectionState', width: 16, align: 'center',
        transform: (v: any) => stateLabel(v), cell: (r) => stateChip(r.collectionState) },
      { header: t('التسليم للعميل', 'To customer'), key: 'deliveryDate', width: 16, type: 'date', filter: 'deliveryDate',
        transform: (v: any) => dt(v),
        cell: (r) => <span className={r.deliveryDate ? 'text-slate-600' : 'text-slate-300'}>{r.deliveryDate ? dt(r.deliveryDate) : '—'}</span> },
      { header: t('التفاصيل', 'Detail'), key: 'collectionDetail', width: 16, filter: 'collectionDetail', cell: (r) => detailCell(r) },
      { header: t('تاريخ التحصيل', 'Collected on'), key: 'collectionDate', width: 14, type: 'date', filter: 'collectionDate',
        transform: (v: any, r: any) => (v ? dt(v) : (r?.collectedNoDate ? t('محصَّل — بلا تاريخ', 'Collected — no date') : '')),
        cell: (r) => collectedCell(r) },
      attachCol,
    ]
    : [
      { header: t('رقم الفاتورة', 'Invoice no.'), key: 'invoiceNumber', width: 18, filter: 'invoiceNumber',
        cell: (r) => (
          <button type="button" onClick={(e) => { e.stopPropagation(); openInvoice(r.invoiceNumber); }}
            className="font-semibold text-[#f37121] hover:underline">{r.invoiceNumber}</button>
        ) },
      { header: t('العميل', 'Customer'), key: 'customer', width: 30, filter: 'partyName', cell: (r) => customerCell(r) },
      { header: t('كود الحساب', 'Account code'), key: 'partyCode', width: 14, filter: 'partyCode' },
      { header: t('عدد أوامر النقل', 'Reports'), key: 'reports', width: 12, align: 'end', cell: (r) => reportsCell(r) },
      { header: t('التخليص', 'Customs'), key: 'customs', width: 16,
        transform: (v: any) => (Array.isArray(v) ? v.map((x: any) => x.refNumber).filter(Boolean).join('، ') : ''),
        cell: (r) => (r.customs && r.customs.length ? <CustomsLinkBadges links={r.customs} ar={ar} /> : <span className="text-slate-300">—</span>) },
      { header: t('القيمة', 'Value'), key: 'value', width: 16, type: 'number', align: 'end',
        cell: (r) => <span className="tabular-nums font-semibold text-slate-900">{money(r.value)}</span> },
      { header: t('المحصَّل', 'Collected'), key: 'collectedAmount', width: 14, type: 'number', align: 'end',
        cell: (r) => <span className="tabular-nums font-semibold text-emerald-700">{r.collectedAmount ? money(r.collectedAmount) : '—'}</span> },
      { header: t('المتبقي', 'Balance'), key: 'remaining', width: 14, type: 'number', align: 'end',
        cell: (r) => remainingCell(r) },
      { header: t('تاريخ الفاتورة', 'Invoice date'), key: 'invoiceDate', width: 14, type: 'date', filter: 'invoiceDate', transform: (v: any) => dt(v) },
      { header: t('التسليم للعميل', 'To customer'), key: 'deliveryDate', width: 14, type: 'date', filter: 'deliveryDate', transform: (v: any) => dt(v) },
      { header: t('العمر (يوم)', 'Age (days)'), key: 'ageDays', width: 12, align: 'end', cell: (r) => ageChip(r.ageDays) },
      { header: t('تاريخ التحصيل', 'Collected on'), key: 'collectionDate', width: 14, type: 'date', filter: 'collectionDate',
        transform: (v: any, r: any) => (v ? dt(v) : r?.collectionState === 'partial' && lastPayDate(r) ? `${dt(lastPayDate(r))} (${t('جزئي', 'partial')})` : ''),
        cell: (r) => (r.collectionState === 'partial' ? partialDate(r) : (
          <span className={r.fullyCollected ? 'text-emerald-700' : 'text-red-500'}>
            {r.fullyCollected ? (r.collectionDate ? dt(r.collectionDate) : t('محصَّلة — بلا تاريخ', 'Collected — no date')) : t('لم تُحصَّل', 'open')}
          </span>
        )) },
      { header: t('حالة التحصيل', 'Collection status'), key: 'collectionState', width: 16, align: 'center',
        transform: (v: any) => stateLabel(v), cell: (r) => stateChip(r.collectionState) },
      { header: t('الحالة', 'Status'), key: 'status', width: 14, filter: 'status', transform: (v: any) => ledgerStatus(v),
        cell: (r) => <span className="text-slate-600">{ledgerStatus(r.status) || '—'}</span> },
      attachCol,
    ];

  // Every column is filterable, by one of two filters. Columns that map to a DB field (c.filter) filter on the server and read all values, not the page's. Columns with no field (statement count, age, amount, path) are computed, not stored, so the server is not asked; they filter here on the displayed rows. Both appear as one funnel in the header, so the reader cannot tell which.
  const cf = useColumnFilters<any>();
  // The attachments column has no filter: a live changing count that the account statement does not know.
  const localGetters = Object.fromEntries(allCols.filter((c) => !c.filter && c.key !== 'attachments').map((c) => [c.key,
    (r: any) => (c.transform ? c.transform(r[c.key], r) : r[c.key])]));
  const shown = cf.apply(rows, localGetters);

  const chooserCols: ChooserColumn[] = allCols.map((c, i) => ({ key: c.key, label: c.header, locked: i === 0 }));
  const { visible, setVisible } = useVisibleColumns(`collections:invoices:${kind}:cols`, chooserCols);
  const cols = allCols.filter((c) => visible.includes(c.key));

  const openInvoice = (no: string) =>
    router.push(`/system/collections-dept/invoices/tax/${encodeURIComponent(no)}`);

  // Customer name is the door to the profile. The server resolves the name to a profile id with the row; a customer with no profile shows the name as text, not a button promising a page that will not open.
  const customerCell = (r: any) => (r.partyId ? (
    <button type="button" onClick={(e) => { e.stopPropagation(); router.push(`/system/collections-dept/parties/${r.partyId}`); }}
      className="text-[#f37121] hover:underline text-start">{r.customer || '—'}</button>
  ) : <span className="text-slate-700">{r.customer || '—'}</span>);

  const reportsCell = (r: any) => (r.reports > 0 ? (
    <span className="tabular-nums text-slate-600">
      {r.reports}
      {r.reports > r.collectedReports && r.collectedReports > 0 && (
        <span className="text-[11px] text-amber-600 ms-1">({r.collectedReports} {t('محصَّل', 'collected')})</span>
      )}
    </span>
  ) : <span className="text-[11px] text-slate-400">{t('لا أوامر نقل', 'no reports')}</span>);

  /** Latest payment day of a partial; the column showed the word 'partial' with no date at all. */
  const lastPayDate = (r: any): string | null => {
    const ds = ((r.payments || []) as Payment[]).map((p) => p.date || p.at).filter(Boolean) as string[];
    return ds.length ? ds.sort()[ds.length - 1] : null;
  };
  const partialDate = (r: any) => {
    const d = lastPayDate(r);
    return (
      <span className="text-amber-600" title={t('آخر دفعة مستلمة؛ الفاتورة لم تُحصَّل بالكامل بعد', 'Latest payment received; not fully collected yet')}>
        {d ? <>{dt(d)} <span className="text-[11px]">({t('جزئي', 'partial')})</span></> : t('جزئي', 'partial')}
      </span>
    );
  };
  /** Ledger status words are stored in English as the workbook wrote them; shown translated. */
  const ledgerStatus = (v: any) => {
    const s = String(v || '').trim();
    if (/^collected$/i.test(s)) return t('محصَّلة', 'Collected');
    if (/^delivered$/i.test(s)) return t('مُسلَّمة للعميل', 'Delivered');
    return s;
  };
  const collectedCell = (r: any) => (
    <span className={r.collectionDate || r.collectedNoDate ? 'text-emerald-700' : r.collectionState === 'partial' ? 'text-amber-600' : 'text-red-500'}>
      {r.collectionDate ? dt(r.collectionDate)
        : r.collectedNoDate
          ? <span title={t('دفترُ التحصيل يقول إنّها حُصّلت ولا يذكر اليوم', 'The collections book says collected but not when')}>
              {t('محصَّل — بلا تاريخ', 'Collected — no date')}
            </span>
          : r.collectionState === 'partial' ? partialDate(r) : t('لم يُحصَّل', 'open')}
    </span>
  );

  const remainingCell = (r: any) => (r.collectionState === 'full' || !Number(r.remaining)
    ? <span className="text-slate-300">—</span>
    : <span className={`tabular-nums font-semibold ${r.collectionState === 'partial' ? 'text-amber-700' : 'text-red-600'}`}>{money(r.remaining)}</span>);

  const detailCell = (r: any) => (canEdit ? (
    <div className={detailSaving === r._id ? 'opacity-60 pointer-events-none' : ''} onClick={(e) => e.stopPropagation()}>
      <ManagedSelect type="collections_detail" value={r.collectionDetail || ''}
        onChange={(v) => saveDetail(r, v)} storeLabel noAdd placeholder={t('—', '—')}
        className="w-full px-2 py-1 rounded-lg bg-white border border-slate-200 text-slate-900 text-[13px] focus:outline-none focus:ring-2 focus:ring-[#f37121]/50" />
    </div>
  ) : <span>{r.collectionDetail || '—'}</span>);

  // Export and print follow the screen: selected columns, and selected rows if any, otherwise the filter's rows. The scope counter states the count so nobody thinks they took what they did not.
  const selectedRows = rows.filter((r) => selected.has(rowKey(r)));
  // In Excel the column is named for what it holds: count.
  const exportCols = cols.map((c) => (c.key === 'attachments' ? { ...c, header: t('عدد المرفقات', 'Attachments count') } : c));
  // Account statement: everything on screen, built on the server. Print used to take only the displayed page rows (a hundred of thousands) without the cards or company header. The statement is now built on the server by the same function that fills the screen, with the same filters, so its cards are the screen's cards and its rows are the whole result across pages. Browser-side filters (computed column filters), selection and visible columns are sent with it.
  const [stBusy, setStBusy] = useState<'' | 'open' | 'print'>('');
  // Send to customer, with the same filter that prints the statement (SendStatementModal).
  const [sendParams, setSendParams] = useState<URLSearchParams | null>(null);
  const statementParams = () => {
    const p = queryParams();
    for (const [key, set] of Object.entries(cf.filters)) {
      for (const v of set) p.append(`lf_${key}`, v);
    }
    if (selected.size) for (const k of selected) p.append('sel', k);
    p.set('cols', cols.map((c) => c.key).join(','));
    p.set('lang', ar ? 'ar' : 'en');
    return p;
  };
  const statementPath = () => {
    const p = queryParams();
    for (const [key, set] of Object.entries(cf.filters)) {
      for (const v of set) p.append(`lf_${key}`, v);
    }
    if (selected.size) for (const k of selected) p.append('sel', k);
    p.set('cols', cols.map((c) => c.key).join(','));
    p.set('lang', ar ? 'ar' : 'en');
    return `/api/collections-dept/invoices/${kind}/statement?${p.toString()}`;
  };
  const statement = async (mode: 'open' | 'print') => {
    if (stBusy) return;
    setStBusy(mode);
    const fileName = `${isCash ? 'cash' : 'tax'}-invoices-statement.pdf`;
    try {
      // The request starts and the window opens in the same click; see utils/pdfActions. No endless wait: after 100 seconds a clear message replaces a spinner that never stops.
      const load = Promise.race([
        api.getBlob(statementPath()),
        new Promise<never>((_, rej) => setTimeout(() => rej(new Error(t(
          'استغرق إعداد أمر النقل وقتًا أطول من المعتاد — ضيّق الفلتر (عميل أو فترة) وأعد المحاولة، أو استخدم تصدير Excel.',
          'The statement took too long — narrow the filter (customer or period) and try again, or use the Excel export.'))), 100000)),
      ]);
      await (mode === 'print' ? printPdf(load, fileName, ar) : openPdf(load, fileName, ar));
    } catch (e: any) {
      notify(e?.message || t('تعذّر إصدار كشف الحساب', 'Could not issue the statement'), 'error');
    }
    setStBusy('');
  };

  const Stat = ({ label, value, accent }: { label: string; value: string | number; accent?: string }) => (
    <div className="bg-white border border-slate-200 rounded-xl px-4 py-3 shadow-sm min-w-0">
      <p className="text-[11px] text-slate-500 truncate">{label}</p>
      <p className={`text-xl font-bold tabular-nums break-words ${accent || 'text-slate-900'}`}>{value}</p>
    </div>
  );

  // Called as a function, not rendered as a component, so it is never remounted.
  const debtCard = () => {
    if (!debt) return null;
    const who = customer || (q.trim() && !/^\d+$/.test(q.trim()) ? q.trim() : '');
    return (
      <div className={`rounded-xl border px-4 py-3 shadow-sm flex flex-wrap items-center gap-x-6 gap-y-2 ${debt.total ? 'bg-red-50/60 border-red-200' : 'bg-emerald-50/60 border-emerald-200'}`}>
        <div className="min-w-0">
          <p className="text-[12px] font-bold text-slate-600 truncate">
            {who ? t(`إجمالي المديونية على «${who}»`, `Total owed by "${who}"`) : t('إجمالي المديونية حسب الفلاتر', 'Total owed (filtered)')}
          </p>
          <p className={`text-2xl font-extrabold tabular-nums ${debt.total ? 'text-red-700' : 'text-emerald-700'}`}>{money(debt.total)}</p>
        </div>
        <div className="flex flex-wrap gap-x-5 gap-y-1 text-[13px]">
          <span className="text-slate-600">{t('لم تُحصَّل بعد', 'Not collected')}: <b className="tabular-nums text-red-600">{money(debt.none)}</b>
            <span className="text-slate-400"> ({money(debt.openCount - debt.partialCount)})</span></span>
          <span className="text-slate-600">{t('متبقّي الجزئي', 'Partial balance')}: <b className="tabular-nums text-amber-700">{money(debt.partial)}</b>
            <span className="text-slate-400"> ({money(debt.partialCount)})</span></span>
        </div>
        <p className="text-[11px] text-slate-500 basis-full">
          {t('يجمع كل ما لم يُحصَّل بالكامل تحت البحث والفلاتر الحالية، أيًّا كان تبويب الحالة المختار.', 'Everything not fully collected under the current search and filters, whatever status tab is selected.')}
        </p>
      </div>
    );
  };

  const ageChip = (d: number | null) => {
    if (d == null) return null;
    const tone = d > 60 ? 'bg-red-50 text-red-700' : d > 45 ? 'bg-orange-50 text-orange-700'
      : d > 30 ? 'bg-amber-50 text-amber-700' : d > 15 ? 'bg-sky-50 text-sky-700' : 'bg-slate-100 text-slate-600';
    return <span className={`px-1.5 py-0.5 rounded text-[11px] tabular-nums ${tone}`}>{d} {t('يوم', 'd')}</span>;
  };

  if (loading) return <Spinner />;

  const Icon = isCash ? Banknote : Receipt;
  const title = isCash ? t('فواتير الكاش', 'Cash invoices') : t('الفواتير الضريبية', 'Tax invoices');

  return (
    <div className="space-y-4 pb-10" dir={isRTL ? 'rtl' : 'ltr'}>
      <PageHeader
        icon={<Icon className="w-6 h-6 text-[#f37121]" />}
        title={title}
        subtitle={isCash
          ? t('أوامر نقل نقديّة اكتمل سدادُها — تُحصَّل في يومها', 'Cash reports already paid out — collect same-day')
          : t('الفاتورةُ هي الوحدة، وقد تضمّ أكثر من أمر نقل', 'The invoice is the unit — it may cover several reports')}
      >
        <ClearColumnFilters count={cf.count} onClear={cf.clear} ar={ar} />
        <ColumnChooser columns={chooserCols} visible={visible} onChange={setVisible} ar={ar} />
        <button type="button" onClick={() => statement('open')} disabled={!!stBusy}
          className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-white border border-slate-200 text-slate-600 hover:text-slate-900 text-sm font-semibold disabled:opacity-60"
          title={selected.size
            ? t('كشف حساب PDF للصفوف المحدَّدة — بالأعمدة المختارة', 'Statement PDF of the selected rows — chosen columns')
            : t('كشف حساب PDF لنتيجة الفلتر كاملةً (كل الصفحات) مع البطاقات — بالأعمدة المختارة', 'Statement PDF of the whole filtered result (every page) with the cards — chosen columns')}>
          {stBusy === 'open' ? <Loader2 className="w-4 h-4 animate-spin" /> : <FileText className="w-4 h-4" />}
          {stBusy === 'open' ? t('جارٍ إعداد أمر النقل…', 'Preparing…') : t('كشف حساب PDF', 'Statement PDF')}
        </button>
        {canEdit && (
          <button type="button" onClick={() => setSendParams(statementParams())}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-[#f37121] text-white hover:bg-[#e06010] text-sm font-bold"
            title={t('إرسال كشف الحساب لنتيجة الفلتر إلى بريد العميل من بريد التحصيل', 'Email the filtered statement to the customer from the collections mailbox')}>
            <Mail className="w-4 h-4" />{t('إرسال للعميل', 'Email customer')}
          </button>
        )}
        <button type="button" onClick={() => statement('print')} disabled={!!stBusy}
          className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-white border border-slate-200 text-slate-600 hover:text-slate-900 text-sm font-semibold disabled:opacity-60"
          title={t('طباعة كشف الحساب على الطابعة مباشرة', 'Print the statement straight to the printer')}>
          {stBusy === 'print' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Printer className="w-4 h-4" />}
          {stBusy === 'print' ? t('جارٍ الإعداد للطباعة…', 'Preparing…') : t('طباعة', 'Print')}
        </button>
        <ExportMenu
          fileName={`collections-${kind}-invoices`}
          lang={ar ? 'ar' : 'en'}
          options={[
            // The scope is named for what it holds: someone who exported selected rows thinking it was everything would get a silently wrong file.
            ...(selected.size ? [{
              key: 'selected',
              label: t(`المحدَّد (${selected.size})`, `Selected (${selected.size})`),
              sheets: [{ name: title, rows: selectedRows as any, columns: exportCols }],
            }] : []),
            { key: 'shown', label: t('المعروض بعد الفلتر', 'Shown (filtered)'), sheets: [{ name: title, rows: rows as any, columns: exportCols }] },
          ]}
        />
      </PageHeader>

      {/* Collection state. */}
      <div className="flex items-center gap-2 flex-wrap">
        {([['', 'all', 'الكل', 'All'], ['no', 'no', 'لم تُحصَّل بعد', 'Not collected'],
          ['partial', 'partial', 'تم تحصيلها جزئيًّا', 'Partially collected'], ['yes', 'yes', 'تم تحصيلها', 'Collected']] as const).map(([k, ck, arL, enL]) => (
          <button key={k} type="button" onClick={() => setCollected(k as any)}
            className={`px-3.5 py-2 rounded-lg text-sm font-semibold transition-colors ${
              collected === k ? 'bg-[#f37121] text-white' : 'bg-white border border-slate-200 text-slate-600 hover:text-slate-900'}`}>
            {t(arL, enL)}
            {/* Count is under the other filters, not under this selection itself. */}
            {(stateCounts as any)[ck] != null && (
              <span className={`ms-1.5 tabular-nums text-[12px] ${collected === k ? 'text-white/85' : 'text-slate-400'}`}>
                {money((stateCounts as any)[ck])}
              </span>
            )}
          </button>
        ))}
      </div>

      {debtCard()}

      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        <Stat label={isCash ? t('أوامر نقل', 'Reports') : t('فواتير', 'Invoices')} value={money(total)} />
        {isCash ? (
          <>
            <Stat label={t('المحصَّل', 'Collected')} value={money(totals.collected)} accent="text-emerald-600" />
            <Stat label={t('محصَّلة بالكامل', 'Fully collected')} value={money(totals.collectedCount)} accent="text-emerald-600" />
            <Stat label={t('محصَّلة جزئيًّا', 'Partially collected')} value={money(totals.partialCount)} accent={totals.partialCount ? 'text-amber-600' : 'text-slate-400'} />
            <Stat label={t('لم يُحصَّل بعد', 'Not collected')} value={money(totals.noneCount ?? totals.pendingCount)} accent={(totals.noneCount ?? totals.pendingCount) ? 'text-red-600' : 'text-slate-400'} />
            <Stat label={t('المتبقي', 'Balance due')} value={money(totals.remaining)} accent={totals.remaining ? 'text-red-600' : 'text-slate-400'} />
          </>
        ) : (
          <>
            <Stat label={t('قيمة الفواتير', 'Invoiced value')} value={money(totals.value)} />
            <Stat label={t('محصَّلة بالكامل', 'Fully collected')} value={money(totals.fullyCollected)} accent="text-emerald-600" />
            <Stat label={t('محصَّلة جزئيًّا', 'Partially collected')} value={money(totals.partial)} accent={totals.partial ? 'text-amber-600' : 'text-slate-400'} />
            <Stat label={t('لم تُحصَّل بعد', 'Not collected')} value={money(totals.none ?? totals.pending)} accent={(totals.none ?? totals.pending) ? 'text-red-600' : 'text-slate-400'} />
            <Stat label={t('المتبقي', 'Balance due')} value={money(totals.remaining)} accent={totals.remaining ? 'text-red-600' : 'text-slate-400'} />
          </>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div className="flex-1 min-w-[220px]">
          <SearchInput value={q} onChange={setQ}
            placeholder={isCash
              ? t('بحث برقم أمر النقل أو العميل أو السند…', 'report no., customer, voucher…')
              : t('بحث برقم الفاتورة أو العميل…', 'invoice no., customer…')} />
        </div>
        <button type="button" onClick={() => setShowFilters((p) => !p)}
          className={`inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-sm font-semibold border transition-colors ${
            activeCount ? 'bg-[#f37121] text-white border-[#f37121]' : 'bg-white border-slate-200 text-slate-600 hover:text-slate-900'}`}>
          <SlidersHorizontal className="w-4 h-4" />{t('فلاتر', 'Filters')}{activeCount ? ` (${activeCount})` : ''}
        </button>
      </div>

      {showFilters && (
        <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-sm space-y-4">
          {/* Age buckets do not overlap: "15 to 30", not "everything over 15"; otherwise one invoice counts in four buckets and the per-age count is unknown. */}
          <div>
            <p className="text-[12px] font-bold text-slate-600 mb-2">{t('عمر الفاتورة', 'Invoice age')}</p>
            <div className="flex items-center gap-2 flex-wrap">
              {AGE_BANDS.map(([k, arL, enL]) => (
                <button key={k} type="button" onClick={() => setAge(age === k ? '' : k)}
                  className={`px-3 py-1.5 rounded-lg text-[13px] font-medium border transition-colors ${
                    age === k ? 'bg-[#f37121] text-white border-[#f37121]' : 'bg-white border-slate-200 text-slate-600 hover:text-slate-900'}`}>
                  {t(arL, enL)}
                </button>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {/* Dropdowns with search: customer lists run to hundreds and scrolling to a name is wasted work; the user knows the name and needs to type it. See SearchSelect. */}
            <Field label={t('العميل', 'Customer')}>
              <SearchSelect ar={ar} value={customer} onChange={setCustomer}
                allLabel={t('جميع العملاء', 'All customers')}
                options={opts.customers.map((c) => ({ value: c, label: c }))} />
            </Field>
            <Field label={t('الفرع المسدد', 'Paying branch')}>
              <SearchSelect ar={ar} value={branch} onChange={setBranch}
                allLabel={t('جميع الفروع', 'All branches')}
                options={opts.branches.map((b) => ({ value: b, label: b }))} />
            </Field>
            {isCash && (
              <Field label={t('التفاصيل', 'Detail')}>
                <ManagedSelect type="collections_detail" value={detail} onChange={setDetail}
                  storeLabel noAdd placeholder={t('الكل', 'All')} />
              </Field>
            )}
            <div className="sm:col-span-2 lg:col-span-1 flex items-end">
              {(activeCount > 0) && (
                <button type="button" onClick={() => { setAge(''); setCustomer(''); setBranch(''); setFrom(''); setTo(''); setDetail(''); }}
                  className="inline-flex items-center gap-1.5 px-3 py-2 text-slate-400 hover:text-red-600 text-sm">
                  <X className="w-4 h-4" />{t('إزالة الفلاتر', 'Clear filters')}
                </button>
              )}
            </div>
          </div>

          <div>
            <p className="text-[12px] font-bold text-slate-600 mb-2">
              {isCash ? t('مدى تاريخ السداد', 'Payment date range') : t('مدى تاريخ الفاتورة', 'Invoice date range')}
            </p>
            <DateRangeFilter from={from} to={to} onFrom={setFrom} onTo={setTo} ar={ar} />
          </div>
        </div>
      )}

      {/* The bulk actions are always on screen, not only after a tick: they could not be found when they appeared only on selection. */}
      {(selected.size > 0 || colCount > 0 || canEdit) && (
        <div className="flex flex-wrap items-center gap-2 text-sm">
          {selected.size > 0 && (
            <span className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg bg-[#f37121]/10 text-[#f37121] font-semibold">
              {t(`محدَّد: ${selected.size}`, `${selected.size} selected`)}
              <button type="button" onClick={() => setSelected(new Set())} title={t('إلغاء التحديد', 'Clear selection')}>
                <X className="w-3.5 h-3.5" />
              </button>
            </span>
          )}
          {canEdit && (
            <>
              <button type="button" onClick={openBulkDeliver} disabled={!selectedRows.length}
                title={selectedRows.length ? '' : t('حدّد الفواتير من المربّعات في أوّل الجدول', 'Tick invoices in the first column')}
                className="px-3 py-1.5 rounded-lg border border-slate-300 bg-white text-slate-800 hover:bg-slate-50 text-[13px] font-semibold disabled:opacity-50 disabled:cursor-not-allowed">
                {t(`تسليم المحدَّد (${selectedRows.length})`, `Deliver selected (${selectedRows.length})`)}
              </button>
              <button type="button" onClick={openBulkCollect} disabled={!selectedRows.length}
                title={selectedRows.length ? '' : t('حدّد الفواتير من المربّعات في أوّل الجدول', 'Tick invoices in the first column')}
                className="px-3 py-1.5 rounded-lg bg-[#f37121] text-white hover:bg-[#e0651a] text-[13px] font-semibold disabled:opacity-50 disabled:cursor-not-allowed">
                {t(`تحصيل المحدَّد بالكامل (${selectedRows.length})`, `Collect selected in full (${selectedRows.length})`)}
              </button>
              {!selectedRows.length && (
                <span className="text-xs text-slate-500">{t('حدّد أكثر من فاتورة من المربّعات في أوّل الجدول لتسليمها أو تحصيلها مرّةً واحدة بتاريخ تختاره.', 'Tick several invoices in the first column to deliver or collect them at once on a date you choose.')}</span>
              )}
            </>
          )}
          {colCount > 0 && (
            <button type="button" onClick={clearColFilters}
              className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-slate-100 text-slate-600 hover:text-slate-900 text-xs font-medium">
              <X className="w-3.5 h-3.5" />{t(`مسح فلاتر الأعمدة (${colCount})`, `Clear column filters (${colCount})`)}
            </button>
          )}
        </div>
      )}

      <div className="relative bg-white border border-slate-200 rounded-xl overflow-hidden shadow-sm">
        {refreshing && <div className="refresh-bar" aria-hidden="true" />}
        <ScrollX aria-busy={refreshing}>
          <table className="w-full text-sm">
            <thead className="table-head">
              <tr>
                {/* Select a whole page with one click. */}
                <th className="px-3 py-2.5 w-10">
                  <input type="checkbox" className="accent-[#f37121]"
                    checked={shown.length > 0 && shown.every((r) => selected.has(rowKey(r)))}
                    onChange={(e) => setSelected(e.target.checked ? new Set(shown.map(rowKey)) : new Set())} />
                </th>
                {cols.map((c) => (
                  <th key={c.key} className="px-3 py-2.5 text-start font-semibold whitespace-nowrap">
                    <span className="inline-flex items-center">
                      {c.header}
                      {/* No DB field, so a local funnel on the displayed rows. */}
                      {!c.filter && localGetters[c.key] && cf.header(c.key, rows, localGetters[c.key], ar)}
                      {c.filter && (
                        <ColumnFilter
                          field={c.filter}
                          selected={colFilters[c.filter] || EMPTY_SET}
                          onChange={(set) => setColFilter(c.filter as string, set)}
                          onOpen={() => fetchColOptions(c.filter as string)}
                          options={colOptions[c.filter]?.values || EMPTY_OPTIONS}
                          truncated={!!colOptions[c.filter]?.truncated}
                          loading={!!colLoading[c.filter]}
                          onQuery={(query) => fetchColOptions(c.filter as string, query)}
                          lang={ar ? 'ar' : 'en'}
                          format={c.type === 'date' ? (v: any) => {
                            // The server groups dates by Riyadh day and returns YYYY-MM-DD. Reinterpreting them in the browser's zone drops a day west of Greenwich, so they are shown as they are.
                            const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(v || ''));
                            return m ? `${m[3]}/${m[2]}/${m[1]}` : String(v || '');
                          } : undefined}
                        />
                      )}
                    </span>
                  </th>
                ))}
                <th className="px-3 py-2.5" />
              </tr>
            </thead>
            <tbody>
              {shown.length === 0 ? (
                <tr><td colSpan={cols.length + 2} className="px-4 py-12 text-center text-slate-400">
                  {colCount || cf.count ? t('لا نتائج للفلتر المحدد', 'No rows match the filters') : t('لا نتائج', 'No results')}
                  {elsewhere && <ElsewhereHint e={elsewhere} isCash={isCash} ar={ar} go={(u) => router.push(u)} />}
                </td></tr>
              ) : shown.map((r: any) => {
                const k = rowKey(r);
                const on = selected.has(k);
                return (
                  <tr key={k}
                    className={`border-b border-slate-100 ${on ? 'bg-[#f37121]/5' : 'hover:bg-slate-50'}`}>
                    <td className="px-3 py-2.5" onClick={(e) => e.stopPropagation()}>
                      <input type="checkbox" className="accent-[#f37121]" checked={on}
                        onChange={() => setSelected((prev) => {
                          const next = new Set(prev);
                          if (next.has(k)) next.delete(k); else next.add(k);
                          return next;
                        })} />
                    </td>
                    {cols.map((c) => (
                      <td key={c.key} className={`px-3 py-2.5 ${c.align === 'end' ? 'text-end' : ''} ${c.key === 'customer' ? 'min-w-[240px] max-w-[340px] leading-snug' : c.key === 'route' ? 'min-w-[200px] max-w-[300px] leading-snug' : 'whitespace-nowrap'} ${c.key === 'collectionDetail' ? 'min-w-[150px]' : ''} ${c.align === 'center' ? 'text-center' : ''}`}
                        onClick={c.key === 'attachments' ? (e) => e.stopPropagation() : undefined}>
                        {c.cell ? c.cell(r) : (
                          <span className="text-slate-600">
                            {(c.transform ? c.transform(r[c.key], r) : r[c.key]) || '—'}
                          </span>
                        )}
                      </td>
                    ))}
                    <td className="px-3 py-2.5 whitespace-nowrap">
                      <div className="flex items-center gap-1">
                        {canEdit && (
                          <button type="button" onClick={() => openDeliver(r)}
                            className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-sky-50 text-sky-700 text-xs font-semibold hover:bg-sky-100"
                            title={t('يومُ استلام العميل للفاتورة — منه تُعَدُّ المهلة', 'When the customer received the invoice — the term starts here')}>
                            <Truck className="w-3.5 h-3.5" />{r.deliveryDate ? t('تعديل التسليم', 'Edit delivery') : t('تسليم', 'Deliver')}
                          </button>
                        )}
                        {canEdit && (
                          <button type="button" onClick={() => openCollect(r)}
                            className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-[#f37121]/10 text-[#f37121] text-xs font-semibold hover:bg-[#f37121]/20">
                            <CheckCircle2 className="w-3.5 h-3.5" />
                            {(isCash ? (r.collectionDate || r.collectedNoDate) : r.fullyCollected) ? t('تعديل', 'Edit') : t('تحصيل', 'Collect')}
                          </button>
                        )}
                        {canEditAmount && !isCash && (
                          <button type="button" onClick={() => editAmount(r)}
                            className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-slate-100 text-slate-700 text-xs font-semibold hover:bg-slate-200"
                            title={t('تصحيح قيمة الفاتورة في الدفتر', 'Correct the invoice amount')}>
                            {t('تعديل القيمة', 'Edit amount')}
                          </button>
                        )}
                        {!isCash && (
                          <button type="button" onClick={() => openInvoice(r.invoiceNumber)}
                            title={t('فتح الفاتورة', 'Open invoice')} className="p-1 text-slate-300 hover:text-[#f37121]">
                            <ChevronLeft className={`w-4 h-4 ${isRTL ? '' : 'rotate-180'}`} />
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </ScrollX>

        {pages > 1 && (
          <div className="flex items-center justify-between px-4 py-3 border-t border-slate-100 text-sm">
            <span className="text-slate-500">{t(`صفحة ${page} من ${pages} · ${money(total)}`, `Page ${page} of ${pages} · ${money(total)}`)}</span>
            <div className="flex items-center gap-2">
              <button type="button" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}
                className="px-3 py-1.5 rounded-lg border border-slate-200 disabled:opacity-40">{t('السابق', 'Prev')}</button>
              <button type="button" disabled={page >= pages} onClick={() => setPage((p) => p + 1)}
                className="px-3 py-1.5 rounded-lg border border-slate-200 disabled:opacity-40">{t('التالي', 'Next')}</button>
            </div>
          </div>
        )}
      </div>

      <Modal
        open={!!delivering}
        onClose={() => setDelivering(null)}
        title={t(`تسجيل تسليم — ${delivering?.label || ''}`, `Record delivery — ${delivering?.label || ''}`)}
        footer={<>
          <button type="button" onClick={() => setDelivering(null)} className="px-4 py-2 text-slate-500 text-sm">{t('إلغاء', 'Cancel')}</button>
          <PrimaryButton onClick={saveDeliver} disabled={saving}>{saving ? <Loader2 className="w-4 h-4 animate-spin" /> : null}{t('حفظ', 'Save')}</PrimaryButton>
        </>}>
        <Field label={t('تاريخ التسليم للعميل', 'Delivered to customer')}>
          <TextInput type="date" value={deliveryDate} onChange={(e) => setDeliveryDate(e.target.value)} />
        </Field>
        <p className="text-xs text-slate-500 mt-2 leading-relaxed">
          {t('يوم استلام العميل للفاتورة — ومنه تبدأ مهلة السداد المتّفق عليها معه. يُكتب على أوامر نقل الفاتورة في سير عمل التشغيل وفي دفتر التحصيل معًا، وهو غير «تاريخ التسليم للفرع» الذي يسجّله التشغيل.',
             'The day the customer received the invoice — the agreed credit term starts here. Written to the invoice\u2019s reports and the collections ledger together, and distinct from the branch delivery operations records.')}
        </p>
      </Modal>

      <Modal
        open={!!bulkCollect}
        onClose={() => setBulkCollect(null)}
        title={t(`تحصيل ${bulkCollect?.rows.length || 0} بالكامل`, `Collect ${bulkCollect?.rows.length || 0} in full`)}
        footer={<>
          <button type="button" onClick={() => setBulkCollect(null)} className="px-4 py-2 text-slate-500 text-sm">{t('إلغاء', 'Cancel')}</button>
          <PrimaryButton onClick={saveBulkCollect} disabled={saving}>{saving ? <Loader2 className="w-4 h-4 animate-spin" /> : null}{t('تحصيل', 'Collect')}</PrimaryButton>
        </>}>
        <p className="text-sm text-slate-700 mb-3">{t(`إجمالي الباقي: ${money(bulkCollect?.total || 0)}`, `Total balance: ${money(bulkCollect?.total || 0)}`)}</p>
        <Field label={t('تاريخ التحصيل', 'Collection date')}>
          <TextInput type="date" value={collectForm.collectionDate} onChange={(e) => setCollectForm((f) => ({ ...f, collectionDate: e.target.value }))} />
        </Field>
        <Field label={t('ملاحظة (اختياري)', 'Note (optional)')}>
          <TextInput value={collectNote} onChange={(e) => setCollectNote(e.target.value)} />
        </Field>
        <p className="text-xs text-slate-500 mt-2 leading-relaxed">
          {t('كل واحدة تُحصَّل بباقيها كاملًا في هذا التاريخ. والمحصَّل بالفعل لا يُعاد، وما لا قيمة له يُذكر لك لتحصيله منفردًا.',
             'Each is collected for its full balance on this date. Collected rows are skipped, and a row with no value is named so you can collect it alone.')}
        </p>
      </Modal>

      <Modal
        open={!!collecting}
        onClose={() => setCollecting(null)}
        title={t(`تسجيل تحصيل — ${collecting?.label || ''}`, `Record collection — ${collecting?.label || ''}`)}
        footer={<>
          <button type="button" onClick={() => setCollecting(null)} className="px-4 py-2 text-slate-500 text-sm">{t('إلغاء', 'Cancel')}</button>
          <PrimaryButton onClick={saveCollect} disabled={saving}>
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : null}{t('حفظ', 'Save')}
          </PrimaryButton>
        </>}
      >
        {/* Value, received and remainder before any choice. */}
        {collecting && (
          <div className="grid grid-cols-3 gap-2 mb-4">
            {[
              [t('القيمة', 'Value'), collecting.value, 'text-slate-900'],
              [t('المحصَّل', 'Collected'), collecting.full ? collecting.value || collecting.paid : collecting.paid, 'text-emerald-700'],
              [t('المتبقي', 'Balance'), collecting.full ? 0 : collecting.remaining, collecting.full ? 'text-slate-400' : 'text-red-600'],
            ].map(([l, v, c]) => (
              <div key={String(l)} className="rounded-lg bg-slate-50 border border-slate-200 px-3 py-2">
                <p className="text-[11px] text-slate-500">{l}</p>
                <p className={`text-sm font-bold tabular-nums ${c}`}>{money(Number(v) || 0)}</p>
              </div>
            ))}
          </div>
        )}

        {/* Full or partial: partial applies to an incomplete item with a known value; a completed item has its day edited. */}
        {collecting && !collecting.full && !collecting.needAmount && (
          <div className="flex items-center gap-2 mb-3" role="radiogroup">
            {([['full', t('تحصيل بالكامل', 'Collect in full')], ['partial', t('تحصيل جزئي', 'Partial collection')]] as const).map(([k, l]) => (
              <button key={k} type="button" role="radio" aria-checked={collectMode === k} onClick={() => setCollectMode(k)}
                className={`flex-1 px-3 py-2 rounded-lg text-sm font-semibold border transition-colors ${
                  collectMode === k ? 'bg-[#f37121] text-white border-[#f37121]' : 'bg-white border-slate-200 text-slate-600 hover:text-slate-900'}`}>
                {l}
              </button>
            ))}
          </div>
        )}

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {/* Partial writes what was received; cash with no value writes the whole amount received. */}
          {collecting && !collecting.full && (collectMode === 'partial' || collecting.needAmount) && (
            <Field label={collectMode === 'partial' ? t('المبلغ المحصَّل *', 'Amount collected *') : t('مبلغ التحصيل *', 'Collected amount *')}>
              <TextInput type="number" value={collectForm.collectedAmount} min={0}
                onChange={(e) => setCollectForm((p) => ({ ...p, collectedAmount: e.target.value }))} />
            </Field>
          )}
          <Field label={t('تاريخ التحصيل *', 'Collection date *')}>
            <TextInput type="date" value={collectForm.collectionDate}
              onChange={(e) => setCollectForm((p) => ({ ...p, collectionDate: e.target.value }))} />
          </Field>
          {collecting && !collecting.full && (
            <Field label={t('ملاحظة', 'Note')}>
              <TextInput value={collectNote} onChange={(e) => setCollectNote(e.target.value)}
                placeholder={t('اختياري — مثال: شيك رقم…', 'Optional — e.g. cheque no.…')} />
            </Field>
          )}
        </div>
        {collecting && !collecting.full && collectMode === 'partial' && (() => {
          const a = Number(String(collectForm.collectedAmount).replace(/,/g, ''));
          const after = Number.isFinite(a) && a > 0 ? collecting.remaining - a : null;
          return (
            <p className={`text-[12px] mt-2 ${after != null && after <= 0.005 ? 'text-red-600' : 'text-slate-500'}`}>
              {after == null
                ? t(`أقل من الباقي (${money(collecting.remaining)}). تبقى الفاتورة «جزئية» حتى يبلغ المحصَّل قيمتها كاملة.`,
                  `Less than the balance (${money(collecting.remaining)}). It stays “partial” until the full value is collected.`)
                : after <= 0.005
                  ? t('المبلغ يبلغ الباقي أو يتجاوزه — اختر «تحصيل بالكامل».', 'This reaches the balance — choose “Collect in full”.')
                  : t(`يبقى بعد هذه الدفعة: ${money(after)}`, `Balance after this payment: ${money(after)}`)}
            </p>
          );
        })()}
        {collecting && !collecting.full && collectMode === 'full' && !collecting.needAmount && (
          <p className="text-[12px] text-slate-500 mt-2">
            {t(`يُسجَّل الباقي (${money(collecting.remaining)}) دفعةً أخيرة وتصير محصَّلةً بالكامل.`,
              `The balance (${money(collecting.remaining)}) is recorded as the final payment and it becomes fully collected.`)}
          </p>
        )}
        {!collecting?.ids && (
          <p className="text-[12px] text-slate-500 mt-3">
            {t('عند اكتمال التحصيل يُسجَّل التاريخ على أوامر نقل هذه الفاتورة كلِّها — تحصيلُها تحصيلٌ لما فيها.',
              'Once fully collected, the date is written to every report under this invoice.')}
          </p>
        )}

        {/* Payments: each with amount, day and writer, edited or removed individually. */}
        {!!collecting?.payments.length && (
          <div className="mt-4">
            <p className="text-[12px] font-bold text-slate-600 mb-2">{t('الدفعات', 'Payments')}</p>
            <div className="divide-y divide-slate-100 rounded-lg border border-slate-200">
              {collecting.payments.map((p) => (
                <div key={p._id} className="px-3 py-2 text-[12.5px]">
                  {editingPay?.id === p._id ? (
                    <div className="flex flex-wrap items-center gap-2">
                      <TextInput type="number" value={editingPay.amount} className="w-28"
                        onChange={(e) => setEditingPay((x) => (x ? { ...x, amount: e.target.value } : x))} />
                      <TextInput type="date" value={editingPay.date} className="w-40"
                        onChange={(e) => setEditingPay((x) => (x ? { ...x, date: e.target.value } : x))} />
                      <button type="button" onClick={savePayment} disabled={saving}
                        className="px-2.5 py-1 rounded-lg bg-[#f37121] text-white text-xs font-semibold disabled:opacity-50">{t('حفظ', 'Save')}</button>
                      <button type="button" onClick={() => setEditingPay(null)} className="px-2 py-1 text-xs text-slate-500">{t('إلغاء', 'Cancel')}</button>
                    </div>
                  ) : (
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="tabular-nums font-semibold text-slate-900">{money(p.amount)}</span>
                      <span className="text-slate-500">{dt(p.date)}</span>
                      <span className={`px-1.5 py-0.5 rounded text-[10.5px] ${p.mode === 'full' ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-700'}`}>
                        {p.mode === 'full' ? t('إتمام', 'Final') : t('جزئية', 'Partial')}
                      </span>
                      {p.byName && <span className="text-slate-400">{p.byName}</span>}
                      {p.note && <span className="text-slate-500 truncate max-w-[180px]" title={p.note}>{p.note}</span>}
                      {canEdit && (
                        <span className="ms-auto flex items-center gap-1">
                          <button type="button" onClick={() => setEditingPay({ id: p._id, amount: String(p.amount), date: (p.date || '').slice(0, 10) })}
                            className="px-2 py-0.5 rounded text-xs text-slate-600 hover:bg-slate-100">{t('تعديل', 'Edit')}</button>
                          <button type="button" onClick={() => removePayment(p)} disabled={saving}
                            className="px-2 py-0.5 rounded text-xs text-red-600 hover:bg-red-50">{t('رفع', 'Remove')}</button>
                        </span>
                      )}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}
        {/* Not collected: recorded as collected but the money was not received (a bounced cheque, or a click on the wrong row). Collection is removed here, returning it to claims and ageing, and the date is cleared from the operations workflow too. */}
        {collecting?.collected && (
          <div className="mt-4 rounded-xl border border-red-200 bg-red-50/60 p-3">
            {!undoOpen ? (
              <div className="flex flex-wrap items-center gap-2">
                <p className="flex-1 text-[12.5px] text-red-800">
                  {collecting.state === 'partial'
                    ? t('مسجَّلٌ عليها تحصيلٌ جزئيّ. «لم تُحصَّل» ترفع الدفعات كلَّها — ولرفع دفعةٍ واحدةٍ استعمل «رفع» بجانبها.', 'Partly collected. “Not collected” removes every payment — to remove one, use “Remove” beside it.')
                    : t('مسجَّلةٌ محصَّلة. إن لم يُقبَض مالُها فعلًا فارفع عنها التحصيل.', 'Recorded as collected. If the money was not actually received, undo it.')}
                </p>
                <button type="button" onClick={() => setUndoOpen(true)}
                  className="rounded-lg bg-white px-3 py-1.5 text-[12.5px] font-bold text-red-700 ring-1 ring-red-200 hover:bg-red-100">
                  {t('لم تُحصَّل', 'Not collected')}
                </button>
              </div>
            ) : (
              <div className="space-y-2">
                <p className="text-[12.5px] font-bold text-red-800">{t('الرجوع عن التحصيل — السبب (اختياري)', 'Undo collection — reason (optional)')}</p>
                <TextInput value={undoReason} onChange={(e) => setUndoReason(e.target.value)}
                  placeholder={t('مثال: الشيك رُدّ · سُجِّل على فاتورةٍ أخرى خطأً', 'e.g. cheque bounced · recorded on the wrong invoice')} />
                <p className="text-[11.5px] text-red-700/80">
                  {t('يُمحى تاريخُ التحصيل ومبلغُه من أوامر النقل (ومن سير عمل التشغيل) وتعود في دفتر التحصيل غيرَ محصَّلة. يُقيَّد ذلك باسمك (وسببك إن كتبته).',
                     'The collection date and amount are cleared from the reports (and the operations workflow) and the ledger shows it as not collected. Recorded under your name with the reason.')}
                </p>
                <div className="flex justify-end gap-2">
                  <button type="button" onClick={() => setUndoOpen(false)} className="px-3 py-1.5 text-[12.5px] text-slate-500">{t('تراجع', 'Back')}</button>
                  <button type="button" onClick={saveUndo} disabled={saving}
                    className="inline-flex items-center gap-1.5 rounded-lg bg-red-600 px-3 py-1.5 text-[12.5px] font-bold text-white disabled:opacity-50">
                    {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : null}{t('تأكيد: لم تُحصَّل', 'Confirm: not collected')}
                  </button>
                </div>
              </div>
            )}
          </div>
        )}
      </Modal>
      {sendParams && <SendStatementModal kind={kind} params={sendParams} ar={ar} onClose={() => setSendParams(null)} />}
    </div>
  );
}

// "The number exists elsewhere": see locateNumber on the server. The cash page reads reviewed cash statements and the tax page reads tax ledger invoices; anything outside them is told where it is, with a link.
interface Elsewhere {
  number: string;
  ledger: { kind: 'tax' | 'cash'; invoiceNumber: string; customer: string; collected: boolean }[];
  sheets: { _id: string; reportNumber: string; invoiceNumber: string; customer: string; paymentType: string; why: string }[];
}

function ElsewhereHint({ e, isCash, ar, go }: { e: Elsewhere; isCash: boolean; ar: boolean; go: (url: string) => void }) {
  const t = (a: string, en: string) => (ar ? a : en);
  if (!e.ledger.length && !e.sheets.length) {
    return <p className="mt-2 text-xs">{t(`الرقم ${e.number} غير موجود في دفتر التحصيل ولا في أوامر النقل.`, `${e.number} is in neither the collections book nor the operations reports.`)}</p>;
  }
  const WHY: Record<string, [string, string]> = {
    cancelled: ['أمر النقل ملغي', 'the report is cancelled'],
    tax: ['نوع الدفع على أمر النقل «ضريبي»', 'the report is marked tax'],
    noType: ['نوع الدفع على أمر النقل غير محدَّد', 'the report has no payment type'],
    noPaymentDate: ['لا تاريخ سداد على أمر النقل بعد', 'the report has no payment date yet'],
    notReviewed: ['لم يراجعه التشغيل بعد', 'operations has not reviewed it yet'],
  };
  const link = 'font-semibold text-[#f37121] hover:underline';
  return (
    <div className="mt-3 mx-auto max-w-xl text-start text-[12.5px] text-slate-600 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 space-y-1.5">
      <p className="font-semibold text-slate-800">{t(`الرقم ${e.number} موجودٌ لكن ليس في هذه الصفحة:`, `${e.number} exists, but not on this page:`)}</p>
      {e.ledger.map((l) => (
        <p key={`l-${l.kind}-${l.invoiceNumber}`}>
          {l.kind === 'cash'
            ? t('فاتورة نقديّة في دفتر التحصيل', 'A cash invoice in the collections book')
            : t('فاتورة ضريبيّة في دفتر التحصيل', 'A tax invoice in the collections book')}
          {l.customer ? ` — ${l.customer}` : ''} · {l.collected ? t('محصَّلة', 'collected') : t('لم تُحصَّل', 'open')}
          {l.kind === 'cash' && isCash && !e.sheets.some((w) => w.paymentType === 'cash') && (
            <span className="text-slate-500">{t(' (لا أمر نقلٍ نقديًّا لها، وصفحةُ الكاش تعرض أوامر النقل)', ' (no cash operations report — this page lists reports)')}</span>
          )}
          {' '}<button type="button" className={link} onClick={() => go(`/system/collections-dept/invoices/tax/${encodeURIComponent(l.invoiceNumber)}`)}>
            {t('افتحها وسجّل التحصيل', 'Open and collect')}
          </button>
        </p>
      ))}
      {e.sheets.map((w) => (
        <p key={`s-${w._id}`}>
          {t(`أمر نقل ${w.reportNumber}`, `Operations report ${w.reportNumber}`)}{w.customer ? ` — ${w.customer}` : ''}
          {isCash && w.why && WHY[w.why] ? ` · ${t('ليس في صفحة الكاش لأنّ', 'not on the cash page because')} ${t(WHY[w.why][0], WHY[w.why][1])}` : ''}
          {' '}<button type="button" className={link} onClick={() => go(`/system/operations/${w._id}`)}>{t('افتح أمر النقل', 'Open report')}</button>
        </p>
      ))}
    </div>
  );
}
