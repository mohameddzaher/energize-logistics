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
    const exp = (await call('GET', '/api/vehicle-registry/expiring?state=expired,critical,warning')).body;
    const expRows = exp?.rows || [];
    ok(`الإجمالي متطابق: تنبيهات ${alerts?.total} · انتهاءات ${expRows.length}`,
      alerts?.total === expRows.length);
    for (const st of ['expired', 'critical', 'warning']) {
      const a = alerts?.byStatus?.[st] ?? -1;
      const e = expRows.filter((r) => r.state === st).length;
      ok(`${st}: ${a} = ${e}`, a === e);
    }
    ok(`المستندات اللي تنبيهها متقفول بتبان ومعلّمة (${alerts?.mutedCount ?? 0})`,
      typeof alerts?.mutedCount === 'number');

    // ═══ ③أ ملفات القسم المستوردة تطابق الملف ═══════════════════════════════
    console.log('\n── مطابقة الاستيراد للملف ──');
    const fs = require('fs');
    const dir = require('path').join(__dirname, '..', 'data', 'masters', 'vehicles files');
    const has = fs.existsSync(dir);
    if (!has) ok('مجلّد vehicles files موجود', false, dir);
    else {
      const vf = JSON.parse(fs.readFileSync(`${dir}/vehicles.json`, 'utf8'));
      const af = JSON.parse(fs.readFileSync(`${dir}/accidents.json`, 'utf8'));
      const pf = JSON.parse(fs.readFileSync(`${dir}/general_insurance.json`, 'utf8'));
      const ov = (await call('GET', '/api/vehicle-registry/overview')).body;

      ok(`عدد المركبات ${ov?.totals?.vehicles} = ${vf.statistics.total_vehicles} (الملف)`,
        ov?.totals?.vehicles === vf.statistics.total_vehicles);
      ok(`مركبات بنواقص لوجستي ${ov?.totals?.withLogistiGaps} = ${vf.statistics.with_logisti_platform_gaps}`,
        ov?.totals?.withLogistiGaps === vf.statistics.with_logisti_platform_gaps);
      const gapItems = vf.vehicles.reduce((t, v) => t + (v.logisti_platform_missing_data || []).length, 0);
      ok(`بنود ناقصة ${ov?.totals?.logistiGapItems} = ${gapItems}`, ov?.totals?.logistiGapItems === gapItems);
      ok(`الشروط الناقصة مسرودة (${(ov?.logistiGaps || []).length})`, (ov?.logistiGaps || []).length > 0);
      ok('ومجموع تكراراتها = عدد البنود',
        (ov?.logistiGaps || []).reduce((t, g) => t + g.count, 0) === gapItems);

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
      const gapList = (await call('GET', '/api/vehicle-registry?logistiGaps=1&limit=500')).body;
      ok(`فلتر «بنواقص» يرجّع ${gapList?.total} = ${vf.statistics.with_logisti_platform_gaps}`,
        gapList?.total === vf.statistics.with_logisti_platform_gaps);
      const one = (ov?.logistiGaps || [])[0];
      if (one) {
        const byItem = (await call('GET', `/api/vehicle-registry?logistiGap=${encodeURIComponent(one.value)}&limit=500`)).body;
        ok(`فلتر شرط بعينه: ${byItem?.total} = ${one.count}`, byItem?.total === one.count, one.value.slice(0, 40));
      }
      const byCity = (await call('GET', '/api/vehicle-registry?city=' + encodeURIComponent('جدة') + '&limit=500')).body;
      ok(`فلتر المدينة: ${byCity?.total} = ${fileCities['جدة']}`, byCity?.total === fileCities['جدة']);
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
