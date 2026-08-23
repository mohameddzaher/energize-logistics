/* eslint-disable no-console */
/**
 * auditVehiclesSection — قسم المركبات بالكامل، بحساب مدير القسم نفسه.
 *
 *   node src/scripts/auditVehiclesSection.js --base https://api.energize-logistics.com
 *
 * تلات حاجات المستخدم شافها بنفسه، والتيست ده بيمنع رجوعها:
 *
 * ① «مفيش تاب تخليني أكريت حادثة جديدة أو أعمل إيديت» — ما كانش فيه اندبوينت
 *    أصلاً، والقسم كان بيتقرا بس من ناحية الحوادث.
 *
 * ② «الانتهاءات والتجديد شبه تنبيهات المركبات، والأرقام فيهم مش زي بعض» —
 *    الشاشتين كانوا بيحسبوا نفس السؤال بدالتين مختلفتين، والتنبيهات كانت بتسقط
 *    أي نوع مستند تنبيهه متقفول **في صمت**. بقوا على حساب واحد، والتيست بيقارن
 *    الرقمين على نفس الداتا.
 *
 * ③ «ليه بتقفل حاجات على ناس وهم واخدين الفل أكسيس» — أدوار القسم نفسه
 *    (vehicles_manager / vehicles_staff) ماكانوش في قوايم الصلاحيات، فصاحب
 *    القسم كان بيشوفه ومش قادر يعدّل فيه.
 *
 * كل الكتابة بتتعمل على مركبة وحادث اختبار بيتعملوا ويتمسحوا.
 */
require('dotenv').config();
const mongoose = require('mongoose');

const argv = process.argv.slice(2);
const iB = argv.indexOf('--base');
const BASE = (iB >= 0 && argv[iB + 1] ? argv[iB + 1] : process.env.BASE || 'http://localhost:5599').replace(/\/$/, '');

const OWNER = { email: 'mohamed.abdeulaal@energize.com', password: 'Mohamedenergize' };

let pass = 0; let fail = 0;
const ok = (l, c, x = '') => { console.log(`  ${c ? '✓' : '✗ FAIL'}  ${l}${x ? '   — ' + x : ''}`); c ? pass++ : fail++; };

