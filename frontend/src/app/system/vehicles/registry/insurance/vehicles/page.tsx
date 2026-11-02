'use client';
// Vehicle insurance, vehicle by vehicle.
// This differs from the adjacent vehicle insurance documents page: that one lists documents (49 documents covering 335 vehicles), and renewing a document applies to all its vehicles at once. This one lists vehicles, because the question comes both ways: what does this document cover, and which document insures this vehicle, until when and for how much. The second had no answer on any screen.
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
    // A vehicle whose premium is paid by the financier is not "no premium": it is insured and the figure is with the financier. Blanking the field made it count as uninsured in the finance manager's report.
    get: (v) => (v.insurance?.premiumSar != null ? money(v.insurance.premiumSar)
      : v.insurance?.premiumStatusAr || ''),
  },
];

// "Premium payer" was removed from entry. It is a field nothing builds on and no report reads: it is not filtered, summed or used in any calculation. Each form field costs the filler time, and an unread field is filled once and then neglected, turning into stale data believed fresh. The stored value stays in the register (the insured-value column reads it when the financier pays); its entry was removed, not its trace.
// The company is picked, not typed. Insurer, coverage type and premium payer have managed lists in section settings, and the edit from the vehicle registry page uses them. Editing from this page, where insurance is actually edited, was a free field, so one name was written in a thousand forms (three spellings of the same insurer), appearing as three companies in reports, so its premium is neither summed nor compared. A new company can be added to the list itself from where it is without leaving the screen.
const FIELDS: DocField[] = [
  { path: 'insurance.policyNumber', ar: 'رقم وثيقة التأمين', en: 'Policy number', mono: true },
  { path: 'insurance.companyAr', ar: 'شركة التأمين', en: 'Insurer', lookup: 'vehicle_insurance_company' },
  { path: 'insurance.coverageTypeAr', ar: 'نوع التأمين', en: 'Coverage type', lookup: 'vehicle_coverage_type' },
  { path: 'insurance.expiryDate', ar: 'تاريخ انتهاء التأمين', en: 'Insurance expiry', kind: 'date' },
  { path: 'insurance.premiumSar', ar: 'قيمة التأمين (ر.س)', en: 'Premium (SAR)', kind: 'number' },

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
