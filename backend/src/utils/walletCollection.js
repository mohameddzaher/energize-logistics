/**
 * Wallet collection on a cash statement.
 * Rule (owner): a rep collects from the customer and records a collection in the wallet with the settlement statement number. If the statement is cash it is collected, and shows as collected in cash invoices at that moment, not when the collections section remembers to enter it again. The date is the wallet entry's date and the amount is its amount (the sum of entries if several exist for one statement).
 * The wallet collection used to reach nothing: 36 entries on cash statements, none shown as collected on the collections screen, so customers were chased for money they had paid.
 * It follows the entry in both directions: recorded, it is written; amount, date or statement number edited, it follows (and is lifted from the old statement); deleted, the collection is lifted unless another entry remains for the statement. If the statement type changes it is reconsidered: became cash, collect; stopped being cash, lift. What the collections staff wrote by hand is never touched. `collectedByWallet` on the statement says the collection on it was written by the wallet. A collection without that flag, recorded by the department by hand (a date or collected from the ledger), is not overwritten or lifted. Once the department writes by hand on a statement (records, edits or lifts a collection) the flag becomes `false`: the statement is theirs and the wallet never returns to it (see handCollected and collectionsDeptController). Date: written exactly as the department's record-collection button does, `new Date('YYYY-MM-DD')`, midnight UTC of that day, so a wallet-collected statement and a department-collected one are identical in any filter, age or report. With several entries, the latest date: collection completed with the last payment.
 */
const { flexSpaceRegex, flexNormalize } = require('./plateKey');
const cache = require('./ttlCache');

const clean = (v) => String(v == null ? '' : v).trim();
const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
const keyOf = (v) => flexNormalize(clean(v));

// Match the full number, not containment.
// `flexSpaceRegex` matches by containment, so "1234" finds "12345". That is right for search and wrong for summing money: one statement's collection would be added to another's. So it is anchored on both ends, keeping tolerance for extra spaces and Arabic spelling.
const exactFlex = (rn) => {
  const inner = flexSpaceRegex(clean(rn)).source;
  return new RegExp(`^[\\sً-ْـ]*(?:${inner})[\\sً-ْـ]*$`, 'i');
};
// Forms of the number that are looked up by index before falling back to the regex.
const variantsOf = (rn) => {
  const t = clean(rn);
  const bare = t.replace(/\s+/g, '');
  return [...new Set([t, bare, t.toUpperCase(), t.toLowerCase(), bare.toUpperCase(), bare.toLowerCase()].filter(Boolean))];
};

const WF_FIELDS = 'reportNumber paymentType collectionDate collectedAmount cashCollectionStatus collectedByWallet invoiceNumber sellingValue';

/** The statement with this number: by index first, then by regex (a number written with a space). */
async function findWorkflow(rn) {
  const OperationsWorkflow = require('../models/OperationsWorkflow');
  if (!clean(rn)) return null;
  const exact = await OperationsWorkflow.findOne({ reportNumber: { $in: variantsOf(rn) } }).select(WF_FIELDS).lean();
  if (exact) return exact;
  return OperationsWorkflow.findOne({ reportNumber: exactFlex(rn) }).select(WF_FIELDS).lean();
}

/** Sums the collection entries: the amount is their total, the date is the latest. */
const summarise = (rows) => {
  if (!rows || !rows.length) return null;
  const dates = rows.map((r) => clean(r.date).slice(0, 10)).filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d)).sort();
  return {
    amount: r2(rows.reduce((a, r) => a + (Number(r.amount) || 0), 0)),
    date: dates.length ? dates[dates.length - 1] : null,
    count: rows.length,
  };
};

/** The wallet collection entries on this statement, grouped, or `null`. */
async function walletCollectionFor(reportNumber) {
  const rn = clean(reportNumber);
  if (!rn) return null;
  const WalletTransaction = require('../models/WalletTransaction');
  const rows = await WalletTransaction.find({ type: 'collection', deliveryStatementNumber: exactFlex(rn) })
    .select('amount date').lean();
  return summarise(rows);
}

/**
 * Is this statement in the department's hands? The flag has three states:
 * `true`  the wallet wrote it, so it follows and lifts it.
 * `false` the department wrote on it by hand (recorded, edited or lifted the collection): the wallet never returns to it, not even when the collection was deliberately lifted by hand, since restoring it at the first match would overrule the department.
 * absent  nobody touched it, unless it is collected from the ledger or the sheet, in which case it is the department's.
 */
const handCollected = (wf) => wf.collectedByWallet === false
  || (!wf.collectedByWallet && (!!wf.collectionDate || wf.cashCollectionStatus === 'collected'));

/**
 * What should be on the statement, with no writes. Read by both the sync and the backfill script.
 * @returns {{action: 'collect'|'update'|'undo'|'hand'|'none', set?: object}}
 */
