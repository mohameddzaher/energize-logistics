'use client';
// Top management (the general manager): every leave in the company; it decides its stage after HR, before the chairman.
import { useAuth } from '@/context/AuthContext';
import LeaveDesk from '@/components/hr/LeaveDesk';

export default function TopManagementLeavesPage() {
  const { user } = useAuth();
  // role-only: this stage belongs to the named top-management accounts (and super admins), not to a section grant.
  const canDecide = (user as any)?.isTopManagement === true || ['super_admin', 'admin'].includes(user?.role || '');
  return (
    <LeaveDesk base="/api/top-management" stage="executive" canDecide={canDecide}
      title={{ ar: 'طلبات الإجازات — الإدارة العليا', en: 'Leave Requests — Top Management' }}
      subtitle={{ ar: 'كل إجازات الشركة. قرارك بعد الموارد البشرية، وبعده تذهب إلى رئيس مجلس الإدارة.', en: 'Every leave in the company. You decide after HR; the chairman decides last.' }} />
  );
}
