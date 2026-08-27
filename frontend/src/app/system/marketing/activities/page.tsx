'use client';
// Marketing activity log (سجل الأنشطة التسويقية) — the section's history: every
// post, story, reel, ad, design, email and event we published, with the day it
// went out and the numbers it brought back. The daily/weekly/monthly report on
// /marketing/reports is nothing more than these rows bucketed by date, so this
// is where the reportable truth is entered.
import { useState, useEffect, useCallback } from 'react';
import { useDialog } from '@/components/system/DialogProvider';
import { useAuth } from '@/context/AuthContext';
import { useLanguage } from '@/context/LanguageContext';
import { useSocket } from '@/hooks/useSocket';
import api from '@/lib/api';
import { ListChecks, Plus, Pencil, Trash2, RefreshCw, Loader2, Link as LinkIcon } from 'lucide-react';
import { Spinner, PageHeader, SearchInput, PrimaryButton, Modal, Field, TextInput, TextArea, Select } from '@/components/hr/HRKit';
import ExportMenu, { exportScopeLabels, type ExportColumn } from '@/components/ls2/ExportMenu';
import RangePicker from '@/components/marketing/RangePicker';
import {
  canViewMarketing, canEditMarketing, PLATFORMS, ACTIVITY_TYPES,
  platformLabel, activityTypeLabel, campaignName, emptyMetrics, engagementOf,
  thisMonthToDate, toIso, num,
  type Lang, type DateRange, type Activity, type ActivityMetrics, type Campaign, type Platform, type ActivityType,
} from '@/lib/marketing';

type Draft = Omit<Partial<Activity>, 'campaign' | 'metrics'> & { campaign?: string | null; metrics: ActivityMetrics };

const blankDraft = (): Draft => ({
  date: toIso(new Date()), campaign: null, platform: 'facebook', type: 'post',
  title: '', description: '', link: '', notes: '', metrics: emptyMetrics(),
});

const campaignId = (c: Activity['campaign']) => (c && typeof c === 'object' ? c._id : (c as string) || null);

