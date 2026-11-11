'use client';
/**
 * Vendors management settings: the trip targets the daily page measures against (company and per branch), and the
 * section's lists (contract status, tax classification, request rejection reasons, JP task titles), how early a
 * contract's end is flagged, and the members the operations manager delegates to approve new carriers. Every change
 * shows on the section's screens at once.
 */
import { useState, useEffect } from 'react';
import { useAuth } from '@/context/AuthContext';
import { useLanguage } from '@/context/LanguageContext';
import { useDialog } from '@/components/system/DialogProvider';
import api from '@/lib/api';
import { Spinner, PageHeader, Field, TextInput } from '@/components/hr/HRKit';
import ReferenceDataManager from '@/components/system/ReferenceDataManager';
import { isVendorLead } from '@/lib/vendors';
import { Settings, Target, Tags, Loader2, ClipboardCheck } from 'lucide-react';

export default function VendorsSettingsPage() {
  const { user } = useAuth();
  const { lang, isRTL } = useLanguage();
  const ar = lang === 'ar';
  const t = (a: string, e: string) => (ar ? a : e);
  const { notify } = useDialog();
  const lead = isVendorLead(user);
  const [tab, setTab] = useState<'targets' | 'approvals' | 'lists'>('targets');
  // The approvals page links straight to the approvers tab (?tab=approvals).
  useEffect(() => { const q = new URLSearchParams(window.location.search).get('tab'); if (q === 'approvals' || q === 'lists') setTab(q); }, []);
  const [contractDays, setContractDays] = useState(30);
  const [inactiveDays, setInactiveDays] = useState(90);
  const [appr, setAppr] = useState<{ users: { id: string; name: string }[]; canManage: boolean; team: { id: string; name: string; role: string }[] } | null>(null);
  const [picked, setPicked] = useState<string[]>([]);
  const [targets, setTargets] = useState<{ daily: number; monthly: number; byBranch: Record<string, number> } | null>(null);
  const [branches, setBranches] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    api.get<{ targets: any; alerts?: { contractDays: number; inactiveDays: number } }>('/api/vendors-mgmt/settings').then((r) => { setTargets(r.targets); setContractDays(r.alerts?.contractDays || 30); setInactiveDays(r.alerts?.inactiveDays || 90); }).catch(() => setTargets({ daily: 0, monthly: 0, byBranch: {} }));
    api.get<any>('/api/vendors-mgmt/approvers').then((r) => { setAppr(r); setPicked(r.users.map((u: any) => u.id)); }).catch(() => {});
    api.get<{ items: { nameAr: string }[] }>('/api/lookups?type=so_branch&active=true').then((r) => setBranches((r.items || []).map((x) => x.nameAr))).catch(() => {});
  }, []);

  const save = async () => {
    setSaving(true);
    try { const r = await api.put<{ targets: any; alerts: any }>('/api/vendors-mgmt/settings', { targets, alerts: { contractDays, inactiveDays } }); setTargets(r.targets); setContractDays(r.alerts?.contractDays || contractDays); setInactiveDays(r.alerts?.inactiveDays || inactiveDays); notify(t('حُفظت الإعدادات', 'Settings saved'), 'success'); }
    catch (e: any) { notify(e?.message || t('تعذّر الحفظ', 'Could not save'), 'error'); }
    setSaving(false);
  };
  const saveApprovers = async () => {
    setSaving(true);
    try { const r = await api.put<any>('/api/vendors-mgmt/approvers', { users: picked }); setAppr(r); notify(t('حُفظ المعتمِدون', 'Approvers saved'), 'success'); }
    catch (e: any) { notify(e?.message || t('تعذّر الحفظ', 'Could not save'), 'error'); }
    setSaving(false);
  };

  return (
    <div className="space-y-5" dir={isRTL ? 'rtl' : 'ltr'}>
      <PageHeader icon={<Settings className="w-6 h-6 text-[#f37121]" />} title={t('إعدادات قسم الموردين', 'Vendors section settings')}
        subtitle={t('أهدافُ التشغيل اليوميّ وقوائمُ القسم — كلُّ تغييرٍ يظهر فورًا في صفحات القسم', 'Daily trip targets and the section lists — changes show at once')} />
      <div className="inline-flex rounded-xl border border-slate-200 bg-white p-1 shadow-sm">
        {([['targets', Target, 'الأهداف والتنبيه', 'Targets & alerts'], ['approvals', ClipboardCheck, 'معتمِدو الموردين', 'Carrier approvers'], ['lists', Tags, 'قوائم القسم', 'Section lists']] as const).map(([k, Icon, a, e]) => (
          <button key={k} type="button" onClick={() => setTab(k)} className={`inline-flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-semibold ${tab === k ? 'bg-slate-900 text-white' : 'text-slate-600 hover:bg-slate-100'}`}>
            <Icon className={`w-4 h-4 ${tab === k ? 'text-[#f37121]' : 'text-slate-400'}`} />{ar ? a : e}
          </button>
        ))}
      </div>
      {tab === 'targets' && (!targets ? <Spinner /> : (
        <div className="rounded-2xl border border-slate-200 bg-white shadow-sm p-5 space-y-4 max-w-3xl">
          <p className="text-sm text-slate-600">{t('عدد الرحلات المحقّقة المستهدَف يوميًّا. تقيس صفحةُ «التحليل التشغيليّ اليوميّ» كلَّ يومٍ وكلَّ فرعٍ عليه.', 'Fulfilled trips targeted per day; the daily page measures every day and branch against it.')}</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Field label={t('المستهدَف اليوميّ للشركة (رحلة/يوم)', 'Company daily target (trips/day)')}><TextInput type="number" min={0} disabled={!lead} value={targets.daily || ''} onChange={(e) => setTargets({ ...targets, daily: Number(e.target.value) || 0 })} /></Field>
            <Field label={t('المستهدَف الشهريّ (رحلة)', 'Monthly target (trips)')}><TextInput type="number" min={0} disabled={!lead} value={targets.monthly || ''} onChange={(e) => setTargets({ ...targets, monthly: Number(e.target.value) || 0 })} /></Field>
          </div>
          <div>
            <p className="text-sm font-bold text-slate-800 mb-2">{t('المستهدَف اليوميّ لكلّ فرع', 'Daily target per branch')}</p>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              {[...new Set([...branches, ...Object.keys(targets.byBranch || {})])].map((b) => (
                <Field key={b} label={b}><TextInput type="number" min={0} disabled={!lead} value={targets.byBranch?.[b] || ''} onChange={(e) => setTargets({ ...targets, byBranch: { ...(targets.byBranch || {}), [b]: Number(e.target.value) || 0 } })} /></Field>
              ))}
            </div>
          </div>
          <Field label={t('التنبيه قبل نهاية عقد المورّد بـ (يوم)', 'Flag a carrier contract this many days before its end')}>
            <TextInput type="number" min={1} max={365} disabled={!lead} value={contractDays} onChange={(e) => setContractDays(Number(e.target.value) || 30)} />
          </Field>
          <Field label={t('يُعدّ المورّد غير نشط بعد (يومًا) بلا رحلةٍ منفّذة', 'A carrier is inactive after this many days without an executed trip')}>
            <TextInput type="number" min={7} max={365} disabled={!lead} value={inactiveDays} onChange={(e) => setInactiveDays(Number(e.target.value) || 90)} />
          </Field>
          {lead
            ? <button type="button" onClick={save} disabled={saving} className="inline-flex items-center gap-1.5 px-5 py-2.5 rounded-xl bg-[#f37121] text-white text-sm font-bold disabled:opacity-50">{saving && <Loader2 className="w-4 h-4 animate-spin" />}{t('حفظ الأهداف', 'Save targets')}</button>
            : <p className="text-[12.5px] text-slate-500">{t('يحدّد الأهدافَ مديرُ القسم أو قائدُ الفريق.', 'Set by the section manager or team leader.')}</p>}
        </div>
      ))}
      {tab === 'approvals' && (!appr ? <Spinner /> : (
        <div className="rounded-2xl border border-slate-200 bg-white shadow-sm p-5 space-y-4 max-w-3xl">
          <p className="text-sm text-slate-600">{t('يعتمد الموردين الجدد مديرُ العمليات (ومن له صلاحيّاته)، ومعه من يختارهم هنا من الفريق.', 'New carriers are approved by the operations manager (and who holds his rights) plus the members picked here.')}</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {appr.team.map((u) => (
              <label key={u.id} className="flex items-center gap-2 rounded-lg border border-slate-200 px-3 py-2 text-sm">
                <input type="checkbox" disabled={!appr.canManage} checked={picked.includes(u.id)} onChange={(e) => setPicked((p) => (e.target.checked ? [...p, u.id] : p.filter((x) => x !== u.id)))} className="accent-[#f37121]" />
                {u.name}
              </label>
            ))}
          </div>
          {appr.canManage
            ? <button type="button" onClick={saveApprovers} disabled={saving} className="inline-flex items-center gap-1.5 px-5 py-2.5 rounded-xl bg-[#f37121] text-white text-sm font-bold disabled:opacity-50">{saving && <Loader2 className="w-4 h-4 animate-spin" />}{t('حفظ المعتمِدين', 'Save approvers')}</button>
            : <p className="text-[12.5px] text-slate-500">{t('يختار المعتمِدين مديرُ العمليات.', 'Chosen by the operations manager.')}</p>}
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
