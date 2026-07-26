'use client';
// Temperature — the two heat risks on a heavy truck: tire surface temperature and
// engine coolant. Each list is sorted hottest-first and colour-coded against the
// configured thresholds; click a row to open the vehicle.
import { useState, useEffect, useCallback, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/context/AuthContext';
import { useLanguage } from '@/context/LanguageContext';
import { useSocket } from '@/hooks/useSocket';
import api from '@/lib/api';
import { Thermometer, Flame, RefreshCw } from 'lucide-react';
import { Spinner, PageHeader } from '@/components/hr/HRKit';
import ExportMenu, { type ExportColumn } from '@/components/ls2/ExportMenu';
import { ls2Text, isLs2Staff, tireTempColor, coolantColor, type Lang, type Vehicle } from '@/lib/ls2';

export default function Ls2TemperaturePage() {
  const { user } = useAuth();
  const { lang, isRTL } = useLanguage();
  const router = useRouter();
  const t = ls2Text(lang as Lang);
  const [items, setItems] = useState<Vehicle[]>([]);
  const [th, setTh] = useState<any>({ tireTempC: 75, tireTempCriticalC: 85, coolantTempC: 100, coolantTempCriticalC: 110 });
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const [v, s] = await Promise.all([
        api.get<{ items: Vehicle[] }>('/api/ls2/vehicles'),
        api.get<{ thresholds: any }>('/api/ls2/settings').catch(() => null),
      ]);
      setItems(v.items || []);
      if (s?.thresholds) setTh(s.thresholds);
    } catch { /* keep */ }
    setLoading(false);
  }, []);
  useEffect(() => { load(); }, [load]);
  useSocket('ls2:updated', useCallback(() => load(), [load]));

  const tireRows = useMemo(() => items.filter((v) => v.maxTireTempC != null).sort((a, b) => (b.maxTireTempC || 0) - (a.maxTireTempC || 0)), [items]);
  const engineRows = useMemo(() => items.filter((v) => v.coolantC != null).sort((a, b) => (b.coolantC || 0) - (a.coolantC || 0)), [items]);

  const ar = lang === 'ar';
  const exportColumns: ExportColumn[] = [
    { header: ar ? 'اللوحة' : 'Plate', key: 'plate', transform: (v, row) => v || row.name || '' },
    { header: ar ? 'السائق' : 'Driver', key: 'driver', transform: (v) => v ?? '' },
    { header: ar ? 'حرارة الموتور °م' : 'Coolant °C', key: 'coolantC', transform: (v) => v ?? '' },
    { header: ar ? 'أقصى حرارة كاوتش' : 'Max Tire Temp °C', key: 'maxTireTempC', transform: (v) => v ?? '' },
    { header: ar ? 'أقل حرارة كاوتش' : 'Min Tire Temp °C', key: 'minTireTempC', transform: (v) => v ?? '' },
    { header: ar ? 'أقصى ضغط' : 'Max Pressure psi', key: 'maxTirePressurePsi', transform: (v) => v ?? '' },
    { header: ar ? 'أقل ضغط' : 'Min Pressure psi', key: 'minTirePressurePsi', transform: (v) => v ?? '' },
    { header: ar ? 'أعطال حساسات' : 'Sensor Faults', key: 'tireFaults', transform: (v) => v ?? '' },
    { header: ar ? 'الحالة' : 'Status', key: 'status', transform: (v) => v ?? '' },
  ];
  const exportOptions = [
    { key: 'all', label: ar ? 'كل العربيات' : 'All vehicles', sheets: [{ name: ar ? 'الحرارة' : 'Temperature', rows: items, columns: exportColumns }] },
  ];

  if (!isLs2Staff(user)) return <div className="text-slate-500 p-8">{t.notAuthorized}</div>;
  if (loading && !items.length) return <Spinner />;

  const go = (id: number) => router.push(`/system/ls2/${id}`);

  return (
    <div className="space-y-5" dir={isRTL ? 'rtl' : 'ltr'}>
      <PageHeader icon={<Thermometer className="w-5 h-5" />} title={t.temperature} subtitle={t.live}>
        <ExportMenu fileName="ls2-temperature" lang={lang as Lang} options={exportOptions} />
        <button type="button" onClick={() => load()} className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 text-sm"><RefreshCw className="w-4 h-4" /> {t.refresh}</button>
      </PageHeader>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        {/* Tire temperature */}
        <div className="bg-white border border-slate-200 rounded-xl overflow-hidden shadow-sm">
          <div className="px-5 py-3 border-b border-slate-100 flex items-center gap-2">
            <Flame className="w-4 h-4 text-orange-600" />
            <h2 className="text-sm font-semibold text-slate-900">{t.maxTireTemp}</h2>
            <span className="ms-auto text-xs text-slate-400">{lang === 'ar' ? `تحذير ≥ ${th.tireTempC}° · حرِج ≥ ${th.tireTempCriticalC}°` : `warn ≥ ${th.tireTempC}° · crit ≥ ${th.tireTempCriticalC}°`}</span>
          </div>
          <div className="divide-y divide-slate-100 max-h-[560px] overflow-y-auto">
            {tireRows.map((v) => (
              <button key={v.unitId} type="button" onClick={() => go(v.unitId)} className="w-full text-start px-5 py-2.5 flex items-center justify-between gap-3 hover:bg-slate-50">
                <div className="min-w-0"><p className="text-sm text-slate-800 font-medium truncate">{v.plate}</p><p className="text-xs text-slate-400 truncate">{v.driver}</p></div>
                <span className={`shrink-0 px-2.5 py-1 rounded-full text-sm font-bold ${tireTempColor(v.maxTireTempC, th.tireTempC, th.tireTempCriticalC)}`}>{v.maxTireTempC}°C</span>
              </button>
            ))}
            {tireRows.length === 0 && <p className="text-slate-400 text-sm py-8 text-center">{t.noData}</p>}
          </div>
        </div>

        {/* Engine coolant */}
        <div className="bg-white border border-slate-200 rounded-xl overflow-hidden shadow-sm">
          <div className="px-5 py-3 border-b border-slate-100 flex items-center gap-2">
            <Thermometer className="w-4 h-4 text-red-600" />
            <h2 className="text-sm font-semibold text-slate-900">{t.engineCoolant}</h2>
            <span className="ms-auto text-xs text-slate-400">{lang === 'ar' ? `تحذير ≥ ${th.coolantTempC}° · حرِج ≥ ${th.coolantTempCriticalC}°` : `warn ≥ ${th.coolantTempC}° · crit ≥ ${th.coolantTempCriticalC}°`}</span>
          </div>
          <div className="divide-y divide-slate-100 max-h-[560px] overflow-y-auto">
            {engineRows.map((v) => (
              <button key={v.unitId} type="button" onClick={() => go(v.unitId)} className="w-full text-start px-5 py-2.5 flex items-center justify-between gap-3 hover:bg-slate-50">
                <div className="min-w-0"><p className="text-sm text-slate-800 font-medium truncate">{v.plate}</p><p className="text-xs text-slate-400 truncate">{v.driver}</p></div>
                <span className={`shrink-0 text-lg font-bold tabular-nums ${coolantColor(v.coolantC, th.coolantTempC, th.coolantTempCriticalC)}`}>{v.coolantC}°C</span>
              </button>
            ))}
            {engineRows.length === 0 && <p className="text-slate-400 text-sm py-8 text-center">{t.noData}</p>}
          </div>
        </div>
      </div>
    </div>
  );
}
