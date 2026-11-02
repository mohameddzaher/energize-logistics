'use client';
// Department requests in HR, the receiving side: received, then executed or rejected with a written reason; beside each name a button opens his file to edit from there.
import StaffRequests from '@/components/hr/StaffRequests';

export default function HrStaffRequestsPage() {
  return <StaffRequests side="hr" />;
}
