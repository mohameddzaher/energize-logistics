'use client';
/**
 * جدولٌ ماليّ عامّ — كلُّ جداول الإدارة الماليّة تُرسَم به.
 *
 * فلترٌ على كلّ عمود كإكسل، وبحثٌ، وفرزٌ بالضغط على الرأس، وصفوفٌ تُفتح على
 * مصدرها (`_href`)، وتصديرُ الجدول وحدَه — المعروضُ بعد الفلاتر أو كلُّه.
 * والمجموعُ في الذيل لأعمدة المال والأعداد: المديرُ الماليّ يقرأ المجموعَ أوّلًا.
 */
import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowUpDown, Search, ExternalLink } from 'lucide-react';
import { useColumnFilters, ClearColumnFilters } from '@/components/useColumnFilters';
import ExportMenu, { exportScopeLabels, type ExportColumn } from '@/components/ls2/ExportMenu';
import { fmtFin, type FinTable } from '@/lib/financeDept';

const fold = (v: any) => String(v ?? '').replace(/[أإآ]/g, 'ا').replace(/[ةه]/g, 'ه').replace(/[ىي]/g, 'ي').toLowerCase();
const PAGE = 100;

export default function FinanceTable({ table, ar, fileName }: { table: FinTable; ar: boolean; fileName: string }) {
  const router = useRouter();
  const cf = useColumnFilters<any>();
  const [q, setQ] = useState('');
  const [sort, setSort] = useState<{ key: string; dir: 1 | -1 } | null>(null);
  const [limit, setLimit] = useState(PAGE);

  const getters = useMemo(() => Object.fromEntries(table.columns.map((c) => [c.key, (r: any) => (c.format === 'text' ? r[c.key] ?? '' : fmtFin(r[c.key], c.format, ar))])), [table.columns, ar]);
  const searched = useMemo(() => {
    const n = fold(q.trim());
    if (!n) return table.rows;
    return table.rows.filter((r) => table.columns.some((c) => fold(r[c.key]).includes(n)));
  }, [table.rows, table.columns, q]);
  const filtered = useMemo(() => cf.apply(searched, getters), [cf, searched, getters]);
  const shown = useMemo(() => {
    if (!sort) return filtered;
    const col = table.columns.find((c) => c.key === sort.key);
    const num = col && ['money', 'number', 'pct'].includes(col.format);
    return [...filtered].sort((a, b) => {
      const x = a[sort.key]; const y = b[sort.key];
      if (num) return ((Number(x) || 0) - (Number(y) || 0)) * sort.dir;
      return String(x ?? '').localeCompare(String(y ?? ''), 'ar') * sort.dir;
    });
  }, [filtered, sort, table.columns]);

  const totals = useMemo(() => Object.fromEntries(table.columns
    .filter((c) => c.format === 'money' || c.format === 'number')
    .map((c) => [c.key, shown.reduce((a, r) => a + (Number(r[c.key]) || 0), 0)])), [shown, table.columns]);

  const exportCols: ExportColumn[] = table.columns.map((c) => ({
    header: ar ? c.ar : c.en, key: c.key,
    type: c.format === 'money' || c.format === 'number' ? 'number' : c.format === 'date' ? 'date' : 'text',
    transform: c.format === 'date' ? (v: any) => fmtFin(v, 'date', ar) : c.format === 'pct' ? (v: any) => (v == null ? '' : Math.round(Number(v) * 10) / 10) : undefined,
  }));
  const scope = exportScopeLabels(ar);
  const name = (ar ? table.ar : table.en).slice(0, 28);

  return (
    <div className="bg-white border border-slate-200 rounded-2xl shadow-sm overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 border-b border-slate-100 bg-slate-50/60">
        <div className="min-w-0">
          <h3 className="font-extrabold text-slate-900 text-[14.5px]">{ar ? table.ar : table.en}
            <span className="ms-2 text-[11.5px] font-semibold text-slate-400 tabular-nums">({shown.length}{shown.length !== table.rows.length ? ` / ${table.rows.length}` : ''})</span>
          </h3>
          {table.noteAr && ar && <p className="text-[11.5px] text-slate-500 mt-0.5">{table.noteAr}</p>}
          {table.capped && <p className="text-[11px] text-amber-700 mt-0.5">{ar ? 'تُعرض أحدث ٢٠٠٠ حركة — ضيّق الفترة لرؤية الباقي.' : 'Showing the latest 2,000 — narrow the period.'}</p>}
        </div>
        <div className="flex items-center gap-2">
          <ClearColumnFilters count={cf.count} onClear={cf.clear} ar={ar} />
          <div className="relative">
            <Search className="w-3.5 h-3.5 text-slate-400 absolute top-1/2 -translate-y-1/2 start-2.5" />
            <input value={q} onChange={(e) => { setQ(e.target.value); setLimit(PAGE); }}
              placeholder={ar ? 'بحث…' : 'Search…'}
              className="w-44 ps-8 pe-2 py-1.5 rounded-lg border border-slate-200 bg-white text-[12.5px] focus:outline-none focus:border-[#f37121]" />
          </div>
          <ExportMenu fileName={`${fileName}-${table.key}`} lang={ar ? 'ar' : 'en'}
            options={[
              { key: 'shown', label: scope.shown, sheets: [{ name, rows: shown, columns: exportCols }] },
              ...(shown.length !== table.rows.length ? [{ key: 'all', label: scope.all, sheets: [{ name, rows: table.rows, columns: exportCols }] }] : []),
            ]} />
        </div>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-[13px]">
          <thead>
            <tr className="bg-slate-900 text-slate-300 text-[11.5px]">
              {table.columns.map((c) => {
                const numeric = ['money', 'number', 'pct'].includes(c.format);
                return (
                  <th key={c.key} className={`px-3 py-2.5 font-semibold whitespace-nowrap ${numeric ? 'text-end' : 'text-start'}`}>
                    <span className="inline-flex items-center gap-1">
                      <button type="button" className="inline-flex items-center gap-1 hover:text-white"
                        onClick={() => setSort((s) => (s?.key === c.key ? { key: c.key, dir: (s.dir * -1) as 1 | -1 } : { key: c.key, dir: numeric ? -1 : 1 }))}>
                        {ar ? c.ar : c.en}<ArrowUpDown className={`w-3 h-3 ${sort?.key === c.key ? 'text-[#f37121]' : 'opacity-40'}`} />
                      </button>
                      {cf.header(c.key, searched, getters[c.key], ar)}
                    </span>
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {shown.slice(0, limit).map((r, i) => (
              <tr key={i} onClick={r._href ? () => router.push(r._href) : undefined}
                className={r._href ? 'cursor-pointer hover:bg-orange-50/50' : 'hover:bg-slate-50'}>
                {table.columns.map((c, ci) => {
                  const numeric = ['money', 'number', 'pct'].includes(c.format);
                  const v = r[c.key];
                  const neg = numeric && Number(v) < 0;
                  return (
                    <td key={c.key} className={`px-3 py-2 whitespace-nowrap ${numeric ? 'text-end tabular-nums' : ''} ${neg ? 'text-red-600 font-semibold' : 'text-slate-700'} ${ci === 0 ? 'font-semibold text-slate-900' : ''}`}>
                      {c.format === 'text' ? (v || '—') : fmtFin(v, c.format, ar)}
                      {ci === 0 && r._href && <ExternalLink className="inline w-3 h-3 ms-1 text-slate-300" />}
                    </td>
                  );
                })}
              </tr>
            ))}
            {!shown.length && (
              <tr><td colSpan={table.columns.length} className="px-3 py-8 text-center text-slate-400">{ar ? 'لا بيانات في هذه الفترة' : 'No data in this period'}</td></tr>
            )}
          </tbody>
          {shown.length > 0 && Object.keys(totals).length > 0 && (
            <tfoot>
              <tr className="bg-slate-100 font-extrabold text-slate-900 text-[12.5px]">
                {table.columns.map((c, ci) => (
                  <td key={c.key} className={`px-3 py-2 whitespace-nowrap ${c.key in totals ? 'text-end tabular-nums' : ''}`}>
                    {ci === 0 ? (ar ? 'الإجمالي' : 'Total') : c.key in totals ? fmtFin(totals[c.key], c.format, ar) : ''}
                  </td>
                ))}
              </tr>
            </tfoot>
          )}
        </table>
      </div>
      {shown.length > limit && (
        <button type="button" onClick={() => setLimit((l) => l + PAGE * 3)}
          className="w-full py-2 text-[12.5px] font-semibold text-[#f37121] hover:bg-orange-50 border-t border-slate-100">
          {ar ? `عرض المزيد (${shown.length - limit} متبقي)` : `Show more (${shown.length - limit} left)`}
        </button>
      )}
    </div>
  );
}
