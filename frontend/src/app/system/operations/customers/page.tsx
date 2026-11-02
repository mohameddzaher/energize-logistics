'use client';
// Operations customers: the same register as shipment orders, shared as a single component to avoid divergence.
import CustomersRegister from '@/components/customers/CustomersRegister';

export default function OperationsCustomersPage() {
  return <CustomersRegister basePath="/system/operations/customers" />;
}
