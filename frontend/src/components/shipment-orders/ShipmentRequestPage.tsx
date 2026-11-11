'use client';
// «طلب شحنة» page body: the asker's requests open first, with a «طلب شحنة جديد» button in the header that opens the form. Rendered by the Shipment Orders and Sales pages alike.
import { useState, useEffect, useCallback } from 'react';
import api from '@/lib/api';
import { useSocket } from '@/hooks/useSocket';
import ShipmentRequestApprovals from '@/components/shipment-orders/ShipmentRequestApprovals';
import { useAuth } from '@/context/AuthContext';
import { useLanguage } from '@/context/LanguageContext';
import { PageHeader } from '@/components/hr/HRKit';
import ShipmentRequestForm from '@/components/shipment-orders/ShipmentRequestForm';
import ShipmentRequestsBoard from '@/components/shipment-orders/ShipmentRequestsBoard';
import { canAsk } from '@/lib/shipmentRequests';
import { ClipboardList, Plus, ArrowRight, ArrowLeft, ClipboardCheck } from 'lucide-react';

export default function ShipmentRequestPage() {
  const { user } = useAuth();
  const { lang, isRTL } = useLanguage();
  const ar = lang === 'ar';
  const [creating, setCreating] = useState(false);
  // The sales manager and his delegates get a second view: the approvals.
  const [approver, setApprover] = useState<{ can: boolean; manage: boolean; pending: number }>({ can: false, manage: false, pending: 0 });
  const [view, setView] = useState<'mine' | 'approvals'>('mine');
  const loadApprover = useCallback(() => {
    if (!canAsk(user)) return;
    api.get<{ can?: { approve?: boolean; manageApprovers?: boolean }; approvalCounts?: Record<string, number> }>('/api/shipment-requests?approval=pending&approvalCounts=1&limit=1')
      .then((d) => setApprover({ can: !!d.can?.approve, manage: !!d.can?.manageApprovers, pending: d.approvalCounts?.pending || 0 })).catch(() => {});
  }, [user]);
  useEffect(() => { loadApprover(); }, [loadApprover]);
  useSocket('shipmentRequests:changed', loadApprover);
  if (!canAsk(user)) return <div className="p-8 text-slate-500">{ar ? 'لا تملك صلاحية.' : 'Not authorized.'}</div>;
  const Back = isRTL ? ArrowRight : ArrowLeft;
  return (
    <div className="space-y-4" dir={isRTL ? 'rtl' : 'ltr'}>
      <PageHeader icon={<ClipboardList className="w-6 h-6 text-[#f37121]" />}
        title={creating ? (ar ? 'طلب شحنة جديد' : 'New shipment request') : (ar ? 'طلبات الشحن' : 'Shipment requests')}
        subtitle={ar ? 'يكتب فريقُ المبيعات الحمولةَ كما بِيعت، ويعتمدها مديرُ المبيعات، ثمّ يُكملها فريقُ الموردين إلى أمر نقل' : 'Sales writes the load, the sales manager approves it, then the vendors team completes it'}>
        {approver.can && !creating && (
          <div className="inline-flex rounded-lg border border-slate-200 bg-white p-0.5">
            <button type="button" onClick={() => setView('mine')} className={`rounded-md px-3 py-1.5 text-[12.5px] font-semibold ${view === 'mine' ? 'bg-slate-900 text-white' : 'text-slate-600'}`}>{ar ? 'الطلبات' : 'Requests'}</button>
            <button type="button" onClick={() => setView('approvals')} className={`inline-flex items-center gap-1 rounded-md px-3 py-1.5 text-[12.5px] font-semibold ${view === 'approvals' ? 'bg-slate-900 text-white' : 'text-slate-600'}`}>
              <ClipboardCheck className="h-4 w-4" />{ar ? 'الاعتمادات' : 'Approvals'}
              {approver.pending > 0 && <span className="rounded-full bg-[#f37121] px-1.5 text-[11px] text-white tabular-nums">{approver.pending}</span>}
            </button>
          </div>
        )}
        {creating ? (
          <button type="button" onClick={() => setCreating(false)}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50">
            <Back className="h-4 w-4" />{ar ? 'رجوع إلى الطلبات' : 'Back to requests'}
          </button>
        ) : (
          <button type="button" onClick={() => setCreating(true)}
            className="inline-flex items-center gap-1.5 rounded-lg bg-[#f37121] px-4 py-2 text-sm font-bold text-white shadow-sm hover:bg-[#e06010]">
            <Plus className="h-4 w-4" />{ar ? 'طلب شحنة جديد' : 'New shipment request'}
          </button>
        )}
      </PageHeader>
      {creating ? <ShipmentRequestForm onDone={() => setCreating(false)} />
        : view === 'approvals' && approver.can ? <ShipmentRequestApprovals canManage={approver.manage} /> : <ShipmentRequestsBoard mode="sales" />}
    </div>
  );
}
