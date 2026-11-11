'use client';
/**
 * One analysis page of Data & Decision Support, drawn from the server payload: filters, KPI cards (with the change
 * against the previous span where the source gives it), trend charts, then ranking tables. The whole page exports to
 * one Excel file (summary, one sheet per chart's data, one per table). Re-reads on `executive:changed`, which follows
 * every section event; the server keeps a one-minute cache, so this costs little.
 */
import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useLanguage } from '@/context/LanguageContext';
import { useSocket } from '@/hooks/useSocket';
import { useLatestRequest } from '@/hooks/useLatestRequest';
import api from '@/lib/api';
import { BarChart3, RefreshCw, Info, Radio, Database, TrendingUp, TrendingDown } from 'lucide-react';
import {
  ResponsiveContainer, LineChart, Line, BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid, Legend,
} from 'recharts';
import { Spinner } from '@/components/hr/HRKit';
import ExportMenu, { type ExportColumn } from '@/components/ls2/ExportMenu';
import FinanceTable from '@/components/finance/FinanceTable';
import { PeriodBar, usePeriod } from '@/components/finance/PeriodBar';
import { fmtFin } from '@/lib/financeDept';
import { deltaPct, type DsSection, type DsChart, type DsCard } from '@/lib/dataSupport';

const TONE: Record<string, string> = { good: 'text-emerald-700', bad: 'text-red-600', warn: 'text-amber-600', neutral: 'text-slate-900' };
const PALETTE = ['#f37121', '#0ea5e9', '#64748b', '#10b981', '#8b5cf6', '#ef4444'];

