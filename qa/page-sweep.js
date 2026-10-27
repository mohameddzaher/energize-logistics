/**
 * QA — page sweep. Every screen, as every role, in a real browser.
 *
 *   node qa/page-sweep.js                       all roles
 *   QA_ROLES=super_admin,collections_staff node qa/page-sweep.js
 *   QA_FILTERS=0 node qa/page-sweep.js          skip the column-filter pass
 *
 * For each role: sign in through the real login screen, read the pages its
 * menu shows, and open each one (super_admin: the whole page catalogue). On
 * every page:
 *   • JS errors (pageerror) and the error screen («حدث خطأ في هذه الشاشة»)
 *   • API answers ≥ 500 behind the page
 *   • every column filter: open it, tick a value — the class of crash that hit
 *     the cash invoices page (a transform calling a helper declared later)
 * And for every non-top role, three pages it does NOT have: they must not
 * show their data (redirect, "not allowed", or empty).
 *
 * Local QA stack only (qa/guard.js). Screenshots of failures → qa/out/shots.
 */
const fs = require('fs');
const path = require('path');
const { QA_WEB, PASSWORD } = require('./guard');

const WEB = process.env.QA_WEB || QA_WEB;
if (!/^http:\/\/(127\.0\.0\.1|localhost):3055$/.test(WEB)) { console.error('QA GUARD: page sweep only runs against the local QA web'); process.exit(2); }
const ROOT = path.join(__dirname, '..');
const puppeteer = require(path.join(ROOT, 'backend', 'node_modules', 'puppeteer'));
const OUT = path.join(__dirname, 'out');
const SHOTS = path.join(OUT, 'shots');
fs.mkdirSync(SHOTS, { recursive: true });

const FILTERS = process.env.QA_FILTERS !== '0';
// Column-filter crashes do not depend on the role, so the deep pass (every
// filter on every page) runs for these roles only; the rest visit every page.
const DEEP = new Set((process.env.QA_DEEP_ROLES || 'super_admin').split(','));
const TABS = Number(process.env.QA_TABS || 4);
const TOP = new Set(['super_admin', 'admin']);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const catalogue = JSON.parse(fs.readFileSync(path.join(ROOT, 'backend', 'src', 'config', 'pages.json'), 'utf8'));
const ALL_PAGES = (catalogue.pages || catalogue).map((p) => p.key || p.href || p).filter((k) => typeof k === 'string' && k.startsWith('/system'));
const ERROR_TEXT = /حدث خطأ في هذه الشاشة|Application error|Unhandled Runtime Error|Something went wrong/;
const NOISE = /favicon|ResizeObserver|hydrat|Download the React DevTools|socket\.io|WebSocket|net::ERR_ABORTED/i;

async function pool(items, n, fn) {
  let i = 0;
  await Promise.all(Array.from({ length: n }, async () => { while (i < items.length) { const k = i++; await fn(items[k], k); } }));
}

async function signIn(browser, role) {
  const ctx = await browser.createBrowserContext();
  const p = await ctx.newPage();
  await p.goto(`${WEB}/login`, { waitUntil: 'networkidle2', timeout: 60000 });
  await p.type('input[type=email]', `qa-${role}@local.test`);
  await p.type('input[type=password]', PASSWORD);
  await Promise.all([p.waitForNavigation({ timeout: 60000 }).catch(() => {}), p.keyboard.press('Enter')]);
  await sleep(1500);
  const ok = !p.url().includes('/login');
  // The menu this role sees = the pages it may open. Groups are collapsed and
  // render their links only when opened — so every group header is opened
  // first (never the logout or the collapse toggle).
  let menu = [];
  if (ok) {
    await p.setViewport({ width: 1440, height: 2400 });
    for (let round = 0; round < 3; round += 1) {
      await p.evaluate(() => {
        // The desktop sidebar is position:fixed (offsetParent is null) — pick the aside with the most group buttons.
        const aside = [...document.querySelectorAll('aside')].sort((x, y) => y.querySelectorAll('button').length - x.querySelectorAll('button').length)[0];
        if (!aside) return;
        for (const b of aside.querySelectorAll('button')) {
          const t = (b.innerText || '').trim();
          if (!t || /logout|تسجيل الخروج|خروج/i.test(t) || b.getAttribute('aria-expanded') === 'true' || b.dataset.qaOpened) continue;
          b.dataset.qaOpened = '1'; b.click();
        }
      }).catch(() => {});
      await sleep(400);
    }
    menu = await p.evaluate(() => [...new Set([...document.querySelectorAll('aside a[href^="/system"]')]
      .map((a) => a.getAttribute('href').split('?')[0]))]);
  }
  await p.close();
  return { ctx, ok, menu };
}

