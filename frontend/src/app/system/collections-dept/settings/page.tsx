'use client';
/** Collections department settings: every dropdown in the department (party class, payment terms, collection status, follow-up method, cities) is managed here so options are shared instead of typed as variants. */
import { useState } from 'react';
import Link from 'next/link';
import { useLanguage } from '@/context/LanguageContext';
import { PageHeader } from '@/components/hr/HRKit';
import ReferenceDataManager from '@/components/system/ReferenceDataManager';
import { Settings, Tags, Users, Truck, ClipboardList, Mail } from 'lucide-react';
import EmailTemplateEditor from '@/components/collections/EmailTemplateEditor';
import { useAuth } from '@/context/AuthContext';
import { canEditCollections } from '@/lib/collections';

export default function CollectionsSettingsPage() {
  const { lang, isRTL } = useLanguage();
  const ar = lang === 'ar';
  const t = (a: string, e: string) => (ar ? a : e);
  const { user } = useAuth();
  const [tab, setTab] = useState<'lists' | 'registers' | 'email'>('lists');

  const TABS: [typeof tab, string, string, any][] = [
    ['lists', 'القوائم المنسدلة', 'Dropdown lists', Tags],
    ['registers', 'السجلّات', 'Registers', Users],
    ['email', 'قالب البريد', 'Email template', Mail],
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

      {/* Lists of this department only, not the system-wide lists page. */}
      {tab === 'lists' && <ReferenceDataManager module="collections" alsoType="jp_task_collections" embedded />}

      {tab === 'email' && <EmailTemplateEditor ar={ar} canEdit={canEditCollections(user)} />}

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
              dAr: 'أوامر النقل نفسُها — منها تُقرأ الأرقام، وفيها تُكتب الفاتورةُ وتاريخُ التحصيل.',
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
