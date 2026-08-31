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

type Tab = 'lists' | 'alerts';

// المستنداتُ التي لها عتبةُ تنبيه — بالترتيب الذي يُقرأ به في الشاشة.
const DOCS: { key: string; ar: string; en: string }[] = [
  { key: 'insurance', ar: 'التأمين', en: 'Insurance' },
  { key: 'operatingCard', ar: 'بطاقة التشغيل', en: 'Operating card' },
  { key: 'vehicleLicense', ar: 'رخصة السير', en: 'Vehicle licence' },
  { key: 'inspection', ar: 'الفحص الدوري', en: 'Inspection' },
  { key: 'authorization', ar: 'التفويض بالقيادة', en: 'Driving authorisation' },
  { key: 'gps', ar: 'اشتراك التتبّع', en: 'GPS subscription' },
  { key: 'corporatePolicy', ar: 'وثائق الشركة', en: 'Corporate policies' },
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
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    try {
      const d = await api.get<{ config: { alerts: Record<string, AlertCfg> } }>('/api/vehicle-registry/settings');
      setAlerts(d.config?.alerts || {});
    } catch (e: any) { notify(e?.message || t('تعذّر التحميل', 'Could not load'), 'error'); }
    setLoading(false);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => { load(); }, [load]);

  const setDoc = (k: string, field: keyof AlertCfg, v: any) =>
    setAlerts((p) => ({ ...(p || {}), [k]: { ...((p || {})[k] || {} as AlertCfg), [field]: v } }));

  const save = async () => {
    setSaving(true);
    try {
      await api.put('/api/vehicle-registry/settings', { alerts });
      notify(t('حُفظت الإعدادات', 'Settings saved'), 'success');
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
          {/* ── ولماذا ثلاثُ عتباتٍ لا واحدة ────────────────────────────────
              «قريبٌ» يُخطَّط له، و«تحذيرٌ» يُبدأ فيه، و«حرجٌ» يُترك له كلُّ شيء.
              وعتبةٌ واحدةٌ تجعل ما بقي له تسعون يومًا وما بقي له ثلاثة سواءً. */}
          <p className="text-[12px] text-slate-500 mb-3">
            {t('لكلّ مستند ثلاث عتبات: «قريب» للتخطيط، و«تحذير» للبدء، و«حرج» للاستعجال. تُقاس بالأيّام قبل الانتهاء.',
               'Each document has three thresholds — soon (plan), warning (start), critical (urgent) — in days before expiry.')}
          </p>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-slate-500 text-xs">
                <tr>
                  <th className="px-3 py-2 text-start font-semibold">{t('المستند', 'Document')}</th>
                  <th className="px-3 py-2 text-center font-semibold">{t('مُفعّل', 'On')}</th>
                  <th className="px-3 py-2 text-center font-semibold">{t('قريب (يوم)', 'Soon (days)')}</th>
                  <th className="px-3 py-2 text-center font-semibold">{t('تحذير (يوم)', 'Warning (days)')}</th>
                  <th className="px-3 py-2 text-center font-semibold">{t('حرج (يوم)', 'Critical (days)')}</th>
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
                  return (
                    <tr key={d.key} className="border-b border-slate-100">
                      <td className="px-3 py-2.5 font-semibold text-slate-800">{t(d.ar, d.en)}</td>
                      <td className="px-3 py-2.5 text-center">
                        <input type="checkbox" checked={!!c.enabled} disabled={!canEdit}
                          onChange={(e) => setDoc(d.key, 'enabled', e.target.checked)}
                          className="w-4 h-4 accent-[#f37121]" aria-label={t(d.ar, d.en)} />
                      </td>
                      <td className="px-3 py-2.5 text-center">{num('soonDays')}</td>
                      <td className="px-3 py-2.5 text-center">{num('warnDays')}</td>
                      <td className="px-3 py-2.5 text-center">{num('criticalDays')}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
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
