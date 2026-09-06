/**
 * auditPageApiGate — أنّ صلاحيّةَ الصفحة تحرس البيانات فعلًا، وأنّها لا تغلق بابًا كان مفتوحًا.
 *
 *   node src/scripts/auditPageApiGate.js --base http://localhost:5199
 *   node src/scripts/auditPageApiGate.js --base https://api.energize-logistics.com
 *
 * ── الخطرُ الذي يُقاس هنا ───────────────────────────────────────────────────
 * هذا حارسٌ على **كلّ** نداءٍ في النظام. فخطؤه في اتّجاه التضييق يوقف الشركة،
 * لا صفحةً واحدة. ولذلك نصفُ الفحص عن المنع، ونصفُه — وهو الأهمّ — عن أنّ ما
 * كان يمرّ ما زال يمرّ: يُجرَّب دورٌ حقيقيٌّ على نقاطِ صفحاته كلِّها.
 */
require('dotenv').config();
const mongoose = require('mongoose');

const arg = (n, d = null) => { const i = process.argv.indexOf(`--${n}`); return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : d; };
const BASE = arg('base', 'http://localhost:5001');
const ORIGIN = /api\.energize-logistics\.com/.test(BASE)
  ? 'https://energize-logistics.com'
  : (process.env.FRONTEND_URL?.split(',')[0].trim() || 'http://localhost:3000');
const PW = 'Passenergize1!';
const KEY = 'zz_gate_probe';

let pass = 0; let fail = 0;
const ok = (l, c, n = '') => { if (c) { pass += 1; console.log(`  ✓  ${l}${n ? `  — ${n}` : ''}`); } else { fail += 1; console.log(`  ✗ فشل  ${l}${n ? `  — ${n}` : ''}`); } };
const head = (t) => console.log(`\n── ${t} ${'─'.repeat(Math.max(0, 56 - t.length))}`);

