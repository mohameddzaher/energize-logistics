'use client';
// الفحص الدوري — متى ينتهي فحصُ كل مركبة.
//
// و«غير مطلوب» هنا حالةٌ سليمة لا نقص: المقطورة لا تُفحص كما تُفحص الشاحنة.
// عدُّها نقصًا يضخّم رقمَ العمل المطلوب في وجه الإدارة بمركباتٍ لا عمل عليها.
import { ClipboardCheck } from 'lucide-react';
import DocumentFamilyPage, { commonColumns, type DocColumn, type DocField } from '@/components/vehicles/DocumentFamilyPage';
import { fmtDate } from '@/lib/vehicleRegistry';

const COLUMNS: DocColumn[] = [
  ...commonColumns(),
  { key: 'statusAr', ar: 'حالة الفحص', en: 'Inspection status', get: (v) => v.inspection?.statusAr, width: 16 },
  { key: 'expiryDate', ar: 'تاريخ انتهاء الفحص (ميلادي)', en: 'Inspection expiry (Gregorian)', get: (v) => fmtDate(v.inspection?.expiryDate), width: 18 },
  { key: 'expiryDateHijri', ar: 'تاريخ انتهاء الفحص (هجري)', en: 'Inspection expiry (Hijri)', mono: true, get: (v) => v.inspection?.expiryDateHijri, width: 18 },
];

// حالةُ الفحص تُكتب نصًّا كما في الملف المصدر («ناجح»، «غير مطلوب») — ولا
// تُشتقّ من التاريخ: المقطورةُ لا تُفحص أصلًا، وتاريخُها الفارغ ليس رسوبًا.
const FIELDS: DocField[] = [
  { path: 'inspection.statusAr', ar: 'حالة الفحص', en: 'Inspection status' },
  { path: 'inspection.expiryDate', ar: 'تاريخ انتهاء الفحص (ميلادي)', en: 'Inspection expiry (Gregorian)', kind: 'date' },
  { path: 'inspection.expiryDateHijri', ar: 'تاريخ انتهاء الفحص (هجري)', en: 'Inspection expiry (Hijri)', mono: true },
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
