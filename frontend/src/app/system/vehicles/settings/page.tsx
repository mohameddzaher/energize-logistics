'use client';
// إعدادات قسم المركبات — القسمُ كلُّه يُضبط من هنا.
//
// كان ما يُضبط في القسم موزَّعًا بلا موضع: عتباتُ التنبيه على انتهاء المستندات
// مذكورةٌ في المخطّط ولا شاشةَ لها، والقوائمُ المرجعيّةُ (القطاع، الماركة،
// اللون، شركاتُ التأمين…) في صفحةٍ عامّةٍ تعرض قوائمَ الأقسام كلِّها. فمَن أراد
// ضبطَ شيءٍ بحث عنه، أو لم يجده أصلًا.
//
// وكلُّه ديناميكيّ: ما يُغيَّر هنا يظهر في نموذج المركبة وفي الفلاتر وفي
// التنبيهات في اللحظة نفسِها، بلا نشرةٍ برمجيّة.
import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '@/context/AuthContext';
import { useLanguage } from '@/context/LanguageContext';
import { useDialog } from '@/components/system/DialogProvider';
import api from '@/lib/api';
import { Spinner, PageHeader, PrimaryButton, Loader2 } from '@/components/hr/HRKit';
import ReferenceDataManager from '@/components/system/ReferenceDataManager';
import { Settings, Tags, BellRing, Save } from 'lucide-react';
import ScrollX from '@/components/system/ScrollX';

type Tab = 'lists' | 'alerts';

// ── المستنداتُ التي لها عتبةُ تنبيه ─────────────────────────────────────────
// والاسمُ هو اسمُ الصفحة كما في القائمة الجانبيّة حرفًا بحرف — لا اسمٌ ثالثٌ
// يُخترَع هنا. كان الصفُّ يُسمّى «التأمين» والصفحةُ «تأمين المركبات»، فيضبط
// المستخدمُ عتبةً ولا يدري أيَّ شاشةٍ ضبط. ومعه مسارُه: تُفتَح الصفحةُ من
// موضع ضبطها ويُرى الأثرُ.
const DOCS: { key: string; ar: string; en: string; href: string }[] = [
  { key: 'insurance', ar: 'تأمين المركبات', en: 'Vehicle insurance', href: '/system/vehicles/registry/insurance/vehicles' },
  { key: 'operatingCard', ar: 'بطاقات التشغيل', en: 'Operating cards', href: '/system/vehicles/registry/operating-cards' },
  { key: 'vehicleLicense', ar: 'رخص السير', en: 'Vehicle licences', href: '/system/vehicles/registry/licenses' },
  { key: 'inspection', ar: 'الفحص الدوري', en: 'Periodic inspection', href: '/system/vehicles/registry/inspection' },
  { key: 'authorization', ar: 'التفاويض', en: 'Authorisations', href: '/system/vehicles/registry/authorizations' },
  { key: 'gps', ar: 'أجهزة التتبّع GPS', en: 'GPS devices', href: '/system/vehicles/registry/gps' },
  // بطاقةُ السائق ورقةٌ على إنسانٍ لا على مركبة، لكنّ انتهاءها يوقف العملَ كما
  // يوقفه انتهاءُ استمارة — فعتباتُها تُضبَط من هنا كغيرها.
  { key: 'driverCard', ar: 'بطاقات السائقين', en: 'Driver cards', href: '/system/vehicles/driver-cards' },
  { key: 'corporatePolicy', ar: 'وثائق تأمين الشركة', en: 'Corporate policies', href: '/system/vehicles/registry/corporate' },
];

// شرائحُ الحالة بلغة الصفحات ولونِها — تُعرَض مع العتبة نتيجتُها الآن.
const BANDS: { key: string; ar: string; en: string; cls: string }[] = [
  { key: 'expired', ar: 'منتهٍ', en: 'Expired', cls: 'bg-red-100 text-red-700' },
  { key: 'critical', ar: 'حرج', en: 'Critical', cls: 'bg-orange-100 text-orange-700' },
  { key: 'warning', ar: 'تحذير', en: 'Warning', cls: 'bg-amber-100 text-amber-700' },
  { key: 'upcoming', ar: 'قريب', en: 'Soon', cls: 'bg-sky-100 text-sky-700' },
  { key: 'valid', ar: 'ساري', en: 'Valid', cls: 'bg-emerald-100 text-emerald-700' },
];

