'use client';
// Performance — the department manager's board (لوحة تقييم الأداء).
//
// Landing here shows the department's headline numbers for the chosen period,
// then one card per team member with a colour bar telling you at a glance
// whether they've been graded and how they scored. Clicking a card opens that
// person's evaluation form.
import { useState, useEffect, useCallback, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useAuth } from '@/context/AuthContext';
import { useLanguage } from '@/context/LanguageContext';
import { useSocket } from '@/hooks/useSocket';
import api from '@/lib/api';
import {
  Target, RefreshCw, Search, Settings as SettingsIcon, Building2,
  CheckCircle2, Clock, CircleDashed, AlertTriangle, ChevronLeft, ChevronRight,
} from 'lucide-react';
import { Spinner, PageHeader, StatCard } from '@/components/hr/HRKit';
import { exportToExcel } from '@/utils/exportExcel';
import {
  isPerfStaff, isPerfFull, canConfigurePerf, bandStyle, bandLabel, bonusLabel,
  pct, score5, periodLabel, periodKey, currentPeriod,
  type Lang, type Period, type TeamMember, type Settings, type Band,
} from '@/lib/performance';

interface TeamResponse {
  period: Period; periodKey: string; periodLabel: string;
  members: TeamMember[];
  summary: {
    total: number; evaluated: number; drafts: number; pending: number; noTemplate: number;
    avgPercentage: number | null; totalBonusSalaries: number;
    byBand: { key: string; ar: string; en: string; color: string; count: number }[];
  };
  settings: Settings;
}

// Quarter/month/year stepper — bonuses are quarterly, so quarter is the default.
function PeriodPicker({ period, onChange, lang, isRTL }: {
  period: Period; onChange: (p: Period) => void; lang: Lang; isRTL: boolean;
}) {
  const ar = lang === 'ar';
  const step = (dir: number) => {
    const p = { ...period };
    if (p.type === 'quarter') {
      let q = (p.quarter || 1) + dir;
      if (q > 4) { q = 1; p.year += 1; } else if (q < 1) { q = 4; p.year -= 1; }
      p.quarter = q;
    } else if (p.type === 'month') {
      let m = (p.month || 1) + dir;
      if (m > 12) { m = 1; p.year += 1; } else if (m < 1) { m = 12; p.year -= 1; }
      p.month = m;
    } else p.year += dir;
    onChange(p);
  };
  const Prev = isRTL ? ChevronRight : ChevronLeft;
  const Next = isRTL ? ChevronLeft : ChevronRight;
  return (
    <div className="flex items-center gap-2">
      <select
        value={period.type}
        onChange={(e) => {
          const type = e.target.value as Period['type'];
          const now = new Date();
          onChange(type === 'quarter'
            ? { type, quarter: Math.floor(now.getMonth() / 3) + 1, year: period.year }
            : type === 'month' ? { type, month: now.getMonth() + 1, year: period.year }
            : { type, year: period.year });
        }}
        className="border border-slate-200 rounded-lg px-2 py-1.5 text-sm bg-white focus:outline-none focus:border-[#f37121]"
      >
        <option value="quarter">{ar ? 'ربع سنوي' : 'Quarterly'}</option>
        <option value="month">{ar ? 'شهري' : 'Monthly'}</option>
        <option value="year">{ar ? 'سنوي' : 'Yearly'}</option>
      </select>
      <div className="flex items-center gap-1 bg-white border border-slate-200 rounded-lg px-1">
        <button type="button" onClick={() => step(-1)} className="p-1.5 text-slate-400 hover:text-[#f37121]"><Prev className="w-4 h-4" /></button>
        <span className="text-sm font-medium text-slate-800 px-2 min-w-[110px] text-center">{periodLabel(period, lang)}</span>
        <button type="button" onClick={() => step(1)} className="p-1.5 text-slate-400 hover:text-[#f37121]"><Next className="w-4 h-4" /></button>
      </div>
    </div>
  );
}

