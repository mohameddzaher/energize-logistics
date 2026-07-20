'use client';
// Performance — the company-wide roll-up (النظرة التنفيذية للتقييم).
//
// Every department for one period: how many of its people have been graded,
// the average score, the band spread, and the total bonus owed. The bonus total
// is a COUNT OF MONTHLY SALARIES, not money — the system holds no payroll, so
// turning it into cash means multiplying each person's bonus by their salary.
import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { useAuth } from '@/context/AuthContext';
import { useLanguage } from '@/context/LanguageContext';
import { useSocket } from '@/hooks/useSocket';
import api from '@/lib/api';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell,
} from 'recharts';
import { Building2, RefreshCw, ArrowLeft, ArrowRight, Info } from 'lucide-react';
import { Spinner, PageHeader, StatCard } from '@/components/hr/HRKit';
import { exportToExcel } from '@/utils/exportExcel';
import {
  isPerfFull, bandStyle, pct, periodLabel, periodKey, currentPeriod,
  type Lang, type Period, type Settings, type Band,
} from '@/lib/performance';

interface DeptRow {
  department: string; headcount: number; evaluated: number; coverage: number;
  avgPercentage: number | null; bonusSalaries: number; tier: number | null;
  byBand: { key: string; count: number }[];
}
interface OverviewResponse {
  period: Period; periodKey: string; periodLabel: string;
  totals: {
    headcount: number; evaluated: number; drafts: number; coverage: number;
    avgPercentage: number | null; totalBonusSalaries: number;
    byBand: { key: string; ar: string; en: string; color: string; count: number }[];
  };
  departments: DeptRow[];
  settings: Settings;
}

