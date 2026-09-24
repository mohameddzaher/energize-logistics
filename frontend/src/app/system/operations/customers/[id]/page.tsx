'use client';
// ملفُّ العميل من قسم التشغيل — نفسُ ملفّه في طلبات الشحنات حرفًا بحرف.
import { useParams } from 'next/navigation';
import CustomerProfile from '@/components/customers/CustomerProfile';

export default function OperationsCustomerProfilePage() {
  const params = useParams();
  return <CustomerProfile id={String(params?.id || '')} basePath="/system/operations/customers" />;
}
