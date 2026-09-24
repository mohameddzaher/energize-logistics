'use client';
// عملاء التشغيل — نفسُ سجلّ «طلبات الشحنات» بلا نسخ: مكوّنٌ واحدٌ لا يفترق.
import CustomersRegister from '@/components/customers/CustomersRegister';

export default function OperationsCustomersPage() {
  return <CustomersRegister basePath="/system/operations/customers" />;
}
