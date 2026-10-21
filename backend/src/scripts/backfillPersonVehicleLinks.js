/**
 * شخصٌ واحدٌ ومركبةٌ واحدة في النظام كلِّه — يُصلح ما افترق قبل أن تصير المزامنةُ
 * في النماذج (صاحبُ الشركة، ٢٠٢٦/١٠/٢١). مرّةً واحدة، وهو نفسُه فحصُ السلامة:
 * بلا `--apply` يعدّ الفروق ولا يكتب شيئًا، ويخرج بـ1 إن وُجدت.
 *
 *   ١) نسخُ الشخص تتبع الموارد البشريّة (utils/employeeIdentitySync.pushPersonChange):
 *      · النقل الخفيف: الاسم والجوال والجنسيّة (لا الوظيفة — قائمةُ القسم غيرُ
 *        مسمّى الموارد البشريّة، تُعَدّ هنا ولا تُمسّ)، وأوامرُ التشغيل السارية
 *      · بطاقةُ السائق: الاسم
 *      · ورقةُ التفويض: الاسم والجوال · القائدُ الفعليّ: الاسم
 *      والفارغُ في الملفّ لا يمحو ما في النسخة.
 *   ٢) مرجعُ المركبة على الحوادث التي لوحتُها في السجلّ.
 *   ٣) مرجعُ المركبة على تفقّدات بداية الدوام — إلّا حيث للمركبة صفٌّ في اليوم نفسِه.
 *   ٤) راكبُ المركبة (`VehicleMaster.b2cRider`) من ربط صفّ النقل الخفيف بها.
 *
 *   node src/scripts/backfillPersonVehicleLinks.js           ← عرضٌ فقط
 *   node src/scripts/backfillPersonVehicleLinks.js --apply
 *   (--verbose يطبع أمثلة)
 */
require('dotenv').config();
const mongoose = require('mongoose');
const Employee = require('../models/Employee');
const DriverCard = require('../models/DriverCard');
const VehicleClaim = require('../models/VehicleClaim');
const B2CDutyCheck = require('../models/B2CDutyCheck');
const { VehicleMaster } = require('../models/VehicleMaster');
const { LightTransportEmployee, LightTransportOrder } = require('../models/LightTransport');
const P = require('../utils/personRef');
const { resolveMany, canonicalPlateKey } = require('../utils/vehicleRef');
const { registryPlateKey } = require('../utils/plateKey');

const APPLY = process.argv.includes('--apply');
const VERBOSE = process.argv.includes('--verbose');
const S = P.S;
const NOID = (x) => S(x).replace(/\s+/g, '');

