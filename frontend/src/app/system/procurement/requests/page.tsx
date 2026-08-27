'use client';
import { useState, useEffect, useCallback } from 'react';
import { useDialog } from '@/components/system/DialogProvider';
import { useAuth } from '@/context/AuthContext';
import { useLanguage } from '@/context/LanguageContext';
import { useSocket } from '@/hooks/useSocket';
import api from '@/lib/api';
import { ClipboardList, Plus, Trash2, Edit, Send, Check, X, ShoppingCart } from 'lucide-react';
import {
  isProcStaff, isProcManager, PurchaseRequest, ProcOptions, PR_STATUS_STYLE, PRIORITY_STYLE,
  optLabel, vendorName, userName, money, fmtDate,
} from '@/lib/procurement';
import { Spinner, PageHeader, SearchInput, PrimaryButton, Badge, Modal, Field, TextInput, TextArea, Select } from '@/components/hr/HRKit';
import ExportMenu, { exportScopeLabels, type ExportColumn } from '@/components/ls2/ExportMenu';
import ManagedSelect from '@/components/system/ManagedSelect';
import VendorSelect from '@/components/system/VendorSelect';
import { getProcurementRequestsTranslations } from '@/lib/translations';

const emptyItem = () => ({ description: '', quantity: 1, unitPrice: 0 });
const EMPTY = { title: '', category: '', department: '', priority: 'medium', justification: '', neededBy: '', notes: '', items: [emptyItem()] };

