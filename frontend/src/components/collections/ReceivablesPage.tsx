'use client';
/**
 * تفاصيلُ المديونيّة — صفحةُ كلِّ رقمٍ في لوحة التحصيل.
 *
 * ── لماذا صفحةٌ لا نافذة ────────────────────────────────────────────────────
 * كان الرقمُ يفتح نافذةً بثلاث مئة صفٍّ وأعمدةٍ مختصرة، لا تُرسَل لأحدٍ ولا
 * يُرجَع إليها، ولا فلترَ فيها ولا مجموع. وطلبُ صاحب الشركة (٢٠٢٦/١٠/٢١): الرقمُ
 * يفتح صفحةً بجدولٍ كامل — كلُّ ما يُعرَف عن الفاتورة أو الكشف، وفلترُ الأعمدة
 * وفرزُها، وصفُّ مجاميع، وتصدير.
 *
 * ── الرابطُ هو الحالة ───────────────────────────────────────────────────────
 * فلاترُ اللوحة، والعقدةُ التي ضُغطت، والبحثُ، وقموعُ الأعمدة (`cf_<عمود>`)،
 * والفرزُ والصفحة — كلُّها في الرابط ولا شيءَ غيره. فيُرسَل الرابطُ فيرى المرسَلُ
 * إليه الصفوفَ نفسَها، ويُحفَظ في المفضّلة، ويرجع زرُّ «اللوحة» إليها بفلاترها.
 *
 * ── والصفوفُ صفوفُ البطاقة ──────────────────────────────────────────────────
 * من `/receivables/rows`، وهو يقرأ الاشتقاقَ نفسَه الذي عدّ البطاقة
 * (collectionsReceivablesController: loadBase → passes → nodeOf). فالعددُ
 * والقيمةُ في رأس الصفحة هما رقمُ البطاقة نفسُه ما دامت القموعُ والبحثُ فارغة.
 */
import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import {
  Layers, ArrowRight, ArrowLeft, X, Search, Handshake, Scale, Ban, ArrowUp, ArrowDown, ArrowUpDown, ExternalLink,
} from 'lucide-react';
import api from '@/lib/api';
import { useLanguage } from '@/context/LanguageContext';
import { useAuth } from '@/context/AuthContext';
import { useDialog } from '@/components/system/DialogProvider';
import { useSocket } from '@/hooks/useSocket';
import { CustomsLinkBadges, type CustomsLinkView } from '@/components/customs/CustomsLinkBadge';
import { useLatestRequest } from '@/hooks/useLatestRequest';
import { canEditCollections, money, dt } from '@/lib/collections';
import { paymentKindLabel, paymentFamily } from '@/lib/paymentKind';
import { PageHeader } from '@/components/hr/HRKit';
import ScrollX from '@/components/system/ScrollX';
import ExportMenu, { type ExportColumn } from '@/components/ls2/ExportMenu';
import { ColumnFilter, type ColumnFilterOption } from '@/components/ColumnFilter';
import { AttachmentsButton } from '@/components/collections/InvoiceAttachments';
import { BANDS, RISKS, unitsOf } from '@/components/collections/ReceivablesTree';
import {
  ReceivablesFilterBar, filtersFromParams, filtersToQuery, nodeLabel,
  NODE_KEYS, DASHBOARD_PATH, RECEIVABLES_PATH, ISSUE_LABELS, DUE_LABELS,
  type DashFilters, type Facets,
} from '@/components/collections/receivablesFilters';

export interface RecvRow {
  _id: string; invoiceNumber: string; reportNumber?: string; kind: 'tax' | 'cash';
  source?: 'workflow'; workflowId?: string;
  subtype?: string; payKind: string;
  total: number; collected: number; remaining: number;
  partyName: string; partyCode: string; party: string | null; partyKey: string;
  invoiceDate: string | null; deliveryDate: string | null; status: string;
  creditDays: number; term: number; termIsDefault: boolean;
  officer: string; officerIsDefault?: boolean;
  issueState: 'none' | 'negotiating' | 'legal'; issueNote?: string; issueSince?: string | null;
  basis: 'delivery' | 'invoice' | 'payment'; dueDate: string | null; daysLate: number | null;
  dueState: string; age: number | null; ageBand: string; risk: string;
  attachments: number | null;
  /** معاملاتُ التخليص التي تخدمها كشوفُ الصفّ — راجع services/customsOpsLink. */
  customs?: CustomsLinkView[];
}
interface RowsResp {
  rows: RecvRow[]; total: number; taxCount: number; cashCount: number;
  value: number; collected: number; remaining: number; customers: number;
  page: number; limit: number; pages: number;
}

const EMPTY_SET: Set<string> = new Set();
const EMPTY_OPTS: ColumnFilterOption[] = [];
const PAGE_SIZES = [50, 100, 200, 500];
/** ما لا يُرسَل إلى قائمة قيم العمود: الصفحةُ والفرزُ لا يغيّران القيم. */
const VIEW_KEYS = ['page', 'limit', 'sort', 'dir'];

const RISK_CLS: Record<string, string> = {
  normal: 'bg-emerald-50 text-emerald-700',
  medium: 'bg-amber-50 text-amber-700',
  hard: 'bg-red-50 text-red-700',
};
const ISSUE_CLS: Record<string, string> = {
  none: 'bg-slate-100 text-slate-500',
  negotiating: 'bg-sky-50 text-sky-700',
  legal: 'bg-[#7c2d12]/10 text-[#7c2d12]',
};

