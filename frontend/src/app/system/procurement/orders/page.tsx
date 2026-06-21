'use client';
import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '@/context/AuthContext';
import { useLanguage } from '@/context/LanguageContext';
import { useSocket } from '@/hooks/useSocket';
import api from '@/lib/api';
import { FileText, Plus, Trash2, PackageCheck, Receipt, X } from 'lucide-react';
import {
  isProcStaff, isProcManager, PurchaseOrder, ProcOptions, PO_STATUS_STYLE,
  vendorName, money, fmtDate,
} from '@/lib/procurement';
import { Spinner, PageHeader, SearchInput, PrimaryButton, Badge, Modal, Field, TextInput, Select } from '@/components/hr/HRKit';
import VendorSelect from '@/components/system/VendorSelect';

const emptyItem = () => ({ description: '', quantity: 1, unitPrice: 0 });

export default function PurchaseOrdersPage() {
  const { user } = useAuth();
  const { lang, isRTL } = useLanguage();
  const ar = lang === 'ar';
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
    if (!form.vendor) { alert(ar ? 'اختر مورّد' : 'Pick a vendor'); return; }
    setSaving(true);
    try {
      await api.post('/api/procurement/orders', { ...form, expectedDate: form.expectedDate || undefined, items: form.items.filter((l: any) => l.description?.trim()) });
      setShowModal(false); load();
    } catch (e: any) { alert(e.message); } finally { setSaving(false); }
  };
  const receive = async (po: PurchaseOrder) => { try { await api.post(`/api/procurement/orders/${po._id}/receive`); load(); } catch (e: any) { alert(e.message); } };
  const remove = async (po: PurchaseOrder) => { if (!confirm(ar ? 'حذف الأمر؟' : 'Delete order?')) return; try { await api.delete(`/api/procurement/orders/${po._id}`); load(); } catch (e: any) { alert(e.message); } };
  const createBill = async () => {
    if (!billFor) return;
    try {
      await api.post('/api/procurement/bills', { vendor: typeof billFor.vendor === 'object' ? billFor.vendor._id : billFor.vendor, purchaseOrder: billFor._id, subtotal: billFor.subtotal, vatAmount: billFor.vatAmount, dueDate: undefined });
      setBillFor(null); load(); alert(ar ? 'تم إنشاء الفاتورة وترحيلها للذمم الدائنة' : 'Bill created & posted to A/P');
    } catch (e: any) { alert(e.message); }
  };

  if (!isProcStaff(user?.role)) return <div className="text-slate-500 p-8">{ar ? 'لا تملك صلاحية' : 'Not authorized'}</div>;
  if (loading) return <Spinner />;

  return (
    <div className="space-y-6" dir={isRTL ? 'rtl' : 'ltr'}>
      <PageHeader icon={<FileText className="w-5 h-5" />} title={ar ? 'أوامر الشراء' : 'Purchase Orders'} subtitle={`${items.length}`}>
        <PrimaryButton onClick={openCreate}><Plus className="w-4 h-4" /> {ar ? 'أمر جديد' : 'New Order'}</PrimaryButton>
      </PageHeader>

      <div className="flex flex-col sm:flex-row gap-3">
        <div className="flex-1"><SearchInput value={search} onChange={setSearch} placeholder={ar ? 'بحث...' : 'Search...'} /></div>
        <select value={statusF} onChange={(e) => setStatusF(e.target.value)} className="px-3 py-2.5 rounded-lg bg-white border border-slate-200 text-slate-900 text-sm">
          <option value="">{ar ? 'كل الحالات' : 'All Statuses'}</option>
          {(opts?.PO_STATUSES || []).map((s) => <option key={s.key} value={s.key}>{ar ? s.nameAr : s.nameEn}</option>)}
        </select>
      </div>

      <div className="bg-white border border-slate-200 rounded-xl overflow-x-auto shadow-sm">
        <table className="w-full text-sm">
          <thead><tr className="bg-slate-900 border-b border-slate-200 text-left text-slate-300">
            <th className="px-4 py-3">#</th><th className="px-4 py-3">{ar ? 'المورّد' : 'Vendor'}</th>
            <th className="px-4 py-3 text-right">{ar ? 'الإجمالي' : 'Total'}</th><th className="px-4 py-3">{ar ? 'الحالة' : 'Status'}</th>
            <th className="px-4 py-3">{ar ? 'متوقع' : 'Expected'}</th><th className="px-4 py-3 text-right">{ar ? 'الإجراءات' : 'Actions'}</th>
          </tr></thead>
          <tbody className="divide-y divide-slate-200">
            {items.length === 0 ? <tr><td colSpan={6} className="px-4 py-10 text-center text-slate-500">—</td></tr> : items.map((po) => (
              <tr key={po._id} className="hover:bg-slate-100">
                <td className="px-4 py-3 text-slate-500 font-mono text-xs">{po.poNumber}</td>
                <td className="px-4 py-3 text-slate-900">{vendorName(po.vendor)}</td>
                <td className="px-4 py-3 text-right text-slate-800">{money(po.total, po.currency)}<div className="text-slate-500 text-xs">{ar ? 'ض.ق.م' : 'VAT'} {money(po.vatAmount, '')}</div></td>
                <td className="px-4 py-3"><Badge style={PO_STATUS_STYLE[po.status]} lang={lang} /></td>
                <td className="px-4 py-3 text-slate-500">{fmtDate(po.expectedDate)}</td>
                <td className="px-4 py-3"><div className="flex items-center justify-end gap-2">
                  {['draft', 'sent', 'partially_received'].includes(po.status) && <button type="button" title={ar ? 'استلام' : 'Receive'} onClick={() => receive(po)} className="text-green-600 hover:text-green-700"><PackageCheck className="w-4 h-4" /></button>}
                  {po.status !== 'cancelled' && po.status !== 'billed' && <button type="button" title={ar ? 'إنشاء فاتورة' : 'Create Bill'} onClick={() => setBillFor(po)} className="text-purple-600 hover:text-purple-700"><Receipt className="w-4 h-4" /></button>}
                  {canManage && <button type="button" title={ar ? 'حذف' : 'Delete'} onClick={() => remove(po)} className="text-red-600 hover:text-red-700"><Trash2 className="w-4 h-4" /></button>}
                </div></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Create PO */}
      <Modal open={showModal} onClose={() => setShowModal(false)} wide title={ar ? 'أمر شراء جديد' : 'New Purchase Order'}
        footer={<><button type="button" onClick={() => setShowModal(false)} className="px-4 py-2 bg-slate-100 text-slate-700 rounded-lg text-sm">{ar ? 'إلغاء' : 'Cancel'}</button>
          <PrimaryButton onClick={save} disabled={saving}>{saving ? '...' : (ar ? 'حفظ' : 'Save')}</PrimaryButton></>}>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Field label={ar ? 'المورّد' : 'Vendor'}><VendorSelect value={form.vendor} onChange={(v) => setForm({ ...form, vendor: v })} required placeholder={ar ? 'المورّد' : 'Vendor'} /></Field>
          <Field label={ar ? 'نسبة الضريبة %' : 'VAT %'}><TextInput type="number" value={form.vatRate} onChange={(e) => setForm({ ...form, vatRate: e.target.value })} dir="ltr" /></Field>
          <Field label={ar ? 'تاريخ متوقع' : 'Expected Date'}><TextInput type="date" value={form.expectedDate} onChange={(e) => setForm({ ...form, expectedDate: e.target.value })} /></Field>
        </div>
        <div className="mt-2 space-y-2">
          <p className="text-slate-500 text-xs">{ar ? 'الأصناف' : 'Items'}</p>
          {form.items.map((l: any, i: number) => (
            <div key={i} className="flex items-center gap-2">
              <input placeholder={ar ? 'الوصف' : 'Description'} value={l.description} onChange={(e) => setItem(i, { description: e.target.value })} className="flex-1 px-2 py-2 rounded-lg bg-white border border-slate-200 text-slate-900 text-sm" />
              <input type="number" placeholder="Qty" value={l.quantity} onChange={(e) => setItem(i, { quantity: e.target.value })} className="w-20 px-2 py-2 rounded-lg bg-white border border-slate-200 text-slate-900 text-sm" dir="ltr" />
              <input type="number" placeholder="Price" value={l.unitPrice} onChange={(e) => setItem(i, { unitPrice: e.target.value })} className="w-24 px-2 py-2 rounded-lg bg-white border border-slate-200 text-slate-900 text-sm" dir="ltr" />
              <span className="w-24 text-right text-slate-500 text-sm">{money((Number(l.quantity) || 0) * (Number(l.unitPrice) || 0), '')}</span>
              <button type="button" title={ar ? 'حذف' : 'Remove'} onClick={() => rmItem(i)} className="text-red-600 hover:text-red-700"><X className="w-4 h-4" /></button>
            </div>
          ))}
          <button type="button" onClick={addItem} className="text-[#f37121] text-sm flex items-center gap-1"><Plus className="w-4 h-4" /> {ar ? 'إضافة صنف' : 'Add item'}</button>
          <div className="flex justify-end gap-6 text-sm pt-2 border-t border-slate-200 text-slate-700">
            <span>{ar ? 'المجموع' : 'Subtotal'}: {money(subtotal, '')}</span>
            <span>{ar ? 'الضريبة' : 'VAT'}: {money(vat, '')}</span>
            <span className="text-slate-900 font-bold">{ar ? 'الإجمالي' : 'Total'}: {money(subtotal + vat, '')}</span>
          </div>
        </div>
      </Modal>

      {/* Create bill from PO */}
      <Modal open={!!billFor} onClose={() => setBillFor(null)} title={ar ? 'إنشاء فاتورة مورّد' : 'Create Vendor Bill'}
        footer={<><button type="button" onClick={() => setBillFor(null)} className="px-4 py-2 bg-slate-100 text-slate-700 rounded-lg text-sm">{ar ? 'إلغاء' : 'Cancel'}</button>
          <PrimaryButton onClick={createBill}>{ar ? 'إنشاء وترحيل' : 'Create & Post'}</PrimaryButton></>}>
        {billFor && <div className="space-y-2 text-sm text-slate-700">
          <p>{ar ? 'المورّد' : 'Vendor'}: <span className="text-slate-900">{vendorName(billFor.vendor)}</span></p>
          <p>{ar ? 'المجموع' : 'Subtotal'}: {money(billFor.subtotal)}</p>
          <p>{ar ? 'الضريبة' : 'VAT'}: {money(billFor.vatAmount)}</p>
          <p className="text-slate-900 font-bold">{ar ? 'الإجمالي' : 'Total'}: {money(billFor.total)}</p>
          <p className="text-slate-500 text-xs">{ar ? 'سيُرحَّل تلقائيًا: مدين مصروف + ضريبة، دائن ذمم دائنة.' : 'Auto-posts: Dr Expense + VAT, Cr Accounts Payable.'}</p>
        </div>}
      </Modal>
    </div>
  );
}
