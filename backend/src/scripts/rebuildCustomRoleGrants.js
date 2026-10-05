/**
 * إعادةُ بناءِ صلاحيّاتِ النوعَين المصنوعَين — بيدٍ واحدةٍ ومن أوّلها.
 *
 * ── ما حدث ─────────────────────────────────────────────────────────────────
 * شاشةُ الصلاحيّات كانت ترسل «ما يخالف قسمَه وحدَه»، وتحسب أنّ القسمَ غيرَ
 * المُدارِ بالمصفوفة (ملفي، إجازاتي، طلباتي، الإعدادات، مركزُ التقارير، البوابة،
 * تقييمُ الأداء، شاشاتُ الإدارة) مفتوحٌ للجميع — والخادمُ يقول عن الدور المصنوع
 * إنّه مغلق. فكلُّ حفظٍ على نوعٍ مصنوعٍ كتب **إغلاقًا صريحًا** على تلك الصفحات
 * كلِّها، لأنّ الشاشةَ قرأتها «مغلقةً وقسمُها مفتوح» فعدّتها استثناءً يُحفَظ.
 *
 * وأثرُه على الأرض: سمر ومحمد الحربي لا يريان ملفَّهما ولا رصيدَ إجازاتهما ولا
 * موضعَ كلمةِ المرور — لا لأنّ أحدًا منعهما، بل لأنّ حفظًا قال «تمّ».
 *
 * والعطبُ أُصلح في الشيفرة (راجع `pageFollowsSection` في utils/permissions:
 * القاعدةُ صارت دالّةً واحدةً يقرؤها الخادمُ عند المنح وعند الاختصار). لكنّ
 * الإغلاقاتَ المكتوبةَ تبقى مكتوبة — فتُمحى هنا.
 *
 * ── وما يُكتب بدلًا منها ────────────────────────────────────────────────────
 * الأقسامُ الممنوحةُ كما هي اليوم (لا يُزاد ولا يُنقَص)، والإغلاقاتُ الصريحةُ
 * داخلَ الأقسام الممنوحة وحدَها — فهي قرارٌ مقصودٌ لا أثرُ عطب. وما عدا ذلك
 * يتبع قسمَه: الدورُ المصنوعُ لا يرث شيئًا، فلا حاجةَ إلى كتابة «مغلق» لما هو
 * مغلقٌ أصلًا. وتُضبَط صفحةُ الدخول: دورٌ مصنوعٌ لا تعرفه خريطةُ المسارات، فبلا
 * صفحةٍ مضبوطةٍ يدخل صاحبُه إلى شاشةٍ قد لا تكون له.
 *
 * الاستعمال:
 *   node src/scripts/rebuildCustomRoleGrants.js            # عرضٌ بلا كتابة
 *   node src/scripts/rebuildCustomRoleGrants.js --apply
 */
require('dotenv').config();
const mongoose = require('mongoose');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const CustomRole = require(`${ROOT}/models/CustomRole`);
const RolePermission = require(`${ROOT}/models/RolePermission`);
const User = require(`${ROOT}/models/User`);
const { SECTION_KEYS, sectionLabel } = require(`${ROOT}/config/sections`);
const { PAGES, getPage, isPage } = require(`${ROOT}/config/pages`);
const { effectivePermissions, effectivePages, homePageFor, invalidate } = require(`${ROOT}/utils/permissions`);

const APPLY = process.argv.includes('--apply');

/**
 * ما يصير عليه كلُّ نوع. مكتوبٌ صراحةً لا مستنبطٌ، ليُقرأ ويُراجَع:
 *   sections — الأقسامُ الممنوحةُ ودرجتُها. وما ليس هنا «ممنوع».
 *   closed   — صفحاتٌ تُغلَق صراحةً **داخل** قسمٍ ممنوح (قرارٌ مقصود).
 *   homePage — أوّلُ شاشةٍ تُفتَح لصاحبه.
 */
const PLAN = {
  ops_team: {
    sections: {
      Operations: 'edit',
      'Operations Platform': 'edit',
      'Shipment Orders': 'edit',
      'Business Review': 'edit',
      CRM: 'edit',
      Sales: 'edit',
    },
    // المحفظةُ ولوحتُها و«التشغيل — خاصّ» تبقى مغلقةً كما هي اليوم: عهدةٌ
    // ماليّةٌ تُقفَل وتُراجَع، وشاشةٌ خاصّةٌ لا يفتحها القسمُ كلُّه.
    closed: ['/system/operations/private', '/system/wallet', '/system/wallet-dashboard'],
    homePage: '/system/operations',
  },
  it_intern: {
    sections: { 'Software & IT': 'edit' },
    closed: [],
    homePage: '/system/it',
  },
};

const SELF = PAGES.filter((p) => p.section === 'Self Service').map((p) => p.key);

