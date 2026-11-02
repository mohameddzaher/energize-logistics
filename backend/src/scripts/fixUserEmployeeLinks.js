/* eslint-disable no-console */
/**
 * fixUserEmployeeLinks: a login account and an employee file each point to the other.
 * Without --apply it only reports; --apply writes.
 * Completes one-sided links (User.linkedEmployee without Employee.user) and clears Employee.user pointing at an account that no longer exists. It never creates a new link by guessing; anything unlinked on both sides stays as is.
 */
require('dotenv').config({ quiet: true });
const mongoose = require('mongoose');

const APPLY = process.argv.includes('--apply');

(async () => {
  await mongoose.connect(process.env.MONGODB_URI || process.env.MONGO_URI);
  const db = mongoose.connection.db;
  const U = db.collection('users'); const E = db.collection('employees');
  const users = await U.find({}).project({ email: 1, linkedEmployee: 1 }).toArray();
  const userIds = new Set(users.map((u) => String(u._id)));
  console.log(APPLY ? '── كتابة ──' : '── عرضٌ فقط ──');

  let oneWay = 0;
  for (const u of users) {
    if (!u.linkedEmployee) continue;
    const e = await E.findOne({ _id: u.linkedEmployee }, { projection: { user: 1, firstName: 1, lastName: 1, arabicName: 1 } });
    if (!e) { console.log(`  ⚠︎ ${u.email} → موظّفٌ غير موجود ${u.linkedEmployee}`); continue; }
    if (String(e.user || '') === String(u._id)) continue;
    const taken = e.user && userIds.has(String(e.user));
    console.log(`  ${taken ? '⚠︎ مأخوذ' : '↔'} ${u.email} ↔ ${e.arabicName || `${e.firstName} ${e.lastName}`} (${e._id})${taken ? ` — يشير إلى حسابٍ آخر ${e.user}` : ''}`);
    if (!taken) { oneWay += 1; if (APPLY) await E.updateOne({ _id: e._id }, { $set: { user: u._id } }); }
  }

  const dangling = await E.find({ user: { $ne: null } }).project({ user: 1, firstName: 1, lastName: 1, arabicName: 1 }).toArray();
  let cleared = 0;
  for (const e of dangling) {
    if (userIds.has(String(e.user))) continue;
    cleared += 1;
    console.log(`  ∅ ${e.arabicName || `${e.firstName} ${e.lastName}`} (${e._id}) → حسابٌ محذوف ${e.user}`);
    if (APPLY) await E.updateOne({ _id: e._id }, { $unset: { user: '' } });
  }
  console.log(`ربطٌ يُكمَّل: ${oneWay} · مؤشّراتٌ إلى حساباتٍ محذوفة تُفرَّغ: ${cleared}`);
  await mongoose.disconnect();
})().catch((e) => { console.error(e); process.exit(1); });
