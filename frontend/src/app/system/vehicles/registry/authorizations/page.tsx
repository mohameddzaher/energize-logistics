'use client';
// Authorizations: who is authorized on each vehicle, by which paper, and until when.
// This family had no screen; only the authorized person's name appeared in section registers, without residency number, authorization number or period, which is the whole paper. An expired authorization is not just a blank: the driver then drives without standing, the violation is recorded against the company, and the insurer can dispute cover at the first accident.
import { useState } from 'react';
import { UserCheck, UserMinus, UserPlus, X, Save, Loader2 } from 'lucide-react';
import api from '@/lib/api';
import PersonSelect, { type Person } from '@/components/system/PersonSelect';
import IqamaPersonInfo from '@/components/vehicles/IqamaPersonInfo';
import ManagedSelect from '@/components/system/ManagedSelect';
import { useAuth } from '@/context/AuthContext';
import { useLanguage } from '@/context/LanguageContext';
import { useDialog } from '@/components/system/DialogProvider';
import DocumentFamilyPage, { commonColumns, type DocColumn, type DocField } from '@/components/vehicles/DocumentFamilyPage';
import { docStateLabel, type PersonDocs } from '@/components/system/PersonDocDate';
import { fmtDate, canEditVehicles, type VReg } from '@/lib/vehicleRegistry';

const COLUMNS: DocColumn[] = [
  ...commonColumns(),
  { key: 'name', ar: 'اسم المفوَّض', en: 'Authorised person', get: (v) => v.authorizedPerson?.name, width: 26 },
  { key: 'iqamaNumber', ar: 'رقم الإقامة', en: 'Iqama number', mono: true, get: (v) => v.authorizedPerson?.iqamaNumber, width: 16 },
  { key: 'authorizationNumber', ar: 'رقم التفويض', en: 'Authorisation number', mono: true, get: (v) => v.authorizedPerson?.authorizationNumber, width: 20 },
  { key: 'startDate', ar: 'تاريخ بداية التفويض', en: 'Start date', get: (v) => fmtDate(v.authorizedPerson?.startDate), width: 14 },
  { key: 'expiryDate', ar: 'تاريخ نهاية التفويض', en: 'End date', get: (v) => fmtDate(v.authorizedPerson?.expiryDate), width: 14 },
  // The driver himself. An authorization is a paper on a vehicle but is granted to a person, and three things concern that person: this paper, his driver card and his breach-of-trust cover; he must not drive with any of them missing. All three are read in one line, so the gap shows in the column.
  { key: 'driverCardNumber', ar: 'بطاقة السائق', en: 'Driver card', mono: true, width: 16,
    get: (v) => (v.authorizedPerson?.iqamaNumber ? (v.driverCard?.cardNumber || (v.driverCard ? '—' : 'لا بطاقة')) : '') },
  { key: 'driverCardExpiry', ar: 'انتهاء بطاقة السائق', en: 'Card expiry', width: 16,
    get: (v) => (v.driverCard?.expiryDate ? `${v.driverCard.expiryDate}${v.driverCard.daysLeft != null ? ` (${v.driverCard.daysLeft})` : ''}` : '') },
  { key: 'fidelity', ar: 'خيانة الأمانة', en: 'Fidelity insurance', width: 14,
    get: (v) => (!v.driverCard ? ''
      : v.driverCard.fidelityStatus === 'covered' ? 'مشمول'
        : v.driverCard.fidelityStatus === 'required' ? 'مطلوب ضمُّه' : 'غير محدَّد') },
  // Residency and driving licence expiry come from his HR file; the status sits beside the date so it can be filtered: expired / expires within 30 days / not recorded.
  { key: 'iqamaExpiry', ar: 'انتهاء الإقامة', en: 'Iqama expiry', width: 18,
    get: (v) => personDocCell((v as any).personDocs, 'iqama') },
  { key: 'licenseExpiry', ar: 'انتهاء رخصة القيادة', en: 'Licence expiry', width: 18,
    get: (v) => personDocCell((v as any).personDocs, 'license') },
];

