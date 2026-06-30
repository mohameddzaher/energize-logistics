'use client';
import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { useAuth } from '@/context/AuthContext';
import { useLanguage } from '@/context/LanguageContext';
import { useSocket } from '@/hooks/useSocket';
import api from '@/lib/api';
import { getCRMTranslations } from '@/lib/translations';
import { BarChart3, Building2, TrendingUp, CalendarDays, Activity, Trophy, ListChecks } from 'lucide-react';
import {
  isCrmStaff, CrmActivity, CrmCompany, CrmDeal, CrmTask, CrmOptions, optLabel, companyName, contactName, money, fmtDateTime, fmtDate, dueBadge, daysUntil,
} from '@/lib/crm';
import { Spinner, PageHeader, StatCard, StarRating } from '@/components/crm/CrmKit';
import OpsLiveSummary from '@/components/ops/OpsLiveSummary';

interface DashboardData {
  companiesTotal: number;
  companiesByStatus: Record<string, number>;
  contactsTotal: number;
  openDealsCount: number;
  pipelineValue: number;
  dealsByStage: Record<string, { count: number; value: number }>;
  wonThisMonth: { count: number; value: number };
  lostThisMonth: { count: number; value: number };
  winRate: number;
  activitiesThisWeek: number;
  activitiesByType: Record<string, number>;
  openTasks: number;
  overdueTasks: number;
  tasksDueToday: number;
  recentActivities: CrmActivity[];
  topCompanies: CrmCompany[];
  topDeals: CrmDeal[];
  upcomingTasks: CrmTask[];
  recentDeals: CrmDeal[];
}

