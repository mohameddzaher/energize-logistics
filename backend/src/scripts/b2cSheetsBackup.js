/**
 * b2cSheetsBackup — نسخةٌ احتياطيّةٌ من شيتات أوردرات B2C قبل إلغاء ربطها (٢٠٢٦/١٠/١٩).
 *
 *   node src/scripts/b2cSheetsBackup.js <dir>              ← نسخةٌ فقط
 *   node src/scripts/b2cSheetsBackup.js <dir> --disable    ← نسخةٌ ثمّ إيقافُ المزامنة
 *
 * في <dir>:
 *   · كلُّ شيتِ جوجل مربوطٍ ملفَّ xlsx كما هو الآن (المشروع_الفرع_المعرّف.xlsx)؛
 *   · وصورةٌ كاملةٌ (EJSON) من: b2cdailyorders · b2creps · b2cprojects ·
 *     b2cgooglesheetsyncs · b2cexceluploads — فما كان قبل الإلغاء يُستعاد كما كان.
 * و--disable يوقف المزامنة في إعداداتها (`enabled: false`) ولا يحذفها: الروابطُ
 * تبقى سجلًّا لما كان.
 */
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const mongoose = require('mongoose');
const { EJSON } = require('bson');

const dir = process.argv[2];
const DISABLE = process.argv.includes('--disable');
if (!dir) { console.error('usage: b2cSheetsBackup.js <dir> [--disable]'); process.exit(1); }

(async () => {
  await mongoose.connect(process.env.MONGODB_URI || process.env.MONGO_URI);
  const db = mongoose.connection.db;
  fs.mkdirSync(dir, { recursive: true });
  const projects = new Map((await db.collection('b2cprojects').find({}).toArray()).map((p) => [String(p._id), p.name]));
  const branches = new Map((await db.collection('branches').find({}).project({ name: 1 }).toArray()).map((b) => [String(b._id), b.name]));
  const configs = await db.collection('b2cgooglesheetsyncs').find({}).toArray();
  let ok = 0;
  for (const c of configs) {
    const name = `${projects.get(String(c.project)) || 'project'}_${branches.get(String(c.branch)) || 'branch'}_${c.sheetId}.xlsx`.replace(/[^\w.\-؀-ۿ]+/g, '_');
    try {
      const url = `https://docs.google.com/spreadsheets/d/${c.sheetId}/export?format=xlsx&nocache=${Date.now()}`;
      const r = await fetch(url, { redirect: 'follow' }); // eslint-disable-line no-await-in-loop
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const buf = Buffer.from(await r.arrayBuffer()); // eslint-disable-line no-await-in-loop
      fs.writeFileSync(path.join(dir, name), buf);
      console.log(`  ✓ ${name}  ${(buf.length / 1024).toFixed(0)} KB  (${c.sheetUrl})`);
      ok += 1;
    } catch (e) { console.log(`  ✗ ${name}: ${e.message}`); }
  }
  for (const col of ['b2cdailyorders', 'b2creps', 'b2cprojects', 'b2cgooglesheetsyncs', 'b2cexceluploads']) {
    const rows = await db.collection(col).find({}).toArray(); // eslint-disable-line no-await-in-loop
    fs.writeFileSync(path.join(dir, `${col}.ejson`), EJSON.stringify(rows, { relaxed: false }));
    console.log(`  ✓ ${col}: ${rows.length}`);
  }
  console.log(`\nالشيتات: ${ok}/${configs.length} · المجلّد: ${dir}`);
  if (DISABLE) {
    if (ok !== configs.length) { console.log('✗ لم تُنسخ كلُّ الشيتات — المزامنةُ لم تُوقَف'); process.exit(2); }
    const r = await db.collection('b2cgooglesheetsyncs').updateMany({}, { $set: { enabled: false, lastSyncMessage: 'أُوقفت: الأوردراتُ تُكتب على النظام (٢٠٢٦/١٠/١٩)' } });
    console.log(`أُوقفت المزامنة: ${r.modifiedCount}`);
  }
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
