'use client';
/**
 * Department finance page: one for all departments, drawn from the server payload.
 * Cards first (each opens its source), then notes on what is not recorded, then tables. The period is chosen once for the whole page, and full export puts each table in a sheet of one file. It listens to `finance:changed`: any financial movement in any department re-reads, and an old reply never overwrites a newer one (useLatestRequest).
 */
import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useLanguage } from '@/context/LanguageContext';
import { useSocket } from '@/hooks/useSocket';
import { useLatestRequest } from '@/hooks/useLatestRequest';
import api from '@/lib/api';
import { Landmark, RefreshCw, Info, Radio } from 'lucide-react';
import { Spinner } from '@/components/hr/HRKit';
import ExportMenu, { type ExportColumn } from '@/components/ls2/ExportMenu';
import FinanceTable from '@/components/finance/FinanceTable';
import { fmtFin, type FinDept } from '@/lib/financeDept';
import { PeriodBar, usePeriod } from '@/components/finance/PeriodBar';

const TONE: Record<string, string> = {
  good: 'text-emerald-700', bad: 'text-red-600', warn: 'text-amber-600', neutral: 'text-slate-900',
};
// The period bar lives in its own file so pages that only need it do not import this view (and its finance endpoint, see genPageApis).
export { PeriodBar, usePeriod };

export default function FinanceDeptView({ dept, onOpenRow }: { dept: string; onOpenRow?: (row: any) => void }) {
  const { lang, isRTL } = useLanguage();
  const ar = lang === 'ar';
  const period = usePeriod();
  const [d, setD] = useState<FinDept | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [liveAt, setLiveAt] = useState<number | null>(null);
  const guard = useLatestRequest();

  const load = useCallback(async () => {
    const mine = guard.begin();
    setLoading(true);
    try {
      const res = await api.get<FinDept>(`/api/finance/departments/${dept}?from=${period.range.from}&to=${period.range.to}`);
      if (!guard.isCurrent(mine)) return;
      setD(res); setError('');
    } catch (e: any) {
      if (guard.isCurrent(mine)) setError(e?.message || 'Failed');
    }
    if (guard.isCurrent(mine)) setLoading(false);
  }, [dept, period.range.from, period.range.to, guard]);

  useEffect(() => { load(); }, [load]);
  // The event names its departments; one not concerning this department does not re-read.
  useSocket('finance:changed', useCallback((p?: { depts?: string[] }) => {
    if (Array.isArray(p?.depts) && !p!.depts.includes(dept)) return;
    setLiveAt(Date.now()); load();
  }, [load, dept]));

  if (loading && !d) return <Spinner />;
  if (!d) return <div className="p-8 text-slate-500">{error || (ar ? 'تعذّر التحميل' : 'Could not load')}</div>;

  const fileName = `finance-${dept}-${d.period.from}-${d.period.to}`;
  const allSheets = d.tables.map((t) => ({
    name: (ar ? t.ar : t.en).slice(0, 28),
    rows: t.rows,
    columns: t.columns.map((c): ExportColumn => ({
      header: ar ? c.ar : c.en, key: c.key,
      type: c.format === 'money' || c.format === 'number' ? 'number' : c.format === 'date' ? 'date' : 'text',
      transform: c.format === 'date' ? (v: any) => fmtFin(v, 'date', ar) : undefined,
    })),
  }));
  const summarySheet = {
    name: ar ? 'الملخص' : 'Summary',
    rows: d.cards.map((c) => ({ label: ar ? c.ar : c.en, value: c.format === 'pct' ? `${Math.round(c.value * 10) / 10}%` : c.value })),
    columns: [{ header: ar ? 'البند' : 'Item', key: 'label' }, { header: ar ? 'القيمة' : 'Value', key: 'value' }] as ExportColumn[],
  };

  return (
    <div className="space-y-5" dir={isRTL ? 'rtl' : 'ltr'}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-[#f37121]/15 flex items-center justify-center text-[#f37121]"><Landmark className="w-5 h-5" /></div>
          <div>
            <h1 className="text-2xl font-bold text-slate-900">{ar ? d.ar : d.en}</h1>
            <p className="text-[12px] text-slate-500 flex items-center gap-1.5">
              <Link href="/system/finance" className="hover:text-[#f37121]">{ar ? 'الإدارة المالية' : 'Finance'}</Link>
              <span>·</span>{d.period.from} → {d.period.to}
              <span className="inline-flex items-center gap-1 ms-2 text-emerald-600"><Radio className="w-3 h-3" />{ar ? 'مباشر' : 'Live'}</span>
              {liveAt && <span className="text-slate-400">· {ar ? 'تحدّث' : 'updated'} {new Date(liveAt).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}</span>}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <ExportMenu fileName={fileName} lang={ar ? 'ar' : 'en'}
            label={ar ? 'تصدير Excel' : 'Export Excel'}
            options={[{ key: 'all', label: ar ? `الصفحة كاملة (${d.tables.length + 1} شيت)` : `Whole page (${d.tables.length + 1} sheets)`, sheets: [summarySheet, ...allSheets] }]} />
          <button type="button" onClick={load} className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 text-sm">
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />{ar ? 'تحديث' : 'Refresh'}
          </button>
        </div>
      </div>

      <PeriodBar period={period} ar={ar} />

      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-4 gap-3">
        {d.cards.map((c) => {
          const body = (
            <>
              <p className="text-[11.5px] font-semibold text-slate-500 leading-snug">{ar ? c.ar : c.en}</p>
              <p className={`text-xl font-extrabold tabular-nums mt-1 ${c.value < 0 ? 'text-red-600' : TONE[c.tone || 'neutral']}`}>
                {fmtFin(c.value, c.format, ar)}{c.format === 'money' && <span className="text-[11px] font-semibold text-slate-400 ms-1">{ar ? 'ر.س' : 'SAR'}</span>}
              </p>
            </>
          );
          return c.href
            ? <Link key={c.key} href={c.href} className="rounded-2xl border border-slate-200 bg-white p-3.5 shadow-sm hover:border-[#f37121]/50 hover:shadow">{body}</Link>
            : <div key={c.key} className="rounded-2xl border border-slate-200 bg-white p-3.5 shadow-sm">{body}</div>;
        })}
      </div>

      {!!d.notes.length && (
        <div className="rounded-2xl border border-sky-200 bg-sky-50/60 p-3 space-y-1">
          {d.notes.map((n, i) => (
            <p key={i} className="text-[12px] text-sky-900 flex items-start gap-1.5"><Info className="w-3.5 h-3.5 mt-0.5 shrink-0" />{ar ? n.ar : n.en}</p>
          ))}
        </div>
      )}

      {d.tables.map((t) => <FinanceTable key={t.key} table={t} ar={ar} fileName={fileName} onOpenRow={onOpenRow} />)}
    </div>
  );
}
