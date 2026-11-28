/**
 * Keeps the tracking screens' unit→vehicle→rider links live. A write that touches a watched path (Media Go flag, plate,
 * GPS device, rider link…) clears the `express:links` cache (cross-worker via ttlCache stamps) and tells open screens to
 * refetch (`tracking:links`). Debounced so a bulk import emits once.
 */
let timer = null;
function announce() {
  if (timer) return;
  timer = setTimeout(() => {
    timer = null;
    try { require('./ttlCache').clear('express:links'); } catch (_) { /* */ }
    try { require('../websocket/socketManager').emitToAll('tracking:links', { at: Date.now() }); } catch (_) { /* */ }
  }, 1500);
  timer.unref?.();
}

const touches = (update, paths) => {
  if (!update) return false;
  const keys = [];
  for (const [k, v] of Object.entries(update)) {
    if (k.startsWith('$')) { if (v && typeof v === 'object') keys.push(...Object.keys(v)); } else keys.push(k);
  }
  return keys.some((k) => paths.some((p) => k === p || k.startsWith(`${p}.`)));
};

/** Adds the hooks to a schema; `paths` are the top-level fields the tracking links read. */
function attach(schema, paths) {
  schema.post('save', function after(doc) {
    if (doc.$locals?.trackingTouched) announce();
  });
  schema.pre('save', function mark(next) {
    this.$locals.trackingTouched = this.isNew || paths.some((p) => this.isModified(p));
    next();
  });
  for (const op of ['updateOne', 'updateMany', 'findOneAndUpdate', 'replaceOne']) {
    schema.post(op, function after() { if (touches(this.getUpdate(), paths)) announce(); });
  }
  for (const op of ['deleteOne', 'deleteMany', 'findOneAndDelete']) schema.post(op, announce);
}

module.exports = { attach, announce };
