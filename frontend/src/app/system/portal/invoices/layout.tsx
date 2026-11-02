'use client';
// Invoices and payments are shown only to partners the server offers the `finance` service, never to the customer.
import PortalFinanceGate from '@/components/portal/PortalFinanceGate';

export default function Layout({ children }: { children: React.ReactNode }) {
  return <PortalFinanceGate>{children}</PortalFinanceGate>;
}
