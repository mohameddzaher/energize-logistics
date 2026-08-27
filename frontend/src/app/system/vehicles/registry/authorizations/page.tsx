'use client';
// التفاويض — مَن هو المفوَّض على كل مركبة، وبأيّ ورقة، وإلى متى.
//
// لم تكن لهذه العائلة شاشة أصلًا. واسمُ المفوَّض وحده كان يظهر في سجلّات القسم
// بلا رقمِ إقامته ولا رقمِ تفويضه ولا مدّته — وهذه هي الورقة كلُّها. وانتهاء
// التفويض ليس خانةً فارغة: السائق حينئذٍ يقود بلا صفة، فتُقيَّد المخالفة على
// الشركة وتُنازِع شركةُ التأمين في التغطية عند أوّل حادث.
import { UserCheck } from 'lucide-react';
import DocumentFamilyPage, { commonColumns, type DocColumn, type DocField } from '@/components/vehicles/DocumentFamilyPage';
import { fmtDate } from '@/lib/vehicleRegistry';

const COLUMNS: DocColumn[] = [
  ...commonColumns(),
  { key: 'name', ar: 'اسم المفوَّض', en: 'Authorised person', get: (v) => v.authorizedPerson?.name, width: 26 },
  { key: 'iqamaNumber', ar: 'رقم الإقامة', en: 'Iqama number', mono: true, get: (v) => v.authorizedPerson?.iqamaNumber, width: 16 },
  { key: 'authorizationNumber', ar: 'رقم التفويض', en: 'Authorisation number', mono: true, get: (v) => v.authorizedPerson?.authorizationNumber, width: 20 },
  { key: 'startDate', ar: 'تاريخ بداية التفويض', en: 'Start date', get: (v) => fmtDate(v.authorizedPerson?.startDate), width: 14 },
  { key: 'expiryDate', ar: 'تاريخ نهاية التفويض', en: 'End date', get: (v) => fmtDate(v.authorizedPerson?.expiryDate), width: 14 },
];

// ورقةُ التفويض كاملةً: مَن، وبأيّ إقامة، وبأيّ رقم، ومن متى إلى متى. وناقصُها
// لا يُقرأ: اسمٌ بلا رقمِ تفويضٍ ولا مدّة لا يُثبِت صفةَ السائق أمام أحد.
const FIELDS: DocField[] = [
  { path: 'authorizedPerson.name', ar: 'اسم المفوَّض', en: 'Authorised person', wide: true },
  { path: 'authorizedPerson.iqamaNumber', ar: 'رقم الإقامة', en: 'Iqama number', mono: true },
  { path: 'authorizedPerson.jobTitleAr', ar: 'المسمّى الوظيفي', en: 'Job title' },
  { path: 'authorizedPerson.authorizationNumber', ar: 'رقم التفويض', en: 'Authorisation number', mono: true },
  { path: 'authorizedPerson.startDate', ar: 'تاريخ بداية التفويض', en: 'Start date', kind: 'date' },
  { path: 'authorizedPerson.expiryDate', ar: 'تاريخ نهاية التفويض', en: 'End date', kind: 'date' },
];

export default function Page() {
  return (
    <DocumentFamilyPage
      docKey="authorization"
      path="/system/vehicles/registry/authorizations"
      icon={<UserCheck className="w-5 h-5" />}
      titleAr="التفاويض" titleEn="Driving Authorisations"
      subtitleAr="المفوَّض على كل مركبة ورقم إقامته ورقم تفويضه ومدّته — والتجديد يقبل رقمًا جديدًا"
      subtitleEn="Who is authorised on each vehicle, their iqama, the authorisation number and its term"
      fileName="vehicle-authorizations"
      columns={COLUMNS}
      fields={FIELDS}
      searchIn={(v) => [v.plateNumber, v.authorizedPerson?.name, v.authorizedPerson?.iqamaNumber, v.authorizedPerson?.authorizationNumber]}
    />
  );
}
