'use client';
// Exceptional Repairs — unscheduled work across the fleet: breakdowns, accidents,
// faults. This is OURS alone: Location Solutions only models periodic services,
// so nothing on this page is read from or written to it.
import { useState, useEffect, useCallback, useMemo } from 'react';
import { useAuth } from '@/context/AuthContext';
import { useLanguage } from '@/context/LanguageContext';
import { useSocket } from '@/hooks/useSocket';
import api from '@/lib/api';
import { Hammer, RefreshCw, Plus, Pencil, Trash2 } from 'lucide-react';
import { Spinner, PageHeader } from '@/components/hr/HRKit';
import RepairModal from '@/components/ls2/RepairModal';
import {
  ls2Text, isLs2Staff, isLs2Admin, fmtKm, REPAIR_CATEGORIES, REPAIR_SEVERITIES, REPAIR_STATUSES,
  repairCategoryLabel, type Lang, type Repair, type Vehicle,
} from '@/lib/ls2';

export default function Ls2RepairsPage() {
  const { user } = useAuth();
  const { lang, isRTL } = useLanguage();
  const ar = lang === 'ar';
  const t = ls2Text(lang as Lang);
  const admin = isLs2Admin(user?.role);
  const [items, setItems] = useState<Repair[]>([]);
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [loading, setLoading] = useState(true);
  const [category, setCategory] = useState('all');
  const [status, setStatus] = useState('all');
  const [editing, setEditing] = useState<Repair | null>(null);
  const [adding, setAdding] = useState<Vehicle | null>(null);
  const [pickVehicle, setPickVehicle] = useState(false);

  const load = useCallback(async () => {
    try {
      const [r, v] = await Promise.all([
        api.get<{ items: Repair[] }>('/api/ls2/repairs'),
        api.get<{ items: Vehicle[] }>('/api/ls2/vehicles'),
      ]);
      setItems(r.items || []); setVehicles(v.items || []);
    } catch { /* keep */ }
    setLoading(false);
  }, []);
  useEffect(() => { load(); }, [load]);
  useSocket('ls2:updated', useCallback(() => load(), [load]));

  const rows = useMemo(() => items.filter((r) =>
    (category === 'all' || r.category === category) && (status === 'all' || r.status === status)
  ), [items, category, status]);

  const totalCost = rows.reduce((a, r) => a + (r.cost || 0), 0);

  const remove = async (r: Repair) => {
    if (!confirm(ar ? `حذف "${r.title}"؟` : `Delete "${r.title}"?`)) return;
    try { await api.delete(`/api/ls2/repairs/${r._id}`); load(); } catch (e: any) { alert(e?.message || 'Failed'); }
  };

  if (!isLs2Staff(user?.role)) return <div className="text-slate-500 p-8">{t.notAuthorized}</div>;
  if (loading && !items.length) return <Spinner />;

  const chip = (active: boolean) => `px-3 py-1.5 rounded-full text-xs font-medium border ${active ? 'bg-[#f37121] text-white border-[#f37121]' : 'bg-white text-slate-600 border-slate-200'}`;

  return (
    <div className="space-y-5" dir={isRTL ? 'rtl' : 'ltr'}>
      <PageHeader icon={<Hammer className="w-5 h-5" />} title={t.repairs} subtitle={t.repairsHint}>
        <button type="button" onClick={() => load()} className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 text-sm"><RefreshCw className="w-4 h-4" /> {t.refresh}</button>
        {admin && (
          <button type="button" onClick={() => setPickVehicle(true)} className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-[#f37121] text-white text-sm font-medium"><Plus className="w-4 h-4" /> {t.newRepair}</button>
        )}
      </PageHeader>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { label: ar ? 'إجمالي السجلات' : 'Total records', value: rows.length.toLocaleString(), accent: 'text-slate-900' },
          { label: REPAIR_STATUSES.open[ar ? 'ar' : 'en'], value: items.filter((r) => r.status === 'open').length, accent: 'text-red-600' },
          { label: REPAIR_STATUSES.in_progress[ar ? 'ar' : 'en'], value: items.filter((r) => r.status === 'in_progress').length, accent: 'text-amber-600' },
          { label: ar ? 'إجمالي التكلفة' : 'Total cost', value: totalCost ? totalCost.toLocaleString() : '—', accent: 'text-slate-900' },
        ].map((k) => (
          <div key={k.label} className="bg-white border border-slate-200 rounded-xl p-4 shadow-sm">
            <p className="text-xs text-slate-500 mb-1">{k.label}</p>
            <p className={`text-xl font-bold tabular-nums ${k.accent}`}>{k.value}</p>
          </div>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <button type="button" onClick={() => setCategory('all')} className={chip(category === 'all')}>{t.all}</button>
        {Object.entries(REPAIR_CATEGORIES).map(([k, v]) => (
          <button key={k} type="button" onClick={() => setCategory(k)} className={chip(category === k)}>{ar ? v.ar : v.en}</button>
        ))}
        <span className="w-px h-5 bg-slate-200 mx-1" />
        <button type="button" onClick={() => setStatus('all')} className={chip(status === 'all')}>{t.all}</button>
        {Object.entries(REPAIR_STATUSES).map(([k, v]) => (
          <button key={k} type="button" onClick={() => setStatus(k)} className={chip(status === k)}>{ar ? v.ar : v.en}</button>
        ))}
      </div>

      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-slate-900 text-slate-300 text-xs">
                <th className="text-start font-semibold px-4 py-3">{t.plate}</th>
                <th className="text-start font-semibold px-4 py-3">{t.repairTitle}</th>
                <th className="text-start font-semibold px-4 py-3">{t.category}</th>
                <th className="text-center font-semibold px-4 py-3">{t.severity}</th>
                <th className="text-start font-semibold px-4 py-3">{t.repairDate}</th>
                <th className="text-end font-semibold px-4 py-3">{t.odometer}</th>
                <th className="text-end font-semibold px-4 py-3">{ar ? 'التكلفة' : 'Cost'}</th>
                <th className="text-start font-semibold px-4 py-3">{t.workshop}</th>
                <th className="text-center font-semibold px-4 py-3">{t.status}</th>
                {admin && <th className="px-4 py-3" />}
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const sev = REPAIR_SEVERITIES[r.severity];
                const st = REPAIR_STATUSES[r.status];
                return (
                  <tr key={r._id} className="border-b border-slate-100 hover:bg-slate-50">
                    <td className="px-4 py-3 font-medium text-slate-800 whitespace-nowrap">{r.plate || `#${r.unitId}`}</td>
                    <td className="px-4 py-3 text-slate-800">
                      {r.title}
                      {r.description && <p className="text-[11px] text-slate-500 truncate max-w-[240px]">{r.description}</p>}
                    </td>
                    <td className="px-4 py-3 text-slate-800">{repairCategoryLabel(r.category, lang as Lang)}</td>
                    <td className="px-4 py-3 text-center"><span className={`px-2 py-0.5 rounded-full text-xs font-medium ${sev.bg} ${sev.text}`}>{ar ? sev.ar : sev.en}</span></td>
                    <td className="px-4 py-3 text-slate-800 whitespace-nowrap">{r.repairDate ? new Date(r.repairDate).toLocaleDateString(ar ? 'ar-EG' : 'en-GB') : '—'}</td>
                    <td className="px-4 py-3 text-end tabular-nums text-slate-800">{fmtKm(r.odometerKm)}</td>
                    <td className="px-4 py-3 text-end tabular-nums text-slate-800">{r.cost != null ? r.cost.toLocaleString() : '—'}</td>
                    <td className="px-4 py-3 text-slate-800">{r.workshop || '—'}</td>
                    <td className="px-4 py-3 text-center"><span className={`px-2 py-0.5 rounded-full text-xs font-medium ${st.bg} ${st.text}`}>{ar ? st.ar : st.en}</span></td>
                    {admin && (
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-1">
                          <button type="button" onClick={() => setEditing(r)} className="p-1.5 rounded-lg text-slate-500 hover:bg-slate-100" aria-label={t.edit}><Pencil className="w-4 h-4" /></button>
                          <button type="button" onClick={() => remove(r)} className="p-1.5 rounded-lg text-red-500 hover:bg-red-50" aria-label={t.delete}><Trash2 className="w-4 h-4" /></button>
                        </div>
                      </td>
                    )}
                  </tr>
                );
              })}
              {rows.length === 0 && <tr><td colSpan={admin ? 10 : 9} className="text-center text-slate-500 py-10">{t.noRepairs}</td></tr>}
            </tbody>
          </table>
        </div>
      </div>

      {/* Pick the truck first — a repair always belongs to one */}
      {pickVehicle && (
        <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/40 p-4" onClick={() => setPickVehicle(false)}>
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm max-h-[80vh] overflow-y-auto p-4" dir={isRTL ? 'rtl' : 'ltr'} onClick={(e) => e.stopPropagation()}>
            <h3 className="text-sm font-bold text-slate-900 mb-3">{ar ? 'اختر المركبة' : 'Select vehicle'}</h3>
            <div className="space-y-1">
              {vehicles.map((v) => (
                <button key={v.unitId} type="button" onClick={() => { setPickVehicle(false); setAdding(v); }}
                  className="w-full text-start px-3 py-2 rounded-lg hover:bg-slate-50 text-sm text-slate-800 flex justify-between">
                  <span className="font-medium">{v.plate || v.name}</span>
                  <span className="text-xs text-slate-500">{v.driver || '—'}</span>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {(adding || editing) && (
        <RepairModal
          unitId={adding ? adding.unitId : editing!.unitId}
          plate={adding ? adding.plate : editing!.plate}
          currentOdo={adding ? adding.odometerKm : null}
          existing={editing}
          lang={lang as Lang}
          isRTL={isRTL}
          onClose={() => { setAdding(null); setEditing(null); }}
          onSaved={() => { setAdding(null); setEditing(null); load(); }}
        />
      )}
    </div>
  );
}
