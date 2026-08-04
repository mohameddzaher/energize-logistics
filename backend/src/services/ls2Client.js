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

/** Read a unit's service intervals (`si`) as an array. */
async function getServiceIntervals(unitId) {
  const data = await call('core/search_item', { id: Number(unitId), flags: 1 | 0x8000 });
  const si = (data.item && data.item.si) || {};
  return Object.values(si);
}

/**
 * Register a completed service on a Wialon service interval — mirrors what the
 * Location Solutions "Register maintenance" dialog does: sets the last-service
 * mileage (`pm`)/engine-hours (`pe`) and bumps the executions count (`c`), so the
 * "km left" recomputes from the odometer we pass. This is `unit/update_service_
 * interval` (verified callable with our token). We MUST resend the whole interval
 * config (n/t/im/it/ie/pm/pt/pe/c) or Wialon rejects it.
 *
 * @param unitId   Wialon unit id
 * @param id       interval id (1..n)
 * @param atOdoKm  odometer AT the service (what the user entered)
 * @param atEngineHrs optional engine-hours at the service
 */
async function registerService(unitId, id, atOdoKm, atEngineHrs, atDate) {
  const intervals = await getServiceIntervals(unitId);
  const iv = intervals.find((s) => Number(s.id) === Number(id));
  if (!iv) { const e = new Error('Service interval not found'); e.status = 404; throw e; }
  // The date the service was ACTUALLY performed, as entered by the user. Without
  // it Wialon would stamp the write moment, so a service logged today for last
  // week's work would read back as "last service: today".
  const at = atDate ? new Date(atDate) : null;
  const atSec = at && !Number.isNaN(at.getTime())
    ? Math.floor(at.getTime() / 1000)
    : Math.floor(Date.now() / 1000);
  await call('unit/update_service_interval', {
    itemId: Number(unitId),
    id: Number(id),
    callMode: 'update',
    n: iv.n,
    t: iv.t || '',
    im: iv.im || 0,
    it: iv.it || 0,
    ie: iv.ie || 0,
    pm: iv.im ? Math.round(Number(atOdoKm)) : (iv.pm || 0), // mileage-based → set last-service mileage
    // Last-service time. Always stamped with the real service date — for time-based
    // intervals Wialon uses it to compute the next due date; for the others it is
    // inert but is what we read back as "last service", instead of falling back to
    // `mt` (Wialon's row-modified time), which is just when we wrote the record.
    pt: atSec,
    pe: iv.ie ? Math.round(Number(atEngineHrs ?? iv.pe ?? 0)) : (iv.pe || 0), // engine-hours based
    c: Number(iv.c || 0) + 1, // one more execution
  });
  // Return the fresh interval so the caller can confirm.
  const after = await getServiceIntervals(unitId);
  return after.find((s) => Number(s.id) === Number(id)) || null;
}

/**
 * Correct ONLY the last-service date (`pt`) on an existing interval, leaving the
 * executions count and the mileage/engine-hours readings untouched. This repairs
 * rows written before `registerService` accepted a date (it stamped the write
 * moment), so it must NOT bump `c` — that would invent extra services.
 *
 * @param unitId  Wialon unit id
 * @param id      interval id
 * @param atDate  the real service date
 */