async function plan() {
  const t = {};
  const ex = {};
  const sample = (k, v) => { (ex[k] = ex[k] || []).length < 5 && ex[k].push(v); };

  // ── الموارد البشريّة: برقم الهويّة وبالمعرّف ─────────────────────────────────
  const emps = await Employee.find({}).select('firstName lastName arabicName iqamaNumber nationalId phone nationality jobTitle isHrRecord employmentStatus').lean();
  const byId = new Map();
  const byOid = new Map(emps.map((e) => [String(e._id), e]));
  for (const e of [...emps].sort((a, b) => P.rank(b) - P.rank(a))) {
    for (const k of P.idsOf(e)) if (!byId.has(k)) byId.set(k, e);
  }
  const hrOf = (oid, id) => {
    const e = (oid && byOid.get(String(oid))) || byId.get(NOID(id)) || null;
    return e && e.isHrRecord !== false ? e : null;
  };

  // ── ١) النقل الخفيف ─────────────────────────────────────────────────────────
  const lt = await LightTransportEmployee.find({}).select('name idNumber employee phone nationalityAr jobTitleAr vehicle opStatus isActive updatedAt').lean();
  const ltOps = [];
  const ltName = new Map(); // معرّفُ الصفّ ← الاسمُ بعد التوحيد
  Object.assign(t, { ltRows: lt.length, ltLinked: 0, ltName: 0, ltPhone: 0, ltNationality: 0, ltJobTitleDiffers_reportOnly: 0 });
  for (const r of lt) {
    const e = hrOf(r.employee, r.idNumber);
    ltName.set(String(r._id), S(r.name));
    if (!e) continue;
    t.ltLinked += 1;
    const $set = {};
    const name = P.canonicalName(e);
    if (name && S(r.name) !== name) { $set.name = name; t.ltName += 1; sample('ltName', [r.name, name]); }
    if (S(e.phone) && S(r.phone) !== S(e.phone)) { $set.phone = S(e.phone); t.ltPhone += 1; }
    if (S(e.nationality) && S(r.nationalityAr) !== S(e.nationality)) { $set.nationalityAr = S(e.nationality); t.ltNationality += 1; sample('ltNationality', [r.nationalityAr, e.nationality]); }
    if (S(r.jobTitleAr) && S(e.jobTitle) && S(r.jobTitleAr) !== S(e.jobTitle)) { t.ltJobTitleDiffers_reportOnly += 1; sample('ltJobTitle', [r.jobTitleAr, e.jobTitle]); }
    if ($set.name) ltName.set(String(r._id), name);
    if (Object.keys($set).length) ltOps.push({ updateOne: { filter: { _id: r._id }, update: { $set } } });
  }

  const orders = await LightTransportOrder.find({ status: { $in: ['active', 'hold'] } }).select('ltEmployee employeeName').lean();
  const orderOps = [];
  for (const o of orders) {
    const want = ltName.get(String(o.ltEmployee));
    if (want && S(o.employeeName) !== want) orderOps.push({ updateOne: { filter: { _id: o._id }, update: { $set: { employeeName: want } } } });
  }
  t.ltOrderNames = orderOps.length;

  // ── بطاقاتُ السائقين ────────────────────────────────────────────────────────
  const cards = await DriverCard.find({}).select('name idNumber employee').lean();
  const cardOps = [];
  for (const c of cards) {
    const e = hrOf(c.employee, c.idNumber);
    const name = e && P.canonicalName(e);
    if (name && S(c.name) !== name) { cardOps.push({ updateOne: { filter: { _id: c._id }, update: { $set: { name } } } }); sample('cardName', [c.name, name]); }
  }
  t.cardNames = cardOps.length;

  // ── ورقةُ التفويض والقائدُ الفعليّ والراكب ──────────────────────────────────
  const vms = await VehicleMaster.find({}).select('plateNumber plateKey canonKey authorizedPerson actualDriver b2cRider').lean();
  const vmSets = new Map(); // id ← $set
  const put = (id, k, v) => { const m = vmSets.get(String(id)) || {}; m[k] = v; vmSets.set(String(id), m); };
  Object.assign(t, { authorizedName: 0, authorizedPhone: 0, actualDriverName: 0 });
  for (const v of vms) {
    const a = v.authorizedPerson || {};
    const ea = NOID(a.iqamaNumber) ? hrOf(null, a.iqamaNumber) : null;
    if (ea) {
      const name = P.canonicalName(ea);
      if (name && S(a.name) !== name) { put(v._id, 'authorizedPerson.name', name); t.authorizedName += 1; sample('authorizedName', [a.name, name]); }
      if (S(ea.phone) && S(a.phone) !== S(ea.phone)) { put(v._id, 'authorizedPerson.phone', S(ea.phone)); t.authorizedPhone += 1; }
    }
    const d = v.actualDriver || {};
    const ed = NOID(d.idNumber) ? hrOf(null, d.idNumber) : null;
    if (ed) {
      const name = P.canonicalName(ed);
      if (name && S(d.name) !== name) { put(v._id, 'actualDriver.name', name); t.actualDriverName += 1; sample('actualDriverName', [d.name, name]); }
    }
  }

  // ── ٤) الراكب ───────────────────────────────────────────────────────────────
  const riders = new Map(); // vm ← [lt rows]
  for (const r of lt) {
    if (!r.vehicle || r.isActive === false) continue;
    const k = String(r.vehicle);
    riders.set(k, [...(riders.get(k) || []), r]);
  }
  Object.assign(t, { riderSet: 0, riderCleared: 0, riderSharedVehicles: 0, riderDangling: 0 });
  const vmIds = new Set(vms.map((v) => String(v._id)));
  for (const k of riders.keys()) if (!vmIds.has(k)) t.riderDangling += 1;
  for (const v of vms) {
    const rows = (riders.get(String(v._id)) || []).sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));
    if (rows.length > 1) t.riderSharedVehicles += 1;
    const cur = v.b2cRider || {};
    const r = rows[0];
    if (r) {
      const want = { lt: String(r._id), name: ltName.get(String(r._id)) || S(r.name), opStatus: S(r.opStatus) };
      if (String(cur.lt || '') !== want.lt || S(cur.name) !== want.name || S(cur.opStatus) !== want.opStatus) {
        put(v._id, 'b2cRider.lt', r._id); put(v._id, 'b2cRider.name', want.name); put(v._id, 'b2cRider.opStatus', want.opStatus);
        t.riderSet += 1;
      }
    } else if (cur.lt || S(cur.name)) {
      put(v._id, 'b2cRider.lt', null); put(v._id, 'b2cRider.name', ''); put(v._id, 'b2cRider.opStatus', '');
      t.riderCleared += 1;
    }
  }
  // راكبٌ تغيّر اسمُه في ١) ولم يتغيّر غيرُه — يُكتب اسمُه على مركبته.
  t.vehiclesTouched = vmSets.size;

  // ── ٢) الحوادث ──────────────────────────────────────────────────────────────
  const claims = await VehicleClaim.find({ $or: [{ vehicle: null }, { vehicle: { $exists: false } }], vehiclePlate: { $nin: ['', null] } })
    .select('vehiclePlate vehiclePlateKey').lean();
  const cMap = await resolveMany(claims.map((c) => c.vehiclePlate), '_id plateNumber canonKey plateKey');
  const claimOps = [];
  for (const c of claims) {
    const hit = cMap.get(canonicalPlateKey(c.vehiclePlate));
    if (!hit) { sample('claimUnmatched', c.vehiclePlate); continue; }
    claimOps.push({ updateOne: { filter: { _id: c._id }, update: { $set: { vehicle: hit._id, vehiclePlateKey: hit.plateKey || registryPlateKey(hit.plateNumber) || c.vehiclePlateKey || '' } } } });
  }
  Object.assign(t, { claimsWithoutRef: claims.length, claimRefs: claimOps.length });

  // ── ٣) التفقّدات ────────────────────────────────────────────────────────────
  const checks = await B2CDutyCheck.find({ $or: [{ vehicle: null }, { vehicle: { $exists: false } }], vehiclePlate: { $nin: ['', null] } })
    .select('vehiclePlate dateKey checkedAt').sort({ checkedAt: 1 }).lean();
  const dMap = await resolveMany(checks.map((c) => c.vehiclePlate), '_id plateNumber canonKey plateKey');
  const taken = new Set((await B2CDutyCheck.find({ vehicle: { $type: 'objectId' } }).select('vehicle dateKey').lean())
    .map((c) => `${c.vehicle}|${c.dateKey}`));
  const dutyOps = [];
  Object.assign(t, { dutyWithoutRef: checks.length, dutyRefs: 0, dutyUnmatched: 0, dutySameDayTaken: 0 });
  for (const c of checks) {
    const hit = dMap.get(canonicalPlateKey(c.vehiclePlate));
    if (!hit) { t.dutyUnmatched += 1; sample('dutyUnmatched', c.vehiclePlate); continue; }
    const k = `${hit._id}|${c.dateKey}`;
    if (taken.has(k)) { t.dutySameDayTaken += 1; continue; }
    taken.add(k);
    dutyOps.push({ updateOne: { filter: { _id: c._id }, update: { $set: { vehicle: hit._id, vehicleKey: hit.plateKey || registryPlateKey(hit.plateNumber) || '' } } } });
  }
  t.dutyRefs = dutyOps.length;

  return { t, ex, ltOps, orderOps, cardOps, vmSets, claimOps, dutyOps };
}

