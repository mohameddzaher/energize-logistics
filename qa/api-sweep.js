/**
 * QA — API sweep. Every read endpoint, as every role, against the local QA stack.
 *
 *   node qa/api-sweep.js            (qa/start-local.sh + node qa/seed.js first)
 *
 * Three questions, answered for all 1,000+ endpoints:
 *   1. Does anything crash?           any 5xx  → bug
 *   2. Is anything open without login? a guarded endpoint answering 2xx with no
 *                                      token → security bug
 *   3. Does anything leak across sections? a role with NO access to a section
 *                                      reading that section's endpoint (2xx)
 *                                      → reported for review (some lookups are
 *                                      shared on purpose)
 *
 * Read-only by design (GET only). The base URL is the local QA API; the guard
 * refuses anything else.
 */
const fs = require('fs');
const path = require('path');
const { QA_API, PASSWORD } = require('./guard');

const BASE = process.env.QA_API || QA_API;
if (!/^http:\/\/(127\.0\.0\.1|localhost):5055$/.test(BASE)) { console.error('QA GUARD: api sweep only runs against the local QA API'); process.exit(2); }
const OUT = path.join(__dirname, 'out');
fs.mkdirSync(OUT, { recursive: true });
const CONCURRENCY = Number(process.env.QA_CONCURRENCY || 12);
const ONLY_ROLES = process.env.QA_ROLES ? process.env.QA_ROLES.split(',') : null;

const TOP = new Set(['super_admin', 'admin']);
// Endpoints that answer everyone on purpose, or stream / long-poll.
const SKIP = [/\/api\/docs$/, /\/stream\b/, /\/events\b/, /\/socket/, /\/download\b/, /\/export\b.*\.(xlsx|pdf)/, /\/pdf\b/, /\/waybill/];

async function login(role) {
  const r = await fetch(`${BASE}/api/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: `qa-${role}@local.test`, password: PASSWORD }) });
  if (!r.ok) return null;
  const d = await r.json();
  const me = await (await fetch(`${BASE}/api/auth/me`, { headers: { authorization: `Bearer ${d.accessToken}` } })).json();
  return { token: d.accessToken, perms: (me.user || me).permissions || {} };
}

async function pool(items, n, fn) {
  let i = 0;
  await Promise.all(Array.from({ length: n }, async () => { while (i < items.length) { const k = i++; await fn(items[k], k); } }));
}

(async () => {
  const health = await fetch(`${BASE}/api/health`).catch(() => null);
  if (!health || !health.ok) { console.error('QA API is not up — run qa/start-local.sh'); process.exit(1); }
  const admin = await login('super_admin');
  const cat = await (await fetch(`${BASE}/api/docs/catalog.json`, { headers: { authorization: `Bearer ${admin.token}` } })).json();

  // A real id per model, from the seeded data — so /:id routes hit a record.
  const sampleIds = JSON.parse(fs.readFileSync(path.join(OUT, 'seed-ids.json'), 'utf8').toString() || '{}');
  const urlOf = (e) => e.path.replace(/:([A-Za-z0-9_]+)/g, (_m, name) => {
    if (/id$/i.test(name)) return (sampleIds[e.model] && sampleIds[e.model][0]) || '6a96c6b71dabbd8fad1405e6';
    if (name === 'kind') return 'customer';
    if (/month/i.test(name)) return new Date().toISOString().slice(0, 7);
    if (/date|day/i.test(name)) return new Date().toISOString().slice(0, 10);
    if (/plate/i.test(name)) return 'ABC1234';
    return 'qa';
  });
  const gets = cat.endpoints.filter((e) => e.method === 'GET' && !SKIP.some((rx) => rx.test(e.path)));
  console.log(`endpoints: ${cat.endpoints.length} · GET swept: ${gets.length}`);

  const findings = { serverErrors: [], openWithoutLogin: [], crossSection: [] };
  const seen5xx = new Set();

  // ── 1. without any credentials ──
  await pool(gets.filter((e) => e.auth !== 'public'), CONCURRENCY, async (e) => {
    const r = await fetch(BASE + urlOf(e)).catch(() => null);
    if (r && r.status >= 200 && r.status < 300) findings.openWithoutLogin.push({ endpoint: e.id, status: r.status });
  });
  console.log(`no-login check done · open: ${findings.openWithoutLogin.length}`);

  // ── 2 + 3. as every role ──
  const { ALL_ROLES } = require(path.join(__dirname, '..', 'backend', 'src', 'config', 'roles'));
  const roles = ONLY_ROLES || [...new Set(['super_admin', 'admin', ...ALL_ROLES])];
  const statusCounts = {};
  for (const role of roles) {
    const s = await login(role);
    if (!s) { console.log(`  ${role}: login failed`); continue; }
    let n5 = 0;
    await pool(gets, CONCURRENCY, async (e) => {
      const t0 = Date.now();
      const r = await fetch(BASE + urlOf(e), { headers: { authorization: `Bearer ${s.token}` } }).catch((err) => ({ status: 0, err }));
      const ms = Date.now() - t0;
      statusCounts[r.status] = (statusCounts[r.status] || 0) + 1;
      if (r.status >= 500 || r.status === 0) {
        n5 += 1;
        const key = `${e.id}`;
        if (!seen5xx.has(key)) {
          seen5xx.add(key);
          let body = ''; try { body = (await r.text()).slice(0, 300); } catch { /* */ }
          findings.serverErrors.push({ endpoint: e.id, status: r.status, role, url: urlOf(e), body, ms });
        }
      } else if (r.status >= 200 && r.status < 300 && !TOP.has(role) && e.section && (s.perms[e.section] || 'none') === 'none') {
        findings.crossSection.push({ endpoint: e.id, section: e.section, role });
      }
    });
    process.stdout.write(`  ${role.padEnd(26)} 5xx:${n5}\n`);
  }

  // Cross-section: one line per endpoint with the roles that read it.
  const bySection = new Map();
  for (const c of findings.crossSection) {
    const k = c.endpoint; const v = bySection.get(k) || { endpoint: k, section: c.section, roles: [] };
    v.roles.push(c.role); bySection.set(k, v);
  }
  findings.crossSection = [...bySection.values()].sort((a, b) => b.roles.length - a.roles.length);
  const result = { at: new Date().toISOString(), base: BASE, swept: gets.length, roles: roles.length, statusCounts, ...findings };
  fs.writeFileSync(path.join(OUT, 'api-sweep.json'), JSON.stringify(result, null, 2));
  console.log(`\n5xx endpoints: ${findings.serverErrors.length} · open without login: ${findings.openWithoutLogin.length} · cross-section reads: ${findings.crossSection.length}`);
  console.log('written qa/out/api-sweep.json');
  process.exit(0);
})().catch((e) => { console.error('sweep failed:', e); process.exit(1); });
