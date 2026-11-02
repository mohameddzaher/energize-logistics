'use client';
/** Customs clearance finance: what awaits payment first, then the department figures. Cards and tables say what happened (revenue, cost, profit), and disbursement requests say what waits: an invoice the clearance employee attached means pay this. This used to be said by phone; it now sits on the screen the accountant already opens. Every transaction number on the page, in requests and in the transactions table, opens its window here (ClearanceQuickView), not a department screen that finance cannot open. */
import { useState } from 'react';
import { useLanguage } from '@/context/LanguageContext';
import FinanceDeptView from '@/components/finance/FinanceDeptView';
import CustomsPaymentRequests from '@/components/finance/CustomsPaymentRequests';
import CustomsInvoiceRequests from '@/components/finance/CustomsInvoiceRequests';
import CustomsCustomerInvoices from '@/components/finance/CustomsCustomerInvoices';
import ClearanceQuickView from '@/components/customs/ClearanceQuickView';

export default function Page() {
  const { lang } = useLanguage();
  const [openId, setOpenId] = useState<string | null>(null);
  return (
    <div className="space-y-6">
      <CustomsPaymentRequests onOpen={setOpenId} />
      {/* Invoicing requests, distinct from disbursement requests: these are what we invoice. */}
      <CustomsInvoiceRequests ar={lang === 'ar'} onOpen={setOpenId} />
      {/* What customs clearance issued to be invoiced; those whose transport invoice has not arrived are red. */}
      <CustomsCustomerInvoices onOpen={setOpenId} />
      <FinanceDeptView dept="customs" onOpenRow={(r) => { if (r._customsId) setOpenId(String(r._customsId)); }} />
      {openId && <ClearanceQuickView id={openId} ar={lang === 'ar'} onClose={() => setOpenId(null)} />}
    </div>
  );
}
