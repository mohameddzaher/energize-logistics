'use client';
/**
 * Building blocks shared by the analytics pages (shipments, vendors overview, daily operation), so the three read
 * as one system: the same card, the same change-against-previous badge, the same ranked bars and tables.
 */
import { ReactNode, useState } from 'react';
import { ArrowUpRight, ArrowDownRight, Minus, ChevronDown, ChevronUp } from 'lucide-react';

export const ORANGE = '#f37121';
export const CHART = ['#f37121', '#0ea5e9', '#10b981', '#8b5cf6', '#f59e0b', '#ef4444', '#14b8a6', '#64748b', '#ec4899', '#84cc16'];

/** Latin digits always, even in the Arabic interface. */
export const fmtInt = (n?: number | null) => (n == null || Number.isNaN(Number(n)) ? '—' : Math.round(Number(n)).toLocaleString('en-US'));
export const fmtMoney = (n?: number | null) => (n == null || Number.isNaN(Number(n)) ? '—' : Number(n).toLocaleString('en-US', { maximumFractionDigits: 0 }));
export const fmtPct = (n?: number | null, d = 1) => (n == null || Number.isNaN(Number(n)) ? '—' : `${Number(n).toFixed(d).replace(/\.0+$/, '')}%`);
export const fmtDay = (iso?: string | null) => (iso ? String(iso).slice(0, 10) : '—');

/** Change against the previous period; `inverse` when a rise is bad (cancellations). */
export function Delta({ cur, prev, inverse, ar }: { cur?: number | null; prev?: number | null; inverse?: boolean; ar: boolean }) {
  if (cur == null || prev == null) return null;
  if (!prev && !cur) return null;
  if (!prev) return <span className="inline-flex items-center gap-0.5 text-[11px] font-semibold text-sky-700">{ar ? 'جديد' : 'new'}</span>;
  const ch = ((cur - prev) / Math.abs(prev)) * 100;
  if (Math.abs(ch) < 0.5) {
    return <span className="inline-flex items-center gap-0.5 text-[11px] font-semibold text-slate-500"><Minus className="w-3 h-3" />{ar ? 'ثابت' : 'flat'}</span>;
  }
  const good = inverse ? ch < 0 : ch > 0;
  const Icon = ch > 0 ? ArrowUpRight : ArrowDownRight;
  return (
    <span className={`inline-flex items-center gap-0.5 text-[11px] font-bold tabular-nums ${good ? 'text-emerald-600' : 'text-red-600'}`}
      title={ar ? `الفترة السابقة: ${fmtMoney(prev)}` : `Previous: ${fmtMoney(prev)}`}>
      <Icon className="w-3.5 h-3.5" />{Math.abs(ch).toFixed(Math.abs(ch) < 10 ? 1 : 0)}%
    </span>
  );
}

export function Kpi({ label, value, sub, cur, prev, inverse, tone, ar, onClick, active, icon }: {
  label: string; value: ReactNode; sub?: ReactNode; cur?: number | null; prev?: number | null; inverse?: boolean;
  tone?: 'good' | 'bad' | 'warn' | 'brand' | 'muted'; ar: boolean; onClick?: () => void; active?: boolean; icon?: ReactNode;
}) {
  const toneCls = tone === 'good' ? 'text-emerald-700' : tone === 'bad' ? 'text-red-600' : tone === 'warn' ? 'text-amber-700' : tone === 'brand' ? 'text-[#f37121]' : tone === 'muted' ? 'text-slate-500' : 'text-slate-900';
  const Tag: any = onClick ? 'button' : 'div';
  return (
    <Tag type={onClick ? 'button' : undefined} onClick={onClick}
      className={`text-start rounded-2xl border bg-white px-4 py-3.5 shadow-sm transition-all ${onClick ? 'hover:border-[#f37121]/50 hover:-translate-y-0.5 cursor-pointer' : ''} ${active ? 'border-[#f37121] ring-2 ring-[#f37121]/20' : 'border-slate-200'}`}>
      <div className="flex items-center gap-1.5 text-[12px] font-semibold text-slate-600">{icon}{label}</div>
      <div className={`mt-1.5 text-[22px] leading-tight font-extrabold tabular-nums ${toneCls}`}>{value}</div>
      <div className="mt-1 flex items-center gap-2 min-h-[16px]">
        <Delta cur={cur} prev={prev} inverse={inverse} ar={ar} />
        {sub && <span className="text-[11px] text-slate-500 truncate">{sub}</span>}
      </div>
    </Tag>
  );
}

export function Panel({ title, subtitle, actions, children, className = '', pad = true }: {
  title: ReactNode; subtitle?: ReactNode; actions?: ReactNode; children: ReactNode; className?: string; pad?: boolean;
}) {
  return (
    <section className={`rounded-2xl border border-slate-200 bg-white shadow-sm ${className}`}>
      <header className="flex flex-wrap items-center gap-2 px-4 py-3 border-b border-slate-100">
        <div className="min-w-0">
          <h3 className="text-[14.5px] font-bold text-slate-900">{title}</h3>
          {subtitle && <p className="text-[11.5px] text-slate-500 mt-0.5">{subtitle}</p>}
        </div>
        {actions && <div className="ms-auto flex items-center gap-1.5">{actions}</div>}
      </header>
      <div className={pad ? 'p-4' : ''}>{children}</div>
    </section>
  );
}

