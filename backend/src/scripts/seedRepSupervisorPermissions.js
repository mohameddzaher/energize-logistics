/**
 * seedRepSupervisorPermissions: default pages for the two rep supervisors. Usage: node src/scripts/seedRepSupervisorPermissions.js [--apply] (shows only by default).
 * Each supervisor is an employee in the individuals department and inherits the whole section; this sets his screens: - Operational: the rep's day: daily entry,
 * operating orders, performance, custody, store and light transport; no section settings or projects. - Inspection: one thing: start-of-shift inspection, its
 * log and analysis. Pages set from the permissions page are not overwritten: if the role has a document, only its unset pages are filled.
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '..', '.env'), quiet: true });
const mongoose = require('mongoose');
const RolePermission = require('../models/RolePermission');
const { pagesOfSection } = require('../config/pages');

const PLAN = {
  b2c_rep_supervisor: {
    home: '/system/b2c/daily-entry',
    open: [
      '/system/b2c/daily-entry', '/system/b2c/orders', '/system/b2c/reps-performance',
      '/system/b2c/light-transport/custody', '/system/b2c/light-transport', '/system/b2c/light-transport/store',
      '/system/b2c/duty/start', '/system/b2c/duty',
      // He also reports to HR what he sees in the field; he is the first to see a rep return or leave.
      '/system/b2c/hr-requests',
      '/system/b2c/my-tasks', '/system/b2c/complaints',
    ],
  },
  b2c_inspection_supervisor: {
    home: '/system/b2c/duty/start',
    open: ['/system/b2c/duty/start', '/system/b2c/duty', '/system/b2c/my-tasks', '/system/b2c/complaints'],
  },
};
const APPLY = process.argv.includes('--apply');
// Rewrite when the role's meaning changes.
// Seeding fills blanks and never overrides a decision, which is right except when the role's meaning changes: `b2c_rep_supervisor` used to be the inspection supervisor (closed to every screen but inspection), then became the operational supervisor while inspection became another role. What is in the database is an old decision for a meaning that no longer exists, so the plan is written explicitly with `--rewrite`.
const REWRITE = process.argv.includes('--rewrite');

(async () => {
  await mongoose.connect(process.env.MONGODB_URI);
  for (const [ROLE, plan] of Object.entries(PLAN)) {
    const OPEN = new Set(plan.open);
    // eslint-disable-next-line no-await-in-loop
    const doc = await RolePermission.findOne({ role: ROLE });
    const pages = doc?.pages ? Object.fromEntries(doc.pages) : {};
    const added = {};
    for (const p of pagesOfSection('B2C')) {
      if (!REWRITE && Object.prototype.hasOwnProperty.call(pages, p.key)) continue;
      if (REWRITE && pages[p.key] === OPEN.has(p.key)) continue;   // No change
      added[p.key] = OPEN.has(p.key);
    }
    console.log(`── ${ROLE}: ${doc ? 'مستندٌ موجود' : 'لا مستند — يُنشأ'} · تُضاف ${Object.keys(added).length} صفحة`);
    Object.entries(added).forEach(([k, v]) => console.log(`     ${v ? '✓' : '✗'} ${k}`));
    const setHome = REWRITE ? doc?.homePage !== plan.home : !doc?.homePage;
    if (APPLY && (Object.keys(added).length || setHome)) {
      // eslint-disable-next-line no-await-in-loop
      await RolePermission.updateOne(
        { role: ROLE },
        { $set: {
          ...Object.fromEntries(Object.entries(added).map(([k, v]) => [`pages.${k}`, v])),
          ...(setHome ? { homePage: plan.home } : {}),
        } },
        { upsert: true },
      );
      // Memory shared between the two workers; see utils/permissions.
      require('../utils/permissions').invalidate(ROLE);
      console.log('   ✓ كُتب');
    }
  }
  process.exit(0);
})();
