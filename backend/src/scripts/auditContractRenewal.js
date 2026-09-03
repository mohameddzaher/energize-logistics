/**
 * auditContractRenewal — التجديدُ يُبقي العقدَ عقدًا.
 *
 *   node src/scripts/auditContractRenewal.js
 *
 * يجدّد عقدًا حقيقيًّا عبر النقطة نفسِها التي تناديها الشاشة، ثمّ يقرأ العقدَ
 * الناتج حقلًا حقلًا. لا يترك أثرًا: ما يُنشأ يُحذف والعقدُ الأصل يُعاد كما كان.
 */
require('dotenv').config();
const mongoose = require('mongoose');

const argv = process.argv.slice(2);
const iB = argv.indexOf('--base');
const BASE = (iB >= 0 && argv[iB + 1] ? argv[iB + 1] : process.env.BASE || 'http://localhost:5599').replace(/\/$/, '');
// المصدرُ يتبع الخادمَ الذي نفحصه لا ملفَّ البيئة المحلّيّ: حارسُ CSRF يقبل
// مصادرَ البرودكشن وحدها، فإرسالُ `localhost` إليه يردّ ٤٠٣ على كلّ POST — وهو
// ما يبدو عطبًا في الميزة وهو عطبٌ في الفحص.
const ORIGIN = /api\.energize-logistics\.com/.test(BASE)
  ? 'https://energize-logistics.com'
  : (process.env.FRONTEND_URL?.split(',')[0].trim() || 'http://localhost:3000');
const PW = 'Passenergize1!';

let pass = 0; let fail = 0;
const ok = (l, c, x = '') => { console.log(`  ${c ? '✓' : '✗ FAIL'}  ${l}${x ? '  — ' + x : ''}`); c ? (pass += 1) : (fail += 1); };
const head = (s) => console.log(`\n── ${s} ${'─'.repeat(Math.max(0, 60 - s.length))}`);

