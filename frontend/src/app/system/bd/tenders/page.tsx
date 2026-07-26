'use client';
// Tenders & RFQs. Sorted by submission deadline — the days-remaining column is
// colour-coded so anything closing inside a week is impossible to miss.
import { useState, useEffect, useCallback, useMemo } from 'react';
import { useDialog } from '@/components/system/DialogProvider';
import { useAuth } from '@/context/AuthContext';
import { useLanguage } from '@/context/LanguageContext';
import { useSocket } from '@/hooks/useSocket';
import api from '@/lib/api';
import { Gavel, Plus, Edit, Trash2, Check, X } from 'lucide-react';
import {
  Spinner, PageHeader, SearchInput, ExportButton, PrimaryButton, SmallBadge, StatCard,
  Modal, Field, TextInput, TextArea, Select,
} from '@/components/hr/HRKit';
import {
  canViewBd, canEditBd, BdTender, BdOpportunity, TENDER_STATUS,
  labelOf, optionsOf, bdTitle, bdName, userName, money, fmtDate, toDateInput,
  daysUntil, deadlineBadge, listToText, textToList, exportToExcel,
} from '@/lib/bd';

const EMPTY = {
  title: '', titleAr: '', entity: '', referenceNumber: '', submissionDeadline: '',
  status: 'watching', estimatedValue: 0, bidBondAmount: 0,
  scope: '', requirements: '', documentsReady: false,
  submittedAt: '', result: '', opportunity: '', notes: '', ownerName: '',
};