function personDocCell(d: PersonDocs | undefined, which: 'iqama' | 'license') {
  if (!d) return '';
  const date = which === 'iqama' ? d.iqamaExpiry : d.licenseExpiry;
  const state = which === 'iqama' ? d.iqamaState : d.licenseState;
  if (!date) return docStateLabel('missing', true);
  return state === 'expired' || state === 'soon' ? `${date.slice(0, 10)} (${docStateLabel(state, true)})` : date.slice(0, 10);
}

// The full authorization paper: who, which residency, which number, from when to when. A name without authorization number or period proves nothing about the driver's standing.
const FIELDS: DocField[] = [
  // The authorized person is chosen from employees: residency and mobile come from his file, not typed, and the server rejects a name that matches no employee.
  { path: 'authorizedPerson.name', ar: 'اسم المفوَّض', en: 'Authorised person', wide: true,
    person: { idPath: 'authorizedPerson.iqamaNumber', phonePath: 'authorizedPerson.phone', jobPath: 'authorizedPerson.jobTitleAr' } },
  { path: 'authorizedPerson.iqamaNumber', ar: 'رقم الإقامة', en: 'Iqama number', mono: true, personInfo: true, readOnly: true },
  // His mobile is on the authorization paper itself; it is the first thing needed when something happens on the road.
  { path: 'authorizedPerson.phone', ar: 'جوال المفوَّض', en: 'Authorised phone', mono: true, readOnly: true },
  // The job title is a list managed from section settings. A free field would turn a few titles into twenty variants within a month.
  { path: 'authorizedPerson.jobTitleAr', ar: 'المسمّى الوظيفي لقائد المركبة', en: 'Driver job title', lookup: 'vehicle_job_title' },
  { path: 'authorizedPerson.authorizationNumber', ar: 'رقم التفويض', en: 'Authorisation number', mono: true },
  { path: 'authorizedPerson.startDate', ar: 'تاريخ بداية التفويض', en: 'Start date', kind: 'date' },
  { path: 'authorizedPerson.expiryDate', ar: 'تاريخ نهاية التفويض', en: 'End date', kind: 'date' },
];

