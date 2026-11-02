'use client';
/**
 * Shipment statuses as currently configured, read by every screen in the section.
 * Label, colour, order and usage are set in section settings; the keys are in code (backend/src/utils/shipmentOrderStatuses). Starts from the built-in list so the screen renders fully from the first frame, then the server corrects any renamed label.
 */
import { useState, useEffect, useCallback } from 'react';
import api from '@/lib/api';
import { useSocket } from '@/hooks/useSocket';
import { FALLBACK_STATUS_VOCAB, type StatusVocab } from '@/lib/shipmentOrders';

export function useOrderStatuses(includeInactive = false) {
  const [statuses, setStatuses] = useState<StatusVocab[]>(FALLBACK_STATUS_VOCAB);

  const load = useCallback(() => {
    api.get<{ statuses: StatusVocab[] }>(`/api/shipment-orders/statuses${includeInactive ? '?all=1' : ''}`)
      .then((d) => { if (d?.statuses?.length) setStatuses(d.statuses); })
      .catch(() => {});
  }, [includeInactive]);

  useEffect(() => { load(); }, [load]);
  // Edited from the settings page, so changes arrive here at once without a reload.
  useSocket('lookup:changed', useCallback((p: any) => {
    if (!p?.type || p.type === 'so_status') load();
  }, [load]));

  return statuses;
}
