'use client';
// أجهزة التتبّع (GPS) — الجهازُ وحالتُه ومزوّدُه وسريالُه، ومتى ينتهي اشتراكه.
//
// وحالةُ الجهاز غيرُ حالة الاشتراك: جهازٌ مسروق قد يكون اشتراكه ساريًا، واشتراكٌ
// منتهٍ لا يعني أن الجهاز نُزع. خلطُهما في عمودٍ واحد يجعل «كم مركبة بلا تتبّع
// فعليّ؟» بلا إجابة — وهو شرطٌ من شروط منصّة لوجستي لا رفاهية.
import { Satellite } from 'lucide-react';
import DocumentFamilyPage, { commonColumns, type DocColumn, type DocField } from '@/components/vehicles/DocumentFamilyPage';
import { fmtDate } from '@/lib/vehicleRegistry';

const COLUMNS: DocColumn[] = [
  ...commonColumns(),
  { key: 'deviceModel', ar: 'جهاز GPS', en: 'GPS device', get: (v) => v.gps?.deviceModel, width: 20 },
  { key: 'deviceStatusAr', ar: 'حالة جهاز GPS', en: 'Device status', get: (v) => v.gps?.deviceStatusAr, width: 14 },
  { key: 'provider', ar: 'شركة الـGPS', en: 'GPS provider', get: (v) => v.gps?.provider, width: 18 },
  { key: 'serialImei', ar: 'سريال GPS', en: 'GPS serial', mono: true, get: (v) => v.gps?.serialImei, width: 22 },
  { key: 'expiryDate', ar: 'تاريخ انتهاء الـGPS', en: 'Subscription expiry', get: (v) => fmtDate(v.gps?.expiryDate), width: 14 },
];

// وحالةُ الجهاز حقلٌ مستقلّ عن تاريخ الاشتراك، كما هي في العمود: جهازٌ مسروق
// باشتراكٍ ساري وضعٌ قائم، ولو اشتُقّت إحداهما من الأخرى لضاع.
const FIELDS: DocField[] = [
  { path: 'gps.deviceModel', ar: 'جهاز GPS', en: 'GPS device' },
  { path: 'gps.deviceStatusAr', ar: 'حالة جهاز GPS', en: 'Device status' },
  { path: 'gps.provider', ar: 'شركة الـGPS', en: 'GPS provider' },
  { path: 'gps.serialImei', ar: 'سريال GPS', en: 'GPS serial', mono: true },
  { path: 'gps.simNumber', ar: 'رقم الشريحة', en: 'SIM number', mono: true },
  { path: 'gps.expiryDate', ar: 'تاريخ انتهاء الـGPS', en: 'Subscription expiry', kind: 'date' },
];

export default function Page() {
  return (
    <DocumentFamilyPage
      docKey="gps"
      path="/system/vehicles/registry/gps"
      icon={<Satellite className="w-5 h-5" />}
      titleAr="أجهزة التتبّع GPS" titleEn="GPS Devices"
      subtitleAr="الجهاز وحالته ومزوّده وسرياله وتاريخ انتهاء اشتراكه — والتجديد يقبل سريالًا جديدًا"
      subtitleEn="Device, status, provider, serial and subscription expiry — renewal accepts a new serial"
      fileName="vehicle-gps"
      columns={COLUMNS}
      fields={FIELDS}
      searchIn={(v) => [v.plateNumber, v.gps?.serialImei, v.gps?.deviceModel, v.gps?.provider]}
    />
  );
}
