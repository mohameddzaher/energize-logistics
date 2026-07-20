'use client';
// Marketing dashboard (لوحة التسويق) — the section's overview for a date window:
// how much we spent, what we published, on which platforms, and what it brought
// back in reach, clicks and leads. Fed by /api/marketing/dashboard and kept live
// by the `marketing:updated` socket event.
import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/context/AuthContext';
import { useLanguage } from '@/context/LanguageContext';
import { useSocket } from '@/hooks/useSocket';
import api from '@/lib/api';
import { Megaphone, RefreshCw, ArrowRight, Target, ListChecks } from 'lucide-react';
import {
  AreaChart, Area, BarChart, Bar, PieChart, Pie, Cell,
  XAxis, YAxis, Tooltip, Legend, CartesianGrid, ResponsiveContainer,
} from 'recharts';
import { Spinner, PageHeader, StatCard } from '@/components/hr/HRKit';
import RangePicker from '@/components/marketing/RangePicker';
import {
  isMarketingStaff, thisMonthToDate, platformLabel, platformColor, activityTypeLabel, activityTypeColor,
  statusStyle, statusLabel, campaignName, num, money, pct,
  type Lang, type DateRange, type Dashboard,
} from '@/lib/marketing';

export default function MarketingDashboardPage() {
  const { user } = useAuth();
  const { lang, isRTL } = useLanguage();
  const router = useRouter();
  const ar = lang === 'ar';
  const L = lang as Lang;

  const [range, setRange] = useState<DateRange>(thisMonthToDate());
  const [d, setD] = useState<Dashboard | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      setD(await api.get<Dashboard>(`/api/marketing/dashboard?from=${range.from}&to=${range.to}`));
    } catch { /* keep the previous snapshot rather than blanking the page */ }
    setLoading(false);
  }, [range.from, range.to]);

  useEffect(() => { load(); }, [load]);
  useSocket('marketing:updated', useCallback(() => load(), [load]));

  if (!isMarketingStaff(user?.role)) {
    return <div className="text-slate-500 p-8">{ar ? 'غير مصرح لك بالوصول إلى قسم التسويق.' : 'You are not authorized to view the Marketing section.'}</div>;
  }
  if (loading && !d) return <Spinner />;
  if (!d) return <div className="text-slate-500 p-8">{ar ? 'لا توجد بيانات.' : 'No data.'}</div>;

  const t = d.totals;
  const go = (path: string) => router.push(`/system/marketing${path}`);

  const cards = [
    { label: ar ? 'الحملات' : 'Campaigns', value: num(t.campaigns), accent: 'text-slate-900' },
    { label: ar ? 'حملات نشطة' : 'Active campaigns', value: num(t.activeCampaigns), accent: 'text-emerald-600' },
    { label: ar ? 'الأنشطة' : 'Activities', value: num(t.activities), accent: 'text-slate-900' },
    { label: ar ? 'الميزانية' : 'Budget', value: money(t.budget, L), accent: 'text-slate-700' },
    { label: ar ? 'الإنفاق' : 'Spend', value: money(t.spend, L), accent: 'text-[#f37121]' },
    { label: ar ? 'العملاء المحتملون' : 'Leads', value: num(t.leads), accent: 'text-emerald-600' },
    { label: ar ? 'مرات الظهور' : 'Impressions', value: num(t.impressions), accent: 'text-blue-600' },
    { label: ar ? 'النقرات' : 'Clicks', value: num(t.clicks), accent: 'text-indigo-600' },
    { label: ar ? 'معدل النقر (CTR)' : 'CTR', value: pct(t.ctr), accent: 'text-purple-600' },
    { label: ar ? 'تكلفة العميل المحتمل (CPL)' : 'CPL', value: money(t.cpl, L), accent: 'text-amber-600' },
  ];

  const timeline = d.timeline.map((r) => ({ ...r, label: r.date.slice(5) }));
  const platformData = d.byPlatform.map((p) => ({ ...p, label: platformLabel(p.platform, L), fill: platformColor(p.platform) }));
  const typeData = d.byType.map((r) => ({ ...r, label: activityTypeLabel(r.type, L), fill: activityTypeColor(r.type) }));

  const card = 'rounded-xl border border-slate-200 bg-white shadow-sm';

  return (
    <div className="space-y-5" dir={isRTL ? 'rtl' : 'ltr'}>
      <PageHeader
        icon={<Megaphone className="w-5 h-5" />}
        title={ar ? 'لوحة التسويق' : 'Marketing Dashboard'}
        subtitle={ar ? 'نظرة عامة على الحملات والأنشطة والنتائج' : 'Campaigns, activities and results at a glance'}
      >
        <button type="button" onClick={() => load()} className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 text-sm">
          <RefreshCw className="w-4 h-4" /> {ar ? 'تحديث' : 'Refresh'}
        </button>
      </PageHeader>

      <RangePicker value={range} onChange={setRange} lang={L} />

      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
        {cards.map((c) => <StatCard key={c.label} label={c.label} value={c.value} accent={c.accent} />)}
      </div>

      {/* Activity over time */}
      <div className={`${card} p-4`}>
        <h2 className="text-sm font-semibold text-slate-800 mb-3 text-start">{ar ? 'النشاط عبر الزمن' : 'Activity over time'}</h2>
        {timeline.length === 0 ? (
          <p className="text-slate-400 text-sm py-10 text-center">{ar ? 'لا توجد أنشطة في هذه الفترة.' : 'No activities in this period.'}</p>
        ) : (
          <div className="h-72">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={timeline} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
                <defs>
                  <linearGradient id="mkImp" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#f37121" stopOpacity={0.5} />
                    <stop offset="95%" stopColor="#f37121" stopOpacity={0.05} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                <XAxis dataKey="label" tick={{ fontSize: 11, fill: '#64748b' }} reversed={isRTL} />
                <YAxis tick={{ fontSize: 11, fill: '#64748b' }} orientation={isRTL ? 'right' : 'left'} />
                <Tooltip contentStyle={{ borderRadius: 12, border: '1px solid #e2e8f0', fontSize: 12 }} />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                <Area type="monotone" dataKey="impressions" name={ar ? 'الظهور' : 'Impressions'} stroke="#f37121" fill="url(#mkImp)" strokeWidth={2} />
                <Area type="monotone" dataKey="clicks" name={ar ? 'النقرات' : 'Clicks'} stroke="#6366f1" fill="transparent" strokeWidth={2} />
                <Area type="monotone" dataKey="leads" name={ar ? 'العملاء المحتملون' : 'Leads'} stroke="#10b981" fill="transparent" strokeWidth={2} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* By platform */}
        <div className={`${card} p-4`}>
          <h2 className="text-sm font-semibold text-slate-800 mb-3 text-start">{ar ? 'حسب المنصة' : 'By platform'}</h2>
          {platformData.length === 0 ? (
            <p className="text-slate-400 text-sm py-10 text-center">{ar ? 'لا توجد بيانات.' : 'No data.'}</p>
          ) : (
            <div className="h-72">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={platformData} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                  <XAxis dataKey="label" tick={{ fontSize: 11, fill: '#64748b' }} reversed={isRTL} interval={0} angle={-20} textAnchor="end" height={60} />
                  <YAxis tick={{ fontSize: 11, fill: '#64748b' }} orientation={isRTL ? 'right' : 'left'} />
                  <Tooltip contentStyle={{ borderRadius: 12, border: '1px solid #e2e8f0', fontSize: 12 }} />
                  <Bar dataKey="activities" name={ar ? 'الأنشطة' : 'Activities'} radius={[6, 6, 0, 0]}>
                    {platformData.map((p) => <Cell key={p.platform} fill={p.fill} />)}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>

        {/* By type */}
        <div className={`${card} p-4`}>
          <h2 className="text-sm font-semibold text-slate-800 mb-3 text-start">{ar ? 'حسب نوع النشاط' : 'By activity type'}</h2>
          {typeData.length === 0 ? (
            <p className="text-slate-400 text-sm py-10 text-center">{ar ? 'لا توجد بيانات.' : 'No data.'}</p>
          ) : (
            <div className="h-72">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie data={typeData} dataKey="count" nameKey="label" cx="50%" cy="50%" outerRadius={90} innerRadius={45} paddingAngle={2}>
                    {typeData.map((r) => <Cell key={r.type} fill={r.fill} />)}
                  </Pie>
                  <Tooltip contentStyle={{ borderRadius: 12, border: '1px solid #e2e8f0', fontSize: 12 }} />
                  <Legend wrapperStyle={{ fontSize: 12 }} />
                </PieChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Top campaigns */}
        <div className={`${card} overflow-hidden`}>
          <div className="px-4 py-3 border-b border-slate-200 flex items-center justify-between">
            <h2 className="text-sm font-semibold text-slate-800 flex items-center gap-2"><Target className="w-4 h-4 text-[#f37121]" /> {ar ? 'أفضل الحملات' : 'Top campaigns'}</h2>
            <button type="button" onClick={() => go('/campaigns')} className="text-xs text-[#f37121] flex items-center gap-1 hover:underline">
              {ar ? 'كل الحملات' : 'All campaigns'} <ArrowRight className={`w-3 h-3 ${isRTL ? 'rotate-180' : ''}`} />
            </button>
          </div>
          {d.topCampaigns.length === 0 ? (
            <p className="text-slate-400 text-sm py-10 text-center">{ar ? 'لا توجد حملات.' : 'No campaigns.'}</p>
          ) : (
            <ul className="divide-y divide-slate-100">
              {d.topCampaigns.map((c) => {
                const st = statusStyle(c.status);
                return (
                  <li key={c._id}>
                    <button type="button" onClick={() => go(`/campaigns/${c._id}`)} className="w-full text-start px-4 py-3 hover:bg-slate-50 flex items-center justify-between gap-3">
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-slate-800 truncate">{campaignName(c, L)}</p>
                        <p className="text-xs text-slate-500">{platformLabel(c.platform, L)} · {money(c.spend, L)}</p>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <span className="text-sm font-bold tabular-nums text-emerald-600">{num(c.leads)}</span>
                        {st && <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${st.bg} ${st.text}`}>{statusLabel(c.status, L)}</span>}
                      </div>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        {/* Recent activity feed */}
        <div className={`${card} overflow-hidden`}>
          <div className="px-4 py-3 border-b border-slate-200 flex items-center justify-between">
            <h2 className="text-sm font-semibold text-slate-800 flex items-center gap-2"><ListChecks className="w-4 h-4 text-[#f37121]" /> {ar ? 'آخر الأنشطة' : 'Recent activity'}</h2>
            <button type="button" onClick={() => go('/activities')} className="text-xs text-[#f37121] flex items-center gap-1 hover:underline">
              {ar ? 'سجل الأنشطة' : 'Activity log'} <ArrowRight className={`w-3 h-3 ${isRTL ? 'rotate-180' : ''}`} />
            </button>
          </div>
          {d.recentActivities.length === 0 ? (
            <p className="text-slate-400 text-sm py-10 text-center">{ar ? 'لا توجد أنشطة.' : 'No activities.'}</p>
          ) : (
            <ul className="divide-y divide-slate-100">
              {d.recentActivities.map((a) => (
                <li key={a._id} className="px-4 py-3 flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-slate-800 truncate">{a.title || activityTypeLabel(a.type, L)}</p>
                    <p className="text-xs text-slate-500">
                      {a.date} · {platformLabel(a.platform, L)} · {activityTypeLabel(a.type, L)}
                      {a.performedByName ? ` · ${a.performedByName}` : ''}
                    </p>
                  </div>
                  <span className="text-xs text-slate-500 tabular-nums shrink-0">{num(a.metrics?.impressions)}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
