'use client';
// Sales-requests inbox page body: the working inbox. Rendered by Shipment Orders and Vendors Management (vendors) and by Fleet Management (fleet: completes on our own trucks).
import { useLanguage } from '@/context/LanguageContext';
import { useAuth } from '@/context/AuthContext';
import { PageHeader } from '@/components/hr/HRKit';
import ShipmentRequestsBoard from '@/components/shipment-orders/ShipmentRequestsBoard';
import { canPlace, canFleetPlace, isFollowup } from '@/lib/shipmentRequests';
import Link from 'next/link';
import { Inbox, PackageSearch } from 'lucide-react';

export default function ShipmentRequestsInbox({ mode = 'vendors' }: { mode?: 'vendors' | 'fleet' }) {
  const { user } = useAuth();
  const { lang, isRTL } = useLanguage();
  const ar = lang === 'ar';
  const fleet = mode === 'fleet';
  if (!(fleet ? canFleetPlace(user) : (canPlace(user) || isFollowup(user)))) return <div className="p-8 text-slate-500">{ar ? 'لا تملك صلاحية.' : 'Not authorized.'}</div>;
  return (
    <div className="space-y-4" dir={isRTL ? 'rtl' : 'ltr'}>
      <PageHeader icon={<Inbox className="w-6 h-6 text-[#f37121]" />}
        title={ar ? (fleet ? 'طلبات من المبيعات' : 'الطلبات من المبيعات') : 'Requests from sales'}
        subtitle={fleet
          ? (ar ? 'تولَّ الطلب، وسجّل ما حصّلتَه من سيارات، وأكمِله على سياراتنا فيصيرَ أمرَ نقلٍ وحمولةً في الأسطول' : 'Take a request, record trucks sourced, and complete it on our trucks')
          : (ar ? 'أسنِد المورّدَ والسيارةَ والسائقَ وسعرَ الشراء لكلّ شاحنة فتصيرَ أمرَ نقل، أو ارفض الطلب بسبب' : 'Place supplier, truck, driver and purchase price for each truck, or reject with a reason')}>
        {/* Placed trucks become transport orders: one click to where they live. */}
        <Link href={fleet ? '/system/fleet' : '/system/shipment-orders'}
          className="inline-flex items-center gap-2 rounded-lg bg-[#f37121] px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-[#e0651a]">
          <PackageSearch className="w-4 h-4" />{fleet ? (ar ? 'الحمولات' : 'Loads') : (ar ? 'صفحة الشحنات' : 'Shipments')}
        </Link>
      </PageHeader>
      <ShipmentRequestsBoard mode={mode} />
    </div>
  );
}
