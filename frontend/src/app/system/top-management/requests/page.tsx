'use client';
// Top management: the staff requests sent to it, by a direct manager, a department, or a department manager.
import IncomingRequests from '@/components/hr/IncomingRequests';

export default function TopManagementRequestsPage() {
  return <IncomingRequests target="Top Management"
    title={{ ar: 'طلبات الموظفين — الإدارة العليا', en: 'Staff Requests — Top Management' }}
    subtitle={{ ar: 'الطلبات المرسلة إلى الإدارة العليا: من مدير مباشر أو قسم حوّلها، أو من مدير قسم مباشرةً.', en: 'Requests sent to top management: forwarded by a direct manager or a department, or sent by a department manager.' }} />;
}
