'use client';
// عملاء طلبات الشحنات — غلافٌ رقيق: الشاشةُ نفسُها تُفتح من التشغيل أيضًا،
// فأيُّ تعديلٍ يظهر في الموضعين معًا (راجع components/customers).
import CustomersRegister from '@/components/customers/CustomersRegister';

export default function ShipmentOrderCustomersPage() {
  return <CustomersRegister basePath="/system/shipment-orders/customers" />;
}
