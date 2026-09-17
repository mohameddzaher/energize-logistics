/**
 * seedRepSupervisorPermissions — الصفحاتُ الافتراضيّة لمشرف المناديب.
 *
 *   node src/scripts/seedRepSupervisorPermissions.js          يعرض فقط
 *   node src/scripts/seedRepSupervisorPermissions.js --apply  يكتب
 *
 * المشرفُ موظّفٌ في قسم الأفراد فيرث القسمَ كلَّه. وهذا يضبط له الشاشات:
 * التفقّد وسجلُّه ومهامُّه وشكاواه فقط. ولا يكتب فوق ما ضُبط من صفحة
 * الصلاحيّات — إن وُجد مستندٌ للدور تُملأ الصفحاتُ الساكتةُ فيه وحدَها.
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '..', '.env'), quiet: true });
const mongoose = require('mongoose');
const RolePermission = require('../models/RolePermission');
const { pagesOfSection } = require('../config/pages');

const ROLE = 'b2c_rep_supervisor';
const OPEN = new Set(['/system/b2c/duty/start', '/system/b2c/duty', '/system/b2c/my-tasks', '/system/b2c/complaints']);
const APPLY = process.argv.includes('--apply');

(async () => {
  await mongoose.connect(process.env.MONGODB_URI);
  const doc = await RolePermission.findOne({ role: ROLE });
  const pages = doc?.pages ? Object.fromEntries(doc.pages) : {};
  const added = {};
  for (const p of pagesOfSection('B2C')) {
    if (Object.prototype.hasOwnProperty.call(pages, p.key)) continue;
    added[p.key] = OPEN.has(p.key);
  }
  console.log(doc ? 'مستندٌ موجود' : 'لا مستند — يُنشأ', added);
  // يدخل المشرفُ على شاشة التفقّد مباشرةً — هي عملُه كلُّه.
  const setHome = !doc?.homePage;
  if (APPLY && (Object.keys(added).length || setHome)) {
    await RolePermission.updateOne(
      { role: ROLE },
      { $set: {
        ...Object.fromEntries(Object.entries(added).map(([k, v]) => [`pages.${k}`, v])),
        ...(setHome ? { homePage: '/system/b2c/duty/start' } : {}),
      } },
      { upsert: true },
    );
    // الذاكرةُ المشتركة بين العاملَين — راجع utils/permissions.
    require('../utils/permissions').invalidate(ROLE);
    console.log('✓ كُتب');
  }
  process.exit(0);
})();
