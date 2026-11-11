/**
 * Customs payment stages ↔ costs:
 * 1) a paid stage entry with no amount, the only entry of its item, takes the cost typed for that item (legacy rows) so the stage shows its money;
 * 2) every cost line with paid amounts becomes their sum (several payments of one item add up);
 * 3) --move <refNumber> <entryId> <stageKey> re-files one entry under the right item.
 * Dry run by default; --apply writes a JSON backup first.
 */
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const mongoose = require('mongoose');

(async () => {
  const args = process.argv.slice(2);
  const apply = args.includes('--apply');
  const mi = args.indexOf('--move');
  const move = mi >= 0 ? { ref: args[mi + 1], entry: args[mi + 2], key: args[mi + 3] } : null;
  await mongoose.connect(process.env.MONGODB_URI || process.env.MONGO_URI);
  const CC = require('../models/CustomsClearance');
  const { STAGE_COST, applyPaidCosts, recomputeTotals } = CC;
  const docs = await CC.find({ 'paymentStages.0': { $exists: true } }).select('refNumber paymentStages costs revenue').lean();
  const n = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
  const has = (v) => v !== null && v !== undefined && v !== '' && Number.isFinite(Number(v));
  const ops = []; const backup = []; const report = { filled: [], costChanged: [], moved: [] };
  let labelOf = null;
  if (move) {
    const lk = await require('../models/Lookup').findOne({ type: 'customs_payment_stage', key: move.key }).select('nameAr').lean();
    labelOf = lk?.nameAr || move.key;
  }
  for (const d of docs) {
    const before = JSON.stringify({ p: d.paymentStages, c: d.costs });
    const stages = d.paymentStages.map((p) => ({ ...p }));
    if (move && d.refNumber === move.ref) {
      const e = stages.find((p) => String(p._id) === move.entry);
      if (e) { report.moved.push(`${d.refNumber}: ${e.label} «${e.note || ''}» ${e.amount} → ${labelOf}`); e.key = move.key; e.label = labelOf; }
    }
    for (const [key, field] of Object.entries(STAGE_COST)) {
      const rows = stages.filter((p) => p.key === key);
      if (rows.length === 1 && rows[0].payStatus === 'paid' && !has(rows[0].amount) && n(d.costs?.[field]) > 0) {
        rows[0].amount = n(d.costs[field]);
        report.filled.push(`${d.refNumber}: ${rows[0].label} ← ${rows[0].amount}`);
      }
    }
    const doc = { paymentStages: stages, costs: { ...(d.costs || {}) }, revenue: { ...(d.revenue || {}) } };
    const oldCosts = { ...doc.costs };
    applyPaidCosts(doc);
    recomputeTotals(doc);
    for (const k of Object.keys(doc.costs)) if (k !== 'total' && n(oldCosts[k]) !== n(doc.costs[k])) report.costChanged.push(`${d.refNumber}: ${k} ${n(oldCosts[k])} → ${n(doc.costs[k])}`);
    if (JSON.stringify({ p: doc.paymentStages, c: doc.costs }) !== before) {
      backup.push(d);
      ops.push({ updateOne: { filter: { _id: d._id }, update: { $set: { paymentStages: doc.paymentStages, costs: doc.costs, revenue: doc.revenue } } } });
    }
  }
  console.log(`docs ${docs.length} · to change ${ops.length}`);
  console.log(`moved: ${report.moved.join(' | ') || '—'}`);
  console.log(`filled (${report.filled.length}): ${report.filled.slice(0, 15).join(' | ')}${report.filled.length > 15 ? ' …' : ''}`);
  console.log(`cost lines changed (${report.costChanged.length}): ${report.costChanged.slice(0, 25).join(' | ')}${report.costChanged.length > 25 ? ' …' : ''}`);
  if (!apply || !ops.length) { console.log(apply ? 'nothing to do' : 'dry run'); process.exit(0); }
  const dir = fs.existsSync('/opt/energize/backups') ? '/opt/energize/backups' : path.join(process.cwd(), 'backups');
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `customs-stage-costs-${Date.now()}.json`);
  fs.writeFileSync(file, JSON.stringify(backup));
  await CC.bulkWrite(ops, { ordered: false });
  console.log('applied; backup', file);
  process.exit(0);
})().catch((e) => { console.error(e.message); process.exit(1); });
