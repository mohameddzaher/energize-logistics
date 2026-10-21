'use client';
/**
 * الموارد البشريّة ← «متابعة المالية».
 *
 * تبويبان: حالةُ دفع رسوم الإقامات ورخص العمل (الصفوفُ نفسُها التي تراها الماليّة،
 * قراءةً فقط — الدفعُ يُسجَّل هناك والتجديدُ يبقى هنا في ملفّ الموظّف)، و«طلبات
 * للمالية»: موظّفون، وأمام كلٍّ منهم ما يُحتاج له، ومرفقات — ثمّ ردُّ الماليّة.
 */
import { Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useLanguage } from '@/context/LanguageContext';
import { Landmark } from 'lucide-react';
import { Spinner, PageHeader, Tabs } from '@/components/hr/HRKit';
import HrDocFees from '@/components/finance/HrDocFees';
import HrFinanceRequests from '@/components/finance/HrFinanceRequests';

function Inner() {
  const { lang, isRTL } = useLanguage();
  const ar = lang === 'ar';
  const t = (a: string, e: string) => (ar ? a : e);
  const router = useRouter();
  const sp = useSearchParams();
  const tab = sp?.get('tab') === 'requests' ? 'requests' : 'fees';

  return (
    <div className="space-y-4 w-full pb-10" dir={isRTL ? 'rtl' : 'ltr'}>
      <PageHeader icon={<Landmark className="w-5 h-5" />}
        title={t('متابعة المالية', 'Finance follow-up')}
        subtitle={t('حالة دفع رسوم الإقامات ورخص العمل، وطلبات القسم إلى الإدارة المالية',
          'Payment status of iqama & work-permit fees, and HR requests to Finance')} />
      <Tabs active={tab}
        onChange={(k) => router.replace(k === 'requests' ? '/system/hr/finance-follow?tab=requests' : '/system/hr/finance-follow')}
        tabs={[
          { key: 'fees', label: t('رسوم الإقامات ورخص العمل', 'Iqama & permit fees') },
          { key: 'requests', label: t('طلبات للمالية', 'Requests to Finance') },
        ]} />
      {tab === 'fees'
        ? <HrDocFees listUrl="/api/hr/finance-follow/docs" optionsUrl="/api/hr/finance-follow/options" profileLinks />
        : <HrFinanceRequests side="hr" listUrl="/api/hr/finance-requests" createUrl="/api/hr/finance-requests"
            employeeSearchUrl="/api/hr/employees-search" />}
    </div>
  );
}

export default function Page() {
  return <Suspense fallback={<Spinner />}><Inner /></Suspense>;
}
