'use client';
import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { useAuth } from '@/context/AuthContext';
import { useLanguage } from '@/context/LanguageContext';
import { useSocket } from '@/hooks/useSocket';
import api from '@/lib/api';
import { getCRMTranslations } from '@/lib/translations';
import { BarChart3, Building2, TrendingUp, CalendarDays } from 'lucide-react';
import {
  isCrmStaff, CrmActivity, CrmCompany, CrmOptions, optLabel, companyName, money, fmtDateTime,
} from '@/lib/crm';
import { Spinner, PageHeader, StatCard, StarRating } from '@/components/crm/CrmKit';

interface DashboardData {
  companiesTotal: number;
  companiesByStatus: Record<string, number>;
  contactsTotal: number;
  openDealsCount: number;
  pipelineValue: number;
  dealsByStage: Record<string, { count: number; value: number }>;
  wonThisMonth: { count: number; value: number };
  openTasks: number;
  overdueTasks: number;
  tasksDueToday: number;
  recentActivities: CrmActivity[];
  topCompanies: CrmCompany[];
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

  if (!isCrmStaff(user?.role)) return <div className="text-slate-500 p-8">{ar ? 'لا تملك صلاحية' : 'Not authorized'}</div>;
  if (loading || !data) return <Spinner />;

  const stages = opts?.PIPELINE_STAGES.filter((s) => s.key !== 'won' && s.key !== 'lost') || [];
  const maxStage = Math.max(1, ...stages.map((s) => data.dealsByStage[s.key]?.count || 0));

  return (
    <div className="space-y-6" dir={isRTL ? 'rtl' : 'ltr'}>
      <PageHeader icon={<BarChart3 className="w-5 h-5" />} title={T.crm} subtitle={T.overview} />

      {/* Stat cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <Link href="/system/crm/companies"><StatCard label={T.totalCompanies} value={data.companiesTotal} accent="text-blue-600" /></Link>
        <Link href="/system/crm/contacts"><StatCard label={T.totalContacts} value={data.contactsTotal} accent="text-purple-600" /></Link>
        <Link href="/system/crm/deals"><StatCard label={T.openDeals} value={data.openDealsCount} accent="text-amber-700" /></Link>
        <Link href="/system/crm/deals"><StatCard label={T.pipelineValue} value={money(data.pipelineValue)} accent="text-green-600" /></Link>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard label={T.wonThisMonth} value={`${data.wonThisMonth.count} · ${money(data.wonThisMonth.value)}`} accent="text-green-600" />
        <Link href="/system/crm/tasks"><StatCard label={T.openTasks} value={data.openTasks} /></Link>
        <Link href="/system/crm/tasks"><StatCard label={T.overdue} value={data.overdueTasks} accent="text-red-600" /></Link>
        <Link href="/system/crm/tasks"><StatCard label={T.dueToday} value={data.tasksDueToday} accent="text-amber-700" /></Link>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Deals by stage */}
        <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-sm">
          <h3 className="bg-slate-900 px-3 py-2 rounded-lg text-white font-semibold mb-4 flex items-center gap-2"><TrendingUp className="w-4 h-4 text-[#f37121]" /> {T.byStage}</h3>
          <div className="space-y-3">
            {stages.map((s) => {
              const cell = data.dealsByStage[s.key] || { count: 0, value: 0 };
              return (
                <div key={s.key}>
                  <div className="flex justify-between text-sm mb-1">
                    <span className="text-slate-700">{ar ? s.nameAr : s.nameEn}</span>
                    <span className="text-slate-500">{cell.count} · {money(cell.value)}</span>
                  </div>
                  <div className="h-2 rounded-full bg-slate-100 overflow-hidden">
                    <div className="h-full rounded-full" style={{ width: `${(cell.count / maxStage) * 100}%`, backgroundColor: s.color || '#f37121' }} />
                  </div>
                </div>
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
              <div key={s.key} className="flex items-center justify-between bg-slate-100 rounded-lg px-3 py-2">
                <span className="text-slate-700 text-sm">{ar ? s.nameAr : s.nameEn}</span>
                <span className="text-slate-900 font-bold">{data.companiesByStatus[s.key] || 0}</span>
              </div>
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
              <div key={a._id} className="flex items-start justify-between gap-2 border-b border-slate-200/70 pb-2">
                <div className="min-w-0">
                  <p className="text-slate-800 text-sm truncate">{a.subject}</p>
                  <p className="text-slate-500 text-xs">{optLabel(opts?.ACTIVITY_TYPES, a.type, lang)} · {companyName(a.company, lang)}</p>
                </div>
                <span className="text-slate-500 text-xs whitespace-nowrap">{fmtDateTime(a.date)}</span>
              </div>
            ))}
            {data.recentActivities.length === 0 && <p className="text-slate-500 text-sm">{T.noActivity}</p>}
          </div>
        </div>
      </div>
    </div>
  );
}
