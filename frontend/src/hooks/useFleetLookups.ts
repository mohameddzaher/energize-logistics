'use client';
// Fetches the fleet lookup lists (rental/payment/load type) once and returns a function mapping the stored key (forward/general...) to its label in the UI language, so raw keys do not show in lists and tables.
import { useState, useEffect, useCallback } from 'react';
import api from '@/lib/api';
import { useSocket } from '@/hooks/useSocket';

type Opt = { ar: string; en: string };
const TYPES = ['fleet_rent_type', 'fleet_payment_type', 'fleet_load_type', 'fleet_followup_note'];

export function useFleetLookups(ar: boolean) {
  const [map, setMap] = useState<Record<string, Record<string, Opt>>>({});

  const load = useCallback(async () => {
    const out: Record<string, Record<string, Opt>> = {};
    await Promise.all(TYPES.map(async (t) => {
      try {
        const d = await api.get<{ items: { key: string; nameAr: string; nameEn: string }[] }>(`/api/lookups?type=${t}`);
        out[t] = Object.fromEntries((d.items || []).map((i) => [i.key, { ar: i.nameAr, en: i.nameEn }]));
      } catch { /* keep */ }
    }));
    setMap(out);
  }, []);

  useEffect(() => { load(); }, [load]);
  useSocket('lookup:changed', useCallback(() => load(), [load]));

  // (type, key) → localized name; falls back to the key so nothing renders blank.
  const label = useCallback((type: string, key?: string | null) => {
    if (!key) return '';
    const it = map[type]?.[key];
    return it ? (ar ? it.ar || it.en : it.en || it.ar) : key;
  }, [map, ar]);

  /**
   * All options of a list in order, not just a key translation.
   * Follow-up notes are shown as quick buttons, not a dropdown, so they need the full list. Returns empty until the fetch arrives, so buttons are not shown and then replaced.
   */
  const options = useCallback((type: string): { key: string; label: string }[] => {
    const m = map[type];
    if (!m) return [];
    return Object.entries(m).map(([key, v]) => ({ key, label: ar ? v.ar || v.en : v.en || v.ar }));
  }, [map, ar]);

  return Object.assign(label, { options });
}
