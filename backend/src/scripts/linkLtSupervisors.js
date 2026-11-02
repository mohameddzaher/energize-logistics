/**
 * Links light transport register supervisors to their system accounts.
 * The register uses names picked from a managed list (Arabic) while the account is in English, so the name does not know the account and the supervisor sees no one in the inspection screen.
 * Matching, not translation: (1) if the row's supervisor employee file equals the account's linkedEmployee, the link is structural; (2) else match first and last word of the Arabic name against the account's file, accepted only if exactly one account results; (3) else leave and report. Then the rep is assigned in B2CRep.supervisor.
 * Usage: [--apply]; prints only without it.
 */
require('dotenv').config();
const mongoose = require('mongoose');
const path = require('path');

const ROOT = path.join(__dirname, '..');
require(`${ROOT}/models/User`);
require(`${ROOT}/models/Employee`);
require(`${ROOT}/models/B2CRep`);
const { LightTransportEmployee } = require(`${ROOT}/models/LightTransport`);
const { listSupervisors, nameSkeleton, buildRepIndex, findRep } = require(`${ROOT}/utils/b2cSupervisors`);

const APPLY = process.argv.includes('--apply');
const S = (v) => String(v ?? '').trim();

/** Name skeleton: matches Arabic to Latin. See nameSkeleton. */
const endsKey = (name) => nameSkeleton(name);

(async () => {
  await mongoose.connect(process.env.MONGODB_URI);
  const User = mongoose.model('User');
  const B2CRep = mongoose.model('B2CRep');

  const sups = await listSupervisors();
  console.log(`حساباتُ الإشراف النشطة: ${sups.length}`);
  sups.forEach((s) => console.log(`  ${s.roleAr.padEnd(12)} · ${s.nameEn.padEnd(22)} · ${s.nameAr || '(لا اسمَ عربيًّا في ملفّه)'}`));

  // Name written in the register to the rows that carry it.
  const rows = await LightTransportEmployee.find({ isActive: { $ne: false } })
    .select('name idNumber supervisorName supervisor supervisorUser staffKind').lean();
  const byName = new Map();
  for (const r of rows) {
    const k = S(r.supervisorName);
    if (!k) continue;
    if (!byName.has(k)) byName.set(k, []);
    byName.get(k).push(r);
  }

  // Account index: by employee file and by name key.
  const byEmployee = new Map(sups.filter((s) => s.employee).map((s) => [String(s.employee), s]));
  const byEnds = new Map();
  for (const s of sups) {
    for (const nm of [s.nameAr, s.nameEn]) {
      const k = endsKey(nm);
      if (!k) continue;
      if (!byEnds.has(k)) byEnds.set(k, []);
      if (!byEnds.get(k).includes(s)) byEnds.get(k).push(s);
    }
  }

  console.log('\n=== المطابقة:');
  const plan = [];
  for (const [name, list] of [...byName.entries()].sort((a, b) => b[1].length - a[1].length)) {
    // 1. Structural path: the same employee file.
    let hit = null; let how = '';
    const empIds = [...new Set(list.map((r) => String(r.supervisor || '')).filter(Boolean))];
    for (const id of empIds) {
      if (byEmployee.has(id)) { hit = byEmployee.get(id); how = 'ملفّ الموظّف (بنيويّ)'; break; }
    }
    // 2. Name skeleton, accepted only when it yields a single account.
    if (!hit) {
      const cands = byEnds.get(endsKey(name)) || [];
      if (cands.length === 1) { [hit] = cands; how = `هيكل الاسم (${endsKey(name)})`; }
      else if (cands.length > 1) how = `التبس بين ${cands.length} حسابات — تُرِك`;
      else how = 'لا حسابَ بهذا الاسم';
    }
    console.log(` ${name.padEnd(20)} ×${String(list.length).padStart(3)} → ${hit ? `${hit.nameEn} [${hit.roleAr}]` : '—'}  (${how})`);
    if (hit) plan.push({ name, sup: hit, rows: list });
  }

  const noName = rows.filter((r) => !S(r.supervisorName)).length;
  console.log(`\nصفوفٌ بلا مشرفٍ مكتوب: ${noName}`);

  // Assignment in the app register: which rows have a counterpart there.
  const repIdx = await buildRepIndex();
  let repHits = 0; let repMiss = 0;
  const repPlan = [];
  for (const p of plan) {
    for (const r of p.rows) {
      const rep = findRep(repIdx, r.name, r._id);
      if (rep) { repHits += 1; repPlan.push({ rep, sup: p.sup, lt: r }); } else repMiss += 1;
    }
  }
  console.log(`\nمطابقةُ سجلّ التطبيق (B2CRep): ${repHits} مندوبًا له صفٌّ هناك · ${repMiss} بلا صفّ`);

  if (!APPLY) {
    console.log('\n(عرضٌ فقط — أضِف --apply للكتابة)');
    await mongoose.disconnect();
    return;
  }

  let ltWrites = 0;
  for (const p of plan) {
    const r = await LightTransportEmployee.updateMany(
      { _id: { $in: p.rows.map((x) => x._id) } },
      { $set: { supervisorUser: p.sup._id, supervisorName: p.sup.name, supervisor: p.sup.employee || null } },
    );
    ltWrites += r.modifiedCount ?? 0;
  }
  let repWrites = 0;
  for (const rp of repPlan) {
    const set = { supervisor: rp.sup._id };
    // The link is stored with the assignment so name matching happens once, not every time.
    if (!rp.rep.ltEmployee) set.ltEmployee = rp.lt._id;
    if (String(rp.rep.supervisor || '') === String(rp.sup._id) && !set.ltEmployee) continue;
    await B2CRep.updateOne({ _id: rp.rep._id }, { $set: set });
    repWrites += 1;
  }
  console.log(`\nكُتب: ${ltWrites} صفًّا في سجلّ النقل الخفيف · ${repWrites} مندوبًا في سجلّ التطبيق`);

  // Resulting state.
  const after = await LightTransportEmployee.aggregate([
    { $match: { isActive: { $ne: false } } },
    { $group: { _id: '$supervisorName', n: { $sum: 1 }, linked: { $sum: { $cond: [{ $ifNull: ['$supervisorUser', false] }, 1, 0] } } } },
    { $sort: { n: -1 } },
  ]);
  console.log('\n=== بعد الربط:');
  after.forEach((a) => console.log(`  ${String(a._id || '(بلا مشرف)').padEnd(22)} ${String(a.n).padStart(3)} · مربوطٌ بحساب=${a.linked}`));
  const byUser = await B2CRep.aggregate([
    { $match: { isActive: { $ne: false }, supervisor: { $ne: null } } },
    { $group: { _id: '$supervisor', n: { $sum: 1 } } },
  ]);
  console.log('\n=== مناديبُ كلِّ مشرفٍ في شاشة التفقّد:');
  for (const b of byUser) {
    const u = await User.findById(b._id).select('firstName lastName role').lean();
    console.log(`  ${(u ? `${u.firstName} ${u.lastName} [${u.role}]` : String(b._id)).padEnd(44)} ${b.n}`);
  }
  await mongoose.disconnect();
})().catch((e) => { console.error('ERR', e.message); process.exit(1); });
