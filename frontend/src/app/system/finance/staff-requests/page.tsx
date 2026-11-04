'use client';
// Finance: every staff request to HR across the company, read to follow what touches pay and advances.
import StaffRequestsDesk from '@/components/hr/StaffRequestsDesk';

export default function FinanceStaffRequestsPage() {
  return <StaffRequestsDesk base="/api/finance-desk" title={{ ar: 'طلبات الموظفين — الإدارة المالية', en: 'Staff Requests — Finance' }} subtitle={{ ar: 'كل ما طلبه الموظفون من الموارد البشرية (أوراق، خطابات، مستندات…) وحالته الآن.', en: 'Everything staff asked HR for (letters, documents…) and where it stands.' }} />;
}