async function visit(ctx, url, { filters }) {
  let p;
  try { p = await ctx.newPage(); } catch (e) { return { url, finalUrl: url, crashed: false, filterCrash: '', errors: [`browser: ${e.message.slice(0, 120)}`], api5xx: [], filtersTried: 0, shot: '', browserLost: true }; }
  await p.setViewport({ width: 1440, height: 900 });
  const errs = []; const api5xx = [];
  p.on('pageerror', (e) => errs.push(String(e.message).slice(0, 200)));
  p.on('console', (m) => { if (m.type() === 'error' && !NOISE.test(m.text())) errs.push(`console: ${m.text().slice(0, 200)}`); });
  p.on('response', (r) => { if (r.status() >= 500 && r.url().includes('/api/')) api5xx.push(`${r.status()} ${r.request().method()} ${r.url().replace(/^https?:\/\/[^/]+/, '')}`.slice(0, 200)); });
  let crashed = false; let finalUrl = url; let filtersTried = 0; let filterCrash = '';
  try {
    await p.goto(WEB + url, { waitUntil: 'networkidle2', timeout: 45000 });
    await sleep(1200);
    finalUrl = p.url().replace(WEB, '');
    crashed = await p.evaluate((src) => new RegExp(src).test(document.body.innerText), ERROR_TEXT.source);
    if (!crashed && filters) {
      const n = await p.$$eval('thead th button', (a) => a.length).catch(() => 0);
      for (let i = 0; i < Math.min(n, 30) && !crashed; i += 1) {
        const btns = await p.$$('thead th button'); if (!btns[i]) break;
        await btns[i].click().catch(() => {}); await sleep(250);
        const ticked = await p.evaluate(() => {
          const boxes = [...document.querySelectorAll('input[type=checkbox]')].filter((x) => !x.closest('thead') && !x.closest('tbody') && x.offsetParent);
          if (!boxes.length) return false; boxes[boxes.length > 1 ? 1 : 0].click(); return true;
        }).catch(() => false);
        if (ticked) filtersTried += 1;
        await sleep(350); await p.keyboard.press('Escape').catch(() => {}); await sleep(100);
        crashed = await p.evaluate((src) => new RegExp(src).test(document.body.innerText), ERROR_TEXT.source).catch(() => false);
        if (crashed) filterCrash = `column filter #${i}`;
      }
    }
  } catch (e) { errs.push(`navigation: ${e.message.slice(0, 160)}`); }
  let shot = '';
  if (crashed || errs.some((e) => !e.startsWith('console:')) || api5xx.length) {
    shot = path.join(SHOTS, `${url.replace(/[^a-z0-9]+/gi, '_')}-${Date.now()}.png`);
    await p.screenshot({ path: shot }).catch(() => {});
  }
  await p.close().catch(() => {});
  return { url, finalUrl, crashed, filterCrash, errors: errs, api5xx, filtersTried, shot: shot ? path.relative(ROOT, shot) : '' };
}

