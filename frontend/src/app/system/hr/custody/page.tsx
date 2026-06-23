'use client';
import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '@/context/AuthContext';
import { useLanguage } from '@/context/LanguageContext';
import { useSocket } from '@/hooks/useSocket';
import api from '@/lib/api';
import { Package, Plus, Edit, Undo2, Trash2, Check } from 'lucide-react';
import { isHRStaff, Asset, Employee, ASSET_TYPES, ASSET_CONDITIONS, assetTypeLabel, conditionLabel, empName, fmtDate, exportToExcel, today } from '@/lib/hr';
import { Spinner, PageHeader, SearchInput, ExportButton, PrimaryButton, SmallBadge, Modal, Field, TextInput, Select, TextArea, Loader2 } from '@/components/hr/HRKit';
import { getHrCustodyTranslations } from '@/lib/translations';

const EMPTY = { employee: '', name: '', type: 'laptop', serialNumber: '', brand: '', model: '', condition: 'good', value: 0, assignedDate: '', notes: '' };

export default function CustodyPage() {
  const { user } = useAuth();
  const { lang, isRTL } = useLanguage();
  const ar = lang === 'ar';
  const tx = getHrCustodyTranslations(lang);
  const staff = isHRStaff(user?.role);

  const [assets, setAssets] = useState<Asset[]>([]);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [showModal, setShowModal] = useState(false);
  const [editing, setEditing] = useState<Asset | null>(null);
  const [form, setForm] = useState<any>(EMPTY);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    try {
      const qs = statusFilter ? `?status=${statusFilter}` : '';
      const d = await api.get<{ assets: Asset[] }>(`/api/hr/assets${qs}`);
      setAssets(d.assets || []);
    } catch {}
    setLoading(false);
  }, [statusFilter]);

  useEffect(() => { load(); }, [load]);
  useSocket('hr:asset', useCallback(() => load(), [load]));
  useEffect(() => { api.get<{ employees: Employee[] }>('/api/hr/employees').then((d) => setEmployees(d.employees || [])).catch(() => {}); }, []);

  const set = (k: string, v: any) => setForm((f: any) => ({ ...f, [k]: v }));
  const openCreate = () => { setEditing(null); setForm({ ...EMPTY, assignedDate: today() }); setShowModal(true); };
  const openEdit = (a: Asset) => { setEditing(a); setForm({ ...EMPTY, ...a, employee: typeof a.employee === 'object' ? a.employee?._id : a.employee }); setShowModal(true); };

  const save = async () => {
    if (!form.employee || !form.name.trim()) return;
    setSaving(true);
    try {
      if (editing) await api.put(`/api/hr/assets/${editing._id}`, form);
      else await api.post('/api/hr/assets', form);
      setShowModal(false); load();
    } catch (e: any) { alert(e.message); }
    setSaving(false);
  };

  const returnAsset = async (a: Asset) => {
    const cond = prompt(tx.returnConditionPrompt, a.condition || 'good') || a.condition;
    try { await api.post(`/api/hr/assets/${a._id}/return`, { returnedCondition: cond }); load(); } catch (e: any) { alert(e.message); }
  };
  const remove = async (a: Asset) => { if (!confirm(tx.deleteConfirm)) return; try { await api.delete(`/api/hr/assets/${a._id}`); load(); } catch (e: any) { alert(e.message); } };

  const filtered = assets.filter((a) => !search.trim() || a.name.toLowerCase().includes(search.toLowerCase()) || (a.serialNumber || '').toLowerCase().includes(search.toLowerCase()) || empName(a.employee).toLowerCase().includes(search.toLowerCase()));

  if (!staff) return <div className="text-slate-500 p-8">{tx.notAuthorized}</div>;
  if (loading) return <Spinner />;

  return (
    <div className="space-y-6" dir={isRTL ? 'rtl' : 'ltr'}>
      <PageHeader icon={<Package className="w-5 h-5" />} title={tx.pageTitle} subtitle={`${assets.filter((a) => a.status === 'assigned').length} ${tx.assignedCount}`}>
        <ExportButton label={tx.exportExcel} onClick={() => exportToExcel(filtered, [
          { header: 'Employee', key: 'employee', transform: (v: any) => empName(v), width: 22 },
          { header: 'Item', key: 'name', width: 20 },
          { header: 'Type', key: 'type', width: 12 },
          { header: 'Serial', key: 'serialNumber', width: 18 },
          { header: 'Brand', key: 'brand', width: 14 },
          { header: 'Condition', key: 'condition', width: 12 },
          { header: 'Status', key: 'status', width: 12 },
          { header: 'Assigned', key: 'assignedDate', width: 14 },
          { header: 'Returned', key: 'returnedDate', width: 14 },
        ], `custody-${today()}`, 'Custody')} />
        <PrimaryButton onClick={openCreate}><Plus className="w-4 h-4" /> {tx.addCustody}</PrimaryButton>
      </PageHeader>

      <div className="flex flex-col sm:flex-row gap-3">
        <div className="flex-1 min-w-[240px]"><SearchInput value={search} onChange={setSearch} placeholder={tx.searchPlaceholder} /></div>
        <div className="w-full sm:w-44 shrink-0">
          <Select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
            <option value="">{tx.filterAll}</option>
            <option value="assigned">{tx.filterAssigned}</option>
            <option value="returned">{tx.filterReturned}</option>
          </Select>
        </div>
      </div>

      <div className="bg-white border border-slate-200 rounded-xl overflow-x-auto shadow-sm">
        <table className="w-full text-sm">
          <thead><tr className="bg-slate-900 border-b border-slate-200 text-slate-300">
            <th className="text-start font-semibold px-4 py-3">{tx.colEmployee}</th>
            <th className="text-start font-semibold px-4 py-3">{tx.colItem}</th>
            <th className="text-start font-semibold px-4 py-3">{tx.colType}</th>
            <th className="text-start font-semibold px-4 py-3">{tx.colSerial}</th>
            <th className="text-start font-semibold px-4 py-3">{tx.colCondition}</th>
            <th className="text-start font-semibold px-4 py-3">{tx.colStatus}</th>
            <th className="text-end font-semibold px-4 py-3">{tx.colActions}</th>
          </tr></thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr><td colSpan={7} className="text-center text-slate-500 py-12">{tx.empty}</td></tr>
            ) : filtered.map((a) => (
              <tr key={a._id} className="border-b border-slate-200/70 hover:bg-slate-100">
                <td className="px-4 py-3 text-slate-900 font-medium">{empName(a.employee, lang)}</td>
                <td className="px-4 py-3 text-slate-700">{a.name}{a.brand ? <span className="text-slate-500"> · {a.brand} {a.model}</span> : ''}</td>
                <td className="px-4 py-3 text-slate-700">{assetTypeLabel(a.type, lang)}</td>
                <td className="px-4 py-3 text-slate-700">{a.serialNumber || '—'}</td>
                <td className="px-4 py-3 text-slate-700">{a.condition ? conditionLabel(a.condition, lang) : '—'}</td>
                <td className="px-4 py-3">{a.status === 'assigned' ? <SmallBadge bg="bg-amber-500/20" text="text-amber-700" label={tx.badgeAssigned} /> : <SmallBadge bg="bg-green-500/20" text="text-green-600" label={`${tx.badgeReturned} ${fmtDate(a.returnedDate)}`} />}</td>
                <td className="px-4 py-3">
                  <div className="flex items-center justify-end gap-1">
                    {a.status === 'assigned' && <button type="button" onClick={() => returnAsset(a)} className="p-1.5 rounded-lg text-slate-500 hover:text-green-600 hover:bg-slate-100" title={tx.actionReturn}><Undo2 className="w-4 h-4" /></button>}
                    <button type="button" onClick={() => openEdit(a)} className="p-1.5 rounded-lg text-slate-500 hover:text-[#f37121] hover:bg-slate-100" title={tx.actionEdit}><Edit className="w-4 h-4" /></button>
                    <button type="button" onClick={() => remove(a)} className="p-1.5 rounded-lg text-slate-500 hover:text-red-600 hover:bg-slate-100" title={tx.actionDelete}><Trash2 className="w-4 h-4" /></button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <Modal open={showModal} onClose={() => setShowModal(false)} title={editing ? tx.editCustody : tx.addCustody}
        footer={<>
          <button type="button" onClick={() => setShowModal(false)} className="px-4 py-2 text-slate-500 hover:text-slate-900 text-sm">{tx.cancel}</button>
          <PrimaryButton onClick={save} disabled={saving || !form.employee || !form.name.trim()}>{saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}{tx.save}</PrimaryButton>
        </>}>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Field label={tx.fieldEmployee} span2><Select value={form.employee} onChange={(e) => set('employee', e.target.value)} disabled={!!editing}><option value="">—</option>{employees.map((e) => <option key={e._id} value={e._id}>{empName(e)} {e.iqamaNumber ? `(${e.iqamaNumber})` : ''}</option>)}</Select></Field>
          <Field label={tx.fieldItemName}><TextInput value={form.name} onChange={(e) => set('name', e.target.value)} placeholder={tx.itemNamePlaceholder} /></Field>
          <Field label={tx.fieldType}><Select value={form.type} onChange={(e) => set('type', e.target.value)}>{ASSET_TYPES.map((t) => <option key={t.key} value={t.key}>{ar ? t.ar : t.en}</option>)}</Select></Field>
          <Field label={tx.fieldSerial}><TextInput value={form.serialNumber} onChange={(e) => set('serialNumber', e.target.value)} /></Field>
          <Field label={tx.fieldBrand}><TextInput value={form.brand} onChange={(e) => set('brand', e.target.value)} /></Field>
          <Field label={tx.fieldModel}><TextInput value={form.model} onChange={(e) => set('model', e.target.value)} /></Field>
          <Field label={tx.fieldCondition}><Select value={form.condition} onChange={(e) => set('condition', e.target.value)}>{ASSET_CONDITIONS.map((c) => <option key={c.key} value={c.key}>{ar ? c.ar : c.en}</option>)}</Select></Field>
          <Field label={tx.fieldValue}><TextInput type="number" value={form.value} onChange={(e) => set('value', Number(e.target.value))} /></Field>
          <Field label={tx.fieldAssignedDate}><TextInput type="date" value={form.assignedDate || ''} onChange={(e) => set('assignedDate', e.target.value)} /></Field>
          <Field label={tx.fieldNotes} span2><TextArea rows={2} value={form.notes} onChange={(e) => set('notes', e.target.value)} /></Field>
        </div>
      </Modal>
    </div>
  );
}
