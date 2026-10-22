'use client';
// تحليلاتُ قسم التخليص — الإيراداتُ والتكاليفُ والأرباح. **للإدارة وحدَها**:
// مديرُ النظام ومديرُ القسم. والفريقُ له «لوحة القسم» التشغيليّة
// (/system/customs/dashboard) بلا رقمٍ ماليّ. والحارسُ في الخادم لا هنا.
//
// كانت تُفتح من زرٍّ في صفحة المعاملات فتُقرأ ملحقًا بها. وهي سؤالٌ آخر: الجدولُ
// يقول «ما حال هذه المعاملة»، واللوحةُ تقول «كيف يسير العمل». ولها فلاترُها
// كاملةً — نفسُ ما يُفلتَر به الجدول، فالسؤالُ الذي يُطرح هناك يُطرح هنا.
import { useState, useEffect, useCallback, useMemo } from 'react';
import { useLanguage } from '@/context/LanguageContext';
import { useDialog } from '@/components/system/DialogProvider';
import Link from 'next/link';
import api from '@/lib/api';
import { Spinner, PageHeader } from '@/components/hr/HRKit';
import PeriodFilter from '@/components/system/PeriodFilter';
import HrQuickFilters from '@/components/hr/HrQuickFilters';
import { useLatestRequest } from '@/hooks/useLatestRequest';
import { useSocket } from '@/hooks/useSocket';
import { useColumnFilters, ClearColumnFilters } from '@/components/useColumnFilters';
import { getCustomsTranslations } from '@/lib/translations';
import ExportMenu, { type ExportColumn } from '@/components/ls2/ExportMenu';
import {
  ResponsiveContainer, BarChart, Bar, LineChart, Line, XAxis, YAxis, Tooltip, CartesianGrid, Legend,
} from 'recharts';
import { BarChart3, RotateCcw, TrendingUp, TrendingDown } from 'lucide-react';
import ScrollX from '@/components/system/ScrollX';

const money = (n?: number) => Math.round(Number(n) || 0).toLocaleString('en-US');
const pct = (n?: number) => `${Math.round((Number(n) || 0) * 1000) / 10}%`;

type Bucket = { key: string; count: number; containers: number; revenue: number; costs: number; profit: number };

