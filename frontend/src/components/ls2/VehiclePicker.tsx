'use client';
// Pick a truck out of the fleet by typing — 57 vehicles is far too many to scroll.
// Matches on plate, unit name, driver or unit id.
import { useState, useMemo, useEffect, useRef } from 'react';
import { Search, Truck, X } from 'lucide-react';
import { fmtKm, type Lang, type Vehicle } from '@/lib/ls2';

export default function VehiclePicker({
  vehicles, lang, isRTL, onPick, onClose,
}: {
  vehicles: Vehicle[];
  lang: Lang;
  isRTL: boolean;
  onPick: (v: Vehicle) => void;
  onClose: () => void;
}) {
  const ar = lang === 'ar';
  const [q, setQ] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => { inputRef.current?.focus(); }, []);

  const rows = useMemo(() => {
    const term = q.trim().toLowerCase();
    if (!term) return vehicles;
    return vehicles.filter((v) =>
      [v.plate, v.name, v.driver, String(v.unitId)].some((x) => (x || '').toLowerCase().includes(term))
    );
  }, [vehicles, q]);

  return (
    <div className="fixed inset-0 z-[9999] flex items-start justify-center bg-black/40 p-4 pt-[10vh]" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-md flex flex-col max-h-[70vh]" dir={isRTL ? 'rtl' : 'ltr'} onClick={(e) => e.stopPropagation()}>
        <div className="p-4 border-b border-slate-100">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-bold text-slate-900 flex items-center gap-2"><Truck className="w-4 h-4 text-[#f37121]" /> {ar ? 'اختر المركبة' : 'Select vehicle'}</h3>
            <button type="button" onClick={onClose} className="p-1 rounded-lg text-slate-400 hover:bg-slate-100"><X className="w-4 h-4" /></button>
          </div>
          <div className="relative">
            <Search className="w-4 h-4 text-slate-400 absolute top-1/2 -translate-y-1/2 start-3" />
            <input ref={inputRef} value={q} onChange={(e) => setQ(e.target.value)}
              placeholder={ar ? 'ابحث برقم اللوحة أو السائق…' : 'Search by plate or driver…'}
              className="w-full ps-9 pe-3 py-2 rounded-lg border border-slate-200 text-sm text-slate-800" />
          </div>
        </div>
        <div className="overflow-y-auto p-2">
          {rows.map((v) => (
            <button key={v.unitId} type="button" onClick={() => onPick(v)}
              className="w-full text-start px-3 py-2.5 rounded-lg hover:bg-slate-50 flex items-center justify-between gap-3">
              <div className="min-w-0">
                <p className="text-sm font-medium text-slate-800 truncate">{v.plate || v.name}</p>
                <p className="text-[11px] text-slate-500 truncate">{v.driver || (ar ? 'بدون سائق' : 'No driver')}</p>
              </div>
              <span className="text-[11px] text-slate-500 tabular-nums shrink-0">{fmtKm(v.odometerKm)}</span>
            </button>
          ))}
          {rows.length === 0 && <p className="text-sm text-slate-400 text-center py-8">{ar ? 'لا توجد نتائج' : 'No matches'}</p>}
        </div>
      </div>
    </div>
  );
}
