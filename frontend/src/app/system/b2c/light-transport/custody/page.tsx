'use client';
/**
 * عهدةُ النقل الخفيف — الكاش، وكارت المشتريات، والورشة.
 * الشاشةُ في components/system/CustodyLedger (مشتركةٌ مع عهدة النقل الثقيل)،
 * والقواعدُ في الخادم (controllers/ltCustodyController).
 */
import CustodyLedger, { type CustodyConfig } from '@/components/system/CustodyLedger';

const CFG: CustodyConfig = {
  api: '/api/light-transport/custody',
  event: 'lt:custody',
  title: ['عهدة النقل الخفيف', 'Light transport custody'],
  // يطابق `CUSTODY_ROLES` في ltCustodyController: مديرُ القطاع ونائبُه ومديرُ النظام وأهلُ المال.
  roles: ['super_admin', 'b2c_manager', 'b2c_deputy', 'cfo', 'accounting_manager', 'accountant'],
  exportPrefix: 'light-custody',
  rep: ['مندوب', 'Rep'],
  repMissing: ['لا مندوبَ بهذا الرقم في الموارد البشريّة ولا في سجلّ النقل الخفيف.', 'No rep with this number in HR or the light-transport register.'],
};

export default function LightCustodyPage() {
  return <CustodyLedger cfg={CFG} />;
}
