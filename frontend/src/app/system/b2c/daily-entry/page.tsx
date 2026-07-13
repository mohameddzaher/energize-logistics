'use client';
import { useState, useEffect, useCallback, useRef } from 'react';
import { useLanguage } from '@/context/LanguageContext';
import { getB2CTranslations, getB2cDailyEntryTranslations } from '@/lib/translations';
import api from '@/lib/api';
import { motion } from 'framer-motion';
import { CalendarDays, Save, Check, AlertCircle, Search } from 'lucide-react';

interface Project { _id: string; name: string; color?: string }
interface Branch { _id: string; name: string }
interface Rep {
  _id: string;
  englishName: string;
  arabicName?: string;
  repId?: string;
  project?: Project;
  branch?: Branch;
  dailyTarget: number;
}
interface DailyOrder {
  _id: string;
  rep: { _id: string };
  dateKey: string;
  orders: number | null;
  worked: boolean;
}

const todayKey = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

export default function B2CDailyEntryPage() {
  const { lang } = useLanguage();
  const T = getB2CTranslations(lang);
  const tx = getB2cDailyEntryTranslations(lang);

  const [date, setDate] = useState<string>(todayKey());
  const [project, setProject] = useState<string>('');
  const [branch, setBranch] = useState<string>('');
  const [search, setSearch] = useState('');

  const [projects, setProjects] = useState<Project[]>([]);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [reps, setReps] = useState<Rep[]>([]);
  const [orderMap, setOrderMap] = useState<Record<string, DailyOrder>>({}); // by rep id
  const [loading, setLoading] = useState(false);

  // value buffer per rep — persists user typing while saves happen
  const [values, setValues] = useState<Record<string, string>>({});
  const [savingState, setSavingState] = useState<Record<string, 'idle' | 'saving' | 'saved' | 'error'>>({});
  const debounceRef = useRef<Record<string, NodeJS.Timeout>>({});

  const fetchProjects = useCallback(async () => {
    try { const data = await api.get<any>('/api/b2c/projects?active=true'); setProjects(data.projects || []); } catch {}
  }, []);
  const fetchBranches = useCallback(async () => {
    try { const data = await api.get<any>('/api/branches?active=true'); setBranches(data.branches || []); } catch {}
  }, []);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ active: 'true' });
      if (project) params.set('project', project);
      if (branch) params.set('branch', branch);
      const repsData = await api.get<any>(`/api/b2c/reps?${params.toString()}`);
      const repsList: Rep[] = repsData.reps || [];
      setReps(repsList);

      // Fetch existing entries for this date
      const ordersData = await api.get<any>(`/api/b2c/daily-orders?dateFrom=${date}&dateTo=${date}`);
      const map: Record<string, DailyOrder> = {};
      const valMap: Record<string, string> = {};
      (ordersData.orders || []).forEach((o: DailyOrder) => {
        const repIdStr = String(o.rep?._id || o.rep);
        map[repIdStr] = o;
        if (o.orders !== null && o.orders !== undefined) valMap[repIdStr] = String(o.orders);
      });
      setOrderMap(map);
      setValues((prev) => ({ ...valMap, ...prev })); // preserve any in-flight edits
    } catch {} finally { setLoading(false); }
  }, [project, branch, date]);

  useEffect(() => { fetchProjects(); fetchBranches(); }, [fetchProjects, fetchBranches]);
  useEffect(() => { fetchData(); }, [fetchData]);

  // Reset values cache when date changes (so we don't carry old values forward)
  useEffect(() => { setValues({}); setSavingState({}); }, [date]);

  const saveRep = useCallback(async (repId: string, raw: string) => {
    setSavingState((s) => ({ ...s, [repId]: 'saving' }));
    try {
      const orders = raw === '' ? null : Number(raw);
      const worked = raw !== '' && !Number.isNaN(orders as number);
      await api.post('/api/b2c/daily-orders', {
        rep: repId,
        dateKey: date,
        orders,
        worked: orders !== null,
        source: 'manual',
      });
      setSavingState((s) => ({ ...s, [repId]: 'saved' }));
      setTimeout(() => setSavingState((s) => ({ ...s, [repId]: 'idle' })), 1500);
      // Refresh just the entry in our map
      const ordersData = await api.get<any>(`/api/b2c/daily-orders?rep=${repId}&dateFrom=${date}&dateTo=${date}`);
      if (ordersData.orders?.[0]) {
        setOrderMap((m) => ({ ...m, [repId]: ordersData.orders[0] }));
      }
    } catch {
      setSavingState((s) => ({ ...s, [repId]: 'error' }));
    }
  }, [date]);

  const handleChange = (repId: string, raw: string) => {
    setValues((v) => ({ ...v, [repId]: raw }));
    if (debounceRef.current[repId]) clearTimeout(debounceRef.current[repId]);
    debounceRef.current[repId] = setTimeout(() => saveRep(repId, raw), 500);
  };

  const handleBlur = (repId: string) => {
    if (debounceRef.current[repId]) {
      clearTimeout(debounceRef.current[repId]);
      saveRep(repId, values[repId] ?? '');
    }
  };

  // Filter reps by search
  const filteredReps = search
    ? reps.filter((r) => {
        const q = search.toLowerCase();
        return r.englishName?.toLowerCase().includes(q)
          || (r.arabicName || '').toLowerCase().includes(q)
          || (r.repId || '').toLowerCase().includes(q);
      })
    : reps;

  // Date display helpers
  const dateObj = new Date(`${date}T00:00:00`);
  const dayName = dateObj.toLocaleDateString(lang === 'ar' ? 'ar-EG' : 'en-US', { weekday: 'long' });

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 flex items-center gap-2">
            <CalendarDays className="w-6 h-6 text-[#f37121]" />
            {T.dailyEntryTitle}
          </h1>
          <p className="text-slate-500 text-sm mt-1">{T.dailyEntrySubtitle}</p>
        </div>
      </div>

      {/* Filters */}
      <div className="bg-white border border-slate-200 rounded-xl p-4 grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-3 shadow-sm">
        <div>
          <label className="block text-slate-500 text-xs uppercase font-medium mb-1.5">{T.pickDate}</label>
          <input type="date" aria-label={tx.pickDate} value={date} onChange={(e) => setDate(e.target.value)}
            className="w-full px-3 py-2 rounded-lg bg-slate-50 border border-slate-200 text-slate-900 text-sm focus:outline-none focus:ring-2 focus:ring-[#f37121]/50" />
        </div>
        <div>
          <label className="block text-slate-500 text-xs uppercase font-medium mb-1.5">{T.project}</label>
          <select aria-label={tx.project} value={project} onChange={(e) => setProject(e.target.value)}
            className="w-full px-3 py-2 rounded-lg bg-slate-50 border border-slate-200 text-slate-900 text-sm focus:outline-none focus:ring-2 focus:ring-[#f37121]/50">
            <option value="">{T.allProjects}</option>
            {projects.map((p) => <option key={p._id} value={p._id}>{p.name}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-slate-500 text-xs uppercase font-medium mb-1.5">{T.branch}</label>
          <select aria-label={tx.branch} value={branch} onChange={(e) => setBranch(e.target.value)}
            className="w-full px-3 py-2 rounded-lg bg-slate-50 border border-slate-200 text-slate-900 text-sm focus:outline-none focus:ring-2 focus:ring-[#f37121]/50">
            <option value="">{T.allBranches}</option>
            {branches.map((b) => <option key={b._id} value={b._id}>{b.name}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-slate-500 text-xs uppercase font-medium mb-1.5">{tx.search}</label>
          <div className="relative">
            <Search className="w-4 h-4 absolute start-3 top-1/2 -translate-y-1/2 text-slate-500" />
            <input type="text" value={search} onChange={(e) => setSearch(e.target.value)}
              placeholder={tx.searchRepPlaceholder}
              className="w-full ps-10 pe-3 py-2 rounded-lg bg-slate-50 border border-slate-200 text-slate-900 text-sm focus:outline-none focus:ring-2 focus:ring-[#f37121]/50" />
          </div>
        </div>
      </div>

      {/* Date header card */}
      <motion.div initial={{ opacity: 0, y: 5 }} animate={{ opacity: 1, y: 0 }}
        className="bg-gradient-to-r from-[#f37121]/10 via-white to-slate-100 border border-[#f37121]/30 rounded-xl p-4 flex items-center justify-between">
        <div>
          <p className="text-slate-500 text-xs uppercase">{tx.recordingFor}</p>
          <p className="text-slate-900 font-bold text-lg">{dayName} — {date}</p>
        </div>
        <div className="text-end">
          <p className="text-slate-500 text-xs uppercase">{tx.reps}</p>
          <p className="text-[#f37121] font-bold text-2xl">{filteredReps.length}</p>
        </div>
      </motion.div>

      {/* Reps grid */}
      {loading && reps.length === 0 ? (
        <div className="flex items-center justify-center h-64">
          <div className="w-8 h-8 border-2 border-[#f37121] border-t-transparent rounded-full animate-spin" />
        </div>
      ) : filteredReps.length === 0 ? (
        <div className="text-center py-16 bg-white rounded-xl border border-slate-200 shadow-sm">
          <p className="text-slate-500">{T.noRepsForProject}</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
          {filteredReps.map((rep) => {
            const repIdStr = rep._id;
            const existing = orderMap[repIdStr];
            const value = values[repIdStr] ?? (existing?.orders !== undefined && existing?.orders !== null ? String(existing.orders) : '');
            const numValue = value === '' ? null : Number(value);
            const state = savingState[repIdStr] || 'idle';
            const target = rep.dailyTarget || 15;
            // Card color logic:
            // - empty/null = muted (no data yet)
            // - has data and below target = red top-stripe
            // - on/above target = green top-stripe
            const hasData = value !== '' && !Number.isNaN(numValue as number);
            const aboveTarget = hasData && (numValue as number) >= target;
            const belowTarget = hasData && (numValue as number) < target;
            const stripeColor = !hasData ? 'bg-slate-100' : aboveTarget ? 'bg-green-500' : 'bg-red-500';
            const cardOpacity = hasData ? '' : 'opacity-60';

            return (
              <motion.div key={repIdStr}
                initial={{ opacity: 0, scale: 0.97 }} animate={{ opacity: 1, scale: 1 }}
                className={`bg-white border border-slate-200 rounded-xl overflow-hidden hover:border-slate-300 transition-all ${cardOpacity} shadow-sm`}
              >
                <div className={`h-1 ${stripeColor}`} />
                <div className="p-4">
                  <div className="flex items-start justify-between mb-3">
                    <div className="min-w-0 flex-1">
                      <p className="text-slate-900 font-medium text-sm truncate">{rep.englishName}</p>
                      {rep.arabicName && <p className="text-slate-500 text-xs truncate">{rep.arabicName}</p>}
                      {rep.project && (
                        <span className="inline-block mt-1 px-1.5 py-0.5 rounded text-[10px] font-medium" style={{ backgroundColor: `${rep.project.color || '#f37121'}20`, color: rep.project.color || '#f37121' }}>
                          {rep.project.name}
                        </span>
                      )}
                    </div>
                    <div className="ms-2 flex items-center justify-center w-6 h-6">
                      {state === 'saving' && <div className="w-3 h-3 border-2 border-[#f37121] border-t-transparent rounded-full animate-spin" />}
                      {state === 'saved' && <Check className="w-4 h-4 text-green-600" />}
                      {state === 'error' && <AlertCircle className="w-4 h-4 text-red-600" />}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <input type="number" min="0" inputMode="numeric"
                      value={value}
                      onChange={(e) => handleChange(repIdStr, e.target.value)}
                      onBlur={() => handleBlur(repIdStr)}
                      placeholder={tx.ordersPlaceholder}
                      aria-label={`${tx.ordersForLabel} ${rep.englishName}`}
                      className={`flex-1 px-3 py-2 rounded-lg bg-slate-50 border text-slate-900 text-sm focus:outline-none focus:ring-2 focus:ring-[#f37121]/50 ${
                        belowTarget ? 'border-red-500/40' : aboveTarget ? 'border-green-500/40' : 'border-slate-200'
                      }`} />
                    <span className="text-slate-500 text-xs">/ {target}</span>
                  </div>
                  {hasData && (
                    <div className="mt-2 text-[11px]">
                      {aboveTarget ? (
                        <span className="text-green-600">+{(numValue as number) - target} {tx.aboveTarget}</span>
                      ) : (
                        <span className="text-red-600">{(numValue as number) - target} {tx.belowTarget}</span>
                      )}
                    </div>
                  )}
                </div>
              </motion.div>
            );
          })}
        </div>
      )}
    </div>
  );
}
