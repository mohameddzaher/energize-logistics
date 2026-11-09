'use client';
// Freelance drivers: carriers who are one person with their own truck. The same register, narrowed to them.
import { useLanguage } from '@/context/LanguageContext';
import FleetRegister from '@/components/shipment-orders/FleetRegister';

export default function FreelanceDriversPage() {
  const { lang } = useLanguage();
  const ar = lang === 'ar';
  return <FleetRegister initialTab="suppliers" supplierType="freelancer" title={ar ? 'السائقون الأفراد' : 'Freelance drivers'} subtitle={ar ? 'سائقون يعملون بسياراتهم مباشرةً — الهدف تقليلُ الاعتماد عليهم لصالح الشركات المتعاقدة' : 'Drivers working with their own trucks'} />;
}
