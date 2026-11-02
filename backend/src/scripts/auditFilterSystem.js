/* eslint-disable no-console */
/**
 * Checks that every dashboard number in HR and vehicles opens exactly that many rows, on real data.
 * Slices must cover all rows once (sum equals total), filter values must narrow each other, and the overview must match the opened table under every filter form.
 */
require('dotenv').config();
const mongoose = require('mongoose');

const argv = process.argv.slice(2);
const iB = argv.indexOf('--base');
const BASE = (iB >= 0 && argv[iB + 1] ? argv[iB + 1] : process.env.BASE || 'http://localhost:5599').replace(/\/$/, '');

let pass = 0; let fail = 0;
const ok = (l, c, x = '') => { console.log(`  ${c ? '✓' : '✗ فشل'}  ${l}${x ? '   — ' + x : ''}`); c ? pass++ : fail++; };
const qsOf = (o) => new URLSearchParams(o).toString();

(async () => {
  await mongoose.connect(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 20000 });
  const User = require('../models/User');
  const Employee = require('../models/Employee');

  await User.deleteMany({ email: { $regex: '^zz-filtersys' } });
  const u = await User.create({
    email: 'zz-filtersys@example.invalid', password: 'Test@12345',
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
    // HR
    console.log('\n══ الموارد البشرية ══');
    const hov = await get('/api/hr/master/overview');
    const hTotal = hov.totals.filtered;
    ok(`النظرة الشاملة تحمّل ${hTotal} موظفًا و${hov.analytics.length} كتلة تحليل`, hTotal > 0 && hov.analytics.length > 0);

    for (const a of hov.analytics) {
      const sum = a.items.reduce((n, i) => n + i.count, 0);
      if (a.kind === 'horizon') {
        ok(`«${a.ar}» شرائحه تغطّي كل الصفوف مرةً واحدة (${sum} = ${hTotal})`, sum === hTotal);
      }
      for (const it of a.items) {
        const o = await get(`/api/hr/master/overview?${qsOf(it.filter)}`);
        ok(`«${a.ar}» → «${it.label}» يقول ${it.count} ويفتح ${o.totals.filtered}`, o.totals.filtered === it.count);
      }
    }

    console.log('\n── النظرة والجدول يتّفقان تحت كل شكل فلترة ──');
    const hf = await get('/api/hr/master/filters');
    const nat = hf.filters.find((x) => x.key === 'nationality');
    const br = hf.filters.find((x) => x.key === 'branchName');
    const two = nat.values.filter((v) => v.value !== '—').slice(0, 2).map((v) => v.value);
    const shapes = [
      { nationality: two[0] },
      { nationality: two.join(',') },
      { nationality: two.join(','), gender: 'male' },
      { branchName: br.values[0].value, employment: 'active' },
      { hireDateFrom: '2025-01-01', hireDateTo: '2025-12-31' },
      { iqamaExpiry: '—' },
      { nationality: '—' },
      { outsideKingdom: '1' },
    ];
    for (const sh of shapes) {
      const q = qsOf(sh);
      const [o, r] = await Promise.all([
        get(`/api/hr/master/overview?${q}`),
        get(`/api/hr/master/records/identity?${q}`),
      ]);
      ok(`${JSON.stringify(sh)} — النظرة ${o.totals.filtered} = الجدول ${r.rows.length}`,
        o.totals.filtered === r.rows.length);
    }
    ok(`الفلترة بقيمتين = مجموعهما (${two.join(' + ')})`,
      (await get(`/api/hr/master/overview?${qsOf({ nationality: two.join(',') })}`)).totals.filtered
      === nat.values.filter((v) => two.includes(v.value)).reduce((n, v) => n + v.count, 0));

    const hf2 = await get(`/api/hr/master/filters?${qsOf({ branchName: br.values[0].value })}`);
    const natAll = nat.values.reduce((n, v) => n + v.count, 0);
    const natIn = hf2.filters.find((x) => x.key === 'nationality').values.reduce((n, v) => n + v.count, 0);
    ok(`أعداد الجنسيات تُحسب بعد فلتر الفرع (${natAll} ← ${natIn})`, natIn < natAll && natIn === br.values[0].count);
    ok('الفرع نفسه يظل يعرض كل فروعه ليمكن إضافة فرع ثانٍ',
      hf2.filters.find((x) => x.key === 'branchName').values.length === br.values.length);
    // Each field is counted with all filters except itself: its values reflect the rest, its selected value stays visible to clear and its other values stay visible to add.
    const cross = await get(`/api/hr/master/filters?${qsOf({ nationality: two[0], gender: 'male' })}`);
    const males = (await get('/api/hr/master/overview?gender=male')).totals.filtered;
    const egy = (await get(`/api/hr/master/overview?${qsOf({ nationality: two[0] })}`)).totals.filtered;
    const cNat = cross.filters.find((x) => x.key === 'nationality');
    const cGen = cross.filters.find((x) => x.key === 'gender');
    ok(`قيم الجنسية محسوبة على الذكور وحدهم (${cNat.values.reduce((n, v) => n + v.count, 0)} = ${males})`,
      cNat.values.reduce((n, v) => n + v.count, 0) === males);
    ok('والقيمة المختارة ما زالت ظاهرةً لترفعها', cNat.values.some((v) => v.value === two[0]));
    ok(`وبقيّة الجنسيات ظاهرة لتضيفها (${cNat.values.length} قيمة)`, cNat.values.length > 1);
    ok(`وقيم الجنس محسوبة على تلك الجنسية (${cGen.values.reduce((n, v) => n + v.count, 0)} = ${egy})`,
      cGen.values.reduce((n, v) => n + v.count, 0) === egy);

    ok('«على رأس العمل» و«الموظفون» لا يتحرّكان مع الفلتر',
      (await get(`/api/hr/master/overview?${qsOf({ nationality: two[0] })}`)).totals.employees === hov.totals.employees);

    // The required count on the dashboard equals the required flags in the database, not fewer.
    // Exists because a partial projection added for query speed dropped the fieldStatus field, so the dashboard read every cell as filled and reported no pending work while thousands were pending. A dashboard saying zero without knowing is worse than one that does not load.
    // A flag on a filled cell is a stale trace from before it was filled; it is counted and printed but excluded from the comparison.
    const rowsFs = await Employee.find({ isHrRecord: { $ne: false }, inCurrentMaster: true }).lean();
    let dbRequired = 0; let staleFlags = 0;
    for (const r of rowsFs) {
      for (const [k, v] of Object.entries(r.fieldStatus || {})) {
        if (v !== 'required') continue;
        const field = k.replace(/Status$/, '');
        const val = r[field];
        const isFilled = !(val === null || val === undefined || val === '' || (Array.isArray(val) && !val.length));
        isFilled ? staleFlags++ : dbRequired++;
      }
    }
    if (staleFlags) console.log(`  ℹ  ${staleFlags} علامة «مطلوب» على خانة فيها قيمة — أثرٌ قديم لا يُعدّ عملًا`);
    ok(`«بيانات مطلوبة» ${hov.totals.required} = خانات القاعدة الفارغة المعلَّمة ${dbRequired}`,
      hov.totals.required === dbRequired,
      hov.totals.required === 0 ? 'العمود كلّه صفر — الأرجح أن حقل الحالة سقط من المشروع الجزئي' : '');
    ok('وكل مجموعة تقول مجموع حقولها',
      hov.groups.every((g) => g.required === g.fields.reduce((n, f) => n + f.counts.required, 0)));

    // Vehicles
    console.log('\n══ المركبات ══');
    const vov = await get('/api/vehicle-registry/overview');
    const vTotal = vov.totals.vehicles;
    ok(`النظرة الشاملة تحمّل ${vTotal} مركبة و${vov.analytics.length} كتلة تحليل`, vTotal > 0 && vov.analytics.length > 0);

    for (const a of vov.analytics) {
      const sum = a.items.reduce((n, i) => n + i.count, 0);
      if (a.kind === 'horizon') {
        ok(`«${a.ar}» شرائحه تغطّي كل المركبات مرةً واحدة (${sum} = ${vTotal})`, sum === vTotal);
      }
      for (const it of a.items) {
        const l = await get(`/api/vehicle-registry?limit=2000&${qsOf(it.filter)}`);
        ok(`«${a.ar}» → «${it.label}» يقول ${it.count} ويفتح ${l.total}`, l.total === it.count);
      }
    }

    console.log('\n── النظرة والقائمة تتّفقان ──');
    const vf = await get('/api/vehicle-registry/filters');
    const city = vf.filters.find((x) => x.key === 'city');
    const brand = vf.filters.find((x) => x.key === 'brand');
    const bTwo = brand.values.filter((v) => v.value !== '—').slice(0, 2).map((v) => v.value);
    const vShapes = [
      { brand: bTwo[0] },
      { brand: bTwo.join(',') },
      { brand: bTwo.join(','), city: city.values[0].value },
      { missing: '1' },
      { hasGps: '1' },
      { owner: '—' },
      { yearFrom: '2020', yearTo: '2023' },
    ];
    for (const sh of vShapes) {
      const q = qsOf(sh);
      const [o, l] = await Promise.all([
        get(`/api/vehicle-registry/overview?${q}`),
        get(`/api/vehicle-registry?limit=2000&${q}`),
      ]);
      ok(`${JSON.stringify(sh)} — النظرة ${o.totals.vehicles} = القائمة ${l.total}`, o.totals.vehicles === l.total);
    }
    ok(`الفلترة بماركتين = مجموعهما (${bTwo.join(' + ')})`,
      (await get(`/api/vehicle-registry/overview?${qsOf({ brand: bTwo.join(',') })}`)).totals.vehicles
      === brand.values.filter((v) => bTwo.includes(v.value)).reduce((n, v) => n + v.count, 0));

    const vf2 = await get(`/api/vehicle-registry/filters?${qsOf({ city: city.values[0].value })}`);
    const brAll = brand.values.reduce((n, v) => n + v.count, 0);
    const brIn = vf2.filters.find((x) => x.key === 'brand').values.reduce((n, v) => n + v.count, 0);
    ok(`أعداد الماركات تُحسب بعد فلتر المدينة (${brAll} ← ${brIn})`, brIn === city.values[0].count);
    ok('كل بطاقات توزيع الأعمدة تُعاد قراءتها مع الفلتر',
      (await get(`/api/vehicle-registry/overview?${qsOf({ city: city.values[0].value })}`))
        .breakdowns.every((b) => b.items.reduce((n, i) => n + i.count, 0) <= city.values[0].count));
  } finally {
    await Employee.deleteMany({ email: { $regex: '^zz-filtersys' } });
    await User.deleteMany({ email: { $regex: '^zz-filtersys' } });
  }

  console.log(`\n${'─'.repeat(64)}\nنجح ${pass} · فشل ${fail}`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('FATAL', e); process.exit(1); });