export default function BdTendersPage() {
  const { confirm, notify } = useDialog();
  const { user } = useAuth();
  const { lang, isRTL } = useLanguage();
  const ar = lang === 'ar';
  const canEdit = canEditBd(user);

  const [rows, setRows] = useState<BdTender[]>([]);
  const [opps, setOpps] = useState<BdOpportunity[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');

  const [showModal, setShowModal] = useState(false);
  const [editing, setEditing] = useState<BdTender | null>(null);
  const [form, setForm] = useState<any>(EMPTY);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    try {
      const qs = new URLSearchParams();
      if (search.trim()) qs.set('q', search.trim());
      if (status) qs.set('status', status);
      const d = await api.get<{ tenders: BdTender[] }>(`/api/business-development/tenders?${qs}`);
      setRows(d.tenders || []);
    } catch { /* keep the last good render */ }
    setLoading(false);
  }, [search, status]);

  // Debounced: one request after typing pauses, not one per keystroke.
  useEffect(() => {
    const h = setTimeout(() => { load(); }, 250);
    return () => clearTimeout(h);
  }, [load]);
  useSocket('bd:updated', useCallback(() => { load(); }, [load]));

  useEffect(() => {
    api.get<{ opportunities: BdOpportunity[] }>('/api/business-development/opportunities')
      .then((d) => setOpps(d.opportunities || []))
      .catch(() => setOpps([]));
  }, []);

  // Deadline-ascending, with undated tenders parked at the end.
  const sorted = useMemo(() => [...rows].sort((a, b) => {
    const A = a.submissionDeadline || '9999-12-31';
    const B = b.submissionDeadline || '9999-12-31';
    return A < B ? -1 : A > B ? 1 : 0;
  }), [rows]);

  const statusCounts = useMemo(() => {
    const m: Record<string, number> = {};
    rows.forEach((r) => { m[r.status] = (m[r.status] || 0) + 1; });
    return m;
  }, [rows]);

  // Same definition as the BD dashboard's «مناقصات قريبة» KPI (watching/preparing
  // within 30 days) — two different numbers under one name confused everyone.
  const dueSoon = sorted.filter((r) => {
    const d = daysUntil(r.submissionDeadline);
    return d !== null && d >= 0 && d <= 30 && ['watching', 'preparing'].includes(r.status);
  }).length;
  const openValue = rows
    .filter((r) => !['lost', 'cancelled'].includes(r.status))
    .reduce((s, r) => s + (r.estimatedValue || 0), 0);
  const wonCount = rows.filter((r) => r.status === 'won').length;

  const openCreate = () => {
    setEditing(null);
    setForm({ ...EMPTY, ownerName: `${user?.firstName || ''} ${user?.lastName || ''}`.trim() });
    setShowModal(true);
  };
  const openEdit = (r: BdTender) => {
    setEditing(r);
    setForm({
      ...EMPTY, ...r,
      submissionDeadline: toDateInput(r.submissionDeadline),
      submittedAt: toDateInput(r.submittedAt),
      requirements: listToText(r.requirements),
      opportunity: typeof r.opportunity === 'object' ? r.opportunity?._id || '' : (r.opportunity || ''),
      ownerName: r.ownerName || '',
    });
    setShowModal(true);
  };

  const save = async () => {
    if (!String(form.title || '').trim()) { notify(ar ? 'العنوان مطلوب' : 'Title is required'); return; }
    setSaving(true);
    try {
      const payload = {
        ...form,
        estimatedValue: Number(form.estimatedValue) || 0,
        bidBondAmount: Number(form.bidBondAmount) || 0,
        requirements: textToList(form.requirements),
        opportunity: form.opportunity || undefined,
      };
      if (editing) await api.put(`/api/business-development/tenders/${editing._id}`, payload);
      else await api.post('/api/business-development/tenders', payload);
      setShowModal(false);
      load();
    } catch (e: any) { notify(e.message, 'error'); }
    finally { setSaving(false); }
  };

  const remove = async (r: BdTender) => {
    if (!(await confirm(ar ? 'تأكيد الحذف؟' : 'Delete this tender?'))) return;
    try { await api.delete(`/api/business-development/tenders/${r._id}`); load(); }
    catch (e: any) { notify(e.message, 'error'); }
  };

  const doExport = () => {
    exportToExcel(sorted, [
      { header: ar ? 'العنوان' : 'Title', key: 'title', transform: (_v, r) => bdTitle(r, lang) },
      { header: ar ? 'الجهة' : 'Entity', key: 'entity' },
      { header: ar ? 'الرقم المرجعي' : 'Reference', key: 'referenceNumber' },
      { header: ar ? 'موعد التقديم' : 'Deadline', key: 'submissionDeadline' },
      { header: ar ? 'الأيام المتبقية' : 'Days left', key: 'submissionDeadline', transform: (v) => daysUntil(v) ?? '' },
      { header: ar ? 'الحالة' : 'Status', key: 'status', transform: (v) => labelOf(TENDER_STATUS, v, lang) },
      { header: ar ? 'القيمة التقديرية' : 'Estimated value', key: 'estimatedValue' },
      { header: ar ? 'الضمان الابتدائي' : 'Bid bond', key: 'bidBondAmount' },
      { header: ar ? 'المستندات جاهزة' : 'Docs ready', key: 'documentsReady', transform: (v) => (v ? (ar ? 'نعم' : 'Yes') : (ar ? 'لا' : 'No')) },
      { header: ar ? 'المسؤول' : 'Owner', key: 'ownerName', transform: (v, r) => v || userName(r.owner) },
    ], `bd-tenders-${new Date().toISOString().slice(0, 10)}`, 'Tenders');
  };

  if (!canViewBd(user)) return <div className="text-slate-500 p-8">{ar ? 'لا تملك صلاحية' : 'Not authorized'}</div>;
  if (loading) return <Spinner />;

  return (
    <div className="space-y-6" dir={isRTL ? 'rtl' : 'ltr'}>
      <PageHeader
        icon={<Gavel className="w-5 h-5" />}
        title={ar ? 'المناقصات وطلبات العروض' : 'Tenders & RFQs'}
        subtitle={`${rows.length} ${ar ? 'مناقصة' : 'tenders'}`}
      >
        <div className="w-56"><SearchInput value={search} onChange={setSearch} placeholder={ar ? 'بحث…' : 'Search…'} /></div>
        <ExportButton onClick={doExport} label={ar ? 'تصدير' : 'Export'} />
        {canEdit && <PrimaryButton onClick={openCreate}><Plus className="w-4 h-4" /> {ar ? 'مناقصة جديدة' : 'New tender'}</PrimaryButton>}
      </PageHeader>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard label={ar ? 'إجمالي المناقصات' : 'Total tenders'} value={rows.length} />
        <StatCard label={ar ? 'تُغلق خلال 7 أيام' : 'Closing in 7 days'} value={dueSoon} accent={dueSoon > 0 ? 'text-red-600' : 'text-slate-900'} />
        <StatCard label={ar ? 'القيمة القائمة' : 'Value in play'} value={money(openValue)} accent="text-[#f37121]" />
        <StatCard label={ar ? 'تم الفوز بها' : 'Won'} value={wonCount} accent="text-emerald-600" />
      </div>

      {/* Status filter pills */}
      <div className="flex flex-wrap gap-2">
        <button type="button" onClick={() => setStatus('')}
          className={`px-3 py-1.5 rounded-full text-xs font-medium border transition-colors ${status === '' ? 'bg-[#f37121] text-white border-[#f37121]' : 'bg-white text-slate-600 border-slate-200 hover:border-[#f37121]/50'}`}>
          {ar ? 'الكل' : 'All'} ({rows.length})
        </button>
        {Object.keys(TENDER_STATUS).map((s) => (
          <button key={s} type="button" onClick={() => setStatus(status === s ? '' : s)}
            className={`px-3 py-1.5 rounded-full text-xs font-medium border transition-colors ${status === s ? 'bg-[#f37121] text-white border-[#f37121]' : 'bg-white text-slate-600 border-slate-200 hover:border-[#f37121]/50'}`}>
            {labelOf(TENDER_STATUS, s, lang)}{status === '' ? ` (${statusCounts[s] || 0})` : ''}
          </button>
        ))}
      </div>

      <div className="rounded-xl border border-slate-200 bg-white shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-900 text-slate-300">
              <tr>
                <th className="px-4 py-3 text-start font-medium">{ar ? 'المناقصة' : 'Tender'}</th>
                <th className="px-4 py-3 text-start font-medium">{ar ? 'الجهة' : 'Entity'}</th>
                <th className="px-4 py-3 text-start font-medium">{ar ? 'موعد التقديم' : 'Deadline'}</th>
                <th className="px-4 py-3 text-start font-medium">{ar ? 'المتبقي' : 'Days left'}</th>
                <th className="px-4 py-3 text-start font-medium">{ar ? 'الحالة' : 'Status'}</th>
                <th className="px-4 py-3 text-start font-medium">{ar ? 'القيمة' : 'Value'}</th>
                <th className="px-4 py-3 text-start font-medium">{ar ? 'المستندات' : 'Docs'}</th>
                <th className="px-4 py-3 text-start font-medium">{ar ? 'المسؤول' : 'Owner'}</th>
                {canEdit && <th className="px-4 py-3 text-end font-medium">{ar ? 'إجراءات' : 'Actions'}</th>}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {sorted.map((r) => {
                const stl = TENDER_STATUS[r.status];
                const b = deadlineBadge(r.submissionDeadline, lang);
                const d = daysUntil(r.submissionDeadline);
                const urgent = d !== null && d >= 0 && d < 7 && !['won', 'lost', 'cancelled'].includes(r.status);
                return (
                  <tr key={r._id} className={`hover:bg-slate-50 ${urgent ? 'bg-red-50/50' : ''}`}>
                    <td className="px-4 py-3">
                      <p className="text-slate-900 font-medium">{bdTitle(r, lang)}</p>
                      {r.referenceNumber && <p className="text-slate-500 text-xs" dir="ltr">{r.referenceNumber}</p>}
                    </td>
                    <td className="px-4 py-3 text-slate-600">{r.entity || '—'}</td>
                    <td className="px-4 py-3 text-slate-600">{fmtDate(r.submissionDeadline)}</td>
                    <td className="px-4 py-3">{b ? <SmallBadge bg={b.bg} text={b.text} label={b.label} /> : <span className="text-slate-400">—</span>}</td>
                    <td className="px-4 py-3">{stl && <SmallBadge bg={stl.bg} text={stl.text} label={ar ? stl.ar : stl.en} />}</td>
                    <td className="px-4 py-3 text-slate-900 font-medium">{money(r.estimatedValue)}</td>
                    <td className="px-4 py-3">
                      {r.documentsReady
                        ? <Check className="w-4 h-4 text-emerald-600" />
                        : <X className="w-4 h-4 text-slate-300" />}
                    </td>
                    <td className="px-4 py-3 text-slate-600">{r.ownerName || userName(r.owner)}</td>
                    {canEdit && (
                      <td className="px-4 py-3">
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
              {sorted.length === 0 && (
                <tr><td colSpan={canEdit ? 9 : 8} className="px-4 py-12 text-center text-slate-400">
                  {ar ? 'لا توجد مناقصات' : 'No tenders'}
                </td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <Modal open={showModal} onClose={() => setShowModal(false)} wide
        title={editing ? (ar ? 'تعديل المناقصة' : 'Edit tender') : (ar ? 'مناقصة جديدة' : 'New tender')}
        footer={<>
          <button type="button" onClick={() => setShowModal(false)} className="px-4 py-2 bg-slate-100 text-slate-700 rounded-lg text-sm">
            {ar ? 'إلغاء' : 'Cancel'}
          </button>
          <PrimaryButton onClick={save} disabled={saving}>{saving ? (ar ? 'جارٍ الحفظ…' : 'Saving…') : (ar ? 'حفظ' : 'Save')}</PrimaryButton>
        </>}>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Field label={ar ? 'العنوان (إنجليزي)' : 'Title (English)'}>
            <TextInput value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />
          </Field>
          <Field label={ar ? 'العنوان (عربي)' : 'Title (Arabic)'}>
            <TextInput value={form.titleAr} onChange={(e) => setForm({ ...form, titleAr: e.target.value })} />
          </Field>
          <Field label={ar ? 'الجهة المصدرة' : 'Issuing entity'}>
            <TextInput value={form.entity} onChange={(e) => setForm({ ...form, entity: e.target.value })} />
          </Field>
          <Field label={ar ? 'الرقم المرجعي' : 'Reference number'}>
            <TextInput dir="ltr" value={form.referenceNumber} onChange={(e) => setForm({ ...form, referenceNumber: e.target.value })} />
          </Field>
          <Field label={ar ? 'موعد التقديم' : 'Submission deadline'}>
            <TextInput type="date" value={form.submissionDeadline} onChange={(e) => setForm({ ...form, submissionDeadline: e.target.value })} />
          </Field>
          <Field label={ar ? 'الحالة' : 'Status'}>
            <Select value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })}>
              {optionsOf(TENDER_STATUS, lang).map((o) => <option key={o.key} value={o.key}>{o.label}</option>)}
            </Select>
          </Field>
          <Field label={ar ? 'القيمة التقديرية' : 'Estimated value'}>
            <TextInput type="number" dir="ltr" value={form.estimatedValue} onChange={(e) => setForm({ ...form, estimatedValue: e.target.value })} />
          </Field>
          <Field label={ar ? 'الضمان الابتدائي' : 'Bid bond amount'}>
            <TextInput type="number" dir="ltr" value={form.bidBondAmount} onChange={(e) => setForm({ ...form, bidBondAmount: e.target.value })} />
          </Field>
          <Field label={ar ? 'تاريخ التقديم الفعلي' : 'Submitted at'}>
            <TextInput type="date" value={form.submittedAt} onChange={(e) => setForm({ ...form, submittedAt: e.target.value })} />
          </Field>
          <Field label={ar ? 'المسؤول' : 'Owner'}>
            <TextInput value={form.ownerName} onChange={(e) => setForm({ ...form, ownerName: e.target.value })} />
          </Field>
          <Field label={ar ? 'الفرصة المرتبطة' : 'Linked opportunity'} span2>
            <Select value={form.opportunity} onChange={(e) => setForm({ ...form, opportunity: e.target.value })}>
              <option value="">{ar ? 'بدون' : 'None'}</option>
              {opps.map((o) => <option key={o._id} value={o._id}>{bdName(o, lang)}</option>)}
            </Select>
          </Field>
          <Field label={ar ? 'نطاق العمل' : 'Scope'} span2>
            <TextArea rows={2} value={form.scope} onChange={(e) => setForm({ ...form, scope: e.target.value })} />
          </Field>
          <Field label={ar ? 'المتطلبات (مفصولة بفواصل)' : 'Requirements (comma separated)'} span2>
            <TextArea rows={2} value={form.requirements} onChange={(e) => setForm({ ...form, requirements: e.target.value })} />
          </Field>
          <Field label={ar ? 'النتيجة' : 'Result'} span2>
            <TextInput value={form.result} onChange={(e) => setForm({ ...form, result: e.target.value })} />
          </Field>
          <Field label={ar ? 'ملاحظات' : 'Notes'} span2>
            <TextArea rows={2} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
          </Field>
          <Field label={ar ? 'المستندات جاهزة' : 'Documents ready'} span2>
            <label className="flex items-center gap-2 text-sm text-slate-700">
              <input type="checkbox" checked={!!form.documentsReady}
                onChange={(e) => setForm({ ...form, documentsReady: e.target.checked })}
                className="w-4 h-4 accent-[#f37121]" />
              {ar ? 'تم تجهيز كل المستندات المطلوبة' : 'All required documents are prepared'}
            </label>
          </Field>
        </div>
      </Modal>
    </div>
  );
}
