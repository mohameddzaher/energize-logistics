'use client';
// Customer file for the Operations section; identical to the same customer's file in shipment orders.
import { useParams } from 'next/navigation';
import CustomerProfile from '@/components/customers/CustomerProfile';

export default function OperationsCustomerProfilePage() {
  const params = useParams();
  return <CustomerProfile id={String(params?.id || '')} basePath="/system/operations/customers" />;
}
