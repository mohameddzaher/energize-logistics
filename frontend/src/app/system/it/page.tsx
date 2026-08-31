'use client';
import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { useAuth } from '@/context/AuthContext';
import { useLanguage } from '@/context/LanguageContext';
import { useSocket } from '@/hooks/useSocket';
import api from '@/lib/api';
import { useRouter } from 'next/navigation';
import { MonitorCog, AlertTriangle, RefreshCw, CalendarClock, ArrowRight, Laptop } from 'lucide-react';
import {
  LineChart, Line, BarChart, Bar, PieChart, Pie, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
} from 'recharts';
import { Spinner, PageHeader, StatCard, SmallBadge, ExportButton } from '@/components/hr/HRKit';
import { exportMultiSheet } from '@/utils/exportExcel';
import {
  canViewIt, Dashboard, categoryLabel, priorityLabel, ticketStatusLabel,
  systemStatusLabel, TICKET_STATUSES, fmtDate, fmtDuration, daysAgo, today,
  daysUntil, renewalTone, bucketLabel, custodyTypeLabel, conditionLabel,
} from '@/lib/it';
import { CustodyCards, CustodyStateButtons } from '@/components/it/CustodyOverview';
import DateRangeFilter from '@/components/system/DateRangeFilter';

const PIE_COLORS = ['#f37121', '#3b82f6', '#f59e0b', '#ef4444', '#10b981', '#8b5cf6'];

