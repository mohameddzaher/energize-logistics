'use client';
/** HR master: one row per employee holding everything. Section pages are split by document, which suits daily work, but no single one answers "show me this employee entirely" or "export the file with columns I choose"; that took thirteen screens pasted into Excel. Every date has two faces: beside each Gregorian date is a computed Hijri column, and only the Gregorian is stored so they never diverge (see lib/hijri). Edited in place. */
import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import Link from 'next/link';
import { useLanguage } from '@/context/LanguageContext';
import { useDialog } from '@/components/system/DialogProvider';
import { useAuth } from '@/context/AuthContext';
import { canEditSection } from '@/lib/sections';
import MasterCell, { type Choices } from '@/components/hr/MasterCell';
import { usePinnedColumns } from '@/components/hr/usePinnedColumns';
import { useSocket } from '@/hooks/useSocket';
import { useLatestRequest } from '@/hooks/useLatestRequest';
import api from '@/lib/api';
import MasterNav from '@/components/hr/MasterNav';
import HrQuickFilters from '@/components/hr/HrQuickFilters';
import type { FilterValues } from '@/components/system/FilterPanel';
import { Spinner, PageHeader, SearchInput } from '@/components/hr/HRKit';
import ColumnChooser, { useVisibleColumns, type ChooserColumn } from '@/components/system/ColumnChooser';
import { ColumnFilter, type ColumnFilterOption } from '@/components/ColumnFilter';
import ExportMenu, { exportScopeLabels, type ExportColumn } from '@/components/ls2/ExportMenu';
import { printTable } from '@/utils/printTable';
import { gregorianToHijri } from '@/lib/hijri';
import { isExpiryField, daysColLabel, daysUntil } from '@/lib/hrMaster';
import { LayoutGrid, Printer, ChevronLeft, ChevronRight, ExternalLink } from 'lucide-react';
import ScrollX from '@/components/system/ScrollX';

type Col = { key: string; ar: string; en: string; type: string; group: string; groupAr: string; groupEn: string; choice?: boolean; cashPayroll?: boolean };
type Row = {
  _id: string; employeeNumber: string; name: string; employmentStatus: string;
  custodyCount: number; values: Record<string, any>; statuses: Record<string, string>;
};

const EMPTY_SET: Set<string> = new Set();
const EMPTY_OPTS: ColumnFilterOption[] = [];

/** Default columns for users who have not chosen: the essentials asked about daily (who, where they work, when residency and contract expire). The remaining 100+ columns are in the column list, and the choice is saved. */
const DEFAULT_COLS = [
  'employeeNumber', 'name', 'iqamaNumber',
  'nationality', 'jobTitle', 'department', 'branchName', 'project', 'systemStatus',
  'hireDate', 'hireDateHijri',
  'iqamaExpiry', 'iqamaExpiryHijri', 'iqamaExpiry__days',
  'contractEndDate', 'contractEndDateHijri', 'contractEndDate__days',
];

