'use client';
// نسخة القسم من لوحة تقييم الأداء. الـAPI بيحصر النتيجة على فريق المدير اللي
// داخل، فمفيش فلترة زيادة محتاجة هنا.
import { useLanguage } from '@/context/LanguageContext';
import TeamBoard from '@/components/performance/TeamBoard';

export default function Page() {
  const { lang } = useLanguage();
  const ar = lang === 'ar';
  return <TeamBoard title={ar ? 'تقييم أداء — المركبات والتفاويض' : 'Performance — Vehicles'} />;
}
