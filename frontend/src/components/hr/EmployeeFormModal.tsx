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

// ── حقولُ المستندات: قيمةٌ، أو حالةٌ تقول لماذا لا قيمة ─────────────────────────
// الموظّفُ الجديد تُعلَّم مستنداتُه الفارغةُ «مطلوبة» في الخادم؛ ومن لا يحتاج
// مستندًا يختار هنا «غير مطلوب» أو «لا يوجد». والفارغُ «تلقائي» يترك الحالة كما
// هي. خارج الاستمارة عمدًا — مكوّنٌ يُعرَّف داخلها يُعاد إنشاؤه مع كلّ حرف.
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
          <TextInput type={type} value={type === 'date' ? (val || '') : String(val).trimStart()} onChange={(e) => set(k, e.target.value)} />
        )}
        {DOC_STATUS_FIELDS.has(k) && (
          <select value={mark} onChange={(e) => setMark(k, e.target.value)}
            className="w-full px-2 py-1 rounded-md border border-slate-200 bg-slate-50 text-[11.5px] text-slate-600">
            {STATUS_OPTS.map(([v, a, e]) => <option key={v} value={v}>{ar ? a : e}</option>)}
          </select>
        )}
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
  // حالةُ كلّ حقلِ مستندٍ — تُقرأ من الملفّ وتُرسَل مع الحفظ (markStatus).
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
   * ── النموذجُ يقرأ السجلَّ كاملًا، لا ما وصله من قائمة ─────────────────────
   *
   * كان يُبنى من الكائن الممرَّر إليه — وهو في صفحة القائمة **مقتطَعٌ**: تختار
   * القائمةُ حقولًا بعينها لتخفّ، وليس فيها `idType`.
   *
   * فيُفتح تعديلُ موظّفٍ هويّتُه «هوية» فلا يجد النموذجُ نوعَها، فيقع على
   * الافتراضيّ «إقامة» — ولأنّ خانةَ رقم الهويّة لا تُعرَض إلّا مع نوعها، يرى
   * صاحبُها رقمَه وقد اختفى، وهو مكتوبٌ في الملفّ كما تركه.
   *
   * وأسوأُ من الاختفاء: مَن حفظ بعدها كتب «إقامة» فوق نوعه، فانقلبت هويّتُه.
   *
   * ولا يُعالَج بإضافة `idType` إلى اختيار القائمة — تلك قائمةٌ تُكتب بيدٍ
   * ويُنسى منها الحقلُ التالي. النموذجُ يقرأ سجلَّه بنفسِه، فأيُّ حقلٍ يُضاف
   * غدًا يعمل بلا سطرٍ يُضاف هنا.
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

    // ما وصل يُعرَض فورًا حتى لا تُفتح نافذةٌ فارغة، ثمّ يحلّ محلَّه الكاملُ.
    seed(employee);
    let alive = true;
    api.get<any>(`/api/hr/employees/${employee._id}`)
      .then((d) => { const full = d?.employee || d; if (alive && full?._id) seed(full); })
      // وتعذُّرُ القراءة يُبقي المعروضَ كما هو — لا يُفرغ النموذج.
      .catch(() => {});
    return () => { alive = false; };
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
      // «تلقائي» على ملفٍّ قائم يرفع العلامة؛ وعلى جديدٍ لا يُرسَل فيعمل الافتراض.
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
      // الخادمُ يعيد أسماءَ الحقول التي ردَّها — تُلوَّن بعينها بدل أن يبحث
      // المستخدم في أربعين خانةً عن الخطأ.
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
            <DocInput k="iqamaExpiry" label={tx.iqamaExpiry} type="date" form={form} set={set} mark={marks['iqamaExpiry'] || ''} setMark={setMark} choices={choices} ar={ar} />
          </>
        )}
        <DocInput k="passportNumber" label={tx.passportNumber} form={form} set={set} mark={marks['passportNumber'] || ''} setMark={setMark} choices={choices} ar={ar} />
        <DocInput k="passportExpiry" label={tx.passportExpiry} type="date" form={form} set={set} mark={marks['passportExpiry'] || ''} setMark={setMark} choices={choices} ar={ar} />
      </Section>

      <Section title={tx.sectionGovernment}>
        <DocInput k="qiwaContractNumber" label={tx.qiwaContractNumber} form={form} set={set} mark={marks['qiwaContractNumber'] || ''} setMark={setMark} choices={choices} ar={ar} />
        <Field label={tx.gosiNumber}><TextInput value={form.gosiNumber} onChange={(e) => set('gosiNumber', e.target.value)} /></Field>
        <Field label={tx.absherStatus}><TextInput value={form.absherStatus} onChange={(e) => set('absherStatus', e.target.value)} /></Field>
        <Field label={tx.sponsorName}><TextInput value={form.sponsorName} onChange={(e) => set('sponsorName', e.target.value)} /></Field>
        <DocInput k="workPermitExpiry" label={tx.workPermitExpiry} type="date" form={form} set={set} mark={marks['workPermitExpiry'] || ''} setMark={setMark} choices={choices} ar={ar} />
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
        <DocInput k="bank" label={vtx.bank} cash form={form} set={set} mark={marks['bank'] || ''} setMark={setMark} choices={choices} ar={ar} />
        <Field label={vtx.project2}><TextInput value={form.project} onChange={(e) => set('project', e.target.value)} /></Field>
        <Field label={vtx.registerNumber}><TextInput value={form.registerNumber} onChange={(e) => set('registerNumber', e.target.value)} /></Field>
        <Field label={vtx.absherNumber}><TextInput value={form.absherNumber} onChange={(e) => set('absherNumber', e.target.value)} /></Field>
        <DocInput k="iqamaProfession" label={vtx.iqamaProfession} form={form} set={set} mark={marks['iqamaProfession'] || ''} setMark={setMark} choices={choices} ar={ar} />
        <Field label={vtx.penaltyClause}><TextInput type="number" value={form.penaltyClause} onChange={(e) => set('penaltyClause', Number(e.target.value))} /></Field>
        <Field label={vtx.classification}><TextInput value={form.classification} onChange={(e) => set('classification', e.target.value)} /></Field>
        <Field label={vtx.fileStatus}><TextInput value={form.fileStatus} onChange={(e) => set('fileStatus', e.target.value)} /></Field>
        <DocInput k="insuranceCompany" label={vtx.insuranceCompany} form={form} set={set} mark={marks['insuranceCompany'] || ''} setMark={setMark} choices={choices} ar={ar} />
        <DocInput k="insuranceExpiry" label={vtx.insuranceExpiry} type="date" form={form} set={set} mark={marks['insuranceExpiry'] || ''} setMark={setMark} choices={choices} ar={ar} />
        <DocInput k="socialInsuranceStatus" label={vtx.socialInsuranceStatus} form={form} set={set} mark={marks['socialInsuranceStatus'] || ''} setMark={setMark} choices={choices} ar={ar} />
        <Field label={vtx.visaExpiry}><TextInput type="date" value={form.visaExpiry || ''} onChange={(e) => set('visaExpiry', e.target.value)} /></Field>
      </Section>

      <Section title={vtx.sectionDriving}>
        <Field label={vtx.vehiclePlate}><TextInput value={form.vehiclePlate} onChange={(e) => set('vehiclePlate', e.target.value)} /></Field>
        <Field label={vtx.licenseNumber}><TextInput value={form.licenseNumber} onChange={(e) => set('licenseNumber', e.target.value)} /></Field>
        <DocInput k="licenseType" label={vtx.licenseType} form={form} set={set} mark={marks['licenseType'] || ''} setMark={setMark} choices={choices} ar={ar} />
        <DocInput k="licenseExpiry" label={vtx.licenseExpiry} type="date" form={form} set={set} mark={marks['licenseExpiry'] || ''} setMark={setMark} choices={choices} ar={ar} />
        <DocInput k="driverCardNumber" label={vtx.driverCardNumber} form={form} set={set} mark={marks['driverCardNumber'] || ''} setMark={setMark} choices={choices} ar={ar} />
        <Field label={vtx.driverCardType}><TextInput value={form.driverCardType} onChange={(e) => set('driverCardType', e.target.value)} /></Field>
        <DocInput k="driverCardExpiry" label={vtx.driverCardExpiry} type="date" form={form} set={set} mark={marks['driverCardExpiry'] || ''} setMark={setMark} choices={choices} ar={ar} />
      </Section>
      {employee && fmtDate(employee.createdAt) !== '—' && <p className="text-xs text-slate-500">{tx.added}: {fmtDate(employee.createdAt)}</p>}
    </Modal>
  );
}

export default EmployeeFormModal;
