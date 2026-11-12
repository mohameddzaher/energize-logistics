'use client';
// Finance: every leave in the company; it decides its stage right after the direct manager (pay, advances, custody), then HR.
import { useAuth } from '@/context/AuthContext';
import LeaveDesk from '@/components/hr/LeaveDesk';

const FINANCE_ROLES = ['cfo', 'accounting_manager', 'accounting_team_leader', 'accountant'];

export default function FinanceLeavesPage() {
  const { user } = useAuth();
  // role-only: the finance stage follows backend utils/leaveChain FINANCE_ROLES.
  const canDecide = FINANCE_ROLES.includes(user?.role || '') || ['super_admin', 'admin', 'it_manager', 'it_team_leader', 'it_specialist'].includes(user?.role || '');
  return (
    <LeaveDesk base="/api/finance-desk" stage="finance" canDecide={canDecide}
      title={{ ar: 'طلبات الإجازات — الإدارة المالية', en: 'Leave Requests — Finance' }}
      subtitle={{ ar: 'الطلب يصلك بعد موافقة المدير المباشر. راجِع المستحقات والسُّلف والعُهد ثم وافق، فيذهب إلى الموارد البشرية.', en: 'Requests reach you after the direct manager. Check dues, advances and custody, then approve; it goes to HR.' }} />
  );
}
