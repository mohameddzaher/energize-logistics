'use client';
import { useState, useEffect, useCallback, useMemo } from 'react';
import { useLatestRequest } from '@/hooks/useLatestRequest';
import HrQuickFilters from '@/components/hr/HrQuickFilters';
import FilterPanel, { countActive, type FilterValues } from '@/components/system/FilterPanel';
import { ColumnFilter } from '@/components/ColumnFilter';
import { HR_DATE_FIELDS, HR_NUM_RANGES } from '@/lib/hrMaster';
import { syncUrl } from '@/lib/urlSync';
import { useDialog } from '@/components/system/DialogProvider';
import { useRouter, useSearchParams } from 'next/navigation';
import { useAuth } from '@/context/AuthContext';
import { useLanguage } from '@/context/LanguageContext';
import { useSocket } from '@/hooks/useSocket';
import api from '@/lib/api';
import { usePinnedColumns } from '@/components/hr/usePinnedColumns';
import { Users, Plus, Edit, UserMinus, RotateCcw, Trash2, UserPlus } from 'lucide-react';
import {
  isHRStaff, Employee, EMPLOYMENT_STATUS, employmentBadge, empName,
} from '@/lib/hr';
import {
  Spinner, PageHeader, SearchInput, PrimaryButton, Badge, Select,
} from '@/components/hr/HRKit';
import ExportMenu, { exportScopeLabels, type ExportColumn } from '@/components/ls2/ExportMenu';
import { exportDatePair } from '@/lib/hrDates';
import { EmployeeFormModal } from '@/components/hr/EmployeeFormModal';
import { getHrEmployeesTranslations } from '@/lib/translations';
import ScrollX from '@/components/system/ScrollX';
import B2cOpBadge from '@/components/b2c/B2cOpBadge';
import { rightsRoleOf } from '@/lib/roles';

