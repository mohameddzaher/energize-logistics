'use client';
// Shared create/edit form for an employee. Used by BOTH the employees list page
// and the employee profile page so the two never drift. Self-contained: it loads
// the manager/branch options itself and owns its form state.
import { useState, useEffect, useCallback } from 'react';
import { useDialog } from '@/components/system/DialogProvider';
import { useLanguage } from '@/context/LanguageContext';
import api from '@/lib/api';
import { Check } from 'lucide-react';
import { Employee, EMPLOYMENT_STATUS } from '@/lib/hr';
import ManagedSelect from '@/components/system/ManagedSelect';
import { SearchableSelect } from '@/components/hr/HRKit';
import { Modal, Field, TextInput, Select, TextArea, PrimaryButton, Loader2 } from '@/components/hr/HRKit';
import { getHrEmployeesTranslations } from '@/lib/translations';
import { getVehiclesText } from '@/lib/vehicles';
import DatePair from '@/components/hr/DatePair';
import { bothDates } from '@/lib/hrDates';

export const EMPTY_EMPLOYEE = {
  firstName: '', lastName: '', arabicName: '', employeeNumber: '', gender: '', dateOfBirth: '', nationality: '',
  idType: 'iqama', iqamaNumber: '', iqamaExpiry: '', nationalId: '', passportNumber: '', passportExpiry: '',
  qiwaContractNumber: '', gosiNumber: '', absherStatus: '', sponsorName: '', workPermitExpiry: '',
  jobTitle: '', department: '', staffCategory: '', hireDate: '', actualWorkStartDate: '', workLocation: '', branchName: '', branch: '', branches: [] as string[], employmentStatus: 'active',
  phone: '', email: '', address: '', emergencyContactName: '', emergencyContactPhone: '',
  basicSalary: 0, allowances: 0, directManager: '', notes: '',
  iban: '', bank: '', project: '', registerNumber: '', absherNumber: '', companyNumber: '', originCountryNumber: '',
  fileStatus: '', systemStatus: '', workStatusText: '', penaltyClause: 0, iqamaProfession: '', classification: '',
  insuranceCompany: '', insuranceExpiry: '', socialInsuranceStatus: '', visaExpiry: '', lastTravelDate: '', lastReturnDate: '',
  vehiclePlate: '', licenseNumber: '', licenseType: '', licenseExpiry: '',
  driverCardNumber: '', driverCardType: '', driverCardStatus: '', driverCardExpiry: '', workCard: '', ajeerStatus: '', ajeerExpiry: '',
  companyEmail: '', employerNumber: '', isOutsideKingdom: false, iqamaIssueDate: '', iqamaProfessionRequirements: '',
  contractOccupation: '', contractStartDate: '', contractEndDate: '', annualLeaveDays: '', probationPeriod: '',
  insuranceClass: '', medicalInsuranceNumber: '', medicalInsuranceRegister: '', insuranceRequirements: '',
  healthCertNumber: '', healthCertExpiry: '',
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

// Document fields: a value, or a status saying why there is no value.
// A new employee's empty documents are marked "required" on the server; someone who needs no document picks "not required" or "none" here. Empty "auto" leaves the status as is. Outside the form on purpose: a component defined inside it is recreated on every character.
const DOC_STATUS_FIELDS = new Set([
  'iqamaExpiry', 'iqamaProfession', 'passportNumber', 'passportExpiry', 'qiwaContractNumber', 'workPermitExpiry',
  'insuranceCompany', 'insuranceExpiry', 'licenseType', 'licenseExpiry', 'driverCardNumber', 'driverCardExpiry',
]);
const STATUS_OPTS: [string, string, string][] = [
  ['', 'الحالة: تلقائي', 'Status: auto'], ['required', 'مطلوب', 'Required'],
  ['not_required', 'غير مطلوب', 'Not required'], ['none', 'لا يوجد', 'None'], ['inactive', 'غير نشط', 'Inactive'],
];
type ChoiceMap = Record<string, { value: string; count: number }[]>;

function DocInput({ k, label, type = 'text', form, set, mark, setMark, choices, cash, ar }: {
  k: string; label: string; type?: string; form: any; set: (k: string, v: any) => void;
  mark: string; setMark: (k: string, v: string) => void; choices?: ChoiceMap; cash?: boolean; ar: boolean;
}) {
  const opts = choices?.[k];
  const val = form[k] ?? '';
  const known = !opts || !val || String(val).toLowerCase() === 'cash' || opts.some((o) => o.value === val);
  const status = DOC_STATUS_FIELDS.has(k) && (
    <select value={mark} onChange={(e) => setMark(k, e.target.value)}
      className="w-full px-2 py-1 rounded-md border border-slate-200 bg-slate-50 text-[11.5px] text-slate-600">
      {STATUS_OPTS.map(([v, a, e]) => <option key={v} value={v}>{ar ? a : e}</option>)}
    </select>
  );
  // A document date is two fields, Gregorian then Hijri. Residence and license papers are issued in Hijri, so it is typed as on the paper and stored as Gregorian (see DatePair). The status sits under them as it did under the single field.
  if (type === 'date') {
    return (
      <div className="col-span-full space-y-1">
        <DatePair label={label} value={val || ''} onChange={(v) => set(k, v)} ar={ar} />
        {status}
      </div>
    );
  }
  return (
    <Field label={label}>
      <div className="space-y-1">
        {opts && known ? (
          <Select value={val} onChange={(e) => set(k, e.target.value === '__other' ? ' ' : e.target.value)}>
            <option value="">{ar ? '— اختر —' : '— choose —'}</option>
            {cash && <option value="cash">{ar ? 'راتب نقدي' : 'Cash payroll'}</option>}
            {opts.filter((o) => !(cash && o.value.toLowerCase() === 'cash')).map((o) => <option key={o.value} value={o.value}>{o.value}</option>)}
            <option value="__other">{ar ? 'أخرى… (اكتب)' : 'Other… (type)'}</option>
          </Select>
        ) : (
          <TextInput type={type} value={String(val).trimStart()} onChange={(e) => set(k, e.target.value)} />
        )}
        {status}
      </div>
    </Field>
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
  // Status of each document field; read from the file and sent with the save (markStatus).
  const [marks, setMarks] = useState<Record<string, string>>({});
  const setMark = useCallback((k: string, v: string) => setMarks((m) => ({ ...m, [k]: v })), []);
  const [choices, setChoices] = useState<ChoiceMap>({});
  useEffect(() => {
    if (!open) return;
    api.get<{ choices: ChoiceMap }>('/api/hr/master/choices').then((d) => setChoices(d.choices || {})).catch(() => {});
  }, [open]);

  useEffect(() => {
    if (!open) return;
    api.get<{ managers: any[]; branches: any[] }>('/api/hr/options')
      .then((d) => { setManagers(d.managers || []); setBranches(d.branches || []); }).catch(() => {});
  }, [open]);

  /**
   * The form reads the full record, not what came from a list.
   * It used to build from the passed object, which on the list page is trimmed: the list selects specific fields for speed and omits `idType`. Opening an employee whose identity type is national ID, the form fell back to the default (residence); since the ID number field only shows with its type, the owner saw the number vanish although it was stored. Worse, saving afterwards wrote residence over the real type and flipped the identity. Adding `idType` to the list's selection would not fix it, since that list is hand-written and the next field gets forgotten. The form reads its own record, so any new field works with no line added here.
   */
  useEffect(() => {
    if (!open) return;
    if (!employee) { setForm(EMPTY_EMPLOYEE); setMarks({}); return; }

    const seed = (src: any) => {
      const fs = src.fieldStatus || {};
      const m: Record<string, string> = {};
      for (const k of DOC_STATUS_FIELDS) { const v = fs[`${k}Status`]; if (v && v !== 'filled') m[k] = v; }
      setMarks(m);
      setForm({
      ...EMPTY_EMPLOYEE, ...src,
      branch: (typeof src.branch === 'object' ? src.branch?._id : src.branch) || '',
      branches: (src.branches || []).map((b: any) => (typeof b === 'object' ? b?._id : b)).filter(Boolean),
      directManager: (typeof src.directManager === 'object' ? src.directManager?._id : src.directManager) || '',
      });
    };

    // What arrived is shown immediately so no empty window opens, then replaced by the full record.
    seed(employee);
    let alive = true;
    api.get<any>(`/api/hr/employees/${employee._id}`)
      .then((d) => { const full = d?.employee || d; if (alive && full?._id) seed(full); })
      // A failed read keeps what is displayed; the form is not emptied.
      .catch(() => {});
    return () => { alive = false; };
  }, [open, employee]);

  const set = (k: string, v: any) => setForm((f: any) => ({ ...f, [k]: v }));

  // Field names the server rejected in the last attempt.
  const [badFields, setBadFields] = useState<string[]>([]);
  const save = useCallback(async () => {
    setBadFields([]);
    if (!form.firstName.trim() || !form.lastName.trim()) return;
    setSaving(true);
    try {
      let saved: any;
      // "Auto" on an existing file clears the mark; on a new one nothing is sent so the default applies.
      const markStatus: Record<string, string> = {};
      for (const k of DOC_STATUS_FIELDS) {
        if (marks[k]) markStatus[k] = marks[k];
        else if (employee) markStatus[k] = 'clear';
      }
      const body = { ...form, markStatus };
      if (employee) saved = await api.put(`/api/hr/employees/${employee._id}`, body);
      else saved = await api.post('/api/hr/employees', body);
      onSaved(saved?.employee);
      onClose();
    } catch (e: any) {
      // The server returns the rejected field names, which are colored directly so the user does not hunt for the error across forty fields.
      setBadFields(Array.isArray(e?.fields) ? e.fields : []);
      notify(e.message, 'error');
    }
    setSaving(false);
  }, [form, marks, employee, onSaved, onClose]);

  return (
    <Modal open={open} onClose={onClose} wide
      title={employee ? tx.editEmployee : tx.addEmployee}
      footer={<>
        <button type="button" onClick={onClose} className="px-4 py-2 text-slate-500 hover:text-slate-900 text-sm">{tx.cancel}</button>
        <PrimaryButton onClick={save} disabled={saving || !form.firstName.trim() || !form.lastName.trim()}>{saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}{tx.save}</PrimaryButton>
      </>}>
      <Section title={tx.sectionPersonal}>
        {/* Required fields are marked before saving, not after. The form used to not distinguish required from optional, so it was filled, sent and rejected. The asterisk shows what cannot be left empty before sending, and the red field shows afterward which field the server rejected. */}
        <Field label={`${tx.firstName} *`}>
          <TextInput value={form.firstName} onChange={(e) => set('firstName', e.target.value)}
            className={badFields.includes('firstName') ? 'border-red-400 bg-red-50' : undefined} /></Field>
        <Field label={`${tx.lastName} *`}>
          <TextInput value={form.lastName} onChange={(e) => set('lastName', e.target.value)}
            className={badFields.includes('lastName') ? 'border-red-400 bg-red-50' : undefined} /></Field>
        <Field label={tx.arabicName}><TextInput value={form.arabicName} onChange={(e) => set('arabicName', e.target.value)} /></Field>
        <Field label={tx.employeeNumber}><TextInput value={form.employeeNumber} onChange={(e) => set('employeeNumber', e.target.value)} /></Field>
        <Field label={tx.gender}><Select value={form.gender} onChange={(e) => set('gender', e.target.value)}><option value="">—</option><option value="male">{tx.male}</option><option value="female">{tx.female}</option></Select></Field>
        <DatePair label={tx.dateOfBirth} value={form.dateOfBirth || ''} onChange={(v) => set('dateOfBirth', v)} ar={ar} />
        {/* Nationality, city and project are closed searchable lists (utils/hrLists on the server). */}
        <Field label={tx.nationality}><SearchableSelect value={form.nationality || ''} onChange={(v) => set('nationality', v)} placeholder={ar ? '— اختر —' : '— choose —'} searchPlaceholder={ar ? 'ابحث…' : 'Search…'} searchAfter={0}
          options={[...(form.nationality && !(choices.nationality || []).some((o) => o.value === form.nationality) ? [{ value: form.nationality, label: form.nationality }] : []), ...(choices.nationality || []).map((o) => ({ value: o.value, label: o.value }))]} /></Field>
      </Section>

      <Section title={tx.sectionIdentity}>
        <Field label={tx.idType}><Select value={form.idType} onChange={(e) => set('idType', e.target.value)}><option value="iqama">{tx.idTypeIqama}</option><option value="national_id">{tx.idTypeNationalId}</option></Select></Field>
        {form.idType === 'national_id' ? (
          <Field label={tx.nationalId}><TextInput value={form.nationalId} onChange={(e) => set('nationalId', e.target.value)} /></Field>
        ) : (
          <>
            <Field label={tx.iqamaNumber}><TextInput value={form.iqamaNumber} onChange={(e) => set('iqamaNumber', e.target.value)} /></Field>
            <DatePair label={ar ? 'تاريخ إصدار الإقامة' : 'Iqama issue date'} value={form.iqamaIssueDate || ''} onChange={(v) => set('iqamaIssueDate', v)} ar={ar} />
            <DocInput k="iqamaExpiry" label={tx.iqamaExpiry} type="date" form={form} set={set} mark={marks['iqamaExpiry'] || ''} setMark={setMark} choices={choices} ar={ar} />
          </>
        )}
        <DocInput k="passportNumber" label={tx.passportNumber} form={form} set={set} mark={marks['passportNumber'] || ''} setMark={setMark} choices={choices} ar={ar} />
        <DocInput k="passportExpiry" label={tx.passportExpiry} type="date" form={form} set={set} mark={marks['passportExpiry'] || ''} setMark={setMark} choices={choices} ar={ar} />
      </Section>

      <Section title={tx.sectionGovernment}>
        <DocInput k="qiwaContractNumber" label={tx.qiwaContractNumber} form={form} set={set} mark={marks['qiwaContractNumber'] || ''} setMark={setMark} choices={choices} ar={ar} />
        <Field label={tx.gosiNumber}><TextInput value={form.gosiNumber} onChange={(e) => set('gosiNumber', e.target.value)} /></Field>
        <DocInput k="absherStatus" label={tx.absherStatus} form={form} set={set} mark="" setMark={setMark} choices={choices} ar={ar} />
        <DocInput k="sponsorName" label={tx.sponsorName} form={form} set={set} mark="" setMark={setMark} choices={choices} ar={ar} />
        <Field label={ar ? 'رقم صاحب العمل' : 'Employer number'}><TextInput value={form.employerNumber || ''} onChange={(e) => set('employerNumber', e.target.value)} /></Field>
        <DocInput k="workPermitExpiry" label={tx.workPermitExpiry} type="date" form={form} set={set} mark={marks['workPermitExpiry'] || ''} setMark={setMark} choices={choices} ar={ar} />
      </Section>

      <Section title={tx.sectionJob}>
        <Field label={tx.jobTitle}><TextInput value={form.jobTitle} onChange={(e) => set('jobTitle', e.target.value)} /></Field>
        {/* Department comes from the list only; the super admin adds departments from reference data. */}
        <Field label={tx.department}><ManagedSelect type="hr_department" storeLabel strict noAdd value={form.department} onChange={(v) => set('department', v)} /></Field>
        {/* Every employee may hold a job category; only B2C and heavy transport count it as missing. */}
        <Field label={ar ? 'الفئة الوظيفية' : 'Staff category'}><ManagedSelect type="hr_staff_category" storeLabel strict noAdd value={form.staffCategory || ''} onChange={(v) => set('staffCategory', v)} /></Field>
        <DatePair label={tx.hireDate} value={form.hireDate || ''} onChange={(v) => set('hireDate', v)} ar={ar} />
        <DatePair label={tx.actualWorkStartDate} value={form.actualWorkStartDate || ''} onChange={(v) => set('actualWorkStartDate', v)} ar={ar} />
        <Field label={ar ? 'المدينة' : 'City'}><SearchableSelect value={form.branchName || ''} onChange={(v) => set('branchName', v)} placeholder={ar ? '— اختر —' : '— choose —'} searchPlaceholder={ar ? 'ابحث…' : 'Search…'} searchAfter={0}
          options={[...(form.branchName && !(choices.branchName || []).some((o) => o.value === form.branchName) ? [{ value: form.branchName, label: form.branchName }] : []), ...(choices.branchName || []).map((o) => ({ value: o.value, label: o.value }))]} /></Field>
        <Field label={tx.workLocation}><SearchableSelect value={form.workLocation || ''} onChange={(v) => set('workLocation', v)} placeholder={ar ? '— اختر —' : '— choose —'} searchPlaceholder={ar ? 'ابحث…' : 'Search…'} searchAfter={0}
          options={[...(form.workLocation && !(choices.workLocation || []).some((o) => o.value === form.workLocation) ? [{ value: form.workLocation, label: form.workLocation }] : []), ...(choices.workLocation || []).map((o) => ({ value: o.value, label: o.value }))]} /></Field>
        <Field label={tx.branch}><Select value={form.branch} onChange={(e) => set('branch', e.target.value)}><option value="">—</option>{branches.map((b) => <option key={b._id} value={b._id}>{b.name}</option>)}</Select></Field>
        {/* Additional branches: employees who really work on more than one branch. Limiting them to one hid them from the other branch's lists as if they were not its own. The primary above stays the branch attributed in reports; these make them appear and be selectable in all their branches. */}
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
        {/* Employment status is not chosen here: "working" on creation, then changed by ending service (one of three statuses) or reactivation from the employee file. */}
        <Field label={tx.employmentStatus}>
          <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-600">
            {ar ? (EMPLOYMENT_STATUS as any)[form.employmentStatus]?.ar || 'يعمل' : (EMPLOYMENT_STATUS as any)[form.employmentStatus]?.en || 'Active'}
            <span className="block text-[11px] text-slate-400">{ar ? 'تتغيّر بإنهاء الخدمة أو إعادة التفعيل من ملف الموظف' : 'Changes via End Service / Reactivate on the profile'}</span>
          </div>
        </Field>
        <Field label={ar ? 'خارج المملكة' : 'Outside the Kingdom'}>
          <label className="inline-flex items-center gap-2 text-sm text-slate-700 py-2">
            <input type="checkbox" checked={!!form.isOutsideKingdom} onChange={(e) => set('isOutsideKingdom', e.target.checked)} />
            {ar ? 'الموظف خارج المملكة الآن' : 'Currently outside the Kingdom'}
          </label>
        </Field>
        <Field label={tx.basicSalary}><TextInput type="number" value={form.basicSalary} onChange={(e) => set('basicSalary', Number(e.target.value))} /></Field>
        <Field label={tx.allowances}><TextInput type="number" value={form.allowances} onChange={(e) => set('allowances', Number(e.target.value))} /></Field>
      </Section>

      <Section title={tx.sectionContact}>
        <Field label={tx.phone}><TextInput value={form.phone} onChange={(e) => set('phone', e.target.value)} /></Field>
        <Field label={tx.email}><TextInput value={form.email} onChange={(e) => set('email', e.target.value)} /></Field>
        <Field label={ar ? 'بريد الشركة' : 'Company email'}><TextInput value={form.companyEmail || ''} onChange={(e) => set('companyEmail', e.target.value)} /></Field>
        <Field label={ar ? 'جوال الشركة' : 'Company mobile'}><TextInput value={form.companyNumber || ''} onChange={(e) => set('companyNumber', e.target.value)} /></Field>
        <Field label={ar ? 'جوال بلد الإقامة' : 'Home-country mobile'}><TextInput value={form.originCountryNumber || ''} onChange={(e) => set('originCountryNumber', e.target.value)} /></Field>
        <Field label={tx.address} span2><TextInput value={form.address} onChange={(e) => set('address', e.target.value)} /></Field>
        <Field label={tx.emergencyContactName}><TextInput value={form.emergencyContactName} onChange={(e) => set('emergencyContactName', e.target.value)} /></Field>
        <Field label={tx.emergencyContactPhone}><TextInput value={form.emergencyContactPhone} onChange={(e) => set('emergencyContactPhone', e.target.value)} /></Field>
        <Field label={tx.notes} span2><TextArea rows={2} value={form.notes} onChange={(e) => set('notes', e.target.value)} /></Field>
      </Section>

      <Section title={ar ? 'العقد' : 'Contract'}>
        <Field label={ar ? 'المهنة في العقد' : 'Contract occupation'}><TextInput value={form.contractOccupation || ''} onChange={(e) => set('contractOccupation', e.target.value)} /></Field>
        <Field label={ar ? 'الإجازة السنوية' : 'Annual leave'}><TextInput value={form.annualLeaveDays || ''} onChange={(e) => set('annualLeaveDays', e.target.value)} /></Field>
        <Field label={ar ? 'فترة التجربة' : 'Probation period'}><TextInput value={form.probationPeriod || ''} onChange={(e) => set('probationPeriod', e.target.value)} /></Field>
        <DatePair label={ar ? 'بداية العقد' : 'Contract start'} value={form.contractStartDate || ''} onChange={(v) => set('contractStartDate', v)} ar={ar} />
        <DatePair label={ar ? 'نهاية العقد' : 'Contract end'} value={form.contractEndDate || ''} onChange={(v) => set('contractEndDate', v)} ar={ar} />
      </Section>

      <Section title={vtx.sectionBankingDocs}>
        <Field label={vtx.iban}><TextInput value={form.iban} onChange={(e) => set('iban', e.target.value)} /></Field>
        <DocInput k="bank" label={vtx.bank} cash form={form} set={set} mark={marks['bank'] || ''} setMark={setMark} choices={choices} ar={ar} />
        <Field label={ar ? 'المشروع' : 'Project'}><SearchableSelect value={form.project || ''} onChange={(v) => set('project', v)} placeholder={ar ? '— اختر —' : '— choose —'} searchPlaceholder={ar ? 'ابحث…' : 'Search…'} searchAfter={0}
          options={[...(form.project && !(choices.project || []).some((o) => o.value === form.project) ? [{ value: form.project, label: form.project }] : []), ...(choices.project || []).map((o) => ({ value: o.value, label: o.value }))]} /></Field>
        {/* Chosen, not typed: our own registers plus freelancer and training; the type is derived from it. */}
        <Field label={vtx.registerNumber}>
          <Select value={form.registerNumber || ''} onChange={(e) => set('registerNumber', e.target.value)}>
            <option value="">—</option>
            {form.registerNumber && !(choices.registerNumber || []).some((o: any) => o.value === form.registerNumber) && (
              <option value={form.registerNumber}>{form.registerNumber}</option>
            )}
            {(choices.registerNumber || []).map((o: any) => <option key={o.value} value={o.value}>{o.value}</option>)}
          </Select>
        </Field>
        <Field label={vtx.absherNumber}><TextInput value={form.absherNumber} onChange={(e) => set('absherNumber', e.target.value)} /></Field>
        <DocInput k="iqamaProfession" label={vtx.iqamaProfession} form={form} set={set} mark={marks['iqamaProfession'] || ''} setMark={setMark} choices={choices} ar={ar} />
        <Field label={ar ? 'متطلبات المهنة في الإقامة' : 'Occupation requirements'}><TextInput value={form.iqamaProfessionRequirements || ''} onChange={(e) => set('iqamaProfessionRequirements', e.target.value)} /></Field>
        <Field label={vtx.penaltyClause}><TextInput type="number" value={form.penaltyClause} onChange={(e) => set('penaltyClause', Number(e.target.value))} /></Field>
        <DocInput k="classification" label={vtx.classification} form={form} set={set} mark="" setMark={setMark} choices={choices} ar={ar} />
        <DocInput k="fileStatus" label={vtx.fileStatus} form={form} set={set} mark="" setMark={setMark} choices={choices} ar={ar} />
        <DocInput k="insuranceCompany" label={vtx.insuranceCompany} form={form} set={set} mark={marks['insuranceCompany'] || ''} setMark={setMark} choices={choices} ar={ar} />
        <DocInput k="insuranceClass" label={ar ? 'فئة التأمين' : 'Insurance class'} form={form} set={set} mark="" setMark={setMark} choices={choices} ar={ar} />
        <Field label={ar ? 'رقم وثيقة التأمين' : 'Policy number'}><TextInput value={form.medicalInsuranceNumber || ''} onChange={(e) => set('medicalInsuranceNumber', e.target.value)} /></Field>
        <DocInput k="medicalInsuranceRegister" label={ar ? 'سجل التأمين الطبي' : 'Medical insurance register'} form={form} set={set} mark="" setMark={setMark} choices={choices} ar={ar} />
        <Field label={ar ? 'متطلبات التأمين' : 'Insurance requirements'}><TextInput value={form.insuranceRequirements || ''} onChange={(e) => set('insuranceRequirements', e.target.value)} /></Field>
        <DocInput k="insuranceExpiry" label={vtx.insuranceExpiry} type="date" form={form} set={set} mark={marks['insuranceExpiry'] || ''} setMark={setMark} choices={choices} ar={ar} />
        <Field label={ar ? 'رقم الشهادة الصحية' : 'Health certificate no.'}><TextInput value={form.healthCertNumber || ''} onChange={(e) => set('healthCertNumber', e.target.value)} /></Field>
        <DatePair label={ar ? 'انتهاء الشهادة الصحية' : 'Health certificate expiry'} value={form.healthCertExpiry || ''} onChange={(v) => set('healthCertExpiry', v)} ar={ar} />
        <DocInput k="ajeerStatus" label={ar ? 'حالة أجير' : 'Ajeer status'} form={form} set={set} mark="" setMark={setMark} choices={choices} ar={ar} />
        <DatePair label={ar ? 'انتهاء أجير' : 'Ajeer expiry'} value={form.ajeerExpiry || ''} onChange={(v) => set('ajeerExpiry', v)} ar={ar} />
        <Field label={ar ? 'كارت العمل' : 'Work card'}><TextInput value={form.workCard || ''} onChange={(e) => set('workCard', e.target.value)} /></Field>
        <DocInput k="socialInsuranceStatus" label={vtx.socialInsuranceStatus} form={form} set={set} mark={marks['socialInsuranceStatus'] || ''} setMark={setMark} choices={choices} ar={ar} />
        <DatePair label={vtx.visaExpiry} value={form.visaExpiry || ''} onChange={(v) => set('visaExpiry', v)} ar={ar} />
        <DatePair label={ar ? 'تاريخ السفر' : 'Travel date'} value={form.lastTravelDate || ''} onChange={(v) => set('lastTravelDate', v)} ar={ar} />
        <DatePair label={ar ? 'تاريخ العودة' : 'Return date'} value={form.lastReturnDate || ''} onChange={(v) => set('lastReturnDate', v)} ar={ar} />
      </Section>

      <Section title={vtx.sectionDriving}>
        {/* Snapshot from the vehicles register (authorization): shown, not written here, or it would diverge from the paper. */}
        <Field label={vtx.vehiclePlate}>
          <TextInput value={form.vehiclePlate || ''} readOnly disabled className="bg-slate-50 text-slate-600 cursor-not-allowed"
            title={ar ? 'تُقرأ من سجل المركبات — تُعدَّل بالتفويض' : 'Read from the vehicle registry — change it through the authorisation'} />
          <p className="mt-1 text-[11px] text-slate-500">{ar ? 'تُقرأ من سجل المركبات — تُعدَّل بالتفويض' : 'Read from the vehicle registry — change it through the authorisation'}</p>
        </Field>
        <Field label={vtx.licenseNumber}><TextInput value={form.licenseNumber} onChange={(e) => set('licenseNumber', e.target.value)} /></Field>
        <DocInput k="licenseType" label={vtx.licenseType} form={form} set={set} mark={marks['licenseType'] || ''} setMark={setMark} choices={choices} ar={ar} />
        <DocInput k="licenseExpiry" label={vtx.licenseExpiry} type="date" form={form} set={set} mark={marks['licenseExpiry'] || ''} setMark={setMark} choices={choices} ar={ar} />
        <DocInput k="driverCardNumber" label={vtx.driverCardNumber} form={form} set={set} mark={marks['driverCardNumber'] || ''} setMark={setMark} choices={choices} ar={ar} />
        <DocInput k="driverCardType" label={vtx.driverCardType} form={form} set={set} mark="" setMark={setMark} choices={choices} ar={ar} />
        <Field label={ar ? 'توفّر البطاقة' : 'Card availability'}><TextInput value={form.driverCardStatus || ''} onChange={(e) => set('driverCardStatus', e.target.value)} /></Field>
        <DocInput k="driverCardExpiry" label={vtx.driverCardExpiry} type="date" form={form} set={set} mark={marks['driverCardExpiry'] || ''} setMark={setMark} choices={choices} ar={ar} />
      </Section>
      {employee && bothDates(employee.createdAt, ar, '') && <p className="text-xs text-slate-500">{tx.added}: {bothDates(employee.createdAt, ar)}</p>}
    </Modal>
  );
}

export default EmployeeFormModal;
