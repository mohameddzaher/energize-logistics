'use client';
// Page for any group: residencies, passports, contracts, medical insurance, health certificates, driver cards, licenses, banks, social insurance. One page built from the field definitions served by the server, so a new group gets the same cards, filters and quick edit, and hand-made pages would drift apart. Filling happens in place: the missing cell is clicked and typed, and saving clears its required state on the server so the counter drops. The page has three whole-group actions: add opens the group file for an employee with no data, edit opens only the group's fields for one person (not the whole employee form), and clear erases this group's data for him only. None deletes an employee; see components/hr/HrGroupModals.
import { useState, useEffect, useCallback, useRef, Suspense } from 'react';
import { useRouter, useSearchParams, useParams } from 'next/navigation';
import { useLanguage } from '@/context/LanguageContext';
import { useAuth } from '@/context/AuthContext';
import { useSocket } from '@/hooks/useSocket';
import { useLatestRequest } from '@/hooks/useLatestRequest';
import { useDialog } from '@/components/system/DialogProvider';
import { Spinner, PageHeader } from '@/components/hr/HRKit';
import MasterCell, { type Choices } from '@/components/hr/MasterCell';
import { usePinnedColumns } from '@/components/hr/usePinnedColumns';
import api from '@/lib/api';
import ExportMenu, { exportScopeLabels, type ExportColumn } from '@/components/ls2/ExportMenu';
import { Search, Check, X, Pencil, ArrowUpDown, RefreshCw, ArrowRight, Plus, Trash2 } from 'lucide-react';
import { stateMeta, statusMeta,
  getHrRecords, updateEmployeeFields, renewHrDocument, renewHrBulk, RENEWABLE_GROUPS,
  STATUS_META, STATE_META, statusLabel, stateLabel,
  fmtDate, toDateInput, daysText, isExpiryField, daysColLabel, daysUntil,
  type RecordRow, type FieldDef,
} from '@/lib/hrMaster';
import SelectionBar from '@/components/ls2/SelectionBar';
import { canEditSection } from '@/lib/sections';
import HrQuickFilters from '@/components/hr/HrQuickFilters';
import FilterPanel, { type FilterValues } from '@/components/system/FilterPanel';
import { HR_DATE_FIELDS, HR_NUM_RANGES, HR_EMPLOYMENT_LABELS } from '@/lib/hrMaster';
import MasterNav from '@/components/hr/MasterNav';
import DatePair from '@/components/hr/DatePair';
import { bothDates } from '@/lib/hrDates';
import ContractsTabs from '@/components/hr/ContractsTabs';
import { HrGroupFormModal, HrGroupClearModal } from '@/components/hr/HrGroupModals';
import ScrollX from '@/components/system/ScrollX';

/** Where the days-remaining column goes: after the whole date pair, never between the Gregorian date and its Hijri twin. Re-keyed as the expiry key when `f` is the last of the pair (the Hijri twin, or the date itself if it has none). */
const daysAfter = (f: { key: string }, fields: { key: string }[]): string | null => {
  if (f.key.endsWith('Hijri')) {
    const base = f.key.slice(0, -'Hijri'.length);
    return isExpiryField(base) ? base : null;
  }
  if (!isExpiryField(f.key)) return null;
  return fields.some((x) => x.key === `${f.key}Hijri`) ? null : f.key;
};

const QUICK = [30, 60, 90, 180];
// Cell states shown as counters and chosen as filters. The first four are the common ones; the next three appear where they exist (bank: cash salary, insurance: inactive). Without them the field counters would not sum to the group's employee count.
const STATUS_KEYS = ['required', 'not_required', 'filled', 'none', 'cash_payroll', 'inactive', 'unparseable'] as const;

/** Who is not on the job and why. Two columns appear only in this list, deliberately two: employment status is our decision and is always known (ended or on leave), while contract status is the contract paper's text as written in the HR file. They differ often, and contract status is empty for most rows, while employment alone would not say what the paper says. */
const EMPLOYMENT_META: Record<string, { ar: string; en: string; cls: string }> = {
  terminated: { ar: 'أُنهيت خدمته', en: 'Terminated', cls: 'bg-red-100 text-red-700' },
  on_leave: { ar: 'في إجازة', en: 'On leave', cls: 'bg-amber-100 text-amber-700' },
  suspended: { ar: 'موقوف', en: 'Suspended', cls: 'bg-orange-100 text-orange-700' },
  active: { ar: 'على رأس العمل', en: 'Active', cls: 'bg-emerald-100 text-emerald-700' },
};
const employmentMeta = (v?: string) => EMPLOYMENT_META[v || ''] || { ar: v || '—', en: v || '—', cls: 'bg-slate-100 text-slate-600' };