/** عمودٌ في الجدول: رأسُه، وفرزُه، وقمعُه، وخليّتُه، وكيف يُصدَّر. */
interface Col {
  key: string; ar: string; en: string;
  sort?: string; filter?: string; align?: 'end' | 'center';
  cell: (r: RecvRow) => React.ReactNode;
  exp?: ExportColumn;
}

export default function ReceivablesPage() {
  const { lang, isRTL } = useLanguage();
  const ar = lang === 'ar';
  const t = (a: string, e: string) => (ar ? a : e);
  const router = useRouter();
  const { user } = useAuth();
  const canEdit = canEditCollections(user);
  const { notify, prompt } = useDialog();

  // ── الرابطُ هو الحالة ───────────────────────────────────────────────────
  const searchParams = useSearchParams();
  const qs = searchParams?.toString() || '';
  const params = useMemo(() => new URLSearchParams(qs), [qs]);
  const filters = useMemo(() => filtersFromParams(params), [params]);
  const node = useMemo(() => NODE_KEYS.filter((k) => params.get(k)).map((k) => [k, params.get(k) as string] as const), [params]);
  const colFilters = useMemo(() => {
    const o: Record<string, Set<string>> = {};
    params.forEach((_v, k) => {
      if (k.startsWith('cf_') && !o[k.slice(3)]) o[k.slice(3)] = new Set(params.getAll(k));
    });
    return o;
  }, [params]);
  const sort = params.get('sort') || '';
  const dir = params.get('dir') === 'asc' ? 'asc' : 'desc';
  const page = Math.max(1, Number(params.get('page')) || 1);
  const limit = PAGE_SIZES.includes(Number(params.get('limit'))) ? Number(params.get('limit')) : 100;
  const qParam = params.get('q') || '';
  // بطاقةُ نوعٍ نقديّ: الصفُّ كشفُ تخريجٍ لا فاتورة.
  const reportsMode = !!params.get('subtype') && paymentFamily(params.get('subtype')) === 'cash';

  /** يغيّر الرابطَ في مكانه — وكلُّ تغييرٍ غيرِ الصفحة يعيد إلى الأولى. */
  const update = useCallback((mut: (p: URLSearchParams) => void, keepPage = false) => {
    const p = new URLSearchParams(qs);
    mut(p);
    if (!keepPage) p.delete('page');
    const s = p.toString();
    router.replace(s ? `${RECEIVABLES_PATH}?${s}` : RECEIVABLES_PATH, { scroll: false });
  }, [qs, router]);

  const setFilters = useCallback((f: DashFilters) => update((p) => {
    ['officer', 'parties', 'pay', 'dueState', 'issue', 'from', 'to'].forEach((k) => p.delete(k));
    Object.entries(filtersToQuery(f)).forEach(([k, v]) => p.set(k, v));
  }), [update]);

  // ── البحثُ يُمهَل ثمّ يُكتب في الرابط ──────────────────────────────────
  const [q, setQ] = useState(qParam);
  useEffect(() => { setQ(qParam); }, [qParam]);
  useEffect(() => {
    if (q.trim() === qParam) return undefined;
    const id = setTimeout(() => update((p) => { if (q.trim()) p.set('q', q.trim()); else p.delete('q'); }), 350);
    return () => clearTimeout(id);
  }, [q, qParam, update]);

  // ── الصفوف ──────────────────────────────────────────────────────────────
  const [data, setData] = useState<RowsResp | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState('');
  const guard = useLatestRequest();
  const load = useCallback(async (background = false) => {
    const mine = guard.begin();
    if (!background) setLoading(true);
    try {
      const p = new URLSearchParams(qs);
      p.set('limit', String(limit));
      const d = await api.get<RowsResp>(`/api/collections-dept/receivables/rows?${p.toString()}`);
      if (guard.isCurrent(mine)) setData(d);
    } catch (e: any) {
      if (guard.isCurrent(mine)) notify(e?.message || t('تعذّر التحميل', 'Could not load'), 'error');
    }
    if (guard.isCurrent(mine)) setLoading(false);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [qs, limit, guard]);
  useEffect(() => { load(); }, [load]);

  // ── خياراتُ شريط الفلاتر: من جواب اللوحة تحت فلاترها (لا تحت العقدة) ──────
  const [facets, setFacets] = useState<{ facets?: Facets; manager?: { name: string } | null } | null>(null);
  const facetGuard = useLatestRequest();
  const filterQs = useMemo(() => new URLSearchParams(filtersToQuery(filters)).toString(), [filters]);
  const loadFacets = useCallback(async () => {
    const mine = facetGuard.begin();
    try {
      const d = await api.get<{ facets?: Facets; manager?: { name: string } | null }>(`/api/collections-dept/receivables/overview?${filterQs}`);
      if (facetGuard.isCurrent(mine)) setFacets({ facets: d.facets, manager: d.manager });
    } catch { /* القوائمُ زيادة — الجدولُ لا يتوقّف عليها */ }
  }, [filterQs, facetGuard]);
  useEffect(() => { loadFacets(); }, [loadFacets]);

  // ── حيّة: كلُّ كتابةٍ في القسم تعيد القراءة بعد هدوء الدفعة ──────────────
  const tick = useRef<ReturnType<typeof setTimeout> | null>(null);
  const soon = useCallback(() => {
    if (tick.current) clearTimeout(tick.current);
    tick.current = setTimeout(() => { load(true); loadFacets(); }, 800);
  }, [load, loadFacets]);
  useEffect(() => () => { if (tick.current) clearTimeout(tick.current); }, []);
  useSocket('workflow:updated', soon);
  useSocket('workflow:bulkImported', soon);
  useSocket('collections:party', soon);
  useSocket('collections:changed', soon);
  useSocket('collections:attachments', soon);

  // ── قموعُ الأعمدة: القيمُ من الخادم تحت كلِّ فلترٍ إلّا قمعَ العمود نفسِه ──
  const [colOptions, setColOptions] = useState<Record<string, { values: ColumnFilterOption[]; truncated: boolean }>>({});
  const [colLoading, setColLoading] = useState<Record<string, boolean>>({});
  const optSeq = useRef<Record<string, number>>({});
  const fetchColOptions = useCallback(async (col: string, search = '') => {
    const seq = (optSeq.current[col] || 0) + 1;
    optSeq.current[col] = seq;
    setColLoading((p) => ({ ...p, [col]: true }));
    try {
      const p = new URLSearchParams(qs);
      VIEW_KEYS.forEach((k) => p.delete(k));
      p.set('col', col);
      if (search) p.set('cq', search);
      const d = await api.get<{ values: ColumnFilterOption[]; truncated: boolean }>(`/api/collections-dept/receivables/column-options?${p.toString()}`);
      if (optSeq.current[col] === seq) setColOptions((o) => ({ ...o, [col]: d }));
    } catch { /* القمعُ يبقى بما فيه */ }
    if (optSeq.current[col] === seq) setColLoading((p) => ({ ...p, [col]: false }));
  }, [qs]);
  const setColFilter = useCallback((col: string, sel: Set<string>) => update((p) => {
    p.delete(`cf_${col}`);
    sel.forEach((v) => p.append(`cf_${col}`, v));
  }), [update]);
  const colCount = Object.keys(colFilters).length;

  const toggleSort = (key: string) => update((p) => {
    if (sort !== key) { p.set('sort', key); p.set('dir', 'desc'); }
    else if (dir === 'desc') p.set('dir', 'asc');
    else { p.delete('sort'); p.delete('dir'); }
  }, true);

  // ── حالةُ الخلاف تُصنَّف من الصفّ — وهي صفةُ العميل، فكلُّ فواتيره تتبعه ──
  const setIssue = async (r: RecvRow, state: 'none' | 'negotiating' | 'legal') => {
    if (!r.party) { notify(t('هذه الفاتورة بلا حسابٍ مربوط', 'This invoice has no linked account'), 'error'); return; }
    let note = '';
    if (state !== 'none') {
      const ask = await prompt({
        title: state === 'legal' ? t('قضايا', 'Legal') : t('تحت التفاوض', 'Negotiating'),
        message: state === 'legal'
          ? t(`رقمُ القضيّة أو بيانُها — «${r.partyName}»`, `Case number or details — “${r.partyName}”`)
          : t(`ما المتَّفقُ عليه مع «${r.partyName}»؟`, `What was agreed with “${r.partyName}”?`),
        defaultValue: r.issueState === state ? (r.issueNote || '') : '',
        confirmLabel: t('حفظ', 'Save'),
      } as any);
      if (!ask || !String(ask).trim()) return;
      note = String(ask).trim();
    }
    setBusy(r._id);
    try {
      await api.put(`/api/collections-dept/parties/${r.party}/issue`, { state, note });
      notify(t('سُجِّلت الحالة — وكلُّ فواتير العميل تتبعها', 'Recorded — all the customer’s invoices follow it'), 'success');
      await load(true);
    } catch (e: any) { notify(e?.message || t('تعذّر الحفظ', 'Could not save'), 'error'); }
    setBusy('');
  };

  /** الصفُّ يُفتَح بتفصيله: الفاتورةُ الضريبيّة بصفحتها، والكشفُ النقديُّ بكشفه. */
  const openRow = (r: RecvRow) => {
    if (r.source === 'workflow') router.push(`/system/operations/${r._id}`);
    else if (r.kind === 'tax') router.push(`/system/collections-dept/invoices/tax/${encodeURIComponent(r.invoiceNumber)}`);
    else if (r.workflowId) router.push(`/system/operations/${r.workflowId}`);
    else if (r.party) router.push(`/system/collections-dept/parties/${r.party}`);
  };

  // ── الأعمدة ─────────────────────────────────────────────────────────────
  const bandLabel = (k: string) => {
    if (k === 'nodate') return t('بلا تاريخ', 'No date');
    const b = BANDS.find((x) => x.key === k);
    return b ? t(b.ar, b.en) : k;
  };
  const riskLabel = (k: string) => {
    const r = RISKS.find((x) => x.key === k);
    return r ? t(r.ar, r.en) : (k === 'nodate' ? t('بلا تاريخ', 'No date') : k);
  };
  const issueLabel = (k: string) => t(...(ISSUE_LABELS[k] || ISSUE_LABELS.none));
  const dueLabel = (k: string) => (DUE_LABELS[k] ? t(...DUE_LABELS[k]) : k);
  // قيمُ القمع رموزٌ في الخادم — وتُعرَض بأسمائها.
  const FORMAT: Record<string, (v: any) => string> = {
    payKind: (v) => (v ? paymentKindLabel(v, ar) : t('(فارغ)', '(blank)')),
    ageBand: (v) => bandLabel(String(v)),
    risk: (v) => riskLabel(String(v)),
    issue: (v) => issueLabel(String(v)),
    dueState: (v) => dueLabel(String(v)),
    attach: (v) => (v === 'yes' ? t('مرفق', 'Has file') : v === 'no' ? t('بلا مرفق', 'No file') : t('لا ينطبق', 'n/a')),
    termSource: (v) => (v === 'default' ? t('افتراضية', 'Default') : t('مدّة العميل', 'Customer term')),
    invoiceDate: (v) => ymdLabel(v), deliveryDate: (v) => ymdLabel(v), dueDate: (v) => ymdLabel(v),
  };

  const cols: Col[] = [
    {
      key: 'number', ar: reportsMode ? 'الكشف' : 'الفاتورة / الكشف', en: reportsMode ? 'Report' : 'Invoice / report', sort: 'number',
      cell: (r) => (
        <span className="whitespace-nowrap">
          <button type="button" onClick={(e) => { e.stopPropagation(); openRow(r); }}
            className="font-semibold text-[#f37121] hover:underline">{r.invoiceNumber || '—'}</button>
          <span className="block text-[10px] text-slate-400">{r.source === 'workflow' || r.kind === 'cash' ? t('كشف تخريج', 'exit report') : t('فاتورة', 'invoice')}</span>
          {/* ومعاملةُ التخليص إن كانت كشوفُه نقلًا لحاوياتها. */}
          {r.customs && r.customs.length ? <span className="mt-0.5 block"><CustomsLinkBadges links={r.customs} ar={ar} /></span> : null}
        </span>
      ),
      exp: { header: t('الرقم', 'Number'), key: 'invoiceNumber', width: 16 },
    },
    {
      key: 'customer', ar: 'العميل', en: 'Customer', sort: 'customer', filter: 'customer',
      cell: (r) => (
        <span className="block max-w-[240px]">
          {r.party ? (
            <button type="button" onClick={(e) => { e.stopPropagation(); router.push(`/system/collections-dept/parties/${r.party}`); }}
              className="text-slate-800 hover:text-[#f37121] hover:underline text-start truncate block max-w-full" title={r.partyName}>{r.partyName || '—'}</button>
          ) : <span className="truncate block" title={r.partyName}>{r.partyName || '—'}</span>}
          {r.partyCode ? <span className="text-[10px] text-slate-400">{r.partyCode}</span> : null}
        </span>
      ),
      exp: { header: t('العميل', 'Customer'), key: 'partyName', width: 32 },
    },
    {
      key: 'officer', ar: 'مسؤول التحصيل', en: 'Collector', sort: 'officer', filter: 'officer',
      cell: (r) => (
        <span className="whitespace-nowrap text-slate-600" title={r.officerIsDefault ? t('غير مُسنَد — على مدير القسم', 'Unassigned — falls to the dept. manager') : undefined}>
          {r.officer || '—'}
          {r.officerIsDefault ? <span className="block text-[10px] text-slate-400">{t('مدير القسم — غير مُسنَد', 'manager — unassigned')}</span> : null}
        </span>
      ),
      exp: { header: t('مسؤول التحصيل', 'Collector'), key: 'officer', width: 18 },
    },
    {
      key: 'payKind', ar: 'نوع الدفع', en: 'Payment type', sort: 'payKind', filter: 'payKind',
      cell: (r) => <span className="whitespace-nowrap text-slate-600">{paymentKindLabel(r.payKind, ar) || '—'}</span>,
      exp: { header: t('نوع الدفع', 'Payment type'), key: 'payKind', width: 16, transform: (v) => paymentKindLabel(v, ar) },
    },
    {
      key: 'invoiceDate', ar: reportsMode ? 'تاريخ السداد' : 'تاريخ الإصدار', en: reportsMode ? 'Payment date' : 'Issued', sort: 'invoiceDate', filter: 'invoiceDate',
      cell: (r) => <span className="tabular-nums text-slate-600 whitespace-nowrap">{dt(r.invoiceDate)}</span>,
      exp: { header: t('تاريخ الإصدار / السداد', 'Issue / payment date'), key: 'invoiceDate', width: 14, type: 'date' },
    },
    {
      key: 'deliveryDate', ar: 'التسليم للعميل', en: 'Delivered', sort: 'deliveryDate', filter: 'deliveryDate',
      cell: (r) => (
        <span className="tabular-nums text-slate-600 whitespace-nowrap">
          {dt(r.deliveryDate)}
          {r.basis === 'invoice' ? <span className="block text-[10px] text-slate-400">{t('عُدَّ من الإصدار', 'counted from issue')}</span> : null}
          {r.basis === 'payment' ? <span className="block text-[10px] text-slate-400">{t('عُدَّ من السداد', 'counted from payment')}</span> : null}
        </span>
      ),
      exp: { header: t('التسليم للعميل', 'Delivered'), key: 'deliveryDate', width: 14, type: 'date' },
    },
    {
      key: 'term', ar: 'المدّة (يوم)', en: 'Term (days)', sort: 'term', filter: 'termSource', align: 'end',
      cell: (r) => (
        <span className="tabular-nums text-slate-600 whitespace-nowrap">
          {r.term}
          {r.termIsDefault ? <span className="block text-[10px] text-slate-400">{t('افتراضية', 'default')}</span> : null}
        </span>
      ),
      exp: { header: t('المدّة (يوم)', 'Term (days)'), key: 'term', width: 10, type: 'number' },
    },
    {
      key: 'dueDate', ar: 'الاستحقاق', en: 'Due date', sort: 'dueDate', filter: 'dueDate',
      cell: (r) => (
        <span className="tabular-nums text-slate-600 whitespace-nowrap">
          {dt(r.dueDate)}
          <span className="block text-[10px] text-slate-400">{dueLabel(r.dueState)}</span>
        </span>
      ),
      exp: { header: t('الاستحقاق', 'Due date'), key: 'dueDate', width: 14, type: 'date' },
    },
    {
      key: 'age', ar: 'العمر (يوم)', en: 'Age (days)', sort: 'age', filter: 'ageBand', align: 'end',
      cell: (r) => (
        <span className="tabular-nums text-slate-700 whitespace-nowrap">
          {r.age == null ? '—' : r.age}
          <span className="block text-[10px] text-slate-400">{bandLabel(r.ageBand)}</span>
        </span>
      ),
      exp: { header: t('العمر (يوم)', 'Age (days)'), key: 'age', width: 10, type: 'number' },
    },
    {
      key: 'risk', ar: 'الخطورة', en: 'Risk', sort: 'risk', filter: 'risk',
      cell: (r) => (RISK_CLS[r.risk]
        ? <span className={`px-2 py-0.5 rounded-full text-[11px] font-medium whitespace-nowrap ${RISK_CLS[r.risk]}`}>{riskLabel(r.risk)}</span>
        : <span className="text-slate-300">—</span>),
      exp: { header: t('الخطورة', 'Risk'), key: 'risk', width: 10, transform: (v) => riskLabel(String(v)) },
    },
    {
      key: 'daysLate', ar: 'التأخير (يوم)', en: 'Days late', sort: 'daysLate', align: 'end',
      cell: (r) => (r.daysLate == null || r.daysLate <= 0
        ? <span className="text-slate-300 tabular-nums">{r.daysLate == null ? '—' : 0}</span>
        : <span className="tabular-nums font-semibold text-slate-800">{r.daysLate}</span>),
      exp: { header: t('التأخير (يوم)', 'Days late'), key: 'daysLate', width: 10, type: 'number' },
    },
    {
      key: 'total', ar: 'القيمة', en: 'Value', sort: 'total', align: 'end',
      cell: (r) => <span className="tabular-nums font-semibold text-slate-900">{money(r.total)}</span>,
      exp: { header: t('القيمة', 'Value'), key: 'total', width: 14, type: 'number' },
    },
    {
      key: 'collected', ar: 'المحصَّل', en: 'Collected', sort: 'collected', align: 'end',
      cell: (r) => <span className="tabular-nums text-slate-600">{r.collected ? money(r.collected) : '—'}</span>,
      exp: { header: t('المحصَّل', 'Collected'), key: 'collected', width: 14, type: 'number' },
    },
    {
      key: 'remaining', ar: 'المتبقّي', en: 'Remaining', sort: 'remaining', align: 'end',
      cell: (r) => <span className="tabular-nums font-semibold text-slate-900">{money(r.remaining)}</span>,
      exp: { header: t('المتبقّي', 'Remaining'), key: 'remaining', width: 14, type: 'number' },
    },
    {
      key: 'issue', ar: 'حالة القضية', en: 'Case state', sort: 'issue', filter: 'issue',
      cell: (r) => (
        <span className="inline-flex items-center gap-1 whitespace-nowrap" onClick={(e) => e.stopPropagation()}>
          <span className={`px-2 py-0.5 rounded-full text-[11px] font-medium ${ISSUE_CLS[r.issueState] || ISSUE_CLS.none}`}
            title={r.issueNote || undefined}>{issueLabel(r.issueState)}</span>
          {canEdit && r.party && (
            <>
              <button type="button" disabled={busy === r._id} title={t('تحت التفاوض', 'Negotiating')} onClick={() => setIssue(r, 'negotiating')}
                className="p-1 rounded-md border border-slate-200 text-slate-500 hover:text-slate-900 disabled:opacity-40"><Handshake className="w-3.5 h-3.5" /></button>
              <button type="button" disabled={busy === r._id} title={t('قضايا', 'Legal')} onClick={() => setIssue(r, 'legal')}
                className="p-1 rounded-md border border-slate-200 text-slate-500 hover:text-slate-900 disabled:opacity-40"><Scale className="w-3.5 h-3.5" /></button>
              {r.issueState !== 'none' && (
                <button type="button" disabled={busy === r._id} title={t('رفعُ الحالة', 'Clear')} onClick={() => setIssue(r, 'none')}
                  className="p-1 rounded-md border border-slate-200 text-slate-400 hover:text-slate-900 disabled:opacity-40"><Ban className="w-3.5 h-3.5" /></button>
              )}
            </>
          )}
        </span>
      ),
      exp: { header: t('حالة القضية', 'Case state'), key: 'issueState', width: 14, transform: (v) => issueLabel(String(v || 'none')) },
    },
    {
      key: 'attach', ar: 'المرفقات', en: 'Files', filter: 'attach', align: 'center',
      cell: (r) => (
        <span onClick={(e) => e.stopPropagation()}>
          {r.source === 'workflow' ? (
            <AttachmentsButton kind="cash" invKey={String(r._id)} label={r.invoiceNumber} count={r.attachments || 0} onCount={(n) => patchRow(r._id, n)} />
          ) : r.kind === 'tax' ? (
            <AttachmentsButton kind="tax" invKey={r.invoiceNumber} label={r.invoiceNumber} count={r.attachments || 0} onCount={(n) => patchRow(r._id, n)} />
          ) : <span className="text-slate-300">—</span>}
        </span>
      ),
      exp: { header: t('المرفقات', 'Files'), key: 'attachments', width: 10, type: 'number' },
    },
  ];
  const exportCols: ExportColumn[] = [
    ...cols.flatMap((c) => (c.exp ? [c.exp] : [])),
    { header: t('كود الحساب', 'Account code'), key: 'partyCode', width: 12 },
    { header: t('شريحة العمر', 'Age band'), key: 'ageBand', width: 14, transform: (v) => bandLabel(String(v)) },
    { header: t('حالة الاستحقاق', 'Due status'), key: 'dueState', width: 18, transform: (v) => dueLabel(String(v)) },
    { header: t('مدّة افتراضية', 'Default term'), key: 'termIsDefault', width: 10, transform: (v) => (v ? t('نعم', 'Yes') : t('لا', 'No')) },
    { header: t('بيان القضية', 'Case note'), key: 'issueNote', width: 28 },
  ];

  function patchRow(id: string, n: number) {
    setData((d) => (d ? { ...d, rows: d.rows.map((x) => (x._id === id ? { ...x, attachments: n } : x)) } : d));
  }

  const fetchAll = async (withFilters: boolean) => {
    const p = withFilters ? new URLSearchParams(qs) : new URLSearchParams();
    VIEW_KEYS.forEach((k) => { if (k !== 'sort' && k !== 'dir') p.delete(k); });
    p.set('limit', 'all');
    const d = await api.get<RowsResp>(`/api/collections-dept/receivables/rows?${p.toString()}`);
    return d.rows || [];
  };

  // ── رأسُ الصفحة: من أيّ بطاقةٍ جاءت، وما الفلاترُ عليها — وكلٌّ يُزال ──────
  const chips: { key: string; label: string; remove: () => void }[] = [
    ...node.map(([k, v]) => ({ key: `n:${k}`, label: nodeLabel(k, v, ar), remove: () => update((p) => p.delete(k)) })),
    ...(filters.officer.length ? [{ key: 'officer', label: `${t('المسؤول', 'Collector')}: ${filters.officer.join('، ')}`, remove: () => setFilters({ ...filters, officer: [] }) }] : []),
    ...(filters.parties.length ? [{
      key: 'parties',
      label: `${t('العميل', 'Customer')}: ${filters.parties.map((k) => facets?.facets?.parties.find((x) => x.value === k)?.label || data?.rows.find((x) => x.partyKey === k)?.partyName || k).join('، ')}`,
      remove: () => setFilters({ ...filters, parties: [] }),
    }] : []),
    ...(filters.pay.length ? [{ key: 'pay', label: `${t('نوع الدفع', 'Payment')}: ${filters.pay.map((k) => paymentKindLabel(k, ar)).join('، ')}`, remove: () => setFilters({ ...filters, pay: [] }) }] : []),
    ...(filters.dueState.length ? [{ key: 'dueState', label: `${t('الاستحقاق', 'Due')}: ${filters.dueState.map(dueLabel).join('، ')}`, remove: () => setFilters({ ...filters, dueState: [] }) }] : []),
    ...(filters.issue.length ? [{ key: 'issue', label: `${t('القضايا', 'Cases')}: ${filters.issue.map(issueLabel).join('، ')}`, remove: () => setFilters({ ...filters, issue: [] }) }] : []),
    ...(filters.from || filters.to ? [{ key: 'date', label: `${t('التاريخ', 'Date')}: ${filters.from || '…'} → ${filters.to || '…'}`, remove: () => setFilters({ ...filters, from: '', to: '' }) }] : []),
    ...(qParam ? [{ key: 'q', label: `${t('بحث', 'Search')}: ${qParam}`, remove: () => update((p) => p.delete('q')) }] : []),
    ...Object.entries(colFilters).map(([c, set]) => ({
      key: `cf:${c}`,
      label: `${t(...(COL_TITLES[c] || [c, c]))}: ${[...set].map((v) => (FORMAT[c] ? FORMAT[c](v) : v || t('(فارغ)', '(blank)'))).join('، ')}`,
      remove: () => update((p) => p.delete(`cf_${c}`)),
    })),
  ];
  const title = node.length ? node.map(([k, v]) => nodeLabel(k, v, ar)).join(' — ') : t('كلُّ المديونية', 'All receivables');
  const backHref = filterQs ? `${DASHBOARD_PATH}?${filterQs}` : DASHBOARD_PATH;
  const rows = data?.rows || [];
  const pages = data?.pages || 1;
  const Back = isRTL ? ArrowRight : ArrowLeft;

  return (
    <div className="space-y-4 pb-10" dir={isRTL ? 'rtl' : 'ltr'}>
      <PageHeader
        icon={<Layers className="w-6 h-6 text-[#f37121]" />}
        title={title}
        subtitle={t('تفاصيل المديونية — الصفوفُ نفسُها التي عُدّت في لوحة التحصيل', 'Receivables detail — the very rows the dashboard counted')}
      >
        <button type="button" onClick={() => router.push(backHref)}
          className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-slate-200 bg-white text-slate-600 text-sm hover:border-slate-300">
          <Back className="w-4 h-4" />{t('لوحة التحصيل', 'Dashboard')}
        </button>
        <ExportMenu
          fileName="collections-receivables"
          lang={ar ? 'ar' : 'en'}
          options={[
            { key: 'matching', label: t('كلّ نتائج الفلتر', 'All rows matching filter'), hint: data ? String(data.total) : undefined,
              resolve: async () => [{ name: t('المديونية', 'Receivables'), title, rows: await fetchAll(true), columns: exportCols }] },
            { key: 'all', label: t('كلُّ المديونية (بلا فلاتر)', 'All receivables (no filters)'),
              resolve: async () => [{ name: t('المديونية', 'Receivables'), rows: await fetchAll(false), columns: exportCols }] },
          ]}
        />
      </PageHeader>

      {/* من أين جاء الجدول — كلُّ شريحةٍ تُزال وحدَها */}
      <div className="flex flex-wrap items-center gap-1.5">
        <button type="button" onClick={() => router.push(backHref)} className="text-[12px] text-slate-500 hover:text-slate-900">
          {t('لوحة التحصيل', 'Collections dashboard')}
        </button>
        <span className="text-slate-300 text-[12px]">/</span>
        {chips.length === 0 && <span className="text-[12px] text-slate-500">{t('بلا فلاتر', 'No filters')}</span>}
        {chips.map((c) => (
          <span key={c.key} className="inline-flex items-center gap-1 ps-2.5 pe-1 py-1 rounded-full bg-white border border-slate-200 text-[12px] text-slate-700">
            {c.label}
            <button type="button" onClick={c.remove} title={t('إزالة', 'Remove')} className="p-0.5 rounded-full text-slate-400 hover:text-slate-900"><X className="w-3 h-3" /></button>
          </span>
        ))}
        {chips.length > 1 && (
          <button type="button" onClick={() => router.replace(RECEIVABLES_PATH, { scroll: false })}
            className="text-[12px] text-slate-400 hover:text-red-600 ms-1">{t('إزالة الكلّ', 'Clear all')}</button>
        )}
      </div>

      <ReceivablesFilterBar filters={filters} onChange={setFilters} facets={facets?.facets} ar={ar} manager={facets?.manager} />

      {/* المجاميعُ على النتيجة كلِّها — وهي رقمُ البطاقة ما دامت القموعُ والبحثُ فارغة */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {[
          [t('العدد', 'Count'), data ? (reportsMode ? `${money(data.total)} ${t('كشف تخريج', 'reports')}` : unitsOf({ count: data.total, value: data.value, tax: data.taxCount, cash: data.cashCount }, ar)) : '—'],
          [t('القيمة', 'Value'), data ? money(data.value) : '—'],
          [t('المحصَّل منها', 'Collected'), data ? money(data.collected) : '—'],
          [t('المتبقّي', 'Remaining'), data ? money(data.remaining) : '—'],
        ].map(([label, v]) => (
          <div key={label} className="bg-white border border-slate-200 rounded-2xl shadow-[0_1px_2px_rgba(15,23,42,0.04)] text-center px-3 py-3">
            <p className="text-[11.5px] font-medium text-slate-500">{label}</p>
            <p className="mt-1 text-[18px] font-bold tabular-nums tracking-tight text-slate-900">{v}</p>
          </div>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[220px] max-w-md">
          <Search className="w-4 h-4 text-slate-400 absolute top-1/2 -translate-y-1/2 start-3" />
          <input value={q} onChange={(e) => setQ(e.target.value)}
            placeholder={t('ابحث برقم الفاتورة أو الكشف أو العميل أو الكود…', 'Search number, customer or code…')}
            className="w-full ps-9 pe-3 py-2 rounded-lg border border-slate-200 bg-white text-sm focus:outline-none focus:border-[#f37121]" />
        </div>
        {colCount > 0 && (
          <button type="button" onClick={() => update((p) => { Array.from(p.keys()).filter((k) => k.startsWith('cf_')).forEach((k) => p.delete(k)); })}
            className="inline-flex items-center gap-1 px-3 py-2 text-sm text-slate-400 hover:text-red-600">
            <X className="w-4 h-4" />{t(`إزالة فلاتر الأعمدة (${colCount})`, `Clear column filters (${colCount})`)}
          </button>
        )}
        <span className="ms-auto text-[12px] text-slate-500 tabular-nums">
          {data ? t(`${money(data.customers)} عميل`, `${money(data.customers)} customers`) : ''}
        </span>
      </div>

      <div className="relative bg-white border border-slate-200 rounded-xl overflow-hidden shadow-sm">
        {loading && <div className="refresh-bar" aria-hidden="true" />}
        <ScrollX aria-busy={loading}>
          <table className="w-full text-sm">
            <thead className="table-head">
              <tr>
                {cols.map((c) => (
                  <th key={c.key} className={`px-3 py-2.5 font-semibold whitespace-nowrap ${c.align === 'end' ? 'text-end' : c.align === 'center' ? 'text-center' : 'text-start'}`}>
                    <span className="inline-flex items-center gap-0.5">
                      {c.sort ? (
                        <button type="button" onClick={() => toggleSort(c.sort as string)} className="inline-flex items-center gap-1 hover:opacity-80">
                          {t(c.ar, c.en)}
                          {sort === c.sort ? (dir === 'asc' ? <ArrowUp className="w-3 h-3" /> : <ArrowDown className="w-3 h-3" />) : <ArrowUpDown className="w-3 h-3 opacity-40" />}
                        </button>
                      ) : t(c.ar, c.en)}
                      {c.filter && (
                        <ColumnFilter
                          field={c.filter}
                          selected={colFilters[c.filter] || EMPTY_SET}
                          onChange={(set) => setColFilter(c.filter as string, set)}
                          onOpen={() => fetchColOptions(c.filter as string)}
                          options={colOptions[c.filter]?.values || EMPTY_OPTS}
                          truncated={!!colOptions[c.filter]?.truncated}
                          loading={!!colLoading[c.filter]}
                          onQuery={(query) => fetchColOptions(c.filter as string, query)}
                          lang={ar ? 'ar' : 'en'}
                          format={FORMAT[c.filter]}
                        />
                      )}
                    </span>
                  </th>
                ))}
                <th className="px-2 py-2.5" />
              </tr>
            </thead>
            <tbody>
              {!rows.length ? (
                <tr><td colSpan={cols.length + 1} className="px-4 py-12 text-center text-slate-400">
                  {loading ? t('جارٍ التحميل…', 'Loading…') : t('لا صفوف', 'No rows')}
                </td></tr>
              ) : rows.map((r) => (
                <tr key={`${r.source || r.kind}:${r._id}`} onClick={() => openRow(r)}
                  className="border-b border-slate-100 hover:bg-slate-50 cursor-pointer">
                  {cols.map((c) => (
                    <td key={c.key} className={`px-3 py-2.5 align-top ${c.align === 'end' ? 'text-end' : c.align === 'center' ? 'text-center' : ''}`}>{c.cell(r)}</td>
                  ))}
                  <td className="px-2 py-2.5 align-top">
                    <ExternalLink className="w-3.5 h-3.5 text-slate-300" />
                  </td>
                </tr>
              ))}
            </tbody>
            {!!rows.length && data && (
              <tfoot>
                <tr className="bg-slate-50 border-t border-slate-200 font-semibold text-slate-800">
                  <td className="px-3 py-2.5 whitespace-nowrap" colSpan={cols.findIndex((c) => c.key === 'total')}>
                    {t('المجموع', 'Total')} · <span className="tabular-nums font-normal text-slate-500">{money(data.total)} {t('صف', 'rows')}</span>
                  </td>
                  <td className="px-3 py-2.5 text-end tabular-nums">{money(data.value)}</td>
                  <td className="px-3 py-2.5 text-end tabular-nums">{money(data.collected)}</td>
                  <td className="px-3 py-2.5 text-end tabular-nums">{money(data.remaining)}</td>
                  <td colSpan={cols.length - cols.findIndex((c) => c.key === 'remaining')} />
                </tr>
              </tfoot>
            )}
          </table>
        </ScrollX>

        <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 border-t border-slate-100 text-sm">
          <span className="text-slate-500 tabular-nums">
            {t(`صفحة ${page} من ${pages}`, `Page ${page} of ${pages}`)}
            <span className="text-slate-300"> · </span>
            <select value={limit} onChange={(e) => update((p) => p.set('limit', e.target.value))}
              className="bg-transparent text-slate-600 border border-slate-200 rounded-md px-1.5 py-0.5">
              {PAGE_SIZES.map((n) => <option key={n} value={n}>{n} {t('في الصفحة', 'per page')}</option>)}
            </select>
          </span>
          <div className="flex items-center gap-2">
            <button type="button" disabled={page <= 1} onClick={() => update((p) => p.set('page', String(page - 1)), true)}
              className="px-3 py-1.5 rounded-lg border border-slate-200 disabled:opacity-40">{t('السابق', 'Prev')}</button>
            <button type="button" disabled={page >= pages} onClick={() => update((p) => p.set('page', String(page + 1)), true)}
              className="px-3 py-1.5 rounded-lg border border-slate-200 disabled:opacity-40">{t('التالي', 'Next')}</button>
          </div>
        </div>
      </div>
    </div>
  );
}

/** أسماءُ قموع الأعمدة في رأس الصفحة. */
const COL_TITLES: Record<string, [string, string]> = {
  customer: ['العميل', 'Customer'], code: ['الكود', 'Code'], officer: ['المسؤول', 'Collector'],
  payKind: ['نوع الدفع', 'Payment type'], invoiceDate: ['الإصدار', 'Issued'], deliveryDate: ['التسليم', 'Delivered'],
  term: ['المدّة', 'Term'], termSource: ['مصدر المدّة', 'Term source'], dueDate: ['الاستحقاق', 'Due date'],
  ageBand: ['شريحة العمر', 'Age band'], risk: ['الخطورة', 'Risk'], dueState: ['حالة الاستحقاق', 'Due status'],
  issue: ['حالة القضية', 'Case state'], attach: ['المرفقات', 'Files'], number: ['الرقم', 'Number'],
};

/** «YYYY-MM-DD» من الخادم (يومُ الرياض) — يُعرَض كما هو بلا إعادة تفسير. */
function ymdLabel(v: any) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(v || ''));
  return m ? `${m[3]}/${m[2]}/${m[1]}` : (v ? String(v) : '—');
}
