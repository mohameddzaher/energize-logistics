/**
 * Shared CORS origin policy for both the Express API and socket.io.
 *
 * Production: only the exact origins listed in FRONTEND_URL (comma-separated).
 * Development: additionally allow any local origin — localhost / 127.0.0.1 /
 * 0.0.0.0 and private-LAN IPs (192.168.x, 10.x, 172.16-31.x) on any port — so
 * the app works whether you open it via localhost:3000, 127.0.0.1:3000, or the
 * machine's network IP (e.g. testing from a phone on the same Wi-Fi).
 */
const allowedOrigins = (process.env.FRONTEND_URL || 'http://localhost:3000')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

const isDev = process.env.NODE_ENV !== 'production';

const LOCAL_ORIGIN = /^https?:\/\/(localhost|127\.0\.0\.1|0\.0\.0\.0|192\.168\.\d{1,3}\.\d{1,3}|10\.\d{1,3}\.\d{1,3}\.\d{1,3}|172\.(1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3})(:\d+)?$/;

function isAllowedOrigin(origin) {
  // Same-origin / server-to-server requests have no Origin header.
  if (!origin) return true;
  if (allowedOrigins.includes(origin)) return true;
  if (isDev && LOCAL_ORIGIN.test(origin)) return true;
  return false;
}

module.exports = { isAllowedOrigin, allowedOrigins };
