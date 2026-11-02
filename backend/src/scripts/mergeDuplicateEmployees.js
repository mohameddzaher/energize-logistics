/**
 * Merges the two records of one employee and sweeps test records.
 * Usage: node src/scripts/mergeDuplicateEmployees.js [--write]
 * Employees are never deleted (see deleteEmployee), but two records for one person are a duplicate entry: documents split across them and ending service hits only one. So every reference moves from the extra record to the kept one, empty fields are filled from the extra, then only the extra is removed.
 * Same name with different identity numbers is not auto-merged (maybe two people or a returning one); it is reported for a decision.
 */
require('dotenv').config({ quiet: true });
const mongoose = require('mongoose');

const WRITE = process.argv.includes('--write');
const S = (v) => String(v == null ? '' : v).trim();

/** Everything that references an employee: collection and field. */
const REFS = [
  ['employeedocuments', 'employee'], ['employeerenewals', 'employee'],
  ['contracts', 'employee'], ['leaverequests', 'employee'], ['hrrequests', 'employee'],
  ['assets', 'employee'], ['drivercards', 'employee'],
  ['lighttransportemployees', 'employee'], ['lighttransportemployees', 'supervisor'],
  ['users', 'linkedEmployee'], ['vehicleauthorizations', 'employee'],
  ['employees', 'directManager'], ['b2creps', 'employee'],
  ['performanceevaluations', 'employee'], ['b2cdutychecks', 'employee'],
];

