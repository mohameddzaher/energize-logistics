'use client';
// Shared create/edit form for an employee. Used by BOTH the employees list page
// and the employee profile page so the two never drift. Self-contained: it loads
// the manager/branch options itself and owns its form state.
import { useState, useEffect, useCallback } from 'react';
import { useDialog } from '@/components/system/DialogProvider';
import { useLanguage } from '@/context/LanguageContext';
import api from '@/lib/api';
import { Check } from 'lucide-react';
import { Employee, EMPLOYMENT_STATUS, fmtDate } from '@/lib/hr';
import { Modal, Field, TextInput, Select, TextArea, PrimaryButton, Loader2 } from '@/components/hr/HRKit';
import { getHrEmployeesTranslations } from '@/lib/translations';
import { getVehiclesText } from '@/lib/vehicles';

export const EMPTY_EMPLOYEE = {
  firstName: '', lastName: '', arabicName: '', employeeNumber: '', gender: '', dateOfBirth: '', nationality: '',
  idType: 'iqama', iqamaNumber: '', iqamaExpiry: '', nationalId: '', passportNumber: '', passportExpiry: '',
  qiwaContractNumber: '', gosiNumber: '', absherStatus: '', sponsorName: '', workPermitExpiry: '',
  jobTitle: '', department: '', hireDate: '', actualWorkStartDate: '', workLocation: '', branch: '', branches: [] as string[], employmentStatus: 'active',
  phone: '', email: '', address: '', emergencyContactName: '', emergencyContactPhone: '',
  basicSalary: 0, allowances: 0, directManager: '', notes: '',
  iban: '', bank: '', project: '', registerNumber: '', absherNumber: '', companyNumber: '', originCountryNumber: '',
  fileStatus: '', systemStatus: '', workStatusText: '', penaltyClause: 0, iqamaProfession: '', classification: '',
  insuranceCompany: '', insuranceExpiry: '', socialInsuranceStatus: '', visaExpiry: '', lastTravelDate: '', lastReturnDate: '',
  vehiclePlate: '', licenseNumber: '', licenseType: '', licenseExpiry: '',
  driverCardNumber: '', driverCardType: '', driverCardStatus: '', driverCardExpiry: '', workCard: '', ajeerStatus: '', ajeerExpiry: '',
};

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  const { notify } = useDialog();
  return (
    <div className="border-t border-slate-200 pt-5 mt-5 first:border-t-0 first:pt-0 first:mt-0">
      <h3 className="text-[#f37121] text-sm font-semibold mb-3 flex items-center gap-2">
        <span className="w-1 h-4 rounded-full bg-[#f37121]" />{title}
      </h3>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">{children}</div>
    </div>
  );
}

