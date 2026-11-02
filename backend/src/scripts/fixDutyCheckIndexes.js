/**
 * Drop the two old duty-check indexes and rebuild them with a partial filter.
 * Mongoose creates a missing index but does not rebuild an existing one with different options, so rep_1_dateKey_1 stayed unique and non-sparse. Light-transport register rows do not set rep, so every check that day collided on {null, day} and the server rejected checks for reps who had not been checked. The partial filter keeps the rule and does not apply it to absence.
 * Usage: node src/scripts/fixDutyCheckIndexes.js [--apply]
 */
require('dotenv').config();
const mongoose = require('mongoose');
const path = require('path');

const B2CDutyCheck = require(path.join(__dirname, '..', 'models', 'B2CDutyCheck'));
const APPLY = process.argv.includes('--apply');

const WANTED = [
  { name: 'ltEmployee_1_dateKey_1_partial', key: { ltEmployee: 1, dateKey: 1 }, field: 'ltEmployee' },
  { name: 'rep_1_dateKey_1_partial', key: { rep: 1, dateKey: 1 }, field: 'rep' },
];
const STALE = ['rep_1_dateKey_1', 'ltEmployee_1_dateKey_1'];

(async () => {
  await mongoose.connect(process.env.MONGODB_URI);
  const col = B2CDutyCheck.collection;
  const before = await col.indexes();
  console.log('قبل:');
  before.filter((i) => /rep|ltEmployee/.test(i.name))
    .forEach((i) => console.log(`  ${i.name.padEnd(34)} unique=${!!i.unique} sparse=${!!i.sparse} partial=${i.partialFilterExpression ? JSON.stringify(i.partialFilterExpression) : '—'}`));

  if (!APPLY) { console.log('\n(عرضٌ فقط — أضِف --apply)'); await mongoose.disconnect(); return; }

  for (const name of STALE) {
    if (!before.some((i) => i.name === name)) continue;
    await col.dropIndex(name);
    console.log(`  أُسقط ${name}`);
  }
  for (const w of WANTED) {
    if (before.some((i) => i.name === w.name)) continue;
    await col.createIndex(w.key, {
      unique: true, name: w.name,
      partialFilterExpression: { [w.field]: { $type: 'objectId' } },
    });
    console.log(`  بُني ${w.name}`);
  }

  const after = await col.indexes();
  console.log('\nبعد:');
  after.filter((i) => /rep|ltEmployee/.test(i.name))
    .forEach((i) => console.log(`  ${i.name.padEnd(34)} unique=${!!i.unique} sparse=${!!i.sparse} partial=${i.partialFilterExpression ? JSON.stringify(i.partialFilterExpression) : '—'}`));
  await mongoose.disconnect();
})().catch((e) => { console.error('ERR', e.message); process.exit(1); });
