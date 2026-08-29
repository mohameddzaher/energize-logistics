'use client';
// إعدادات تنبيهات المركبات — لكل مستند: تفعيل التنبيه وكم يوم قبل الانتهاء يبدأ.
// مثال: التأمين 60 يوم، بطاقة التشغيل 30 يوم…
import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { useLanguage } from '@/context/LanguageContext';
import { useAuth } from '@/context/AuthContext';
import api from '@/lib/api';
import { useDialog } from '@/components/system/DialogProvider';
import { Spinner, PageHeader } from '@/components/hr/HRKit';
import { RegConfig, DOC_TYPES } from '@/lib/vehicleRegistry';
import { Settings, Save, CalendarClock, Bell, Tags } from 'lucide-react';
import ReferenceDataManager from '@/components/system/ReferenceDataManager';
import { canAdminVehicles } from '@/lib/vehicleRegistry';
import { useSocket } from '@/hooks/useSocket';


export default function VehicleRegistrySettings() {
  const { lang, isRTL } = useLanguage();
  const ar = lang === 'ar';
  const { user } = useAuth();
  const { notify } = useDialog();
  const canEdit = canAdminVehicles(user);
  const [cfg, setCfg] = useState<RegConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  // ── تبويبان: عتبات التنبيه، والقوائم المنسدلة ─────────────────────────────
  // القوائم كانت تُدار من شاشةٍ عامّة في «الأدوات» لا يفتحها أحدٌ من داخل
  // القسم، فتبقى الحقول حرّةً بحكم الأمر الواقع. وهي هنا الآن حيث تُستعمل.
  const [tab, setTab] = useState<'alerts' | 'lists'>('alerts');

  const load = useCallback(async () => {
    try { const d = await api.get<{ config: RegConfig }>('/api/vehicle-registry/settings'); setCfg(d.config); }
    catch { /* keep */ } finally { setLoading(false); }
  }, []);
  useEffect(() => { load(); }, [load]);
  // آخر صفحة في القسم كانت مش بتسمع — دلوقتي كلهم على نفس الحدث.
  useSocket('vreg:updated', useCallback(() => { load(); }, [load]));

  const setDoc = (key: string, patch: Partial<{ enabled: boolean; warnDays: number; criticalDays: number }>) =>
    setCfg((p) => p ? { ...p, alerts: { ...p.alerts, [key]: { ...p.alerts[key], ...patch } } } : p);

  const save = async () => {
    if (!cfg) return;
    setSaving(true);
    try { await api.put('/api/vehicle-registry/settings', { alerts: cfg.alerts }); notify(ar ? 'تم حفظ الإعدادات' : 'Settings saved', 'success'); }
    catch (e: any) { notify(e?.message || 'Failed', 'error'); } finally { setSaving(false); }
  };

  if (loading || !cfg) return <Spinner />;

  const TabBtn = ({ k, icon, label }: { k: 'alerts' | 'lists'; icon: React.ReactNode; label: string }) => (
    <button type="button" onClick={() => setTab(k)}
      className={`flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-[13px] font-bold border transition-colors ${
        tab === k ? 'bg-[#12325c] text-white border-[#12325c]' : 'bg-white text-slate-700 border-slate-200 hover:border-slate-400'}`}>
      {icon}{label}
    </button>
  );

  return (
    <div className={`space-y-4 w-full pb-10 ${tab === 'alerts' ? 'max-w-3xl' : ''}`} dir={isRTL ? 'rtl' : 'ltr'}>
      <PageHeader icon={<Settings className="w-5 h-5" />} title={ar ? 'إعدادات القسم' : 'Section Settings'}
        subtitle={ar ? 'عتبات التنبيه للمستندات، والقوائم المنسدلة التي تُملأ منها حقول المركبة'
                     : 'Document alert thresholds, and the dropdown lists that fill the vehicle fields'}>
        <Link href="/system/vehicles/registry/expiring" className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 text-sm"><CalendarClock className="w-4 h-4" /> {ar ? 'الانتهاءات والتجديد' : 'Expiries & Renewals'}</Link>
      </PageHeader>

      <div className="flex flex-wrap items-center gap-2">
        <TabBtn k="alerts" icon={<Bell className="w-4 h-4" />} label={ar ? 'عتبات التنبيه' : 'Alert thresholds'} />
        <TabBtn k="lists" icon={<Tags className="w-4 h-4" />} label={ar ? 'القوائم المنسدلة' : 'Dropdown lists'} />
      </div>

      {tab === 'lists' && <ReferenceDataManager module="vehicles" embedded />}
      {tab === 'alerts' && (<>

      <div className="rounded-2xl border border-slate-200 bg-white shadow-sm divide-y divide-slate-100">
        {[...DOC_TYPES, { key: 'corporatePolicy', ar: 'وثائق تأمين الشركة', en: 'Company policies' }].map((d) => {
          const a = cfg.alerts[d.key] || { enabled: true, warnDays: 60, criticalDays: 15 };
          return (
            <div key={d.key} className="flex items-center gap-4 px-4 py-4">
              <div className="flex-1">
                <p className="font-semibold text-slate-800">{ar ? d.ar : d.en}</p>
                <p className="text-xs text-slate-400">{ar ? 'تنبيه برتقالي، ثم أحمر عند اقتراب الموعد كثيرًا' : 'Amber warning, then red when it gets close'}</p>
              </div>
              <div className="flex items-center gap-2">
                <div className="text-center">
                  <input type="number" min={0} max={3650} disabled={!canEdit || !a.enabled} value={a.warnDays}
                    onChange={(e) => setDoc(d.key, { warnDays: Number(e.target.value) || 0 })}
                    className="w-20 px-2 py-2 rounded-lg border border-amber-300 text-sm text-center disabled:bg-slate-50" />
                  <p className="text-[10px] text-amber-600 mt-0.5">{ar ? 'تنبيه' : 'warn'}</p>
                </div>
                {/* «حرج» لازم تفضل جوّه «تنبيه» — لو بقت أكبر، البرتقالي بيختفي
                    خالص وما حدش هيلاحظ. السيرفر بيقصّها برضه. */}
                <div className="text-center">
                  <input type="number" min={0} max={a.warnDays} disabled={!canEdit || !a.enabled}
                    value={Math.min(a.criticalDays ?? 7, a.warnDays)}
                    onChange={(e) => setDoc(d.key, { criticalDays: Math.min(Number(e.target.value) || 0, a.warnDays) })}
                    className="w-20 px-2 py-2 rounded-lg border border-red-300 text-sm text-center disabled:bg-slate-50" />
                  <p className="text-[10px] text-red-600 mt-0.5">{ar ? 'حرج' : 'critical'}</p>
                </div>
                <span className="text-xs text-slate-500">{ar ? 'يوم' : 'days'}</span>
                <label className="relative inline-flex items-center cursor-pointer ms-2">
                  <input type="checkbox" className="sr-only peer" disabled={!canEdit} checked={a.enabled} onChange={(e) => setDoc(d.key, { enabled: e.target.checked })} />
                  <div className="w-11 h-6 bg-slate-200 peer-checked:bg-emerald-500 rounded-full peer transition after:content-[''] after:absolute after:top-0.5 after:start-0.5 after:bg-white after:rounded-full after:h-5 after:w-5 after:transition peer-checked:after:translate-x-5 rtl:peer-checked:after:-translate-x-5" />
                </label>
              </div>
            </div>
          );
        })}
      </div>
      <p className="text-xs text-slate-400 leading-relaxed">
        {ar
          ? 'مثال: التأمين — تنبيه ٦٠ وحرج ١٥: يصبح برتقاليًا حين يتبقّى شهران، وأحمر في آخر أسبوعين. وبهذه الأرقام نفسها تتلوّن بطاقات النظرة الشاملة وصفحة الانتهاءات.'
          : 'e.g. Insurance warn 60 / critical 15 — amber from two months out, red for the last fortnight. The overview cards and the expiries page colour by exactly these numbers.'}
      </p>

      {canEdit && (
        <button onClick={save} disabled={saving} className="flex items-center gap-1.5 px-5 py-2.5 rounded-lg bg-[#f37121] hover:bg-[#e5651a] text-white text-sm font-semibold disabled:opacity-60">
          <Save className="w-4 h-4" /> {ar ? 'حفظ الإعدادات' : 'Save settings'}
        </button>
      )}
      </>)}
    </div>
  );
}
