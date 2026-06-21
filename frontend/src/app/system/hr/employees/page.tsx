'use client';
import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/context/AuthContext';
import { useLanguage } from '@/context/LanguageContext';
import { useSocket } from '@/hooks/useSocket';
import api from '@/lib/api';
import { Users, Plus, Edit, Trash2, Check } from 'lucide-react';
import {
  isHRStaff, Employee, EMPLOYMENT_STATUS, empName, fmtDate, exportToExcel, today,
} from '@/lib/hr';
import {
  Spinner, PageHeader, SearchInput, ExportButton, PrimaryButton, Badge, Modal, Field,
  TextInput, Select, TextArea, Loader2,
} from '@/components/hr/HRKit';

const EMPTY = {
  firstName: '', lastName: '', arabicName: '', employeeNumber: '', gender: '', dateOfBirth: '', nationality: '',
  idType: 'iqama', iqamaNumber: '', iqamaExpiry: '', nationalId: '', passportNumber: '', passportExpiry: '',
  qiwaContractNumber: '', gosiNumber: '', absherStatus: '', sponsorName: '', workPermitExpiry: '',
  jobTitle: '', department: '', hireDate: '', workLocation: '', branch: '', employmentStatus: 'active',
  phone: '', email: '', address: '', emergencyContactName: '', emergencyContactPhone: '',
  basicSalary: 0, allowances: 0, directManager: '', notes: '',
};

