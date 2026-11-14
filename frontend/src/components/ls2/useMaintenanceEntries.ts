'use client';
// One truck's maintenance ledger (records, older service logs and repairs, store issues) and its per-type summary.
// Re-read on every real write in the section (ls2:updated without the poller's `vehicles` pulse) and on store moves.
import { useCallback, useEffect, useMemo, useState } from 'react';
import api from '@/lib/api';
import { useSocket } from '@/hooks/useSocket';
import { useLatestRequest } from '@/hooks/useLatestRequest';
import { MAINTENANCE_TYPES, type MaintenanceEntry, type MaintenanceType } from '@/lib/ls2';

export type TypeSummary = { type: MaintenanceType; count: number; total: number; lastDate: string; last: MaintenanceEntry | null };

export function useMaintenanceEntries(unitId: number) {
  const [entries, setEntries] = useState<MaintenanceEntry[] | null>(null);
  const latest = useLatestRequest();
  const load = useCallback(async () => {
    const mine = latest.begin();
    try {
      const r = await api.get<{ entries: MaintenanceEntry[] }>(`/api/ls2/maintenance/entries?unitId=${unitId}&includeCancelled=1`);
      if (latest.isCurrent(mine)) setEntries(r.entries || []);
    } catch { if (latest.isCurrent(mine)) setEntries((p) => p || []); }
  }, [unitId, latest]);
  useEffect(() => { load(); }, [load]);
  useSocket('ls2:updated', useCallback((d: any) => { if (!d?.vehicles) load(); }, [load]));
  useSocket('ls2:store', useCallback(() => load(), [load]));

  const summary = useMemo(() => {
    const out = Object.fromEntries(MAINTENANCE_TYPES.map((m) => [m.key, { type: m.key, count: 0, total: 0, lastDate: '', last: null }])) as Record<MaintenanceType, TypeSummary>;
    for (const e of entries || []) {
      if (e.cancelled) continue;
      const s = out[e.type];
      if (!s) continue;
      s.count += 1;
      s.total += e.totalCost || 0;
      if (!s.last || e.date > s.lastDate) { s.lastDate = e.date; s.last = e; }
    }
    return out;
  }, [entries]);

  return { entries, summary, reload: load };
}
