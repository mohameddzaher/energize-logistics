/**
 * Assigns the vendors team roles: manager, team leader and staff, matched by name on active accounts.
 * Refuses when a name matches no account or several (pass --pick <key>=<userId> to choose), so nobody is changed by a guess.
 * Usage: node src/scripts/assignVendorsTeam.js (dry run) | --apply [--pick hossam=<id> ...]
 */
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const mongoose = require('mongoose');
const User = require('../models/User');

const APPLY = process.argv.includes('--apply');
const PICK = Object.fromEntries(process.argv.flatMap((a, i, all) => (a === '--pick' && all[i + 1] ? [all[i + 1].split('=')] : [])));
// Hossam Medhat and Hossam Abdullah are the same person; either name matches.
const TEAM = [
  { key: 'morsy', role: 'vendors_manager', rx: /مرسي|مرسى|mors[iy]/i },
  { key: 'nariman', role: 'vendors_team_leader', rx: /ناريمان|نريمان|narim[ae]n/i },
  { key: 'aisha', role: 'vendors_staff', rx: /عائشة|عايشة|عائشه|عايشه|a[iy]sha|aysha/i },
  { key: 'hossam', role: 'vendors_staff', rx: /حسام\s*(مدحت|عبد\s*الله)|hossam\s*(medhat|abd[ue]?l+ah)|hosam\s*(medhat|abd[ue]?l+ah)/i },
  { key: 'saja', role: 'vendors_staff', rx: /سجى|سجا|saja|saga/i },
];

(async () => {
  await mongoose.connect(process.env.MONGODB_URI);
  const users = await User.find({ isActive: { $ne: false } }).select('firstName lastName email role').lean();
  const full = (u) => `${u.firstName || ''} ${u.lastName || ''}`.replace(/\s+/g, ' ').trim();
  const plan = []; let blocked = 0;
  for (const m of TEAM) {
    let hits = users.filter((u) => m.rx.test(full(u)) || m.rx.test(u.email.split('@')[0].replace(/[._-]/g, ' ')));
    if (PICK[m.key]) hits = hits.filter((u) => String(u._id) === PICK[m.key]);
    if (hits.length !== 1) {
      blocked += 1;
      console.log(`✗ ${m.key} → ${m.role}: ${hits.length ? `${hits.length} حسابات — اختر بـ --pick ${m.key}=<id>` : 'لا حسابَ مطابق'}`);
      hits.forEach((u) => console.log(`    ${u._id}  ${full(u)}  <${u.email}>  (${u.role})`));
      continue;
    }
    const u = hits[0];
    console.log(`${u.role === m.role ? '=' : '✓'} ${m.key}: ${full(u)} <${u.email}>  ${u.role} → ${m.role}`);
    if (u.role !== m.role) plan.push({ u, role: m.role });
  }
  if (APPLY && blocked) { console.log('لم يُكتب شيء: حُلَّ الأسماء غير المحسومة أوّلًا.'); return mongoose.disconnect(); }
  if (APPLY && plan.length) {
    const dir = fs.existsSync('/opt/energize/backups') ? '/opt/energize/backups' : path.join(__dirname, '../../');
    const f = path.join(dir, `users-before-vendors-team-${Date.now()}.json`);
    fs.writeFileSync(f, JSON.stringify(plan.map((p) => ({ _id: p.u._id, email: p.u.email, role: p.u.role })), null, 1));
    // Through the document so the role validator and save hooks run.
    for (const p of plan) { const doc = await User.findById(p.u._id); doc.role = p.role; await doc.save(); }
    console.log(`كُتب ${plan.length} · نسخةٌ احتياطيّة: ${f}`);
  } else console.log(APPLY ? 'لا تغيير.' : 'عرضٌ فقط (--apply للكتابة)');
  await mongoose.disconnect();
})().catch((e) => { console.error(e); process.exit(1); });
