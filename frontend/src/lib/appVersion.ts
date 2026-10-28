/**
 * Detects that a newer build is live while this tab still runs an older one.
 * The bundle carries its build id (next.config → NEXT_PUBLIC_BUILD_ID); the
 * server reports the build it is running (/app-version).
 */
const MINE = process.env.NEXT_PUBLIC_BUILD_ID || '';

/** The live build id when it differs from this tab's, otherwise ''. */
export async function newerBuild(): Promise<string> {
  if (!MINE || typeof window === 'undefined') return '';
  try {
    const r = await fetch('/app-version', { cache: 'no-store' });
    if (!r.ok) return '';
    const { id } = await r.json();
    return id && id !== MINE ? String(id) : '';
  } catch { return ''; }
}

export async function isOutdated(): Promise<boolean> {
  return !!(await newerBuild());
}

const RELOADED_FOR = 'version-reloaded-for';

/**
 * Reload at most once per new build. If the reload still lands on an old build
 * (a deploy in progress), the tab does not reload again for that same build —
 * which is what turned a deploy into a reload loop.
 */
export function reloadOnceFor(buildId: string): boolean {
  if (!buildId) return false;
  try {
    if (sessionStorage.getItem(RELOADED_FOR) === buildId) return false;
    sessionStorage.setItem(RELOADED_FOR, buildId);
  } catch { return false; }
  window.location.reload();
  return true;
}

/** Used by the error screen: one silent reload when a newer build is live. */
export async function reloadIfNewer(): Promise<boolean> {
  const id = await newerBuild();
  return id ? reloadOnceFor(id) : false;
}
