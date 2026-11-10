'use client';
// «طلب شحنة» page body: the asker's requests open first, with a «طلب شحنة جديد» button in the header that opens the form. Rendered by the Shipment Orders and Sales pages alike.
import { useState } from 'react';
import { useAuth } from '@/context/AuthContext';
import { useLanguage } from '@/context/LanguageContext';
import { PageHeader } from '@/components/hr/HRKit';
import ShipmentRequestForm from '@/components/shipment-orders/ShipmentRequestForm';
import ShipmentRequestsBoard from '@/components/shipment-orders/ShipmentRequestsBoard';
import { canAsk } from '@/lib/shipmentRequests';
import { ClipboardList, Plus, ArrowRight, ArrowLeft } from 'lucide-react';

export default function ShipmentRequestPage() {
  const { user } = useAuth();
  const { lang, isRTL } = useLanguage();
  const ar = lang === 'ar';
  const [creating, setCreating] = useState(false);
  if (!canAsk(user)) return <div className="p-8 text-slate-500">{ar ? 'لا تملك صلاحية.' : 'Not authorized.'}</div>;
  const Back = isRTL ? ArrowRight : ArrowLeft;
  return (
    <div className="space-y-4" dir={isRTL ? 'rtl' : 'ltr'}>
      <PageHeader icon={<ClipboardList className="w-6 h-6 text-[#f37121]" />}
        title={creating ? (ar ? 'طلب شحنة جديد' : 'New shipment request') : (ar ? 'طلبات الشحن' : 'Shipment requests')}
        subtitle={ar ? 'يكتب فريقُ المبيعات الحمولةَ كما بِيعت، ويُكملها فريقُ الموردين إلى أمر نقل' : 'Sales writes the load as sold; the vendors team completes it into a transport order'}>
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
      {creating ? <ShipmentRequestForm onDone={() => setCreating(false)} /> : <ShipmentRequestsBoard mode="sales" />}
    </div>
  );
}
