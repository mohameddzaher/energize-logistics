/**
 * auditCompanyEmails — سجل بريد الشركة: الفصل عن حسابات السيستم، وتخزين
 * كلمات المرور.
 *
 *   node src/scripts/auditCompanyEmails.js
 *   node src/scripts/auditCompanyEmails.js --base http://127.0.0.1:5001
 *
 * الحاجات اللي بيتأكد منها:
 *   • كلمة المرور مش بترجع أبدًا مع القائمة ولا مع الإنشاء/التعديل.
 *   • مخزّنة مشفّرة في مونجو — مش نص صريح.
 *   • الكشف مسار مستقل، بيتسجّل، ومقفول على أدوار تقنية المعلومات.
 *   • تغيير باسوورد بريد الشركة **ما بيمسّش** دخول الموظف على السيستم، والعكس.
 *   • الربط بموظف اختياري وبيتربط بعدين.
 *
 * بيمسح كل ما أنشأه (zz-*) في الآخر ولا بيلمس بيانات حقيقية.
 */
require('dotenv').config();
const mongoose = require('mongoose');
const argv = process.argv.slice(2);
const iB = argv.indexOf('--base');
const BASE = (iB >= 0 && argv[iB + 1] ? argv[iB + 1] : process.env.BASE || 'http://localhost:5599').replace(/\/$/, '');
let pass = 0, fail = 0;
const ok = (l, c, x = '') => { console.log(`  ${c ? '✓' : '✗ FAIL'}  ${l}${x ? '  — ' + x : ''}`); c ? pass++ : fail++; };
async function req(m, p, ck, b) {
  const r = await fetch(`${BASE}${p}`, { method: m, headers: { 'Content-Type': 'application/json', ...(ck ? { Cookie: ck } : {}) }, body: b ? JSON.stringify(b) : undefined });
  let j = null; try { j = await r.json(); } catch (e) {}
  return { status: r.status, body: j };
}
async function login(e, pw = 'Test@12345') {
  const r = await fetch(`${BASE}/api/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: e, password: pw }) });
  if (r.status === 429) { console.error('RATE LIMITED — restart the API or wait 15 min.'); process.exit(2); }
  return { status: r.status, ck: (r.headers.getSetCookie?.() || []).map((c) => c.split(';')[0]).join('; ') };
}
(async () => {
  await mongoose.connect(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 20000 });
  const User = require('../models/User');
  const Employee = require('../models/Employee');
  const CompanyEmail = require('../models/CompanyEmail');

  await User.deleteMany({ email: { $regex: '^zz-ce' } });
  await CompanyEmail.deleteMany({ email: { $regex: '^zz-' } });
  const it = await User.create({ email: 'zz-ce-it@example.invalid', password: 'Test@12345', firstName: 'تقنية', lastName: 'م', role: 'it_manager' });
  const emp = await User.create({ email: 'zz-ce-emp@example.invalid', password: 'Test@12345', firstName: 'موظف', lastName: 'ع', role: 'employee' });
  const C = { it: (await login(it.email)).ck, emp: (await login(emp.email)).ck };

  const MAILBOX_PW = 'Mailbox#2026!';

  console.log('── إنشاء صندوق وربطه بموظف ──');
  const anEmployee = await Employee.findOne({}).select('_id firstName arabicName employeeNumber').lean();
  const made = await req('POST', '/api/it/emails', C.it, {
    email: 'zz-test.person', displayName: 'zz تجربة', password: MAILBOX_PW,
    employee: anEmployee ? String(anEmployee._id) : null,
  });
  ok('الصندوق اتعمل', made.status === 201, `http ${made.status} ${made.body?.message || ''}`);
  const ID = made.body?.email?._id;
  ok('الدومين اتكمّل تلقائيًا', made.body?.email?.email === `zz-test.person@energize-logistics.com`, made.body?.email?.email);
  ok('اتربط بالموظف', !!made.body?.email?.employee === !!anEmployee);
  ok('الرد مفيهوش كلمة المرور', !JSON.stringify(made.body).includes(MAILBOX_PW));

  console.log('\n── كلمة المرور مش بتتخزّن نص صريح ──');
  const raw = await CompanyEmail.findById(ID).select('+passwordEnc').lean();
  ok('مفيش نص صريح في مونجو', raw.passwordEnc && !raw.passwordEnc.includes(MAILBOX_PW), raw.passwordEnc?.slice(0, 18) + '…');
  ok('بصيغة الخزنة v1:iv:tag:data', /^v1:[^:]+:[^:]+:[^:]+$/.test(raw.passwordEnc || ''));
  ok('اتسجّل مين حطّها وامتى', !!raw.passwordSetAt && !!raw.passwordSetByName, raw.passwordSetByName);

  console.log('\n── القائمة ما بتسرّبش كلمة المرور ──');
  const list = await req('GET', '/api/it/emails', C.it);
  ok('القائمة رجعت', list.status === 200, `${list.body?.emails?.length} صندوق`);
  ok('مفيش كلمة مرور في الرد', !JSON.stringify(list.body).includes(MAILBOX_PW));
  ok('ولا حتى الصيغة المشفّرة', !JSON.stringify(list.body).includes('passwordEnc'));
  ok('العدّادات موجودة', typeof list.body?.counts?.withoutPassword === 'number', JSON.stringify(list.body?.counts));

  console.log('\n── الكشف: مسار مستقل، مسجَّل، ومقفول ──');
  const denied = await req('POST', `/api/it/emails/${ID}/reveal`, C.emp, {});
  ok('موظف عادي مرفوض', denied.status === 403, `http ${denied.status}`);
  const shown = await req('POST', `/api/it/emails/${ID}/reveal`, C.it, {});
  ok('تقنية المعلومات بتشوفها', shown.status === 200 && shown.body?.password === MAILBOX_PW, `http ${shown.status}`);
  const after = await CompanyEmail.findById(ID).lean();
  ok('الكشف اتسجّل باسم اللي عمله', after.revealCount === 1 && !!after.lastRevealedAt && !!after.lastRevealedByName, after.lastRevealedByName);
  const AuditLog = require('../models/AuditLog');
  const trail = await AuditLog.findOne({ action: 'reveal_company_email_password', entityId: ID }).lean();
  ok('واتكتب في سجل التدقيق', !!trail);

  console.log('\n── ده مش حساب دخول السيستم ──');
  // نفس الشخص ليه حساب سيستم وكلمة مروره غير كلمة مرور البريد تمامًا.
  const sysLogin = await login(emp.email);
  ok('حساب السيستم لسه شغال بكلمته', sysLogin.status === 200);
  const asMailbox = await login(emp.email, MAILBOX_PW);
  ok('وكلمة مرور البريد مش بتفتح السيستم', asMailbox.status === 401, `http ${asMailbox.status}`);
  // وتغيير كلمة مرور البريد ما بيلمسش المستخدم.
  const userBefore = await User.findById(emp._id).select('+password').lean();
  await req('PUT', `/api/it/emails/${ID}`, C.it, { password: 'Changed#2026!' });
  const userAfter = await User.findById(emp._id).select('+password').lean();
  ok('تغيير كلمة مرور البريد ما غيّرش باسوورد السيستم', userBefore.password === userAfter.password);
  const stillIn = await login(emp.email);
  ok('والموظف لسه بيدخل السيستم عادي', stillIn.status === 200);
  const reShown = await req('POST', `/api/it/emails/${ID}/reveal`, C.it, {});
  ok('والكلمة الجديدة هي اللي بترجع', reShown.body?.password === 'Changed#2026!');

  console.log('\n── الربط اختياري ──');
  const solo = await req('POST', '/api/it/emails', C.it, { email: 'zz-unlinked', displayName: 'zz بدون ربط' });
  ok('صندوق من غير موظف اتعمل', solo.status === 201, `http ${solo.status}`);
  ok('وبيتعدّ في «غير مربوط»', (await req('GET', '/api/it/emails?linked=no', C.it)).body?.emails?.some((e) => e._id === solo.body.email._id));
  const linkedNow = await req('PUT', `/api/it/emails/${solo.body.email._id}`, C.it, { employee: anEmployee ? String(anEmployee._id) : null });
  ok('واتربط بعدين', linkedNow.status === 200 && (!anEmployee || !!linkedNow.body?.email?.employee));

  console.log('\n── التصدير بكلمات المرور: مقفول ومسجَّل ──');
  const expDenied = await req('GET', '/api/it/emails/export', C.emp);
  ok('موظف عادي مرفوض', expDenied.status === 403, `http ${expDenied.status}`);
  const exp = await req('GET', '/api/it/emails/export?q=zz-', C.it);
  ok('تقنية المعلومات بتصدّر', exp.status === 200, `http ${exp.status}`);
  const mine = (exp.body?.rows || []).find((r) => r.email.startsWith('zz-test.person'));
  ok('كلمة المرور الحقيقية في الملف', mine?.password === 'Changed#2026!', mine?.password);
  ok('مفيش أعمدة النوع/الحالة في التصدير', mine && !('mailboxType' in mine) && !('status' in mine), Object.keys(mine || {}).join(', '));
  // الخاصية اللي بتهم فعلاً: اللي بيتصدّر هو اللي كان معروض. لو الفلتر اتجاهل،
  // حد بيصدّر صف واحد كان هياخد كل كلمات المرور — ولذلك المقارنة بالقائمة نفسها.
  const listSame = await req('GET', '/api/it/emails?q=zz-', C.it);
  ok('التصدير بيحترم نفس فلتر الشاشة',
    exp.body?.exported === (listSame.body?.emails || []).length,
    `تصدير ${exp.body?.exported} · قائمة ${(listSame.body?.emails || []).length}`);
  const bulkTrail = await AuditLog.findOne({ action: 'export_company_email_passwords' }).sort({ createdAt: -1 }).lean();
  ok('التصدير اتسجّل بالعدد والفلتر', !!bulkTrail && bulkTrail.changes?.after?.exported === exp.body?.exported,
    bulkTrail ? `exported=${bulkTrail.changes?.after?.exported} filters=${JSON.stringify(bulkTrail.changes?.after?.filters)}` : 'no entry');

  console.log('\n── التكرار مرفوض ──');
  const dup = await req('POST', '/api/it/emails', C.it, { email: 'zz-unlinked' });
  ok('نفس البريد مرتين مرفوض', dup.status === 400, dup.body?.message);

  await CompanyEmail.deleteMany({ email: { $regex: '^zz-' } });
  await User.deleteMany({ email: { $regex: '^zz-ce' } });
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('FATAL', e); process.exit(1); });