export default function HREmployeesPage() {
  const { confirm, notify } = useDialog();
  const { user } = useAuth();
  const { lang, isRTL } = useLanguage();
  const ar = lang === 'ar';
  const tx = getHrEmployeesTranslations(lang);
  const router = useRouter();
  // Actions, employee number, name and ID stay pinned to the right.
  const pin = usePinnedColumns(4);
  const searchParams = useSearchParams();
  const staff = isHRStaff(user);

  const [employees, setEmployees] = useState<Employee[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  // Search is server-side, so the raw box value is debounced — otherwise every
  // keystroke fires a request and a slow early one can land after a later one.
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState(searchParams?.get('status') || '');
  // Remaining filters. The list endpoint already honors all master filters, so the page exposes the same panel and option source as the master screen instead of a second definition.
  const [filters, setFilters] = useState<FilterValues>(() =>
    Object.fromEntries([...(searchParams?.entries() || [])].filter(([k]) => k !== 'q' && k !== 'status')));
  // Quick toggle for employees added by the individuals section from the light-transport register; HR completes their files.
  const [fromB2c, setFromB2c] = useState(0);
  const b2cOnly = filters.createdVia === 'b2c';
  const toggleB2c = () => setFilters((p) => { const n = { ...p }; if (n.createdVia === 'b2c') delete n.createdVia; else n.createdVia = 'b2c'; return n; });
  const [showModal, setShowModal] = useState(false);
  const [editing, setEditing] = useState<Employee | null>(null);
  /** Excel-style column funnel. The page filter narrows the server set; this narrows what is shown by a value in one column, computed on what passed the page filter. */
  const [colFilters, setColFilters] = useState<Record<string, Set<string>>>({});
  const setCol = (k: string, v: Set<string>) => setColFilters((p) => {
    const n = { ...p };
    if (v.size) n[k] = v; else delete n[k];
    return n;
  });

  // Ignore stale responses: the full-list call starts first and is slowest, so it could land after a search result and overwrite it. See hooks/useLatestRequest.
  const guard = useLatestRequest();
  const load = useCallback(async () => {
    const mine = guard.begin();
    try {
      const qs = new URLSearchParams();
      if (debouncedSearch.trim()) qs.set('q', debouncedSearch.trim());
      if (statusFilter) qs.set('status', statusFilter);
      for (const [k, v] of Object.entries(filters)) if (v !== '' && v != null) qs.set(k, String(v));
      const d = await api.get<{ employees: Employee[]; fromB2c?: number }>(`/api/hr/employees?${qs}`);
      if (!guard.isCurrent(mine)) return;
      setEmployees(d.employees || []);
      setFromB2c(d.fromB2c || 0);
    } catch {}
    if (guard.isCurrent(mine)) setLoading(false);
  }, [debouncedSearch, statusFilter, JSON.stringify(filters), guard]);

  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search), 300);
    return () => clearTimeout(t);
  }, [search]);

  // Selections live in the URL so back/forward work and a refresh or shared link keeps them.
  useEffect(() => {
    const p = new URLSearchParams();
    if (search.trim()) p.set('q', search.trim());
    if (statusFilter) p.set('status', statusFilter);
    for (const [k, v] of Object.entries(filters)) if (v !== '' && v != null) p.set(k, String(v));
    syncUrl('/system/hr/employees', p);
  }, [search, statusFilter, JSON.stringify(filters)]);

  useEffect(() => { load(); }, [load]);
  // Re-fetch on `hr:master`: master screens write the same fields and broadcast it, otherwise two open screens show different numbers.
  useSocket('hr:employee', useCallback(() => load(), [load]));
  useSocket('hr:master', useCallback(() => load(), [load]));

  const openCreate = () => { setEditing(null); setShowModal(true); };
  const openEdit = (e: Employee) => { setEditing(e); setShowModal(true); };

  /** No delete button in the employee register. Staff who leave are ended, not erased, since their file is needed later; the server also blocks deletion (see `deleteEmployee`). Ending service is done from the employee file, guarded by custody and authorization checks. */
  const openFileToEndService = (e: Employee) => {
    router.push(`/system/hr/employees/${e._id}`);
  };

  /** Permanent delete is for the system admin only, for records entered by mistake or duplicated. The full record is saved to the audit log first, and holders of custody or a vehicle authorization are rejected with a reason. */
  const removeForGood = async (e: Employee) => {
    if (!(await confirm({
      title: ar ? `حذف سجلّ «${empName(e, lang)}» نهائيًّا؟` : `Permanently delete “${empName(e, lang)}”?`,
      message: ar
        ? 'يُحذَف السجلُّ ومستنداتُه وتجديداتُه ولا يظهر في أيّ قائمة. لمن ترك العمل استعمل «إنهاء الخدمة» — الحذفُ لسجلٍّ أُدخل خطأً أو مكرَّرًا. تُحفَظ نسخةٌ منه في سجلّ المراجعة.'
        : 'The record, its documents and renewals are removed. For someone who left, use “End service” — delete is for a record entered by mistake or duplicated. A copy is kept in the audit log.',
      confirmLabel: ar ? 'حذف نهائيّ' : 'Delete permanently', tone: 'danger',
    }))) return;
    try {
      await api.delete(`/api/hr/employees/${e._id}`);
      notify(ar ? 'حُذف السجلّ' : 'Record deleted', 'success');
      load();
    } catch (err: any) { notify(err?.message || (ar ? 'تعذّر الحذف' : 'Delete failed'), 'error'); }
  };

  const exportColumns: ExportColumn[] = [
    { header: tx.colName, key: 'firstName', transform: (_: any, r: any) => empName(r), width: 22 },
    { header: tx.colArabicName, key: 'arabicName', width: 22 },
    { header: tx.colEmpNumber, key: 'employeeNumber', width: 12 },
    { header: tx.colJobTitle, key: 'jobTitle', width: 18 },
    { header: tx.colIdType, key: 'idType', width: 12 },
    { header: tx.colIqama, key: 'iqamaNumber', width: 16 },
    // Each date is two adjacent columns: Gregorian, then its derived Hijri (lib/hrDates).
    ...exportDatePair(tx.colIqamaExpiry, 'iqamaExpiry', ar),
    { header: tx.colNationalId, key: 'nationalId', width: 16 },
    { header: tx.colNationality, key: 'nationality', width: 14 },
    { header: tx.colPhone, key: 'phone', width: 16 },
    { header: tx.colStatus, key: 'employmentStatus', width: 12 },
    ...exportDatePair(tx.colHireDate, 'hireDate', ar),
  ];
  // Search and status filter run on the server, so memory holds only their results. "All" re-fetches without parameters and is hidden when no filter is active, since shown equals all.
  const hasActiveFilters = !!(debouncedSearch.trim() || statusFilter || countActive(filters));
  /** Filters that can hide a valid search result; named for the reader, not counted. */
  const blockers = [
    statusFilter
      ? `${ar ? 'الحالة' : 'status'}: ${ar ? EMPLOYMENT_STATUS[statusFilter]?.ar : EMPLOYMENT_STATUS[statusFilter]?.en}`
      : '',
    countActive(filters) ? `${countActive(filters)} ${ar ? 'فلتر متقدّم' : 'advanced filter(s)'}` : '',
  ].filter(Boolean);
  const clearAllFilters = () => { setStatusFilter(''); setFilters({}); };
  const fetchAllEmployees = async () => {
    const d = await api.get<{ employees: Employee[] }>('/api/hr/employees');
    return [{ name: 'Employees', rows: d.employees || [], columns: exportColumns }];
  };
  // One displayed value per column, shared by rendering, the funnel and export, so filtering matches what is shown.
  const colValue: Record<string, (e: Employee) => string> = {
    employeeNumber: (e) => String(e.employeeNumber || ''),
    name: (e) => empName(e, lang),
    iqamaId: (e) => String((e as any).iqamaNumber || (e as any).nationalId || ''),
    jobTitle: (e) => String((e as any).jobTitle || ''),
    nationality: (e) => String((e as any).nationality || ''),
    // Status text is read from the same map that draws the row badge, so filtering matches the displayed word.
    status: (e) => {
      const m = (EMPLOYMENT_STATUS as any)[(e as any).employmentStatus || 'active'];
      return m ? (ar ? m.ar : m.en) : String((e as any).employmentStatus || '');
    },
  };

  // Rows actually shown: the server result after the page filter, narrowed by the column funnels.
  const shown = useMemo(() => {
    const keys = Object.keys(colFilters);
    if (!keys.length) return employees;
    return employees.filter((e) => keys.every((k) => colFilters[k].has(colValue[k]?.(e) ?? '')));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [employees, JSON.stringify(Object.fromEntries(Object.entries(colFilters).map(([k, v]) => [k, [...v]])))]);

  const scope = exportScopeLabels(ar);
  const exportOptions = hasActiveFilters
    ? [
        { key: 'shown', label: scope.shown, sheets: [{ name: 'Employees', rows: employees, columns: exportColumns }] },
        { key: 'all', label: scope.all, resolve: fetchAllEmployees },
      ]
    : [{ key: 'all', label: scope.all, sheets: [{ name: 'Employees', rows: employees, columns: exportColumns }] }];

  if (!staff) return <div className="text-slate-500 p-8">{tx.notAuthorized}</div>;
  if (loading) return <Spinner />;

  return (
    <div className="space-y-6" dir={isRTL ? 'rtl' : 'ltr'}>
      <PageHeader icon={<Users className="w-5 h-5" />} title={tx.pageTitle} subtitle={`${employees.length} ${tx.employeesUnit}`}>
        {(fromB2c > 0 || b2cOnly) && (
          <button type="button" onClick={toggleB2c}
            title={ar ? 'موظفون أضافهم قسم الأفراد من سجلّ النقل الخفيف — أكمِل بياناتهم' : 'Employees added by the B2C section — complete their files'}
            className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm font-bold transition-colors ${b2cOnly ? 'bg-[#12325c] text-white' : 'bg-amber-100 text-amber-800 hover:bg-amber-200'}`}>
            <UserPlus className="w-4 h-4" />
            {ar ? 'موظفون جدد من قسم الأفراد (B2C)' : 'New from B2C'}
            <span className={`rounded-full px-1.5 py-0.5 text-[11px] tabular-nums ${b2cOnly ? 'bg-white/20' : 'bg-amber-600 text-white'}`}>{fromB2c}</span>
          </button>
        )}
        <ExportMenu fileName="employees" lang={ar ? 'ar' : 'en'} variant="subtle" label={tx.exportExcel} options={exportOptions} />
        <PrimaryButton onClick={openCreate}><Plus className="w-4 h-4" /> {tx.addEmployee}</PrimaryButton>
      </PageHeader>

      {/* HRKit's Select is `w-full`, so as a bare flex child it claims the whole
          row and squeezes the search box. Every filter gets a fixed, shrink-0
          box and the search keeps the rest. */}
      <div className="bg-white border border-slate-200 rounded-xl p-3 shadow-sm flex flex-col sm:flex-row gap-3 sm:items-center">
        <div className="flex-1 min-w-[240px]"><SearchInput value={search} onChange={setSearch} placeholder={tx.searchPlaceholder} /></div>
        <div className="w-full sm:w-48 shrink-0">
          <Select aria-label={ar ? 'فلترة الحالة' : 'Filter by status'} value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
            <option value="">{tx.allStatuses}</option>
            {Object.entries(EMPLOYMENT_STATUS).map(([k, v]) => <option key={k} value={k}>{ar ? v.ar : v.en}</option>)}
          </Select>
        </div>
        <div className="shrink-0">
          <FilterPanel
            optionsUrl="/api/hr/master/filters"
            // The screen shows all records, so option counts use the same scope; otherwise the panel and the table disagree.
            optionsParams={{ scope: 'all' }}
            value={filters}
            onChange={setFilters}
            dateFields={HR_DATE_FIELDS}
            numRanges={HR_NUM_RANGES}
            resultCount={employees.length}
            resultLabel={ar ? 'الموظفون المطابقون' : 'Matching employees'}
          />
        </div>
      </div>

      {/* Department, city, work status, project, nationality: the same filter the panel and the table read. */}
      <div className="rounded-xl border border-slate-200 bg-white p-3 shadow-sm">
        <HrQuickFilters optionsUrl="/api/hr/master/filters" optionsParams={{ scope: 'all' }} value={filters} onChange={setFilters} ar={ar} />
      </div>

      <ScrollX className="bg-white border border-slate-200 rounded-xl shadow-sm">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-slate-900 border-b border-slate-200 text-slate-300">
              <th {...pin.th(0, 'text-start font-semibold px-4 py-3 whitespace-nowrap')}>{tx.thActions}</th>
              {([
                [1, 'employeeNumber', tx.thEmpNumber],
                [2, 'name', tx.thName],
                [3, 'iqamaId', tx.thIqamaId],
                [null, 'jobTitle', tx.thJobTitle],
                [null, 'nationality', tx.thNationality],
                [null, 'status', tx.thStatus],
              ] as [number | null, string, string][]).map(([pinIdx, key, label]) => {
                const cls = 'text-start font-semibold px-4 py-3 whitespace-nowrap';
                const inner = (
                  <span className="inline-flex items-center gap-1">
                    {label}
                    <ColumnFilter rows={employees} field={key} valueOf={colValue[key]}
                      selected={colFilters[key] || new Set()} onChange={(v) => setCol(key, v)} lang={ar ? 'ar' : 'en'} />
                  </span>
                );
                return pinIdx == null
                  ? <th key={key} className={cls}>{inner}</th>
                  : <th key={key} {...pin.th(pinIdx, cls)}>{inner}</th>;
              })}
            </tr>
          </thead>
          <tbody>
            {shown.length === 0 ? (
              /* Empty-state explanation: the filter persists in the URL and search applies inside it, so searching an ended employee under an active-status filter returned nothing. The empty screen names what hides results and clears it in one click. */
              <tr><td colSpan={7} className="text-center py-12">
                <p className="text-slate-800 font-semibold">{tx.noEmployees}</p>
                {blockers.length > 0 && (
                  <div className="mt-2 space-y-2">
                    <p className="text-[12.5px] text-slate-500">
                      {ar ? 'فيه فلاتر شغّالة والبحث بيتم جوّاها: ' : 'Filters are active and the search runs inside them: '}
                      <span className="font-semibold text-slate-700">{blockers.join(' · ')}</span>
                    </p>
                    <button type="button" onClick={clearAllFilters}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#f37121] text-white text-[12.5px] font-bold hover:bg-[#e06010]">
                      <RotateCcw className="w-3.5 h-3.5" />
                      {ar ? 'ابحث في كل الموظفين' : 'Search all employees'}
                    </button>
                  </div>
                )}
              </td></tr>
            ) : shown.map((e) => (
              <tr key={e._id} className="group border-b border-slate-200/70 hover:bg-slate-100 transition-colors cursor-pointer" onClick={() => router.push(`/system/hr/employees/${e._id}`)}>
                <td {...pin.td(0, 'px-4 py-3', 'bg-white group-hover:bg-slate-100')} onClick={(ev) => ev.stopPropagation()}>
                  <div className="flex items-center gap-1">
                    <button type="button" onClick={() => openEdit(e)} className="p-1.5 rounded-lg text-slate-700 hover:text-[#f37121] hover:bg-slate-100" title={tx.edit}><Edit className="w-4 h-4" /></button>
                    {(['super_admin', 'admin', 'it_manager', 'it_team_leader', 'it_specialist'].includes(user?.role || '') || rightsRoleOf(user?.role) === 'hr_manager') && e.employmentStatus !== 'terminated' && (
                      <button type="button" onClick={() => openFileToEndService(e)}
                        className="p-1.5 rounded-lg text-slate-700 hover:text-amber-600 hover:bg-slate-100"
                        title={ar ? 'إنهاء الخدمة — من ملفّ الموظّف' : 'End service — in the employee file'}>
                        <UserMinus className="w-4 h-4" />
                      </button>
                    )}
                    {/* Delete is for the system admin only; the server enforces it separately from section grants. */}
                    {['super_admin', 'admin', 'it_manager', 'it_team_leader', 'it_specialist'].includes(user?.role || '') && (
                      <button type="button" onClick={() => removeForGood(e)}
                        className="p-1.5 rounded-lg text-slate-400 hover:text-red-600 hover:bg-red-50"
                        title={ar ? 'حذف السجلّ نهائيًّا (مدير النظام)' : 'Delete the record permanently (system admin)'}>
                        <Trash2 className="w-4 h-4" />
                      </button>
                    )}
                  </div>
                </td>
                <td {...pin.td(1, 'px-4 py-3 text-slate-700 whitespace-nowrap', 'bg-white group-hover:bg-slate-100')}>{e.employeeNumber || '—'}</td>
                {/* Single line; the email under the name made rows taller for no reason. */}
                {/* Cap the name column width and truncate: long Arabic names stretched it to half the screen. The full name stays in the tooltip and in export. */}
                <td {...pin.td(2, 'px-4 py-3 text-slate-900 font-semibold', 'bg-white group-hover:bg-slate-100')}>
                  <span className="block max-w-[15rem] truncate" title={empName(e, lang)}>{empName(e, lang)}</span>
                  {/* Current status is maintained in the individuals section (leave, suspended, accident). */}
                  <B2cOpBadge status={(e as any).b2cOpStatus} ar={lang === 'ar'} />
                </td>
                <td {...pin.td(3, 'px-4 py-3 text-slate-700 whitespace-nowrap', 'bg-white group-hover:bg-slate-100')}>{e.idType === 'national_id' ? (e.nationalId || '—') : (e.iqamaNumber || '—')}</td>
                <td className="px-4 py-3 text-slate-700">{e.jobTitle || '—'}</td>
                <td className="px-4 py-3 text-slate-700">{e.nationality || '—'}</td>
                <td className="px-4 py-3 whitespace-nowrap">
                  {(e as any).workStatusText === 'شركة شقيقة'
                    ? <Badge style={{ bg: 'bg-teal-500/20', text: 'text-teal-700', ar: 'شركة شقيقة', en: 'Sister company' }} lang={lang} />
                    : <Badge style={employmentBadge(e)} lang={lang} />}
                  {/* The three not-working states: awaiting sponsorship transfer, sister company, final exit. */}
                  {e.employmentStatus === 'terminated' && (e as any).workStatusText && String((e as any).workStatusText).includes('—') && (
                    <span className="block text-[10.5px] text-red-600 mt-0.5">{String((e as any).workStatusText).split('—')[1].trim()}</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </ScrollX>

      <EmployeeFormModal open={showModal} employee={editing} onClose={() => setShowModal(false)} onSaved={() => load()} />
    </div>
  );
}
