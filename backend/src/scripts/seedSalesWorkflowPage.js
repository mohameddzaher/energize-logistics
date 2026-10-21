/**
 * seedSalesWorkflowPage — تُفتح صفحةُ «سير عمل التشغيل» للمبيعات (لقيمة البيع).
 *
 *   node src/scripts/seedSalesWorkflowPage.js          يعرض فقط
 *   node src/scripts/seedSalesWorkflowPage.js --apply  يكتب
 *
 * صاحبُ الشركة (٢٠٢٦/١٠/٢١): فريقُ المبيعات يرى «قيمة البيع» في سير العمل ويكتبها.
 * والصفحةُ في قسم «العمليات»، والمبيعاتُ ممنوعةٌ منه افتراضًا — فيردّ حارسُ
 * الصفحات (`pageGate`) كلَّ نداءٍ لـ`/api/workflows` بـ٤٠٣ ولو فتح المسارُ لها.
 *
 * ولا يُمنح القسمُ كلُّه: «العمليات» يحمل المحفظةَ (`/api/wallet`) أيضًا، و`authorize`
 * يمرّر كلَّ مَن خُتم له القسم — فمنحُه يفتح العهدةَ للمبيعات. فتُؤشَّر الصفحةُ
 * وحدَها (تأشيرةٌ صريحة)، وحقولُها تحرسها `ROLE_FIELD_ACCESS`: قيمةُ البيع وحدَها.
 *
 * ولا يكتب فوق قرارٍ في صفحة الصلاحيّات: إن كانت الصفحةُ مكتوبةً للدور تُترك.
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
