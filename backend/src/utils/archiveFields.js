/**
 * Archive marker shared by customer and vendor registers (services/customerArchive).
 * Deleting a customer or vendor anywhere moves it to the archive; only deleting from the archive removes it.
 * `hide: true` is for registers without an `isActive` flag (CRM companies, contract customers): their queries skip archived rows
 * unless the filter names `_id` or `archivedAt`, or the query sets the `withArchived` option.
 */
const mongoose = require('mongoose');

const FIELDS = {
  archivedAt: { type: Date, default: null, index: true },
  archivedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  archivedByName: { type: String, default: '' },
  // Section the delete came from (register key), shown in the archive.
  archivedFrom: { type: String, default: '' },
  // isActive before archiving, so restoring does not revive a row that was already disabled for another reason.
  archivePrevActive: { type: Boolean, default: undefined },
};

// Reads only: writes by id or by name must still reach archived rows (renames, restore).
const FIND_OPS = ['find', 'findOne', 'countDocuments', 'count', 'distinct'];

function addArchive(schema, { hide = false } = {}) {
  schema.add(FIELDS);
  if (!hide) return;
  schema.pre(FIND_OPS, function hideArchived() {
    if (this.getOptions && this.getOptions().withArchived) return;
    const f = this.getFilter ? this.getFilter() : {};
    if (f && (Object.prototype.hasOwnProperty.call(f, '_id') || Object.prototype.hasOwnProperty.call(f, 'archivedAt'))) return;
    this.where({ archivedAt: null });
  });
  schema.pre('aggregate', function hideArchivedAgg() {
    if (this.options && this.options.withArchived) return;
    const first = this.pipeline()[0];
    // Stages that must stay first ($geoNear, $search) are left alone.
    if (first && (first.$geoNear || first.$search || first.$searchMeta)) return;
    this.pipeline().unshift({ $match: { archivedAt: null } });
  });
}

module.exports = { addArchive, ARCHIVE_FIELDS: Object.keys(FIELDS) };
