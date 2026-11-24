/**
 * Bulk edit by running a page's own single-edit handler on each selected row.
 * Every rule of a manual edit applies unchanged (validation, price sides, locks, syncs to the workflow and the fleet); rows the handler refuses are reported with its message.
 */
const mongoose = require('mongoose');

const CAP = 500;

/** Calls `handler(req, res)` once per id with `fields` as the body; returns { done, failed: [{ id, label, message }] }. */
async function runBulk(req, handler, { labelOf } = {}) {
  const ids = (Array.isArray(req.body?.ids) ? req.body.ids : []).map(String).filter(mongoose.isValidObjectId);
  const fields = req.body?.fields && typeof req.body.fields === 'object' ? req.body.fields : {};
  if (!ids.length) return { status: 400, body: { message: 'لم يُحدَّد أيُّ صفّ' } };
  if (ids.length > CAP) return { status: 400, body: { message: `الحدُّ الأقصى ${CAP} صفًّا في المرّة` } };
  // Empty values mean "leave unchanged", as on the workflow's bulk edit.
  const body = Object.fromEntries(Object.entries(fields).filter(([, v]) => v !== '' && v !== null && v !== undefined));
  if (!Object.keys(body).length) return { status: 400, body: { message: 'لم يُغيَّر أيُّ حقل' } };
  let done = 0; const failed = [];
  for (const id of ids) {
    let status = 200; let payload = null;
    const res = {
      status(c) { status = c; return this; },
      json(p) { payload = p; return this; },
      send(p) { payload = p; return this; },
      set() { return this; }, setHeader() { return this; },
    };
    const one = { ...req, params: { ...req.params, id }, body: JSON.parse(JSON.stringify(body)), query: {}, bulk: true };
    try {
      // eslint-disable-next-line no-await-in-loop
      await handler(one, res);
    } catch (e) { status = 500; payload = { message: e.message }; }
    if (status < 300) done += 1;
    else {
      let label = id;
      // eslint-disable-next-line no-await-in-loop
      try { if (labelOf) label = (await labelOf(id)) || id; } catch (_) { /* */ }
      failed.push({ id, label: String(label), message: (payload && payload.message) || `خطأ ${status}` });
    }
  }
  const message = failed.length
    ? `حُفظ ${done} من ${ids.length} — لم يُحفظ ${failed.length}`
    : `حُفظ التعديل على ${done} ${done === 1 ? 'صفّ' : 'صفًّا'}`;
  return { status: 200, body: { done, failedCount: failed.length, failed: failed.slice(0, 50), message } };
}

module.exports = { runBulk, CAP };
