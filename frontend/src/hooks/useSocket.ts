'use client';
import { useEffect, useCallback } from 'react';
import { getSocket } from '@/lib/socket';
import { useAuth } from '@/context/AuthContext';

/**
 * Refresh notices are not handled while the screen is off.
 * Notices to re-read arrive every few seconds (operations platform sync). A background tab or a phone in a pocket used to fetch the payload for each, wasting data and battery. They are deferred: a flag marks that a change happened and it runs once when the screen returns. Non-refresh events such as notifications and chat messages pass through unchanged.
 */
const DEFERRABLE = /(:changed|:updated|:created|:deleted|:bulkImported|^workflow:|^ops:|^vreg:|^ls2:|^fleet:|^customs:|^collections:|^b2c:|^hr:|^finance:|^executive:|^br:|^vendors:|^shipmentRequests:)/;

export function useSocket(event: string, callback: (data: any) => void) {
  const { isAuthenticated } = useAuth();

  useEffect(() => {
    if (!isAuthenticated) return undefined;

    const socket = getSocket();
    const deferrable = DEFERRABLE.test(event);
    let pending: any = null;

    const run = (data: any) => callback(data);
    const handler = (data: any) => {
      if (deferrable && typeof document !== 'undefined' && document.hidden) { pending = data ?? {}; return; }
      run(data);
    };
    const onVisible = () => {
      if (typeof document === 'undefined' || document.hidden || pending === null) return;
      const data = pending;
      pending = null;
      run(data);
    };

    socket.on(event, handler);
    if (deferrable && typeof document !== 'undefined') document.addEventListener('visibilitychange', onVisible);
    // Changes made while the connection was down were never pushed: after a reconnect, a refresh-type listener re-reads once.
    const onReconnect = () => { if (deferrable) handler({ reconnected: true }); };
    socket.io.on('reconnect', onReconnect);

    return () => {
      socket.off(event, handler);
      socket.io.off('reconnect', onReconnect);
      if (deferrable && typeof document !== 'undefined') document.removeEventListener('visibilitychange', onVisible);
    };
  }, [event, callback, isAuthenticated]);
}

export function useRealTimeRefresh(events: string[], refetchFn: () => void) {
  const stableRefetch = useCallback(refetchFn, [refetchFn]);

  useEffect(() => {
    const socket = getSocket();
    if (!socket.connected) return;

    events.forEach((event) => {
      socket.on(event, stableRefetch);
    });

    return () => {
      events.forEach((event) => {
        socket.off(event, stableRefetch);
      });
    };
  }, [events, stableRefetch]);
}
