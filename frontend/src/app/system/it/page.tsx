'use client';
import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { useAuth } from '@/context/AuthContext';
import { useLanguage } from '@/context/LanguageContext';
import { useSocket } from '@/hooks/useSocket';
import api from '@/lib/api';
import { MonitorCog, AlertTriangle, RefreshCw, CalendarClock, ArrowRight } from 'lucide-react';
import {
  LineChart, Line, BarChart, Bar, PieChart, Pie, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
} from 'recharts';
import { Spinner, PageHeader, StatCard, SmallBadge } from '@/components/hr/HRKit';
import {
  canViewIt, Dashboard, categoryLabel, priorityLabel, ticketStatusLabel,
  systemStatusLabel, TICKET_STATUSES, fmtDate, fmtDuration, daysAgo, today,
  daysUntil, renewalTone,
} from '@/lib/it';

const PIE_COLORS = ['#f37121', '#3b82f6', '#f59e0b', '#ef4444', '#10b981', '#8b5cf6'];

export default function ItDashboardPage() {
  const { user } = useAuth();
  const { lang, isRTL } = useLanguage();
  const ar = lang === 'ar';
  const staff = canViewIt(user);

  const [data, setData] = useState<Dashboard | null>(null);
  const [loading, setLoading] = useState(true);
  const [from, setFrom] = useState(daysAgo(89));
  const [to, setTo] = useState(today());

  const load = useCallback(async () => {
    try {
      const d = await api.get<Dashboard>(`/api/it/dashboard?from=${from}&to=${to}`);
      setData(d);
    } catch {}
    setLoading(false);
  }, [from, to]);

  useEffect(() => { load(); }, [load]);
  useSocket('it:updated', useCallback(() => load(), [load]));

  if (!staff) return <div className="text-slate-500 p-8">{ar ? 'غير مصرح لك بالوصول لهذا القسم.' : 'You are not authorized to view this section.'}</div>;
  if (loading) return <Spinner />;

  const t = data?.totals;
  const systemsDown = (t?.systemsByStatus || []).filter((s) => s.key === 'down' || s.key === 'degraded').reduce((s, r) => s + r.count, 0);

  const categoryData = (t?.ticketsByCategory || []).map((r) => ({ name: categoryLabel(r.key, lang), count: r.count }));
  const priorityData = (t?.ticketsByPriority || []).map((r) => ({ name: priorityLabel(r.key, lang), value: r.count }));
  const timelineData = (t?.timeline || []).map((r) => ({ ...r, label: r.date.slice(5) }));

  return (
    <div className="space-y-6" dir={isRTL ? 'rtl' : 'ltr'}>
      <PageHeader
        icon={<MonitorCog className="w-5 h-5" />}
        title={ar ? 'البرمجيات وتقنية المعلومات' : 'Software & IT'}
        subtitle={ar ? 'نظرة عامة على الدعم الفني والأنظمة والعهد' : 'Support, systems and custody at a glance'}
      >
        <div className="flex items-center gap-2">
          <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="px-3 py-2 rounded-lg border border-slate-200 bg-white text-sm text-slate-900" />
          <span className="text-slate-400 text-sm">→</span>
          <input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="px-3 py-2 rounded-lg border border-slate-200 bg-white text-sm text-slate-900" />
        </div>
      </PageHeader>

      <div className="grid grid-cols-2 lg:grid-cols-6 gap-3">
        <StatCard label={ar ? 'بلاغات مفتوحة' : 'Open tickets'} value={t?.openTickets ?? 0} accent="text-amber-600" />
        <StatCard label={ar ? 'قيد التنفيذ' : 'In progress'} value={t?.inProgress ?? 0} accent="text-blue-600" />
        <StatCard label={ar ? 'تم حلها في الفترة' : 'Resolved this period'} value={t?.resolvedThisPeriod ?? 0} accent="text-green-600" />
        <StatCard label={ar ? 'متوسط زمن الحل' : 'Avg resolution'} value={fmtDuration(t?.avgResolutionMinutes, lang)} accent="text-[#f37121]" />
        <StatCard label={ar ? 'عهد مسلّمة' : 'Assets assigned'} value={t?.assetsAssigned ?? 0} accent="text-indigo-600" />
        <StatCard label={ar ? 'أنظمة متعثرة' : 'Systems down'} value={systemsDown} accent={systemsDown ? 'text-red-600' : 'text-slate-900'} />
      </div>

      {/* Opened vs resolved — the line that matters: if opened outpaces resolved
          for long, the backlog is growing. */}
      <div className="rounded-xl border border-slate-200 bg-white shadow-sm p-5">
        <h3 className="text-sm font-semibold text-slate-900 mb-4">{ar ? 'البلاغات المفتوحة مقابل المحلولة' : 'Opened vs resolved'}</h3>
        <div className="h-72">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={timelineData}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
              <XAxis dataKey="label" tick={{ fontSize: 11, fill: '#64748b' }} />
              <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: '#64748b' }} />
              <Tooltip />
              <Legend />
              <Line type="monotone" dataKey="opened" name={ar ? 'مفتوحة' : 'Opened'} stroke="#f37121" strokeWidth={2} dot={false} />
              <Line type="monotone" dataKey="resolved" name={ar ? 'تم حلها' : 'Resolved'} stroke="#10b981" strokeWidth={2} dot={false} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="rounded-xl border border-slate-200 bg-white shadow-sm p-5">
          <h3 className="text-sm font-semibold text-slate-900 mb-4">{ar ? 'البلاغات حسب التصنيف' : 'Tickets by category'}</h3>
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={categoryData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                <XAxis dataKey="name" tick={{ fontSize: 10, fill: '#64748b' }} interval={0} angle={-25} textAnchor="end" height={70} />
                <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: '#64748b' }} />
                <Tooltip />
                <Bar dataKey="count" name={ar ? 'العدد' : 'Count'} fill="#f37121" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="rounded-xl border border-slate-200 bg-white shadow-sm p-5">
          <h3 className="text-sm font-semibold text-slate-900 mb-4">{ar ? 'البلاغات حسب الأولوية' : 'Tickets by priority'}</h3>
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie data={priorityData} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={90} label>
                  {priorityData.map((_, i) => <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />)}
                </Pie>
                <Tooltip />
                <Legend />
              </PieChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      {/* Recurring problems — deliberately loud. A repeat is a root cause that
          was never fixed, not a ticket that needs closing faster. */}
      <div className="rounded-xl border border-red-200 bg-red-50/60 shadow-sm p-5">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-semibold text-red-800 flex items-center gap-2">
            <AlertTriangle className="w-4 h-4" />
            {ar ? 'المشكلات المتكررة' : 'Recurring problems'}
          </h3>
          <Link href="/system/it/recurring" className="text-xs font-medium text-red-700 hover:text-red-900 flex items-center gap-1">
            {ar ? 'التقرير الكامل' : 'Full report'} <ArrowRight className={`w-3.5 h-3.5 ${isRTL ? 'rotate-180' : ''}`} />
          </Link>
        </div>
        {(data?.topRecurring || []).length === 0 ? (
          <p className="text-sm text-red-700/70">{ar ? 'لا توجد مشكلات متكررة حالياً — وضع جيد.' : 'No recurring problems right now — all good.'}</p>
        ) : (
          <>
            <p className="text-xs text-red-700/80 mb-3">
              {ar ? 'هذه المشكلات تكررت أكثر من مرة وتحتاج معالجة جذرية دائمة وليس حلاً مؤقتاً.' : 'These problems came back more than once — they need a permanent root-cause fix, not another patch.'}
            </p>
            <div className="space-y-2">
              {(data?.topRecurring || []).map((g) => (
                <Link key={g.signature} href={`/system/it/recurring?sig=${encodeURIComponent(g.signature)}`}
                  className="flex items-center justify-between gap-3 rounded-lg border border-red-200 bg-white px-4 py-3 hover:border-red-300">
                  <div className="min-w-0">
                    <div className="text-sm font-medium text-slate-900 truncate">{g.sampleTitle}</div>
                    <div className="text-xs text-slate-500">
                      {categoryLabel(g.category, lang)} · {ar ? 'آخر بلاغ' : 'last'} {fmtDate(g.lastReportedAt)}
                    </div>
                  </div>
                  <span className="shrink-0 inline-flex items-center gap-1 rounded-full bg-red-500/15 px-2.5 py-1 text-xs font-semibold text-red-700">
                    <RefreshCw className="w-3 h-3" /> {g.count}× {ar ? 'تكرار' : 'times'}
                  </span>
                </Link>
              ))}
            </div>
          </>
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="rounded-xl border border-slate-200 bg-white shadow-sm p-5">
          <h3 className="text-sm font-semibold text-slate-900 mb-4 flex items-center gap-2">
            <CalendarClock className="w-4 h-4 text-[#f37121]" />
            {ar ? 'اشتراكات وتجديدات قريبة' : 'Renewals due soon'}
          </h3>
          {(t?.renewalsDueSoon || []).length === 0 ? (
            <p className="text-sm text-slate-500">{ar ? 'لا توجد تجديدات خلال ٦٠ يوماً.' : 'Nothing due in the next 60 days.'}</p>
          ) : (
            <div className="space-y-2">
              {(t?.renewalsDueSoon || []).map((s) => {
                const d = daysUntil(s.renewalDate);
                return (
                  <div key={s._id} className="flex items-center justify-between gap-3 border-b border-slate-100 pb-2 last:border-0">
                    <span className="text-sm text-slate-800 truncate">{ar && s.nameAr ? s.nameAr : s.name}</span>
                    <span className={`text-xs shrink-0 ${renewalTone(s.renewalDate)}`}>
                      {fmtDate(s.renewalDate)}
                      {d !== null && ` · ${d < 0 ? (ar ? `متأخر ${Math.abs(d)} يوم` : `${Math.abs(d)}d overdue`) : (ar ? `بعد ${d} يوم` : `in ${d}d`)}`}
                    </span>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <div className="rounded-xl border border-slate-200 bg-white shadow-sm p-5">
          <h3 className="text-sm font-semibold text-slate-900 mb-4">{ar ? 'أحدث البلاغات' : 'Recent tickets'}</h3>
          {(data?.recentTickets || []).length === 0 ? (
            <p className="text-sm text-slate-500">{ar ? 'لا توجد بلاغات.' : 'No tickets yet.'}</p>
          ) : (
            <div className="space-y-2">
              {(data?.recentTickets || []).map((tk) => (
                <Link key={tk._id} href={`/system/it/tickets/${tk._id}`}
                  className="flex items-center justify-between gap-3 border-b border-slate-100 pb-2 last:border-0 hover:bg-slate-50 -mx-2 px-2 rounded">
                  <div className="min-w-0">
                    <div className="text-sm text-slate-900 truncate">
                      {tk.isRecurring && <span className="text-red-600 me-1" title={ar ? 'مشكلة متكررة' : 'Recurring'}>⟳</span>}
                      {tk.title}
                    </div>
                    <div className="text-xs text-slate-500">{tk.ticketNumber} · {fmtDate(tk.reportedAt)}</div>
                  </div>
                  <SmallBadge
                    bg={TICKET_STATUSES[tk.status]?.bg || 'bg-slate-500/15'}
                    text={TICKET_STATUSES[tk.status]?.text || 'text-slate-700'}
                    label={ticketStatusLabel(tk.status, lang)}
                  />
                </Link>
              ))}
            </div>
          )}
        </div>
      </div>

      {(t?.systemsByStatus || []).length > 0 && (
        <div className="rounded-xl border border-slate-200 bg-white shadow-sm p-5">
          <h3 className="text-sm font-semibold text-slate-900 mb-3">{ar ? 'حالة الأنظمة' : 'Systems status'}</h3>
          <div className="flex flex-wrap gap-2">
            {(t?.systemsByStatus || []).map((s) => (
              <span key={s.key} className="rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-700">
                {systemStatusLabel(s.key, lang)}: <strong className="text-slate-900">{s.count}</strong>
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
