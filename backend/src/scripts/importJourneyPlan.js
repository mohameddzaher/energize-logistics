/**
 * importJourneyPlan — يُدخل خطّةَ الزيارات (ورقة JP) وتاريخَها.
 *
 *   node src/scripts/importJourneyPlan.js --dry
 *   node src/scripts/importJourneyPlan.js --apply
 *   node src/scripts/importJourneyPlan.js --apply --file "اسم الملفّ.xlsx"
 *
 * ── لماذا مفردًا ────────────────────────────────────────────────────────────
 * استيرادُ الدفتر الكاملُ يمسح الفواتيرَ والأطرافَ ويُعيد بناءها، وهو عملٌ ثقيلٌ
 * لا يُعاد لأجل ورقةٍ واحدة. وهذا يكتب `CollectionTask` وحدَها، فيصلح لسدّ ما
 * فات ولإدخال شهرٍ جديدٍ بعد تحديث الملفّ.
 *
 * ولا يمسح شيئًا: المفتاحُ (عميل × يوم × نوعُ الطلب) — فالتشغيلُ مرّتين لا
 * يُضاعف، وما كُتب في النظام بيدٍ لا يُمحى بتشغيلٍ جديدٍ إلّا إن كان في الورقة
 * ما يقابله.
 */
require('dotenv').config();
const path = require('path');
const fs = require('fs');
const XLSX = require('xlsx');
const mongoose = require('mongoose');
const { parseJourneyPlan } = require('../utils/journeyPlan');

const APPLY = process.argv.includes('--apply');
const fileArg = process.argv.indexOf('--file');
const BOOK = fileArg > -1 ? process.argv[fileArg + 1] : 'Updated Financial Collections    9-2026.xlsx';
const FILE = path.join(__dirname, '..', '..', '..', 'collection files', BOOK);
const M = (x) => x.toLocaleString('en-US', { maximumFractionDigits: 2 });

(async () => {
  if (!fs.existsSync(FILE)) { console.error(`لا ملفَّ باسم «${BOOK}» في مجلّد collection files`); process.exit(1); }
  await mongoose.connect(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 60000 });
  const CollectionsParty = require('../models/CollectionsParty');
  const CollectionTask = require('../models/CollectionTask');
  const { fold } = CollectionsParty;

  const wb = XLSX.readFile(FILE, { cellDates: false, raw: true });
  if (!wb.Sheets.JP) { console.error('لا ورقةَ JP في هذا الملفّ'); process.exit(1); }
  const rows = XLSX.utils.sheet_to_json(wb.Sheets.JP, { header: 1, defval: null, raw: true });
  const { tasks, days, rows: nRows, skipped } = parseJourneyPlan(rows);

  console.log(`\n  الملفّ: ${BOOK}${APPLY ? '' : '   — تجربة، بلا كتابة —'}`);
  console.log(`  أعمدةُ أيّام في الورقة: ${days.length}   (${days[0]} → ${days[days.length - 1]})`);
  console.log(`  صفوفُ عملاء: ${nRows}${skipped ? ` · صفوفٌ تُخُطِّيت: ${skipped}` : ''}`);
  console.log(`  مهامُّ فيها شيء: ${tasks.length}   في ${new Set(tasks.map((t) => t.date)).size} يومًا`);

  // ── ورقةُ الخطّة تسمّي العميلَ بكوده، والكودُ يُطابَق كما يُطابَق في الدفتر ──
  const parties = await CollectionsParty.find({ kind: 'customer' }).select('code name nameKey aliasKeys').lean();
  const byCode = new Map(parties.filter((p) => p.code).map((p) => [String(p.code).trim(), p]));
  const byName = new Map();
  for (const p of parties) for (const k of [p.nameKey || fold(p.name || ''), ...(p.aliasKeys || [])]) if (k && !byName.has(k)) byName.set(k, p);

  let linked = 0; const unlinked = new Map();
  for (const t of tasks) {
    const p = byCode.get(t.partyCode) || (t.partyName ? byName.get(fold(t.partyName)) : null);
    if (p) { t.party = p._id; linked += 1; }
    else {
      const k = `${t.partyCode} · ${t.partyName || '(بلا اسم)'}`;
      unlinked.set(k, (unlinked.get(k) || 0) + 1);
    }
  }
  console.log(`  مربوطةٌ بعميلٍ في النظام: ${linked} / ${tasks.length}`);
  if (unlinked.size) {
    console.log('  ⚠ مهامُّ لم يُعرَف عميلُها:');
    for (const [k, n] of unlinked) console.log(`       ${k}  (${n})`);
  }

  const byOff = {}; let sum = 0;
  for (const t of tasks) { byOff[t.officerName || '(بلا مسؤول)'] = (byOff[t.officerName || '(بلا مسؤول)'] || 0) + 1; sum += t.collected || 0; }
  console.log(`  بالموظّف: ${Object.entries(byOff).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${v}`).join(' · ')}`);
  console.log(`  مجموعُ ما حُصِّل في الزيارات: ${M(sum)}`);

  if (!APPLY) { console.log('\n  لم يُكتب شيء. أضف --apply للتنفيذ.\n'); await mongoose.disconnect(); return; }

  // المفتاحُ هو (عميل × يوم × نوعُ الطلب) كما في فهرس النموذج — فلا تكرار.
  const ops = tasks.map((t) => ({
    updateOne: {
      filter: { party: t.party || null, date: t.date, requestType: t.requestType },
      update: { $set: { ...t, source: 'collections_workbook' } },
      upsert: true,
    },
  }));
  let created = 0; let updated = 0;
  for (let i = 0; i < ops.length; i += 500) {
    const r = await CollectionTask.bulkWrite(ops.slice(i, i + 500), { ordered: false });
    created += r.upsertedCount || 0; updated += r.modifiedCount || 0;
  }
  const total = await CollectionTask.countDocuments({});
  console.log(`\n  ✔ أُنشئت ${created} · حُدِّثت ${updated}   — المجموع في القاعدة ${total}`);

  // ── التحقّق: ما في الورقة هو ما في القاعدة ────────────────────────────────
  const dbSum = (await CollectionTask.aggregate([{ $group: { _id: null, t: { $sum: '$collected' } } }]))[0]?.t || 0;
  const dbDays = (await CollectionTask.distinct('date')).length;
  const okN = total >= tasks.length;
  console.log(`  ${okN ? '✔' : '✘'} عددُ المهامّ        الورقة ${tasks.length}   القاعدة ${total}`);
  console.log(`  ${Math.abs(dbSum - sum) < 0.01 ? '✔' : '✘'} مجموعُ المحصَّل     الورقة ${M(sum)}   القاعدة ${M(dbSum)}`);
  console.log(`  ${dbDays === new Set(tasks.map((t) => t.date)).size ? '✔' : '⚠'} أيّامٌ فيها عمل     الورقة ${new Set(tasks.map((t) => t.date)).size}   القاعدة ${dbDays}\n`);
  await mongoose.disconnect();
})().catch((e) => { console.error(e); process.exit(1); });
