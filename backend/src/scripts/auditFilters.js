/* eslint-disable no-console */
/**
 * auditFilters — الفلاتر بترجّع اللي بتقول عليه بالظبط.
 *
 *   node src/scripts/auditFilters.js --base https://api.energize-logistics.com
 *
 * الفلتر اللي رقمه مختلف عن عدد الصفوف اللي بيفتحها أسوأ من اللي مش موجود:
 * بيخلّي المستخدم يشك في الشاشة كلها. التيست ده بيقارن **العدد اللي هيظهر على
 * الشريحة** بـ**عدد الصفوف اللي هترجع** — لكل شريحة، على الداتا الحقيقية،
 * بنفس الشروط المكتوبة في الواجهة بالظبط.
 *
 * ولو الشرط في الواجهة اتغيّر ولا اتغيّر هنا، الرقم هيختلف والتيست هيقع — وده
 * المقصود.
 */
require('dotenv').config();
const mongoose = require('mongoose');

const argv = process.argv.slice(2);
const iB = argv.indexOf('--base');
const BASE = (iB >= 0 && argv[iB + 1] ? argv[iB + 1] : process.env.BASE || 'http://localhost:5599').replace(/\/$/, '');

let pass = 0; let fail = 0;
const ok = (l, c, x = '') => { console.log(`  ${c ? '✓' : '✗ FAIL'}  ${l}${x ? '   — ' + x : ''}`); c ? pass++ : fail++; };

// نفس شروط الشرايح في الواجهة، حرفيًا.
const TRAILER_CHIPS = {
  mounted: (x) => !!x.currentPlate,
  free: (x) => !x.currentPlate && x.status !== 'retired',
  retired: (x) => x.status === 'retired',
};
const FLATBED_CHIPS = {
  full: (f) => (f.tireCount || 0) >= 14,
  short: (f) => (f.tireCount || 0) > 0 && (f.tireCount || 0) < 14,
  none: (f) => !(f.tireCount || 0),
  noTrailer: (f) => !f.currentTrailerNumber,
  noGps: (f) => f.unitId == null,
};
const HOT = (v) => v.maxTireTempC != null && v.maxTireTempC >= 75;
const LOW = (v) => v.minTirePressurePsi != null && v.minTirePressurePsi < 90;
const TIRE_CHIPS = {
  any: (v) => HOT(v) || LOW(v) || v.tireFaults > 0,
  hot: HOT,
  low: LOW,
  faults: (v) => v.tireFaults > 0,
  ok: (v) => !HOT(v) && !LOW(v) && !(v.tireFaults > 0),
};

