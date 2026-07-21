'use client';
// One campaign's full profile: its brief, its numbers as stat cards, and the
// activity log filed under it. Admins edit the details in place — the same
// fields the list modal exposes, without leaving the page.
import { useState, useEffect, useCallback } from 'react';
import { useDialog } from '@/components/system/DialogProvider';
import { useParams, useRouter } from 'next/navigation';
import { useAuth } from '@/context/AuthContext';
import { useLanguage } from '@/context/LanguageContext';
import { useSocket } from '@/hooks/useSocket';
import api from '@/lib/api';
import { Megaphone, ArrowRight, Pencil, X, Loader2, Link as LinkIcon } from 'lucide-react';
import { Spinner, PageHeader, StatCard, PrimaryButton, Field, TextInput, TextArea, Select } from '@/components/hr/HRKit';
import {
  canViewMarketing, canEditMarketing, PLATFORMS, OBJECTIVES, STATUSES,
  platformLabel, objectiveLabel, statusLabel, statusStyle, activityTypeLabel,
  campaignName, personName, num, money, pct,
  type Lang, type Campaign, type Activity, type CampaignStatus, type Platform, type Objective,
} from '@/lib/marketing';

type Draft = Partial<Campaign>;

export default function MarketingCampaignPage() {
  const { notify } = useDialog();
  const { user } = useAuth();
  const { lang, isRTL } = useLanguage();
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const id = params?.id as string;
  const ar = lang === 'ar';
  const L = lang as Lang;
  const admin = canEditMarketing(user);

  const [campaign, setCampaign] = useState<Campaign | null>(null);
  const [activities, setActivities] = useState<Activity[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [draft, setDraft] = useState<Draft>({});

  const load = useCallback(async () => {
    if (!id) return;
    try {
      const r = await api.get<{ campaign: Campaign; activities: Activity[] }>(`/api/marketing/campaigns/${id}`);
      setCampaign(r.campaign);
      setActivities(r.activities || []);
    } catch { /* keep previous */ }
    setLoading(false);
  }, [id]);
  useEffect(() => { load(); }, [load]);
  useSocket('marketing:updated', useCallback(() => load(), [load]));

  const startEdit = () => {
    if (!campaign) return;
    setDraft({
      ...campaign,
      owner: campaign.owner && typeof campaign.owner === 'object' ? campaign.owner._id : (campaign.owner as string) || null,
    });
    setEditing(true);
  };

  const save = async () => {
    if (!draft.name || !draft.name.trim()) { notify(ar ? 'اسم الحملة مطلوب' : 'Campaign name is required'); return; }
    setSaving(true);
    try {
      const body = { ...draft };
      delete (body as Record<string, unknown>)._id;
      await api.put(`/api/marketing/campaigns/${id}`, body);
      setEditing(false);
      load();
    } catch (e: unknown) {
      notify((e as Error)?.message || (ar ? 'فشل الحفظ' : 'Failed to save'), 'error');
    }
    setSaving(false);
  };

  if (!canViewMarketing(user)) {
    return <div className="text-slate-500 p-8">{ar ? 'غير مصرح لك بالوصول إلى قسم التسويق.' : 'You are not authorized to view the Marketing section.'}</div>;
  }
  if (loading && !campaign) return <Spinner />;
  if (!campaign) return <div className="text-slate-500 p-8">{ar ? 'الحملة غير موجودة.' : 'Campaign not found.'}</div>;

  const st = statusStyle(campaign.status);
  const card = 'rounded-xl border border-slate-200 bg-white shadow-sm';
  const setF = (k: keyof Draft, v: unknown) => setDraft((p) => ({ ...p, [k]: v }));
  const numField = (k: keyof Draft, label: string) => (
    <Field label={label}>
      <TextInput type="number" value={String(draft[k] ?? 0)} onChange={(e) => setF(k, Number(e.target.value))} />
    </Field>
  );

  const stats = [
    { label: ar ? 'الميزانية' : 'Budget', value: money(campaign.budget, L), accent: 'text-slate-700' },
    { label: ar ? 'الإنفاق' : 'Spend', value: money(campaign.spend, L), accent: 'text-[#f37121]' },
    { label: ar ? 'الإيراد' : 'Revenue', value: money(campaign.revenue, L), accent: 'text-emerald-600' },
    { label: ar ? 'مرات الظهور' : 'Impressions', value: num(campaign.impressions), accent: 'text-blue-600' },
    { label: ar ? 'الوصول' : 'Reach', value: num(campaign.reach), accent: 'text-sky-600' },
    { label: ar ? 'النقرات' : 'Clicks', value: num(campaign.clicks), accent: 'text-indigo-600' },
    { label: ar ? 'التفاعلات' : 'Engagements', value: num(campaign.engagements), accent: 'text-purple-600' },
    { label: ar ? 'العملاء المحتملون' : 'Leads', value: num(campaign.leads), accent: 'text-emerald-600' },
    { label: ar ? 'التحويلات' : 'Conversions', value: num(campaign.conversions), accent: 'text-teal-600' },
    { label: ar ? 'معدل النقر (CTR)' : 'CTR', value: pct(campaign.ctr), accent: 'text-purple-600' },
    { label: ar ? 'تكلفة العميل (CPL)' : 'CPL', value: money(campaign.cpl, L), accent: 'text-amber-600' },
    { label: 'ROAS', value: campaign.roas != null ? `${Number(campaign.roas).toFixed(2)}×` : '—', accent: 'text-slate-900' },
  ];

  const detail = (label: string, value: string) => (
    <div>
      <p className="text-xs text-slate-500">{label}</p>
      <p className="text-sm text-slate-800 mt-0.5">{value || '—'}</p>
    </div>
  );

  return (
    <div className="space-y-5" dir={isRTL ? 'rtl' : 'ltr'}>
      <PageHeader
        icon={<Megaphone className="w-5 h-5" />}
        title={campaignName(campaign, L)}
        subtitle={`${platformLabel(campaign.platform, L)} · ${objectiveLabel(campaign.objective, L)}`}
      >
        <button type="button" onClick={() => router.push('/system/marketing/campaigns')} className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 text-sm">
          <ArrowRight className={`w-4 h-4 ${isRTL ? '' : 'rotate-180'}`} /> {ar ? 'كل الحملات' : 'All campaigns'}
        </button>
        {admin && !editing && (
          <PrimaryButton onClick={startEdit}><Pencil className="w-4 h-4" /> {ar ? 'تعديل' : 'Edit'}</PrimaryButton>
        )}
        {editing && (
          <>
            <button type="button" onClick={() => setEditing(false)} className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-slate-200 text-slate-700 text-sm">
              <X className="w-4 h-4" /> {ar ? 'إلغاء' : 'Cancel'}
            </button>
            <PrimaryButton onClick={save} disabled={saving}>
              {saving && <Loader2 className="w-4 h-4 animate-spin" />} {ar ? 'حفظ' : 'Save'}
            </PrimaryButton>
          </>
        )}
      </PageHeader>

      {/* Details — read-only card, or the same fields inline for admins */}
      <div className={`${card} p-4`}>
        {!editing ? (
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
            {detail(ar ? 'الحالة' : 'Status', statusLabel(campaign.status, L))}
            {detail(ar ? 'المنصة' : 'Platform', platformLabel(campaign.platform, L))}
            {detail(ar ? 'الهدف' : 'Objective', objectiveLabel(campaign.objective, L))}
            {detail(ar ? 'المسؤول' : 'Owner', personName(campaign.owner))}
            {detail(ar ? 'تاريخ البداية' : 'Start date', campaign.startDate || '')}
            {detail(ar ? 'تاريخ النهاية' : 'End date', campaign.endDate || '')}
            {detail(ar ? 'الجمهور المستهدف' : 'Target audience', campaign.targetAudience || '')}
            {detail(ar ? 'عدد الأنشطة' : 'Activities', String(activities.length))}
            <div className="col-span-2 sm:col-span-3 lg:col-span-4">
              {detail(ar ? 'الوصف' : 'Description', campaign.description || '')}
            </div>
            {campaign.notes && (
              <div className="col-span-2 sm:col-span-3 lg:col-span-4">
                {detail(ar ? 'ملاحظات' : 'Notes', campaign.notes)}
              </div>
            )}
            {st && (
              <div className="col-span-2 sm:col-span-3 lg:col-span-4">
                <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${st.bg} ${st.text}`}>{statusLabel(campaign.status, L)}</span>
              </div>
            )}
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            <Field label={ar ? 'اسم الحملة (إنجليزي)' : 'Campaign name (EN)'}>
              <TextInput value={draft.name || ''} onChange={(e) => setF('name', e.target.value)} />
            </Field>
            <Field label={ar ? 'اسم الحملة (عربي)' : 'Campaign name (AR)'}>
              <TextInput value={draft.nameAr || ''} onChange={(e) => setF('nameAr', e.target.value)} />
            </Field>
            <Field label={ar ? 'المنصة' : 'Platform'}>
              <Select value={draft.platform || 'other'} onChange={(e) => setF('platform', e.target.value as Platform)}>
                {Object.keys(PLATFORMS).map((k) => <option key={k} value={k}>{platformLabel(k, L)}</option>)}
              </Select>
            </Field>
            <Field label={ar ? 'الهدف' : 'Objective'}>
              <Select value={draft.objective || 'awareness'} onChange={(e) => setF('objective', e.target.value as Objective)}>
                {Object.keys(OBJECTIVES).map((k) => <option key={k} value={k}>{objectiveLabel(k, L)}</option>)}
              </Select>
            </Field>
            <Field label={ar ? 'الحالة' : 'Status'}>
              <Select value={draft.status || 'planned'} onChange={(e) => setF('status', e.target.value as CampaignStatus)}>
                {Object.keys(STATUSES).map((k) => <option key={k} value={k}>{statusLabel(k, L)}</option>)}
              </Select>
            </Field>
            <Field label={ar ? 'الجمهور المستهدف' : 'Target audience'}>
              <TextInput value={draft.targetAudience || ''} onChange={(e) => setF('targetAudience', e.target.value)} />
            </Field>
            <Field label={ar ? 'تاريخ البداية' : 'Start date'}>
              <TextInput type="date" value={draft.startDate || ''} onChange={(e) => setF('startDate', e.target.value)} />
            </Field>
            <Field label={ar ? 'تاريخ النهاية' : 'End date'}>
              <TextInput type="date" value={draft.endDate || ''} onChange={(e) => setF('endDate', e.target.value)} />
            </Field>
            {numField('budget', ar ? 'الميزانية' : 'Budget')}
            {numField('spend', ar ? 'الإنفاق' : 'Spend')}
            {numField('revenue', ar ? 'الإيراد' : 'Revenue')}
            {numField('impressions', ar ? 'مرات الظهور' : 'Impressions')}
            {numField('reach', ar ? 'الوصول' : 'Reach')}
            {numField('clicks', ar ? 'النقرات' : 'Clicks')}
            {numField('engagements', ar ? 'التفاعلات' : 'Engagements')}
            {numField('leads', ar ? 'العملاء المحتملون' : 'Leads')}
            {numField('conversions', ar ? 'التحويلات' : 'Conversions')}
            <Field label={ar ? 'الوصف' : 'Description'} span2>
              <TextArea rows={3} value={draft.description || ''} onChange={(e) => setF('description', e.target.value)} />
            </Field>
            <Field label={ar ? 'ملاحظات' : 'Notes'} span2>
              <TextArea rows={2} value={draft.notes || ''} onChange={(e) => setF('notes', e.target.value)} />
            </Field>
          </div>
        )}
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        {stats.map((s) => <StatCard key={s.label} label={s.label} value={s.value} accent={s.accent} />)}
      </div>

      {/* Activities filed under this campaign */}
      <div className={`${card} overflow-hidden`}>
        <div className="px-4 py-3 border-b border-slate-200 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-slate-800">{ar ? 'أنشطة الحملة' : 'Campaign activities'}</h2>
          <button type="button" onClick={() => router.push('/system/marketing/activities')} className="text-xs text-[#f37121] hover:underline">
            {ar ? 'سجل الأنشطة الكامل' : 'Full activity log'}
          </button>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-900 text-slate-300">
              <tr>
                <th className="px-4 py-3 text-start font-medium">{ar ? 'التاريخ' : 'Date'}</th>
                <th className="px-4 py-3 text-start font-medium">{ar ? 'العنوان' : 'Title'}</th>
                <th className="px-4 py-3 text-start font-medium">{ar ? 'المنصة' : 'Platform'}</th>
                <th className="px-4 py-3 text-start font-medium">{ar ? 'النوع' : 'Type'}</th>
                <th className="px-4 py-3 text-start font-medium">{ar ? 'الظهور' : 'Impressions'}</th>
                <th className="px-4 py-3 text-start font-medium">{ar ? 'النقرات' : 'Clicks'}</th>
                <th className="px-4 py-3 text-start font-medium">{ar ? 'العملاء المحتملون' : 'Leads'}</th>
                <th className="px-4 py-3 text-start font-medium">{ar ? 'نفّذها' : 'By'}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {activities.length === 0 ? (
                <tr><td colSpan={8} className="px-4 py-10 text-center text-slate-400">{ar ? 'لا توجد أنشطة لهذه الحملة.' : 'No activities for this campaign.'}</td></tr>
              ) : activities.map((a) => (
                <tr key={a._id} className="hover:bg-slate-50">
                  <td className="px-4 py-3 text-start text-slate-600 whitespace-nowrap">{a.date}</td>
                  <td className="px-4 py-3 text-start text-slate-800">
                    <span className="inline-flex items-center gap-1.5">
                      {a.title || '—'}
                      {a.link && <a href={a.link} target="_blank" rel="noreferrer" className="text-[#f37121]" onClick={(e) => e.stopPropagation()}><LinkIcon className="w-3.5 h-3.5" /></a>}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-start text-slate-600">{platformLabel(a.platform, L)}</td>
                  <td className="px-4 py-3 text-start text-slate-600">{activityTypeLabel(a.type, L)}</td>
                  <td className="px-4 py-3 text-start tabular-nums text-slate-700">{num(a.metrics?.impressions)}</td>
                  <td className="px-4 py-3 text-start tabular-nums text-slate-700">{num(a.metrics?.clicks)}</td>
                  <td className="px-4 py-3 text-start tabular-nums text-emerald-600 font-medium">{num(a.metrics?.leads)}</td>
                  <td className="px-4 py-3 text-start text-slate-600">{a.performedByName || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
