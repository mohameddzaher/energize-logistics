'use client';
// Maintenance — periodic-service tracking driven by the live odometer. Every
// vehicle shows how far it is from its next service (interval − distance since the
// last one); the admin tier can record a completed service (which resets the
// baseline and clears the open service alerts).
import { useState, useEffect, useCallback, useMemo } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useAuth } from '@/context/AuthContext';
import { useLanguage } from '@/context/LanguageContext';
import { useSocket } from '@/hooks/useSocket';
import api from '@/lib/api';
import { Wrench, RefreshCw, CheckCircle2 } from 'lucide-react';
import { Spinner, PageHeader, Modal, Field, TextInput, TextArea, Select, PrimaryButton } from '@/components/hr/HRKit';
import { ls2Text, isLs2Staff, isLs2Admin, maintStyle, fmtNum, fmtKm, type Lang, type Vehicle } from '@/lib/ls2';

const FILTERS = ['all', 'due', 'overdue'];

export default function Ls2MaintenancePage() {
  const { user } = useAuth();
  const { lang, isRTL } = useLanguage();
  const router = useRouter();
  const params = useSearchParams();
  const t = ls2Text(lang as Lang);
  const admin = isLs2Admin(user?.role);
  const [items, setItems] = useState<Vehicle[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState(params.get('filter') || 'all');
  const [svc, setSvc] = useState<Vehicle | null>(null);
  const [form, setForm] = useState({ serviceType: 'periodic', odometerKm: '', notes: '' });
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    try { const res = await api.get<{ items: Vehicle[] }>('/api/ls2/vehicles'); setItems(res.items || []); } catch { /* keep */ }
    setLoading(false);
  }, []);
  useEffect(() => { load(); }, [load]);
  useSocket('ls2:updated', useCallback(() => load(), [load]));

  const rows = useMemo(() => {
    let r = items.filter((v) => v.maintenance);
    if (filter === 'due') r = r.filter((v) => v.maintenance!.statusLevel === 'due');
    else if (filter === 'overdue') r = r.filter((v) => v.maintenance!.statusLevel === 'overdue');
    return r.sort((a, b) => (a.maintenance!.kmToService) - (b.maintenance!.kmToService));
  }, [items, filter]);

  const openService = (v: Vehicle) => { setSvc(v); setForm({ serviceType: 'periodic', odometerKm: String(v.odometerKm ?? ''), notes: '' }); };
  const submitService = async () => {
    if (!svc) return;
    setSaving(true);
    try {
      await api.post(`/api/ls2/vehicles/${svc.unitId}/service`, { serviceType: form.serviceType, odometerKm: form.odometerKm ? Number(form.odometerKm) : undefined, notes: form.notes });
      setSvc(null);
      await load();
    } catch { /* ignore */ }
    setSaving(false);
  };

  if (!isLs2Staff(user?.role)) return <div className="text-slate-500 p-8">{t.notAuthorized}</div>;
  if (loading && !items.length) return <Spinner />;

  const counts = { due: items.filter((v) => v.maintenance?.statusLevel === 'due').length, overdue: items.filter((v) => v.maintenance?.statusLevel === 'overdue').length };

  return (
    <div className="space-y-5" dir={isRTL ? 'rtl' : 'ltr'}>
      <PageHeader icon={<Wrench className="w-5 h-5" />} title={t.maintenance} subtitle={`${counts.overdue} ${t.serviceOverdue} · ${counts.due} ${t.serviceDue}`}>
        <button type="button" onClick={() => load()} className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 text-sm"><RefreshCw className="w-4 h-4" /> {t.refresh}</button>
      </PageHeader>

      <div className="flex flex-wrap gap-2">
        {FILTERS.map((f) => (
          <button key={f} type="button" onClick={() => setFilter(f)} className={`px-3 py-1.5 rounded-full text-xs font-medium border ${filter === f ? 'bg-[#f37121] text-white border-[#f37121]' : 'bg-white text-slate-600 border-slate-200'}`}>
            {f === 'all' ? t.all : f === 'due' ? t.serviceDue : t.serviceOverdue}
          </button>
        ))}
      </div>

      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-slate-900 text-slate-300 text-xs">
                <th className="text-start font-semibold px-4 py-3">{t.plate}</th>
                <th className="text-start font-semibold px-4 py-3">{t.driver}</th>
                <th className="text-end font-semibold px-4 py-3">{t.odometer}</th>
                <th className="text-end font-semibold px-4 py-3">{t.nextService}</th>
                <th className="text-end font-semibold px-4 py-3">{t.kmToService}</th>
                <th className="text-center font-semibold px-4 py-3">{t.status}</th>
                {admin && <th className="text-center font-semibold px-4 py-3" />}
              </tr>
            </thead>
            <tbody>
              {rows.map((v) => {
                const m = v.maintenance!;
                const ms = maintStyle(m.statusLevel);
                return (
                  <tr key={v.unitId} className="border-b border-slate-100 hover:bg-slate-50">
                    <td className="px-4 py-3 font-medium text-slate-800 whitespace-nowrap cursor-pointer" onClick={() => router.push(`/system/ls2/${v.unitId}`)}>{v.plate || v.name}</td>
                    <td className="px-4 py-3 text-slate-600 whitespace-nowrap">{v.driver || '—'}</td>
                    <td className="px-4 py-3 text-end tabular-nums text-slate-600">{fmtKm(v.odometerKm)}</td>
                    <td className="px-4 py-3 text-end tabular-nums text-slate-600">{fmtKm(m.nextServiceKm)}</td>
                    <td className={`px-4 py-3 text-end tabular-nums font-bold ${m.statusLevel === 'overdue' ? 'text-red-600' : m.statusLevel === 'due' ? 'text-amber-600' : 'text-slate-700'}`}>
                      {m.kmToService <= 0 ? `−${fmtNum(Math.abs(m.kmToService))}` : fmtNum(m.kmToService)}
                    </td>
                    <td className="px-4 py-3 text-center"><span className={`px-2 py-0.5 rounded-full text-xs font-medium ${ms.bg} ${ms.text}`}>{lang === 'ar' ? ms.ar : ms.en}</span></td>
                    {admin && <td className="px-4 py-3 text-center">
                      <button type="button" onClick={() => openService(v)} className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-emerald-50 text-emerald-700 hover:bg-emerald-100 text-xs font-medium"><CheckCircle2 className="w-3.5 h-3.5" /> {t.markServiced}</button>
                    </td>}
                  </tr>
                );
              })}
              {rows.length === 0 && <tr><td colSpan={admin ? 7 : 6} className="text-center text-slate-400 py-10">{t.noData}</td></tr>}
            </tbody>
          </table>
        </div>
      </div>

      <Modal open={!!svc} onClose={() => setSvc(null)} title={svc ? `${t.markServiced} · ${svc.plate}` : ''}
        footer={<><button type="button" onClick={() => setSvc(null)} className="px-4 py-2 rounded-lg text-slate-600 hover:bg-slate-100 text-sm">{t.cancel}</button><PrimaryButton onClick={submitService} disabled={saving}>{t.confirm}</PrimaryButton></>}>
        <div className="space-y-4">
          <Field label={t.serviceType}>
            <Select value={form.serviceType} onChange={(e) => setForm((p) => ({ ...p, serviceType: e.target.value }))}>
              <option value="periodic">{lang === 'ar' ? 'صيانة دورية' : 'Periodic'}</option>
              <option value="repair">{lang === 'ar' ? 'إصلاح' : 'Repair'}</option>
              <option value="tires">{lang === 'ar' ? 'كاوتش' : 'Tires'}</option>
              <option value="other">{lang === 'ar' ? 'أخرى' : 'Other'}</option>
            </Select>
          </Field>
          <Field label={`${t.odometer} (km)`}><TextInput type="number" value={form.odometerKm} onChange={(e) => setForm((p) => ({ ...p, odometerKm: e.target.value }))} /></Field>
          <Field label={t.notes}><TextArea rows={3} value={form.notes} onChange={(e) => setForm((p) => ({ ...p, notes: e.target.value }))} /></Field>
          <p className="text-xs text-slate-400">{lang === 'ar' ? 'تسجيل الصيانة يعيد ضبط عدّاد الصيانة القادمة ويغلق تنبيهات الصيانة الحالية.' : 'Recording a service resets the next-service counter and clears open service alerts.'}</p>
        </div>
      </Modal>
    </div>
  );
}
