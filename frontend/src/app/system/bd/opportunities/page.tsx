'use client';
// Business Development opportunities — market entries, new service lines,
// partnerships and expansion plays. Rows open the full initiative page.
import { useState, useEffect, useCallback, useMemo } from 'react';
import { useDialog } from '@/components/system/DialogProvider';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/context/AuthContext';
import { useLanguage } from '@/context/LanguageContext';
import { useSocket } from '@/hooks/useSocket';
import api from '@/lib/api';
import { Compass, Plus, Edit, Trash2 } from 'lucide-react';
import {
  Spinner, PageHeader, SearchInput, PrimaryButton, SmallBadge,
  Modal, Field, TextInput, TextArea, Select,
} from '@/components/hr/HRKit';
import ExportMenu, { exportScopeLabels, type ExportColumn } from '@/components/ls2/ExportMenu';
import {
  canViewBd, canEditBd, BdOpportunity, OPP_STAGE, OPP_TYPE, PRIORITY, ALL_STAGES,
  labelOf, optionsOf, bdName, userName, companyName, money, fmtDate, toDateInput,
  listToText, textToList,
} from '@/lib/bd';

const EMPTY = {
  name: '', nameAr: '', type: 'new_market', stage: 'identified', priority: 'medium',
  estimatedValue: 0, currency: 'SAR', probability: 0, expectedCloseDate: '',
  ownerName: '', crmCompany: '', partnerName: '', region: '', city: '',
  description: '', nextStep: '', nextStepDate: '', source: '',
  competitors: '', risks: '', notes: '', lostReason: '',
};

