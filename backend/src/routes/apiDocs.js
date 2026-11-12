const express = require('express');

const router = express.Router();

/**
 * API documentation: two documents and a page that shows them.
 * Generated on request from `app._router`, so what is actually mounted is what is shown; added routes appear and removed ones disappear automatically.
 * Visibility: `/api/docs/partner.json` is the partner surface, opened with the integration key; `/api/docs/internal.json` is the whole surface, admin accounts only; `/api/docs` is a page showing the first, and the second to signed-in admins.
 */
const { buildOpenApi, buildCatalog, stats } = require('../services/apiDocs');
const { requireApiKey } = require('../middleware/apiKey');
const authenticate = require('../middleware/auth');
const { FULL_ACCESS_ROLES } = require('../config/constants');

// Who reads the internal surface: top roles and IT (the page and the server use the same list).
const DOCS_ROLES = [...new Set([...FULL_ACCESS_ROLES, 'it_manager', 'it_team_leader', 'it_specialist'])];
const docsOnly = (req, res, next) => (DOCS_ROLES.includes(req.user?.role)
  ? next()
  : res.status(403).json({ message: 'The internal API documentation is for administration and IT only' }));

/** Server base URL as the reader sees it; behind nginx the forwarded header is read. */
const baseUrlOf = (req) => {
  const proto = req.headers['x-forwarded-proto'] || req.protocol || 'https';
  const host = req.headers['x-forwarded-host'] || req.get('host');
  return `${proto}://${host}`;
};

/** Partner document, opened with the integration key. */
// The partner document opens with the partner key — or for a signed-in admin/IT
// user, so the "Partner docs" button in the system opens it without a key.
const partnerKey = requireApiKey('FLEET_API_KEY', 'Partner API documentation');
const keyOrDocsUser = (req, res, next) => ((req.headers['x-api-key'] || req.query.key)
  ? partnerKey(req, res, next)
  : authenticate(req, res, () => docsOnly(req, res, next)));

router.get('/partner.json', keyOrDocsUser, (req, res) => {
  res.set('Cache-Control', 'no-store');
  res.json(buildOpenApi(req.app, { scope: 'partner', baseUrl: baseUrlOf(req) }));
});

/** Internal surface document, admins only. */
router.get('/internal.json', authenticate, docsOnly, (req, res) => {
  res.set('Cache-Control', 'no-store');
  return res.json(buildOpenApi(req.app, { scope: 'internal', baseUrl: baseUrlOf(req) }));
});

/**
 * The partner API key — revealed on request to the people who hand it out.
 *
 * It lives only in the server environment (FLEET_API_KEY), so nobody in the
 * company could find it ("where do I get it from?"). Top roles and the IT
 * manager can reveal it from the docs page; every reveal is audited, like the
 * company email passwords.
 */
const KEY_ROLES = [...new Set([...FULL_ACCESS_ROLES, 'it_manager', 'it_team_leader'])];
router.get('/partner-key', authenticate, async (req, res) => {
  if (!KEY_ROLES.includes(req.user?.role)) return res.status(403).json({ message: 'Only administrators and the IT manager can reveal the partner key' });
  res.set('Cache-Control', 'no-store');
  const key = process.env.FLEET_API_KEY || '';
  try {
    await require('../utils/auditLogger')({
      user: req.user, action: 'reveal_partner_api_key', entity: 'ApiKey', entityKey: 'FLEET_API_KEY',
      changes: { details: 'Revealed the partner API key from the API reference page' }, ipAddress: req.ip,
    });
  } catch (_) { /* the reveal is still answered */ }
  return res.json({ configured: !!key, key });
});

/** The compact catalog the docs page renders — routes, fields, samples, models. */
router.get('/catalog.json', authenticate, docsOnly, (req, res) => {
  res.set('Cache-Control', 'no-store');
  return res.json(buildCatalog(req.app, { baseUrl: baseUrlOf(req) }));
});

/** Counters + the surface signature — polled by the page to know when to reload. */
router.get('/stats', authenticate, docsOnly, (req, res) => {
  res.set('Cache-Control', 'no-store');
  return res.json(stats(req.app));
});

