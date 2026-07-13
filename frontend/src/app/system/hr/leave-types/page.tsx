'use client';
import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '@/context/AuthContext';
import { useLanguage } from '@/context/LanguageContext';
import api from '@/lib/api';
import { Tags, Plus, Edit, Trash2, Check } from 'lucide-react';
import { isHRStaff, LeaveType } from '@/lib/hr';
import { Spinner, PageHeader, PrimaryButton, SmallBadge, Modal, Field, TextInput, Select, Loader2, ExportButton } from '@/components/hr/HRKit';
import { getHrLeaveTypesTranslations } from '@/lib/translations';
import { exportToExcel } from '@/utils/exportExcel';

const EMPTY = { code: '', nameEn: '', nameAr: '', paid: true, affectsBalance: true, color: '#f37121', active: true };

export default function LeaveTypesPage() {
  const { user } = useAuth();
  const { lang, isRTL } = useLanguage();
  const ar = lang === 'ar';
  const tx = getHrLeaveTypesTranslations(lang);
  const staff = isHRStaff(user?.role);

  const [types, setTypes] = useState<LeaveType[]>([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [editing, setEditing] = useState<LeaveType | null>(null);
  const [form, setForm] = useState<any>(EMPTY);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    try { const d = await api.get<{ leaveTypes: LeaveType[] }>('/api/hr/leave-types'); setTypes(d.leaveTypes || []); } catch {}
    setLoading(false);
  }, []);
  useEffect(() => { load(); }, [load]);

  const set = (k: string, v: any) => setForm((f: any) => ({ ...f, [k]: v }));
  const openCreate = () => { setEditing(null); setForm(EMPTY); setShowModal(true); };
  const openEdit = (t: LeaveType) => { setEditing(t); setForm({ ...EMPTY, ...t }); setShowModal(true); };

  const save = async () => {
    if (!form.code.trim() || !form.nameEn.trim() || !form.nameAr.trim()) return;
    setSaving(true);
    try {
      if (editing) await api.put(`/api/hr/leave-types/${editing._id}`, form);
      else await api.post('/api/hr/leave-types', form);
      setShowModal(false); load();
    } catch (e: any) { alert(e.message); }
    setSaving(false);
  };
  const remove = async (t: LeaveType) => { if (!confirm(tx.deleteConfirm)) return; try { await api.delete(`/api/hr/leave-types/${t._id}`); load(); } catch (e: any) { alert(e.message); } };

  const exportXlsx = () => {
    exportToExcel(types, [
      { header: tx.colName, key: ar ? 'nameAr' : 'nameEn', width: 24 },
      { header: tx.colCode, key: 'code', width: 16 },
      { header: tx.colPaid, key: 'paid', transform: (v) => (v ? tx.yes : tx.no), width: 12 },
      { header: tx.colAffectsBalance, key: 'affectsBalance', transform: (v) => (v ? tx.yes : tx.no), width: 18 },
      { header: tx.colActive, key: 'active', transform: (v) => (v ? tx.activeLabel : tx.inactiveLabel), width: 14 },
    ], 'leave-types', tx.title);
  };

  if (!staff) return <div className="text-slate-500 p-8">{tx.notAuthorized}</div>;
  if (loading) return <Spinner />;

  return (
    <div className="space-y-6" dir={isRTL ? 'rtl' : 'ltr'}>
      <PageHeader icon={<Tags className="w-5 h-5" />} title={tx.title} subtitle={`${types.length} ${tx.typesUnit}`}>
        <ExportButton onClick={exportXlsx} label={ar ? 'تصدير Excel' : 'Export Excel'} />
        <PrimaryButton onClick={openCreate}><Plus className="w-4 h-4" /> {tx.addType}</PrimaryButton>
      </PageHeader>

      <div className="bg-white border border-slate-200 rounded-xl overflow-x-auto shadow-sm">
        <table className="w-full text-sm">
          <thead><tr className="bg-slate-900 border-b border-slate-200 text-slate-300">
            <th className="text-start font-semibold px-4 py-3">{tx.colName}</th>
            <th className="text-start font-semibold px-4 py-3">{tx.colCode}</th>
            <th className="text-start font-semibold px-4 py-3">{tx.colPaid}</th>
            <th className="text-start font-semibold px-4 py-3">{tx.colAffectsBalance}</th>
            <th className="text-start font-semibold px-4 py-3">{tx.colActive}</th>
            <th className="text-end font-semibold px-4 py-3">{tx.colActions}</th>
          </tr></thead>
          <tbody>
            {types.map((t) => (
              <tr key={t._id} className="border-b border-slate-200/70 hover:bg-slate-100">
                <td className="px-4 py-3 text-slate-900 font-medium"><span className="inline-block w-3 h-3 rounded-full me-2 align-middle" style={{ background: t.color || '#f37121' }} />{ar ? t.nameAr : t.nameEn}</td>
                <td className="px-4 py-3 text-slate-800">{t.code}</td>
                <td className="px-4 py-3">{t.paid ? <SmallBadge bg="bg-green-500/20" text="text-green-600" label={tx.yes} /> : <SmallBadge bg="bg-slate-500/20" text="text-slate-700" label={tx.no} />}</td>
                <td className="px-4 py-3">{t.affectsBalance ? <SmallBadge bg="bg-blue-500/20" text="text-blue-600" label={tx.yes} /> : <SmallBadge bg="bg-slate-500/20" text="text-slate-700" label={tx.no} />}</td>
                <td className="px-4 py-3">{t.active ? <SmallBadge bg="bg-green-500/20" text="text-green-600" label={tx.activeLabel} /> : <SmallBadge bg="bg-red-500/20" text="text-red-600" label={tx.inactiveLabel} />}</td>
                <td className="px-4 py-3">
                  <div className="flex items-center justify-end gap-1">
                    <button type="button" onClick={() => openEdit(t)} className="p-1.5 rounded-lg text-slate-700 hover:text-[#f37121] hover:bg-slate-100"><Edit className="w-4 h-4" /></button>
                    <button type="button" onClick={() => remove(t)} className="p-1.5 rounded-lg text-slate-700 hover:text-red-600 hover:bg-slate-100"><Trash2 className="w-4 h-4" /></button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <Modal open={showModal} onClose={() => setShowModal(false)} title={editing ? tx.editLeaveType : tx.newLeaveType}
        footer={<>
          <button type="button" onClick={() => setShowModal(false)} className="px-4 py-2 text-slate-500 hover:text-slate-900 text-sm">{tx.cancel}</button>
          <PrimaryButton onClick={save} disabled={saving || !form.code.trim() || !form.nameEn.trim() || !form.nameAr.trim()}>{saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}{tx.save}</PrimaryButton>
        </>}>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Field label={tx.fieldCode}><TextInput value={form.code} onChange={(e) => set('code', e.target.value)} disabled={!!editing} placeholder="annual" /></Field>
          <Field label={tx.fieldColor}><TextInput type="color" value={form.color} onChange={(e) => set('color', e.target.value)} /></Field>
          <Field label={tx.fieldNameEn}><TextInput value={form.nameEn} onChange={(e) => set('nameEn', e.target.value)} /></Field>
          <Field label={tx.fieldNameAr}><TextInput value={form.nameAr} onChange={(e) => set('nameAr', e.target.value)} /></Field>
          <Field label={tx.fieldPaid}><Select value={form.paid ? '1' : '0'} onChange={(e) => set('paid', e.target.value === '1')}><option value="1">{tx.yes}</option><option value="0">{tx.no}</option></Select></Field>
          <Field label={tx.fieldAffectsBalance}><Select value={form.affectsBalance ? '1' : '0'} onChange={(e) => set('affectsBalance', e.target.value === '1')}><option value="1">{tx.yes}</option><option value="0">{tx.no}</option></Select></Field>
          <Field label={tx.fieldActive}><Select value={form.active ? '1' : '0'} onChange={(e) => set('active', e.target.value === '1')}><option value="1">{tx.yes}</option><option value="0">{tx.no}</option></Select></Field>
        </div>
      </Modal>
    </div>
  );
}