export default function HREmployeesPage() {
  const { user } = useAuth();
  const { lang, isRTL } = useLanguage();
  const ar = lang === 'ar';
  const router = useRouter();
  const staff = isHRStaff(user?.role);

  const [employees, setEmployees] = useState<Employee[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [showModal, setShowModal] = useState(false);
  const [editing, setEditing] = useState<Employee | null>(null);
  const [form, setForm] = useState<any>(EMPTY);
  const [saving, setSaving] = useState(false);
  const [managers, setManagers] = useState<any[]>([]);
  const [branches, setBranches] = useState<any[]>([]);

  const load = useCallback(async () => {
    try {
      const qs = new URLSearchParams();
      if (search.trim()) qs.set('q', search.trim());
      if (statusFilter) qs.set('status', statusFilter);
      const d = await api.get<{ employees: Employee[] }>(`/api/hr/employees?${qs}`);
      setEmployees(d.employees || []);
    } catch {}
    setLoading(false);
  }, [search, statusFilter]);

  useEffect(() => { load(); }, [load]);
  useSocket('hr:employee', useCallback(() => load(), [load]));

  useEffect(() => {
    api.get<{ managers: any[]; branches: any[] }>('/api/hr/options')
      .then((d) => { setManagers(d.managers || []); setBranches(d.branches || []); }).catch(() => {});
  }, []);

  const openCreate = () => { setEditing(null); setForm(EMPTY); setShowModal(true); };
  const openEdit = (e: Employee) => {
    setEditing(e);
    setForm({
      ...EMPTY, ...e,
      branch: (typeof e.branch === 'object' ? e.branch?._id : e.branch) || '',
      directManager: (typeof e.directManager === 'object' ? e.directManager?._id : e.directManager) || '',
    });
    setShowModal(true);
  };

  const set = (k: string, v: any) => setForm((f: any) => ({ ...f, [k]: v }));

  const save = async () => {
    if (!form.firstName.trim() || !form.lastName.trim()) return;
    setSaving(true);
    try {
      if (editing) await api.put(`/api/hr/employees/${editing._id}`, form);
      else await api.post('/api/hr/employees', form);
      setShowModal(false);
      load();
    } catch (e: any) { alert(e.message); }
    setSaving(false);
  };

  const remove = async (e: Employee) => {
    if (!confirm(ar ? `حذف الموظف ${empName(e, lang)}؟` : `Delete ${empName(e)}?`)) return;
    try { await api.delete(`/api/hr/employees/${e._id}`); load(); } catch (err: any) { alert(err.message); }
  };

  if (!staff) return <div className="text-slate-500 p-8">{ar ? 'لا تملك صلاحية.' : 'Not authorized.'}</div>;
  if (loading) return <Spinner />;

  return (
    <div className="space-y-6" dir={isRTL ? 'rtl' : 'ltr'}>
      <PageHeader icon={<Users className="w-5 h-5" />} title={ar ? 'الموظفون' : 'Employees'} subtitle={`${employees.length} ${ar ? 'موظف' : 'employees'}`}>
        <ExportButton label={ar ? 'تصدير Excel' : 'Export Excel'} onClick={() => exportToExcel(employees, [
          { header: 'Name', key: 'firstName', transform: (_: any, r: any) => empName(r), width: 22 },
          { header: 'Arabic Name', key: 'arabicName', width: 22 },
          { header: 'Emp #', key: 'employeeNumber', width: 12 },
          { header: 'Job Title', key: 'jobTitle', width: 18 },
          { header: 'ID Type', key: 'idType', width: 12 },
          { header: 'Iqama', key: 'iqamaNumber', width: 16 },
          { header: 'Iqama Expiry', key: 'iqamaExpiry', width: 14 },
          { header: 'National ID', key: 'nationalId', width: 16 },
          { header: 'Nationality', key: 'nationality', width: 14 },
          { header: 'Phone', key: 'phone', width: 16 },
          { header: 'Status', key: 'employmentStatus', width: 12 },
          { header: 'Hire Date', key: 'hireDate', width: 14 },
        ], `employees-${today()}`, 'Employees')} />
        <PrimaryButton onClick={openCreate}><Plus className="w-4 h-4" /> {ar ? 'إضافة موظف' : 'Add Employee'}</PrimaryButton>
      </PageHeader>

      <div className="flex flex-col sm:flex-row gap-3">
        <div className="flex-1"><SearchInput value={search} onChange={setSearch} placeholder={ar ? 'بحث بالاسم أو رقم الإقامة أو رقم الموظف...' : 'Search by name, iqama, employee #...'} /></div>
        <Select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
          <option value="">{ar ? 'كل الحالات' : 'All statuses'}</option>
          {Object.entries(EMPLOYMENT_STATUS).map(([k, v]) => <option key={k} value={k}>{ar ? v.ar : v.en}</option>)}
        </Select>
      </div>

      <div className="bg-white border border-slate-200 rounded-xl overflow-x-auto shadow-sm">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-slate-900 border-b border-slate-200 text-slate-300">
              <th className="text-start font-semibold px-4 py-3">{ar ? 'الاسم' : 'Name'}</th>
              <th className="text-start font-semibold px-4 py-3">{ar ? 'رقم الموظف' : 'Emp #'}</th>
              <th className="text-start font-semibold px-4 py-3">{ar ? 'الوظيفة' : 'Job Title'}</th>
              <th className="text-start font-semibold px-4 py-3">{ar ? 'الإقامة / الهوية' : 'Iqama / ID'}</th>
              <th className="text-start font-semibold px-4 py-3">{ar ? 'الجنسية' : 'Nationality'}</th>
              <th className="text-start font-semibold px-4 py-3">{ar ? 'الحالة' : 'Status'}</th>
              <th className="text-end font-semibold px-4 py-3">{ar ? 'إجراءات' : 'Actions'}</th>
            </tr>
          </thead>
          <tbody>
            {employees.length === 0 ? (
              <tr><td colSpan={7} className="text-center text-slate-500 py-12">{ar ? 'لا يوجد موظفون' : 'No employees'}</td></tr>
            ) : employees.map((e) => (
              <tr key={e._id} className="border-b border-slate-200/70 hover:bg-slate-100 transition-colors cursor-pointer" onClick={() => router.push(`/system/hr/employees/${e._id}`)}>
                <td className="px-4 py-3 text-slate-900 font-medium">{empName(e, lang)}<div className="text-xs text-slate-500">{e.email || ''}</div></td>
                <td className="px-4 py-3 text-slate-700">{e.employeeNumber || '—'}</td>
                <td className="px-4 py-3 text-slate-700">{e.jobTitle || '—'}</td>
                <td className="px-4 py-3 text-slate-700">{e.idType === 'national_id' ? (e.nationalId || '—') : (e.iqamaNumber || '—')}</td>
                <td className="px-4 py-3 text-slate-700">{e.nationality || '—'}</td>
                <td className="px-4 py-3"><Badge style={EMPLOYMENT_STATUS[e.employmentStatus || 'active']} lang={lang} /></td>
                <td className="px-4 py-3" onClick={(ev) => ev.stopPropagation()}>
                  <div className="flex items-center justify-end gap-1">
                    <button type="button" onClick={() => openEdit(e)} className="p-1.5 rounded-lg text-slate-500 hover:text-[#f37121] hover:bg-slate-100" title="Edit"><Edit className="w-4 h-4" /></button>
                    {(user?.role === 'super_admin' || user?.role === 'hr_manager') && (
                      <button type="button" onClick={() => remove(e)} className="p-1.5 rounded-lg text-slate-500 hover:text-red-600 hover:bg-slate-100" title="Delete"><Trash2 className="w-4 h-4" /></button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <Modal open={showModal} onClose={() => setShowModal(false)} wide
        title={editing ? (ar ? 'تعديل موظف' : 'Edit Employee') : (ar ? 'إضافة موظف' : 'Add Employee')}
        footer={<>
          <button type="button" onClick={() => setShowModal(false)} className="px-4 py-2 text-slate-500 hover:text-slate-900 text-sm">{ar ? 'إلغاء' : 'Cancel'}</button>
          <PrimaryButton onClick={save} disabled={saving || !form.firstName.trim() || !form.lastName.trim()}>{saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}{ar ? 'حفظ' : 'Save'}</PrimaryButton>
        </>}>
        <Section title={ar ? 'البيانات الشخصية' : 'Personal'}>
          <Field label={ar ? 'الاسم الأول *' : 'First Name *'}><TextInput value={form.firstName} onChange={(e) => set('firstName', e.target.value)} /></Field>
          <Field label={ar ? 'الاسم الأخير *' : 'Last Name *'}><TextInput value={form.lastName} onChange={(e) => set('lastName', e.target.value)} /></Field>
          <Field label={ar ? 'الاسم بالعربي' : 'Arabic Name'}><TextInput value={form.arabicName} onChange={(e) => set('arabicName', e.target.value)} /></Field>
          <Field label={ar ? 'رقم الموظف' : 'Employee #'}><TextInput value={form.employeeNumber} onChange={(e) => set('employeeNumber', e.target.value)} /></Field>
          <Field label={ar ? 'الجنس' : 'Gender'}><Select value={form.gender} onChange={(e) => set('gender', e.target.value)}><option value="">—</option><option value="male">{ar ? 'ذكر' : 'Male'}</option><option value="female">{ar ? 'أنثى' : 'Female'}</option></Select></Field>
          <Field label={ar ? 'تاريخ الميلاد' : 'Date of Birth'}><TextInput type="date" value={form.dateOfBirth || ''} onChange={(e) => set('dateOfBirth', e.target.value)} /></Field>
          <Field label={ar ? 'الجنسية' : 'Nationality'}><TextInput value={form.nationality} onChange={(e) => set('nationality', e.target.value)} /></Field>
        </Section>

        <Section title={ar ? 'الهوية والإقامة (السعودية)' : 'Identity & Residence (Saudi)'}>
          <Field label={ar ? 'نوع الهوية' : 'ID Type'}><Select value={form.idType} onChange={(e) => set('idType', e.target.value)}><option value="iqama">{ar ? 'إقامة (مقيم)' : 'Iqama (Resident)'}</option><option value="national_id">{ar ? 'هوية وطنية (مواطن)' : 'National ID (Citizen)'}</option></Select></Field>
          {form.idType === 'national_id' ? (
            <Field label={ar ? 'رقم الهوية الوطنية' : 'National ID'}><TextInput value={form.nationalId} onChange={(e) => set('nationalId', e.target.value)} /></Field>
          ) : (
            <>
              <Field label={ar ? 'رقم الإقامة' : 'Iqama Number'}><TextInput value={form.iqamaNumber} onChange={(e) => set('iqamaNumber', e.target.value)} /></Field>
              <Field label={ar ? 'انتهاء الإقامة' : 'Iqama Expiry'}><TextInput type="date" value={form.iqamaExpiry || ''} onChange={(e) => set('iqamaExpiry', e.target.value)} /></Field>
            </>
          )}
          <Field label={ar ? 'رقم الجواز' : 'Passport #'}><TextInput value={form.passportNumber} onChange={(e) => set('passportNumber', e.target.value)} /></Field>
          <Field label={ar ? 'انتهاء الجواز' : 'Passport Expiry'}><TextInput type="date" value={form.passportExpiry || ''} onChange={(e) => set('passportExpiry', e.target.value)} /></Field>
        </Section>

        <Section title={ar ? 'الجهات الحكومية (قوى / أبشر / التأمينات)' : 'Government (Qiwa / Absher / GOSI)'}>
          <Field label={ar ? 'رقم عقد قوى' : 'Qiwa Contract #'}><TextInput value={form.qiwaContractNumber} onChange={(e) => set('qiwaContractNumber', e.target.value)} /></Field>
          <Field label={ar ? 'رقم التأمينات (GOSI)' : 'GOSI #'}><TextInput value={form.gosiNumber} onChange={(e) => set('gosiNumber', e.target.value)} /></Field>
          <Field label={ar ? 'حالة أبشر' : 'Absher Status'}><TextInput value={form.absherStatus} onChange={(e) => set('absherStatus', e.target.value)} /></Field>
          <Field label={ar ? 'الكفيل / جهة العمل' : 'Sponsor / Kafala'}><TextInput value={form.sponsorName} onChange={(e) => set('sponsorName', e.target.value)} /></Field>
          <Field label={ar ? 'انتهاء رخصة العمل' : 'Work Permit Expiry'}><TextInput type="date" value={form.workPermitExpiry || ''} onChange={(e) => set('workPermitExpiry', e.target.value)} /></Field>
        </Section>

        <Section title={ar ? 'بيانات الوظيفة' : 'Job'}>
          <Field label={ar ? 'المسمى الوظيفي' : 'Job Title'}><TextInput value={form.jobTitle} onChange={(e) => set('jobTitle', e.target.value)} /></Field>
          <Field label={ar ? 'القسم' : 'Department'}><TextInput value={form.department} onChange={(e) => set('department', e.target.value)} /></Field>
          <Field label={ar ? 'تاريخ التعيين' : 'Hire Date'}><TextInput type="date" value={form.hireDate || ''} onChange={(e) => set('hireDate', e.target.value)} /></Field>
          <Field label={ar ? 'مكان العمل' : 'Work Location'}><TextInput value={form.workLocation} onChange={(e) => set('workLocation', e.target.value)} /></Field>
          <Field label={ar ? 'الفرع' : 'Branch'}><Select value={form.branch} onChange={(e) => set('branch', e.target.value)}><option value="">—</option>{branches.map((b) => <option key={b._id} value={b._id}>{b.name}</option>)}</Select></Field>
          <Field label={ar ? 'المدير المباشر' : 'Direct Manager'}><Select value={form.directManager} onChange={(e) => set('directManager', e.target.value)}><option value="">—</option>{managers.map((m) => <option key={m._id} value={m._id}>{m.firstName} {m.lastName}</option>)}</Select></Field>
          <Field label={ar ? 'الحالة الوظيفية' : 'Employment Status'}><Select value={form.employmentStatus} onChange={(e) => set('employmentStatus', e.target.value)}>{Object.entries(EMPLOYMENT_STATUS).map(([k, v]) => <option key={k} value={k}>{ar ? v.ar : v.en}</option>)}</Select></Field>
          <Field label={ar ? 'الراتب الأساسي' : 'Basic Salary'}><TextInput type="number" value={form.basicSalary} onChange={(e) => set('basicSalary', Number(e.target.value))} /></Field>
          <Field label={ar ? 'البدلات' : 'Allowances'}><TextInput type="number" value={form.allowances} onChange={(e) => set('allowances', Number(e.target.value))} /></Field>
        </Section>

        <Section title={ar ? 'التواصل' : 'Contact'}>
          <Field label={ar ? 'الجوال' : 'Phone'}><TextInput value={form.phone} onChange={(e) => set('phone', e.target.value)} /></Field>
          <Field label={ar ? 'البريد الإلكتروني' : 'Email'}><TextInput value={form.email} onChange={(e) => set('email', e.target.value)} /></Field>
          <Field label={ar ? 'العنوان' : 'Address'} span2><TextInput value={form.address} onChange={(e) => set('address', e.target.value)} /></Field>
          <Field label={ar ? 'اسم جهة الطوارئ' : 'Emergency Contact'}><TextInput value={form.emergencyContactName} onChange={(e) => set('emergencyContactName', e.target.value)} /></Field>
          <Field label={ar ? 'جوال الطوارئ' : 'Emergency Phone'}><TextInput value={form.emergencyContactPhone} onChange={(e) => set('emergencyContactPhone', e.target.value)} /></Field>
          <Field label={ar ? 'ملاحظات' : 'Notes'} span2><TextArea rows={2} value={form.notes} onChange={(e) => set('notes', e.target.value)} /></Field>
        </Section>
        {editing && fmtDate(editing.createdAt) && <p className="text-xs text-slate-500">{ar ? 'أضيف في' : 'Added'}: {fmtDate(editing.createdAt)}</p>}
      </Modal>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <h3 className="text-[#f37121] text-sm font-semibold mb-3">{title}</h3>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">{children}</div>
    </div>
  );
}
