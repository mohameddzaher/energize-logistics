'use client';
import { useState, useEffect, useCallback, useMemo } from 'react';
import { useAuth } from '@/context/AuthContext';
import { useLanguage } from '@/context/LanguageContext';
import { useSocket } from '@/hooks/useSocket';
import api from '@/lib/api';
import { getCRMTranslations } from '@/lib/translations';
import { CalendarDays, ChevronLeft, ChevronRight } from 'lucide-react';
import { isCrmStaff, CrmActivity, CrmTask, CrmOptions, optLabel, companyName, fmtDateTime } from '@/lib/crm';
import { Spinner, PageHeader, Tabs } from '@/components/crm/CrmKit';

const MONTHS_EN = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const MONTHS_AR = ['يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو', 'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر'];
const DOW_EN = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const DOW_AR = ['أحد', 'إثنين', 'ثلاثاء', 'أربعاء', 'خميس', 'جمعة', 'سبت'];

const dayKey = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

export default function CrmCalendarPage() {
  const { user } = useAuth();
  const { lang, isRTL } = useLanguage();
  const ar = lang === 'ar';
  const T = getCRMTranslations(lang);

  const [cursor, setCursor] = useState(() => { const d = new Date(); return new Date(d.getFullYear(), d.getMonth(), 1); });
  const [activities, setActivities] = useState<CrmActivity[]>([]);
  const [tasks, setTasks] = useState<CrmTask[]>([]);
  const [opts, setOpts] = useState<CrmOptions | null>(null);
  const [loading, setLoading] = useState(true);
  const [scope, setScope] = useState('all');
  const [selected, setSelected] = useState<string | null>(null);

  const load = useCallback(async () => {
    const from = new Date(cursor.getFullYear(), cursor.getMonth(), 1);
    const to = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 0, 23, 59, 59);
    try {
      const qs = new URLSearchParams({ from: from.toISOString(), to: to.toISOString() });
      if (scope === 'mine') qs.set('mine', 'true');
      const d = await api.get<{ activities: CrmActivity[]; tasks: CrmTask[] }>(`/api/crm/calendar?${qs}`);
      setActivities(d.activities || []); setTasks(d.tasks || []);
    } catch { /* */ }
    setLoading(false);
  }, [cursor, scope]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { api.get<CrmOptions>('/api/crm/options').then(setOpts).catch(() => {}); }, []);
  useSocket('crm:task', useCallback(() => load(), [load]));
  useSocket('crm:activity', useCallback(() => load(), [load]));

  // Build day → events map.
  const byDay = useMemo(() => {
    const m: Record<string, { activities: CrmActivity[]; tasks: CrmTask[] }> = {};
    const push = (k: string) => (m[k] ||= { activities: [], tasks: [] });
    activities.forEach((a) => { if (a.date) push(dayKey(new Date(a.date))).activities.push(a); });
    tasks.forEach((t) => { if (t.dueDate) push(dayKey(new Date(t.dueDate))).tasks.push(t); });
    return m;
  }, [activities, tasks]);

  // Grid cells (leading blanks + days).
  const cells = useMemo(() => {
    const first = new Date(cursor.getFullYear(), cursor.getMonth(), 1);
    const days = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 0).getDate();
    const arr: (Date | null)[] = [];
    for (let i = 0; i < first.getDay(); i++) arr.push(null);
    for (let d = 1; d <= days; d++) arr.push(new Date(cursor.getFullYear(), cursor.getMonth(), d));
    return arr;
  }, [cursor]);

  if (!isCrmStaff(user?.role)) return <div className="text-slate-500 p-8">{ar ? 'لا تملك صلاحية' : 'Not authorized'}</div>;

  const todayKey = dayKey(new Date());
  const sel = selected ? byDay[selected] : null;
  const months = ar ? MONTHS_AR : MONTHS_EN;
  const dow = ar ? DOW_AR : DOW_EN;

  return (
    <div className="space-y-6" dir={isRTL ? 'rtl' : 'ltr'}>
      <PageHeader icon={<CalendarDays className="w-5 h-5" />} title={T.calendar}>
        <Tabs tabs={[{ key: 'all', label: T.all }, { key: 'mine', label: T.myTasks }]} active={scope} onChange={setScope} />
      </PageHeader>

      <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-sm">
        <div className="flex items-center justify-between mb-4">
          <button type="button" title="prev" onClick={() => setCursor(new Date(cursor.getFullYear(), cursor.getMonth() - 1, 1))} className="text-slate-500 hover:text-slate-900 p-1">{isRTL ? <ChevronRight /> : <ChevronLeft />}</button>
          <h2 className="bg-slate-900 px-3 py-2 rounded-lg text-white font-bold text-lg mb-3">{months[cursor.getMonth()]} {cursor.getFullYear()}</h2>
          <button type="button" title="next" onClick={() => setCursor(new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1))} className="text-slate-500 hover:text-slate-900 p-1">{isRTL ? <ChevronLeft /> : <ChevronRight />}</button>
        </div>

        {loading ? <Spinner /> : (
          <div className="grid grid-cols-7 gap-1">
            {dow.map((d) => <div key={d} className="text-center text-slate-500 text-xs font-medium py-1">{d}</div>)}
            {cells.map((d, i) => {
              if (!d) return <div key={i} />;
              const k = dayKey(d);
              const ev = byDay[k];
              const isToday = k === todayKey;
              return (
                <button type="button" key={i} onClick={() => setSelected(k)}
                  className={`min-h-[84px] text-left rounded-lg border p-1.5 transition-colors ${isToday ? 'border-[#f37121] bg-[#f37121]/5' : 'border-slate-200 hover:border-slate-300'} ${selected === k ? 'ring-2 ring-[#f37121]/50' : ''}`}>
                  <span className={`text-xs ${isToday ? 'text-[#f37121] font-bold' : 'text-slate-500'}`}>{d.getDate()}</span>
                  <div className="mt-1 space-y-0.5">
                    {(ev?.tasks || []).slice(0, 2).map((t) => (
                      <div key={t._id} className={`text-[10px] truncate rounded px-1 ${t.status === 'done' ? 'bg-green-500/15 text-green-600' : 'bg-amber-500/15 text-amber-700'}`}>• {t.title}</div>
                    ))}
                    {(ev?.activities || []).slice(0, 2).map((a) => (
                      <div key={a._id} className="text-[10px] truncate rounded px-1 bg-blue-500/15 text-blue-600">◦ {a.subject}</div>
                    ))}
                    {ev && (ev.tasks.length + ev.activities.length) > 4 && <div className="text-[10px] text-slate-500">+{ev.tasks.length + ev.activities.length - 4}</div>}
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* Selected day detail */}
      {selected && sel && (
        <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-sm">
          <h3 className="bg-slate-900 px-3 py-2 rounded-lg text-white font-semibold mb-3">{selected}</h3>
          {(sel.tasks.length + sel.activities.length) === 0 ? <p className="text-slate-500 text-sm">{T.noResults}</p> : (
            <div className="space-y-2">
              {sel.tasks.map((t) => (
                <div key={t._id} className="flex items-center justify-between bg-slate-100 rounded-lg px-3 py-2">
                  <span className="text-amber-700 text-sm">📋 {t.title}</span>
                  <span className="text-slate-500 text-xs">{companyName(t.company, lang)}</span>
                </div>
              ))}
              {sel.activities.map((a) => (
                <div key={a._id} className="flex items-center justify-between bg-slate-100 rounded-lg px-3 py-2">
                  <span className="text-blue-600 text-sm">📞 {a.subject} <span className="text-slate-500">({optLabel(opts?.ACTIVITY_TYPES, a.type, lang)})</span></span>
                  <span className="text-slate-500 text-xs">{fmtDateTime(a.date)}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
