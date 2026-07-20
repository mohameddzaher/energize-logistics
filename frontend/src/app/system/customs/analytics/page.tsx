'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { BarChart, Bar, Line, ComposedChart, XAxis, YAxis, Tooltip, Legend, ResponsiveContainer, CartesianGrid } from 'recharts';
import { ArrowLeft, ArrowRight, BarChart3, Download } from 'lucide-react';
import api from '@/lib/api';
import { useLanguage } from '@/context/LanguageContext';
import { Spinner, PageHeader, StatCard } from '@/components/hr/HRKit';
import { exportToExcel } from '@/utils/exportExcel';

const ORANGE = '#f37121';
const SLATE = '#334155';
const GREEN = '#16a34a';

const MONTH_LABELS: [string, string][] = [
  ['يناير', 'Jan'], ['فبراير', 'Feb'], ['مارس', 'Mar'], ['أبريل', 'Apr'],
  ['مايو', 'May'], ['يونيو', 'Jun'], ['يوليو', 'Jul'], ['أغسطس', 'Aug'],
  ['سبتمبر', 'Sep'], ['أكتوبر', 'Oct'], ['نوفمبر', 'Nov'], ['ديسمبر', 'Dec'],
];

interface Bucket {
  key: string;
  count: number;
  containers: number;
  revenue: number;
  costs: number;
  profit: number;
  clearanceFee: number;
  jeddah: number;
  dammam: number;
  avgContainers: number;
  containerShare: number;
  rank: number;
}

interface MonthBucket extends Bucket { year: number; month: number }

interface Analytics {
  totals: {
    clearances: number; containers: number; customers: number; agents: number;
    invoiced: number; notInvoiced: number; avgContainersPerBl: number;
    totalRevenue: number; clearanceFees: number; totalCosts: number;
    netProfit: number; margin: number; jeddah: number; dammam: number;
    avgInvoice: number; monthsCovered: number; avgPerMonth: number;
  };
  byCustomer: Bucket[];
  byAgent: Bucket[];
  byCity: Bucket[];
  byMonth: MonthBucket[];
}

