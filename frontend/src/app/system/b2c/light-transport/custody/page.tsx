'use client';
/**
 * Light-transport custody: cash, purchase card and workshop.
 * The screen is components/system/CustodyLedger (shared with heavy-transport custody); the rules are server-side (controllers/ltCustodyController).
 */
import CustodyLedger, { type CustodyConfig } from '@/components/system/CustodyLedger';

const CFG: CustodyConfig = {
  api: '/api/light-transport/custody',
  event: 'lt:custody',
  title: ['عهدة النقل الخفيف', 'Light transport custody'],
  // Matches `CUSTODY_ROLES` in ltCustodyController: sector manager, deputy, system admin and finance roles.
  roles: ['super_admin', 'admin', 'b2c_manager', 'b2c_deputy', 'vehicles_manager', 'cfo', 'accounting_manager', 'accountant'],
  exportPrefix: 'light-custody',
  rep: ['مندوب', 'Rep'],
  repMissing: ['لا مندوبَ بهذا الرقم في الموارد البشريّة ولا في سجلّ النقل الخفيف.', 'No rep with this number in HR or the light-transport register.'],
};

export default function LightCustodyPage() {
  return <CustodyLedger cfg={CFG} />;
}
