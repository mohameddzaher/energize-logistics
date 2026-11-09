/**
 * Finds leave requests whose direct-manager stage was decided by someone other than the employee's direct manager
 * (a super admin's override used to reach that stage) and sends the open ones back to the real manager.
 * The manager is re-read from the requester's account; decisions made after the bypass are cleared, since nobody had the manager's approval.
 * Closed requests are listed, not changed.
 * Usage: node src/scripts/repairManagerStageBypass.js (dry run) | --apply
 */
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const mongoose = require('mongoose');
const LeaveRequest = require('../models/LeaveRequest');
const User = require('../models/User');
const chain = require('../utils/leaveChain');

const APPLY = process.argv.includes('--apply');
const OPEN = new Set(chain.OPEN_STATUSES || ['pending_manager', 'pending_finance', 'pending_hr', 'pending_executive', 'info_requested']);

(async () => {
  await mongoose.connect(process.env.MONGODB_URI);
  const users = new Map((await User.find({}).select('firstName lastName role manager isChairman').lean()).map((u) => [String(u._id), u]));
  const nm = (id) => { const u = users.get(String(id || '')); return u ? `${u.firstName} ${u.lastName}` : '—'; };
  const rows = await LeaveRequest.find({ 'managerDecision.by': { $exists: true, $ne: null } }).lean();
  const bad = rows.filter((l) => {
    const by = String(l.managerDecision.by);
    if (String(l.requester) === by) return false; // self-managed requester
    if (l.filedByManager && String(l.filedBy) === by) return false;
    const requester = users.get(String(l.requester));
    const rightful = String(requester?.manager || l.manager || '');
    return by !== rightful;
  });
  const backup = []; let fixed = 0;
  for (const l of bad) {
    const requester = users.get(String(l.requester));
    const rightful = requester && !chain.selfManaged(requester) ? requester.manager : null;
    const open = OPEN.has(l.status);
    console.log(`${open ? '↺' : '·'} ${nm(l.requester)} ${l.startDate}→${l.endDate} [${l.status}] — المدير المباشر وقّعه ${nm(l.managerDecision.by)}، ومديره الفعليّ ${nm(rightful)}${open ? '' : ' (مغلق: يُعرض فقط)'}`);
    if (!open || !APPLY) continue;
    backup.push(l);
    const doc = await LeaveRequest.findById(l._id);
    const excluded = (doc.excludedFridays || []).length;
    doc.manager = rightful || undefined;
    chain.restart(doc, null, { amended: true });
    if (excluded) doc.days = (doc.days || 0) + excluded;
    if (doc.balanceSnapshot) doc.balanceSnapshot.requested = doc.days;
    await doc.save();
    fixed += 1;
    if (rightful) {
      const { createNotification } = require('../services/notificationService');
      await createNotification({ recipient: rightful, type: 'system_alert', title: 'طلب إجازة بانتظار قرارك', message: `${nm(l.requester)}: ${l.startDate} → ${l.endDate}`, relatedEntity: 'LeaveRequest', relatedEntityId: l._id }).catch(() => {});
    }
  }
  if (backup.length) {
    const dir = fs.existsSync('/opt/energize/backups') ? '/opt/energize/backups' : path.join(__dirname, '../../');
    const f = path.join(dir, `leaves-before-manager-bypass-repair-${Date.now()}.json`);
    fs.writeFileSync(f, JSON.stringify(backup, null, 1));
    console.log(`نسخةٌ احتياطيّة: ${f}`);
    try { require('../utils/ttlCache').clear('hr:'); } catch (_) { /* caches expire on their own */ }
  }
  console.log(`${bad.length} طلبًا وُقِّعت مرحلةُ مديره المباشر من غيره · ${APPLY ? `أُعيد ${fixed} مفتوحًا إلى مديره` : 'عرضٌ فقط (--apply للكتابة)'}`);
  await mongoose.disconnect();
})().catch((e) => { console.error(e); process.exit(1); });
