/**
 * Global schema plugin: every document is copied to `deletedrecords` before a
 * delete runs, so a wrong delete from any screen can be restored
 * (scripts/restoreDeleted.js). If the copy fails the delete fails with it.
 * Skipped: caches, and the duty log whose 14-day removal the owner asked for.
 */
const mongoose = require('mongoose');

const SKIP = new Set(['Ls2TripCache', 'ExportJob', 'Notification', 'B2CDutyCheck']);
const COLLECTION = 'deletedrecords';

async function keep(modelName, docs) {
  if (!docs.length) return;
  const at = new Date();
  const rows = docs.map((data) => ({ model: modelName, refId: data._id, data, deletedAt: at }));
  const target = mongoose.connection.collection(COLLECTION);
  for (let i = 0; i < rows.length; i += 1000) await target.insertMany(rows.slice(i, i + 1000), { ordered: false });
}

module.exports = function keepDeleted(schema) {
  // doc.deleteOne() runs a query too, so this one hook covers it.
  schema.pre(['deleteOne', 'deleteMany', 'findOneAndDelete'], { query: true, document: false }, async function onQuery() {
    const name = this.model.modelName;
    if (SKIP.has(name)) return;
    const filter = this.getFilter();
    if (name === 'AuditLog' && filter.entity === 'B2CDutyCheck') return;
    const q = this.model.find(filter).lean();
    if (this.op !== 'deleteMany') q.limit(1);
    await keep(name, await q);
  });
};
