'use client';
import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/context/AuthContext';
import { useLanguage } from '@/context/LanguageContext';
import { useSocket } from '@/hooks/useSocket';
import api from '@/lib/api';
import { Truck, Plus, Edit, Trash2, Check } from 'lucide-react';
import {
  Vehicle, VEHICLE_TYPES, VEHICLE_STATUS, isVehicleStaff, isVehicleAdmin,
  vehicleTypeLabel, empRefName, getVehiclesText, fmtDate, exportToExcel, today,
} from '@/lib/vehicles';
import {
  Spinner, PageHeader, SearchInput, ExportButton, PrimaryButton, Badge, Modal, Field,
  TextInput, Select, TextArea, Loader2,
} from '@/components/hr/HRKit';

const EMPTY = {
  plateNumber: '', type: 'car', make: '', model: '', year: '', color: '',
  branch: '', department: '', project: '', registrationExpiry: '', insuranceExpiry: '', status: 'available', notes: '',
};

export default function VehiclesPage() {
  const { user } = useAuth();
  const { lang, isRTL } = useLanguage();
  const ar = lang === 'ar';
  const tx = getVehiclesText(lang);
  const router = useRouter();
  const staff = isVehicleStaff(user?.role);

  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [showModal, setShowModal] = useState(false);
  const [editing, setEditing] = useState<Vehicle | null>(null);
  const [form, setForm] = useState<any>(EMPTY);
  const [saving, setSaving] = useState(false);
  const [branches, setBranches] = useState<any[]>([]);

  const load = useCallback(async () => {
    try {
      const qs = new URLSearchParams();
      if (search.trim()) qs.set('q', search.trim());
      if (typeFilter) qs.set('type', typeFilter);
      if (statusFilter) qs.set('status', statusFilter);
      const d = await api.get<{ vehicles: Vehicle[] }>(`/api/vehicles?${qs}`);
      setVehicles(d.vehicles || []);
    } catch {}
    setLoading(false);
  }, [search, typeFilter, statusFilter]);

  useEffect(() => { load(); }, [load]);
  useSocket('vehicle:updated', useCallback(() => load(), [load]));
  useSocket('vehicle:authorization', useCallback(() => load(), [load]));

  useEffect(() => {
    api.get<{ branches: any[] }>('/api/branches').then((d) => setBranches(d.branches || [])).catch(() => {});
  }, []);

  const openCreate = () => { setEditing(null); setForm(EMPTY); setShowModal(true); };
  const openEdit = (v: Vehicle) => {
    setEditing(v);
    setForm({ ...EMPTY, ...v, year: v.year || '', branch: (typeof v.branch === 'object' ? v.branch?._id : v.branch) || '' });
    setShowModal(true);
  };
  const set = (k: string, val: any) => setForm((f: any) => ({ ...f, [k]: val }));

  const save = async () => {
    if (!form.plateNumber.trim()) return;
    setSaving(true);
    try {
      const body = { ...form, year: form.year ? Number(form.year) : undefined };
      if (editing) await api.put(`/api/vehicles/${editing._id}`, body);
      else await api.post('/api/vehicles', body);
      setShowModal(false);
      load();
    } catch (e: any) { alert(e.message); }
    setSaving(false);
  };

  const remove = async (v: Vehicle) => {
    if (!confirm(`${tx.delete} ${v.plateNumber}؟`)) return;
    try { await api.delete(`/api/vehicles/${v._id}`); load(); } catch (e: any) { alert(e.message); }
  };

  if (!staff) return <div className="text-slate-500 p-8">{tx.notAuthorized}</div>;
  if (loading) return <Spinner />;

  return (
    <div className="space-y-6" dir={isRTL ? 'rtl' : 'ltr'}>
      <PageHeader icon={<Truck className="w-5 h-5" />} title={tx.fleetTitle} subtitle={`${vehicles.length} ${tx.vehiclesUnit}`}>
        <ExportButton label={tx.exportExcel} onClick={() => exportToExcel(vehicles, [
          { header: tx.plateNumber, key: 'plateNumber', width: 16 },
          { header: tx.type, key: 'type', transform: (v: any) => vehicleTypeLabel(v, lang), width: 14 },
          { header: tx.make, key: 'make', width: 14 },
          { header: tx.model, key: 'model', width: 14 },
          { header: tx.status, key: 'status', transform: (v: any) => (VEHICLE_STATUS[v]?.[ar ? 'ar' : 'en'] || v), width: 14 },
          { header: tx.authorizedTo, key: 'currentEmployee', transform: (_: any, r: any) => empRefName(r.currentEmployee, lang), width: 22 },
          { header: tx.department, key: 'department', width: 16 },
          { header: tx.project, key: 'project', width: 16 },
        ], `vehicles-${today()}`, 'Vehicles')} />
        <PrimaryButton onClick={openCreate}><Plus className="w-4 h-4" /> {tx.addVehicle}</PrimaryButton>
      </PageHeader>

      <div className="flex flex-col sm:flex-row gap-3">
        <div className="flex-1 min-w-[240px]"><SearchInput value={search} onChange={setSearch} placeholder={tx.search} /></div>
        {/* Fixed, shrink-0 boxes — a bare `w-full` Select would eat the row. */}
        <div className="w-full sm:w-44 shrink-0">
          <Select value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)}>
            <option value="">{tx.allTypes}</option>
            {VEHICLE_TYPES.map((t) => <option key={t.key} value={t.key}>{ar ? t.ar : t.en}</option>)}
          </Select>
        </div>
        <div className="w-full sm:w-44 shrink-0">
          <Select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
            <option value="">{tx.allStatuses}</option>
            {Object.entries(VEHICLE_STATUS).map(([k, v]) => <option key={k} value={k}>{ar ? v.ar : v.en}</option>)}
          </Select>
        </div>
      </div>

      <div className="bg-white border border-slate-200 rounded-xl overflow-x-auto shadow-sm">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-slate-900 border-b border-slate-200 text-slate-300">
              <th className="text-start font-semibold px-4 py-3">{tx.plateNumber}</th>
              <th className="text-start font-semibold px-4 py-3">{tx.type}</th>
              <th className="text-start font-semibold px-4 py-3">{tx.make}/{tx.model}</th>
              <th className="text-start font-semibold px-4 py-3">{tx.authorizedTo}</th>
              <th className="text-start font-semibold px-4 py-3">{tx.department}</th>
              <th className="text-start font-semibold px-4 py-3">{tx.status}</th>
              <th className="text-end font-semibold px-4 py-3">{tx.actions}</th>
            </tr>
          </thead>
          <tbody>
            {vehicles.length === 0 ? (
              <tr><td colSpan={7} className="text-center text-slate-800 py-12">{tx.noVehicles}</td></tr>
            ) : vehicles.map((v) => (
              <tr key={v._id} className="border-b border-slate-200/70 hover:bg-slate-100 transition-colors cursor-pointer" onClick={() => router.push(`/system/vehicles/${v._id}`)}>
                <td className="px-4 py-3 text-slate-900 font-bold">{v.plateNumber}</td>
                <td className="px-4 py-3 text-slate-700">{vehicleTypeLabel(v.type, lang)}</td>
                <td className="px-4 py-3 text-slate-700">{[v.make, v.model].filter(Boolean).join(' ') || '—'}</td>
                <td className="px-4 py-3 text-slate-700">
                  {v.currentEmployee
                    ? <span className="text-slate-900 font-medium">{empRefName(v.currentEmployee, lang)}</span>
                    : <span className="text-slate-700">{tx.notAuthorizedYet}</span>}
                </td>
                <td className="px-4 py-3 text-slate-700">{v.department || '—'}</td>
                <td className="px-4 py-3"><Badge style={VEHICLE_STATUS[v.status]} lang={lang} /></td>
                <td className="px-4 py-3" onClick={(ev) => ev.stopPropagation()}>
                  <div className="flex items-center justify-end gap-1">
                    <button type="button" onClick={() => openEdit(v)} className="p-1.5 rounded-lg text-slate-700 hover:text-[#f37121] hover:bg-slate-100" title={tx.edit}><Edit className="w-4 h-4" /></button>
                    {isVehicleAdmin(user?.role) && (
                      <button type="button" onClick={() => remove(v)} className="p-1.5 rounded-lg text-slate-700 hover:text-red-600 hover:bg-slate-100" title={tx.delete}><Trash2 className="w-4 h-4" /></button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <Modal open={showModal} onClose={() => setShowModal(false)} wide
        title={editing ? tx.editVehicle : tx.addVehicle}
        footer={<>
          <button type="button" onClick={() => setShowModal(false)} className="px-4 py-2 text-slate-500 hover:text-slate-900 text-sm">{tx.cancel}</button>
          <PrimaryButton onClick={save} disabled={saving || !form.plateNumber.trim()}>{saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}{tx.save}</PrimaryButton>
        </>}>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Field label={tx.plateNumber}><TextInput value={form.plateNumber} onChange={(e) => set('plateNumber', e.target.value)} /></Field>
          <Field label={tx.type}><Select value={form.type} onChange={(e) => set('type', e.target.value)}>{VEHICLE_TYPES.map((t) => <option key={t.key} value={t.key}>{ar ? t.ar : t.en}</option>)}</Select></Field>
          <Field label={tx.make}><TextInput value={form.make} onChange={(e) => set('make', e.target.value)} /></Field>
          <Field label={tx.model}><TextInput value={form.model} onChange={(e) => set('model', e.target.value)} /></Field>
          <Field label={tx.year}><TextInput type="number" value={form.year} onChange={(e) => set('year', e.target.value)} /></Field>
          <Field label={tx.color}><TextInput value={form.color} onChange={(e) => set('color', e.target.value)} /></Field>
          <Field label={tx.branch}><Select value={form.branch} onChange={(e) => set('branch', e.target.value)}><option value="">—</option>{branches.map((b) => <option key={b._id} value={b._id}>{b.name}</option>)}</Select></Field>
          <Field label={tx.department}><TextInput value={form.department} onChange={(e) => set('department', e.target.value)} /></Field>
          <Field label={tx.project}><TextInput value={form.project} onChange={(e) => set('project', e.target.value)} /></Field>
          <Field label={tx.status}><Select value={form.status} onChange={(e) => set('status', e.target.value)}>{Object.entries(VEHICLE_STATUS).map(([k, v]) => <option key={k} value={k}>{ar ? v.ar : v.en}</option>)}</Select></Field>
          <Field label={tx.registrationExpiry}><TextInput type="date" value={form.registrationExpiry || ''} onChange={(e) => set('registrationExpiry', e.target.value)} /></Field>
          <Field label={tx.insuranceExpiry}><TextInput type="date" value={form.insuranceExpiry || ''} onChange={(e) => set('insuranceExpiry', e.target.value)} /></Field>
          <Field label={tx.notes} span2><TextArea rows={2} value={form.notes} onChange={(e) => set('notes', e.target.value)} /></Field>
        </div>
        {editing && fmtDate(editing.createdAt) !== '—' && <p className="text-xs text-slate-500 mt-2">{fmtDate(editing.createdAt)}</p>}
      </Modal>
    </div>
  );
}
