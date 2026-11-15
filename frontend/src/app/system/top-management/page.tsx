'use client';
// Top management (the general manager): every leave in the company; it decides its stage after HR, and its approval is final.
import { useAuth } from '@/context/AuthContext';
import LeaveDesk from '@/components/hr/LeaveDesk';

export default function TopManagementLeavesPage() {
  const { user } = useAuth();
  // role-only: this stage belongs to the named top-management accounts (and super admins), not to a section grant.
  const canDecide = (user as any)?.isTopManagement === true || ['super_admin', 'admin', 'it_manager', 'it_team_leader', 'it_specialist'].includes(user?.role || '');
  return (
    <LeaveDesk base="/api/top-management" stage="executive" canDecide={canDecide}
      title={{ ar: 'طلبات الإجازات — الإدارة العليا', en: 'Leave Requests — Top Management' }}
      subtitle={{ ar: 'كل إجازات الشركة. قرارك بعد الموارد البشرية، وموافقتك هي الاعتماد النهائي.', en: 'Every leave in the company. You decide after HR; your approval is final.' }} />
  );
}
