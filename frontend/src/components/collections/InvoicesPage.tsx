'use client';
/**
 * فواتيرُ التحصيل — الكاشُ والضريبيّ، بالصفحة نفسِها ونوعين.
 *
 * ── من هنا يعمل القسم ──────────────────────────────────────────────────────
 * التحصيلُ لا يُحصِّل كشوفًا؛ يُحصِّل فواتير. والكشفُ الذي لم يُفوتَر لا شأنَ
 * له بالقسم — إلّا أن يكون نقديًّا، فالنقديُّ يُحصَّل في يومه بلا فاتورة
 * ويُعرَف برقم كشفه.
 *
 * والفرقُ بين الوجهين ليس شكلًا: النقديُّ صفُّه كشفٌ ويكتب المحصِّلُ ما قبضه،
 * والضريبيُّ صفُّه فاتورةٌ قد تضمّ كشوفًا وقيمتُها مكتوبةٌ فيها.
 */
import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/context/AuthContext';
import { useLanguage } from '@/context/LanguageContext';
import { useDialog } from '@/components/system/DialogProvider';
import api from '@/lib/api';
import { useLatestRequest } from '@/hooks/useLatestRequest';
import { useSocket } from '@/hooks/useSocket';
import { canEditCollections, money, dt } from '@/lib/collections';
import { Spinner, PageHeader, SearchInput, PrimaryButton, Modal, Field, TextInput, Select, Loader2 } from '@/components/hr/HRKit';
import DateRangeFilter from '@/components/system/DateRangeFilter';
import ExportMenu, { type ExportColumn } from '@/components/ls2/ExportMenu';
import { Banknote, Receipt, SlidersHorizontal, X, CheckCircle2, ChevronLeft, Truck } from 'lucide-react';

export type InvoiceKind = 'cash' | 'tax';

interface CashRow {
  _id: string; reportNumber: string; customer: string; branch: string; payingBranch: string;
  paymentDate: string | null; route: string; collectedAmount: number; collectionDate: string | null;
  ageDays: number | null;
}
interface TaxRow {
  invoiceNumber: string; customer: string; value: number; net: number; vat: number;
  invoiceDate: string | null; deliveryDate: string | null; branch: string; payingBranch: string;
  reports: number; collectedReports: number; fullyCollected: boolean;
  collectionDate: string | null; ageDays: number | null;
}

/**
 * شرائحُ العمر — لا تتداخل.
 *
 * «فوق ١٥ يومًا» تعني من خمسةَ عشرَ إلى ثلاثين، لا كلَّ ما تجاوزها. والشرائحُ
 * المتداخلة تجعل الفاتورةَ الواحدة تُعدّ في أربعة أرقام، فلا يُعرف كم فاتورةً
 * في كلّ عمرٍ حقًّا — ومجموعُ الشرائح يزيد على الكلّ.
 */
const AGE_BANDS: [string, string, string][] = [
  ['0_15', 'حتى ١٥ يومًا', 'Up to 15 days'],
  ['15_30', 'من ١٥ إلى ٣٠', '15 – 30 days'],
  ['30_45', 'من ٣٠ إلى ٤٥', '30 – 45 days'],
  ['45_60', 'من ٤٥ إلى ٦٠', '45 – 60 days'],
  ['60_plus', 'أكثر من ٦٠', 'Over 60 days'],
];

