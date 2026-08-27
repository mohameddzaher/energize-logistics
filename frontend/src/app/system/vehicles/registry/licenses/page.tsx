'use client';
// رخص السير — تاريخُ انتهاء الرخصة لكل مركبة، هجريًّا وميلاديًّا.
//
// ولماذا التاريخان معًا: الرخصة تُطبَع بالهجريّ، والنظامُ يحسب الأيام المتبقية
// بالميلاديّ. عرضُ أحدهما وحده يجعل الموظف يقارن ما في يده بما في الشاشة فلا
// يتطابقان، فيشكّ في الرقم بدل أن يعمل به. وهما هنا متجاوران فلا مقارنة تُحسَب
// في الرأس ولا خطأ يقع عند التسليم.
import { FileText } from 'lucide-react';
import DocumentFamilyPage, { commonColumns, type DocColumn, type DocField } from '@/components/vehicles/DocumentFamilyPage';
import { fmtDate } from '@/lib/vehicleRegistry';

const COLUMNS: DocColumn[] = [
  ...commonColumns(),
  { key: 'expiryDate', ar: 'انتهاء رخصة السير (ميلادي)', en: 'Licence expiry (Gregorian)', get: (v) => fmtDate(v.vehicleLicense?.expiryDate), width: 18 },
  { key: 'expiryDateHijri', ar: 'انتهاء رخصة السير (هجري)', en: 'Licence expiry (Hijri)', mono: true, get: (v) => v.vehicleLicense?.expiryDateHijri, width: 18 },
];

// التاريخان يُكتبان معًا لا أحدُهما: الرخصة في اليد هجريّة، والنظام يحسب
// بالميلاديّ. من أدخل واحدًا وترك الآخر أعاد الخلافَ الذي جاء العمودان لرفعه.
const FIELDS: DocField[] = [
  { path: 'vehicleLicense.expiryDate', ar: 'انتهاء رخصة السير (ميلادي)', en: 'Licence expiry (Gregorian)', kind: 'date' },
  { path: 'vehicleLicense.expiryDateHijri', ar: 'انتهاء رخصة السير (هجري)', en: 'Licence expiry (Hijri)', mono: true },
];

export default function Page() {
  return (
    <DocumentFamilyPage
      docKey="vehicleLicense"
      path="/system/vehicles/registry/licenses"
      icon={<FileText className="w-5 h-5" />}
      titleAr="رخص السير" titleEn="Vehicle Licences"
      subtitleAr="تاريخ انتهاء رخصة السير لكل مركبة — بالهجري والميلادي معًا"
      subtitleEn="Licence expiry per vehicle — Hijri alongside Gregorian"
      fileName="vehicle-licenses"
      columns={COLUMNS}
      fields={FIELDS}
      searchIn={(v) => [v.plateNumber, v.ownerNameAr, v.departmentAr, v.vehicleLicense?.expiryDateHijri]}
    />
  );
}
