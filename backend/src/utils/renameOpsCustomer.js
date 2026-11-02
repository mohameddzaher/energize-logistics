/**
 * A customer's name edited in the operations platform is followed by collections and statements.
 * Cause: the operations customer name is its key in collections. A statement carries the name as text (`username`) and the collections party is matched by its folded name (`nameKey`). Fixing one letter on the platform used to break the link: new statements arrived with the new name, found no party and created a second party with no code, leaving one customer with two accounts and split debt.
 * When the name changes there, it follows here in one call:
 * - The collections party is renamed and the old name stays as another form (`aliases`/`aliasKeys`), so earlier records stay linked. - If the new name already belongs to an existing party, no third is created: the old name is added as an alias of the existing one and the duplicate is disabled, as "link accounts" does by hand. - Saved operations statements get the new name immediately, without waiting for the full sync cycle (the sync writes the platform name on every pass, so the values agree anyway). The name is written as text in several registers: operations statements, shipment orders, fleet loads, clearance parties and transactions, and the party name on ledger invoices. Fixing one place only makes one customer two rows on one screen and one row on another, so it is corrected in all of them in one call. The party name on an invoice is corrected too: it is the owner's name, not the paper's text; the paper stays with its attachment and number.
 */
const fold = (v) => require('../models/CollectionsParty').fold(v);
const S = (v) => String(v ?? '').trim();

async function renameOpsCustomer(oldName, newName) {
  const from = String(oldName || '').trim();
  const to = String(newName || '').trim();
  // A spelling fix is still a fix. The condition used to compare the two names after folding, and folding treats variants of the same letter as equal. So eleven rows of the matching sheet were never applied: they read as no difference, though the reader sees a difference on screen and the platform searches the exact text and cannot find it. While the text differs there is something to write; folding only decides whether it is the same customer (no merge, no second account), not whether to write.
  if (!from || !to || from === to) return null;

  const CollectionsParty = require('../models/CollectionsParty');
  const OperationsWorkflow = require('../models/OperationsWorkflow');
  const out = { from, to, party: null, merged: false, sheets: 0 };

  const oldKey = fold(from);
  const newKey = fold(to);

  const current = await CollectionsParty.findOne({
    kind: 'customer', $or: [{ nameKey: oldKey }, { aliasKeys: oldKey }],
  });
  const target = await CollectionsParty.findOne({
    kind: 'customer', isActive: { $ne: false }, $or: [{ nameKey: newKey }, { aliasKeys: newKey }],
  });

  const sameCode = current && target && S(current.code) && S(current.code) === S(target.code);
  if (current && target && String(current._id) !== String(target._id) && (!S(current.code) || sameCode)) {
    // The new name belongs to an existing party and the old one has no code of its own: its name is added as an alias of that account and the duplicate is disabled, so one customer never has two records.
    await CollectionsParty.updateOne({ _id: target._id }, {
      // The approved name is written exactly: the existing one may be spelled with a variant letter and the wanted one with the standard letter. Folding equates them; the reader does not.
      ...(target.name !== to ? { $set: { name: to, nameKey: newKey } } : {}),
      $addToSet: { aliases: from, aliasKeys: oldKey },
    });
    await CollectionsParty.updateOne({ _id: current._id }, {
      $set: { isActive: false, notes: `دُمج في «${target.name}» بعد تعديل الاسم في منصّة التشغيل` },
    });
    out.party = String(target._id);
    out.merged = true;
  } else if (current && target && String(current._id) !== String(target._id)) {
    // An account that has its own code is never merged into another. One company can hold two accounts, cash (Cxxxx) and tax (1104xxxx), each with its own balance, credit term and invoices; merging them because the names agree hides an account with its invoices (it happened: 37 accounts and 1,014 invoices). So its name is corrected and it stays an account with its code, and the old name becomes an alias.
    await CollectionsParty.updateOne({ _id: current._id }, {
      $set: { name: to, nameKey: newKey },
      $addToSet: { aliases: from, aliasKeys: oldKey },
    });
    out.party = String(current._id);
    out.keptSeparate = S(current.code);
  } else if (current) {
    await CollectionsParty.updateOne({ _id: current._id }, {
      $set: { name: to, nameKey: newKey },
      $addToSet: { aliases: from, aliasKeys: oldKey },
    });
    out.party = String(current._id);
  } else if (target) {
    await CollectionsParty.updateOne({ _id: target._id }, { $addToSet: { aliases: from, aliasKeys: oldKey } });
    out.party = String(target._id);
  }

  // All name forms, not just the literal one. Statements carry the name as written that day, in letter variants, and exact matching leaves the rest (about four thousand remained after the first run).
  // Forms are collected from both sides of the edit, old and new: the one written with one variant and the one written with the other are both this customer, and leaving one would split it into two rows on a screen that groups by text. The intent is a single approved spelling.
  const KEYS = new Set([oldKey, newKey]);
  const variantsOf = async (coll, field) => {
    const names = await coll.distinct(field);
    return (names || []).filter((n) => n && KEYS.has(fold(n)) && n !== to);
  };

  const wfNames = await variantsOf(OperationsWorkflow, 'username');
  if (wfNames.length) {
    const r = await OperationsWorkflow.updateMany({ username: { $in: wfNames } }, { $set: { username: to } });
    out.sheets = r.modifiedCount || 0;
  }

  // The remaining places, each by its own field name.
  const also = [
    ['ShipmentOrder', 'customerName', 'shipmentOrders'],
    ['FleetModels', 'customerName', 'fleetShipments', 'FleetShipment'],
    ['CustomsParty', 'name', 'customsParties'],
    ['CustomsClearance', 'customerName', 'customsClearances'],
  ];
  for (const [modelName, field, key, exportName] of also) {
    try {
      const Model = require(`../models/${modelName}`);
      const M = Model[exportName || modelName] || Model;
      if (!M || typeof M.distinct !== 'function') continue;
      const names = (await M.distinct(field)).filter((n) => n && KEYS.has(fold(n)) && n !== to);
      if (!names.length) continue;
      const r = await M.updateMany({ [field]: { $in: names } }, { $set: { [field]: to } });
      out[key] = r.modifiedCount || 0;
    } catch (_) { /* Registry absent in this build. */ }
  }

  // The party name on ledger invoices, for those linked to this party or to its old name.
  try {
    const CollectionInvoice = require('../models/CollectionInvoice');
    const names = (await CollectionInvoice.distinct('partyName')).filter((n) => n && KEYS.has(fold(n)) && n !== to);
    const or = [];
    if (names.length) or.push({ partyName: { $in: names } });
    if (out.party) or.push({ party: out.party });
    if (or.length) {
      const r = await CollectionInvoice.updateMany({ $or: or }, { $set: { partyName: to } });
      out.invoices = r.modifiedCount || 0;
    }
  } catch (_) { /* */ }

  try {
    const cache = require('./ttlCache');
    // `wfparty:` maps (approved name and customer type) follow the parties, not the statements.
    cache.clear('wf:'); cache.clear('wfparty:'); cache.clear('collections:'); cache.clear('coll:');
  } catch (_) { /* */ }
  try { require('../controllers/collectionsLedgerController').invalidate(); } catch (_) { /* */ }
  try {
    const { emitToAll } = require('../websocket/socketManager');
    emitToAll('collections:party', { renamed: true });
    emitToAll('workflow:updated', { renamed: true });
  } catch (_) { /* */ }

  return out;
}

module.exports = { renameOpsCustomer };
