'use client';
// شريط تنقّل واحد بيربط صفحات ملف الموظفين ببعض.
//
// المشكلة اللي بيحلّها: الصفحات كانت جزر — تفتح الإقامات، تخلص، ترجع للقايمة
// الجانبية، تدوّر على الجوازات. والأهم إنك ما كنتش شايف **فين الشغل**، فكنت
// بتفتح صفحة صفحة تشوف فيها حاجة ناقصة ولا لأ.
//
// ── والرقمُ انتهاءاتٌ لا نقصٌ في البيانات ──────────────────────────────────
//
// كان الرقمُ «بياناتٌ ناقصة». فيقرأ المستخدمُ «الإقامات ٢» بالأحمر فيفهم أنّ
// إقامتين انتهتا، ويدخل فيجد مئتين واثنتين وثلاثين — رقمان صحيحان يجيبان عن
// سؤالين، ولا شيء يقول أيُّهما أيّ.
//
// والسؤالُ الذي يُطرح على هذا الشريط كلَّ صباح هو «ما الذي انتهى أو يوشك؟».
// فصار الرقمُ ذلك: المنتهي والحرج والقريب (`needsAttention`) — وهو نفسُه الذي
// تعدّه صفحةُ الانتهاءات وبطاقاتُ اللوحة، فلا يختلف رقمٌ عن رقم.
//
// والمجموعاتُ التي لا مستندَ لها (التواصل، البيانات البنكية…) لا انتهاءَ فيها،
// فلا رقمَ لها — أَولى من رقمٍ يعني شيئًا آخر في نفس الموضع.
//
// العدّاد بيتقرا من نفس اندبوينت النظرة الشاملة اللي الصفحة الرئيسية بتستعمله،
// فمفيش حساب تاني ممكن يختلف عنه.
import { useEffect, useState } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { useLanguage } from '@/context/LanguageContext';
import { useSocket } from '@/hooks/useSocket';
import { getHrOverview } from '@/lib/hrMaster';
import { LayoutGrid, CalendarClock, Users } from 'lucide-react';

type Item = { href: string; ar: string; en: string; count?: number; icon?: React.ReactNode };

export default function MasterNav() {
  const { lang } = useLanguage();
  const ar = lang === 'ar';
  const t = (a: string, e: string) => (ar ? a : e);
  const router = useRouter();
  const pathname = usePathname() || '';
  const [groups, setGroups] = useState<{ key: string; ar: string; en: string; count?: number }[]>([]);
  const [expiring, setExpiring] = useState(0);

  const load = async () => {
    try {
      const o = await getHrOverview({});
      setGroups((o.groups || []).map((g: any) => ({
        key: g.key, ar: g.ar, en: g.en,
        // المستنداتُ وحدَها لها انتهاءات؛ وغيرُها بلا رقم.
        count: g.needsAttention == null ? undefined : g.needsAttention,
      })));
      setExpiring(o.totals?.expiringSoon || 0);
    } catch { /* الشريط مايوقفش الصفحة */ }
  };
  useEffect(() => { load(); }, []);
  useSocket('hr:master', () => { load(); });

  const items: Item[] = [
    { href: '/system/hr/master', ar: 'النظرة الشاملة', en: 'Overview', icon: <LayoutGrid className="w-3.5 h-3.5" /> },
    { href: '/system/hr/master/expiring', ar: 'الانتهاءات', en: 'Expiries', count: expiring, icon: <CalendarClock className="w-3.5 h-3.5" /> },
    // والرابطُ يحمل الفلترَ الذي يُنتج الرقمَ نفسَه: من ضغط «٢٣٢» يجد اثنين
    // وثلاثين ومئتين، لا الجدولَ كلَّه. راجع state=attention في الخادم.
    ...groups.map((g) => ({
      href: g.count ? `/system/hr/master/${g.key}?state=attention` : `/system/hr/master/${g.key}`,
      ar: g.ar, en: g.en, count: g.count,
    })),
    { href: '/system/hr/employees', ar: 'كل الموظفين', en: 'All employees', icon: <Users className="w-3.5 h-3.5" /> },
  ];

  return (
    <nav className="-mx-1 overflow-x-auto pb-1">
      <div className="flex items-center gap-1.5 px-1 min-w-max">
        {items.map((it) => {
          const active = pathname === it.href.split('?')[0];
          const work = (it.count || 0) > 0;
          return (
            <button key={it.href} onClick={() => router.push(it.href)}
              className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[12.5px] font-semibold border whitespace-nowrap transition
                ${active ? 'bg-[#12325c] text-white border-[#12325c]'
                         : 'bg-white text-slate-700 border-slate-200 hover:border-slate-400 hover:text-slate-900'}`}>
              {it.icon}
              {ar ? it.ar : it.en}
              {it.count != null && (
                <span className={`px-1.5 py-0.5 rounded text-[10.5px] font-bold tabular-nums
                  ${active ? 'bg-white/20 text-white'
                           : work ? 'bg-rose-100 text-rose-700' : 'bg-slate-100 text-slate-500'}`}>
                  {it.count}
                </span>
              )}
            </button>
          );
        })}
      </div>
      <p className="px-1 pt-1.5 text-[11px] text-slate-500">
        {t('الرقم بجانب كل صفحة = مستندات منتهية أو تقترب من الانتهاء',
           'The number next to each page = documents expired or nearing expiry')}
      </p>
    </nav>
  );
}
