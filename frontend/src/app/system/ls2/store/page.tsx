'use client';
/**
 * Heavy-transport store: spare parts.
 * The light-transport store uses the same screen with another scope: one store mechanism (in and out, balance after each movement, reversal by an opposite movement and never by deletion) with different items and balances. See `components/store/StoreScreen`.
 * Issuing happens only through issue requests (طلب صرف), as in the light store; the items screen keeps receipts and closes its out actions.
 */
import { useState } from 'react';
import { useAuth } from '@/context/AuthContext';
import { useLanguage } from '@/context/LanguageContext';
import StoreScreen from '@/components/store/StoreScreen';
import IssueRequests from '@/components/store/IssueRequests';
import { Tabs } from '@/components/hr/HRKit';
import { isLs2Staff, isLs2Admin } from '@/lib/ls2';

const STORE_ADD_ROLES = ['super_admin', 'admin', 'it_manager', 'it_specialist', 'accountant', 'accounting_manager', 'cfo', 'vehicles_manager'];

/** Heavy-transport trucks from the Location mirror. They have no project (our fleet runs on waybills), so their description and driver show in its place. */
const plateSource = {
  url: '/api/ls2/vehicles',
  // The description comes from the vehicle register: its plate, brand and model.
  rows: (d: any) => (d.items || []).map((v: any) => ({
    plate: v.plate,
    rider: v.driver || '',
    detail: [v.registry?.plateNumber, v.registry?.brand || v.profile?.brand, v.registry?.model].filter(Boolean).join(' · ') || v.name,
  })),
};
const canSee = (u: any) => isLs2Staff(u) || STORE_ADD_ROLES.includes(u?.role);

export default function Ls2StorePage() {
  useAuth();
  const { lang } = useLanguage();
  const ar = lang === 'ar';
  const [tab, setTab] = useState<'requests' | 'items'>('requests');
  return (
    <div className="space-y-3 w-full">
      <Tabs active={tab} onChange={(k) => setTab(k as 'requests' | 'items')}
        tabs={[
          { key: 'requests', label: ar ? 'طلبات الصرف' : 'Issue requests' },
          { key: 'items', label: ar ? 'الأصناف والأرصدة' : 'Items & stock' },
        ]} />
      {tab === 'requests' ? (
        <IssueRequests scope={{
          base: '/api/ls2/store/issue-requests',
          itemsBase: '/api/ls2/store',
          plateSource,
          canSee, canEdit: isLs2Admin,
        }} />
      ) : (
        <StoreScreen scope={{
          base: '/api/ls2/store',
          suppliersBase: '/api/ls2/suppliers',
          titleAr: 'مخزن النقل الثقيل', titleEn: 'Heavy Transport Store',
          subtitleAr: 'قطع الغيار — الرصيد والحركات', subtitleEn: 'Spare parts — stock & movements',
          plateSource,
          unknownPlatesUrl: '/api/ls2/store/unknown-plates',
          // Stock leaves only through issue requests; receipts and everything else stay here.
          noDirectIssue: true,
          canSee, canEdit: isLs2Admin,
          // role-only: the owner limited adding items to these roles.
          canAdd: (u: any) => STORE_ADD_ROLES.includes(u?.role),
          fileName: 'ls2-store',
        }} />
      )}
    </div>
  );
}
