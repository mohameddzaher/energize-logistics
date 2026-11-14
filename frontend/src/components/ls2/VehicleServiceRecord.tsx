'use client';
// The complete maintenance record of one truck: open deferred tasks, then one card per maintenance type
// (periodic with each visit's checklist, preventive, roadside, accident) read from the maintenance ledger.
import { useState, useEffect, useCallback } from 'react';
import { Clock } from 'lucide-react';
import api from '@/lib/api';
import { useSocket } from '@/hooks/useSocket';
import MaintenanceRecords from '@/components/ls2/MaintenanceRecords';
import DeferralActionModal from '@/components/ls2/DeferralActionModal';
import DeferralCard from '@/components/ls2/DeferralCard';
import { ls2Text, type Lang, type Deferral } from '@/lib/ls2';

export default function VehicleServiceRecord({
  unitId, plate, currentOdo, lang, isRTL, admin,
}: {
  unitId: number;
  plate?: string;
  currentOdo?: number | null;
  lang: Lang;
  isRTL: boolean;
  admin: boolean;
}) {
  const ar = lang === 'ar';
  const t = ls2Text(lang);
  const [deferrals, setDeferrals] = useState<Deferral[]>([]);
  const [settle, setSettle] = useState<Deferral | null>(null); // deferral being settled

  const load = useCallback(async () => {
    try {
      const r = await api.get<{ deferrals: Deferral[] }>(`/api/ls2/vehicles/${unitId}/maintenance`);
      setDeferrals(r.deferrals || []);
    } catch { /* keep */ }
  }, [unitId]);
  useEffect(() => { load(); }, [load]);
  useSocket('ls2:updated', useCallback((d: any) => { if (!d?.vehicles) load(); }, [load]));

  return (
    <>
      {/* Deferred tasks — inspected, granted extra km, not yet done */}
      {deferrals.length > 0 && (
        <div className="bg-white border border-amber-200 rounded-xl shadow-sm overflow-hidden">
          <h2 className="text-sm font-semibold text-slate-900 flex items-center gap-2 px-5 py-3 border-b border-amber-100 bg-amber-50">
            <Clock className="w-4 h-4 text-amber-600" /> {t.openDeferrals} ({deferrals.length})
          </h2>
          <div className="p-3 space-y-2.5 bg-slate-50/60">
            {deferrals.map((d) => (
              <DeferralCard
                key={`${d.logId}-${d.label}`}
                d={d} lang={lang} admin={admin}
                currentOdoFallback={currentOdo}
                onSettle={() => setSettle(d)}
              />
            ))}
          </div>
        </div>
      )}

      {/* One card per maintenance type with its full history; older service logs and repairs appear under their type. */}
      <MaintenanceRecords
        unitId={unitId} plate={plate} currentOdo={currentOdo} lang={lang} isRTL={isRTL} admin={admin} layout="cards"
        periodic={<p className="text-xs text-slate-600">{ar ? 'تُسجَّل الصيانة الدورية من بطاقات «خطة الصيانة» أعلاه («تم عمل الصيانة»).' : 'Periodic services are registered from the service-plan cards above (“Mark serviced”).'}</p>}
      />

      {settle && (
        <DeferralActionModal
          deferral={settle} unitId={unitId} currentOdo={currentOdo}
          lang={lang} isRTL={isRTL}
          onClose={() => setSettle(null)}
          onDone={() => { setSettle(null); load(); }}
        />
      )}
    </>
  );
}