(async () => {
  await mongoose.connect(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 20000 });
  const User = require('../models/User');
  const Employee = require('../models/Employee');
  const { VehicleMaster } = require('../models/VehicleMaster');
  const VehicleClaim = require('../models/VehicleClaim');

  const cleanup = async () => {
    await VehicleClaim.deleteMany({ $or: [{ vehiclePlate: /^ZZV/ }, { incidentSubjectAr: /^zz-/ }] });
    await VehicleMaster.deleteMany({ plateNumber: /^ZZV/ });
  };
  await cleanup();
  await User.deleteMany({ email: { $regex: '^zz-vsec' } });

  const lr = await fetch(`${BASE}/api/auth/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(OWNER),
  });
  if (lr.status === 429) { console.error('RATE LIMITED'); process.exit(2); }
  const ck = (lr.headers.getSetCookie?.() || []).map((c) => c.split(';')[0]).join('; ');
  ok(`دخول مدير المركبات (${OWNER.email})`, lr.status === 200 && !!ck, `HTTP ${lr.status}`);
  if (!ck) process.exit(1);

  const call = async (method, p, body) => {
    const r = await fetch(`${BASE}${p}`, {
      method, headers: { 'Content-Type': 'application/json', Cookie: ck },
      body: body ? JSON.stringify(body) : undefined,
    });
    let j = null; try { j = await r.json(); } catch { /* */ }
    return { status: r.status, body: j };
  };

  try {
    // ═══ ① الحوادث: إنشاء وتعديل وحذف ═══════════════════════════════════════
    console.log('\n── الحوادث ──');
    const before = (await call('GET', '/api/vehicle-registry/claims')).body?.totals?.total ?? 0;
    const made = await call('POST', '/api/vehicle-registry/claims', {
      vehiclePlate: 'ZZV 1234', accidentDate: '2026-08-01', accidentNumber: 'ZZ-ACC-1',
      counterpartyNameAr: 'zz-طرف تاني', faultPercent: 40, reportedViaAr: 'نجم',
      claim: { insurerAr: 'zz-تأمين', estimatedAmountSar: 10000, expectedRecoverySar: 6000 },
    });
    ok('مدير المركبات يقدر يسجّل حادث', made.status === 201, `HTTP ${made.status} ${made.body?.message || ''}`);
    const id = made.body?.claim?._id;
    ok('والرقم اتولّد تلقائيًا', !!made.body?.claim?.claimId, made.body?.claim?.claimId || '—');
    ok('والفجوة اتحسبت على السيرفر (١٠٠٠٠ − ٦٠٠٠ = ٤٠٠٠)',
      made.body?.claim?.claim?.recoveryGapSar === 4000, String(made.body?.claim?.claim?.recoveryGapSar));

    const after = (await call('GET', '/api/vehicle-registry/claims')).body?.totals?.total ?? 0;
    ok(`وظهر في القايمة (${before} → ${after})`, after === before + 1);

    const upd = await call('PUT', `/api/vehicle-registry/claims/${id}`, {
      statusCode: 'closed', statusAr: 'مقفولة',
      claim: { estimatedAmountSar: 12000, expectedRecoverySar: 12000 },
    });
    ok('ويقدر يعدّله', upd.status === 200, `HTTP ${upd.status} ${upd.body?.message || ''}`);
    ok('والفجوة اتعاد حسابها (صفر)', upd.body?.claim?.claim?.recoveryGapSar === 0,
      String(upd.body?.claim?.claim?.recoveryGapSar));
    ok('والحالة اتغيّرت', upd.body?.claim?.statusCode === 'closed');

    const del = await call('DELETE', `/api/vehicle-registry/claims/${id}`);
    ok('ويقدر يحذفه', del.status === 200, `HTTP ${del.status}`);
    const gone = await VehicleClaim.findById(id).lean();
    ok('حذف ناعم — السجل المالي بيفضل موجود', !!gone && gone.isActive === false);
    ok(`ورجع العدد ${before}`, ((await call('GET', '/api/vehicle-registry/claims')).body?.totals?.total ?? -1) === before);

    // ═══ ② الانتهاءات = التنبيهات ═══════════════════════════════════════════
    console.log('\n── الانتهاءات مقابل التنبيهات ──');
    const alerts = (await call('GET', '/api/vehicle-registry/alerts')).body;
    const exp = (await call('GET', '/api/vehicle-registry/expiring?state=expired,critical,warning,upcoming')).body;
    const expRows = exp?.rows || [];
    ok(`الإجمالي متطابق: تنبيهات ${alerts?.total} · انتهاءات ${expRows.length}`,
      alerts?.total === expRows.length);
    for (const st of ['expired', 'critical', 'warning', 'upcoming']) {
      const a = alerts?.byStatus?.[st] ?? -1;
      const e = expRows.filter((r) => r.state === st).length;
      ok(`${st}: ${a} = ${e}`, a === e);
    }
    ok(`المستندات اللي تنبيهها متقفول بتبان ومعلّمة (${alerts?.mutedCount ?? 0})`,
      typeof alerts?.mutedCount === 'number');

    // ═══ ③أ ملفات القسم المستوردة تطابق الملف ═══════════════════════════════
    console.log('\n── مطابقة الاستيراد للملف ──');
    const fs = require('fs');
    // المصدر هو أحدث مجلّد: «new vehicles files» يحلّ محلّ سابقه.
    const dir = require('path').join(__dirname, '..', 'data', 'masters', 'new vehicles files');
    const has = fs.existsSync(dir);
    if (!has) ok('مجلّد new vehicles files موجود', false, dir);
    else {
      const L = (f, k) => { const d = JSON.parse(fs.readFileSync(`${dir}/${f}`, 'utf8')); return Array.isArray(d) ? d : (d[k] || d.records || []); };
      const stats = JSON.parse(fs.readFileSync(`${dir}/summary_statistics.json`, 'utf8'));
      const vf = { statistics: { total_vehicles: stats.fleet.total_vehicles, by_city: stats.fleet.by_city },
        vehicles: L('vehicles.json') };
      const af = { accidents: L('accidents.json') };
      const pf = { policies: L('general_documents.json') };
      const insF = L('insurance_policies.json');
      const missF = L('missing_data.json');
      const ov = (await call('GET', '/api/vehicle-registry/overview')).body;

      ok(`عدد المركبات ${ov?.totals?.vehicles} = ${vf.statistics.total_vehicles} (الملف)`,
        ov?.totals?.vehicles === vf.statistics.total_vehicles);
      const polList = (await call('GET', '/api/vehicle-registry/insurance-policies')).body;
      ok(`وثائق التأمين ${polList?.totals?.total} = ${insF.length} (الملف)`,
        polList?.totals?.total === insF.length);
      ok(`مركبات ينقصها شيء ${ov?.totals?.withMissing} = ${missF.length} (الملف)`,
        ov?.totals?.withMissing === missF.length);

      const cl = (await call('GET', '/api/vehicle-registry/claims')).body;
      ok(`الحوادث ${cl?.totals?.total} = ${af.accidents.length} (الملف)`, cl?.totals?.total === af.accidents.length);
      const co = (await call('GET', '/api/vehicle-registry/corporate-policies')).body;
      ok(`وثائق الشركة ${(co?.policies || []).length} = ${pf.policies.length}`,
        (co?.policies || []).length === pf.policies.length);

      // البطاقات الجديدة موجودة وتطابق إحصاءات الملف
      const bd = Object.fromEntries((ov?.breakdowns || []).map((b) => [b.key, b]));
      for (const k of ['department', 'city', 'possession', 'gpsDeviceStatus']) {
        ok(`بطاقة «${bd[k]?.ar || k}» موجودة (${(bd[k]?.items || []).length} قيمة)`, !!bd[k] && bd[k].items.length > 0);
      }
      const cityCard = bd.city?.items || [];
      const fileCities = vf.statistics.by_city || {};
      const jeddah = cityCard.find((x) => x.value === 'جدة')?.count;
      ok(`جدة ${jeddah} = ${fileCities['جدة']} (الملف)`, jeddah === fileCities['جدة']);

      // الفلاتر الجديدة ترجّع نفس العدد
      const missList = (await call('GET', '/api/vehicle-registry?missing=1&limit=500')).body;
      ok(`فلتر «ينقصه شيء» يرجّع ${missList?.total} = ${missF.length}`, missList?.total === missF.length);
      const byCity = (await call('GET', '/api/vehicle-registry?city=' + encodeURIComponent('جدة') + '&limit=500')).body;
      ok(`فلتر المدينة: ${byCity?.total} = ${fileCities['جدة']}`, byCity?.total === fileCities['جدة']);
    }

    // ═══ ③أ٢ التنبيهات وسجلّات القسم: كل ما في الملف يظهر ═════════════════════
    console.log('\n── التنبيهات وسجلّات القسم ──');
    {
      const dirN = require('path').join(__dirname, '..', 'data', 'masters', 'new vehicles files');
      const fsN = require('fs');
      const LN = (f) => { const x = JSON.parse(fsN.readFileSync(`${dirN}/${f}`, 'utf8')); return Array.isArray(x) ? x : (x.records || []); };
      const alerts = (await call('GET', '/api/vehicle-registry/alerts')).body;
      const fileAlerts = LN('expiry_alerts.json');
      ok(`التنبيهات ${alerts?.total} = ${fileAlerts.length} (الملف)`, alerts?.total === fileAlerts.length);
      // الأفق الثالث موجود — كان ٢٤ مستندًا يسقط من الشاشة تمامًا
      ok(`منها «على الرادار» ${alerts?.byStatus?.upcoming}`, (alerts?.byStatus?.upcoming || 0) > 0);
      const fb = {}; fileAlerts.forEach((x) => { fb[x.bucket] = (fb[x.bucket] || 0) + 1; });
      ok(`المنتهية ${alerts?.byStatus?.expired} = ${fb.expired} (الملف)`, alerts?.byStatus?.expired === fb.expired);
      ok(`وخلال ٩٠ يومًا ${alerts?.byStatus?.upcoming} = ${fb.expiring_90d}`, alerts?.byStatus?.upcoming === fb.expiring_90d);

      const regs = (await call('GET', '/api/vehicle-registry/registers')).body;
      const uniq = (f, k) => new Set(LN(f).map((x) => String(x[k] || '').trim()).filter(Boolean)).size;
      const cmp = [
        ['owners', uniq('owners.json', 'owner_name'), 'المُلّاك'],
        ['authorizedPersons', uniq('authorized_persons.json', 'name'), 'المفوَّضون'],
        ['gpsProviders', uniq('gps_providers.json', 'provider'), 'مزوّدو التتبّع'],
        ['gpsUnits', LN('gps_devices.json').length, 'أجهزة التتبّع'],
        ['fuelCards', LN('fuel_cards_petroapp.json').length, 'شرائح الوقود'],
      ];
      for (const [key, expected, label] of cmp) {
        ok(`${label.padEnd(16)} ${regs?.totals?.[key]} = ${expected} (الملف)`, regs?.totals?.[key] === expected);
      }
      // النص الدلالي لا يظهر كقيمة: «مطلوب» ليست شركة تتبّع
      const providers = (regs?.registers?.gpsProviders?.items || []).map((x) => x.value);
      ok('لا نصّ دلالي بين مزوّدي التتبّع', !providers.some((v) => /^(مطلوب|غير مطلوب|لا يوجد)$/.test(v)),
        providers.join(' · '));
      // وكل صفّ يفتح ما يقوله
      const owner = (regs?.registers?.owners?.items || [])[0];
      if (owner) {
        const got = (await call('GET', `/api/vehicle-registry?owner=${encodeURIComponent(owner.value)}&limit=500`)).body;
        ok(`الضغط على «${String(owner.value).slice(0, 24)}» يفتح ${got?.total} = ${owner.vehicles}`,
          got?.total === owner.vehicles);
      }
      const person = (regs?.registers?.authorizedPersons?.items || [])[0];
      if (person) {
        const got = (await call('GET', `/api/vehicle-registry?authorizedPerson=${encodeURIComponent(person.value)}&limit=500`)).body;
        ok(`ومفوَّض «${String(person.value).slice(0, 20)}»: ${got?.total} = ${person.vehicles}`,
          got?.total === person.vehicles);
      }
    }

    // ═══ ③ب وثائق التأمين: وثيقة واحدة تغطّي مئات المركبات ═══════════════════
    console.log('\n── وثائق التأمين ──');
    const { VehicleInsurancePolicy } = require('../models/VehicleMaster');
    const pols = (await call('GET', '/api/vehicle-registry/insurance-policies')).body;
    ok('قائمة الوثائق تردّ', !!pols?.policies, `HTTP`);
    ok(`${pols?.totals?.total} وثيقة تغطّي ${pols?.totals?.vehiclesCovered} مركبة`,
      (pols?.totals?.total || 0) > 0 && (pols?.totals?.vehiclesCovered || 0) > 0);
    // عدد المركبات على كل وثيقة = المحسوب من المركبات نفسها
    let mismatched = 0;
    for (const p of (pols?.policies || []).slice(0, 10)) {
      const real = await VehicleMaster.countDocuments({ insurancePolicy: p._id, isActive: { $ne: false } });
      if (real !== p.vehicles) mismatched++;
    }
    ok('عدد مركبات كل وثيقة = المحسوب فعلًا', mismatched === 0, `${mismatched} مختلف`);

    // ── التجديد يسري على كل مركبات الوثيقة ──
    const big = (pols?.policies || []).filter((p) => p.vehicles >= 2).sort((a, b) => b.vehicles - a.vehicles)[0];
    if (!big) ok('توجد وثيقة تغطّي أكثر من مركبة للتجربة', false);
    else {
      const before = await VehicleMaster.find({ insurancePolicy: big._id }).select('_id insurance.expiryDate renewals').lean();
      const target = new Date(Date.now() + 300 * 86400000).toISOString().slice(0, 10);
      const rn = await call('POST', `/api/vehicle-registry/insurance-policies/${big._id}/renew`, {
        newExpiry: target, reference: 'ZZ-POL', note: 'تيست',
      });
      ok(`تجديد وثيقة ${big.policyNumber} (${big.vehicles} مركبة)`, rn.status === 200,
        `HTTP ${rn.status} ${rn.body?.message || ''}`);
      ok(`سرى على ${rn.body?.vehiclesUpdated} مركبة`, rn.body?.vehiclesUpdated === big.vehicles,
        `${rn.body?.vehiclesUpdated} من ${big.vehicles}`);
      const after = await VehicleMaster.find({ insurancePolicy: big._id }).select('insurance.expiryDate renewals').lean();
      ok('كل المركبات أخذت التاريخ الجديد',
        after.every((v) => new Date(v.insurance.expiryDate).toISOString().slice(0, 10) === target));
      ok('وكل واحدة قُيِّدت في سجل تجديداتها كالتجديد المفرد',
        after.every((v) => (v.renewals || []).some((r) => r.document === 'insurance' && r.reference === 'ZZ-POL' && r.byName)));
      const polAfter = await VehicleInsurancePolicy.findById(big._id).lean();
      ok('والوثيقة نفسها سجّلت التجديد بعدد مركباتها',
        (polAfter.renewals || []).some((r) => r.reference === 'ZZ-POL' && r.vehiclesUpdated === big.vehicles));

      // إرجاع الحال — التواريخ الأصلية لكل مركبة والوثيقة
      for (const b of before) {
        await VehicleMaster.updateOne({ _id: b._id }, {
          $set: { 'insurance.expiryDate': b.insurance?.expiryDate ?? null },
          $pull: { renewals: { reference: 'ZZ-POL' } },
        });
      }
      await VehicleInsurancePolicy.updateOne({ _id: big._id }, {
        $set: { expiryDate: big.expiryDate ?? null }, $pull: { renewals: { reference: 'ZZ-POL' } },
      });
      const restored = await VehicleMaster.countDocuments({ insurancePolicy: big._id, 'renewals.reference': 'ZZ-POL' });
      ok('ورجع الحال كما كان', restored === 0, `${restored} باقٍ`);
    }

    // ── تاريخ في الماضي مرفوض ──
    const pastDay = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
    const badPol = await call('POST', `/api/vehicle-registry/insurance-policies/${(pols?.policies || [])[0]?._id}/renew`, { newExpiry: pastDay });
    ok('تجديد بتاريخ ماضٍ مرفوض', badPol.status === 400, `HTTP ${badPol.status}`);

    // ═══ ③ج نواقص البيانات ═══════════════════════════════════════════════════
    console.log('\n── نواقص البيانات ──');
    const ovm = (await call('GET', '/api/vehicle-registry/overview')).body;
    ok(`${ovm?.totals?.withMissing} مركبة ينقصها شيء · ${ovm?.totals?.missingItems} بندًا`,
      (ovm?.totals?.withMissing || 0) > 0);
    ok(`النواقص مجمَّعة بالبند والسبب (${(ovm?.missingBreakdown || []).length} مجموعة)`,
      (ovm?.missingBreakdown || []).length > 0);
    ok('ومجموعها = عدد البنود',
      (ovm?.missingBreakdown || []).reduce((t, x) => t + x.count, 0) === ovm?.totals?.missingItems,
      `${(ovm?.missingBreakdown || []).reduce((t, x) => t + x.count, 0)} / ${ovm?.totals?.missingItems}`);
    ok('و«غير مطلوب» لا تُعدّ نقصًا',
      !(ovm?.missingBreakdown || []).some((x) => x.reason === 'not_required'));
    const firstGap = (ovm?.missingBreakdown || [])[0];
    if (firstGap) {
      const q = `missingItem=${encodeURIComponent(firstGap.item)}&missingReason=${firstGap.reason}&limit=500`;
      const got = (await call('GET', `/api/vehicle-registry?${q}`)).body;
      ok(`فلتر «${firstGap.item} — ${firstGap.reasonAr}»: ${got?.total} = ${firstGap.count}`,
        got?.total === firstGap.count);
    }

    // ═══ ③ التجديد الجماعي ══════════════════════════════════════════════════
    console.log('\n── تجديد أكتر من مستند بنفس التاريخ ──');
    const v1 = await VehicleMaster.create({ plateNumber: 'ZZV 1', plateKey: 'ZZV1', operatingCard: { expiryDate: new Date('2026-01-01') } });
    const v2 = await VehicleMaster.create({ plateNumber: 'ZZV 2', plateKey: 'ZZV2', operatingCard: { expiryDate: new Date('2026-01-02') } });
    const v3 = await VehicleMaster.create({ plateNumber: 'ZZV 3', plateKey: 'ZZV3', operatingCard: { expiryDate: new Date('2026-01-03') } });
    const target = new Date(Date.now() + 200 * 86400000).toISOString().slice(0, 10);

    const bulk = await call('POST', '/api/vehicle-registry/renew-bulk', {
      items: [v1, v2, v3].map((v) => ({ vehicle: v._id, document: 'operatingCard' })),
      newExpiry: target, reference: 'ZZ-REF', note: 'تيست',
    });
    ok('التجديد الجماعي نجح', bulk.status === 200, `HTTP ${bulk.status} ${bulk.body?.message || ''}`);
    ok(`٣ مستندات على ٣ مركبات`, bulk.body?.summary?.count === 3 && bulk.body?.summary?.vehicles === 3,
      JSON.stringify(bulk.body?.summary || {}));
    const fresh = await VehicleMaster.find({ plateNumber: /^ZZV [123]$/ }).lean();
    ok('كلهم أخدوا نفس التاريخ',
      fresh.every((v) => new Date(v.operatingCard.expiryDate).toISOString().slice(0, 10) === target),
      fresh.map((v) => new Date(v.operatingCard.expiryDate).toISOString().slice(0, 10)).join(' '));
    ok('وكل واحد اتقيّد في سجل تجديداته زي التجديد المفرد',
      fresh.every((v) => (v.renewals || []).some((r) => r.document === 'operatingCard' && r.reference === 'ZZ-REF' && r.byName)));

    // الرفض الكامل
    const past = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
    const bad = await call('POST', '/api/vehicle-registry/renew-bulk', {
      items: [{ vehicle: v1._id, document: 'operatingCard' }, { vehicle: v2._id, document: 'operatingCard' }],
      newExpiry: past,
    });
    ok('تاريخ في الماضي ⇒ الكل يترفض', bad.status === 400, `HTTP ${bad.status}`);
    const still = await VehicleMaster.find({ plateNumber: /^ZZV [12]$/ }).lean();
    ok('ومفيش مركبة اتغيّرت',
      still.every((v) => new Date(v.operatingCard.expiryDate).toISOString().slice(0, 10) === target));
    const mixed = await call('POST', '/api/vehicle-registry/renew-bulk', {
      items: [{ vehicle: v1._id, document: 'operatingCard' }, { vehicle: new mongoose.Types.ObjectId(), document: 'operatingCard' }],
      newExpiry: target,
    });
    ok('مركبة مش موجودة في السطر ⇒ الكل يترفض', mixed.status === 400, `HTTP ${mixed.status}`);
    ok('من غير أسطر ⇒ مرفوض', (await call('POST', '/api/vehicle-registry/renew-bulk', { items: [], newExpiry: target })).status === 400);

    // ═══ ④ باقي القسم مفتوح للمدير ═══════════════════════════════════════════
    console.log('\n── باقي القسم ──');
    const one = await VehicleMaster.findOne({ plateNumber: 'ZZV 1' }).lean();
    ok('يعدّل مركبة', (await call('PUT', `/api/vehicle-registry/${one._id}`, { notes: 'zz' })).status === 200);
    ok('يجدّد مستند مفرد',
      (await call('POST', `/api/vehicle-registry/${one._id}/renew`, { document: 'operatingCard', newExpiry: target })).status === 200);
    for (const [label, p] of [['النظرة الشاملة', '/api/vehicle-registry/overview'], ['التنبيهات', '/api/vehicle-registry/alerts'],
      ['الإعدادات', '/api/vehicle-registry/settings'], ['وثائق الشركة', '/api/vehicle-registry/corporate-policies'],
      ['التفاويض', '/api/vehicles/authorizations']]) {
      ok(`${label.padEnd(16)} ${p}`, (await call('GET', p)).status === 200);
    }

    // ═══ ⑤ موظف القسم يقدر يعدّل برضه ═══════════════════════════════════════
    console.log('\n── موظف القسم ──');
    const st = await User.create({
      email: 'zz-vsec@example.invalid', password: 'Test@12345',
      firstName: 'ت', lastName: 'م', role: 'vehicles_staff', isActive: true,
    });
    const sl = await fetch(`${BASE}/api/auth/login`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: st.email, password: 'Test@12345' }),
    });
    const sck = (sl.headers.getSetCookie?.() || []).map((c) => c.split(';')[0]).join('; ');
    const sPost = await fetch(`${BASE}/api/vehicle-registry/claims`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: sck },
      body: JSON.stringify({ incidentSubjectAr: 'zz-واقعة موظف', accidentDate: '2026-08-02' }),
    });
    ok('موظف القسم يقدر يسجّل حادث', sPost.status === 201, `HTTP ${sPost.status}`);
    const sBody = await sPost.json().catch(() => null);
    if (sBody?.claim?._id) await VehicleClaim.deleteOne({ _id: sBody.claim._id });
  } finally {
    await cleanup();
    await Employee.deleteMany({ email: { $regex: '^zz-vsec' } });
    await User.deleteMany({ email: { $regex: '^zz-vsec' } });
  }
  ok('التدقيق ما سابش أثر',
    (await VehicleMaster.countDocuments({ plateNumber: /^ZZV/ })) === 0
    && (await VehicleClaim.countDocuments({ $or: [{ vehiclePlate: /^ZZV/ }, { incidentSubjectAr: /^zz-/ }] })) === 0);

  console.log(`\n${'─'.repeat(62)}\nنجح ${pass} · فشل ${fail}`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('FATAL', e); process.exit(1); });
