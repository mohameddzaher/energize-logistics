'use client';
/**
 * Vendors management settings: the trip targets the daily page measures against (company and per branch), and the
 * section's lists (contract status, tax classification, request rejection reasons, JP task titles). Every change shows
 * on the section's screens at once.
 */
import { useState, useEffect } from 'react';
import { useAuth } from '@/context/AuthContext';
import { useLanguage } from '@/context/LanguageContext';
import { useDialog } from '@/components/system/DialogProvider';
import api from '@/lib/api';
import { Spinner, PageHeader, Field, TextInput } from '@/components/hr/HRKit';
import ReferenceDataManager from '@/components/system/ReferenceDataManager';
import { isVendorLead } from '@/lib/vendors';
import { Settings, Target, Tags, Loader2 } from 'lucide-react';

export default function VendorsSettingsPage() {
  const { user } = useAuth();
  const { lang, isRTL } = useLanguage();
  const ar = lang === 'ar';
  const t = (a: string, e: string) => (ar ? a : e);
  const { notify } = useDialog();
  const lead = isVendorLead(user);
  const [tab, setTab] = useState<'targets' | 'lists'>('targets');
  const [targets, setTargets] = useState<{ daily: number; monthly: number; byBranch: Record<string, number> } | null>(null);
  const [branches, setBranches] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    api.get<{ targets: any }>('/api/vendors-mgmt/settings').then((r) => setTargets(r.targets)).catch(() => setTargets({ daily: 0, monthly: 0, byBranch: {} }));
    api.get<{ items: { nameAr: string }[] }>('/api/lookups?type=so_branch&active=true').then((r) => setBranches((r.items || []).map((x) => x.nameAr))).catch(() => {});
  }, []);

  const save = async () => {
    setSaving(true);
    try { const r = await api.put<{ targets: any }>('/api/vendors-mgmt/settings', { targets }); setTargets(r.targets); notify(t('حُفظت الأهداف', 'Targets saved'), 'success'); }
    catch (e: any) { notify(e?.message || t('تعذّر الحفظ', 'Could not save'), 'error'); }
    setSaving(false);
  };

  return (
    <div className="space-y-5" dir={isRTL ? 'rtl' : 'ltr'}>
      <PageHeader icon={<Settings className="w-6 h-6 text-[#f37121]" />} title={t('إعدادات قسم الموردين', 'Vendors section settings')}
        subtitle={t('أهدافُ التشغيل اليوميّ وقوائمُ القسم — كلُّ تغييرٍ يظهر فورًا في صفحات القسم', 'Daily trip targets and the section lists — changes show at once')} />
      <div className="inline-flex rounded-xl border border-slate-200 bg-white p-1 shadow-sm">
        {([['targets', Target, 'الأهداف (التارجت)', 'Targets'], ['lists', Tags, 'قوائم القسم', 'Section lists']] as const).map(([k, Icon, a, e]) => (
          <button key={k} type="button" onClick={() => setTab(k)} className={`inline-flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-semibold ${tab === k ? 'bg-slate-900 text-white' : 'text-slate-600 hover:bg-slate-100'}`}>
            <Icon className={`w-4 h-4 ${tab === k ? 'text-[#f37121]' : 'text-slate-400'}`} />{ar ? a : e}
          </button>
        ))}
      </div>
      {tab === 'targets' && (!targets ? <Spinner /> : (
        <div className="rounded-2xl border border-slate-200 bg-white shadow-sm p-5 space-y-4 max-w-3xl">
          <p className="text-sm text-slate-600">{t('عدد الرحلات المحقّقة المستهدَف يوميًّا. تقيس صفحةُ «التحليل التشغيليّ اليوميّ» كلَّ يومٍ وكلَّ فرعٍ عليه.', 'Fulfilled trips targeted per day; the daily page measures every day and branch against it.')}</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Field label={t('التارجت اليوميّ للشركة (رحلة/يوم)', 'Company daily target (trips/day)')}><TextInput type="number" min={0} disabled={!lead} value={targets.daily || ''} onChange={(e) => setTargets({ ...targets, daily: Number(e.target.value) || 0 })} /></Field>
            <Field label={t('التارجت الشهريّ (رحلة)', 'Monthly target (trips)')}><TextInput type="number" min={0} disabled={!lead} value={targets.monthly || ''} onChange={(e) => setTargets({ ...targets, monthly: Number(e.target.value) || 0 })} /></Field>
          </div>
          <div>
            <p className="text-sm font-bold text-slate-800 mb-2">{t('التارجت اليوميّ لكلّ فرع', 'Daily target per branch')}</p>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              {[...new Set([...branches, ...Object.keys(targets.byBranch || {})])].map((b) => (
                <Field key={b} label={b}><TextInput type="number" min={0} disabled={!lead} value={targets.byBranch?.[b] || ''} onChange={(e) => setTargets({ ...targets, byBranch: { ...(targets.byBranch || {}), [b]: Number(e.target.value) || 0 } })} /></Field>
              ))}
            </div>
          </div>
          {lead
            ? <button type="button" onClick={save} disabled={saving} className="inline-flex items-center gap-1.5 px-5 py-2.5 rounded-xl bg-[#f37121] text-white text-sm font-bold disabled:opacity-50">{saving && <Loader2 className="w-4 h-4 animate-spin" />}{t('حفظ الأهداف', 'Save targets')}</button>
            : <p className="text-[12.5px] text-slate-500">{t('يحدّد الأهدافَ مديرُ القسم أو قائدُ الفريق.', 'Set by the section manager or team leader.')}</p>}
        </div>
      ))}
      {tab === 'lists' && (
        <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-sm">
          <ReferenceDataManager module="vendors" alsoType={['sr_reject_reason', 'jp_task_vendors']} embedded />
        </div>
      )}
    </div>
  );
}