(async () => {
  const { ALL_ROLES } = require(path.join(ROOT, 'backend', 'src', 'config', 'roles'));
  const roles = process.env.QA_ROLES ? process.env.QA_ROLES.split(',') : [...new Set(['super_admin', 'admin', ...ALL_ROLES])];
  const launch = () => puppeteer.launch({ headless: 'new', protocolTimeout: 120000, args: ['--disable-dev-shm-usage'] });
  let browser = await launch();
  const results = [];
  const started = Date.now();
  for (const role of roles) {
    // A fresh browser per role: one crash costs one role at most, never the run.
    try { await browser.close(); } catch { /* already gone */ }
    browser = await launch();
    let signed;
    try { signed = await signIn(browser, role); } catch (e) { results.push({ role, signIn: false, error: e.message.slice(0, 160) }); console.log(`${role.padEnd(26)} sign-in ERROR ${e.message.slice(0, 80)}`); continue; }
    const { ctx, ok, menu } = signed;
    if (!ok) { results.push({ role, signIn: false }); console.log(`${role.padEnd(26)} sign-in FAILED`); await ctx.close(); continue; }
    const pages = role === 'super_admin' ? [...new Set([...ALL_PAGES, ...menu])] : menu;
    const visits = [];
    // Deep pass (filters) for the top role; others: every page, filters too unless disabled.
    await pool(pages, TABS, async (u) => {
      try { visits.push(await visit(ctx, u, { filters: FILTERS && DEEP.has(role) })); }
      catch (e) { visits.push({ url: u, finalUrl: u, crashed: false, filterCrash: '', errors: [`sweep: ${e.message.slice(0, 120)}`], api5xx: [], filtersTried: 0, shot: '' }); }
    });
    // Access check: pages outside this role's menu must not show their content.
    const denied = [];
    if (!TOP.has(role)) {
      const outside = ALL_PAGES.filter((u) => !menu.includes(u) && !/\/system\/?$|dashboard$|\/jp$|profile|notifications|settings\/me/.test(u));
      for (const u of [outside[3], outside[Math.floor(outside.length / 2)], outside[outside.length - 4]].filter(Boolean)) {
        let p; try { p = await ctx.newPage(); } catch { break; }
        const seenApi = [];
        p.on('response', (r) => { if (r.url().includes('/api/') && r.status() === 200 && r.request().method() === 'GET') seenApi.push(r.url().replace(/^https?:\/\/[^/]+/, '')); });
        await p.goto(WEB + u, { waitUntil: 'networkidle2', timeout: 45000 }).catch(() => {});
        await sleep(800);
        const landed = p.url().replace(WEB, '');
        const blockedText = await p.evaluate(() => /غير مسموح|ليس لديك صلاحية|لا تملك|Not allowed|Access denied|Forbidden|Administration and IT only/i.test(document.body.innerText)).catch(() => false);
        denied.push({ url: u, landed, redirected: landed.split('?')[0] !== u, blockedText, dataCalls: seenApi.filter((x) => !/auth\/me|nav-badges|notifications|lookups|app-version|client-errors|branding|settings\/public/.test(x)).slice(0, 5) });
        await p.close().catch(() => {});
      }
    }
    await ctx.close().catch(() => {});
    const bad = visits.filter((v) => v.crashed || v.api5xx.length || v.errors.some((e) => !e.startsWith('console:')));
    const leak = denied.filter((d) => !d.redirected && !d.blockedText && d.dataCalls.length);
    results.push({ role, signIn: true, menu: menu.length, visited: visits.length, bad: bad.length, visits, denied });
    console.log(`${role.padEnd(26)} pages:${String(visits.length).padStart(3)}  failing:${bad.length}  filters:${visits.reduce((a, v) => a + v.filtersTried, 0)}  possible-leaks:${leak.length}  (${Math.round((Date.now() - started) / 1000)}s)`);
    fs.writeFileSync(path.join(OUT, 'page-sweep.json'), JSON.stringify({ at: new Date().toISOString(), web: WEB, results }, null, 1));
  }
  await browser.close();
  console.log('written qa/out/page-sweep.json');
  process.exit(0);
})().catch((e) => { console.error('page sweep failed:', e); process.exit(1); });
