'use client';
/**
 * لوحةُ التحصيل — ما لنا وما علينا، ومَن أكبرُ المتأخّرين، وأين تتراكم.
 *
 * الرقمُ الواحد «مستحقٌّ كذا» لا يقول شيئًا عن خطره: مليونٌ عمرُه أسبوعٌ عملٌ
 * جارٍ، ومليونٌ عمرُه سنةٌ مالٌ يكاد يضيع. فمعه تقادمُه دائمًا.
 *
 * وكلُّ بطاقةٍ تفتح ما تعدّه: الرقمُ يليه سؤالٌ واحدٌ — أيُّها؟
 */
import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { useLanguage } from '@/context/LanguageContext';
import { useDialog } from '@/components/system/DialogProvider';
import api from '@/lib/api';
import { money, dt, receivablesOnly } from '@/lib/collections';
import { useAuth } from '@/context/AuthContext';
import { Spinner, PageHeader, Field, Select } from '@/components/hr/HRKit';
import DateRangeFilter from '@/components/system/DateRangeFilter';
import ExportMenu from '@/components/ls2/ExportMenu';
import CreditAlerts from '@/components/collections/CreditAlerts';
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Legend,
  LineChart, Line,
} from 'recharts';
import { Wallet, Users, Truck, TrendingDown, ChevronLeft, SlidersHorizontal, X } from 'lucide-react';

interface Side {
  reports: number; total: number; settled: number; outstanding: number;
  settledCount: number; openReports: number;
  top: { name: string; reports: number; outstanding: number; oldest: string | null }[];
}
interface Dash {
  customers: Side; suppliers?: Side;
  monthly: { month: string; total: number; settled: number; outstanding: number }[];
  aging: { customer: { bucket: string; amount: number }[]; supplier?: { bucket: string; amount: number }[] };
  byBranch: { branch: string; reports: number; receivable: number; payable?: number }[];
  counts: { customer: { active: number; inactive: number }; supplier: { active: number; inactive: number } };
}

/** شرائحُ العمر — هي هي في اللوحة وفي صفحتَي الفواتير. */
const AGE_BANDS: [string, string, string][] = [
  ['0_15', 'حتى ١٥ يومًا', 'Up to 15 days'],
  ['15_30', 'من ١٥ إلى ٣٠', '15 – 30 days'],
  ['30_45', 'من ٣٠ إلى ٤٥', '30 – 45 days'],
  ['45_60', 'من ٤٥ إلى ٦٠', '45 – 60 days'],
  ['60_plus', 'أكثر من ٦٠', 'Over 60 days'],
];

