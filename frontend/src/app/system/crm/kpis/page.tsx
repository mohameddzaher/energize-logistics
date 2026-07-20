'use client';
// This section's own copy of the KPI evaluation board. The API scopes the
// result to the signed-in manager's own team, so no extra filtering is needed.
import { useLanguage } from '@/context/LanguageContext';
import TeamBoard from '@/components/performance/TeamBoard';

export default function Page() {
  const { lang } = useLanguage();
  const ar = lang === 'ar';
  return <TeamBoard title={ar ? 'تقييم أداء — العلاقات' : 'Performance — CRM'} />;
}
