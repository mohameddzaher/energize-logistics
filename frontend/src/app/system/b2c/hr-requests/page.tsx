'use client';
// طلباتُ قسم الأفراد إلى الموارد البشريّة — الجانبُ المُرسِل. الشاشةُ واحدةٌ
// للطرفين (راجع components/hr/StaffRequests) كي لا تفترق الكلماتُ والحالات.
import StaffRequests from '@/components/hr/StaffRequests';

export default function B2cHrRequestsPage() {
  return <StaffRequests side="section" section="B2C" />;
}
