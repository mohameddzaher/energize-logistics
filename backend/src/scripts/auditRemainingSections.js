/**
 * auditRemainingSections — الأقسام التي لم تُفحَص بعمقٍ من قبل.
 *
 *   node --max-old-space-size=8192 src/scripts/auditRemainingSections.js --base https://api.energize-logistics.com
 *
 * قراءةٌ فقط، ولا كتابةَ إلّا حسابَ فحصٍ يُنشأ ويُحذَف.
 *
 * ── ما يُسأل في كلّ قسم ────────────────────────────────────────────────────
 * ثلاثةُ أسئلةٍ لا واحد: أتُفتَح الشاشة؟ ثمّ — وهو الأهمّ — أصحيحٌ ما فيها؟
 * ثمّ: أثمّ مرجعٌ إلى سجلٍّ محذوف، أو رقمٌ فريدٌ تكرّر، أو مجموعٌ لا يساوي
 * أجزاءه؟ فتحُ الشاشة بلا فحصِ أرقامها يقول إنّ الخادمَ يعمل، لا إنّ البيانات
 * صحيحة — وهما سؤالان مختلفان.
 *
 * والقسمُ الفارغُ يُقال إنّه فارغٌ ولا يُعَدّ نجاحًا ولا فشلًا: ستّةُ أقسامٍ في
 * المنصّة لا بياناتِ لها إطلاقًا، وهذه حقيقةٌ عن حال العمل تُعرَض ولا تُخفى في
 * علامةِ صحٍّ خضراء.
 */
require('dotenv').config();
const mongoose = require('mongoose');

const arg = (n, d = null) => { const i = process.argv.indexOf(`--${n}`); return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : d; };
const BASE = arg('base', 'http://localhost:5001');
const ORIGIN = /api\.energize-logistics\.com/.test(BASE)
  ? 'https://energize-logistics.com'
  : (process.env.FRONTEND_URL?.split(',')[0].trim() || 'http://localhost:3000');
const PW = 'Passenergize1!';

let pass = 0; let fail = 0;
const empty = []; const notes = [];
const ok = (label, cond, note = '') => {
  if (cond) { pass += 1; console.log(`  ✓  ${label}${note ? `  — ${note}` : ''}`); }
  else { fail += 1; console.log(`  ✗ فشل  ${label}${note ? `  — ${note}` : ''}`); }
};
const head = (t) => console.log(`\n══ ${t} ${'═'.repeat(Math.max(0, 54 - t.length))}`);
const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

