'use client';
// «الطلبات من المبيعات» page body: the vendors team's inbox. Rendered by the Shipment Orders and Vendors Management pages alike.
import { useLanguage } from '@/context/LanguageContext';
import { useAuth } from '@/context/AuthContext';
import { PageHeader } from '@/components/hr/HRKit';
import ShipmentRequestsBoard from '@/components/shipment-orders/ShipmentRequestsBoard';
import { canPlace } from '@/lib/shipmentRequests';
import { Inbox } from 'lucide-react';

export default function ShipmentRequestsInbox() {
  const { user } = useAuth();
  const { lang, isRTL } = useLanguage();
  const ar = lang === 'ar';
  if (!canPlace(user)) return <div className="p-8 text-slate-500">{ar ? 'لا تملك صلاحية.' : 'Not authorized.'}</div>;
  return (
    <div className="space-y-4" dir={isRTL ? 'rtl' : 'ltr'}>
      <PageHeader icon={<Inbox className="w-6 h-6 text-[#f37121]" />}
        title={ar ? 'الطلبات من المبيعات' : 'Requests from sales'}
        subtitle={ar ? 'أسنِد المورّدَ والسيارةَ والسائقَ وسعرَ الشراء لكلّ شاحنة فتصيرَ أمرَ نقل، أو ارفض الطلب بسبب' : 'Place supplier, truck, driver and purchase price for each truck, or reject with a reason'} />
      <ShipmentRequestsBoard mode="vendors" />
    </div>
  );
}
