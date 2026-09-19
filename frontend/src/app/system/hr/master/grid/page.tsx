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
 *
 * ── ويُعدَّل في مكانه ───────────────────────────────────────────────────────
 * كلُّ خانةٍ من حقول الموظّف تُفتح بالضغط (MasterCell — الخانةُ نفسُها في صفحات
 * المجموعات)، والحفظُ يبثّ `hr:master` و`hr:employee` فتتحدّث بقيّةُ القسم. أمّا
 * الهجريُّ والأيّامُ وعددُ العهد فمشتقّةٌ لا تُكتب. وفتحُ الملفّ صار زرًّا في عمود
 * الإجراءات — الضغطُ على الصفّ كلِّه كان يسرق الضغطةَ من الخانة.
 */
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
import { Spinner, PageHeader, SearchInput } from '@/components/hr/HRKit';
import ColumnChooser, { useVisibleColumns, type ChooserColumn } from '@/components/system/ColumnChooser';
import { ColumnFilter, type ColumnFilterOption } from '@/components/ColumnFilter';
import ExportMenu, { exportScopeLabels, type ExportColumn } from '@/components/ls2/ExportMenu';
import { printTable } from '@/utils/printTable';
import { gregorianToHijri } from '@/lib/hijri';
import { isExpiryField, daysColLabel, daysUntil } from '@/lib/hrMaster';
import { LayoutGrid, Printer, ChevronLeft, ChevronRight, ExternalLink } from 'lucide-react';

