'use client';
import { useState } from 'react';
import { ChevronUp, ChevronDown, Search } from 'lucide-react';

interface Column {
  key: string;
  label: string;
  render?: (value: any, row: any) => React.ReactNode;
  sortable?: boolean;
  /**
   * ما يُبحَث فيه لهذا العمود حين لا يكون `key` حقلًا في الصفّ.
   *
   * ── العطل الذي أوجب هذا ──────────────────────────────────────────────────
   * البحثُ كان يقرأ `row[col.key]` دائمًا. وعمودُ الاسم في صفحة المستخدمين
   * مفتاحُه `name` بينما الصفُّ يحمل `firstName` و`lastName` — فالقيمةُ
   * `undefined`، فلا يطابق البحثُ بالاسم أحدًا أبدًا. والاسمُ معروضٌ أمام
   * المستخدم في العمود نفسِه لأنّ `render` يركّبه، فيبحث عمّا يراه فلا يجده
   * ويظنّ الحسابَ غيرَ موجود.
   *
   * فكلُّ عمودٍ يعرض شيئًا مركَّبًا يقول هنا بماذا يُبحَث فيه.
   */
  search?: (row: any) => any;
}

/**
 * طيُّ العربيّة قبل المقارنة.
 *
 * الاسمُ يُكتب «أحمد» ويُبحَث عنه «احمد»، و«فاطمة» و«فاطمه» اسمٌ واحد. والمقارنةُ
 * الحرفيّة تجعل من يبحث عن الاسم الذي يراه أمامه لا يجده — وهي القاعدةُ نفسُها
 * المستعمَلة في بحث الخادم (`utils/plateKey`).
 */
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
}

export default function DataTable({ columns, data, searchable, searchPlaceholder, onRowClick, emptyMessage, actions }: DataTableProps) {
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

      <div className="overflow-x-auto rounded-xl border border-slate-200 shadow-sm bg-white -mx-4 sm:mx-0 px-4 sm:px-0">
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
              {actions && <th className="px-4 py-3 text-start text-xs font-semibold text-slate-300 uppercase whitespace-nowrap">Actions</th>}
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
              sortedData.map((row, i) => (
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
      </div>
    </div>
  );
}
