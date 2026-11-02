'use client';
// HR requests from the personnel department, sender side. One screen serves both parties (see components/hr/StaffRequests) so wording and statuses stay in sync.
import StaffRequests from '@/components/hr/StaffRequests';

export default function B2cHrRequestsPage() {
  return <StaffRequests side="section" section="B2C" />;
}
