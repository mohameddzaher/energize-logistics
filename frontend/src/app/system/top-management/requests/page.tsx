'use client';
// Top management: every staff request to HR across the company.
import StaffRequestsDesk from '@/components/hr/StaffRequestsDesk';

export default function TopManagementRequestsPage() {
  return <StaffRequestsDesk base="/api/top-management" title={{ ar: 'طلبات الموظفين — الإدارة العليا', en: 'Staff Requests — Top Management' }} subtitle={{ ar: 'كل ما طلبه الموظفون من الموارد البشرية (أوراق، خطابات، مستندات…) وحالته الآن.', en: 'Everything staff asked HR for (letters, documents…) and where it stands.' }} />;
}
