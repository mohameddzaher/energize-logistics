'use client';
/**
 * ماستر الموارد البشرية — صفٌّ واحدٌ لكلّ موظّف، فيه كلُّ شيء.
 *
 * ── لماذا ────────────────────────────────────────────────────────────────
 * صفحاتُ القسم مقسَّمةٌ بحسب المستند — إقاماتٌ وجوازاتٌ وعقود — وهو التقسيمُ
 * الصحيح للعمل اليوميّ. لكنّ سؤالَ «أرِني هذا الموظّف كلَّه» أو «صدّر الملفَّ
 * بأعمدةٍ أختارها» لا تجيب عنه أيُّ واحدةٍ منها، وكان يُجاب بفتح ثلاثَ عشرةَ
 * شاشةً ولصقِ نتائجها في إكسل.
 *
 * ── وكلُّ تاريخٍ بوجهين ──────────────────────────────────────────────────
 * بجانب كلّ تاريخٍ ميلاديٍّ عمودٌ هجريٌّ يُحسَب — والمحفوظُ ميلاديٌّ وحدَه،
 * فلا يفترق الوجهان. راجع lib/hijri.
 */
import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { useLanguage } from '@/context/LanguageContext';
import { useDialog } from '@/components/system/DialogProvider';
import { useSocket } from '@/hooks/useSocket';
import { useLatestRequest } from '@/hooks/useLatestRequest';
import api from '@/lib/api';
import MasterNav from '@/components/hr/MasterNav';
import { Spinner, PageHeader, SearchInput } from '@/components/hr/HRKit';
import ColumnChooser, { useVisibleColumns, type ChooserColumn } from '@/components/system/ColumnChooser';
import { ColumnFilter, type ColumnFilterOption } from '@/components/ColumnFilter';
import ExportMenu, { type ExportColumn } from '@/components/ls2/ExportMenu';
import { printTable } from '@/utils/printTable';
import { gregorianToHijri } from '@/lib/hijri';
import { LayoutGrid, Printer, ChevronLeft, ChevronRight } from 'lucide-react';

type Col = { key: string; ar: string; en: string; type: string; group: string; groupAr: string; groupEn: string };
type Row = {
  _id: string; employeeNumber: string; name: string; employmentStatus: string;
  custodyCount: number; values: Record<string, any>; statuses: Record<string, string>;
};

const EMPTY_SET: Set<string> = new Set();
const EMPTY_OPTS: ColumnFilterOption[] = [];

export default function HrMasterGridPage() {
  const { lang, isRTL } = useLanguage();
  const ar = lang === 'ar';
  const t = (a: string, e: string) => (ar ? a : e);
  const router = useRouter();
  const { notify } = useDialog();

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
  const guard = useLatestRequest();

  const params = useCallback(() => {
    const p = new URLSearchParams({ page: String(page), limit: String(limit) });
    if (q.trim()) p.set('q', q.trim());
    for (const [k, vals] of Object.entries(colFilters)) for (const v of vals) p.append(k, v);
    return p;
  }, [page, limit, q, colFilters]);

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
  useEffect(() => { setPage(1); }, [q, colFilters]);
  // كلُّ تعديلٍ في أيّ شاشةٍ في القسم يصل هنا — والعكس. راجع hr:master.
  useSocket('hr:master', useCallback(() => load(), [load]));

  // ── الأعمدة: كلُّ حقلٍ، وبجانب كلّ تاريخٍ هجريُّه ──────────────────────
  const allCols = useMemo(() => {
    const base: { key: string; label: string; type: string; hijriOf?: string }[] = [
      { key: 'employeeNumber', label: t('الرقم الوظيفي', 'Employee no.'), type: 'text' },
      { key: 'name', label: t('الموظف', 'Employee'), type: 'text' },
    ];
    for (const c of cols) {
      base.push({ key: c.key, label: ar ? c.ar : c.en, type: c.type });
      if (c.type === 'date') {
        base.push({ key: `${c.key}__hijri`, label: `${ar ? c.ar : c.en} ${t('(هجري)', '(Hijri)')}`, type: 'hijri', hijriOf: c.key });
      }
    }
    base.push({ key: 'custodyCount', label: t('عدد العهد', 'Custody items'), type: 'number' });
    return base;
  }, [cols, ar]);

  const chooserCols: ChooserColumn[] = allCols.map((c, i) => ({ key: c.key, label: c.label, locked: i < 2 }));
  const { visible, setVisible } = useVisibleColumns('hr:master:grid:cols', chooserCols);
  const shown = allCols.filter((c) => visible.includes(c.key));

  const cellOf = (r: Row, c: typeof allCols[number]) => {
    if (c.key === 'employeeNumber') return r.employeeNumber || '—';
    if (c.key === 'name') return r.name || '—';
    if (c.key === 'custodyCount') return r.custodyCount || 0;
    if (c.hijriOf) return gregorianToHijri(r.values[c.hijriOf]) || '';
    const v = r.values[c.key];
    if (v === true) return t('نعم', 'Yes');
    if (v === false) return t('لا', 'No');
    return v ?? '';
  };

  const exportCols: ExportColumn[] = shown.map((c) => ({
    header: c.label, key: c.key, width: 18,
    type: c.type === 'date' ? 'date' : c.type === 'hijri' ? 'hijri' : c.type === 'number' ? 'number' : 'text',
    // الهجريُّ يُصدَّر بتاريخه الميلاديّ ليصير خانةَ تاريخٍ حقيقيّةً تُعرَض
    // هجريًّا — لا نصًّا نوعُه General.
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

  // قيمُ عمودٍ للفلتر — تُشتقّ من الصفحة المعروضة (الفلترُ يُطبَّق في الخادم).
  const optionsFor = (key: string): ColumnFilterOption[] => {
    const m = new Map<string, number>();
    for (const r of rows) {
      const c = allCols.find((x) => x.key === key);
      const v = c ? String(cellOf(r, c) ?? '') : '';
      m.set(v || '—', (m.get(v || '—') || 0) + 1);
    }
    return [...m.entries()].map(([value, count]) => ({ value, count })).sort((a, b) => b.count - a.count);
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
        <ExportMenu fileName="hr-master" lang={ar ? 'ar' : 'en'}
          options={[{ key: 'shown', label: t('المعروض', 'Shown'), sheets: [{ name: t('الماستر', 'Master'), rows: rows as any, columns: exportCols }] }]} />
      </PageHeader>

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
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="table-head">
              <tr>
                {shown.map((c) => (
                  <th key={c.key} className="px-3 py-2.5 text-start font-semibold whitespace-nowrap">
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
                        options={optionsFor(c.key) || EMPTY_OPTS}
                        lang={ar ? 'ar' : 'en'}
                      />
                    </span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <tr><td colSpan={shown.length} className="px-4 py-12 text-center text-slate-400">{t('لا نتائج', 'No results')}</td></tr>
              ) : rows.map((r) => (
                <tr key={r._id} className="border-b border-slate-100 hover:bg-slate-50 cursor-pointer"
                  onClick={() => router.push(`/system/hr/employees/${r._id}`)}>
                  {shown.map((c) => {
                    const st = r.statuses[c.hijriOf || c.key];
                    return (
                      <td key={c.key}
                        className={`px-3 py-2 whitespace-nowrap ${st === 'required' ? 'bg-red-50/60 text-red-700' : st === 'not_required' ? 'text-slate-300' : 'text-slate-700'}`}>
                        {st === 'not_required' ? '—' : (String(cellOf(r, c) ?? '') || <span className="text-slate-300">—</span>)}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>

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