type AlertCfg = { enabled: boolean; soonDays: number; warnDays: number; criticalDays: number };

export default function VehiclesSettingsPage() {
  const { user } = useAuth();
  const { lang, isRTL } = useLanguage();
  const ar = lang === 'ar';
  const t = (a: string, e: string) => (ar ? a : e);
  const { notify } = useDialog();

  const role = String((user as any)?.role || '');
  const canEdit = ['super_admin', 'admin', 'vehicles_manager'].includes(role);

  const [tab, setTab] = useState<Tab>('lists');
  const [alerts, setAlerts] = useState<Record<string, AlertCfg> | null>(null);
  // ما تقوله هذه العتباتُ عن البيانات الآن — يأتي محسوبًا من الخادم بالدالّة
  // نفسِها التي تحسبه في الصفحات.
  const [counts, setCounts] = useState<Record<string, Record<string, number>>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    try {
      const d = await api.get<{ config: { alerts: Record<string, AlertCfg> }; counts?: Record<string, Record<string, number>> }>('/api/vehicle-registry/settings');
      setAlerts(d.config?.alerts || {});
      setCounts(d.counts || {});
    } catch (e: any) { notify(e?.message || t('تعذّر التحميل', 'Could not load'), 'error'); }
    setLoading(false);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => { load(); }, [load]);

  const setDoc = (k: string, field: keyof AlertCfg, v: any) =>
    setAlerts((p) => ({ ...(p || {}), [k]: { ...((p || {})[k] || {} as AlertCfg), [field]: v } }));

  const save = async () => {
    // الخادمُ يردّ المخالف برسالته؛ ويُقال هنا قبل النداء ليُصحَّح في مكانه.
    const bad = Object.entries(alerts || {}).filter(([, c]: any) => c?.enabled !== false
      && (Number(c.criticalDays) > Number(c.warnDays) || Number(c.warnDays) > Number(c.soonDays)));
    if (bad.length) {
      notify(t('راجع العتبات المعلَّمة بالأحمر: حرج ≤ تحذير ≤ قريب', 'Fix the rows in red: critical ≤ warning ≤ soon'), 'error');
      return;
    }
    setSaving(true);
    try {
      await api.put('/api/vehicle-registry/settings', { alerts });
      notify(t('حُفظت الإعدادات', 'Settings saved'), 'success');
      // ويُعاد السؤالُ فورًا: ما يُقصّه الخادمُ أو يردّه يُرى على الشاشة، ولا
      // يبقى رقمٌ معروضٌ غيرَ الرقم المحفوظ. والعدّاداتُ تُعاد بالعتبة الجديدة.
      await load();
    } catch (e: any) { notify(e?.message || t('تعذّر الحفظ', 'Could not save'), 'error'); }
    setSaving(false);
  };

  if (loading) return <Spinner />;

  const TABS: [Tab, string, string, any][] = [
    ['lists', 'القوائم المرجعية', 'Reference lists', Tags],
    ['alerts', 'عتبات التنبيه', 'Alert thresholds', BellRing],
  ];

  return (
    <div className="space-y-5 pb-10" dir={isRTL ? 'rtl' : 'ltr'}>
      <PageHeader icon={<Settings className="w-6 h-6 text-[#f37121]" />}
        title={t('إعدادات قسم المركبات', 'Vehicles settings')}
        subtitle={t('كلُّ ما يتكرّر في القسم يُضبط من هنا — والتغيير يظهر فورًا', 'Everything the section repeats is set here — changes apply at once')} />

      <div className="flex items-center gap-2 flex-wrap">
        {TABS.map(([k, arL, enL, Icon]) => (
          <button key={k} type="button" onClick={() => setTab(k)}
            className={`inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-sm font-semibold transition-colors ${
              tab === k ? 'bg-[#f37121] text-white' : 'bg-white border border-slate-200 text-slate-600 hover:text-slate-900'}`}>
            <Icon className="w-4 h-4" /> {t(arL, enL)}
          </button>
        ))}
      </div>

      {/* القوائمُ المرجعيّةُ الخاصّةُ بهذا القسم وحدَه — لا قوائمُ النظام كلِّه. */}
      {tab === 'lists' && <ReferenceDataManager module="vehicles" embedded />}

      {tab === 'alerts' && (
        <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-sm">
          {/* ── ثلاثُ عتباتٍ، وحالةٌ واحدةٌ تُقرأ ──────────────────────────────
              الشاشاتُ تعرض ثلاثَ حالاتٍ لا غير: منتهٍ · قارب على الانتهاء ·
              ساري. و«قارب على الانتهاء» تبدأ من عتبة «قريب»؛ والعتبتان
              الأخريان تغيّران اللونَ وحدَه — أصفرُ ثمّ برتقاليٌّ كلّما اقترب.
              فمن أراد أن يبدأ التنبيهُ أبكرَ يزيد «قريب» وحدَها. */}
          <p className="text-[12px] text-slate-500 mb-3 leading-relaxed">
            {t('كلُّ رقمٍ عددُ أيّامٍ قبل الانتهاء، وكلُّ صفٍّ يُغيّر شرائحَ صفحته الثلاث: «حرج» و«تحذير» و«قريب» — تُعدّ في الصفحة وتُفلتَر بضغطة. وعمودُ «الوضع الآن» يقول ما تقوله هذه الأرقامُ على بياناتك في هذه اللحظة، فالصفرُ فيه صفرٌ حقيقيّ لا إعدادٌ لم يُحفَظ.',
               'Each number is days before expiry, and each row drives its page’s three bands — critical, warning and soon. “Right now” shows what these numbers say about your data at this moment, so a zero there is a real zero, not an unsaved setting.')}
          </p>
          {/* ── والقاعدةُ تُكتب قبل الحفظ لا بعده ────────────────────────────
              كان ما يخالفها يُقَصّ في الخادم بلا خبر، فيقرأ صاحبُه رقمَه ولم
              يتغيّر ويقول «الإعدادات لا تعمل». فالقاعدةُ معروضة، والصفُّ
              المخالف يُعلَّم، والحفظُ يقف حتى يُصحَّح. */}
          <p className="text-[12px] text-slate-600 mb-3 bg-slate-50 border border-slate-200 rounded-lg px-3 py-2">
            {t('القاعدة: حرج ≤ تحذير ≤ قريب. مثال: حرج ٧، تحذير ٣٠، قريب ٩٠.',
               'Rule: critical ≤ warning ≤ soon. Example: 7, 30, 90.')}
          </p>
          <ScrollX>
            <table className="w-full text-sm">
              <thead className="table-head">
                <tr>
                  <th className="px-3 py-2 text-start font-semibold">{t('المستند', 'Document')}</th>
                  <th className="px-3 py-2 text-center font-semibold">{t('مُفعّل', 'On')}</th>
                  <th className="px-3 py-2 text-center font-semibold">{t('قريب (يوم)', 'Soon (days)')}</th>
                  <th className="px-3 py-2 text-center font-semibold">{t('تحذير (يوم)', 'Warning (days)')}</th>
                  <th className="px-3 py-2 text-center font-semibold">{t('حرج (يوم)', 'Critical (days)')}</th>
                  <th className="px-3 py-2 text-start font-semibold">{t('المدى الفعلي', 'Actual bands')}</th>
                  <th className="px-3 py-2 text-start font-semibold">{t('الوضع الآن', 'Right now')}</th>
                </tr>
              </thead>
              <tbody>
                {DOCS.map((d) => {
                  const c = (alerts || {})[d.key] || ({ enabled: false, soonDays: 90, warnDays: 30, criticalDays: 7 } as AlertCfg);
                  const num = (field: keyof AlertCfg) => (
                    <input type="number" min={0} disabled={!canEdit || !c.enabled}
                      value={(c as any)[field] ?? ''} onChange={(e) => setDoc(d.key, field, Number(e.target.value) || 0)}
                      className="w-20 px-2 py-1.5 rounded-lg border border-slate-200 text-sm text-center disabled:bg-slate-50 disabled:text-slate-400" />
                  );
                  const bad = !!c.enabled && (Number(c.criticalDays) > Number(c.warnDays) || Number(c.warnDays) > Number(c.soonDays));
                  return (
                    <tr key={d.key} className={`border-b border-slate-100 ${bad ? 'bg-red-50' : ''}`}>
                      <td className="px-3 py-2.5 font-semibold text-slate-800">
                        {t(d.ar, d.en)}
                        {bad && <span className="block text-[11px] font-normal text-red-600">{t('حرج ≤ تحذير ≤ قريب', 'critical ≤ warning ≤ soon')}</span>}
                      </td>
                      <td className="px-3 py-2.5 text-center">
                        <input type="checkbox" checked={!!c.enabled} disabled={!canEdit}
                          onChange={(e) => setDoc(d.key, 'enabled', e.target.checked)}
                          className="w-4 h-4 accent-[#f37121]" aria-label={t(d.ar, d.en)} />
                      </td>
                      <td className="px-3 py-2.5 text-center">{num('soonDays')}</td>
                      <td className="px-3 py-2.5 text-center">{num('warnDays')}</td>
                      <td className="px-3 py-2.5 text-center">{num('criticalDays')}</td>
                      {/* ── والرقمُ يُقرأ مدًى لا عتبةً مفردة ────────────────
                          ثلاثةُ أرقامٍ في سطرٍ واحدٍ لا تقول أين يقع كلُّ
                          مستند: مَن كتب «حرج ٢٠ وتحذير ٣٠ وقريب ٦٠» لا يرى أنّ
                          «تحذير» صار ٢١–٣٠ يومًا وأنّ ما بعد الستّين ليس في
                          شريحةٍ أصلًا. فالمدى مكتوبٌ صريحًا. */}
                      <td className="px-3 py-2.5 text-[11.5px] text-slate-600 whitespace-nowrap leading-relaxed">
                        <span className="text-orange-700 font-semibold">{t('حرج', 'Crit')}</span>{` ≤${c.criticalDays} · `}
                        <span className="text-amber-700 font-semibold">{t('تحذير', 'Warn')}</span>
                        {Number(c.warnDays) > Number(c.criticalDays) ? ` ${Number(c.criticalDays) + 1}–${c.warnDays}` : ` — ${t('معطَّلة', 'off')}`}
                        {' · '}
                        <span className="text-sky-700 font-semibold">{t('قريب', 'Soon')}</span>
                        {Number(c.soonDays) > Number(c.warnDays) ? ` ${Number(c.warnDays) + 1}–${c.soonDays}` : ` — ${t('معطَّلة', 'off')}`}
                      </td>
                      {/* ── وأثرُ العتبة في موضع ضبطها ───────────────────────
                          «أظبط حرج ٢٠ وأروح الصفحة ألاقي صفر» — والصفرُ قد يكون
                          صحيحًا (لا مستندَ ينتهي في هذا المدى) وقد يكون عطلًا،
                          ولا سبيلَ للتفريق. فالعددُ هنا، محسوبًا بالعتبة نفسِها
                          التي تُحسب بها الصفحة. */}
                      <td className="px-3 py-2.5">
                        <span className="inline-flex items-center gap-1 flex-wrap">
                          {BANDS.filter((b) => (counts[d.key]?.[b.key] || 0) > 0).map((b) => (
                            <span key={b.key} className={`px-1.5 py-0.5 rounded text-[11px] font-bold ${b.cls}`}>
                              {t(b.ar, b.en)} {counts[d.key]?.[b.key]}
                            </span>
                          ))}
                          {!BANDS.some((b) => (counts[d.key]?.[b.key] || 0) > 0) && (
                            <span className="text-slate-400 text-[11.5px]">{t('لا بيانات بتاريخ', 'no dated records')}</span>
                          )}
                          <a href={d.href} className="text-[11px] font-bold text-slate-400 hover:text-[#f37121] whitespace-nowrap">
                            {t('الصفحة ↗', 'page ↗')}
                          </a>
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </ScrollX>
          {canEdit && (
            <div className="flex justify-end mt-4">
              <PrimaryButton onClick={save} disabled={saving}>
                {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                {t('حفظ', 'Save')}
              </PrimaryButton>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