(async () => {
  await mongoose.connect(process.env.MONGODB_URI);
  const User = require('../models/User');
  const CustomRole = require('../models/CustomRole');
  const RolePermission = require('../models/RolePermission');
  const { PAGES } = require('../config/pages');
  const { pages: PAGE_APIS } = require('../config/pageApis.json');

  const cleanup = async () => {
    await User.deleteMany({ email: /^zz-gate/ });
    await CustomRole.deleteMany({ key: KEY });
    await RolePermission.deleteMany({ role: KEY });
  };
  await cleanup();

  const su = await User.create({ email: 'zz-gate-su@example.invalid', password: PW, firstName: 'ف', lastName: 'ح', role: 'super_admin' });

  const login = async (email) => {
    const r = await fetch(`${BASE}/api/auth/login`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', Origin: ORIGIN },
      body: JSON.stringify({ email, password: PW }),
    });
    const ck = (r.headers.getSetCookie?.() || []).map((c) => c.split(';')[0]).join('; ');
    return { status: r.status, ck };
  };
  const call = async (ck, path, init = {}) => {
    const r = await fetch(`${BASE}${path}`, { ...init, headers: { Cookie: ck, Origin: ORIGIN, 'Content-Type': 'application/json', ...(init.headers || {}) } });
    let body = null; try { body = await r.json(); } catch (_) {}
    return { status: r.status, body };
  };

  const suLogin = await login(su.email);
  console.log(`الخادم: ${BASE}\nالدخول: ${suLogin.status}`);
  if (suLogin.status !== 200) { await cleanup(); process.exit(1); }
  const suCk = suLogin.ck;

  try {
    head('صاحبُ النظام لا يمسّه الحارس');
    for (const p of ['/api/workflows/payment-types', '/api/hr/employees?limit=1', '/api/vehicle-registry?limit=1']) {
      const r = await call(suCk, p);
      ok(`يمرّ ${p}`, r.status !== 403, String(r.status));
    }

    head('دورٌ مصنوعٌ: القسمُ مفتوحٌ وكلُّ صفحاته');
    await CustomRole.create({ key: KEY, nameAr: 'فحصُ الحارس', nameEn: 'Gate probe' });
    const holder = await User.create({ email: 'zz-gate@example.invalid', password: PW, firstName: 'ح', lastName: 'ف', role: KEY });
    const grant = async (pagesPatch) => {
      const r = await call(suCk, `/api/admin/permissions/${KEY}`, {
        method: 'PUT',
        body: JSON.stringify({ sections: { Operations: 'edit', Collections: 'edit' }, pages: pagesPatch }),
      });
      return r.status;
    };
    ok('يُمنَح القسمان', await grant({}) === 200);

    const hLogin = await login(holder.email);
    ok('يدخل', hLogin.status === 200, String(hLogin.status));
    const hCk = hLogin.ck;

    // نقطةُ صفحةٍ واحدةٍ لا يناديها غيرُها — بها يُقاس المنعُ والسماح.
    const EXCLUSIVE = '/api/workflows/payment-types';
    const owners = Object.entries(PAGE_APIS).filter(([, d]) => (d.apis || []).includes(EXCLUSIVE)).map(([k]) => k);
    ok('النقطةُ حكرٌ على صفحةٍ واحدة', owners.length === 1, owners.join(', '));

    // ── ويُقاس حارسُ الصفحات وحدَه ────────────────────────────────────────
    // ٤٠٣ قد تأتي من حارس القسم أو من قائمة أدوار المسار، وهما غيرُ ما نقيس.
    // فالمقياسُ رمزُ الردّ لا رقمُه.
    const pageBlocked = (r) => r.status === 403 && r.body?.code === 'PAGE_FORBIDDEN';
    const before = await call(hCk, EXCLUSIVE);
    ok('لا يمنعها حارسُ الصفحات والصفحةُ مفتوحة', !pageBlocked(before), `${before.status} ${before.body?.code || ''}`);
    const shared = await call(hCk, '/api/collections-dept/invoices/cash?limit=1');
    ok('ونقطةٌ مشتركةٌ تمرّ', shared.status === 200, String(shared.status));

    head('تُغلَق صفحةٌ واحدة');
    ok('يُحفَظ الإغلاق', await grant({ '/system/operations/payment-types': false }) === 200);
    // ستُّ قراءات: العاملان.
    const after = [];
    for (let i = 0; i < 6; i += 1) after.push((await call(hCk, EXCLUSIVE)).status);
    ok('تُردّ ٤٠٣ من العاملَين معًا', after.every((s) => s === 403), after.join(' '));
    const why = await call(hCk, EXCLUSIVE);
    ok('والرفضُ يسمّي الصفحة', why.body?.code === 'PAGE_FORBIDDEN' && /أنواع الدفع/.test(why.body?.message || ''),
      why.body?.message || '');

    const stillShared = await call(hCk, '/api/collections-dept/invoices/cash?limit=1');
    ok('وجارتُها لم تُمسّ', stillShared.status === 200, String(stillShared.status));
    const stillWorkflows = await call(hCk, '/api/workflows?limit=1');
    ok('وقاعدةُ القسم لم تُمسّ', !pageBlocked(stillWorkflows), `${stillWorkflows.status} ${stillWorkflows.body?.code || ''}`);
    // ── ومنحُ القسم يفتح سيرَ العمل فعلًا ──────────────────────────────────
    // كان `/api/workflows` بلا قسمٍ يملكه، فيُمنَح الدورُ «العمليات» ثمّ لا يفتح
    // أكبرَ شاشةٍ فيها. راجع config/sections.
    ok('ومنحُ «العمليات» يفتح سير العمل', stillWorkflows.status === 200, String(stillWorkflows.status));

    head('نقاطُ الإطار لا تُغلَق أبدًا');
    ok('يُغلَق كلُّ شيء', await grant(Object.fromEntries(PAGES.map((p) => [p.key, false]))) === 200);
    for (const p of ['/api/auth/me', '/api/notifications?limit=1', '/api/lookups?type=collections_detail']) {
      const r = await call(hCk, p);
      ok(`يمرّ ${p}`, r.status !== 403, String(r.status));
    }
    const closed = await call(hCk, EXCLUSIVE);
    ok('وما عداها مغلق', pageBlocked(closed), `${closed.status} ${closed.body?.code || ''}`);

    // ══════════════════════════════════════════════════════════════════════
    head('ولا يُغلَق بابٌ كان مفتوحًا');
    // ══════════════════════════════════════════════════════════════════════
    // هذا نصفُ الفحص الأهمّ: دورٌ حقيقيٌّ بصلاحيّاته المعتادة، تُجرَّب عليه نقاطُ
    // صفحاته كلِّها. أيُّ ٤٠٣ من حارس الصفحات هنا عطبٌ يوقف موظّفًا عن عمله.
    const REAL = 'collections_staff';
    await User.deleteMany({ email: /^zz-gate-real/ });
    const real = await User.create({ email: 'zz-gate-real@example.invalid', password: PW, firstName: 'م', lastName: 'ح', role: REAL });
    const rLogin = await login(real.email);
    ok(`يدخل ${REAL}`, rLogin.status === 200, String(rLogin.status));

    const perms = await call(suCk, '/api/admin/permissions');
    const openPages = Object.entries(perms.body?.pages?.[REAL] || {}).filter(([, v]) => v).map(([k]) => k);
    const endpoints = new Set();
    for (const k of openPages) for (const a of (PAGE_APIS[k]?.apis || [])) endpoints.add(a);
    console.log(`  · ${openPages.length} صفحة مفتوحة · ${endpoints.size} نقطة تُجرَّب`);

    const denied = [];
    for (const e of endpoints) {
      const r = await call(rLogin.ck, `${e}?limit=1`);
      if (r.status === 403 && r.body?.code === 'PAGE_FORBIDDEN') denied.push(`${e} → ${(r.body.pages || []).join(',')}`);
    }
    ok('لا نقطةَ من صفحاته المفتوحة تُمنَع', denied.length === 0,
      denied.length ? denied.slice(0, 6).join(' | ') : `${endpoints.size} نقطة`);
  } catch (e) {
    fail += 1; console.log(`  ✗ خطأ: ${e.message}`);
  } finally {
    await User.deleteMany({ email: /^zz-gate/ });
    await CustomRole.deleteMany({ key: KEY });
    await RolePermission.deleteMany({ role: KEY });
    console.log(`\nنجح ${pass} · فشل ${fail}`);
    await mongoose.disconnect();
    process.exit(fail ? 1 : 0);
  }
})();