export default function CustomsAnalyticsPage() {
  const { lang, isRTL } = useLanguage();
  const ar = lang === 'ar';
  const Back = isRTL ? ArrowRight : ArrowLeft;

  const [data, setData] = useState<Analytics | null>(null);
  const [loading, setLoading] = useState(true);
  const [year, setYear] = useState('');

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.get<Analytics>(`/api/customs-clearance/analytics${year ? `?year=${year}` : ''}`);
      setData(res);
    } catch { setData(null); }
    setLoading(false);
  }, [year]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const nf = (v: number, d = 0) => (Number(v) || 0).toLocaleString('en-US', { maximumFractionDigits: d });
  const pct = (v: number) => `${((Number(v) || 0) * 100).toFixed(1)}%`;
  const monthName = (m: number) => MONTH_LABELS[(m || 1) - 1][ar ? 0 : 1];

  if (loading) return <Spinner />;
  if (!data) {
    return (
      <div className="text-center text-slate-500 py-20">{ar ? 'تعذر تحميل لوحة المعلومات' : 'Failed to load the dashboard'}</div>
    );
  }

  const t = data.totals;
  const years = Array.from(new Set(data.byMonth.map((m) => m.year))).sort((a, b) => b - a);

  const chartData = data.byMonth.map((m) => ({
    name: `${monthName(m.month)} ${String(m.year).slice(2)}`,
    [ar ? 'البوالص' : 'BLs']: m.count,
    [ar ? 'الحاويات' : 'Containers']: m.containers,
    [ar ? 'الإيرادات' : 'Revenue']: m.revenue,
  }));

  const exportAll = () => {
    exportToExcel(data.byCustomer, [
      { header: ar ? 'العميل' : 'Customer', key: 'key', width: 26 },
      { header: ar ? 'عدد البوالص' : 'BLs', key: 'count', width: 12 },
      { header: ar ? 'عدد الحاويات' : 'Containers', key: 'containers', width: 14 },
      { header: ar ? 'متوسط حاويات' : 'Avg containers', key: 'avgContainers', width: 15 },
      { header: ar ? 'حصة الحاويات' : 'Container share', key: 'containerShare', width: 15, transform: (v) => pct(v) },
      { header: ar ? 'إجمالي الفواتير' : 'Total invoiced', key: 'revenue', width: 16 },
      { header: ar ? 'إجمالي المصاريف' : 'Total costs', key: 'costs', width: 16 },
      { header: ar ? 'صافي الربح' : 'Net profit', key: 'profit', width: 14 },
      { header: ar ? 'ترتيب' : 'Rank', key: 'rank', width: 10 },
    ], 'customs-analytics-customers', ar ? 'تحليل العملاء' : 'Customers');
  };

  return (
    <div className="space-y-6">
      <PageHeader
        icon={<BarChart3 className="w-5 h-5 text-[#f37121]" />}
        title={ar ? 'لوحة معلومات التخليص الجمركي' : 'Customs clearance dashboard'}
        subtitle={ar ? 'تحليل شامل للبوالص والعملاء والمصروفات والإيرادات' : 'Bills of lading, customers, costs and revenue at a glance'}
      >
        <Link href="/system/customs" className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 text-sm transition-colors">
          <Back className="w-4 h-4" /> {ar ? 'المعاملات' : 'Transactions'}
        </Link>
        <select value={year} onChange={(e) => setYear(e.target.value)}
          className="px-3 py-2 rounded-lg bg-white border border-slate-200 text-slate-900 text-sm focus:outline-none focus:ring-2 focus:ring-[#f37121]/50"
          aria-label={ar ? 'السنة' : 'Year'}>
          <option value="">{ar ? 'كل السنوات' : 'All years'}</option>
          {years.map((y) => <option key={y} value={String(y)}>{y}</option>)}
        </select>
        <button type="button" onClick={exportAll}
          className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 text-sm transition-colors">
          <Download className="w-4 h-4" /> {ar ? 'تصدير Excel' : 'Export Excel'}
        </button>
      </PageHeader>

      {/* Totals */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <StatCard label={ar ? 'إجمالي البوالص' : 'Total BLs'} value={nf(t.clearances)} />
        <StatCard label={ar ? 'إجمالي الحاويات' : 'Total containers'} value={nf(t.containers)} />
        <StatCard label={ar ? 'عدد العملاء' : 'Customers'} value={nf(t.customers)} />
        <StatCard label={ar ? 'متوسط حاويات / بوليصة' : 'Avg containers / BL'} value={nf(t.avgContainersPerBl, 2)} />
        <StatCard label={ar ? 'البوالص المفوترة' : 'Invoiced BLs'} value={nf(t.invoiced)} accent="text-green-600" />
        <StatCard label={ar ? 'البوالص غير المفوترة' : 'Not invoiced'} value={nf(t.notInvoiced)} accent="text-amber-600" />
        <StatCard label={ar ? 'وكلاء الشحن' : 'Shipping agents'} value={nf(t.agents)} />
        <StatCard label={ar ? 'متوسط الفاتورة' : 'Avg invoice'} value={nf(t.avgInvoice, 2)} />
        <StatCard label={ar ? 'إجمالي الإيرادات' : 'Total revenue'} value={nf(t.totalRevenue, 2)} accent="text-[#f37121]" />
        <StatCard label={ar ? 'أجور التخليص' : 'Clearance fees'} value={nf(t.clearanceFees, 2)} />
        <StatCard label={ar ? 'إجمالي المصاريف' : 'Total costs'} value={nf(t.totalCosts, 2)} />
        <StatCard label={`${ar ? 'صافي الربح' : 'Net profit'} · ${ar ? 'هامش' : 'margin'} ${pct(t.margin)}`}
          value={nf(t.netProfit, 2)} accent={t.netProfit >= 0 ? 'text-green-600' : 'text-red-600'} />
        <StatCard label={ar ? 'معاملات جدة' : 'Jeddah transactions'} value={nf(t.jeddah)} />
        <StatCard label={ar ? 'معاملات الدمام' : 'Dammam transactions'} value={nf(t.dammam)} />
        <StatCard label={ar ? 'عدد الأشهر' : 'Months covered'} value={nf(t.monthsCovered)} />
        <StatCard label={ar ? 'متوسط بوالص / شهر' : 'Avg BLs / month'} value={nf(t.avgPerMonth, 1)} />
      </div>

      {/* Monthly performance */}
      <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-sm">
        <h3 className="bg-slate-900 px-3 py-2 rounded-lg text-white font-semibold mb-4">{ar ? 'الأداء الشهري' : 'Monthly performance'}</h3>
        {chartData.length === 0 ? (
          <p className="text-slate-500 text-sm py-10 text-center">{ar ? 'لا توجد بيانات شهرية' : 'No monthly data'}</p>
        ) : (
          <div className="h-80 w-full" dir="ltr">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={chartData} margin={{ top: 8, right: 16, bottom: 8, left: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
                <XAxis dataKey="name" tick={{ fill: '#64748b', fontSize: 12 }} tickLine={false} axisLine={{ stroke: '#e2e8f0' }} />
                <YAxis yAxisId="left" tick={{ fill: '#64748b', fontSize: 12 }} tickLine={false} axisLine={false} />
                <YAxis yAxisId="right" orientation="right" tick={{ fill: '#64748b', fontSize: 12 }} tickLine={false} axisLine={false} />
                <Tooltip contentStyle={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 8, fontSize: 12 }} />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                <Bar yAxisId="left" dataKey={ar ? 'الحاويات' : 'Containers'} fill={ORANGE} radius={[4, 4, 0, 0]} />
                <Bar yAxisId="left" dataKey={ar ? 'البوالص' : 'BLs'} fill={SLATE} radius={[4, 4, 0, 0]} />
                <Line yAxisId="right" type="monotone" dataKey={ar ? 'الإيرادات' : 'Revenue'} stroke={GREEN} strokeWidth={2} dot={{ r: 3 }} />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        )}
      </div>

      {/* City split */}
      <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-sm">
        <h3 className="bg-slate-900 px-3 py-2 rounded-lg text-white font-semibold mb-4">{ar ? 'الأداء حسب المدينة' : 'Performance by city'}</h3>
        <Table
          head={[ar ? 'المدينة' : 'City', ar ? 'البوالص' : 'BLs', ar ? 'الحاويات' : 'Containers', ar ? '% الحاويات' : '% containers', ar ? 'إجمالي الفواتير' : 'Total invoiced', ar ? 'أجور التخليص' : 'Clearance fees']}
          rows={data.byCity.map((b) => [b.key, nf(b.count), nf(b.containers), pct(b.containerShare), nf(b.revenue, 2), nf(b.clearanceFee, 2)])}
          empty={ar ? 'لا توجد بيانات' : 'No data'}
        />
      </div>

      {/* Customers */}
      <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-sm">
        <h3 className="bg-slate-900 px-3 py-2 rounded-lg text-white font-semibold mb-4">{ar ? 'تحليل العملاء' : 'Customer analysis'}</h3>
        <Table
          head={[ar ? 'العميل' : 'Customer', ar ? 'البوالص' : 'BLs', ar ? 'الحاويات' : 'Containers', ar ? 'متوسط حاويات' : 'Avg containers', ar ? 'حصة الحاويات' : 'Container share', ar ? 'إجمالي الفواتير' : 'Total invoiced', ar ? 'ترتيب' : 'Rank']}
          rows={data.byCustomer.map((b) => [b.key, nf(b.count), nf(b.containers), nf(b.avgContainers, 2), pct(b.containerShare), nf(b.revenue, 2), `#${b.rank}`])}
          empty={ar ? 'لا يوجد عملاء' : 'No customers'}
        />
      </div>

      {/* Agents */}
      <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-sm">
        <h3 className="bg-slate-900 px-3 py-2 rounded-lg text-white font-semibold mb-4">{ar ? 'توزيع وكلاء الشحن' : 'Shipping agents'}</h3>
        <Table
          head={[ar ? 'وكيل الشحن' : 'Agent', ar ? 'البوالص' : 'BLs', ar ? 'الحاويات' : 'Containers', ar ? 'متوسط حاويات' : 'Avg containers', ar ? 'حصة الحاويات' : 'Container share', ar ? 'جدة' : 'Jeddah', ar ? 'الدمام' : 'Dammam']}
          rows={data.byAgent.map((b) => [b.key, nf(b.count), nf(b.containers), nf(b.avgContainers, 2), pct(b.containerShare), nf(b.jeddah), nf(b.dammam)])}
          empty={ar ? 'لا يوجد وكلاء' : 'No agents'}
        />
      </div>
    </div>
  );
}

function Table({ head, rows, empty }: { head: string[]; rows: (string | number)[][]; empty: string }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm min-w-[720px]">
        <thead>
          <tr className="bg-slate-900">
            {head.map((h, i) => (
              <th key={i} className="text-start text-slate-300 font-semibold px-4 py-3 whitespace-nowrap">{h}</th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-200">
          {rows.length === 0 ? (
            <tr><td colSpan={head.length} className="text-center text-slate-500 py-10">{empty}</td></tr>
          ) : rows.map((r, i) => (
            <tr key={i} className="bg-white hover:bg-slate-50 transition-colors">
              {r.map((cell, j) => (
                <td key={j} className={`px-4 py-3 whitespace-nowrap ${j === 0 ? 'text-slate-900 font-medium' : 'text-slate-700'}`}>{cell}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
