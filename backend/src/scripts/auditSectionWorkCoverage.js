/* eslint-disable no-console */
/**
 * auditSectionWorkCoverage: every section with staff has the My Tasks and Complaints pages.
 * Prevents a new section being left out of the tasks/complaints section list, which made its manager miss two pages (the API answered 400 silently).
 * Iterates the sections in config/sections.js rather than a hand-written list, so new sections are checked automatically.
 * Business review is excluded on purpose: it is a managers' forum with no roles of its own, and its My Tasks means meeting items from another collection.
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

// Section key in config -> section-work key and its page path.
const MAP = {
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
// Forum, not a staff section; see the note above.
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

    // A section missing from the list must be rejected, not pass silently.
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
