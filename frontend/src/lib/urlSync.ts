/**
 * Update the URL without navigation.
 * Screens write their filter and search into the URL so the link can be sent and refresh works. They used `router.replace`, which is a full navigation in the Next router: it re-renders the path segment, the screen drops to the Suspense boundary, shows the empty screen and comes back, and the cycle repeats with each search character. This writes the URL without that.
 */
export function syncUrl(path: string, params: URLSearchParams | Record<string, string | number | null | undefined>) {
  if (typeof window === 'undefined') return;
  const p = params instanceof URLSearchParams
    ? params
    : new URLSearchParams(
      Object.entries(params)
        .filter(([, v]) => v !== '' && v != null)
        .map(([k, v]) => [k, String(v)]),
    );
  const qs = p.toString();
  const next = `${path}${qs ? `?${qs}` : ''}`;
  if (window.location.pathname + window.location.search === next) return;
  window.history.replaceState(null, '', next);
}