(async () => {
  await mongoose.connect(process.env.MONGODB_URI);
  console.log(`\n${APPLY ? '⚙️  تطبيق' : '👁️  عرضٌ فقط'} — إعادةُ بناءِ صلاحيّات الأنواع المصنوعة\n`);

  let problems = 0;
  for (const [key, plan] of Object.entries(PLAN)) {
    const role = await CustomRole.findOne({ key }).lean();
    if (!role) { console.log(`✗ «${key}» غير موجود — تُخطَّى`); problems += 1; continue; }
    const holders = await User.find({ role: key }).select('firstName lastName username email').lean();
    console.log(`── ${role.nameAr} (${key}) — ${holders.length} حساب: ${holders.map((u) => `${u.firstName || ''} ${u.lastName || ''}`.trim() || u.username || u.email).join('، ') || 'لا أحد'}`);

    const beforeDoc = await RolePermission.findOne({ role: key }).lean();
    const beforePages = await effectivePages(key);
    const closedSelfBefore = SELF.filter((k) => beforePages[k] === false);
    const explicitBefore = Object.keys(beforeDoc?.pages || {}).length;
    console.log(`   قبل: ${explicitBefore} تأشيرةً صريحة · خدمتُه الذاتيّةُ مغلقةٌ ${closedSelfBefore.length}/${SELF.length} · صفحةُ الدخول «${beforeDoc?.homePage || 'غير مضبوطة'}»`);

    // كلُّ قسمٍ يُكتب صراحةً: «ممنوع» قرارٌ أيضًا، وسكوتُه عن المصنوع يعني ممنوعًا
    // على أيّ حال — فكتابتُه تجعل الشاشةَ تقرأ قرارًا لا فراغًا.
    const sections = {};
    for (const s of SECTION_KEYS) sections[s] = plan.sections[s] || 'none';

    const pages = {};
    // ── والخدمةُ الذاتيّةُ تُفتَح صراحةً، لا اتّباعًا ────────────────────────
    // القاعدةُ الجديدةُ تفتحها لكلّ دورٍ داخليٍّ ولو كان مصنوعًا، لكنّ الخادمَ
    // الذي لم يُحدَّث بعدُ يقرأ القاعدةَ القديمة. فتُكتب تأشيرةٌ صريحةٌ تسبق
    // القاعدتين: يرى صاحبُها ملفَّه اليومَ لا بعد النشر.
    for (const k of SELF) pages[k] = true;
    for (const k of plan.closed) {
      if (!isPage(k)) { console.log(`   ✗ «${k}» ليست صفحةً معروفة`); problems += 1; continue; }
      const sec = getPage(k).section;
      if ((sections[sec] || 'none') === 'none') {
        console.log(`   ✗ «${k}» في قسمٍ غيرِ ممنوحٍ أصلًا — لا معنى لإغلاقها`);
        problems += 1; continue;
      }
      pages[k] = false;
    }
    if (!isPage(plan.homePage)) { console.log(`   ✗ صفحةُ الدخول «${plan.homePage}» غير معروفة`); problems += 1; continue; }

    if (APPLY) {
      await RolePermission.findOneAndUpdate(
        { role: key },
        { $set: { sections, pages, homePage: plan.homePage } },
        { upsert: true },
      );
      invalidate(key);
    }

    // القراءةُ بعدَها من الخادم نفسِه لا من الخطّة.
    const after = APPLY ? await effectivePages(key) : null;
    const afterSecs = APPLY ? await effectivePermissions(key) : null;
    if (APPLY) {
      const granted = Object.entries(afterSecs).filter(([, v]) => v !== 'none');
      const open = PAGES.filter((p) => after[p.key]).length;
      const closedSelf = SELF.filter((k) => after[k] === false);
      const home = await homePageFor(key);
      console.log(`   بعد: ${granted.length} قسمًا (${granted.map(([k, v]) => `${sectionLabel(k)}=${v}`).join('، ')})`);
      console.log(`         ${open} صفحةً مفتوحة · ${plan.closed.length} إغلاقًا مقصودًا و${SELF.length} تأشيرةَ خدمةٍ ذاتيّة · خدمتُه الذاتيّةُ مغلقةٌ ${closedSelf.length}/${SELF.length} · الدخول «${home}»`);
      const wantGranted = Object.keys(plan.sections).sort().join(',');
      const gotGranted = granted.map(([k]) => k).sort().join(',');
      if (wantGranted !== gotGranted) { console.log(`   ✗ الأقسامُ الساريةُ تخالف الخطّة: ${gotGranted}`); problems += 1; }
      if (closedSelf.length) { console.log('   ✗ خدمتُه الذاتيّةُ ما زالت مغلقة'); problems += 1; }
      if (after[home] === false) { console.log('   ✗ صفحةُ الدخول مغلقةٌ عليه'); problems += 1; }
      for (const k of plan.closed) if (after[k] !== false) { console.log(`   ✗ «${k}» لم تُغلَق`); problems += 1; }
    } else {
      console.log(`   سيصير: ${Object.keys(plan.sections).length} قسمًا · ${plan.closed.length} إغلاقًا مقصودًا · الدخول «${plan.homePage}» · وتُمحى ${explicitBefore - plan.closed.length} إغلاقًا من أثر العطب`);
    }
    console.log('');
  }

  console.log(problems === 0
    ? (APPLY ? '✓ تمّ — وكلُّ ما كُتب قُرئ من الخادم كما كُتب' : '✓ الخطّةُ صحيحة — أعِدها مع --apply')
    : `✗ ${problems} مشكلة`);
  await mongoose.disconnect();
  process.exit(problems ? 1 : 0);
})();
