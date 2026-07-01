'use client';
// Live Fleet — every truck with its current status, speed, position, hottest
// tire, engine temp, odometer and active-alert level. Refreshes on `ls2:updated`.
import { useState, useEffect, useCallback, useMemo } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useAuth } from '@/context/AuthContext';
import { useLanguage } from '@/context/LanguageContext';
import { useSocket } from '@/hooks/useSocket';
import api from '@/lib/api';
import { Satellite, MapPin, RefreshCw, Search } from 'lucide-react';
import { Spinner, PageHeader } from '@/components/hr/HRKit';
import { ls2Text, isLs2Staff, statusStyle, severityStyle, tireTempColor, coolantColor, fmtKm, timeAgo, osmLink, type Lang, type Vehicle } from '@/lib/ls2';

const STATUSES = ['moving', 'idle', 'stopped', 'offline'];

export default function Ls2LivePage() {
  const { user } = useAuth();
  const { lang, isRTL } = useLanguage();
  const router = useRouter();
  const params = useSearchParams();
  const t = ls2Text(lang as Lang);
  const [items, setItems] = useState<Vehicle[]>([]);
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState(params.get('status') || '');
  const [q, setQ] = useState('');

  const load = useCallback(async () => {
    try {
      const res = await api.get<{ items: Vehicle[] }>(`/api/ls2/vehicles${status ? `?status=${status}` : ''}`);
      setItems(res.items || []);
    } catch { /* keep */ }
    setLoading(false);
  }, [status]);
  useEffect(() => { load(); }, [load]);
  useSocket('ls2:updated', useCallback(() => load(), [load]));

  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s) return items;
    return items.filter((v) => `${v.plate} ${v.driver} ${v.name}`.toLowerCase().includes(s));
  }, [items, q]);

  if (!isLs2Staff(user?.role)) return <div className="text-slate-500 p-8">{t.notAuthorized}</div>;
  if (loading && !items.length) return <Spinner />;

  return (
    <div className="space-y-5" dir={isRTL ? 'rtl' : 'ltr'}>
      <PageHeader icon={<Satellite className="w-5 h-5" />} title={t.liveFleet} subtitle={`${filtered.length} ${lang === 'ar' ? 'مركبة' : 'vehicles'} · ${t.live}`}>
        <button type="button" onClick={() => load()} className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 text-sm"><RefreshCw className="w-4 h-4" /> {t.refresh}</button>
      </PageHeader>

      <div className="bg-white border border-slate-200 rounded-xl p-3 flex flex-wrap items-center gap-2 shadow-sm">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t.search} className="w-full pl-10 pr-3 py-2 rounded-lg border border-slate-200 text-sm" />
        </div>
        <button type="button" onClick={() => setStatus('')} className={`px-3 py-1.5 rounded-full text-xs font-medium border ${!status ? 'bg-[#f37121] text-white border-[#f37121]' : 'bg-white text-slate-600 border-slate-200'}`}>{t.all}</button>
        {STATUSES.map((s) => {
          const st = statusStyle(s);
          return <button key={s} type="button" onClick={() => setStatus(s)} className={`px-3 py-1.5 rounded-full text-xs font-medium border ${status === s ? 'bg-[#f37121] text-white border-[#f37121]' : 'bg-white text-slate-600 border-slate-200'}`}>{lang === 'ar' ? st.ar : st.en}</button>;
        })}
      </div>

      {/* Status legend — clarifies idle vs stopped (a common question). */}
      <p className="text-xs text-slate-400 -mt-2 px-1">
        {lang === 'ar'
          ? 'يتحرك = ماشية · خامل = الموتور شغّال وواقفة · متوقف = الموتور مطفي · غير متصل = مفيش إشارة'
          : 'Moving = driving · Idle = engine on, stationary · Stopped = engine off · Offline = no signal'}
      </p>

      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-slate-900 text-slate-300 text-xs">
                <th className="text-start font-semibold px-4 py-3">{t.plate}</th>
                <th className="text-start font-semibold px-4 py-3">{t.driver}</th>
                <th className="text-start font-semibold px-4 py-3">{t.status}</th>
                <th className="text-end font-semibold px-4 py-3">{t.speed}</th>
                <th className="text-end font-semibold px-4 py-3">{t.maxTireTemp}</th>
                <th className="text-end font-semibold px-4 py-3">{t.coolant}</th>
                <th className="text-end font-semibold px-4 py-3">{t.odometer}</th>
                <th className="text-center font-semibold px-4 py-3">{t.alerts}</th>
                <th className="text-start font-semibold px-4 py-3">{t.lastSeen}</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody>
              {filtered.map((v) => {
                const st = statusStyle(v.status);
                const sv = severityStyle(v.alertLevel);
                return (
                  <tr key={v.unitId} onClick={() => router.push(`/system/ls2/${v.unitId}`)} className="border-b border-slate-100 hover:bg-slate-50 cursor-pointer">
                    <td className="px-4 py-3 font-medium text-slate-800 whitespace-nowrap">{v.plate || v.name}</td>
                    <td className="px-4 py-3 text-slate-600 whitespace-nowrap">{v.driver || '—'}</td>
                    <td className="px-4 py-3"><span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-medium ${st.bg} ${st.text}`}><span className={`w-1.5 h-1.5 rounded-full ${st.dot}`} />{lang === 'ar' ? st.ar : st.en}</span></td>
                    <td className="px-4 py-3 text-end tabular-nums">{v.speed != null ? `${v.speed}` : '—'}</td>
                    <td className={`px-4 py-3 text-end tabular-nums font-medium ${v.maxTireTempC != null ? '' : 'text-slate-300'}`}>{v.maxTireTempC != null ? <span className={`px-2 py-0.5 rounded-full text-xs ${tireTempColor(v.maxTireTempC)}`}>{v.maxTireTempC}°C</span> : '—'}</td>
                    <td className={`px-4 py-3 text-end tabular-nums font-medium ${coolantColor(v.coolantC)}`}>{v.coolantC != null ? `${v.coolantC}°C` : '—'}</td>
                    <td className="px-4 py-3 text-end tabular-nums text-slate-600">{fmtKm(v.odometerKm)}</td>
                    <td className="px-4 py-3 text-center">{v.activeAlertCount > 0 ? <span className={`px-2 py-0.5 rounded-full text-xs font-bold ${sv.bg} ${sv.text}`}>{v.activeAlertCount}</span> : <span className="text-slate-300">0</span>}</td>
                    <td className="px-4 py-3 text-slate-400 text-xs whitespace-nowrap">{timeAgo(v.lastMessageAt, lang as Lang)}</td>
                    <td className="px-4 py-3">
                      {v.position && <a href={osmLink(v.position.lat, v.position.lng)} target="_blank" rel="noopener noreferrer" onClick={(e) => e.stopPropagation()} className="text-slate-400 hover:text-[#f37121]" title={t.openInMap}><MapPin className="w-4 h-4" /></a>}
                    </td>
                  </tr>
                );
              })}
              {filtered.length === 0 && <tr><td colSpan={10} className="text-center text-slate-400 py-10">{t.noData}</td></tr>}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