type Col = { key: string; ar: string; en: string; type: string; group: string; groupAr: string; groupEn: string; choice?: boolean; cashPayroll?: boolean };
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
  const { notify } = useDialog();
  const { user } = useAuth();
  const canEdit = ['super_admin', 'admin', 'hr_manager', 'hr_specialist'].includes((user as any)?.role)
    || canEditSection((user as any)?.permissions, 'HR');
  // الإجراءات، الرقم الوظيفيّ، الاسم، الهويّة — ثابتةٌ على اليمين.
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
  useSocket('hr:master', useCallback(() => { load(); loadChoices(); }, [load, loadChoices]));
  useSocket('hr:employee', useCallback(() => load(), [load]));

  // ── الأعمدة: كلُّ حقلٍ، وبجانب كلّ تاريخٍ هجريُّه ──────────────────────
  const allCols = useMemo(() => {
    const base: { key: string; label: string; type: string; hijriOf?: string; daysOf?: string }[] = [
      { key: 'employeeNumber', label: t('الرقم الوظيفي', 'Employee no.'), type: 'text' },
      { key: 'name', label: t('الموظف', 'Employee'), type: 'text' },
      { key: 'iqamaNumber', label: t('رقم الهوية / الإقامة', 'ID / Iqama no.'), type: 'text' },
    ];
    // ── والعمودُ المثبَّتُ لا يُعرَض مرّةً ثانيةً في القائمة ──────────────────
    // الرقمُ الوظيفيُّ والاسمُ مثبَّتان أعلاه، ويعودان في أعمدة الخادم باسمَي
    // `employeeNumber` و`arabicName` — فيظهران مرّتين في قائمة الاختيار،
    // ويُعلَّم عليهما فيتكرّران في الجدول وفي الملفّ.
    const PINNED = new Set(['employeeNumber', 'arabicName', 'name', 'iqamaNumber']);
    for (const c of cols) {
      if (PINNED.has(c.key)) continue;
      base.push({ key: c.key, label: ar ? c.ar : c.en, type: c.type });
      if (c.type === 'date') {
        base.push({ key: `${c.key}__hijri`, label: `${ar ? c.ar : c.en} ${t('(هجري)', '(Hijri)')}`, type: 'hijri', hijriOf: c.key });
        // ── والمدّةُ بالأيّام تلي انتهاءَها ───────────────────────────────────
        // التاريخُ يقول متى، والمدّةُ تقول كم بقي — وهي السؤالُ الذي يُفتَح
        // الجدولُ لأجله. وتقع بعد عمودِ انتهائها مباشرةً فتُقرأ معه، ولها اسمٌ
        // صريحٌ لأنّ خمسةَ أعمدةٍ هنا عنوانُها «تاريخ الانتهاء» نفسُه.
        if (isExpiryField(c.key)) {
          base.push({ key: `${c.key}__days`, label: daysColLabel(c.key, ar), type: 'number', daysOf: c.key });
        }
      }
    }
    base.push({ key: 'custodyCount', label: t('عدد العهد', 'Custody items'), type: 'number' });
    return base;
  }, [cols, ar]);

  const scope = exportScopeLabels(ar);
  // «الكلّ» نداءٌ ثانٍ مجرَّدٌ من البحث وفلاتر الأعمدة والترقيم — وإلّا كان
  // الاسمان لملفٍّ واحدٍ ناقص.
  const fetchAllForExport = async () => {
    const d = await api.get<any>('/api/hr/master/grid?limit=100000');
    return [{ name: t('الماستر', 'Master'), rows: (d.rows || []) as any, columns: exportCols }];
  };

  const chooserCols: ChooserColumn[] = allCols.map((c, i) => ({ key: c.key, label: c.label, locked: i < 3 }));
  const { visible, setVisible } = useVisibleColumns('hr:master:grid:cols', chooserCols);
  // الثلاثةُ الأولى ثابتةٌ دائمًا — حتّى لو حُفظ اختيارٌ قديمٌ قبل تثبيت الهويّة.
  const shown = allCols.filter((c, i) => i < 3 || visible.includes(c.key));
  // الحقلُ الذي يُعدَّل: عمودٌ من أعمدة الخادم، لا مشتقٌّ (هجريّ، أيّام، عهد).
  const colMap = useMemo(() => new Map(cols.map((c) => [c.key, c])), [cols]);

  const cellOf = (r: Row, c: typeof allCols[number]) => {
    if (c.key === 'employeeNumber') return r.employeeNumber || '—';
    if (c.key === 'name') return r.name || '—';
    if (c.key === 'custodyCount') return r.custodyCount || 0;
    if (c.key === 'iqamaNumber') return r.values.iqamaNumber || r.values.nationalId || '';
    if (c.hijriOf) return gregorianToHijri(r.values[c.hijriOf]) || '';
    // الأيّامُ تُحسَب عند القراءة — راجع daysUntil. والفارغُ يبقى فارغًا لا صفرًا:
    // «بلا تاريخ» غيرُ «ينتهي اليوم».
    if (c.daysOf) { const n = daysUntil(r.values[c.daysOf] as any); return n === null ? '' : n; }
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
        {/* ── نطاقان: ما بعد الفلتر، والماستر كلُّه ────────────────────────
            البحثُ وفلاتر الأعمدة تُطبَّق على الخادم والصفحةُ مرقَّمة، فما في
            اليد صفحةٌ من شريحة. وكان الخيارُ واحدًا اسمُه «المعروض» — فمن أراد
            الكشفَ كاملًا لم يجد إليه سبيلًا إلّا رفعَ الفلاتر وتقليبَ الصفحات. */}
        <ExportMenu fileName="hr-master" lang={ar ? 'ar' : 'en'}
          options={[
            { key: 'shown', label: scope.shown, sheets: [{ name: t('الماستر', 'Master'), rows: rows as any, columns: exportCols }] },
            { key: 'all', label: scope.all, resolve: fetchAllForExport },
          ]} />
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
                    const field = colMap.get(c.key);
                    const tone = st === 'required' ? 'bg-red-50/60 text-red-700' : st === 'not_required' ? 'text-slate-300' : 'text-slate-700';
                    const cls = `px-3 py-2 whitespace-nowrap ${i < 3 ? '' : tone}`;
                    const props = i < 3 ? pin.td(i + 1, cls) : { className: cls };
                    if (c.key === 'name') {
                      return (
                        <td key={c.key} {...props}>
                          <Link href={`/system/hr/employees/${r._id}`} className="font-semibold text-slate-900 hover:text-[#f37121]">{r.name || '—'}</Link>
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
