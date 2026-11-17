/**
 * Media Go was added as a project, then turned out to be a service (the box on a rider's vehicle). Anything filed under
 * the project moves to the yes/no flag and leaves the project empty; the project rows and list entries are retired.
 * Idempotent: a second run finds nothing.
 */
const mongoose = require('mongoose');

const RX = /^\s*(media\s*go|ميديا\s*جو)\s*$/i;

async function run() {
  const Employee = mongoose.model('Employee');
  const { LightTransportEmployee } = require('../models/LightTransport');
  const { VehicleMaster } = require('../models/VehicleMaster');
  const B2CProject = require('../models/B2CProject');
  const B2CRep = require('../models/B2CRep');
  const Lookup = require('../models/Lookup');
  let n = 0;
  // Raw collection writes: one migration, no per-row hooks (both sides are set here together).
  n += (await LightTransportEmployee.collection.updateMany({ projectAr: RX }, { $set: { mediaGo: true, projectAr: '' } })).modifiedCount;
  n += (await Employee.collection.updateMany({ project: RX }, { $set: { mediaGo: true, project: '' } })).modifiedCount;
  // HR files of riders flagged above follow their register row.
  const flagged = await LightTransportEmployee.find({ mediaGo: true, employee: { $ne: null } }).select('employee').lean();
  if (flagged.length) n += (await Employee.collection.updateMany({ _id: { $in: flagged.map((r) => r.employee) }, mediaGo: { $ne: true } }, { $set: { mediaGo: true } })).modifiedCount;
  n += (await VehicleMaster.collection.updateMany({ departmentAr: RX }, { $set: { mediaGo: true, departmentAr: '' } })).modifiedCount;
  const projects = await B2CProject.find({ $or: [{ name: RX }, { nameAr: RX }] }).select('_id').lean();
  if (projects.length) {
    const ids = projects.map((p) => p._id);
    n += (await B2CRep.collection.updateMany({ project: { $in: ids } }, { $unset: { project: 1 } })).modifiedCount;
    n += (await B2CProject.collection.deleteMany({ _id: { $in: ids } })).deletedCount;
  }
  // Tombstoned, so boot seeding does not bring the entries back.
  n += (await Lookup.collection.updateMany({ type: { $in: ['lt_project', 'vehicle_department', 'hr_project'] }, nameAr: RX, deleted: { $ne: true } }, { $set: { deleted: true, isActive: false } })).modifiedCount;
  if (n) {
    const cache = require('./ttlCache');
    for (const p of ['hrm:', 'hr:', 'hrlists:', 'lt:', 'b2c:', 'dash:']) { try { cache.clear(p); } catch (_) { /* */ } }
    try { require('./hrLists').forget(); } catch (_) { /* */ }
  }
  return n;
}

module.exports = { run };
