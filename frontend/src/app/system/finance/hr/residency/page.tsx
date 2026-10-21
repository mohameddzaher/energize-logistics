'use client';
/**
 * الإدارة الماليّة ← ماليات الموارد البشرية ← «الإقامات ورخص العمل».
 *
 * تبويبان: الرسومُ المستحقّة (ما انتهى وما بقي عليه ٢٠ يومًا فأقلّ — كلُّ مستندٍ
 * صفّ، ويُسجَّل دفعُه هنا)، وطلباتُ الموارد البشريّة إلى الماليّة (تُجاب «تمّ» أو
 * «لم يتمّ»). راجع backend/src/controllers/hrFinanceController.
 *
 * والتبويبُ في الرابط (`?tab=requests`) — إشعارُ «طلب جديد» يفتح عليه مباشرةً.
 */
import { Suspense, useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useLanguage } from '@/context/LanguageContext';
import { useSocket } from '@/hooks/useSocket';
import api from '@/lib/api';
import { IdCard } from 'lucide-react';
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
  const [pending, setPending] = useState(0);

  const loadCount = useCallback(() => {
    api.get<{ pendingRequests: number }>('/api/finance/hr-docs/summary')
      .then((s) => setPending(s.pendingRequests || 0)).catch(() => {});
  }, []);
  useEffect(() => { loadCount(); }, [loadCount]);
  useSocket('hr-finance:changed', loadCount);

  return (
    <div className="space-y-4 w-full pb-10" dir={isRTL ? 'rtl' : 'ltr'}>
      <PageHeader icon={<IdCard className="w-5 h-5" />}
        title={t('الإقامات ورخص العمل', 'Iqamas & work permits')}
        subtitle={<span>
          <Link href="/system/finance/hr" className="hover:text-[#f37121]">{t('ماليات الموارد البشرية', 'HR finance')}</Link>
          {' · '}{t('رسوم التجديد المستحقة، وطلبات الموارد البشرية إلى المالية', 'Renewal fees due, and HR requests to Finance')}
        </span>} />
      <Tabs active={tab}
        onChange={(k) => router.replace(k === 'requests' ? '/system/finance/hr/residency?tab=requests' : '/system/finance/hr/residency')}
        tabs={[
          { key: 'fees', label: t('رسوم الإقامات ورخص العمل', 'Iqama & permit fees') },
          { key: 'requests', label: t('طلبات الموارد البشرية', 'HR requests'), badge: pending },
        ]} />
      {tab === 'fees'
        ? <HrDocFees listUrl="/api/finance/hr-docs" optionsUrl="/api/finance/hr-docs/options"
            payUrl="/api/finance/hr-docs/pay" unpayUrl="/api/finance/hr-docs/unpay" />
        : <HrFinanceRequests side="finance" listUrl="/api/finance/hr-requests" answerUrl="/api/finance/hr-requests" />}
    </div>
  );
}

export default function Page() {
  return <Suspense fallback={<Spinner />}><Inner /></Suspense>;
}
