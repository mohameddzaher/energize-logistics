'use client';
// لوحةُ تحليلات التخليص الجمركيّ — صفحةٌ قائمةٌ بذاتها.
//
// كانت تُفتح من زرٍّ في صفحة المعاملات فتُقرأ ملحقًا بها. وهي سؤالٌ آخر: الجدولُ
// يقول «ما حال هذه المعاملة»، واللوحةُ تقول «كيف يسير العمل». ولها فلاترُها
// كاملةً — نفسُ ما يُفلتَر به الجدول، فالسؤالُ الذي يُطرح هناك يُطرح هنا.
import { useState, useEffect, useCallback, useMemo } from 'react';
import { useLanguage } from '@/context/LanguageContext';
import { useDialog } from '@/components/system/DialogProvider';
import api from '@/lib/api';
import { Spinner, PageHeader } from '@/components/hr/HRKit';
import DateRangeFilter from '@/components/system/DateRangeFilter';
import ExportMenu, { type ExportColumn } from '@/components/ls2/ExportMenu';
import {
  ResponsiveContainer, BarChart, Bar, LineChart, Line, XAxis, YAxis, Tooltip, CartesianGrid, Legend,
} from 'recharts';
import { BarChart3, RotateCcw, TrendingUp, TrendingDown } from 'lucide-react';

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
  const [f, setF] = useState<Record<string, string>>({});
  const [tab, setTab] = useState<'byCustomer' | 'byAgent' | 'byPort' | 'byStage' | 'byCity' | 'byBranch'>('byCustomer');

  const set = (k: string, v: string) => setF((p) => ({ ...p, [k]: v }));
  const qs = useMemo(() => {
    const p = new URLSearchParams();
    Object.entries(f).forEach(([k, v]) => { if (v) p.set(k, v); });
    return p.toString();
  }, [f]);

  const load = useCallback(async () => {
    try { setD(await api.get<any>(`/api/customs-clearance/analytics?${qs}`)); }
    catch (e: any) { notify(e?.message || t('تعذّر التحميل', 'Could not load'), 'error'); }
    setLoading(false);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [qs]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => { api.get<any>('/api/customs-clearance/filters').then((r) => setOpts(r.options || {})).catch(() => {}); }, []);

  if (loading && !d) return <Spinner />;
  if (!d) return null;
  const T = d.totals;
  const active = Object.values(f).filter(Boolean).length;

  const Stat = ({ label, value, accent, hint }: { label: string; value: any; accent?: string; hint?: string }) => (
    <div className="bg-white border border-slate-200 rounded-xl px-4 py-3 shadow-sm">
      <p className="text-[11px] text-slate-500">{label}</p>
      <p className={`text-xl font-bold tabular-nums ${accent || 'text-slate-900'}`}>{value}</p>
      {hint && <p className="text-[10px] text-slate-400 mt-0.5">{hint}</p>}
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
    ['byPort', 'حسب الميناء', 'By port'],
    ['byStage', 'حسب المرحلة', 'By stage'],
    ['byCity', 'حسب المدينة', 'By city'],
    ['byBranch', 'حسب الفرع', 'By branch'],
  ];
  const rows: Bucket[] = (d[tab] || []).slice().sort((a: Bucket, b: Bucket) => b.profit - a.profit);

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
        title={t('تحليلات التخليص الجمركي', 'Customs analytics')}
        subtitle={t('كيف يسير العمل — لا ما حالُ معاملةٍ بعينها', 'How the work is going — not the state of one transaction')}>
        <ExportMenu fileName="customs-analytics" lang={ar ? 'ar' : 'en'}
          options={[
            { key: 'view', label: t('الجدول المعروض', 'Shown table'), sheets: [{ name: t('تحليل', 'Analysis'), rows, columns: cols }] },
            { key: 'all', label: t('كل التجميعات', 'All groupings'), sheets: TABS.map(([k, arL, enL]) => ({ name: ar ? arL : enL, rows: d[k] || [], columns: cols })) },
          ]} />
      </PageHeader>

      {/* ── الفلاتر ────────────────────────────────────────────────────────── */}
      <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-sm flex flex-wrap items-center gap-3">
        <Sel k="customerParty" label={t('كل العملاء', 'All customers')} list={opts.customers} />
        <Sel k="agentParty" label={t('كل الوكلاء', 'All agents')} list={opts.agents} />
        <Sel k="port" label={t('كل الموانئ', 'All ports')} list={opts.port} />
        <Sel k="stage" label={t('كل المراحل', 'All stages')} list={opts.stage} />
        <Sel k="branch" label={t('كل الفروع', 'All branches')} list={opts.branch} />
        <Sel k="city" label={t('كل المدن', 'All cities')} list={opts.city} />
        <Sel k="currency" label={t('كل العملات', 'All currencies')} list={opts.currency} />
        <Sel k="invoiceType" label={t('كل أنواع الفواتير', 'All invoice types')} list={opts.invoiceType} />
        <Sel k="countryOfOrigin" label={t('كل بلدان المنشأ', 'All origins')} list={opts.countryOfOrigin} />
        <Sel k="invoiceStatus" label={t('كل حالات الفوترة', 'All invoice statuses')} list={opts.invoiceStatus} />
        <Sel k="year" label={t('كل السنوات', 'All years')} list={opts.years} />
        <Sel k="month" label={t('كل الأشهر', 'All months')}
          list={Array.from({ length: 12 }, (_, i) => ({ value: String(i + 1), label: String(i + 1) }))} />
        {/* المدى بمفتاح الشهر (YYYY-MM) كما يقرؤه الخادم. */}
        <DateRangeFilter ar={ar} from={f.from || ''} to={f.to || ''} onFrom={(v) => set('from', v)} onTo={(v) => set('to', v)} />
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
            <button key={k} type="button" onClick={() => setTab(k)}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors ${
                tab === k ? 'bg-[#f37121] text-white' : 'bg-slate-100 text-slate-600 hover:text-slate-900'}`}>
              {t(arL, enL)}
            </button>
          ))}
        </div>
        {rows.length > 1 && (
          <div className="h-64 px-2 pt-3">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={rows.slice(0, 12)}>
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
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-slate-500 text-xs">
              <tr>{[t('البند', 'Item'), t('معاملات', 'Deals'), t('حاويات', 'Containers'), t('الإيراد', 'Revenue'),
                t('التكلفة', 'Cost'), t('الربح', 'Profit'), t('الهامش', 'Margin')].map((h, i) => (
                <th key={i} className="px-3 py-2.5 text-start font-semibold whitespace-nowrap">{h}</th>))}</tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <tr><td colSpan={7} className="px-4 py-10 text-center text-slate-400">{t('لا بيانات', 'No data')}</td></tr>
              ) : rows.map((b) => (
                <tr key={b.key} className="border-b border-slate-100 hover:bg-slate-50">
                  <td className="px-3 py-2.5 font-semibold text-slate-800 max-w-[240px] truncate" title={b.key}>{b.key}</td>
                  <td className="px-3 py-2.5 tabular-nums">{money(b.count)}</td>
                  <td className="px-3 py-2.5 tabular-nums">{money(b.containers)}</td>
                  <td className="px-3 py-2.5 tabular-nums text-emerald-700">{money(b.revenue)}</td>
                  <td className="px-3 py-2.5 tabular-nums text-slate-600">{money(b.costs)}</td>
                  <td className={`px-3 py-2.5 tabular-nums font-semibold ${b.profit >= 0 ? 'text-emerald-700' : 'text-red-600'}`}>{money(b.profit)}</td>
                  <td className="px-3 py-2.5 tabular-nums text-slate-600">{b.revenue ? pct(b.profit / b.revenue) : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
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
              <div className="overflow-x-auto max-h-72">
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
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
