'use client';
/**
 * لوحةُ التحصيل — ما لنا، وكم عمرُه، وعند مَن، وأين.
 *
 * الرقمُ الواحد «مستحقٌّ كذا» لا يقول شيئًا عن خطره: مليونٌ عمرُه أسبوعٌ عملٌ
 * جارٍ، ومليونٌ عمرُه سنةٌ مالٌ يكاد يضيع. فمعه تقادمُه دائمًا.
 *
 * ── الترتيبُ هو ترتيبُ الأسئلة ──────────────────────────────────────────────
 *   ١. كم لنا، وكم حصّلنا منه؟          ← البطاقةُ الكبيرة ونسبةُ التحصيل
 *   ٢. ما الذي يحتاج تصرّفًا اليوم؟       ← تنبيهاتُ الحدود والاستحقاق
 *   ٣. كم عمرُ ما لنا؟ وكيف يسير الشهر؟   ← سلّمُ التقادم والرسمُ الشهريّ
 *   ٤. عند مَن؟ وفي أيّ فرع؟              ← أكبرُ المتأخّرين والفروع
 * وكلُّ بطاقةٍ تفتح ما تعدّه.
 *
 * ── «ما لنا» لا غير ─────────────────────────────────────────────────────────
 * القسمُ يُحصِّل؛ ما ندفعه للموردين والصافيُ بينهما شأنُ الإدارة والمالية،
 * ولوحةُ الحسابات تعرض الوجهين. فاللوحةُ هنا للجميع بلا إخفاءٍ بالدور.
 *
 * ── حيّة ────────────────────────────────────────────────────────────────────
 * كلُّ تعديلٍ على كشفٍ أو طرفٍ يعيد القراءة، والأرقامُ القائمة تبقى معروضةً حتى
 * يصل الجديد — لا تُمسح ولا تومض.
 *
 * والمكوّناتُ الصغيرة خارج الصفحة عمدًا: مكوّنٌ يُعرَّف داخل الرسم يُعاد إنشاؤه
 * مع كلّ تحديث، فتُفقَد حالتُه ويُعاد رسمُ الرسوم كلّها.
 */
