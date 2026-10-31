/* eslint-disable no-console */
// Brings rows back from `deletedrecords`. Dry run unless --apply; a row whose _id
// exists again is left alone.
//   node src/scripts/restoreDeleted.js --list
//   node src/scripts/restoreDeleted.js --model=CrmCompany [--id=<refId>] [--since=2026-11-01] [--apply]
require('dotenv').config({ path: require('path').join(__dirname, '../../.env') });
const mongoose = require('mongoose');

const argOf = (name) => (process.argv.find((a) => a.startsWith(`--${name}=`)) || '').split('=')[1];

async function main() {
  await mongoose.connect(process.env.MONGODB_URI || process.env.MONGO_URI);
  const { db } = mongoose.connection;
  const store = db.collection('deletedrecords');
  if (process.argv.includes('--list')) {
    console.log(await store.aggregate([{ $group: { _id: '$model', n: { $sum: 1 }, last: { $max: '$deletedAt' } } }, { $sort: { last: -1 } }]).toArray());
    await mongoose.disconnect();
    return;
  }
  const model = argOf('model');
  if (!model) throw new Error('--model is required');
  require('fs').readdirSync(require('path').join(__dirname, '../models')).forEach((f) => require(`../models/${f}`));
  const target = mongoose.models[model].collection;
  const filter = { model };
  if (argOf('id')) filter.refId = new mongoose.Types.ObjectId(argOf('id'));
  if (argOf('since')) filter.deletedAt = { $gte: new Date(argOf('since')) };
  const rows = await store.find(filter).sort({ deletedAt: 1 }).toArray();
  let back = 0;
  for (const r of rows) {
    if (await target.findOne({ _id: r.refId }, { projection: { _id: 1 } })) continue;
    back += 1;
    if (process.argv.includes('--apply')) await target.insertOne(r.data);
  }
  console.log(`${rows.length} found, ${back} ${process.argv.includes('--apply') ? 'restored' : 'would be restored'}`);
  await mongoose.disconnect();
}
main().catch((e) => { console.error(e.message); process.exit(1); });
