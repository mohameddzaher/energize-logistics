'use client';
// Marketing campaigns (الحملات التسويقية) — the list every campaign lives on:
// search, status/platform filters, create/edit/delete and an Excel export.
// Clicking a row opens the campaign's own page with its activities.
import { useState, useEffect, useCallback, useMemo } from 'react';
import { useDialog } from '@/components/system/DialogProvider';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/context/AuthContext';
import { useLanguage } from '@/context/LanguageContext';
import { useSocket } from '@/hooks/useSocket';
import api from '@/lib/api';
import { Megaphone, Plus, Pencil, Trash2, RefreshCw, Loader2 } from 'lucide-react';
import { Spinner, PageHeader, SearchInput, PrimaryButton, Modal, Field, TextInput, TextArea, Select } from '@/components/hr/HRKit';
import ExportMenu, { exportScopeLabels, type ExportColumn } from '@/components/ls2/ExportMenu';
import {
  canViewMarketing, canEditMarketing, PLATFORMS, OBJECTIVES, STATUSES,
  platformLabel, objectiveLabel, statusLabel, statusStyle, campaignName, personName,
  num, money, pct, type Lang, type Campaign, type CampaignStatus, type Platform, type Objective,
} from '@/lib/marketing';

type Draft = Partial<Campaign> & { owner?: string | null };

const blankDraft = (): Draft => ({
  name: '', nameAr: '', platform: 'facebook', objective: 'awareness', status: 'planned',
  startDate: '', endDate: '', budget: 0, spend: 0, revenue: 0, targetAudience: '',
  description: '', notes: '', impressions: 0, clicks: 0, leads: 0, conversions: 0, reach: 0, engagements: 0,
});

