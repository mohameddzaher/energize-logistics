'use client';
import { useState, useEffect, useCallback } from 'react';
import { useDialog } from '@/components/system/DialogProvider';
import { useAuth } from '@/context/AuthContext';
import { useLanguage } from '@/context/LanguageContext';
import { useSocket } from '@/hooks/useSocket';
import api from '@/lib/api';
import { Receipt, Plus, Trash2, DollarSign } from 'lucide-react';
import {
  isProcStaff, isProcManager, VendorBill, ProcOptions, BILL_STATUS_STYLE,
  vendorName, money, fmtDate, today,
} from '@/lib/procurement';
import { Spinner, PageHeader, SearchInput, PrimaryButton, Badge, Modal, Field, TextInput, Select, ExportButton } from '@/components/hr/HRKit';
import ManagedSelect from '@/components/system/ManagedSelect';
import VendorSelect from '@/components/system/VendorSelect';
import { getProcurementBillsTranslations } from '@/lib/translations';
import { exportToExcel } from '@/utils/exportExcel';

export default function VendorBillsPage() {
  const { confirm, notify } = useDialog();
  const { user } = useAuth();
  const { lang, isRTL } = useLanguage();
  const ar = lang === 'ar';
  const tx = getProcurementBillsTranslations(lang);
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
    if (!form.vendor) { notify(tx.pickVendor); return; }
    if (total <= 0) { notify(tx.totalGtZero); return; }
    setSaving(true);
    try {
      await api.post('/api/procurement/bills', { ...form, subtotal: Number(form.subtotal) || 0, vatAmount: Number(form.vatAmount) || 0, dueDate: form.dueDate || undefined });
      setShowModal(false); load();
    } catch (e: any) { notify(e.message, 'error'); } finally { setSaving(false); }
  };
  const remove = async (b: VendorBill) => { if (!(await confirm(tx.confirmDelete))) return; try { await api.delete(`/api/procurement/bills/${b._id}`); load(); } catch (e: any) { notify(e.message, 'error'); } };
  const openPay = (b: VendorBill) => { setPayFor(b); setPayAmount(String(b.balance)); };
  const pay = async () => {
    try { await api.post(`/api/procurement/bills/${payFor!._id}/pay`, { amount: Number(payAmount) || undefined }); setPayFor(null); load(); }
    catch (e: any) { notify(e.message, 'error'); }
  };

  const statusLabel = (s: string) => {
    const o = (opts?.BILL_STATUSES || []).find((x) => x.key === s);
    return o ? (ar ? o.nameAr : o.nameEn) : s;
  };
  const handleExport = () => {
    exportToExcel(items, [
      { header: '#', key: 'billNumber', width: 16 },
      { header: tx.vendor, key: 'vendor', width: 24, transform: (v) => vendorName(v) },
      { header: tx.vendorInvoiceNo, key: 'vendorInvoiceNumber', width: 18 },
      { header: tx.total, key: 'total', width: 14, transform: (v) => money(v) },
      { header: tx.balance, key: 'balance', width: 14, transform: (v) => money(v) },
      { header: tx.due, key: 'dueDate', width: 14, transform: (v) => fmtDate(v) },
      { header: tx.status, key: 'status', width: 14, transform: (v) => statusLabel(v) },
    ], 'bills', tx.pageTitle);
  };

  if (!isProcStaff(user?.role)) return <div className="text-slate-500 p-8">{tx.notAuthorized}</div>;
  if (loading) return <Spinner />;

  return (
    <div className="space-y-6" dir={isRTL ? 'rtl' : 'ltr'}>
      <PageHeader icon={<Receipt className="w-5 h-5" />} title={tx.pageTitle} subtitle={`${items.length}`}>
        <ExportButton label={ar ? 'تصدير Excel' : 'Export Excel'} onClick={handleExport} />
        <PrimaryButton onClick={openCreate}><Plus className="w-4 h-4" /> {tx.newBill}</PrimaryButton>
      </PageHeader>

      <div className="flex flex-col sm:flex-row gap-3">
        <div className="flex-1 min-w-[240px]"><SearchInput value={search} onChange={setSearch} placeholder={tx.searchPlaceholder} /></div>
        <select value={statusF} onChange={(e) => setStatusF(e.target.value)} className="w-full sm:w-44 shrink-0 px-3 py-2.5 rounded-lg bg-white border border-slate-200 text-slate-900 text-sm">
          <option value="">{tx.allStatuses}</option>
          {(opts?.BILL_STATUSES || []).map((s) => <option key={s.key} value={s.key}>{ar ? s.nameAr : s.nameEn}</option>)}
        </select>
      </div>

      <div className="bg-white border border-slate-200 rounded-xl overflow-x-auto shadow-sm">
        <table className="w-full text-sm">
          <thead><tr className="bg-slate-900 border-b border-slate-200 text-start text-slate-300">
            <th className="px-4 py-3">#</th><th className="px-4 py-3">{tx.vendor}</th>
            <th className="px-4 py-3 text-end">{tx.total}</th><th className="px-4 py-3 text-end">{tx.balance}</th>
            <th className="px-4 py-3">{tx.due}</th><th className="px-4 py-3">{tx.status}</th>
            <th className="px-4 py-3 text-end">{tx.actions}</th>
          </tr></thead>
          <tbody className="divide-y divide-slate-200">
            {items.length === 0 ? <tr><td colSpan={7} className="px-4 py-10 text-center text-slate-800">—</td></tr> : items.map((b) => (
              <tr key={b._id} className="hover:bg-slate-100">
                <td className="px-4 py-3 text-slate-800 font-mono text-xs">{b.billNumber}</td>
                <td className="px-4 py-3 text-slate-900">{vendorName(b.vendor)}{b.vendorInvoiceNumber && <div className="text-slate-700 text-xs">{b.vendorInvoiceNumber}</div>}</td>
                <td className="px-4 py-3 text-end text-slate-800">{money(b.total)}</td>
                <td className="px-4 py-3 text-end text-red-600">{money(b.balance)}</td>
                <td className="px-4 py-3 text-slate-800">{fmtDate(b.dueDate)}</td>
                <td className="px-4 py-3"><Badge style={BILL_STATUS_STYLE[b.status]} lang={lang} /></td>
                <td className="px-4 py-3"><div className="flex items-center justify-end gap-2">
                  {b.status !== 'paid' && <button type="button" title={tx.pay} onClick={() => openPay(b)} className="text-green-600 hover:text-green-700"><DollarSign className="w-4 h-4" /></button>}
                  {canManage && <button type="button" title={tx.delete} onClick={() => remove(b)} className="text-red-600 hover:text-red-700"><Trash2 className="w-4 h-4" /></button>}
                </div></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Create bill */}
      <Modal open={showModal} onClose={() => setShowModal(false)} title={tx.newVendorBill}
        footer={<><button type="button" onClick={() => setShowModal(false)} className="px-4 py-2 bg-slate-100 text-slate-700 rounded-lg text-sm">{tx.cancel}</button>
          <PrimaryButton onClick={save} disabled={saving}>{saving ? '...' : tx.createAndPost}</PrimaryButton></>}>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Field label={tx.vendor} span2><VendorSelect value={form.vendor} onChange={(v) => setForm({ ...form, vendor: v })} required placeholder={tx.vendor} /></Field>
          <Field label={tx.vendorInvoiceNo}><TextInput value={form.vendorInvoiceNumber} onChange={(e) => setForm({ ...form, vendorInvoiceNumber: e.target.value })} /></Field>
          <Field label={tx.category}><ManagedSelect type="procurement_category" value={form.category} onChange={(v) => setForm({ ...form, category: v })} placeholder={tx.category} /></Field>
          <Field label={tx.subtotal}><TextInput type="number" value={form.subtotal} onChange={(e) => setForm({ ...form, subtotal: e.target.value })} dir="ltr" /></Field>
          <Field label={tx.vatAmount}><TextInput type="number" value={form.vatAmount} onChange={(e) => setForm({ ...form, vatAmount: e.target.value })} dir="ltr" /></Field>
          <Field label={tx.billDate}><TextInput type="date" value={form.billDate} onChange={(e) => setForm({ ...form, billDate: e.target.value })} /></Field>
          <Field label={tx.dueDate}><TextInput type="date" value={form.dueDate} onChange={(e) => setForm({ ...form, dueDate: e.target.value })} /></Field>
        </div>
        <div className="flex justify-end text-slate-900 font-bold text-sm pt-2 border-t border-slate-200">{tx.total}: {money(total)}</div>
      </Modal>

      {/* Pay bill */}
      <Modal open={!!payFor} onClose={() => setPayFor(null)} title={tx.recordPayment}
        footer={<><button type="button" onClick={() => setPayFor(null)} className="px-4 py-2 bg-slate-100 text-slate-700 rounded-lg text-sm">{tx.cancel}</button>
          <PrimaryButton onClick={pay}>{tx.pay}</PrimaryButton></>}>
        {payFor && <>
          <p className="text-slate-700 text-sm mb-3">{vendorName(payFor.vendor)} · {tx.balance}: <span className="text-slate-900">{money(payFor.balance)}</span></p>
          <Field label={tx.paymentAmount}><TextInput type="number" value={payAmount} onChange={(e) => setPayAmount(e.target.value)} dir="ltr" /></Field>
          <p className="text-slate-500 text-xs mt-2">{tx.autoPostNote}</p>
        </>}
      </Modal>
    </div>
  );
}
