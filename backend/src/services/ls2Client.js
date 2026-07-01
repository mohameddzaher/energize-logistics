/**
 * ls2Client — thin client for the Location Solutions (Wialon) Remote API.
 *
 * Wialon is session-based: we log in ONCE with the long-lived access token
 * (`token/login`) to get a short-lived session id (`eid`/`sid`), cache it, and
 * reuse it for every later call. Sessions expire after inactivity, so on any
 * "session expired" error we transparently re-login once and retry.
 *
 * Every request is an HTTP POST with an `application/x-www-form-urlencoded` body:
 *   sid=<session>&svc=<service>&params=<json>
 * The response is JSON; on error it is `{ "error": <code>, "reason"?: ... }`.
 *
 * Nothing here touches our DB — it is a pure passthrough. The poll job + Express
 * controllers add our own persistence / auth / RBAC in front of it.
 */
const cfg = require('../config/ls2Config');

// In-memory session cache (single shared account session).
let session = { sid: null, host: null, ts: 0 };
let loginInFlight = null;

// Wialon error codes that mean "your session is gone, log in again".
// 1 = invalid session, 4 = auth failed, 5 = server error (retry), 7 = access denied.
const SESSION_DEAD = new Set([1, 4, 1003, 1004]);

function form(fields) {
  const p = new URLSearchParams();
  Object.entries(fields).forEach(([k, v]) => {
    if (v === undefined || v === null) return;
    p.append(k, typeof v === 'object' ? JSON.stringify(v) : String(v));
  });
  return p;
}

async function post(fields) {
  const res = await fetch(cfg.BASE_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: form(fields),
  });
  // Wialon always answers 200 with a JSON body; a non-200 means the gateway/path
  // is wrong (e.g. the infamous /lsx 404).
  const text = await res.text();
  if (!res.ok) {
    const err = new Error(`LS2 HTTP ${res.status} (${text.slice(0, 120)})`);
    err.status = res.status >= 400 && res.status < 600 ? res.status : 502;
    throw err;
  }
  let json;
  try { json = JSON.parse(text); } catch { json = {}; }
  return json;
}

/** Log in with the access token and cache the resulting session id. */
async function doLogin() {
  if (!cfg.TOKEN) {
    const err = new Error('LS2 integration not configured (missing LS2_TOKEN)');
    err.status = 503;
    throw err;
  }
  const data = await post({ svc: 'token/login', params: { token: cfg.TOKEN } });
  if (data.error || !data.eid) {
    const err = new Error(`LS2 login failed (error ${data.error ?? 'no-eid'})`);
    err.status = 502;
    throw err;
  }
  session = { sid: data.eid, host: data.host || null, ts: Date.now() };
  return session.sid;
}

/** Return a valid session id, logging in (or reusing an in-flight login) as needed. */
async function getSession(force = false) {
  if (!force && session.sid) return session.sid;
  if (!loginInFlight) {
    loginInFlight = doLogin().finally(() => { loginInFlight = null; });
  }
  return loginInFlight;
}

/**
 * Call a Wialon service. Transparently re-logins + retries once on a dead
 * session. Returns the parsed JSON `data` (throws on a real API error).
 */
async function call(svc, params, _retried = false) {
  const sid = await getSession();
  const data = await post({ sid, svc, params });
  if (data && typeof data.error === 'number' && data.error !== 0) {
    if (!_retried && SESSION_DEAD.has(data.error)) {
      session.sid = null;
      await getSession(true);
      return call(svc, params, true);
    }
    const err = new Error(`LS2 ${svc} failed (error ${data.error})`);
    err.status = 502;
    err.wialonError = data.error;
    throw err;
  }
  return data;
}

/**
 * Search every unit (avl_unit) with the given data flags. `flags` defaults to the
 * poller set (position + sensors + last message + counters). Returns the raw
 * Wialon items array.
 */
async function searchUnits(flags = cfg.POLL_FLAGS) {
  const data = await call('core/search_items', {
    spec: {
      itemsType: 'avl_unit',
      propName: 'sys_name',
      propValueMask: '*',
      sortType: 'sys_name',
      propType: 'property',
    },
    force: 1,
    flags,
    from: 0,
    to: 0,
  });
  return data.items || [];
}

/** Fetch a single unit by id with the given flags. */
async function searchUnit(id, flags = cfg.POLL_FLAGS) {
  const data = await call('core/search_item', { id: Number(id), flags });
  return data.item || null;
}

/**
 * Load raw messages for a unit over a time interval (epoch seconds). Used for the
 * history/track view. `flags`: 1 = data messages (0x0000 gives all).
 */
async function loadMessages(unitId, timeFrom, timeTo, count = 5000) {
  return call('messages/load_interval', {
    itemId: Number(unitId),
    timeFrom: Math.floor(timeFrom),
    timeTo: Math.floor(timeTo),
    flags: 0,
    flagsMask: 0,
    loadCount: count,
  });
}

module.exports = {
  isConfigured: cfg.isConfigured,
  getSession,
  call,
  searchUnits,
  searchUnit,
  loadMessages,
  _sessionInfo: () => ({ ...session }),
};
