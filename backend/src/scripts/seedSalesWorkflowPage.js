/**
 * seedSalesWorkflowPage: opens the operations workflow page to sales (for the selling value). Usage: node src/scripts/seedSalesWorkflowPage.js [--apply] (shows only by default). Sales sees and writes 'selling
 * value' in the workflow. The page belongs to the operations section, which sales is denied by default, so the page guard (`pageGate`) rejects every `/api/workflows` call with 403 even if the route is open. The
 * whole section is not granted: operations also carries the wallet (`/api/wallet`) and `authorize` passes anyone stamped for the section, so granting it would open custody to sales. Only the page is ticked (explicit
 * grant), and its fields are guarded by `ROLE_FIELD_ACCESS`: selling value only. A decision on the permissions page is not overwritten: if the page is already written for the role it is left.
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '..', '.env'), quiet: true });
const mongoose = require('mongoose');
const RolePermission = require('../models/RolePermission');

const ROLES = ['sales_manager', 'sales_rep'];
const PAGE = '/system/operations';
const APPLY = process.argv.includes('--apply');

(async () => {
  await mongoose.connect(process.env.MONGODB_URI);
  for (const role of ROLES) {
    // eslint-disable-next-line no-await-in-loop
    const doc = await RolePermission.findOne({ role });
    const pages = doc?.pages ? Object.fromEntries(doc.pages) : {};
    if (Object.prototype.hasOwnProperty.call(pages, PAGE)) {
      console.log(`── ${role}: مكتوبةٌ من قبل (${pages[PAGE] ? 'مفتوحة' : 'مغلقة'}) — تُترك`);
      continue;
    }
    console.log(`── ${role}: ${doc ? 'مستندٌ موجود' : 'لا مستند — يُنشأ'} · تُفتح ${PAGE}`);
    if (APPLY) {
      // eslint-disable-next-line no-await-in-loop
      await RolePermission.updateOne({ role }, { $set: { [`pages.${PAGE}`]: true } }, { upsert: true });
      require('../utils/permissions').invalidate(role);
      console.log('   ✓ كُتب');
    }
  }
  process.exit(0);
})();