export default function CrmDashboardPage() {
  const { user } = useAuth();
  const { lang, isRTL } = useLanguage();
  const ar = lang === 'ar';
  const T = getCRMTranslations(lang);
  const [data, setData] = useState<DashboardData | null>(null);
  const [opts, setOpts] = useState<CrmOptions | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const [d, o] = await Promise.all([
        api.get<DashboardData>('/api/crm/dashboard'),
        api.get<CrmOptions>('/api/crm/options'),
      ]);
      setData(d);
      setOpts(o);
    } catch { /* handled by layout */ }
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);
  useSocket('crm:deal', useCallback(() => load(), [load]));
  useSocket('crm:task', useCallback(() => load(), [load]));
  useSocket('crm:company', useCallback(() => load(), [load]));
  useSocket('crm:activity', useCallback(() => load(), [load]));
  useSocket('crm:contact', useCallback(() => load(), [load]));

  if (!isCrmStaff(user?.role)) return <div className="text-slate-500 p-8">{ar ? 'لا تملك صلاحية' : 'Not authorized'}</div>;
  if (loading || !data) return <Spinner />;

  const stages = opts?.PIPELINE_STAGES.filter((s) => s.key !== 'won' && s.key !== 'lost') || [];
  const maxStage = Math.max(1, ...stages.map((s) => data.dealsByStage[s.key]?.count || 0));
  // Average rating across the top-rated companies returned by the API.
  const avgRating = data.topCompanies.length
    ? data.topCompanies.reduce((s, c) => s + (c.rating || 0), 0) / data.topCompanies.length
    : 0;

  return (
    <div className="space-y-6" dir={isRTL ? 'rtl' : 'ltr'}>
      <PageHeader icon={<BarChart3 className="w-5 h-5" />} title={T.crm} subtitle={T.overview} />

      <OpsLiveSummary />

      {/* Stat cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <Link href="/system/crm/companies"><StatCard label={T.totalCompanies} value={data.companiesTotal} accent="text-blue-600" /></Link>
        <Link href="/system/crm/contacts"><StatCard label={T.totalContacts} value={data.contactsTotal} accent="text-purple-600" /></Link>
        <Link href="/system/crm/deals"><StatCard label={T.openDeals} value={data.openDealsCount} accent="text-amber-700" /></Link>
        <Link href="/system/crm/deals"><StatCard label={T.pipelineValue} value={money(data.pipelineValue)} accent="text-green-600" /></Link>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <Link href="/system/crm/deals"><StatCard label={T.wonThisMonth} value={`${data.wonThisMonth.count} · ${money(data.wonThisMonth.value)}`} accent="text-green-600" /></Link>
        <Link href="/system/crm/tasks"><StatCard label={T.openTasks} value={data.openTasks} /></Link>
        <Link href="/system/crm/tasks"><StatCard label={T.overdue} value={data.overdueTasks} accent="text-red-600" /></Link>
        <Link href="/system/crm/tasks"><StatCard label={T.dueToday} value={data.tasksDueToday} accent="text-amber-700" /></Link>
      </div>

      {/* Performance KPIs */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <Link href="/system/crm/deals">
          <StatCard label={ar ? 'نسبة الفوز (الشهر)' : 'Win rate (MTD)'} value={`${data.winRate}%`} accent="text-green-600" />
        </Link>
        <Link href="/system/crm/deals">
          <StatCard label={ar ? 'صفقات خاسرة (الشهر)' : 'Lost (MTD)'} value={`${data.lostThisMonth.count} · ${money(data.lostThisMonth.value)}`} accent="text-red-600" />
        </Link>
        <Link href="/system/crm/activities">
          <StatCard label={ar ? 'أنشطة هذا الأسبوع' : 'Activities this week'} value={data.activitiesThisWeek} accent="text-blue-600" />
        </Link>
        <Link href="/system/crm/companies">
          <StatCard label={ar ? 'متوسط التقييم' : 'Avg. company rating'} value={avgRating.toFixed(1)} accent="text-amber-700" />
        </Link>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Deals by stage */}
        <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-sm">
          <h3 className="bg-slate-900 px-3 py-2 rounded-lg text-white font-semibold mb-4 flex items-center gap-2"><TrendingUp className="w-4 h-4 text-[#f37121]" /> {T.byStage}</h3>
          <div className="space-y-3">
            {stages.map((s) => {
              const cell = data.dealsByStage[s.key] || { count: 0, value: 0 };
              return (
                <Link key={s.key} href={`/system/crm/deals?stage=${s.key}`} className="block hover:bg-slate-50 rounded-lg -mx-2 px-2 py-1 transition-colors">
                  <div className="flex justify-between text-sm mb-1">
                    <span className="text-slate-700">{ar ? s.nameAr : s.nameEn}</span>
                    <span className="text-slate-500">{cell.count} · {money(cell.value)}</span>
                  </div>
                  <div className="h-2 rounded-full bg-slate-100 overflow-hidden">
                    <div className="h-full rounded-full" style={{ width: `${(cell.count / maxStage) * 100}%`, backgroundColor: s.color || '#f37121' }} />
                  </div>
                </Link>
              );
            })}
            {stages.length === 0 && <p className="text-slate-500 text-sm">—</p>}
          </div>
        </div>

        {/* Companies by status */}
        <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-sm">
          <h3 className="bg-slate-900 px-3 py-2 rounded-lg text-white font-semibold mb-4 flex items-center gap-2"><Building2 className="w-4 h-4 text-[#f37121]" /> {T.byStatus}</h3>
          <div className="grid grid-cols-2 gap-3">
            {(opts?.COMPANY_STATUSES || []).map((s) => (
              <Link key={s.key} href={`/system/crm/companies?status=${s.key}`} className="flex items-center justify-between bg-slate-100 hover:bg-slate-200 rounded-lg px-3 py-2 transition-colors">
                <span className="text-slate-700 text-sm">{ar ? s.nameAr : s.nameEn}</span>
                <span className="text-slate-900 font-bold">{data.companiesByStatus[s.key] || 0}</span>
              </Link>
            ))}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Top rated companies */}
        <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-sm">
          <h3 className="bg-slate-900 px-3 py-2 rounded-lg text-white font-semibold mb-4">{T.topRated}</h3>
          <div className="space-y-2">
            {data.topCompanies.map((c) => (
              <Link key={c._id} href={`/system/crm/companies/${c._id}`} className="flex items-center justify-between hover:bg-slate-100 rounded-lg px-3 py-2">
                <span className="text-slate-800 text-sm">{companyName(c, lang)}</span>
                <StarRating value={c.rating || 0} size={14} />
              </Link>
            ))}
            {data.topCompanies.length === 0 && <p className="text-slate-500 text-sm">—</p>}
          </div>
        </div>

        {/* Recent activity */}
        <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-sm">
          <h3 className="bg-slate-900 px-3 py-2 rounded-lg text-white font-semibold mb-4 flex items-center gap-2"><CalendarDays className="w-4 h-4 text-[#f37121]" /> {T.recentActivity}</h3>
          <div className="space-y-2">
            {data.recentActivities.map((a) => (
              <Link
                key={a._id}
                href={a.company?._id ? `/system/crm/companies/${a.company._id}` : '/system/crm/activities'}
                className="flex items-start justify-between gap-2 border-b border-slate-200/70 pb-2 hover:bg-slate-50 rounded-lg -mx-2 px-2 transition-colors"
              >
                <div className="min-w-0">
                  <p className="text-slate-800 text-sm truncate">{a.subject}</p>
                  <p className="text-slate-500 text-xs truncate">{optLabel(opts?.ACTIVITY_TYPES, a.type, lang)} · {companyName(a.company, lang)}</p>
                </div>
                <span className="text-slate-500 text-xs whitespace-nowrap">{fmtDateTime(a.date)}</span>
              </Link>
            ))}
            {data.recentActivities.length === 0 && <p className="text-slate-500 text-sm">{T.noActivity}</p>}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Top open deals by value */}
        <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-sm">
          <h3 className="bg-slate-900 px-3 py-2 rounded-lg text-white font-semibold mb-4 flex items-center gap-2"><Trophy className="w-4 h-4 text-[#f37121]" /> {ar ? 'أكبر الصفقات المفتوحة' : 'Top open deals'}</h3>
          <div className="space-y-2">
            {data.topDeals.map((d) => (
              <Link key={d._id} href="/system/crm/deals" className="flex items-center justify-between gap-2 hover:bg-slate-100 rounded-lg px-3 py-2 transition-colors">
                <div className="min-w-0">
                  <p className="text-slate-800 text-sm truncate">{d.title}</p>
                  <p className="text-slate-500 text-xs truncate">{companyName(d.company, lang)} · {optLabel(opts?.PIPELINE_STAGES, d.stage, lang)}</p>
                </div>
                <span className="text-green-600 font-semibold text-sm whitespace-nowrap">{money(d.value, d.currency)}</span>
              </Link>
            ))}
            {data.topDeals.length === 0 && <p className="text-slate-500 text-sm">—</p>}
          </div>
        </div>

        {/* Upcoming tasks */}
        <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-sm">
          <h3 className="bg-slate-900 px-3 py-2 rounded-lg text-white font-semibold mb-4 flex items-center gap-2"><ListChecks className="w-4 h-4 text-[#f37121]" /> {ar ? 'المهام القادمة' : 'Upcoming tasks'}</h3>
          <div className="space-y-2">
            {data.upcomingTasks.map((t) => {
              const badge = dueBadge(t.dueDate, lang);
              return (
                <Link key={t._id} href="/system/crm/tasks" className="flex items-center justify-between gap-2 hover:bg-slate-100 rounded-lg px-3 py-2 transition-colors">
                  <div className="min-w-0">
                    <p className="text-slate-800 text-sm truncate">{t.title}</p>
                    <p className="text-slate-500 text-xs truncate">{companyName(t.company, lang)}{t.contact ? ` · ${contactName(t.contact, lang)}` : ''}</p>
                  </div>
                  <div className="flex items-center gap-2 whitespace-nowrap">
                    <span className="text-slate-500 text-xs">{fmtDate(t.dueDate)}</span>
                    {badge && daysUntil(t.dueDate) !== null && daysUntil(t.dueDate)! <= 3 && (
                      <span className={`text-xs px-2 py-0.5 rounded-full ${daysUntil(t.dueDate)! <= 0 ? 'bg-amber-100 text-amber-700' : 'bg-slate-100 text-slate-600'}`}>{badge.label}</span>
                    )}
                  </div>
                </Link>
              );
            })}
            {data.upcomingTasks.length === 0 && <p className="text-slate-500 text-sm">—</p>}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Recently updated deals */}
        <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-sm">
          <h3 className="bg-slate-900 px-3 py-2 rounded-lg text-white font-semibold mb-4 flex items-center gap-2"><TrendingUp className="w-4 h-4 text-[#f37121]" /> {ar ? 'أحدث الصفقات' : 'Recent deals'}</h3>
          <div className="space-y-2">
            {data.recentDeals.map((d) => (
              <Link key={d._id} href="/system/crm/deals" className="flex items-center justify-between gap-2 hover:bg-slate-100 rounded-lg px-3 py-2 transition-colors">
                <div className="min-w-0">
                  <p className="text-slate-800 text-sm truncate">{d.title}</p>
                  <p className="text-slate-500 text-xs truncate">{companyName(d.company, lang)}</p>
                </div>
                <div className="flex items-center gap-2 whitespace-nowrap">
                  <span className={`text-xs px-2 py-0.5 rounded-full ${d.status === 'won' ? 'bg-green-100 text-green-700' : d.status === 'lost' ? 'bg-red-100 text-red-700' : 'bg-blue-100 text-blue-700'}`}>
                    {d.status === 'won' ? (ar ? 'فوز' : 'Won') : d.status === 'lost' ? (ar ? 'خسارة' : 'Lost') : (ar ? 'مفتوحة' : 'Open')}
                  </span>
                  <span className="text-slate-500 text-sm">{money(d.value, d.currency)}</span>
                </div>
              </Link>
            ))}
            {data.recentDeals.length === 0 && <p className="text-slate-500 text-sm">—</p>}
          </div>
        </div>

        {/* Activities this week by type */}
        <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-sm">
          <h3 className="bg-slate-900 px-3 py-2 rounded-lg text-white font-semibold mb-4 flex items-center gap-2"><Activity className="w-4 h-4 text-[#f37121]" /> {ar ? 'أنشطة الأسبوع حسب النوع' : 'This week by type'}</h3>
          <div className="grid grid-cols-2 gap-3">
            {(opts?.ACTIVITY_TYPES || []).map((t) => (
              <Link key={t.key} href="/system/crm/activities" className="flex items-center justify-between bg-slate-100 hover:bg-slate-200 rounded-lg px-3 py-2 transition-colors">
                <span className="text-slate-700 text-sm">{ar ? t.nameAr : t.nameEn}</span>
                <span className="text-slate-900 font-bold">{data.activitiesByType[t.key] || 0}</span>
              </Link>
            ))}
            {(opts?.ACTIVITY_TYPES || []).length === 0 && <p className="text-slate-500 text-sm">—</p>}
          </div>
        </div>
      </div>
    </div>
  );
}
