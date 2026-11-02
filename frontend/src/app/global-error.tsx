'use client';
/**
 * Last-resort guard for an error in the root layout itself.
 * The `/system` guard covers screens; this covers what happens before them, so Next's generic message is never shown.
 */
import { useEffect } from 'react';

export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    const s = `${error?.name || ''} ${error?.message || ''}`;
    // New deploy with a stale tab: one reload is enough. See system/error.
    if (/ChunkLoadError|Loading chunk|dynamically imported module/i.test(s)) {
      let last = 0;
      try { last = Number(sessionStorage.getItem('chunk-reload-at') || 0); } catch { /* */ }
      if (Date.now() - last > 60000) {
        try { sessionStorage.setItem('chunk-reload-at', String(Date.now())); } catch { /* */ }
        window.location.reload();
      }
    }
  }, [error]);

  return (
    <html lang="ar" dir="rtl">
      <body style={{ fontFamily: 'system-ui, sans-serif', padding: 40, textAlign: 'center' }}>
        <h2 style={{ fontSize: 18, fontWeight: 700, color: '#0f172a' }}>حدث خطأ غير متوقع</h2>
        <p style={{ fontSize: 13, color: '#64748b', marginTop: 8 }}>{error?.message || ''}</p>
        <button type="button" onClick={reset}
          style={{ marginTop: 20, padding: '10px 18px', borderRadius: 8, background: '#f37121', color: '#fff', border: 0, fontSize: 14 }}>
          إعادة المحاولة
        </button>
      </body>
    </html>
  );
}
