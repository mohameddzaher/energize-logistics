/**
 * Tests every page in the HR section against the master itself, not a sample.
 * Catches: stale dates next to a required status, expires-within-30-days returning long-expired rows, missing identity numbers in rows.
 * Also that every page has a responding endpoint and archive records (isHrRecord:false) appear in no list or counter.
 */
require('dotenv').config();
const path = require('path');
const mongoose = require('mongoose');

const argv = process.argv.slice(2);
const iB = argv.indexOf('--base');
const BASE = (iB >= 0 && argv[iB + 1] ? argv[iB + 1] : process.env.BASE || 'http://localhost:5599').replace(/\/$/, '');

let pass = 0; let fail = 0;
const ok = (l, c, x = '') => { console.log(`  ${c ? '✓' : '✗ FAIL'}  ${l}${x ? '   — ' + x : ''}`); c ? pass++ : fail++; };

async function req(m, p, ck, b) {
  const r = await fetch(`${BASE}${p}`, {
    method: m, headers: { 'Content-Type': 'application/json', ...(ck ? { Cookie: ck } : {}) },
    body: b ? JSON.stringify(b) : undefined,
  });
  let j = null; try { j = await r.json(); } catch { /* Not JSON. */ }
  return { status: r.status, body: j };
}
async function login(email) {
  const r = await fetch(`${BASE}/api/auth/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: 'Test@12345' }),
  });
  if (r.status === 429) { console.error('RATE LIMITED — استنى شوية'); process.exit(2); }
  return (r.headers.getSetCookie?.() || []).map((c) => c.split(';')[0]).join('; ');
}

// Every page in the section and the endpoint feeding it.
const PAGES = [
  ['/system/hr/master', '/api/hr/master/overview'],
  ['/system/hr/master/expiring', '/api/hr/master/expiring'],
  ['/system/hr/employees', '/api/hr/employees'],
  ['/system/hr/employees/[id]', null],
  ['/system/hr/contracts', '/api/hr/contracts'],
  ['/system/hr/leaves', '/api/hr/leaves'],
  ['/system/hr/leave-types', '/api/hr/leave-types'],
  ['/system/hr/requests', '/api/hr/requests'],
  ['/system/hr/custody', '/api/hr/assets'],
  ['/system/hr/stock', '/api/hr/stock'],
  ['/system/hr/licenses', '/api/hr/licenses'],
  ['/system/hr/kpis', '/api/performance/evaluations'],
  ['/system/hr/my-tasks', '/api/section-work/tasks?section=hr'],
  ['/system/hr/complaints', '/api/section-work/complaints?section=hr'],
  ['/system/hr/me', '/api/hr/me/profile'],
  ['/system/hr/my-leaves', '/api/hr/me/leaves'],
  ['/system/hr/my-requests', '/api/hr/me/requests'],
  ['/system/hr/dashboard', '/api/hr/dashboard'],
];

(async () => {
  await mongoose.connect(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 20000 });
  const User = require('../models/User');
  const Employee = require('../models/Employee');
  const H = require('../config/hrFields');
  const src = require(path.join(__dirname, '..', 'data', 'masters', 'hr_master_final.json'));

  await User.deleteMany({ email: { $regex: '^zz-hrsec' } });
  const u = await User.create({ email: 'zz-hrsec@example.invalid', password: 'Test@12345', firstName: 'تيست', lastName: 'قسم', role: 'hr_manager' });
  const ck = await login(u.email);

  try {
    // 1) Numbers against the file itself
    console.log('\n── الأرقام مقابل الماستر ──');
    const ov = (await req('GET', '/api/hr/master/overview', ck)).body;
    const fileTotal = src.employees.length;
    const fileActive = src.employees.filter((e) => e.employment?.is_active !== false).length;
    // The file is the reference for the total: the row count does not change with user actions.
    ok(`الموظفون = ${fileTotal} (الملف)`, ov?.totals?.employees === fileTotal, `رجع ${ov?.totals?.employees}`);

    // The active-staff count changes daily: someone ended on screen is no longer active whatever the import file says. So the comparison is between the interfaces, not against the file; drift from the file is printed for reading, not failing.
    const drift = fileActive - (ov?.totals?.active ?? 0);
    if (drift) console.log(`  ℹ  ${drift} موظفًا تغيّرت حالتهم بعد الاستيراد — الملف ${fileActive} · النظام ${ov?.totals?.active}`);
    ok('«ليس على رأس العمل» = الإجمالي ناقص العاملين',
      ov?.totals?.notActive === ov?.totals?.employees - ov?.totals?.active,
      `${ov?.totals?.notActive} = ${ov?.totals?.employees} − ${ov?.totals?.active}`);

    // The Employees number must not move when the filter changes; that was the bug showing 321.
    const ovA = (await req('GET', '/api/hr/master/overview?status=active', ck)).body;
    ok('«الموظفون» ثابت مع فلتر «على رأس العمل فقط»', ovA?.totals?.employees === fileTotal, `رجع ${ovA?.totals?.employees}`);
    ok('«المعروض» بيقول العدد المفلتر', ovA?.totals?.filtered === ov?.totals?.active, `رجع ${ovA?.totals?.filtered}`);

    // The required count equals the sentinel count in the file exactly.
    let fileRequired = 0;
    const countReq = (o) => { for (const [k, v] of Object.entries(o || {})) { if (v && typeof v === 'object') countReq(v); else if (k.endsWith('_status') || k === 'status_sentinel') { if (v === 'required') fileRequired++; } } };
    src.employees.forEach(countReq);
    // The required count falls as people fill fields, so it cannot equal the file forever. It must not exceed it (no work lists out of nothing) and must stay positive.
    ok(`بيانات مطلوبة ${ov?.totals?.required} ≤ ${fileRequired} (الملف)`,
      ov?.totals?.required <= fileRequired && ov?.totals?.required >= 0,
      `اكتُمل ${fileRequired - (ov?.totals?.required ?? 0)} خانة منذ الاستيراد`);

    // 2) Every page responds
    console.log('\n── كل صفحة في القسم ──');
    for (const [page, ep] of PAGES) {
      if (!ep) { ok(`${page}  (صفحة تفاصيل)`, true, 'بتتفتح من قايمة الموظفين'); continue; }
      const r = await req('GET', ep, ck);
      ok(`${page.padEnd(34)} ${ep}`, r.status === 200, `HTTP ${r.status}`);
    }

    // Detail page of a real employee.
    const one = await Employee.findOne({ inCurrentMaster: true }).select('_id').lean();
    const det = await req('GET', `/api/hr/employees/${one._id}`, ck);
    ok('/system/hr/employees/[id]  ببيانات حقيقية', det.status === 200, `HTTP ${det.status}`);

    // 3) Every group has a page
    console.log('\n── صفحة كل مجموعة (/system/hr/master/[group]) ──');
    for (const g of H.GROUPS) {
      const r = await req('GET', `/api/hr/master/records/${g.key}`, ck);
      const rows = r.body?.rows || [];
      const hasFields = (r.body?.group?.fields || []).length > 0;
      ok(`${g.key.padEnd(20)} ${String(g.ar).padEnd(22)} ${rows.length} صف`, r.status === 200 && hasFields, `HTTP ${r.status}`);
    }

    // 4) Identity number in every row
    console.log('\n── رقم الهوية موجود في كل جدول ──');
    for (const g of H.GROUPS) {
      const rows = (await req('GET', `/api/hr/master/records/${g.key}`, ck)).body?.rows || [];
      const missing = rows.filter((x) => x.iqamaNumber === undefined).length;
      ok(`${g.key.padEnd(20)} ${rows.length - missing}/${rows.length} صف فيه رقم الهوية`, missing === 0, `${missing} من غير`);
    }
    const exp = (await req('GET', '/api/hr/master/expiring', ck)).body?.rows || [];
    ok(`الانتهاءات: ${exp.length} صف فيهم رقم الهوية`, exp.every((x) => x.iqamaNumber !== undefined),
      `${exp.filter((x) => x.iqamaNumber === undefined).length} من غير`);

    // 5) Original bug: stale date next to required
    console.log('\n── مفيش تاريخ بايت جنب حالة «مطلوب» ──');
    let stale = 0; const examples = [];
    for (const g of H.GROUPS) {
      const rows = (await req('GET', `/api/hr/master/records/${g.key}`, ck)).body?.rows || [];
      for (const r of rows) {
        for (const [k, st] of Object.entries(r.statuses || {})) {
          if (st === 'required' && r.values?.[k]) {
            stale++;
            if (examples.length < 5) examples.push(`${r.name} · ${k} = ${r.values[k]}`);
          }
        }
      }
    }
    ok('مفيش قيمة متخزّنة على حقل حالته «مطلوب»', stale === 0, examples.join(' | '));

    // HRIDOY by name: the one the user saw himself.
    const iq = (await req('GET', '/api/hr/master/records/iqama?q=HRIDOY', ck)).body?.rows || [];
    if (iq.length) {
      const bad = iq.filter((r) => r.statuses?.iqamaExpiry === 'required' && r.values?.iqamaExpiry);
      ok(`HRIDOY: ${iq.length} صف، مفيش تاريخ إقامة وهمي`, bad.length === 0,
        bad.map((b) => `${b.name} = ${b.values.iqamaExpiry}`).join(' | '));
    }

    // 6) Filters
    console.log('\n── الفلاتر ──');
    for (const days of [30, 60, 90, 180]) {
      const r = (await req('GET', `/api/hr/master/records/iqama?withinDays=${days}&includeExpired=0`, ck)).body?.rows || [];
      const outside = r.filter((x) => x.daysRemaining == null || x.daysRemaining < 0 || x.daysRemaining > days);
      ok(`ينتهي خلال ${String(days).padEnd(3)} يوم (من غير المنتهي): ${r.length} صف`, outside.length === 0,
        outside.slice(0, 3).map((x) => `${x.name}=${x.daysRemaining}`).join(' | '));
    }
    const withExp = (await req('GET', '/api/hr/master/records/iqama?withinDays=30&includeExpired=1', ck)).body?.rows || [];
    const noExp = (await req('GET', '/api/hr/master/records/iqama?withinDays=30&includeExpired=0', ck)).body?.rows || [];
    ok(`«مع المنتهي» بيزوّد فعلاً (${withExp.length} مقابل ${noExp.length})`, withExp.length >= noExp.length);

    // Status filters: the number must match the overview card.
    console.log('\n── الضغط على كارت «مطلوب» بيفتح نفس العدد ──');
    let chipChecks = 0;
    for (const g of H.GROUPS.slice(0, 6)) {
      const gov = ov.groups.find((x) => x.key === g.key);
      for (const f of (gov?.fields || []).slice(0, 3)) {
        for (const code of ['required', 'not_required']) {
          const want = f.counts?.[code] || 0;
          if (!want) continue;
          const got = ((await req('GET', `/api/hr/master/records/${g.key}?field=${f.key}&status=${code}`, ck)).body?.rows || []).length;
          if (got !== want) ok(`${g.key}/${f.key}/${code}`, false, `الكارت ${want} والصفحة ${got}`);
          else chipChecks++;
        }
      }
    }
    ok(`${chipChecks} كارت بيفتح نفس العدد اللي مكتوب عليه`, chipChecks > 0);

    // Search by identity number: the thing most often missed.
    const someone = await Employee.findOne({ inCurrentMaster: true, iqamaNumber: { $nin: ['', null] } }).lean();
    const byId = (await req('GET', `/api/hr/master/records/iqama?q=${someone.iqamaNumber}`, ck)).body?.rows || [];
    ok(`البحث برقم الهوية ${someone.iqamaNumber}`, byId.length >= 1 && byId.some((r) => r.iqamaNumber === someone.iqamaNumber));

    // Sort order
    const asc = (await req('GET', '/api/hr/master/records/iqama?sort=iqamaNumber&dir=asc', ck)).body?.rows || [];
    const desc = (await req('GET', '/api/hr/master/records/iqama?sort=iqamaNumber&dir=desc', ck)).body?.rows || [];
    ok('الترتيب برقم الهوية بيقلب', asc.length > 1 && asc[0]?.iqamaNumber !== desc[0]?.iqamaNumber);

    // 7) Archive appears nowhere
    console.log('\n── سجلات الأرشيف مستبعدة ──');
    const archived = await Employee.find({ isHrRecord: false }).select('_id arabicName firstName').lean();
    const empList = (await req('GET', '/api/hr/employees?limit=1000', ck)).body;
    const listRows = empList?.employees || empList?.rows || empList?.data || (Array.isArray(empList) ? empList : []);
    const leaked = listRows.filter((x) => archived.some((a) => String(a._id) === String(x._id)));
    ok(`${archived.length} سجل أرشيفي — مفيش منهم في قايمة الموظفين`, leaked.length === 0,
      leaked.map((x) => x.arabicName || x.firstName).join(' | '));
    const dash = (await req('GET', '/api/hr/dashboard', ck)).body;
    // The dashboard and the board are two pages in one section; two different employee counts on adjacent screens make the reader trust neither.
    ok(`داشبورد: ${dash?.summary?.totalEmployees ?? '?'} موظف = لوحة ${ov?.totals?.employees}`,
      dash?.summary?.totalEmployees === ov?.totals?.employees);
    ok(`داشبورد: ${dash?.summary?.activeEmployees ?? '?'} على رأس العمل = لوحة ${ov?.totals?.active}`,
      dash?.summary?.activeEmployees === ov?.totals?.active);

    // 8) Filling from the screen lowers the counter
    console.log('\n── الملء من الشاشة ──');
    const target = await Employee.findOne({ inCurrentMaster: true, 'fieldStatus.companyNumberStatus': 'required' }).lean();
    if (target) {
      const before = (await req('GET', '/api/hr/master/overview?fresh=0', ck)).body?.totals?.required;
      const w = await req('PATCH', `/api/hr/master/employees/${target._id}/fields`, ck, { fields: { companyNumber: '0500000000' } });
      const after = (await req('GET', '/api/hr/master/overview', ck)).body?.totals?.required;
      ok('الحفظ نجح', w.status === 200, `HTTP ${w.status}`);
      ok(`العدّاد نقص ${before} → ${after}`, after === before - 1);
      // Restore it as it was.
      await Employee.updateOne({ _id: target._id }, { $set: { companyNumber: '', 'fieldStatus.companyNumberStatus': 'required' } });
      const back = (await req('GET', '/api/hr/master/overview?fresh=1', ck)).body?.totals?.required;
      ok(`رجع لأصله ${back}`, back === before);
    } else ok('مفيش حقل «مطلوب» للتجربة', false);
  } finally {
    await Employee.deleteMany({ email: { $regex: '^zz-hrsec' } });
    await User.deleteMany({ email: { $regex: '^zz-hrsec' } });
  }

  console.log(`\n${'─'.repeat(64)}\nنجح ${pass} · فشل ${fail}`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('FATAL', e); process.exit(1); });