export default function HrMasterGridPage() {
  const { lang, isRTL } = useLanguage();
  const ar = lang === 'ar';
  const t = (a: string, e: string) => (ar ? a : e);
  const { notify } = useDialog();
  const { user } = useAuth();
  const canEdit = ['super_admin', 'admin', 'hr_manager', 'hr_specialist'].includes((user as any)?.role)
    || canEditSection((user as any)?.permissions, 'HR');
  // Actions, employee number, name and ID stay pinned to the right.
  const pin = usePinnedColumns(4);
  const [choices, setChoices] = useState<Choices>({});
  const loadChoices = useCallback(() => { api.get<{ choices: Choices }>('/api/hr/master/choices').then((d) => setChoices(d.choices || {})).catch(() => {}); }, []);
  useEffect(() => { loadChoices(); }, [loadChoices]);

  const [rows, setRows] = useState<Row[]>([]);
  const [cols, setCols] = useState<Col[]>([]);
  const [total, setTotal] = useState(0);
  const [pages, setPages] = useState(1);
  const [page, setPage] = useState(1);
  const [limit] = useState(50);
  const [q, setQ] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [colFilters, setColFilters] = useState<Record<string, Set<string>>>({});
  // Visible filters above the table. They were all hidden in column headers, so this is the same strip as the panel and employees page (department, job category, commercial register, city, work status, project, nationality) with a count per value, read by the server like column filters.
  const [quick, setQuick] = useState<FilterValues>({});
  const guard = useLatestRequest();
  /** Strip filters as sent, unless the column itself has a filter from its header. */
  const appendQuick = useCallback((p: URLSearchParams, skip = '') => {
    for (const [k, v] of Object.entries(quick)) {
      if (!v || k === skip || colFilters[k]) continue;
      p.set(k, String(v));
    }
  }, [quick, colFilters]);

  const params = useCallback(() => {
    const p = new URLSearchParams({ page: String(page), limit: String(limit) });
    if (q.trim()) p.set('q', q.trim());
    // `cf_<column>`: the server filters on the cell as rendered, for every column (a plain `<column>=` was ignored for non-filterable columns). See hrMasterController.gridCell.
    for (const [k, vals] of Object.entries(colFilters)) for (const v of vals) p.append(`cf_${k}`, v);
    appendQuick(p);
    return p;
  }, [page, limit, q, colFilters, appendQuick]);

  const load = useCallback(async () => {
    const mine = guard.begin();
    setBusy(true);
    try {
      const d = await api.get<any>(`/api/hr/master/grid?${params().toString()}`);
      if (!guard.isCurrent(mine)) return;
      setRows(d.rows || []);
      setCols(d.columns || []);
      setTotal(d.total || 0);
      setPages(d.pages || 1);
    } catch (e: any) {
      if (guard.isCurrent(mine)) notify(e?.message || t('تعذّر التحميل', 'Could not load'), 'error');
    } finally { setBusy(false); setLoading(false); }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params]);

  const first = useRef(true);
  useEffect(() => {
    if (first.current) { first.current = false; load(); return; }
    const id = setTimeout(load, 300);
    return () => clearTimeout(id);
  }, [load]);
  useEffect(() => { setPage(1); }, [q, colFilters, quick]);
  // Every edit on any screen of the section arrives here, and the reverse. See hr:master.
  useSocket('hr:master', useCallback(() => { load(); loadChoices(); }, [load, loadChoices]));
  useSocket('hr:employee', useCallback(() => load(), [load]));

  // Columns: every field, with its Hijri beside each date.
  const allCols = useMemo(() => {
    const base: { key: string; label: string; type: string; hijriOf?: string; daysOf?: string }[] = [
      { key: 'employeeNumber', label: t('الرقم الوظيفي', 'Employee no.'), type: 'text' },
      { key: 'name', label: t('الموظف', 'Employee'), type: 'text' },
      { key: 'iqamaNumber', label: t('رقم الهوية / الإقامة', 'ID / Iqama no.'), type: 'text' },
    ];
    // A pinned column is not listed again. Employee number and name are pinned above and also come back in the server columns as `employeeNumber` and `arabicName`, so they would appear twice in the picker and be duplicated in the table and file.
    const PINNED = new Set(['employeeNumber', 'arabicName', 'name', 'iqamaNumber']);
    // Do not generate a Hijri twin the server already sends. The server generates each date's Hijri twin in `config/hrFields` as a `hijri` column keyed `<key>Hijri`; generating it again showed the column twice. Worse, the two differ in source: the generated one converts the Gregorian date, the server's value is ready Hijri text. On export that text was read as a Gregorian date ("1448-07-08" as year 1448 AD) and converted to Hijri again, giving a meaningless date.
    const serverHijri = new Set(cols.filter((c: any) => c.type === 'hijri').map((c: any) => c.key));
    for (const c of cols) {
      if (PINNED.has(c.key)) continue;
      // Hijri column from the server: read from its Gregorian source (`of`), not from its text.
      if (c.type === 'hijri') {
        base.push({ key: c.key, label: ar ? c.ar : c.en, type: 'hijri', hijriOf: (c as any).of || c.key.replace(/Hijri$/, '') });
        continue;
      }
      base.push({ key: c.key, label: ar ? c.ar : c.en, type: c.type });
      if (c.type === 'date' && !serverHijri.has(`${c.key}Hijri`)) {
        // The Hijri column name must not carry "Gregorian". The server names the date column e.g. "expiry date (Gregorian)" (see config/hrFields), so appending "(Hijri)" would read "Gregorian (Hijri)".
        const baseLabel = (ar ? c.ar : c.en)
          .replace(' الميلادي', '').replace(' (ميلادي)', '').replace(' (Gregorian)', '');
        base.push({
          key: `${c.key}Hijri`,
          label: ar ? `${baseLabel} الهجري` : `${baseLabel} (Hijri)`,
          type: 'hijri', hijriOf: c.key,
        });
        // Days remaining follows its expiry column: the date says when, the days say how much is left. It sits right after its expiry column, with an explicit name since five columns here are headed "expiry date".
      }
      // Days remaining follows its expiry whether the twin was generated here or came from the server; it used to sit inside the twin-generation condition and vanished with it.
      if (c.type === 'date' && isExpiryField(c.key)) {
        base.push({ key: `${c.key}__days`, label: daysColLabel(c.key, ar), type: 'number', daysOf: c.key });
      }
    }
    base.push({ key: 'custodyCount', label: t('عدد العهد', 'Custody items'), type: 'number' });
    return base;
  }, [cols, ar]);

  const scope = exportScopeLabels(ar);
  // "All" is a second call without search, column filters and pagination; otherwise the two names would export one incomplete file.
  const fetchAllForExport = async () => {
    const d = await api.get<any>('/api/hr/master/grid?limit=100000');
    return [{ name: t('الماستر', 'Master'), rows: (d.rows || []) as any, columns: exportCols }];
  };

  const chooserCols: ChooserColumn[] = allCols.map((c, i) => ({ key: c.key, label: c.label, locked: i < 3 }));
  // Key `v2`: the old saved choice was truncated to four columns (see useVisibleColumns).
  const { visible, setVisible: saveVisible } = useVisibleColumns('hr:master:grid:cols:v2', chooserCols, { defaults: DEFAULT_COLS });
  // A date and its Hijri twin show and hide together, one right after the other; showing the Gregorian shows its Hijri (and the reverse), never one alone.
  const setVisible = (next: string[]) => {
    const prev = new Set(visible); const out = new Set(next);
    for (const c of allCols) {
      if (!c.hijriOf) continue;
      const g = out.has(c.hijriOf); const h = out.has(c.key);
      if (g === h) continue;
      const on = g !== prev.has(c.hijriOf) ? g : h;
      if (on) { out.add(c.hijriOf); out.add(c.key); } else { out.delete(c.hijriOf); out.delete(c.key); }
    }
    saveVisible(allCols.map((c) => c.key).filter((k) => out.has(k)));
  };
  // The first three are always pinned, even if an older choice was saved before ID was pinned.
  const shown = allCols.filter((c, i) => i < 3 || visible.includes(c.key));
  // The editable field: a server column, not a derived one (Hijri, days, custody).
  const colMap = useMemo(() => new Map(cols.map((c) => [c.key, c])), [cols]);

  const cellOf = (r: Row, c: typeof allCols[number]) => {
    if (c.key === 'employeeNumber') return r.employeeNumber || '—';
    if (c.key === 'name') return r.name || '—';
    if (c.key === 'custodyCount') return r.custodyCount || 0;
    if (c.key === 'iqamaNumber') return r.values.iqamaNumber || r.values.nationalId || '';
    // The server sends the Hijri twin with the row (see hrMasterController.grid). Client-side computation stays as a fallback for an older server so the cell is never empty.
    if (c.hijriOf) return (r.values[c.key] as string) || gregorianToHijri(r.values[c.hijriOf]) || '';
    // Days are computed at read time (see daysUntil). Empty stays empty, not zero, since "no date" differs from "expires today".
    if (c.daysOf) { const n = daysUntil(r.values[c.daysOf] as any); return n === null ? '' : n; }
    const v = r.values[c.key];
    if (v === true) return t('نعم', 'Yes');
    if (v === false) return t('لا', 'No');
    return v ?? '';
  };

  const exportCols: ExportColumn[] = shown.map((c) => ({
    header: c.label, key: c.key, width: 18,
    type: c.type === 'date' ? 'date' : c.type === 'hijri' ? 'hijri' : c.type === 'number' ? 'number' : 'text',
    // Hijri is exported with its Gregorian date so it is a real date cell displayed as Hijri, not General-type text.
    transform: (_v: any, row: any) => (c.hijriOf ? (row.values?.[c.hijriOf] ?? '') : cellOf(row as Row, c)),
  }));

  const printNow = () => {
    const ok = printTable({
      title: t('ماستر الموارد البشرية', 'HR master'),
      columns: shown.map((c) => ({ header: c.label, key: c.key, transform: (_v: any, row: any) => String(cellOf(row as Row, c) ?? '') })),
      rows: rows as any, ar,
      meta: [`${t('صفوف', 'Rows')}: ${rows.length} / ${total}`, `${t('صفحة', 'Page')} ${page}/${pages}`],
    });
    if (!ok) notify(t('المتصفّح منع نافذة الطباعة', 'The browser blocked the print window'), 'error');
  };

  /** Column filter values come from all matching employees, not the page. They used to be counted from the 50 shown, so choosing "—" returned every employee with an empty cell, the first 50 were shown and the list said "— 50", as if the filter lied. They are computed when the funnel opens: all employees matching the other filters (not this column's own, like Excel), with the same display function (`cellOf`), so what is counted is what shows in the cell. */
  const [colOpts, setColOpts] = useState<Record<string, ColumnFilterOption[]>>({});
  const [colLoading, setColLoading] = useState<string>('');
  useEffect(() => { setColOpts({}); }, [q, colFilters, quick]);
  const loadColOptions = async (key: string) => {
    if (colOpts[key]) return;
    setColLoading(key);
    try {
      // Values are counted by the server on the cell it filters by, so a count equals what picking it returns.
      const p = new URLSearchParams({ field: key });
      if (q.trim()) p.set('q', q.trim());
      for (const [k, vals] of Object.entries(colFilters)) if (k !== key) for (const v of vals) p.append(`cf_${k}`, v);
      appendQuick(p, key);
      const d = await api.get<any>(`/api/hr/master/grid/options?${p.toString()}`);
      setColOpts((prev) => ({ ...prev, [key]: (d.values || []) as ColumnFilterOption[] }));
    } catch { /* The funnel stays without values and the table is unchanged. */ }
    setColLoading('');
  };

  if (loading) return <Spinner />;

  return (
    <div className="space-y-4 pb-10" dir={isRTL ? 'rtl' : 'ltr'}>
      <MasterNav />
      <PageHeader
        icon={<LayoutGrid className="w-6 h-6 text-[#f37121]" />}
        title={t('ماستر الموارد البشرية', 'HR master')}
        subtitle={t(`${total} موظفًا · ${allCols.length} عمودًا — كل بيانات الموظف في صف واحد`,
          `${total} employees · ${allCols.length} columns — everything about an employee in one row`)}
      >
        <ColumnChooser columns={chooserCols} visible={visible} onChange={setVisible} ar={ar} />
        <button type="button" onClick={printNow}
          className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-white border border-slate-200 text-slate-600 hover:text-slate-900 text-sm font-semibold">
          <Printer className="w-4 h-4" />{t('طباعة PDF', 'Print PDF')}
        </button>
        {/* Two scopes: after the filter, and the whole master. Search and column filters run on the server and the page is paginated, so the loaded data is one page of a slice. With only "shown", exporting a full transfer order meant clearing filters and flipping pages. */}
        <ExportMenu fileName="hr-master" lang={ar ? 'ar' : 'en'}
          options={[
            { key: 'shown', label: scope.shown, sheets: [{ name: t('الماستر', 'Master'), rows: rows as any, columns: exportCols }] },
            { key: 'all', label: scope.all, resolve: fetchAllForExport },
          ]} />
      </PageHeader>

      <div className="rounded-xl border border-orange-200 bg-gradient-to-l from-orange-50 to-white p-3 shadow-sm">
        <p className="mb-2 text-[12px] font-bold text-slate-500">{t('فلترة الماستر — الجدول والعدد يتبعان اختيارك', 'Filter the master — the table and count follow your choice')}</p>
        <HrQuickFilters optionsUrl="/api/hr/master/filters" value={quick} onChange={setQuick} ar={ar} />
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div className="flex-1 min-w-[240px]">
          <SearchInput value={q} onChange={setQ}
            placeholder={t('بحث بالاسم أو الرقم الوظيفي أو الهوية…', 'name, employee no., ID…')} />
        </div>
        {Object.keys(colFilters).length > 0 && (
          <button type="button" onClick={() => setColFilters({})}
            className="px-3 py-2 rounded-lg bg-[#f37121]/10 text-[#f37121] text-xs font-medium">
            {t(`مسح فلاتر الأعمدة (${Object.keys(colFilters).length})`, `Clear column filters (${Object.keys(colFilters).length})`)}
          </button>
        )}
      </div>

      <div className="relative bg-white border border-slate-200 rounded-xl overflow-hidden shadow-sm">
        {busy && <div className="refresh-bar" aria-hidden="true" />}
        <ScrollX>
          <table className="w-full text-sm">
            <thead className="table-head">
              <tr>
                <th {...pin.th(0, 'px-3 py-2.5 text-center font-semibold whitespace-nowrap')}>{t('إجراءات', 'Actions')}</th>
                {shown.map((c, i) => (
                  <th key={c.key} {...(i < 3 ? pin.th(i + 1, 'px-3 py-2.5 text-start font-semibold whitespace-nowrap') : { className: 'px-3 py-2.5 text-start font-semibold whitespace-nowrap' })}>
                    <span className="inline-flex items-center">
                      {c.label}
                      <ColumnFilter
                        field={c.key}
                        selected={colFilters[c.key] || EMPTY_SET}
                        onChange={(set) => setColFilters((p) => {
                          const n = { ...p };
                          if (set.size) n[c.key] = set; else delete n[c.key];
                          return n;
                        })}
                        options={colOpts[c.key] || EMPTY_OPTS}
                        onOpen={() => loadColOptions(c.key)}
                        loading={colLoading === c.key}
                        lang={ar ? 'ar' : 'en'}
                      />
                    </span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <tr><td colSpan={shown.length + 1} className="px-4 py-12 text-center text-slate-400">{t('لا نتائج', 'No results')}</td></tr>
              ) : rows.map((r) => (
                <tr key={r._id} className="group border-b border-slate-100 hover:bg-slate-50">
                  <td {...pin.td(0, 'px-3 py-2 text-center')}>
                    <Link href={`/system/hr/employees/${r._id}`} title={t('فتح ملف الموظف', 'Open profile')}
                      className="inline-flex p-1.5 rounded-md text-slate-600 hover:text-[#f37121] hover:bg-slate-100">
                      <ExternalLink className="w-3.5 h-3.5" />
                    </Link>
                  </td>
                  {shown.map((c, i) => {
                    const st = r.statuses[c.hijriOf || c.key];
                    // Hijri is editable like Gregorian: the cell opens and takes input, and the server converts it to Gregorian and writes the same date (see updateFields), so both columns update with no sync.
                    const field = c.hijriOf
                      ? { key: c.key, ar: c.label, en: c.label, type: 'hijri' }
                      : colMap.get(c.key);
                    const tone = st === 'required' ? 'bg-red-50/60 text-red-700' : st === 'not_required' ? 'text-slate-300' : 'text-slate-700';
                    const cls = `px-3 py-2 whitespace-nowrap ${i < 3 ? '' : tone}`;
                    const props = i < 3 ? pin.td(i + 1, cls) : { className: cls };
                    if (c.key === 'name') {
                      return (
                        <td key={c.key} {...props}>
                          {/* Cap the employee name width and truncate: an uncapped long name hides the columns the table exists for. The full name is in the tooltip and on its page. Same as the employees table. */}
                          <Link href={`/system/hr/employees/${r._id}`}
                            title={r.name || ''}
                            className="block max-w-[15rem] truncate font-semibold text-slate-900 hover:text-[#f37121]">{r.name || '—'}</Link>
                        </td>
                      );
                    }
                    if (field && canEdit) {
                      return (
                        <td key={c.key} {...props}>
                          <MasterCell id={r._id} f={field} raw={r.values[c.key]} st={st} choices={choices}
                            ar={ar} canEdit={canEdit} onSaved={load} notify={notify} compact />
                        </td>
                      );
                    }
                    return (
                      <td key={c.key} {...props}>
                        {st === 'not_required' ? '—' : (String(cellOf(r, c) ?? '') || <span className="text-slate-300">—</span>)}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </ScrollX>

        {pages > 1 && (
          <div className="flex items-center justify-between px-4 py-3 border-t border-slate-100 text-sm">
            <span className="text-slate-500">{t(`صفحة ${page} من ${pages} · ${total} موظفًا`, `Page ${page} of ${pages} · ${total} employees`)}</span>
            <div className="flex items-center gap-2">
              <button type="button" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}
                className="p-1.5 rounded-lg border border-slate-200 disabled:opacity-40">
                <ChevronRight className={`w-4 h-4 ${isRTL ? '' : 'hidden'}`} /><ChevronLeft className={`w-4 h-4 ${isRTL ? 'hidden' : ''}`} />
              </button>
              <button type="button" disabled={page >= pages} onClick={() => setPage((p) => p + 1)}
                className="p-1.5 rounded-lg border border-slate-200 disabled:opacity-40">
                <ChevronLeft className={`w-4 h-4 ${isRTL ? '' : 'hidden'}`} /><ChevronRight className={`w-4 h-4 ${isRTL ? 'hidden' : ''}`} />
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
