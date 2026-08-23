/* eslint-disable no-console */
/**
 * dedupeVehicleClaims — الواقعة الواحدة سجلٌّ واحد.
 *
 *   node src/scripts/dedupeVehicleClaims.js --dry
 *   node src/scripts/dedupeVehicleClaims.js --yes
 *
 * ملفّا المركبات المتتاليان رقّما الحوادث بصيغتين: ACC-001 في الأول و ACC-0001
 * في الثاني. فصارت الواقعة الواحدة سجلَّين، والعدّاد يقول ٤٩ حادثًا وهي ٢٥.
 *
 * المطابقة **برقم الحادث** (رقم نجم) لا بالمعرّف: هو الرقم الرسمي للواقعة،
 * ولا يتغيّر بتغيّر ترقيم الملفات.
 *
 * والقديم يُطوى لا يُحذف: قد يكون أحدهم فتح مطالبةً عليه أو أشار إليه، والمسح
 * يقطع ذلك ولا يمكن استرجاعه. الطيّ يخرجه من العدّادات ويُبقي أثره.
 */
require('dotenv').config();
const mongoose = require('mongoose');

const DRY = !process.argv.includes('--yes');
const S = (v) => String(v ?? '').trim();

(async () => {
  await mongoose.connect(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 20000 });
  const VehicleClaim = require('../models/VehicleClaim');
  const { VehicleMaster } = require('../models/VehicleMaster');

  const all = await VehicleClaim.find({ isActive: true }).lean();
  // الأحدث = الذي صيغته ACC-0000 (أربعة أرقام) — ملف ٢٣ أغسطس.
  const isNew = (c) => /^ACC-\d{4}$/.test(String(c.claimId || ''));

  const byNumber = new Map();
  for (const c of all) {
    const n = String(c.accidentNumber || '').trim();
    if (!n) continue;
    if (!byNumber.has(n)) byNumber.set(n, []);
    byNumber.get(n).push(c);
  }

  const fold = [];
  for (const [num, group] of byNumber) {
    if (group.length < 2) continue;
    const keep = group.find(isNew) || group[0];
    for (const c of group) {
      if (String(c._id) === String(keep._id)) continue;
      fold.push({ num, drop: c, keep });
    }
  }

  console.log(`${all.length} حادثًا فعّالًا · ${fold.length} سجلًّا مكرَّرًا يُطوى${DRY ? '     (تجربة)' : ''}\n`);
  for (const f of fold) {
    console.log(`   ${String(f.num).padEnd(14)} يُطوى ${f.drop.claimId}  ويبقى ${f.keep.claimId}`
      + `   ${f.keep.vehiclePlate || f.keep.incidentSubjectAr || ''}`);
  }

  // ── ما لا رقمَ له ─────────────────────────────────────────────────────────
  // الواقعة بلا رقم نجم (مطالبة بضاعة مثلًا) لا تُطابَق بالرقم. نطابقها بالمبلغ
  // المقدَّر مع التاريخ — وهما معًا نادرا التكرار — ثم **نُدمج** لا نطوي: الملف
  // الجديد فقد الموضوع واسم شركة التأمين، والقديم يحملهما. الطيّ وحده كان
  // سيضيّعهما.
  const noNumber = all.filter((c) => !String(c.accidentNumber || '').trim());
  const merges = [];
  const byAmount = new Map();
  for (const c of noNumber) {
    const k = `${c.claim?.estimatedAmountSar ?? ''}|${c.accidentDate ? new Date(c.accidentDate).toISOString().slice(0, 10) : ''}`;
    if (!byAmount.has(k)) byAmount.set(k, []);
    byAmount.get(k).push(c);
  }
  for (const [k, group] of byAmount) {
    if (group.length < 2 || k === '|') continue;
    const keep = group.find(isNew) || group[0];
    for (const c of group) {
      if (String(c._id) === String(keep._id)) continue;
      // ما يحمله القديم وينقص الجديد ينتقل إليه قبل الطيّ.
      const fill = {};
      if (!S(keep.incidentSubjectAr) && S(c.incidentSubjectAr)) fill.incidentSubjectAr = c.incidentSubjectAr;
      if (!S(keep.claim?.insurerAr) && S(c.claim?.insurerAr)) fill['claim.insurerAr'] = c.claim.insurerAr;
      if (!S(keep.claim?.claimNumber) && S(c.claim?.claimNumber)) fill['claim.claimNumber'] = c.claim.claimNumber;
      if (!S(keep.reportedViaAr) && S(c.reportedViaAr)) fill.reportedViaAr = c.reportedViaAr;
      if (!S(keep.statusAr) && S(c.statusAr)) fill.statusAr = c.statusAr;
      merges.push({ drop: c, keep, fill });
    }
  }
  if (merges.length) {
    console.log(`\nبلا رقم حادث — تُدمج بالمبلغ والتاريخ (${merges.length}):`);
    merges.forEach((mg) => console.log(`   ${mg.drop.claimId} ← يُدمج في ${mg.keep.claimId}`
      + (Object.keys(mg.fill).length ? `   ينقل: ${Object.keys(mg.fill).join('، ')}` : '   لا شيء ينقص')));
  }
  const stillAlone = noNumber.filter((c) => !merges.some((mg) => String(mg.drop._id) === String(c._id)
    || String(mg.keep._id) === String(c._id)));
  if (stillAlone.length) {
    console.log(`\nبلا رقم ولا مطابق (${stillAlone.length}) — تُترك كما هي:`);
    stillAlone.forEach((c) => console.log(`   ${c.claimId}  ${c.vehiclePlate || c.incidentSubjectAr || ''}`));
  }

  if (!DRY && merges.length) {
    for (const mg of merges) {
      if (Object.keys(mg.fill).length) await VehicleClaim.updateOne({ _id: mg.keep._id }, { $set: mg.fill });
      await VehicleClaim.updateOne({ _id: mg.drop._id }, {
        $set: { isActive: false, 'claim.notesAr': [mg.drop.claim?.notesAr, `مطوي: دُمج في ${mg.keep.claimId}`].filter(Boolean).join(' · ') },
      });
    }
  }

  if (!DRY && (fold.length || merges.length)) {
    for (const f of fold) {
      await VehicleClaim.updateOne({ _id: f.drop._id }, {
        $set: {
          isActive: false,
          statusAr: f.drop.statusAr,
          claim: { ...(f.drop.claim || {}), notesAr: [f.drop.claim?.notesAr, `مطوي: نفس الواقعة مسجَّلة في ${f.keep.claimId}`].filter(Boolean).join(' · ') },
        },
      });
    }
    // عدّاد حوادث المركبة يُعاد حسابه بعد الطيّ
    await VehicleMaster.updateMany({}, { $set: { accidentCount: 0 } });
    const keys = [...new Set((await VehicleClaim.find({ isActive: true }).select('vehiclePlateKey').lean())
      .map((c) => c.vehiclePlateKey).filter(Boolean))];
    for (const k of keys) {
      const n = await VehicleClaim.countDocuments({ vehiclePlateKey: k, isActive: true });
      await VehicleMaster.updateMany({ plateKey: k }, { $set: { accidentCount: n } });
    }
    console.log(`\n✓ طُوي ${fold.length + merges.length} · الفعّال الآن ${await VehicleClaim.countDocuments({ isActive: true })}`);
  }
  process.exit(0);
})().catch((e) => { console.error('FATAL', e); process.exit(1); });
