'use client';
// Section copy of the performance-evaluation board. The API already limits results to the signed-in manager's team, so no extra filtering is needed.
import { useLanguage } from '@/context/LanguageContext';
import TeamBoard from '@/components/performance/TeamBoard';

export default function Page() {
  const { lang } = useLanguage();
  const ar = lang === 'ar';
  return <TeamBoard section="Operations" title={ar ? 'تقييم أداء — العمليات' : 'Performance — Operations'} />;
}
