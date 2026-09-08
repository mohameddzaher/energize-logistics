require('dotenv').config();
const mongoose = require('mongoose');
(async () => {
  await mongoose.connect(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 30000 });
  const Employee = require('../models/Employee');
  const H = require('../config/hrFields');
  const { docStateCounts } = require('../utils/hrCounts');
  const ALERT = { warnDays: 60, criticalDays: 30 };
  const filled = (v) => !(v === undefined || v === null || v === '' || (Array.isArray(v) && !v.length));
  const statusOf = (e, k) => {
    const val = H.valueOf(e, k); const st = e.fieldStatus?.[H.statusKeyOf(k)];
    if (st === 'required' && filled(val)) return 'filled';
    if (st) return st;
    return filled(val) ? 'filled' : 'none';
  };
  const emps = await Employee.find({}).lean();
  const node = {};
  for (const g of H.GROUPS.filter((x) => x.document && x.expiryField)) {
    const states = { valid: 0, warning: 0, critical: 0, expired: 0, missing: 0, not_applicable: 0 };
    for (const e of emps) {
      const s = H.stateOf(e[g.expiryField], statusOf(e, g.expiryField) === 'filled' ? '' : statusOf(e, g.expiryField), ALERT);
      states[s.state] += 1;
    }
    node[g.key] = states;
  }
  const t = Date.now();
  const db = await docStateCounts(Employee, {}, H.GROUPS, ALERT);
  console.log(`القاعدة: ${Date.now() - t}ms\n`);
  let bad = 0;
  for (const k of Object.keys(node)) {
    for (const st of Object.keys(node[k])) {
      const a = node[k][st]; const b = db[k]?.states[st] ?? -1;
      if (a !== b) { bad += 1; console.log(`  ✗ ${k}.${st}: عقدة=${a} قاعدة=${b}`); }
    }
  }
  console.log(bad ? `✗ اختلافات: ${bad}` : '✓ حالاتُ الانتهاء مطابقةٌ تمامًا');
  await mongoose.disconnect();
})();
