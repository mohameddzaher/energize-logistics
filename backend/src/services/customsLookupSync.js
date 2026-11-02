/**
 * Renaming an item in the customs settings applies immediately and retroactively. Payment-stage entries and customer invoice items snapshot the item name (`label`), and the transaction attachment uses it as its title, so old rows kept the old name.
 * The new name is propagated to snapshots that carry the old name exactly; an attachment title edited by hand is left alone.
 */
const cache = require('../utils/ttlCache');

const SYNCED = {
  customs_payment_stage: { list: 'paymentStages', titles: (n) => [n, `إثبات دفع · ${n}`] },
  customs_sale_item: { list: 'saleItems', titles: (n) => [`فاتورة العميل — ${n}`] },
};

async function lookupRenamed({ type, key, from, to }) {
  const def = SYNCED[type];
  if (!def || !from || !to || from === to) return { touched: 0 };
  const CustomsClearance = require('../models/CustomsClearance');
  let touched = 0;
  const r = await CustomsClearance.updateMany(
    { [`${def.list}.key`]: key },
    { $set: { [`${def.list}.$[e].label`]: to } },
    { arrayFilters: [{ 'e.key': key }] },
  );
  touched += r.modifiedCount || 0;
  const oldTitles = def.titles(from); const newTitles = def.titles(to);
  for (let i = 0; i < oldTitles.length; i += 1) {
    const a = await CustomsClearance.updateMany(
      { 'attachments.title': oldTitles[i] },
      { $set: { 'attachments.$[a].title': newTitles[i] } },
      { arrayFilters: [{ 'a.title': oldTitles[i] }] },
    );
    touched += a.modifiedCount || 0;
  }
  try { cache.clear('customs:'); cache.clear('finance:'); } catch (_) { /* */ }
  // Open screens refetch: the transaction, its list, the section dashboard and finance.
  try { require('../websocket/socketManager').emitToAll('customs:updated', { renamed: { type, key } }); } catch (_) { /* */ }
  return { touched };
}

module.exports = { lookupRenamed, SYNCED };
