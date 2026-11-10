'use client';
import { useState, useEffect, useCallback, useMemo } from 'react';
import { useDialog } from '@/components/system/DialogProvider';
import { useAuth } from '@/context/AuthContext';
import { useLanguage } from '@/context/LanguageContext';
import { useSocket } from '@/hooks/useSocket';
import { useLatestRequest } from '@/hooks/useLatestRequest';
import api from '@/lib/api';
import { usePinnedColumns } from '@/components/hr/usePinnedColumns';
import { FileText, Plus, Edit, Ban, Check, Trash2, RefreshCw } from 'lucide-react';
import { isHRStaff, Contract, Employee, CONTRACT_STATUS, contractBadge, empName, today } from '@/lib/hr';
import { Spinner, PageHeader, SearchInput, PrimaryButton, Badge, Modal, Field, TextInput, Select, SearchableSelect, TextArea, Loader2 } from '@/components/hr/HRKit';
import ExportMenu, { exportScopeLabels, type ExportColumn } from '@/components/ls2/ExportMenu';
import { getHrContractsTranslations } from '@/lib/translations';
import ContractsTabs from '@/components/hr/ContractsTabs';
import FilterPanel, { type FilterValues } from '@/components/system/FilterPanel';
import { localFilterFields, applyLocalFilters, type LocalFieldDef } from '@/lib/localFilters';
import ScrollX from '@/components/system/ScrollX';
import { useColumnFilters } from '@/hooks/useColumnFilters';
import DatePair from '@/components/hr/DatePair';
import { gregCell, hijriCell, hijriDay, pairLabels, exportDatePair } from '@/lib/hrDates';

const EMPTY = { employee: '', type: 'fixed', startDate: '', endDate: '', durationMonths: 12, annualLeaveDays: 21, jobTitle: '', basicSalary: 0, allowances: 0, probationMonths: 3, notes: '',
  iqamaNumber: '', contractProfession: '', sponsorRegistration: '', contractNumber: '' };

const BG = 'bg-white group-hover:bg-slate-100';

