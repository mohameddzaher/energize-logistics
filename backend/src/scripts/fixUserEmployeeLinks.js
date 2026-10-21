/* eslint-disable no-console */
/**
 * fixUserEmployeeLinks — حسابُ الدخول وملفُّ الموظّف يشير كلٌّ منهما إلى الآخر.
 *
 *   node src/scripts/fixUserEmployeeLinks.js           (عرضٌ فقط)
 *   node src/scripts/fixUserEmployeeLinks.js --apply   (يكتب)
 *
 * يُكمل الربطَ الذي من جهةٍ واحدة (`User.linkedEmployee` بلا `Employee.user`)،
 * ويُفرغ `Employee.user` الذي يشير إلى حسابٍ لم يعد موجودًا. لا يُنشئ ربطًا جديدًا
 * بالتخمين — ما ليس مربوطًا من أيّ جهةٍ يبقى كما هو.
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
