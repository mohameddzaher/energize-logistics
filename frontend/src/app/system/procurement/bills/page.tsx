'use client';
import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '@/context/AuthContext';
import { useLanguage } from '@/context/LanguageContext';
import { useSocket } from '@/hooks/useSocket';
import api from '@/lib/api';
import { Receipt, Plus, Trash2, DollarSign } from 'lucide-react';
import {
  isProcStaff, isProcManager, VendorBill, ProcOptions, BILL_STATUS_STYLE,
  vendorName, money, fmtDate, today,
} from '@/lib/procurement';
import { Spinner, PageHeader, SearchInput, PrimaryButton, Badge, Modal, Field, TextInput, Select } from '@/components/hr/HRKit';
import ManagedSelect from '@/components/system/ManagedSelect';
import VendorSelect from '@/components/system/VendorSelect';

export default function VendorBillsPage() {
  const { user } = useAuth();
  const { lang, isRTL } = useLanguage();
  const ar = lang === 'ar';
  const [items, setItems] = useState<VendorBill[]>([]);
  const [opts, setOpts] = useState<ProcOptions | null>(null);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [statusF, setStatusF] = useState('');
  const [showModal, setShowModal] = useState(false);
  const [form, setForm] = useState<any>({ vendor: '', vendorInvoiceNumber: '', subtotal: 0, vatAmount: 0, billDate: today(), dueDate: '', category: '', notes: '' });
  const [saving, setSaving] = useState(false);
  const [payFor, setPayFor] = useState<VendorBill | null>(null);
  const [payAmount, setPayAmount] = useState('');

  const canManage = isProcManager(user?.role);

  const load = useCallback(async () => {
    try {
      const qs = new URLSearchParams(); if (search.trim()) qs.set('q', search.trim()); if (statusF) qs.set('status', statusF);
      const d = await api.get<{ bills: VendorBill[] }>(`/api/procurement/bills?${qs}`);
      setItems(d.bills || []);
    } catch { /* */ }
    setLoading(false);
  }, [search, statusF]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => { api.get<ProcOptions>('/api/procurement/options').then(setOpts).catch(() => {}); }, []);
  useSocket('procurement:bill', useCallback(() => load(), [load]));

  const total = (Number(form.subtotal) || 0) + (Number(form.vatAmount) || 0);
  const openCreate = () => { setForm({ vendor: '', vendorInvoiceNumber: '', subtotal: 0, vatAmount: 0, billDate: today(), dueDate: '', category: '', notes: '' }); setShowModal(true); };
  const save = async () => {
    if (!form.vendor) { alert(ar ? 'اختر مورّد' : 'Pick a vendor'); return; }
    if (total <= 0) { alert(ar ? 'الإجمالي لازم أكبر من صفر' : 'Total must be > 0'); return; }
    setSaving(true);
    try {
      await api.post('/api/procurement/bills', { ...form, subtotal: Number(form.subtotal) || 0, vatAmount: Number(form.vatAmount) || 0, dueDate: form.dueDate || undefined });
      setShowModal(false); load();
    } catch (e: any) { alert(e.message); } finally { setSaving(false); }
  };
  const remove = async (b: VendorBill) => { if (!confirm(ar ? 'حذف الفاتورة؟ سيُلغى الترحيل المحاسبي.' : 'Delete bill? Its journal entries will be reversed.')) return; try { await api.delete(`/api/procurement/bills/${b._id}`); load(); } catch (e: any) { alert(e.message); } };
  const openPay = (b: VendorBill) => { setPayFor(b); setPayAmount(String(b.balance)); };
  const pay = async () => {
    try { await api.post(`/api/procurement/bills/${payFor!._id}/pay`, { amount: Number(payAmount) || undefined }); setPayFor(null); load(); }
    catch (e: any) { alert(e.message); }
  };

  if (!isProcStaff(user?.role)) return <div className="text-slate-500 p-8">{ar ? 'لا تملك صلاحية' : 'Not authorized'}</div>;
  if (loading) return <Spinner />;

  return (
    <div className="space-y-6" dir={isRTL ? 'rtl' : 'ltr'}>
      <PageHeader icon={<Receipt className="w-5 h-5" />} title={ar ? 'فواتير الموردين' : 'Vendor Bills'} subtitle={`${items.length}`}>
        <PrimaryButton onClick={openCreate}><Plus className="w-4 h-4" /> {ar ? 'فاتورة جديدة' : 'New Bill'}</PrimaryButton>
      </PageHeader>

      <div className="flex flex-col sm:flex-row gap-3">
        <div className="flex-1"><SearchInput value={search} onChange={setSearch} placeholder={ar ? 'بحث...' : 'Search...'} /></div>
        <select value={statusF} onChange={(e) => setStatusF(e.target.value)} className="px-3 py-2.5 rounded-lg bg-white border border-slate-200 text-slate-900 text-sm">
          <option value="">{ar ? 'كل الحالات' : 'All Statuses'}</option>
          {(opts?.BILL_STATUSES || []).map((s) => <option key={s.key} value={s.key}>{ar ? s.nameAr : s.nameEn}</option>)}
        </select>
      </div>

      <div className="bg-white border border-slate-200 rounded-xl overflow-x-auto shadow-sm">
        <table className="w-full text-sm">
          <thead><tr className="bg-slate-900 border-b border-slate-200 text-left text-slate-300">
            <th className="px-4 py-3">#</th><th className="px-4 py-3">{ar ? 'المورّد' : 'Vendor'}</th>
            <th className="px-4 py-3 text-right">{ar ? 'الإجمالي' : 'Total'}</th><th className="px-4 py-3 text-right">{ar ? 'المتبقي' : 'Balance'}</th>
            <th className="px-4 py-3">{ar ? 'الاستحقاق' : 'Due'}</th><th className="px-4 py-3">{ar ? 'الحالة' : 'Status'}</th>
            <th className="px-4 py-3 text-right">{ar ? 'الإجراءات' : 'Actions'}</th>
          </tr></thead>
          <tbody className="divide-y divide-slate-200">
            {items.length === 0 ? <tr><td colSpan={7} className="px-4 py-10 text-center text-slate-500">—</td></tr> : items.map((b) => (
              <tr key={b._id} className="hover:bg-slate-100">
                <td className="px-4 py-3 text-slate-500 font-mono text-xs">{b.billNumber}</td>
                <td className="px-4 py-3 text-slate-900">{vendorName(b.vendor)}{b.vendorInvoiceNumber && <div className="text-slate-500 text-xs">{b.vendorInvoiceNumber}</div>}</td>
                <td className="px-4 py-3 text-right text-slate-800">{money(b.total)}</td>
                <td className="px-4 py-3 text-right text-red-600">{money(b.balance)}</td>
                <td className="px-4 py-3 text-slate-500">{fmtDate(b.dueDate)}</td>
                <td className="px-4 py-3"><Badge style={BILL_STATUS_STYLE[b.status]} lang={lang} /></td>
                <td className="px-4 py-3"><div className="flex items-center justify-end gap-2">
                  {b.status !== 'paid' && <button type="button" title={ar ? 'دفع' : 'Pay'} onClick={() => openPay(b)} className="text-green-600 hover:text-green-700"><DollarSign className="w-4 h-4" /></button>}
                  {canManage && <button type="button" title={ar ? 'حذف' : 'Delete'} onClick={() => remove(b)} className="text-red-600 hover:text-red-700"><Trash2 className="w-4 h-4" /></button>}
                </div></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Create bill */}
      <Modal open={showModal} onClose={() => setShowModal(false)} title={ar ? 'فاتورة مورّد جديدة' : 'New Vendor Bill'}
        footer={<><button type="button" onClick={() => setShowModal(false)} className="px-4 py-2 bg-slate-100 text-slate-700 rounded-lg text-sm">{ar ? 'إلغاء' : 'Cancel'}</button>
          <PrimaryButton onClick={save} disabled={saving}>{saving ? '...' : (ar ? 'إنشاء وترحيل' : 'Create & Post')}</PrimaryButton></>}>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Field label={ar ? 'المورّد' : 'Vendor'} span2><VendorSelect value={form.vendor} onChange={(v) => setForm({ ...form, vendor: v })} required placeholder={ar ? 'المورّد' : 'Vendor'} /></Field>
          <Field label={ar ? 'رقم فاتورة المورّد' : 'Vendor Invoice #'}><TextInput value={form.vendorInvoiceNumber} onChange={(e) => setForm({ ...form, vendorInvoiceNumber: e.target.value })} /></Field>
          <Field label={ar ? 'الفئة' : 'Category'}><ManagedSelect type="procurement_category" value={form.category} onChange={(v) => setForm({ ...form, category: v })} placeholder={ar ? 'الفئة' : 'Category'} /></Field>
          <Field label={ar ? 'المجموع (قبل الضريبة)' : 'Subtotal'}><TextInput type="number" value={form.subtotal} onChange={(e) => setForm({ ...form, subtotal: e.target.value })} dir="ltr" /></Field>
          <Field label={ar ? 'الضريبة' : 'VAT Amount'}><TextInput type="number" value={form.vatAmount} onChange={(e) => setForm({ ...form, vatAmount: e.target.value })} dir="ltr" /></Field>
          <Field label={ar ? 'تاريخ الفاتورة' : 'Bill Date'}><TextInput type="date" value={form.billDate} onChange={(e) => setForm({ ...form, billDate: e.target.value })} /></Field>
          <Field label={ar ? 'تاريخ الاستحقاق' : 'Due Date'}><TextInput type="date" value={form.dueDate} onChange={(e) => setForm({ ...form, dueDate: e.target.value })} /></Field>
        </div>
        <div className="flex justify-end text-slate-900 font-bold text-sm pt-2 border-t border-slate-200">{ar ? 'الإجمالي' : 'Total'}: {money(total)}</div>
      </Modal>

      {/* Pay bill */}
      <Modal open={!!payFor} onClose={() => setPayFor(null)} title={ar ? 'تسجيل دفعة' : 'Record Payment'}
        footer={<><button type="button" onClick={() => setPayFor(null)} className="px-4 py-2 bg-slate-100 text-slate-700 rounded-lg text-sm">{ar ? 'إلغاء' : 'Cancel'}</button>
          <PrimaryButton onClick={pay}>{ar ? 'دفع' : 'Pay'}</PrimaryButton></>}>
        {payFor && <>
          <p className="text-slate-700 text-sm mb-3">{vendorName(payFor.vendor)} · {ar ? 'المتبقي' : 'Balance'}: <span className="text-slate-900">{money(payFor.balance)}</span></p>
          <Field label={ar ? 'مبلغ الدفعة' : 'Payment Amount'}><TextInput type="number" value={payAmount} onChange={(e) => setPayAmount(e.target.value)} dir="ltr" /></Field>
          <p className="text-slate-500 text-xs mt-2">{ar ? 'سيُرحَّل: مدين ذمم دائنة، دائن نقدية.' : 'Auto-posts: Dr Accounts Payable, Cr Cash.'}</p>
        </>}
      </Modal>
    </div>
  );
}
