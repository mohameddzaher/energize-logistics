'use client';
// إعدادات الموارد البشريّة — ما يضبطه القسمُ لنفسه في موضعٍ واحد.
//
// كان القسمُ بلا صفحةِ إعدادات: أنواعُ الإجازات في صفحةٍ مستقلّة، وعتباتُ
// التنبيه لانتهاء المستندات مبثوثةٌ في الشيفرة، والقوائمُ المرجعيّة في صفحةٍ
// عامّةٍ تعرض قوائمَ الأقسام كلِّها. فمن أراد ضبطَ شيءٍ في قسمه بحث عنه في
// أربعة مواضع.
import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { useAuth } from '@/context/AuthContext';
import { useLanguage } from '@/context/LanguageContext';
import { useDialog } from '@/components/system/DialogProvider';
import api from '@/lib/api';
import { isHRStaff } from '@/lib/hr';
import { Spinner, PageHeader, PrimaryButton, Loader2 } from '@/components/hr/HRKit';
import ReferenceDataManager from '@/components/system/ReferenceDataManager';
import { Settings, CalendarDays, BellRing, Tags, ExternalLink } from 'lucide-react';

interface LeaveType { _id: string; nameAr: string; nameEn: string; affectsBalance?: boolean; paid?: boolean; active?: boolean; requiresAdvanceNotice?: boolean; minAdvanceDays?: number }

