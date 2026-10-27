/**
 * QA — write sweep. Every POST / PUT / PATCH / DELETE, against the LOCAL QA stack.
 *
 *   node qa/write-sweep.js        (then `node qa/seed.js` to restore the data)
 *
 * Two passes:
 *   1. Permission: every write as a low-access role. A 2xx is reported for review —
 *      a write the role should not be able to make (self-service routes excepted).
 *   2. Robustness: every write as super_admin, first with an EMPTY body, then with
 *      the sample body from the API docs. A 5xx is a bug: bad input must be
 *      answered with a 4xx and a message, never a server error.
 * Deletes run last. Auth, users and the permission matrix are skipped so the QA
 * accounts themselves are not changed mid-run.
 */
const fs = require('fs');
const path = require('path');
const { QA_API, PASSWORD } = require('./guard');

const BASE = process.env.QA_API || QA_API;
if (!/^http:\/\/(127\.0\.0\.1|localhost):5055$/.test(BASE)) { console.error('QA GUARD: write sweep only runs against the local QA API'); process.exit(2); }
const OUT = path.join(__dirname, 'out');
const LOW_ROLE = process.env.QA_LOW_ROLE || 'procurement_trainee';
const SKIP = [/^\/api\/auth\//, /^\/api\/users\b/, /^\/api\/permissions\b/, /^\/api\/role-permissions\b/, /^\/api\/page-permissions\b/,
  /\/logout\b/, /\/password\b/, /^\/api\/client-errors/, /\/stream\b/, /\/webhook/, /^\/api\/ops\//];
const SELF_SERVICE = /\/me\b|\/my-|notifications|section-work|\/jp\/|client-errors|business-review\/my|\/follow-ups|uiPrefs|\/prefs\b|\/presence|leaves\/?$|requests\/?$|\/remote\//;

async function login(role) {
  const r = await fetch(`${BASE}/api/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: `qa-${role}@local.test`, password: PASSWORD }) });
  return r.ok ? (await r.json()).accessToken : null;
}

(async () => {
  const admin = await login('super_admin');
  const low = await login(LOW_ROLE);
  if (!admin || !low) { console.error('login failed — is the QA stack up and seeded?'); process.exit(1); }
  const cat = await (await fetch(`${BASE}/api/docs/catalog.json`, { headers: { authorization: `Bearer ${admin}` } })).json();
  const ids = JSON.parse(fs.readFileSync(path.join(OUT, 'seed-ids.json'), 'utf8'));
  const urlOf = (e) => e.path.replace(/:([A-Za-z0-9_]+)/g, (_m, name) => {
    if (/id$/i.test(name)) return (ids[e.model] && ids[e.model][1]) || '6a96c6b71dabbd8fad1405e6';
    if (name === 'kind') return 'customer';
    if (/month/i.test(name)) return new Date().toISOString().slice(0, 7);
    return 'qa';
  });
  const writes = cat.endpoints
    .filter((e) => ['POST', 'PUT', 'PATCH', 'DELETE'].includes(e.method) && !SKIP.some((rx) => rx.test(e.path)))
    .sort((a, b) => (a.method === 'DELETE') - (b.method === 'DELETE'));
  console.log(`write endpoints swept: ${writes.length} (low role: ${LOW_ROLE})`);

  const call = async (e, token, body) => {
    const t0 = Date.now();
    try {
      const r = await fetch(BASE + urlOf(e), {
        method: e.method,
        headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
        body: e.method === 'DELETE' && body === undefined ? undefined : JSON.stringify(body || {}),
        signal: AbortSignal.timeout(20000),
      });
      let text = ''; try { text = (await r.text()).slice(0, 240); } catch { /* */ }
      return { status: r.status, text, ms: Date.now() - t0 };
    } catch (err) { return { status: 0, text: String(err.message).slice(0, 120), ms: Date.now() - t0 }; }
  };

  // ── 1. permission ──
  const lowAllowed = [];
  for (const e of writes) {
    const r = await call(e, low, e.requestExample || {});
    if (r.status >= 200 && r.status < 300 && !SELF_SERVICE.test(e.path)) lowAllowed.push({ endpoint: e.id, section: e.section, roles: e.roles, status: r.status, body: r.text.slice(0, 120) });
  }
  console.log(`permission pass: ${lowAllowed.length} writes accepted from ${LOW_ROLE} (review)`);

  // ── 2. robustness ──
  const serverErrors = [];
  const counts = {};
  for (const e of writes) {
    for (const [label, body] of [['empty', {}], ['sample', e.requestExample || {}]]) {
      const r = await call(e, admin, body);
      counts[r.status] = (counts[r.status] || 0) + 1;
      if (r.status >= 500 || r.status === 0) serverErrors.push({ endpoint: e.id, input: label, status: r.status, body: r.text, url: urlOf(e) });
    }
  }
  const out = { at: new Date().toISOString(), swept: writes.length, lowRole: LOW_ROLE, statusCounts: counts, serverErrors, lowAllowed };
  fs.writeFileSync(path.join(OUT, 'write-sweep.json'), JSON.stringify(out, null, 2));
  console.log(`status counts ${JSON.stringify(counts)}`);
  console.log(`5xx: ${serverErrors.length} (endpoints: ${new Set(serverErrors.map((s) => s.endpoint)).size}) · low-role writes accepted: ${lowAllowed.length}`);
  console.log('written qa/out/write-sweep.json — reseed with: node qa/seed.js');
  process.exit(0);
})().catch((e) => { console.error('write sweep failed:', e); process.exit(1); });
