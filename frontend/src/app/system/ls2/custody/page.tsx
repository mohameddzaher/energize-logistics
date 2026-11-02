'use client';
/**
 * Heavy-transport custody: cash, purchase card and workshop. Same as light-transport custody, with each in or out optionally attributed to a Location Solutions fleet vehicle.
 * The screen is in components/system/CustodyLedger and the rules are on the server (controllers/htCustodyController).
 */
import CustodyLedger, { type CustodyConfig } from '@/components/system/CustodyLedger';

const CFG: CustodyConfig = {
  api: '/api/ls2/custody',
  event: 'ht:custody',
  title: ['عهدة النقل الثقيل', 'Heavy transport custody'],
  // Matches `CUSTODY_ROLES` in htCustodyController: the Location Solutions manager, system admin and finance roles.
  roles: ['super_admin', 'admin', 'location_manager', 'vehicles_manager', 'cfo', 'accounting_manager', 'accountant'],
  exportPrefix: 'heavy-custody',
  rep: ['موظف', 'Employee'],
  repMissing: ['لا موظّفَ بهذا الرقم في الموارد البشريّة.', 'No employee with this number in HR.'],
  vehicles: true,
};

export default function HeavyCustodyPage() {
  return <CustodyLedger cfg={CFG} />;
}