export default function PerformancePage() {
  const { user } = useAuth();
  const { lang, isRTL } = useLanguage();
  const router = useRouter();
  const ar = lang === 'ar';
  const [period, setPeriod] = useState<Period>(currentPeriod());
  const [data, setData] = useState<TeamResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState('');
  const [filter, setFilter] = useState<'all' | 'pending' | 'draft' | 'done'>('all');

  const load = useCallback(async () => {
    try {
      setData(await api.get<TeamResponse>(`/api/performance/team?period=${periodKey(period)}`));
    } catch { /* keep the last good view */ }
    setLoading(false);
  }, [period]);
  useEffect(() => { load(); }, [load]);
  useSocket('performance:updated', useCallback(() => load(), [load]));

  const bandByKey = useMemo(() => {
    const m = new Map<string, Band>();
    (data?.settings?.bands || []).forEach((b) => m.set(b.key, b));
    return m;
  }, [data]);

  const members = useMemo(() => {
    let rows = data?.members || [];
    if (filter === 'pending') rows = rows.filter((m) => !m.evaluation);
    else if (filter === 'draft') rows = rows.filter((m) => m.evaluation?.status === 'draft');
    else if (filter === 'done') rows = rows.filter((m) => m.evaluation?.status === 'submitted');
    const s = q.trim().toLowerCase();
    if (s) rows = rows.filter((m) => [m.name, m.jobTitle, m.employeeNumber, m.department].some((x) => String(x || '').toLowerCase().includes(s)));
    return rows;
  }, [data, filter, q]);

  if (!isPerfStaff(user?.role)) {
    return <div className="text-slate-500 p-8">{ar ? 'لا تملك صلاحية لهذا القسم' : 'You do not have access to this section'}</div>;
  }
  if (loading && !data) return <Spinner />;
  const sum = data?.summary;

  const FILTERS: { key: typeof filter; ar: string; en: string; count?: number }[] = [
    { key: 'all', ar: 'الكل', en: 'All', count: sum?.total },
    { key: 'pending', ar: 'لم يُقيَّم', en: 'Not evaluated', count: sum?.pending },
    { key: 'draft', ar: 'مسودة', en: 'Draft', count: sum?.drafts },
    { key: 'done', ar: 'مكتمل', en: 'Completed', count: sum?.evaluated },
  ];

  return (
    <div className="space-y-6" dir={isRTL ? 'rtl' : 'ltr'}>
      <PageHeader
        icon={<Target className="w-5 h-5" />}
        title={ar ? 'تقييم الأداء' : 'Performance Evaluation'}
        subtitle={`${periodLabel(period, lang as Lang)} · ${sum?.evaluated ?? 0}/${sum?.total ?? 0} ${ar ? 'تم تقييمهم' : 'evaluated'}`}
      >
        <PeriodPicker period={period} onChange={setPeriod} lang={lang as Lang} isRTL={isRTL} />
        {isPerfFull(user?.role) && (
          <Link href="/system/performance/overview" className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 text-sm">
            <Building2 className="w-4 h-4" /> {ar ? 'كل الأقسام' : 'All departments'}
          </Link>
        )}
        {canConfigurePerf(user?.role) && (
          <Link href="/system/performance/settings" className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-slate-900 hover:bg-slate-800 text-white text-sm">
            <SettingsIcon className="w-4 h-4" /> {ar ? 'إعداد المؤشرات' : 'Configure'}
          </Link>
        )}
        <button type="button" onClick={() => load()} className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 text-sm">
          <RefreshCw className="w-4 h-4" /> {ar ? 'تحديث' : 'Refresh'}
        </button>
      </PageHeader>

      {/* Headline numbers */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
        <StatCard label={ar ? 'الفريق' : 'Team'} value={String(sum?.total ?? 0)} />
        <StatCard label={ar ? 'تم تقييمهم' : 'Evaluated'} value={String(sum?.evaluated ?? 0)} />
        <StatCard label={ar ? 'في الانتظار' : 'Pending'} value={String((sum?.pending ?? 0) + (sum?.drafts ?? 0))} />
        <StatCard label={ar ? 'متوسط الأداء' : 'Avg performance'} value={pct(sum?.avgPercentage)} />
        <StatCard label={ar ? 'إجمالي البونص (رواتب)' : 'Total bonus (salaries)'} value={String(sum?.totalBonusSalaries ?? 0)} />
      </div>

      {/* Band distribution */}
      {!!sum?.byBand?.length && sum.evaluated > 0 && (
        <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-sm">
          <p className="text-xs font-semibold text-slate-500 mb-3">{ar ? 'توزيع الشرائح' : 'Performance bands'}</p>
          <div className="flex h-3 rounded-full overflow-hidden bg-slate-100">
            {sum.byBand.map((b) => {
              const w = sum.evaluated ? (b.count / sum.evaluated) * 100 : 0;
              if (!w) return null;
              return <div key={b.key} className={bandStyle({ color: b.color } as Band).bar} style={{ width: `${w}%` }} title={`${ar ? b.ar : b.en}: ${b.count}`} />;
            })}
          </div>
          <div className="flex flex-wrap gap-x-5 gap-y-1 mt-3">
            {sum.byBand.map((b) => (
              <span key={b.key} className="text-xs text-slate-600 flex items-center gap-1.5">
                <span className={`w-2.5 h-2.5 rounded-full ${bandStyle({ color: b.color } as Band).bar}`} />
                {ar ? b.ar : b.en} <b className="text-slate-800 tabular-nums">{b.count}</b>
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Filters + search */}
      <div className="flex flex-wrap items-center gap-2">
        {FILTERS.map((f) => (
          <button
            key={f.key} type="button" onClick={() => setFilter(f.key)}
            className={`px-3 py-1.5 rounded-full text-xs font-medium border ${filter === f.key ? 'bg-[#f37121] text-white border-[#f37121]' : 'bg-white text-slate-600 border-slate-200 hover:border-slate-300'}`}
          >
            {ar ? f.ar : f.en}{f.count != null && <span className={`ms-1 tabular-nums ${filter === f.key ? 'text-white/80' : 'text-slate-400'}`}>({f.count})</span>}
          </button>
        ))}
        <div className="relative ms-auto">
          <Search className={`w-4 h-4 text-slate-400 absolute top-2.5 ${isRTL ? 'right-3' : 'left-3'}`} />
          <input
            value={q} onChange={(e) => setQ(e.target.value)}
            placeholder={ar ? 'بحث بالاسم أو الوظيفة…' : 'Search name or job title…'}
            className={`w-64 border border-slate-200 rounded-lg py-2 text-sm bg-white focus:outline-none focus:border-[#f37121] ${isRTL ? 'pr-9 pl-3' : 'pl-9 pr-3'}`}
          />
        </div>
        <button
          type="button"
          onClick={() => exportToExcel(
            members.map((m) => ({
              name: m.name, jobTitle: m.jobTitle, department: m.department,
              employeeNumber: m.employeeNumber, template: m.template?.nameAr || '',
              status: m.evaluation ? (m.evaluation.status === 'submitted' ? (ar ? 'مكتمل' : 'Completed') : (ar ? 'مسودة' : 'Draft')) : (ar ? 'لم يُقيَّم' : 'Not evaluated'),
              score: m.evaluation?.weightedScore ?? '', percentage: m.evaluation?.percentage ?? '',
              band: bandLabel(m.evaluation?.band ? bandByKey.get(m.evaluation.band) : null, lang as Lang),
              bonus: m.evaluation?.bonusMultiplier ?? '',
            })),
            [
              { header: ar ? 'الاسم' : 'Name', key: 'name', width: 26 },
              { header: ar ? 'المسمى الوظيفي' : 'Job title', key: 'jobTitle', width: 20 },
              { header: ar ? 'القسم' : 'Department', key: 'department', width: 18 },
              { header: ar ? 'الرقم الوظيفي' : 'Employee no.', key: 'employeeNumber', width: 14 },
              { header: ar ? 'النموذج' : 'Template', key: 'template', width: 22 },
              { header: ar ? 'الحالة' : 'Status', key: 'status', width: 14 },
              { header: ar ? 'الدرجة (من ٥)' : 'Score /5', key: 'score', width: 12 },
              { header: ar ? 'النسبة %' : 'Percentage', key: 'percentage', width: 12 },
              { header: ar ? 'الشريحة' : 'Band', key: 'band', width: 14 },
              { header: ar ? 'البونص (رواتب)' : 'Bonus (salaries)', key: 'bonus', width: 16 },
            ],
            `performance-${periodKey(period)}`
          )}
          className="px-3 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-medium"
        >
          {ar ? 'تصدير Excel' : 'Export Excel'}
        </button>
      </div>

      {/* One card per team member */}
      {members.length === 0 ? (
        <div className="bg-white border border-slate-200 rounded-xl p-12 text-center text-slate-500 shadow-sm">
          {ar ? 'لا يوجد موظفون لعرضهم' : 'No employees to show'}
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
          {members.map((m) => {
            const ev = m.evaluation;
            const band = ev?.band ? bandByKey.get(ev.band) : null;
            const st = bandStyle(band);
            const noTemplate = !m.template;
            return (
              <button
                key={m._id} type="button"
                disabled={noTemplate}
                onClick={() => router.push(`/system/performance/evaluate/${m._id}?period=${periodKey(period)}`)}
                className={`text-start bg-white border rounded-xl shadow-sm overflow-hidden transition hover:shadow-md disabled:opacity-60 disabled:cursor-not-allowed ${ev?.status === 'submitted' ? st.border : 'border-slate-200'} hover:border-[#f37121]`}
              >
                {/* The colour bar: grey = not evaluated, band colour once graded */}
                <div className={`h-1.5 w-full ${ev?.status === 'submitted' ? st.bar : ev ? 'bg-amber-300' : 'bg-slate-200'}`} />
                <div className="p-4 space-y-2">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="font-semibold text-slate-900 truncate">{m.name}</p>
                      <p className="text-xs text-slate-500 truncate">{m.jobTitle || '—'}</p>
                    </div>
                    {ev?.status === 'submitted' ? <CheckCircle2 className="w-4 h-4 text-emerald-500 shrink-0" />
                      : ev ? <Clock className="w-4 h-4 text-amber-500 shrink-0" />
                      : <CircleDashed className="w-4 h-4 text-slate-300 shrink-0" />}
                  </div>

                  {noTemplate ? (
                    <p className="text-[11px] text-amber-600 flex items-center gap-1">
                      <AlertTriangle className="w-3.5 h-3.5" />
                      {ar ? 'لا يوجد نموذج لهذا القسم' : 'No template for this department'}
                    </p>
                  ) : ev?.status === 'submitted' ? (
                    <>
                      <div className="flex items-end justify-between">
                        <div>
                          <p className="text-2xl font-bold text-slate-900 tabular-nums leading-none">{pct(ev.percentage)}</p>
                          <p className="text-[11px] text-slate-500 mt-0.5">{score5(ev.weightedScore)} {ar ? 'من ٥' : '/ 5'}</p>
                        </div>
                        <span className={`px-2 py-0.5 rounded-full text-[11px] font-medium ${st.bg} ${st.text}`}>
                          {bandLabel(band, lang as Lang)}
                        </span>
                      </div>
                      <p className="text-[11px] text-slate-500">
                        {ar ? 'البونص:' : 'Bonus:'} <b className="text-slate-700">{bonusLabel(ev.bonusMultiplier, lang as Lang)}</b>
                      </p>
                    </>
                  ) : (
                    <p className="text-xs text-slate-400">
                      {ev ? (ar ? 'مسودة — لم تُرسل بعد' : 'Draft — not submitted') : (ar ? 'اضغط لبدء التقييم' : 'Click to start evaluating')}
                    </p>
                  )}

                  {m.template && (
                    <p className="text-[10px] text-slate-400 truncate pt-1 border-t border-slate-100">
                      {m.template.nameAr} · {m.template.criteriaCount} {ar ? 'مؤشرات' : 'criteria'}
                    </p>
                  )}
                </div>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