function plan(wf, wallet) {
  const owned = !!wf.collectedByWallet;
  if (wallet && wallet.date && wf.paymentType === 'cash') {
    if (handCollected(wf)) return { action: 'hand' };
    const date = new Date(wallet.date); // As recordCollection writes it; see the header
    // An entry smaller than the statement value is a partial collection.
    // The rep collected part of the money: the amount is written but not the collection date, so the statement shows as partial with its remainder. The date is written when the total reaches the value (a second entry). A statement with no known value completes with what was collected, as before.
    const value = Number(wf.sellingValue) || 0;
    const partial = value > 0 && wallet.amount < value - 0.005;
    const wantDate = partial ? null : date;
    const sameDate = wantDate
      ? !!wf.collectionDate && new Date(wf.collectionDate).getTime() === wantDate.getTime()
      : !wf.collectionDate;
    const same = owned && sameDate
      && Math.abs((Number(wf.collectedAmount) || 0) - wallet.amount) < 0.01;
    if (same) return { action: 'none' };
    return {
      action: partial ? 'partial' : (owned ? 'update' : 'collect'),
      set: { collectionDate: wantDate, collectedAmount: wallet.amount, collectedByWallet: true },
    };
  }
  // No entry remains, or the statement is no longer cash: lift only what the wallet wrote.
  // The flag is cleared, not set to `false`: that is the "in the department's hands" state (see handCollected).
  if (owned) return { action: 'undo', set: { collectionDate: null, collectedAmount: 0 }, unset: { collectedByWallet: 1 } };
  return { action: 'none' };
}

const AR = { collect: 'تحصيلٌ من المحفظة', update: 'تحديثُ تحصيل المحفظة', partial: 'تحصيلٌ جزئيّ من المحفظة', undo: 'رفعُ تحصيل المحفظة' };
const ymd = (d) => (d ? new Date(d).toISOString().slice(0, 10) : '—');

/** Writes the plans, then the ledger and cache, then announces, in that order: announcing before invalidating makes the listener read stale data and lag a step (announce-before-invalidate). */
async function applyPlans(items, { user = null, reason = '' } = {}) {
  const todo = items.filter((x) => x.plan && x.plan.set);
  if (!todo.length) return [];
  const OperationsWorkflow = require('../models/OperationsWorkflow');
  const logAudit = require('./auditLogger');

  for (const { wf, plan: p } of todo) {
    const $set = { ...p.set };
    if (user && user._id) $set.lastModifiedBy = user._id;
    // eslint-disable-next-line no-await-in-loop
    await OperationsWorkflow.updateOne({ _id: wf._id }, { $set, ...(p.unset ? { $unset: p.unset } : {}) });
  }

  // The collections ledger (the cash shipment row) follows the statement, and the department and ledger caches are invalidated.
  try {
    await require('../controllers/collectionsDeptController').syncLedgerFromWorkflows(
      todo.map(({ wf, plan: p }) => ({ _id: wf._id, invoiceNumber: wf.invoiceNumber, collectionDate: p.set.collectionDate })),
      { collectionDate: true },
    );
  } catch (e) { console.error('wallet→collections ledger sync:', e.message); }
  // The workflow cache and whatever reads collection; `clear` stamps the invalidation for the other worker too.
  try {
    cache.clear('wf:');
    cache.clear('collections-dept:'); cache.clear('cdr:');
    require('../controllers/collectionsLedgerController').invalidate();
  } catch (_) { /* */ }

  for (const { wf, plan: p, wallet } of todo) {
    const details = p.action === 'undo'
      ? `${AR.undo} عن أمر النقل ${wf.reportNumber}${reason ? ` — ${reason}` : ''}`
      : `${AR[p.action]} على أمر النقل النقديّ ${wf.reportNumber}: ${wallet.amount} ريال بتاريخ ${wallet.date}`
        + `${wallet.count > 1 ? ` (مجموعُ ${wallet.count} قيود)` : ''}${reason ? ` — ${reason}` : ''}`;
    // eslint-disable-next-line no-await-in-loop
    await logAudit({
      user: user || undefined,
      bySystem: !user,
      action: 'wallet_cash_collection',
      entity: 'OperationsWorkflow',
      entityId: wf._id,
      entityKey: wf.reportNumber,
      details,
      changes: {
        details,
        before: { collectionDate: wf.collectionDate || null, collectedAmount: wf.collectedAmount || 0, collectedByWallet: !!wf.collectedByWallet },
        after: { collectionDate: p.set.collectionDate ? ymd(p.set.collectionDate) : null, collectedAmount: p.set.collectedAmount },
      },
    });
  }

  try {
    const { emitToAll } = require('../websocket/socketManager');
    // No `_id`: the operations screen replaces the row with what arrives in `workflow:updated`, so an event with an id but no row would erase the row from the screen. This one is for the cash screen (refetches), `bulkImported` is for the operations screen (refetches), and `collections:changed` is for the department board.
    emitToAll('workflow:updated', { bulk: true, collection: true, fromWallet: true });
    emitToAll('workflow:bulkImported', { fromWallet: true, collection: true, count: todo.length });
    emitToAll('collections:changed', { source: 'wallet', field: 'collectionDate', reportNumbers: todo.map((x) => x.wf.reportNumber) });
  } catch (_) { /* */ }

  return todo.map(({ wf, plan: p }) => ({ _id: wf._id, reportNumber: wf.reportNumber, action: p.action }));
}

