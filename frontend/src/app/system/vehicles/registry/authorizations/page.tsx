'use client';
// التفاويض — مَن هو المفوَّض على كل مركبة، وبأيّ ورقة، وإلى متى.
//
// لم تكن لهذه العائلة شاشة أصلًا. واسمُ المفوَّض وحده كان يظهر في سجلّات القسم
// بلا رقمِ إقامته ولا رقمِ تفويضه ولا مدّته — وهذه هي الورقة كلُّها. وانتهاء
// التفويض ليس خانةً فارغة: السائق حينئذٍ يقود بلا صفة، فتُقيَّد المخالفة على
// الشركة وتُنازِع شركةُ التأمين في التغطية عند أوّل حادث.
import { UserCheck, UserMinus, UserPlus } from 'lucide-react';
import api from '@/lib/api';
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
          <span key="none" className="inline-flex items-center gap-1 px-2 py-1 rounded-lg bg-slate-50 text-slate-500 border border-slate-200 text-[11.5px] font-semibold whitespace-nowrap"
            title={t('لا مفوَّضَ على هذه المركبة — يُفوَّض من زرّ التعديل', 'Nobody is authorised on this vehicle — use edit to authorise')}>
            <UserPlus className="w-3.5 h-3.5" />{t('بلا تفويض', 'Unassigned')}
          </span>
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
  );
}
