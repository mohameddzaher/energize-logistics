'use client';
// تأمين المركبات — مركبةً مركبة.
//
// وهي غيرُ صفحة «وثائق تأمين المركبات» المجاورة: تلك تعرض الوثائق (تسعًا
// وأربعين وثيقةً تغطّي ثلاثمئة وخمسًا وثلاثين مركبة) وتُجدَّد الوثيقةُ فيها
// فتسري على كل مركباتها دفعةً واحدة. وهذه تعرض المركبات، لأن السؤال يأتي
// بالاتجاهين: «ما الذي تغطّيه هذه الوثيقة؟» و«بأيّ وثيقةٍ هذه المركبة مؤمَّنة
// وإلى متى وبكم؟». الثانية لم يكن لها جواب في أي شاشة.
import { ShieldCheck } from 'lucide-react';
import DocumentFamilyPage, { commonColumns, type DocColumn } from '@/components/vehicles/DocumentFamilyPage';
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
      searchIn={(v) => [v.plateNumber, v.insurance?.policyNumber, v.insurance?.companyAr, v.ownerNameAr]}
    />
  );
}
