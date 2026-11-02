/**
 * Carry the page permission over from the old custody page in the personnel section to the new light transport custody page under its new path.
 * The decision is kept by path: a role for which the old page was opened or closed gets the same decision on the new one; otherwise absence would open it for roles it was closed to, and miss custom roles that inherit nothing.
 * Usage: node src/scripts/carryCustodyPagePermission.js (dry run) | --apply
 */
require('dotenv').config();
const mongoose = require('mongoose');
const RolePermission = require('../models/RolePermission');

const OLD = '/system/b2c/custody';
const NEW = '/system/b2c/light-transport/custody';
const APPLY = process.argv.includes('--apply');

(async () => {
  await mongoose.connect(process.env.MONGODB_URI);
  const docs = await RolePermission.find({}).lean();
  let n = 0;
  for (const d of docs) {
    const pages = d.pages || {};
    const hasOld = Object.prototype.hasOwnProperty.call(pages, OLD);
    const hasNew = Object.prototype.hasOwnProperty.call(pages, NEW);
    if (!hasOld) continue;
    n += 1;
    console.log(`  ${d.role}: القديمة=${pages[OLD]}${hasNew ? ` · الجديدة مكتوبةٌ أصلًا=${pages[NEW]} (تُترَك)` : ' → الجديدة'}`);
    if (!APPLY) continue;
    // eslint-disable-next-line no-await-in-loop
    await RolePermission.updateOne({ _id: d._id }, {
      ...(hasNew ? {} : { $set: { [`pages.${NEW}`]: pages[OLD] } }),
      $unset: { [`pages.${OLD}`]: '' },
    });
  }
  const homes = await RolePermission.find({ homePage: OLD }).select('role').lean();
  for (const h of homes) console.log(`  ${h.role}: مسارُ الدخول كان الصفحةَ القديمة → الجديدة`);
  if (APPLY && homes.length) await RolePermission.updateMany({ homePage: OLD }, { $set: { homePage: NEW } });
  console.log(`${n} دورًا له قرارٌ على الصفحة القديمة · ${APPLY ? 'كُتب' : 'عرضٌ فقط (--apply للكتابة)'}`);
  await mongoose.disconnect();
})().catch((e) => { console.error(e); process.exit(1); });
