'use client';
/**
 * Light-transport store: motorcycle spare parts and rep supplies.
 * The store question is the same in both departments: what we have, what is left, who issued what on which vehicle, what is nearly out. So the mechanics are written once (`StoreScreen`) and take the department scope. Items and balances of the two stores are separate in the database (`warehouse`), so one balance is never read in the other or summed.
 */
import { useState } from 'react';
import { useAuth } from '@/context/AuthContext';
import { useLanguage } from '@/context/LanguageContext';
import StoreScreen, { type PlateRow } from '@/components/store/StoreScreen';
import IssueRequests from '@/components/store/IssueRequests';
import { Tabs } from '@/components/hr/HRKit';
import { canSeeLT, canEditLT } from '@/lib/lightTransport';

/**
 * Vehicles and their projects.
 * Issue targets are the department's vehicles (motorcycles and rep vehicles, not Location Solutions trucks), from `orders/options`: the full department vehicle register joined to the current rider, giving project and branch. Joined by plate key because the two registers write plates in different formats.
 */
const plateSource = {
  url: '/api/light-transport/orders/options',
  rows: (d: any): PlateRow[] => {
    const key = (v: any) => String(v ?? '').replace(/[^0-9A-Za-z\u0621-\u064A]/g, '').toUpperCase();
    const riderOf = new Map<string, any>();
    for (const e of (d.employees || [])) {
      const k = key(e.vehiclePlate);
      if (k && !riderOf.has(k)) riderOf.set(k, e);
    }
    const rows: PlateRow[] = (d.vehicles || []).map((v: any) => {
      const r = riderOf.get(key(v.plateNumber));
      return {
        plate: v.plateNumber,
        project: r?.projectAr || '',
        rider: r?.name || v.authorizedName || '',
        city: r?.cityAr || '',
        detail: [v.typeAr, v.brand].filter(Boolean).join(' '),
      };
    });
    // A plate that belongs to an employee but is missing from the vehicle register is added: the issue has already happened.
    const have = new Set(rows.map((r) => key(r.plate)));
    for (const [k, e] of riderOf) {
      if (!have.has(k) && e.vehiclePlate) {
        rows.push({ plate: e.vehiclePlate, project: e.projectAr || '', rider: e.name || '', city: e.cityAr || '', detail: '' });
      }
    }
    return rows.sort((a, b) => String(a.plate).localeCompare(String(b.plate)));
  },
};

/** Issue requests open first: issuing from this store happens only through them. The items screen stays one tab away, unchanged except that its out actions are closed. */
export default function LightTransportStorePage() {
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
          base: '/api/light-transport/store/issue-requests',
          itemsBase: '/api/light-transport/store',
          plateSource,
          canSee: canSeeLT, canEdit: canEditLT,
        }} />
      ) : (
        <StoreScreen scope={{
          base: '/api/light-transport/store',
          suppliersBase: '/api/light-transport/suppliers',
          titleAr: 'مخزن النقل الخفيف', titleEn: 'Light Transport Store',
          // Owner's rules for this store: no prices, stock only via in/out, the supplier's item name.
          noPrices: true, noInitialQty: true, supplierItemName: true,
          subtitleAr: 'قطع الغيار والمستلزمات — الرصيد والحركات', subtitleEn: 'Parts & supplies — stock & movements',
          plateSource,
          // Stock leaves only through issue requests; receipts and everything else stay here.
          noDirectIssue: true,
          canSee: canSeeLT, canEdit: canEditLT,
          fileName: 'light-transport-store',
        }} />
      )}
    </div>
  );
}