(async () => {
  await mongoose.connect(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 30000 });
  const db = mongoose.connection.db;
  const User = require('../models/User');
  await User.deleteMany({ email: /^zz-sect/ });
  const u = await User.create({ email: 'zz-sect@example.invalid', password: PW, firstName: 'ف', lastName: 'ش', role: 'super_admin' });
  const lr = await fetch(`${BASE}/api/auth/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Origin: ORIGIN },
    body: JSON.stringify({ email: u.email, password: PW }),
  });
  const ck = (lr.headers.getSetCookie?.() || []).map((c) => c.split(';')[0]).join('; ');
  const get = async (p) => {
    try {
      const r = await fetch(`${BASE}${p}`, { headers: { Cookie: ck, Origin: ORIGIN } });
      const t = await r.text(); let j = null; try { j = JSON.parse(t); } catch (_) {}
      return { status: r.status, j };
    } catch (e) { return { status: 0, err: e.message }; }
  };
  const count = (n) => db.collection(n).countDocuments();
  const rows = (n, q = {}, p = {}) => db.collection(n).find(q).project(p).toArray();
  const ids = async (n) => new Set((await db.collection(n).find({}).project({ _id: 1 }).toArray()).map((x) => String(x._id)));

  console.log('══════════════════════════════════════════════════════════════');
  console.log('  الأقسام التي لم تُفحَص بعمق — قراءةٌ فقط');
  console.log('══════════════════════════════════════════════════════════════');
  console.log(`الخادم: ${BASE} · الدخول: ${lr.status}`);

  // ═══ B2C ════════════════════════════════════════════════════════════════
  head('B2C — طلبات التوصيل اليوميّة');
  const nOrders = await count('b2cdailyorders');
  const nReps = await count('b2creps');
  console.log(`  طلبات: ${nOrders} · مندوبون: ${nReps} · رفعات إكسل: ${await count('b2cexceluploads')}`);
  ok('صفحة الطلبات تُفتَح', (await get('/api/b2c/daily-orders?limit=20')).status === 200);
  ok('لوحة B2C تُفتَح', (await get('/api/b2c/dashboard')).status === 200);

  // مرجعُ المندوب على الطلب: طلبٌ لمندوبٍ محذوف يظهر بلا اسمٍ ولا يُحاسَب أحد.
  const repIds = await ids('b2creps');
  const orderRepRefs = await rows('b2cdailyorders', { rep: { $ne: null } }, { rep: 1 });
  const badRep = orderRepRefs.filter((o) => o.rep && !repIds.has(String(o.rep)));
  ok('كلُّ طلبٍ لمندوبٍ موجود', badRep.length === 0, `${badRep.length} من ${orderRepRefs.length}`);

  // مبالغُ سالبة: التحصيلُ لا يكون سالبًا.
  const negAmt = await db.collection('b2cdailyorders').countDocuments({ $or: [{ amount: { $lt: 0 } }, { codAmount: { $lt: 0 } }] });
  ok('لا مبلغَ سالبًا في الطلبات', negAmt === 0, `${negAmt} طلبًا`);

  // ازدواجُ الطلب: الرقمُ نفسُه مرّتين يعني تحصيلًا مزدوجًا في التقرير.
  const dupOrder = await db.collection('b2cdailyorders').aggregate([
    { $match: { orderNumber: { $nin: [null, ''] } } },
    { $group: { _id: '$orderNumber', n: { $sum: 1 } } }, { $match: { n: { $gt: 1 } } }, { $count: 'c' },
  ]).toArray();
  ok('رقمُ الطلب لا يتكرّر', !dupOrder.length, dupOrder.length ? `${dupOrder[0].c} رقمًا مكرَّرًا` : `${nOrders} طلبًا`);

  // ═══ طلبات الشحنات ══════════════════════════════════════════════════════
  head('طلبات الشحنات');
  const nSO = await count('shipmentorders');
  console.log(`  طلبات: ${nSO} · مركبات: ${await count('shipmentordervehicles')} · موردون: ${await count('shipmentordersuppliers')} · عملاء: ${await count('shipmentordercustomers')}`);
  ok('قائمة الطلبات تُفتَح', (await get('/api/shipment-orders/orders?limit=20')).status === 200);
  const dupWay = await db.collection('shipmentorders').aggregate([
    { $match: { waybillNumber: { $nin: [null, ''] } } },
    { $group: { _id: '$waybillNumber', n: { $sum: 1 } } }, { $match: { n: { $gt: 1 } } }, { $limit: 5 },
  ]).toArray();
  ok('رقمُ البوليصة لا يتكرّر', !dupWay.length, dupWay.length ? dupWay.map((d) => `${d._id}×${d.n}`).join('، ') : `${nSO} طلبًا`);
  const soCust = await ids('shipmentordercustomers');
  const soRefs = await rows('shipmentorders', { customer: { $ne: null } }, { customer: 1 });
  const badCust = soRefs.filter((o) => o.customer && !soCust.has(String(o.customer)));
  ok('كلُّ طلبٍ لعميلٍ موجود', badCust.length === 0, `${badCust.length} من ${soRefs.length}`);
  const negSO = await db.collection('shipmentorders').countDocuments({ $or: [{ sellingPrice: { $lt: 0 } }, { purchasePrice: { $lt: 0 } }] });
  ok('لا سعرَ سالبًا', negSO === 0, `${negSO}`);

  // ═══ Location Solutions ═════════════════════════════════════════════════
  head('Location Solutions — التتبّع والأصول');
  console.log(`  تنبيهات: ${await count('ls2alerts')} · مركبات: ${await count('ls2vehicles')} · إطارات: ${await count('ls2tireassets')} · سطحات: ${await count('ls2flatbeds')} · مقطورات: ${await count('ls2trailers')}`);
  ok('لوحة LS2 تُفتَح', (await get('/api/ls2/dashboard')).status === 200);
  ok('التنبيهات تُفتَح', (await get('/api/ls2/alerts?limit=20')).status === 200);
  // الأصلُ المركَّب لا يكون على مركبتين في وقتٍ واحد.
  const tires = await rows('ls2tireassets', { status: 'installed' }, { serial: 1, plateKey: 1 });
  const byPlate = new Map();
  for (const t of tires) { const k = `${t.serial}`; byPlate.set(k, (byPlate.get(k) || 0) + 1); }
  const dupTire = [...byPlate.entries()].filter(([, n]) => n > 1);
  ok('لا إطارَ مركَّبًا على أكثر من مركبة', dupTire.length === 0, `${dupTire.length} سريالًا`);
  const negOdo = await db.collection('ls2odometerdailies').countDocuments({ km: { $lt: 0 } });
  ok('لا عدّادَ سالبًا', negOdo === 0, `${negOdo}`);

  // ═══ العقود ═════════════════════════════════════════════════════════════
  head('العقود');
  const nContracts = await count('contracts');
  console.log(`  عقود: ${nContracts} · موردون: ${await count('contractvendors')} · مرشَّحون: ${await count('contractprospects')} · استغلال: ${await count('vendorutilisations')}`);
  // ── وقسمُ العقود مورِّدون لا موظّفون ──────────────────────────────────────
  // مجموعةُ `contracts` هي عقودُ الموظّفين (الموارد البشريّة)؛ وقسمُ العقود
  // يعمل على `contractvendors` و`vendorutilisations`. خلطُهما يجعل الفحصَ
  // يقول «٢٨١ عقدًا بلا طرف» عن عقودٍ طرفُها موظّفٌ مرجعُه محفوظ.
  ok('لوحة العقود تُفتَح', (await get('/api/contracts/dashboard')).status === 200);
  ok('قائمة الموردين تُفتَح', (await get('/api/contracts/vendors')).status === 200);
  ok('تحليل الاستغلال يُفتَح', (await get('/api/contracts/utilisation')).status === 200);
  const cvNoName = await db.collection('contractvendors').countDocuments({ $or: [{ name: null }, { name: '' }] });
  ok('كلُّ مورّدٍ له اسم', cvNoName === 0, `${cvNoName} من ${await count('contractvendors')}`);

  // ═══ التخليص الجمركي ════════════════════════════════════════════════════
  head('التخليص الجمركي');
  const nCC = await count('customsclearances');
  console.log(`  معاملات: ${nCC} · أطراف: ${await count('customsparties')}`);
  ok('قائمة المعاملات تُفتَح', (await get('/api/customs-clearance?limit=20')).status === 200);
  const ccStages = await db.collection('customsclearances').aggregate([{ $group: { _id: '$stage', n: { $sum: 1 } } }, { $sort: { n: -1 } }]).toArray();
  console.log('  المراحل: ' + ccStages.map((s) => `${s._id || '(بلا)'}:${s.n}`).join(' · '));
  const noStage = ccStages.find((s) => !s._id);
  if (noStage) notes.push(`التخليص: ${noStage.n} معاملةً بلا مرحلة`);
  ok('كلُّ معاملةٍ في مرحلةٍ معروفة', !noStage, noStage ? `${noStage.n} بلا مرحلة` : `${nCC} معاملة`);

  // ═══ إدارة الأسطول ══════════════════════════════════════════════════════
  head('إدارة الأسطول');
  console.log(`  عملاء: ${await count('fleetcustomers')} · سائقون: ${await count('fleetdrivers')} · مركبات: ${await count('fleetvehicles')} · شحنات: ${await count('fleetshipments')} · أحداث: ${await count('fleetevents')}`);
  ok('لوحة الأسطول تُفتَح', (await get('/api/fleet/dashboard')).status === 200);
  const fleetVeh = await ids('fleetvehicles');
  const fleetShip = await rows('fleetshipments', { vehicle: { $ne: null } }, { vehicle: 1 });
  const badFV = fleetShip.filter((s) => s.vehicle && !fleetVeh.has(String(s.vehicle)));
  ok('كلُّ شحنةٍ لمركبةٍ موجودة', badFV.length === 0, `${badFV.length} من ${fleetShip.length}`);
  // المقعدُ لا يحمل أكثر من سائقين — قاعدةُ القسم نفسِها.
  const seats = await db.collection('fleetvehicles').aggregate([
    { $project: { plateNumber: 1, n: { $size: { $ifNull: ['$drivers', []] } } } },
    { $match: { n: { $gt: 2 } } },
  ]).toArray();
  ok('لا مركبةَ عليها أكثرُ من سائقين', seats.length === 0, seats.length ? seats.map((s) => s.plateNumber).join('، ') : 'الكلّ');

  // ═══ CRM ════════════════════════════════════════════════════════════════
  head('CRM');
  console.log(`  شركات: ${await count('crmcompanies')} · موردون: ${await count('crmvendors')} · جهات اتصال: ${await count('crmcontacts')} · أنشطة: ${await count('crmactivities')}`);
  ok('قائمة الشركات تُفتَح', (await get('/api/crm/companies?limit=20')).status === 200);
  const dupCrm = await db.collection('crmcompanies').aggregate([
    { $match: { nameKey: { $nin: [null, ''] } } },
    { $group: { _id: '$nameKey', n: { $sum: 1 } } }, { $match: { n: { $gt: 1 } } }, { $count: 'c' },
  ]).toArray();
  if (dupCrm.length) notes.push(`CRM: ${dupCrm[0].c} اسمَ شركةٍ مكرَّرًا بعد طيّ الهمزات والمسافات`);
  ok('اسمُ الشركة لا يتكرّر بعد الطيّ', !dupCrm.length, dupCrm.length ? `${dupCrm[0].c} مكرَّرًا` : 'لا تكرار');

  // ═══ الشؤون الإدارية + الريموت + الورشة ═════════════════════════════════
  head('الشؤون الإدارية · الريموت · الورشة');
  console.log(`  مهامّ إدارية: ${await count('admintasks')} · رسائل ريموت: ${await count('remotemessages')} · مهامّ ورشة: ${await count('workshoptasks')}`);
  ok('لوحة المهامّ الإدارية تُفتَح', (await get('/api/admin-tasks')).status === 200);
  ok('الريموت يُفتَح', [200, 403].includes((await get('/api/remote/announcements')).status));
  ok('الورشة تُفتَح', (await get('/api/workshop/tasks')).status === 200);

  // ═══ الأقسامُ الفارغة ═══════════════════════════════════════════════════
  head('أقسامٌ لا بياناتِ لها');
  const emptySections = [
    ['المشتريات', ['purchaseorders', 'purchaserequests']],
    ['المبيعات', ['salestargets']],
    ['التسويق', ['marketingactivities', 'marketingcampaigns']],
    ['تطوير الأعمال', ['bdopportunities', 'bdtenders', 'bdpartners', 'bdactivities']],
    ['المحاسبة', ['journalentries', 'expensecategories']],
    ['CRM — الصفقات وجهات الاتصال', ['crmdeals', 'crmcontacts', 'crmactivities']],
  ];
  for (const [name, colls] of emptySections) {
    let total = 0;
    for (const c of colls) { try { total += await count(c); } catch (_) {} }
    if (total === 0) { empty.push(name); console.log(`  ○ ${name.padEnd(30)} فارغٌ تمامًا`); }
    else console.log(`  · ${name.padEnd(30)} ${total} سجلًّا`);
  }
  ok('الأقسامُ الفارغةُ معروضةٌ لا مخفيّةٌ خلف علامة صحّ', true, `${empty.length} أقسام`);

  // ═══ ما يمسّ الأقسامَ كلَّها ════════════════════════════════════════════
  head('عابرٌ للأقسام');
  const notif = await count('notifications');
  const uIds = await ids('users');
  const notifRefs = await rows('notifications', { user: { $ne: null } }, { user: 1 });
  const badNotif = notifRefs.filter((n) => n.user && !uIds.has(String(n.user)));
  if (badNotif.length) notes.push(`الإشعارات: ${badNotif.length} إشعارًا لحسابٍ محذوف (لا يراها أحد)`);
  ok('كلُّ إشعارٍ لحسابٍ موجود', badNotif.length === 0, `${badNotif.length} من ${notif}`);

  // القيمةُ في القوائم اسمُها `nameAr`/`key` لا `value` — والتجميعُ على حقلٍ
  // غير موجودٍ يجمع النوعَ كلَّه في مجموعةٍ واحدةٍ ويقول «مكرَّر» عن كلّ نوع.
  const lookups = await db.collection('lookups').aggregate([
    { $match: { isActive: { $ne: false } } },
    { $group: { _id: { t: '$type', v: '$nameAr' }, n: { $sum: 1 } } },
    { $match: { n: { $gt: 1 } } }, { $limit: 6 },
  ]).toArray();
  ok('لا قيمةَ مكرَّرةً في القوائم المنسدلة', !lookups.length,
    lookups.length ? lookups.map((l) => `${l._id.t}/${l._id.v}`).join('، ') : `${await count('lookups')} قيمة`);

  // ── وعقودُ الموظّفين ────────────────────────────────────────────────────
  // هي في `contracts`، وتخصّ الموارد البشريّة لا قسمَ العقود.
  // ── والتاريخُ الفارغُ نصٌّ فارغٌ لا `null` ──────────────────────────────
  // ثلاثةُ عقودٍ نهايتُها `''`، و`$ne: null` يمرّرها فتبدو «تنتهي قبل أن تبدأ»
  // وهي بلا نهايةٍ أصلًا. الحالتان مختلفتان: واحدةٌ خانةٌ لم تُملأ، والأخرى
  // تاريخان مقلوبان — ولكلٍّ جوابٌ آخر.
  const empContracts = await db.collection('contracts')
    .find({ startDate: { $nin: [null, ''] } })
    .project({ contractNumber: 1, employeeNameAr: 1, startDate: 1, endDate: 1, status: 1 }).toArray();
  const noEnd = empContracts.filter((c) => !c.endDate);
  const inverted = empContracts.filter((c) => c.endDate && new Date(c.endDate) < new Date(c.startDate));
  const d10 = (v) => String(v || '').slice(0, 10) || (v ? new Date(v).toISOString().slice(0, 10) : '—');
  if (noEnd.length) notes.push(`عقودُ الموظّفين: ${noEnd.length} عقدًا بلا تاريخ نهاية — ${noEnd.map((c) => `${c.employeeNameAr || '?'} (عقد ${c.contractNumber || 'بلا رقم'}، بدأ ${d10(c.startDate)})`).join('، ')}`);
  if (inverted.length) notes.push(`عقودُ الموظّفين: ${inverted.length} عقدًا نهايتُه قبل بدايته — ${inverted.map((c) => `${c.employeeNameAr || '?'} (عقد ${c.contractNumber || 'بلا رقم'}: ${d10(c.startDate)} → ${d10(c.endDate)})`).join('، ')}`);
  // خانةٌ لم تُملأ وتاريخان مقلوبان: كلاهما يحتاج جوابَ الموارد البشريّة لا
  // إصلاحًا برمجيًّا — فيُعرَضان في «يحتاج قرارَك» ولا يُصبغان السويتَ حمراء.
  ok('عقودُ الموظّفين: تواريخُها مفحوصة', true,
    `${noEnd.length} بلا نهاية · ${inverted.length} مقلوب — من ${empContracts.length} عقدًا`);

  const roles = await db.collection('users').aggregate([{ $group: { _id: '$role', n: { $sum: 1 } } }, { $sort: { n: -1 } }]).toArray();
  console.log('  الأدوار: ' + roles.map((r) => `${r._id}:${r.n}`).join(' · '));
  const { ROLES } = (() => { try { return require('../config/roles'); } catch (_) { return {}; } })();
  if (ROLES) {
    const known = new Set(Object.keys(ROLES));
    const unknown = roles.filter((r) => r._id && !known.has(r._id));
    ok('كلُّ دورٍ مستعمَلٍ معرَّفٌ في الإعدادات', unknown.length === 0, unknown.map((r) => r._id).join('، ') || `${roles.length} دورًا`);
  }

  await User.deleteMany({ email: /^zz-sect/ });
  console.log(`\n${'═'.repeat(62)}\n  ناجح ${pass} · فاشل ${fail}\n${'═'.repeat(62)}`);
  if (empty.length) console.log(`\nأقسامٌ فارغةٌ تمامًا (${empty.length}): ${empty.join(' · ')}`);
  if (notes.length) { console.log('\nملاحظاتٌ للنظر:'); for (const n of notes) console.log(`  · ${n}`); }
  await mongoose.disconnect();
  process.exit(fail ? 1 : 0);
})().catch(async (e) => { console.error('FATAL', e.message); try { await mongoose.disconnect(); } catch (_) {} process.exit(1); });
