/**
 * Rebuilds the grants of the two custom role types from scratch. The permissions screen assumed pages outside the matrix (profile, leave, requests, settings, portal) were open to all while the server treats custom roles as closed, so each save wrote explicit closures on them.
 * The code is fixed (pageFollowsSection in utils/permissions), but the stored closures remain and are erased here.
 * Written instead: granted sections as today, explicit closures only inside granted sections, and the login page; the rest follows its section.
 * Usage: [--apply]; view only otherwise.
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
 * What each type becomes, written explicitly so it can be reviewed.
 * sections: granted sections and level; anything absent is denied.
 * closed: pages explicitly closed inside a granted section (intentional).
 * homePage: first screen opened for the holder.
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
    // Wallet, its dashboard and private operations stay closed as today: custody is financial and reviewed, and the private screen is not open to the whole section.
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

    // Every section is written explicitly: denied is a decision too, and silence for a custom role already means denied, so writing it lets the screen read a decision rather than a blank.
    const sections = {};
    for (const s of SECTION_KEYS) sections[s] = plan.sections[s] || 'none';

    const pages = {};
    // Self-service is opened explicitly, not by following. The new rule opens it for every internal role including custom ones, but a server not yet updated reads the old rule, so an explicit grant takes precedence over both and the user sees their file now, not after deploy.
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

    // Read back from the server itself, not from the plan.
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
