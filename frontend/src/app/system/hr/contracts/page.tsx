'use client';
import { useState, useEffect, useCallback } from 'react';
import { useDialog } from '@/components/system/DialogProvider';
import { useAuth } from '@/context/AuthContext';
import { useLanguage } from '@/context/LanguageContext';
import { useSocket } from '@/hooks/useSocket';
import api from '@/lib/api';
import { FileText, Plus, Edit, Ban, Check } from 'lucide-react';
import { isHRStaff, Contract, Employee, CONTRACT_STATUS, empName, fmtDate, exportToExcel, today } from '@/lib/hr';
import { Spinner, PageHeader, SearchInput, ExportButton, PrimaryButton, Badge, Modal, Field, TextInput, Select, SearchableSelect, TextArea, Loader2 } from '@/components/hr/HRKit';
import { getHrContractsTranslations } from '@/lib/translations';

const EMPTY = { employee: '', type: 'fixed', startDate: '', endDate: '', durationMonths: 12, annualLeaveDays: 21, jobTitle: '', basicSalary: 0, allowances: 0, probationMonths: 3, notes: '' };

export default function ContractsPage() {
  const { notify } = useDialog();
  const { user } = useAuth();
  const { lang, isRTL } = useLanguage();
  const ar = lang === 'ar';
  const tx = getHrContractsTranslations(lang);
  const staff = isHRStaff(user);

  const [contracts, setContracts] = useState<Contract[]>([]);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [showModal, setShowModal] = useState(false);
  const [editing, setEditing] = useState<Contract | null>(null);
  const [form, setForm] = useState<any>(EMPTY);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    try {
      const qs = statusFilter ? `?status=${statusFilter}` : '';
      const d = await api.get<{ contracts: Contract[] }>(`/api/hr/contracts${qs}`);
      setContracts(d.contracts || []);
    } catch {}
    setLoading(false);
  }, [statusFilter]);

  useEffect(() => { load(); }, [load]);
  useSocket('hr:contract', useCallback(() => load(), [load]));
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

  const terminate = async (c: Contract) => {
    const reason = prompt(tx.terminationReasonPrompt) ?? '';
    try {
      await api.post(`/api/hr/contracts/${c._id}/terminate`, { reason });
      load();
    } catch (e: any) {
      // The backend blocks termination while custody is outstanding.
      notify(e.message, 'error');
    }
  };

  const filtered = contracts.filter((c) => {
    if (!search.trim()) return true;
    const n = empName(c.employee).toLowerCase();
    const emp = typeof c.employee === 'object' ? c.employee : null;
    return n.includes(search.toLowerCase()) || (emp?.iqamaNumber || '').includes(search) || (emp?.employeeNumber || '').includes(search);
  });

  if (!staff) return <div className="text-slate-500 p-8">{tx.notAuthorized}</div>;
  if (loading) return <Spinner />;

  return (
    <div className="space-y-6" dir={isRTL ? 'rtl' : 'ltr'}>
      <PageHeader icon={<FileText className="w-5 h-5" />} title={tx.pageTitle} subtitle={`${contracts.length} ${tx.contractsUnit}`}>
        <ExportButton label={tx.exportExcel} onClick={() => exportToExcel(filtered, [
          { header: tx.colEmployee, key: 'employee', transform: (v: any) => empName(v), width: 22 },
          { header: tx.colType, key: 'type', width: 12 },
          { header: tx.colStart, key: 'startDate', width: 14 },
          { header: tx.colEnd, key: 'endDate', width: 14 },
          { header: tx.colAnnualLeave, key: 'annualLeaveDays', width: 14 },
          { header: tx.colBasicSalary, key: 'basicSalary', width: 14 },
          { header: tx.colStatus, key: 'status', width: 12 },
        ], `contracts-${today()}`, 'Contracts')} />
        <PrimaryButton onClick={openCreate}><Plus className="w-4 h-4" /> {tx.newContract}</PrimaryButton>
      </PageHeader>

      <div className="flex flex-col sm:flex-row gap-3">
        <div className="flex-1 min-w-[240px]"><SearchInput value={search} onChange={setSearch} placeholder={tx.searchPlaceholder} /></div>
        <div className="w-full sm:w-44 shrink-0">
          <Select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
            <option value="">{tx.allStatuses}</option>
            {Object.entries(CONTRACT_STATUS).map(([k, v]) => <option key={k} value={k}>{ar ? v.ar : v.en}</option>)}
          </Select>
        </div>
      </div>

      <div className="bg-white border border-slate-200 rounded-xl overflow-x-auto shadow-sm">
        <table className="w-full text-sm">
          <thead><tr className="bg-slate-900 border-b border-slate-200 text-slate-300">
            <th className="text-start font-semibold px-4 py-3">{tx.colEmployee}</th>
            <th className="text-start font-semibold px-4 py-3">{tx.colType}</th>
            <th className="text-start font-semibold px-4 py-3">{tx.thStart}</th>
            <th className="text-start font-semibold px-4 py-3">{tx.thEnd}</th>
            <th className="text-start font-semibold px-4 py-3">{tx.thAnnualLeave}</th>
            <th className="text-start font-semibold px-4 py-3">{tx.colStatus}</th>
            <th className="text-end font-semibold px-4 py-3">{tx.colActions}</th>
          </tr></thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr><td colSpan={7} className="text-center text-slate-800 py-12">{tx.noContracts}</td></tr>
            ) : filtered.map((c) => (
              <tr key={c._id} className="border-b border-slate-200/70 hover:bg-slate-100">
                <td className="px-4 py-3 text-slate-900 font-medium">{empName(c.employee, lang)}</td>
                <td className="px-4 py-3 text-slate-700">{c.type === 'unlimited' ? tx.typeUnlimited : tx.typeFixed}</td>
                <td className="px-4 py-3 text-slate-700">{fmtDate(c.startDate)}</td>
                <td className="px-4 py-3 text-slate-700">{c.endDate ? fmtDate(c.endDate) : '—'}</td>
                <td className="px-4 py-3 text-slate-700">{c.annualLeaveDays} {tx.daysShort}</td>
                <td className="px-4 py-3"><Badge style={CONTRACT_STATUS[c.status]} lang={lang} /></td>
                <td className="px-4 py-3">
                  <div className="flex items-center justify-end gap-1">
                    <button type="button" onClick={() => openEdit(c)} className="p-1.5 rounded-lg text-slate-700 hover:text-[#f37121] hover:bg-slate-100" title={tx.editTooltip}><Edit className="w-4 h-4" /></button>
                    {c.status === 'active' && (
                      <button type="button" onClick={() => terminate(c)} className="p-1.5 rounded-lg text-slate-700 hover:text-red-600 hover:bg-slate-100" title={tx.terminateTooltip}><Ban className="w-4 h-4" /></button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
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
          <Field label={tx.fieldStartDate}><TextInput type="date" value={form.startDate || ''} onChange={(e) => set('startDate', e.target.value)} /></Field>
          <Field label={tx.fieldEndDate}><TextInput type="date" value={form.endDate || ''} onChange={(e) => set('endDate', e.target.value)} /></Field>
          <Field label={tx.fieldAnnualLeaveDays}><TextInput type="number" value={form.annualLeaveDays} onChange={(e) => set('annualLeaveDays', Number(e.target.value))} /></Field>
          <Field label={tx.fieldProbation}><TextInput type="number" value={form.probationMonths} onChange={(e) => set('probationMonths', Number(e.target.value))} /></Field>
          <Field label={tx.fieldJobTitle}><TextInput value={form.jobTitle} onChange={(e) => set('jobTitle', e.target.value)} /></Field>
          <Field label={tx.fieldBasicSalary}><TextInput type="number" value={form.basicSalary} onChange={(e) => set('basicSalary', Number(e.target.value))} /></Field>
          <Field label={tx.fieldAllowances}><TextInput type="number" value={form.allowances} onChange={(e) => set('allowances', Number(e.target.value))} /></Field>
          <Field label={tx.fieldNotes} span2><TextArea rows={2} value={form.notes} onChange={(e) => set('notes', e.target.value)} /></Field>
        </div>
        <p className="text-xs text-slate-500">{tx.activeContractNote}</p>
      </Modal>
    </div>
  );
}
