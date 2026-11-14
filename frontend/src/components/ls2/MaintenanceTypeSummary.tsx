'use client';
// Compact rows for the three non-periodic maintenance types under a truck's service plan: count, last date, total cost
// and the latest entry. A row scrolls to that type's card in the maintenance record below.
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { MAINTENANCE_TYPES, type Lang } from '@/lib/ls2';
import { useMaintenanceEntries } from './useMaintenanceEntries';
import { TYPE_ICON } from './MaintenanceRecords';

const money = (n?: number | null) => Number(n || 0).toLocaleString('en-US', { maximumFractionDigits: 0 });

export default function MaintenanceTypeSummary({ unitId, lang, isRTL }: { unitId: number; lang: Lang; isRTL: boolean }) {
  const ar = lang === 'ar';
  const { summary } = useMaintenanceEntries(unitId);
  const Chevron = isRTL ? ChevronLeft : ChevronRight;
  return (
    <div className="mt-4 pt-3 border-t border-slate-100 space-y-1.5">
      <p className="text-xs font-semibold text-slate-700">{ar ? 'الصيانة غير الدورية' : 'Non-periodic maintenance'}</p>
      {MAINTENANCE_TYPES.filter((m) => m.key !== 'periodic').map((m) => {
        const s = summary[m.key];
        const Icon = TYPE_ICON[m.key];
        return (
          <button key={m.key} type="button"
            onClick={() => document.getElementById(`maint-${m.key}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' })}
            className="w-full text-start border border-slate-100 hover:border-slate-300 rounded-lg px-3 py-2 flex items-center gap-2.5">
            <span className={`w-7 h-7 rounded-lg flex items-center justify-center shrink-0 border ${m.cls}`}><Icon className="w-3.5 h-3.5" /></span>
            <div className="min-w-0 flex-1">
              <div className="flex items-center justify-between gap-2">
                <span className="text-sm font-medium text-slate-800">{ar ? m.ar : m.en}</span>
                <span className="text-sm font-bold tabular-nums text-slate-900">{money(s.total)} <span className="text-[10px] font-normal text-slate-500">{ar ? 'ر.س' : 'SAR'}</span></span>
              </div>
              <p className="text-[11px] text-slate-600 truncate tabular-nums">
                {s.count} {ar ? 'سجل' : 'entries'}{s.last ? ` · ${ar ? 'آخرها' : 'last'} ${s.lastDate} — ${s.last.title || ''}` : ` · ${ar ? 'لا سجلات' : 'none yet'}`}
              </p>
            </div>
            <Chevron className="w-4 h-4 text-slate-400 shrink-0" />
          </button>
        );
      })}
    </div>
  );
}
