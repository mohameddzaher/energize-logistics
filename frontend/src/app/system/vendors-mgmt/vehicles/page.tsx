'use client';
// The carriers' trucks: the same register as Shipment Orders «الموردون والمركبات», opened on the trucks.
import { useLanguage } from '@/context/LanguageContext';
import FleetRegister from '@/components/shipment-orders/FleetRegister';

export default function VendorVehiclesPage() {
  const { lang } = useLanguage();
  const ar = lang === 'ar';
  return <FleetRegister initialTab="vehicles" title={ar ? 'السيارات' : 'Trucks'} subtitle={ar ? 'شاحناتُ الموردين وسائقوها — السجلُّ نفسه في قسم طلبات الشحنات' : "Carriers' trucks and drivers — the same register as Shipment Orders"} />;
}
