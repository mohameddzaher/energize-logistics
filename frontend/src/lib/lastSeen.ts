/** Last value this browser saw, shown instantly on page open and replaced when fresh data arrives. Operations platform numbers arrive after seconds and cards showed a dash on every open. Display only, not a source of truth. Every read and write is guarded because storage may be blocked (private window), and the page works without it. */
const PREFIX = 'lastSeen:';

export function readLastSeen<T>(key: string): T | null {
  try {
    const raw = typeof window !== 'undefined' ? window.localStorage.getItem(PREFIX + key) : null;
    return raw ? (JSON.parse(raw) as T) : null;
  } catch { return null; }
}

export function writeLastSeen<T>(key: string, value: T) {
  try { window.localStorage.setItem(PREFIX + key, JSON.stringify(value)); } catch { /* */ }
}
