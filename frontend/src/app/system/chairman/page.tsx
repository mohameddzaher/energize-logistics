'use client';
// Chairman's office: every leave and every staff request, for information only. The chairman left the leave chain on 2026-11-07; top management's approval is final.
import { useState } from 'react';
import { useLanguage } from '@/context/LanguageContext';
import { Tabs } from '@/components/hr/HRKit';
import LeaveDesk from '@/components/hr/LeaveDesk';
import StaffRequestsDesk from '@/components/hr/StaffRequestsDesk';

export default function ChairmanOfficePage() {
  const { lang } = useLanguage();
  const ar = lang === 'ar';
  const [tab, setTab] = useState<'leaves' | 'requests'>('leaves');
  return (
    <div className="space-y-3 w-full">
      <Tabs active={tab} onChange={(k) => setTab(k as 'leaves' | 'requests')}
        tabs={[
          { key: 'leaves', label: ar ? 'طلبات الإجازات' : 'Leave requests' },
          { key: 'requests', label: ar ? 'طلبات الموظفين' : 'Staff requests' },
        ]} />
      {tab === 'leaves' ? (
        <LeaveDesk base="/api/chairman" stage="executive" canDecide={false}
          title={{ ar: 'اعتمادات رئيس مجلس الإدارة — الإجازات', en: "Chairman's Approvals — Leaves" }}
          subtitle={{ ar: 'إجازات الشركة وحالتها.', en: 'Company leaves and where they stand.' }} />
      ) : (
        <StaffRequestsDesk base="/api/chairman"
          title={{ ar: 'اعتمادات رئيس مجلس الإدارة — طلبات الموظفين', en: "Chairman's Approvals — Staff Requests" }}
          subtitle={{ ar: 'كل ما طلبه الموظفون من الموارد البشرية وحالته الآن، للاطّلاع.', en: 'Everything staff asked HR for and where it stands, for information.' }} />
      )}
    </div>
  );
}
