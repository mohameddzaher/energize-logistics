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
  roles: ['super_admin', 'admin', 'it_manager', 'it_team_leader', 'it_specialist', 'location_manager', 'location_team_leader', 'vehicles_manager', 'vehicles_team_leader', 'cfo', 'accounting_manager', 'accounting_team_leader', 'accountant'],
  exportPrefix: 'heavy-custody',
  rep: ['موظف', 'Employee'],
  repMissing: ['لا موظّفَ بهذا الرقم في الموارد البشريّة.', 'No employee with this number in HR.'],
  vehicles: true,
};

export default function HeavyCustodyPage() {
  return <CustodyLedger cfg={CFG} />;
}