export default function CustomsAnalyticsPage() {
  const { lang, isRTL } = useLanguage();
  const ar = lang === 'ar';
  const t = (a: string, e: string) => (ar ? a : e);
  const { notify } = useDialog();

  const [d, setD] = useState<any>(null);
  const [opts, setOpts] = useState<any>({});
  const [loading, setLoading] = useState(true);
  const [denied, setDenied] = useState(false);
  const [f, setF] = useState<Record<string, string>>({});
  const [tab, setTab] = useState<'byCustomer' | 'byAgent' | 'byCarrier' | 'byPort' | 'byStage' | 'byCity' | 'byBranch' | 'byCargo' | 'byState' | 'byMonth'>('byCustomer');
  const cf = useColumnFilters<Bucket>();
  const TR = getCustomsTranslations(lang);

  const set = (k: string, v: string) => setF((p) => ({ ...p, [k]: v }));
  const qs = useMemo(() => {
    const p = new URLSearchParams();
    Object.entries(f).forEach(([k, v]) => { if (v) p.set(k, v); });
    return p.toString();
  }, [f]);

  // كلُّ فلترٍ طلبٌ — والأقدمُ لا يكتب فوق الأحدث (راجع useLatestRequest).
  const latest = useLatestRequest();
  const load = useCallback(async () => {
    const mine = latest.begin();
    try { const r = await api.get<any>(`/api/customs-clearance/analytics?${qs}`); if (latest.isCurrent(mine)) setD(r); }
    catch (e: any) {
      if (!latest.isCurrent(mine)) return;
      if (e?.status === 403 || e?.code === 'CUSTOMS_ANALYTICS_MANAGERS') setDenied(true);
      else notify(e?.message || t('تعذّر التحميل', 'Could not load'), 'error');
    }
    if (latest.isCurrent(mine)) setLoading(false);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [qs]);
  useEffect(() => { load(); }, [load]);
  // حيّة: كلُّ تعديلٍ في التخليص أو قرارٍ ماليٍّ يُعيد الأرقام.
  useSocket('customs:updated', load);
  useSocket('customs:created', load);
  useSocket('customs:deleted', load);
  useEffect(() => { api.get<any>('/api/customs-clearance/filters').then((r) => setOpts(r.options || {})).catch(() => {}); }, []);

  if (loading && !d) return <Spinner />;
  if (denied) {
    return (
      <div className="mx-auto mt-16 max-w-md rounded-2xl border border-slate-200 bg-white p-8 text-center shadow-sm">
        <BarChart3 className="mx-auto mb-3 h-8 w-8 text-slate-300" />
        <p className="font-bold text-slate-900">{t('تحليلات قسم التخليص', 'Customs section analytics')}</p>
        <p className="mt-1 text-sm text-slate-500">{t('هذه الصفحةُ لمدير النظام ومدير القسم. وللمتابعة اليوميّة افتح «لوحة القسم».', 'This page is for the system admin and the section manager. For day-to-day follow-up open the section dashboard.')}</p>
        <Link href="/system/customs/dashboard" className="mt-4 inline-block rounded-lg bg-[#f37121] px-4 py-2 text-sm font-bold text-white">{t('لوحة القسم', 'Section dashboard')}</Link>
      </div>
    );
  }
  if (!d) return null;
  const T = d.totals;
  const active = Object.values(f).filter(Boolean).length;

  // ── والرقمُ يبقى داخلَ بطاقته ────────────────────────────────────────────
  // «٣٬٢٣٣٬٤٠٦» في بطاقةٍ عرضُها سُبعُ الشاشة يخرج من حدّها حين تضيق: البطاقةُ
  // لا تنكمش تحت محتواها، والنصُّ لا يُلَفّ لأنّه رقمٌ بلا فراغات. فيُمنَع
  // الفيضُ صراحةً (`min-w-0` على البطاقة و`truncate` على الرقم) ويُقاس الخطُّ
  // بالشاشة، ويبقى الرقمُ كاملًا في `title` لمن يريده.
  const Stat = ({ label, value, accent, hint }: { label: string; value: any; accent?: string; hint?: string }) => (
    <div className="min-w-0 bg-white border border-slate-200 rounded-xl px-3 sm:px-4 py-3 shadow-sm overflow-hidden">
      <p className="text-[11px] text-slate-500 truncate" title={label}>{label}</p>
      <p className={`text-base sm:text-lg lg:text-xl font-bold tabular-nums truncate ${accent || 'text-slate-900'}`} title={String(value)}>{value}</p>
      {hint && <p className="text-[10px] text-slate-400 mt-0.5 truncate" title={hint}>{hint}</p>}
    </div>
  );

  const Sel = ({ k, label, list }: { k: string; label: string; list: { value: string; label?: string; count?: number }[] }) => (
    <select value={f[k] || ''} onChange={(e) => set(k, e.target.value)} aria-label={label}
      className="px-3 py-2 rounded-lg bg-white border border-slate-200 text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-[#f37121]/40">
      <option value="">{label}</option>
      {(list || []).map((o) => (
        <option key={o.value} value={o.value}>{o.label || o.value}{o.count != null ? ` (${o.count})` : ''}</option>
      ))}
    </select>
  );

  const TABS: [typeof tab, string, string][] = [
    ['byCustomer', 'حسب العميل', 'By customer'],
    ['byAgent', 'حسب وكيل الشحن', 'By agent'],
    ['byCarrier', 'حسب الناقل', 'By carrier'],
    ['byMonth', 'حسب الشهر', 'By month'],
    ['byCargo', 'حاويات / سيّارات', 'Containers / vehicles'],
    ['byState', 'مفتوحة / مغلقة', 'Open / closed'],
    ['byPort', 'حسب الميناء', 'By port'],
    ['byStage', 'حسب المرحلة', 'By stage'],
    ['byCity', 'حسب المدينة', 'By city'],
    ['byBranch', 'حسب الفرع', 'By branch'],
  ];
  // اسمُ البند كما يُقرأ: مفتاحُ المرحلة أو النوع أو الحالة يُترجَم، وغيرُه اسمٌ كما هو.
  const WORDS: Record<string, [string, string]> = {
    containers: ['حاويات', 'Containers'], vehicles: ['سيّارات', 'Vehicles'], open: ['مفتوحة', 'Open'], closed: ['مغلقة', 'Closed'],
  };
  const nameOf = (k: string) => (tab === 'byStage' ? (TR.stages[k] || k) : WORDS[k] ? (ar ? WORDS[k][0] : WORDS[k][1]) : k);
  const baseRows: Bucket[] = (d[tab] || []).slice().sort((a: Bucket, b: Bucket) => (tab === 'byMonth' ? a.key.localeCompare(b.key) : b.profit - a.profit));
  const getters: Record<string, (b: Bucket) => any> = { key: (b) => nameOf(b.key) };
  const rows: Bucket[] = cf.apply(baseRows, getters);
  const I = d.insight || {};
  const COST_AR: Record<string, [string, string]> = {
    deliveryOrder: ['قيمة إذن التسليم', 'Delivery order'], customsDuty: ['الرسوم الجمركية', 'Customs duty'], portFees: ['أجور الموانئ', 'Port fees'],
    unloadingFees: ['أجور التفريغ', 'Unloading fees'], inspection: ['أجور الكشف', 'Inspection'], transport: ['النقل من الميناء إلى العميل', 'Transport: port → customer'],
    transportToYard: ['النقل من الميناء إلى الساحة', 'Transport: port → yard'],
    transportYardToCustomer: ['النقل من الساحة إلى العميل', 'Transport: yard → customer'], labourExpenses: ['مصاريف عمال', 'Labour expenses'], appointmentBooking: ['حجز الموعد', 'Appointment booking'], storage: ['التخزين', 'Storage'],
    yardFees: ['أجور الساحة', 'Yard fees'], exitPermit: ['تصريح الخروج (الأرضيّات)', 'Exit permit (demurrage)'], demurrage: ['أرضيّات', 'Demurrage'],
    extension: ['تمديد', 'Extension'], consolidator: ['الدامج', 'Consolidator'], commissions: ['عمولات', 'Commissions'], extraFees: ['أجور إضافيّة', 'Extra fees'],
    returnInvoice: ['فاتورة الإرجاع', 'Return invoice'],
    clearanceFee: ['أجور التخليص', 'Clearance fee'], labour: ['عمّال', 'Labour'], yardNet: ['صافي الساحة', 'Yard net'], storageNet: ['صافي التخزين', 'Storage net'],
    transportToYardNet: ['صافي النقل إلى الساحة', 'Transport-to-yard net'], securityScan: ['فحص أمنيّ', 'Security scan'], transportNet: ['صافي النقل', 'Transport net'],
    yardToCustomerNet: ['صافي النقل من الساحة إلى العميل', 'Yard-to-customer net'],
    transportSelling: ['سعر النقل من الميناء إلى العميل', 'Price: port → customer'], transportToYardSelling: ['سعر النقل من الميناء إلى الساحة', 'Price: port → yard'],
    yardToCustomerSelling: ['سعر النقل من الساحة إلى العميل', 'Price: yard → customer'],
  };
  const lineName = (k: string) => (COST_AR[k] ? (ar ? COST_AR[k][0] : COST_AR[k][1]) : k);

  const cols: ExportColumn[] = [
    { header: t('البند', 'Item'), key: 'key', width: 28 },
    { header: t('معاملات', 'Deals'), key: 'count', width: 10 },
    { header: t('حاويات', 'Containers'), key: 'containers', width: 10 },
    { header: t('الإيراد', 'Revenue'), key: 'revenue', width: 14 },
    { header: t('التكلفة', 'Cost'), key: 'costs', width: 14 },
    { header: t('الربح', 'Profit'), key: 'profit', width: 14 },
  ];

  return (
    <div className="space-y-4 pb-10" dir={isRTL ? 'rtl' : 'ltr'}>
      <PageHeader icon={<BarChart3 className="w-6 h-6 text-[#f37121]" />}
        title={t('تحليلات قسم التخليص', 'Customs section analytics')}
        subtitle={t('الإيرادات والتكاليف والأرباح — للإدارة', 'Revenue, costs and profit — management only')}>
        <ExportMenu fileName="customs-analytics" lang={ar ? 'ar' : 'en'}
          options={[
            { key: 'view', label: t('الجدول المعروض', 'Shown table'), sheets: [{ name: t('تحليل', 'Analysis'), rows: rows.map((b) => ({ ...b, key: nameOf(b.key) })), columns: cols }] },
            { key: 'all', label: t('كل التجميعات', 'All groupings'), sheets: TABS.map(([k, arL, enL]) => ({ name: ar ? arL : enL, rows: d[k] || [], columns: cols })) },
          ]} />
      </PageHeader>

      {/* ── الفلاتر ────────────────────────────────────────────────────────── */}
      <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-sm flex flex-wrap items-center gap-3">
        {/* الفلاترُ السريعة كلوحة القسم: متعدّدةُ القيم وبأعدادها (٢٠٢٦/١٠/٢٢). */}
        <HrQuickFilters ar={ar} value={f} onChange={(v) => setF(v as Record<string, string>)}
          keys={[
            { key: 'qState', ar: 'حالة المعاملة', en: 'State' }, { key: 'qCustomer', ar: 'العميل', en: 'Customer' },
            { key: 'qAgent', ar: 'الوكيل الملاحي', en: 'Shipping agent' }, { key: 'qCarrier', ar: 'الناقل', en: 'Carrier' },
            { key: 'qPort', ar: 'الميناء', en: 'Port' }, { key: 'qBranch', ar: 'الفرع', en: 'Branch' },
            { key: 'qCargo', ar: 'النوع', en: 'Type' }, { key: 'qMonth', ar: 'الشهر', en: 'Month' },
          ]}
          options={Object.fromEntries(((d?.filters || []) as { key: string; values: any[] }[]).map((x) => [x.key, x.values]))} />
        <Sel k="stage" label={t('كل المراحل', 'All stages')} list={opts.stage} />
        <Sel k="city" label={t('كل المدن', 'All cities')} list={opts.city} />
        <Sel k="currency" label={t('كل العملات', 'All currencies')} list={opts.currency} />
        <Sel k="invoiceType" label={t('كل أنواع الفواتير', 'All invoice types')} list={opts.invoiceType} />
        <Sel k="countryOfOrigin" label={t('كل بلدان المنشأ', 'All origins')} list={opts.countryOfOrigin} />
        <Sel k="invoiceStatus" label={t('كل حالات الفوترة', 'All invoice statuses')} list={opts.invoiceStatus} />
        <Sel k="year" label={t('كل السنوات', 'All years')} list={opts.years} />
        {/* المدّة بشهر المعاملة: التحليلُ يُجمَع بالشهر، فيُختار شهرٌ أو فترةُ أشهر. */}
        <PeriodFilter ar={ar} modes={['month', 'range']} from={f.from || ''} to={f.to || ''}
          onChange={(a, b) => setF((p) => ({ ...p, from: a, to: b, year: '', month: '' }))} />
        {active > 0 && (
          <button type="button" onClick={() => setF({})}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-[#f37121]/10 text-[#f37121] text-sm font-semibold hover:bg-[#f37121]/20">
            <RotateCcw className="w-4 h-4" /> {t(`مسح (${active})`, `Clear (${active})`)}
          </button>
        )}
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-3">
        <Stat label={t('معاملات', 'Deals')} value={money(T.clearances)} hint={t(`${T.monthsCovered} شهرًا`, `${T.monthsCovered} months`)} />
        <Stat label={t('حاويات', 'Containers')} value={money(T.containers)} hint={t(`${T.avgContainersPerBl} لكل بوليصة`, `${T.avgContainersPerBl} per BL`)} />
        <Stat label={t('الإيراد', 'Revenue')} value={money(T.totalRevenue)} accent="text-emerald-600" />
        <Stat label={t('التكلفة', 'Cost')} value={money(T.totalCosts)} accent="text-slate-700" />
        <Stat label={t('صافي الربح', 'Net profit')} value={money(T.netProfit)} accent={T.netProfit >= 0 ? 'text-emerald-600' : 'text-red-600'} />
        <Stat label={t('الهامش', 'Margin')} value={pct(T.margin)} accent={T.margin >= 0 ? 'text-emerald-600' : 'text-red-600'} />
        <Stat label={t('لم تُفوتَر', 'Uninvoiced')} value={money(T.notInvoiced)} accent={T.notInvoiced ? 'text-amber-600' : undefined} />
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <Stat label={t('عملاء', 'Customers')} value={money(T.customers)} />
        <Stat label={t('وكلاء شحن', 'Agents')} value={money(T.agents)} />
        <Stat label={t('متوسط الفاتورة', 'Avg invoice')} value={money(T.avgInvoice)} />
        <Stat label={t('متوسط المعاملات شهريًّا', 'Avg deals / month')} value={money(T.avgPerMonth)} />
      </div>

      {/* ── ما تسأل عنه الإدارة ───────────────────────────────────────────────
          الأرقامُ أعلاه مجاميع. وهذه ما يُبنى عليه قرار: كم يدرّ الحاوية، وما
          المالُ الذي لم يُفوتَر بعد، وكم من الربح يتوقّف على عميلٍ واحد. */}
      <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-3">
        <Stat label={t('ربح الحاوية', 'Profit / container')} value={money(I.profitPerContainer)} accent={I.profitPerContainer >= 0 ? 'text-emerald-600' : 'text-red-600'} />
        <Stat label={t('إيراد الحاوية', 'Revenue / container')} value={money(I.revenuePerContainer)} />
        <Stat label={t('تكلفة الحاوية', 'Cost / container')} value={money(I.costPerContainer)} />
        <Stat label={t('متوسط ربح المعاملة', 'Avg profit / deal')} value={money(I.avgProfit)} />
        <Stat label={t('قيمة ما لم يُفوتَر', 'Uninvoiced value')} value={money(I.notInvoicedValue)} accent={I.notInvoiced ? 'text-amber-600' : undefined}
          hint={t(`${I.notInvoiced || 0} معاملة · مصروفُها ${money(I.notInvoicedCosts)}`, `${I.notInvoiced || 0} deals · costs ${money(I.notInvoicedCosts)}`)} />
        <Stat label={t('معاملات مفتوحة', 'Open deals')} value={money(I.open)} hint={t(`قيمتُها ${money(I.openValue)}`, `value ${money(I.openValue)}`)} />
        <Stat label={t('معاملات خاسرة', 'Losing deals')} value={money(I.losing)} accent={I.losing ? 'text-red-600' : undefined} />
        <Stat label={t('تركّز الربح', 'Profit concentration')} value={pct(I.top5Share)} accent={I.top1Share > 0.4 ? 'text-amber-600' : undefined}
          hint={t(`أكبرُ خمسة عملاء · الأوّل ${pct(I.top1Share)}`, `top 5 customers · #1 ${pct(I.top1Share)}`)} />
      </div>

      {/* أين يذهب المالُ ومن أين يأتي الربح — بندًا بندًا. */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {[
          { title: t('أين تذهب التكلفة', 'Where the cost goes'), rows: d.costBreakdown || [], total: T.totalCosts, bar: 'bg-slate-500' },
          { title: t('من أين يأتي الربح', 'Where the profit comes from'), rows: d.marginBreakdown || [], total: (d.marginBreakdown || []).reduce((a: number, x: any) => a + x.amount, 0), bar: 'bg-[#f37121]' },
        ].map((sec) => (
          <div key={sec.title} className="bg-white border border-slate-200 rounded-xl p-4 shadow-sm">
            <p className="text-sm font-bold text-slate-800 mb-3">{sec.title}</p>
            {sec.rows.length === 0 ? <p className="py-6 text-center text-sm text-slate-400">{t('لا بيانات', 'No data')}</p> : (
              <ul className="space-y-2">
                {sec.rows.map((x: any) => (
                  <li key={x.key}>
                    <div className="flex items-center justify-between gap-2 text-[13px]">
                      <span className="truncate font-semibold text-slate-700">{lineName(x.key)}</span>
                      <span className="shrink-0 tabular-nums text-slate-500">
                        <b className={x.amount < 0 ? 'text-red-600' : 'text-slate-900'}>{money(x.amount)}</b>
                        {sec.total ? <span className="ms-1.5 text-[11.5px]">{pct(x.amount / sec.total)}</span> : null}
                        <span className="ms-1.5 text-[11px] text-slate-400">{t(`${x.deals} معاملة`, `${x.deals} deals`)}</span>
                      </span>
                    </div>
                    <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-slate-100">
                      <div className={`h-full rounded-full ${sec.bar}`} style={{ width: `${sec.total ? Math.min(100, Math.abs(x.amount / sec.total) * 100) : 0}%` }} />
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        ))}
      </div>

      {d.byMonth?.length > 1 && (
        <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-sm">
          <p className="text-sm font-bold text-slate-800 mb-3">{t('بالشهر', 'By month')}</p>
          <div className="h-72">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={d.byMonth}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                <XAxis dataKey="key" tick={{ fontSize: 11 }} />
                <YAxis tick={{ fontSize: 11 }} />
                <Tooltip formatter={(v: any) => money(v as number)} />
                <Legend />
                <Line type="monotone" dataKey="revenue" name={t('الإيراد', 'Revenue')} stroke="#10b981" strokeWidth={2} dot={false} />
                <Line type="monotone" dataKey="costs" name={t('التكلفة', 'Cost')} stroke="#64748b" strokeWidth={2} dot={false} />
                <Line type="monotone" dataKey="profit" name={t('الربح', 'Profit')} stroke="#f37121" strokeWidth={2} dot={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

      <div className="bg-white border border-slate-200 rounded-xl shadow-sm">
        <div className="px-4 pt-4 flex items-center gap-2 flex-wrap">
          {TABS.map(([k, arL, enL]) => (
            <button key={k} type="button" onClick={() => { setTab(k); cf.clear(); }}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors ${
                tab === k ? 'bg-[#f37121] text-white' : 'bg-slate-100 text-slate-600 hover:text-slate-900'}`}>
              {t(arL, enL)}
            </button>
          ))}
          <ClearColumnFilters count={cf.count} onClear={cf.clear} ar={ar} />
        </div>
        {rows.length > 1 && (
          <div className="h-64 px-2 pt-3">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={rows.slice(0, 12).map((b) => ({ ...b, key: nameOf(b.key) }))}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                <XAxis dataKey="key" tick={{ fontSize: 10 }} interval={0} angle={-20} textAnchor="end" height={60} />
                <YAxis tick={{ fontSize: 11 }} />
                <Tooltip formatter={(v: any) => money(v as number)} />
                <Legend />
                <Bar dataKey="revenue" name={t('الإيراد', 'Revenue')} fill="#10b981" radius={[3, 3, 0, 0]} />
                <Bar dataKey="profit" name={t('الربح', 'Profit')} fill="#f37121" radius={[3, 3, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}
        <ScrollX>
          <table className="w-full text-sm">
            <thead className="table-head">
              <tr>
                <th className="px-3 py-2.5 text-start font-semibold whitespace-nowrap">
                  <span className="inline-flex items-center gap-1">{t('البند', 'Item')}{cf.header('key', baseRows, getters.key, ar)}</span>
                </th>
                {[t('معاملات', 'Deals'), t('حاويات', 'Containers'), t('الإيراد', 'Revenue'),
                  t('التكلفة', 'Cost'), t('الربح', 'Profit'), t('الهامش', 'Margin'), t('ربح الحاوية', 'Profit / container')].map((h, i) => (
                  <th key={i} className="px-3 py-2.5 text-start font-semibold whitespace-nowrap">{h}</th>))}
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <tr><td colSpan={8} className="px-4 py-10 text-center text-slate-400">{t('لا بيانات', 'No data')}</td></tr>
              ) : rows.map((b) => (
                <tr key={b.key} className="border-b border-slate-100 hover:bg-slate-50">
                  <td className="px-3 py-2.5 font-semibold text-slate-800 max-w-[240px] truncate" title={nameOf(b.key)}>{nameOf(b.key)}</td>
                  <td className="px-3 py-2.5 tabular-nums">{money(b.count)}</td>
                  <td className="px-3 py-2.5 tabular-nums">{money(b.containers)}</td>
                  <td className="px-3 py-2.5 tabular-nums text-emerald-700">{money(b.revenue)}</td>
                  <td className="px-3 py-2.5 tabular-nums text-slate-600">{money(b.costs)}</td>
                  <td className={`px-3 py-2.5 tabular-nums font-semibold ${b.profit >= 0 ? 'text-emerald-700' : 'text-red-600'}`}>{money(b.profit)}</td>
                  <td className="px-3 py-2.5 tabular-nums text-slate-600">{b.revenue ? pct(b.profit / b.revenue) : '—'}</td>
                  <td className="px-3 py-2.5 tabular-nums text-slate-600">{b.containers ? money(b.profit / b.containers) : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </ScrollX>
      </div>

      {/* ── الصفقاتُ بأسمائها ────────────────────────────────────────────────
          الرقمُ المجمَّع لا يقول أيَّ صفقةٍ صنعته: أعلاها ربحًا تُدرَس ليُكرَّر،
          وما خسر يُسأل عنه بعينه. */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {[
          { rows: d.topDeals || [], ar: 'أعلى المعاملات ربحًا', en: 'Most profitable', Icon: TrendingUp, tone: 'text-emerald-600' },
          { rows: d.losingDeals || [], ar: 'معاملات خاسرة', en: 'Losing deals', Icon: TrendingDown, tone: 'text-red-600' },
        ].map((sec) => (
          <div key={sec.en} className="bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden">
            <div className="px-4 py-3 border-b border-slate-100 flex items-center gap-2">
              <sec.Icon className={`w-4 h-4 ${sec.tone}`} />
              <p className="text-sm font-bold text-slate-800">{t(sec.ar, sec.en)}</p>
              <span className="ms-auto text-xs text-slate-400">{sec.rows.length}</span>
            </div>
            {sec.rows.length === 0 ? (
              <p className="px-4 py-8 text-center text-slate-400 text-sm">{t('لا شيء', 'None')}</p>
            ) : (
              <ScrollX className="max-h-72">
                <table className="w-full text-sm">
                  <tbody>
                    {sec.rows.map((r: any, i: number) => (
                      <tr key={i} className="border-b border-slate-100">
                        <td className="px-3 py-2 font-mono text-xs text-slate-700 whitespace-nowrap">{r.refNumber || r.blNumber || '—'}</td>
                        <td className="px-3 py-2 text-slate-600 max-w-[160px] truncate" title={r.customerName}>{r.customerName || '—'}</td>
                        <td className={`px-3 py-2 tabular-nums font-semibold text-end ${r.profit >= 0 ? 'text-emerald-700' : 'text-red-600'}`}>{money(r.profit)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </ScrollX>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
