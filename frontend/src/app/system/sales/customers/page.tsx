'use client';
// Sales customers: the same register as shipment orders and operations, one component and one data set, so an edit from any door shows in the other two (see components/customers).
import CustomersRegister from '@/components/customers/CustomersRegister';

export default function SalesCustomersPage() {
  return <CustomersRegister basePath="/system/sales/customers" />;
}
