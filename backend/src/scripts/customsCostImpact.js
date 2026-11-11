/** Read-only: transaction cost before/after the stage-cost repair (moneyOf old rule vs new), to see what analytics would move. */
require('dotenv').config();
const mongoose = require('mongoose');
(async () => {
  await mongoose.connect(process.env.MONGODB_URI || process.env.MONGO_URI);
  const CC = require('../models/CustomsClearance');
  const { moneyOf } = require('../utils/customsInvoice');
  const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
  const oldCost = (c) => {
    const st = (c.paymentStages || []).filter((p) => p && p.payStatus !== 'rejected' && p.amount !== null && p.amount !== undefined && p.amount !== '' && Number(p.amount) !== 0 && Number.isFinite(Number(p.amount)));
    return st.length ? st.reduce((a, p) => a + Number(p.amount), 0) : num(c.costs?.total);
  };
  const docs = await CC.find({ cancelled: { $ne: true } }).lean();
  let moved = 0; let sumOld = 0; let sumNew = 0; const ex = [];
  for (const c of docs) {
    const o = Math.round(oldCost(c) * 100) / 100; const nw = moneyOf(c).cost;
    sumOld += o; sumNew += nw;
    if (Math.abs(o - nw) > 0.01) { moved += 1; if (ex.length < 12) ex.push(`${c.refNumber}: ${o} → ${nw}`); }
  }
  console.log(`docs ${docs.length} · cost differs ${moved} · total ${Math.round(sumOld)} → ${Math.round(sumNew)}`);
  console.log(ex.join(' | '));
  process.exit(0);
})();
