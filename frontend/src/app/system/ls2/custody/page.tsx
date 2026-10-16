'use client';
/**
 * عهدةُ النقل الثقيل — الكاش، وكارت المشتريات، والورشة. مثلُ عهدة النقل الخفيف،
 * ويُنسب الواردُ أو الصادرُ — اختيارًا — إلى سيّارةٍ من أسطول لوكيشن سوليوشن.
 * الشاشةُ في components/system/CustodyLedger، والقواعدُ في الخادم
 * (controllers/htCustodyController).
 */
import CustodyLedger, { type CustodyConfig } from '@/components/system/CustodyLedger';

const CFG: CustodyConfig = {
  api: '/api/ls2/custody',
  event: 'ht:custody',
  title: ['عهدة النقل الثقيل', 'Heavy transport custody'],
  // يطابق `CUSTODY_ROLES` في htCustodyController: مديرُ لوكيشن سوليوشن ومديرُ النظام وأهلُ المال.
  roles: ['super_admin', 'location_manager', 'cfo', 'accounting_manager', 'accountant'],
  exportPrefix: 'heavy-custody',
  rep: ['موظف', 'Employee'],
  repMissing: ['لا موظّفَ بهذا الرقم في الموارد البشريّة.', 'No employee with this number in HR.'],
  vehicles: true,
};

export default function HeavyCustodyPage() {
  return <CustodyLedger cfg={CFG} />;
}
