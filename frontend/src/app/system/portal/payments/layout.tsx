'use client';
// الفواتير والمدفوعات تُعرض فقط لمن يقدّم له الخادم خدمة `finance` — لا للعميل.
import PortalFinanceGate from '@/components/portal/PortalFinanceGate';

export default function Layout({ children }: { children: React.ReactNode }) {
  return <PortalFinanceGate>{children}</PortalFinanceGate>;
}