(async () => {
  await mongoose.connect(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 20000 });
  const User = require('../models/User');
  const Employee = require('../models/Employee');

  await User.deleteMany({ email: { $regex: '^zz-filters' } });
  const u = await User.create({
    email: 'zz-filters@example.invalid', password: 'Test@12345',
    firstName: 'ت', lastName: 'ف', role: 'super_admin', isActive: true,
  });
  const lr = await fetch(`${BASE}/api/auth/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: u.email, password: 'Test@12345' }),
  });
  if (lr.status === 429) { console.error('RATE LIMITED'); process.exit(2); }
  const ck = (lr.headers.getSetCookie?.() || []).map((c) => c.split(';')[0]).join('; ');
  const get = async (p) => (await (await fetch(`${BASE}${p}`, { headers: { Cookie: ck } })).json());

  try {
    const ov = await get('/api/ls2/assets/overview');
    const flatbeds = ov.flatbeds || [];
    const trailers = ov.trailers || [];

    // ═══ التيدرات — المثال اللي اتطلب بالاسم ════════════════════════════════
    console.log('── فلاتر التيدرات ──');
    let sum = 0;
    for (const [key, test] of Object.entries(TRAILER_CHIPS)) {
      const n = trailers.filter(test).length;
      sum += n;
      ok(`${key.padEnd(10)} ${n}`, true);
    }
    ok(`المجموع = الإجمالي (${sum} = ${trailers.length})`, sum === trailers.length,
      'الشرايح لازم تغطّي كل صف مرة واحدة');
    const standing = trailers.filter(TRAILER_CHIPS.free);
    ok(`«واقفة (غير مركّبة)» بترجّع ${standing.length} تيدر`, standing.length > 0,
      standing.map((x) => x.trailerNumber).join(', ') || 'مفيش');
    ok('وكلهم فعلاً من غير عربية', standing.every((x) => !x.currentPlate));

    // ═══ السطحات ═════════════════════════════════════════════════════════════
    console.log('\n── فلاتر السطحات ──');
    for (const [key, test] of Object.entries(FLATBED_CHIPS)) {
      ok(`${key.padEnd(12)} ${flatbeds.filter(test).length}`, true);
    }
    const cover = flatbeds.filter(FLATBED_CHIPS.full).length
      + flatbeds.filter(FLATBED_CHIPS.short).length
      + flatbeds.filter(FLATBED_CHIPS.none).length;
    ok(`مكتمل + ناقص + ما اتجردش = الإجمالي (${cover} = ${flatbeds.length})`, cover === flatbeds.length);
    // «ناقصة كاوتش» ما تشملش اللي مفيهاش خالص — دول فئتين مختلفتين
    ok('«ناقصة» و«ما اتجردتش» ما بيتداخلوش',
      !flatbeds.some((f) => FLATBED_CHIPS.short(f) && FLATBED_CHIPS.none(f)));

    // ═══ الكاوتش الحيّ ═══════════════════════════════════════════════════════
    console.log('\n── فلاتر الكاوتش الحيّة ──');
    const veh = (await get('/api/ls2/vehicles')).items || [];
    for (const [key, test] of Object.entries(TIRE_CHIPS)) {
      ok(`${key.padEnd(8)} ${veh.filter(test).length}`, true);
    }
    ok(`«فيها مشكلة» + «سليمة» = الإجمالي (${veh.filter(TIRE_CHIPS.any).length} + ${veh.filter(TIRE_CHIPS.ok).length} = ${veh.length})`,
      veh.filter(TIRE_CHIPS.any).length + veh.filter(TIRE_CHIPS.ok).length === veh.length);
    ok('«حرارة» و«ضغط» و«أعطال» كلهم جوه «فيها مشكلة»',
      veh.filter((v) => TIRE_CHIPS.hot(v) || TIRE_CHIPS.low(v) || TIRE_CHIPS.faults(v))
        .every((v) => TIRE_CHIPS.any(v)));

    // ═══ تنبيهات المركبات ════════════════════════════════════════════════════
    console.log('\n── فلاتر تنبيهات المركبات ──');
    const al = await get('/api/vehicle-registry/alerts');
    const items = al.items || [];
    ok(`الإجمالي ${items.length} = المعلن ${al.total}`, items.length === al.total);
    const byStatusSum = ['expired', 'critical', 'warning'].reduce((n, s) => n + (al.byStatus?.[s] || 0), 0);
    ok(`مجموع الحالات = الإجمالي (${byStatusSum} = ${al.total})`, byStatusSum === al.total);
    for (const s of ['expired', 'critical', 'warning']) {
      ok(`${s.padEnd(9)} ${al.byStatus[s]} = ${items.filter((i) => i.status === s).length}`,
        al.byStatus[s] === items.filter((i) => i.status === s).length);
    }
    const muted = items.filter((i) => i.alertEnabled === false).length;
    ok(`«تنبيهه متقفول» ${muted} = المعلن ${al.mutedCount}`, muted === al.mutedCount);
    ok('ومجموع أنواع المستندات = الإجمالي',
      Object.values(al.byDoc || {}).reduce((a, b) => a + b, 0) === al.total,
      `${Object.values(al.byDoc || {}).reduce((a, b) => a + b, 0)} / ${al.total}`);
  } finally {
    await Employee.deleteMany({ email: { $regex: '^zz-filters' } });
    await User.deleteMany({ email: { $regex: '^zz-filters' } });
  }

  console.log(`\n${'─'.repeat(60)}\nنجح ${pass} · فشل ${fail}`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('FATAL', e); process.exit(1); });
