'use client';
// Section copy of the performance dashboard; the API limits it to the signed-in manager's team.
import { useLanguage } from '@/context/LanguageContext';
import TeamBoard from '@/components/performance/TeamBoard';

export default function Page() {
  const { lang } = useLanguage();
  const ar = lang === 'ar';
  return <TeamBoard section="Vendors Management" title={ar ? 'تقييم أداء — إدارة الموردين' : 'Performance — Vendors Management'} />;
}
