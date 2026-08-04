'use client';
// قائمة سجل المركبات — فلاتر متعددة، بحث، حالة كل مركبة، وتعديل/إضافة/حذف.
import { useState, useEffect, useCallback, useMemo } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { useLanguage } from '@/context/LanguageContext';
import { useAuth } from '@/context/AuthContext';
import { useSocket } from '@/hooks/useSocket';
import api from '@/lib/api';
import { useDialog } from '@/components/system/DialogProvider';
import { Spinner, PageHeader } from '@/components/hr/HRKit';
import { VReg, statusColor, statusLabel, docLabel, DOC_TYPES, fmtDate, money, daysText } from '@/lib/vehicleRegistry';
import { canEditSection } from '@/lib/sections';
import { Car, Plus, Edit, Trash2, BarChart3, BellRing, X, Save, RotateCcw } from 'lucide-react';

const EDIT_ROLES = ['super_admin', 'admin', 'hr_manager', 'hr_specialist', 'finance_manager', 'accountant'];
const ADMIN_ROLES = ['super_admin', 'admin', 'hr_manager'];

export default function VehicleRegistryList() {
  const { lang, isRTL } = useLanguage();
  const ar = lang === 'ar';
  const { user } = useAuth();
  const router = useRouter();
  const sp = useSearchParams();
  const { notify, confirm } = useDialog();
  // A grant of «تعديل» on المركبات has to bring the actions with it — the API
  // already accepts the calls (rbac lets a section grant through), so hiding the
  // buttons only made the section look read-only to people who aren't.
  const grant = canEditSection((user as any)?.permissions, 'Vehicles');
  const canEdit = !!user && (EDIT_ROLES.includes(user.role) || grant);
  const canDelete = !!user && (ADMIN_ROLES.includes(user.role) || grant);

  const [rows, setRows] = useState<VReg[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState(sp.get('q') || '');
  const [editing, setEditing] = useState<VReg | null>(null);
  const [showForm, setShowForm] = useState(false);

  const qs = useMemo(() => {
    const p = new URLSearchParams();
    if (q.trim()) p.set('q', q.trim());
    ['sector', 'registrationType', 'brand', 'owner', 'insuranceCompany', 'coverageType', 'fuelCardStatus', 'inspectionStatus', 'modelYear', 'expiringDoc', 'expiringWithin', 'expiredDoc', 'missingDoc', 'hasGps'].forEach((k) => {
      const v = sp.get(k); if (v) p.set(k, v);
    });
    p.set('limit', '2000');
    return p.toString();
  }, [q, sp]);

  const load = useCallback(async () => {
    try {
      const d = await api.get<{ vehicles: VReg[]; total: number }>(`/api/vehicle-registry?${qs}`);
      setRows(d.vehicles || []); setTotal(d.total || 0);
    } catch (e: any) { notify(e?.message || 'Failed', 'error'); } finally { setLoading(false); }
  }, [qs, notify]);

  useEffect(() => { const t = setTimeout(load, 200); return () => clearTimeout(t); }, [load]);
  useSocket('vreg:updated', useCallback(() => load(), [load]));

  const FILTER_LABELS: Record<string, [string, string]> = {
    missingDoc: ['بدون', 'Missing'], expiringDoc: ['قرب انتهاء', 'Expiring'], expiredDoc: ['منتهي', 'Expired'],
    fuelCardStatus: ['شريحة', 'Fuel card'], hasGps: ['GPS', 'GPS'],
  };
  const activeFilters = ['sector', 'registrationType', 'brand', 'owner', 'insuranceCompany', 'coverageType', 'fuelCardStatus', 'inspectionStatus', 'modelYear', 'expiringDoc', 'expiredDoc', 'missingDoc', 'hasGps']
    .map((k) => ({ k, v: sp.get(k) })).filter((x) => x.v);
  const filterChipText = (k: string, v: string) => {
    if (k === 'expiringDoc' || k === 'expiredDoc' || k === 'missingDoc') return `${ar ? FILTER_LABELS[k][0] : FILTER_LABELS[k][1]}: ${docLabel(v, ar)}`;
    if (k === 'hasGps') return ar ? 'مزوّدة بـ GPS' : 'With GPS';
    return v;
  };

  const del = async (v: VReg) => {
    if (!(await confirm(ar ? `حذف المركبة ${v.plateNumber}؟` : `Delete ${v.plateNumber}?`))) return;
    try { await api.delete(`/api/vehicle-registry/${v._id}`); notify(ar ? 'تم الحذف' : 'Deleted', 'success'); load(); }
    catch (e: any) { notify(e?.message || 'Failed', 'error'); }
  };

  if (loading && !rows.length) return <Spinner />;

  return (
    <div className="space-y-4 w-full pb-10" dir={isRTL ? 'rtl' : 'ltr'}>
      <PageHeader icon={<Car className="w-5 h-5" />} title={ar ? 'سجل المركبات' : 'Vehicle Registry'} subtitle={ar ? `${total} مركبة` : `${total} vehicles`}>
        <div className="flex items-center gap-2">
          <Link href="/system/vehicles/registry/dashboard" className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 text-sm"><BarChart3 className="w-4 h-4" /> {ar ? 'التحليلات' : 'Analytics'}</Link>
          <Link href="/system/vehicles/registry/alerts" className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-red-600 hover:bg-red-700 text-white text-sm"><BellRing className="w-4 h-4" /> {ar ? 'التنبيهات' : 'Alerts'}</Link>
          {canEdit && <button onClick={() => { setEditing(null); setShowForm(true); }} className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-[#f37121] hover:bg-[#e5651a] text-white text-sm"><Plus className="w-4 h-4" /> {ar ? 'إضافة' : 'Add'}</button>}
        </div>
      </PageHeader>

      <div className="flex flex-wrap items-center gap-2">
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={ar ? 'ابحث بلوحة/هيكل/مالك/بوليصة…' : 'plate / chassis / owner…'} className="px-3 py-2 rounded-lg border border-slate-200 text-sm w-72 max-w-full" />
        {activeFilters.map((f) => (
          <span key={f.k} className="flex items-center gap-1 px-2.5 py-1.5 rounded-full bg-[#12325c]/10 text-[#12325c] text-xs">
            {filterChipText(f.k, f.v!)}
            <button onClick={() => { const p = new URLSearchParams(sp.toString()); p.delete(f.k); router.push(`/system/vehicles/registry?${p.toString()}`); }}><X className="w-3 h-3" /></button>
          </span>
        ))}
        {activeFilters.length > 0 && <button onClick={() => router.push('/system/vehicles/registry')} className="flex items-center gap-1 text-xs text-slate-500"><RotateCcw className="w-3 h-3" /> {ar ? 'مسح الفلاتر' : 'Clear'}</button>}
      </div>

      <div className="rounded-2xl border border-slate-200 bg-white shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-900 text-slate-300 text-xs">
              <tr>{[ar ? 'اللوحة' : 'Plate', ar ? 'القطاع' : 'Sector', ar ? 'النوع' : 'Type', ar ? 'الماركة' : 'Brand', ar ? 'السنة' : 'Year', ar ? 'المالك' : 'Owner', ar ? 'التأمين' : 'Insurance', ar ? 'الحالة' : 'Status', ''].map((h) => <th key={h} className="px-3 py-2.5 text-start font-semibold whitespace-nowrap">{h}</th>)}</tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {rows.map((v) => (
                <tr key={v._id} className="hover:bg-slate-50">
                  <td className="px-3 py-2"><Link href={`/system/vehicles/registry/${v._id}`} className="text-[#f37121] hover:underline font-mono font-semibold">{v.plateNumber}</Link></td>
                  <td className="px-3 py-2 text-slate-600 whitespace-nowrap">{v.sectorAr || '—'}</td>
                  <td className="px-3 py-2 text-slate-600 whitespace-nowrap">{v.registrationTypeAr || '—'}</td>
                  <td className="px-3 py-2 text-slate-600 whitespace-nowrap">{v.brandAr || '—'} {v.modelAr}</td>
                  <td className="px-3 py-2 text-slate-500">{v.modelYear || '—'}</td>
                  <td className="px-3 py-2 text-slate-500 max-w-[160px] truncate" title={v.ownerNameAr}>{v.ownerNameAr || '—'}</td>
                  <td className="px-3 py-2 whitespace-nowrap text-xs">{v.insurance?.expiryDate ? <span style={{ color: statusColor(v.docStatuses?.insurance?.status || 'none') }}>{fmtDate(v.insurance.expiryDate)}</span> : <span className="text-slate-400">—</span>}</td>
                  <td className="px-3 py-2"><span className="px-2 py-0.5 rounded-full text-xs font-semibold" style={{ background: `${statusColor(v.overallStatus || 'valid')}1a`, color: statusColor(v.overallStatus || 'valid') }}>{statusLabel(v.overallStatus || 'valid', ar)}{v.overallDays != null && v.overallStatus !== 'valid' ? ` · ${daysText(v.overallDays, ar)}` : ''}</span></td>
                  <td className="px-3 py-2">
                    <div className="flex items-center gap-1">
                      {canEdit && <button onClick={() => { setEditing(v); setShowForm(true); }} className="p-1.5 rounded hover:bg-slate-100 text-slate-500"><Edit className="w-3.5 h-3.5" /></button>}
                      {canDelete && <button onClick={() => del(v)} className="p-1.5 rounded hover:bg-red-50 text-red-500"><Trash2 className="w-3.5 h-3.5" /></button>}
                    </div>
                  </td>
                </tr>
              ))}
              {rows.length === 0 && <tr><td colSpan={9} className="px-3 py-10 text-center text-slate-400">{ar ? 'لا توجد مركبات مطابقة' : 'No matching vehicles'}</td></tr>}
            </tbody>
          </table>
        </div>
      </div>

      {showForm && <VehicleForm vehicle={editing} onClose={() => setShowForm(false)} onSaved={() => { setShowForm(false); load(); }} />}
    </div>
  );
}

function VehicleForm({ vehicle, onClose, onSaved }: { vehicle: VReg | null; onClose: () => void; onSaved: () => void }) {
  const { lang } = useLanguage();
  const ar = lang === 'ar';
  const { notify } = useDialog();
  const [f, setF] = useState<any>(vehicle || { plateNumber: '', sectorAr: '', registrationTypeAr: '', brandAr: '', modelAr: '', modelYear: '', colorAr: '', ownerNameAr: '', chassisNumber: '', insurance: {}, operatingCard: {}, vehicleLicense: {}, inspection: {}, fuelCard: {} });
  const [saving, setSaving] = useState(false);
  const set = (k: string, v: any) => setF((p: any) => ({ ...p, [k]: v }));
  const setSub = (o: string, k: string, v: any) => setF((p: any) => ({ ...p, [o]: { ...(p[o] || {}), [k]: v } }));

  const save = async () => {
    if (!f.plateNumber?.trim()) { notify(ar ? 'رقم اللوحة مطلوب' : 'Plate required', 'error'); return; }
    setSaving(true);
    try {
      if (vehicle) await api.put(`/api/vehicle-registry/${vehicle._id}`, f);
      else await api.post('/api/vehicle-registry', f);
      notify(ar ? 'تم الحفظ' : 'Saved', 'success'); onSaved();
    } catch (e: any) { notify(e?.message || 'Failed', 'error'); } finally { setSaving(false); }
  };

  const inp = 'w-full px-3 py-2 rounded-lg border border-slate-200 text-sm';
  const L = ({ children }: { children: React.ReactNode }) => <label className="block text-xs font-semibold text-slate-600 mb-1">{children}</label>;

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto p-5" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-bold text-lg">{vehicle ? (ar ? 'تعديل مركبة' : 'Edit vehicle') : (ar ? 'إضافة مركبة' : 'Add vehicle')}</h3>
          <button onClick={onClose}><X className="w-5 h-5 text-slate-400" /></button>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div><L>{ar ? 'رقم اللوحة *' : 'Plate *'}</L><input className={inp} value={f.plateNumber} onChange={(e) => set('plateNumber', e.target.value)} /></div>
          <div><L>{ar ? 'رقم الهيكل' : 'Chassis'}</L><input className={inp} value={f.chassisNumber || ''} onChange={(e) => set('chassisNumber', e.target.value)} /></div>
          <div><L>{ar ? 'القطاع' : 'Sector'}</L><input className={inp} value={f.sectorAr || ''} onChange={(e) => set('sectorAr', e.target.value)} /></div>
          <div><L>{ar ? 'نوع التسجيل' : 'Registration type'}</L><input className={inp} value={f.registrationTypeAr || ''} onChange={(e) => set('registrationTypeAr', e.target.value)} /></div>
          <div><L>{ar ? 'الماركة' : 'Brand'}</L><input className={inp} value={f.brandAr || ''} onChange={(e) => set('brandAr', e.target.value)} /></div>
          <div><L>{ar ? 'الطراز' : 'Model'}</L><input className={inp} value={f.modelAr || ''} onChange={(e) => set('modelAr', e.target.value)} /></div>
          <div><L>{ar ? 'سنة الصنع' : 'Year'}</L><input type="number" className={inp} value={f.modelYear || ''} onChange={(e) => set('modelYear', e.target.value ? Number(e.target.value) : null)} /></div>
          <div><L>{ar ? 'اللون' : 'Color'}</L><input className={inp} value={f.colorAr || ''} onChange={(e) => set('colorAr', e.target.value)} /></div>
          <div className="md:col-span-2"><L>{ar ? 'المالك' : 'Owner'}</L><input className={inp} value={f.ownerNameAr || ''} onChange={(e) => set('ownerNameAr', e.target.value)} /></div>
          <div><L>{ar ? 'تاريخ انتهاء التأمين' : 'Insurance expiry'}</L><input type="date" className={inp} value={(f.insurance?.expiryDate || '').slice(0, 10)} onChange={(e) => setSub('insurance', 'expiryDate', e.target.value || null)} /></div>
          <div><L>{ar ? 'قسط التأمين' : 'Premium'}</L><input type="number" className={inp} value={f.insurance?.premiumSar || ''} onChange={(e) => setSub('insurance', 'premiumSar', e.target.value ? Number(e.target.value) : null)} /></div>
          <div><L>{ar ? 'انتهاء بطاقة التشغيل' : 'Operating card expiry'}</L><input type="date" className={inp} value={(f.operatingCard?.expiryDate || '').slice(0, 10)} onChange={(e) => setSub('operatingCard', 'expiryDate', e.target.value || null)} /></div>
          <div><L>{ar ? 'انتهاء رخصة السير' : 'License expiry'}</L><input type="date" className={inp} value={(f.vehicleLicense?.expiryDate || '').slice(0, 10)} onChange={(e) => setSub('vehicleLicense', 'expiryDate', e.target.value || null)} /></div>
          <div><L>{ar ? 'انتهاء الفحص' : 'Inspection expiry'}</L><input type="date" className={inp} value={(f.inspection?.expiryDate || '').slice(0, 10)} onChange={(e) => setSub('inspection', 'expiryDate', e.target.value || null)} /></div>
          <div className="md:col-span-2"><L>{ar ? 'ملاحظات' : 'Notes'}</L><textarea className={inp} rows={2} value={f.notesAr || ''} onChange={(e) => set('notesAr', e.target.value)} /></div>
        </div>
        <div className="flex justify-end gap-2 mt-5">
          <button onClick={onClose} className="px-4 py-2 rounded-lg bg-slate-100 text-slate-600 text-sm">{ar ? 'إلغاء' : 'Cancel'}</button>
          <button onClick={save} disabled={saving} className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-[#f37121] text-white text-sm disabled:opacity-60"><Save className="w-4 h-4" /> {ar ? 'حفظ' : 'Save'}</button>
        </div>
      </div>
    </div>
  );
}