(async () => {
  await mongoose.connect(process.env.MONGODB_URI);
  const Employee = require('../models/Employee');
  const db = mongoose.connection;
  const have = new Set((await db.db.listCollections().toArray()).map((c) => c.name));

  const all = await Employee.find({}).lean();

  // Test records: created automatically with each user made for testing and left behind after the user is deleted. They have no identity, document or contract, and use example.invalid, a reserved unregistrable domain no real email resembles.
  const litter = all.filter((e) => /@example\.invalid$/i.test(S(e.email)));
  const litterWithData = [];
  for (const e of litter) {
    let n = 0;
    for (const [coll, field] of REFS) {
      if (!have.has(coll)) continue;
      n += await db.collection(coll).countDocuments({ [field]: e._id });
    }
    if (n) litterWithData.push({ e, n });
  }
  console.log('── سجلّات اختبارٍ متروكة ────────────────────────────────────');
  console.log('  عددُها:', litter.length, '· ما لها إشاراتٌ (لن تُمَسّ):', litterWithData.length);
  litter.slice(0, 12).forEach((e) => console.log('   ', S(e.email)));

  // Real duplicates: one identity number, two records.
  const byId = new Map();
  for (const e of all) {
    if (/@example\.invalid$/i.test(S(e.email))) continue;
    // The number may be written in both columns of one record (see identity-number-two-columns), so group by id to avoid counting a record as a duplicate of itself.
    for (const id of new Set([S(e.nationalId), S(e.iqamaNumber)].filter(Boolean))) {
      if (!byId.has(id)) byId.set(id, new Map());
      byId.get(id).set(String(e._id), e);
    }
  }
  const dups = [...byId.entries()].filter(([, m]) => m.size > 1);

  const refsOf = async (id) => {
    const out = {};
    for (const [coll, field] of REFS) {
      if (!have.has(coll)) continue;
      const n = await db.collection(coll).countDocuments({ [field]: id });
      if (n) out[`${coll}.${field}`] = n;
    }
    return out;
  };
  const filled = (e) => Object.entries(e).filter(([k, v]) => !['_id', '__v', 'createdAt', 'updatedAt'].includes(k)
    && v !== null && v !== undefined && v !== '' && !(Array.isArray(v) && !v.length)).length;

  console.log('\n── تكرارٌ حقيقيٌّ (هويّةٌ واحدةٌ · سجلّان) ──────────────────');
  const plans = [];
  for (const [id, map] of dups) {
    const rows = [...map.values()];
    const enriched = [];
    for (const r of rows) enriched.push({ r, refs: await refsOf(r._id), n: filled(r) });
    /** Which one to keep: the active employee first, since leave, salary and custody build on it and keeping the ended one would read a working person as terminated. Ties go to the record with more data. */
    enriched.sort((a, b) => {
      const act = (x) => (x.r.employmentStatus === 'active' ? 1 : 0);
      if (act(a) !== act(b)) return act(b) - act(a);
      if (a.n !== b.n) return b.n - a.n;
      return new Date(a.r.createdAt) - new Date(b.r.createdAt);
    });
    const [keep, ...drop] = enriched;
    plans.push({ id, keep, drop });
    console.log(`\n هوية ${id} — «${keep.r.arabicName || keep.r.firstName}»`);
    console.log(`   يُبقى : ${String(keep.r._id).slice(-6)} [${keep.r.employmentStatus}] خانات ${keep.n} · ${JSON.stringify(keep.refs)}`);
    for (const d of drop) console.log(`   يُدمَج: ${String(d.r._id).slice(-6)} [${d.r.employmentStatus}] خانات ${d.n} · ${JSON.stringify(d.refs)}`);
  }

  // Same name with two different identity numbers: not decided by a script.
  const fold = (v) => S(v).replace(/[أإآٱ]/g, 'ا').replace(/ة/g, 'ه').replace(/[ىئ]/g, 'ي').replace(/\s+/g, ' ');
  const byName = {};
  for (const e of all) {
    if (/@example\.invalid$/i.test(S(e.email))) continue;
    const n = fold(e.arabicName) || fold(`${e.firstName || ''} ${e.lastName || ''}`);
    if (n.length > 4) (byName[n] = byName[n] || []).push(e);
  }
  const nameOnly = Object.entries(byName).filter(([, v]) => v.length > 1
    && new Set(v.map((e) => S(e.nationalId) || S(e.iqamaNumber))).size > 1);
  if (nameOnly.length) {
    console.log('\n── اسمٌ واحدٌ برقمَي هويّةٍ مختلفين (يُترك لصاحب القرار) ────');
    nameOnly.forEach(([n, v]) => {
      console.log(`  «${n}»`);
      v.forEach((e) => console.log(`     ${S(e.nationalId) || S(e.iqamaNumber)} · ${e.employmentStatus} · ${S(e.department) || '—'} · ${S(e.jobTitle) || '—'}`));
    });
  }

  if (!WRITE) { console.log('\n(تقريرٌ فقط — أضِف --write للتنفيذ)'); process.exit(0); }

  // Execution.
  let moved = 0; let merged = 0; let swept = 0;
  for (const { keep, drop } of plans) {
    for (const d of drop) {
      for (const [coll, field] of REFS) {
        if (!have.has(coll)) continue;
        const r = await db.collection(coll).updateMany({ [field]: d.r._id }, { $set: { [field]: keep.r._id } });
        moved += r.modifiedCount;
      }
      // Whatever the extra record has that the kept one lacks is carried over, so no information is lost.
      const $set = {};
      for (const [k, v] of Object.entries(d.r)) {
        if (['_id', '__v', 'createdAt', 'updatedAt', 'employmentStatus'].includes(k)) continue;
        const cur = keep.r[k];
        const empty = cur === null || cur === undefined || cur === '' || (Array.isArray(cur) && !cur.length);
        const has = v !== null && v !== undefined && v !== '' && !(Array.isArray(v) && !v.length);
        if (empty && has) $set[k] = v;
      }
      if (Object.keys($set).length) await Employee.updateOne({ _id: keep.r._id }, { $set });
      await Employee.deleteOne({ _id: d.r._id });
      merged += 1;
      console.log(`دُمج ${String(d.r._id).slice(-6)} → ${String(keep.r._id).slice(-6)} · خاناتٌ نُقلت: ${Object.keys($set).length}`);
    }
  }
  for (const e of litter) {
    if (litterWithData.some((x) => String(x.e._id) === String(e._id))) continue;
    await Employee.deleteOne({ _id: e._id });
    swept += 1;
  }
  console.log(`\nنُقلت ${moved} إشارة · دُمج ${merged} سجلًّا · كُنس ${swept} سجلَّ اختبار`);
  process.exit(0);
})().catch((e) => { console.error('ERR', e); process.exit(1); });
