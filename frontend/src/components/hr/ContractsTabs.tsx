'use client';
// تبويبا العقود.
//
// كان في القائمة مدخلان: «العقود» و«بيانات العقود» — والمستخدم لا يعرف أيّهما
// يفتح، فيفتح واحدًا ويحسبه كلّ الحكاية. وهما في الحقيقة وجهان لشيء واحد:
//
//   العقود            سجلّ العمل: إنشاء العقد وتجديده وإنهاؤه.
//   بيانات العقود     أعمدة العقد في ملف الموارد البشرية وحالة كلٍّ منها
//                     (رقم قوى · المهنة · تاريخ الانتهاء) وما ينقص منها.
//
// فصارا مدخلًا واحدًا وتبويبين — والفرق بينهما مكتوبٌ تحتهما لا مُخمَّن.
import { useRouter, usePathname } from 'next/navigation';
import { useLanguage } from '@/context/LanguageContext';

const TABS = [
  { href: '/system/hr/contracts', ar: 'العقود', en: 'Contracts',
    hintAr: 'إنشاء العقد وتجديده وإنهاؤه', hintEn: 'Create, renew and end contracts' },
  { href: '/system/hr/master/contract', ar: 'بيانات العقود', en: 'Contract data',
    hintAr: 'أعمدة العقد في الملف وما ينقص منها', hintEn: 'The sheet columns and what is missing' },
];

export default function ContractsTabs() {
  const { lang } = uمتseLanguage();
  const ar = lang === 'ar';
  const router = useRouter();
  const pathname = usePathname() || '';
  const active = TABS.find((t) => pathname.startsWith(t.href)) || TABS[0];

  return (
    <div className="space-y-1.5">
      <div className="flex flex-wrap items-center gap-1.5">
        {TABS.map((t) => {
          const on = t.href === active.href;
          return (
            <button key={t.href} type="button" onClick={() => router.push(t.href)}
              className={`px-3 py-1.5 rounded-lg text-[13px] font-semibold border whitespace-nowrap transition
                ${on ? 'bg-[#12325c] text-white border-[#12325c]'
                     : 'bg-white text-slate-700 border-slate-200 hover:border-slate-400'}`}>
              {ar ? t.ar : t.en}
            </button>
          );
        })}
      </div>
      <p className="text-[11.5px] text-slate-600 px-1">{ar ? active.hintAr : active.hintEn}</p>
    </div>
  );
}