export function EmployeeFormModal({ open, employee, onClose, onSaved }: {
  open: boolean;
  employee: Employee | null;        // null = create
  onClose: () => void;
  onSaved: (e?: Employee) => void;
}) {
  const { notify } = useDialog();
  const { lang } = useLanguage();
  const ar = lang === 'ar';
  const tx = getHrEmployeesTranslations(lang);
  const vtx = getVehiclesText(lang);

  const [form, setForm] = useState<any>(EMPTY_EMPLOYEE);
  const [saving, setSaving] = useState(false);
  const [managers, setManagers] = useState<any[]>([]);
  const [branches, setBranches] = useState<any[]>([]);

  useEffect(() => {
    if (!open) return;
    api.get<{ managers: any[]; branches: any[] }>('/api/hr/options')
      .then((d) => { setManagers(d.managers || []); setBranches(d.branches || []); }).catch(() => {});
  }, [open]);

  // Reset the form whenever we open (for a new record or a different employee).
  useEffect(() => {
    if (!open) return;
    if (employee) {
      setForm({
        ...EMPTY_EMPLOYEE, ...employee,
        branch: (typeof employee.branch === 'object' ? employee.branch?._id : employee.branch) || '',
        branches: (employee.branches || []).map((b: any) => (typeof b === 'object' ? b?._id : b)).filter(Boolean),
        directManager: (typeof employee.directManager === 'object' ? employee.directManager?._id : employee.directManager) || '',
      });
    } else {
      setForm(EMPTY_EMPLOYEE);
    }
  }, [open, employee]);

  const set = (k: string, v: any) => setForm((f: any) => ({ ...f, [k]: v }));

  // أسماءُ الحقول التي ردَّها الخادمُ في آخر محاولة.
  const [badFields, setBadFields] = useState<string[]>([]);
  const save = useCallback(async () => {
    setBadFields([]);
    if (!form.firstName.trim() || !form.lastName.trim()) return;
    setSaving(true);
    try {
      let saved: any;
      if (employee) saved = await api.put(`/api/hr/employees/${employee._id}`, form);
      else saved = await api.post('/api/hr/employees', form);
      onSaved(saved?.employee);
      onClose();
    } catch (e: any) {
      // الخادمُ يعيد أسماءَ الحقول التي ردَّها — تُلوَّن بعينها بدل أن يبحث
      // المستخدم في أربعين خانةً عن الخطأ.
      setBadFields(Array.isArray(e?.fields) ? e.fields : []);
      notify(e.message, 'error');
    }
    setSaving(false);
  }, [form, employee, onSaved, onClose]);

  return (
    <Modal open={open} onClose={onClose} wide
      title={employee ? tx.editEmployee : tx.addEmployee}
      footer={<>
        <button type="button" onClick={onClose} className="px-4 py-2 text-slate-500 hover:text-slate-900 text-sm">{tx.cancel}</button>
        <PrimaryButton onClick={save} disabled={saving || !form.firstName.trim() || !form.lastName.trim()}>{saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}{tx.save}</PrimaryButton>
      </>}>
      <Section title={tx.sectionPersonal}>
        {/* ── المطلوبُ يُعلَّم قبل الحفظ لا بعده ────────────────────────────
            كان النموذجُ لا يميّز مطلوبًا من اختياريّ، فيُملأ ويُرسَل ويُردّ.
            النجمةُ تقول قبل الإرسال ما لا يمكن تركُه، والخانةُ الحمراءُ تقول
            بعده أيَّ خانةٍ بالضبط ردّها الخادم. */}
        <Field label={`${tx.firstName} *`}>
          <TextInput value={form.firstName} onChange={(e) => set('firstName', e.target.value)}
            className={badFields.includes('firstName') ? 'border-red-400 bg-red-50' : undefined} /></Field>
        <Field label={`${tx.lastName} *`}>
          <TextInput value={form.lastName} onChange={(e) => set('lastName', e.target.value)}
            className={badFields.includes('lastName') ? 'border-red-400 bg-red-50' : undefined} /></Field>
        <Field label={tx.arabicName}><TextInput value={form.arabicName} onChange={(e) => set('arabicName', e.target.value)} /></Field>
        <Field label={tx.employeeNumber}><TextInput value={form.employeeNumber} onChange={(e) => set('employeeNumber', e.target.value)} /></Field>
        <Field label={tx.gender}><Select value={form.gender} onChange={(e) => set('gender', e.target.value)}><option value="">—</option><option value="male">{tx.male}</option><option value="female">{tx.female}</option></Select></Field>
        <Field label={tx.dateOfBirth}><TextInput type="date" value={form.dateOfBirth || ''} onChange={(e) => set('dateOfBirth', e.target.value)} /></Field>
        <Field label={tx.nationality}><TextInput value={form.nationality} onChange={(e) => set('nationality', e.target.value)} /></Field>
      </Section>

      <Section title={tx.sectionIdentity}>
        <Field label={tx.idType}><Select value={form.idType} onChange={(e) => set('idType', e.target.value)}><option value="iqama">{tx.idTypeIqama}</option><option value="national_id">{tx.idTypeNationalId}</option></Select></Field>
        {form.idType === 'national_id' ? (
          <Field label={tx.nationalId}><TextInput value={form.nationalId} onChange={(e) => set('nationalId', e.target.value)} /></Field>
        ) : (
          <>
            <Field label={tx.iqamaNumber}><TextInput value={form.iqamaNumber} onChange={(e) => set('iqamaNumber', e.target.value)} /></Field>
            <Field label={tx.iqamaExpiry}><TextInput type="date" value={form.iqamaExpiry || ''} onChange={(e) => set('iqamaExpiry', e.target.value)} /></Field>
          </>
        )}
        <Field label={tx.passportNumber}><TextInput value={form.passportNumber} onChange={(e) => set('passportNumber', e.target.value)} /></Field>
        <Field label={tx.passportExpiry}><TextInput type="date" value={form.passportExpiry || ''} onChange={(e) => set('passportExpiry', e.target.value)} /></Field>
      </Section>

      <Section title={tx.sectionGovernment}>
        <Field label={tx.qiwaContractNumber}><TextInput value={form.qiwaContractNumber} onChange={(e) => set('qiwaContractNumber', e.target.value)} /></Field>
        <Field label={tx.gosiNumber}><TextInput value={form.gosiNumber} onChange={(e) => set('gosiNumber', e.target.value)} /></Field>
        <Field label={tx.absherStatus}><TextInput value={form.absherStatus} onChange={(e) => set('absherStatus', e.target.value)} /></Field>
        <Field label={tx.sponsorName}><TextInput value={form.sponsorName} onChange={(e) => set('sponsorName', e.target.value)} /></Field>
        <Field label={tx.workPermitExpiry}><TextInput type="date" value={form.workPermitExpiry || ''} onChange={(e) => set('workPermitExpiry', e.target.value)} /></Field>
      </Section>

      <Section title={tx.sectionJob}>
        <Field label={tx.jobTitle}><TextInput value={form.jobTitle} onChange={(e) => set('jobTitle', e.target.value)} /></Field>
        <Field label={tx.department}><TextInput value={form.department} onChange={(e) => set('department', e.target.value)} /></Field>
        <Field label={tx.hireDate}><TextInput type="date" value={form.hireDate || ''} onChange={(e) => set('hireDate', e.target.value)} /></Field>
        <Field label={tx.actualWorkStartDate}><TextInput type="date" value={form.actualWorkStartDate || ''} onChange={(e) => set('actualWorkStartDate', e.target.value)} /></Field>
        <Field label={tx.workLocation}><TextInput value={form.workLocation} onChange={(e) => set('workLocation', e.target.value)} /></Field>
        <Field label={tx.branch}><Select value={form.branch} onChange={(e) => set('branch', e.target.value)}><option value="">—</option>{branches.map((b) => <option key={b._id} value={b._id}>{b.name}</option>)}</Select></Field>
        {/* ── فروع إضافية ────────────────────────────────────────────────────
            موظّفون يعملون على أكثر من فرع فعلًا. حصرُهم في واحد كان يُخفيهم من
            قوائم الفرع الآخر وكأنهم ليسوا منه. الأساسي أعلاه يبقى فرعهم المنسوب
            في التقارير، وهذه تجعلهم يظهرون ويُختارون في الفروع كلها. */}
        <Field label={ar ? 'فروع إضافية يعمل عليها' : 'Also works at'}>
          <div className="flex flex-wrap gap-1.5">
            {branches.filter((b) => b._id !== form.branch).map((b) => {
              const on = (form.branches || []).includes(b._id);
              return (
                <button key={b._id} type="button"
                  onClick={() => set('branches', on
                    ? (form.branches || []).filter((x: string) => x !== b._id)
                    : [...(form.branches || []), b._id])}
                  className={`px-2.5 py-1.5 rounded-lg text-[12.5px] font-semibold border transition ${
                    on ? 'bg-[#12325c] text-white border-[#12325c]'
                       : 'bg-white text-slate-700 border-slate-200 hover:border-slate-400'}`}>
                  {b.name}
                </button>
              );
            })}
            {!branches.length && <span className="text-[12px] text-slate-500">—</span>}
          </div>
          <p className="text-[11px] text-slate-600 mt-1">
            {ar ? 'الفرع الأساسي فوق هو المنسوب إليه في التقارير والرواتب.'
                : 'The primary branch above is the one used in reports and payroll.'}
          </p>
        </Field>
        <Field label={tx.directManager}><Select value={form.directManager} onChange={(e) => set('directManager', e.target.value)}><option value="">—</option>{managers.map((m) => <option key={m._id} value={m._id}>{m.firstName} {m.lastName}</option>)}</Select></Field>
        <Field label={tx.employmentStatus}><Select value={form.employmentStatus} onChange={(e) => set('employmentStatus', e.target.value)}>{Object.entries(EMPLOYMENT_STATUS).map(([k, v]) => <option key={k} value={k}>{ar ? v.ar : v.en}</option>)}</Select></Field>
        <Field label={tx.basicSalary}><TextInput type="number" value={form.basicSalary} onChange={(e) => set('basicSalary', Number(e.target.value))} /></Field>
        <Field label={tx.allowances}><TextInput type="number" value={form.allowances} onChange={(e) => set('allowances', Number(e.target.value))} /></Field>
      </Section>

      <Section title={tx.sectionContact}>
        <Field label={tx.phone}><TextInput value={form.phone} onChange={(e) => set('phone', e.target.value)} /></Field>
        <Field label={tx.email}><TextInput value={form.email} onChange={(e) => set('email', e.target.value)} /></Field>
        <Field label={tx.address} span2><TextInput value={form.address} onChange={(e) => set('address', e.target.value)} /></Field>
        <Field label={tx.emergencyContactName}><TextInput value={form.emergencyContactName} onChange={(e) => set('emergencyContactName', e.target.value)} /></Field>
        <Field label={tx.emergencyContactPhone}><TextInput value={form.emergencyContactPhone} onChange={(e) => set('emergencyContactPhone', e.target.value)} /></Field>
        <Field label={tx.notes} span2><TextArea rows={2} value={form.notes} onChange={(e) => set('notes', e.target.value)} /></Field>
      </Section>

      <Section title={vtx.sectionBankingDocs}>
        <Field label={vtx.iban}><TextInput value={form.iban} onChange={(e) => set('iban', e.target.value)} /></Field>
        <Field label={vtx.bank}><TextInput value={form.bank} onChange={(e) => set('bank', e.target.value)} /></Field>
        <Field label={vtx.project2}><TextInput value={form.project} onChange={(e) => set('project', e.target.value)} /></Field>
        <Field label={vtx.registerNumber}><TextInput value={form.registerNumber} onChange={(e) => set('registerNumber', e.target.value)} /></Field>
        <Field label={vtx.absherNumber}><TextInput value={form.absherNumber} onChange={(e) => set('absherNumber', e.target.value)} /></Field>
        <Field label={vtx.iqamaProfession}><TextInput value={form.iqamaProfession} onChange={(e) => set('iqamaProfession', e.target.value)} /></Field>
        <Field label={vtx.penaltyClause}><TextInput type="number" value={form.penaltyClause} onChange={(e) => set('penaltyClause', Number(e.target.value))} /></Field>
        <Field label={vtx.classification}><TextInput value={form.classification} onChange={(e) => set('classification', e.target.value)} /></Field>
        <Field label={vtx.fileStatus}><TextInput value={form.fileStatus} onChange={(e) => set('fileStatus', e.target.value)} /></Field>
        <Field label={vtx.insuranceCompany}><TextInput value={form.insuranceCompany} onChange={(e) => set('insuranceCompany', e.target.value)} /></Field>
        <Field label={vtx.insuranceExpiry}><TextInput type="date" value={form.insuranceExpiry || ''} onChange={(e) => set('insuranceExpiry', e.target.value)} /></Field>
        <Field label={vtx.socialInsuranceStatus}><TextInput value={form.socialInsuranceStatus} onChange={(e) => set('socialInsuranceStatus', e.target.value)} /></Field>
        <Field label={vtx.visaExpiry}><TextInput type="date" value={form.visaExpiry || ''} onChange={(e) => set('visaExpiry', e.target.value)} /></Field>
      </Section>

      <Section title={vtx.sectionDriving}>
        <Field label={vtx.vehiclePlate}><TextInput value={form.vehiclePlate} onChange={(e) => set('vehiclePlate', e.target.value)} /></Field>
        <Field label={vtx.licenseNumber}><TextInput value={form.licenseNumber} onChange={(e) => set('licenseNumber', e.target.value)} /></Field>
        <Field label={vtx.licenseType}><TextInput value={form.licenseType} onChange={(e) => set('licenseType', e.target.value)} /></Field>
        <Field label={vtx.licenseExpiry}><TextInput type="date" value={form.licenseExpiry || ''} onChange={(e) => set('licenseExpiry', e.target.value)} /></Field>
        <Field label={vtx.driverCardNumber}><TextInput value={form.driverCardNumber} onChange={(e) => set('driverCardNumber', e.target.value)} /></Field>
        <Field label={vtx.driverCardType}><TextInput value={form.driverCardType} onChange={(e) => set('driverCardType', e.target.value)} /></Field>
        <Field label={vtx.driverCardExpiry}><TextInput type="date" value={form.driverCardExpiry || ''} onChange={(e) => set('driverCardExpiry', e.target.value)} /></Field>
      </Section>
      {employee && fmtDate(employee.createdAt) !== '—' && <p className="text-xs text-slate-500">{tx.added}: {fmtDate(employee.createdAt)}</p>}
    </Modal>
  );
}

export default EmployeeFormModal;
