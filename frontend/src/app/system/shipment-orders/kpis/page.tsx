'use client';
// Section copy of the performance dashboard. The API already limits results to the signed-in manager's team, so no extra filtering is needed here.
import { useLanguage } from '@/context/LanguageContext';
import TeamBoard from '@/components/performance/TeamBoard';

export default function Page() {
  const { lang } = useLanguage();
  const ar = lang === 'ar';
  return <TeamBoard section="Shipment Orders" title={ar ? 'تقييم أداء — طلبات الشحنات' : 'Performance — Shipment Orders'} />;
}
