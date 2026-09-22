'use client';
/**
 * ماليّاتُ التخليص الجمركيّ — ما ينتظر الدفعَ أوّلًا، ثمّ أرقامُ القسم.
 *
 * البطاقاتُ والجداولُ تقول ما وقع (إيرادٌ وتكلفةٌ وربح)، وطلباتُ الصرف تقول ما
 * ينتظر: فاتورةٌ أرفقها موظّفُ التخليص ومعناها «ادفعوا هذه». وكانت تُقال
 * بالهاتف — فصارت في الشاشة التي يفتحها المحاسبُ أصلًا.
 *
 * وكلُّ رقمِ معاملةٍ في الصفحة — في الطلبات وفي جدول المعاملات — يفتح نافذتَها
 * هنا (ClearanceQuickView)، لا شاشةَ قسمٍ لا تُفتح للماليّة.
 */
import { useState } from 'react';
import { useLanguage } from '@/context/LanguageContext';
import FinanceDeptView from '@/components/finance/FinanceDeptView';
import CustomsPaymentRequests from '@/components/finance/CustomsPaymentRequests';
import ClearanceQuickView from '@/components/customs/ClearanceQuickView';

export default function Page() {
  const { lang } = useLanguage();
  const [openId, setOpenId] = useState<string | null>(null);
  return (
    <div className="space-y-6">
      <CustomsPaymentRequests onOpen={setOpenId} />
      <FinanceDeptView dept="customs" onOpenRow={(r) => { if (r._customsId) setOpenId(String(r._customsId)); }} />
      {openId && <ClearanceQuickView id={openId} ar={lang === 'ar'} onClose={() => setOpenId(null)} />}
    </div>
  );
}
