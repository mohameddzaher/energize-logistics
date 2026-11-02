'use client';
// GPS tracking devices: the device, its status, provider, serial, and when its subscription ends.
// Device status differs from subscription status: a stolen device can have a valid subscription, and an expired subscription does not mean the device was removed. Mixing them in one column leaves "how many vehicles have no effective tracking?" unanswerable, which is a platform requirement and not a nicety.
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

// Device status is a field independent of the subscription date, as in the column: a stolen device with a valid subscription is a real state, and deriving one from the other would lose it.
// Device, company and status are picked from section lists, not typed free; as in the insurance page, a free name is written in variants and becomes several devices in reports when it is one.
const FIELDS: DocField[] = [
  { path: 'gps.deviceModel', ar: 'جهاز GPS', en: 'GPS device', lookup: 'vehicle_gps_device' },
  { path: 'gps.deviceStatusAr', ar: 'حالة جهاز GPS', en: 'Device status', lookup: 'vehicle_gps_device_status' },
  { path: 'gps.provider', ar: 'شركة الـGPS', en: 'GPS provider', lookup: 'vehicle_gps_provider' },
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
