'use client';
// «طلب شحنة» page body: a new request on one tab and the asker's requests on the other. Rendered by the Shipment Orders and Sales pages alike.
import { useState } from 'react';
import { useAuth } from '@/context/AuthContext';
import { useLanguage } from '@/context/LanguageContext';
import { PageHeader } from '@/components/hr/HRKit';
import ShipmentRequestForm from '@/components/shipment-orders/ShipmentRequestForm';
import ShipmentRequestsBoard from '@/components/shipment-orders/ShipmentRequestsBoard';
import { canAsk } from '@/lib/shipmentRequests';
import { ClipboardList, FilePlus2, ListChecks } from 'lucide-react';

export default function ShipmentRequestPage() {
  const { user } = useAuth();
  const { lang, isRTL } = useLanguage();
  const ar = lang === 'ar';
  const [tab, setTab] = useState<'new' | 'mine'>(() => (typeof window !== 'undefined' && new URLSearchParams(window.location.search).get('id') ? 'mine' : 'new'));
  if (!canAsk(user)) return <div className="p-8 text-slate-500">{ar ? 'لا تملك صلاحية.' : 'Not authorized.'}</div>;
  return (
    <div className="space-y-4" dir={isRTL ? 'rtl' : 'ltr'}>
      <PageHeader icon={<ClipboardList className="w-6 h-6 text-[#f37121]" />}
        title={ar ? 'طلب شحنة' : 'Shipment request'}
        subtitle={ar ? 'يكتب فريقُ المبيعات الحمولةَ كما بِيعت، ويُكملها فريقُ الموردين إلى أمر نقل' : 'Sales writes the load as sold; the vendors team completes it into a transport order'} />
      <div className="inline-flex rounded-xl border border-slate-200 bg-white p-1 shadow-sm">
        {([['new', FilePlus2, 'طلبٌ جديد', 'New request'], ['mine', ListChecks, 'طلباتي ومتابعتها', 'My requests']] as const).map(([k, Icon, a, e]) => (
          <button key={k} type="button" onClick={() => setTab(k)}
            className={`inline-flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-semibold ${tab === k ? 'bg-slate-900 text-white' : 'text-slate-600 hover:bg-slate-100'}`}>
            <Icon className={`w-4 h-4 ${tab === k ? 'text-[#f37121]' : 'text-slate-400'}`} />{ar ? a : e}
          </button>
        ))}
      </div>
      {tab === 'new' ? <ShipmentRequestForm onDone={() => setTab('mine')} /> : <ShipmentRequestsBoard mode="sales" />}
    </div>
  );
}