/** Ranked horizontal bars; a row press usually filters the page by it. */
export function BarList({ rows, max, color = ORANGE, onPick, valueLabel, empty, limit = 10, ar }: {
  rows: { key: string; label: string; value: number; hint?: string; sub?: string }[];
  max?: number; color?: string; onPick?: (key: string) => void; valueLabel?: (v: number) => string; empty?: string; limit?: number; ar: boolean;
}) {
  const [all, setAll] = useState(false);
  if (!rows.length) return <p className="py-6 text-center text-sm text-slate-400">{empty || (ar ? 'لا بيانات' : 'No data')}</p>;
  const top = max ?? Math.max(...rows.map((r) => r.value), 1);
  const shown = all ? rows : rows.slice(0, limit);
  return (
    <div className="space-y-2">
      {shown.map((r) => (
        <button key={r.key} type="button" disabled={!onPick} onClick={() => onPick?.(r.key)}
          className={`w-full text-start group ${onPick ? 'cursor-pointer' : 'cursor-default'}`}>
          <div className="flex items-center justify-between gap-2 text-[12.5px]">
            <span className={`font-semibold text-slate-800 truncate ${onPick ? 'group-hover:text-[#f37121]' : ''}`} title={r.label}>{r.label}</span>
            <span className="shrink-0 tabular-nums text-slate-700 font-semibold">
              {valueLabel ? valueLabel(r.value) : fmtInt(r.value)}{r.hint && <span className="ms-1.5 text-[11px] font-normal text-slate-400">{r.hint}</span>}
            </span>
          </div>
          <div className="mt-1 h-2 rounded-full bg-slate-100 overflow-hidden">
            <div className="h-2 rounded-full transition-all" style={{ width: `${Math.max(2, (r.value / top) * 100)}%`, background: color }} />
          </div>
          {r.sub && <p className="mt-0.5 text-[11px] text-slate-500 truncate">{r.sub}</p>}
        </button>
      ))}
      {rows.length > limit && (
        <button type="button" onClick={() => setAll((v) => !v)} className="inline-flex items-center gap-1 text-[12px] font-semibold text-[#f37121] hover:underline">
          {all ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
          {all ? (ar ? 'عرض أقل' : 'Show less') : (ar ? `عرض الكلّ (${rows.length})` : `Show all (${rows.length})`)}
        </button>
      )}
    </div>
  );
}

export type Col<T> = { key: string; label: string; render?: (r: T) => ReactNode; num?: boolean; sort?: (r: T) => number | string; className?: string };

/** A sortable table with a row cap and «show all». */
export function DataGrid<T extends Record<string, any>>({ rows, cols, onRow, limit = 15, ar, empty, rowKey, defaultSort }: {
  rows: T[]; cols: Col<T>[]; onRow?: (r: T) => void; limit?: number; ar: boolean; empty?: string; rowKey?: (r: T, i: number) => string;
  defaultSort?: { key: string; dir: 'asc' | 'desc' };
}) {
  const [sort, setSort] = useState<{ key: string; dir: 'asc' | 'desc' } | null>(defaultSort || null);
  const [all, setAll] = useState(false);
  const col = sort ? cols.find((c) => c.key === sort.key) : null;
  const sorted = col ? [...rows].sort((a, b) => {
    const va = col.sort ? col.sort(a) : a[col.key];
    const vb = col.sort ? col.sort(b) : b[col.key];
    const x = typeof va === 'number' && typeof vb === 'number' ? va - vb : String(va ?? '').localeCompare(String(vb ?? ''), 'ar');
    return sort!.dir === 'asc' ? x : -x;
  }) : rows;
  const shown = all ? sorted : sorted.slice(0, limit);
  return (
    <div>
      <div className="overflow-x-auto">
        <table className="w-full text-[12.5px]">
          <thead className="bg-slate-50 text-slate-600">
            <tr>
              {cols.map((c) => (
                <th key={c.key} onClick={() => setSort((s) => ({ key: c.key, dir: s?.key === c.key && s.dir === 'desc' ? 'asc' : 'desc' }))}
                  className={`px-3 py-2 font-semibold whitespace-nowrap cursor-pointer select-none hover:text-slate-900 ${c.num ? 'text-end' : 'text-start'}`}>
                  {c.label}{sort?.key === c.key ? (sort.dir === 'desc' ? ' ↓' : ' ↑') : ''}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {shown.map((r, i) => (
              <tr key={rowKey ? rowKey(r, i) : i} onClick={onRow ? () => onRow(r) : undefined}
                className={`${onRow ? 'cursor-pointer hover:bg-[#f37121]/[0.04]' : 'hover:bg-slate-50'}`}>
                {cols.map((c) => (
                  <td key={c.key} className={`px-3 py-2 ${c.num ? 'text-end tabular-nums whitespace-nowrap' : 'text-start'} ${c.className || ''}`}>
                    {c.render ? c.render(r) : (c.num ? fmtInt(r[c.key]) : (r[c.key] ?? '—'))}
                  </td>
                ))}
              </tr>
            ))}
            {!rows.length && <tr><td colSpan={cols.length} className="px-3 py-8 text-center text-slate-400">{empty || (ar ? 'لا بيانات ضمن هذه الفلاتر' : 'No data for these filters')}</td></tr>}
          </tbody>
        </table>
      </div>
      {rows.length > limit && (
        <div className="px-3 py-2 border-t border-slate-100">
          <button type="button" onClick={() => setAll((v) => !v)} className="text-[12px] font-semibold text-[#f37121] hover:underline">
            {all ? (ar ? 'عرض أقل' : 'Show less') : (ar ? `عرض الكلّ (${rows.length})` : `Show all (${rows.length})`)}
          </button>
        </div>
      )}
    </div>
  );
}

/** A grade chip: A green, B sky, C amber, D red. */
export function Grade({ g, score }: { g?: string; score?: number }) {
  if (!g) return <span className="text-slate-400">—</span>;
  const cls = g === 'A' ? 'bg-emerald-100 text-emerald-800 border-emerald-200' : g === 'B' ? 'bg-sky-100 text-sky-800 border-sky-200'
    : g === 'C' ? 'bg-amber-100 text-amber-800 border-amber-200' : 'bg-red-100 text-red-700 border-red-200';
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className={`inline-flex items-center justify-center w-6 h-6 rounded-md border text-[12px] font-extrabold ${cls}`}>{g}</span>
      {score != null && <span className="tabular-nums text-[11.5px] text-slate-500">{score}</span>}
    </span>
  );
}

const TREND: Record<string, { ar: string; en: string; cls: string }> = {
  up: { ar: 'متزايد', en: 'Growing', cls: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
  steady: { ar: 'مستمر', en: 'Steady', cls: 'bg-sky-50 text-sky-700 border-sky-200' },
  down: { ar: 'متراجع', en: 'Declining', cls: 'bg-amber-50 text-amber-700 border-amber-200' },
  new: { ar: 'جديد', en: 'New', cls: 'bg-violet-50 text-violet-700 border-violet-200' },
  stopped: { ar: 'متوقف', en: 'Stopped', cls: 'bg-red-50 text-red-700 border-red-200' },
  never: { ar: 'لم يعمل', en: 'Never worked', cls: 'bg-slate-50 text-slate-500 border-slate-200' },
};
export const trendLabel = (t: string, ar: boolean) => (TREND[t] ? (ar ? TREND[t].ar : TREND[t].en) : t);
export function TrendChip({ t, ar }: { t?: string; ar: boolean }) {
  if (!t) return null;
  const x = TREND[t] || TREND.steady;
  return <span className={`inline-flex px-2 py-0.5 rounded-full border text-[11px] font-semibold ${x.cls}`}>{ar ? x.ar : x.en}</span>;
}

/** Period presets every analytics page offers, resolved to from/to in Riyadh days. */
export function presetRange(key: string): [string, string] {
  const now = new Date(Date.now() + 3 * 3600000);
  const iso = (d: Date) => d.toISOString().slice(0, 10);
  const day = (n: number) => { const d = new Date(now); d.setUTCDate(d.getUTCDate() + n); return iso(d); };
  const y = now.getUTCFullYear(); const m = now.getUTCMonth();
  const monthStart = (yy: number, mm: number) => iso(new Date(Date.UTC(yy, mm, 1)));
  const monthEnd = (yy: number, mm: number) => iso(new Date(Date.UTC(yy, mm + 1, 0)));
  switch (key) {
    case 'today': return [iso(now), iso(now)];
    case 'yesterday': return [day(-1), day(-1)];
    case '7d': return [day(-6), iso(now)];
    case '30d': return [day(-29), iso(now)];
    case 'lastMonth': return [monthStart(y, m - 1), monthEnd(y, m - 1)];
    case 'quarter': return [monthStart(y, m - 2), iso(now)];
    case 'year': return [`${y}-01-01`, iso(now)];
    case 'month':
    default: return [monthStart(y, m), iso(now)];
  }
}
export const PRESETS: [string, string, string][] = [
  ['today', 'اليوم', 'Today'], ['yesterday', 'أمس', 'Yesterday'], ['7d', '7 أيام', '7 days'], ['month', 'هذا الشهر', 'This month'],
  ['lastMonth', 'الشهر الماضي', 'Last month'], ['30d', '30 يومًا', '30 days'], ['quarter', 'آخر 3 أشهر', 'Last 3 months'], ['year', 'هذا العام', 'This year'],
];

export function LiveDot({ ar, busy }: { ar: boolean; busy?: boolean }) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-[11.5px] font-semibold text-emerald-700">
      <span className={`w-2 h-2 rounded-full ${busy ? 'bg-amber-500 animate-pulse' : 'bg-emerald-500'}`} />
      {busy ? (ar ? 'يُحدَّث…' : 'Updating…') : (ar ? 'مباشر' : 'Live')}
    </span>
  );
}
