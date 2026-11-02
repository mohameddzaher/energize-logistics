/**
 * opsWorkflowSyncService — mirrors UPL shipments into the internal Operations
 * workflow (dispatch-sheet) list, mapping each shipment onto the OperationsWorkflow
 * columns. The UPL-derived columns are refreshed every run; the manually-entered
 * columns (operations/accounting/invoice review, etc.) are written ONLY on first
 * insert and then left alone for the other roles to fill in.
 *
 * Deduped by (externalSource, externalId = UPL shipment id) so re-runs update in
 * place. New rows land at stage 'draft'.
 */
const upl = require('./uplClient');
const OperationsWorkflow = require('../models/OperationsWorkflow');
const { emitToAll } = require('../websocket/socketManager');
const cache = require('../utils/ttlCache');
const { arLetters } = require('../utils/arLetters');
const { derivePaymentTypeFor, ISSUED_INVOICE_EXPR, subtypeAfterAutoExpr } = require('../utils/paymentType');


const SOURCE = 'ops_upl';
const crypto = require('crypto');

/**
 * Do not rewrite what did not change. The full sync wrote all 40 thousand reports every hour, because each row carries a fresh `lastSyncedAt` and so counts as modified though nothing changed: about sixteen writes per second nonstop, replicated to three servers, inflating backups and read by every change listener; most of the DB bill.
 * Each row has a fingerprint of everything that goes into its write: platform values, canonical name, customer type, derived type, and the row's own fields that the update pipeline reads (selling value source, payment type, invoice). If it matches the last write's fingerprint the result is identical, so the row is skipped; if anything changed it is written as before. As a safety net, once a day (04:00 Riyadh time) all rows are written as before.
 */
