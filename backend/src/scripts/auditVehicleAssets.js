/**
 * auditVehicleAssets — سجل كاوتش الأسطول: التغطية، والملف الواحد للعربية.
 *
 *   node src/scripts/auditVehicleAssets.js --base http://127.0.0.1:5599
 *
 * بيتأكد إن الرقم اللي على الشاشة هو نفسه اللي في الداتابيز، وإن الضغط عليه
 * بيفتح نفس الكاوتش بالظبط — العدد اللي مكتوب على الزرار لازم يساوي عدد
 * الصفوف اللي بتتفتح، وإلا الزرار بيكدب.
 *
 * وبيتأكد إن التاريخ المدموج بيلم من كل المصادر: حركة الكاوتش من سجل الأصول،
 * وقطع الغيار من مخزن LS2 ومخزن الورشة، والإصلاحات، والصيانة. المطابقة بالعربية
 * بتتم بمفتاح اللوحة مش بالنص — «5010» و«أ ص ر 5010» نفس العربية.
 */
require('dotenv').config();
const mongoose = require('mongoose');

const argv = process.argv.slice(2);
const iB = argv.indexOf('--base');
const BASE = (iB >= 0 && argv[iB + 1] ? argv[iB + 1] : process.env.BASE || 'http://localhost:5599').replace(/\/$/, '');
const FULL = 14;

let pass = 0; let fail = 0;
const ok = (l, c, x = '') => { console.log(`  ${c ? '✓' : '✗ FAIL'}  ${l}${x ? '   — ' + x : ''}`); c ? pass++ : fail++; };
const req = async (p, ck) => {
  const r = await fetch(`${BASE}${p}`, { headers: ck ? { Cookie: ck } : {} });
  let j = null; try { j = await r.json(); } catch { /* not json */ }
  return { status: r.status, body: j };
};

