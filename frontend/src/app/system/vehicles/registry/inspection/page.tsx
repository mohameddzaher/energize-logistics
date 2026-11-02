'use client';
// Periodic inspection: when each vehicle's inspection expires.
// "Not required" is a healthy state here, not a gap: a trailer is not inspected like a truck. Counting it as a gap inflates the required-work number shown to management with vehicles that need no work.
import { ClipboardCheck } from 'lucide-react';
import DocumentFamilyPage, { commonColumns, type DocColumn, type DocField } from '@/components/vehicles/DocumentFamilyPage';
import { fmtDate, toHijri } from '@/lib/vehicleRegistry';

// No "inspection status" column. It was a text column reading pass or not-required, while the status column computed from the expiry date says the same thing more currently: expired, near expiry, valid, not required, computed today and not written at the last import. Two columns saying one thing diverge after the first renewal and leave the reader unsure which to trust. The field itself is still written in the form; its display was removed, not its recording.
const COLUMNS: DocColumn[] = [
  ...commonColumns(),
  { key: 'expiryDate', ar: 'تاريخ انتهاء الفحص (ميلادي)', en: 'Inspection expiry (Gregorian)', get: (v) => fmtDate(v.inspection?.expiryDate), width: 18 },
  // Derived from the Gregorian date, not typed: a column filled twice diverges at the first renewal.
  { key: 'expiryDateHijri', ar: 'تاريخ انتهاء الفحص (هجري)', en: 'Inspection expiry (Hijri)', mono: true, get: (v) => toHijri(v.inspection?.expiryDate), width: 18 },
];

// Inspection status is not hand-written: it is derived from the expiry date and not-required, so it is removed from the edit form to avoid values that contradict the date. Only the expiry date remains, Hijri or Gregorian, each filling the other (HijriGregorianField). The stored field stays in the database as imported.
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
