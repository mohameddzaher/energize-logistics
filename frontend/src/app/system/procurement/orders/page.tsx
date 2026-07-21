'use client';
import { useState, useEffect, useCallback } from 'react';
import { useDialog } from '@/components/system/DialogProvider';
import { useAuth } from '@/context/AuthContext';
import { useLanguage } from '@/context/LanguageContext';
import { useSocket } from '@/hooks/useSocket';
import api from '@/lib/api';
import { FileText, Plus, Trash2, PackageCheck, Receipt, X, FileSpreadsheet } from 'lucide-react';
import {
  isProcStaff, isProcManager, PurchaseOrder, ProcOptions, PO_STATUS_STYLE,
  vendorName, money, fmtDate,
} from '@/lib/procurement';
import { Spinner, PageHeader, SearchInput, PrimaryButton, Badge, Modal, Field, TextInput, Select } from '@/components/hr/HRKit';
import VendorSelect from '@/components/system/VendorSelect';
import { getProcurementOrdersTranslations } from '@/lib/translations';
import { exportToExcel } from '@/utils/exportExcel';

const emptyItem = () => ({ description: '', quantity: 1, unitPrice: 0 });

export default function PurchaseOrdersPage() {
  const { confirm, notify } = useDialog();
  const { user } = useAuth();
  const { lang, isRTL } = useLanguage();
  const ar = lang === 'ar';
  const tx = getProcurementOrdersTranslations(lang);
  const [items, setItems] = useState<PurchaseOrder[]>([]);
  const [opts, setOpts] = useState<ProcOptions | null>(null);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [statusF, setStatusF] = useState('');
  const [showModal, setShowModal] = useState(false);
  const [form, setForm] = useState<any>({ vendor: '', vatRate: 15, expectedDate: '', notes: '', items: [emptyItem()] });
  const [saving, setSaving] = useState(false);
  const [billFor, setBillFor] = useState<PurchaseOrder | null>(null);

  const canManage = isProcManager(user?.role);

  const load = useCallback(async () => {
    try {
      const qs = new URLSearchParams(); if (search.trim()) qs.set('q', search.trim()); if (statusF) qs.set('status', statusF);
      const d = await api.get<{ orders: PurchaseOrder[] }>(`/api/procurement/orders?${qs}`);
      setItems(d.orders || []);
    } catch { /* */ }
    setLoading(false);
  }, [search, statusF]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => { api.get<ProcOptions>('/api/procurement/options').then((o) => { setOpts(o); setForm((f: any) => ({ ...f, vatRate: o.KSA_VAT_RATE ?? 15 })); }).catch(() => {}); }, []);
  useSocket('procurement:po', useCallback(() => load(), [load]));

  const subtotal = form.items.reduce((s: number, l: any) => s + (Number(l.quantity) || 0) * (Number(l.unitPrice) || 0), 0);
  const vat = subtotal * (Number(form.vatRate) || 0) / 100;
  const setItem = (i: number, patch: any) => setForm((f: any) => ({ ...f, items: f.items.map((l: any, idx: number) => idx === i ? { ...l, ...patch } : l) }));
  const addItem = () => setForm((f: any) => ({ ...f, items: [...f.items, emptyItem()] }));
  const rmItem = (i: number) => setForm((f: any) => ({ ...f, items: f.items.filter((_: any, idx: number) => idx !== i) }));

  const openCreate = () => { setForm({ vendor: '', vatRate: opts?.KSA_VAT_RATE ?? 15, expectedDate: '', notes: '', items: [emptyItem()] }); setShowModal(true); };
  const save = async () => {
    if (!form.vendor) { notify(tx.pickVendor); return; }
    setSaving(true);
    try {
      await api.post('/api/procurement/orders', { ...form, expectedDate: form.expectedDate || undefined, items: form.items.filter((l: any) => l.description?.trim()) });
      setShowModal(false); load();
    } catch (e: any) { notify(e.message, 'error'); } finally { setSaving(false); }
  };
  const receive = async (po: PurchaseOrder) => { try { await api.post(`/api/procurement/orders/${po._id}/receive`); load(); } catch (e: any) { notify(e.message, 'error'); } };
  const remove = async (po: PurchaseOrder) => { if (!(await confirm(tx.deleteOrderConfirm))) return; try { await api.delete(`/api/procurement/orders/${po._id}`); load(); } catch (e: any) { notify(e.message, 'error'); } };
  const createBill = async () => {
    if (!billFor) return;
    try {
      await api.post('/api/procurement/bills', { vendor: typeof billFor.vendor === 'object' ? billFor.vendor._id : billFor.vendor, purchaseOrder: billFor._id, subtotal: billFor.subtotal, vatAmount: billFor.vatAmount, dueDate: undefined });
      setBillFor(null); load(); notify(tx.billCreatedPosted);
    } catch (e: any) { notify(e.message, 'error'); }
  };

  const statusLabel = (key: string) => {
    const s = (opts?.PO_STATUSES || []).find((x) => x.key === key);
    return s ? (ar ? s.nameAr : s.nameEn) : key;
  };
  const handleExport = () => {
    exportToExcel(items, [
      { header: '#', key: 'poNumber', width: 16 },
      { header: tx.vendor, key: 'vendor', width: 24, transform: (_v, r) => vendorName(r.vendor) },
      { header: tx.total, key: 'total', width: 16, transform: (v, r) => money(v, r.currency) },
      { header: tx.vat, key: 'vatAmount', width: 14, transform: (v) => money(v, '') },
      { header: tx.status, key: 'status', width: 16, transform: (v) => statusLabel(v) },
      { header: tx.expected, key: 'expectedDate', width: 16, transform: (v) => fmtDate(v) },
    ], 'purchase-orders', tx.purchaseOrders);
  };

  if (!isProcStaff(user?.role)) return <div className="text-slate-500 p-8">{tx.notAuthorized}</div>;
  if (loading) return <Spinner />;

  return (
    <div className="space-y-6" dir={isRTL ? 'rtl' : 'ltr'}>
      <PageHeader icon={<FileText className="w-5 h-5" />} title={tx.purchaseOrders} subtitle={`${items.length}`}>
        <button type="button" onClick={handleExport} disabled={items.length === 0} className="inline-flex items-center gap-2 px-4 py-2 bg-slate-100 text-slate-700 rounded-lg text-sm hover:bg-slate-200 disabled:opacity-50"><FileSpreadsheet className="w-4 h-4" /> {ar ? 'تصدير Excel' : 'Export Excel'}</button>
        <PrimaryButton onClick={openCreate}><Plus className="w-4 h-4" /> {tx.newOrder}</PrimaryButton>
      </PageHeader>

      <div className="flex flex-col sm:flex-row gap-3">
        <div className="flex-1 min-w-[240px]"><SearchInput value={search} onChange={setSearch} placeholder={tx.searchPlaceholder} /></div>
        <select value={statusF} onChange={(e) => setStatusF(e.target.value)} className="w-full sm:w-44 shrink-0 px-3 py-2.5 rounded-lg bg-white border border-slate-200 text-slate-900 text-sm">
          <option value="">{tx.allStatuses}</option>
          {(opts?.PO_STATUSES || []).map((s) => <option key={s.key} value={s.key}>{ar ? s.nameAr : s.nameEn}</option>)}
        </select>
      </div>

      <div className="bg-white border border-slate-200 rounded-xl overflow-x-auto shadow-sm">
        <table className="w-full text-sm">
          <thead><tr className="bg-slate-900 border-b border-slate-200 text-start text-slate-300">
            <th className="px-4 py-3">#</th><th className="px-4 py-3">{tx.vendor}</th>
            <th className="px-4 py-3 text-end">{tx.total}</th><th className="px-4 py-3">{tx.status}</th>
            <th className="px-4 py-3">{tx.expected}</th><th className="px-4 py-3 text-end">{tx.actions}</th>
          </tr></thead>
          <tbody className="divide-y divide-slate-200">
            {items.length === 0 ? <tr><td colSpan={6} className="px-4 py-10 text-center text-slate-800">—</td></tr> : items.map((po) => (
              <tr key={po._id} className="hover:bg-slate-100">
                <td className="px-4 py-3 text-slate-800 font-mono text-xs">{po.poNumber}</td>
                <td className="px-4 py-3 text-slate-900">{vendorName(po.vendor)}</td>
                <td className="px-4 py-3 text-end text-slate-800">{money(po.total, po.currency)}<div className="text-slate-700 text-xs">{tx.vatShort} {money(po.vatAmount, '')}</div></td>
                <td className="px-4 py-3"><Badge style={PO_STATUS_STYLE[po.status]} lang={lang} /></td>
                <td className="px-4 py-3 text-slate-800">{fmtDate(po.expectedDate)}</td>
                <td className="px-4 py-3"><div className="flex items-center justify-end gap-2">
                  {['draft', 'sent', 'partially_received'].includes(po.status) && <button type="button" title={tx.receive} onClick={() => receive(po)} className="text-green-600 hover:text-green-700"><PackageCheck className="w-4 h-4" /></button>}
                  {po.status !== 'cancelled' && po.status !== 'billed' && <button type="button" title={tx.createBill} onClick={() => setBillFor(po)} className="text-purple-600 hover:text-purple-700"><Receipt className="w-4 h-4" /></button>}
                  {canManage && <button type="button" title={tx.delete} onClick={() => remove(po)} className="text-red-600 hover:text-red-700"><Trash2 className="w-4 h-4" /></button>}
                </div></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Create PO */}
      <Modal open={showModal} onClose={() => setShowModal(false)} wide title={tx.newPurchaseOrder}
        footer={<><button type="button" onClick={() => setShowModal(false)} className="px-4 py-2 bg-slate-100 text-slate-700 rounded-lg text-sm">{tx.cancel}</button>
          <PrimaryButton onClick={save} disabled={saving}>{saving ? '...' : tx.save}</PrimaryButton></>}>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Field label={tx.vendor}><VendorSelect value={form.vendor} onChange={(v) => setForm({ ...form, vendor: v })} required placeholder={tx.vendor} /></Field>
          <Field label={tx.vatPercent}><TextInput type="number" value={form.vatRate} onChange={(e) => setForm({ ...form, vatRate: e.target.value })} dir="ltr" /></Field>
          <Field label={tx.expectedDate}><TextInput type="date" value={form.expectedDate} onChange={(e) => setForm({ ...form, expectedDate: e.target.value })} /></Field>
        </div>
        <div className="mt-2 space-y-2">
          <p className="text-slate-500 text-xs">{tx.items}</p>
          {form.items.map((l: any, i: number) => (
            <div key={i} className="flex items-center gap-2">
              <input placeholder={tx.description} value={l.description} onChange={(e) => setItem(i, { description: e.target.value })} className="flex-1 px-2 py-2 rounded-lg bg-white border border-slate-200 text-slate-900 text-sm" />
              <input type="number" placeholder={tx.qty} value={l.quantity} onChange={(e) => setItem(i, { quantity: e.target.value })} className="w-20 px-2 py-2 rounded-lg bg-white border border-slate-200 text-slate-900 text-sm" dir="ltr" />
              <input type="number" placeholder={tx.price} value={l.unitPrice} onChange={(e) => setItem(i, { unitPrice: e.target.value })} className="w-24 px-2 py-2 rounded-lg bg-white border border-slate-200 text-slate-900 text-sm" dir="ltr" />
              <span className="w-24 text-end text-slate-500 text-sm">{money((Number(l.quantity) || 0) * (Number(l.unitPrice) || 0), '')}</span>
              <button type="button" title={tx.remove} onClick={() => rmItem(i)} className="text-red-600 hover:text-red-700"><X className="w-4 h-4" /></button>
            </div>
          ))}
          <button type="button" onClick={addItem} className="text-[#f37121] text-sm flex items-center gap-1"><Plus className="w-4 h-4" /> {tx.addItem}</button>
          <div className="flex justify-end gap-6 text-sm pt-2 border-t border-slate-200 text-slate-700">
            <span>{tx.subtotal}: {money(subtotal, '')}</span>
            <span>{tx.vat}: {money(vat, '')}</span>
            <span className="text-slate-900 font-bold">{tx.total}: {money(subtotal + vat, '')}</span>
          </div>
        </div>
      </Modal>

      {/* Create bill from PO */}
      <Modal open={!!billFor} onClose={() => setBillFor(null)} title={tx.createVendorBill}
        footer={<><button type="button" onClick={() => setBillFor(null)} className="px-4 py-2 bg-slate-100 text-slate-700 rounded-lg text-sm">{tx.cancel}</button>
          <PrimaryButton onClick={createBill}>{tx.createAndPost}</PrimaryButton></>}>
        {billFor && <div className="space-y-2 text-sm text-slate-700">
          <p>{tx.vendor}: <span className="text-slate-900">{vendorName(billFor.vendor)}</span></p>
          <p>{tx.subtotal}: {money(billFor.subtotal)}</p>
          <p>{tx.vat}: {money(billFor.vatAmount)}</p>
          <p className="text-slate-900 font-bold">{tx.total}: {money(billFor.total)}</p>
          <p className="text-slate-500 text-xs">{tx.autoPostsNote}</p>
        </div>}
      </Modal>
    </div>
  );
}