export default function ContractsPage() {
  const { notify, prompt, confirm } = useDialog();
  const { user } = useAuth();
  const { lang, isRTL } = useLanguage();
  const ar = lang === 'ar';
  const tx = getHrContractsTranslations(lang);
  const staff = isHRStaff(user);

  // Actions, employee number, name, ID: pinned on the right.
  const pin = usePinnedColumns(4);
  const [contracts, setContracts] = useState<Contract[]>([]);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [filters, setFilters] = useState<FilterValues>({});
  const [showModal, setShowModal] = useState(false);
  const [editing, setEditing] = useState<Contract | null>(null);
  const [form, setForm] = useState<any>(EMPTY);
  const [saving, setSaving] = useState(false);

  // The whole register is loaded, and contract status is a filter like any other. Only status used to be sent to the server while the other filters were computed from loaded rows, so choosing 'active' left only active contracts in memory: panel options and counts were computed on part of the register, contract status had a single value, and the title said 265 contracts for a register of three hundred. So the whole register is loaded once (the server caps it at 2000) and all options are computed over it.
  const guard = useLatestRequest();
  const load = useCallback(async () => {
    const mine = guard.begin();
    try {
      const d = await api.get<{ contracts: Contract[] }>('/api/hr/contracts');
      // Two consecutive socket updates: the older may arrive last and revert the table to its state before the second edit.
      if (!guard.isCurrent(mine)) return;
      setContracts(d.contracts || []);
    } catch {}
    if (guard.isCurrent(mine)) setLoading(false);
  }, [guard]);

  useEffect(() => { load(); }, [load]);
  // Master edits reach here. Master screens write the same fields this screen shows and broadcast `hr:master`. Without this line the screen keeps its numbers until someone refreshes it, and two open screens show different values for the same thing.
  useSocket('hr:contract', useCallback(() => load(), [load]));
  useSocket('hr:master', useCallback(() => load(), [load]));
  useEffect(() => { api.get<{ employees: Employee[] }>('/api/hr/employees').then((d) => setEmployees(d.employees || [])).catch(() => {}); }, []);

  const set = (k: string, v: any) => setForm((f: any) => ({ ...f, [k]: v }));
  const openCreate = () => { setEditing(null); setForm({ ...EMPTY, startDate: today() }); setShowModal(true); };
  const openEdit = (c: Contract) => {
    setEditing(c);
    setForm({ ...EMPTY, ...c, employee: typeof c.employee === 'object' ? c.employee?._id : c.employee });
    setShowModal(true);
  };

  const save = async () => {
    if (!form.employee || !form.startDate) return;
    setSaving(true);
    try {
      if (editing) await api.put(`/api/hr/contracts/${editing._id}`, form);
      else await api.post('/api/hr/contracts', form);
      setShowModal(false); load();
    } catch (e: any) { notify(e.message, 'error'); }
    setSaving(false);
  };

  // Renewal dialog
  const [renewing, setRenewing] = useState<Contract | null>(null);
  const [renewForm, setRenewForm] = useState({ startDate: '', endDate: '', annualLeaveDays: '', carryOver: true, contractProfession: '', contractNumber: '' });
  const [renewSaving, setRenewSaving] = useState(false);
  useEffect(() => {
    if (!renewing) return;
    // The new contract starts the day after the current one ends; this is what was typed by hand every time.
    const next = renewing.endDate
      ? new Date(new Date(renewing.endDate).getTime() + 86400000).toISOString().slice(0, 10)
      : '';
    const after = next ? new Date(new Date(next).getTime() + 364 * 86400000).toISOString().slice(0, 10) : '';
    setRenewForm({
      startDate: next, endDate: after,
      annualLeaveDays: String(renewing.annualLeaveDays ?? ''), carryOver: true,
      // Prefilled from the current contract: renewal keeps what exists except what is deliberately changed, so someone who does not touch a field finds it as it was, and one who changes it writes it once here.
      contractProfession: renewing.contractProfession || '',
      contractNumber: renewing.contractNumber || '',
    });
  }, [renewing]);

  const doRenew = async () => {
    if (!renewing) return;
    setRenewSaving(true);
    try {
      const r = await api.post<{ message?: string }>(`/api/hr/contracts/${renewing._id}/renew`, {
        startDate: renewForm.startDate,
        endDate: renewForm.endDate,
        annualLeaveDays: renewForm.annualLeaveDays ? Number(renewForm.annualLeaveDays) : undefined,
        carryOver: renewForm.carryOver,
        contractProfession: renewForm.contractProfession,
        contractNumber: renewForm.contractNumber,
      });
      notify(r?.message || (ar ? 'جُدِّد العقد' : 'Contract renewed'), 'success');
      setRenewing(null);
      load();
    } catch (e: any) { notify(e.message, 'error'); }
    setRenewSaving(false);
  };

  /**
   * Terminating a contract ends service, so the not-working status is asked.
   * Options: awaiting sponsorship transfer, sister company, final exit. Someone already outside the system or a freelancer is archived immediately and is not asked (the server enforces this too).
   */
  const [ending, setEnding] = useState<Contract | null>(null);
  const [endKind, setEndKind] = useState('');
  const [endReason, setEndReason] = useState('');
  const [endSaving, setEndSaving] = useState(false);
  const terminate = async (c: Contract) => { setEnding(c); setEndKind(''); setEndReason(''); };
  const confirmEnd = async () => {
    if (!ending) return;
    setEndSaving(true);
    try {
      await api.post(`/api/hr/contracts/${ending._id}/terminate`, { reason: endReason.trim(), kind: endKind || undefined });
      setEnding(null);
      load();
    } catch (e: any) {
      // The backend blocks termination while custody is outstanding — or asks for the status.
      notify(e.message, 'error');
    }
    setEndSaving(false);
  };

  /**
   * Delete a contract, not terminate it.
   * Termination is an event in the employee's history and stays recorded; deletion is for a contract entered by mistake (wrong employee or a duplicate row), which has no reason to stay as ended in his record.
   */
  const remove = async (c: Contract) => {
    if (!(await confirm(ar
      ? `حذف عقد «${empName(c.employee)}» نهائيًّا؟ إن كان العقد قد انتهى فعلًا فالأصحّ إنهاؤه لا حذفه.`
      : `Permanently delete the contract for “${empName(c.employee)}”? If it actually ended, terminate it instead.`))) return;
    try { await api.delete(`/api/hr/contracts/${c._id}`); load(); }
    catch (e: any) { notify(e.message, 'error'); }
  };

  // Contract filters. Computed from the loaded rows: the page is loaded whole and filtered locally, so a server call to count what it already holds risks the count differing from the table.
  // One reader per column: what is drawn in the cell is what is filtered by in the panel and the column funnel and what is exported. The panel used to read `annualLeaveDays` as a number while the table showed the not-required text from `annualLeaveText`, so choosing 0 showed a row saying not required. Department was read from a column the server does not fetch (see listContracts), so it came out all empty.
  const read = useMemo(() => {
    const emp = (c: Contract) => (typeof c.employee === 'object' && c.employee ? c.employee : null) as any;
    const year = (v?: string) => { const d = v ? new Date(v) : null; return d && !isNaN(d.getTime()) ? String(d.getFullYear()) : ''; };
    return {
      employeeNumber: (c: Contract) => emp(c)?.employeeNumber || '',
      employee: (c: Contract) => empName(c.employee, lang) || c.employeeNameAr || '',
      idNumber: (c: Contract) => c.iqamaNumber || emp(c)?.iqamaNumber || emp(c)?.nationalId || '',
      department: (c: Contract) => emp(c)?.department || '',
      branch: (c: Contract) => emp(c)?.branchName || '',
      project: (c: Contract) => emp(c)?.project || '',
      contractNumber: (c: Contract) => c.contractNumber || '',
      profession: (c: Contract) => c.contractProfession || c.jobTitle || '',
      type: (c: Contract) => (c.type === 'unlimited' ? tx.typeUnlimited : tx.typeFixed),
      startDate: (c: Contract) => gregCell(c.startDate),
      endDate: (c: Contract) => (c.endDate ? gregCell(c.endDate) : ''),
      // The Hijri twin is derived from the same date: drawn, filtered and exported with the same reader.
      startDateHijri: (c: Contract) => hijriDay(c.startDate),
      endDateHijri: (c: Contract) => hijriDay(c.endDate),
      startYear: (c: Contract) => year(c.startDate),
      endYear: (c: Contract) => year(c.endDate),
      annualLeave: (c: Contract) => c.annualLeaveText || `${c.annualLeaveDays} ${tx.daysShort}`,
      probation: (c: Contract) => c.probationText || (c.probationMonths ? `${c.probationMonths} ${ar ? 'شهر' : 'mo'}` : ''),
      cr: (c: Contract) => c.sponsorRegistration || '',
      status: (c: Contract) => { const m = contractBadge(c); return m ? (ar ? m.ar : m.en) : String(c.status || ''); },
    };
  }, [ar, lang, tx.typeUnlimited, tx.typeFixed, tx.daysShort]);

  // Every displayed column has a filter. Columns whose value is unique per contract (employee number, name, ID, contract number, a full date) are filtered from the header funnel and search, since a list of three hundred entries each with a count of 1 is not a usable choice. The two dates use their year, which is how they are asked: contracts ending in 2027.
  const FILTER_DEFS: LocalFieldDef<Contract>[] = useMemo(() => [
    { key: 'status', ar: 'حالة العقد', en: 'Status', groupAr: 'العقد', groupEn: 'Contract', get: read.status },
    { key: 'type', ar: 'نوع العقد', en: 'Type', groupAr: 'العقد', groupEn: 'Contract', get: read.type },
    { key: 'contractProfession', ar: 'المهنة في العقد', en: 'Profession', groupAr: 'العقد', groupEn: 'Contract', get: read.profession },
    { key: 'startYear', ar: 'سنة بداية العقد', en: 'Start year', groupAr: 'العقد', groupEn: 'Contract', get: read.startYear },
    { key: 'endYear', ar: 'سنة نهاية العقد', en: 'End year', groupAr: 'العقد', groupEn: 'Contract', get: read.endYear },
    { key: 'annualLeave', ar: 'الإجازة السنوية', en: 'Annual leave', groupAr: 'العقد', groupEn: 'Contract', get: read.annualLeave },
    { key: 'probation', ar: 'فترة التجربة', en: 'Probation', groupAr: 'العقد', groupEn: 'Contract', get: read.probation },
    { key: 'sponsorRegistration', ar: 'السجل التجاري', en: 'CR', groupAr: 'الجهة', groupEn: 'Sponsor', get: read.cr },
    { key: 'department', ar: 'القسم', en: 'Department', groupAr: 'الموظف', groupEn: 'Employee', get: read.department },
    { key: 'branch', ar: 'الفرع', en: 'Branch', groupAr: 'الموظف', groupEn: 'Employee', get: read.branch },
    { key: 'project', ar: 'وحدة العمل', en: 'Business unit', groupAr: 'الموظف', groupEn: 'Employee', get: read.project },
  ], [read]);

  // Status in the bar is a local filter like the others, and is excluded from computing its own panel values, as every panel is excluded from its own filter.
  const byStatus = useMemo(
    () => (statusFilter ? contracts.filter((c) => c.status === statusFilter) : contracts), [contracts, statusFilter]);

  const filterFields = useMemo(
    () => localFilterFields(byStatus, FILTER_DEFS, filters), [byStatus, FILTER_DEFS, filters]);

  const filtered = applyLocalFilters(byStatus, FILTER_DEFS, filters).filter((c) => {
    if (!search.trim()) return true;
    const n = empName(c.employee).toLowerCase();
    const emp = typeof c.employee === 'object' ? c.employee : null;
    // Search covers what is now displayed: ID as in the contract, profession and register; otherwise there would be columns that are read but not searchable.
    return n.includes(search.toLowerCase())
      || (emp?.iqamaNumber || '').includes(search)
      || (emp?.employeeNumber || '').includes(search)
      || (c.iqamaNumber || '').includes(search)
      || (c.sponsorRegistration || '').includes(search)
      || (c.employeeNameAr || '').toLowerCase().includes(search.toLowerCase())
      || (c.contractNumber || '').includes(search)
      || (c.contractProfession || '').toLowerCase().includes(search.toLowerCase());
  });

  // A start-date Gregorian label is never read: the primary name is the start date.
  const START_LABEL = ar ? 'تاريخ البداية' : 'Start date';
  const END_LABEL = ar ? 'تاريخ النهاية' : 'End date';
  const startLabels = pairLabels(START_LABEL, ar);
  const endLabels = pairLabels(END_LABEL, ar);

  const exportColumns: ExportColumn[] = [
    { header: tx.colEmployee, key: 'employee', transform: (v: any) => empName(v), width: 22 },
    { header: ar ? 'الهوية' : 'ID number', key: 'iqamaNumber', width: 16, transform: (_v: any, r: any) => read.idNumber(r) || '—' },
    { header: ar ? 'القسم' : 'Department', key: 'employee', width: 18, transform: (_v: any, r: any) => read.department(r) || '—' },
    { header: ar ? 'رقم العقد' : 'Contract no.', key: 'contractNumber', width: 16, transform: (v: any) => v || '—' },
    { header: ar ? 'المهنة في العقد' : 'Contract profession', key: 'contractProfession', width: 22, transform: (v: any) => v || '—' },
    { header: tx.colType, key: 'type', width: 12 },
    // Each date is two adjacent columns: Gregorian, then its Hijri (see lib/hrDates).
    ...exportDatePair(START_LABEL, 'startDate', ar),
    ...exportDatePair(END_LABEL, 'endDate', ar),
    { header: tx.colAnnualLeave, key: 'annualLeaveDays', width: 14, transform: (v: any, r: any) => r?.annualLeaveText || v },
    { header: ar ? 'فترة التجربة' : 'Probation', key: 'probationText', width: 14, transform: (v: any, r: any) => v || (r?.probationMonths ? `${r.probationMonths}` : '—') },
    { header: ar ? 'السجل' : 'CR number', key: 'sponsorRegistration', width: 16, transform: (v: any) => v || '—' },
    { header: tx.colBasicSalary, key: 'basicSalary', width: 14 },
    { header: tx.colStatus, key: 'status', width: 12 },
  ];
  /** Column funnel: the reader of each column is what it is drawn with, and the list comes from rows after the page filter. See hooks/useColumnFilters. */
  const cf = useColumnFilters<any>(read, filtered, ar ? 'ar' : 'en');
  const shown = cf.apply(filtered);

  // The whole register is in memory (see load), so 'all' is exported from it with no second call; 'displayed' is what is in the table after the panel, search and column funnels.
  const scope = exportScopeLabels(ar);
  const exportOptions = [
    { key: 'shown', label: scope.shown, sheets: [{ name: 'Contracts', rows: shown, columns: exportColumns }] },
    { key: 'all', label: scope.all, sheets: [{ name: 'Contracts', rows: contracts, columns: exportColumns }] },
  ];

  if (!staff) return <div className="text-slate-500 p-8">{tx.notAuthorized}</div>;
  if (loading) return <Spinner />;

  return (
    <div className="space-y-6" dir={isRTL ? 'rtl' : 'ltr'}>
      <ContractsTabs />
      <PageHeader icon={<FileText className="w-5 h-5" />} title={tx.pageTitle} subtitle={`${contracts.length} ${tx.contractsUnit}`}>
        <ExportMenu fileName="contracts" lang={ar ? 'ar' : 'en'} variant="subtle" label={tx.exportExcel} options={exportOptions} />
        <PrimaryButton onClick={openCreate}><Plus className="w-4 h-4" /> {tx.newContract}</PrimaryButton>
      </PageHeader>

      <div className="bg-white border border-slate-200 rounded-xl p-3 shadow-sm flex flex-col sm:flex-row gap-3 sm:items-center">
        <div className="flex-1 min-w-[240px]"><SearchInput value={search} onChange={setSearch} placeholder={tx.searchPlaceholder} /></div>
        <div className="w-full sm:w-44 shrink-0">
          <Select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
            <option value="">{tx.allStatuses}</option>
            {Object.entries(CONTRACT_STATUS).map(([k, v]) => <option key={k} value={k}>{ar ? v.ar : v.en}</option>)}
          </Select>
        </div>
        <div className="shrink-0">
          {/* Options and counts are computed over the whole register after the other filters. See lib/localFilters. */}
          <FilterPanel
            fields={filterFields}
            value={filters}
            onChange={setFilters}
            resultCount={shown.length}
            resultLabel={ar ? 'العقود المطابقة' : 'Matching contracts'}
          />
        </div>
      </div>

      <ScrollX className="bg-white border border-slate-200 rounded-xl shadow-sm">
        <table className="w-full text-sm">
          <thead><tr className="bg-slate-900 border-b border-slate-200 text-slate-300">
            <th {...pin.th(0, 'text-start font-semibold px-4 py-3 whitespace-nowrap')}>{tx.colActions}</th>
            <th {...pin.th(1, 'text-start font-semibold px-4 py-3 whitespace-nowrap')}>{cf.head('employeeNumber', ar ? 'الرقم الوظيفي' : 'Emp. no.')}</th>
            <th {...pin.th(2, 'text-start font-semibold px-4 py-3 whitespace-nowrap')}>{cf.head('employee', tx.colEmployee)}</th>
            <th {...pin.th(3, 'text-start font-semibold px-4 py-3 whitespace-nowrap')}>{cf.head('idNumber', ar ? 'الهوية' : 'ID number')}</th>
            <th className="text-start font-semibold px-4 py-3 whitespace-nowrap">{cf.head('department', ar ? 'القسم' : 'Department')}</th>
            <th className="text-start font-semibold px-4 py-3 whitespace-nowrap">{cf.head('contractNumber', ar ? 'رقم العقد' : 'Contract no.')}</th>
            <th className="text-start font-semibold px-4 py-3 whitespace-nowrap">{cf.head('profession', ar ? 'المهنة في العقد' : 'Contract profession')}</th>
            <th className="text-start font-semibold px-4 py-3 whitespace-nowrap">{cf.head('type', tx.colType)}</th>
            <th className="text-start font-semibold px-4 py-3 whitespace-nowrap">{cf.head('startDate', startLabels[0])}</th>
            <th className="text-start font-semibold px-4 py-3 whitespace-nowrap">{cf.head('startDateHijri', startLabels[1])}</th>
            <th className="text-start font-semibold px-4 py-3 whitespace-nowrap">{cf.head('endDate', endLabels[0])}</th>
            <th className="text-start font-semibold px-4 py-3 whitespace-nowrap">{cf.head('endDateHijri', endLabels[1])}</th>
            <th className="text-start font-semibold px-4 py-3 whitespace-nowrap">{cf.head('annualLeave', tx.thAnnualLeave)}</th>
            <th className="text-start font-semibold px-4 py-3 whitespace-nowrap">{cf.head('probation', ar ? 'فترة التجربة' : 'Probation')}</th>
            <th className="text-start font-semibold px-4 py-3 whitespace-nowrap">{cf.head('cr', ar ? 'السجل' : 'CR number')}</th>
            <th className="text-start font-semibold px-4 py-3 whitespace-nowrap">{cf.head('status', tx.colStatus)}</th>
          </tr></thead>
          <tbody>
            {shown.length === 0 ? (
              <tr><td colSpan={16} className="text-center text-slate-800 py-12">{tx.noContracts}</td></tr>
            ) : shown.map((c) => (
              <tr key={c._id} className="group border-b border-slate-200/70 hover:bg-slate-100">
                <td {...pin.td(0, 'px-4 py-3', BG)}>
                  <div className="flex items-center gap-1">
                    <button type="button" onClick={() => openEdit(c)} className="p-1.5 rounded-lg text-slate-700 hover:text-[#f37121] hover:bg-slate-100" title={tx.editTooltip}><Edit className="w-4 h-4" /></button>
                    {/* Renewal is an action separate from editing. A contract used to be renewed by editing its end date by hand, leaving no trace of when, by whom, or from which date, and the leave balance was read on an extended contract with no new entitlement year. */}
                    {c.status === 'active' && (
                      <button type="button" onClick={() => setRenewing(c)} className="p-1.5 rounded-lg text-slate-700 hover:text-emerald-600 hover:bg-slate-100" title={ar ? 'تجديد العقد' : 'Renew contract'}><RefreshCw className="w-4 h-4" /></button>
                    )}
                    {c.status === 'active' && (
                      <button type="button" onClick={() => terminate(c)} className="p-1.5 rounded-lg text-slate-700 hover:text-red-600 hover:bg-slate-100" title={tx.terminateTooltip}><Ban className="w-4 h-4" /></button>
                    )}
                    <button type="button" onClick={() => remove(c)} className="p-1.5 rounded-lg text-slate-400 hover:text-red-600 hover:bg-slate-100" title={ar ? 'حذف العقد' : 'Delete contract'}><Trash2 className="w-4 h-4" /></button>
                  </div>
                </td>
                <td {...pin.td(1, 'px-4 py-3 text-slate-700 whitespace-nowrap', BG)}>{(c.employee as any)?.employeeNumber || '—'}</td>
                <td {...pin.td(2, 'px-4 py-3 text-slate-900 font-medium whitespace-nowrap', BG)}>
                  {/* Upper bound and clipping. See the employees table. */}
                  <span className="block max-w-[15rem] truncate" title={empName(c.employee, lang) || c.employeeNameAr || ''}>{empName(c.employee, lang) || c.employeeNameAr || '—'}</span>
                </td>
                <td {...pin.td(3, 'px-4 py-3 text-slate-700 whitespace-nowrap', BG)}>{c.iqamaNumber || (c.employee as any)?.iqamaNumber || (c.employee as any)?.nationalId || '—'}</td>
                <td className="px-4 py-3 text-slate-700 whitespace-nowrap">{read.department(c) || '—'}</td>
                <td className="px-4 py-3 text-slate-700 whitespace-nowrap">{c.contractNumber || '—'}</td>
                <td className="px-4 py-3 text-slate-700">{c.contractProfession || c.jobTitle || '—'}</td>
                <td className="px-4 py-3 text-slate-700">{c.type === 'unlimited' ? tx.typeUnlimited : tx.typeFixed}</td>
                <td className="px-4 py-3 text-slate-700 whitespace-nowrap tabular-nums">{gregCell(c.startDate)}</td>
                <td className="px-4 py-3 text-slate-700 whitespace-nowrap tabular-nums" dir="ltr">{hijriCell(c.startDate)}</td>
                <td className="px-4 py-3 text-slate-700 whitespace-nowrap tabular-nums">{gregCell(c.endDate)}</td>
                <td className="px-4 py-3 text-slate-700 whitespace-nowrap tabular-nums" dir="ltr">{hijriCell(c.endDate)}</td>
                {/* Not required is a valid state, not a missing zero; written as is. */}
                <td className="px-4 py-3 text-slate-700 whitespace-nowrap">{c.annualLeaveText || `${c.annualLeaveDays} ${tx.daysShort}`}</td>
                <td className="px-4 py-3 text-slate-700 whitespace-nowrap">{c.probationText || (c.probationMonths ? `${c.probationMonths} ${ar ? 'شهر' : 'mo'}` : '—')}</td>
                <td className="px-4 py-3 text-slate-700 whitespace-nowrap">{c.sponsorRegistration || '—'}</td>
                <td className="px-4 py-3 whitespace-nowrap"><Badge style={contractBadge(c)} lang={lang} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </ScrollX>
      <p className="text-xs text-slate-500">{tx.custodyNote}</p>

      <Modal open={showModal} onClose={() => setShowModal(false)}
        title={editing ? tx.editContract : tx.newContract}
        footer={<>
          <button type="button" onClick={() => setShowModal(false)} className="px-4 py-2 text-slate-500 hover:text-slate-900 text-sm">{tx.cancel}</button>
          <PrimaryButton onClick={save} disabled={saving || !form.employee || !form.startDate}>{saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}{tx.save}</PrimaryButton>
        </>}>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Field label={tx.fieldEmployee} span2>
            <SearchableSelect
              value={form.employee}
              onChange={(v) => set('employee', v)}
              disabled={!!editing}
              placeholder={ar ? 'اختر الموظف' : 'Select an employee'}
              searchPlaceholder={ar ? 'ابحث بالاسم أو الرقم الوظيفي أو الإقامة…' : 'Search by name, number or iqama…'}
              emptyLabel={ar ? 'لا توجد نتائج' : 'No matches'}
              options={employees.map((e) => ({
                value: e._id,
                label: empName(e, lang),
                hint: [e.employeeNumber, e.jobTitle, e.iqamaNumber].filter(Boolean).join(' · '),
              }))}
            />
          </Field>
          <Field label={tx.fieldType}><Select value={form.type} onChange={(e) => set('type', e.target.value)}><option value="fixed">{tx.optFixedTerm}</option><option value="unlimited">{tx.typeUnlimited}</option></Select></Field>
          <Field label={tx.fieldDuration}><TextInput type="number" value={form.durationMonths} onChange={(e) => set('durationMonths', Number(e.target.value))} /></Field>
          {/* Two fields per date: Gregorian then Hijri; only the Gregorian is sent. */}
          <DatePair label={tx.fieldStartDate} value={form.startDate || ''} onChange={(v) => set('startDate', v)} ar={ar} />
          <DatePair label={tx.fieldEndDate} value={form.endDate || ''} onChange={(v) => set('endDate', v)} ar={ar} />
          <Field label={tx.fieldAnnualLeaveDays}><TextInput type="number" value={form.annualLeaveDays} onChange={(e) => set('annualLeaveDays', Number(e.target.value))} /></Field>
          <Field label={tx.fieldProbation}><TextInput type="number" value={form.probationMonths} onChange={(e) => set('probationMonths', Number(e.target.value))} /></Field>
          <Field label={tx.fieldJobTitle}><TextInput value={form.jobTitle} onChange={(e) => set('jobTitle', e.target.value)} /></Field>
          <Field label={tx.fieldBasicSalary}><TextInput type="number" value={form.basicSalary} onChange={(e) => set('basicSalary', Number(e.target.value))} /></Field>
          <Field label={tx.fieldAllowances}><TextInput type="number" value={form.allowances} onChange={(e) => set('allowances', Number(e.target.value))} /></Field>
          {/* Data of the contract sheet itself: read in the table, so corrected from here. */}
          <Field label={ar ? 'الهوية (كما في العقد)' : 'ID number (as on the contract)'}><TextInput value={form.iqamaNumber || ''} onChange={(e) => set('iqamaNumber', e.target.value)} /></Field>
          <Field label={ar ? 'المهنة في العقد' : 'Profession on the contract'}><TextInput value={form.contractProfession || ''} onChange={(e) => set('contractProfession', e.target.value)} /></Field>
          <Field label={ar ? 'رقم العقد' : 'Contract number'}><TextInput value={form.contractNumber || ''} onChange={(e) => set('contractNumber', e.target.value)} /></Field>
          <Field label={ar ? 'السجل التجاري' : 'CR number'}><TextInput value={form.sponsorRegistration || ''} onChange={(e) => set('sponsorRegistration', e.target.value)} /></Field>
          <Field label={tx.fieldNotes} span2><TextArea rows={2} value={form.notes} onChange={(e) => set('notes', e.target.value)} /></Field>
        </div>
        <p className="text-xs text-slate-500">{tx.activeContractNote}</p>
      </Modal>

      {/* Renewal dialog. Dates are proposed from the current contract: the new one starts the day after it ends and runs one year. These are the dates typed by hand every time. */}
      <Modal open={!!renewing} onClose={() => setRenewing(null)}
        title={ar ? 'تجديد العقد' : 'Renew contract'}
        footer={<>
          <button type="button" onClick={() => setRenewing(null)} className="px-4 py-2 text-slate-500 text-sm">{ar ? 'إلغاء' : 'Cancel'}</button>
          <PrimaryButton onClick={doRenew} disabled={renewSaving || !renewForm.startDate}>
            {renewSaving ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
            {ar ? 'تجديد' : 'Renew'}
          </PrimaryButton>
        </>}>
        <div className="space-y-3">
          <p className="text-[13px] text-slate-500">
            {ar
              ? 'يُقفَل العقد الحالي «منتهيًا» ولا يُحذف، ويُنشأ عقدٌ ساري يليه ويُقيَّد التجديد في سجلّ الموظف.'
              : 'The current contract is closed as “expired” (not deleted), an active successor is created, and the renewal is recorded in the employee’s history.'}
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <DatePair label={ar ? 'تاريخ بداية العقد الجديد *' : 'New start date *'} ar={ar}
              value={renewForm.startDate} onChange={(v) => setRenewForm((f) => ({ ...f, startDate: v }))} />
            <DatePair label={ar ? 'تاريخ نهاية العقد الجديد' : 'New end date'} ar={ar}
              value={renewForm.endDate} onChange={(v) => setRenewForm((f) => ({ ...f, endDate: v }))} />
            <Field label={ar ? 'أيام الإجازة السنوية' : 'Annual leave days'}>
              <TextInput type="number" value={renewForm.annualLeaveDays} onChange={(e) => setRenewForm((f) => ({ ...f, annualLeaveDays: e.target.value }))} /></Field>
            {/* Profession is reviewed here, optionally. Renewal is when a profession really changes: a driver is promoted or moved to other work and it is written on the new contract. It used to be left as is and the new contract opened after creation to be corrected. Prefilled from the current contract, so someone who does not want to change it does not touch it. */}
            <Field label={ar ? 'المهنة في العقد (اختياري)' : 'Contract profession (optional)'}>
              <TextInput value={renewForm.contractProfession}
                placeholder={ar ? 'كما في العقد الحالي' : 'as on the current contract'}
                onChange={(e) => setRenewForm((f) => ({ ...f, contractProfession: e.target.value }))} /></Field>
            <Field label={ar ? 'رقم العقد (اختياري)' : 'Contract number (optional)'}>
              <TextInput value={renewForm.contractNumber}
                placeholder={ar ? 'رقم العقد الجديد في قوى' : 'new contract number'}
                onChange={(e) => setRenewForm((f) => ({ ...f, contractNumber: e.target.value }))} /></Field>
          </div>
          {/* Unused leave balance. It accumulates from the start of the active contract, so a new contract means accumulation from zero, while the employee's remaining days are his right and do not lapse on renewal. Computed at renewal time and fixed on the new contract, which starts with it. */}
          <label className="flex items-start gap-2 rounded-lg border border-slate-200 bg-slate-50 p-3 cursor-pointer">
            <input type="checkbox" checked={renewForm.carryOver}
              onChange={(e) => setRenewForm((f) => ({ ...f, carryOver: e.target.checked }))}
              className="w-4 h-4 accent-[#f37121] mt-0.5" />
            <span className="text-[13px] text-slate-700">
              <b>{ar ? 'ترحيل رصيد الإجازات غير المستهلك' : 'Carry unused leave balance forward'}</b>
              <span className="block text-[11px] text-slate-500 mt-0.5">
                {ar
                  ? 'مَن أخذ 15 يومًا من 30 يبدأ عامَه التالي بـ15 محفوظة، ويتراكم استحقاق السنة الجديدة فوقها.'
                  : 'Someone who used 15 of 30 starts the next year with 15 in hand, and the new year accrues on top.'}
              </span>
            </span>
          </label>
        </div>
      </Modal>
      {ending && (
        <Modal open onClose={() => setEnding(null)} title={ar ? 'إنهاء العقد والخدمة' : 'End contract and service'}
          footer={<>
            <button type="button" onClick={() => setEnding(null)} className="px-4 py-2 text-slate-500 text-sm">{ar ? 'إلغاء' : 'Cancel'}</button>
            <button type="button" onClick={confirmEnd} disabled={endSaving}
              className="flex items-center gap-2 px-4 py-2 bg-red-600 text-white rounded-lg text-sm font-medium hover:bg-red-700 disabled:opacity-50">
              {endSaving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Ban className="w-4 h-4" />}{ar ? 'تأكيد' : 'Confirm'}
            </button>
          </>}>
          <div className="space-y-3">
            <p className="text-[12.5px] text-slate-600">{ar ? 'فسخُ العقد يُنهي خدمة الموظف («لا يعمل»). اختر حالته — ومَن هو خارج النظام أو فريلانسر ينتقل إلى الأرشيف فورًا ولا يحتاج حالة.' : 'Ending the contract ends the service (“not working”). Pick the status — anyone out of the system or freelance goes straight to the archive.'}</p>
            {[['transfer_pending', 'انتظار نقل الكفالة', 'Awaiting sponsorship transfer'], ['final_exit', 'خروج نهائي', 'Final exit'], ['saudi_end', 'نهاية خدمة (سعودي)', 'End of service (Saudi)']].map(([k, a, en]) => (
              <label key={k} className={`flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-2 text-[13px] ${endKind === k ? 'border-red-400 bg-red-50' : 'border-slate-200 hover:bg-slate-50'}`}>
                <input type="radio" name="endKind" className="accent-red-600" checked={endKind === k} onChange={() => setEndKind(k)} />
                <span className="font-semibold text-slate-800">{ar ? a : en}</span>
              </label>
            ))}
            <Field label={ar ? 'السبب (اختياري)' : 'Reason (optional)'}>
              <TextInput value={endReason} onChange={(e) => setEndReason(e.target.value)} />
            </Field>
          </div>
        </Modal>
      )}
    </div>
  );
}
