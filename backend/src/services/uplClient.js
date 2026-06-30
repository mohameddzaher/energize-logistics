/**
 * uplClient — thin client for the external "UPL" Operations platform
 * (the system the field/operations team works on; B2B: Fleet Management + 3PL).
 *
 * Every request needs the `x-api-key` header; protected endpoints additionally
 * need a `Authorization: Bearer <JWT>` obtained from POST /admins/login. This
 * module logs in once, caches the JWT until just before it expires, and retries
 * a request once after a fresh login if the token was rejected (401).
 *
 * Nothing here touches our own DB — it is a pure passthrough to UPL. The Express
 * controllers add our own auth/RBAC in front of it.
 */

const BASE = (process.env.UPL_BASE_URL || '').replace(/\/+$/, '');
const PREFIX = '/api/v1';
const API_KEY = process.env.UPL_API_KEY || '';
const EMAIL = process.env.UPL_ADMIN_EMAIL || '';
const PASSWORD = process.env.UPL_ADMIN_PASSWORD || '';

// In-memory token cache (single shared admin session).
let tokenCache = { token: null, exp: 0 };
let loginInFlight = null;

const isConfigured = () => Boolean(BASE && API_KEY && EMAIL && PASSWORD);

/** Decode the `exp` (epoch seconds) claim out of a JWT without verifying it. */
function jwtExp(token) {
  try {
    const payload = JSON.parse(Buffer.from(token.split('.')[1], 'base64').toString('utf8'));
    return typeof payload.exp === 'number' ? payload.exp : 0;
  } catch {
    return 0;
  }
}

async function doLogin() {
  const res = await fetch(`${BASE}${PREFIX}/admins/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': API_KEY },
    body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(json?.message || `UPL login failed (${res.status})`);
    err.status = res.status;
    throw err;
  }
  const token = json?.data?.accessToken || json?.data?.token;
  if (!token) throw new Error('UPL login returned no access token');
  // Refresh 2 minutes before the real expiry to avoid edge-of-window 401s.
  const exp = jwtExp(token);
  tokenCache = { token, exp: exp ? exp - 120 : Math.floor(Date.now() / 1000) + 60 * 60 };
  return token;
}

/** Return a valid bearer token, logging in (or re-using an in-flight login) as needed. */
async function getToken(force = false) {
  const now = Math.floor(Date.now() / 1000);
  if (!force && tokenCache.token && tokenCache.exp > now) return tokenCache.token;
  if (!loginInFlight) {
    loginInFlight = doLogin().finally(() => { loginInFlight = null; });
  }
  return loginInFlight;
}

// Serialize a query object into a string, supporting nested objects with the
// bracket notation UPL expects (e.g. { sort: { updated_at: 'desc' } } ->
// `sort[updated_at]=desc`). Express' qs parser hands us nested objects when the
// frontend sends `sort[updated_at]=desc`, so we must round-trip them faithfully.
function appendParam(qs, key, val) {
  if (val === undefined || val === null || val === '') return;
  if (Array.isArray(val)) {
    val.forEach((item) => appendParam(qs, key, item));
  } else if (typeof val === 'object') {
    Object.entries(val).forEach(([k, v]) => appendParam(qs, `${key}[${k}]`, v));
  } else {
    qs.append(key, String(val));
  }
}

function buildQuery(query) {
  if (!query) return '';
  const qs = new URLSearchParams();
  Object.entries(query).forEach(([k, v]) => appendParam(qs, k, v));
  const s = qs.toString();
  return s ? `?${s}` : '';
}

/**
 * Perform a request against UPL.
 *
 * @param {object} opts
 * @param {string} opts.method  GET|POST|PATCH|PUT|DELETE
 * @param {string} opts.path    path AFTER the /api/v1 prefix, e.g. "/admin/shipments"
 * @param {object} [opts.query] query params
 * @param {object} [opts.body]  JSON body
 * @param {object} [opts.form]  multipart/form-data fields (used by shipments)
 * @param {string} [opts.lang]  "en" | "ar" -> sent as the `lang` header
 * @returns {Promise<object>} the parsed `{ statusCode, message, data }` envelope
 */
async function request({ method = 'GET', path, query, body, form, lang } = {}, _retried = false) {
  if (!isConfigured()) {
    const err = new Error('UPL integration is not configured (missing UPL_* env vars)');
    err.status = 503;
    throw err;
  }

  const token = await getToken();
  const headers = { 'x-api-key': API_KEY, Authorization: `Bearer ${token}` };
  if (lang) headers.lang = lang;

  let payload;
  if (form) {
    const fd = new FormData();
    Object.entries(form).forEach(([k, v]) => {
      if (v === undefined || v === null) return;
      if (Array.isArray(v)) v.forEach((item) => fd.append(k, typeof item === 'object' ? JSON.stringify(item) : String(item)));
      else fd.append(k, typeof v === 'object' ? JSON.stringify(v) : String(v));
    });
    payload = fd; // fetch sets the multipart boundary automatically
  } else if (body !== undefined) {
    headers['Content-Type'] = 'application/json';
    payload = JSON.stringify(body);
  }

  const url = `${BASE}${PREFIX}${path}${buildQuery(query)}`;
  const res = await fetch(url, { method, headers, body: payload });

  // Token expired / revoked mid-flight -> one forced re-login + retry.
  if (res.status === 401 && !_retried) {
    await getToken(true);
    return request({ method, path, query, body, form, lang }, true);
  }

  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(json?.message || `UPL request failed (${res.status})`);
    err.status = res.status;
    err.upstream = json;
    throw err;
  }
  return json;
}

// Convenience wrappers
const get = (path, opts = {}) => request({ method: 'GET', path, ...opts });
const post = (path, opts = {}) => request({ method: 'POST', path, ...opts });
const patch = (path, opts = {}) => request({ method: 'PATCH', path, ...opts });
const del = (path, opts = {}) => request({ method: 'DELETE', path, ...opts });

module.exports = { request, get, post, patch, del, getToken, isConfigured };
