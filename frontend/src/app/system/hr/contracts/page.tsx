'use client';
import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '@/context/AuthContext';
import { useLanguage } from '@/context/LanguageContext';
import { useSocket } from '@/hooks/useSocket';
import api from '@/lib/api';
import { FileText, Plus, Edit, Ban, Check } from 'lucide-react';
import { isHRStaff, Contract, Employee, CONTRACT_STATUS, empName, fmtDate, exportToExcel, today } from '@/lib/hr';
import { Spinner, PageHeader, SearchInput, ExportButton, PrimaryButton, Badge, Modal, Field, TextInput, Select, TextArea, Loader2 } from '@/components/hr/HRKit';

const EMPTY = { employee: '', type: 'fixed', startDate: '', endDate: '', durationMonths: 12, annualLeaveDays: 21, jobTitle: '', basicSalary: 0, allowances: 0, probationMonths: 3, notes: '' };

export default function ContractsPage() {
  const { user } = useAuth();
  const { lang, isRTL } = useLanguage();
  const ar = lang === 'ar';
  const staff = isHRStaff(user?.role);

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
    } catch (e: any) { alert(e.message); }
    setSaving(false);
  };

  const terminate = async (c: Contract) => {
    const reason = prompt(ar ? 'سبب إنهاء العقد:' : 'Termination reason:') ?? '';
    try {
      await api.post(`/api/hr/contracts/${c._id}/terminate`, { reason });
      load();
    } catch (e: any) {
      // The backend blocks termination while custody is outstanding.
      alert(e.message);
    }
  };

  const filtered = contracts.filter((c) => {
    if (!search.trim()) return true;
    const n = empName(c.employee).toLowerCase();
    const emp = typeof c.employee === 'object' ? c.employee : null;
    return n.includes(search.toLowerCase()) || (emp?.iqamaNumber || '').includes(search) || (emp?.employeeNumber || '').includes(search);
  });

  if (!staff) return <div className="text-slate-500 p-8">{ar ? 'لا تملك صلاحية.' : 'Not authorized.'}</div>;
  if (loading) return <Spinner />;

  return (
    <div className="space-y-6" dir={isRTL ? 'rtl' : 'ltr'}>
      <PageHeader icon={<FileText className="w-5 h-5" />} title={ar ? 'العقود' : 'Contracts'} subtitle={`${contracts.length} ${ar ? 'عقد' : 'contracts'}`}>
        <ExportButton label={ar ? 'تصدير Excel' : 'Export Excel'} onClick={() => exportToExcel(filtered, [
          { header: 'Employee', key: 'employee', transform: (v: any) => empName(v), width: 22 },
          { header: 'Type', key: 'type', width: 12 },
          { header: 'Start', key: 'startDate', width: 14 },
          { header: 'End', key: 'endDate', width: 14 },
          { header: 'Annual Leave', key: 'annualLeaveDays', width: 14 },
          { header: 'Basic Salary', key: 'basicSalary', width: 14 },
          { header: 'Status', key: 'status', width: 12 },
        ], `contracts-${today()}`, 'Contracts')} />
        <PrimaryButton onClick={openCreate}><Plus className="w-4 h-4" /> {ar ? 'عقد جديد' : 'New Contract'}</PrimaryButton>
      </PageHeader>

      <div className="flex flex-col sm:flex-row gap-3">
        <div className="flex-1"><SearchInput value={search} onChange={setSearch} placeholder={ar ? 'بحث باسم الموظف أو رقم الإقامة...' : 'Search by employee name or iqama...'} /></div>
        <Select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
          <option value="">{ar ? 'كل الحالات' : 'All statuses'}</option>
          {Object.entries(CONTRACT_STATUS).map(([k, v]) => <option key={k} value={k}>{ar ? v.ar : v.en}</option>)}
        </Select>
      </div>

      <div className="bg-white border border-slate-200 rounded-xl overflow-x-auto shadow-sm">
        <table className="w-full text-sm">
          <thead><tr className="bg-slate-900 border-b border-slate-200 text-slate-300">
            <th className="text-start font-semibold px-4 py-3">{ar ? 'الموظف' : 'Employee'}</th>
            <th className="text-start font-semibold px-4 py-3">{ar ? 'النوع' : 'Type'}</th>
            <th className="text-start font-semibold px-4 py-3">{ar ? 'البداية' : 'Start'}</th>
            <th className="text-start font-semibold px-4 py-3">{ar ? 'النهاية' : 'End'}</th>
            <th className="text-start font-semibold px-4 py-3">{ar ? 'إجازة سنوية' : 'Annual Leave'}</th>
            <th className="text-start font-semibold px-4 py-3">{ar ? 'الحالة' : 'Status'}</th>
            <th className="text-end font-semibold px-4 py-3">{ar ? 'إجراءات' : 'Actions'}</th>
          </tr></thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr><td colSpan={7} className="text-center text-slate-500 py-12">{ar ? 'لا توجد عقود' : 'No contracts'}</td></tr>
            ) : filtered.map((c) => (
              <tr key={c._id} className="border-b border-slate-200/70 hover:bg-slate-100">
                <td className="px-4 py-3 text-slate-900 font-medium">{empName(c.employee, lang)}</td>
                <td className="px-4 py-3 text-slate-700">{c.type === 'unlimited' ? (ar ? 'غير محدد' : 'Unlimited') : (ar ? 'محدد' : 'Fixed')}</td>
                <td className="px-4 py-3 text-slate-700">{fmtDate(c.startDate)}</td>
                <td className="px-4 py-3 text-slate-700">{c.endDate ? fmtDate(c.endDate) : '—'}</td>
                <td className="px-4 py-3 text-slate-700">{c.annualLeaveDays} {ar ? 'يوم' : 'd'}</td>
                <td className="px-4 py-3"><Badge style={CONTRACT_STATUS[c.status]} lang={lang} /></td>
                <td className="px-4 py-3">
                  <div className="flex items-center justify-end gap-1">
                    <button type="button" onClick={() => openEdit(c)} className="p-1.5 rounded-lg text-slate-500 hover:text-[#f37121] hover:bg-slate-100" title="Edit"><Edit className="w-4 h-4" /></button>
                    {c.status === 'active' && (
                      <button type="button" onClick={() => terminate(c)} className="p-1.5 rounded-lg text-slate-500 hover:text-red-600 hover:bg-slate-100" title={ar ? 'إنهاء العقد' : 'Terminate'}><Ban className="w-4 h-4" /></button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-slate-500">{ar ? 'ملاحظة: لا يمكن إنهاء العقد قبل تسليم كل العهد المسجّلة على الموظف.' : 'Note: a contract cannot be terminated until all custody items are returned.'}</p>

      <Modal open={showModal} onClose={() => setShowModal(false)}
        title={editing ? (ar ? 'تعديل عقد' : 'Edit Contract') : (ar ? 'عقد جديد' : 'New Contract')}
        footer={<>
          <button type="button" onClick={() => setShowModal(false)} className="px-4 py-2 text-slate-500 hover:text-slate-900 text-sm">{ar ? 'إلغاء' : 'Cancel'}</button>
          <PrimaryButton onClick={save} disabled={saving || !form.employee || !form.startDate}>{saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}{ar ? 'حفظ' : 'Save'}</PrimaryButton>
        </>}>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Field label={ar ? 'الموظف *' : 'Employee *'} span2>
            <Select value={form.employee} onChange={(e) => set('employee', e.target.value)} disabled={!!editing}>
              <option value="">—</option>
              {employees.map((e) => <option key={e._id} value={e._id}>{empName(e)} {e.iqamaNumber ? `(${e.iqamaNumber})` : ''}</option>)}
            </Select>
          </Field>
          <Field label={ar ? 'نوع العقد' : 'Type'}><Select value={form.type} onChange={(e) => set('type', e.target.value)}><option value="fixed">{ar ? 'محدد المدة' : 'Fixed term'}</option><option value="unlimited">{ar ? 'غير محدد' : 'Unlimited'}</option></Select></Field>
          <Field label={ar ? 'مدة العقد (شهور)' : 'Duration (months)'}><TextInput type="number" value={form.durationMonths} onChange={(e) => set('durationMonths', Number(e.target.value))} /></Field>
          <Field label={ar ? 'تاريخ البداية *' : 'Start Date *'}><TextInput type="date" value={form.startDate || ''} onChange={(e) => set('startDate', e.target.value)} /></Field>
          <Field label={ar ? 'تاريخ النهاية' : 'End Date'}><TextInput type="date" value={form.endDate || ''} onChange={(e) => set('endDate', e.target.value)} /></Field>
          <Field label={ar ? 'أيام الإجازة السنوية *' : 'Annual Leave Days *'}><TextInput type="number" value={form.annualLeaveDays} onChange={(e) => set('annualLeaveDays', Number(e.target.value))} /></Field>
          <Field label={ar ? 'شهور التجربة' : 'Probation (months)'}><TextInput type="number" value={form.probationMonths} onChange={(e) => set('probationMonths', Number(e.target.value))} /></Field>
          <Field label={ar ? 'المسمى الوظيفي' : 'Job Title'}><TextInput value={form.jobTitle} onChange={(e) => set('jobTitle', e.target.value)} /></Field>
          <Field label={ar ? 'الراتب الأساسي' : 'Basic Salary'}><TextInput type="number" value={form.basicSalary} onChange={(e) => set('basicSalary', Number(e.target.value))} /></Field>
          <Field label={ar ? 'البدلات' : 'Allowances'}><TextInput type="number" value={form.allowances} onChange={(e) => set('allowances', Number(e.target.value))} /></Field>
          <Field label={ar ? 'ملاحظات' : 'Notes'} span2><TextArea rows={2} value={form.notes} onChange={(e) => set('notes', e.target.value)} /></Field>
        </div>
        <p className="text-xs text-slate-500">{ar ? 'عند إنشاء عقد جديد كـ "ساري" يتم إنهاء العقد الساري السابق تلقائيًا.' : 'Creating a new active contract automatically expires the previous active one.'}</p>
      </Modal>
    </div>
  );
}