export default function PerformanceOverviewPage() {
  const { user } = useAuth();
  const { lang, isRTL } = useLanguage();
  const ar = lang === 'ar';
  const [period, setPeriod] = useState<Period>(currentPeriod());
  const [data, setData] = useState<OverviewResponse | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try { setData(await api.get<OverviewResponse>(`/api/performance/overview?period=${periodKey(period)}`)); }
    catch { /* keep last good */ }
    setLoading(false);
  }, [period]);
  useEffect(() => { load(); }, [load]);
  useSocket('performance:updated', useCallback(() => load(), [load]));

  const step = (dir: number) => {
    const p = { ...period };
    let q = (p.quarter || 1) + dir;
    if (q > 4) { q = 1; p.year += 1; } else if (q < 1) { q = 4; p.year -= 1; }
    p.quarter = q;
    setPeriod(p);
  };

  if (!isPerfFull(user?.role)) {
    return <div className="text-slate-500 p-8">{ar ? 'هذه الصفحة للإدارة العليا فقط' : 'This page is restricted to executives'}</div>;
  }
  if (loading && !data) return <Spinner />;
  const t = data?.totals;
  const Prev = isRTL ? ArrowRight : ArrowLeft;
  const Next = isRTL ? ArrowLeft : ArrowRight;

  const chartData = (data?.departments || [])
    .filter((d) => d.avgPercentage != null)
    .sort((a, b) => (b.avgPercentage || 0) - (a.avgPercentage || 0))
    .map((d) => ({ name: d.department, value: d.avgPercentage as number }));

  const bandOf = (pctVal: number): Band | undefined =>
    (data?.settings?.bands || []).find((b, i, arr) =>
      pctVal >= b.min && (i === arr.length - 1 ? pctVal <= b.max : pctVal < b.max));

  return (
    <div className="space-y-5" dir={isRTL ? 'rtl' : 'ltr'}>
      <PageHeader
        icon={<Building2 className="w-5 h-5" />}
        title={ar ? 'تقييم الأداء — كل الأقسام' : 'Performance — all departments'}
        subtitle={`${periodLabel(period, lang as Lang)} · ${t?.evaluated ?? 0}/${t?.headcount ?? 0} ${ar ? 'تم تقييمهم' : 'evaluated'}`}
      >
        <div className="flex items-center gap-1 bg-white border border-slate-200 rounded-lg px-1">
          <button type="button" onClick={() => step(-1)} className="p-1.5 text-slate-400 hover:text-[#f37121]"><Prev className="w-4 h-4" /></button>
          <span className="text-sm font-medium text-slate-800 px-2 min-w-[110px] text-center">{periodLabel(period, lang as Lang)}</span>
          <button type="button" onClick={() => step(1)} className="p-1.5 text-slate-400 hover:text-[#f37121]"><Next className="w-4 h-4" /></button>
        </div>
        <Link href="/system/performance" className="px-3 py-2 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 text-sm">
          {ar ? 'لوحتي' : 'My board'}
        </Link>
        <button type="button" onClick={() => load()} className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 text-sm">
          <RefreshCw className="w-4 h-4" /> {ar ? 'تحديث' : 'Refresh'}
        </button>
      </PageHeader>

      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
        <StatCard label={ar ? 'إجمالي الموظفين' : 'Headcount'} value={String(t?.headcount ?? 0)} />
        <StatCard label={ar ? 'تم تقييمهم' : 'Evaluated'} value={String(t?.evaluated ?? 0)} />
        <StatCard label={ar ? 'نسبة التغطية' : 'Coverage'} value={pct(t?.coverage)} />
        <StatCard label={ar ? 'متوسط الأداء' : 'Avg performance'} value={pct(t?.avgPercentage)} />
        <StatCard label={ar ? 'إجمالي البونص (رواتب)' : 'Total bonus (salaries)'} value={String(t?.totalBonusSalaries ?? 0)} />
      </div>

      <div className="bg-blue-50 border border-blue-200 rounded-xl px-4 py-2.5 text-xs text-blue-800 flex items-start gap-2">
        <Info className="w-4 h-4 mt-0.5 shrink-0" />
        {ar
          ? 'إجمالي البونص معروض بعدد مضاعفات الرواتب وليس بمبالغ نقدية، لأن المنظومة لا تتضمن بيانات الرواتب. لتحويله لتكلفة فعلية يُضرب بونص كل موظف في راتبه.'
          : 'The bonus total is a count of salary multiples, not cash — the system holds no payroll data. Multiply each employee’s bonus by their salary for the real cost.'}
      </div>

      {/* Band spread */}
      {!!t?.byBand?.length && t.evaluated > 0 && (
        <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-sm">
          <p className="text-xs font-semibold text-slate-500 mb-3">{ar ? 'توزيع الشرائح على مستوى الشركة' : 'Company-wide band spread'}</p>
          <div className="flex h-3 rounded-full overflow-hidden bg-slate-100">
            {t.byBand.map((b) => {
              const w = t.evaluated ? (b.count / t.evaluated) * 100 : 0;
              if (!w) return null;
              return <div key={b.key} className={bandStyle({ color: b.color } as Band).bar} style={{ width: `${w}%` }} title={`${ar ? b.ar : b.en}: ${b.count}`} />;
            })}
          </div>
          <div className="flex flex-wrap gap-x-5 gap-y-1 mt-3">
            {t.byBand.map((b) => (
              <span key={b.key} className="text-xs text-slate-600 flex items-center gap-1.5">
                <span className={`w-2.5 h-2.5 rounded-full ${bandStyle({ color: b.color } as Band).bar}`} />
                {ar ? b.ar : b.en} <b className="text-slate-800 tabular-nums">{b.count}</b>
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Average by department */}
      {chartData.length > 0 && (
        <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-sm">
          <p className="text-xs font-semibold text-slate-500 mb-3">{ar ? 'متوسط الأداء لكل قسم' : 'Average performance by department'}</p>
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={chartData} margin={{ top: 4, right: 8, bottom: 4, left: 8 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false} />
                <XAxis dataKey="name" tick={{ fontSize: 11, fill: '#64748b' }} interval={0} angle={-15} textAnchor="end" height={60} />
                <YAxis domain={[0, 100]} tick={{ fontSize: 11, fill: '#94a3b8' }} />
                <Tooltip
                  contentStyle={{ borderRadius: 10, border: '1px solid #e2e8f0', fontSize: 11 }}
                  formatter={(v: any) => [`${v}%`, ar ? 'متوسط الأداء' : 'Avg']}
                />
                <Bar dataKey="value" radius={[6, 6, 0, 0]}>
                  {chartData.map((d) => (
                    <Cell key={d.name} fill={bandStyle(bandOf(d.value)).hex} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

      {/* Per-department table */}
      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden shadow-sm">
        <div className="flex items-center justify-between px-4 py-3 border-b border-slate-100">
          <p className="text-sm font-semibold text-slate-800">{ar ? 'تفصيل الأقسام' : 'Department breakdown'}</p>
          <button
            type="button"
            onClick={() => exportToExcel(
              (data?.departments || []).map((d) => ({
                department: d.department, headcount: d.headcount, evaluated: d.evaluated,
                coverage: d.coverage, avg: d.avgPercentage ?? '', tier: d.tier ?? '', bonus: d.bonusSalaries,
              })),
              [
                { header: ar ? 'القسم' : 'Department', key: 'department', width: 24 },
                { header: ar ? 'عدد الموظفين' : 'Headcount', key: 'headcount', width: 14 },
                { header: ar ? 'تم تقييمهم' : 'Evaluated', key: 'evaluated', width: 14 },
                { header: ar ? 'التغطية %' : 'Coverage %', key: 'coverage', width: 14 },
                { header: ar ? 'متوسط الأداء %' : 'Avg %', key: 'avg', width: 14 },
                { header: ar ? 'الطبقة' : 'Tier', key: 'tier', width: 10 },
                { header: ar ? 'البونص (رواتب)' : 'Bonus (salaries)', key: 'bonus', width: 18 },
              ],
              `performance-overview-${periodKey(period)}`
            )}
            className="px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-medium"
          >
            {ar ? 'تصدير Excel' : 'Export Excel'}
          </button>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-slate-900 text-slate-300 text-xs">
                <th className="text-start font-semibold px-4 py-3">{ar ? 'القسم' : 'Department'}</th>
                <th className="text-end font-semibold px-4 py-3">{ar ? 'الموظفون' : 'Headcount'}</th>
                <th className="text-end font-semibold px-4 py-3">{ar ? 'تم تقييمهم' : 'Evaluated'}</th>
                <th className="text-end font-semibold px-4 py-3">{ar ? 'التغطية' : 'Coverage'}</th>
                <th className="text-end font-semibold px-4 py-3">{ar ? 'متوسط الأداء' : 'Avg'}</th>
                <th className="text-center font-semibold px-4 py-3">{ar ? 'الطبقة' : 'Tier'}</th>
                <th className="text-end font-semibold px-4 py-3">{ar ? 'البونص (رواتب)' : 'Bonus'}</th>
              </tr>
            </thead>
            <tbody>
              {(data?.departments || []).map((d) => (
                <tr key={d.department} className="border-b border-slate-100 hover:bg-slate-50">
                  <td className="px-4 py-3 font-medium text-slate-800">{d.department}</td>
                  <td className="px-4 py-3 text-end tabular-nums text-slate-700">{d.headcount}</td>
                  <td className="px-4 py-3 text-end tabular-nums text-slate-700">{d.evaluated}</td>
                  <td className="px-4 py-3 text-end">
                    <div className="flex items-center justify-end gap-2">
                      <div className="w-16 h-1.5 rounded-full bg-slate-100 overflow-hidden">
                        <div className="h-full bg-[#f37121]" style={{ width: `${Math.min(100, d.coverage)}%` }} />
                      </div>
                      <span className="tabular-nums text-xs text-slate-600 w-11 text-end">{pct(d.coverage)}</span>
                    </div>
                  </td>
                  <td className="px-4 py-3 text-end">
                    {d.avgPercentage == null ? <span className="text-slate-300">—</span> : (
                      <span className={`px-2 py-0.5 rounded-full text-xs font-bold tabular-nums ${bandStyle(bandOf(d.avgPercentage)).bg} ${bandStyle(bandOf(d.avgPercentage)).text}`}>
                        {pct(d.avgPercentage)}
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-center text-slate-600 tabular-nums">{d.tier ?? '—'}</td>
                  <td className="px-4 py-3 text-end tabular-nums font-medium text-slate-800">{d.bonusSalaries || '—'}</td>
                </tr>
              ))}
              {!(data?.departments || []).length && (
                <tr><td colSpan={7} className="text-center text-slate-400 py-10">{ar ? 'لا توجد بيانات' : 'No data'}</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
