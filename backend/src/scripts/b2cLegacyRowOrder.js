/**
 * b2cLegacyRowOrder: each account's position in the old sheets per month before October 2026, so old months render in the new project sheet in their original order.
 * Reads the old sheets themselves (B2CGoogleSheetSync; settings remain although sync is stopped) and writes only B2CLegacyRow: no order or account is touched. Safe to rerun.
 * A row is matched to an account that has orders in the same project and month: by app account number and name together, then number alone if unique, then name alone if unique, since one account could be worked by several reps and one number can repeat across apps. A project with two sheets (Keeta) orders the first then the second.
 * Usage: node src/scripts/b2cLegacyRowOrder.js (dry run) | --apply (write)
 */
require('dotenv').config({ path: require('path').join(__dirname, '../../.env'), quiet: true });
const mongoose = require('mongoose');
const { parseRepsExcel } = require('../utils/b2cExcelParser');

const APPLY = process.argv.includes('--apply');
const SYNC_FROM = '2026-10';
const S = (v) => String(v ?? '').trim();
const acc = (v) => S(v).replace(/^\*/, '');
const fold = (v) => S(v).toLowerCase().replace(/[أإآٱ]/g, 'ا').replace(/ة/g, 'ه').replace(/[ىئ]/g, 'ي').replace(/ؤ/g, 'و').replace(/[\s-]+/g, ' ');

(async () => {
  await mongoose.connect(process.env.MONGODB_URI);
  const db = mongoose.connection.db;
  const { B2CLegacyRow } = require('../models/B2COrderSheet');
  const reps = new Map((await db.collection('b2creps').find({}).project({ repId: 1, englishName: 1, arabicName: 1 }).toArray())
    .map((r) => [String(r._id), r]));
  const configs = await db.collection('b2cgooglesheetsyncs').find({}).sort({ createdAt: 1 }).toArray();
  const sheetNo = new Map();
  const ops = [];
  let matched = 0; const missed = [];

  for (const cfg of configs) {
    const pkey = String(cfg.project);
    const nth = sheetNo.get(pkey) || 0; sheetNo.set(pkey, nth + 1);
    const r = await fetch(`https://docs.google.com/spreadsheets/d/${cfg.sheetId}/export?format=xlsx`);
    if (!r.ok) { console.log('download failed', cfg.sheetId, r.status); continue; }
    const { records } = parseRepsExcel(Buffer.from(await r.arrayBuffer()));
    const idx = new Map();
    const inMonth = new Map(); // month → reps with orders in this project
    for (const rec of records) {
      const mo = `${rec.year}-${String(rec.monthIndex).padStart(2, '0')}`;
      if (mo >= SYNC_FROM) continue;
      const i = (idx.get(mo) || 0) + 1; idx.set(mo, i);
      if (!inMonth.has(mo)) {
        inMonth.set(mo, (await db.collection('b2cdailyorders').distinct('rep', { project: cfg.project, dateKey: { $regex: `^${mo}` }, orders: { $ne: null } }))
          .map(String).filter((id) => reps.has(id)));
      }
      const pool = inMonth.get(mo).map((id) => reps.get(id));
      const id = acc(rec.repIdNumber); const nm = fold(rec.englishName);
      const named = (x) => fold(x.englishName) === nm || fold(x.arabicName) === nm;
      let cand = id ? pool.filter((x) => acc(x.repId) === id && named(x)) : [];
      if (cand.length !== 1 && id) { const byId = pool.filter((x) => acc(x.repId) === id); if (byId.length === 1) cand = byId; }
      if (cand.length !== 1 && nm) { const byName = pool.filter(named); if (byName.length === 1) cand = byName; }
      if (cand.length !== 1) {
        if (Object.values(rec.dailyOrders || {}).some((v) => Number(v))) missed.push(`${mo} ${rec.englishName} [${id}]`);
        continue;
      }
      matched += 1;
      ops.push({ updateOne: {
        filter: { project: cfg.project, month: mo, rep: cand[0]._id },
        update: { $set: { pos: nth * 10000 + i } },
        upsert: true,
      } });
    }
  }
  console.log({ matched, missedWithOrders: missed.length, apply: APPLY });
  if (missed.length) console.log(missed.slice(0, 30).join('\n'));
  if (APPLY && ops.length) {
    const res = await B2CLegacyRow.bulkWrite(ops, { ordered: false });
    console.log('written', res.upsertedCount + res.modifiedCount);
    await require('../utils/ttlCache').clearShared('b2c:').catch(() => {});
  }
  await mongoose.disconnect();
})().catch((e) => { console.error(e); process.exit(1); });
