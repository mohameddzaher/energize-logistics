'use client';
// Finance: the staff requests sent to the finance department.
import IncomingRequests from '@/components/hr/IncomingRequests';

export default function FinanceStaffRequestsPage() {
  return <IncomingRequests target="Accounting"
    title={{ ar: 'طلبات الموظفين — الإدارة المالية', en: 'Staff Requests — Finance' }}
    subtitle={{ ar: 'الطلبات التي حُوِّلت إلى الإدارة المالية: حوِّلها، أو أنجزها، أو ارفضها.', en: 'Requests sent to finance: forward, handle or reject them.' }} />;
}
