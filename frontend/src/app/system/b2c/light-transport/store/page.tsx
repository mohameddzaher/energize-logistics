'use client';
/**
 * Light-transport store: motorcycle spare parts and rep supplies.
 * The store question is the same in both departments: what we have, what is left, who issued what on which vehicle, what is nearly out. So the mechanics are written once (`StoreScreen`) and take the department scope. Items and balances of the two stores are separate in the database (`warehouse`), so one balance is never read in the other or summed.
 */
import { useAuth } from '@/context/AuthContext';
import StoreScreen from '@/components/store/StoreScreen';
import { canSeeLT, canEditLT } from '@/lib/lightTransport';

export default function LightTransportStorePage() {
  useAuth();
  return (
    <StoreScreen scope={{
      base: '/api/light-transport/store',
      suppliersBase: '/api/light-transport/suppliers',
      titleAr: 'مخزن النقل الخفيف', titleEn: 'Light Transport Store',
      // Owner's rules for this store: no prices, stock only via in/out, the supplier's item name.
      noPrices: true, noInitialQty: true, supplierItemName: true,
      subtitleAr: 'قطع الغيار والمستلزمات — الرصيد والحركات', subtitleEn: 'Parts & supplies — stock & movements',
      /**
       * Vehicles and their projects.
       * Issue targets are the department's vehicles (motorcycles and rep vehicles, not Location Solutions trucks). The source used to be employees' plates only, so a vehicle without a rider never appeared and the project of those shown was unknown.
       * Now it comes from `orders/options`: the full department vehicle register (with type and make) joined to the current rider, giving project and branch. Joined by plate key because the two registers write plates in different formats.
       */
      plateSource: {
        url: '/api/light-transport/orders/options',
        rows: (d: any) => {
          const key = (v: any) => String(v ?? '').replace(/[^0-9A-Za-z\u0621-\u064A]/g, '').toUpperCase();
          const riderOf = new Map<string, any>();
          for (const e of (d.employees || [])) {
            const k = key(e.vehiclePlate);
            if (k && !riderOf.has(k)) riderOf.set(k, e);
          }
          const rows = (d.vehicles || []).map((v: any) => {
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
          const have = new Set(rows.map((r: any) => key(r.plate)));
          for (const [k, e] of riderOf) {
            if (!have.has(k) && e.vehiclePlate) {
              rows.push({ plate: e.vehiclePlate, project: e.projectAr || '', rider: e.name || '', city: e.cityAr || '', detail: '' });
            }
          }
          return rows.sort((a: any, b: any) => String(a.plate).localeCompare(String(b.plate)));
        },
      },
      canSee: canSeeLT, canEdit: canEditLT,
      fileName: 'light-transport-store',
    }} />
  );
}
