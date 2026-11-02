'use client';
// Customer file from the shipment-orders section: identical to the operations file.
import { useParams } from 'next/navigation';
import CustomerProfile from '@/components/customers/CustomerProfile';

export default function ShipmentOrderCustomerProfilePage() {
  const params = useParams();
  return <CustomerProfile id={String(params?.id || '')} basePath="/system/shipment-orders/customers" />;
}
