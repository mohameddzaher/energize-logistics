'use client';
/**
 * سجلُّ أعمار الديون — الصفحةُ التي يعمل عليها قسمُ التحصيل كلَّ صباح.
 *
 * ── ما تعرضه ───────────────────────────────────────────────────────────────
 * صفٌّ لكلّ حساب: كودُه، ومَن يتولّاه، وتقييمُه، وحدُّه الائتمانيُّ وكم استُهلك
 * منه، ومهلةُ السداد المتّفق عليها، ثمّ دَينُه موزَّعًا على شرائح العمر.
 *
 * ── ولماذا الشرائحُ أعمدةٌ لا صفحات ────────────────────────────────────────
 * السؤالُ الذي يُطرح ليس «كم عليه» بل «كم عليه **منذ متى**»: مئةُ ألفٍ عمرُها
 * خمسةَ عشرَ يومًا عملٌ جارٍ، ومئةُ ألفٍ عمرُها سنةٌ خسارةٌ تُلاحَق. وعرضُها في
 * صفٍّ واحدٍ يجعل الفرقَ يُرى بلا نقرة.
 *
 * وكلُّ شريحةٍ زرٌّ يفلتر: مَن أراد «أرِني مَن عليه دينٌ فوق ١٢٠ يومًا» ضغطها.
 */
