'use client';
// بطاقات التشغيل — رقمُ البطاقة وتاريخُ انتهائها لكل مركبة.
//
// كان هذا العمود موجودًا في قاعدة البيانات لمئتين وعشرين مركبة ولا يظهر في أي
// شاشة: تفلتر على بطاقة التشغيل فتحصل على المركبات الصحيحة بلا رقمِ بطاقةٍ
// واحد. والرقمُ هو ما يُطابَق به الورق حين تصل مخالفةٌ أو يُطلَب تجديد.
import { CreditCard } from 'lucide-react';
import DocumentFamilyPage, { commonColumns, type DocColumn } from '@/components/vehicles/DocumentFamilyPage';
import { fmtDate } from '@/lib/vehicleRegistry';

const COLUMNS: DocColumn[] = [
  ...commonColumns(),
  { key: 'cardNumber', ar: 'رقم بطاقة التشغيل', en: 'Operating card number', mono: true, get: (v) => v.operatingCard?.cardNumber, width: 22 },
  { key: 'expiryDate', ar: 'تاريخ الانتهاء', en: 'Expiry date', get: (v) => fmtDate(v.operatingCard?.expiryDate), width: 14 },
];

export default function Page() {
  return (
    <DocumentFamilyPage
      docKey="operatingCard"
      path="/system/vehicles/registry/operating-cards"
      icon={<CreditCard className="w-5 h-5" />}
      titleAr="بطاقات التشغيل" titleEn="Operating Cards"
      subtitleAr="رقم البطاقة وتاريخ انتهائها لكل مركبة — والتجديد يقبل الرقم الجديد"
      subtitleEn="Card number and expiry per vehicle — renewal accepts the new number"
      fileName="vehicle-operating-cards"
      columns={COLUMNS}
      searchIn={(v) => [v.plateNumber, v.operatingCard?.cardNumber, v.ownerNameAr, v.departmentAr]}
    />
  );
}