import { useState, useEffect, useCallback, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { useLanguage } from '@/context/LanguageContext';
import { useDialog } from '@/components/system/DialogProvider';
import { useSocket } from '@/hooks/useSocket';
import api from '@/lib/api';
import { money, dt } from '@/lib/collections';
import SearchSelect from '@/components/system/SearchSelect';
import { Spinner, PageHeader, Field } from '@/components/hr/HRKit';
import DateRangeFilter from '@/components/system/DateRangeFilter';
import ExportMenu from '@/components/ls2/ExportMenu';
import CreditAlerts from '@/components/collections/CreditAlerts';
import {
  ComposedChart, Bar, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Legend,
} from 'recharts';
import {
  Wallet, Users, Building2, TrendingUp, FileText, CheckCircle2, Clock, ChevronLeft, SlidersHorizontal, X,
  UserCheck, Truck,
} from 'lucide-react';

interface Side {
  reports: number; total: number; settled: number; outstanding: number;
  settledCount: number; openReports: number;
  top: { name: string; reports: number; outstanding: number; oldest: string | null }[];
}
interface Dash {
  customers: Side;
  monthly: { month: string; total: number; settled: number; outstanding: number }[];
  aging: { customer: { bucket: string; amount: number }[] };
  byBranch: { branch: string; reports: number; receivable: number }[];
  counts: { customer: { active: number; inactive: number }; supplier: { active: number; inactive: number } };
}

/** شرائحُ العمر للفلتر — هي هي في صفحتَي الفواتير. */
const AGE_BANDS: [string, string, string][] = [
  ['0_15', 'حتى ١٥ يومًا', 'Up to 15 days'],
  ['15_30', 'من ١٥ إلى ٣٠', '15 – 30 days'],
  ['30_45', 'من ٣٠ إلى ٤٥', '30 – 45 days'],
  ['45_60', 'من ٤٥ إلى ٦٠', '45 – 60 days'],
  ['60_plus', 'أكثر من ٦٠', 'Over 60 days'],
];

/** سلّمُ التقادم: كلّما كبر العمرُ اشتدّ اللون — الخطرُ يُرى قبل أن يُقرأ. */
const AGING_META: Record<string, { ar: string; en: string; color: string }> = {
  '0-30': { ar: 'حتى ٣٠ يومًا', en: '0 – 30 days', color: '#10b981' },
  '31-60': { ar: '٣١ – ٦٠ يومًا', en: '31 – 60 days', color: '#f59e0b' },
  '61-90': { ar: '٦١ – ٩٠ يومًا', en: '61 – 90 days', color: '#f97316' },
  '90+': { ar: 'أكثر من ٩٠ يومًا', en: 'Over 90 days', color: '#dc2626' },
};

const pct = (a: number, b: number) => (b ? Math.round((a / b) * 1000) / 10 : 0);

function Panel({ title, icon, right, children, className = '' }: {
  title: string; icon?: React.ReactNode; right?: React.ReactNode; children: React.ReactNode; className?: string;
}) {
  return (
    <section className={`bg-white border border-slate-200 rounded-2xl shadow-sm overflow-hidden ${className}`}>
      <header className="flex items-center justify-between gap-2 px-5 py-3.5 border-b border-slate-100">
        <h2 className="text-[14px] font-bold text-slate-900 flex items-center gap-2">
          {icon && <span className="w-7 h-7 rounded-lg bg-slate-100 text-slate-600 flex items-center justify-center">{icon}</span>}
          {title}
        </h2>
        {right}
      </header>
      <div className="p-5">{children}</div>
    </section>
  );
}

function Kpi({ icon, label, value, sub, tone, onClick, isRTL }: {
  icon: React.ReactNode; label: string; value: string; sub?: string;
  tone: 'slate' | 'emerald' | 'amber' | 'sky'; onClick?: () => void; isRTL: boolean;
}) {
  const TONE = {
    slate: 'bg-slate-100 text-slate-700', emerald: 'bg-emerald-50 text-emerald-600',
    amber: 'bg-amber-50 text-amber-600', sky: 'bg-sky-50 text-sky-600',
  }[tone];
  return (
    <button type="button" onClick={onClick} disabled={!onClick}
      className="group text-start bg-white border border-slate-200 rounded-2xl p-4 shadow-sm min-w-0 transition-all enabled:hover:border-[#f37121]/50 enabled:hover:shadow-md disabled:cursor-default">
      <div className="flex items-center justify-between">
        <span className={`w-9 h-9 rounded-xl flex items-center justify-center ${TONE}`}>{icon}</span>
        {onClick && <ChevronLeft className={`w-4 h-4 text-slate-300 group-hover:text-[#f37121] ${isRTL ? '' : 'rotate-180'}`} />}
      </div>
      <p className="text-[12px] text-slate-500 mt-3">{label}</p>
      <p className="text-[22px] leading-tight font-extrabold tabular-nums text-slate-900 truncate" title={value}>{value}</p>
      {sub && <p className="text-[11.5px] text-slate-400 mt-0.5 truncate">{sub}</p>}
    </button>
  );
}

export default function CollectionsDashboardPage() {
  const { lang, isRTL } = useLanguage();
  const ar = lang === 'ar';
  const t = (a: string, e: string) => (ar ? a : e);
  const { notify } = useDialog();
  const router = useRouter();

  const [data, setData] = useState<Dash | null>(null);
  const [loading, setLoading] = useState(true);
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  // اللوحةُ تُفلتر كما تُفلتر الصفحات: عميلٌ بعينه، وفرع، وشريحةُ عمر، ومدى.
  const [customer, setCustomer] = useState('');
  const [branch, setBranch] = useState('');
  const [age, setAge] = useState('');
  const [showFilters, setShowFilters] = useState(false);
  const [opts, setOpts] = useState<{ customers: string[]; suppliers: string[]; branches: string[] }>(
    { customers: [], suppliers: [], branches: [] },
  );
  const activeCount = [customer, branch, age, from, to].filter(Boolean).length;
  const seq = useRef(0);

  const load = useCallback(async () => {
    const mine = ++seq.current;
    try {
      const p = new URLSearchParams();
      if (from) p.set('from', from);
      if (to) p.set('to', to);
      if (customer) p.set('customer', customer);
      if (branch) p.set('branch', branch);
      if (age) p.set('age', age);
      const d = await api.get<Dash>(`/api/collections-dept/dashboard?${p.toString()}`);
      // ردٌّ متأخّرٌ لفلترٍ سابق لا يكتب فوق الأحدث.
      if (mine === seq.current) setData(d);
    } catch (e: any) {
      if (mine === seq.current) notify(e?.message || t('تعذّر التحميل', 'Could not load'), 'error');
    }
    if (mine === seq.current) setLoading(false);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [from, to, customer, branch, age]);
  useEffect(() => { load(); }, [load]);

  // ── حيّة: تعديلٌ على كشفٍ أو فاتورةٍ أو طرف ⇒ قراءةٌ واحدةٌ بعد هدوء الدفعة ──
  const tick = useRef<ReturnType<typeof setTimeout> | null>(null);
  const soon = useCallback(() => {
    if (tick.current) clearTimeout(tick.current);
    tick.current = setTimeout(() => { load(); }, 800);
  }, [load]);
  useEffect(() => () => { if (tick.current) clearTimeout(tick.current); }, []);
  useSocket('workflow:updated', soon);
  useSocket('workflow:bulkImported', soon);
  useSocket('collections:party', soon);
  useSocket('finance:changed', soon);

  useEffect(() => {
    api.get<typeof opts>('/api/collections-dept/dashboard/filters').then(setOpts).catch(() => {});
  }, []);

  if (loading && !data) return <Spinner />;
  if (!data) return null;

  const C = data.customers;
  const rate = pct(C.settled, C.total);
  const agingTotal = data.aging.customer.reduce((s, a) => s + a.amount, 0);
  const topMax = Math.max(1, ...C.top.map((r) => r.outstanding));
  const branchMax = Math.max(1, ...data.byBranch.map((b) => b.receivable));
  const clear = () => { setCustomer(''); setBranch(''); setAge(''); setFrom(''); setTo(''); };

  const topCols = [
    { header: t('الاسم', 'Name'), key: 'name', width: 34 },
    { header: t('كشوف', 'Reports'), key: 'reports', width: 10 },
    { header: t('المستحق', 'Outstanding'), key: 'outstanding', width: 16 },
    { header: t('أقدم كشف', 'Oldest'), key: 'oldest', width: 14 },
  ];

  return (
    <div className="space-y-5 pb-10" dir={isRTL ? 'rtl' : 'ltr'}>
      <PageHeader
        icon={<Wallet className="w-6 h-6 text-[#f37121]" />}
        title={t('لوحة التحصيل', 'Collections dashboard')}
        subtitle={t('محسوبةٌ مباشرةً من كشوف التشغيل — حيّةٌ مع كلّ تعديل', 'Straight from the operations reports — live with every change')}
      >
        <span className="hidden sm:inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-emerald-50 text-emerald-700 text-xs font-semibold">
          <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />{t('مباشر', 'Live')}
        </span>
        <ExportMenu
          fileName="collections-dashboard"
          lang={ar ? 'ar' : 'en'}
          options={[{
            key: 'shown',
            label: t('المعروض', 'Shown'),
            sheets: [
              { name: t('أكبر المتأخرين', 'Top customers due'), rows: C.top, columns: topCols },
              {
                name: t('بالفرع', 'By branch'),
                rows: data.byBranch,
                columns: [
                  { header: t('الفرع', 'Branch'), key: 'branch', width: 18 },
                  { header: t('كشوف', 'Reports'), key: 'reports', width: 10 },
                  { header: t('لنا', 'Receivable'), key: 'receivable', width: 16 },
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

      {/* ── الفلاتر: شريطٌ واحدٌ هادئ، والتفصيلُ عند الطلب ─────────────────── */}
      <div className="bg-white border border-slate-200 rounded-2xl px-4 py-3 shadow-sm">
        <div className="flex flex-wrap items-center gap-2.5">
          <DateRangeFilter from={from} to={to} onFrom={setFrom} onTo={setTo} ar={ar} />
          <button type="button" onClick={() => setShowFilters((p) => !p)}
            className={`inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-sm font-semibold border transition-colors ${
              activeCount ? 'bg-[#f37121] text-white border-[#f37121]' : 'bg-white border-slate-200 text-slate-600 hover:text-slate-900'}`}>
            <SlidersHorizontal className="w-4 h-4" />{t('فلاتر', 'Filters')}{activeCount ? ` (${activeCount})` : ''}
          </button>
          {activeCount > 0 && (
            <button type="button" onClick={clear}
              className="inline-flex items-center gap-1.5 px-3 py-2 text-slate-400 hover:text-red-600 text-sm">
              <X className="w-4 h-4" />{t('إزالة الفلاتر', 'Clear')}
            </button>
          )}
        </div>
        {showFilters && (
          <div className="mt-3 pt-3 border-t border-slate-100 space-y-3">
            {/* الشرائحُ لا تتداخل — مجموعُها يساوي الكلَّ ولا يُعدّ الكشفُ مرّتين. */}
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-[12px] font-bold text-slate-600 me-1">{t('عمر الكشف', 'Report age')}</span>
              {AGE_BANDS.map(([k, arL, enL]) => (
                <button key={k} type="button" onClick={() => setAge(age === k ? '' : k)}
                  className={`px-3 py-1.5 rounded-full text-[12.5px] font-medium border transition-colors ${
                    age === k ? 'bg-[#f37121] text-white border-[#f37121]' : 'bg-white border-slate-200 text-slate-600 hover:text-slate-900'}`}>
                  {t(arL, enL)}
                </button>
              ))}
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <Field label={t('العميل', 'Customer')}>
                <SearchSelect ar={ar} value={customer} onChange={setCustomer}
                  allLabel={t('جميع العملاء', 'All customers')}
                  options={opts.customers.map((c) => ({ value: c, label: c }))} />
              </Field>
              <Field label={t('الفرع', 'Branch')}>
                <SearchSelect ar={ar} value={branch} onChange={setBranch}
                  allLabel={t('جميع الفروع', 'All branches')}
                  options={opts.branches.map((b) => ({ value: b, label: b }))} />
              </Field>
            </div>
          </div>
        )}
      </div>

      {/* ── ١. كم لنا، وكم حصّلنا ──────────────────────────────────────────── */}
      <div className="grid grid-cols-1 xl:grid-cols-5 gap-4">
        <button type="button" onClick={() => router.push('/system/collections-dept/customers')}
          className="xl:col-span-2 text-start rounded-2xl p-6 text-white shadow-md bg-gradient-to-br from-[#12325C] to-[#081833] hover:shadow-lg transition-shadow relative overflow-hidden">
          <div className="absolute -top-10 -end-10 w-40 h-40 rounded-full bg-[#f37121]/20 blur-2xl" aria-hidden="true" />
          <p className="text-[13px] text-slate-300 flex items-center gap-2">
            <Wallet className="w-4 h-4 text-[#f37121]" />{t('المستحق لنا من العملاء', 'Receivable from customers')}
          </p>
          <p className="text-[34px] leading-tight font-extrabold tabular-nums mt-2">{money(C.outstanding)}</p>
          <p className="text-[12.5px] text-slate-300 mt-1">
            {t(`${money(C.openReports)} كشفًا لم يُحصَّل`, `${money(C.openReports)} reports not yet collected`)}
          </p>
          <div className="mt-5">
            <div className="flex items-center justify-between text-[12px] mb-1.5">
              <span className="text-slate-300">{t('نسبة التحصيل', 'Collection rate')}</span>
              <span className="font-bold text-emerald-300 tabular-nums">{C.total ? `${rate}%` : '—'}</span>
            </div>
            <div className="h-2.5 rounded-full bg-white/10 overflow-hidden">
              <div className="h-full rounded-full bg-gradient-to-l from-emerald-400 to-emerald-500 transition-all duration-700" style={{ width: `${Math.min(100, rate)}%` }} />
            </div>
            <p className="text-[11.5px] text-slate-400 mt-1.5 tabular-nums">
              {t(`حُصِّل ${money(C.settled)} من ${money(C.total)}`, `${money(C.settled)} collected of ${money(C.total)}`)}
            </p>
          </div>
        </button>

        <div className="xl:col-span-3 grid grid-cols-2 gap-4">
          <Kpi isRTL={isRTL} tone="slate" icon={<TrendingUp className="w-5 h-5" />}
            label={t('إجمالي المبيعات', 'Total billed')} value={money(C.total)}
            sub={t(`${money(C.reports)} كشفًا`, `${money(C.reports)} reports`)} />
          <Kpi isRTL={isRTL} tone="emerald" icon={<CheckCircle2 className="w-5 h-5" />}
            label={t('المحصَّل', 'Collected')} value={money(C.settled)}
            sub={t(`${money(C.settledCount)} كشفًا مُقفَلًا`, `${money(C.settledCount)} settled reports`)} />
          <Kpi isRTL={isRTL} tone="amber" icon={<FileText className="w-5 h-5" />}
            label={t('كشوف لم تُحصَّل', 'Uncollected reports')} value={money(C.openReports)}
            sub={t('افتح فواتيرها', 'Open their invoices')}
            onClick={() => router.push('/system/collections-dept/invoices/tax')} />
          <Kpi isRTL={isRTL} tone="sky" icon={<UserCheck className="w-5 h-5" />}
            label={t('عملاء مسجَّلون', 'Registered customers')} value={money(data.counts.customer.active)}
            sub={data.counts.customer.inactive ? t(`${money(data.counts.customer.inactive)} معطَّل`, `${money(data.counts.customer.inactive)} inactive`) : t('كلُّهم نشِطون', 'All active')}
            onClick={() => router.push('/system/collections-dept/customers')} />
        </div>
      </div>

      {/* ── ٢. ما يحتاج تصرّفًا اليوم ───────────────────────────────────────── */}
      <CreditAlerts compact />

      {/* ── ٣. عمرُ ما لنا، وسيرُ الأشهر ────────────────────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-5 gap-4">
        <Panel className="lg:col-span-2" icon={<Clock className="w-4 h-4" />} title={t('تقادم المستحق', 'Ageing of outstanding')}
          right={<span className="text-[11px] text-slate-400">{t('منذ تاريخ الكشف', 'since report date')}</span>}>
          {/* شريطٌ واحدٌ مقسومٌ بالنِّسَب — ثمّ كلُّ شريحةٍ بمبلغها. */}
          <div className="flex h-3 rounded-full overflow-hidden bg-slate-100">
            {data.aging.customer.map((a) => (
              <div key={a.bucket} title={`${AGING_META[a.bucket]?.[ar ? 'ar' : 'en'] || a.bucket}: ${money(a.amount)}`}
                style={{ width: `${pct(a.amount, agingTotal)}%`, background: AGING_META[a.bucket]?.color || '#94a3b8' }} />
            ))}
          </div>
          <ul className="mt-4 space-y-3">
            {data.aging.customer.map((a) => {
              const m = AGING_META[a.bucket];
              const p = pct(a.amount, agingTotal);
              return (
                <li key={a.bucket}>
                  <div className="flex items-center justify-between text-[13px]">
                    <span className="flex items-center gap-2 text-slate-700">
                      <span className="w-2.5 h-2.5 rounded-sm" style={{ background: m?.color || '#94a3b8' }} />
                      {m ? t(m.ar, m.en) : a.bucket}
                    </span>
                    <span className="tabular-nums font-bold text-slate-900">{money(a.amount)}
                      <span className="text-[11px] font-medium text-slate-400 ms-1.5">{p}%</span>
                    </span>
                  </div>
                  <div className="h-1.5 mt-1.5 rounded-full bg-slate-100 overflow-hidden">
                    <div className="h-full rounded-full transition-all duration-700" style={{ width: `${p}%`, background: m?.color || '#94a3b8' }} />
                  </div>
                </li>
              );
            })}
          </ul>
          <p className="text-[11px] text-slate-400 mt-4">{t('الكشوف الملغاة مستثناة', 'Cancelled reports excluded')}</p>
        </Panel>

        <Panel className="lg:col-span-3" icon={<TrendingUp className="w-4 h-4" />} title={t('المبيعات والمحصَّل بالشهر', 'Billed vs collected, by month')}>
          <div className="h-72">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={data.monthly} margin={{ top: 4, right: 4, left: 4, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#eef2f7" vertical={false} />
                <XAxis dataKey="month" tick={{ fontSize: 11, fill: '#64748b' }} axisLine={false} tickLine={false} reversed={isRTL} />
                <YAxis tick={{ fontSize: 11, fill: '#64748b' }} width={70} axisLine={false} tickLine={false} orientation={isRTL ? 'right' : 'left'}
                  tickFormatter={(v) => (Math.abs(v) >= 1e6 ? `${Math.round(v / 1e5) / 10}M` : Math.abs(v) >= 1e3 ? `${Math.round(v / 1e3)}k` : String(v))} />
                <Tooltip formatter={(v: any) => money(v)} contentStyle={{ borderRadius: 12, borderColor: '#e2e8f0', fontSize: 12 }} />
                <Legend wrapperStyle={{ fontSize: 12 }} iconType="circle" />
                <Bar dataKey="total" name={t('المبيعات', 'Billed')} fill="#cbd5e1" radius={[6, 6, 0, 0]} maxBarSize={28} />
                <Bar dataKey="settled" name={t('المحصَّل', 'Collected')} fill="#10b981" radius={[6, 6, 0, 0]} maxBarSize={28} />
                <Line type="monotone" dataKey="outstanding" name={t('المتبقي', 'Outstanding')} stroke="#dc2626" strokeWidth={2.5} dot={{ r: 3 }} />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        </Panel>
      </div>

      {/* ── ٤. عند مَن، وفي أيّ فرع ─────────────────────────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-5 gap-4">
        <Panel className="lg:col-span-3" icon={<Users className="w-4 h-4" />} title={t('أكبر المتأخّرين', 'Largest amounts due')}
          right={<span className="text-[11px] text-slate-400">{t(`أعلى ${C.top.length}`, `Top ${C.top.length}`)}</span>}>
          {C.top.length === 0 ? (
            <p className="py-8 text-center text-slate-400 text-sm">{t('لا شيء مستحق', 'Nothing outstanding')}</p>
          ) : (
            <ol className="-my-1 divide-y divide-slate-100">
              {C.top.map((r, i) => (
                <li key={r.name}>
                  <button type="button"
                    onClick={() => router.push(`/system/collections-dept/customers?q=${encodeURIComponent(r.name)}`)}
                    className="w-full text-start flex items-center gap-3 py-2.5 group">
                    <span className={`w-7 h-7 shrink-0 rounded-lg flex items-center justify-center text-[12px] font-bold ${i < 3 ? 'bg-red-50 text-red-600' : 'bg-slate-100 text-slate-500'}`}>{i + 1}</span>
                    <span className="flex-1 min-w-0">
                      <span className="flex items-center justify-between gap-3">
                        <span className="truncate text-[13.5px] font-semibold text-slate-900 group-hover:text-[#f37121]">{r.name}</span>
                        <span className="shrink-0 tabular-nums text-[13.5px] font-bold text-red-600">{money(r.outstanding)}</span>
                      </span>
                      <span className="mt-1 flex items-center gap-3">
                        <span className="flex-1 h-1.5 rounded-full bg-slate-100 overflow-hidden">
                          <span className="block h-full rounded-full bg-red-400/80" style={{ width: `${(r.outstanding / topMax) * 100}%` }} />
                        </span>
                        <span className="shrink-0 text-[11px] text-slate-400 tabular-nums">
                          {t(`${money(r.reports)} كشف · أقدمها ${dt(r.oldest)}`, `${money(r.reports)} reports · oldest ${dt(r.oldest)}`)}
                        </span>
                      </span>
                    </span>
                  </button>
                </li>
              ))}
            </ol>
          )}
        </Panel>

        <div className="lg:col-span-2 space-y-4">
          <Panel icon={<Building2 className="w-4 h-4" />} title={t('بالفرع', 'By branch')}
            right={<span className="text-[11px] text-slate-400">{t('غير المُقفَل', 'Open only')}</span>}>
            {data.byBranch.length === 0 ? (
              <p className="py-6 text-center text-slate-400 text-sm">{t('لا شيء', 'Nothing')}</p>
            ) : (
              <ul className="space-y-3.5">
                {data.byBranch.map((b) => (
                  <li key={b.branch}>
                    <div className="flex items-center justify-between text-[13px]">
                      <span className="font-semibold text-slate-800">{b.branch || '—'}</span>
                      <span className="tabular-nums font-bold text-slate-900">{money(b.receivable)}</span>
                    </div>
                    <div className="mt-1.5 flex items-center gap-2">
                      <div className="flex-1 h-1.5 rounded-full bg-slate-100 overflow-hidden">
                        <div className="h-full rounded-full bg-[#f37121]/80" style={{ width: `${(b.receivable / branchMax) * 100}%` }} />
                      </div>
                      <span className="text-[11px] text-slate-400 tabular-nums shrink-0">{t(`${money(b.reports)} كشف`, `${money(b.reports)} reports`)}</span>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Panel>

          <button type="button" onClick={() => router.push('/system/collections-dept/suppliers')}
            className="w-full flex items-center gap-3 bg-white border border-slate-200 rounded-2xl px-5 py-4 shadow-sm text-start hover:border-[#f37121]/50 hover:shadow-md transition-all group">
            <span className="w-9 h-9 rounded-xl bg-slate-100 text-slate-600 flex items-center justify-center"><Truck className="w-5 h-5" /></span>
            <span className="flex-1">
              <span className="block text-[12px] text-slate-500">{t('موردون مسجَّلون', 'Registered suppliers')}</span>
              <span className="block text-[18px] font-extrabold tabular-nums text-slate-900">{money(data.counts.supplier.active)}</span>
            </span>
            <ChevronLeft className={`w-4 h-4 text-slate-300 group-hover:text-[#f37121] ${isRTL ? '' : 'rotate-180'}`} />
          </button>
        </div>
      </div>
    </div>
  );
}
