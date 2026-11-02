/**
 * archivedHidden: archived staff disappear as if deleted.
 * The endedStaff sets are read once per request; this file holds the query conditions built from them, because records link to the file in three ways: file reference, login account and ID number. The archive page and the archived person's own file do not pass through here.
 */
const mongoose = require('mongoose');
const { endedStaff, notArchivedRef } = require('./endedStaff');

const oid = (s) => new mongoose.Types.ObjectId(s);

/** A login account tied to an archived person, in a field holding a User reference. */
const notArchivedUserRef = (sets, field) => ({ [field]: { $nin: [...sets.archivedUserIds].map(oid) } });

/** An archived person's ID number, in a text field (numbers are stored without spaces). */
const notArchivedIdNumber = (sets, field) => ({ [field]: { $nin: [...sets.archivedIdNumbers] } });

/** A row in a section register that carries the file reference when linked and always the ID number (light transport): matched by reference if present, otherwise by ID number. */
const notArchivedRow = (sets, refField = 'employee', idField = 'idNumber') => ({
  $nor: [
    { [refField]: { $in: [...sets.archivedIds].map(oid) } },
    { [refField]: null, [idField]: { $in: [...sets.archivedIdNumbers] } },
  ],
});

/** Light transport rows of archived people, for records that point at the row rather than the file (`B2CRep.ltEmployee`, app reps). One query per request. */
async function archivedLtRowIds(sets) {
  if (!sets.archivedIds.size && !sets.archivedIdNumbers.size) return [];
  const { LightTransportEmployee } = require('../models/LightTransport');
  const rows = await LightTransportEmployee.find({
    $or: [
      { employee: { $in: [...sets.archivedIds].map(oid) } },
      { employee: null, idNumber: { $in: [...sets.archivedIdNumbers] } },
    ],
  }).select('_id').lean();
  return rows.map((r) => r._id);
}

/** Merges the conditions into an existing filter without overwriting its `$or`. */
const andAll = (filter, ...frags) => ({ ...(filter || {}), $and: [...((filter && filter.$and) || []), ...frags] });

/** Shortcut: the same filter excluding archived people in `field` (an Employee reference). */
async function withoutArchivedRef(filter, field = 'employee') {
  const sets = await endedStaff();
  return andAll(filter, notArchivedRef(sets, field));
}

module.exports = { endedStaff, notArchivedRef, notArchivedUserRef, notArchivedIdNumber, notArchivedRow, archivedLtRowIds, andAll, withoutArchivedRef };
