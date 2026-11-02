/* eslint-disable no-console */
/**
 * cleanHrStatusWords: "not required" and "none" are decisions, not values.
 * Usage: node src/scripts/cleanHrStatusWords.js (dry run) | --apply
 * The import wrote both words into the value field itself (license number, operating card type), so they counted as filled and showed as a number. They belong in the status flag (fieldStatus.<key>Status) that the dashboard and master read (see statusOf): the decision moves to its flag and the value is emptied.
 * The sponsor name is also emptied when it equals the commercial registration number written in its field: a duplicate, not a name.
 */
require('dotenv').config({ quiet: true });
const mongoose = require('mongoose');
const H = require('../config/hrFields');

const APPLY = process.argv.includes('--apply');
const WORDS = { 'غير مطلوب': 'not_required', 'لايوجد': 'none', 'لا يوجد': 'none' };
const FIELDS = ['licenseNumber', 'driverCardType'];

(async () => {
  await mongoose.connect(process.env.MONGODB_URI || process.env.MONGO_URI);
  const E = mongoose.connection.db.collection('employees');
  console.log(APPLY ? '── كتابة ──' : '── عرضٌ فقط ──');
  for (const f of FIELDS) {
    for (const [word, code] of Object.entries(WORDS)) {
      const q = { [f]: word };
      const n = await E.countDocuments(q);
      if (!n) continue;
      console.log(`${f}: «${word}» → عَلَم ${code} · ${n}`);
      if (APPLY) await E.updateMany(q, { $set: { [f]: '', [`fieldStatus.${H.statusKeyOf(f)}`]: code } });
    }
  }
  const dupQ = { sponsorName: { $regex: /^\d{10}$/ }, $expr: { $eq: ['$sponsorName', '$registerNumber'] } };
  const dup = await E.countDocuments(dupQ);
  console.log(`اسم الكفيل = رقم السجلّ نفسُه: ${dup} — يُفرَّغ`);
  if (APPLY && dup) await E.updateMany(dupQ, { $set: { sponsorName: '' } });
  if (APPLY) {
    try { const c = require('../utils/ttlCache'); for (const p of ['hrm:', 'hr:', 'dash:']) await c.clearShared?.(p); } catch (_) { /* */ }
  }
  await mongoose.disconnect();
})().catch((e) => { console.error(e); process.exit(1); });