export default function Page() {
  const ar = useLanguage().lang === 'ar';
  const t = (a: string, e: string) => (ar ? a : e);
  const { user } = useAuth();
  const { confirm, notify } = useDialog();
  const canEdit = canEditVehicles(user);

  // Revoking an authorization touches two records. Clearing the employee name on the vehicle does not revoke it: the authorization lives in two places, the paper on the vehicle and an assignment linking it to the employee, which his HR file reads. Clearing empties the paper but keeps the assignment, so his file still says he is authorized on a vehicle, and that blocks his clearance until noticed by hand. The action has its own named button and closes both records in one call.
  // Assigning also works from here. "No authorization" was plain text; assigning meant opening edit and retyping the employee name and residency number from another tab, where a digit gets wrong and the authorization attaches to nobody. Now the name is picked from the register and the residency number comes with it.
  const [assigning, setAssigning] = useState<{ v: VReg; reload: () => void } | null>(null);

  const revoke = async (v: VReg, reload: () => void) => {
    const who = v.authorizedPerson?.name || '';
    if (!(await confirm({
      title: t('إلغاء التفويض', 'Revoke authorisation'),
      tone: 'danger',
      confirmLabel: t('إلغاء التفويض', 'Revoke'),
      message: t(
        `سيُلغى تفويضُ ${who ? `«${who}»` : 'المفوَّض'} على المركبة ${v.plateNumber}. المركبةُ تبقى في السجلّ كما هي — الذي يزول هو التفويضُ وحدَه، ويختفي من ملفّ الموظّف في الموارد البشريّة.`,
        `The authorisation of ${who ? `"${who}"` : 'the holder'} on vehicle ${v.plateNumber} will be revoked. The vehicle stays in the registry — only the authorisation goes, and it disappears from the employee's HR file.`),
    }))) return;
    try {
      const r = await api.post<{ message: string }>(`/api/vehicle-registry/${v._id}/authorization`, { action: 'revoke' });
      notify(r?.message || t('أُلغي التفويض', 'Revoked'), 'success');
      reload();
    } catch (e: any) { notify(e?.message || t('تعذّر الإلغاء', 'Could not revoke'), 'error'); }
  };

  return (
    <>
    {assigning && (
      <AssignModal v={assigning.v} ar={ar}
        onClose={() => setAssigning(null)}
        onDone={(msg) => { notify(msg, 'success'); assigning.reload(); setAssigning(null); }} />
    )}
    <DocumentFamilyPage
      /* The authorized person is picked from the employee dropdown in its own field (DocField.person), so residency and mobile come from his file and no name is typed by hand. */
      docKey="authorization"
      // No "clear data" button here. Its name says clear while users wanted to revoke, so they pressed it and moved on; the correct action has its own button below.
      hideClear
      rowAction={(v, reload) => {
        if (!canEdit) return null;
        return v.authorizedPerson?.name ? (
          <button key="revoke" onClick={() => revoke(v, reload)}
            title={t('إلغاء التفويض عن هذا الموظّف — المركبة تبقى', 'Revoke this employee\u2019s authorisation — the vehicle stays')}
            className="inline-flex items-center gap-1 px-2 py-1 rounded-lg bg-red-50 text-red-700 border border-red-200 text-[11.5px] font-semibold hover:bg-red-100 whitespace-nowrap">
            <UserMinus className="w-3.5 h-3.5" />{t('إلغاء التفويض', 'Revoke')}
          </button>
        ) : (
          <button key="assign" onClick={() => setAssigning({ v, reload })}
            title={t('تفويض هذه المركبة لموظّف', 'Authorise this vehicle to an employee')}
            className="inline-flex items-center gap-1 px-2 py-1 rounded-lg bg-emerald-50 text-emerald-800 border border-emerald-200 text-[11.5px] font-semibold hover:bg-emerald-100 whitespace-nowrap">
            <UserPlus className="w-3.5 h-3.5" />{t('تفويض', 'Authorise')}
          </button>
        );
      }}
      path="/system/vehicles/registry/authorizations"
      icon={<UserCheck className="w-5 h-5" />}
      titleAr="التفاويض" titleEn="Driving Authorisations"
      subtitleAr="المفوَّض على كل مركبة ورقم إقامته ورقم تفويضه ومدّته — والتجديد يقبل رقمًا جديدًا"
      subtitleEn="Who is authorised on each vehicle, their iqama, the authorisation number and its term"
      fileName="vehicle-authorizations"
      columns={COLUMNS}
      fields={FIELDS}
      searchIn={(v) => [v.plateNumber, v.authorizedPerson?.name, v.authorizedPerson?.iqamaNumber,
        v.authorizedPerson?.authorizationNumber, v.driverCard?.cardNumber]}
    />
    </>
  );
}

