'use client';
// شريط تنقّل واحد بيربط صفحات ملف الموظفين ببعض.
//
// المشكلة اللي بيحلّها: الصفحات كانت جزر — تفتح الإقامات، تخلص، ترجع للقايمة
// الجانبية، تدوّر على الجوازات. والأهم إنك ما كنتش شايف **فين الشغل**، فكنت
// بتفتح صفحة صفحة تشوف فيها حاجة ناقصة ولا لأ.
//
// هنا كل مجموعة مكتوب جنبها عدد البيانات الناقصة فيها. اللي فيه شغل بيبان
// بالأحمر، واللي خلص بيبان رمادي. فترتيب شغل اليوم بقى قراءة سطر واحد.
//
// العدّاد بيتقرا من نفس اندبوينت النظرة الشاملة اللي الصفحة الرئيسية بتستعمله،
// فمفيش حساب تاني ممكن يختلف عنه.
import { useEffect, useState } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { useLanguage } from '@/context/LanguageContext';
import { useSocket } from '@/hooks/useSocket';
import { getHrOverview } from '@/lib/hrMaster';
import { LayoutGrid, CalendarClock, Users } from 'lucide-react';

type Item = { href: string; ar: string; en: string; required?: number; icon?: React.ReactNode };

export default function MasterNav() {
  const { lang } = useLanguage();
  const ar = lang === 'ar';
  const t = (a: string, e: string) => (ar ? a : e);
  const router = useRouter();
  const pathname = usePathname() || '';
  const [groups, setGroups] = useState<{ key: string; ar: string; en: string; required: number }[]>([]);
  const [expiring, setExpiring] = useState(0);

  const load = async () => {
    try {
      const o = await getHrOverview({});
      setGroups((o.groups || []).map((g: any) => ({ key: g.key, ar: g.ar, en: g.en, required: g.required || 0 })));
      setExpiring(o.totals?.expiringSoon || 0);
    } catch { /* الشريط مايوقفش الصفحة */ }
  };
  useEffect(() => { load(); }, []);
  useSocket('hr:master', () => { load(); });

  const items: Item[] = [
    { href: '/system/hr/master', ar: 'النظرة الشاملة', en: 'Overview', icon: <LayoutGrid className="w-3.5 h-3.5" /> },
    { href: '/system/hr/master/expiring', ar: 'الانتهاءات', en: 'Expiries', required: expiring, icon: <CalendarClock className="w-3.5 h-3.5" /> },
    ...groups.map((g) => ({ href: `/system/hr/master/${g.key}`, ar: g.ar, en: g.en, required: g.required })),
    { href: '/system/hr/employees', ar: 'كل الموظفين', en: 'All employees', icon: <Users className="w-3.5 h-3.5" /> },
  ];

  return (
    <nav className="-mx-1 overflow-x-auto pb-1">
      <div className="flex items-center gap-1.5 px-1 min-w-max">
        {items.map((it) => {
          const active = pathname === it.href;
          const work = (it.required || 0) > 0;
          return (
            <button key={it.href} onClick={() => router.push(it.href)}
              className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[12.5px] font-semibold border whitespace-nowrap transition
                ${active ? 'bg-[#12325c] text-white border-[#12325c]'
                         : 'bg-white text-slate-700 border-slate-200 hover:border-slate-400 hover:text-slate-900'}`}>
              {it.icon}
              {ar ? it.ar : it.en}
              {it.required != null && (
                <span className={`px-1.5 py-0.5 rounded text-[10.5px] font-bold tabular-nums
                  ${active ? 'bg-white/20 text-white'
                           : work ? 'bg-rose-100 text-rose-700' : 'bg-slate-100 text-slate-500'}`}>
                  {it.required}
                </span>
              )}
            </button>
          );
        })}
      </div>
      <p className="px-1 pt-1.5 text-[11px] text-slate-500">
        {t('الرقم بجانب كل صفحة = بيانات ناقصة ما زالت بحاجة إلى استكمال', 'The number next to each page = data still missing')}
      </p>
    </nav>
  );
}