export default function MarketingActivitiesPage() {
  const { confirm, notify } = useDialog();
  const { user } = useAuth();
  const { lang, isRTL } = useLanguage();
  const ar = lang === 'ar';
  const L = lang as Lang;
  const admin = canEditMarketing(user);

  const [items, setItems] = useState<Activity[]>([]);
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [range, setRange] = useState<DateRange>(thisMonthToDate());
  const [q, setQ] = useState('');
  const [platform, setPlatform] = useState('all');
  const [type, setType] = useState('all');
  const [campaign, setCampaign] = useState('all');
  const [open, setOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft>(blankDraft());

  // Filtering is server-side here: the log grows without bound, unlike campaigns.
  const load = useCallback(async () => {
    try {
      const qs = new URLSearchParams({ from: range.from, to: range.to, platform, type, campaign });
      if (q.trim()) qs.set('q', q.trim());
      const [a, c] = await Promise.all([
        api.get<{ items: Activity[] }>(`/api/marketing/activities?${qs.toString()}`),
        api.get<{ items: Campaign[] }>('/api/marketing/campaigns'),
      ]);
      setItems(a.items || []);
      setCampaigns(c.items || []);
    } catch { /* keep previous */ }
    setLoading(false);
  }, [range.from, range.to, platform, type, campaign, q]);

  useEffect(() => {
    const h = setTimeout(() => { load(); }, 250); // debounce the search box
    return () => clearTimeout(h);
  }, [load]);
  useSocket('marketing:updated', useCallback(() => load(), [load]));

  const openCreate = () => { setEditingId(null); setDraft(blankDraft()); setOpen(true); };
  const openEdit = (a: Activity) => {
    setEditingId(a._id);
    setDraft({
      ...a,
      campaign: campaignId(a.campaign),
      metrics: { ...emptyMetrics(), ...(a.metrics || {}) },
    });
    setOpen(true);
  };

  const save = async () => {
    if (!draft.date) { notify(ar ? 'التاريخ مطلوب' : 'Date is required'); return; }
    setSaving(true);
    try {
      const body = { ...draft };
      delete (body as Record<string, unknown>)._id;
      if (editingId) await api.put(`/api/marketing/activities/${editingId}`, body);
      else await api.post('/api/marketing/activities', body);
      setOpen(false);
      load();
    } catch (e: unknown) {
      notify((e as Error)?.message || (ar ? 'فشل الحفظ' : 'Failed to save'), 'error');
    }
    setSaving(false);
  };

  const remove = async (a: Activity) => {
    if (!(await confirm(ar ? `حذف النشاط "${a.title || a.date}"؟` : `Delete activity "${a.title || a.date}"?`))) return;
    try { await api.delete(`/api/marketing/activities/${a._id}`); load(); }
    catch (e: unknown) { notify((e as Error)?.message || 'Failed', 'error'); }
  };

  const exportColumns: ExportColumn[] = [
    { header: ar ? 'التاريخ' : 'Date', key: 'date', transform: (v) => v || '', width: 14 },
    { header: ar ? 'العنوان' : 'Title', key: 'title', transform: (v) => v || '', width: 30 },
    { header: ar ? 'الحملة' : 'Campaign', key: 'campaign', transform: (v) => (v && typeof v === 'object' ? campaignName(v as Campaign, L) : ''), width: 24 },
    { header: ar ? 'المنصة' : 'Platform', key: 'platform', transform: (v) => platformLabel(v as string, L), width: 16 },
    { header: ar ? 'النوع' : 'Type', key: 'type', transform: (v) => activityTypeLabel(v as string, L), width: 14 },
    { header: ar ? 'الظهور' : 'Impressions', key: 'metrics.impressions', transform: (v) => v ?? 0, width: 14 },
    { header: ar ? 'الوصول' : 'Reach', key: 'metrics.reach', transform: (v) => v ?? 0, width: 12 },
    { header: ar ? 'النقرات' : 'Clicks', key: 'metrics.clicks', transform: (v) => v ?? 0, width: 12 },
    { header: ar ? 'إعجابات' : 'Likes', key: 'metrics.likes', transform: (v) => v ?? 0, width: 10 },
    { header: ar ? 'تعليقات' : 'Comments', key: 'metrics.comments', transform: (v) => v ?? 0, width: 10 },
    { header: ar ? 'مشاركات' : 'Shares', key: 'metrics.shares', transform: (v) => v ?? 0, width: 10 },
    { header: ar ? 'العملاء المحتملون' : 'Leads', key: 'metrics.leads', transform: (v) => v ?? 0, width: 14 },
    { header: ar ? 'نفّذها' : 'Performed by', key: 'performedByName', transform: (v) => v || '', width: 20 },
    { header: ar ? 'الرابط' : 'Link', key: 'link', transform: (v) => v || '', width: 32 },
    { header: ar ? 'ملاحظات' : 'Notes', key: 'notes', transform: (v) => v || '', width: 28 },
  ];
  // الفلترة كلّها على الخادم — المدى الزمنيّ أوّلها — فما في الذاكرة هو شهرٌ واحد
  // افتراضًا لا السجلّ كلّه؛ ومَن صدّر ظنّ أنّه أخذ الأنشطة جميعها. خيار «الكلّ»
  // يعيد النداء بلا مدًى ولا منصّةٍ ولا نوع. والخادم يسقّف المسار بثلاثة آلاف نشاط.
  const sheetName = ar ? 'الأنشطة' : 'Activities';
  const fetchAllForExport = async () => {
    const d = await api.get<{ items: Activity[] }>('/api/marketing/activities');
    return [{ name: sheetName, rows: (d.items || []) as unknown as Record<string, unknown>[], columns: exportColumns }];
  };
  const hasActiveFilters = !!(q.trim() || platform !== 'all' || type !== 'all' || campaign !== 'all' || range.from || range.to);
  const scope = exportScopeLabels(ar);
  const exportOptions = [
    { key: 'shown', label: hasActiveFilters ? scope.shown : scope.all, sheets: [{ name: sheetName, rows: items as unknown as Record<string, unknown>[], columns: exportColumns }] },
    ...(hasActiveFilters ? [{ key: 'all', label: scope.all, resolve: fetchAllForExport }] : []),
  ];

  if (!canViewMarketing(user)) {
    return <div className="text-slate-500 p-8">{ar ? 'غير مصرح لك بالوصول إلى قسم التسويق.' : 'You are not authorized to view the Marketing section.'}</div>;
  }
  if (loading && !items.length) return <Spinner />;

  const setF = (k: keyof Draft, v: unknown) => setDraft((p) => ({ ...p, [k]: v } as Draft));
  const setM = (k: keyof ActivityMetrics, v: number) => setDraft((p) => ({ ...p, metrics: { ...p.metrics, [k]: v } }));
  const metricField = (k: keyof ActivityMetrics, label: string) => (
    <Field key={k} label={label}>
      <TextInput type="number" value={String(draft.metrics?.[k] ?? 0)} onChange={(e) => setM(k, Number(e.target.value))} />
    </Field>
  );

  return (
    <div className="space-y-5" dir={isRTL ? 'rtl' : 'ltr'}>
      <PageHeader
        icon={<ListChecks className="w-5 h-5" />}
        title={ar ? 'سجل الأنشطة التسويقية' : 'Marketing Activity Log'}
        subtitle={ar ? 'كل ما نُشر ومتى وبأي نتيجة' : 'Everything we published, when, and what it returned'}
      >
        <ExportMenu fileName="marketing-activities" lang={ar ? 'ar' : 'en'} variant="subtle" label={ar ? 'تصدير Excel' : 'Export Excel'} options={exportOptions} />
        <button type="button" onClick={() => load()} className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 text-sm">
          <RefreshCw className="w-4 h-4" /> {ar ? 'تحديث' : 'Refresh'}
        </button>
        {admin && <PrimaryButton onClick={openCreate}><Plus className="w-4 h-4" /> {ar ? 'نشاط جديد' : 'New activity'}</PrimaryButton>}
      </PageHeader>

      <RangePicker value={range} onChange={setRange} lang={L} />

      <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
        <SearchInput value={q} onChange={setQ} placeholder={ar ? 'ابحث بالعنوان أو الوصف…' : 'Search title or description…'} />
        <Select value={platform} onChange={(e) => setPlatform(e.target.value)}>
          <option value="all">{ar ? 'كل المنصات' : 'All platforms'}</option>
          {Object.keys(PLATFORMS).map((k) => <option key={k} value={k}>{platformLabel(k, L)}</option>)}
        </Select>
        <Select value={type} onChange={(e) => setType(e.target.value)}>
          <option value="all">{ar ? 'كل الأنواع' : 'All types'}</option>
          {Object.keys(ACTIVITY_TYPES).map((k) => <option key={k} value={k}>{activityTypeLabel(k, L)}</option>)}
        </Select>
        <Select value={campaign} onChange={(e) => setCampaign(e.target.value)}>
          <option value="all">{ar ? 'كل الحملات' : 'All campaigns'}</option>
          {campaigns.map((c) => <option key={c._id} value={c._id}>{campaignName(c, L)}</option>)}
        </Select>
      </div>

      <div className="rounded-xl border border-slate-200 bg-white shadow-sm overflow-hidden">
        <div className="px-4 py-2.5 border-b border-slate-200 text-xs text-slate-500 text-start">
          {ar ? `${items.length} نشاط في هذه الفترة` : `${items.length} activities in this period`}
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-900 text-slate-300">
              <tr>
                <th className="px-4 py-3 text-start font-medium">{ar ? 'التاريخ' : 'Date'}</th>
                <th className="px-4 py-3 text-start font-medium">{ar ? 'العنوان' : 'Title'}</th>
                <th className="px-4 py-3 text-start font-medium">{ar ? 'الحملة' : 'Campaign'}</th>
                <th className="px-4 py-3 text-start font-medium">{ar ? 'المنصة' : 'Platform'}</th>
                <th className="px-4 py-3 text-start font-medium">{ar ? 'النوع' : 'Type'}</th>
                <th className="px-4 py-3 text-start font-medium">{ar ? 'الظهور' : 'Impr.'}</th>
                <th className="px-4 py-3 text-start font-medium">{ar ? 'النقرات' : 'Clicks'}</th>
                <th className="px-4 py-3 text-start font-medium">{ar ? 'التفاعل' : 'Engag.'}</th>
                <th className="px-4 py-3 text-start font-medium">{ar ? 'محتملون' : 'Leads'}</th>
                <th className="px-4 py-3 text-start font-medium">{ar ? 'نفّذها' : 'By'}</th>
                {admin && <th className="px-4 py-3 text-end font-medium">{ar ? 'إجراءات' : 'Actions'}</th>}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {items.length === 0 ? (
                <tr><td colSpan={admin ? 11 : 10} className="px-4 py-10 text-center text-slate-400">{ar ? 'لا توجد أنشطة في هذه الفترة.' : 'No activities in this period.'}</td></tr>
              ) : items.map((a) => (
                <tr key={a._id} className="hover:bg-slate-50">
                  <td className="px-4 py-3 text-start text-slate-600 whitespace-nowrap">{a.date}</td>
                  <td className="px-4 py-3 text-start text-slate-800">
                    <span className="inline-flex items-center gap-1.5">
                      {a.title || '—'}
                      {a.link && <a href={a.link} target="_blank" rel="noreferrer" className="text-[#f37121]"><LinkIcon className="w-3.5 h-3.5" /></a>}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-start text-slate-600">{a.campaign && typeof a.campaign === 'object' ? campaignName(a.campaign, L) : '—'}</td>
                  <td className="px-4 py-3 text-start text-slate-600">{platformLabel(a.platform, L)}</td>
                  <td className="px-4 py-3 text-start text-slate-600">{activityTypeLabel(a.type, L)}</td>
                  <td className="px-4 py-3 text-start tabular-nums text-slate-700">{num(a.metrics?.impressions)}</td>
                  <td className="px-4 py-3 text-start tabular-nums text-slate-700">{num(a.metrics?.clicks)}</td>
                  <td className="px-4 py-3 text-start tabular-nums text-purple-600">{num(engagementOf(a.metrics))}</td>
                  <td className="px-4 py-3 text-start tabular-nums text-emerald-600 font-medium">{num(a.metrics?.leads)}</td>
                  <td className="px-4 py-3 text-start text-slate-600">{a.performedByName || '—'}</td>
                  {admin && (
                    <td className="px-4 py-3 text-end whitespace-nowrap">
                      <button type="button" onClick={() => openEdit(a)} className="p-1.5 rounded-lg hover:bg-slate-200 text-slate-600" aria-label="Edit"><Pencil className="w-4 h-4" /></button>
                      <button type="button" onClick={() => remove(a)} className="p-1.5 rounded-lg hover:bg-red-100 text-red-600 ms-1" aria-label="Delete"><Trash2 className="w-4 h-4" /></button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        wide
        title={editingId ? (ar ? 'تعديل النشاط' : 'Edit activity') : (ar ? 'نشاط جديد' : 'New activity')}
        footer={
          <>
            <button type="button" onClick={() => setOpen(false)} className="px-4 py-2 rounded-lg bg-slate-200 text-slate-700 text-sm">{ar ? 'إلغاء' : 'Cancel'}</button>
            <PrimaryButton onClick={save} disabled={saving}>
              {saving && <Loader2 className="w-4 h-4 animate-spin" />} {ar ? 'حفظ' : 'Save'}
            </PrimaryButton>
          </>
        }
      >
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Field label={ar ? 'التاريخ' : 'Date'}>
            <TextInput type="date" value={draft.date || ''} onChange={(e) => setF('date', e.target.value)} />
          </Field>
          <Field label={ar ? 'الحملة (اختياري)' : 'Campaign (optional)'}>
            <Select value={draft.campaign || ''} onChange={(e) => setF('campaign', e.target.value || null)}>
              <option value="">{ar ? 'بدون حملة' : 'No campaign'}</option>
              {campaigns.map((c) => <option key={c._id} value={c._id}>{campaignName(c, L)}</option>)}
            </Select>
          </Field>
          <Field label={ar ? 'المنصة' : 'Platform'}>
            <Select value={draft.platform || 'other'} onChange={(e) => setF('platform', e.target.value as Platform)}>
              {Object.keys(PLATFORMS).map((k) => <option key={k} value={k}>{platformLabel(k, L)}</option>)}
            </Select>
          </Field>
          <Field label={ar ? 'النوع' : 'Type'}>
            <Select value={draft.type || 'post'} onChange={(e) => setF('type', e.target.value as ActivityType)}>
              {Object.keys(ACTIVITY_TYPES).map((k) => <option key={k} value={k}>{activityTypeLabel(k, L)}</option>)}
            </Select>
          </Field>
          <Field label={ar ? 'العنوان' : 'Title'} span2>
            <TextInput value={draft.title || ''} onChange={(e) => setF('title', e.target.value)} />
          </Field>
          <Field label={ar ? 'الرابط' : 'Link'} span2>
            <TextInput value={draft.link || ''} onChange={(e) => setF('link', e.target.value)} placeholder="https://…" />
          </Field>
          <Field label={ar ? 'نفّذها' : 'Performed by'} span2>
            <TextInput value={draft.performedByName || ''} onChange={(e) => setF('performedByName', e.target.value)} placeholder={ar ? 'يُملأ باسمك تلقائياً إن تُرك فارغاً' : 'Defaults to your name if left blank'} />
          </Field>

          <div className="sm:col-span-2 grid grid-cols-2 sm:grid-cols-4 gap-3">
            {metricField('impressions', ar ? 'الظهور' : 'Impressions')}
            {metricField('reach', ar ? 'الوصول' : 'Reach')}
            {metricField('clicks', ar ? 'النقرات' : 'Clicks')}
            {metricField('leads', ar ? 'محتملون' : 'Leads')}
            {metricField('likes', ar ? 'إعجابات' : 'Likes')}
            {metricField('comments', ar ? 'تعليقات' : 'Comments')}
            {metricField('shares', ar ? 'مشاركات' : 'Shares')}
          </div>

          <Field label={ar ? 'الوصف' : 'Description'} span2>
            <TextArea rows={3} value={draft.description || ''} onChange={(e) => setF('description', e.target.value)} />
          </Field>
          <Field label={ar ? 'ملاحظات' : 'Notes'} span2>
            <TextArea rows={2} value={draft.notes || ''} onChange={(e) => setF('notes', e.target.value)} />
          </Field>
        </div>
      </Modal>
    </div>
  );
}
