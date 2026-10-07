'use client';
// طلباتُ الأقسام في الموارد البشريّة — الجانبُ المستقبِل: تُستلَم ثمّ تُنفَّذ
// أو تُرفَض بسببٍ مكتوب، وبجانب كلّ اسمٍ زرٌّ يفتح ملفَّه ليُعدَّل من هناك.
import StaffRequests from '@/components/hr/StaffRequests';

export default function HrStaffRequestsPage() {
  return <StaffRequests side="hr" />;
}
