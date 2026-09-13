'use client';
// التفاويض — مَن هو المفوَّض على كل مركبة، وبأيّ ورقة، وإلى متى.
//
// لم تكن لهذه العائلة شاشة أصلًا. واسمُ المفوَّض وحده كان يظهر في سجلّات القسم
// بلا رقمِ إقامته ولا رقمِ تفويضه ولا مدّته — وهذه هي الورقة كلُّها. وانتهاء
// التفويض ليس خانةً فارغة: السائق حينئذٍ يقود بلا صفة، فتُقيَّد المخالفة على
// الشركة وتُنازِع شركةُ التأمين في التغطية عند أوّل حادث.
import { useState } from 'react';
import { UserCheck, UserMinus, UserPlus, X, Save, Loader2 } from 'lucide-react';
import api from '@/lib/api';
import { EmployeePicker } from '@/components/vehicles/EmployeePicker';
import ManagedSelect from '@/components/system/ManagedSelect';
import { empName } from '@/lib/hr';
import { useAuth } from '@/context/AuthContext';
import { useLanguage } from '@/context/LanguageContext';
import { useDialog } from '@/components/system/DialogProvider';
import DocumentFamilyPage, { commonColumns, type DocColumn, type DocField } from '@/components/vehicles/DocumentFamilyPage';
import { fmtDate, canEditVehicles, type VReg } from '@/lib/vehicleRegistry';

const COLUMNS: DocColumn[] = [
  ...commonColumns(),
  { key: 'name', ar: 'اسم المفوَّض', en: 'Authorised person', get: (v) => v.authorizedPerson?.name, width: 26 },
  { key: 'iqamaNumber', ar: 'رقم الإقامة', en: 'Iqama number', mono: true, get: (v) => v.authorizedPerson?.iqamaNumber, width: 16 },
  { key: 'authorizationNumber', ar: 'رقم التفويض', en: 'Authorisation number', mono: true, get: (v) => v.authorizedPerson?.authorizationNumber, width: 20 },
  { key: 'startDate', ar: 'تاريخ بداية التفويض', en: 'Start date', get: (v) => fmtDate(v.authorizedPerson?.startDate), width: 14 },
  { key: 'expiryDate', ar: 'تاريخ نهاية التفويض', en: 'End date', get: (v) => fmtDate(v.authorizedPerson?.expiryDate), width: 14 },
  // ── والسائقُ نفسُه ─────────────────────────────────────────────────────────
  // التفويضُ ورقةٌ على مركبة، لكنّه يُعطى لشخص. وثلاثةُ أشياء تخصّ ذلك الشخص:
  // ورقتُه هذه، وبطاقةُ سائقه، وخيانةُ أمانته — ولا يجوز أن يقود بواحدةٍ منها
  // ناقصة. فتُقرأ الثلاثةُ في سطرٍ واحد، ومَن ينقصه شيءٌ يُقرأ من العمود لا من
  // فتح شاشةٍ أخرى بحثًا عن اسمه.
  { key: 'driverCardNumber', ar: 'بطاقة السائق', en: 'Driver card', mono: true, width: 16,
    get: (v) => (v.authorizedPerson?.iqamaNumber ? (v.driverCard?.cardNumber || (v.driverCard ? '—' : 'لا بطاقة')) : '') },
  { key: 'driverCardExpiry', ar: 'انتهاء بطاقة السائق', en: 'Card expiry', width: 16,
    get: (v) => (v.driverCard?.expiryDate ? `${v.driverCard.expiryDate}${v.driverCard.daysLeft != null ? ` (${v.driverCard.daysLeft})` : ''}` : '') },
  { key: 'fidelity', ar: 'خيانة الأمانة', en: 'Fidelity insurance', width: 14,
    get: (v) => (!v.driverCard ? ''
      : v.driverCard.fidelityStatus === 'covered' ? 'مشمول'
        : v.driverCard.fidelityStatus === 'required' ? 'مطلوب ضمُّه' : 'غير محدَّد') },
];

