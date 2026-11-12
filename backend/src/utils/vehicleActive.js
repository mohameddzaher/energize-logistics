/**
 * A vehicle whose service ended («إنهاء خدمة المركبة») is archived, not deleted: it keeps every field and its history but no longer belongs to us.
 * The filter lives here, installed as query middleware on VehicleMaster, so every list, count, dashboard, alert, picker and populate skips archived vehicles without each caller remembering.
 * Opt in with `.setOptions({ withArchived: true })` (or `.option(...)` on aggregate), or by naming `archived` in the filter.
 */
const ACTIVE = Object.freeze({ archived: { $ne: true } });
const ARCHIVED = Object.freeze({ archived: true });

const QUERY_OPS = ['find', 'findOne', 'countDocuments', 'count', 'distinct',
  'findOneAndUpdate', 'findOneAndDelete', 'findOneAndReplace', 'deleteOne', 'deleteMany'];

// The caller decided about archived vehicles if it named the field at the top level or inside $and.
function mentionsArchived(filter) {
  if (!filter || typeof filter !== 'object') return false;
  if (Object.prototype.hasOwnProperty.call(filter, 'archived')) return true;
  return Array.isArray(filter.$and) && filter.$and.some(mentionsArchived);
}

function installArchiveFilter(schema) {
  for (const op of QUERY_OPS) {
    schema.pre(op, function () {
      if (this.getOptions().withArchived || mentionsArchived(this.getFilter())) return;
      this.where(ACTIVE);
    });
  }
  schema.pre('aggregate', function () {
    if (this.options && this.options.withArchived) return;
    const p = this.pipeline();
    if (p[0] && p[0].$match && mentionsArchived(p[0].$match)) return;
    // $search / $geoNear must stay the first stage.
    const at = p[0] && (p[0].$search || p[0].$searchMeta || p[0].$geoNear || p[0].$vectorSearch) ? 1 : 0;
    p.splice(at, 0, { $match: { ...ACTIVE } });
  });
}

module.exports = { ACTIVE, ARCHIVED, installArchiveFilter, mentionsArchived };
