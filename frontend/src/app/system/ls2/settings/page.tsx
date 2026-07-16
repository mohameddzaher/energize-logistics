'use client';
// Settings — everything that governs the section, in two tabs: the alert
// thresholds (grouped by the system each one guards) and the four periodic
// services. Admin-only; the alert engine re-reads all of it on its next poll.
//
// There is no "service interval" to set: every vehicle carries its own real
// intervals from Location Solutions. What we configure per service is how early it
// warns and the checklist of tasks it consists of.
import { useState, useEffect, useCallback, useMemo } from 'react';
import { useAuth } from '@/context/AuthContext';
import { useLanguage } from '@/context/LanguageContext';
import api from '@/lib/api';
import {
  Settings as SettingsIcon, Save, RotateCcw, Plus, Trash2, ListChecks, Bell,
  Activity, Thermometer, Gauge, Zap, GripVertical, Check, AlertTriangle,
} from 'lucide-react';
import { Spinner, PageHeader } from '@/components/hr/HRKit';
import {
  ls2Text, isLs2Admin, THRESHOLD_GROUPS, thresholdField, fmtNum,
  type Lang, type ChecklistTemplates, type AlertBeforeMap, type ServiceInterval, type Vehicle,
} from '@/lib/ls2';

type Tab = 'thresholds' | 'checklists';

const GROUP_ICONS: Record<string, any> = { tires: Activity, engine: Thermometer, load: Gauge, power: Zap };

