'use client';
import { useLanguage } from '@/context/LanguageContext';
import { useState, useEffect } from 'react';
import { ChevronUp, ChevronDown, Search } from 'lucide-react';
import ScrollX from '@/components/system/ScrollX';

interface Column {
  key: string;
  label: string;
  render?: (value: any, row: any) => React.ReactNode;
  sortable?: boolean;
  /**
   * What to search for this column when `key` is not a field of the row.
   * Search used to read `row[col.key]` only; the users name column has key `name` while the row holds firstName/lastName, so name search never matched. Columns with composed content declare their search text here.
   */
  search?: (row: any) => any;
}

/** Arabic folding before comparison, so spelling variants of the same name (alef and ha/ta-marbuta forms) match. Same rule as the server search (`utils/plateKey`). */
const fold = (v: any) => String(v ?? '')
  .replace(/[٠-٩]/g, (d) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d)))
  .replace(/[أإآٱ]/g, 'ا').replace(/[ةه]/g, 'ه').replace(/[ىئي]/g, 'ي').replace(/[ؤو]/g, 'و')
  .replace(/[ً-ْـ]/g, '')
  .replace(/\s+/g, ' ')
  .trim()
  .toLowerCase();

interface DataTableProps {
  columns: Column[];
  data: any[];
  searchable?: boolean;
  searchPlaceholder?: string;
  onRowClick?: (row: any) => void;
  emptyMessage?: string;
  actions?: (row: any) => React.ReactNode;
  /** Rows per page; without it every row is drawn, which is slow for long lists. */
  pageSize?: number;
}

export default function DataTable({ columns, data, searchable, searchPlaceholder, onRowClick, emptyMessage, actions, pageSize }: DataTableProps) {
  // The actions header follows the page language; it was written in English for every table using this component.
  const { lang } = useLanguage();
  const [search, setSearch] = useState('');
  const [sortKey, setSortKey] = useState('');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');

  const needle = fold(search);
  const filteredData = searchable && needle
    ? data.filter((row) =>
        columns.some((col) => {
          const val = col.search ? col.search(row) : row[col.key];
          return val != null && val !== '' && fold(val).includes(needle);
        })
      )
    : data;

  const sortedData = sortKey
    ? [...filteredData].sort((a, b) => {
        const aVal = a[sortKey];
        const bVal = b[sortKey];
        if (aVal < bVal) return sortDir === 'asc' ? -1 : 1;
        if (aVal > bVal) return sortDir === 'asc' ? 1 : -1;
        return 0;
      })
    : filteredData;

  const [page, setPage] = useState(0);
  // A new search or sort starts from the first page, otherwise the reader lands on an empty page.
  useEffect(() => { setPage(0); }, [needle, sortKey, sortDir]);
  const pages = pageSize ? Math.max(1, Math.ceil(sortedData.length / pageSize)) : 1;
  const current = Math.min(page, pages - 1);
  const shownData = pageSize ? sortedData.slice(current * pageSize, (current + 1) * pageSize) : sortedData;

  const handleSort = (key: string) => {
    if (sortKey === key) {
      setSortDir(sortDir === 'asc' ? 'desc' : 'asc');
    } else {
      setSortKey(key);
      setSortDir('asc');
    }
  };

  return (
    <div>
      {searchable && (
        <div className="mb-4 relative">
          <Search className="w-4 h-4 absolute start-3 top-1/2 -translate-y-1/2 text-slate-500" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={searchPlaceholder || 'Search...'}
            className="w-full ps-10 pe-4 py-2.5 rounded-lg bg-white border border-slate-200 text-slate-900 text-sm placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-[#f37121]/50"
          />
        </div>
      )}

      <ScrollX className="rounded-xl border border-slate-200 shadow-sm bg-white -mx-4 sm:mx-0 px-4 sm:px-0">
        <table className="w-full min-w-[800px]">
          <thead>
            <tr className="bg-slate-900">
              {columns.map((col) => (
                <th
                  key={col.key}
                  onClick={() => col.sortable !== false && handleSort(col.key)}
                  className={`px-4 py-3 text-start text-xs font-semibold text-slate-300 uppercase tracking-wider whitespace-nowrap ${col.sortable !== false ? 'cursor-pointer hover:text-white' : ''}`}
                >
                  <div className="flex items-center gap-1">
                    {col.label}
                    {sortKey === col.key && (
                      sortDir === 'asc' ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />
                    )}
                  </div>
                </th>
              ))}
              {actions && <th className="px-4 py-3 text-start text-xs font-semibold text-slate-300 uppercase whitespace-nowrap">{lang === 'ar' ? 'الإجراءات' : 'Actions'}</th>}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-200">
            {sortedData.length === 0 ? (
              <tr>
                <td colSpan={columns.length + (actions ? 1 : 0)} className="px-4 py-8 text-center text-slate-800 text-sm">
                  {emptyMessage || 'No data found'}
                </td>
              </tr>
            ) : (
              shownData.map((row, i) => (
                <tr
                  key={row._id || i}
                  onClick={() => onRowClick?.(row)}
                  className={`bg-white hover:bg-slate-50 transition-colors ${onRowClick ? 'cursor-pointer' : ''}`}
                >
                  {columns.map((col) => (
                    <td key={col.key} className="px-4 py-3 text-sm text-slate-700">
                      {col.render ? col.render(row[col.key], row) : row[col.key] ?? '-'}
                    </td>
                  ))}
                  {actions && <td className="px-4 py-3 text-sm">{actions(row)}</td>}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </ScrollX>
      {pageSize && sortedData.length > pageSize && (
        <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-sm text-slate-600">
          <span className="tabular-nums">
            {(current * pageSize + 1).toLocaleString('en-US')}–{Math.min((current + 1) * pageSize, sortedData.length).toLocaleString('en-US')} {lang === 'ar' ? 'من' : 'of'} {sortedData.length.toLocaleString('en-US')}
          </span>
          <div className="flex items-center gap-1.5">
            <button type="button" disabled={current === 0} onClick={() => setPage(current - 1)}
              className="px-3 py-1.5 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 disabled:opacity-40">{lang === 'ar' ? 'السابق' : 'Previous'}</button>
            <span className="px-2 tabular-nums">{(current + 1).toLocaleString('en-US')} / {pages.toLocaleString('en-US')}</span>
            <button type="button" disabled={current >= pages - 1} onClick={() => setPage(current + 1)}
              className="px-3 py-1.5 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 disabled:opacity-40">{lang === 'ar' ? 'التالي' : 'Next'}</button>
          </div>
        </div>
      )}
    </div>
  );
}
