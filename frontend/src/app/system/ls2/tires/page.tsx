'use client';
// Tires — per-axle tire pressure & temperature across the fleet. Table sorted by
// hottest tire. Click a row to open the vehicle's full detail page; use the
// chevron to peek at the axle-by-axle layout inline without leaving the list.
import { useState, useEffect, useCallback, useMemo, Fragment } from 'react';
import { useAuth } from '@/context/AuthContext';
import { useLanguage } from '@/context/LanguageContext';
import { useSocket } from '@/hooks/useSocket';
import { useRouter } from 'next/navigation';
import api from '@/lib/api';
import { Activity, RefreshCw, AlertTriangle, ChevronDown, ChevronRight } from 'lucide-react';
import { Spinner, PageHeader } from '@/components/hr/HRKit';
import { ls2Text, isLs2Staff, tireTempColor, type Lang, type Vehicle, type Tire } from '@/lib/ls2';

export default function Ls2TiresPage() {
  const { user } = useAuth();
  const { lang, isRTL } = useLanguage();
  const router = useRouter();
  const t = ls2Text(lang as Lang);
  const [items, setItems] = useState<Vehicle[]>([]);
  const [loading, setLoading] = useState(true);
  const [problemsOnly, setProblemsOnly] = useState(false);
  const [expanded, setExpanded] = useState<number | null>(null);

  const load = useCallback(async () => {
    try { const res = await api.get<{ items: Vehicle[] }>('/api/ls2/vehicles'); setItems(res.items || []); } catch { /* keep */ }
    setLoading(false);
  }, []);
  useEffect(() => { load(); }, [load]);
  useSocket('ls2:updated', useCallback(() => load(), [load]));

  const rows = useMemo(() => {
    let r = [...items];
    if (problemsOnly) r = r.filter((v) => (v.maxTireTempC != null && v.maxTireTempC >= 75) || (v.minTirePressurePsi != null && v.minTirePressurePsi < 90) || v.tireFaults > 0);
    return r.sort((a, b) => (b.maxTireTempC || 0) - (a.maxTireTempC || 0));
  }, [items, problemsOnly]);

  if (!isLs2Staff(user?.role)) return <div className="text-slate-500 p-8">{t.notAuthorized}</div>;
  if (loading && !items.length) return <Spinner />;

  const open = (id: number) => router.push(`/system/ls2/${id}`);
  const toggle = (id: number, e: React.MouseEvent) => { e.stopPropagation(); setExpanded((p) => (p === id ? null : id)); };

  return (
    <div className="space-y-5" dir={isRTL ? 'rtl' : 'ltr'}>
      <PageHeader icon={<Activity className="w-5 h-5" />} title={t.tires} subtitle={lang === 'ar' ? `${rows.length} مركبة · اضغط على مركبة لفتح صفحتها الكاملة` : `${rows.length} vehicles · click a vehicle to open its full page`}>
        <label className="flex items-center gap-2 text-sm text-slate-600"><input type="checkbox" checked={problemsOnly} onChange={(e) => setProblemsOnly(e.target.checked)} /> {lang === 'ar' ? 'المشاكل فقط' : 'Problems only'}</label>
        <button type="button" onClick={() => load()} className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 text-sm"><RefreshCw className="w-4 h-4" /> {t.refresh}</button>
      </PageHeader>

      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-slate-900 text-slate-300 text-xs">
                <th className="px-3 py-3" />
                <th className="text-start font-semibold px-4 py-3">{t.plate}</th>
                <th className="text-start font-semibold px-4 py-3">{t.driver}</th>
                <th className="text-center font-semibold px-4 py-3">{lang === 'ar' ? 'عدد الكاوتش' : 'Tires'}</th>
                <th className="text-end font-semibold px-4 py-3">{t.maxTireTemp}</th>
                <th className="text-end font-semibold px-4 py-3">{lang === 'ar' ? 'أقل ضغط' : 'Min Pressure'}</th>
                <th className="text-center font-semibold px-4 py-3">{t.faults}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((v) => (
                <Fragment key={v.unitId}>
                  <tr onClick={() => open(v.unitId)} className="border-b border-slate-100 hover:bg-slate-50 cursor-pointer">
                    <td className="px-3 py-3"><button type="button" onClick={(e) => toggle(v.unitId, e)} className="text-slate-400 hover:text-[#f37121]" aria-label="expand">{expanded === v.unitId ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className={`w-4 h-4 ${isRTL ? 'rotate-180' : ''}`} />}</button></td>
                    <td className="px-4 py-3 font-medium text-slate-800 whitespace-nowrap">{v.plate || v.name}</td>
                    <td className="px-4 py-3 text-slate-600 whitespace-nowrap">{v.driver || '—'}</td>
                    <td className="px-4 py-3 text-center text-slate-600">{v.tireCount || 0}</td>
                    <td className="px-4 py-3 text-end">{v.maxTireTempC != null ? <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${tireTempColor(v.maxTireTempC)}`}>{v.maxTireTempC}°C</span> : '—'}</td>
                    <td className={`px-4 py-3 text-end tabular-nums font-medium ${v.minTirePressurePsi != null && v.minTirePressurePsi < 90 ? 'text-amber-600' : 'text-slate-600'}`}>{v.minTirePressurePsi != null ? `${v.minTirePressurePsi} psi` : '—'}</td>
                    <td className="px-4 py-3 text-center">{v.tireFaults > 0 ? <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs bg-slate-100 text-slate-600"><AlertTriangle className="w-3 h-3" />{v.tireFaults}</span> : <span className="text-slate-300">0</span>}</td>
                  </tr>
                  {expanded === v.unitId && (
                    <tr className="border-b border-slate-100 bg-slate-50/60">
                      <td colSpan={7} className="px-6 py-4"><TireLayout tires={v.tires} t={t} lang={lang as Lang} /></td>
                    </tr>
                  )}
                </Fragment>
              ))}
              {rows.length === 0 && <tr><td colSpan={7} className="text-center text-slate-400 py-10">{t.noData}</td></tr>}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function TireLayout({ tires, t, lang }: { tires: Tire[]; t: any; lang: Lang }) {
  if (!tires || tires.length === 0) return <p className="text-slate-400 text-sm py-2 text-center">{t.noTireData}</p>;
  const axles = [...new Set(tires.map((x) => x.axle))].sort((a, b) => a - b);
  return (
    <div className="space-y-3">
      {axles.map((axle) => {
        const row = tires.filter((x) => x.axle === axle).sort((a, b) => a.position - b.position);
        return (
          <div key={axle} className="flex items-center gap-3">
            <span className="w-16 shrink-0 text-xs font-semibold text-slate-500">{t.axle} {axle}</span>
            <div className="flex flex-wrap gap-2">
              {row.map((tire) => (
                <div key={`${axle}-${tire.position}`} className={`rounded-lg px-3 py-2 min-w-[92px] text-center border ${tire.fault ? 'bg-slate-50 border-slate-200 text-slate-400' : `${tireTempColor(tire.tempC)} border-transparent`}`}>
                  <p className="text-[10px] opacity-70">{lang === 'ar' ? 'إطار' : 'Tire'} {tire.position}</p>
                  <p className="text-sm font-bold">{tire.fault ? (lang === 'ar' ? 'عطل' : 'Fault') : (tire.tempC != null ? `${tire.tempC}°C` : '—')}</p>
                  <p className="text-[10px] opacity-80">{tire.pressurePsi != null ? `${tire.pressurePsi} psi` : '—'}</p>
                </div>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}
