'use client';
// Chairman of the board: the final leave stage; a request arrives only after top management approves it.
import { useAuth } from '@/context/AuthContext';
import LeaveDesk from '@/components/hr/LeaveDesk';

export default function ChairmanLeavesPage() {
  const { user } = useAuth();
  // role-only: the final stage belongs to the chairman account (and super admins), not to a section grant.
  const canDecide = (user as any)?.isChairman === true || ['super_admin', 'admin', 'it_manager', 'it_specialist'].includes(user?.role || '');
  return (
    <LeaveDesk base="/api/chairman" stage="chairman" canDecide={canDecide}
      title={{ ar: 'اعتماد الإجازات — رئيس مجلس الإدارة', en: 'Leave Approval — Chairman of the Board' }}
      subtitle={{ ar: 'تصلك الإجازة بعد موافقة المدير المباشر والإدارة المالية والموارد البشرية والإدارة العليا. موافقتك هي الاعتماد النهائي.', en: 'A leave reaches you after the direct manager, finance, HR and top management. Your approval is final.' }} />
  );
}
