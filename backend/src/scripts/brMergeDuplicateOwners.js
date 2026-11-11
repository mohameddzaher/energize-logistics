/**
 * One owner holding the same shared task twice (an older reassign could point a copy at someone already sharing it):
 * keeps that owner's earliest copy, moves the other copies' delegations, follow-ups and updates onto it, deletes the rest.
 * Dry run by default; --apply writes a JSON backup first.
 */
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const mongoose = require('mongoose');

(async () => {
  const apply = process.argv.includes('--apply');
  await mongoose.connect(process.env.MONGODB_URI || process.env.MONGO_URI);
  const { BrAction, BrAssignment } = require('../models/BusinessReview');
  const rows = await BrAction.find({ shareGroup: { $ne: null } }).sort({ createdAt: 1 }).lean();
  const by = new Map();
  for (const r of rows) { const k = `${r.shareGroup}|${r.assignee}`; if (!by.has(k)) by.set(k, []); by.get(k).push(r); }
  const plan = [...by.values()].filter((l) => l.length > 1);
  for (const l of plan) console.log(`${l[0].assigneeName} × ${l.length} | ${l[0].title.slice(0, 60)} | keep ${l[0]._id} (${l[0].status} ${l[0].progress || 0}%) drop ${l.slice(1).map((x) => `${x._id} (${x.status} ${x.progress || 0}%)`).join(', ')}`);
  if (!plan.length || !apply) { console.log(apply ? 'nothing to do' : `dry run: ${plan.length} group(s)`); process.exit(0); }
  const dir = fs.existsSync('/opt/energize/backups') ? '/opt/energize/backups' : path.join(process.cwd(), 'backups');
  fs.mkdirSync(dir, { recursive: true });
  const dropIds = plan.flatMap((l) => l.slice(1).map((x) => x._id));
  const file = path.join(dir, `br-duplicate-owners-${Date.now()}.json`);
  fs.writeFileSync(file, JSON.stringify({ actions: plan.flat(), assignments: await BrAssignment.find({ action: { $in: dropIds } }).lean() }));
  for (const [keep, ...drop] of plan) {
    const ids = drop.map((x) => x._id);
    // The furthest-along part wins its state (progress, then the most recently updated), so nothing reported is lost.
    const best = [keep, ...drop].sort((a, b) => ((b.progress || 0) - (a.progress || 0)) || (new Date(b.updatedAt) - new Date(a.updatedAt)))[0];
    const updates = [...(keep.updates || []), ...drop.flatMap((x) => x.updates || [])].sort((a, b) => new Date(a.at) - new Date(b.at));
    await BrAssignment.updateMany({ action: { $in: ids } }, { $set: { action: keep._id } });
    await BrAction.updateMany({ followUpOf: { $in: ids } }, { $set: { followUpOf: keep._id } });
    await BrAction.updateOne({ _id: keep._id }, { $set: { updates, status: best.status, progress: best.progress || 0, completedAt: best.completedAt || keep.completedAt || null,
      dueDate: best.dueDate || keep.dueDate || null, originalDueDate: best.originalDueDate || keep.originalDueDate || null, postponeCount: best.postponeCount || 0,
      postponeReason: best.postponeReason || '', expectedDate: best.expectedDate || keep.expectedDate || null } });
    await BrAction.deleteMany({ _id: { $in: ids } });
  }
  console.log(`merged ${plan.length} group(s), removed ${dropIds.length} copy(ies); backup ${file}`);
  process.exit(0);
})().catch((e) => { console.error(e.message); process.exit(1); });
