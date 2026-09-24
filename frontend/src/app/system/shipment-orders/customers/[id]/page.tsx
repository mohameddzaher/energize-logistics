'use client';
// ملفُّ العميل من قسم طلبات الشحنات — نفسُ ملفّه في التشغيل حرفًا بحرف.
import { useParams } from 'next/navigation';
import CustomerProfile from '@/components/customers/CustomerProfile';

export default function ShipmentOrderCustomerProfilePage() {
  const params = useParams();
  return <CustomerProfile id={String(params?.id || '')} basePath="/system/shipment-orders/customers" />;
}