export default function CollectionsInvoicesPage({ kind }: { kind: InvoiceKind }) {
  const { user } = useAuth();
  const { lang, isRTL } = useLanguage();
  const ar = lang === 'ar';
  const t = (a: string, e: string) => (ar ? a : e);
  const { notify } = useDialog();
  const router = useRouter();
  const canEdit = canEditCollections(user);
  const isCash = kind === 'cash';

  const [rows, setRows] = useState<(CashRow | TaxRow)[]>([]);
  const [totals, setTotals] = useState<any>({});
  const [total, setTotal] = useState(0);
  const [pages, setPages] = useState(1);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  // ── حالةُ التحصيل فوق الجدول لا داخلَ الفلاتر ─────────────────────────────
  // السؤالُ يُطرح على الوجهين كلَّ يوم: «ما الذي بقي؟» و«كم حصّلنا؟». فالاختيارُ
  // ظاهرٌ لا مخبوءٌ خلف زرّ، والبطاقاتُ فوقه تتحرّك معه.
  const [collected, setCollected] = useState<'' | 'no' | 'yes'>('');
  const [q, setQ] = useState('');
  const [age, setAge] = useState('');
  const [customer, setCustomer] = useState('');
  const [branch, setBranch] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [showFilters, setShowFilters] = useState(false);
  const [opts, setOpts] = useState<{ customers: string[]; branches: string[] }>({ customers: [], branches: [] });

  const activeCount = [age, customer, branch, from, to].filter(Boolean).length;

  // ── تسجيلُ التحصيل ────────────────────────────────────────────────────────
  const [collecting, setCollecting] = useState<{ label: string; invoiceNumber?: string; ids?: string[]; needAmount: boolean } | null>(null);
  // ── والتسليمُ خطوةٌ قبل التحصيل ───────────────────────────────────────────
  // الفاتورةُ تُرسَل وتُستلَم ويُوقَّع عليها، ومن يومئذٍ تُعَدُّ المدّةُ المتّفق
  // عليها. وكانت الشاشةُ تسجّل التحصيل وحدَه، فيبقى «متى وصلت العميل؟» بلا
  // جوابٍ إلّا في ورقةٍ خارج النظام — وهو أوّلُ ما يُسأل عند كلّ مطالبة.
  const [delivering, setDelivering] = useState<{ label: string; invoiceNumber?: string; ids?: string[] } | null>(null);
  const [deliveryDate, setDeliveryDate] = useState('');
  const [collectForm, setCollectForm] = useState({ collectionDate: '', collectedAmount: '' });
  const [saving, setSaving] = useState(false);

  const guard = useLatestRequest();

  const load = useCallback(async (background = false) => {
    const mine = guard.begin();
    if (!background) setRefreshing(true);
    try {
      const p = new URLSearchParams({ page: String(page), limit: '100' });
      if (q.trim()) p.set('q', q.trim());
      if (collected) p.set('collected', collected);
      if (age) p.set('age', age);
      if (customer) p.set('customer', customer);
      if (branch) p.set('branch', branch);
      if (from) p.set('from', from);
      if (to) p.set('to', to);
      const d = await api.get<any>(`/api/collections-dept/invoices/${kind}?${p.toString()}`);
      if (!guard.isCurrent(mine)) return;
      setRows(d.invoices || []);
      setTotals(d.totals || {});
      setTotal(d.total || 0);
      setPages(d.pages || 1);
    } catch (e: any) {
      if (guard.isCurrent(mine)) notify(e?.message || t('تعذّر التحميل', 'Could not load'), 'error');
    } finally {
      // الرايةُ تُطفأ دائمًا: ربطُها بـ«الأحدث يفوز» يُبقيها مشتعلةً أبدًا في
      // صفحةٍ يعمل عليها فريق.
      if (!background) setRefreshing(false);
      setLoading(false);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kind, page, q, collected, age, customer, branch, from, to]);

  const first = useRef(true);
  useEffect(() => {
    if (first.current) { first.current = false; load(); return; }
    const id = setTimeout(() => load(), 300);
    return () => clearTimeout(id);
  }, [load]);

  useEffect(() => { setPage(1); }, [q, collected, age, customer, branch, from, to]);

  // التحصيلُ يُكتب على الكشف، فأيُّ تعديلٍ هناك يُحدِّث هنا في لحظته.
  useSocket('workflow:updated', useCallback(() => { load(true); }, [load]));

  useEffect(() => {
    api.get<{ customers: string[]; branches: string[] }>(`/api/collections-dept/invoices/filters?kind=${kind}`)
      .then(setOpts).catch(() => {});
  }, [kind]);

  const openCollect = (r: any) => {
    const today = new Date().toISOString().slice(0, 10);
    if (isCash) {
      setCollecting({ label: r.reportNumber, ids: [r._id], needAmount: true });
      setCollectForm({ collectionDate: r.collectionDate?.slice(0, 10) || today, collectedAmount: r.collectedAmount ? String(r.collectedAmount) : '' });
    } else {
      setCollecting({ label: r.invoiceNumber, invoiceNumber: r.invoiceNumber, needAmount: false });
      setCollectForm({ collectionDate: r.collectionDate?.slice(0, 10) || today, collectedAmount: '' });
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
      const r = await api.post<{ message: string }>('/api/collections-dept/invoices/deliver', {
        invoiceNumber: delivering?.invoiceNumber,
        ids: delivering?.ids,
        deliveryDate,
      });
      notify(r?.message || t('سُجِّل التسليم', 'Delivery recorded'));
      setDelivering(null);
      load();
    } catch (e: any) { notify(e?.message || t('تعذّر الحفظ', 'Could not save'), 'error'); }
    setSaving(false);
  };

  const saveCollect = async () => {
    if (!collectForm.collectionDate) { notify(t('تاريخ التحصيل مطلوب', 'Collection date required'), 'error'); return; }
    if (collecting?.needAmount && !String(collectForm.collectedAmount).trim()) {
      notify(t('مبلغ التحصيل مطلوب', 'Collected amount required'), 'error'); return;
    }
    setSaving(true);
    try {
      const r = await api.post<{ message: string }>('/api/collections-dept/invoices/collect', {
        invoiceNumber: collecting?.invoiceNumber,
        ids: collecting?.ids,
        collectionDate: collectForm.collectionDate,
        ...(collecting?.needAmount ? { collectedAmount: Number(collectForm.collectedAmount) || 0 } : {}),
      });
      notify(r?.message || t('سُجِّل التحصيل', 'Collection recorded'));
      setCollecting(null);
      load();
    } catch (e: any) { notify(e?.message || t('تعذّر الحفظ', 'Could not save'), 'error'); }
    setSaving(false);
  };

  const cols: ExportColumn[] = isCash
    ? [
      { header: t('رقم كشف التخريج', 'Report no.'), key: 'reportNumber', width: 18 },
      { header: t('العميل', 'Customer'), key: 'customer', width: 30 },
      { header: t('تاريخ السداد', 'Paid on'), key: 'paymentDate', width: 14, transform: (v: any) => dt(v) },
      { header: t('الفرع المسدد', 'Paying branch'), key: 'payingBranch', width: 14 },
      { header: t('مبلغ التحصيل', 'Collected'), key: 'collectedAmount', width: 14 },
      { header: t('تاريخ التحصيل', 'Collected on'), key: 'collectionDate', width: 14, transform: (v: any) => dt(v) },
      { header: t('العمر (يوم)', 'Age (days)'), key: 'ageDays', width: 12 },
    ]
    : [
      { header: t('رقم الفاتورة', 'Invoice no.'), key: 'invoiceNumber', width: 18 },
      { header: t('العميل', 'Customer'), key: 'customer', width: 30 },
      { header: t('القيمة', 'Value'), key: 'value', width: 16 },
      { header: t('عدد الكشوفات', 'Reports'), key: 'reports', width: 12 },
      { header: t('تاريخ الفاتورة', 'Invoice date'), key: 'invoiceDate', width: 14, transform: (v: any) => dt(v) },
      { header: t('تاريخ التسليم للعميل', 'Delivered to customer'), key: 'deliveryDate', width: 14, transform: (v: any) => dt(v) },
      { header: t('تاريخ التحصيل', 'Collected on'), key: 'collectionDate', width: 14, transform: (v: any) => dt(v) },
      { header: t('العمر (يوم)', 'Age (days)'), key: 'ageDays', width: 12 },
    ];

  const Stat = ({ label, value, accent }: { label: string; value: string | number; accent?: string }) => (
    <div className="bg-white border border-slate-200 rounded-xl px-4 py-3 shadow-sm min-w-0">
      <p className="text-[11px] text-slate-500 truncate">{label}</p>
      <p className={`text-xl font-bold tabular-nums break-words ${accent || 'text-slate-900'}`}>{value}</p>
    </div>
  );

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
          ? t('كشوفٌ نقديّة اكتمل سدادُها — تُحصَّل في يومها', 'Cash reports already paid out — collect same-day')
          : t('الفاتورةُ هي الوحدة، وقد تضمّ أكثر من كشف', 'The invoice is the unit — it may cover several reports')}
      >
        <ExportMenu
          fileName={`collections-${kind}-invoices`}
          lang={ar ? 'ar' : 'en'}
          options={[{ key: 'shown', label: t('المعروض', 'Shown'), sheets: [{ name: title, rows: rows as any, columns: cols }] }]}
        />
      </PageHeader>

      {/* ── حالةُ التحصيل ────────────────────────────────────────────────── */}
      <div className="flex items-center gap-2 flex-wrap">
        {([['', 'الكل', 'All'], ['no', 'لم يُحصَّل بعد', 'Not collected'], ['yes', 'تم تحصيله', 'Collected']] as const).map(([k, arL, enL]) => (
          <button key={k} type="button" onClick={() => setCollected(k as any)}
            className={`px-3.5 py-2 rounded-lg text-sm font-semibold transition-colors ${
              collected === k ? 'bg-[#f37121] text-white' : 'bg-white border border-slate-200 text-slate-600 hover:text-slate-900'}`}>
            {t(arL, enL)}
          </button>
        ))}
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <Stat label={isCash ? t('كشوف', 'Reports') : t('فواتير', 'Invoices')} value={money(total)} />
        {isCash ? (
          <>
            <Stat label={t('المحصَّل', 'Collected')} value={money(totals.collected)} accent="text-emerald-600" />
            <Stat label={t('عدد المحصَّل', 'Collected count')} value={money(totals.collectedCount)} accent="text-emerald-600" />
            <Stat label={t('لم يُحصَّل بعد', 'Outstanding count')} value={money(totals.pendingCount)} accent={totals.pendingCount ? 'text-red-600' : 'text-slate-400'} />
          </>
        ) : (
          <>
            <Stat label={t('قيمة الفواتير', 'Invoiced value')} value={money(totals.value)} />
            <Stat label={t('محصَّلة بالكامل', 'Fully collected')} value={money(totals.fullyCollected)} accent="text-emerald-600" />
            <Stat label={t('لم تُحصَّل بعد', 'Still open')} value={money(totals.pending)} accent={totals.pending ? 'text-red-600' : 'text-slate-400'} />
          </>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div className="flex-1 min-w-[220px]">
          <SearchInput value={q} onChange={setQ}
            placeholder={isCash
              ? t('بحث برقم الكشف أو العميل أو السند…', 'report no., customer, voucher…')
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
          {/* ── العمرُ شرائحُ لا تتداخل ──────────────────────────────────────
              «من ١٥ إلى ٣٠» لا «كلُّ ما تجاوز ١٥» — وإلّا عُدَّت الفاتورةُ
              الواحدة في أربع شرائح فلا يُعرف كم في كلّ عمر. */}
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
            <Field label={t('العميل', 'Customer')}>
              <Select value={customer} onChange={(e) => setCustomer(e.target.value)}>
                <option value="">{t('جميع العملاء', 'All customers')}</option>
                {opts.customers.map((c) => <option key={c} value={c}>{c}</option>)}
              </Select>
            </Field>
            <Field label={t('الفرع المسدد', 'Paying branch')}>
              <Select value={branch} onChange={(e) => setBranch(e.target.value)}>
                <option value="">{t('جميع الفروع', 'All branches')}</option>
                {opts.branches.map((b) => <option key={b} value={b}>{b}</option>)}
              </Select>
            </Field>
            <div className="sm:col-span-2 lg:col-span-1 flex items-end">
              {(activeCount > 0) && (
                <button type="button" onClick={() => { setAge(''); setCustomer(''); setBranch(''); setFrom(''); setTo(''); }}
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

      <div className="relative bg-white border border-slate-200 rounded-xl overflow-hidden shadow-sm">
        {refreshing && <div className="refresh-bar" aria-hidden="true" />}
        <div aria-busy={refreshing} className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="table-head">
              <tr>
                {(isCash
                  ? [t('رقم كشف التخريج', 'Report no.'), t('العميل', 'Customer'), t('المسار', 'Route'),
                    t('تاريخ السداد', 'Paid on'), t('الفرع المسدد', 'Paying branch'), t('العمر', 'Age'),
                    t('مبلغ التحصيل', 'Collected'), t('تاريخ التحصيل', 'Collected on'), '']
                  : [t('رقم الفاتورة', 'Invoice no.'), t('العميل', 'Customer'), t('عدد الكشوفات', 'Reports'),
                    t('القيمة', 'Value'), t('تاريخ الفاتورة', 'Invoice date'), t('التسليم للعميل', 'To customer'),
                    t('العمر', 'Age'), t('تاريخ التحصيل', 'Collected on'), '']
                ).map((h, i) => <th key={i} className="px-3 py-2.5 text-start font-semibold whitespace-nowrap">{h}</th>)}
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <tr><td colSpan={9} className="px-4 py-12 text-center text-slate-400">{t('لا نتائج', 'No results')}</td></tr>
              ) : isCash ? (rows as CashRow[]).map((r) => (
                <tr key={r._id} className="border-b border-slate-100 hover:bg-slate-50">
                  <td className="px-3 py-2.5 font-semibold text-slate-900 whitespace-nowrap">{r.reportNumber}</td>
                  <td className="px-3 py-2.5 text-slate-700">{r.customer || '—'}</td>
                  <td className="px-3 py-2.5 text-slate-500 whitespace-nowrap">{r.route || '—'}</td>
                  <td className="px-3 py-2.5 text-slate-600 whitespace-nowrap">{dt(r.paymentDate)}</td>
                  <td className="px-3 py-2.5 text-slate-600 whitespace-nowrap">{r.payingBranch || '—'}</td>
                  <td className="px-3 py-2.5 whitespace-nowrap">{ageChip(r.ageDays)}</td>
                  <td className="px-3 py-2.5 tabular-nums font-semibold text-emerald-700">{r.collectedAmount ? money(r.collectedAmount) : '—'}</td>
                  <td className={`px-3 py-2.5 whitespace-nowrap ${r.collectionDate ? 'text-emerald-700' : 'text-red-500'}`}>
                    {r.collectionDate ? dt(r.collectionDate) : t('لم يُحصَّل', 'open')}
                  </td>
                  <td className="px-3 py-2.5 whitespace-nowrap">
                    {canEdit && (
                      <button type="button" onClick={() => openCollect(r)}
                        className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-[#f37121]/10 text-[#f37121] text-xs font-semibold hover:bg-[#f37121]/20">
                        <CheckCircle2 className="w-3.5 h-3.5" />{r.collectionDate ? t('تعديل', 'Edit') : t('تحصيل', 'Collect')}
                      </button>
                    )}
                  </td>
                </tr>
              )) : (rows as TaxRow[]).map((r) => (
                <tr key={r.invoiceNumber} className="border-b border-slate-100 hover:bg-slate-50 cursor-pointer"
                  onClick={() => router.push(`/system/collections-dept/invoices/tax/${encodeURIComponent(r.invoiceNumber)}`)}>
                  <td className="px-3 py-2.5 font-semibold text-slate-900 whitespace-nowrap">{r.invoiceNumber}</td>
                  <td className="px-3 py-2.5 text-slate-700">{r.customer || '—'}</td>
                  {/* عددُ الكشوفات: الفاتورةُ الواحدة قد تضمّ أكثرَ من كشف. */}
                  <td className="px-3 py-2.5 tabular-nums text-slate-600">
                    {r.reports}
                    {r.reports > r.collectedReports && r.collectedReports > 0 && (
                      <span className="text-[11px] text-amber-600 ms-1">({r.collectedReports} {t('محصَّل', 'collected')})</span>
                    )}
                  </td>
                  <td className="px-3 py-2.5 tabular-nums font-semibold text-slate-900">{money(r.value)}</td>
                  <td className="px-3 py-2.5 text-slate-600 whitespace-nowrap">{dt(r.invoiceDate)}</td>
                  <td className="px-3 py-2.5 text-slate-600 whitespace-nowrap">{dt(r.deliveryDate)}</td>
                  <td className="px-3 py-2.5 whitespace-nowrap">{ageChip(r.ageDays)}</td>
                  <td className={`px-3 py-2.5 whitespace-nowrap ${r.fullyCollected ? 'text-emerald-700' : 'text-red-500'}`}>
                    {r.fullyCollected ? dt(r.collectionDate) : t('لم تُحصَّل', 'open')}
                  </td>
                  <td className="px-3 py-2.5 whitespace-nowrap" onClick={(e) => e.stopPropagation()}>
                    <div className="flex items-center gap-1">
                      {canEdit && (
                        <button type="button" onClick={() => openDeliver(r)}
                          className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-sky-50 text-sky-700 text-xs font-semibold hover:bg-sky-100"
                          title={t('تاريخُ وصول الفاتورة إلى العميل — منه تُعَدُّ المدّة', 'When the invoice reached the customer — the term starts here')}>
                          <Truck className="w-3.5 h-3.5" />{r.deliveryDate ? t('تعديل التسليم', 'Edit delivery') : t('تسليم', 'Deliver')}
                        </button>
                      )}
                      {canEdit && (
                        <button type="button" onClick={() => openCollect(r)}
                          className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-[#f37121]/10 text-[#f37121] text-xs font-semibold hover:bg-[#f37121]/20">
                          <CheckCircle2 className="w-3.5 h-3.5" />{r.fullyCollected ? t('تعديل', 'Edit') : t('تحصيل', 'Collect')}
                        </button>
                      )}
                      <ChevronLeft className={`w-4 h-4 text-slate-300 ${isRTL ? '' : 'rotate-180'}`} />
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

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
          {t('يوم استلام العميل للفاتورة — ومنه تبدأ مهلة السداد المتّفق عليها معه. يُكتب على كشوف الفاتورة في سير عمل التشغيل وفي دفتر التحصيل معًا، وهو غير «تاريخ التسليم للفرع» الذي يسجّله التشغيل.',
             'The day the customer received the invoice — the agreed credit term starts here. Written to the invoice\u2019s reports and the collections ledger together, and distinct from the branch delivery operations records.')}
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
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {/* النقديُّ يكتب المحصِّلُ ما قبضه بيده — والضريبيُّ قيمتُه في فاتورته. */}
          {collecting?.needAmount && (
            <Field label={t('مبلغ التحصيل *', 'Collected amount *')}>
              <TextInput type="number" value={collectForm.collectedAmount}
                onChange={(e) => setCollectForm((p) => ({ ...p, collectedAmount: e.target.value }))} />
            </Field>
          )}
          <Field label={t('تاريخ التحصيل *', 'Collection date *')}>
            <TextInput type="date" value={collectForm.collectionDate}
              onChange={(e) => setCollectForm((p) => ({ ...p, collectionDate: e.target.value }))} />
          </Field>
        </div>
        {!collecting?.needAmount && (
          <p className="text-[12px] text-slate-500 mt-3">
            {t('يُسجَّل التاريخ على كشوف هذه الفاتورة كلِّها — تحصيلُها تحصيلٌ لما فيها.',
              'The date is written to every report under this invoice.')}
          </p>
        )}
      </Modal>
    </div>
  );
}
