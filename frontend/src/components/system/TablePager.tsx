'use client';
import type React from 'react';
/**
 * Pagination bar for server-paged tables. The full bar (range + rows per page) sits above
 * the table; `compact` is the prev/next pair kept under a long table.
 */
import { ChevronLeft, ChevronRight } from 'lucide-react';

export const PAGE_SIZES = [50, 100, 150, 200, 500];

/** A stored size, or 50 when it is missing or no longer offered. */
export const readPageSize = (key: string) => {
  try { const v = Number(localStorage.getItem(key)); return PAGE_SIZES.includes(v) ? v : 50; } catch { return 50; }
};
export const savePageSize = (key: string, n: number) => {
  try { localStorage.setItem(key, String(n)); } catch { /* per-viewer convenience only */ }
};

const fmt = (n: number) => n.toLocaleString('en-US');

export default function TablePager({ page, pageSize, total, ar, onPage, onPageSize, note, compact, className = '', extra }: {
  page: number; pageSize: number; total: number; ar: boolean;
  onPage: (p: number) => void; onPageSize?: (n: number) => void;
  note?: string; compact?: boolean; className?: string;
  /** Controls that belong with how the list is shown (view switcher), placed beside the rows-per-page select. */
  extra?: React.ReactNode;
}) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const Prev = ar ? ChevronRight : ChevronLeft;
  const Next = ar ? ChevronLeft : ChevronRight;
  const arrow = 'inline-flex h-8 w-8 items-center justify-center rounded-lg text-slate-600 hover:bg-slate-100 disabled:opacity-30 disabled:hover:bg-transparent';
  const nav = (
    <div className="inline-flex items-center gap-0.5 rounded-lg border border-slate-200 bg-white p-0.5">
      <button type="button" aria-label={ar ? 'السابق' : 'Previous'} title={ar ? 'السابق' : 'Previous'}
        onClick={() => onPage(page - 1)} disabled={page <= 1} className={arrow}><Prev className="h-4 w-4" /></button>
      <span className="min-w-[4.5rem] px-1 text-center text-[13px] font-semibold text-slate-700 tabular-nums">{fmt(page)} / {fmt(pages)}</span>
      <button type="button" aria-label={ar ? 'التالي' : 'Next'} title={ar ? 'التالي' : 'Next'}
        onClick={() => onPage(page + 1)} disabled={page >= pages} className={arrow}><Next className="h-4 w-4" /></button>
    </div>
  );
  if (compact) return <div className={`flex justify-end ${className}`}>{nav}</div>;
  const from = total ? (page - 1) * pageSize + 1 : 0;
  const to = Math.min(page * pageSize, total);
  return (
    <div className={`flex flex-wrap items-center justify-between gap-x-4 gap-y-2 ${className}`}>
      <p className="text-[13px] text-slate-500 tabular-nums">
        {ar ? 'عرض' : 'Showing'} <b className="font-semibold text-slate-800">{fmt(from)}–{fmt(to)}</b> {ar ? 'من' : 'of'} <b className="font-semibold text-slate-800">{fmt(total)}</b>
        {note ? <span className="ms-1.5 text-[#f37121]">({note})</span> : null}
      </p>
      <div className="flex flex-wrap items-center gap-3">
        {extra}
        {onPageSize && (
          <label className="flex items-center gap-2 text-[13px] text-slate-500">
            {ar ? 'عدد الصفوف' : 'Rows per page'}
            <select value={pageSize} onChange={(e) => onPageSize(Number(e.target.value))} title={ar ? 'عدد الصفوف' : 'Rows per page'}
              className="h-9 rounded-lg border border-slate-200 bg-white px-2 text-[13px] font-semibold text-slate-800 tabular-nums focus:outline-none focus:ring-2 focus:ring-[#f37121]/40">
              {PAGE_SIZES.map((n) => <option key={n} value={n}>{n}</option>)}
            </select>
          </label>
        )}
        {nav}
      </div>
    </div>
  );
}
