'use client';
/**
 * Heavy-transport store: spare parts.
 * The light-transport store uses the same screen with another scope: one store mechanism (in and out, balance after each movement, reversal by an opposite movement and never by deletion) with different items and balances. See `components/store/StoreScreen`.
 */
import { useAuth } from '@/context/AuthContext';
import StoreScreen from '@/components/store/StoreScreen';
import { isLs2Staff, isLs2Admin } from '@/lib/ls2';

const STORE_ADD_ROLES = ['super_admin', 'admin', 'it_manager', 'it_specialist', 'accountant', 'accounting_manager', 'cfo', 'vehicles_manager'];

export default function Ls2StorePage() {
  useAuth();
  return (
    <StoreScreen scope={{
      base: '/api/ls2/store',
      suppliersBase: '/api/ls2/suppliers',
      titleAr: 'مخزن النقل الثقيل', titleEn: 'Heavy Transport Store',
      subtitleAr: 'قطع الغيار — الرصيد والحركات', subtitleEn: 'Spare parts — stock & movements',
      /** Heavy-transport trucks from the Location mirror. They have no project (it is our fleet running on waybills), so their description and driver show in its place and the line under the field answers 'what is this vehicle?' as 'which project?' does in light transport. */
      plateSource: {
        url: '/api/ls2/vehicles',
        // The description comes from the vehicle register: its plate, brand and model.
        rows: (d: any) => (d.items || []).map((v: any) => ({
          plate: v.plate,
          rider: v.driver || '',
          detail: [v.registry?.plateNumber, v.registry?.brand || v.profile?.brand, v.registry?.model].filter(Boolean).join(' · ') || v.name,
        })),
      },
      unknownPlatesUrl: '/api/ls2/store/unknown-plates',
      canSee: (u: any) => isLs2Staff(u) || STORE_ADD_ROLES.includes(u?.role), canEdit: isLs2Admin,
      // role-only: the owner limited adding items to these roles.
      canAdd: (u: any) => STORE_ADD_ROLES.includes(u?.role),
      fileName: 'ls2-store',
    }} />
  );
}