async function setServiceDate(unitId, id, atDate) {
  const at = new Date(atDate);
  if (Number.isNaN(at.getTime())) { const e = new Error('Invalid service date'); e.status = 400; throw e; }
  const intervals = await getServiceIntervals(unitId);
  const iv = intervals.find((s) => Number(s.id) === Number(id));
  if (!iv) { const e = new Error('Service interval not found'); e.status = 404; throw e; }
  await call('unit/update_service_interval', {
    itemId: Number(unitId),
    id: Number(id),
    callMode: 'update',
    n: iv.n,
    t: iv.t || '',
    im: iv.im || 0,
    it: iv.it || 0,
    ie: iv.ie || 0,
    pm: iv.pm || 0,           // preserved
    pt: Math.floor(at.getTime() / 1000), // the only field we change
    pe: iv.pe || 0,           // preserved
    c: Number(iv.c || 0),     // preserved — no new execution
  });
  const after = await getServiceIntervals(unitId);
  return after.find((s) => Number(s.id) === Number(id)) || null;
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

/**
 * Run a Wialon report and return its already-fetched result rows.
 *
 * Reports are stateful server-side: exec_report computes into a slot, then
 * get_result_rows pages the table out, then cleanup_result frees the slot. Big
 * fleet-wide reports time out at the gateway, so callers should run this
 * PER-UNIT (fast, ~2s). Returns { header, rows } for the first table.
 *
 * @param {number} templateId  report template id in the resource
 * @param {number} objectId     unit id (or group id) to report on
 * @param {number} from,to      epoch seconds
 */
// Wialon computes a report into ONE server-side slot per session, so the
// cleanup → exec → get_rows → cleanup sequence is not re-entrant: two callers
// running at once interleave and each wipes the other's result, handing back
// somebody else's rows. Every report therefore queues on this chain — reports
// are seconds long and infrequent, so serialising them costs far less than the
// wrong data would.
let reportChain = Promise.resolve();
function serialiseReport(fn) {
  const run = reportChain.then(fn, fn);
  // Keep the chain alive after a failure, and don't leak the rejection.
  reportChain = run.then(() => {}, () => {});
  return run;
}

async function execReport(templateId, objectId, from, to, opts = {}) {
  return serialiseReport(() => execReportUnsafe(templateId, objectId, from, to, opts));
}

async function execReportUnsafe(templateId, objectId, from, to, { resourceId = cfg.REPORTS.RESOURCE_ID, tableIndex = 0, maxRows = 5000 } = {}) {
  // Clear any stale slot first (ignore errors — nothing to clean is fine).
  try { await call('report/cleanup_result', {}); } catch (e) { /* noop */ }
  const exec = await call('report/exec_report', {
    reportResourceId: resourceId,
    reportTemplateId: templateId,
    reportObjectId: objectId,
    reportObjectSecId: 0,
    interval: { from: Math.floor(from), to: Math.floor(to), flags: 0 },
  });
  const tables = (exec.reportResult && exec.reportResult.tables) || [];
  const table = tables[tableIndex];
  if (!table) { try { await call('report/cleanup_result', {}); } catch (e) {} return { header: [], rows: [] }; }
  const header = table.header || [];
  let rows = [];
  if (table.rows > 0) {
    const res = await call('report/get_result_rows', { tableIndex, indexFrom: 0, indexTo: Math.min(table.rows, maxRows) });
    rows = Array.isArray(res) ? res : [];
  }
  try { await call('report/cleanup_result', {}); } catch (e) { /* noop */ }
  return { header, rows, label: table.label || table.name };
}

/**
 * Run a report and return its first table as header-keyed row objects:
 *   { header: [...], rows: [{ "Beginning": "...", "Mileage": "...", ... }] }
 * Convenience over execReport for the trip/stop/fuel tables. Cells are flattened
 * to their display text (`t`) with the raw value kept under `__raw[col]`.
 */
async function runReport(templateId, objectId, from, to, opts = {}) {
  const { header, rows } = await execReport(templateId, objectId, from, to, opts);
  const objs = rows.map((r) => {
    const cells = r.c || [];
    const o = { __raw: {} };
    header.forEach((h, i) => {
      const cell = cells[i];
      o[h] = cell && typeof cell === 'object' ? (cell.t ?? null) : cell;
      o.__raw[h] = cell && typeof cell === 'object' ? (cell.v ?? cell.t ?? null) : cell;
    });
    return o;
  });
  return { header, rows: objs };
}

/** Fetch all units with the identity flags (VIN/brand/plate + custom fields). */
async function searchIdentity() {
  const data = await call('core/search_items', {
    spec: { itemsType: 'avl_unit', propName: 'sys_name', propValueMask: '*', sortType: 'sys_name', propType: 'property' },
    force: 1, flags: cfg.IDENTITY_FLAGS, from: 0, to: 0,
  });
  return data.items || [];
}

module.exports = {
  isConfigured: cfg.isConfigured,
  getSession,
  call,
  searchUnits,
  searchUnit,
  searchIdentity,
  getServiceIntervals,
  registerService,
  setServiceDate,
  loadMessages,
  execReport,
  runReport,
  _sessionInfo: () => ({ ...session }),
};