function KpiCard({ c, ar }: { c: DsCard; ar: boolean }) {
  const d = deltaPct(c.value, c.prev);
  const good = d == null ? null : (c.lowerIsBetter ? d < 0 : d > 0);
  const body = (
    <>
      <p className="text-[11.5px] font-semibold text-slate-500 leading-snug">{ar ? c.ar : c.en}</p>
      <p className={`text-xl font-extrabold tabular-nums mt-1 ${Number(c.value) < 0 ? 'text-red-600' : TONE[c.tone || 'neutral']}`}>
        {fmtFin(c.value, c.format, ar)}{c.format === 'money' && c.value != null && <span className="text-[11px] font-semibold text-slate-400 ms-1">{ar ? 'ر.س' : 'SAR'}</span>}
      </p>
      {d != null && (
        <p className={`text-[11px] font-bold mt-0.5 inline-flex items-center gap-1 ${good ? 'text-emerald-600' : 'text-red-600'}`}>
          {d >= 0 ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
          {`${d >= 0 ? '+' : ''}${(Math.round(d * 10) / 10).toLocaleString('en-US')}%`}
          <span className="text-slate-400 font-semibold">{ar ? 'عن الفترة السابقة' : 'vs previous'}</span>
        </p>
      )}
    </>
  );
  return c.href
    ? <Link href={c.href} className="rounded-2xl border border-slate-200 bg-white p-3.5 shadow-sm hover:border-[#f37121]/50 hover:shadow">{body}</Link>
    : <div className="rounded-2xl border border-slate-200 bg-white p-3.5 shadow-sm">{body}</div>;
}

function ChartCard({ ch, ar }: { ch: DsChart; ar: boolean }) {
  const fmt = (v: any, key?: string) => {
    const s = ch.series.find((x) => x.key === key);
    return fmtFin(v, s?.format || 'number', ar);
  };
  const Kind = ch.kind === 'line' ? LineChart : BarChart;
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      <h3 className="font-extrabold text-slate-900 text-[14px] mb-3">{ar ? ch.ar : ch.en}</h3>
      {!ch.rows.length ? (
        <p className="text-[12.5px] text-slate-400 py-10 text-center">{ar ? 'لا بيانات في هذه الفترة' : 'No data in this period'}</p>
      ) : (
        <div className="h-64" dir="ltr">
          <ResponsiveContainer width="100%" height="100%">
            <Kind data={ch.rows} margin={{ top: 4, right: 8, left: 4, bottom: 4 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
              <XAxis dataKey={ch.x} tick={{ fontSize: 10.5 }} />
              <YAxis tick={{ fontSize: 10.5 }} tickFormatter={(v) => Number(v).toLocaleString('en-US', { notation: 'compact' })} width={48} />
              <Tooltip formatter={(v: any, _n: any, item: any) => [fmt(v, item?.dataKey), (ar ? ch.series.find((s) => s.key === item?.dataKey)?.ar : ch.series.find((s) => s.key === item?.dataKey)?.en) || _n]} />
              {ch.series.length > 1 && <Legend formatter={(v: any) => { const s = ch.series.find((x) => x.key === v); return s ? (ar ? s.ar : s.en) : v; }} wrapperStyle={{ fontSize: 11.5 }} />}
              {ch.series.map((s, i) => (ch.kind === 'line'
                ? <Line key={s.key} type="monotone" dataKey={s.key} stroke={PALETTE[i % PALETTE.length]} strokeWidth={2} dot={ch.rows.length < 40} />
                : <Bar key={s.key} dataKey={s.key} fill={PALETTE[i % PALETTE.length]} radius={[4, 4, 0, 0]} stackId={ch.stacked ? 'a' : undefined} />))}
            </Kind>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  );
}

export default function DataSupportView({ section }: { section: string }) {
  const { lang, isRTL } = useLanguage();
  const ar = lang === 'ar';
  const period = usePeriod();
  const [branch, setBranch] = useState('');
  const [d, setD] = useState<DsSection | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [liveAt, setLiveAt] = useState<number | null>(null);
  const guard = useLatestRequest();

  const load = useCallback(async (fresh = false) => {
    const mine = guard.begin();
    setLoading(true);
    try {
      const qs = new URLSearchParams({ from: period.range.from, to: period.range.to });
      if (branch) qs.set('branch', branch);
      if (fresh) qs.set('fresh', '1');
      const res = await api.get<DsSection>(`/api/data-support/sections/${section}?${qs.toString()}`);
      if (!guard.isCurrent(mine)) return;
      setD(res); setError('');
    } catch (e: any) {
      if (guard.isCurrent(mine)) setError(e?.message || 'Failed');
    }
    if (guard.isCurrent(mine)) setLoading(false);
  }, [section, period.range.from, period.range.to, branch, guard]);

  useEffect(() => { load(); }, [load]);
  useSocket('executive:changed', useCallback(() => { setLiveAt(Date.now()); load(); }, [load]));

  if (loading && !d) return <Spinner />;
  if (!d) return <div className="p-8 text-slate-500">{error || (ar ? 'تعذّر التحميل' : 'Could not load')}</div>;

  const fileName = `analysis-${section}-${d.period.from}-${d.period.to}${d.branch ? `-${d.branch}` : ''}`;
  const sheetName = (s: string) => s.replace(/[\\/?*[\]:]/g, ' ').slice(0, 28);
  const typeOf = (f: string): ExportColumn['type'] => (f === 'money' || f === 'number' || f === 'pct' ? 'number' : f === 'date' ? 'date' : 'text');
  const summarySheet = {
    name: ar ? 'الملخص' : 'Summary',
    rows: d.cards.map((c) => ({ label: ar ? c.ar : c.en, value: c.value, prev: c.prev ?? '', unit: c.format === 'money' ? (ar ? 'ر.س' : 'SAR') : c.format === 'pct' ? '%' : '' })),
    columns: [
      { header: ar ? 'المؤشّر' : 'Indicator', key: 'label' }, { header: ar ? 'القيمة' : 'Value', key: 'value', type: 'number' },
      { header: ar ? 'الفترة السابقة' : 'Previous', key: 'prev', type: 'number' }, { header: ar ? 'الوحدة' : 'Unit', key: 'unit' },
    ] as ExportColumn[],
  };
  const chartSheets = d.charts.filter((c) => c.rows.length).map((c) => ({
    name: sheetName(ar ? c.ar : c.en),
    rows: c.rows,
    columns: [{ header: ar ? 'البند' : 'Label', key: c.x }, ...c.series.map((s) => ({ header: ar ? s.ar : s.en, key: s.key, type: typeOf(s.format) }))] as ExportColumn[],
  }));
  const tableSheets = d.tables.map((t) => ({
    name: sheetName(ar ? t.ar : t.en),
    rows: t.rows,
    columns: t.columns.map((c): ExportColumn => ({
      header: ar ? c.ar : c.en, key: c.key, type: typeOf(c.format),
      transform: c.format === 'date' ? (v: any) => fmtFin(v, 'date', ar) : c.format === 'pct' ? (v: any) => (v == null ? '' : Math.round(Number(v) * 10) / 10) : undefined,
    })),
  }));
  const allSheets = [summarySheet, ...chartSheets, ...tableSheets];

  return (
    <div className="space-y-5" dir={isRTL ? 'rtl' : 'ltr'} data-dash>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-[#f37121]/15 flex items-center justify-center text-[#f37121]"><BarChart3 className="w-5 h-5" /></div>
          <div>
            <h1 className="text-2xl font-bold text-slate-900">{ar ? d.ar : d.en}</h1>
            <p className="text-[12px] text-slate-500 flex items-center gap-1.5 flex-wrap">
              <Link href="/system/data-support" className="hover:text-[#f37121]">{ar ? 'إدارة البيانات ودعم القرار' : 'Data & Decision Support'}</Link>
              <span>·</span><span dir="ltr">{d.period.from} → {d.period.to}</span>
              <span className="inline-flex items-center gap-1 ms-2 text-emerald-600"><Radio className="w-3 h-3" />{ar ? 'مباشر' : 'Live'}</span>
              {liveAt && <span className="text-slate-400">· {ar ? 'تحدّث' : 'updated'} {new Date(liveAt).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}</span>}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <ExportMenu fileName={fileName} lang={ar ? 'ar' : 'en'} label={ar ? 'تصدير Excel' : 'Export Excel'}
            options={[{ key: 'all', label: ar ? `الصفحة كاملة (${allSheets.length} شيت)` : `Whole page (${allSheets.length} sheets)`, sheets: allSheets }]} />
          <button type="button" onClick={() => load(true)} className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 text-sm">
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />{ar ? 'تحديث' : 'Refresh'}
          </button>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <div className="flex-1 min-w-[280px]"><PeriodBar period={period} ar={ar} /></div>
        {d.hasBranch && (
          <div className="flex items-center gap-2 rounded-2xl border border-slate-200 bg-white p-3 shadow-sm">
            <label htmlFor="ds-branch" className="text-[12px] text-slate-500 whitespace-nowrap">{ar ? 'الفرع' : 'Branch'}</label>
            <select id="ds-branch" value={branch} onChange={(e) => setBranch(e.target.value)}
              className="px-2 py-1.5 rounded-lg border border-slate-200 text-[12.5px] min-w-[160px] bg-white">
              <option value="">{ar ? 'كل الفروع' : 'All branches'}</option>
              {d.branchOptions.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </div>
        )}
      </div>

      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-4 gap-3">
        {d.cards.map((c) => <KpiCard key={c.key} c={c} ar={ar} />)}
      </div>

      {!!d.notes.length && (
        <div className="rounded-2xl border border-sky-200 bg-sky-50/60 p-3 space-y-1">
          {d.notes.map((n, i) => (
            <p key={i} className="text-[12px] text-sky-900 flex items-start gap-1.5"><Info className="w-3.5 h-3.5 mt-0.5 shrink-0" />{ar ? n.ar : n.en}</p>
          ))}
        </div>
      )}

      {!!d.charts.length && (
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
          {d.charts.map((ch) => <ChartCard key={ch.key} ch={ch} ar={ar} />)}
        </div>
      )}

      {d.tables.map((t) => <FinanceTable key={t.key} table={t} ar={ar} fileName={fileName} />)}

      {!!d.sources.length && (
        <div className="rounded-2xl border border-slate-200 bg-slate-50 p-3">
          <p className="text-[12px] font-bold text-slate-600 flex items-center gap-1.5 mb-1"><Database className="w-3.5 h-3.5" />{ar ? 'مصادر الأرقام' : 'Data sources'}</p>
          <ul className="space-y-0.5">
            {d.sources.map((s, i) => (
              <li key={i} className="text-[11.5px] text-slate-500">{ar ? s.ar : s.en} — <code dir="ltr" className="text-slate-600">{s.endpoint}</code></li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
