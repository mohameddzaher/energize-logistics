/**
 * Keep-alive self-ping — for Render's free tier, which spins the service down
 * after ~15 min of inactivity. A cold start then takes 30-50s and the first
 * users hit 503 / "Request failed". This job pings our own public /api/health
 * a little more often than that window so the instance never idles out.
 *
 * URL resolution: Render injects RENDER_EXTERNAL_URL automatically. You can
 * override with KEEPALIVE_URL. If neither is set (e.g. local dev) it no-ops.
 * Disable entirely with KEEPALIVE_ENABLED=false (e.g. once you upgrade to a
 * paid always-on instance and no longer want the extra request).
 */
function startKeepAlive() {
  if (String(process.env.KEEPALIVE_ENABLED || 'true').toLowerCase() === 'false') {
    console.log('[keepAlive] disabled via KEEPALIVE_ENABLED=false');
    return;
  }
  const base = (process.env.KEEPALIVE_URL || process.env.RENDER_EXTERNAL_URL || '').replace(/\/+$/, '');
  if (!base) {
    console.log('[keepAlive] no public URL (RENDER_EXTERNAL_URL / KEEPALIVE_URL) — self-ping disabled');
    return;
  }

  // 13 min < Render's 15 min idle window, with headroom for a slow response.
  const ms = Math.max(60000, parseInt(process.env.KEEPALIVE_INTERVAL_MS || '780000', 10));
  const url = `${base}/api/health`;

  const ping = async () => {
    try {
      const res = await fetch(url, { method: 'GET' });
      if (!res.ok) console.warn(`[keepAlive] ping ${url} -> ${res.status}`);
    } catch (e) {
      console.warn(`[keepAlive] ping failed: ${e.message}`);
    }
  };

  setInterval(ping, ms).unref();
  console.log(`[keepAlive] self-ping every ${Math.round(ms / 60000)} min -> ${url}`);
}

module.exports = { startKeepAlive };
