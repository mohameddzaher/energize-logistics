/**
 * seedRepSupervisorPermissions — الصفحاتُ الافتراضيّة لمشرفَي المناديب.
 *
 *   node src/scripts/seedRepSupervisorPermissions.js          يعرض فقط
 *   node src/scripts/seedRepSupervisorPermissions.js --apply  يكتب
 *
 * كلُّ مشرفٍ موظّفٌ في قسم الأفراد فيرث القسمَ كلَّه، وهذا يضبط له شاشاتِه:
 *   • **التشغيليّ** يومُ المندوب: الإدخالُ اليوميّ وأوامرُ التشغيل والأداءُ
 *     والعهدةُ والمخزنُ والنقلُ الخفيف — ولا إعداداتَ قسمٍ ولا مشاريع.
 *   • **التفقّديّ** لحظةٌ واحدة: تفقّدُ بداية الدوام وسجلُّه وتحليلُه.
 * ولا يكتب فوق ما ضُبط من صفحة الصلاحيّات — إن وُجد مستندٌ للدور تُملأ
 * الصفحاتُ الساكتةُ فيه وحدَها.
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
      '/system/b2c/custody', '/system/b2c/light-transport', '/system/b2c/light-transport/store',
      '/system/b2c/duty/start', '/system/b2c/duty',
      // ويُبلِّغ الموارد البشريّة بما رآه في الميدان — هو أوّلُ من يرى عودةَ
      // المندوب أو تركَه.
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
// ── وإعادةُ الكتابة حين يتغيّر معنى الدور ────────────────────────────────────
// البذرُ يملأ الساكتَ ولا يكتب فوق قرار. وذلك صحيحٌ إلّا يومَ **يتغيّر معنى
// الدور**: كان `b2c_rep_supervisor` هو مشرفَ التفقّد، فكُتب له إغلاقُ كلِّ
// شاشةٍ إلّا التفقّد. ثمّ صار المشرفَ التشغيليَّ وصار التفقّدُ دورًا آخر — فما
// في القاعدة قرارٌ قديمٌ لمعنًى لم يبقَ. فتُكتب الخطّةُ صراحةً بـ`--rewrite`.
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
      if (REWRITE && pages[p.key] === OPEN.has(p.key)) continue;   // لا تغيير
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
      // الذاكرةُ المشتركة بين العاملَين — راجع utils/permissions.
      require('../utils/permissions').invalidate(ROLE);
      console.log('   ✓ كُتب');
    }
  }
  process.exit(0);
})();
