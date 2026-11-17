/**
 * «خدمة Media Go»: a yes/no service on a rider (the box on his vehicle carries Media Go ads); it is not a project.
 * The rider's flag lives on the HR file (Employee.mediaGo) and on the B2C register row (LightTransportEmployee.mediaGo):
 * a change on either side is copied to the other at once, from any write path (model hooks call this). Writes use the
 * raw collection so the copy does not re-trigger the hooks. The vehicle has its own flag (VehicleMaster.mediaGo).
 */
const mongoose = require('mongoose');

const emit = (ev, p = {}) => { try { require('../websocket/socketManager').emitToAll(ev, p); } catch (_) { /* */ } };
const bust = () => {
  const cache = require('./ttlCache');
  for (const p of ['hrm:', 'hr:', 'dash:', 'lt:', 'b2c:']) { try { cache.clear(p); } catch (_) { /* */ } }
};

/** HR file → B2C register rows of that employee. */
async function fromEmployee(employeeIds, value) {
  const ids = [].concat(employeeIds || []).filter(Boolean);
  if (!ids.length) return;
  const LT = mongoose.model('LightTransportEmployee');
  const r = await LT.collection.updateMany({ employee: { $in: ids }, mediaGo: { $ne: !!value } }, { $set: { mediaGo: !!value } });
  if (r.modifiedCount) { bust(); emit('lt:updated', {}); }
}

/** B2C register row → its HR file. */
async function fromRegister(employeeIds, value) {
  const ids = [].concat(employeeIds || []).filter(Boolean);
  if (!ids.length) return;
  const Employee = mongoose.model('Employee');
  const r = await Employee.collection.updateMany({ _id: { $in: ids }, mediaGo: { $ne: !!value } }, { $set: { mediaGo: !!value } });
  if (r.modifiedCount) { bust(); emit('hr:employee', {}); emit('hr:master', {}); }
}

/** The new value in an update document, or undefined when the update does not touch it. */
function valueIn(update) {
  if (!update) return undefined;
  if (update.$set && Object.prototype.hasOwnProperty.call(update.$set, 'mediaGo')) return !!update.$set.mediaGo;
  if (Object.prototype.hasOwnProperty.call(update, 'mediaGo')) return !!update.mediaGo;
  return undefined;
}

/**
 * Adds the copy hooks to a schema. `idsOf(docs)` turns the changed documents into the employee ids to copy to,
 * `push(ids, value)` writes them.
 */
function attach(schema, { idsOf, push }) {
  schema.pre('save', function mark(next) {
    this.$locals.mediaGoChanged = !this.isNew ? this.isModified('mediaGo') : !!this.mediaGo;
    next();
  });
  schema.post('save', async function copy(doc) {
    if (!doc.$locals.mediaGoChanged) return;
    try { await push(idsOf([doc]), doc.mediaGo); } catch (e) { console.error('[mediaGo] save sync:', e.message); }
  });
  for (const op of ['updateOne', 'updateMany', 'findOneAndUpdate']) {
    schema.pre(op, function mark(next) { this._mediaGo = valueIn(this.getUpdate()); next(); });
    schema.post(op, async function copy() {
      if (this._mediaGo === undefined) return;
      try {
        const docs = await this.model.find(this.getFilter()).select('_id employee').lean();
        await push(idsOf(docs), this._mediaGo);
      } catch (e) { console.error('[mediaGo] update sync:', e.message); }
    });
  }
}

module.exports = { fromEmployee, fromRegister, attach, valueIn };
