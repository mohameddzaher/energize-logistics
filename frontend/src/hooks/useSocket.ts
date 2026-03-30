'use client';
import { useEffect, useCallback } from 'react';
import { getSocket } from '@/lib/socket';
import { useAuth } from '@/context/AuthContext';

export function useSocket(event: string, callback: (data: any) => void) {
  const { isAuthenticated } = useAuth();

  useEffect(() => {
    if (!isAuthenticated) return;

    const socket = getSocket();
    socket.on(event, callback);

    return () => {
      socket.off(event, callback);
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
