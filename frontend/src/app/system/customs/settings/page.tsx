'use client';
// إعدادات قسم التخليص الجمركي — القسمُ كلُّه يُضبط من هنا.
//
// كلُّ قائمةٍ منسدلةٍ في القسم تُدار من هذه الصفحة: الموانئُ والعملاتُ وأنواعُ
// الفواتير وبلدانُ المنشأ والمدن. ومَن ينقصه خيارٌ يضيفه هنا فيراه كلُّ من بعده،
// بدل أن يكتبه بيده في معاملته وحدَها فيصير صيغةً سادسةً للشيء نفسِه.
import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '@/context/AuthContext';
import { useLanguage } from '@/context/LanguageContext';
import { PageHeader } from '@/components/hr/HRKit';
import ReferenceDataManager from '@/components/system/ReferenceDataManager';
import { Settings, Tags, Users, Ship, Bell, Loader2, Check } from 'lucide-react';
import api from '@/lib/api';
import { useDialog } from '@/components/system/DialogProvider';
import Link from 'next/link';

export default function CustomsSettingsPage() {
  const { user } = useAuth();
  const { lang, isRTL } = useLanguage();
  const ar = lang === 'ar';
  const t = (a: string, e: string) => (ar ? a : e);
  const { notify } = useDialog();
  const [tab, setTab] = useState<'lists' | 'parties' | 'alerts'>('lists');

  const TABS: [typeof tab, string, string, any][] = [
    ['lists', 'القوائم المنسدلة', 'Dropdown lists', Tags],
    ['parties', 'العملاء والوكلاء', 'Customers & agents', Users],
    ['alerts', 'التنبيهات', 'Alerts', Bell],
  ];

  // ── مدّةُ التنبيه على المعاملات القادمة ──────────────────────────────────
  // رقمٌ واحدٌ يحكم الشارةَ في شاشة القسم. وكتابتُه في الشيفرة تجعل تغييرَه
  // نشرًا؛ فهو هنا، ويسري على النداء التالي بلا انتظار.
  const [days, setDays] = useState<number | ''>('');
  const [savingDays, setSavingDays] = useState(false);
  const [loadedDays, setLoadedDays] = useState(false);
  const loadSettings = useCallback(async () => {
    try {
      const d = await api.get<any>('/api/customs-clearance/settings');
      setDays(Number(d?.settings?.upcomingAlertDays ?? 2));
    } catch { /* */ }
    setLoadedDays(true);
  }, []);
  useEffect(() => { loadSettings(); }, [loadSettings]);
  const saveDays = async () => {
    setSavingDays(true);
    try {
      await api.put('/api/customs-clearance/settings', { upcomingAlertDays: Number(days) });
      notify(t('حُفظ', 'Saved'), 'success');
    } catch (e: any) { notify(e?.message || 'Failed', 'error'); }
    setSavingDays(false);
  };

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

      {tab === 'alerts' && (
        <div className="max-w-xl rounded-xl border border-slate-200 bg-white p-5">
          <p className="font-bold text-slate-900">{t('تنبيه المعاملات القادمة', 'Upcoming transaction alerts')}</p>
          <p className="mt-1 text-[13px] text-slate-500">
            {t('قبل كم يومٍ تظهر المعاملةُ القادمة في شارة التنبيه أعلى شاشة القسم؟ وما فات موعدُه يبقى فيها.',
              'How many days ahead should an upcoming transaction appear in the alert badge? Overdue ones stay in it.')}
          </p>
          <div className="mt-4 flex items-end gap-3">
            <div>
              <label className="mb-1 block text-[11px] text-slate-500">{t('عدد الأيّام', 'Days ahead')}</label>
              <input type="number" min={0} max={60} value={days}
                onChange={(e) => setDays(e.target.value === '' ? '' : Number(e.target.value))}
                className="w-28 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#f37121]/50" />
            </div>
            <button type="button" onClick={saveDays} disabled={savingDays || !loadedDays || days === ''}
              className="inline-flex items-center gap-1.5 rounded-lg bg-[#f37121] px-4 py-2 text-sm font-medium text-white hover:bg-[#e06010] disabled:opacity-60">
              {savingDays ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
              {t('حفظ', 'Save')}
            </button>
          </div>
        </div>
      )}

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
