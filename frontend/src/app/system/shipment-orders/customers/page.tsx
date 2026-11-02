'use client';
// Shipment-orders customers: a thin wrapper; the same screen also opens from operations, so any edit shows in both (see components/customers).
import CustomersRegister from '@/components/customers/CustomersRegister';

export default function ShipmentOrderCustomersPage() {
  return <CustomersRegister basePath="/system/shipment-orders/customers" />;
}
