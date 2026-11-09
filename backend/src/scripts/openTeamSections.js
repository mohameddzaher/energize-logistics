/**
 * Opens the sections the sales and vendors teams work in, on roles whose saved RolePermission overrides the defaults.
 * A saved 'none'/'view' or a page closed to false beats config/sections defaultRoles, so a team kept getting 403 after the code opened it.
 * Usage: node src/scripts/openTeamSections.js (dry run) | --apply
 */
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const mongoose = require('mongoose');
const RolePermission = require('../models/RolePermission');
const User = require('../models/User');
const { pagesOfSection } = require('../config/pages');

const APPLY = process.argv.includes('--apply');
const SALES = ['Sales', 'Shipment Orders', 'Contracts'];
const VENDORS = ['Vendors Management', 'Shipment Orders', 'Contracts'];
const TARGET = {
  sales_manager: SALES, sales_rep: SALES,
  vendors_manager: [...VENDORS, 'Operations'], vendors_team_leader: [...VENDORS, 'Operations'], vendors_staff: VENDORS,
};
// Operations is opened page by page for the other team roles (utils/permissions.effectivePages); a closure there still blocks the workflow.
const EXTRA_PAGES = ['/system/operations'];

(async () => {
  await mongoose.connect(process.env.MONGODB_URI);
  const docs = await RolePermission.find({ role: { $in: Object.keys(TARGET) } }).lean();
  const backup = [];
  for (const [role, sections] of Object.entries(TARGET)) {
    const users = await User.countDocuments({ role, isActive: { $ne: false } });
    const d = docs.find((x) => x.role === role);
    if (!d) { console.log(`${role} (${users} مستخدم): لا سجلَّ محفوظ — يتبع الافتراضيّ، لا تغيير`); continue; }
    const sec = d.sections || {};
    const pages = d.pages || {};
    const set = {}; const unset = {};
    for (const s of sections) if (sec[s] !== 'edit') set[`sections.${s}`] = 'edit';
    const paths = new Set([...sections.flatMap((s) => pagesOfSection(s).map((p) => p.key)), ...EXTRA_PAGES]);
    for (const [p, v] of Object.entries(pages)) {
      if (v === false && [...paths].some((x) => p === x || p.startsWith(`${x}/`))) unset[`pages.${p}`] = '';
    }
    const changes = [...Object.keys(set).map((k) => `${k}: ${sec[k.slice(9)] || '—'} → edit`), ...Object.keys(unset).map((k) => `يُفتح ${k.slice(6)}`)];
    console.log(`${role} (${users} مستخدم): ${changes.length ? `\n   ${changes.join('\n   ')}` : 'مفتوحٌ أصلًا'}`);
    if (!changes.length) continue;
    backup.push(d);
    if (APPLY) await RolePermission.updateOne({ _id: d._id }, { ...(Object.keys(set).length ? { $set: set } : {}), ...(Object.keys(unset).length ? { $unset: unset } : {}) });
  }
  if (APPLY && backup.length) {
    const dir = fs.existsSync('/opt/energize/backups') ? '/opt/energize/backups' : path.join(__dirname, '../../');
    const f = path.join(dir, `rolepermissions-before-open-teams-${Date.now()}.json`);
    fs.writeFileSync(f, JSON.stringify(backup, null, 1));
    console.log(`نسخةٌ احتياطيّة: ${f}`);
    // Clear the shared permission cache on both workers.
    const cache = require('../utils/ttlCache');
    await Promise.resolve(cache.clear('perm:'));
  }
  console.log(APPLY ? 'كُتب.' : 'عرضٌ فقط (--apply للكتابة)');
  await mongoose.disconnect();
})().catch((e) => { console.error(e); process.exit(1); });
