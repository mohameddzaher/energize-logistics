/**
 * A carrier truck or driver can work for several suppliers: `supplier` is the primary (shown on the row, printed on
 * the waybill), `suppliers` is every supplier it is linked to and always contains the primary. Older rows have only
 * `supplier`, so readers match either field instead of relying on a backfill.
 */
const mongoose = require('mongoose');

const oid = (v) => {
  if (!v) return null;
  try { return new mongoose.Types.ObjectId(String(v._id || v)); } catch (_) { return null; }
};

/** Rows linked to a supplier, primary or not. */
const linkedTo = (id) => {
  const o = oid(id);
  return o ? { $or: [{ supplier: o }, { suppliers: o }] } : { _id: null };
};

/** Rows not linked to a supplier at all (the «من خارج سجلّ هذا المورد» list). */
const notLinkedTo = (id) => {
  const o = oid(id);
  return o ? { supplier: { $ne: o }, suppliers: { $ne: o } } : {};
};

/** Aggregation expression: the row's full supplier set, primary included, for rows written before `suppliers` existed. */
const SUPPLIER_SET = {
  $setUnion: [
    { $ifNull: ['$suppliers', []] },
    { $cond: [{ $ifNull: ['$supplier', false] }, ['$supplier'], []] },
  ],
};

/** Ids of every supplier on a row, primary first. */
const supplierIdsOf = (row) => {
  const out = [];
  for (const s of [row && row.supplier, ...((row && row.suppliers) || [])]) {
    const k = s && String(s._id || s);
    if (k && !out.includes(k)) out.push(k);
  }
  return out;
};

/**
 * Keeps `suppliers` in step with `supplier` on every write path: save, update and the bulk updates scripts use.
 * Our own truck (`ownership: 'ours'`) has no supplier, so its list is cleared with it.
 */
function supplierSetPlugin(schema) {
  schema.add({ suppliers: { type: [mongoose.Schema.Types.ObjectId], ref: 'ShipmentOrderSupplier', default: undefined } });
  schema.index({ suppliers: 1 });

  schema.pre('save', function keepSupplierSet(next) {
    if (this.ownership === 'ours') { this.suppliers = []; return next(); }
    if (this.supplier) {
      const ids = (this.suppliers || []).map(String);
      if (!ids.includes(String(this.supplier))) this.suppliers = [...(this.suppliers || []), this.supplier];
    }
    next();
  });

  for (const op of ['findOneAndUpdate', 'updateOne', 'updateMany']) {
    schema.pre(op, function keepSupplierSetOnUpdate(next) {
      const u = this.getUpdate() || {};
      if (Array.isArray(u)) return next(); // Pipeline updates set the fields themselves.
      const set = u.$set || {};
      const own = set.ownership !== undefined ? set.ownership : u.ownership;
      if (own === 'ours') {
        if (u.$set) u.$set.suppliers = []; else u.suppliers = [];
        if (u.$addToSet) delete u.$addToSet.suppliers;
        this.setUpdate(u);
        return next();
      }
      const primary = set.supplier !== undefined ? set.supplier : u.supplier;
      if (primary) {
        const p = oid(primary);
        if (p) {
          // A whole list written in the same update gets the primary added to it; otherwise it is added to the stored list.
          if (Array.isArray(set.suppliers)) {
            if (!set.suppliers.map(String).includes(String(p))) set.suppliers.push(p);
          } else if (Array.isArray(u.suppliers)) {
            if (!u.suppliers.map(String).includes(String(p))) u.suppliers.push(p);
          } else {
            u.$addToSet = { ...(u.$addToSet || {}), suppliers: p };
          }
          this.setUpdate(u);
        }
      }
      next();
    });
  }
}

module.exports = { supplierSetPlugin, linkedTo, notLinkedTo, SUPPLIER_SET, supplierIdsOf, oid };
