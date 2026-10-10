'use client';
// ملفُّ العميل من قسم المبيعات — نفسُ ملفّه في التشغيل وطلبات الشحنات حرفًا
// بحرف، بأسعار مساراته وشرائحها.
import { useParams } from 'next/navigation';
import CustomerProfile from '@/components/customers/CustomerProfile';

export default function SalesCustomerProfilePage() {
  const params = useParams();
  return <CustomerProfile id={String(params?.id || '')} basePath="/system/sales/customers" />;
}