(async () => {
  await mongoose.connect(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 20000 });
  const User = require('../models/User');
  const Ls2Flatbed = require('../models/Ls2Flatbed');
  const Ls2TireAsset = require('../models/Ls2TireAsset');
  const Ls2AssetEvent = require('../models/Ls2AssetEvent');
  const { plateKey } = require('../utils/plateKey');

  await User.deleteMany({ email: { $regex: '^zz-assets' } });
  const u = await User.create({ email: 'zz-assets@example.invalid', password: 'Test@12345', firstName: 'ت', lastName: 'أ', role: 'super_admin' });
  const lr = await fetch(`${BASE}/api/auth/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: u.email, password: 'Test@12345' }),
  });
  if (lr.status === 429) { console.error('RATE LIMITED'); process.exit(2); }
  const ck = (lr.headers.getSetCookie?.() || []).map((c) => c.split(';')[0]).join('; ');

  try {
    // ═══ التغطية ═════════════════════════════════════════════════════════════
    console.log('── تغطية الكاوتش ──');
    const ov = await req('/api/ls2/assets/overview', ck);
    ok('النظرة الشاملة بترد', ov.status === 200, `HTTP ${ov.status}`);
    const flatbeds = ov.body?.flatbeds || [];

    const mounted = await Ls2TireAsset.find({ status: 'mounted', plateKey: { $nin: [null, ''] } }).select('plateKey').lean();
    const dbCount = new Map();
    mounted.forEach((t) => dbCount.set(t.plateKey, (dbCount.get(t.plateKey) || 0) + 1));

    // الرقم اللي على الزرار = اللي في الداتابيز، لكل سطحة مش لعيّنة
    const wrong = flatbeds.filter((f) => (f.tireCount || 0) !== (dbCount.get(f.plateKey) || 0));
    ok(`${flatbeds.length} سطحة: الرقم المعروض = المسجّل فعلاً`, wrong.length === 0,
      wrong.slice(0, 3).map((f) => `${f.plate}: شاشة ${f.tireCount} / داتابيز ${dbCount.get(f.plateKey) || 0}`).join(' | '));

    const complete = flatbeds.filter((f) => (f.tireCount || 0) >= FULL);
    const partial = flatbeds.filter((f) => (f.tireCount || 0) > 0 && (f.tireCount || 0) < FULL);
    const empty = flatbeds.filter((f) => !(f.tireCount || 0));
    console.log(`     مكتملة ${complete.length} · ناقصة ${partial.length} · مفيهاش أي كاوتش ${empty.length}`);
    partial.forEach((f) => console.log(`       ⚠ ${f.plate} — ${f.tireCount}/${FULL} (ناقص ${FULL - f.tireCount})`));
    empty.forEach((f) => console.log(`       ✗ ${f.plate} — لسه لم تُجرَد بعد`));

    // ═══ الضغط على الرقم بيفتح نفس الكاوتش ═══════════════════════════════════
    console.log('\n── الضغط على الرقم بيفتح نفس العدد ──');
    let checked = 0; const mismatched = [];
    for (const f of flatbeds) {
      const r = await req(`/api/ls2/assets/vehicle/${encodeURIComponent(f.plate)}`, ck);
      const n = (r.body?.tires || []).length;
      if (r.status !== 200 || n !== (f.tireCount || 0)) mismatched.push(`${f.plate}: زرار ${f.tireCount} / فتح ${n}`);
      else checked++;
    }
    ok(`${checked}/${flatbeds.length} سطحة: العدد على الزرار = عدد الصفوف اللي بتتفتح`,
      mismatched.length === 0, mismatched.slice(0, 4).join(' | '));

    // بيانات كل إطار كاملة — من غيرها الجدول اللي بيتفتح فاضي المعنى
    const sample = complete[0];
    if (sample) {
      const tires = (await req(`/api/ls2/assets/vehicle/${encodeURIComponent(sample.plate)}`, ck)).body?.tires || [];
      const incomplete = tires.filter((x) => !x.serial || x.positionNumber == null);
      ok(`${sample.plate}: كل الـ${tires.length} إطار ليهم سيريال وموقع`, incomplete.length === 0,
        incomplete.map((x) => x.serial || '(بدون سيريال)').join(' | '));
      const isSp = (x) => x.isSpare || /استبن/.test(x.section || '');
      const heads = tires.filter((x) => !isSp(x) && !/تيدر|تريل/.test(x.section || '')).length;
      const trl = tires.filter((x) => !isSp(x) && /تيدر|تريل/.test(x.section || '')).length;
      const sp = tires.filter(isSp).length;
      ok(`${sample.plate}: التقسيمة ٦ رأس · ٦ تيدر · ٢ استبن`, heads === 6 && trl === 6 && sp === 2,
        `رأس ${heads} · تيدر ${trl} · استبن ${sp}`);
    }

    // ═══ التاريخ المدموج ═════════════════════════════════════════════════════
    console.log('\n── تاريخ العربية (كاوتش + قطع غيار + إصلاح + صيانة) ──');
    let withHistory = 0; const kinds = {};
    for (const f of flatbeds.slice(0, 20)) {
      const h = await req(`/api/ls2/assets/vehicle/${encodeURIComponent(f.plate)}/history`, ck);
      if (h.status !== 200) { ok(`${f.plate} التاريخ`, false, `HTTP ${h.status}`); continue; }
      if ((h.body?.total || 0) > 0) withHistory++;
      Object.entries(h.body?.counts || {}).forEach(([k, v]) => { kinds[k] = (kinds[k] || 0) + v; });
      // مفيش صف من عربية تانية
      const foreign = (h.body?.rows || []).filter((r) => r.kind === 'tire' && r.detail
        && !r.detail.includes(f.plate) && !r.detail.includes('مخزن'));
      if (foreign.length) ok(`${f.plate}: مفيش صفوف من عربية تانية`, false, foreign[0].detail);
    }
    ok(`${withHistory}/20 عربية عندها تاريخ`, withHistory > 0);
    ok(`الأنواع اللي اتلمّت: ${Object.entries(kinds).map(([k, v]) => `${k} ${v}`).join(' · ')}`,
      Object.keys(kinds).length >= 2, 'المفروض على الأقل كاوتش + صيانة');

    // ── الدمج نفسه: قطع الغيار لسه مفيش منها حركة على عربية في الداتا، فالتيست
    // بيزرع واحدة حقيقية ويتأكد إنها بتوصل، وبعدين يشيلها. من غير كده كنا
    // بنقول «مفيش أخطاء» على داتا فاضية — وده مش تيست.
    console.log('\n── الدمج: قطع الغيار بتوصل للعربية الصح ──');
    const { Ls2StoreItem, Ls2StoreMovement } = require('../models/Ls2Store');
    const InventoryIssue = require('../models/InventoryIssue');
    const target = complete[0] || flatbeds[0];
    let item = await Ls2StoreItem.findOne({}).select('_id name').lean();
    if (!item) item = await Ls2StoreItem.create({ name: 'zz-صنف اختبار' });
    await Ls2StoreMovement.deleteMany({ itemName: { $regex: '^zz-' } });
    await InventoryIssue.deleteMany({ itemName: { $regex: '^zz-' } });
    const before = (await req(`/api/ls2/assets/vehicle/${encodeURIComponent(target.plate)}/history`, ck)).body;
    const mv = await Ls2StoreMovement.create({
      item: item._id, itemName: 'zz-فلتر زيت اختبار', type: 'out', quantity: 2,
      vehiclePlate: target.plate, reason: 'تيست', performedByName: 'audit',
    });
    // ونفس الحاجة من مخزن الورشة، بس **بأرقام اللوحة بس** — ده اللي بيثبت إن
    // المطابقة بالمفتاح مش بالنص.
    const InventoryItem = require('../models/InventoryItem');
    let invItem = await InventoryItem.findOne({}).select('_id').lean();
    if (!invItem) invItem = await InventoryItem.create({ name: 'zz-صنف ورشة اختبار' });
    const iss = await InventoryIssue.create({
      item: invItem._id, itemName: 'zz-طقم فرامل اختبار', quantity: 1,
      vehicleNumber: String(target.plate).replace(/[^0-9]/g, '') || target.plate,
      date: new Date().toISOString().slice(0, 10),
    });
    const after = (await req(`/api/ls2/assets/vehicle/${encodeURIComponent(target.plate)}/history`, ck)).body;
    ok(`${target.plate}: صادر مخزن LS2 ظهر في التاريخ`,
      (after?.rows || []).some((r) => r.kind === 'part' && r.title === 'zz-فلتر زيت اختبار'));
    ok(`${target.plate}: صرف مخزن الورشة (بأرقام اللوحة بس) ظهر برضه`,
      (after?.rows || []).some((r) => r.kind === 'part' && r.title === 'zz-طقم فرامل اختبار'));
    ok(`عدّاد «قطع غيار» زاد ٢ (${before?.counts?.part || 0} → ${after?.counts?.part || 0})`,
      (after?.counts?.part || 0) === (before?.counts?.part || 0) + 2);
    // ومحدش تاني شافها
    const other = flatbeds.find((f) => f.plateKey !== target.plateKey);
    const oh = (await req(`/api/ls2/assets/vehicle/${encodeURIComponent(other.plate)}/history`, ck)).body;
    ok(`${other.plate}: ماشافش حركة ${target.plate}`,
      !(oh?.rows || []).some((r) => String(r.title || '').startsWith('zz-')));
    await Ls2StoreMovement.deleteOne({ _id: mv._id });
    await InventoryIssue.deleteOne({ _id: iss._id });
    await InventoryItem.deleteMany({ name: { $regex: '^zz-' } });
    await Ls2StoreMovement.deleteMany({ itemName: { $regex: '^zz-' } });
    await InventoryIssue.deleteMany({ itemName: { $regex: '^zz-' } });
    await Ls2StoreItem.deleteMany({ name: { $regex: '^zz-' } });
    const back = (await req(`/api/ls2/assets/vehicle/${encodeURIComponent(target.plate)}/history`, ck)).body;
    ok('اتشالت بعد التيست', (back?.counts?.part || 0) === (before?.counts?.part || 0));

    // الترتيب زمني تنازلي
    const one = (await req(`/api/ls2/assets/vehicle/${encodeURIComponent(flatbeds[0].plate)}/history`, ck)).body?.rows || [];
    const sorted = one.every((r, i) => i === 0 || new Date(one[i - 1].date) >= new Date(r.date));
    ok('التاريخ مرتّب من الأحدث للأقدم', sorted);

    // مفتاح اللوحة: النص المختلف لازم يوصل لنفس العربية
    const p = flatbeds[0].plate;
    const digits = String(p).replace(/[^0-9]/g, '');
    if (digits && digits !== p) {
      const a = (await req(`/api/ls2/assets/vehicle/${encodeURIComponent(p)}/history`, ck)).body?.total;
      const b = (await req(`/api/ls2/assets/vehicle/${encodeURIComponent(digits)}/history`, ck)).body?.total;
      ok(`«${p}» و«${digits}» نفس العربية`, a === b, `${a} مقابل ${b}`);
    }

    // ═══ قاعدة «الموقع ما بيفضلش فاضي» + الأكشنز ════════════════════════════
    // التدقيق بيشتغل على **عربية اختبار بيعملها ويمسحها**، مش على عربية شغالة.
    // الجرية القديمة كانت بتنزّل وتركّب فردة حقيقية، فكانت بتسيب حركات في تاريخ
    // عربية بتشتغل — الورشة بتقراها كأنها شغل اتعمل، وهي ما حصلتش. أي تيست
    // بيكتب لازم يكتب على داتا بتاعته.
    console.log('\n── قاعدة: الفردة ما تنزلش من غير بديل ──');
    const Ls2Flatbed2 = require('../models/Ls2Flatbed');
    const { plateKey: pk2 } = require('../utils/plateKey');
    const TEST_PLATE = 'ZZ 9999';
    const testKey = pk2(TEST_PLATE);
    const post = async (path, body) => {
      const r = await fetch(`${BASE}${path}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: ck },
        body: JSON.stringify(body),
      });
      let j = null; try { j = await r.json(); } catch { /* not json */ }
      return { status: r.status, body: j };
    };
    const cleanupTest = async () => {
      const ids = (await Ls2TireAsset.find({ serial: { $regex: '^ZZ-' } }).select('_id').lean()).map((x) => x._id);
      await Ls2AssetEvent.deleteMany({ $or: [{ refId: { $in: ids } }, { fromPlateKey: testKey }, { toPlateKey: testKey }] });
      await Ls2TireAsset.deleteMany({ serial: { $regex: '^ZZ-' } });
      await Ls2Flatbed2.deleteMany({ plateKey: testKey });
    };
    await cleanupTest();
    await Ls2Flatbed2.create({ plate: TEST_PLATE, plateKey: testKey });
    // فردة على موقع شغّال (الرأس) وفردة على الاستبن وفردة في المخزن كبديل
    const mk = async (serial, extra) => (await post('/api/ls2/assets/tires', {
      serial, tireNumber: serial, type: 'Test', plate: TEST_PLATE, ...extra,
    })).body?.tire;
    const onHead = await mk('ZZ-HEAD-1', { positionNumber: 1, positionLabel: 'اطار 1 يسار', section: 'الرأس' });
    const onSpare = await mk('ZZ-SPARE-1', { positionNumber: 13, positionLabel: 'اطار 13', section: 'الاستبن', isSpare: true });
    const inStore = (await post('/api/ls2/assets/tires', { serial: 'ZZ-STORE-1', tireNumber: 'ZZ-STORE-1', type: 'Test' })).body?.tire;
    ok('اتعملت عربية اختبار بـ ٣ فردات', !!(onHead && onSpare && inStore));

    // ① إنزال من موقع شغّال من غير بديل → مرفوض
    const bare = await post(`/api/ls2/assets/tires/${onHead._id}/move`, { toPlate: null, destination: 'store' });
    ok('إنزال من الرأس من غير بديل مرفوض', bare.status === 400 && bare.body?.code === 'REPLACEMENT_REQUIRED',
      `HTTP ${bare.status} ${bare.body?.code || ''}`);
    const still = await Ls2TireAsset.findById(onHead._id).lean();
    ok('والفردة فضلت مكانها (الرفض ما غيّرش حاجة)', still.status === 'mounted' && still.positionNumber === 1);

    // ② «تالفة/سكراب» من موقع شغّال من غير بديل → مرفوض برضه (الباب التاني)
    const bareRetire = await post(`/api/ls2/assets/tires/${onHead._id}/retire`, { kind: 'damaged', reason: 'تيست' });
    ok('«تالفة» من غير بديل مرفوضة كمان', bareRetire.status === 400 && bareRetire.body?.code === 'REPLACEMENT_REQUIRED',
      `HTTP ${bareRetire.status}`);
    // ③ و«نقل الحالة» — الباب الثالث
    const bareStatus = await post(`/api/ls2/assets/tires/${onHead._id}/status`, { status: 'in_repair' });
    ok('«نقل الحالة» من غير بديل مرفوض كمان', bareStatus.status === 400 && bareStatus.body?.code === 'REPLACEMENT_REQUIRED',
      `HTTP ${bareStatus.status}`);

    // ④ الاستبن مستثنى — العربية بتمشي من غيره
    const spareDown = await post(`/api/ls2/assets/tires/${onSpare._id}/move`, { toPlate: null, destination: 'store' });
    ok('الاستبن ينزل من غير بديل (مسموح)', spareDown.status === 200, `HTTP ${spareDown.status} ${spareDown.body?.message || ''}`);

    // ⑤ وبالبديل بيعدّي، والبديل بياخد المكان
    const withRepl = await post(`/api/ls2/assets/tires/${onHead._id}/move`, {
      toPlate: null, destination: 'store', conditionPercent: 70, replacementTireId: inStore._id, reason: 'تيست',
    });
    ok('الإنزال بالبديل بيعدّي', withRepl.status === 200, `HTTP ${withRepl.status} ${withRepl.body?.message || ''}`);
    const slot = await Ls2TireAsset.findOne({ plateKey: testKey, positionNumber: 1, status: 'mounted' }).lean();
    ok('البديل اترکب في نفس الموقع', slot && String(slot._id) === String(inStore._id),
      slot ? slot.serial : 'الموقع فاضي');
    const oldOne = await Ls2TireAsset.findById(onHead._id).lean();
    ok('والفردة القديمة راحت المخزن بنسبتها', oldOne.status === 'spare' && oldOne.conditionPercent === 70,
      `${oldOne.status} · ${oldOne.conditionPercent}%`);

    await cleanupTest();
    const leftovers = await Ls2AssetEvent.countDocuments({ $or: [{ fromPlateKey: testKey }, { toPlateKey: testKey }] });
    ok('التدقيق ما سابش أي أثر', leftovers === 0 && (await Ls2TireAsset.countDocuments({ serial: { $regex: '^ZZ-' } })) === 0);

    // ═══ الاستيراد سجّل التاريخ ══════════════════════════════════════════════
    console.log('\n── الاستيراد الأخير سجّل الحركة ──');
    const newTrucks = require('../data/masters/newtrucks.json');
    const plates = [...new Set(newTrucks.map((r) => r.vehicle_plate))];
    let allIn = 0; const missing = [];
    for (const pl of plates) {
      const key = plateKey(pl);
      const n = await Ls2TireAsset.countDocuments({ plateKey: key, status: 'mounted' });
      const ev = await Ls2AssetEvent.countDocuments({ toPlateKey: key, entityType: 'tire' });
      if (n === FULL && ev >= FULL) allIn++; else missing.push(`${pl}: ${n} إطار / ${ev} حركة`);
    }
    ok(`${allIn}/${plates.length} عربية من الملف الجديد: ١٤ إطار + حركة لكل واحد`,
      missing.length === 0, missing.slice(0, 3).join(' | '));

    // الاستيراد idempotent — السيريال ما بيتكررش
    const dupes = await Ls2TireAsset.aggregate([
      { $group: { _id: '$serial', n: { $sum: 1 } } }, { $match: { n: { $gt: 1 } } }, { $limit: 5 },
    ]);
    ok('مفيش سيريال متكرّر', dupes.length === 0, dupes.map((d) => d._id).join(' | '));

    // العلَم والقسم ما ينفعش يختلفوا — الموديل بيشتق العلَم، فلو ده فشل يبقى
    // الشاشة هتعدّ غلط من غير ما حد ياخد باله.
    const drift = await Ls2TireAsset.find({
      $or: [
        { status: 'mounted', section: /استبن/, isSpare: { $ne: true } },
        { isSpare: true, section: { $not: /استبن/ } },
        { isSpare: true, status: { $ne: 'mounted' } },
      ],
    }).select('serial section isSpare status').limit(5).lean();
    ok('علَم الاستبن مطابق للقسم في كل الفردات', drift.length === 0,
      drift.map((d) => `${d.serial}: ${d.section}/${d.isSpare}/${d.status}`).join(' | '));

    // مفيش موقع واحد عليه إطارين في نفس العربية
    const clash = await Ls2TireAsset.aggregate([
      { $match: { status: 'mounted', plateKey: { $nin: [null, ''] } } },
      { $group: { _id: { k: '$plateKey', p: '$positionNumber' }, n: { $sum: 1 } } },
      { $match: { n: { $gt: 1 } } }, { $limit: 5 },
    ]);
    ok('مفيش موقع عليه أكتر من إطار', clash.length === 0,
      clash.map((c) => `${c._id.k} موقع ${c._id.p} → ${c.n}`).join(' | '));
  } finally {
    await User.deleteMany({ email: { $regex: '^zz-assets' } });
    const Employee = require('../models/Employee');
    await Employee.deleteMany({ email: { $regex: '^zz-assets' } });
  }

  console.log(`\n${'─'.repeat(60)}\nنجح ${pass} · فشل ${fail}`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('FATAL', e); process.exit(1); });
