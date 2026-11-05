'use client';
/**
 * Last-resort guard for an error in the root or /system layout itself.
 * The `/system` guard covers screens; this covers what happens before them, so Next's generic message is never shown.
 * The common cause is a deploy: a page opened while the build was being swapped asks for code files the old server does not serve yet. Such an error is a chunk failure, so the page says the system is updating and reloads by itself a few times instead of leaving «حدث خطأ غير متوقع» on screen.
 * Every error is reported to /api/client-errors (as the /system guard does), so it shows in the server log.
 */
import { useEffect, useState } from 'react';

const CHUNK = /ChunkLoadError|Loading chunk|Loading CSS chunk|dynamically imported module|Failed to fetch|Importing a module script failed|error loading dynamically/i;
const TRIES_KEY = 'global-error-reloads';

export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const isChunk = CHUNK.test(`${error?.name || ''} ${error?.message || ''}`);
  const [updating, setUpdating] = useState(isChunk);

  useEffect(() => {
    try {
      const base = process.env.NEXT_PUBLIC_API_URL || '';
      fetch(`${base}/api/client-errors`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: error?.message || 'unknown',
          name: `global:${error?.name || ''}`,
          digest: error?.digest || '',
          stack: String(error?.stack || '').slice(0, 4000),
          path: typeof window !== 'undefined' ? window.location.pathname : '',
          userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : '',
        }),
      }).catch(() => {});
    } catch { /* Reporting never blocks the page. */ }

    if (!isChunk) return undefined;
    // Up to three reloads, a few seconds apart, within ten minutes: the restart takes seconds, and a loop is never possible.
    let state = { n: 0, at: 0 };
    try { state = JSON.parse(sessionStorage.getItem(TRIES_KEY) || '{"n":0,"at":0}'); } catch { /* */ }
    if (Date.now() - state.at > 10 * 60000) state = { n: 0, at: Date.now() };
    if (state.n >= 3) { setUpdating(false); return undefined; }
    const t = setTimeout(() => {
      try { sessionStorage.setItem(TRIES_KEY, JSON.stringify({ n: state.n + 1, at: state.at || Date.now() })); } catch { /* */ }
      window.location.reload();
    }, 2500 * (state.n + 1));
    return () => clearTimeout(t);
  }, [error, isChunk]);

  return (
    <html lang="ar" dir="rtl">
      <body style={{ fontFamily: 'system-ui, sans-serif', padding: 40, textAlign: 'center' }}>
        {updating ? (
          <>
            <h2 style={{ fontSize: 18, fontWeight: 700, color: '#0f172a' }}>النظام يتحدّث الآن</h2>
            <p style={{ fontSize: 13, color: '#64748b', marginTop: 8 }}>ستُعاد الصفحة تلقائيًا خلال ثوانٍ — لا تحتاج لفعل شيء.</p>
          </>
        ) : (
          <>
            <h2 style={{ fontSize: 18, fontWeight: 700, color: '#0f172a' }}>حدث خطأ غير متوقع</h2>
            <p style={{ fontSize: 13, color: '#64748b', marginTop: 8 }}>{error?.message || ''}</p>
          </>
        )}
        <button type="button" onClick={() => { try { sessionStorage.removeItem(TRIES_KEY); } catch { /* */ } if (isChunk) window.location.reload(); else reset(); }}
          style={{ marginTop: 20, padding: '10px 18px', borderRadius: 8, background: '#f37121', color: '#fff', border: 0, fontSize: 14 }}>
          إعادة المحاولة
        </button>
      </body>
    </html>
  );
}