/**
 * Matches the collection of statements with these numbers against the wallet and writes what differs.
 * Called after every create, edit, move or delete of a collection entry, and after a statement type changes.
 * @param {string|string[]} reportNumbers
 */
async function syncWalletCollection(reportNumbers, opts = {}) {
  const list = [...new Set((Array.isArray(reportNumbers) ? reportNumbers : [reportNumbers]).map(clean).filter(Boolean))];
  const items = [];
  const seen = new Set();
  for (const rn of list) {
    // eslint-disable-next-line no-await-in-loop
    const wf = await findWorkflow(rn);
    if (!wf || seen.has(String(wf._id))) continue;
    seen.add(String(wf._id));
    // eslint-disable-next-line no-await-in-loop
    const wallet = await walletCollectionFor(wf.reportNumber);
    items.push({ wf, wallet, plan: plan(wf, wallet) });
  }
  return applyPlans(items, opts);
}

/**
 * The whole match: every collection entry with a statement number, and every statement the wallet wrote.
 * Called after anything that changes payment types in bulk (sync, the payment types page, reset), and it is the backfill script itself (`apply: false` for a dry run).
 * `regexFallback`: a number not found by index is looked up by regex, a collection scan, so it is left off in periodic cycles and used in the script.
 */
async function resyncAllWalletCollections({ apply = true, regexFallback = false, ...opts } = {}) {
  const WalletTransaction = require('../models/WalletTransaction');
  const OperationsWorkflow = require('../models/OperationsWorkflow');
  const entries = await WalletTransaction.find({ type: 'collection', deliveryStatementNumber: { $nin: [null, ''] } })
    .select('deliveryStatementNumber amount date').lean();

  const groups = new Map(); // Folded key to entries
  for (const e of entries) {
    const k = keyOf(e.deliveryStatementNumber);
    if (!k) continue;
    if (!groups.has(k)) groups.set(k, { raw: clean(e.deliveryStatementNumber), rows: [] });
    groups.get(k).rows.push(e);
  }

  const variants = [...new Set([...groups.values()].flatMap((g) => g.rows.flatMap((r) => variantsOf(r.deliveryStatementNumber))))];
  const [matched, owned] = await Promise.all([
    variants.length ? OperationsWorkflow.find({ reportNumber: { $in: variants } }).select(WF_FIELDS).lean() : [],
    OperationsWorkflow.find({ collectedByWallet: true }).select(WF_FIELDS).lean(),
  ]);
  const byId = new Map();
  for (const w of [...matched, ...owned]) byId.set(String(w._id), w);
  const foundKeys = new Set([...byId.values()].map((w) => keyOf(w.reportNumber)));

  const notFound = [];
  for (const [k, g] of groups) {
    if (foundKeys.has(k)) continue;
    if (regexFallback) {
      // eslint-disable-next-line no-await-in-loop
      const w = await OperationsWorkflow.findOne({ reportNumber: exactFlex(g.raw) }).select(WF_FIELDS).lean();
      if (w) { byId.set(String(w._id), w); foundKeys.add(keyOf(w.reportNumber)); continue; }
    }
    notFound.push(g.raw);
  }

  const items = [...byId.values()].map((wf) => {
    const g = groups.get(keyOf(wf.reportNumber));
    const wallet = g ? summarise(g.rows) : null;
    return { wf, wallet, plan: plan(wf, wallet) };
  });

  const summary = {
    entries: entries.length,
    reports: groups.size,
    notFound,
    cash: items.filter((x) => x.wallet && x.wf.paymentType === 'cash').length,
    nonCash: items.filter((x) => x.wallet && x.wf.paymentType !== 'cash').length,
    byAction: items.reduce((m, x) => { m[x.plan.action] = (m[x.plan.action] || 0) + 1; return m; }, {}),
    items,
  };
  summary.applied = apply ? await applyPlans(items, opts) : [];
  return summary;
}

// From the sync: once, after it settles.
// Platform polling writes every few seconds and may change the type of a statement that has a wallet collection, so calls are coalesced into one a few seconds later; the match is three small queries.
let pending = null;
function scheduleResync(delayMs = 5000) {
  if (pending) return;
  pending = setTimeout(() => {
    pending = null;
    resyncAllWalletCollections({ reason: 'تغيّر نوع الدفع' })
      .catch((e) => console.error('wallet cash-collection resync:', e.message));
  }, delayMs);
  if (pending.unref) pending.unref();
}

module.exports = {
  syncWalletCollection, resyncAllWalletCollections, scheduleResync,
  walletCollectionFor, plan, exactFlex,
};