export default function Ls2SettingsPage() {
  const { user } = useAuth();
  const { lang, isRTL } = useLanguage();
  const ar = lang === 'ar';
  const t = ls2Text(lang as Lang);
  const [tab, setTab] = useState<Tab>('thresholds');
  const [thresholds, setThresholds] = useState<any>({});
  const [maintenance, setMaintenance] = useState<any>({});
  const [checklists, setChecklists] = useState<ChecklistTemplates>({});
  const [alertBefore, setAlertBefore] = useState<Record<string, string>>({});
  const [services, setServices] = useState<ServiceInterval[]>([]);
  const [defaults, setDefaults] = useState<any>({ thresholds: {}, maintenance: {} });
  const [saved, setSaved] = useState<string>(''); // JSON of the last saved state
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<{ text: string; ok: boolean } | null>(null);

  const load = useCallback(async () => {
    try {
      const [s, v] = await Promise.all([
        api.get<any>('/api/ls2/settings'),
        api.get<{ items: Vehicle[] }>('/api/ls2/vehicles'),
      ]);
      setThresholds(s.thresholds || {});
      setMaintenance(s.maintenance || {});
      setChecklists(s.checklists || {});
      setDefaults(s.defaults || {});
      // Kept as strings so a cleared box stays cleared (and means "use the default").
      setAlertBefore(Object.fromEntries(Object.entries(s.alertBefore || {}).map(([k, v]) => [k, String(v)])));
      setSaved(JSON.stringify({ t: s.thresholds || {}, m: s.maintenance || {}, c: s.checklists || {}, a: s.alertBefore || {} }));
      // The 4 services are identical fleet-wide — take the plan off any vehicle.
      setServices((v.items || []).find((x) => (x.serviceIntervals?.length || 0) > 0)?.serviceIntervals || []);
    } catch { /* keep */ }
    setLoading(false);
  }, []);
  useEffect(() => { load(); }, [load]);

  // Warn before leaving with edits still in the form.
  const cleanWindows = (): AlertBeforeMap => Object.fromEntries(
    Object.entries(alertBefore).filter(([, v]) => Number(v) > 0).map(([k, v]) => [k, Number(v)])
  );
  const dirty = useMemo(
    () => !!saved && JSON.stringify({ t: thresholds, m: maintenance, c: checklists, a: cleanWindows() }) !== saved,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [thresholds, maintenance, checklists, alertBefore, saved]
  );
  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ''; };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);

  if (!isLs2Admin(user?.role)) return <div className="text-slate-500 p-8">{t.notAuthorized}</div>;
  if (loading) return <Spinner />;

  const save = async () => {
    setSaving(true); setMsg(null);
    try {
      const num = (o: any) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, Number(v)]));
      // Drop blank rows so an empty "add" box never becomes a task.
      const cleaned: ChecklistTemplates = {};
      for (const [k, items] of Object.entries(checklists)) {
        const kept = (items || []).filter((i) => i.label.trim());
        if (kept.length) cleaned[k] = kept.map((i) => ({ label: i.label.trim(), labelAr: (i.labelAr || '').trim() }));
      }
      const windows = cleanWindows();
      const body = { thresholds: num(thresholds), maintenance: num(maintenance), checklists: cleaned, alertBefore: windows };
      await api.put('/api/ls2/settings', body);
      setChecklists(cleaned);
      setSaved(JSON.stringify({ t: body.thresholds, m: body.maintenance, c: cleaned, a: windows }));
      setMsg({ text: t.saved, ok: true });
      setTimeout(() => setMsg(null), 2500);
    } catch { setMsg({ text: t.saveFailed, ok: false }); }
    setSaving(false);
  };

  const resetDefaults = () => { setThresholds({ ...defaults.thresholds }); setMaintenance({ ...defaults.maintenance }); };

  const taskCount = Object.values(checklists).reduce((a, x) => a + (x?.length || 0), 0);
  const TABS: { key: Tab; label: string; icon: any; badge?: string }[] = [
    { key: 'thresholds', label: t.alertThresholds, icon: Bell },
    { key: 'checklists', label: t.periodicServices, icon: ListChecks, badge: taskCount ? String(taskCount) : undefined },
  ];

  return (
    <div dir={isRTL ? 'rtl' : 'ltr'}>
      <div className="space-y-5">
        <PageHeader icon={<SettingsIcon className="w-5 h-5" />} title={`${t.section} · ${t.settings}`}
          subtitle={ar ? 'تُطبَّق فورًا على كل التنبيهات' : 'Applied to every alert immediately'} />

        {/* Tabs — the page is three unrelated jobs, not one long scroll */}
        <div className="flex gap-2 p-1.5 bg-slate-100 rounded-xl overflow-x-auto border border-slate-200">
          {TABS.map((x) => {
            const Icon = x.icon;
            const on = tab === x.key;
            return (
              <button key={x.key} type="button" onClick={() => setTab(x.key)}
                className={`flex-1 min-w-max flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg text-sm font-medium border transition ${on
                  ? 'bg-white border-slate-300 shadow-sm text-slate-900'
                  : 'bg-white/50 border-slate-200 text-slate-600 hover:bg-white hover:border-slate-300 hover:text-slate-900'}`}>
                <Icon className={`w-4 h-4 ${on ? 'text-[#f37121]' : ''}`} /> {x.label}
                {x.badge && <span className={`px-1.5 py-0.5 rounded-full text-[10px] tabular-nums ${on ? 'bg-[#f37121] text-white' : 'bg-slate-200 text-slate-600'}`}>{x.badge}</span>}
              </button>
            );
          })}
        </div>

        {/* ---- Alert thresholds, grouped by the system each one guards ---- */}
        {tab === 'thresholds' && (
          <div className="space-y-4">
            <p className="text-xs text-slate-500">{t.thresholdsHint}</p>
            {THRESHOLD_GROUPS.map((g) => {
              const Icon = GROUP_ICONS[g.key] || Bell;
              return (
                <div key={g.key} className="bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden">
                  <h2 className="text-sm font-semibold text-slate-900 flex items-center gap-2 px-5 py-3 border-b border-slate-100 bg-slate-50/60">
                    <Icon className="w-4 h-4 text-[#f37121]" /> {ar ? g.ar : g.en}
                  </h2>
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4 p-5">
                    {g.fields.map((key) => {
                      const f = thresholdField(key);
                      if (!f) return null;
                      // A "critical" threshold is the escalation tier — flag it so the
                      // pair reads as warning-then-critical rather than two equals.
                      const critical = /critical|Critical/.test(key);
                      const changed = defaults.thresholds && thresholds[key] != null
                        && Number(thresholds[key]) !== Number(defaults.thresholds[key]);
                      return (
                        <div key={key}>
                          <label className="text-xs font-medium text-slate-600 mb-1 flex items-center gap-1.5">
                            {critical && <AlertTriangle className="w-3 h-3 text-red-500 shrink-0" />}
                            <span>{ar ? f.ar : f.en}</span>
                            {changed && <span className="w-1.5 h-1.5 rounded-full bg-[#f37121]" title={ar ? 'مختلف عن الافتراضي' : 'Differs from default'} />}
                          </label>
                          <div className="relative">
                            <input type="number" value={thresholds[key] ?? ''}
                              onChange={(e) => setThresholds((p: any) => ({ ...p, [key]: e.target.value }))}
                              className={`w-full ps-3 pe-12 py-2 rounded-lg border text-sm tabular-nums text-slate-900 ${critical ? 'border-red-200 focus:border-red-400' : 'border-slate-200 focus:border-[#f37121]'} outline-none`} />
                            <span className="absolute top-1/2 -translate-y-1/2 end-3 text-[11px] text-slate-400 pointer-events-none">{f.unit}</span>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })}
            <button type="button" onClick={resetDefaults}
              className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 text-sm">
              <RotateCcw className="w-4 h-4" /> {t.reset}
            </button>
          </div>
        )}

        {/* ---- Our own per-service checklists ---- */}
        {tab === 'checklists' && (
          <div className="space-y-4">
            <p className="text-xs text-slate-500">{t.periodicServicesHint}</p>
            {services.length === 0 && (
              <div className="bg-white border border-slate-200 rounded-xl p-8 text-center text-sm text-slate-400">{t.noData}</div>
            )}
            {services.map((sv) => {
              const key = String(sv.id);
              const items = checklists[key] || [];
              const setItems = (next: typeof items) => setChecklists((p) => ({ ...p, [key]: next }));
              const move = (i: number, dir: -1 | 1) => {
                const j = i + dir;
                if (j < 0 || j >= items.length) return;
                const next = [...items];
                [next[i], next[j]] = [next[j], next[i]];
                setItems(next);
              };
              return (
                <div key={sv.id} className="bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden">
                  <div className="px-5 py-3 border-b border-slate-100 bg-slate-50/60">
                    <div className="flex items-center justify-between gap-2 flex-wrap">
                      <div className="min-w-0">
                        <p className="text-sm font-semibold text-slate-900 truncate">{sv.name}</p>
                        <p className="text-[11px] text-slate-500">
                          {sv.intervalKm > 0 && <>{t.everyKm} {fmtNum(sv.intervalKm)} km · </>}
                          {items.length} {ar ? 'بند' : items.length === 1 ? 'task' : 'tasks'}
                        </p>
                      </div>
                      {/* This service's own warn window — 3,000 km means something
                          different on a 20K service than on an 80K one. */}
                      <div className="flex items-center gap-2 shrink-0">
                        <label className="text-[11px] font-medium text-slate-600">{t.warnBefore}</label>
                        <div className="relative">
                          <input type="number" value={alertBefore[key] ?? ''}
                            onChange={(e) => setAlertBefore((p) => ({ ...p, [key]: e.target.value }))}
                            placeholder={String(defaults.maintenance?.alertBeforeKm ?? 3000)}
                            className="w-28 ps-3 pe-9 py-1.5 rounded-lg border border-slate-200 focus:border-[#f37121] outline-none text-sm tabular-nums text-slate-900" />
                          <span className="absolute top-1/2 -translate-y-1/2 end-2.5 text-[10px] text-slate-400 pointer-events-none">km</span>
                        </div>
                        {!alertBefore[key] && <span className="text-[10px] text-slate-400">({t.usingDefault})</span>}
                      </div>
                    </div>
                    <p className="text-[10px] text-slate-500 mt-1.5">{t.warnBeforeHint}</p>
                  </div>
                  <div className="flex items-center justify-between gap-2 px-5 py-2.5 border-b border-slate-100">
                    <p className="text-xs font-semibold text-slate-700 flex items-center gap-1.5"><ListChecks className="w-3.5 h-3.5 text-[#f37121]" /> {t.checklist}</p>
                    <button type="button" onClick={() => setItems([...items, { label: '', labelAr: '' }])}
                      className="shrink-0 flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-[#f37121] hover:bg-[#e06010] text-white text-xs font-medium">
                      <Plus className="w-3.5 h-3.5" /> {t.addTask}
                    </button>
                  </div>
                  {items.length === 0 ? (
                    <p className="text-xs text-slate-400 py-8 text-center">{t.noTasks}</p>
                  ) : (
                    <div className="divide-y divide-slate-50">
                      {items.map((it, i) => (
                        <div key={i} className="flex items-start gap-2 p-3 hover:bg-slate-50/60">
                          {/* Reorder — the checklist is read top-down in the workshop */}
                          <div className="flex flex-col shrink-0 pt-1.5 text-slate-300">
                            <button type="button" onClick={() => move(i, -1)} disabled={i === 0}
                              className="hover:text-[#f37121] disabled:opacity-30 leading-none text-[10px]" aria-label="Move up">▲</button>
                            <GripVertical className="w-3 h-3" />
                            <button type="button" onClick={() => move(i, 1)} disabled={i === items.length - 1}
                              className="hover:text-[#f37121] disabled:opacity-30 leading-none text-[10px]" aria-label="Move down">▼</button>
                          </div>
                          <div className="flex-1 grid grid-cols-1 sm:grid-cols-2 gap-2 min-w-0">
                            <input value={it.label} placeholder={`${t.taskName} — English`} dir="ltr"
                              onChange={(e) => setItems(items.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)))}
                              className="w-full px-3 py-2 rounded-lg border border-slate-200 focus:border-[#f37121] outline-none text-sm text-slate-900" />
                            <input value={it.labelAr || ''} placeholder={t.taskNameAr} dir="rtl"
                              onChange={(e) => setItems(items.map((x, j) => (j === i ? { ...x, labelAr: e.target.value } : x)))}
                              className="w-full px-3 py-2 rounded-lg border border-slate-200 focus:border-[#f37121] outline-none text-sm text-slate-900" />
                          </div>
                          <button type="button" onClick={() => setItems(items.filter((_, j) => j !== i))}
                            className="shrink-0 p-2 rounded-lg text-slate-400 hover:text-red-600 hover:bg-red-50" aria-label={t.delete}>
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
        )}
      </div>

      {/* Sticky save bar — the form is long; Save must never be scrolled away.
          Sticky (not fixed) so it tracks the content column through the sidebar's
          collapse and the RTL flip without knowing anything about either. */}
      <div className="sticky bottom-0 mt-5 -mx-1 px-4 py-3 bg-white/95 backdrop-blur border border-slate-200 rounded-t-xl shadow-[0_-2px_12px_rgba(0,0,0,0.06)] z-30">
        <div className="flex items-center gap-3">
          {msg ? (
            <span className={`text-sm font-medium flex items-center gap-1.5 ${msg.ok ? 'text-emerald-600' : 'text-red-600'}`}>
              {msg.ok && <Check className="w-4 h-4" />} {msg.text}
            </span>
          ) : dirty ? (
            <span className="text-xs text-amber-600 flex items-center gap-1.5"><span className="w-1.5 h-1.5 rounded-full bg-amber-500" /> {t.unsavedChanges}</span>
          ) : null}
          <button type="button" onClick={save} disabled={saving || !dirty}
            className="ms-auto flex items-center gap-1.5 px-5 py-2 rounded-lg bg-[#f37121] hover:bg-[#e06010] text-white text-sm font-medium disabled:opacity-40 disabled:cursor-not-allowed">
            <Save className="w-4 h-4" /> {saving ? '…' : t.save}
          </button>
        </div>
      </div>
    </div>
  );
}
