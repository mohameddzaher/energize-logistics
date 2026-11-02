'use client';
// Customer file from the sales section: identical to the operations and shipment-orders file, with its route prices and tiers.
import { useParams } from 'next/navigation';
import CustomerProfile from '@/components/customers/CustomerProfile';

export default function SalesCustomerProfilePage() {
  const params = useParams();
  return <CustomerProfile id={String(params?.id || '')} basePath="/system/sales/customers" />;
}
