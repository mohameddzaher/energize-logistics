/**
 * ensureCollectionsParty: a new customer enters collections with its code from the first statement.
 * Collections works by code (invoice attribution, ledger matching, debt), and the party register used to be filled by a manual script, so new customers had no code.
 * The code comes from the chain of its type (tax `1104xxxx`, cash `Cxxxx`) via `nextPartyCode`; the type is derived from the statement (`derivePaymentType`). If unknown, no type or code is guessed, since a code from the wrong chain is worse than none.
 * Names under two characters (blank, dash, totals label) create no record.
 */
const MIN_NAME = 2;
const JUNK = /^\s*(?:-|—|_|n\/a|na|none|null|undefined|test|الإجمالي|الاجمالي|المجموع|total)\s*$/i;

/**
 * Returns the party record, existing or just created.
 * @param {string} name  customer name as received
 * @param {object} opts  { paymentType: 'cash'|'tax'|'' (type if known), source: originating section such as `operations_workflow` }
 * @returns {Promise<object|null>}
 */
async function ensureCollectionsParty(name, opts = {}) {
  const CollectionsParty = require('../models/CollectionsParty');
  const { fold } = CollectionsParty;
  const clean = String(name || '').trim();
  if (clean.length < MIN_NAME || JUNK.test(clean)) return null;

  const key = fold(clean);
  if (!key) return null;

  // The name is matched folded and by alias: one customer is written with and without hamza, and a second record would split his debt across two rows.
  const found = await CollectionsParty.findOne({
    kind: 'customer', $or: [{ nameKey: key }, { aliasKeys: key }],
  }).lean();
  const paymentType = opts.paymentType === 'cash' || opts.paymentType === 'tax' ? opts.paymentType : '';
  // An existing party with no code gets one once the type of its loads is known. A party created without a code because the type was unknown was never revisited, leaving 148 customers with loads and no code, so they were missing from aging.
  if (found) {
    if (!found.code && found.isActive !== false) {
      try { await classifyCodelessParty(found, { apply: true, paymentType }); } catch (_) { /* */ }
      return CollectionsParty.findById(found._id).lean();
    }
    return found;
  }
  // A code is not granted directly at creation: first check whether it is an existing account under another name; see classifyCodelessParty.
  const code = '';

  try {
    return await CollectionsParty.findOneAndUpdate(
      { kind: 'customer', nameKey: key },
      {
        $setOnInsert: {
          kind: 'customer', name: clean, nameKey: key, paymentType, code,
          source: opts.source || 'operations_workflow', isActive: true,
        },
      },
      { upsert: true, new: true, setDefaultsOnInsert: true },
    ).lean().then(async (doc) => {
      if (doc && !doc.code) {
        try { await classifyCodelessParty(doc, { apply: true, paymentType }); } catch (_) { /* */ }
        return CollectionsParty.findById(doc._id).lean();
      }
      return doc;
    });
  } catch (e) {
    // Race between two syncs on the same name: the unique index rejects the second, so the one that won is read instead of failing the call and dropping the whole statement.
    if (e && e.code === 11000) {
      return CollectionsParty.findOne({ kind: 'customer', nameKey: key }).lean();
    }
    throw e;
  }
}

/**
 * A party with no code: an existing account under another name, or a new customer?
 * auto: one unambiguous account, merged into it (duplicate disabled, not deleted). review: non-conclusive lookalike, a suggestion in the link queue and no code until decided, since a duplicate code splits the debt irreparably. none: new code from the chain of its loads' type. unknown: type unknown, stays until known.
 * Type = the one on the party, else the majority among its loads.
 */
async function classifyCodelessParty(party, { apply = false, paymentType = '' } = {}) {
  const CollectionsParty = require('../models/CollectionsParty');
  const PartyLinkSuggestion = require('../models/PartyLinkSuggestion');
  const { matchAccount } = require('./partyMatch');
  const mongoose = require('mongoose');
  const names = [party.name, ...(party.aliases || [])].filter(Boolean);

  const accounts = await CollectionsParty.find({
    kind: 'customer', isActive: { $ne: false }, code: { $gt: '' }, _id: { $ne: party._id },
  }).select('name code paymentType').lean();
  const m = matchAccount(party.name, accounts);

  if (m.level === 'auto') {
    if (apply) {
      const keys = names.map((n) => CollectionsParty.fold(n)).filter(Boolean);
      await CollectionsParty.updateOne({ _id: m.best._id }, { $addToSet: { aliases: { $each: names }, aliasKeys: { $each: keys } } });
      await CollectionsParty.updateOne({ _id: party._id }, { $set: { isActive: false, notes: `دُمج في الحساب ${m.best.code}` } });
      await PartyLinkSuggestion.updateOne({ code: m.best.code, candidate: party._id }, { $setOnInsert: {
        code: m.best.code, accountName: m.best.name, kind: m.best.paymentType === 'cash' ? 'cash' : 'tax',
        candidate: party._id, candidateName: party.name, score: m.score,
        decision: 'linked', decidedHow: 'auto', decidedAt: new Date(), party: m.best._id,
      } }, { upsert: true }).catch(() => {});
    }
    return { level: 'auto', best: m.best, score: m.score };
  }

  if (m.level === 'review') {
    // A previous decision that the two are separate is respected: not asked twice, and treated as new.
    const prior = await PartyLinkSuggestion.findOne({ code: m.best.code, candidate: party._id }).lean();
    const saidSeparate = prior && prior.decision === 'separate';
    if (!saidSeparate) {
      if (apply && !prior) {
        await PartyLinkSuggestion.create({
          code: m.best.code, accountName: m.best.name, kind: m.best.paymentType === 'cash' ? 'cash' : 'tax',
          candidate: party._id, candidateName: party.name, score: m.score, decision: 'pending', party: m.best._id,
        }).catch(() => {});
      }
      return { level: 'review', best: m.best, score: m.score, queued: !prior };
    }
  }

  let type = party.paymentType === 'cash' || party.paymentType === 'tax' ? party.paymentType : '';
  if (!type && (paymentType === 'cash' || paymentType === 'tax')) type = paymentType;
  if (!type) {
    const agg = await mongoose.connection.collection('operationsworkflows').aggregate([
      { $match: { username: { $in: names }, paymentType: { $in: ['cash', 'tax'] } } },
      { $group: { _id: '$paymentType', n: { $sum: 1 } } }, { $sort: { n: -1 } }, { $limit: 1 },
    ]).toArray();
    type = agg[0]?._id || '';
  }
  if (!type) return { level: 'unknown' };
  let code = '';
  if (apply) {
    const { nextPartyCode } = require('./partyCode');
    // Race on the next code: the unique index rejects the second, which retries with the next one.
    for (let i = 0; i < 5 && !code; i += 1) {
      const next = await nextPartyCode(type);
      try {
        const r = await CollectionsParty.updateOne(
          { _id: party._id, $or: [{ code: '' }, { code: null }, { code: { $exists: false } }] },
          { $set: { code: next, paymentType: type } },
        );
        if (r.modifiedCount) code = next; else break;
      } catch (e) { if (e.code !== 11000) throw e; }
    }
    try { require('../controllers/collectionsLedgerController').invalidate(); } catch (_) { /* */ }
  }
  return { level: 'none', code, type };
}

module.exports = { ensureCollectionsParty, classifyCodelessParty };
