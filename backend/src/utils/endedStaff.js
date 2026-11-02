/**
 * endedStaff: staff whose service ended, from their HR file.
 * HR alone writes work status; its dashboard shows ended staff, while other sections count only people on duty.
 * Three sets because records link differently: `ids` (reference to the file), `idNumbers` (ID number only, both columns iqamaNumber and nationalId), `userIds` (login account, `User.linkedEmployee`).
 * Read once and cached for thirty seconds since many dashboards ask in one request.
 */
const cache = require('./ttlCache');

const TTL = 30000;

async function load() {
  const Employee = require('../models/Employee');
  const User = require('../models/User');
  const ended = await Employee.find({ employmentStatus: 'terminated' })
    .select('_id iqamaNumber nationalId').lean();
  const ids = new Set(ended.map((e) => String(e._id)));
  const idNumbers = new Set();
  for (const e of ended) {
    for (const n of [e.iqamaNumber, e.nationalId]) {
      const k = String(n || '').replace(/\s+/g, '');
      if (k) idNumbers.add(k);
    }
  }
  const users = ids.size
    ? await User.find({ linkedEmployee: { $in: [...ids] } }).select('_id').lean()
    : [];
  /**
   * Archive is stronger, as if deleted.
   * Ended staff are not counted on dashboards but stay in lists for review. Archived staff (service ended and left the system, or an ended freelancer) appear on no page, list or dropdown except the archive page. See utils/hrEngagement.
   */
  const { ARCHIVED } = require('./hrEngagement');
  const arch = await Employee.find(ARCHIVED).select('_id iqamaNumber nationalId').lean();
  const archivedIds = new Set(arch.map((e) => String(e._id)));
  const archivedIdNumbers = new Set();
  for (const e of arch) for (const n of [e.iqamaNumber, e.nationalId]) { const k = String(n || '').replace(/\s+/g, ''); if (k) archivedIdNumbers.add(k); }
  const archivedUsers = archivedIds.size ? await User.find({ linkedEmployee: { $in: [...archivedIds] } }).select('_id').lean() : [];
  return {
    ids, idNumbers, userIds: new Set(users.map((u) => String(u._id))),
    archivedIds, archivedIdNumbers, archivedUserIds: new Set(archivedUsers.map((u) => String(u._id))),
  };
}

/** { ids, idNumbers, userIds }: sets of strings. */
const endedStaff = () => cache.wrap('endedstaff:all', TTL, load);

/** Is this ID number an ended employee's? (normalized without spaces) */
const idNumberEnded = (sets, n) => !!n && sets.idNumbers.has(String(n).replace(/\s+/g, ''));
/** Is this file reference an ended employee's? Accepts an id or a populated document. */
const employeeEnded = (sets, ref) => {
  if (!ref) return false;
  if (typeof ref === 'object' && ref.employmentStatus) return ref.employmentStatus === 'terminated';
  return sets.ids.has(String(ref._id || ref));
};
/** Is this login account linked to an ended employee's file? */
const userEnded = (sets, user) => !!user && sets.userIds.has(String(user._id || user));

/** Archived? By file reference (or populated document) or by ID number. */
// Always by id: a populated document may lack the fields that identify the archive.
const employeeArchived = (sets, ref) => !!ref && sets.archivedIds.has(String(ref._id || ref));
const idNumberArchived = (sets, n) => !!n && sets.archivedIdNumbers.has(String(n).replace(/\s+/g, ''));
const userArchived = (sets, user) => !!user && sets.archivedUserIds.has(String(user._id || user));
/** Query condition that drops archived staff from a collection holding the file reference in `field`. */
const notArchivedRef = (sets, field = 'employee') => ({ [field]: { $nin: [...sets.archivedIds].map((x) => new (require('mongoose').Types.ObjectId)(x)) } });

module.exports = { endedStaff, idNumberEnded, employeeEnded, userEnded, employeeArchived, idNumberArchived, userArchived, notArchivedRef };