export default function PurchaseRequestsPage() {
  const { confirm, notify } = useDialog();
  const { user } = useAuth();
  const { lang, isRTL } = useLanguage();
  const ar = lang === 'ar';
  const tx = getProcurementRequestsTranslations(lang);
  const [items, setItems] = useState<PurchaseRequest[]>([]);
  const [opts, setOpts] = useState<ProcOptions | null>(null);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [statusF, setStatusF] = useState('');
  const [showModal, setShowModal] = useState(false);
  const [editing, setEditing] = useState<PurchaseRequest | null>(null);
  const [form, setForm] = useState<any>(EMPTY);
  const [saving, setSaving] = useState(false);
  const [convertFor, setConvertFor] = useState<PurchaseRequest | null>(null);
  const [convVendor, setConvVendor] = useState('');

  const canApprove = isProcManager(user);

  const load = useCallback(async () => {
    try {
      const qs = new URLSearchParams(); if (search.trim()) qs.set('q', search.trim()); if (statusF) qs.set('status', statusF);
      const d = await api.get<{ requests: PurchaseRequest[] }>(`/api/procurement/requests?${qs}`);
      setItems(d.requests || []);
    } catch { /* */ }
    setLoading(false);
  }, [search, statusF]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => { api.get<ProcOptions>('/api/procurement/options').then(setOpts).catch(() => {}); }, []);
  useSocket('procurement:pr', useCallback(() => load(), [load]));

  const subtotal = form.items.reduce((s: number, l: any) => s + (Number(l.quantity) || 0) * (Number(l.unitPrice) || 0), 0);
  const setItem = (i: number, patch: any) => setForm((f: any) => ({ ...f, items: f.items.map((l: any, idx: number) => idx === i ? { ...l, ...patch } : l) }));
  const addItem = () => setForm((f: any) => ({ ...f, items: [...f.items, emptyItem()] }));
  const rmItem = (i: number) => setForm((f: any) => ({ ...f, items: f.items.filter((_: any, idx: number) => idx !== i) }));

  const openCreate = () => { setEditing(null); setForm({ ...EMPTY, items: [emptyItem()] }); setShowModal(true); };
  const openEdit = (pr: PurchaseRequest) => {
    setEditing(pr);
    setForm({ ...EMPTY, ...pr, neededBy: pr.neededBy ? new Date(pr.neededBy).toISOString().slice(0, 10) : '', items: pr.items.length ? pr.items : [emptyItem()] });
    setShowModal(true);
  };
  const save = async (submit = false) => {
    if (!form.title.trim()) { notify(tx.titleRequired); return; }
    setSaving(true);
    try {
      const payload = { ...form, neededBy: form.neededBy || undefined, status: submit ? 'pending_approval' : undefined,
        items: form.items.filter((l: any) => l.description?.trim()) };
      if (editing) await api.put(`/api/procurement/requests/${editing._id}`, payload);
      else await api.post('/api/procurement/requests', payload);
      setShowModal(false); load();
    } catch (e: any) { notify(e.message, 'error'); } finally { setSaving(false); }
  };
  const submitPR = async (pr: PurchaseRequest) => { try { await api.post(`/api/procurement/requests/${pr._id}/submit`); load(); } catch (e: any) { notify(e.message, 'error'); } };
  const decide = async (pr: PurchaseRequest, decision: string) => {
    if (decision === 'rejected' && !(await confirm(tx.confirmReject))) return;
    try { await api.patch(`/api/procurement/requests/${pr._id}/decision`, { decision }); load(); } catch (e: any) { notify(e.message, 'error'); }
  };
  const remove = async (pr: PurchaseRequest) => { if (!(await confirm(tx.confirmDelete))) return; try { await api.delete(`/api/procurement/requests/${pr._id}`); load(); } catch (e: any) { notify(e.message, 'error'); } };
  const convert = async () => {
    if (!convVendor) { notify(tx.pickVendor); return; }
    try { await api.post(`/api/procurement/requests/${convertFor!._id}/convert`, { vendor: convVendor, vatRate: opts?.KSA_VAT_RATE ?? 15 }); setConvertFor(null); setConvVendor(''); load(); }
    catch (e: any) { notify(e.message, 'error'); }
  };

  const statusLabel = (key: string) => { const s = (opts?.PR_STATUSES || []).find((x) => x.key === key); return s ? (ar ? s.nameAr : s.nameEn) : key; };
  const priorityLabel = (key: string) => { const p = (opts?.PRIORITIES || []).find((x) => x.key === key); return p ? (ar ? p.nameAr : p.nameEn) : key; };
  const exportColumns: ExportColumn[] = [
    { header: '#', key: 'requestNumber', width: 16 },
    { header: ar ? 'العنوان' : 'Title', key: 'title', width: 28 },
    { header: ar ? 'القسم' : 'Department', key: 'department', width: 18 },
    { header: tx.colRequester, key: 'requester', width: 20, transform: (_v, r) => userName(r.requester) },
    { header: tx.colEstimate, key: 'totalEstimate', width: 16, transform: (v) => money(v) },
    { header: tx.colPriority, key: 'priority', width: 14, transform: (v) => priorityLabel(v) },
    { header: tx.colStatus, key: 'status', width: 18, transform: (v) => statusLabel(v) },
  ];
  // البحثُ والحالة يُنفَّذان على الخادم، فالقائمة الحاضرة نتيجةُ فلترٍ لا السجلّ كلّه؛
  // ولذلك «الكلّ» يعيد النداء بلا معاملات بدل أن يسمّي المفلتَر كلًّا.
  const REQUESTS_SHEET = ar ? 'طلبات الشراء' : 'Purchase Requests';
  const hasActiveFilters = !!(search.trim() || statusF);
  const fetchAllForExport = async () => {
    const d = await api.get<{ requests: PurchaseRequest[] }>('/api/procurement/requests');
    return [{ name: REQUESTS_SHEET, rows: (d.requests || []) as unknown as Record<string, any>[], columns: exportColumns }];
  };
  const scope = exportScopeLabels(ar);
  const exportOptions = [
    { key: 'shown', label: hasActiveFilters ? scope.shown : scope.all, sheets: [{ name: REQUESTS_SHEET, rows: items as unknown as Record<string, any>[], columns: exportColumns }] },
    ...(hasActiveFilters ? [{ key: 'all', label: scope.all, resolve: fetchAllForExport }] : []),
  ];

  if (!isProcStaff(user)) return <div className="text-slate-500 p-8">{tx.notAuthorized}</div>;
  if (loading) return <Spinner />;

  return (
    <div className="space-y-6" dir={isRTL ? 'rtl' : 'ltr'}>
      <PageHeader icon={<ClipboardList className="w-5 h-5" />} title={tx.pageTitle} subtitle={`${items.length}`}>
        <ExportMenu fileName="purchase-requests" lang={ar ? 'ar' : 'en'} variant="subtle" label={ar ? 'تصدير Excel' : 'Export Excel'} options={exportOptions} />
        <PrimaryButton onClick={openCreate}><Plus className="w-4 h-4" /> {tx.newRequest}</PrimaryButton>
      </PageHeader>

      <div className="flex flex-col sm:flex-row gap-3">
        <div className="flex-1 min-w-[240px]"><SearchInput value={search} onChange={setSearch} placeholder={tx.searchPlaceholder} /></div>
        <select value={statusF} onChange={(e) => setStatusF(e.target.value)} className="w-full sm:w-44 shrink-0 px-3 py-2.5 rounded-lg bg-white border border-slate-200 text-slate-900 text-sm">
          <option value="">{tx.allStatuses}</option>
          {(opts?.PR_STATUSES || []).map((s) => <option key={s.key} value={s.key}>{ar ? s.nameAr : s.nameEn}</option>)}
        </select>
      </div>

      <div className="bg-white border border-slate-200 rounded-xl overflow-x-auto shadow-sm">
        <table className="w-full text-sm">
          <thead><tr className="bg-slate-900 border-b border-slate-200 text-start text-slate-300">
            <th className="px-4 py-3">#</th><th className="px-4 py-3">{tx.colTitle}</th>
            <th className="px-4 py-3">{tx.colRequester}</th><th className="px-4 py-3 text-end">{tx.colEstimate}</th>
            <th className="px-4 py-3">{tx.colPriority}</th><th className="px-4 py-3">{tx.colStatus}</th>
            <th className="px-4 py-3 text-end">{tx.colActions}</th>
          </tr></thead>
          <tbody className="divide-y divide-slate-200">
            {items.length === 0 ? <tr><td colSpan={7} className="px-4 py-10 text-center text-slate-800">—</td></tr> : items.map((pr) => (
              <tr key={pr._id} className="hover:bg-slate-100">
                <td className="px-4 py-3 text-slate-800 font-mono text-xs">{pr.requestNumber}</td>
                <td className="px-4 py-3 text-slate-900">{pr.title}<div className="text-slate-700 text-xs">{pr.department || ''}</div></td>
                <td className="px-4 py-3 text-slate-700">{userName(pr.requester)}</td>
                <td className="px-4 py-3 text-end text-slate-800">{money(pr.totalEstimate)}</td>
                <td className="px-4 py-3"><Badge style={PRIORITY_STYLE[pr.priority]} lang={lang} /></td>
                <td className="px-4 py-3"><Badge style={PR_STATUS_STYLE[pr.status]} lang={lang} /></td>
                <td className="px-4 py-3"><div className="flex items-center justify-end gap-2">
                  {pr.status === 'draft' && <button type="button" title={tx.actionSubmit} onClick={() => submitPR(pr)} className="text-amber-700 hover:text-amber-700"><Send className="w-4 h-4" /></button>}
                  {pr.status === 'pending_approval' && canApprove && <>
                    <button type="button" title={tx.actionApprove} onClick={() => decide(pr, 'approved')} className="text-green-600 hover:text-green-700"><Check className="w-4 h-4" /></button>
                    <button type="button" title={tx.actionReject} onClick={() => decide(pr, 'rejected')} className="text-red-600 hover:text-red-700"><X className="w-4 h-4" /></button>
                  </>}
                  {pr.status === 'approved' && <button type="button" title={tx.actionConvert} onClick={() => { setConvertFor(pr); setConvVendor(''); }} className="text-blue-600 hover:text-blue-700"><ShoppingCart className="w-4 h-4" /></button>}
                  {['draft', 'pending_approval'].includes(pr.status) && <button type="button" title={tx.actionEdit} onClick={() => openEdit(pr)} className="text-blue-600 hover:text-blue-700"><Edit className="w-4 h-4" /></button>}
                  {canApprove && <button type="button" title={tx.actionDelete} onClick={() => remove(pr)} className="text-red-600 hover:text-red-700"><Trash2 className="w-4 h-4" /></button>}
                </div></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Create / edit */}
      <Modal open={showModal} onClose={() => setShowModal(false)} wide title={editing ? tx.editRequest : tx.newPurchaseRequest}
        footer={<><button type="button" onClick={() => setShowModal(false)} className="px-4 py-2 bg-slate-100 text-slate-700 rounded-lg text-sm">{tx.cancel}</button>
          <button type="button" onClick={() => save(false)} disabled={saving} className="px-4 py-2 bg-slate-200 text-slate-900 rounded-lg text-sm disabled:opacity-50">{tx.saveDraft}</button>
          <PrimaryButton onClick={() => save(true)} disabled={saving}>{saving ? '...' : tx.actionSubmit}</PrimaryButton></>}>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Field label={tx.fieldTitle} span2><TextInput value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} /></Field>
          <Field label={tx.fieldCategory}><ManagedSelect type="procurement_category" value={form.category} onChange={(v) => setForm({ ...form, category: v })} placeholder={tx.fieldCategory} /></Field>
          <Field label={tx.fieldDepartment}><TextInput value={form.department} onChange={(e) => setForm({ ...form, department: e.target.value })} /></Field>
          <Field label={tx.fieldPriority}><Select value={form.priority} onChange={(e) => setForm({ ...form, priority: e.target.value })}>
            {(opts?.PRIORITIES || []).map((c) => <option key={c.key} value={c.key}>{ar ? c.nameAr : c.nameEn}</option>)}
          </Select></Field>
          <Field label={tx.fieldNeededBy}><TextInput type="date" value={form.neededBy} onChange={(e) => setForm({ ...form, neededBy: e.target.value })} /></Field>
        </div>
        {/* line items */}
        <div className="mt-2 space-y-2">
          <p className="text-slate-500 text-xs">{tx.items}</p>
          {form.items.map((l: any, i: number) => (
            <div key={i} className="flex items-center gap-2">
              <input placeholder={tx.itemDescription} value={l.description} onChange={(e) => setItem(i, { description: e.target.value })} className="flex-1 px-2 py-2 rounded-lg bg-white border border-slate-200 text-slate-900 text-sm" />
              <input type="number" placeholder={tx.itemQty} value={l.quantity} onChange={(e) => setItem(i, { quantity: e.target.value })} className="w-20 px-2 py-2 rounded-lg bg-white border border-slate-200 text-slate-900 text-sm" dir="ltr" />
              <input type="number" placeholder={tx.itemPrice} value={l.unitPrice} onChange={(e) => setItem(i, { unitPrice: e.target.value })} className="w-24 px-2 py-2 rounded-lg bg-white border border-slate-200 text-slate-900 text-sm" dir="ltr" />
              <span className="w-24 text-end text-slate-500 text-sm">{money((Number(l.quantity) || 0) * (Number(l.unitPrice) || 0), '')}</span>
              <button type="button" title={tx.remove} onClick={() => rmItem(i)} className="text-red-600 hover:text-red-700"><X className="w-4 h-4" /></button>
            </div>
          ))}
          <div className="flex items-center justify-between">
            <button type="button" onClick={addItem} className="text-[#f37121] text-sm flex items-center gap-1"><Plus className="w-4 h-4" /> {tx.addItem}</button>
            <span className="text-slate-900 text-sm">{tx.total}: {money(subtotal)}</span>
          </div>
        </div>
        <Field label={tx.fieldJustification}><TextArea rows={2} value={form.justification} onChange={(e) => setForm({ ...form, justification: e.target.value })} /></Field>
      </Modal>

      {/* Convert to PO */}
      <Modal open={!!convertFor} onClose={() => setConvertFor(null)} title={tx.convertTitle}
        footer={<><button type="button" onClick={() => setConvertFor(null)} className="px-4 py-2 bg-slate-100 text-slate-700 rounded-lg text-sm">{tx.cancel}</button>
          <PrimaryButton onClick={convert}>{tx.createPO}</PrimaryButton></>}>
        <Field label={tx.fieldVendor}><VendorSelect value={convVendor} onChange={(v) => setConvVendor(v)} placeholder={tx.suggestedVendor} /></Field>
        <p className="text-slate-500 text-xs">{`${tx.vatPrefix}${opts?.KSA_VAT_RATE ?? 15}${tx.vatSuffix}`}</p>
      </Modal>
    </div>
  );
}