export default function HrSettingsPage() {
  const { user } = useAuth();
  const { lang, isRTL } = useLanguage();
  const ar = lang === 'ar';
  const t = (a: string, e: string) => (ar ? a : e);
  const { notify } = useDialog();
  const staff = isHRStaff(user);

  const [types, setTypes] = useState<LeaveType[]>([]);
  const [alerts, setAlerts] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    try {
      const [lt, cfg] = await Promise.all([
        api.get<{ leaveTypes: LeaveType[] }>('/api/hr/leave-types'),
        api.get<{ alerts: Record<string, number> }>('/api/hr/settings').catch(() => ({ alerts: {} })),
      ]);
      setTypes(lt.leaveTypes || []);
      setAlerts(cfg.alerts || {});
    } catch (e: any) { notify(e?.message || t('تعذّر التحميل', 'Could not load'), 'error'); }
    setLoading(false);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => { load(); }, [load]);

  const saveAlerts = async () => {
    setSaving(true);
    try {
      await api.put('/api/hr/settings', { alerts });
      notify(t('حُفظت الإعدادات', 'Settings saved'), 'success');
    } catch (e: any) { notify(e?.message || t('لم تُحفظ', 'Not saved'), 'error'); }
    setSaving(false);
  };

  if (!staff) return <div className="text-slate-500 p-8">{t('غير مصرّح', 'Not authorized')}</div>;
  if (loading) return <Spinner />;

  // المستنداتُ ذاتُ تاريخ الانتهاء في الموارد البشريّة — العتبةُ لكلٍّ منها.
  const DOCS: [string, string, string][] = [
    ['iqama', 'الإقامة', 'Iqama'],
    ['passport', 'جواز السفر', 'Passport'],
    ['workPermit', 'رخصة العمل', 'Work permit'],
    ['healthCertificate', 'الشهادة الصحية', 'Health certificate'],
    ['driverCard', 'بطاقة السائق', 'Driver card'],
    ['drivingLicense', 'رخصة القيادة', 'Driving licence'],
    ['medicalInsurance', 'التأمين الطبي', 'Medical insurance'],
    ['contract', 'العقد', 'Contract'],
  ];

  return (
    <div className="space-y-6" dir={isRTL ? 'rtl' : 'ltr'}>
      <PageHeader
        icon={<Settings className="w-6 h-6 text-[#f37121]" />}
        title={t('إعدادات الموارد البشرية', 'HR Settings')}
        subtitle={t('أنواع الإجازات، وعتبات تنبيه انتهاء المستندات، وقوائم القسم', 'Leave types, document-expiry alert thresholds, and the section’s lists')}
      />

      {/* ── أنواع الإجازات ──────────────────────────────────────────────────
          «تُخصَم من الرصيد» تُقرَّر هنا مرّةً واحدة فتنطبق على كلّ من يأخذ
          هذا النوع — لا سؤالٌ يُعاد عند كلّ تسجيل، فيُخصَم من موظّفٍ ما لم
          يُخصَم من زميله في الحالة نفسِها. */}
      <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
          <h3 className="bg-slate-900 px-3 py-2 rounded-lg text-white font-semibold flex items-center gap-2">
            <CalendarDays className="w-4 h-4 text-[#f37121]" /> {t('أنواع الإجازات', 'Leave types')}
            <span className="text-slate-400 text-xs font-normal">{types.length}</span>
          </h3>
          <Link href="/system/hr/leave-types"
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-[#f37121] text-white text-sm font-medium hover:bg-[#e06010]">
            {t('إدارة الأنواع', 'Manage types')} <ExternalLink className="w-3.5 h-3.5" />
          </Link>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm min-w-[520px]">
            <thead><tr className="table-head">
              {[t('النوع', 'Type'), t('تُخصَم من الرصيد', 'Deducts balance'), t('مدفوعة', 'Paid'), t('إخطار مسبق', 'Advance notice'), t('نشط', 'Active')].map((h) => (
                <th key={h} className="px-3 py-2 text-start font-semibold whitespace-nowrap">{h}</th>
              ))}
            </tr></thead>
            <tbody className="divide-y divide-slate-100">
              {types.map((x) => (
                <tr key={x._id} className="hover:bg-slate-50">
                  <td className="px-3 py-2 font-semibold text-slate-900">{ar ? x.nameAr : x.nameEn}</td>
                  <td className="px-3 py-2">
                    <span className={`px-2 py-0.5 rounded-full text-xs font-semibold ${x.affectsBalance === false ? 'bg-slate-200 text-slate-600' : 'bg-blue-100 text-blue-700'}`}>
                      {x.affectsBalance === false ? t('لا', 'No') : t('نعم', 'Yes')}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-slate-600">{x.paid === false ? t('لا', 'No') : t('نعم', 'Yes')}</td>
                  <td className="px-3 py-2 text-slate-600">
                    {x.requiresAdvanceNotice === false ? t('معفاة', 'Exempt') : `${x.minAdvanceDays ?? 30} ${t('يوم', 'days')}`}
                  </td>
                  <td className="px-3 py-2 text-slate-600">{x.active === false ? t('لا', 'No') : t('نعم', 'Yes')}</td>
                </tr>
              ))}
              {!types.length && <tr><td colSpan={5} className="px-3 py-8 text-center text-slate-400">{t('لا أنواع بعد', 'No types yet')}</td></tr>}
            </tbody>
          </table>
        </div>
      </div>

      {/* ── عتبات التنبيه ───────────────────────────────────────────────────
          «نبّهني قبل انتهاء الإقامة بكم يومًا؟» كان الجوابُ رقمًا في الشيفرة،
          فمن أراد ستّين بدل ثلاثين انتظر نشرةً برمجيّة. */}
      <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-sm">
        <h3 className="bg-slate-900 px-3 py-2 rounded-lg text-white font-semibold mb-2 flex items-center gap-2">
          <BellRing className="w-4 h-4 text-[#f37121]" /> {t('تنبيه انتهاء المستندات', 'Document-expiry alerts')}
        </h3>
        <p className="text-slate-500 text-sm mb-4">
          {t('كم يومًا قبل الانتهاء يظهر المستند في شاشة الانتهاءات؟', 'How many days before expiry should a document appear in the expiries screen?')}
        </p>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          {DOCS.map(([key, arLabel, enLabel]) => (
            <div key={key}>
              <label className="block text-xs font-semibold text-slate-600 mb-1">{ar ? arLabel : enLabel}</label>
              <input type="number" min={1} max={365}
                value={alerts[key] ?? 30}
                onChange={(e) => setAlerts((a) => ({ ...a, [key]: Number(e.target.value) || 0 }))}
                className="w-full px-3 py-2 rounded-lg bg-white border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-[#f37121]/50" />
            </div>
          ))}
        </div>
        <div className="mt-4">
          <PrimaryButton onClick={saveAlerts} disabled={saving}>
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : null} {t('حفظ', 'Save')}
          </PrimaryButton>
        </div>
      </div>

      {/* ── قوائم القسم ─────────────────────────────────────────────────────
          تعيش عند قسمها لا في صفحةٍ عامّةٍ تعرض قوائمَ الأقسام كلِّها. */}
      <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-sm">
        <h3 className="bg-slate-900 px-3 py-2 rounded-lg text-white font-semibold mb-4 flex items-center gap-2">
          <Tags className="w-4 h-4 text-[#f37121]" /> {t('قوائم القسم', 'Section lists')}
        </h3>
        <ReferenceDataManager module="hr" embedded />
      </div>
    </div>
  );
}