export default function ItDashboardPage() {
  const router = useRouter();
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
  const custody = data?.custody;
  const custodyBuckets = (custody?.buckets || []).map((b) => ({ key: b.key, count: b.count }));
  const systemsDown = (t?.systemsByStatus || []).filter((s) => s.key === 'down' || s.key === 'degraded').reduce((s, r) => s + r.count, 0);

  const categoryData = (t?.ticketsByCategory || []).map((r) => ({ name: categoryLabel(r.key, lang), count: r.count }));
  const priorityData = (t?.ticketsByPriority || []).map((r) => ({ name: priorityLabel(r.key, lang), value: r.count }));
  const timelineData = (t?.timeline || []).map((r) => ({ ...r, label: r.date.slice(5) }));

  // One workbook, one sheet per block of the dashboard — a flat dump of a chart
  // is useless, so each breakdown keeps its own sheet with readable labels.
  const exportDashboard = () => exportMultiSheet([
    {
      name: 'Summary',
      columns: [{ header: 'Metric', key: 'metric', width: 30 }, { header: 'Value', key: 'value', width: 16 }],
      data: [
        { metric: 'Period', value: `${from} → ${to}` },
        { metric: 'Open tickets', value: t?.openTickets ?? 0 },
        { metric: 'In progress', value: t?.inProgress ?? 0 },
        { metric: 'Resolved in period', value: t?.resolvedThisPeriod ?? 0 },
        { metric: 'Avg resolution (days)', value: Math.round((t?.avgResolutionMinutes ?? 0) / 1440) },
        { metric: 'Systems down or degraded', value: systemsDown },
        { metric: 'Custody items assigned', value: t?.assetsAssigned ?? 0 },
        { metric: 'Units in store', value: t?.stockCount ?? t?.assetsInStock ?? 0 },
      ],
    },
    {
      name: 'By category',
      columns: [{ header: 'Category', key: 'name', width: 24 }, { header: 'Tickets', key: 'count', width: 12 }],
      data: categoryData,
    },
    {
      name: 'By priority',
      columns: [{ header: 'Priority', key: 'name', width: 24 }, { header: 'Tickets', key: 'value', width: 12 }],
      data: priorityData,
    },
    {
      name: 'By status',
      columns: [{ header: 'Status', key: 'name', width: 24 }, { header: 'Tickets', key: 'count', width: 12 }],
      data: (t?.ticketsByStatus || []).map((r) => ({ name: ticketStatusLabel(r.key, 'en'), count: r.count })),
    },
    {
      name: 'Opened vs resolved',
      columns: [
        { header: 'Date', key: 'date', width: 14 },
        { header: 'Opened', key: 'opened', width: 10 },
        { header: 'Resolved', key: 'resolved', width: 10 },
      ],
      data: t?.timeline || [],
    },
    {
      name: 'Custody by category',
      columns: [{ header: 'Category', key: 'name', width: 24 }, { header: 'Items', key: 'count', width: 10 }],
      data: (custody?.buckets || []).map((b) => ({ name: b.nameEn, count: b.count })),
    },
    {
      name: 'Custody by state',
      columns: [{ header: 'State', key: 'name', width: 24 }, { header: 'Items', key: 'count', width: 10 }],
      data: [
        { name: 'With employee', count: custody?.byStatus.assigned ?? 0 },
        { name: 'In store', count: custody?.byStatus.in_stock ?? 0 },
        { name: 'Faulty', count: custody?.byStatus.returned ?? 0 },
      ],
    },
    {
      name: 'Store by type',
      columns: [{ header: 'Type', key: 'name', width: 24 }, { header: 'Units', key: 'count', width: 10 }],
      data: (t?.stockByType || []).map((r) => ({ name: r.key, count: r.count })),
    },
    {
      name: 'Low stock',
      columns: [{ header: 'Type', key: 'name', width: 24 }, { header: 'Units left', key: 'count', width: 12 }],
      data: (t?.lowStock || []).map((r) => ({ name: r.key, count: r.count })),
    },
    {
      name: 'Renewals due',
      columns: [
        { header: 'System', key: 'name', width: 28 },
        { header: 'Renewal date', key: 'renewalDate', width: 14 },
        { header: 'Cost', key: 'cost', width: 12 },
        { header: 'Period', key: 'costPeriod', width: 12 },
      ],
      data: t?.renewalsDueSoon || [],
    },
  ], `it-dashboard-${to}`);

  return (
    <div className="space-y-6" dir={isRTL ? 'rtl' : 'ltr'}>
      <PageHeader
        icon={<MonitorCog className="w-5 h-5" />}
        title={ar ? 'البرمجيات وتقنية المعلومات' : 'Software & IT'}
        subtitle={ar ? 'نظرة عامة على الدعم الفني والأنظمة والعهد' : 'Support, systems and custody at a glance'}
      >
        <div className="flex items-center gap-2">
          <DateRangeFilter ar={ar} from={from} to={to} onFrom={setFrom} onTo={setTo} />
          <ExportButton label={ar ? 'تصدير Excel' : 'Export Excel'} onClick={exportDashboard} />
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

      {/* ── العهد ───────────────────────────────────────────────────────────
          كروت العهد وأزرارها كاملة على اللوحة: القسم يُسأل عن أعداد العهد أكثر
          مما يُسأل عن البلاغات، وإرسال المستخدم إلى صفحة أخرى ليعرف كم لابتوباً
          لدينا يجعل اللوحة صفحة عبور لا لوحة. الأرقام محسوبة في الخادم من نفس
          التجميع الذي تقرأه صفحة العهد، والضغط ينقل إليها على نفس الفلتر. */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold text-slate-900 flex items-center gap-2">
            <Laptop className="w-4 h-4 text-[#f37121]" />
            {ar ? 'العهد' : 'Custody'}
            <span className="text-xs font-normal text-slate-400">
              {ar ? `${custody?.total ?? 0} صنف في السجل` : `${custody?.total ?? 0} items on the register`}
            </span>
          </h3>
          <Link href="/system/it/custody" className="text-xs font-medium text-[#f37121] hover:text-[#d85f16] flex items-center gap-1">
            {ar ? 'السجل الكامل' : 'Full register'} <ArrowRight className={`w-3.5 h-3.5 ${isRTL ? 'rotate-180' : ''}`} />
          </Link>
        </div>

        <CustodyCards
          buckets={custodyBuckets}
          active=""
          onPick={(k) => k && router.push(`/system/it/custody?bucket=${k}`)}
          lang={lang}
        />

        <CustodyStateButtons
          byStatus={custody?.byStatus || { assigned: 0, in_stock: 0, returned: 0 }}
          active=""
          onPick={(k) => k && router.push(`/system/it/custody?status=${k}`)}
          lang={lang}
        />

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {/* الحالة الفنية — فلتر قائم بذاته في صفحة العهد، ومختصره هنا. */}
          <div className="rounded-xl border border-slate-200 bg-white shadow-sm p-5">
            <p className="text-xs font-semibold text-slate-500 mb-3">{ar ? 'حسب الحالة الفنية' : 'By condition'}</p>
            {(custody?.byCondition || []).length === 0 ? (
              <p className="text-sm text-slate-400">{ar ? 'لا توجد بيانات.' : 'Nothing to show.'}</p>
            ) : (
              <div className="flex flex-wrap gap-2">
                {(custody?.byCondition || []).map((c) => (
                  <Link key={c.key} href={`/system/it/custody?condition=${c.key}`}
                    className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600 hover:border-[#f37121]/50 hover:bg-[#f37121]/5">
                    {conditionLabel(c.key, lang)}
                    <span className="ms-2 text-sm font-semibold text-slate-900 tabular-nums">{c.count}</span>
                  </Link>
                ))}
              </div>
            )}
          </div>

          {/* تفصيل «أخرى» — الكارت وحده يقول «١٤٠ صنفاً آخر» ولا يقول ما هي. */}
          <div className="rounded-xl border border-slate-200 bg-white shadow-sm p-5">
            <p className="text-xs font-semibold text-slate-500 mb-3">
              {ar ? `تفصيل «${bucketLabel('other', lang)}»` : `Inside "${bucketLabel('other', lang)}"`}
            </p>
            {(custody?.otherKinds || []).length === 0 ? (
              <p className="text-sm text-slate-400">{ar ? 'لا توجد أصناف أخرى.' : 'Nothing here.'}</p>
            ) : (
              <div className="flex flex-wrap gap-2">
                {(custody?.otherKinds || []).map((k) => (
                  // الرابط يحمل النوع المفصّل كذلك: كان يفتح دلو «أخرى» كله،
                  // فيضغط المستخدم على «شنطة لابتوب ٣٤» ويجد أمامه ٦٣ صفاً.
                  <Link key={k.key} href={`/system/it/custody?bucket=other&otherType=${k.key}`}
                    className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600 hover:border-[#f37121]/50 hover:bg-[#f37121]/5">
                    {custodyTypeLabel(k.key, lang)}
                    <span className="ms-2 text-sm font-semibold text-slate-900 tabular-nums">{k.count}</span>
                  </Link>
                ))}
              </div>
            )}
          </div>
        </div>
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
