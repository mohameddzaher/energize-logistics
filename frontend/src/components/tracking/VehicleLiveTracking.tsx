'use client';
/** Live position and route of a register vehicle, shown on its profile when an Express GPS unit tracks it; nothing otherwise. */
import { useEffect, useState } from 'react';
import { Navigation } from 'lucide-react';
import api from '@/lib/api';
import TrackingScreen, { type Unit } from './TrackingScreen';

export default function VehicleLiveTracking({ vehicleId, ar }: { vehicleId: string; ar: boolean }) {
  const [unit, setUnit] = useState<Unit | null>(null);
  const [open, setOpen] = useState(true);
  useEffect(() => {
    let dead = false;
    api.get<{ unit: Unit | null }>(`/api/vehicles/tracking/by-vehicle/${vehicleId}`).then((d) => { if (!dead) setUnit(d.unit); }).catch(() => {});
    return () => { dead = true; };
  }, [vehicleId]);
  if (!unit) return null;
  return (
    <div className="rounded-2xl border border-emerald-200 bg-emerald-50/40 p-3.5">
      <button type="button" onClick={() => setOpen((o) => !o)} className="w-full flex items-center justify-between gap-2 mb-2">
        <span className="flex items-center gap-2 font-bold text-slate-800"><Navigation className="w-4 h-4 text-emerald-600" />{ar ? 'التتبّع المباشر وخط السير' : 'Live tracking & route'}</span>
        <span className="text-xs text-slate-500">{open ? (ar ? 'إخفاء' : 'Hide') : (ar ? 'إظهار' : 'Show')}</span>
      </button>
      {open && <TrackingScreen base="/api/vehicles/tracking" ar={ar} only={unit} />}
    </div>
  );
}
