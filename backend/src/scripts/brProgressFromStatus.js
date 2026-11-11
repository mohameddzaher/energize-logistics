/** Business review: set every task's and delegation's progress from its status (config/businessReview PROGRESS_OF). Dry run by default; --apply writes a backup first. */
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const mongoose = require('mongoose');
(async () => {
  const apply = process.argv.includes('--apply');
  await mongoose.connect(process.env.MONGODB_URI || process.env.MONGO_URI);
  const { BrAction, BrAssignment } = require('../models/BusinessReview');
  const { PROGRESS_OF } = require('../config/businessReview');
  const out = {}; const backup = {};
  for (const [name, M] of [['actions', BrAction], ['assignments', BrAssignment]]) {
    const rows = await M.find({}).select('status progress').lean();
    const off = rows.filter((r) => PROGRESS_OF[r.status] !== undefined && Number(r.progress || 0) !== PROGRESS_OF[r.status]);
    out[name] = { total: rows.length, change: off.length };
    backup[name] = off;
    if (apply) for (const r of off) await M.updateOne({ _id: r._id }, { $set: { progress: PROGRESS_OF[r.status] } });
  }
  console.log(JSON.stringify(out));
  if (apply) {
    const dir = fs.existsSync('/opt/energize/backups') ? '/opt/energize/backups' : path.join(process.cwd(), 'backups');
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, `br-progress-${Date.now()}.json`);
    fs.writeFileSync(file, JSON.stringify(backup));
    try { require('../websocket/socketManager').emitToAll('br:action', {}); } catch (_) { /* */ }
    console.log('applied; backup', file);
  } else console.log('dry run');
  process.exit(0);
})().catch((e) => { console.error(e.message); process.exit(1); });
