'use client';
import { useRef, useCallback, useMemo } from 'react';

/**
 * Latest-request guard: an old response never overwrites a newer one.
 * A server-filtered, live-updated table fires several requests at once (a search changes the text and resets to page 1, so a request with the new search and old page returns empty, racing a socket refresh). The network does not preserve order, so the last to arrive wins.
 * Usage: const mine = guard.begin(); await ...; if (!guard.isCurrent(mine)) return;
 */
export function useLatestRequest() {
  const seq = useRef(0);
  const begin = useCallback(() => ++seq.current, []);
  const isCurrent = useCallback((token: number) => token === seq.current, []);
  return useMemo(() => ({ begin, isCurrent }), [begin, isCurrent]);
}

export default useLatestRequest;
