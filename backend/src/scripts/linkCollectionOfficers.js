/* eslint-disable no-console */
/**
 * Links each collection officer to a user account instead of a free-text name.
 * Usage: node src/scripts/linkCollectionOfficers.js [--apply]
 * CollectionsParty.collectionOfficer was text that matched no account; it is linked via collectionOfficerUser while the text stays for display. One name maps to the customs clearance manager. CollectionTask.officer gets the same treatment.
 */
require('dotenv').config({ quiet: true });
const mongoose = require('mongoose');

const APPLY = process.argv.includes('--apply');
const MAP = [
  { from: 'Hossam', text: 'Hossam', email: 'hossam.elhoufy@energize.com' },
  { from: 'Yasser', text: 'Yasser', email: 'yasser.helal@energize.com' },
  { from: 'Orabi', text: 'Orabi', email: 'ahmed.orabi@energize.com' },
  { from: 'Haitham', text: 'التخليص الجمركي', email: 'haitham.i@energize.com' },
];

(async () => {
  await mongoose.connect(process.env.MONGODB_URI || process.env.MONGO_URI);
  const db = mongoose.connection.db;
  const P = db.collection('collectionsparties');
  const T = db.collection('collectiontasks');
  console.log(APPLY ? '── كتابة ──' : '── عرضٌ فقط ──');
  for (const m of MAP) {
    const u = await db.collection('users').findOne({ email: m.email, isActive: { $ne: false } }, { projection: { _id: 1, firstName: 1, lastName: 1 } });
    if (!u) { console.log(`✗ ${m.from}: لا حساب ${m.email}`); continue; }
    const q = { collectionOfficer: { $in: [m.from, m.text] } };
    const need = await P.countDocuments({ ...q, $or: [{ collectionOfficer: { $ne: m.text } }, { collectionOfficerUser: { $ne: u._id } }] });
    const tasks = await T.countDocuments({ officerName: m.from, officer: { $ne: u._id } });
    console.log(`${m.from} → «${m.text}» · ${u.firstName} ${u.lastName} (${m.email}) · حساباتٌ تُكتب ${need} · مهامّ ${tasks}`);
    if (APPLY) {
      await P.updateMany(q, { $set: { collectionOfficer: m.text, collectionOfficerUser: u._id } });
      await T.updateMany({ officerName: m.from }, { $set: { officer: u._id } });
    }
  }
  if (APPLY) {
    try { await require('../utils/ttlCache').clearShared?.('cdr:'); await require('../utils/ttlCache').clearShared?.('colledger:'); } catch (_) { /* */ }
  }
  await mongoose.disconnect();
})().catch((e) => { console.error(e); process.exit(1); });