export default function BdOpportunitiesPage() {
  const { confirm, notify } = useDialog();
  const { user } = useAuth();
  const { lang, isRTL } = useLanguage();
  const ar = lang === 'ar';
  const router = useRouter();
  const canEdit = canEditBd(user);

  const [rows, setRows] = useState<BdOpportunity[]>([]);
  const [companies, setCompanies] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [stage, setStage] = useState('');

  const [showModal, setShowModal] = useState(false);
  const [editing, setEditing] = useState<BdOpportunity | null>(null);
  const [form, setForm] = useState<any>(EMPTY);
  const [saving, setSaving] = useState(false);

  // The dashboard links here with ?stage=… — read it once on mount (rather than
  // useSearchParams, which would force a Suspense boundary at build time).
  useEffect(() => {
    const s = new URLSearchParams(window.location.search).get('stage');
    if (s) setStage(s);
  }, []);

  const load = useCallback(async () => {
    try {
      const qs = new URLSearchParams();
      if (search.trim()) qs.set('q', search.trim());
      if (stage) qs.set('stage', stage);
      const d = await api.get<{ opportunities: BdOpportunity[] }>(`/api/business-development/opportunities?${qs}`);
      setRows(d.opportunities || []);
    } catch { /* keep the last good render */ }
    setLoading(false);
  }, [search, stage]);

  // Debounced: one request after typing pauses, not one per keystroke.
  useEffect(() => {
    const h = setTimeout(() => { load(); }, 250);
    return () => clearTimeout(h);
  }, [load]);
  useSocket('bd:updated', useCallback(() => { load(); }, [load]));

  // Optional CRM link — silently skipped when this role has no CRM access.
  useEffect(() => {
    api.get<{ companies: any[] }>('/api/crm/companies')
      .then((d) => setCompanies(d.companies || []))
      .catch(() => setCompanies([]));
  }, []);

  const stageCounts = useMemo(() => {
    const m: Record<string, number> = {};
    rows.forEach((r) => { m[r.stage] = (m[r.stage] || 0) + 1; });
    return m;
  }, [rows]);

  const openCreate = () => { setEditing(null); setForm({ ...EMPTY, ownerName: `${user?.firstName || ''} ${user?.lastName || ''}`.trim() }); setShowModal(true); };
  const openEdit = (r: BdOpportunity) => {
    setEditing(r);
    setForm({
      ...EMPTY, ...r,
      expectedCloseDate: toDateInput(r.expectedCloseDate),
      nextStepDate: toDateInput(r.nextStepDate),
      crmCompany: typeof r.crmCompany === 'object' ? r.crmCompany?._id || '' : (r.crmCompany || ''),
      competitors: listToText(r.competitors),
      ownerName: r.ownerName || userName(r.owner).replace('—', ''),
    });
    setShowModal(true);
  };

  const save = async () => {
    if (!String(form.name || '').trim()) { notify(ar ? 'الاسم مطلوب' : 'Name is required'); return; }
    setSaving(true);
    try {
      const payload = {
        ...form,
        estimatedValue: Number(form.estimatedValue) || 0,
        probability: Number(form.probability) || 0,
        competitors: textToList(form.competitors),
        crmCompany: form.crmCompany || undefined,
      };
      if (editing) await api.put(`/api/business-development/opportunities/${editing._id}`, payload);
      else await api.post('/api/business-development/opportunities', payload);
      setShowModal(false);
      load();
    } catch (e: any) { notify(e.message, 'error'); }
    finally { setSaving(false); }
  };

  const remove = async (r: BdOpportunity) => {
    if (!(await confirm(ar ? 'تأكيد الحذف؟' : 'Delete this opportunity?'))) return;
    try { await api.delete(`/api/business-development/opportunities/${r._id}`); load(); }
    catch (e: any) { notify(e.message, 'error'); }
  };

  const exportColumns: ExportColumn[] = [
    { header: ar ? 'الاسم' : 'Name', key: 'name', transform: (_v, r) => bdName(r, lang) },
    { header: ar ? 'النوع' : 'Type', key: 'type', transform: (v) => labelOf(OPP_TYPE, v, lang) },
    { header: ar ? 'المرحلة' : 'Stage', key: 'stage', transform: (v) => labelOf(OPP_STAGE, v, lang) },
    { header: ar ? 'الأولوية' : 'Priority', key: 'priority', transform: (v) => labelOf(PRIORITY, v, lang) },
    { header: ar ? 'القيمة' : 'Value', key: 'estimatedValue' },
    { header: ar ? 'العملة' : 'Currency', key: 'currency' },
    { header: ar ? 'الاحتمالية %' : 'Probability %', key: 'probability' },
    { header: ar ? 'تاريخ الإغلاق المتوقع' : 'Expected close', key: 'expectedCloseDate' },
    { header: ar ? 'المسؤول' : 'Owner', key: 'ownerName', transform: (v, r) => v || userName(r.owner) },
    { header: ar ? 'المنطقة' : 'Region', key: 'region' },
    { header: ar ? 'الخطوة التالية' : 'Next step', key: 'nextStep' },
  ];
  // الفلترة هنا تجري على الخادم، فما في الذاكرة هو نتيجة البحث والمرحلة معًا؛
  // ومَن يريد السجلّ كاملًا لا يملك وسيلةً لرؤيته إلّا بمسح فلاتره أوّلًا،
  // فنُعيد النداء بلا معاملاتٍ نيابةً عنه بدل أن يظنّ المفلتَر هو الكلّ.
  const fetchAllForExport = async () => {
    const d = await api.get<{ opportunities: BdOpportunity[] }>('/api/business-development/opportunities');
    return [{ name: 'Opportunities', rows: d.opportunities || [], columns: exportColumns }];
  };
  const hasActiveFilters = !!(search.trim() || stage);
  const scope = exportScopeLabels(ar);
  const exportOptions = [
    { key: 'shown', label: hasActiveFilters ? scope.shown : scope.all, sheets: [{ name: 'Opportunities', rows, columns: exportColumns }] },
    ...(hasActiveFilters ? [{ key: 'all', label: scope.all, resolve: fetchAllForExport }] : []),
  ];

  if (!canViewBd(user)) return <div className="text-slate-500 p-8">{ar ? 'لا تملك صلاحية' : 'Not authorized'}</div>;
  if (loading) return <Spinner />;

  const totalValue = rows.filter((r) => r.status === 'open').reduce((s, r) => s + (r.estimatedValue || 0), 0);

  return (
    <div className="space-y-6" dir={isRTL ? 'rtl' : 'ltr'}>
      <PageHeader
        icon={<Compass className="w-5 h-5" />}
        title={ar ? 'الفرص الاستراتيجية' : 'Opportunities'}
        subtitle={`${rows.length} · ${money(totalValue)}`}
      >
        <div className="w-56"><SearchInput value={search} onChange={setSearch} placeholder={ar ? 'بحث…' : 'Search…'} /></div>
        <ExportMenu fileName="bd-opportunities" lang={ar ? 'ar' : 'en'} variant="subtle" label={ar ? 'تصدير' : 'Export'} options={exportOptions} />
        {canEdit && <PrimaryButton onClick={openCreate}><Plus className="w-4 h-4" /> {ar ? 'فرصة جديدة' : 'New opportunity'}</PrimaryButton>}
      </PageHeader>

      {/* Stage filter pills */}
      <div className="flex flex-wrap gap-2">
        <button type="button" onClick={() => setStage('')}
          className={`px-3 py-1.5 rounded-full text-xs font-medium border transition-colors ${stage === '' ? 'bg-[#f37121] text-white border-[#f37121]' : 'bg-white text-slate-600 border-slate-200 hover:border-[#f37121]/50'}`}>
          {ar ? 'الكل' : 'All'} ({rows.length})
        </button>
        {ALL_STAGES.map((s) => (
          <button key={s} type="button" onClick={() => setStage(stage === s ? '' : s)}
            className={`px-3 py-1.5 rounded-full text-xs font-medium border transition-colors ${stage === s ? 'bg-[#f37121] text-white border-[#f37121]' : 'bg-white text-slate-600 border-slate-200 hover:border-[#f37121]/50'}`}>
            {labelOf(OPP_STAGE, s, lang)}{stage === '' ? ` (${stageCounts[s] || 0})` : ''}
          </button>
        ))}
      </div>

      {/* Table */}
      <div className="rounded-xl border border-slate-200 bg-white shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-900 text-slate-300">
              <tr>
                <th className="px-4 py-3 text-start font-medium">{ar ? 'الفرصة' : 'Opportunity'}</th>
                <th className="px-4 py-3 text-start font-medium">{ar ? 'النوع' : 'Type'}</th>
                <th className="px-4 py-3 text-start font-medium">{ar ? 'المرحلة' : 'Stage'}</th>
                <th className="px-4 py-3 text-start font-medium">{ar ? 'الأولوية' : 'Priority'}</th>
                <th className="px-4 py-3 text-start font-medium">{ar ? 'القيمة' : 'Value'}</th>
                <th className="px-4 py-3 text-start font-medium">{ar ? 'الاحتمالية' : 'Prob.'}</th>
                <th className="px-4 py-3 text-start font-medium">{ar ? 'الإغلاق المتوقع' : 'Expected close'}</th>
                <th className="px-4 py-3 text-start font-medium">{ar ? 'المسؤول' : 'Owner'}</th>
                {canEdit && <th className="px-4 py-3 text-end font-medium">{ar ? 'إجراءات' : 'Actions'}</th>}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {rows.map((r) => {
                const st = OPP_STAGE[r.stage];
                const ty = OPP_TYPE[r.type];
                const pr = PRIORITY[r.priority];
                return (
                  <tr key={r._id} onClick={() => router.push(`/system/bd/opportunities/${r._id}`)}
                    className="hover:bg-slate-50 cursor-pointer">
                    <td className="px-4 py-3">
                      <p className="text-slate-900 font-medium">{bdName(r, lang)}</p>
                      <p className="text-slate-500 text-xs">
                        {[r.region, r.city].filter(Boolean).join(' · ') || companyName(r.crmCompany, lang)}
                      </p>
                    </td>
                    <td className="px-4 py-3">{ty && <SmallBadge bg={ty.bg} text={ty.text} label={ar ? ty.ar : ty.en} />}</td>
                    <td className="px-4 py-3">{st && <SmallBadge bg={st.bg} text={st.text} label={ar ? st.ar : st.en} />}</td>
                    <td className="px-4 py-3">{pr && <SmallBadge bg={pr.bg} text={pr.text} label={ar ? pr.ar : pr.en} />}</td>
                    <td className="px-4 py-3 text-slate-900 font-medium">{money(r.estimatedValue, r.currency)}</td>
                    <td className="px-4 py-3 text-slate-600">{r.probability || 0}%</td>
                    <td className="px-4 py-3 text-slate-600">{fmtDate(r.expectedCloseDate)}</td>
                    <td className="px-4 py-3 text-slate-600">{r.ownerName || userName(r.owner)}</td>
                    {canEdit && (
                      <td className="px-4 py-3" onClick={(e) => e.stopPropagation()}>
                        <div className="flex items-center justify-end gap-2">
                          <button type="button" title={ar ? 'تعديل' : 'Edit'} onClick={() => openEdit(r)}
                            className="text-blue-600 hover:text-blue-700"><Edit className="w-4 h-4" /></button>
                          <button type="button" title={ar ? 'حذف' : 'Delete'} onClick={() => remove(r)}
                            className="text-red-600 hover:text-red-700"><Trash2 className="w-4 h-4" /></button>
                        </div>
                      </td>
                    )}
                  </tr>
                );
              })}
              {rows.length === 0 && (
                <tr><td colSpan={canEdit ? 9 : 8} className="px-4 py-12 text-center text-slate-400">
                  {ar ? 'لا توجد فرص' : 'No opportunities'}
                </td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <Modal open={showModal} onClose={() => setShowModal(false)} wide
        title={editing ? (ar ? 'تعديل الفرصة' : 'Edit opportunity') : (ar ? 'فرصة جديدة' : 'New opportunity')}
        footer={<>
          <button type="button" onClick={() => setShowModal(false)} className="px-4 py-2 bg-slate-100 text-slate-700 rounded-lg text-sm">
            {ar ? 'إلغاء' : 'Cancel'}
          </button>
          <PrimaryButton onClick={save} disabled={saving}>{saving ? (ar ? 'جارٍ الحفظ…' : 'Saving…') : (ar ? 'حفظ' : 'Save')}</PrimaryButton>
        </>}>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Field label={ar ? 'الاسم (إنجليزي)' : 'Name (English)'}>
            <TextInput value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          </Field>
          <Field label={ar ? 'الاسم (عربي)' : 'Name (Arabic)'}>
            <TextInput value={form.nameAr} onChange={(e) => setForm({ ...form, nameAr: e.target.value })} />
          </Field>
          <Field label={ar ? 'النوع' : 'Type'}>
            <Select value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })}>
              {optionsOf(OPP_TYPE, lang).map((o) => <option key={o.key} value={o.key}>{o.label}</option>)}
            </Select>
          </Field>
          <Field label={ar ? 'المرحلة' : 'Stage'}>
            <Select value={form.stage} onChange={(e) => setForm({ ...form, stage: e.target.value })}>
              {optionsOf(OPP_STAGE, lang).map((o) => <option key={o.key} value={o.key}>{o.label}</option>)}
            </Select>
          </Field>
          <Field label={ar ? 'الأولوية' : 'Priority'}>
            <Select value={form.priority} onChange={(e) => setForm({ ...form, priority: e.target.value })}>
              {optionsOf(PRIORITY, lang).map((o) => <option key={o.key} value={o.key}>{o.label}</option>)}
            </Select>
          </Field>
          <Field label={ar ? 'المسؤول' : 'Owner'}>
            <TextInput value={form.ownerName} onChange={(e) => setForm({ ...form, ownerName: e.target.value })} />
          </Field>
          <Field label={ar ? 'القيمة التقديرية' : 'Estimated value'}>
            <TextInput type="number" dir="ltr" value={form.estimatedValue} onChange={(e) => setForm({ ...form, estimatedValue: e.target.value })} />
          </Field>
          <Field label={ar ? 'العملة' : 'Currency'}>
            <TextInput value={form.currency} onChange={(e) => setForm({ ...form, currency: e.target.value })} />
          </Field>
          <Field label={ar ? 'الاحتمالية %' : 'Probability %'}>
            <TextInput type="number" dir="ltr" value={form.probability} onChange={(e) => setForm({ ...form, probability: e.target.value })} />
          </Field>
          <Field label={ar ? 'تاريخ الإغلاق المتوقع' : 'Expected close date'}>
            <TextInput type="date" value={form.expectedCloseDate} onChange={(e) => setForm({ ...form, expectedCloseDate: e.target.value })} />
          </Field>
          {companies.length > 0 && (
            <Field label={ar ? 'شركة CRM مرتبطة' : 'Linked CRM company'}>
              <Select value={form.crmCompany} onChange={(e) => setForm({ ...form, crmCompany: e.target.value })}>
                <option value="">{ar ? 'بدون' : 'None'}</option>
                {companies.map((c) => <option key={c._id} value={c._id}>{companyName(c, lang)}</option>)}
              </Select>
            </Field>
          )}
          <Field label={ar ? 'اسم الشريك' : 'Partner name'}>
            <TextInput value={form.partnerName} onChange={(e) => setForm({ ...form, partnerName: e.target.value })} />
          </Field>
          <Field label={ar ? 'المنطقة' : 'Region'}>
            <TextInput value={form.region} onChange={(e) => setForm({ ...form, region: e.target.value })} />
          </Field>
          <Field label={ar ? 'المدينة' : 'City'}>
            <TextInput value={form.city} onChange={(e) => setForm({ ...form, city: e.target.value })} />
          </Field>
          <Field label={ar ? 'المصدر' : 'Source'}>
            <TextInput value={form.source} onChange={(e) => setForm({ ...form, source: e.target.value })} />
          </Field>
          <Field label={ar ? 'تاريخ الخطوة التالية' : 'Next step date'}>
            <TextInput type="date" value={form.nextStepDate} onChange={(e) => setForm({ ...form, nextStepDate: e.target.value })} />
          </Field>
          <Field label={ar ? 'الخطوة التالية' : 'Next step'} span2>
            <TextInput value={form.nextStep} onChange={(e) => setForm({ ...form, nextStep: e.target.value })} />
          </Field>
          <Field label={ar ? 'الوصف' : 'Description'} span2>
            <TextArea rows={2} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
          </Field>
          <Field label={ar ? 'المنافسون (مفصولون بفواصل)' : 'Competitors (comma separated)'} span2>
            <TextInput value={form.competitors} onChange={(e) => setForm({ ...form, competitors: e.target.value })} />
          </Field>
          <Field label={ar ? 'المخاطر' : 'Risks'} span2>
            <TextArea rows={2} value={form.risks} onChange={(e) => setForm({ ...form, risks: e.target.value })} />
          </Field>
          <Field label={ar ? 'ملاحظات' : 'Notes'} span2>
            <TextArea rows={2} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
          </Field>
          {form.stage === 'lost' && (
            <Field label={ar ? 'سبب الخسارة' : 'Lost reason'} span2>
              <TextInput value={form.lostReason} onChange={(e) => setForm({ ...form, lostReason: e.target.value })} />
            </Field>
          )}
        </div>
      </Modal>
    </div>
  );
}