(async () => {
  await mongoose.connect(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 30000 });
  const User = require('../models/User');
  const Employee = require('../models/Employee');
  const Contract = require('../models/Contract');
  const EmployeeRenewal = require('../models/EmployeeRenewal');

  await User.deleteMany({ email: /^zz-renew/ });
  const hr = await User.create({ email: 'zz-renew-hr@example.invalid', password: PW, firstName: 'م', lastName: 'ب', role: 'hr_manager' });

  const login = await fetch(`${BASE}/api/auth/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Origin: ORIGIN },
    body: JSON.stringify({ email: hr.email, password: PW }),
  });
  const ck = (login.headers.getSetCookie?.() || []).map((c) => c.split(';')[0]).join('; ');
  ok('دخول موظّف الموارد البشريّة', login.status === 200, `${login.status}`);
  if (login.status !== 200) { await User.deleteMany({ email: /^zz-renew/ }); process.exit(1); }

  const emp = await Employee.findOne({}).select('_id').lean();
  const made = [];
  try {
    head('العقدُ الجديد يرث شروطَ سابقِه');
    const old = await Contract.create({
      employee: emp._id, type: 'unlimited', startDate: '2025-01-01', endDate: '2026-01-01',
      durationMonths: 24, annualLeaveDays: 27, annualLeaveText: '', probationMonths: 6, probationText: 'غير مطلوب',
      basicSalary: 5500, allowances: 900, jobTitle: 'zz-مسمّى', contractProfession: 'zz-مهنة',
      contractNumber: 'ZZ-1', iqamaNumber: 'ZZ-IQ', employeeNameAr: 'zz-اسم', sponsorRegistration: 'ZZ-CR',
      status: 'active',
    });
    made.push(old._id);

    const r = await fetch(`${BASE}/api/hr/contracts/${old._id}/renew`, {
      method: 'POST', headers: { Cookie: ck, Origin: ORIGIN, 'Content-Type': 'application/json' },
      body: JSON.stringify({ startDate: '2026-01-02', endDate: '2027-01-01', carryOver: false }),
    });
    const j = await r.json().catch(() => ({}));
    ok('يُقبل التجديد', r.status === 201, `${r.status} ${j.message || ''}`);
    const fresh = j.contract && await Contract.findById(j.contract._id).lean();
    if (fresh) made.push(fresh._id);
    ok('وأُنشئ عقدٌ يليه', !!fresh);

    if (fresh) {
      // ── ما كان يضيع كلَّه ────────────────────────────────────────────────
      for (const [k, want] of [
        ['basicSalary', 5500], ['allowances', 900], ['type', 'unlimited'],
        ['durationMonths', 24], ['probationMonths', 6], ['probationText', 'غير مطلوب'],
        ['annualLeaveDays', 27], ['jobTitle', 'zz-مسمّى'], ['contractProfession', 'zz-مهنة'],
        ['contractNumber', 'ZZ-1'], ['iqamaNumber', 'ZZ-IQ'], ['employeeNameAr', 'zz-اسم'],
        ['sponsorRegistration', 'ZZ-CR'],
      ]) ok(`يرث ${k}`, String(fresh[k]) === String(want), `${fresh[k]} — المنتظَر ${want}`);
      ok('وحالتُه «ساري»', fresh.status === 'active', fresh.status);
      ok('ومربوطٌ بسابقِه', String(fresh.renewedFrom) === String(old._id));
      const closed = await Contract.findById(old._id).select('status').lean();
      ok('والسابقُ أُقفل «مجدَّد»', closed.status === 'renewed', closed.status);
    }

    head('والمهنةُ تُغيَّر عند التجديد إن كُتبت');
    const old2 = await Contract.create({
      employee: emp._id, type: 'fixed', startDate: '2025-02-01', endDate: '2026-02-01',
      annualLeaveDays: 21, contractProfession: 'zz-قديمة', contractNumber: 'ZZ-2', status: 'active',
    });
    made.push(old2._id);
    const r2 = await fetch(`${BASE}/api/hr/contracts/${old2._id}/renew`, {
      method: 'POST', headers: { Cookie: ck, Origin: ORIGIN, 'Content-Type': 'application/json' },
      body: JSON.stringify({ startDate: '2026-02-02', endDate: '2027-02-01', carryOver: false,
        contractProfession: 'zz-جديدة', contractNumber: 'ZZ-2B' }),
    });
    const j2 = await r2.json().catch(() => ({}));
    const f2 = j2.contract && await Contract.findById(j2.contract._id).lean();
    if (f2) made.push(f2._id);
    ok('المهنةُ المكتوبةُ هي التي تُكتب', f2?.contractProfession === 'zz-جديدة', f2?.contractProfession);
    ok('ورقمُ العقد الجديد كذلك', f2?.contractNumber === 'ZZ-2B', f2?.contractNumber);

    head('والتعديلُ من الشاشة يحفظ الحقلين');
    const up = await fetch(`${BASE}/api/hr/contracts/${old2._id}`, {
      method: 'PUT', headers: { Cookie: ck, Origin: ORIGIN, 'Content-Type': 'application/json' },
      body: JSON.stringify({ contractNumber: 'ZZ-EDIT', contractProfession: 'zz-معدّلة' }),
    });
    const after = await Contract.findById(old2._id).select('contractNumber contractProfession').lean();
    ok('يُقبل التعديل', up.status === 200, `${up.status}`);
    ok('ويُحفظ رقمُ العقد', after.contractNumber === 'ZZ-EDIT', after.contractNumber);
    ok('وتُحفظ المهنة', after.contractProfession === 'zz-معدّلة', after.contractProfession);
  } finally {
    if (made.length) await Contract.deleteMany({ _id: { $in: made } });
    await EmployeeRenewal.deleteMany({ employee: emp._id, docType: 'contract', previousExpiry: { $in: ['2026-01-01', '2026-02-01'] } });
    await User.deleteMany({ email: /^zz-renew/ });
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  await mongoose.disconnect();
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('FATAL', e); process.exit(1); });
