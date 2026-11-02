/* eslint-disable no-console */
/**
 * auditSessions: multi-device login and session lifetime with continued use.
 * Guards two real complaints: a second login invalidated the first, and the refresh token expired a fixed 7 days after login instead of after last use.
 * Opens three sessions for one user, checks all work together after refresh and that logging out of one leaves the others intact; this breaks easily on any auth change.
 */
require('dotenv').config();
const mongoose = require('mongoose');

const argv = process.argv.slice(2);
const iB = argv.indexOf('--base');
const BASE = (iB >= 0 && argv[iB + 1] ? argv[iB + 1] : process.env.BASE || 'http://localhost:5599').replace(/\/$/, '');

let pass = 0; let fail = 0;
const ok = (l, c, x = '') => { console.log(`  ${c ? '✓' : '✗ FAIL'}  ${l}${x ? '   — ' + x : ''}`); c ? pass++ : fail++; };

const cookiesOf = (r) => (r.headers.getSetCookie?.() || []);
const jar = (list) => list.map((c) => c.split(';')[0]).join('; ');
const pick = (list, name) => {
  const c = list.find((x) => x.startsWith(`${name}=`));
  return c ? c.split(';')[0].split('=').slice(1).join('=') : null;
};

(async () => {
  await mongoose.connect(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 20000 });
  const User = require('../models/User');
  const Employee = require('../models/Employee');

  await User.deleteMany({ email: { $regex: '^zz-sess' } });
  const u = await User.create({
    email: 'zz-sess@example.invalid', password: 'Test@12345',
    firstName: 'ت', lastName: 'ج', role: 'employee', isActive: true,
  });

  const login = async () => {
    const r = await fetch(`${BASE}/api/auth/login`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: u.email, password: 'Test@12345' }),
    });
    if (r.status === 429) { console.error('RATE LIMITED'); process.exit(2); }
    const list = cookiesOf(r);
    return { status: r.status, cookies: list, jar: jar(list), refresh: pick(list, 'refreshToken') };
  };
  const me = (cookie) => fetch(`${BASE}/api/auth/me`, { headers: { Cookie: cookie } });
  const refresh = async (cookie) => {
    const r = await fetch(`${BASE}/api/auth/refresh`, { method: 'POST', headers: { Cookie: cookie } });
    const list = cookiesOf(r);
    return { status: r.status, jar: list.length ? jar(list) : cookie, refresh: pick(list, 'refreshToken') };
  };

  try {
    // Three devices at the same time
    console.log('── ثلاثة أجهزة لنفس المستخدم ──');
    const A = await login(); const B = await login(); const C = await login();
    ok('الثلاثة دخلوا', [A, B, C].every((s) => s.status === 200 && s.jar));
    ok('ولكلٍّ توكن تجديد مختلف',
      new Set([A.refresh, B.refresh, C.refresh]).size === 3);

    const alive = await Promise.all([me(A.jar), me(B.jar), me(C.jar)]);
    ok('والثلاثة يعملون معًا (الدخول الثاني لم يُبطِل الأول)',
      alive.every((r) => r.status === 200), alive.map((r) => r.status).join('/'));

    const stored = await User.findById(u._id).select('+refreshTokens').lean();
    ok(`وثلاث جلسات محفوظة (${(stored.refreshTokens || []).length})`,
      (stored.refreshTokens || []).length === 3);

    // Refresh does not log out the other devices
    console.log('\n── التجديد ──');
    const rA = await refresh(A.jar);
    ok('الجهاز الأول جدَّد', rA.status === 200, `HTTP ${rA.status}`);
    const after = await Promise.all([me(rA.jar), me(B.jar), me(C.jar)]);
    ok('والباقي ما زالوا داخلين', after.every((r) => r.status === 200), after.map((r) => r.status).join('/'));

    // Two concurrent refreshes from the same session, like ten open tabs
    const [p1, p2] = await Promise.all([refresh(B.jar), refresh(B.jar)]);
    ok('تجديدان متزامنان من نفس الجلسة ينجحان',
      p1.status === 200 && p2.status === 200, `${p1.status}/${p2.status}`);
    ok('والجلسة ما زالت تعمل بعدهما', (await me(p1.jar)).status === 200);

    // Logout affects only this device
    console.log('\n── الخروج ──');
    const out = await fetch(`${BASE}/api/auth/logout`, { method: 'POST', headers: { Cookie: C.jar } });
    ok('خروج الجهاز الثالث', out.status === 200, `HTTP ${out.status}`);
    ok('ولم يُخرِج الأول والثاني',
      (await me(rA.jar)).status === 200 && (await me(p1.jar)).status === 200);
    const afterOut = await User.findById(u._id).select('+refreshTokens').lean();
    ok('وجلسته وحدها حُذفت', !(afterOut.refreshTokens || []).includes(C.refresh));

    // Sliding session
    // A token past half its lifetime must be replaced by a fresh one rather than expire abruptly.
    console.log('\n── الجلسة المنزلقة ──');
    const jwtLib = require('jsonwebtoken');
    const old = jwtLib.sign({ userId: String(u._id) }, process.env.JWT_REFRESH_SECRET, { expiresIn: '30d' });
    // Forge an old token: issued 20 days ago, expires in 10, i.e. past half its life.
    const now = Math.floor(Date.now() / 1000);
    const aged = jwtLib.sign(
      { userId: String(u._id), iat: now - 20 * 86400, exp: now + 10 * 86400 },
      process.env.JWT_REFRESH_SECRET,
    );
    await User.updateOne({ _id: u._id }, { $push: { refreshTokens: aged } });
    const rAged = await refresh(`refreshToken=${aged}`);
    ok('توكن تجاوز نصف عمره يُجدَّد', rAged.status === 200, `HTTP ${rAged.status}`);
    ok('ويُصدَر بديلٌ جديد', !!rAged.refresh && rAged.refresh !== aged);
    ok('والقديم يبقى صالحًا في فترة السماح',
      (await refresh(`refreshToken=${aged}`)).status === 200,
      'وإلا خرجت التبويبات التي جدَّدت في اللحظة نفسها');
    ok('والبديل يعمل', (await me(rAged.jar)).status === 200);
    void old;

    // Session limit
    console.log('\n── حدّ الجلسات ──');
    const many = [];
    for (let i = 0; i < 10; i++) many.push(await login());
    const capped = await User.findById(u._id).select('+refreshTokens').lean();
    ok(`الجلسات مسقوفة بثمانٍ (${(capped.refreshTokens || []).length})`,
      (capped.refreshTokens || []).length <= 8);
    ok('وآخر جهاز دخل يعمل', (await me(many[many.length - 1].jar)).status === 200);
  } finally {
    await Employee.deleteMany({ email: { $regex: '^zz-sess' } });
    await User.deleteMany({ email: { $regex: '^zz-sess' } });
  }

  console.log(`\n${'─'.repeat(60)}\nنجح ${pass} · فشل ${fail}`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('FATAL', e); process.exit(1); });
