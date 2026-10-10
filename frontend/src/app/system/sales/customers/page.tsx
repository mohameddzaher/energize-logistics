'use client';
// عملاء المبيعات — سجلُّ «طلبات الشحنات» و«التشغيل» نفسُه بلا نسخ: مكوّنٌ واحدٌ
// وبياناتٌ واحدة، فما يُعدَّل من أيّ بابٍ يظهر في البابين الآخرين (راجع
// components/customers).
import CustomersRegister from '@/components/customers/CustomersRegister';

export default function SalesCustomersPage() {
  return <CustomersRegister basePath="/system/sales/customers" />;
}
