'use client';
// Settings — tune the alert thresholds (tire/engine temperature, pressure, fuel,
// weight, speed, voltage, offline window) and the periodic-service plan (interval
// + pre-alert distance). Admin-only; the alert engine re-reads these every poll.
import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '@/context/AuthContext';
import { useLanguage } from '@/context/LanguageContext';
import api from '@/lib/api';
import { Settings as SettingsIcon, Save, RotateCcw, Plus, Trash2, ListChecks } from 'lucide-react';
import { Spinner, PageHeader, Field, TextInput, PrimaryButton } from '@/components/hr/HRKit';
import { ls2Text, isLs2Admin, THRESHOLD_FIELDS, MAINTENANCE_FIELDS, type Lang, type ChecklistTemplates, type ServiceInterval, type Vehicle } from '@/lib/ls2';

export default function Ls2SettingsPage() {
  const { user } = useAuth();
  const { lang, isRTL } = useLanguage();
  const t = ls2Text(lang as Lang);
  const [thresholds, setThresholds] = useState<any>({});
  const [maintenance, setMaintenance] = useState<any>({});
  const [defaults, setDefaults] = useState<any>({ thresholds: {}, maintenance: {} });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState('');
  // Our own checklist templates, keyed by the Wialon service-interval id. The
  // 4 services are identical fleet-wide, so any vehicle's plan names them.
  const [checklists, setChecklists] = useState<ChecklistTemplates>({});
  const [services, setServices] = useState<ServiceInterval[]>([]);

  const load = useCallback(async () => {
    try {
      const [s, v] = await Promise.all([
        api.get<any>('/api/ls2/settings'),
        api.get<{ items: Vehicle[] }>('/api/ls2/vehicles'),
      ]);
      setThresholds(s.thresholds || {}); setMaintenance(s.maintenance || {}); setDefaults(s.defaults || {});
      setChecklists(s.checklists || {});
      // Take the service plan from the first vehicle that has one.
      const withPlan = (v.items || []).find((x) => (x.serviceIntervals?.length || 0) > 0);
      setServices(withPlan?.serviceIntervals || []);
    } catch { /* keep */ }
    setLoading(false);
  }, []);
  useEffect(() => { load(); }, [load]);

  if (!isLs2Admin(user?.role)) return <div className="text-slate-500 p-8">{t.notAuthorized}</div>;
  if (loading) return <Spinner />;

  const save = async () => {
    setSaving(true); setMsg('');
    try {
      const num = (o: any) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, Number(v)]));
      // Drop blank rows so an empty "add" box never becomes a task.
      const cleaned: ChecklistTemplates = {};
      for (const [k, items] of Object.entries(checklists)) {
        const kept = (items || []).filter((i) => i.label.trim());
        if (kept.length) cleaned[k] = kept.map((i) => ({ label: i.label.trim(), labelAr: (i.labelAr || '').trim() }));
      }
      await api.put('/api/ls2/settings', { thresholds: num(thresholds), maintenance: num(maintenance), checklists: cleaned });
      setMsg(t.saved);
      setTimeout(() => setMsg(''), 2500);
    } catch { setMsg(t.saveFailed); }
    setSaving(false);
  };
  const resetDefaults = () => { setThresholds({ ...defaults.thresholds }); setMaintenance({ ...defaults.maintenance }); };

  return (
    <div className="space-y-5 max-w-3xl" dir={isRTL ? 'rtl' : 'ltr'}>
      <PageHeader icon={<SettingsIcon className="w-5 h-5" />} title={`${t.section} · ${t.settings}`} subtitle={lang === 'ar' ? 'تُطبَّق فورًا على كل التنبيهات' : 'Applied to every alert immediately'}>
        <button type="button" onClick={resetDefaults} className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 text-sm"><RotateCcw className="w-4 h-4" /> {t.reset}</button>
        <PrimaryButton onClick={save} disabled={saving}><Save className="w-4 h-4" /> {t.save}</PrimaryButton>
      </PageHeader>
      {msg && <div className="px-4 py-2 rounded-lg bg-emerald-50 text-emerald-700 text-sm">{msg}</div>}

      <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-sm">
        <h2 className="text-sm font-semibold text-slate-900 mb-4">{t.alertThresholds}</h2>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
          {THRESHOLD_FIELDS.map((f) => (
            <Field key={f.key} label={`${lang === 'ar' ? f.ar : f.en} (${f.unit})`}>
              <TextInput type="number" value={thresholds[f.key] ?? ''} onChange={(e) => setThresholds((p: any) => ({ ...p, [f.key]: e.target.value }))} />
            </Field>
          ))}
        </div>
      </div>

      <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-sm">
        <h2 className="text-sm font-semibold text-slate-900 mb-1">{t.maintenancePlan}</h2>
        <p className="text-xs text-slate-400 mb-4">{lang === 'ar' ? 'الصيانة الدورية تُحسب من عدّاد الكيلومترات المباشر لكل مركبة.' : 'Periodic service is computed from each vehicle’s live odometer.'}</p>
        <div className="grid grid-cols-2 gap-4">
          {MAINTENANCE_FIELDS.map((f) => (
            <Field key={f.key} label={`${lang === 'ar' ? f.ar : f.en} (${f.unit})`}>
              <TextInput type="number" value={maintenance[f.key] ?? ''} onChange={(e) => setMaintenance((p: any) => ({ ...p, [f.key]: e.target.value }))} />
            </Field>
          ))}
        </div>
      </div>

      {/* Service checklists — OUR extension: Location Solutions has no such thing */}
      <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-sm">
        <h2 className="text-sm font-semibold text-slate-900 mb-1 flex items-center gap-2"><ListChecks className="w-4 h-4 text-[#f37121]" /> {t.checklists}</h2>
        <p className="text-xs text-slate-500 mb-4">{t.checklistHint}</p>
        {services.length === 0 && <p className="text-xs text-slate-400">{t.noData}</p>}
        <div className="space-y-4">
          {services.map((sv) => {
            const key = String(sv.id);
            const items = checklists[key] || [];
            const setItems = (next: typeof items) => setChecklists((p) => ({ ...p, [key]: next }));
            return (
              <div key={sv.id} className="border border-slate-200 rounded-xl p-3">
                <div className="flex items-center justify-between gap-2 mb-2">
                  <p className="text-sm font-bold text-slate-800">{sv.name}</p>
                  <button type="button" onClick={() => setItems([...items, { label: '', labelAr: '' }])}
                    className="flex items-center gap-1 px-2.5 py-1 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-medium">
                    <Plus className="w-3.5 h-3.5" /> {t.addTask}
                  </button>
                </div>
                {items.length === 0 ? (
                  <p className="text-xs text-slate-400 py-2">{t.noTasks}</p>
                ) : (
                  <div className="space-y-2">
                    {items.map((it, i) => (
                      <div key={i} className="flex items-center gap-2">
                        <input value={it.label} placeholder={t.taskName}
                          onChange={(e) => setItems(items.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)))}
                          className="flex-1 px-3 py-2 rounded-lg border border-slate-200 text-sm text-slate-800" />
                        <input value={it.labelAr || ''} placeholder={t.taskNameAr} dir="rtl"
                          onChange={(e) => setItems(items.map((x, j) => (j === i ? { ...x, labelAr: e.target.value } : x)))}
                          className="flex-1 px-3 py-2 rounded-lg border border-slate-200 text-sm text-slate-800" />
                        <button type="button" onClick={() => setItems(items.filter((_, j) => j !== i))}
                          className="p-2 rounded-lg text-red-500 hover:bg-red-50" aria-label={t.delete}>
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