/** Authorization dialog. The employee is picked from the register, not typed: the residency number is the key that links the authorization to his file, and a hand-copied number gets a digit wrong and leaves a paper on a vehicle that reaches nobody. Picking from the list brings the number along. */
function AssignModal({ v, ar, onClose, onDone }: {
  v: VReg; ar: boolean; onClose: () => void; onDone: (msg: string) => void;
}) {
  const t = (a: string, e: string) => (ar ? a : e);
  const [emp, setEmp] = useState<Person | null>(null);
  const [f, setF] = useState({
    name: '', iqamaNumber: '', jobTitleAr: '', authorizationNumber: '', startDate: '', expiryDate: '',
  });
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');

  // Employee picked from the dropdown: HR employees plus light-transport people with no HR file.
  const pick = (e: Person | null) => {
    setEmp(e);
    if (!e) { setF((p) => ({ ...p, name: '', iqamaNumber: '' })); return; }
    setF((p) => ({ ...p, name: e.name, iqamaNumber: e.idNumber, jobTitleAr: p.jobTitleAr || e.jobTitleAr || '' }));
  };

  const save = async () => {
    if (!emp) { setErr(t('اختر الموظّف', 'Pick the employee')); return; }
    setSaving(true); setErr('');
    try {
      const r = await api.post<{ message: string }>(`/api/vehicle-registry/${v._id}/authorization`, {
        action: 'assign', ...f, employeeId: emp.employeeId, ltId: emp.ltId,
      });
      onDone(r?.message || t('تمّ التفويض', 'Authorised'));
    } catch (e: any) { setErr(e?.message || t('تعذّر التفويض', 'Could not authorise')); }
    setSaving(false);
  };

  const inp = 'w-full px-3 py-2 rounded-lg border border-slate-200 text-sm';
  const L = ({ children }: { children: React.ReactNode }) => (
    <label className="block text-xs font-semibold text-slate-600 mb-1">{children}</label>
  );

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto p-5" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-1">
          <h3 className="font-bold text-lg text-slate-900">{t('تفويض مركبة', 'Authorise a vehicle')}</h3>
          <button onClick={onClose}><X className="w-5 h-5 text-slate-400" /></button>
        </div>
        <p className="text-sm text-slate-500 mb-4">
          {v.plateNumber}{v.ownerNameAr ? ` · ${v.ownerNameAr}` : ''}
        </p>

        <div className="space-y-3">
          <div>
            <L>{t('الموظّف *', 'Employee *')}</L>
            <PersonSelect endpoint="/api/vehicle-registry/people" ar={ar} idNumber={emp?.idNumber || ''} onChange={pick} />
            {emp && (
              <p className="mt-1 text-[11.5px] text-emerald-700">
                {[emp.idNumber, emp.phone, emp.projectAr].filter(Boolean).join(' · ')}
              </p>
            )}
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div><L>{t('رقم الإقامة', 'Iqama number')}</L>
              {/* From the selected employee's file; not typed. */}
              <input className={`${inp} font-mono bg-slate-50 text-slate-500`} dir="ltr" value={f.iqamaNumber} readOnly tabIndex={-1} />
              <IqamaPersonInfo idNumber={f.iqamaNumber} ar={ar} />
            </div>
            <div><L>{t('المسمّى الوظيفي', 'Job title')}</L>
              <ManagedSelect storeLabel type="vehicle_job_title" value={f.jobTitleAr}
                onChange={(x) => setF((p) => ({ ...p, jobTitleAr: x }))}
                placeholder={t('اختر…', 'Select…')} />
            </div>
            <div><L>{t('رقم التفويض', 'Authorisation number')}</L>
              <input className={`${inp} font-mono`} dir="ltr" value={f.authorizationNumber}
                onChange={(e) => setF((p) => ({ ...p, authorizationNumber: e.target.value }))} />
            </div>
            <div><L>{t('بداية التفويض', 'Start date')}</L>
              <input type="date" className={inp} value={f.startDate}
                onChange={(e) => setF((p) => ({ ...p, startDate: e.target.value }))} />
            </div>
            <div><L>{t('نهاية التفويض', 'End date')}</L>
              <input type="date" className={inp} value={f.expiryDate}
                onChange={(e) => setF((p) => ({ ...p, expiryDate: e.target.value }))} />
            </div>
          </div>

          <p className="text-[11px] text-slate-500 bg-slate-50 rounded-lg px-3 py-2 leading-relaxed">
            {t('يُكتب التفويضُ على المركبة، ويظهر في ملفّ الموظّف متى عُرف برقم إقامته.',
               'The authorisation is written on the vehicle, and appears in the employee\u2019s file once matched by iqama number.')}
          </p>
          {err && <p className="text-[12.5px] text-red-600">{err}</p>}
        </div>

        <div className="flex justify-end gap-2 mt-4">
          <button onClick={onClose} className="px-4 py-2 rounded-lg bg-slate-100 text-slate-600 text-sm">{t('إلغاء', 'Cancel')}</button>
          <button onClick={save} disabled={saving || !emp}
            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-[#f37121] hover:bg-[#d95f14] text-white text-sm font-semibold disabled:opacity-60">
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />} {t('تفويض', 'Authorise')}
          </button>
        </div>
      </div>
    </div>
  );
}