function GroupInner() {
  const { lang, isRTL } = useLanguage();
  const ar = lang === 'ar';
  const t = (a: string, e: string) => (ar ? a : e);
  const router = useRouter();
  const params = useParams();
  const sp = useSearchParams();
  const { user } = useAuth();
  const { notify } = useDialog();
  const group = String(params?.group || '');

  const canEdit = ['super_admin', 'admin', 'hr_manager', 'hr_specialist'].includes((user as any)?.role)
    || canEditSection((user as any)?.permissions, 'HR');
  // Pinned right columns: selection and actions (for editors), then employee number, name and ID. See usePinnedColumns.
  const lead = (RENEWABLE_GROUPS.has(group) && canEdit ? 1 : 0) + (canEdit ? 1 : 0);
  const pin = usePinnedColumns(lead + 3);

  const [q, setQ] = useState('');
  const [field, setField] = useState(sp?.get('field') || '');
  const [status, setStatus] = useState(sp?.get('status') || '');
  const [state, setState] = useState(sp?.get('state') || '');
  const [within, setWithin] = useState(sp?.get('withinDays') || '');
  // "Expires within 30 days" did not exclude those expired over a year ago, which inflated the count. The choice is now explicit to the user, like the vehicles screen.
  const [includeExpired, setIncludeExpired] = useState(true);
  const [sort, setSort] = useState('');
  const [dir, setDir] = useState<'asc' | 'desc'>('asc');
  // A filter carried from the overview stays visible and editable here; hidden, the user would see a shorter table with no explanation, which is worse than no filter.
  const CTRL = ['field', 'status', 'state', 'withinDays', 'sort', 'dir', 'includeExpired', 'q'];
  // `employment` is not in CTRL; it is a panel filter like the others. The two columns appear only in the not-on-the-job list, and not in the contracts group (which already has contract status as a column). See EMPLOYMENT_META.
  const [filters, setFilters] = useState<FilterValues>(() =>
    Object.fromEntries([...(sp?.entries() || [])].filter(([k]) => !CTRL.includes(k))));
  const [d, setD] = useState<Awaited<ReturnType<typeof getHrRecords>> | null>(null);
  const [loading, setLoading] = useState(true);
  // Selection and renewal: only groups with an expiry date can be renewed; bank data never expires, so it has no renew button.
  const showWhyInactive = (filters as any).employment === 'inactive' && group !== 'contract';
  const renewable = RENEWABLE_GROUPS.has(group);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [bulk, setBulk] = useState(false);
  const [renewing, setRenewing] = useState<RecordRow | null>(null);
  // Create/edit/clear: one form for both cases, since two components would let a field added to the group show in only one.
  const [form, setForm] = useState<{ mode: 'create' | 'edit'; row: RecordRow | null } | null>(null);
  const [clearing, setClearing] = useState<RecordRow | null>(null);

  // Counters and table are one guarded response. The unfiltered page is the heaviest request and fires on open; a later counter click or socket refresh could let the widest response land last and overwrite the table. See hooks/useLatestRequest.
  const guard = useLatestRequest();
  // Clicking a number in a field card scrolls to its rows in the table, so the click does not look like it did nothing.
  const tableRef = useRef<HTMLDivElement>(null);
  const load = useCallback(async () => {
    const mine = guard.begin();
    try {
      const res = await getHrRecords(group, {
        q: q.trim(), field, status, state, withinDays: within, sort, dir,
        // Inactive here is a cell state, not an employment status; see legacyEmploymentStatus on the server.
        statusKind: 'cell',
        includeExpired: includeExpired ? '1' : '0',
        // Value filters coming from the overview cards (department, nationality, durations, ...).
        ...filters,
      });
      if (!guard.isCurrent(mine)) return;
      setD(res);
    } catch (e: any) { if (guard.isCurrent(mine)) notify(e?.message || 'Failed', 'error'); }
    if (guard.isCurrent(mine)) setLoading(false);
  }, [group, q, field, status, state, within, includeExpired, sort, dir, JSON.stringify(filters), notify, guard]);

  useEffect(() => { const h = setTimeout(load, 250); return () => clearTimeout(h); }, [load]);
  useSocket('hr:master', useCallback(() => { load(); }, [load]));
  // Contract changes on the contracts page (create, terminate, delete) change contract status here.
  useSocket('hr:contract', useCallback(() => { load(); }, [load]));
  // Choice-field lists (license type, bank, insurance status, ...); see MasterCell.
  const [choices, setChoices] = useState<Choices>({});
  const loadChoices = useCallback(() => { api.get<{ choices: Choices }>('/api/hr/master/choices').then((d) => setChoices(d.choices || {})).catch(() => {}); }, []);
  useEffect(() => { loadChoices(); }, [loadChoices]);
  useSocket('hr:master', loadChoices);

  // Selections live in the URL. Previously the filter was read once on open and then detached, so back went to a stale state and refresh erased the selection.
  useEffect(() => {
    const p = new URLSearchParams();
    for (const [k, v] of Object.entries(filters)) if (v !== '' && v != null) p.set(k, String(v));
    if (field) p.set('field', field);
    if (status) p.set('status', status);
    if (state) p.set('state', state);
    if (within) p.set('withinDays', within);
    const q = p.toString();
    router.replace(`/system/hr/master/${group}${q ? `?${q}` : ''}`, { scroll: false });
  }, [JSON.stringify(filters), field, status, state, within, group, router]);

  /** Return to the overview carrying the current filter, not dropping it. */
  const backToOverview = () => {
    const q = new URLSearchParams(
      Object.entries(filters).filter(([, v]) => v !== '' && v != null) as [string, string][]).toString();
    router.push(`/system/hr/master${q ? `?${q}` : ''}`);
  };
  // Selection is cleared when filters change: a row selected and then filtered out stays selected unseen, and the batch would renew names not on screen.
  useEffect(() => { setPicked(new Set()); }, [group, q, field, status, state, within, includeExpired, JSON.stringify(filters)]);

  if (loading && !d) return <Spinner />;
  if (!d) return <div className="text-slate-500 p-8">{t('تعذّر التحميل', 'Could not load')}</div>;

  const g = d.group;
  const rows = d.rows;
  const cols: ExportColumn[] = [
    { header: t('الرقم الوظيفي', 'Employee no.'), key: 'employeeNumber', width: 14 },
    { header: t('الاسم', 'Name'), key: 'name', width: 30 },
    { header: t('رقم الهوية', 'ID number'), key: 'iqamaNumber', width: 16 },
    // Commercial register the employee is on, beside name and residency number. Same linking rule as backend utils/hrEngagement: our register number shows its number, freelancer in any spelling is freelancer, training is trainee, empty is unspecified.
    { header: t('السجل', 'Commercial register'), key: 'registerNumber', width: 16,
      transform: (v: any) => {
        const r = String(v || '').trim();
        if (!r) return ar ? 'غير محدّد' : 'Not specified';
        if (/فري\s*لانس|فريلانس|freelanc/i.test(r)) return ar ? 'فريلانسر' : 'Freelancer';
        if (/تدريب|متدرب|trainee/i.test(r)) return ar ? 'متدرّب' : 'Trainee';
        return r;
      } },
    { header: t('القسم', 'Department'), key: 'department', width: 18 },
    // The export carries what the screen shows, so someone exporting the not-on-the-job list has its reason column.
    ...(showWhyInactive ? [
      {
        header: t('حالة التوظيف', 'Employment'), key: 'employmentStatus', width: 16,
        transform: (v: any) => { const m = employmentMeta(v); return ar ? m.ar : m.en; },
      },
      {
        header: t('حالة العقد', 'Contract status'), key: 'values', width: 20,
        transform: (_v: any, row: any) => String(row.values?.contractStatusText || '').trim()
          || (ar ? 'غير مسجَّلة' : 'not recorded'),
      },
    ] as ExportColumn[] : []),
    ...g.fields.flatMap((f) => [
      {
        header: ar ? f.ar : f.en, key: 'values',
        transform: (v: any, row: any) => {
          const raw = row.values?.[f.key];
          const st = row.statuses?.[f.key];
          if (st === 'required') return ar ? 'مطلوب' : 'Required';
          if (st === 'not_required') return ar ? 'غير مطلوب' : 'Not required';
          return f.type === 'date' ? fmtDate(raw) : (raw ?? '');
        },
        width: 18,
      },
      // The export carries what the screen shows, as a sortable, summable number rather than text.
      ...(daysAfter(f, g.fields) ? [{
        header: daysColLabel(daysAfter(f, g.fields)!, ar), key: 'values', width: 16,
        transform: (_v: any, row: any) => { const n = daysUntil(row.values?.[daysAfter(f, g.fields)!]); return n === null ? '' : n; },
      }] : []),
    ] as ExportColumn[]),
  ];

  // All filters here run on the server (search, filter panel, status, duration), so memory holds only the result. "All" re-fetches without any of them, instead of making the user clear filters by hand to export the whole group.
  const hasActiveFilters = !!(q.trim() || field || status || state || within || !includeExpired
    || Object.values(filters).some((v) => v !== '' && v != null));
  const fetchAllRecords = async () => {
    const full = await getHrRecords(group, {});
    return [{ name: ar ? g.ar : g.en, rows: full.rows, columns: cols }];
  };
  const scope = exportScopeLabels(ar);
  const exportOptions = hasActiveFilters
    ? [
        { key: 'shown', label: scope.shown, sheets: [{ name: ar ? g.ar : g.en, rows, columns: cols }] },
        { key: 'all', label: scope.all, resolve: fetchAllRecords },
      ]
    : [{ key: 'all', label: scope.all, sheets: [{ name: ar ? g.ar : g.en, rows, columns: cols }] }];

  const toggleSort = (key: string) => {
    if (sort === key) setDir((x) => (x === 'asc' ? 'desc' : 'asc'));
    else { setSort(key); setDir('asc'); }
  };

  return (
    <div className="space-y-4 w-full pb-10" dir={isRTL ? 'rtl' : 'ltr'}>
      <MasterNav />
      <button onClick={backToOverview}
        className="inline-flex items-center gap-1.5 text-slate-500 text-sm hover:text-slate-900">
        <ArrowRight className="w-4 h-4 rtl:rotate-0 ltr:rotate-180" />
        {t('النظرة الشاملة', 'Overview')}
      </button>
      {group === 'contract' && <ContractsTabs />}

      <PageHeader icon={<Pencil className="w-5 h-5" />} title={ar ? g.ar : g.en}
        subtitle={t('اضغط أي خانة ناقصة واملأها من هنا مباشرة', 'Click any missing cell and fill it right here')}>
        <ExportMenu fileName={`hr-${group}`} lang={lang as 'ar' | 'en'} options={exportOptions} />
        {canEdit && (
          <button onClick={() => setForm({ mode: 'create', row: null })}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-[#f37121] hover:bg-[#e06010] text-white text-sm font-semibold">
            <Plus className="w-4 h-4" />{t('إضافة بيانات', 'Add data')}
          </button>
        )}
      </PageHeader>

      {/* Filter, including one carried from the overview; visible and removable. */}
      <div className="bg-white border border-slate-200 rounded-xl p-3 shadow-sm space-y-2.5">
        <HrQuickFilters optionsUrl="/api/hr/master/filters" value={filters} onChange={setFilters} ar={ar} />
        <FilterPanel
          optionsUrl="/api/hr/master/filters"
          value={filters}
          onChange={setFilters}
          dateFields={HR_DATE_FIELDS}
          numRanges={HR_NUM_RANGES}
          extraLabels={{
            employment: HR_EMPLOYMENT_LABELS,
            outsideKingdom: { ar: 'خارج المملكة', en: 'Outside kingdom', values: { 1: { ar: 'خارج المملكة', en: 'Outside kingdom' } } },
            freelancer: { ar: 'عمل حر', en: 'Freelancer', values: { 1: { ar: 'عمل حر', en: 'Freelancer' } } },
          }}
          resultCount={rows.length}
          resultLabel={t('الصفوف المعروضة', 'Rows shown')}
        />
      </div>

      {/* Status counters per field, computed on the filters except the pressed counter itself (see records on the server). A field's states always sum to `summary.population`, and pressing one does not hide its neighbors. */}
      <p className="text-[11.5px] text-slate-500 -mb-2 px-1">
        {t(`حالة كل حقل لدى ${d.summary.population ?? rows.length} موظفًا — اضغط أي رقم لعرض أصحابه`,
           `Status of every field across ${d.summary.population ?? rows.length} employees — click a number to list them`)}
      </p>
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-2.5">
        {g.fields.map((f) => {
          const s = d.summary[f.key] || {};
          return (
            <div key={f.key} className="bg-white border border-slate-200 rounded-xl px-3 py-2.5 shadow-sm">
              <p className="text-[12.5px] font-bold text-slate-800 mb-1.5">{ar ? f.ar : f.en}</p>
              <div className="flex flex-wrap gap-1">
                {STATUS_KEYS.map((k) => (s[k] > 0) && (
                  <button key={k}
                    onClick={() => {
                      const off = status === k && field === f.key;
                      setField(f.key); setStatus(off ? '' : k);
                      if (!off) setTimeout(() => tableRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 350);
                    }}
                    className={`px-1.5 py-0.5 rounded text-[10.5px] font-semibold tabular-nums ${statusMeta(k).bg} ${
                      field === f.key && status === k ? 'ring-2 ring-offset-1 ring-[#f37121]' : ''}`}>
                    {statusLabel(k, ar)} {s[k]}
                  </button>
                ))}
              </div>
              {/* Holders of the pressed number are listed beneath it; a name opens the employee file directly. */}
              {field === f.key && status && rows.length > 0 && rows.length <= 40 && (
                <div className="mt-2 pt-2 border-t border-slate-100 flex flex-wrap gap-1">
                  {rows.map((r) => (
                    <button key={r._id} onClick={() => router.push(`/system/hr/employees/${r._id}`)}
                      title={t('فتح ملف الموظف', 'Open employee file')}
                      className="px-2 py-0.5 rounded-full bg-slate-100 hover:bg-orange-100 hover:text-[#c2410c] text-[11.5px] font-semibold text-slate-700">
                      {r.employeeNumber ? `${r.employeeNumber} · ` : ''}{r.name}
                    </button>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* When arriving from a strip number, say why the table is cut: that click opens this page on those rows only, and without a note the reader thinks it is the whole group. */}
      {state === 'attention' && (
        <div className="flex items-center justify-between gap-2 rounded-xl border border-rose-200 bg-rose-50 px-4 py-2.5">
          <p className="text-[13px] font-semibold text-rose-800">
            {ar ? 'المعروض: المنتهي والقريب من الانتهاء فقط' : 'Showing expired and nearing expiry only'}
          </p>
          <button type="button" onClick={() => setState('')}
            className="text-[12px] font-medium text-rose-700 hover:text-rose-900 underline">
            {ar ? 'عرض الكل' : 'Show all'}
          </button>
        </div>
      )}

      {/* Date states if the group is a document. */}
      {g.document && d.summary.states && (
        <div className="grid grid-cols-2 md:grid-cols-6 gap-2.5">
          {(['expired', 'critical', 'warning', 'valid', 'missing', 'not_applicable'] as const).map((k) => (
            <button key={k} onClick={() => setState(state === k ? '' : k)}
              className={`text-start bg-white border rounded-xl p-3 shadow-sm ${state === k ? 'border-[#f37121] ring-1 ring-[#f37121]/30' : 'border-slate-200 hover:border-slate-300'}`}>
              <p className="text-xl font-extrabold leading-none tabular-nums" style={{ color: stateMeta(k).color }}>{d.summary.states[k]}</p>
              <p className="text-[11px] text-slate-600 mt-1.5 leading-tight font-medium">{stateLabel(k, ar)}</p>
            </button>
          ))}
        </div>
      )}

      <div ref={tableRef} className="scroll-mt-4 rounded-2xl border border-slate-200 bg-white p-3 shadow-sm flex flex-wrap items-center gap-2">
        <div className="relative">
          <Search className="w-4 h-4 text-slate-400 absolute top-1/2 -translate-y-1/2 start-2.5" />
          <input value={q} onChange={(e) => setQ(e.target.value)}
            placeholder={t('اسم / رقم وظيفي / رقم هوية…', 'name / employee no / ID…')}
            className="ps-8 pe-3 py-2 rounded-lg border border-slate-200 text-sm w-72 max-w-full" />
        </div>
        <select value={field} onChange={(e) => setField(e.target.value)} className="px-2.5 py-2 rounded-lg border border-slate-200 text-sm bg-white">
          <option value="">{t('كل الحقول', 'All fields')}</option>
          {g.fields.map((f) => <option key={f.key} value={f.key}>{ar ? f.ar : f.en}</option>)}
        </select>
        <select value={status} onChange={(e) => setStatus(e.target.value)} className="px-2.5 py-2 rounded-lg border border-slate-200 text-sm bg-white">
          <option value="">{t('كل الحالات', 'All statuses')}</option>
          {STATUS_KEYS.filter((k) => g.fields.some((f) => (d.summary[f.key]?.[k] || 0) > 0) || status === k)
            .map((k) => <option key={k} value={k}>{statusLabel(k, ar)}</option>)}
        </select>
        {g.document && (
          <div className="flex items-center gap-1.5">
            <span className="text-xs text-slate-700 font-medium whitespace-nowrap">{t('ينتهي خلال', 'Within')}</span>
            <input type="number" min={0} value={within} onChange={(e) => setWithin(e.target.value)}
              className="w-20 px-2 py-2 rounded-lg border border-slate-200 text-sm text-center" />
            {QUICK.map((n) => (
              <button key={n} onClick={() => setWithin(String(n))}
                className={`px-2 py-1.5 rounded-lg text-[11px] font-semibold border ${within === String(n) ? 'bg-[#f37121] text-white border-[#f37121]' : 'bg-white text-slate-700 border-slate-200'}`}>{n}</button>
            ))}
            <label className="inline-flex items-center gap-1.5 text-xs text-slate-700 cursor-pointer">
              <input type="checkbox" checked={includeExpired} onChange={(e) => setIncludeExpired(e.target.checked)} className="accent-[#f37121]" />
              {t('مع المنتهي', 'incl. expired')}
            </label>
          </div>
        )}
        {(q || field || status || state || within) && (
          <button onClick={() => { setQ(''); setField(''); setStatus(''); setState(''); setWithin(''); }}
            className="px-2.5 py-2 rounded-lg border border-slate-200 text-sm text-slate-700 hover:text-slate-900">
            {t('إلغاء الفلترة', 'Clear')}
          </button>
        )}
        <span className="text-[12.5px] font-semibold text-slate-700 ms-auto whitespace-nowrap">{rows.length} {t('موظف', 'people')}</span>
      </div>

      <div className="rounded-2xl border border-slate-200 bg-white shadow-sm overflow-hidden">
        <ScrollX>
          <table className="w-full text-sm">
            <thead className="bg-slate-900 text-slate-200 text-[13px]">
              <tr>
                {renewable && canEdit && (
                  <th {...pin.th(0, 'px-3 py-3 w-9')}>
                    <input type="checkbox" className="accent-[#f37121]"
                      title={t('اختيار كل المعروض', 'Select all shown')}
                      checked={rows.length > 0 && rows.every((x) => picked.has(x._id))}
                      onChange={(e) => setPicked((p) => {
                        const n = new Set(p);
                        rows.forEach((x) => (e.target.checked ? n.add(x._id) : n.delete(x._id)));
                        return n;
                      })} />
                  </th>
                )}
                {canEdit && <th {...pin.th(lead - 1, 'px-3 py-3 text-center font-bold whitespace-nowrap')}>{t('إجراءات', 'Actions')}</th>}
                <th {...pin.th(lead, 'px-3 py-3 text-center font-bold whitespace-nowrap')}>
                  <button onClick={() => toggleSort('employeeNumber')} className="inline-flex items-center gap-1 hover:text-white">
                    {t('الرقم الوظيفي', 'Emp. no.')}<ArrowUpDown className="w-3 h-3 opacity-60" />
                  </button>
                </th>
                <th {...pin.th(lead + 1, 'px-3 py-3 text-center font-bold whitespace-nowrap')}>
                  <button onClick={() => toggleSort('name')} className="inline-flex items-center gap-1 hover:text-white">
                    {t('الموظف', 'Employee')}<ArrowUpDown className="w-3 h-3 opacity-60" />
                  </button>
                </th>
                <th {...pin.th(lead + 2, 'px-3 py-3 text-center font-bold whitespace-nowrap')}>
                  <button onClick={() => toggleSort('iqamaNumber')} className="inline-flex items-center gap-1 hover:text-white">
                    {t('رقم الهوية', 'ID number')}<ArrowUpDown className="w-3 h-3 opacity-60" />
                  </button>
                </th>
                <th className="px-3 py-3 text-center font-bold whitespace-nowrap">{t('القسم', 'Department')}</th>
                {/* Why not on the job: two columns, not one. See EMPLOYMENT_META. */}
                {showWhyInactive && (
                  <>
                    <th className="px-3 py-3 text-center font-bold whitespace-nowrap">{t('حالة التوظيف', 'Employment')}</th>
                    <th className="px-3 py-3 text-center font-bold whitespace-nowrap">{t('حالة العقد', 'Contract status')}</th>
                  </>
                )}
                {/* Days remaining follows its expiry column: the date says when, the days say how long is left, which is the question the table is opened for. It sits right after its expiry column and has an explicit name since the expiry headings are similar. */}
                {g.fields.flatMap((f) => [
                  <th key={f.key} className="px-3 py-3 text-center font-bold whitespace-nowrap">
                    <button onClick={() => toggleSort(f.key)} className="inline-flex items-center gap-1 hover:text-white">
                      {ar ? f.ar : f.en}<ArrowUpDown className="w-3 h-3 opacity-60" />
                    </button>
                  </th>,
                  ...(daysAfter(f, g.fields) ? [
                    <th key={`${daysAfter(f, g.fields)}__days`} className="px-3 py-3 text-center font-bold whitespace-nowrap">
                      {daysColLabel(daysAfter(f, g.fields)!, ar)}
                    </th>,
                  ] : []),
                ])}
                {g.document && (
                  <th className="px-3 py-3 text-center font-bold whitespace-nowrap">
                    <button onClick={() => toggleSort('daysRemaining')} className="inline-flex items-center gap-1 hover:text-white">
                      {t('المتبقي', 'Left')}<ArrowUpDown className="w-3 h-3 opacity-60" />
                    </button>
                  </th>
                )}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {rows.map((r) => (
                <Row key={r._id} r={r} fields={g.fields} isDoc={g.document} ar={ar} t={t} showWhyInactive={showWhyInactive}
                  canEdit={canEdit} onSaved={load} notify={notify} router={router} choices={choices} pin={pin} lead={lead}
                  renewable={renewable} picked={picked} setPicked={setPicked} onRenew={setRenewing}
                  onEdit={(x: RecordRow) => setForm({ mode: 'edit', row: x })} onClear={setClearing} />
              ))}
              {!rows.length && (
                <tr><td colSpan={4 + (showWhyInactive ? 2 : 0) + g.fields.length + g.fields.filter((f) => isExpiryField(f.key)).length + (g.document ? 1 : 0) + (renewable && canEdit ? 1 : 0) + (canEdit ? 1 : 0)} className="px-3 py-12 text-center text-slate-500">
                  {t('لا نتائج تطابق هذه الفلاتر', 'Nothing matches these filters')}
                </td></tr>
              )}
            </tbody>
          </table>
        </ScrollX>
      </div>

      {renewable && canEdit && (
        <SelectionBar
          count={picked.size} ar={ar} tone="green"
          label={t(`${picked.size} مستند محدَّد`, `${picked.size} selected`)}
          hint={t('يُسجَّل لها جميعًا تاريخ تجديد واحد', 'All get one renewal date')}
          actionLabel={t(`تجديدها بتاريخ واحد (${picked.size})`, `Renew to one date (${picked.size})`)}
          onAction={() => setBulk(true)}
          onClear={() => setPicked(new Set())} />
      )}

      {bulk && (
        <HrBulkRenewModal
          rows={rows.filter((r) => picked.has(r._id))} group={group} groupLabel={ar ? g.ar : g.en} ar={ar}
          onClose={() => setBulk(false)}
          onDone={() => { setBulk(false); setPicked(new Set()); load(); }} />
      )}

      {renewing && (
        <HrRenewModal row={renewing} group={group} groupLabel={ar ? g.ar : g.en}
          expiryField={g.expiryField} ar={ar} t={t} notify={notify}
          onClose={() => setRenewing(null)}
          onDone={() => { setRenewing(null); load(); }} />
      )}

      <HrGroupFormModal
        open={!!form} mode={form?.mode || 'create'} group={group} groupLabel={ar ? g.ar : g.en}
        fields={g.fields.filter((f) => !f.readOnly)} row={form?.row || null} ar={ar}
        onClose={() => setForm(null)}
        onDone={() => { setForm(null); load(); }} />

      <HrGroupClearModal
        open={!!clearing} groupLabel={ar ? g.ar : g.en} fields={g.fields.filter((f) => !f.readOnly)} row={clearing} ar={ar}
        onClose={() => setClearing(null)}
        onDone={() => { setClearing(null); load(); }} />
    </div>
  );
}

// Employee row: every cell is editable in place.
function Row({ r, fields, isDoc, ar, t, canEdit, onSaved, notify, router, choices, pin, lead,
  renewable, picked, setPicked, onRenew, onEdit, onClear, showWhyInactive }: any) {
  const m = r.state ? stateMeta(r.state) : null;
  const sel = renewable && canEdit;
  const on = sel && picked.has(r._id);
  // A pinned cell carries its row's color, or it looks white in a selected row.
  const bg = on ? 'bg-orange-50' : 'bg-white group-hover:bg-slate-50';
  return (
    <tr className={on ? 'group bg-orange-50/70 text-center align-middle' : 'group hover:bg-slate-50 text-center align-middle'}>
      {sel && (
        <td {...pin.td(0, 'px-3 py-2.5', bg)}>
          <input type="checkbox" className="accent-[#f37121]"
            checked={picked.has(r._id)}
            onChange={() => setPicked((p: Set<string>) => {
              const n = new Set(p);
              if (n.has(r._id)) n.delete(r._id); else n.add(r._id);
              return n;
            })} />
        </td>
      )}
      {/* The three actions in one column. Renew stays first for documents as the most frequent; clear is last and alone, colored to show it is unlike the others. */}
      {canEdit && (
        <td {...pin.td(lead - 1, 'px-3 py-2.5', bg)}>
          <div className="inline-flex items-center gap-1">
            {sel && (
              <button onClick={() => onRenew(r)} title={t('تجديد', 'Renew')}
                className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md bg-emerald-50 hover:bg-emerald-100 text-emerald-700 text-[11px] font-semibold">
                <RefreshCw className="w-3.5 h-3.5" />{t('تجديد', 'Renew')}
              </button>
            )}
            <button onClick={() => onEdit(r)} title={t('تعديل بيانات المجموعة', 'Edit this group’s data')}
              className="p-1.5 rounded-md text-slate-600 hover:text-[#f37121] hover:bg-slate-100">
              <Pencil className="w-3.5 h-3.5" />
            </button>
            <button onClick={() => onClear(r)} title={t('تفريغ بيانات المجموعة', 'Clear this group’s data')}
              className="p-1.5 rounded-md text-slate-600 hover:text-red-600 hover:bg-red-50">
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          </div>
        </td>
      )}
      <td {...pin.td(lead, 'px-3 py-2.5 whitespace-nowrap text-slate-700 text-[13px] tabular-nums', bg)}>{r.employeeNumber || '—'}</td>
      <td {...pin.td(lead + 1, 'px-3 py-2.5', bg)}>
        <button onClick={() => router.push(`/system/hr/employees/${r._id}`)}
          className="font-semibold text-slate-900 hover:text-[#f37121] text-[13.5px] whitespace-nowrap">{r.name}</button>
      </td>
      {/* ID number is the most searched field, so it has its own column in every table. */}
      <td {...pin.td(lead + 2, 'px-3 py-2.5 whitespace-nowrap text-slate-700 text-[13px] tabular-nums', bg)}>{r.iqamaNumber || '—'}</td>
      <td className="px-3 py-2.5 text-slate-700 text-[13px] whitespace-nowrap">{r.department || '—'}</td>
      {showWhyInactive && (() => {
        const em = employmentMeta(r.employmentStatus);
        // The contract paper's text as written in the file. Most not-on-the-job rows have none, so show "not recorded" instead of a dash that reads as "no contract".
        const cs = String(r.values?.contractStatusText || '').trim();
        return (
          <>
            <td className="px-3 py-2.5 whitespace-nowrap">
              <span className={`px-2 py-0.5 rounded-full text-[11.5px] font-semibold ${em.cls}`}>{ar ? em.ar : em.en}</span>
            </td>
            <td className="px-3 py-2.5 whitespace-nowrap text-[13px]">
              {cs
                ? <span className={`font-semibold ${/انهاء|إنهاء|فسخ|غير ساري|منته/.test(cs) ? 'text-red-700' : 'text-slate-700'}`}>{cs}</span>
                : <span className="text-slate-400 text-[12px]">{t('غير مسجَّلة', 'not recorded')}</span>}
            </td>
          </>
        );
      })()}
      {fields.flatMap((f: FieldDef) => [
        <td key={f.key} className="px-3 py-2.5">
          <MasterCell id={r._id} f={f} raw={r.values[f.key]} st={r.statuses[f.key]} choices={choices}
            ar={ar} canEdit={canEdit} onSaved={onSaved} notify={notify} />
        </td>,
        // Days are computed at read time (see daysUntil). With no date it stays empty, not zero, since zero means "expires today".
        ...(daysAfter(f, fields) ? [(() => {
          const base = daysAfter(f, fields)!;
          const n = daysUntil(r.values?.[base]);
          return (
            <td key={`${base}__days`} className="px-3 py-2.5 whitespace-nowrap text-[13px] tabular-nums font-semibold"
              style={{ color: n == null ? undefined : n < 0 ? '#dc2626' : n <= 30 ? '#ea580c' : n <= 90 ? '#f59e0b' : '#16a34a' }}>
              {n == null ? <span className="text-slate-300">—</span> : n}
            </td>
          );
        })()] : []),
      ])}
      {isDoc && (
        <td className="px-3 py-2.5 whitespace-nowrap font-bold" style={{ color: m?.color }}>
          {r.daysRemaining == null ? <span className="text-slate-500">—</span> : daysText(r.daysRemaining, ar)}
        </td>
      )}
    </tr>
  );
}

// Renew one document. Renewal writes the new date and leaves a trace of who renewed and from which date to which; writing directly on the cell loses that, and it is the first thing asked in review.
function HrRenewModal({ row, group, groupLabel, expiryField, ar, t, notify, onClose, onDone }: any) {
  const cur = expiryField ? row.values?.[expiryField] : null;
  const [newExpiry, setNewExpiry] = useState('');
  const [docNum, setDocNum] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    // Default is a year from the existing expiry if in the future, else a year from today, so a long-expired document is never renewed to a past date.
    const base = cur && !isNaN(new Date(cur).getTime()) ? new Date(cur) : new Date();
    const from = base > new Date() ? base : new Date();
    const d = new Date(from);
    d.setFullYear(d.getFullYear() + 1);
    const iso = d.toISOString().slice(0, 10);
    setNewExpiry(iso);
  }, [cur]);

  const save = async () => {
    if (!newExpiry) return notify(t('أدخل تاريخ الانتهاء الجديد', 'Enter the new expiry date'), 'error');
    setBusy(true);
    try {
      await renewHrDocument({ employee: row._id, group, newExpiry, documentNumber: docNum.trim(), notes: note.trim() });
      notify(t(`تم التجديد حتى ${newExpiry}`, `Renewed to ${newExpiry}`), 'success');
      onDone();
    } catch (e: any) { notify(e?.message || 'Failed', 'error'); }
    setBusy(false);
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-md p-5" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-1">
          <h3 className="text-emerald-700 font-bold">{t('تجديد المستند', 'Renew document')}</h3>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-700"><X className="w-4 h-4" /></button>
        </div>
        <p className="text-[12px] text-slate-500 mb-4">
          {row.name} · {groupLabel}{cur ? ` · ${t('ينتهي', 'expires')} ${bothDates(cur, ar)}` : ''}
        </p>

        {/* Entered in either calendar. The renewer reads the paper in hand (a Hijri-dated residency or a Gregorian passport), so it is entered as written and converted here. Stored is always one Gregorian date (lib/hijri, utils/hijri); the other field updates live so the user can check before saving. */}
        <div className="grid mb-1">
          <DatePair label={`${t('تاريخ الانتهاء الجديد', 'New expiry')} *`} value={newExpiry} onChange={setNewExpiry} ar={ar} autoFocus />
        </div>
        <p className="text-[10.5px] text-slate-400 mb-3">
          {t('اكتب أيَّهما شئت — والآخرُ يتبعه. والمحفوظ ميلاديٌّ واحد.',
             'Type either one — the other follows. Only the Gregorian date is stored.')}
        </p>

        <label className="block text-[12px] font-semibold text-slate-600 mb-1">{t('رقم المستند الجديد', 'New document number')}</label>
        <input value={docNum} onChange={(e) => setDocNum(e.target.value)}
          placeholder={t('اتركه فارغًا إن لم يتغيّر', 'Leave blank if unchanged')}
          className="w-full px-3 py-2 rounded-lg border border-slate-200 text-sm mb-3" />

        <label className="block text-[12px] font-semibold text-slate-600 mb-1">{t('ملاحظة', 'Note')}</label>
        <input value={note} onChange={(e) => setNote(e.target.value)}
          className="w-full px-3 py-2 rounded-lg border border-slate-200 text-sm mb-4" />

        <p className="text-[11px] text-slate-400 mb-3">
          {t('يُحفَظ التجديد في سجلّ الموظف: التاريخ السابق والجديد ومَن سجّله ومتى.',
             'The renewal is kept on the employee record: previous and new date, who logged it and when.')}
        </p>
        <button onClick={save} disabled={busy || !newExpiry}
          className="w-full inline-flex items-center justify-center gap-1.5 px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white text-sm font-semibold">
          <Check className="w-4 h-4" />{busy ? t('جارٍ التجديد…', 'Renewing…') : t('تجديد', 'Renew')}
        </button>
      </div>
    </div>
  );
}

// Batch renewal with one date, all or nothing: if the server rejects a row, none is renewed and the reasons are shown with row numbers, since a half-succeeded batch is worse than a clearly failed one.
function HrBulkRenewModal({ rows, group, groupLabel, ar, onClose, onDone }: {
  rows: any[]; group: string; groupLabel: string; ar: boolean; onClose: () => void; onDone: () => void;
}) {
  const { notify } = useDialog();
  const t = (a: string, e: string) => (ar ? a : e);
  const [when, setWhen] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<string[]>([]);
  const today = new Date().toISOString().slice(0, 10);
  const past = !!when && when < today;

  const save = async () => {
    setBusy(true); setErrors([]);
    try {
      const r = await renewHrBulk({
        items: rows.map((x) => ({ employee: x._id, group })),
        newExpiry: when, notes: note.trim(),
      });
      notify(t(`جُدِّد ${r.summary.count} مستندًا لـ${r.summary.employees} موظفًا`,
               `Renewed ${r.summary.count} documents for ${r.summary.employees} employees`), 'success');
      onDone();
    } catch (e: any) {
      const list = e?.data?.errors || e?.errors;
      if (Array.isArray(list) && list.length) {
        setErrors(list.map((x: any) => t(`سطر ${x.line}: ${x.message}`, `Row ${x.line}: ${x.message}`)));
        notify(t('رُفضت العملية كاملةً — لم يُجدَّد أي مستند', 'Rejected in full — nothing was renewed'), 'error');
      } else notify(e?.message || 'Failed', 'error');
    }
    setBusy(false);
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/45 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg max-h-[90vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100">
          <h3 className="text-emerald-700 font-bold">{t('تجديد جماعي', 'Bulk renewal')}</h3>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-700"><X className="w-4 h-4" /></button>
        </div>

        <div className="p-5 space-y-3 overflow-y-auto">
          <p className="text-sm text-slate-600">
            {t(`${rows.length} مستند من «${groupLabel}» سيُجدَّد إلى التاريخ نفسه.`,
               `${rows.length} “${groupLabel}” documents will be renewed to the same date.`)}
          </p>

          <div>
            {/* Two cells as in single-document renewal; the minimum applies to both together. */}
            <div className="grid">
              <DatePair label={`${t('تاريخ الانتهاء الجديد', 'New expiry')} *`} value={when} onChange={setWhen} ar={ar} min={today} autoFocus />
            </div>
            {past && <p className="text-[11px] text-red-600 mt-1">{t('التاريخ في الماضي', 'That date is in the past')}</p>}
          </div>

          <div>
            <label className="block text-[12px] font-semibold text-slate-600 mb-1">{t('ملاحظة', 'Note')}</label>
            <input value={note} onChange={(e) => setNote(e.target.value)}
              className="w-full px-3 py-2 rounded-lg border border-slate-200 text-sm" />
          </div>

          {!!errors.length && (
            <div className="rounded-lg border border-red-200 bg-red-50 p-2.5 max-h-32 overflow-y-auto">
              {errors.map((x, i) => <p key={i} className="text-[11.5px] text-red-700">{x}</p>)}
            </div>
          )}
        </div>

        <div className="px-5 py-4 border-t border-slate-100">
          <button onClick={save} disabled={busy || !when || past}
            className="w-full inline-flex items-center justify-center gap-1.5 px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white text-sm font-semibold">
            <Check className="w-4 h-4" />
            {busy ? t('جارٍ التجديد…', 'Renewing…') : !when ? t('اختر التاريخ أولًا', 'Pick a date first')
              : t(`تجديد ${rows.length} مستند`, `Renew ${rows.length} documents`)}
          </button>
        </div>
      </div>
    </div>
  );
}

export default function Page() {
  return <Suspense fallback={<Spinner />}><GroupInner /></Suspense>;
}
