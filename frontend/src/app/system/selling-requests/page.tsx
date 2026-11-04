'use client';
// Selling-price change requests from the data team, for approvers who may not open the workflow page.
import { useEffect, useState } from 'react';
import { BadgeDollarSign } from 'lucide-react';
import api from '@/lib/api';
import { useLanguage } from '@/context/LanguageContext';
import SellingPriceRequests from '@/components/operations/SellingPriceRequests';

export default function SellingRequestsPage() {
  const { lang } = useLanguage();
  const ar = lang === 'ar';
  // The server decides who approves; null while asking.
  const [allowed, setAllowed] = useState<boolean | null>(null);
  useEffect(() => {
    api.get<{ canApprove: boolean }>('/api/selling-price-requests/count')
      .then((d) => setAllowed(!!d?.canApprove)).catch(() => setAllowed(false));
  }, []);

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold text-slate-900 flex items-center gap-2">
          <BadgeDollarSign className="w-6 h-6 text-[#f37121]" />
          {ar ? 'طلبات تعديل سعر البيع' : 'Selling-price change requests'}
        </h1>
        <p className="text-sm text-slate-500 mt-1">
          {ar ? 'تعديلات سعر البيع من فريق البيانات لا تُطبَّق حتى تُعتمد هنا؛ الاعتماد يكتب السعر في سير العمل والشحنة معًا.'
            : 'Selling-price edits from the data team apply only once approved here; approval writes the price to the workflow and the shipment.'}
        </p>
      </div>
      {allowed === null ? null : allowed ? <SellingPriceRequests ar={ar} /> : (
        <div className="text-slate-500 p-8">{ar ? 'هذه الصفحة لمدير المبيعات والإدارة العليا ومدير النظام.' : 'For the sales manager, top management and system admins.'}</div>
      )}
    </div>
  );
}
