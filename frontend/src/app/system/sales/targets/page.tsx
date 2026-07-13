'use client';
import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '@/context/AuthContext';
import { useLanguage } from '@/context/LanguageContext';
import { useSocket } from '@/hooks/useSocket';
import api from '@/lib/api';
import { Target, Plus, Trash2, Edit } from 'lucide-react';
import { isSalesStaff, isSalesAdmin, SalesTarget, money, userName, thisPeriod } from '@/lib/finance';
import { Spinner, PageHeader, PrimaryButton, Modal, Field, TextInput, Select, ExportButton } from '@/components/hr/HRKit';
import { getSalesTargetsTranslations } from '@/lib/translations';
import { exportToExcel } from '@/utils/exportExcel';

const EMPTY = { rep: '', period: thisPeriod(), amountTarget: 0, dealsTarget: 0, notes: '' };

export default function SalesTargetsPage() {
  const { user } = useAuth();
  const { lang, isRTL } = useLanguage();
  const ar = lang === 'ar';
  const tx = getSalesTargetsTranslations(lang);
  const [items, setItems] = useState<SalesTarget[]>([]);
  const [reps, setReps] = useState<any[]>([]);
  const [period, setPeriod] = useState(thisPeriod());
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [editing, setEditing] = useState<SalesTarget | null>(null);
  const [form, setForm] = useState<any>(EMPTY);
  const [saving, setSaving] = useState(false);

  const canEdit = isSalesAdmin(user?.role);

  const load = useCallback(async () => {
    try { const d = await api.get<{ targets: SalesTarget[] }>(`/api/sales/targets?period=${period}`); setItems(d.targets || []); } catch { /* */ }
    setLoading(false);
  }, [period]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => { api.get<{ reps: any[] }>('/api/sales/options').then((d) => setReps(d.reps || [])).catch(() => {}); }, []);
  useSocket('sales:target', useCallback(() => load(), [load]));

  const openCreate = () => { setEditing(null); setForm({ ...EMPTY, period }); setShowModal(true); };
  const openEdit = (t: SalesTarget) => { setEditing(t); setForm({ ...EMPTY, ...t, rep: typeof t.rep === 'object' ? t.rep?._id : (t.rep || '') }); setShowModal(true); };
  const save = async () => {
    setSaving(true);
    try {
      const payload = { ...form, rep: form.rep || null, amountTarget: Number(form.amountTarget) || 0, dealsTarget: Number(form.dealsTarget) || 0 };
      if (editing) await api.put(`/api/sales/targets/${editing._id}`, payload);
      else await api.post('/api/sales/targets', payload);
      setShowModal(false); load();
    } catch (e: any) { alert(e.message); } finally { setSaving(false); }
  };
  const remove = async (t: SalesTarget) => {
    if (!confirm(tx.confirmDelete)) return;
    try { await api.delete(`/api/sales/targets/${t._id}`); load(); } catch (e: any) { alert(e.message); }
  };

  const handleExport = () => {
    exportToExcel(items, [
      { header: tx.rep, key: 'rep', width: 24, transform: (v) => (v ? userName(v) : tx.wholeTeam) },
      { header: tx.period, key: 'period', width: 14 },
      { header: tx.amountTarget, key: 'amountTarget', width: 18, transform: (v) => money(v) },
      { header: tx.dealsTarget, key: 'dealsTarget', width: 14 },
    ], 'sales-targets', tx.pageTitle);
  };

  if (!isSalesStaff(user?.role)) return <div className="text-slate-500 p-8">{tx.notAuthorized}</div>;
  if (loading) return <Spinner />;

  return (
    <div className="space-y-6" dir={isRTL ? 'rtl' : 'ltr'}>
      <PageHeader icon={<Target className="w-5 h-5" />} title={tx.pageTitle}>
        <input type="month" value={period} onChange={(e) => setPeriod(e.target.value)} className="px-3 py-2 rounded-lg bg-white border border-slate-200 text-slate-900 text-sm" aria-label={tx.period} />
        <ExportButton label={ar ? 'تصدير Excel' : 'Export Excel'} onClick={handleExport} />
        {canEdit && <PrimaryButton onClick={openCreate}><Plus className="w-4 h-4" /> {tx.setTarget}</PrimaryButton>}
      </PageHeader>

      <div className="bg-white border border-slate-200 rounded-xl overflow-x-auto shadow-sm">
        <table className="w-full text-sm">
          <thead><tr className="bg-slate-900 border-b border-slate-200 text-start text-slate-300">
            <th className="px-4 py-3">{tx.rep}</th>
            <th className="px-4 py-3">{tx.period}</th>
            <th className="px-4 py-3 text-end">{tx.amountTarget}</th>
            <th className="px-4 py-3 text-end">{tx.dealsTarget}</th>
            <th className="px-4 py-3 text-end">{tx.actions}</th>
          </tr></thead>
          <tbody className="divide-y divide-slate-200">
            {items.length === 0 ? <tr><td colSpan={5} className="px-4 py-10 text-center text-slate-500">—</td></tr> : items.map((t) => (
              <tr key={t._id} className="hover:bg-slate-100">
                <td className="px-4 py-3 text-slate-900">{t.rep ? userName(t.rep) : tx.wholeTeam}</td>
                <td className="px-4 py-3 text-slate-700">{t.period}</td>
                <td className="px-4 py-3 text-end text-slate-900">{money(t.amountTarget)}</td>
                <td className="px-4 py-3 text-end text-slate-700">{t.dealsTarget}</td>
                <td className="px-4 py-3"><div className="flex items-center justify-end gap-2">
                  {canEdit && <button type="button" title={tx.edit} onClick={() => openEdit(t)} className="text-blue-600 hover:text-blue-700"><Edit className="w-4 h-4" /></button>}
                  {canEdit && <button type="button" title={tx.delete} onClick={() => remove(t)} className="text-red-600 hover:text-red-700"><Trash2 className="w-4 h-4" /></button>}
                </div></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <Modal open={showModal} onClose={() => setShowModal(false)} title={editing ? tx.editTarget : tx.newTarget}
        footer={<><button type="button" onClick={() => setShowModal(false)} className="px-4 py-2 bg-slate-100 text-slate-700 rounded-lg text-sm">{tx.cancel}</button>
          <PrimaryButton onClick={save} disabled={saving}>{saving ? '...' : tx.save}</PrimaryButton></>}>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Field label={tx.rep} span2><Select value={form.rep} onChange={(e) => setForm({ ...form, rep: e.target.value })} disabled={!!editing}>
            <option value="">{tx.wholeTeam}</option>
            {reps.map((r) => <option key={r._id} value={r._id}>{r.firstName} {r.lastName}</option>)}
          </Select></Field>
          <Field label={tx.period}><TextInput type="month" value={form.period} onChange={(e) => setForm({ ...form, period: e.target.value })} disabled={!!editing} /></Field>
          <Field label={tx.amountTarget}><TextInput type="number" value={form.amountTarget} onChange={(e) => setForm({ ...form, amountTarget: e.target.value })} dir="ltr" /></Field>
          <Field label={tx.dealsTarget}><TextInput type="number" value={form.dealsTarget} onChange={(e) => setForm({ ...form, dealsTarget: e.target.value })} dir="ltr" /></Field>
        </div>
      </Modal>
    </div>
  );
}
