'use client';
import { useLanguage } from '@/context/LanguageContext';
import AgingPage from '@/components/collections/AgingPage';

export default function CollectionsAging() {
  const { lang } = useLanguage();
  const ar = lang === 'ar';
  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-bold text-slate-900">{ar ? 'أعمار الديون' : 'Aging'}</h1>
        <p className="text-sm text-slate-500 mt-0.5">
          {ar ? 'كم على كل عميل، ومنذ متى — والحدُّ المتّفق عليه وكم استُهلك منه.'
              : 'What each customer owes, how long it has been owed, and how much of their limit is used.'}
        </p>
      </div>
      <AgingPage />
    </div>
  );
}
