'use client';
// تأمين المركبات — مركبةً مركبة.
//
// وهي غيرُ صفحة «وثائق تأمين المركبات» المجاورة: تلك تعرض الوثائق (تسعًا
// وأربعين وثيقةً تغطّي ثلاثمئة وخمسًا وثلاثين مركبة) وتُجدَّد الوثيقةُ فيها
// فتسري على كل مركباتها دفعةً واحدة. وهذه تعرض المركبات، لأن السؤال يأتي
// بالاتجاهين: «ما الذي تغطّيه هذه الوثيقة؟» و«بأيّ وثيقةٍ هذه المركبة مؤمَّنة
// وإلى متى وبكم؟». الثانية لم يكن لها جواب في أي شاشة.
import { ShieldCheck } from 'lucide-react';
import DocumentFamilyPage, { commonColumns, type DocColumn, type DocField } from '@/components/vehicles/DocumentFamilyPage';
import { fmtDate, money } from '@/lib/vehicleRegistry';

const COLUMNS: DocColumn[] = [
  ...commonColumns(),
  { key: 'policyNumber', ar: 'رقم وثيقة التأمين', en: 'Policy number', mono: true, get: (v) => v.insurance?.policyNumber, width: 20 },
  { key: 'expiryDate', ar: 'تاريخ انتهاء التأمين', en: 'Insurance expiry', get: (v) => fmtDate(v.insurance?.expiryDate), width: 16 },
  { key: 'companyAr', ar: 'شركة التأمين', en: 'Insurer', get: (v) => v.insurance?.companyAr, width: 24 },
  { key: 'coverageTypeAr', ar: 'نوع التأمين', en: 'Coverage type', get: (v) => v.insurance?.coverageTypeAr, width: 16 },
  {
    key: 'premiumSar', ar: 'قيمة التأمين', en: 'Premium', width: 16,
    // مركبةٌ يسدّد قسطَها المموِّل ليست «بلا قسط»: هي مؤمَّنة والرقم عنده.
    // تفريغُ الخانة كان يجعلها تُعدّ بلا تأمين في تقرير المدير المالي.
    get: (v) => (v.insurance?.premiumSar != null ? money(v.insurance.premiumSar)
      : v.insurance?.premiumStatusAr || ''),
  },
];

// و«قيمة التأمين» خانتان لا واحدة: رقمٌ حين ندفعه نحن، ونصٌّ حين يدفعه المموِّل
// («ملكية بنك الراجحي»). دمجُهما في خانةٍ واحدة يجبر المدخِل على ترك الرقم
// فارغًا فتُعدّ المركبة بلا تأمين وهي مؤمَّنة.
const FIELDS: DocField[] = [
  { path: 'insurance.policyNumber', ar: 'رقم وثيقة التأمين', en: 'Policy number', mono: true },
  { path: 'insurance.companyAr', ar: 'شركة التأمين', en: 'Insurer' },
  { path: 'insurance.coverageTypeAr', ar: 'نوع التأمين', en: 'Coverage type' },
  { path: 'insurance.expiryDate', ar: 'تاريخ انتهاء التأمين', en: 'Insurance expiry', kind: 'date' },
  { path: 'insurance.premiumSar', ar: 'قيمة التأمين (ر.س)', en: 'Premium (SAR)', kind: 'number' },
  { path: 'insurance.premiumStatusAr', ar: 'جهة سداد القسط', en: 'Who pays the premium',
    hint: 'إن كان القسط على المموِّل' },
];

export default function Page() {
  return (
    <DocumentFamilyPage
      docKey="insurance"
      path="/system/vehicles/registry/insurance/vehicles"
      icon={<ShieldCheck className="w-5 h-5" />}
      titleAr="تأمين المركبات" titleEn="Vehicle Insurance"
      subtitleAr="وثيقة كل مركبة وشركتها ونوع تغطيتها وقيمتها وتاريخ انتهائها"
      subtitleEn="Each vehicle's policy, insurer, coverage, premium and expiry"
      fileName="vehicle-insurance"
      columns={COLUMNS}
      fields={FIELDS}
      searchIn={(v) => [v.plateNumber, v.insurance?.policyNumber, v.insurance?.companyAr, v.ownerNameAr]}
    />
  );
}
