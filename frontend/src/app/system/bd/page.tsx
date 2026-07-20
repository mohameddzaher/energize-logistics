'use client';
// Business Development dashboard — the strategic view above CRM/Sales:
// pipeline of market entries, partnerships and tenders rather than customer deals.
import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/context/AuthContext';
import { useLanguage } from '@/context/LanguageContext';
import { useSocket } from '@/hooks/useSocket';
import api from '@/lib/api';
import { Compass, Handshake, Gavel, ArrowUpRight } from 'lucide-react';
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Cell,
  PieChart, Pie, Legend,
} from 'recharts';
import { Spinner, PageHeader, StatCard, SmallBadge } from '@/components/hr/HRKit';
import {
  canViewBd, BdDashboard, BdOpportunity, OPP_STAGE, OPP_TYPE, ACTIVITY_TYPE, ENTITY_TYPE,
  STAGE_COLOR, TYPE_COLOR, labelOf, bdName, bdTitle, userName, money, moneyShort,
  fmtDate, fmtDateTime, deadlineBadge, ALL_STAGES,
} from '@/lib/bd';

export default function BdDashboardPage() {
  const { user } = useAuth();
  const { lang, isRTL } = useLanguage();
  const ar = lang === 'ar';
  const router = useRouter();

  const [data, setData] = useState<BdDashboard | null>(null);
  const [opps, setOpps] = useState<BdOpportunity[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const [d, o] = await Promise.all([
        api.get<BdDashboard>('/api/business-development/dashboard'),
        api.get<{ opportunities: BdOpportunity[] }>('/api/business-development/opportunities'),
      ]);
      setData(d);
      setOpps(o.opportunities || []);
    } catch { /* keep the last good render */ }
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);
  useSocket('bd:updated', useCallback(() => { load(); }, [load]));

  if (!canViewBd(user)) {
    return <div className="text-slate-500 p-8">{ar ? 'لا تملك صلاحية' : 'Not authorized'}</div>;
  }
  if (loading) return <Spinner />;
  if (!data) return <div className="text-slate-500 p-8">{ar ? 'تعذر تحميل البيانات' : 'Failed to load data'}</div>;

  const t = data.totals;

  // Funnel: the open stages only — won/lost/on-hold are reported as their own KPIs.
  const funnel = data.funnel
    .filter((f) => !['won', 'lost', 'on_hold'].includes(f.stage))
    .map((f) => ({ ...f, label: labelOf(OPP_STAGE, f.stage, lang) }));

  // Open pipeline value split by initiative type.
  const byType = Object.keys(OPP_TYPE)
    .map((key) => ({
      key,
      name: labelOf(OPP_TYPE, key, lang),
      value: opps.filter((o) => o.status === 'open' && o.type === key)
        .reduce((s, o) => s + (o.estimatedValue || 0), 0),
    }))
    .filter((r) => r.value > 0);

  const activePartners = t.partners?.active || 0;

  return (
    <div className="space-y-6" dir={isRTL ? 'rtl' : 'ltr'}>
      <PageHeader
        icon={<Compass className="w-5 h-5" />}
        title={ar ? 'تطوير الأعمال' : 'Business Development'}
        subtitle={ar
          ? 'الفرص الاستراتيجية والشراكات والمناقصات'
          : 'Strategic opportunities, partnerships and tenders'}
      />

      {/* KPIs */}
      <div className="grid grid-cols-2 lg:grid-cols-6 gap-4">
        <StatCard label={ar ? 'فرص مفتوحة' : 'Open opportunities'} value={t.openOpportunities} />
        <StatCard label={ar ? 'قيمة خط الفرص' : 'Pipeline value'} value={moneyShort(t.pipelineValue)} accent="text-[#f37121]" />
        <StatCard label={ar ? 'القيمة المرجحة' : 'Weighted pipeline'} value={moneyShort(t.weightedPipelineValue)} accent="text-indigo-600" />
        <StatCard label={ar ? 'نسبة الفوز' : 'Win rate'} value={`${t.winRate}%`} accent={t.winRate >= 50 ? 'text-emerald-600' : 'text-slate-900'} />
        <StatCard label={ar ? 'شراكات نشطة' : 'Active partners'} value={activePartners} accent="text-teal-600" />
        <StatCard label={ar ? 'مناقصات تقترب' : 'Tenders due soon'} value={t.tendersDueSoon} accent={t.tendersDueSoon > 0 ? 'text-red-600' : 'text-slate-900'} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Stage funnel */}
        <div className="lg:col-span-2 rounded-xl border border-slate-200 bg-white shadow-sm p-5">
          <h2 className="text-slate-900 font-semibold mb-4">{ar ? 'مراحل الفرص' : 'Opportunity funnel'}</h2>
          {funnel.some((f) => f.count > 0) ? (
            <div className="h-72">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={funnel} layout="vertical" margin={{ left: 8, right: 16 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" horizontal={false} />
                  <XAxis type="number" tick={{ fontSize: 11, fill: '#64748b' }} allowDecimals={false} />
                  <YAxis type="category" dataKey="label" width={110} tick={{ fontSize: 11, fill: '#334155' }} />
                  <Tooltip
                    contentStyle={{ borderRadius: 12, border: '1px solid #e2e8f0', fontSize: 12 }}
                    formatter={(v: any, _n: any, p: any) => [
                      `${v} · ${money(p?.payload?.value)}`,
                      ar ? 'عدد الفرص' : 'Opportunities',
                    ]}
                  />
                  <Bar dataKey="count" radius={[0, 6, 6, 0]} cursor="pointer"
                    onClick={(e: any) => e && e.stage && router.push(`/system/bd/opportunities?stage=${e.stage}`)}>
                    {funnel.map((f) => <Cell key={f.stage} fill={STAGE_COLOR[f.stage] || '#f37121'} />)}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          ) : <p className="text-slate-400 text-sm py-10 text-center">{ar ? 'لا توجد فرص بعد' : 'No opportunities yet'}</p>}
        </div>

        {/* Pipeline value by type */}
        <div className="rounded-xl border border-slate-200 bg-white shadow-sm p-5">
          <h2 className="text-slate-900 font-semibold mb-4">{ar ? 'القيمة حسب النوع' : 'Pipeline by type'}</h2>
          {byType.length > 0 ? (
            <div className="h-72">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie data={byType} dataKey="value" nameKey="name" innerRadius={50} outerRadius={85} paddingAngle={2}>
                    {byType.map((r) => <Cell key={r.key} fill={TYPE_COLOR[r.key] || '#f37121'} />)}
                  </Pie>
                  <Tooltip
                    contentStyle={{ borderRadius: 12, border: '1px solid #e2e8f0', fontSize: 12 }}
                    formatter={(v: any) => money(Number(v))}
                  />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                </PieChart>
              </ResponsiveContainer>
            </div>
          ) : <p className="text-slate-400 text-sm py-10 text-center">{ar ? 'لا توجد بيانات' : 'No data'}</p>}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Upcoming tender deadlines */}
        <div className="rounded-xl border border-slate-200 bg-white shadow-sm p-5">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-slate-900 font-semibold flex items-center gap-2">
              <Gavel className="w-4 h-4 text-[#f37121]" /> {ar ? 'مواعيد المناقصات' : 'Upcoming tender deadlines'}
            </h2>
            <button type="button" onClick={() => router.push('/system/bd/tenders')}
              className="text-[#f37121] text-xs font-medium flex items-center gap-1 hover:underline">
              {ar ? 'الكل' : 'View all'} <ArrowUpRight className="w-3 h-3" />
            </button>
          </div>
          <div className="space-y-2">
            {(data.upcomingDeadlines || []).map((td) => {
              const b = deadlineBadge(td.submissionDeadline, lang);
              const urgent = (td.daysLeft ?? 99) < 7;
              return (
                <div key={td._id}
                  className={`flex items-center justify-between gap-3 rounded-lg border p-3 ${urgent ? 'border-red-200 bg-red-50' : 'border-slate-200 bg-white'}`}>
                  <div className="min-w-0">
                    <p className={`text-sm font-medium truncate text-start ${urgent ? 'text-red-700' : 'text-slate-900'}`}>{bdTitle(td, lang)}</p>
                    <p className="text-slate-500 text-xs text-start">{td.entity || '—'} · {fmtDate(td.submissionDeadline)}</p>
                  </div>
                  {b && <SmallBadge bg={b.bg} text={b.text} label={b.label} />}
                </div>
              );
            })}
            {(data.upcomingDeadlines || []).length === 0 && (
              <p className="text-slate-400 text-sm py-8 text-center">{ar ? 'لا توجد مواعيد قادمة' : 'No upcoming deadlines'}</p>
            )}
          </div>
        </div>

        {/* Top open opportunities */}
        <div className="rounded-xl border border-slate-200 bg-white shadow-sm p-5">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-slate-900 font-semibold flex items-center gap-2">
              <Handshake className="w-4 h-4 text-[#f37121]" /> {ar ? 'أكبر الفرص المفتوحة' : 'Top open opportunities'}
            </h2>
            <button type="button" onClick={() => router.push('/system/bd/opportunities')}
              className="text-[#f37121] text-xs font-medium flex items-center gap-1 hover:underline">
              {ar ? 'الكل' : 'View all'} <ArrowUpRight className="w-3 h-3" />
            </button>
          </div>
          <div className="space-y-2">
            {(data.topOpportunities || []).map((o) => {
              const st = OPP_STAGE[o.stage];
              return (
                <button key={o._id} type="button" onClick={() => router.push(`/system/bd/opportunities/${o._id}`)}
                  className="w-full flex items-center justify-between gap-3 rounded-lg border border-slate-200 p-3 hover:border-[#f37121]/50 transition-colors">
                  <div className="min-w-0 text-start">
                    <p className="text-slate-900 text-sm font-medium truncate">{bdName(o, lang)}</p>
                    <p className="text-slate-500 text-xs">{labelOf(OPP_TYPE, o.type, lang)} · {userName(o.owner) !== '—' ? userName(o.owner) : (o.ownerName || '—')}</p>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <span className="text-[#f37121] text-sm font-semibold">{moneyShort(o.estimatedValue, o.currency)}</span>
                    {st && <SmallBadge bg={st.bg} text={st.text} label={ar ? st.ar : st.en} />}
                  </div>
                </button>
              );
            })}
            {(data.topOpportunities || []).length === 0 && (
              <p className="text-slate-400 text-sm py-8 text-center">{ar ? 'لا توجد فرص مفتوحة' : 'No open opportunities'}</p>
            )}
          </div>
        </div>
      </div>

      {/* Activity feed */}
      <div className="rounded-xl border border-slate-200 bg-white shadow-sm p-5">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-slate-900 font-semibold">{ar ? 'آخر الأنشطة' : 'Recent activity'}</h2>
          <span className="text-slate-500 text-xs">
            {t.activitiesThisPeriod} {ar ? 'نشاط خلال الفترة' : 'activities this period'}
          </span>
        </div>
        <div className="space-y-3">
          {(data.timeline || []).map((a) => {
            const ty = ACTIVITY_TYPE[a.type];
            const en = ENTITY_TYPE[a.entityType];
            return (
              <div key={a._id} className="flex items-start gap-3 border-b border-slate-100 last:border-0 pb-3 last:pb-0">
                <div className="w-2 h-2 rounded-full bg-[#f37121] mt-2 shrink-0" />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <p className="text-slate-900 text-sm font-medium text-start">{a.title}</p>
                    {ty && <SmallBadge bg={ty.bg} text={ty.text} label={ar ? ty.ar : ty.en} />}
                    {en && <SmallBadge bg={en.bg} text={en.text} label={ar ? en.ar : en.en} />}
                  </div>
                  {a.summary && <p className="text-slate-600 text-xs mt-1 text-start">{a.summary}</p>}
                  <p className="text-slate-400 text-[11px] mt-1 text-start">
                    {fmtDateTime(a.date)} · {a.performedByName || userName(a.performedBy)}
                  </p>
                </div>
              </div>
            );
          })}
          {(data.timeline || []).length === 0 && (
            <p className="text-slate-400 text-sm py-8 text-center">{ar ? 'لا توجد أنشطة' : 'No activity yet'}</p>
          )}
        </div>
      </div>

      {/* Stage totals strip — quick jump into a filtered list */}
      <div className="flex flex-wrap gap-2">
        {ALL_STAGES.map((s) => (
          <button key={s} type="button" onClick={() => router.push(`/system/bd/opportunities?stage=${s}`)}
            className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs text-slate-700 hover:border-[#f37121]/50 transition-colors">
            {labelOf(OPP_STAGE, s, lang)} <span className="font-semibold text-slate-900">{t.byStage?.[s] || 0}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