const DOC_INPUTS = ['sellingValue', 'sellingValueSource', 'paymentType', 'paymentTypeSource', 'paymentSubtype', 'invoiceNumber', 'reportNumber', 'stage'];
const sigOf = (parts) => crypto.createHash('sha1').update(JSON.stringify(parts)).digest('hex');
const riyadhHour = () => Number(new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Riyadh', hour: '2-digit', hour12: false }).format(new Date()));
let running = false;
let timer = null;

// Localized relation label ({ name: { ar, en } } | { name: '...' } | '...').
const loc = (v) => {
  const n = v && v.name;
  if (n && typeof n === 'object') return n.ar || n.en || '';
  if (typeof n === 'string') return n;
  return typeof v === 'string' ? v : '';
};


async function fetchAllShipments() {
  const all = [];
  const limit = 100; // UPL page cap
  let page = 1;
  for (let i = 0; i < 1000; i++) {
    // The scan is complete, page by page, so order does not matter. (`sort` is ignored by the platform anyway; it always returns creation order; see jobs/opsPoll.)
    const out = await upl.get('/admin/shipments', { query: { page, limit } });
    const items = (out.data && out.data.items) || [];
    all.push(...items);
    const meta = out.data && out.data.meta;
    if (!meta || !meta.hasNextPage) break;
    page += 1;
  }
  return all;
}

function mapShipment(s) {
  const set = {
    // Report date is `pick_time`, not `created_at`. `created_at` is when the platform row was written; `pick_time` is the report's own date. They differ in about 8,700 of 33,000 shipments: a report made in November 2025 and entered in February 2026 was read as a February report, entering the reports of a month it did not occur in and leaving its own. The follow-up sheet carries `pick_time`, so the two figures disagreed for no reason.
    reportDate: s.pick_time ? new Date(s.pick_time)
      : (s.created_at ? new Date(s.created_at) : undefined),
    fromLocation: s.address_from || '',
    toLocation: s.address_to || '',
    branch: loc(s.branch),
    carOwner: arLetters(s.car?.owner?.owner_name || ''),
    carNumber: s.car?.car_number || '',
    ownerType: s.creator_type || '',
    // Store the RAW values from UPL — translation happens in the UI (so new
    // statuses the vendor adds never break / show blank).
    applicationStatus: s.status || '',
    executionStatus: s.status || '',
    paymentMethod: s.payment_method || '',
    username: s.user?.name || '',
    userPhone: s.user?.phone || '',
    purchaseValue: Number(s.purchase_price) || 0,
    sellingValue: Number(s.selling_price) || 0,
    loadingTime: s.pick_time || '',
    driverName: s.driver?.admin?.name || '',
    driverPhone: s.driver?.admin?.phone || '',
    carName: loc(s.car),
    plateNumber: s.car?.plate_number || '',
    truckType: loc(s.truck_type),
    truckSize: loc(s.truck_size),
    loadType: loc(s.load_type),
    quantity: s.qty != null ? String(s.qty) : '',
    goodsValue: Number(s.goods_value_price) || 0,
    reference: s.reference_num || '',
    representativeName: s.delegate?.name || '',
    country: loc(s.country),
    driverRentalType: s.driver_rental_type || '',
    driverCost: Number(s.driver_rental_price) || 0,
    ownerName: arLetters(s.car?.owner?.owner_name || ''),
    ownerPhone: s.car?.owner?.owner_phone || '',
    externalSource: SOURCE,
    externalId: String(s.id),
    externalUpdatedAt: s.updated_at ? String(s.updated_at) : '',
    lastSyncedAt: new Date(),
  };
  const setOnInsert = {
    reportNumber: s.graduation_statement_num != null ? String(s.graduation_statement_num) : `UPL-${s.id}`,
    stage: 'draft',
  };
  return { set, setOnInsert };
}

// Synced rows are not stamped with a person. `getSysUserId` took the first `super_admin` in the DB and set it as `createdBy` on every row the sync created, so 34 thousand reports showed as created by one admin who opened none. Platform-imported rows have no creator here, and "nobody" is more truthful than naming someone who did not do it.
// The details screen reads `externalSource` and shows "operations platform (automatic)", so the field is not empty without explanation.

// Upsert a batch of shipments into OperationsWorkflow (used by both the full sync
// and the live poll). Soft-deleted shipments (deleted_at set) are removed instead.
// Refreshes only the UPL-derived columns; manual columns are $setOnInsert-only.
/**
 * Each customer's type from the payment-types page: folded name key -> cash | tax.
 * Read once per batch, not per shipment, and cached under the `wf:` prefix, which is cleared when a customer's type is changed from that page, so the new type applies from the first sync after.
 */
/**
 * The incoming name is mapped to the canonical customer name.
 * A customer name corrected on the platform (or in our customers screen) remains in old payloads in its first form, so a sync would bring the old name and overwrite the correct one. It happened: 4,396 reports reverted to old names after name matching.
 * Every name is checked against collections party names and aliases (`aliasKeys`, which hold the old name of anyone renamed; see utils/renameOpsCustomer): if known, the canonical name is written, otherwise it stays as received. So a correction sticks and variants of one name gather on one row on every screen.
 */
/**
 * The two customer maps are not cleared with table filters.
 * They were under the `wf:` prefix, which is cleared on every report write and at the end of this function, so each sync invalidated its own maps and re-read the DB next time: measured 2.3 s for names and 1.2 s for types, four seconds for a single shipment's sync, which someone changing a status waits for.
 * They follow collections parties, not reports, so they have their own prefix: cleared when a customer is renamed or its type changed (renameOpsCustomer, paymentTypesController), not when a report field is written.
 */
async function canonicalNameMap() {
  return cache.wrap('wfparty:canonicalCustomerName', 60000, async () => {
    const CollectionsParty = require('../models/CollectionsParty');
    const rows = await CollectionsParty.find({ kind: 'customer', isActive: { $ne: false } })
      .select('name nameKey aliasKeys').lean();
    const out = {};
    for (const p of rows) {
      const name = String(p.name || '').trim();
      if (!name) continue;
      const keys = [p.nameKey || CollectionsParty.fold(name), ...(p.aliasKeys || [])];
      for (const k of keys) if (k && !out[k]) out[k] = name;
    }
    return out;
  });
}

async function customerTypeMap() {
  return cache.wrap('wfparty:paymentTypeByCustomer', 60000, async () => {
    const CollectionsParty = require('../models/CollectionsParty');
    const rows = await CollectionsParty.find({ kind: 'customer', paymentType: { $in: ['cash', 'tax'] } })
      .select('name nameKey paymentType').lean();
    const out = {};
    for (const p of rows) {
      const k = p.nameKey || CollectionsParty.fold(p.name || '');
      if (k) out[k] = p.paymentType;
    }
    return out;
  });
}

async function upsertShipments(ships, { force = false } = {}) {
  if (!ships || !ships.length) return { created: 0, updated: 0, removed: 0 };
  const live = ships.filter((s) => s && s.id && !s.deleted_at);
  const deletedIds = ships.filter((s) => s && s.id && s.deleted_at).map((s) => String(s.id));

  // Payment type is written with the report, not a week later. The sync never touched `paymentType`, so a report was born without a type and stayed empty until someone opened the payment-types page and pressed a button. As a result 4,644 reports had a payment date but no type: due for collection yet shown on no collection screen, neither cash nor tax.
  // Now derived in the sync itself: the customer type, overridden by the cash payment method if the platform states it for this payload (the only exception). See utils/paymentType.
  const typeByCustomer = await customerTypeMap();
  const canonicalName = await canonicalNameMap();
  const { fold } = require('../models/CollectionsParty');

  // What is currently written for each row: its fingerprint and the fields that go into its write.
  const existing = new Map();
  const liveIds = live.map((s) => String(s.id));
  for (let i = 0; i < liveIds.length; i += 5000) {
    const rows = await OperationsWorkflow.find({ externalSource: SOURCE, externalId: { $in: liveIds.slice(i, i + 5000) } })
      .select(['externalId', 'syncSig', ...DOC_INPUTS].join(' ')).lean();
    for (const r of rows) existing.set(String(r.externalId), r);
  }
  let skipped = 0;

  const ops = live.map((s) => {
    const { set, setOnInsert } = mapShipment(s);
    // The canonical name, not the incoming one; see canonicalNameMap.
    const canon = canonicalName[fold(set.username || '')];
    if (canon) set.username = canon;
    // Type is derived by the full rule: customer type, overridden by cash payment method for new reports only, and above both an issued invoice. See utils/paymentType; measured on `reportDate` because the rule applies from the start of September.
    const custType = typeByCustomer[fold(s.user?.name || '')] || '';
    const shipDate = s.pick_time ? new Date(s.pick_time) : (s.created_at ? new Date(s.created_at) : null);
    const derived = derivePaymentTypeFor(
      { reportDate: shipDate, paymentMethod: s.payment_method },
      custType,
    );
    const ex = existing.get(String(s.id));
    const { lastSyncedAt: _at, ...stable } = set;
    const sig = sigOf([stable, setOnInsert, derived || '', ex ? DOC_INPUTS.map((f) => ex[f] ?? null) : null]);
    if (!force && ex && ex.syncSig === sig) { skipped += 1; return null; }
    set.syncSig = sig;
    return {
      updateOne: {
        filter: { externalSource: SOURCE, externalId: String(s.id) },
        // Except a selling value corrected from the collections ledger. All fields are written from the platform except `sellingValue` when its source is the ledger: it is the reference for a cash report, and without this condition the old value returned at the first sync after the correction, and it did.
        // (An aggregation pipeline, not a plain `$set`, since the condition must read the row itself.)
        update: [
          {
            $set: {
              ...set,
              sellingValue: {
                $cond: [
                  // Likewise a value written by hand in the workflow (`manual`); see the model.
                  { $in: [{ $ifNull: ['$sellingValueSource', ''] }, ['collections_book', 'manual']] },
                  { $ifNull: ['$sellingValue', 0] },
                  set.sellingValue,
                ],
              },
              // (Formerly "a written type is not replaced; only empty ones are filled". Since a40ad1c6 the derived type is re-derived every cycle; only a manual choice and unification persist; see below.)
              // Customer type governs, overridden by an issued invoice or a manual choice. A report with an invoice number has actually been tax-invoiced, and the paper sent to the customer outranks a general type.
              // Unification is a decision that is not derived over. A report unified to its customer's type (`unified`) keeps it unless a real tax invoice is issued for it afterwards. Unification used to write `auto`, so this step re-derived it next cycle: 823 reports of tax customers that the platform called "cash" reverted to cash after each unification, and the mismatched ones returned. See isUnified in utils/paymentType.
              paymentType: derived ? {
                $switch: {
                  branches: [
                    { case: { $eq: [{ $ifNull: ['$paymentTypeSource', ''] }, 'manual'] }, then: { $ifNull: ['$paymentType', ''] } },
                    {
                      case: { $eq: [{ $ifNull: ['$paymentTypeSource', ''] }, 'unified'] },
                      then: { $cond: [ISSUED_INVOICE_EXPR, 'tax', { $ifNull: ['$paymentType', ''] }] },
                    },
                    // Only a real invoice number makes it tax; not net or tax amounts: a cash report gets a net (its payment amount) and may get a computed tax, but has no number. See hasTaxInvoice in utils/paymentType.
                    { case: ISSUED_INVOICE_EXPR, then: 'tax' },
                  ],
                  default: derived,
                },
              } : { $ifNull: ['$paymentType', ''] },
              paymentTypeSource: derived ? {
                $cond: [
                  { $in: [{ $ifNull: ['$paymentTypeSource', ''] }, ['manual', 'unified']] },
                  '$paymentTypeSource',
                  'auto',
                ],
              } : { $ifNull: ['$paymentTypeSource', ''] },
              // The family before this cycle; read by the type in the next step.
              _prevPT: { $ifNull: ['$paymentType', ''] },
            },
          },
          // The type follows the family if the sync moved it. An automatic move to tax takes the credit-with-invoice type; a move to cash clears a tax type (there are three cash types, so a person chooses). A manual choice is untouched. See subtypeAfterAuto in utils/paymentType.
          {
            $set: {
              paymentSubtype: {
                $cond: [
                  { $eq: [{ $ifNull: ['$paymentTypeSource', ''] }, 'manual'] },
                  { $ifNull: ['$paymentSubtype', ''] },
                  subtypeAfterAutoExpr('$_prevPT', { $ifNull: ['$paymentType', ''] }, { $ifNull: ['$paymentSubtype', ''] }),
                ],
              },
            },
          },
          { $unset: '_prevPT' },
          { $set: Object.fromEntries(Object.entries(setOnInsert).map(([k, v]) => [k, { $ifNull: [`$${k}`, v] }])) },
        ],
        upsert: true,
      },
    };
  });

  // A new customer enters collections with its code. The collections party register used to be filled by a manually run script, so a customer for whom operations created a report today did not appear in the section until someone ran it. The section works by code: invoices are attributed by it, the ledger is matched by it, debt is read by it; a customer without a code is shipped to but not collected from.
  // So it is created with the first report, with its type derived by the same rule as the report's type above, not a second rule that could drift.
  const { ensureCollectionsParty } = require('../utils/ensureCollectionsParty');
  const seenNames = new Map();
  for (const s of live) {
    const nm = String(s.user?.name || '').trim();
    if (!nm || seenNames.has(fold(nm))) continue;
    const custType = typeByCustomer[fold(nm)] || '';
    const shipDate = s.pick_time ? new Date(s.pick_time) : (s.created_at ? new Date(s.created_at) : null);
    seenNames.set(fold(nm), {
      name: nm,
      paymentType: custType || derivePaymentTypeFor({ reportDate: shipDate, paymentMethod: s.payment_method }, '') || '',
    });
  }
  // The customer is not looked up every cycle. A customer without a code was reclassified on every sync: reads and writes costing about 1.5 s per name, repeated every 15 seconds with nothing new (classification does not change by itself). One that was asked about is remembered for ten minutes.
  // The cache cannot hide a new customer: a name never asked about is not in it.
  const ASKED_TTL = 10 * 60 * 1000;
  let newParties = 0;
  for (const { name, paymentType } of seenNames.values()) {
    const askedKey = `wfparty:ensured:${fold(name)}`;
    if (cache.get(askedKey)) continue;
    try {
      const CP = require('../models/CollectionsParty');
      const before = await CP
        // A party that exists with a code is not returned; one that exists without a code is passed through to receive it.
        .countDocuments({ kind: 'customer', code: { $gt: '' }, $or: [{ nameKey: CP.fold(name) }, { aliasKeys: CP.fold(name) }] });
      if (before) { cache.set(askedKey, 1, ASKED_TTL); continue; }
      const p = await ensureCollectionsParty(name, { paymentType, source: 'operations_workflow' });
      cache.set(askedKey, 1, ASKED_TTL);
      // Only new ones are counted. Everything the function returned was counted, and it returns existing parties as well as created ones, so the log said "new customer" every cycle for an old one.
      if (p && p.createdAt && Date.now() - new Date(p.createdAt).getTime() < 60000) newParties += 1;
    } catch (e) {
      // A customer that was not created does not stop the shipment sync: the report enters, and the party is created in the next sync or by the department.
      console.error('[ops-sync] تعذّر إنشاء طرف التحصيل:', name, e.message);
    }
  }
  if (newParties) console.log(`[ops-sync] عملاءُ جددٌ دخلوا قسمَ التحصيل بأكوادهم: ${newParties}`);

  let created = 0; let updated = 0; let removed = 0;
  const CHUNK = 500;
  const writes = ops.filter(Boolean);
  for (let i = 0; i < writes.length; i += CHUNK) {
    let res;
    try {
      res = await OperationsWorkflow.bulkWrite(writes.slice(i, i + CHUNK), { ordered: false });
    } catch (e) {
      // A platform number that our own series already issued must not stop the
      // rest of the sync; the row stays out and the log names it.
      if (e.code !== 11000) throw e;
      console.error('[ops-sync] manifest number already issued here:', e.message);
      res = e.result || {};
    }
    created += res.upsertedCount || 0;
    updated += res.modifiedCount || 0;
  }
  if (deletedIds.length) {
    // Deleted over there stays here: our row carries work the platform never saw.
    console.log(`[ops-sync] deleted on the platform, kept here: ${deletedIds.join(',')}`);
  }
  // The sync brings new statuses and branches, and filter value lists are cached; without invalidating them a user filters on a list older than the last sync and does not see the new reports.
  if (created || updated || removed) { try { cache.clear('wf:'); } catch (e) {} }
  // A new report may already be named by customs before it reaches us. The haulage report number is written in the container move field when loaded, and the report arrives from the platform afterwards, so it is linked on arrival; see services/customsOpsLink.
  if (created) {
    require('./customsOpsLink').linkPendingMoveRefs()
      .catch((e) => console.error('[ops-sync] ربطُ كشوف التخليص:', e.message));
  }
  // The sync re-derives payment type. A report that became cash with a wallet collection on it gets collected; one that stopped being cash loses what the wallet wrote. Once, after cycles settle; see utils/walletCollection.
  if (updated || created) { try { require('../utils/walletCollection').scheduleResync(); } catch (e) {} }
  return { created, updated, removed, skipped };
}

/**
 * What we wrote is not left to wait for the polling cycle.
 * When a shipment's status is changed from our screens (orders page or workflow table), the write went only to the platform and our row kept the old status until the poll reached it, so the person who changed it saw nothing happen and changed it again. The platform is the reference, but what we wrote we know at the moment of writing: so the shipment is read back from it right after the write, our row is written and broadcast.
 * It is read back rather than assumed: the platform may return a different status (a constraint in their status sequence), and what settled there is what should be shown, not what was requested.
 * @param {string[]} ids shipment ids on the platform
 */
async function syncShipmentsById(ids) {
  const list = [...new Set((ids || []).map((x) => String(x || '').trim()).filter(Boolean))];
  if (!list.length) return { rows: [], created: 0, updated: 0, removed: 0 };
  const ships = [];
  await Promise.all(list.slice(0, 50).map(async (id) => {
    try {
      const out = await upl.get(`/admin/shipments/${encodeURIComponent(id)}`);
      const d = out?.data ?? out;
      if (d && d.id) ships.push(d);
    } catch (_) { /* Shipment could not be read; the poll will catch it up. */ }
  }));
  if (!ships.length) return { rows: [], created: 0, updated: 0, removed: 0 };
  const res = await upsertShipments(ships);

  // The shipment orders section follows too; it is our own system, not a mirror.
  try {
    const { upsertPlatformShipments } = require('./shipmentOrderSyncService');
    const r = await upsertPlatformShipments(ships);
    if (r.created || r.updated) emitToAll('shipmentOrders:updated', { source: 'platform', ...r });
  } catch (_) { /* */ }

  const rows = await OperationsWorkflow.find({
    externalSource: SOURCE, externalId: { $in: ships.map((s) => String(s.id)) },
  }).lean();

  // The event is broadcast to both workers, not one. `workflow:updated` is sent with `emitPerRole`, a loop over this worker's sockets only, because the row is masked by role before sending, so the half of clients connected to the other worker hear nothing. This event carries no row at all, only shipment numbers and statuses, so it is broadcast to all via the adapter, and each screen refetches its rows with the usual masking.
  try {
    emitToAll('workflow:bulkImported', {
      source: SOURCE, live: true, write: true,
      statuses: ships.map((s) => ({ id: String(s.id), status: String(s.status || '') })),
    });
  } catch (_) { /* */ }
  return { rows, ...res };
}

// Full reconciliation pass: pull every shipment and upsert. Heavy — runs on a
// long interval; the live poll keeps things current in between.
async function syncOnce() {
  if (running) return { skipped: 'running' };
  if (!upl.isConfigured()) return { skipped: 'not-configured' };
  running = true;
  try {
    const ships = await fetchAllShipments();
    if (!ships.length) return { total: 0 };
    const force = riyadhHour() === 4;
    const res = await upsertShipments(ships, { force });
    try { emitToAll('workflow:bulkImported', { source: SOURCE, count: ships.length }); } catch (e) {}
    console.log(`[opsWorkflowSync] full sync${force ? ' (daily full write)' : ''}: ${ships.length} shipments -> created ${res.created}, updated ${res.updated}, unchanged ${res.skipped || 0}, removed ${res.removed}`);
    return { total: ships.length, ...res };
  } catch (e) {
    console.error('[opsWorkflowSync] error:', e.message);
    return { error: e.message };
  } finally {
    running = false;
  }
}

function startOpsWorkflowSync() {
  if (timer) return;
  if (!upl.isConfigured()) {
    console.log('[opsWorkflowSync] UPL not configured — disabled');
    return;
  }
  // Full reconciliation is the safety net; the live poll (opsPoll) keeps the rows
  // current within seconds, so the full pass can run infrequently.
  const minutes = Math.max(30, parseInt(process.env.UPL_WORKFLOW_SYNC_MIN || '360', 10));
  timer = setInterval(() => { syncOnce().catch(() => {}); }, minutes * 60 * 1000);
  setTimeout(() => { syncOnce().catch(() => {}); }, 25000); // initial run after boot
  console.log(`[opsWorkflowSync] full sync scheduled every ${minutes} min (live updates via poll)`);
}

module.exports = {
  startOpsWorkflowSync, syncOnce, upsertShipments, syncShipmentsById,
};
