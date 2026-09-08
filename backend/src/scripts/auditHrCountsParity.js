/** يقارن العدَّ في القاعدة بالعدّ في العقدة، حقلًا حقلًا. لا يكتب. */
require('dotenv').config();
const mongoose = require('mongoose');
(async () => {
  await mongoose.connect(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 30000 });
  const Employee = require('../models/Employee');
  const H = require('../config/hrFields');
  const { statusCounts } = require('../utils/hrCounts');

  const filled = (v) => !(v === undefined || v === null || v === '' || (Array.isArray(v) && !v.length));
  const statusOf = (emp, k) => {
    const val = H.valueOf(emp, k);
    const st = emp.fieldStatus?.[H.statusKeyOf(k)];
    if (st === 'required' && filled(val)) return 'filled';
    if (st) return st;
    return filled(val) ? 'filled' : 'none';
  };

  const keys = [...new Set(H.GROUPS.flatMap((g) => g.fields.map((f) => f.key)))];
  const match = {};

  let t = Date.now();
  const emps = await Employee.find(match).lean();
  const nodeMs = Date.now() - t;
  const nodeCounts = {};
  for (const k of keys) nodeCounts[k] = {};
  for (const e of emps) for (const k of keys) {
    const s = statusOf(e, k);
    nodeCounts[k][s] = (nodeCounts[k][s] || 0) + 1;
  }

  t = Date.now();
  const dbCounts = await statusCounts(Employee, match, keys);
  const dbMs = Date.now() - t;

  let bad = 0;
  for (const k of keys) {
    const a = nodeCounts[k]; const b = dbCounts[k];
    const states = new Set([...Object.keys(a), ...Object.keys(b)]);
    for (const s of states) {
      const x = a[s] || 0; const y = b[s] || 0;
      if (x !== y) { bad += 1; console.log(`  ✗ ${k}.${s}: عقدة=${x} قاعدة=${y}`); }
    }
  }
  console.log(`\nحقول: ${keys.length} · موظّفون: ${emps.length}`);
  console.log(`العقدة: ${nodeMs}ms · القاعدة: ${dbMs}ms · أسرعُ بـ${(nodeMs / Math.max(1, dbMs)).toFixed(1)}×`);
  console.log(bad ? `✗ اختلافات: ${bad}` : '✓ مطابقٌ تمامًا في كلّ حقلٍ وكلّ حالة');
  await mongoose.disconnect();
})();
