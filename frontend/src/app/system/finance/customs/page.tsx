'use client';
/**
 * ماليّاتُ التخليص الجمركيّ — أرقامُ القسم، وتحتها ما يطلب القسمُ دفعَه.
 *
 * البطاقاتُ والجداولُ تقول ما وقع (إيرادٌ وتكلفةٌ وربح)، وطلباتُ الصرف تقول ما
 * ينتظر: فاتورةٌ أرفقها موظّفُ التخليص ومعناها «ادفعوا هذه». وكانت تُقال
 * بالهاتف — فصارت في الشاشة التي يفتحها المحاسبُ أصلًا.
 */
import FinanceDeptView from '@/components/finance/FinanceDeptView';
import CustomsPaymentRequests from '@/components/finance/CustomsPaymentRequests';

export default function Page() {
  return (
    <div className="space-y-6">
      <CustomsPaymentRequests />
      <FinanceDeptView dept="customs" />
    </div>
  );
}
