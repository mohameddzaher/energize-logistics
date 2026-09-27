'use client';
/**
 * «مناديب المبيعات» — استُبدلت بسجلّ القسم كلِّه.
 *
 * ── لماذا تحويلةٌ لا حذف ────────────────────────────────────────────────────
 * الصفحةُ كانت تعرض مَن له تقريرُ طلباتٍ وحدَه، فلا يظهر فيها مشرفٌ ولا ميكانيكيٌّ
 * ولا عاملُ نظافة — وهم أحدَ عشرَ من مئةٍ وواحدٍ وستّين. فحلَّ محلَّها «موظفون
 * النقل الخفيف» بكلّ من يعمل في القسم.
 *
 * والرابطُ يبقى يعمل: هو محفوظٌ في مفضّلات الناس وفي رسائلَ قديمة، وصفحةٌ
 * تُحذَف تعطي خطأً لا يُفهَم منه أين ذهبت. فيُحوَّل إلى السجلّ الجديد.
 *
 * وسجلُّ `B2CRep` نفسُه لم يُمَسّ: خمسةُ مئةٍ وثلاثةٌ وتسعون صفًّا تشير إليها
 * ستٌّ وأربعون ألفَ طلبٍ، وهي أساسُ تحليل الطلبات.
 */
import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useLanguage } from '@/context/LanguageContext';
import { Truck } from 'lucide-react';

export default function RepsMovedPage() {
  const router = useRouter();
  const { lang, isRTL } = useLanguage();
  const ar = lang === 'ar';
  const t = (a: string, e: string) => (ar ? a : e);

  useEffect(() => { router.replace('/system/b2c/light-transport'); }, [router]);

  return (
    <div className="p-8" dir={isRTL ? 'rtl' : 'ltr'}>
      <div className="max-w-md rounded-2xl border border-slate-200 bg-white p-6 shadow-sm space-y-3">
        <span className="w-11 h-11 rounded-xl bg-[#f37121]/10 text-[#f37121] flex items-center justify-center">
          <Truck className="w-5 h-5" />
        </span>
        <h1 className="font-extrabold text-slate-900 text-[17px]">
          {t('انتقلت هذه الصفحة', 'This page has moved')}
        </h1>
        <p className="text-[13px] text-slate-600 leading-relaxed">
          {t('صارت «موظفون النقل الخفيف» — وفيها كلُّ من يعمل في القسم: المناديب والمشرفون والإداريون والفنيون، بمركباتهم ومشاريعهم وسكنهم.',
             'It is now “Light-transport employees” — everyone in the section: reps, supervisors, admin and technicians, with their vehicles, projects and housing.')}
        </p>
        <Link href="/system/b2c/light-transport"
          className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-[#f37121] text-white text-sm font-bold">
          {t('اذهب إلى السجلّ', 'Go to the register')}
        </Link>
      </div>
    </div>
  );
}