/** The human-readable page. Integrators open it with their key and try calls from it. The viewer loads from a public CDN; if that fails the JSON document remains available and is the source, the page being a view of it. */
router.get('/', (req, res) => {
  res.set('Cache-Control', 'no-store');
  // ── Its own security policy ──────────────────────────────────────────────
  // The site-wide policy allows scripts from this origin only, which blocked
  // the viewer (cdnjs) and the page's own script: the partner page only ever
  // showed its header. This page alone allows cdnjs, and its inline script by
  // a per-request nonce — nothing broader.
  const nonce = require('crypto').randomBytes(16).toString('base64');
  res.set('Content-Security-Policy', [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' https://cdnjs.cloudflare.com`,
    "style-src 'self' 'unsafe-inline' https://cdnjs.cloudflare.com",
    "img-src 'self' data: https:",
    "font-src 'self' data: https:",
    "connect-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "frame-ancestors 'self'",
  ].join('; '));
  res.type('html').send(`<!doctype html>
<html lang="en" dir="ltr">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Energize Logistics — Partner API</title>
  <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/swagger-ui/5.17.14/swagger-ui.min.css" />
  <style>
    :root { --ink:#0b1220; --orange:#f37121; }
    * { box-sizing: border-box; }
    body { margin: 0; background: #f8fafc; font-family: Inter, system-ui, -apple-system, 'Segoe UI', sans-serif; color: #0f172a; }
    .hero { position: relative; overflow: hidden; background: var(--ink); color: #fff; padding: 28px 24px 26px; }
    .hero:before { content: ''; position: absolute; inset: 0; opacity: .07;
      background-image: linear-gradient(#fff 1px, transparent 1px), linear-gradient(90deg, #fff 1px, transparent 1px); background-size: 32px 32px; }
    .glow { position: absolute; right: -80px; top: -110px; width: 280px; height: 280px; border-radius: 50%; background: var(--orange); opacity: .22; filter: blur(60px); }
    .wrap { position: relative; max-width: 1100px; margin: 0 auto; }
    .eyebrow { font-size: 12px; font-weight: 600; letter-spacing: .18em; text-transform: uppercase; color: #f7a26b; }
    h1 { margin: 6px 0 6px; font-size: 28px; letter-spacing: -.02em; }
    .sub { margin: 0; color: #94a3b8; font-size: 14px; line-height: 1.6; max-width: 720px; }
    .chips { margin-top: 14px; display: flex; flex-wrap: wrap; gap: 8px; }
    .chip { font: 12px/1 ui-monospace, SFMono-Regular, Menlo, monospace; color: #cbd5e1; background: rgba(255,255,255,.06);
      border: 1px solid rgba(255,255,255,.1); border-radius: 999px; padding: 7px 11px; }
    .chip b { color: #fff; font-weight: 600; }
    .card { max-width: 1100px; margin: 20px auto 0; padding: 0 16px; }
    .box { background: #fff; border: 1px solid #e2e8f0; border-radius: 16px; padding: 20px; box-shadow: 0 1px 2px rgba(15,23,42,.04); }
    .box h2 { margin: 0 0 4px; font-size: 16px; }
    .box p { margin: 0; color: #64748b; font-size: 13.5px; line-height: 1.6; }
    form { display: flex; gap: 8px; margin-top: 14px; flex-wrap: wrap; }
    input { flex: 1; min-width: 220px; padding: 11px 14px; border-radius: 12px; border: 1px solid #cbd5e1; font: 14px ui-monospace, Menlo, monospace; }
    input:focus { outline: 2px solid var(--orange); border-color: transparent; }
    button { padding: 11px 18px; border: 0; border-radius: 12px; background: var(--orange); color: #fff; font-weight: 600; font-size: 14px; cursor: pointer; }
    .err { margin-top: 10px; color: #e11d48; font-size: 13px; }
    .steps { display: grid; grid-template-columns: repeat(auto-fit, minmax(230px, 1fr)); gap: 12px; margin-top: 16px; }
    .step { background: #f8fafc; border-radius: 12px; padding: 12px 14px; font-size: 13px; color: #475569; line-height: 1.55; }
    .step b { display: block; color: #0f172a; margin-bottom: 2px; }
    code { font: 12.5px ui-monospace, Menlo, monospace; background: #f1f5f9; padding: 1px 6px; border-radius: 6px; }
    #ui { max-width: 1100px; margin: 0 auto; padding: 4px 0 40px; }
    .swagger-ui .topbar, .swagger-ui .information-container { display: none; }
    .hidden { display: none; }
  </style>
</head>
<body>
  <div class="hero"><div class="glow"></div>
    <div class="wrap">
      <div class="eyebrow">Partner API</div>
      <h1>Energize Logistics Fleet API</h1>
      <p class="sub">Read-only access to live fleet data — vehicles, positions, alerts and supervisor assignments — for partner systems and automation tools.
        Generated by the server when you open it, so it always matches what is deployed.</p>
      <div class="chips">
        <span class="chip">Auth <b>x-api-key</b> header</span>
        <span class="chip">Base <b id="base"></b></span>
        <span class="chip">Format <b>JSON</b></span>
        <span class="chip" id="status">Loading…</span>
      </div>
    </div>
  </div>

  <div class="card hidden" id="gate">
    <div class="box">
      <h2>Enter your API key</h2>
      <p id="why">This documentation and the API itself open with the key issued to you by Energize Logistics.</p>
      <form id="f"><input id="k" type="password" placeholder="x-api-key" autocomplete="off" spellcheck="false" /><button type="submit">Open the docs</button></form>
      <div class="err" id="err"></div>
      <div class="steps">
        <div class="step"><b>1 · Get a key</b>Ask your Energize Logistics contact. Treat it like a password.</div>
        <div class="step"><b>2 · Send it</b>On every request: <code>x-api-key: &lt;key&gt;</code></div>
        <div class="step"><b>3 · Try it</b><code>GET /api/fleet-api/health</code> answers when the key is right.</div>
      </div>
    </div>
  </div>

  <div class="card hidden" id="hint">
    <div class="box"><p>Open any endpoint below and press <b>Try it out</b> — your key is sent automatically in the <code>x-api-key</code> header.</p></div>
  </div>
  <div id="ui"></div>

  <script nonce="${nonce}" src="https://cdnjs.cloudflare.com/ajax/libs/swagger-ui/5.17.14/swagger-ui-bundle.min.js"></script>
  <script nonce="${nonce}">
    (function () {
      var base = location.origin;
      document.getElementById('base').textContent = base;
      var params = new URLSearchParams(location.search);
      // The key may come after # (never sent to the server, so not in access logs),
      // in ?key= (older links), or from this tab's earlier entry.
      var hashKey = new URLSearchParams(location.hash.replace(/^#/, '')).get('key');
      var key = hashKey || params.get('key') || sessionStorage.getItem('energize-partner-key') || '';
      if (hashKey || params.get('key')) history.replaceState(null, '', location.pathname);
      var $ = function (id) { return document.getElementById(id); };

      function show(id, on) { $(id).classList.toggle('hidden', !on); }

      function load() {
        $('status').textContent = 'Loading…';
        var headers = key ? { 'x-api-key': key } : {};
        fetch('/api/docs/partner.json', { headers: headers, credentials: 'include', cache: 'no-store' })
          .then(function (r) { return r.json().then(function (body) { return { ok: r.ok, status: r.status, body: body }; }); })
          .then(function (res) {
            if (!res.ok) {
              $('status').textContent = 'Key required';
              show('gate', true); show('hint', false);
              $('err').textContent = key ? (res.body && res.body.message ? res.body.message : 'The key was not accepted') : '';
              if (key) sessionStorage.removeItem('energize-partner-key');
              return;
            }
            if (key) sessionStorage.setItem('energize-partner-key', key);
            show('gate', false); show('hint', true);
            var n = Object.keys(res.body.paths || {}).length;
            $('status').innerHTML = '<b>' + n + '</b> endpoint' + (n === 1 ? '' : 's');
            window.ui = SwaggerUIBundle({
              spec: res.body, dom_id: '#ui', docExpansion: 'list', defaultModelsExpandDepth: -1,
              tryItOutEnabled: true, deepLinking: true,
              requestInterceptor: function (q) { if (key) q.headers['x-api-key'] = key; return q; },
            });
          })
          .catch(function () { $('status').textContent = 'Offline'; show('gate', true); $('err').textContent = 'Could not reach the server.'; });
      }

      $('f').addEventListener('submit', function (e) {
        e.preventDefault();
        key = $('k').value.trim();
        if (!key) return;
        load();
      });
      load();
    })();
  </script>
</body>
</html>`);
});

module.exports = router;
