/**
 * 'Data owner' in the operations workflow: its filter works on what is displayed, not on one field.
 * The cell is read from three sources in order (see getWorkflows): who wrote the payment date here (`paymentDateByName`), then who recorded the purchase in the wallet, then the import source (the 'moved from the operations platform' label). The first field is written in only about 500 of 39k rows, so a list built on it alone would show 'blank' for 38k rows whose cells hold a name or the moved label, and a name seen in the table would be missing from the list.
 * The virtual column `dataOwnerShown` is therefore filtered in the same order: written name, then the wallet recorder for an unnamed statement, then the import source for the rest.
 * Why an in-memory snapshot: wallet purchases are a few thousand and the filter condition is built in a synchronous function (`buildWorkflowFilter`) read by the table, stats and export. The map is loaded before the request (`ensure`) and read in the condition (`current`). Each worker has its own snapshot with a 30-second age, about the age of the value list itself.
 */
const { walletRecorderMap } = require('./walletPayment');
const { normKey, textMatcher, BLANK_VALUES } = require('./colFilter');

const MAX_AGE_MS = 30 * 1000;
const OPS_LABEL = 'النظام';

/** Text displayed for a statement with no name and no wallet purchase, by its source. */
const importLabel = (externalSource) => {
  const ext = String(externalSource || '').trim();
  if (!ext) return '';
  return ext === 'ops_upl' ? OPS_LABEL : `مستورَد (${ext})`;
};

/** Inverse of `importLabel`: text to source, or `null` if it is not an import text. */
const sourceOfLabel = (label) => {
  if (label === OPS_LABEL) return 'ops_upl';
  const m = /^مستورَد \((.+)\)$/.exec(String(label || ''));
  return m ? m[1] : null;
};

let snap = null;          // { byName: Map<name, rn[]>, rns: string[] }
let at = 0;
let inflight = null;

async function load() {
  const WalletTransaction = require('../models/WalletTransaction');
  const raw = await WalletTransaction.distinct('purchaseDeliveryStatementNumber', { type: 'purchase' });
  // The same map the table reads, so the filter and the cell never differ for one name.
  const map = await walletRecorderMap(raw);
  const byName = new Map();
  for (const [rn, raw] of map) {
    const name = normKey(raw);
    if (!byName.has(name)) byName.set(name, []);
    byName.get(name).push(rn);
  }
  return { byName, rns: [...map.keys()], map };
}

/** Loads the snapshot if stale. Never throws: a failure keeps the last snapshot (or none). */
async function ensure(maxAgeMs = MAX_AGE_MS) {
  if (snap && Date.now() - at < maxAgeMs) return snap;
  if (!inflight) {
    inflight = load()
      .then((s) => { snap = s; at = Date.now(); return s; })
      .catch((e) => { console.error('[dataOwnerIndex]', e.message); return snap; })
      .finally(() => { inflight = null; });
  }
  return inflight;
}

const current = () => snap || { byName: new Map(), rns: [], map: new Map() };

const BLANK_NAME = { paymentDateByName: { $in: BLANK_VALUES } };

/**
 * Filter condition for values the user chose from the 'data owner' list.
 * Values are texts as displayed: a name, an import text, or '' for blank.
 */
function ownerCondition(values) {
  const { byName, rns } = current();
  const names = []; const sources = []; let blank = false;
  for (const v of values) {
    if (!normKey(v)) { blank = true; continue; }
    const src = sourceOfLabel(v);
    if (src) sources.push(src); else names.push(v);
  }
  const or = [];
  if (names.length) {
    or.push({ paymentDateByName: { $in: names.map(textMatcher) } });
    const walletRns = names.flatMap((n) => byName.get(normKey(n)) || []);
    if (walletRns.length) or.push({ $and: [BLANK_NAME, { reportNumber: { $in: walletRns } }] });
  }
  if (sources.length || blank) {
    const ext = [...sources, ...(blank ? ['', null] : [])];
    or.push({ $and: [BLANK_NAME, { reportNumber: { $nin: rns } }, { externalSource: { $in: ext } }] });
  }
  // Nothing matches the chosen values: a condition that returns no rows, not a dropped condition that returns everything.
  if (!or.length) return { _id: { $exists: false } };
  return or.length === 1 ? or[0] : { $or: or };
}

/**
 * List values and the count of each, in the same order the cell is filled.
 * `match` is the condition of the other filters (without this column's filter).
 */
async function ownerOptions(OperationsWorkflow, match) {
  const { map, rns } = await ensure();
  const and = (...c) => ({ $and: [match, ...c] });
  const [named, wallet, imported] = await Promise.all([
    OperationsWorkflow.aggregate([
      { $match: and({ paymentDateByName: { $nin: BLANK_VALUES } }) },
      { $group: { _id: '$paymentDateByName', count: { $sum: 1 } } },
    ]),
    rns.length ? OperationsWorkflow.aggregate([
      { $match: and(BLANK_NAME, { reportNumber: { $in: rns } }) },
      { $group: { _id: '$reportNumber', count: { $sum: 1 } } },
    ]) : [],
    OperationsWorkflow.aggregate([
      { $match: and(BLANK_NAME, { reportNumber: { $nin: rns } }) },
      { $group: { _id: '$externalSource', count: { $sum: 1 } } },
    ]),
  ]);
  const counts = new Map();
  const add = (k, n) => counts.set(k, (counts.get(k) || 0) + n);
  for (const r of named) add(normKey(r._id), r.count);
  for (const r of wallet) add(normKey(map.get(String(r._id || '').trim())), r.count);
  for (const r of imported) add(importLabel(r._id), r.count);
  return [...counts.entries()].map(([value, count]) => ({ value, count }));
}

/** Middleware that loads the snapshot before any request carrying this column's filter, because the condition is built synchronously in `buildWorkflowFilter` (table, stats, export and the dedicated page). */
const preload = (req, _res, next) => {
  if (req.query && req.query.cf_dataOwnerShown !== undefined) ensure().then(() => next(), () => next());
  else next();
};

module.exports = { ensure, current, ownerCondition, ownerOptions, importLabel, preload, OPS_LABEL };
