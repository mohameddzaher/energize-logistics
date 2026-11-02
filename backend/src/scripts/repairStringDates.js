/* eslint-disable no-console */
/**
 * Repairs dates saved as `Date.toString()` in text fields. Usage: node src/scripts/repairStringDates.js [--dry] Most employee-file date fields are plain text ('YYYY-MM-DD') because
 * they sometimes hold an administrative word instead of a date. Editing from the screen wrote a Date object, which Mongoose converted with `toString()` into 'Wed Jun 30 2027 03:00:00
 * GMT+0300'. The fault is silent: the screen parses it fine, but text ordering breaks, import matching fails and export emits the raw line. Why not just `new Date()`: the text carries
 * a timezone (+3) and `toISOString()` converts to GMT, moving anything before 03:00 back a day. The day is read from the local date components as written.
 */
require('dotenv').config();
const mongoose = require('mongoose');

const DRY = process.argv.includes('--dry');
const pad = (n) => String(n).padStart(2, '0');
/** 'Wed Jun 30 2027 03:00:00 GMT+0300' to '2027-06-30' using the local calendar. */
const toYmd = (raw) => {
  const d = new Date(raw);
  if (isNaN(d.getTime())) return null;
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};

(async () => {
  await mongoose.connect(process.env.MONGODB_URI);
  const Employee = require('../models/Employee');
  const H = require('../config/hrFields');

  // Text fields only: a field declared as `Date` stores a valid object and is out of scope.
  const keys = H.ALL_FIELDS
    .filter((f) => f.type === 'date')
    .map((f) => f.key)
    .filter((k) => Employee.schema.path(k)?.instance === 'String');

  console.log(`حقول تاريخٍ نصّيّة: ${keys.length}`);
  let total = 0; let fixed = 0; const unreadable = [];

  for (const k of keys) {
    // Marker: the `toString()` format starts with a three-letter weekday and contains GMT.
    const rows = await Employee.find({ [k]: { $regex: 'GMT' } })
      .select(`iqamaNumber arabicName ${k}`).lean();
    if (!rows.length) continue;
    total += rows.length;
    console.log(`\n${k}: ${rows.length}`);
    for (const r of rows.slice(0, 3)) console.log(`   ${String(r[k]).slice(0, 40)}…  →  ${toYmd(r[k]) || '؟'}`);
    if (rows.length > 3) console.log(`   … و${rows.length - 3} غيرها`);

    if (DRY) continue;
    for (const r of rows) {
      const ymd = toYmd(r[k]);
      // Unparseable values are left and reported, not guessed: an invented value is worse than an obviously broken one.
      if (!ymd) { unreadable.push(`${r.iqamaNumber} · ${k} · ${r[k]}`); continue; }
      await Employee.updateOne({ _id: r._id }, { $set: { [k]: ymd } });
      fixed += 1;
    }
  }

  console.log(`\nالإجمالي: ${total}`);
  if (DRY) { console.log('معاينة — لم يُكتب شيء.'); process.exit(0); }
  console.log(`أُصلح: ${fixed}`);
  if (unreadable.length) {
    console.log(`تعذّرت قراءته (${unreadable.length}) — تُرك كما هو:`);
    unreadable.slice(0, 10).forEach((u) => console.log(`   ${u}`));
  }
  process.exit(0);
})();
