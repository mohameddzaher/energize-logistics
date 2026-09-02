/**
 * importCollectionTasks — خطّةُ الفريق وما تمّ منها، من ورقة «JP».
 *
 *   node --max-old-space-size=8192 src/scripts/importCollectionTasks.js --dry
 *   node --max-old-space-size=8192 src/scripts/importCollectionTasks.js
 *
 * ── شكلُ الورقة ────────────────────────────────────────────────────────────
 * صفٌّ لكلّ عميل، ثمّ كتلةٌ من خمسة أعمدةٍ لكلّ يوم تتكرّر إلى آخر الورقة:
 *
 *     Plan · Request · Status · Collected · action
 *
 * وتاريخُ اليوم مكتوبٌ فوق أوّل عمودٍ من كتلته في صفٍّ سابق. فالوحدةُ الحقيقيّة
 * (عميلٌ × يوم)، وهي التي تُخزَّن — لا صفُّ العميل العريض. وبذلك يُقرأ العملُ
 * بالموظّف وبالتاريخ وبالعميل، وهي الأسئلةُ الثلاثة التي يُسأل بها.
 *
 * ── ولا يُخزَّن اليومُ الفارغ ──────────────────────────────────────────────
 * أكثرُ الخانات فارغة: عميلٌ لا خطّةَ له في ذلك اليوم. فلا يُكتب صفٌّ إلّا حيث
 * خُطِّط شيءٌ أو تمّ شيء.
 */
require('dotenv').config();
const path = require('path');
const XLSX = require('xlsx');
const mongoose = require('mongoose');

const DRY = process.argv.includes('--dry');
const FILE = path.join(__dirname, '../../..', 'collection files', 'Financial Collections    9-2026.xlsx');
const HEADER_ROW = 6;
const DATE_ROW = 4;
const FIRST_BLOCK = 12;
const BLOCK = 5;                       // Plan · Request · Status · Collected · action

const XLS_EPOCH = Date.UTC(1899, 11, 30);
const S = (v) => (v == null ? '' : String(v).trim());
const N = (v) => { const n = Number(String(v ?? '').replace(/[^\d.\-]/g, '')); return Number.isFinite(n) ? n : 0; };
const isoDay = (v) => (typeof v === 'number' && Number.isFinite(v) && v > 1
  ? new Date(XLS_EPOCH + Math.round(v * 86400000)).toISOString().slice(0, 10) : '');

(async () => {
  await mongoose.connect(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 30000 });
  const CollectionsParty = require('../models/CollectionsParty');
  const CollectionTask = require('../models/CollectionTask');
  const { fold } = CollectionsParty;

  console.log(DRY ? '── تجربة، بلا كتابة ──\n' : '── تنفيذ ──\n');
  const wb = XLSX.readFile(FILE, { cellDates: false, raw: true });
  const all = XLSX.utils.sheet_to_json(wb.Sheets.JP, { header: 1, defval: null, blankrows: false, raw: true });
  const dateRow = all[DATE_ROW] || [];
  const rows = all.slice(HEADER_ROW + 1);

  // أعمدةُ الأيّام: أوّلُ كلّ كتلةٍ يحمل تاريخَها.
  const days = [];
  for (let c = FIRST_BLOCK; c + BLOCK - 1 < (all[HEADER_ROW] || []).length; c += BLOCK) {
    const d = isoDay(dateRow[c]);
    if (d) days.push({ col: c, date: d });
  }
  console.log(`أيّامٌ في الورقة: ${days.length}${days.length ? ` (${days[0].date} … ${days[days.length - 1].date})` : ''}`);

  const parties = await CollectionsParty.find({ kind: 'customer' }).select('code name nameKey aliasKeys').lean();
  const byCode = new Map(parties.filter((p) => p.code).map((p) => [p.code, p]));
  const byName = new Map();
  for (const p of parties) for (const k of [p.nameKey || fold(p.name), ...(p.aliasKeys || [])]) if (k && !byName.has(k)) byName.set(k, p);

  const out = []; const noParty = new Set();
  let scanned = 0;
  for (const r of rows) {
    const code = S(r[0]); const name = S(r[1]);
    if (!code && !name) continue;
    const party = byCode.get(code) || byName.get(fold(name));
    if (!party) { noParty.add(name || code); continue; }
    const officerName = S(r[3]);

    for (const { col, date } of days) {
      const planned = S(r[col]);
      const requestType = S(r[col + 1]);
      const status = S(r[col + 2]);
      const collected = N(r[col + 3]);
      const action = S(r[col + 4]);
      scanned += 1;
      if (!planned && !requestType && !status && !collected && !action) continue;   // يومٌ لا شيءَ فيه
      out.push({
        party: party._id, partyCode: party.code || code, partyName: party.name || name,
        officerName, date,
        planned: !!planned, requestType, status, collected, action,
        source: 'collections_workbook',
      });
    }
  }
  console.log(`  صفوفُ عملاء: ${rows.length} · خاناتٌ فُحصت: ${scanned}`);
  console.log(`  مهامُّ فيها عمل: ${out.length}`);
  if (noParty.size) console.log(`  عملاءُ الورقة بلا حسابٍ عندنا (يُتركون): ${noParty.size} — ${[...noParty].slice(0, 5).join('، ')}`);

  const byOfficer = {}; const byStatus = {}; let collectedSum = 0;
  for (const t of out) {
    byOfficer[t.officerName || '(بلا موظّف)'] = (byOfficer[t.officerName || '(بلا موظّف)'] || 0) + 1;
    byStatus[t.status || '(بلا حالة)'] = (byStatus[t.status || '(بلا حالة)'] || 0) + 1;
    collectedSum += t.collected;
  }
  console.log('  بالموظّف:', Object.entries(byOfficer).map(([k, v]) => `${k}=${v}`).join(' · '));
  console.log('  بالحالة: ', Object.entries(byStatus).map(([k, v]) => `${k}=${v}`).join(' · '));
  console.log(`  مجموعُ ما حُصِّل في المهامّ: ${collectedSum.toFixed(2)}`);

  if (DRY) { console.log('\n— تجربةٌ فقط —\n'); await mongoose.disconnect(); return; }

  const ops = out.map((t) => ({
    updateOne: { filter: { party: t.party, date: t.date, requestType: t.requestType }, update: { $set: t }, upsert: true },
  }));
  let done = 0;
  for (let i = 0; i < ops.length; i += 500) {
    const r = await CollectionTask.bulkWrite(ops.slice(i, i + 500), { ordered: false });
    done += (r.upsertedCount || 0) + (r.modifiedCount || 0);
  }
  console.log(`\n✓ مهامُّ في السجلّ: ${await CollectionTask.countDocuments()}`);
  await mongoose.disconnect();
})().catch((e) => { console.error(e); process.exit(1); });
