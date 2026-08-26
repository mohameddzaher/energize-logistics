'use client';
import { useState, useEffect, useCallback, Fragment } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useAuth } from '@/context/AuthContext';
import { useLanguage } from '@/context/LanguageContext';
import { useSocket } from '@/hooks/useSocket';
import api from '@/lib/api';
import { RefreshCw, ChevronDown, ChevronRight } from 'lucide-react';
import { exportToExcel } from '@/utils/exportExcel';
import { Spinner, PageHeader, SearchInput, ExportButton, SmallBadge, SearchableSelect } from '@/components/hr/HRKit';
import {
  canViewIt, RecurringGroup, Ticket, TICKET_CATEGORIES, TICKET_STATUSES,
  categoryLabel, ticketStatusLabel, optionsOf, fmtDate, fmtDuration, today,
} from '@/lib/it';

export default function RecurringPage() {
  const { user } = useAuth();
  const { lang, isRTL } = useLanguage();
  const ar = lang === 'ar';
  const staff = canViewIt(user);
  const params = useSearchParams();

  const [groups, setGroups] = useState<RecurringGroup[]>([]);
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('');
  const [expanded, setExpanded] = useState<string | null>(params?.get('sig') || null);

  const load = useCallback(async () => {
    try {
      const qs = categoryFilter ? `?category=${categoryFilter}` : '';
      const d = await api.get<{ groups: RecurringGroup[]; tickets: Ticket[] }>(`/api/it/tickets/recurring${qs}`);
      setGroups(d.groups || []);
      setTickets(d.tickets || []);
    } catch {}
    setLoading(false);
  }, [categoryFilter]);

  useEffect(() => { load(); }, [load]);
  useSocket('it:updated', useCallback(() => load(), [load]));

  const ticketById = new Map(tickets.map((t) => [t._id, t]));

  const filtered = groups.filter((g) => {
    const s = search.trim().toLowerCase();
    if (!s) return true;
    return g.sampleTitle.toLowerCase().includes(s) || categoryLabel(g.category, lang).toLowerCase().includes(s);
  });

  if (!staff) return <div className="text-slate-500 p-8">{ar ? 'غير مصرح لك بالوصول لهذا القسم.' : 'You are not authorized to view this section.'}</div>;
  if (loading) return <Spinner />;

  const totalRepeats = filtered.reduce((s, g) => s + g.count, 0);

  return (
    <div className="space-y-6" dir={isRTL ? 'rtl' : 'ltr'}>
      <PageHeader
        icon={<RefreshCw className="w-5 h-5" />}
        title={ar ? 'المشكلات المتكررة' : 'Recurring Problems'}
        subtitle={ar ? `${filtered.length} مشكلة متكررة · ${totalRepeats} بلاغ` : `${filtered.length} recurring problems · ${totalRepeats} tickets`}
      >
        <ExportButton label={ar ? 'تصدير Excel' : 'Export Excel'} onClick={() => exportToExcel(filtered, [
          { header: 'Problem', key: 'sampleTitle', width: 40 },
          { header: 'Category', key: 'category', transform: (v: any) => categoryLabel(v, 'en'), width: 18 },
          { header: 'Occurrences', key: 'count', width: 12 },
          { header: 'First seen', key: 'firstReportedAt', width: 14 },
          { header: 'Last seen', key: 'lastReportedAt', width: 14 },
          { header: 'Avg resolution', key: 'avgResolutionMinutes', transform: (v: any) => fmtDuration(v, 'en'), width: 16 },
          { header: 'Affected departments', key: 'affectedDepartments', transform: (v: any) => (v || []).join(', '), width: 32 },
        ], `it-recurring-${today()}`, 'Recurring')} />
      </PageHeader>

      <div className="flex flex-col sm:flex-row gap-3">
        <div className="flex-1 min-w-[240px]">
          <SearchInput value={search} onChange={setSearch} placeholder={ar ? 'بحث في المشكلات...' : 'Search problems...'} />
        </div>
        <div className="w-full sm:w-56 shrink-0">
          <SearchableSelect
            value={categoryFilter} onChange={setCategoryFilter}
            placeholder={ar ? 'كل التصنيفات' : 'All categories'} emptyLabel={ar ? 'كل التصنيفات' : 'All categories'}
            options={[{ value: '', label: ar ? 'كل التصنيفات' : 'All categories' }, ...optionsOf(TICKET_CATEGORIES).map((o) => ({ value: o.key, label: ar ? o.ar : o.en }))]}
          />
        </div>
      </div>

      <div className="rounded-xl border border-slate-200 bg-white shadow-sm overflow-x-auto">
        <table className="w-full text-sm">
          <thead><tr className="bg-slate-900 border-b border-slate-200 text-slate-300">
            <th className="w-8 px-4 py-3" />
            <th className="text-start font-semibold px-4 py-3">{ar ? 'المشكلة' : 'Problem'}</th>
            <th className="text-start font-semibold px-4 py-3">{ar ? 'التصنيف' : 'Category'}</th>
            <th className="text-start font-semibold px-4 py-3">{ar ? 'عدد التكرار' : 'Occurrences'}</th>
            <th className="text-start font-semibold px-4 py-3">{ar ? 'أول ظهور' : 'First seen'}</th>
            <th className="text-start font-semibold px-4 py-3">{ar ? 'آخر ظهور' : 'Last seen'}</th>
            <th className="text-start font-semibold px-4 py-3">{ar ? 'متوسط زمن الحل' : 'Avg resolution'}</th>
            <th className="text-start font-semibold px-4 py-3">{ar ? 'الأقسام المتأثرة' : 'Departments'}</th>
          </tr></thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr><td colSpan={8} className="text-center text-slate-500 py-12">{ar ? 'لا توجد مشكلات متكررة — وضع جيد.' : 'No recurring problems — all good.'}</td></tr>
            ) : filtered.map((g) => {
              const open = expanded === g.signature;
              return (
                <Fragment key={g.signature}>
                  <tr onClick={() => setExpanded(open ? null : g.signature)}
                    className="border-b border-slate-200/70 hover:bg-slate-50 cursor-pointer">
                    <td className="px-4 py-3 text-slate-400">
                      {open ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className={`w-4 h-4 ${isRTL ? 'rotate-180' : ''}`} />}
                    </td>
                    <td className="px-4 py-3 text-slate-900 font-medium">{g.sampleTitle}</td>
                    <td className="px-4 py-3">
                      <SmallBadge bg={TICKET_CATEGORIES[g.category]?.bg || 'bg-slate-500/15'} text={TICKET_CATEGORIES[g.category]?.text || 'text-slate-700'} label={categoryLabel(g.category, lang)} />
                    </td>
                    <td className="px-4 py-3">
                      <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-semibold ${g.count >= 5 ? 'bg-red-500/20 text-red-700' : 'bg-amber-500/20 text-amber-700'}`}>
                        <RefreshCw className="w-3 h-3" /> {g.count}×
                      </span>
                    </td>
                    <td className="px-4 py-3 text-slate-700">{fmtDate(g.firstReportedAt)}</td>
                    <td className="px-4 py-3 text-slate-700">{fmtDate(g.lastReportedAt)}</td>
                    <td className="px-4 py-3 text-slate-700">{fmtDuration(g.avgResolutionMinutes, lang)}</td>
                    <td className="px-4 py-3 text-slate-700 text-xs">{g.affectedDepartments.length ? g.affectedDepartments.join('، ') : '—'}</td>
                  </tr>
                  {open && (
                    <tr className="border-b border-slate-200/70 bg-slate-50/70">
                      <td />
                      <td colSpan={7} className="px-4 py-3">
                        <div className="text-xs font-semibold text-slate-600 mb-2">{ar ? 'البلاغات المرتبطة' : 'Individual tickets'}</div>
                        <div className="space-y-1.5">
                          {g.ticketIds.map((tid) => {
                            const t = ticketById.get(tid);
                            if (!t) return null;
                            return (
                              <Link key={tid} href={`/system/it/tickets/${tid}`}
                                className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 hover:border-[#f37121]">
                                <span className="text-sm text-slate-900">
                                  <span className="font-mono text-xs text-slate-500 me-2">{t.ticketNumber}</span>
                                  {t.title}
                                </span>
                                <span className="flex items-center gap-2">
                                  <SmallBadge bg={TICKET_STATUSES[t.status]?.bg || 'bg-slate-500/15'} text={TICKET_STATUSES[t.status]?.text || 'text-slate-700'} label={ticketStatusLabel(t.status, lang)} />
                                  <span className="text-xs text-slate-500">{fmtDate(t.reportedAt)}</span>
                                </span>
                              </Link>
                            );
                          })}
                        </div>
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
