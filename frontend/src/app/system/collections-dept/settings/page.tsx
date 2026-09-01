'use client';
/**
 * إعداداتُ قسم التحصيل — القسمُ كلُّه يُضبط من هنا.
 *
 * كلُّ قائمةٍ منسدلةٍ في القسم تُدار من هذه الصفحة: تصنيفُ الطرف وشروطُ السداد
 * وحالةُ التحصيل ووسيلةُ المتابعة والمدن. ومَن ينقصه خيارٌ يضيفه هنا فيراه كلُّ
 * من بعده، بدل أن يكتبه بيده في سجلٍّ واحدٍ فيصير صيغةً أخرى للشيء نفسِه.
 */
import { useState } from 'react';
import Link from 'next/link';
import { useLanguage } from '@/context/LanguageContext';
import { PageHeader } from '@/components/hr/HRKit';
import ReferenceDataManager from '@/components/system/ReferenceDataManager';
import { Settings, Tags, Users, Truck, ClipboardList } from 'lucide-react';

export default function CollectionsSettingsPage() {
  const { lang, isRTL } = useLanguage();
  const ar = lang === 'ar';
  const t = (a: string, e: string) => (ar ? a : e);
  const [tab, setTab] = useState<'lists' | 'registers'>('lists');

  const TABS: [typeof tab, string, string, any][] = [
    ['lists', 'القوائم المنسدلة', 'Dropdown lists', Tags],
    ['registers', 'السجلّات', 'Registers', Users],
  ];

  return (
    <div className="space-y-5 pb-10" dir={isRTL ? 'rtl' : 'ltr'}>
      <PageHeader
        icon={<Settings className="w-6 h-6 text-[#f37121]" />}
        title={t('إعدادات قسم التحصيل', 'Collections settings')}
        subtitle={t('كلُّ قائمةٍ منسدلةٍ في القسم تُضبط من هنا — والتغيير يظهر فورًا', 'Every dropdown in the section is set here — changes apply at once')}
      />

      <div className="flex items-center gap-2 flex-wrap">
        {TABS.map(([k, arL, enL, Icon]) => (
          <button
            key={k}
            type="button"
            onClick={() => setTab(k)}
            className={`inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-sm font-semibold transition-colors ${
              tab === k ? 'bg-[#f37121] text-white' : 'bg-white border border-slate-200 text-slate-600 hover:text-slate-900'}`}
          >
            <Icon className="w-4 h-4" /> {t(arL, enL)}
          </button>
        ))}
      </div>

      {/* قوائمُ هذا القسم وحدَه — لا قوائمُ النظام كلِّه في صفحةٍ عامّةٍ يبحث
          فيها المستخدم عن قائمته بين قوائم غيره. */}
      {tab === 'lists' && <ReferenceDataManager module="collections" embedded />}

      {tab === 'registers' && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {[
            {
              href: '/system/collections-dept/customers', Icon: Users,
              ar: 'العملاء', en: 'Customers',
              dAr: 'مَن نحصّل منهم: بياناتُهم وشروطُ سدادهم وكلُّ كشوفهم وما بقي لنا عندهم.',
              dEn: 'Who we collect from: details, terms, all their reports and what is still due.',
            },
            {
              href: '/system/collections-dept/suppliers', Icon: Truck,
              ar: 'الموردون', en: 'Suppliers',
              dAr: 'مَن نسدّد لهم: الآيبانُ والسجلُّ التجاريُّ ومحاسبُ المورّد وما بقي عليه.',
              dEn: 'Who we pay: IBAN, CR, their accountant, and what is still owed.',
            },
            {
              href: '/system/operations', Icon: ClipboardList,
              ar: 'سير عمل التشغيل', en: 'Operations workflow',
              dAr: 'الكشوفُ نفسُها — منها تُقرأ الأرقام، وفيها تُكتب الفاتورةُ وتاريخُ التحصيل.',
              dEn: 'The reports themselves — the source of every figure here.',
            },
          ].map((c) => (
            <Link
              key={c.href}
              href={c.href}
              className="block bg-white border border-slate-200 rounded-xl p-5 shadow-sm hover:border-[#f37121]/50 hover:shadow-md transition-all"
            >
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
