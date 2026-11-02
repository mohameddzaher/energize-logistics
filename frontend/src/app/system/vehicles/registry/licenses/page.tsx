'use client';
// Vehicle licenses: license expiry per vehicle, in both Hijri and Gregorian.
// The paper is printed in Hijri but days left are computed in Gregorian, so both show side by side to avoid mental conversion.
import { FileText } from 'lucide-react';
import DocumentFamilyPage, { commonColumns, type DocColumn, type DocField } from '@/components/vehicles/DocumentFamilyPage';
import { fmtDate, toHijri } from '@/lib/vehicleRegistry';

const COLUMNS: DocColumn[] = [
  ...commonColumns(),
  { key: 'expiryDate', ar: 'انتهاء رخصة السير', en: 'Licence expiry', get: (v) => fmtDate(v.vehicleLicense?.expiryDate), width: 18 },
  // Derived from the Gregorian date, not typed: a column filled twice drifts apart at the first renewal.
  { key: 'expiryDateHijri', ar: 'انتهاء رخصة السير (هجري)', en: 'Licence expiry (Hijri)', mono: true, get: (v) => toHijri(v.vehicleLicense?.expiryDate), width: 18 },
];

// Both dates are written together: the paper is Hijri, the system computes in Gregorian. Entering only one brings back the mismatch the two columns exist to remove.
const FIELDS: DocField[] = [
  { path: 'vehicleLicense.expiryDate', ar: 'انتهاء رخصة السير', en: 'Licence expiry', kind: 'date' },
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
      searchIn={(v) => [v.plateNumber, v.ownerNameAr, v.departmentAr, toHijri(v.vehicleLicense?.expiryDate)]}
    />
  );
}
