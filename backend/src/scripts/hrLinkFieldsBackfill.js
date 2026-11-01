/* eslint-disable no-console */
// Brings paired employee fields into line: work status text from the status, and the
// direct manager's stored name from the chosen account. A name typed with no account
// is linked when it matches exactly one person. The old values are saved first.
// Dry run unless --apply.
//   node src/scripts/hrLinkFieldsBackfill.js [--apply] [--backup-dir=/opt/energize/archive]
require('dotenv').config({ path: require('path').join(__dirname, '../../.env') });
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const mongoose = require('mongoose');
const Employee = require('../models/Employee');
const User = require('../models/User');
const { fold } = require('../models/CollectionsParty');
const { workStatusTextOf } = require('../utils/hrEngagement');

const { EJSON } = mongoose.mongo.BSON;
const argOf = (name, dflt) => (process.argv.find((a) => a.startsWith(`--${name}=`)) || '').split('=')[1] || dflt;
const fileName = (e) => String(e.arabicName || '').trim() || `${e.firstName || ''} ${e.lastName || ''}`.trim();
const key = (s) => fold(String(s || '').toLowerCase());

async function main() {
  const apply = process.argv.includes('--apply');
  await mongoose.connect(process.env.MONGODB_URI || process.env.MONGO_URI);
  const emps = await Employee.find({ isHrRecord: { $ne: false } }).select('arabicName firstName lastName user workStatusText employmentStatus terminationKind sisterCompany leaveViolation leaveStatusSource directManager directManagerName').lean();
  const users = await User.find({}).select('firstName lastName linkedEmployee').lean();
  const empById = new Map(emps.map((e) => [String(e._id), e]));
  const empOfUser = new Map();
  emps.forEach((e) => { if (e.user) empOfUser.set(String(e.user), e); });
  users.forEach((u) => { if (u.linkedEmployee && empById.has(String(u.linkedEmployee))) empOfUser.set(String(u._id), empById.get(String(u.linkedEmployee))); });
  const nameOfUser = (u) => { const e = empOfUser.get(String(u._id)); return (e && fileName(e)) || `${u.firstName || ''} ${u.lastName || ''}`.trim(); };
  const userById = new Map(users.map((u) => [String(u._id), u]));
  const byName = new Map();
  const add = (k, id) => { if (!k) return; if (!byName.has(k)) byName.set(k, new Set()); byName.get(k).add(String(id)); };
  users.forEach((u) => { add(key(`${u.firstName} ${u.lastName}`), u._id); add(key(nameOfUser(u)), u._id); });

  const ops = []; const saved = []; let statusFixed = 0; let nameFixed = 0; let linked = 0; const unmatched = [];
  for (const e of emps) {
    const set = {};
    const want = workStatusTextOf(e);
    if ((e.workStatusText ?? '') !== want) { set.workStatusText = want; statusFixed += 1; }
    if (e.directManager) {
      const u = userById.get(String(e.directManager));
      const name = u ? nameOfUser(u) : '';
      if (name && name !== e.directManagerName) { set.directManagerName = name; nameFixed += 1; }
    } else if (String(e.directManagerName || '').trim()) {
      const hits = byName.get(key(e.directManagerName));
      if (hits?.size === 1) {
        const [id] = hits;
        set.directManager = new mongoose.Types.ObjectId(id);
        set.directManagerName = nameOfUser(userById.get(id));
        linked += 1;
      } else unmatched.push(e.directManagerName);
    }
    if (Object.keys(set).length) {
      saved.push({ _id: e._id, before: Object.fromEntries(Object.keys(set).map((k) => [k, e[k] ?? null])) });
      ops.push({ updateOne: { filter: { _id: e._id }, update: { $set: set } } });
    }
  }
  console.log({ employees: emps.length, statusFixed, nameFixed, linked, unmatched: unmatched.length });
  console.log('unmatched names', [...new Set(unmatched)]);
  if (!apply) { console.log('dry run: nothing written'); await mongoose.disconnect(); return; }
  const file = path.join(argOf('backup-dir', '/opt/energize/archive'), `hr-link-fields-${new Date().toISOString().replace(/[:.]/g, '-')}.json.gz`);
  fs.writeFileSync(file, zlib.gzipSync(EJSON.stringify(saved)), { mode: 0o600 });
  console.log(`backup ${file}`);
  if (ops.length) await Employee.collection.bulkWrite(ops, { ordered: false });
  console.log(`updated ${ops.length}`);
  await mongoose.disconnect();
}
main().catch((e) => { console.error(e.message); process.exit(1); });