import { useState, useEffect, useCallback, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { useLanguage } from '@/context/LanguageContext';
import { useAuth } from '@/context/AuthContext';
import api from '@/lib/api';
import ExportMenu, { exportScopeLabels, type ExportColumn } from '@/components/ls2/ExportMenu';
import {
  money, gradeTone, limitTone, receivablesOnly,
  type AgingRow, type AgeBand,
} from '@/lib/collections';
import {
  Search, FilterX, Loader2, AlertTriangle, ChevronLeft, ChevronRight, Users,
} from 'lucide-react';

interface Filters {
  officers: string[]; grades: string[]; departments: string[];
  locations: string[]; creditDays: number[]; statuses: string[]; regions: string[];
  bands: AgeBand[];
}

const EMPTY: Filters = { officers: [], grades: [], departments: [], locations: [], creditDays: [], statuses: [], regions: [], bands: [] };

export default function AgingPage({ kind }: { kind?: 'tax' | 'cash' }) {
  const { lang, isRTL } = useLanguage();
  const { user } = useAuth();
  const router = useRouter();
  const ar = lang === 'ar';

  const [rows, setRows] = useState<AgingRow[]>([]);
  const [totals, setTotals] = useState<any>({ outstanding: 0, invoices: 0, creditLimit: 0, bands: {} });
  const [bands, setBands] = useState<AgeBand[]>([]);
  const [opts, setOpts] = useState<Filters>(EMPTY);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [page, setPage] = useState(1);
  const [pages, setPages] = useState(1);
  const [total, setTotal] = useState(0);

  const [search, setSearch] = useState('');
  const [input, setInput] = useState('');
  const [officer, setOfficer] = useState('');
  const [grade, setGrade] = useState('');
  const [department, setDepartment] = useState('');
  const [hoLocation, setHoLocation] = useState('');
  const [creditDays, setCreditDays] = useState('');
  const [band, setBand] = useState('');
  const [sort, setSort] = useState('outstanding');
  const [dir, setDir] = useState<'asc' | 'desc'>('desc');

  // البحثُ يُمهَل حتى يتوقّف الكتابة: طلبٌ لكلّ حرفٍ يُغرق الخادمَ ولا يُقرأ.
  useEffect(() => {
    const t = setTimeout(() => { setSearch(input); setPage(1); }, 300);
    return () => clearTimeout(t);
  }, [input]);

  const params = useCallback(() => {
    const p = new URLSearchParams();
    if (kind) p.append('kind', kind);
    if (search) p.append('search', search);
    if (officer) p.append('officer', officer);
    if (grade) p.append('grade', grade);
    if (department) p.append('department', department);
    if (hoLocation) p.append('hoLocation', hoLocation);
    if (creditDays) p.append('creditDays', creditDays);
    if (band) p.append('band', band);
    p.append('sort', sort); p.append('dir', dir);
    return p;
  }, [kind, search, officer, grade, department, hoLocation, creditDays, band, sort, dir]);

  const load = useCallback(async () => {
    setBusy(true);
    try {
      const p = params();
      p.append('page', String(page)); p.append('limit', '50');
      const d = await api.get<any>(`/api/collections-dept/ledger/aging?${p.toString()}`);
      setRows(d.rows || []); setTotals(d.totals || {}); setBands(d.bands || []);
      setTotal(d.total || 0); setPages(d.pages || 1);
    } catch { /* الشاشةُ تبقى على آخر ما عُرف */ }
    finally { setBusy(false); setLoading(false); }
  }, [params, page]);
  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    api.get<Filters>('/api/collections-dept/ledger/aging/filters')
      .then((d) => setOpts({ ...EMPTY, ...d })).catch(() => {});
  }, []);

  const active = !!(search || officer || grade || department || hoLocation || creditDays || band);
  const clear = () => {
    setInput(''); setSearch(''); setOfficer(''); setGrade(''); setDepartment('');
    setHoLocation(''); setCreditDays(''); setBand(''); setPage(1);
  };

  const L = exportScopeLabels(ar);
  const ageBands = useMemo(() => bands.filter((b) => b.key !== 'noDate'), [bands]);
  const hasNoDate = (totals.bands?.noDate || 0) !== 0;

  const sortBy = (k: string) => {
    if (sort === k) setDir((d) => (d === 'desc' ? 'asc' : 'desc'));
    else { setSort(k); setDir('desc'); }
    setPage(1);
  };

  const exportCols = [
    { header: ar ? 'الكود' : 'Code', key: 'code', width: 14 },
    { header: ar ? 'الحساب' : 'Account', key: 'name', width: 40 },
    { header: ar ? 'موظف التحصيل' : 'Officer', key: 'collectionOfficer', width: 16 },
    { header: ar ? 'الفرع' : 'Location', key: 'hoLocation', width: 14 },
    { header: ar ? 'التقييم' : 'Grade', key: 'grade', width: 10 },
    { header: ar ? 'القسم' : 'Department', key: 'department', width: 18 },
    { header: ar ? 'مندوب المبيعات' : 'Sales', key: 'salesManagers', width: 24, transform: (v: any) => (v || []).join(' / ') },
    { header: ar ? 'الحد الائتماني' : 'Credit limit', key: 'creditLimit', width: 16 },
    { header: ar ? 'مهلة السداد' : 'Credit days', key: 'creditDays', width: 12 },
    { header: ar ? 'إجمالي المديونية' : 'Outstanding', key: 'outstanding', width: 18 },
    ...ageBands.map((b) => ({ header: b.label, key: `band_${b.key}`, width: 14 })),
  ];
  const exportRows = rows.map((r) => ({
    ...r,
    ...Object.fromEntries(ageBands.map((b) => [`band_${b.key}`, r.bands?.[b.key] || 0])),
  }));

  if (loading) {
    return <div className="flex items-center justify-center py-24"><Loader2 className="w-6 h-6 animate-spin text-[#f37121]" /></div>;
  }

  const th = 'px-3 py-3 text-start text-xs text-slate-300 font-semibold whitespace-nowrap';
  const sortable = (k: string, label: string) => (
    <th className={`${th} cursor-pointer select-none hover:text-white`} onClick={() => sortBy(k)}>
      {label}{sort === k ? (dir === 'desc' ? ' ↓' : ' ↑') : ''}
    </th>
  );

  return (
    <div className="space-y-4" dir={isRTL ? 'rtl' : 'ltr'}>
      {/* ── الأرقامُ الكبيرة، على ما يُعرَض لا على الكلّ ─────────────────────
          البطاقاتُ تعكس الفلترَ النشط: مَن فلتر بموظّفٍ يريد أرقامَ ذلك الموظّف
          لا أرقامَ الشركة. */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {[
          { label: ar ? 'حسابات' : 'Accounts', value: total.toLocaleString('en-US'), tone: 'text-slate-900' },
          { label: ar ? 'إجمالي المديونية' : 'Outstanding', value: money(totals.outstanding), tone: 'text-red-600' },
          { label: ar ? 'عدد الفواتير' : 'Open invoices', value: (totals.invoices || 0).toLocaleString('en-US'), tone: 'text-slate-900' },
          { label: ar ? 'إجمالي الحدود' : 'Credit limits', value: money(totals.creditLimit), tone: 'text-slate-900' },
        ].map((c) => (
          <div key={c.label} className="bg-white border border-slate-200 rounded-xl p-4 shadow-sm">
            <p className="text-[11px] text-slate-500">{c.label}</p>
            <p className={`text-xl font-bold mt-1 ${c.tone}`}>{c.value}</p>
          </div>
        ))}
      </div>

      {/* ── الشرائحُ أزرارُ فلترة ───────────────────────────────────────────── */}
      <div className="bg-white border border-slate-200 rounded-xl p-3 shadow-sm">
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={() => { setBand(''); setPage(1); }}
            className={`px-3 py-2 rounded-lg text-xs font-medium border transition-colors ${!band ? 'bg-[#f37121] text-white border-[#f37121]' : 'bg-slate-50 text-slate-700 border-slate-200 hover:border-[#f37121]/40'}`}>
            {ar ? 'الكل' : 'All'} · {money(totals.outstanding)}
          </button>
          {ageBands.map((b) => (
            <button key={b.key} type="button" onClick={() => { setBand(band === b.key ? '' : b.key); setPage(1); }}
              className={`px-3 py-2 rounded-lg text-xs font-medium border transition-colors ${band === b.key ? 'bg-[#f37121] text-white border-[#f37121]' : 'bg-slate-50 text-slate-700 border-slate-200 hover:border-[#f37121]/40'}`}>
              <span className="opacity-70">{b.label}</span> · {money(totals.bands?.[b.key])}
            </button>
          ))}
          {/* ما لا تاريخَ له يُعرَض ولا يُخفى: مالٌ في السجلّ لا شريحةَ عمرٍ له. */}
          {hasNoDate && (
            <button type="button" onClick={() => { setBand(band === 'noDate' ? '' : 'noDate'); setPage(1); }}
              title={ar ? 'فواتير بلا تاريخ فوترة ولا تسليم — يُكمَل تاريخُها لتدخل شريحتَها' : 'Invoices with no invoice or delivery date'}
              className={`px-3 py-2 rounded-lg text-xs font-medium border transition-colors ${band === 'noDate' ? 'bg-slate-700 text-white border-slate-700' : 'bg-amber-50 text-amber-700 border-amber-200 hover:border-amber-400'}`}>
              <AlertTriangle className="w-3 h-3 inline -mt-0.5 me-1" />
              {ar ? 'بلا تاريخ' : 'No date'} · {money(totals.bands?.noDate)}
            </button>
          )}
        </div>
      </div>

      {/* ── الفلاتر ─────────────────────────────────────────────────────────── */}
      <div className="bg-white border border-slate-200 rounded-xl p-3 shadow-sm">
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative flex-1 min-w-[220px]">
            <Search className="absolute start-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
            <input value={input} onChange={(e) => setInput(e.target.value)}
              placeholder={ar ? 'ابحث بالاسم أو الكود أو الموظف…' : 'Search name, code, officer…'}
              className="w-full ps-9 pe-3 py-2 rounded-lg border border-slate-300 text-sm focus:ring-1 focus:ring-[#f37121] focus:outline-none" />
          </div>
          {([
            [ar ? 'موظف التحصيل' : 'Officer', officer, setOfficer, opts.officers],
            [ar ? 'التقييم' : 'Grade', grade, setGrade, opts.grades],
            [ar ? 'القسم' : 'Department', department, setDepartment, opts.departments],
            [ar ? 'الفرع' : 'Location', hoLocation, setHoLocation, opts.locations],
          ] as const).map(([label, val, set, list]) => (
            <select key={label} title={label} value={val as string}
              onChange={(e) => { (set as any)(e.target.value); setPage(1); }}
              className="px-3 py-2 rounded-lg border border-slate-300 text-sm bg-white focus:ring-1 focus:ring-[#f37121] focus:outline-none">
              <option value="">{label}</option>
              {(list as string[]).map((x) => <option key={x} value={x}>{x}</option>)}
            </select>
          ))}
          <select title={ar ? 'مهلة السداد' : 'Credit days'} value={creditDays}
            onChange={(e) => { setCreditDays(e.target.value); setPage(1); }}
            className="px-3 py-2 rounded-lg border border-slate-300 text-sm bg-white focus:ring-1 focus:ring-[#f37121] focus:outline-none">
            <option value="">{ar ? 'مهلة السداد' : 'Credit days'}</option>
            {opts.creditDays.map((d) => <option key={d} value={d}>{ar ? `${d} يومًا` : `${d} days`}</option>)}
          </select>
          {active && (
            <button type="button" onClick={clear}
              className="px-3 py-2 rounded-lg border border-slate-300 text-sm text-slate-600 hover:border-red-300 hover:text-red-600 flex items-center gap-1.5">
              <FilterX className="w-4 h-4" />{ar ? 'مسح' : 'Clear'}
            </button>
          )}
          {/* ── ويُصدَّر ما يُرى، ثمّ كلُّ نتائج الفلتر ────────────────────────
              الصفحةُ مرقَّمةٌ على الخادم، فتصديرُ «المعروض» يعني الصفحةَ وحدَها
              — تُسمّى باسمها كي لا يظنّ أحدٌ أنّه صدّر الكلّ. و«كلُّ النتائج»
              يجلبها من الخادم بالفلتر نفسِه. */}
          <ExportMenu
            fileName={ar ? 'أعمار-الديون' : 'aging'} lang={lang as 'ar' | 'en'}
            options={[
              { key: 'page', label: L.page, sheets: [{ name: ar ? 'أعمار الديون' : 'Aging', rows: exportRows, columns: exportCols as ExportColumn[] }] },
              {
                key: 'matching', label: L.matching, hint: `${total}`,
                resolve: async () => {
                  const p = params(); p.append('page', '1'); p.append('limit', '5000');
                  const d = await api.get<any>(`/api/collections-dept/ledger/aging?${p.toString()}`);
                  const all = (d.rows || []).map((r: AgingRow) => ({
                    ...r, ...Object.fromEntries(ageBands.map((b) => [`band_${b.key}`, r.bands?.[b.key] || 0])),
                  }));
                  return [{ name: ar ? 'أعمار الديون' : 'Aging', rows: all, columns: exportCols as ExportColumn[] }];
                },
              },
            ]} />
        </div>
      </div>

      {/* ── الجدول ──────────────────────────────────────────────────────────── */}
      <div className="bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden">
        {busy && <div className="refresh-bar" aria-hidden="true" />}
        <div className="overflow-x-auto" aria-busy={busy}>
          <table className="w-full min-w-[1500px]">
            <thead>
              <tr className="table-head border-b border-slate-200">
                {sortable('code', ar ? 'الكود' : 'Code')}
                {sortable('name', ar ? 'الحساب' : 'Account')}
                <th className={th}>{ar ? 'موظف التحصيل' : 'Officer'}</th>
                <th className={th}>{ar ? 'الفرع' : 'Location'}</th>
                <th className={th}>{ar ? 'التقييم' : 'Grade'}</th>
                <th className={th}>{ar ? 'القسم' : 'Dept'}</th>
                <th className={th}>{ar ? 'المبيعات' : 'Sales'}</th>
                {sortable('creditDays', ar ? 'مهلة السداد' : 'Terms')}
                {sortable('creditLimit', ar ? 'الحد' : 'Limit')}
                {sortable('limitUsedPct', ar ? 'المستهلك' : 'Used')}
                {sortable('outstanding', ar ? 'المديونية' : 'Outstanding')}
                {ageBands.map((b) => <th key={b.key} className={`${th} text-end`}>{b.label}</th>)}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200">
              {rows.length === 0 ? (
                <tr><td colSpan={11 + ageBands.length} className="px-4 py-12 text-center text-slate-500 text-sm">
                  {active ? (ar ? 'لا نتائج للفلتر المحدد' : 'No rows match the filters') : (ar ? 'لا حسابات' : 'No accounts')}
                </td></tr>
              ) : rows.map((r) => (
                <tr key={r._id} className="hover:bg-slate-50 cursor-pointer"
                  onClick={() => router.push(`/system/collections-dept/parties/${r._id}`)}>
                  <td className="px-3 py-2.5 text-sm font-mono text-slate-600 whitespace-nowrap">{r.code || '—'}</td>
                  <td className="px-3 py-2.5 text-sm text-slate-900 font-medium max-w-[280px] truncate" title={r.name}>{r.name}</td>
                  <td className="px-3 py-2.5 text-sm text-slate-700 whitespace-nowrap">{r.collectionOfficer || '—'}</td>
                  <td className="px-3 py-2.5 text-sm text-slate-700 whitespace-nowrap">{r.hoLocation || '—'}</td>
                  <td className="px-3 py-2.5 whitespace-nowrap">
                    {r.grade ? <span className={`px-1.5 py-0.5 rounded border text-[11px] font-semibold ${gradeTone(r.grade)}`}>{r.grade}</span> : <span className="text-slate-400">—</span>}
                  </td>
                  <td className="px-3 py-2.5 text-sm text-slate-700 whitespace-nowrap">{r.department || '—'}</td>
                  <td className="px-3 py-2.5 text-xs text-slate-600 max-w-[160px] truncate" title={(r.salesManagers || []).join(' / ')}>{(r.salesManagers || []).join(' / ') || '—'}</td>
                  <td className="px-3 py-2.5 text-sm text-slate-700 whitespace-nowrap">{r.creditDays ? (ar ? `${r.creditDays} يومًا` : `${r.creditDays}d`) : '—'}</td>
                  <td className="px-3 py-2.5 text-sm text-slate-700 text-end tabular-nums whitespace-nowrap">{r.creditLimit ? money(r.creditLimit) : '—'}</td>
                  <td className={`px-3 py-2.5 text-sm text-end tabular-nums whitespace-nowrap ${limitTone(r.limitUsedPct)}`}
                    title={r.limitUsedPct == null ? (ar ? 'لا حدّ ائتمانيّ مضبوط لهذا الحساب' : 'No credit limit set') : undefined}>
                    {r.limitUsedPct == null ? '—' : `${Math.round(r.limitUsedPct)}%`}
                  </td>
                  <td className="px-3 py-2.5 text-sm text-end tabular-nums font-semibold text-slate-900 whitespace-nowrap">{money(r.outstanding)}</td>
                  {ageBands.map((b) => (
                    <td key={b.key} className={`px-3 py-2.5 text-sm text-end tabular-nums whitespace-nowrap ${(r.bands?.[b.key] || 0) ? 'text-slate-700' : 'text-slate-300'}`}>
                      {(r.bands?.[b.key] || 0) ? money(r.bands[b.key]) : '—'}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {pages > 1 && (
          <div className="flex items-center justify-between px-4 py-3 border-t border-slate-200 text-sm">
            <span className="text-slate-500">{ar ? `صفحة ${page} من ${pages} · ${total} حسابًا` : `Page ${page} of ${pages} · ${total} accounts`}</span>
            <div className="flex gap-1">
              <button type="button" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}
                title={ar ? 'السابق' : 'Previous'}
                className="p-1.5 rounded-lg border border-slate-300 disabled:opacity-40 hover:border-[#f37121]"><ChevronRight className={`w-4 h-4 ${isRTL ? '' : 'rotate-180'}`} /></button>
              <button type="button" disabled={page >= pages} onClick={() => setPage((p) => p + 1)}
                title={ar ? 'التالي' : 'Next'}
                className="p-1.5 rounded-lg border border-slate-300 disabled:opacity-40 hover:border-[#f37121]"><ChevronLeft className={`w-4 h-4 ${isRTL ? '' : 'rotate-180'}`} /></button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