export default function MarketingCampaignsPage() {
  const { confirm, notify } = useDialog();
  const { user } = useAuth();
  const { lang, isRTL } = useLanguage();
  const router = useRouter();
  const ar = lang === 'ar';
  const L = lang as Lang;
  const admin = canEditMarketing(user);

  const [items, setItems] = useState<Campaign[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [q, setQ] = useState('');
  const [status, setStatus] = useState<string>('all');
  const [platform, setPlatform] = useState<string>('all');
  const [open, setOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft>(blankDraft());

  const load = useCallback(async () => {
    try {
      const r = await api.get<{ items: Campaign[] }>('/api/marketing/campaigns');
      setItems(r.items || []);
    } catch { /* keep previous */ }
    setLoading(false);
  }, []);
  useEffect(() => { load(); }, [load]);
  useSocket('marketing:updated', useCallback(() => load(), [load]));

  // Filtering stays client-side: the whole campaign list is small and it keeps
  // typing instant.
  const rows = useMemo(() => {
    const term = q.trim().toLowerCase();
    return items.filter((c) => {
      if (status !== 'all' && c.status !== status) return false;
      if (platform !== 'all' && c.platform !== platform) return false;
      if (!term) return true;
      return [c.name, c.nameAr, c.description, c.targetAudience, c.notes]
        .some((x) => (x || '').toLowerCase().includes(term));
    });
  }, [items, q, status, platform]);

  const openCreate = () => { setEditingId(null); setDraft(blankDraft()); setOpen(true); };
  const openEdit = (c: Campaign) => {
    setEditingId(c._id);
    setDraft({
      ...c,
      owner: c.owner && typeof c.owner === 'object' ? c.owner._id : (c.owner as string) || null,
    });
    setOpen(true);
  };

  const save = async () => {
    if (!draft.name || !draft.name.trim()) { notify(ar ? 'اسم الحملة مطلوب' : 'Campaign name is required'); return; }
    setSaving(true);
    try {
      const body = { ...draft };
      delete (body as Record<string, unknown>)._id;
      if (editingId) await api.put(`/api/marketing/campaigns/${editingId}`, body);
      else await api.post('/api/marketing/campaigns', body);
      setOpen(false);
      load();
    } catch (e: unknown) {
      notify((e as Error)?.message || (ar ? 'فشل الحفظ' : 'Failed to save'), 'error');
    }
    setSaving(false);
  };

  const remove = async (c: Campaign) => {
    if (!(await confirm(ar ? `حذف الحملة "${campaignName(c, L)}"؟` : `Delete campaign "${campaignName(c, L)}"?`))) return;
    try { await api.delete(`/api/marketing/campaigns/${c._id}`); load(); }
    catch (e: unknown) { notify((e as Error)?.message || 'Failed', 'error'); }
  };

  const exportColumns: ExportColumn[] = [
    { header: ar ? 'الحملة' : 'Campaign', key: 'name', transform: (_v, r) => campaignName(r as Campaign, L), width: 28 },
    { header: ar ? 'المنصة' : 'Platform', key: 'platform', transform: (v) => platformLabel(v as string, L), width: 16 },
    { header: ar ? 'الهدف' : 'Objective', key: 'objective', transform: (v) => objectiveLabel(v as string, L), width: 18 },
    { header: ar ? 'الحالة' : 'Status', key: 'status', transform: (v) => statusLabel(v as string, L), width: 14 },
    { header: ar ? 'من' : 'Start', key: 'startDate', transform: (v) => v || '', width: 14 },
    { header: ar ? 'إلى' : 'End', key: 'endDate', transform: (v) => v || '', width: 14 },
    { header: ar ? 'الميزانية' : 'Budget', key: 'budget', transform: (v) => v ?? 0, width: 14 },
    { header: ar ? 'الإنفاق' : 'Spend', key: 'spend', transform: (v) => v ?? 0, width: 14 },
    { header: ar ? 'الإيراد' : 'Revenue', key: 'revenue', transform: (v) => v ?? 0, width: 14 },
    { header: ar ? 'الظهور' : 'Impressions', key: 'impressions', transform: (v) => v ?? 0, width: 14 },
    { header: ar ? 'النقرات' : 'Clicks', key: 'clicks', transform: (v) => v ?? 0, width: 12 },
    { header: ar ? 'العملاء المحتملون' : 'Leads', key: 'leads', transform: (v) => v ?? 0, width: 14 },
    { header: ar ? 'التحويلات' : 'Conversions', key: 'conversions', transform: (v) => v ?? 0, width: 14 },
    { header: 'CTR %', key: 'ctr', transform: (v) => Number(v ?? 0).toFixed(2), width: 10 },
    { header: 'CPL', key: 'cpl', transform: (v) => Number(v ?? 0).toFixed(2), width: 10 },
    { header: ar ? 'المسؤول' : 'Owner', key: 'owner', transform: (v) => personName(v as never), width: 20 },
  ];
  // الحملات تُفلتَر في المتصفّح (بحث وحالة ومنصّة)، وكان زرُّ التصدير يأخذ
  // المفلتَر وحده باسم «الحملات» — فيخرج ملفٌّ ناقصٌ لا شيء فيه يشي بنقصه.
  const scope = exportScopeLabels(ar);
  const sheetName = ar ? 'الحملات' : 'Campaigns';
  const exportOptions = [
    { key: 'shown', label: scope.shown, sheets: [{ name: sheetName, rows: rows as unknown as Record<string, unknown>[], columns: exportColumns }] },
    { key: 'all', label: scope.all, sheets: [{ name: sheetName, rows: items as unknown as Record<string, unknown>[], columns: exportColumns }] },
  ];

  if (!canViewMarketing(user)) {
    return <div className="text-slate-500 p-8">{ar ? 'غير مصرح لك بالوصول إلى قسم التسويق.' : 'You are not authorized to view the Marketing section.'}</div>;
  }
  if (loading && !items.length) return <Spinner />;

  const setF = (k: keyof Draft, v: unknown) => setDraft((p) => ({ ...p, [k]: v }));
  const numField = (k: keyof Draft, label: string) => (
    <Field label={label}>
      <TextInput type="number" value={String(draft[k] ?? 0)} onChange={(e) => setF(k, Number(e.target.value))} />
    </Field>
  );

  return (
    <div className="space-y-5" dir={isRTL ? 'rtl' : 'ltr'}>
      <PageHeader
        icon={<Megaphone className="w-5 h-5" />}
        title={ar ? 'الحملات التسويقية' : 'Marketing Campaigns'}
        subtitle={ar ? 'كل حملة بميزانيتها وأهدافها ونتائجها' : 'Every campaign with its budget, objective and results'}
      >
        <ExportMenu fileName="marketing-campaigns" lang={ar ? 'ar' : 'en'} variant="subtle" label={ar ? 'تصدير Excel' : 'Export Excel'} options={exportOptions} />
        <button type="button" onClick={() => load()} className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 text-sm">
          <RefreshCw className="w-4 h-4" /> {ar ? 'تحديث' : 'Refresh'}
        </button>
        {admin && <PrimaryButton onClick={openCreate}><Plus className="w-4 h-4" /> {ar ? 'حملة جديدة' : 'New campaign'}</PrimaryButton>}
      </PageHeader>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <SearchInput value={q} onChange={setQ} placeholder={ar ? 'ابحث باسم الحملة أو الوصف…' : 'Search by name or description…'} />
        <Select value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="all">{ar ? 'كل الحالات' : 'All statuses'}</option>
          {Object.keys(STATUSES).map((k) => <option key={k} value={k}>{statusLabel(k, L)}</option>)}
        </Select>
        <Select value={platform} onChange={(e) => setPlatform(e.target.value)}>
          <option value="all">{ar ? 'كل المنصات' : 'All platforms'}</option>
          {Object.keys(PLATFORMS).map((k) => <option key={k} value={k}>{platformLabel(k, L)}</option>)}
        </Select>
      </div>

      <div className="rounded-xl border border-slate-200 bg-white shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-900 text-slate-300">
              <tr>
                <th className="px-4 py-3 text-start font-medium">{ar ? 'الحملة' : 'Campaign'}</th>
                <th className="px-4 py-3 text-start font-medium">{ar ? 'المنصة' : 'Platform'}</th>
                <th className="px-4 py-3 text-start font-medium">{ar ? 'الهدف' : 'Objective'}</th>
                <th className="px-4 py-3 text-start font-medium">{ar ? 'الحالة' : 'Status'}</th>
                <th className="px-4 py-3 text-start font-medium">{ar ? 'الفترة' : 'Period'}</th>
                <th className="px-4 py-3 text-start font-medium">{ar ? 'الإنفاق / الميزانية' : 'Spend / Budget'}</th>
                <th className="px-4 py-3 text-start font-medium">{ar ? 'العملاء المحتملون' : 'Leads'}</th>
                <th className="px-4 py-3 text-start font-medium">CTR</th>
                {admin && <th className="px-4 py-3 text-end font-medium">{ar ? 'إجراءات' : 'Actions'}</th>}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {rows.length === 0 ? (
                <tr><td colSpan={admin ? 9 : 8} className="px-4 py-10 text-center text-slate-400">{ar ? 'لا توجد حملات مطابقة.' : 'No matching campaigns.'}</td></tr>
              ) : rows.map((c) => {
                const st = statusStyle(c.status);
                return (
                  <tr key={c._id} className="hover:bg-slate-50 cursor-pointer" onClick={() => router.push(`/system/marketing/campaigns/${c._id}`)}>
                    <td className="px-4 py-3 text-start">
                      <p className="font-medium text-slate-800">{campaignName(c, L)}</p>
                      {c.targetAudience && <p className="text-xs text-slate-500 truncate max-w-[240px]">{c.targetAudience}</p>}
                    </td>
                    <td className="px-4 py-3 text-start text-slate-600">{platformLabel(c.platform, L)}</td>
                    <td className="px-4 py-3 text-start text-slate-600">{objectiveLabel(c.objective, L)}</td>
                    <td className="px-4 py-3 text-start">
                      {st && <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${st.bg} ${st.text}`}>{statusLabel(c.status, L)}</span>}
                    </td>
                    <td className="px-4 py-3 text-start text-slate-600 whitespace-nowrap text-xs">{c.startDate || '—'} → {c.endDate || '—'}</td>
                    <td className="px-4 py-3 text-start text-slate-700 tabular-nums whitespace-nowrap">{money(c.spend, L)} / {money(c.budget, L)}</td>
                    <td className="px-4 py-3 text-start font-semibold text-emerald-600 tabular-nums">{num(c.leads)}</td>
                    <td className="px-4 py-3 text-start text-slate-600 tabular-nums">{pct(c.ctr)}</td>
                    {admin && (
                      <td className="px-4 py-3 text-end whitespace-nowrap" onClick={(e) => e.stopPropagation()}>
                        <button type="button" onClick={() => openEdit(c)} className="p-1.5 rounded-lg hover:bg-slate-200 text-slate-600" aria-label="Edit"><Pencil className="w-4 h-4" /></button>
                        <button type="button" onClick={() => remove(c)} className="p-1.5 rounded-lg hover:bg-red-100 text-red-600 ms-1" aria-label="Delete"><Trash2 className="w-4 h-4" /></button>
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        wide
        title={editingId ? (ar ? 'تعديل الحملة' : 'Edit campaign') : (ar ? 'حملة جديدة' : 'New campaign')}
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
          {numField('clicks', ar ? 'النقرات' : 'Clicks')}
          {numField('leads', ar ? 'العملاء المحتملون' : 'Leads')}
          {numField('conversions', ar ? 'التحويلات' : 'Conversions')}
          {numField('reach', ar ? 'الوصول' : 'Reach')}
          {numField('engagements', ar ? 'التفاعلات' : 'Engagements')}
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
