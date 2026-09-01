/* eslint-disable no-console */
/**
 * auditSectionWorkCoverage — «مهامي» و«الشكاوى» موجودين في كل قسم له موظفين.
 *
 *   node src/scripts/auditSectionWorkCoverage.js --base https://api.energize-logistics.com
 *
 * الحاجة اللي بيمنعها: قسم يتعمل وينسوا يضيفوه لقايمة الأقسام اللي ليها مهام
 * وشكاوى، فمدير القسم يدخل يلاقي قسمه ناقص صفحتين موجودين عند كل زميل له —
 * وده اللي حصل فعلاً مع المركبات، والـAPI كان بيرد 400 من غير ما حد ياخد باله.
 *
 * الفحص بيمشي على **الأقسام نفسها** من config/sections.js، مش على قايمة مكتوبة
 * بالإيد هنا — عشان أي قسم جديد يتضاف يتفحص لوحده.
 *
 * مراجعة الأعمال مستثناة عن قصد: مالهاش أدوار خاصة بيها (منتدى بين مديري
 * الأقسام)، و«مهامي» عندها معناها بنود الاجتماعات من مجموعة تانية خالص.
 */
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const mongoose = require('mongoose');

const argv = process.argv.slice(2);
const iB = argv.indexOf('--base');
const BASE = (iB >= 0 && argv[iB + 1] ? argv[iB + 1] : process.env.BASE || 'http://localhost:5599').replace(/\/$/, '');

let pass = 0; let fail = 0;
const ok = (l, c, x = '') => { console.log(`  ${c ? '✓' : '✗ FAIL'}  ${l}${x ? '   — ' + x : ''}`); c ? pass++ : fail++; };

// مفتاح القسم في الإعدادات → مفتاح section-work ومسار صفحاته.
const MAP = {
  'Customers & Finance': ['finance', 'finance'],
  Operations: ['operations', 'operations'],
  Collections: ['collections', 'collections-dept'],
  'Operations Platform': ['ops', 'ops'],
  'Shipment Orders': ['shipment-orders', 'shipment-orders'],
  'Fleet Management': ['fleet', 'fleet'],
  Customs: ['customs', 'customs'],
  Vehicles: ['vehicles', 'vehicles'],
  'Location Solutions': ['ls2', 'ls2'],
  Marketing: ['marketing', 'marketing'],
  'Business Development': ['bd', 'bd'],
  'Software & IT': ['it', 'it'],
  Administration: ['administration', 'administration'],
  Contracts: ['contracts', 'contracts'],
  B2C: ['b2c', 'b2c'],
  Workshop: ['workshop', 'workshop'],
  Remote: ['remote', 'remote'],
  HR: ['hr', 'hr'],
  CRM: ['crm', 'crm'],
  Sales: ['sales', 'sales'],
  Accounting: ['accounting', 'accounting'],
  Procurement: ['procurement', 'procurement'],
};
// منتدى، مش قسم بموظفين — شوف الشرح فوق.
const EXEMPT = new Set(['Business Review']);

(async () => {
  await mongoose.connect(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 20000 });
  const User = require('../models/User');
  const S = require('../config/sections');
  const R = require('../config/roles');
  const { SECTIONS: ALLOWED } = require('../controllers/sectionWorkController');

  const FRONT = path.join(__dirname, '..', '..', '..', 'frontend', 'src', 'app', 'system');
  const LAYOUT = fs.existsSync(path.join(FRONT, 'layout.tsx'))
    ? fs.readFileSync(path.join(FRONT, 'layout.tsx'), 'utf8') : '';

  await User.deleteMany({ email: { $regex: '^zz-swcov' } });
  const u = await User.create({
    email: 'zz-swcov@example.invalid', password: 'Test@12345',
    firstName: 'ت', lastName: 'غ', role: 'super_admin', isActive: true,
  });
  const lr = await fetch(`${BASE}/api/auth/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: u.email, password: 'Test@12345' }),
  });
  if (lr.status === 429) { console.error('RATE LIMITED'); process.exit(2); }
  const ck = (lr.headers.getSetCookie?.() || []).map((c) => c.split(';')[0]).join('; ');

  try {
    console.log(`الأقسام: ${S.SECTIONS.length} · مستثنى: ${[...EXEMPT].join(', ')}\n`);
    for (const sec of S.SECTIONS) {
      if (EXEMPT.has(sec.key)) {
        console.log(`  ~  ${sec.key.padEnd(22)} مستثنى — مالوش أدوار خاصة (${(R.rolesOfSection(sec.key) || []).length} دور)`);
        continue;
      }
      const entry = MAP[sec.key];
      if (!entry) { ok(`${sec.key} — مش معروف في الخريطة`, false, 'ضيفه في MAP'); continue; }
      const [key, base] = entry;

      const problems = [];
      if (!ALLOWED.includes(key)) problems.push('مش في قايمة الباك');
      for (const [kind, ep] of [['tasks', 'tasks'], ['complaints', 'complaints']]) {
        const r = await fetch(`${BASE}/api/section-work/${ep}?section=${key}`, { headers: { Cookie: ck } });
        if (r.status !== 200) problems.push(`${kind} → HTTP ${r.status}`);
      }
      for (const f of ['my-tasks', 'complaints', 'kpis']) {
        if (!fs.existsSync(path.join(FRONT, base, f, 'page.tsx'))) problems.push(`صفحة ${f} ناقصة`);
        if (LAYOUT && !LAYOUT.includes(`/system/${base}/${f}'`)) problems.push(`مدخل ${f} مش في القايمة`);
      }
      ok(`${sec.key.padEnd(22)} (${key})`, problems.length === 0, problems.join(' | '));
    }

    // القسم اللي مش في القايمة لازم يترفض — مش يعدّي بصمت
    const bad = await fetch(`${BASE}/api/section-work/tasks?section=zz-not-a-section`, { headers: { Cookie: ck } });
    console.log('');
    ok('قسم مش معروف بيترفض', bad.status === 400, `HTTP ${bad.status}`);
  } finally {
    const Employee = require('../models/Employee');
    await Employee.deleteMany({ email: { $regex: '^zz-swcov' } });
    await User.deleteMany({ email: { $regex: '^zz-swcov' } });
  }

  console.log(`\n${'─'.repeat(60)}\nنجح ${pass} · فشل ${fail}`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('FATAL', e); process.exit(1); });