// ورقةُ التفويض كاملةً: مَن، وبأيّ إقامة، وبأيّ رقم، ومن متى إلى متى. وناقصُها
// لا يُقرأ: اسمٌ بلا رقمِ تفويضٍ ولا مدّة لا يُثبِت صفةَ السائق أمام أحد.
const FIELDS: DocField[] = [
  { path: 'authorizedPerson.name', ar: 'اسم المفوَّض', en: 'Authorised person', wide: true },
  { path: 'authorizedPerson.iqamaNumber', ar: 'رقم الإقامة', en: 'Iqama number', mono: true },
  // المسمّى قائمةٌ تُدار من إعدادات القسم: «سائق نقل ثقيل» في سبعٍ وخمسين مركبة
  // و«مندوب توصيل» في ثلاثٍ وعشرين — وخانةٌ حرّةٌ تجعلها عشرين مسمًّى بعد شهر.
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

  // ── إلغاءُ التفويض فعلٌ له طرفان ──────────────────────────────────────────
  //
  // كان المسؤولُ يفتح المركبةَ ويمسح اسمَ الموظّف ظنًّا أنّه ألغى التفويض. وهو
  // لا يُلغي: التفويضُ مسجَّلٌ في سجلَّين — ورقةٌ على المركبة، وإسنادٌ يربطها
  // بالموظّف يقرؤه ملفُّه في الموارد البشريّة. فالمسحُ يفرّغ الورقةَ ويترك
  // الإسنادَ، فيبقى الرجلُ «مفوَّضٌ على سيّارة» في ملفّه وليس كذلك — وهو شرطٌ
  // في إخلاء طرفه، فلا يُخلى طرفُه حتى يُكتشَف الأمرُ بيد.
  //
  // فصار للفعل زرُّه باسمه، ويُغلق السجلَّين معًا في نداءٍ واحد.
  // ── والتفويضُ يُسنَد من مكانه أيضًا ───────────────────────────────────────
  // «بلا تفويض» كان نصًّا يُقرأ ولا يُضغَط، فمن أراد أن يفوّض فتح زرَّ التعديل
  // وكتب اسمَ الموظّف ورقمَ إقامته بيده — وهو منقولٌ من ملفٍّ مفتوحٍ في تبويبٍ
  // آخر، فيُخطئ فيه رقمٌ ولا يُربط التفويضُ بأحد. فصار الاسمُ يُختار من السجلّ،
  // ويأتي رقمُ الإقامة معه.
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
      docKey="authorization"
      // ── ولا زرَّ «مسح البيانات» هنا ────────────────────────────────────────
      // هو الذي أوقع في الخطأ: اسمُه يقول إنّه يمسح، والمستخدمُ يريد أن يُلغي،
      // فيضغطه ويمضي. والفعلُ الصحيح له زرُّه أدناه.
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

/**
 * ── نافذةُ التفويض ──────────────────────────────────────────────────────────
 *
 * الموظّفُ يُختار من السجلّ لا يُكتب: رقمُ الإقامة هو المفتاحُ الذي يُربط به
 * التفويضُ بملفّه، ورقمٌ منقولٌ بالنظر يُخطئ رقمًا فيبقى التفويضُ ورقةً على
 * مركبةٍ لا تصل إلى أحد. وباختياره من القائمة يأتي الرقمُ معه.
 */
function AssignModal({ v, ar, onClose, onDone }: {
  v: VReg; ar: boolean; onClose: () => void; onDone: (msg: string) => void;
}) {
  const t = (a: string, e: string) => (ar ? a : e);
  const [emp, setEmp] = useState<any>(null);
  const [f, setF] = useState({
    name: '', iqamaNumber: '', jobTitleAr: '', authorizationNumber: '', startDate: '', expiryDate: '',
  });
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');

  const pick = (_id: string, e: any) => {
    setEmp(e);
    if (!e) { setF((p) => ({ ...p, name: '', iqamaNumber: '' })); return; }
    setF((p) => ({
      ...p,
      name: empName(e, ar ? 'ar' : 'en'),
      // رقمُ الهويّة عمودان بحسب نوعها — يُقرأ الموجودُ منهما. راجع
      // ملاحظةَ «رقم الهوية عمودان لا عمود» في config/hrFields.
      iqamaNumber: e.iqamaNumber || e.nationalId || '',
      jobTitleAr: p.jobTitleAr || e.jobTitle || '',
    }));
  };

  const save = async () => {
    if (!f.name.trim()) { setErr(t('اختر الموظّف', 'Pick the employee')); return; }
    setSaving(true); setErr('');
    try {
      const r = await api.post<{ message: string }>(`/api/vehicle-registry/${v._id}/authorization`, {
        action: 'assign', ...f,
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
            <EmployeePicker value={emp?._id || ''} onChange={pick} lang={ar ? 'ar' : 'en'}
              placeholder={t('ابحث بالاسم أو الرقم الوظيفي…', 'Search by name or number…')} />
            {emp && (
              <p className="mt-1 text-[11.5px] text-emerald-700">
                {[emp.employeeNumber, emp.iqamaNumber || emp.nationalId].filter(Boolean).join(' · ')}
              </p>
            )}
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div><L>{t('رقم الإقامة', 'Iqama number')}</L>
              <input className={`${inp} font-mono`} dir="ltr" value={f.iqamaNumber}
                onChange={(e) => setF((p) => ({ ...p, iqamaNumber: e.target.value }))} />
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
          <button onClick={save} disabled={saving || !f.name.trim()}
            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-[#f37121] hover:bg-[#d95f14] text-white text-sm font-semibold disabled:opacity-60">
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />} {t('تفويض', 'Authorise')}
          </button>
        </div>
      </div>
    </div>
  );
}