export default function CollectionsDashboardPage() {
  const { user } = useAuth();
  // ── ما علينا والصافي ليسا شغلَ التحصيل ──────────────────────────────────
  // القسمُ يُحصِّل؛ ما ندفعه للموردين والصافيُ بينهما شأنُ الإدارة والمالية.
  // ويُخفَيان بالدور لا بالقسم: مَن يفتح القسمَ من الإدارة يرى الوجهين.
  const receivables = receivablesOnly(user);
  const { lang, isRTL } = useLanguage();
  const ar = lang === 'ar';
  const t = (a: string, e: string) => (ar ? a : e);
  const { notify } = useDialog();
  const router = useRouter();

  const [data, setData] = useState<Dash | null>(null);
  const [loading, setLoading] = useState(true);
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  // ── واللوحةُ تُفلتر كما تُفلتر الصفحات ────────────────────────────────────
  // لوحةٌ لا تقبل إلّا مدًى تُقرأ مرّةً ثمّ يُنزَل منها إلى الصفحات لتُقرأ
  // ثانيةً. والأسئلةُ التي تُطرح عليها هي هي: عميلٌ بعينه، ومورّد، وفرع،
  // وشريحةُ عمر.
  const [customer, setCustomer] = useState('');
  const [supplier, setSupplier] = useState('');
  const [branch, setBranch] = useState('');
  const [age, setAge] = useState('');
  const [showFilters, setShowFilters] = useState(false);
  const [opts, setOpts] = useState<{ customers: string[]; suppliers: string[]; branches: string[] }>(
    { customers: [], suppliers: [], branches: [] },
  );
  const activeCount = [customer, supplier, branch, age, from, to].filter(Boolean).length;

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const p = new URLSearchParams();
      if (from) p.set('from', from);
      if (to) p.set('to', to);
      if (customer) p.set('customer', customer);
      if (supplier) p.set('supplier', supplier);
      if (branch) p.set('branch', branch);
      if (age) p.set('age', age);
      setData(await api.get<Dash>(`/api/collections-dept/dashboard?${p.toString()}`));
    } catch (e: any) { notify(e?.message || t('تعذّر التحميل', 'Could not load'), 'error'); }
    setLoading(false);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [from, to, customer, supplier, branch, age]);
  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    api.get<typeof opts>('/api/collections-dept/dashboard/filters').then(setOpts).catch(() => {});
  }, []);

  if (loading && !data) return <Spinner />;
  if (!data) return null;

  const C = data.customers;
  // الخادمُ لا يُرسل الموردين لمن لا يراهم — فيُقرأ الغيابُ لا يُفترَض الوجود.
  const S = data.suppliers || { reports: 0, total: 0, settled: 0, outstanding: 0, settledCount: 0, openReports: 0, top: [] };
  // ما يبقى لنا بعد سداد ما علينا — الرقمُ الذي يُسأل عنه بعد الرقمين.
  const net = C.outstanding - S.outstanding;

  const Card = ({ label, value, sub, accent, onClick }: {
    label: string; value: string; sub?: string; accent?: string; onClick?: () => void;
  }) => (
    <div
      onClick={onClick}
      className={`bg-white border border-slate-200 rounded-xl p-4 shadow-sm min-w-0 ${onClick ? 'cursor-pointer hover:border-[#f37121]/50 hover:shadow-md transition-all' : ''}`}
    >
      <p className="text-[11px] text-slate-500 flex items-center gap-1">
        {label}{onClick && <ChevronLeft className={`w-3 h-3 text-slate-300 ${isRTL ? '' : 'rotate-180'}`} />}
      </p>
      <p className={`text-2xl font-bold tabular-nums break-words ${accent || 'text-slate-900'}`} title={value}>{value}</p>
      {sub && <p className="text-[11px] text-slate-400 mt-0.5">{sub}</p>}
    </div>
  );

  const Panel = ({ title, children, right }: { title: string; children: React.ReactNode; right?: React.ReactNode }) => (
    <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-sm">
      <div className="flex items-center justify-between mb-3">
        <p className="text-[13px] font-bold text-slate-900">{title}</p>
        {right}
      </div>
      {children}
    </div>
  );

  const agingRows = data.aging.customer.map((c, i) => ({
    bucket: c.bucket,
    [t('لنا', 'Receivable')]: c.amount,
    ...(receivables ? {} : { [t('علينا', 'Payable')]: data.aging.supplier?.[i]?.amount || 0 }),
  }));

  const topCols = [
    { header: t('الاسم', 'Name'), key: 'name', width: 34 },
    { header: t('كشوف', 'Reports'), key: 'reports', width: 10 },
    { header: t('المستحق', 'Outstanding'), key: 'outstanding', width: 16 },
    { header: t('أقدم كشف', 'Oldest'), key: 'oldest', width: 14 },
  ];

  const TopTable = ({ rows, kind }: { rows: Side['top']; kind: 'customer' | 'supplier' }) => (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="table-head">
          <tr>
            {[t('الاسم', 'Name'), t('كشوف', 'Reports'), t('المستحق', 'Outstanding'), t('أقدم كشف', 'Oldest')].map((h, i) => (
              <th key={i} className="px-3 py-2 text-start font-semibold whitespace-nowrap">{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr><td colSpan={4} className="px-3 py-8 text-center text-slate-400">{t('لا شيء مستحق', 'Nothing outstanding')}</td></tr>
          ) : rows.map((r, i) => (
            <tr
              key={i}
              className="border-b border-slate-100 hover:bg-slate-50 cursor-pointer"
              onClick={() => router.push(`/system/collections-dept/${kind === 'customer' ? 'customers' : 'suppliers'}?q=${encodeURIComponent(r.name)}`)}
            >
              <td className="px-3 py-2 font-medium text-slate-900">{r.name}</td>
              <td className="px-3 py-2 tabular-nums text-slate-600">{money(r.reports)}</td>
              <td className="px-3 py-2 tabular-nums font-semibold text-red-600">{money(r.outstanding)}</td>
              <td className="px-3 py-2 text-slate-500 whitespace-nowrap">{dt(r.oldest)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );

  return (
    <div className="space-y-5 pb-10" dir={isRTL ? 'rtl' : 'ltr'}>
      <PageHeader
        icon={<Wallet className="w-6 h-6 text-[#f37121]" />}
        title={t('لوحة التحصيل', 'Collections dashboard')}
        subtitle={t('محسوبةٌ من كشوف التشغيل مباشرةً — لا من جدولٍ يُملأ باليد', 'Computed straight from the operations reports')}
      >
        <ExportMenu
          fileName="collections-dashboard"
          lang={ar ? 'ar' : 'en'}
          options={[{
            key: 'shown',
            label: t('المعروض', 'Shown'),
            sheets: [
              { name: t('أكبر المتأخرين — عملاء', 'Top customers due'), rows: C.top, columns: topCols },
              ...(receivables ? [] : [{ name: t('أكبر المتأخرين — موردون', 'Top suppliers due'), rows: S.top, columns: topCols }]),
              {
                name: t('بالفرع', 'By branch'),
                rows: data.byBranch,
                columns: [
                  { header: t('الفرع', 'Branch'), key: 'branch', width: 18 },
                  { header: t('كشوف', 'Reports'), key: 'reports', width: 10 },
                  { header: t('لنا', 'Receivable'), key: 'receivable', width: 16 },
                  // الملفُّ لا يخرج بما لا يُعرَض: الحجبُ على الشاشة وحدَها
                  // يلتفّ حوله زرُّ تصدير.
                  ...(receivables ? [] : [{ header: t('علينا', 'Payable'), key: 'payable', width: 16 }]),
                ],
              },
              {
                name: t('بالشهر', 'Monthly'),
                rows: data.monthly,
                columns: [
                  { header: t('الشهر', 'Month'), key: 'month', width: 12 },
                  { header: t('المبيعات', 'Billed'), key: 'total', width: 16 },
                  { header: t('المحصَّل', 'Collected'), key: 'settled', width: 16 },
                  { header: t('المتبقي', 'Outstanding'), key: 'outstanding', width: 16 },
                ],
              },
            ],
          }]}
        />
      </PageHeader>

      {/* ── ما يحتاج تصرّفًا اليوم، فوق كلّ شيء ────────────────────────────
          اللوحةُ تقول ما حدث؛ وهذا يقول ما يجب أن يحدث: مَن قارب حدَّه، وأيُّ
          فاتورةٍ تستحقّ بعد يومين. ووضعُه تحت الأرقام يجعله يُقرأ بعد أن
          يكون قد فات. */}
      <CreditAlerts compact />

      {/* المدى اختياريّ: بلا مدًى تُقرأ الصورةُ كلُّها، وهي ما يُسأل عنه أوّلًا. */}
      <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-sm space-y-4">
        <div className="flex flex-wrap items-center gap-3">
          <DateRangeFilter from={from} to={to} onFrom={setFrom} onTo={setTo} ar={ar} />
          <button type="button" onClick={() => setShowFilters((p) => !p)}
            className={`inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-sm font-semibold border transition-colors ${
              activeCount ? 'bg-[#f37121] text-white border-[#f37121]' : 'bg-white border-slate-200 text-slate-600 hover:text-slate-900'}`}>
            <SlidersHorizontal className="w-4 h-4" />{t('فلاتر', 'Filters')}{activeCount ? ` (${activeCount})` : ''}
          </button>
          {activeCount > 0 && (
            <button type="button"
              onClick={() => { setCustomer(''); setSupplier(''); setBranch(''); setAge(''); setFrom(''); setTo(''); }}
              className="inline-flex items-center gap-1.5 px-3 py-2 text-slate-400 hover:text-red-600 text-sm">
              <X className="w-4 h-4" />{t('إزالة الفلاتر', 'Clear')}
            </button>
          )}
        </div>

        {showFilters && (
          <div className="space-y-4 border-t border-slate-100 pt-4">
            {/* شرائحُ العمر لا تتداخل: «من ١٥ إلى ٣٠» لا «كلُّ ما تجاوز ١٥» —
                فمجموعُها يساوي الكلَّ ولا يُعدّ الكشفُ مرّتين. */}
            <div>
              <p className="text-[12px] font-bold text-slate-600 mb-2">{t('عمر الكشف', 'Report age')}</p>
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
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <Field label={t('العميل', 'Customer')}>
                <Select value={customer} onChange={(e) => setCustomer(e.target.value)}>
                  <option value="">{t('جميع العملاء', 'All customers')}</option>
                  {opts.customers.map((c) => <option key={c} value={c}>{c}</option>)}
                </Select>
              </Field>
              {/* المورّدُ لمن يرى ما علينا — والخادمُ لا يُرسل أسماءهم لغيره. */}
              {opts.suppliers.length > 0 && (
                <Field label={t('المورد', 'Supplier')}>
                  <Select value={supplier} onChange={(e) => setSupplier(e.target.value)}>
                    <option value="">{t('جميع الموردين', 'All suppliers')}</option>
                    {opts.suppliers.map((c) => <option key={c} value={c}>{c}</option>)}
                  </Select>
                </Field>
              )}
              <Field label={t('الفرع', 'Branch')}>
                <Select value={branch} onChange={(e) => setBranch(e.target.value)}>
                  <option value="">{t('جميع الفروع', 'All branches')}</option>
                  {opts.branches.map((b) => <option key={b} value={b}>{b}</option>)}
                </Select>
              </Field>
            </div>
          </div>
        )}
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Card
          label={t('المستحق لنا (العملاء)', 'Receivable (customers)')}
          value={money(C.outstanding)}
          sub={t(`${money(C.openReports)} كشفًا لم تُحصَّل`, `${money(C.openReports)} uncollected reports`)}
          accent="text-red-600"
          onClick={() => router.push('/system/collections-dept/customers')}
        />
        {!receivables && (
          <Card
            label={t('المستحق علينا (الموردون)', 'Payable (suppliers)')}
            value={money(S.outstanding)}
            sub={t(`${money(S.openReports)} كشفًا لم تُسدَّد`, `${money(S.openReports)} unpaid reports`)}
            accent="text-amber-600"
            onClick={() => router.push('/system/collections-dept/suppliers')}
          />
        )}
        {!receivables && (
          <Card
            label={t('الصافي', 'Net position')}
            value={money(net)}
            sub={t('ما يبقى لنا بعد سداد ما علينا', 'What is left after paying what we owe')}
            accent={net >= 0 ? 'text-emerald-600' : 'text-red-600'}
          />
        )}
        {/* ومكانُهما لمن لا يراهما: ما يخصّه — كم فاتورةً بقيت وكم عمرُها. */}
        {receivables && (
          <Card
            label={t('كشوف لم تُحصَّل', 'Uncollected reports')}
            value={money(C.openReports)}
            sub={t('من كشوف التشغيل', 'from the operations reports')}
            accent="text-amber-600"
            onClick={() => router.push('/system/collections-dept/invoices/tax')}
          />
        )}
        <Card
          label={t('نسبة التحصيل', 'Collection rate')}
          value={C.total ? `${Math.round((C.settled / C.total) * 1000) / 10}%` : '—'}
          sub={t(`${money(C.settled)} من ${money(C.total)}`, `${money(C.settled)} of ${money(C.total)}`)}
          accent="text-slate-900"
        />
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Card
          label={t('عملاء مسجَّلون', 'Registered customers')}
          value={money(data.counts.customer.active)}
          sub={data.counts.customer.inactive ? t(`${money(data.counts.customer.inactive)} معطَّل`, `${money(data.counts.customer.inactive)} inactive`) : undefined}
          onClick={() => router.push('/system/collections-dept/customers')}
        />
        <Card
          label={t('موردون مسجَّلون', 'Registered suppliers')}
          value={money(data.counts.supplier.active)}
          sub={data.counts.supplier.inactive ? t(`${money(data.counts.supplier.inactive)} معطَّل`, `${money(data.counts.supplier.inactive)} inactive`) : undefined}
          onClick={() => router.push('/system/collections-dept/suppliers')}
        />
        <Card label={t('إجمالي المبيعات', 'Total billed')} value={money(C.total)} sub={t(`${money(C.reports)} كشفًا`, `${money(C.reports)} reports`)} />
        {!receivables && (
          <Card label={t('إجمالي المشتريات', 'Total purchased')} value={money(S.total)} sub={t(`${money(S.reports)} كشفًا`, `${money(S.reports)} reports`)} />
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Panel title={t('تقادم المستحق', 'Ageing of outstanding')}>
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={agingRows}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                <XAxis dataKey="bucket" tick={{ fontSize: 11 }} />
                <YAxis tick={{ fontSize: 11 }} width={70} />
                <Tooltip formatter={(v: any) => money(v)} />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                <Bar dataKey={t('لنا', 'Receivable')} fill="#ef4444" radius={[4, 4, 0, 0]} />
                {!receivables && <Bar dataKey={t('علينا', 'Payable')} fill="#f59e0b" radius={[4, 4, 0, 0]} />}
              </BarChart>
            </ResponsiveContainer>
          </div>
          <p className="text-[11px] text-slate-400 mt-2">
            {t('بالأيّام منذ تاريخ الكشف — الملغاة مستثناة', 'Days since the report date — cancelled excluded')}
          </p>
        </Panel>

        <Panel title={t('المبيعات والمحصَّل بالشهر', 'Billed vs collected, by month')}>
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={data.monthly}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                <XAxis dataKey="month" tick={{ fontSize: 11 }} />
                <YAxis tick={{ fontSize: 11 }} width={70} />
                <Tooltip formatter={(v: any) => money(v)} />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                <Line type="monotone" dataKey="total" name={t('المبيعات', 'Billed')} stroke="#334155" strokeWidth={2} dot={false} />
                <Line type="monotone" dataKey="settled" name={t('المحصَّل', 'Collected')} stroke="#10b981" strokeWidth={2} dot={false} />
                <Line type="monotone" dataKey="outstanding" name={t('المتبقي', 'Outstanding')} stroke="#ef4444" strokeWidth={2} dot={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </Panel>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Panel
          title={t('أكبر المتأخّرين — عملاء', 'Largest amounts due — customers')}
          right={<span className="text-[11px] text-slate-400 inline-flex items-center gap-1"><Users className="w-3.5 h-3.5" />{t('أعلى ١٥', 'Top 15')}</span>}
        >
          <TopTable rows={C.top} kind="customer" />
        </Panel>
        {!receivables && (
          <Panel
            title={t('أكبر المستحقّ — موردون', 'Largest amounts owed — suppliers')}
            right={<span className="text-[11px] text-slate-400 inline-flex items-center gap-1"><Truck className="w-3.5 h-3.5" />{t('أعلى ١٥', 'Top 15')}</span>}
          >
            <TopTable rows={S.top} kind="supplier" />
          </Panel>
        )}
      </div>

      <Panel
        title={t('بالفرع', 'By branch')}
        right={<span className="text-[11px] text-slate-400 inline-flex items-center gap-1"><TrendingDown className="w-3.5 h-3.5" />{t('غير المُقفَل', 'Open only')}</span>}
      >
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="table-head">
              <tr>
                {[t('الفرع', 'Branch'), t('كشوف', 'Reports'), t('المستحق لنا', 'Receivable'),
                  ...(receivables ? [] : [t('المستحق علينا', 'Payable'), t('الصافي', 'Net')])].map((h, i) => (
                  <th key={i} className="px-3 py-2 text-start font-semibold whitespace-nowrap">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {data.byBranch.map((b) => (
                <tr key={b.branch} className="border-b border-slate-100">
                  <td className="px-3 py-2 font-medium text-slate-900">{b.branch}</td>
                  <td className="px-3 py-2 tabular-nums text-slate-600">{money(b.reports)}</td>
                  <td className="px-3 py-2 tabular-nums text-red-600">{money(b.receivable)}</td>
                  {!receivables && <td className="px-3 py-2 tabular-nums text-amber-600">{money(b.payable)}</td>}
                  {!receivables && (
                    <td className={`px-3 py-2 tabular-nums font-semibold ${b.receivable - (b.payable || 0) >= 0 ? 'text-emerald-700' : 'text-red-600'}`}>
                      {money(b.receivable - (b.payable || 0))}
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>
    </div>
  );
}
