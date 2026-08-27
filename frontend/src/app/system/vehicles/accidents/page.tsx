'use client';
import { useState, useEffect, useCallback } from 'react';
import { useDialog } from '@/components/system/DialogProvider';
import { useRouter, useSearchParams } from 'next/navigation';
import { useAuth } from '@/context/AuthContext';
import { useLanguage } from '@/context/LanguageContext';
import { useSocket } from '@/hooks/useSocket';
import api from '@/lib/api';
import { AlertTriangle, Edit, Trash2, Check } from 'lucide-react';
import {
  VehicleAccident, ACCIDENT_SEVERITY, ACCIDENT_STATUS, FAULT_PARTY, isVehicleStaff, isVehicleAdmin,
  faultPartyLabel, empRefName, plateOf, getVehiclesText, fmtDate, today,
} from '@/lib/vehicles';
import {
  Spinner, PageHeader, SearchInput, Badge, Modal, Field, TextInput, TextArea, Select, PrimaryButton, Loader2,
} from '@/components/hr/HRKit';
import ExportMenu, { exportScopeLabels, type ExportColumn } from '@/components/ls2/ExportMenu';

export default function VehicleAccidentsPage() {
  const { confirm, notify } = useDialog();
  const { user } = useAuth();
  const { lang, isRTL } = useLanguage();
  const ar = lang === 'ar';
  const tx = getVehiclesText(lang);
  const router = useRouter();
  const staff = isVehicleStaff(user);

  // Dashboard KPI cards deep-link here with ?status= — honour it.
  const sp = useSearchParams();
  const [accidents, setAccidents] = useState<VehicleAccident[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState(sp?.get('status') || '');
  const [editing, setEditing] = useState<VehicleAccident | null>(null);
  const [form, setForm] = useState<any>(null);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    try {
      const qs = new URLSearchParams();
      if (search.trim()) qs.set('q', search.trim());
      if (statusFilter) qs.set('status', statusFilter);
      const d = await api.get<{ accidents: VehicleAccident[] }>(`/api/vehicles/accidents?${qs}`);
      setAccidents(d.accidents || []);
    } catch {}
    setLoading(false);
  }, [search, statusFilter]);

  useEffect(() => { load(); }, [load]);
  useSocket('vehicle:accident', useCallback(() => load(), [load]));

  const openEdit = (a: VehicleAccident) => {
    setEditing(a);
    setForm({
      date: a.date || today(), location: a.location || '', description: a.description || '',
      faultParty: a.faultParty || 'unknown', severity: a.severity || 'minor', status: a.status || 'reported',
      thirdPartyDetails: a.thirdPartyDetails || '', actionTaken: a.actionTaken || '', reportNumber: a.reportNumber || '',
      estimatedCost: a.estimatedCost || '', actualCost: a.actualCost || '', resolution: a.resolution || '', notes: a.notes || '',
    });
  };
  const set = (k: string, v: any) => setForm((f: any) => ({ ...f, [k]: v }));

  const save = async () => {
    if (!editing || !form.description?.trim()) return;
    setSaving(true);
    try {
      await api.put(`/api/vehicles/accidents/${editing._id}`, { ...form, estimatedCost: Number(form.estimatedCost) || 0, actualCost: Number(form.actualCost) || 0 });
      setEditing(null); setForm(null); load();
    } catch (e: any) { notify(e.message, 'error'); }
    setSaving(false);
  };

  const remove = async (a: VehicleAccident) => {
    if (!(await confirm(tx.deleteConfirm))) return;
    try { await api.delete(`/api/vehicles/accidents/${a._id}`); load(); } catch (e: any) { notify(e.message, 'error'); }
  };

  const exportColumns: ExportColumn[] = [
    { header: tx.date, key: 'date', width: 14 },
    { header: tx.plateNumber, key: 'vehicle', transform: (v: any) => plateOf(v), width: 14 },
    { header: tx.employee, key: 'employee', transform: (v: any) => empRefName(v, lang), width: 22 },
    { header: tx.description, key: 'description', width: 36 },
    { header: tx.faultParty, key: 'faultParty', transform: (v: any) => faultPartyLabel(v, lang), width: 14 },
    { header: tx.severity, key: 'severity', transform: (v: any) => (ACCIDENT_SEVERITY[v]?.[ar ? 'ar' : 'en'] || v), width: 12 },
    { header: tx.status, key: 'status', transform: (v: any) => (ACCIDENT_STATUS[v]?.[ar ? 'ar' : 'en'] || v), width: 12 },
    { header: tx.actualCost, key: 'actualCost', width: 12 },
  ];
  // البحث والحالة يُطبَّقان على الخادم، فما في الذاكرة نتائجُ الفلتر لا السجلّ كلّه؛
  // «الكلّ» يلزمه نداءٌ ثانٍ بلا معاملات، وإلّا كان الاسمان لملفٍّ واحد ناقص.
  const hasActiveFilters = !!(search.trim() || statusFilter);
  const fetchAllForExport = async () => {
    const d = await api.get<{ accidents: VehicleAccident[] }>('/api/vehicles/accidents');
    return [{ name: 'Accidents', rows: (d.accidents || []) as unknown as Record<string, any>[], columns: exportColumns }];
  };
  const scope = exportScopeLabels(ar);
  const exportOptions = [
    { key: 'shown', label: scope.shown, sheets: [{ name: 'Accidents', rows: accidents as unknown as Record<string, any>[], columns: exportColumns }] },
    ...(hasActiveFilters ? [{ key: 'all', label: scope.all, resolve: fetchAllForExport }] : []),
  ];

  if (!staff) return <div className="text-slate-500 p-8">{tx.notAuthorized}</div>;
  if (loading) return <Spinner />;

  return (
    <div className="space-y-6" dir={isRTL ? 'rtl' : 'ltr'}>
      <PageHeader icon={<AlertTriangle className="w-5 h-5" />} title={tx.accidentsTitle} subtitle={`${accidents.length} ${tx.accidentsUnit}`}>
        <ExportMenu fileName="accidents" lang={ar ? 'ar' : 'en'} variant="subtle" label={tx.exportExcel} options={exportOptions} />
      </PageHeader>

      <div className="flex flex-col sm:flex-row gap-3">
        <div className="flex-1 min-w-[240px]"><SearchInput value={search} onChange={setSearch} placeholder={tx.search} /></div>
        {/* Fixed, shrink-0 box — a bare `w-full` Select would eat the row. */}
        <div className="w-full sm:w-48 shrink-0">
          <Select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
            <option value="">{tx.allAccidentStatuses}</option>
            {Object.entries(ACCIDENT_STATUS).map(([k, v]) => <option key={k} value={k}>{ar ? v.ar : v.en}</option>)}
          </Select>
        </div>
      </div>

      <div className="bg-white border border-slate-200 rounded-xl overflow-x-auto shadow-sm">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-slate-900 border-b border-slate-200 text-slate-300">
              <th className="text-start font-semibold px-4 py-3">{tx.date}</th>
              <th className="text-start font-semibold px-4 py-3">{tx.plateNumber}</th>
              <th className="text-start font-semibold px-4 py-3">{tx.employee}</th>
              <th className="text-start font-semibold px-4 py-3">{tx.description}</th>
              <th className="text-start font-semibold px-4 py-3">{tx.faultParty}</th>
              <th className="text-start font-semibold px-4 py-3">{tx.severity}</th>
              <th className="text-start font-semibold px-4 py-3">{tx.status}</th>
              <th className="text-end font-semibold px-4 py-3">{tx.actions}</th>
            </tr>
          </thead>
          <tbody>
            {accidents.length === 0 ? (
              <tr><td colSpan={8} className="text-center text-slate-800 py-12">{tx.noAccidents}</td></tr>
            ) : accidents.map((a) => (
              <tr key={a._id} className="border-b border-slate-200/70 hover:bg-slate-100">
                <td className="px-4 py-3 text-slate-700">{fmtDate(a.date)}</td>
                <td className="px-4 py-3 text-slate-900 font-bold cursor-pointer hover:text-[#f37121]" onClick={() => router.push(`/system/vehicles/${typeof a.vehicle === 'object' ? (a.vehicle as any)?._id : a.vehicle}`)}>{plateOf(a.vehicle)}</td>
                <td className="px-4 py-3 text-slate-700">{empRefName(a.employee, lang)}</td>
                <td className="px-4 py-3 text-slate-700 max-w-xs truncate" title={a.description}>{a.description}</td>
                <td className="px-4 py-3 text-slate-700">{faultPartyLabel(a.faultParty, lang)}</td>
                <td className="px-4 py-3"><Badge style={ACCIDENT_SEVERITY[a.severity || 'minor']} lang={lang} /></td>
                <td className="px-4 py-3"><Badge style={ACCIDENT_STATUS[a.status || 'reported']} lang={lang} /></td>
                <td className="px-4 py-3">
                  <div className="flex items-center justify-end gap-1">
                    <button type="button" onClick={() => openEdit(a)} className="p-1.5 rounded-lg text-slate-700 hover:text-[#f37121] hover:bg-slate-100" title={tx.edit}><Edit className="w-4 h-4" /></button>
                    {isVehicleAdmin(user) && (
                      <button type="button" onClick={() => remove(a)} className="p-1.5 rounded-lg text-slate-700 hover:text-red-600 hover:bg-slate-100" title={tx.delete}><Trash2 className="w-4 h-4" /></button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <Modal open={!!editing} onClose={() => { setEditing(null); setForm(null); }} wide
        title={tx.editAccident}
        footer={<>
          <button type="button" onClick={() => { setEditing(null); setForm(null); }} className="px-4 py-2 text-slate-500 hover:text-slate-900 text-sm">{tx.cancel}</button>
          <PrimaryButton onClick={save} disabled={saving || !form?.description?.trim()}>{saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}{tx.save}</PrimaryButton>
        </>}>
        {form && (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Field label={tx.date}><TextInput type="date" value={form.date || ''} onChange={(e) => set('date', e.target.value)} /></Field>
            <Field label={tx.location}><TextInput value={form.location} onChange={(e) => set('location', e.target.value)} /></Field>
            <Field label={tx.faultParty}><Select value={form.faultParty} onChange={(e) => set('faultParty', e.target.value)}>{FAULT_PARTY.map((f) => <option key={f.key} value={f.key}>{ar ? f.ar : f.en}</option>)}</Select></Field>
            <Field label={tx.severity}><Select value={form.severity} onChange={(e) => set('severity', e.target.value)}>{Object.entries(ACCIDENT_SEVERITY).map(([k, v]) => <option key={k} value={k}>{ar ? v.ar : v.en}</option>)}</Select></Field>
            <Field label={tx.status}><Select value={form.status} onChange={(e) => set('status', e.target.value)}>{Object.entries(ACCIDENT_STATUS).map(([k, v]) => <option key={k} value={k}>{ar ? v.ar : v.en}</option>)}</Select></Field>
            <Field label={tx.reportNumber}><TextInput value={form.reportNumber} onChange={(e) => set('reportNumber', e.target.value)} /></Field>
            <Field label={tx.estimatedCost}><TextInput type="number" value={form.estimatedCost} onChange={(e) => set('estimatedCost', e.target.value)} /></Field>
            <Field label={tx.actualCost}><TextInput type="number" value={form.actualCost} onChange={(e) => set('actualCost', e.target.value)} /></Field>
            <Field label={tx.description} span2><TextArea rows={3} value={form.description} onChange={(e) => set('description', e.target.value)} /></Field>
            <Field label={tx.thirdPartyDetails} span2><TextArea rows={2} value={form.thirdPartyDetails} onChange={(e) => set('thirdPartyDetails', e.target.value)} /></Field>
            <Field label={tx.actionTaken} span2><TextArea rows={2} value={form.actionTaken} onChange={(e) => set('actionTaken', e.target.value)} /></Field>
            <Field label={tx.resolution} span2><TextArea rows={2} value={form.resolution} onChange={(e) => set('resolution', e.target.value)} /></Field>
          </div>
        )}
      </Modal>
    </div>
  );
}
