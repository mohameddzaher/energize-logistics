'use client';
// HR: the staff requests sent to HR. HR forwards a request to another department, handles it, or rejects it.
import IncomingRequests from '@/components/hr/IncomingRequests';

export default function HRRequestsPage() {
  return <IncomingRequests target="HR"
    title={{ ar: 'طلبات الموظفين — الموارد البشرية', en: 'Staff Requests — HR' }}
    subtitle={{ ar: 'الطلبات التي حُوِّلت إلى الموارد البشرية من المدير المباشر أو من قسم آخر، أو أرسلها مدير قسم.', en: 'Requests sent to HR by a direct manager, another department, or a department manager.' }} />;
}