(async () => {
  await mongoose.connect(process.env.MONGODB_URI);
  const p = await plan();
  console.log(APPLY ? '── تطبيق ──' : '── عرضٌ فقط (أضف --apply للكتابة) ──');
  console.table(p.t);
  if (VERBOSE) console.log(JSON.stringify(p.ex, null, 1));
  const pending = p.ltOps.length + p.orderOps.length + p.cardOps.length + p.vmSets.size + p.claimOps.length + p.dutyOps.length;
  if (!APPLY) { await mongoose.disconnect(); process.exit(pending ? 1 : 0); }

  const chunks = async (Model, ops, opts = {}) => {
    let n = 0;
    for (let i = 0; i < ops.length; i += 500) n += (await Model.bulkWrite(ops.slice(i, i + 500), { ordered: false, ...opts })).modifiedCount || 0; // eslint-disable-line no-await-in-loop
    return n;
  };
  const done = {
    lt: await chunks(LightTransportEmployee, p.ltOps),
    orders: await chunks(LightTransportOrder, p.orderOps),
    cards: await chunks(DriverCard, p.cardOps),
    // كتابةٌ بلا `timestamps`: مزامنةٌ لا تعديلٌ يدويّ يحميه الاستيراد.
    vehicles: await chunks(VehicleMaster, [...p.vmSets].map(([id, $set]) => ({ updateOne: { filter: { _id: id }, update: { $set }, timestamps: false } }))),
    claims: await chunks(VehicleClaim, p.claimOps),
    duty: await chunks(B2CDutyCheck, p.dutyOps),
  };
  // عددُ الحوادث على المركبة يُعَدّ بمفتاح اللوحة — يُعاد لما رُبط منها.
  const keys = [...new Set(p.claimOps.map((o) => o.updateOne.update.$set.vehiclePlateKey).filter(Boolean))];
  for (const k of keys) {
    const n = await VehicleClaim.countDocuments({ vehiclePlateKey: k, isActive: true }); // eslint-disable-line no-await-in-loop
    await VehicleMaster.updateMany({ plateKey: k }, { $set: { accidentCount: n } }, { timestamps: false }); // eslint-disable-line no-await-in-loop
  }
  done.accidentCounts = keys.length;
  console.table(done);
  const again = await plan();
  console.log('بعد التطبيق:'); console.table(again.t);
  await mongoose.disconnect();
})().catch((e) => { console.error(e); process.exit(2); });
