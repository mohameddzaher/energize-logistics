'use client';
// إعدادات قسم التخليص الجمركي — القسمُ كلُّه يُضبط من هنا.
//
// كلُّ قائمةٍ منسدلةٍ في القسم تُدار من هذه الصفحة: الموانئُ والعملاتُ وأنواعُ
// الفواتير وبلدانُ المنشأ والمدن. ومَن ينقصه خيارٌ يضيفه هنا فيراه كلُّ من بعده،
// بدل أن يكتبه بيده في معاملته وحدَها فيصير صيغةً سادسةً للشيء نفسِه.
import { useState } from 'react';
import { useAuth } from '@/context/AuthContext';
import { useLanguage } from '@/context/LanguageContext';
import { PageHeader } from '@/components/hr/HRKit';
import ReferenceDataManager from '@/components/system/ReferenceDataManager';
import { Settings, Tags, Users, Ship } from 'lucide-react';
import Link from 'next/link';

export default function CustomsSettingsPage() {
  const { user } = useAuth();
  const { lang, isRTL } = useLanguage();
  const ar = lang === 'ar';
  const t = (a: string, e: string) => (ar ? a : e);
  const [tab, setTab] = useState<'lists' | 'parties'>('lists');

  const TABS: [typeof tab, string, string, any][] = [
    ['lists', 'القوائم المنسدلة', 'Dropdown lists', Tags],
    ['parties', 'العملاء والوكلاء', 'Customers & agents', Users],
  ];

  return (
    <div className="space-y-5 pb-10" dir={isRTL ? 'rtl' : 'ltr'}>
      <PageHeader icon={<Settings className="w-6 h-6 text-[#f37121]" />}
        title={t('إعدادات قسم التخليص الجمركي', 'Customs settings')}
        subtitle={t('كلُّ قائمةٍ منسدلةٍ في القسم تُضبط من هنا — والتغيير يظهر فورًا', 'Every dropdown in the section is set here — changes apply at once')} />

      <div className="flex items-center gap-2 flex-wrap">
        {TABS.map(([k, arL, enL, Icon]) => (
          <button key={k} type="button" onClick={() => setTab(k)}
            className={`inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-sm font-semibold transition-colors ${
              tab === k ? 'bg-[#f37121] text-white' : 'bg-white border border-slate-200 text-slate-600 hover:text-slate-900'}`}>
            <Icon className="w-4 h-4" /> {t(arL, enL)}
          </button>
        ))}
      </div>

      {tab === 'lists' && <ReferenceDataManager module="customs" embedded />}

      {/* ── والأطرافُ لها صفحاتُها ────────────────────────────────────────────
          العميلُ ووكيلُ الشحن ليسا قائمةَ خياراتٍ بل ملفّان لهما بريدٌ وسجلٌّ
          تجاريٌّ وتاريخُ عملٍ وأرقام. فمكانُهما صفحةٌ لا صفٌّ في جدول قوائم. */}
      {tab === 'parties' && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {[
            { href: '/system/customs/customers', Icon: Users, ar: 'عملاء التخليص', en: 'Customs customers',
              dAr: 'ملفُّ كلّ عميل: بياناتُه وسجلُّه التجاريّ وكلُّ معاملاته وأرقامُه.',
              dEn: 'Each customer: details, CR, all their deals and figures.' },
            { href: '/system/customs/agents', Icon: Ship, ar: 'وكلاء الشحن', en: 'Shipping agents',
              dAr: 'ملفُّ كلّ وكيل — والبريدُ يُملأ وحدَه في المعاملة حين يُختار.',
              dEn: 'Each agent — their email autofills on the transaction.' },
          ].map((c) => (
            <Link key={c.href} href={c.href}
              className="block bg-white border border-slate-200 rounded-xl p-5 shadow-sm hover:border-[#f37121]/50 hover:shadow-md transition-all">
              <div className="flex items-center gap-3 mb-2">
                <span className="w-10 h-10 rounded-lg bg-[#f37121]/10 text-[#f37121] flex items-center justify-center">
                  <c.Icon className="w-5 h-5" />
                </span>
                <p className="font-bold text-slate-900">{t(c.ar, c.en)}</p>
              </div>
              <p className="text-[13px] text-slate-500">{t(c.dAr, c.dEn)}</p>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
