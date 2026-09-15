'use client';
// الفحص الدوري — متى ينتهي فحصُ كل مركبة.
//
// و«غير مطلوب» هنا حالةٌ سليمة لا نقص: المقطورة لا تُفحص كما تُفحص الشاحنة.
// عدُّها نقصًا يضخّم رقمَ العمل المطلوب في وجه الإدارة بمركباتٍ لا عمل عليها.
import { ClipboardCheck } from 'lucide-react';
import DocumentFamilyPage, { commonColumns, type DocColumn, type DocField } from '@/components/vehicles/DocumentFamilyPage';
import { fmtDate, toHijri } from '@/lib/vehicleRegistry';

// ── ولا عمودَ «حالة الفحص» ───────────────────────────────────────────────────
// كان عمودًا نصّيًّا يُقرأ «ناجح» أو «غير مطلوب»، وعمودُ الحالة المحسوب من تاريخ
// الانتهاء يقول الشيء نفسَه بأحدثَ منه: «منتهٍ» و«قارب على الانتهاء» و«ساري»
// و«غير مطلوب» — محسوبةً اليومَ لا مكتوبةً في آخر استيراد. وعمودان يقولان
// شيئًا واحدًا ويفترقان بعد أوّل تجديد يجعلان القارئ يسأل أيَّهما يصدّق.
// والحقلُ نفسُه باقٍ يُكتب في الاستمارة — الذي رُفع عرضُه لا تسجيلُه.
const COLUMNS: DocColumn[] = [
  ...commonColumns(),
  { key: 'expiryDate', ar: 'تاريخ انتهاء الفحص (ميلادي)', en: 'Inspection expiry (Gregorian)', get: (v) => fmtDate(v.inspection?.expiryDate), width: 18 },
  // يُشتقّ من الميلاديّ لا يُكتب: عمودٌ يُملأ مرّتين يفترق عند أوّل تجديد.
  { key: 'expiryDateHijri', ar: 'تاريخ انتهاء الفحص (هجري)', en: 'Inspection expiry (Hijri)', mono: true, get: (v) => toHijri(v.inspection?.expiryDate), width: 18 },
];

// ── ولا تُكتب «حالة الفحص» بيد ─────────────────────────────────────────────
// رُفعت من العمود لأنّها تقول ما يقوله عمودُ الحالة المحسوب، ثمّ بقيت في نموذج
// التعديل — فيُفتَح التعديلُ فتُرى خانةٌ لحالةٍ لا تُكتب باليد أصلًا: هي مشتقّةٌ
// من تاريخ الانتهاء ومن «غير مطلوب»، تُحسَب اليومَ لا تُملأ. ووجودُها في النموذج
// دعوةٌ لأن يكتب أحدُهم فيها ما يخالف التاريخَ تحتها.
//
// فلم يبقَ في النموذج إلّا ما يُكتب فعلًا: تاريخُ الانتهاء — بالهجريّ أو
// بالميلاديّ، وكلٌّ يُسمِع الآخر. راجع HijriGregorianField.
//
// والحقلُ نفسُه باقٍ في القاعدة كما استُورد؛ الذي رُفع عرضُه وتحريرُه لا محوُه.
const FIELDS: DocField[] = [
  { path: 'inspection.expiryDate', ar: 'تاريخ انتهاء الفحص', en: 'Inspection expiry', kind: 'date' },
];

export default function Page() {
  return (
    <DocumentFamilyPage
      docKey="inspection"
      path="/system/vehicles/registry/inspection"
      icon={<ClipboardCheck className="w-5 h-5" />}
      titleAr="الفحص الدوري" titleEn="Periodic Inspection"
      subtitleAr="تاريخ انتهاء الفحص لكل مركبة والأيام المتبقية عليه"
      subtitleEn="Inspection expiry per vehicle and the days left on it"
      fileName="vehicle-inspection"
      columns={COLUMNS}
      fields={FIELDS}
      searchIn={(v) => [v.plateNumber, v.ownerNameAr, v.inspection?.statusAr]}
    />
  );
}
