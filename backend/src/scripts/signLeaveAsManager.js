/**
 * One leave: record its direct-manager approval as a given user (default: the requester's current direct manager) without moving the request.
 * Usage: node src/scripts/signLeaveAsManager.js <leaveId | emp:<employeeNumber>> [managerUserId] [--apply]
 * emp:<number> picks that employee's latest open leave.
 * Dry run by default; --apply writes a JSON backup to /opt/energize/backups (or ./backups) first.
 */
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const mongoose = require('mongoose');

(async () => {
  const [leaveId, maybeMgr] = process.argv.slice(2).filter((a) => !a.startsWith('--'));
  const apply = process.argv.includes('--apply');
  await mongoose.connect(process.env.MONGODB_URI || process.env.MONGO_URI);
  const LeaveRequest = require('../models/LeaveRequest');
  const Employee = require('../models/Employee');
  const User = require('../models/User');
  let leave;
  if (String(leaveId).startsWith('emp:')) {
    const e = await Employee.findOne({ employeeNumber: leaveId.slice(4) }).select('_id').lean();
    leave = e && await LeaveRequest.findOne({ employee: e._id, status: { $nin: ['approved', 'rejected', 'cancelled'] } }).sort({ createdAt: -1 }).lean();
  } else leave = await LeaveRequest.findById(leaveId).lean();
  if (!leave) throw new Error('leave not found');
  const emp = await Employee.findById(leave.employee).select('firstName lastName directManager').lean();
  const mgrId = maybeMgr || (emp && emp.directManager);
  const mgr = mgrId ? await User.findById(mgrId).select('firstName lastName role').lean() : null;
  if (!mgr) throw new Error('manager user not found');
  const old = leave.manager ? await User.findById(leave.manager).select('firstName lastName').lean() : null;
  console.log(JSON.stringify({
    employee: emp && `${emp.firstName} ${emp.lastName}`, status: leave.status, noManagerStage: leave.noManagerStage,
    managerBefore: old && `${old.firstName} ${old.lastName}`, managerDecisionBefore: leave.managerDecision || null,
    managerAfter: `${mgr.firstName} ${mgr.lastName}`,
  }, null, 1));
  if (!apply) { console.log('dry run'); process.exit(0); }
  const dir = fs.existsSync('/opt/energize/backups') ? '/opt/energize/backups' : path.join(process.cwd(), 'backups');
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `leave-${leave._id}-before-manager-sign-${Date.now()}.json`);
  fs.writeFileSync(file, JSON.stringify(leave));
  // The approval is dated with the request's earliest later stage so the sheet reads in order; the status is left where it is.
  const at = leave.financeDecision?.at || leave.hrDecision?.at || new Date();
  await LeaveRequest.updateOne({ _id: leave._id }, { $set: {
    manager: mgr._id, noManagerStage: false,
    managerDecision: { by: mgr._id, at, decision: 'approved', note: '', signature: '' },
  } });
  console.log('applied; backup', file);
  process.exit(0);
})().catch((e) => { console.error(e.message); process.exit(1); });
