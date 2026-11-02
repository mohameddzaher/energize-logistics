/**
 * seedCollectionsParties: build the customer and vendor registers for the collections section from data already in the system, not from an imported file. Usage: node src/scripts/seedCollectionsParties.js [--dry] Source: operations workflow
 * statements tell who we actually deal with and what is owed each way. Registers are then enriched from other company records (contact numbers, commercial registration, IBAN), which statements lack and which anyone chasing an invoice needs.
 * Duplicates are folded before writing: one name is written in many forms (hamza here, taa marbuta there, a different letter variant), and writing each as a row would split our largest vendor into four, the same fault that split one logistics
 * company into two rows in analytics. Screen corrections are not overwritten: the script fills blanks and never overwrites an existing value, so a hand-corrected phone survives reruns and rerunning changes nothing.
 */
require('dotenv').config();
const mongoose = require('mongoose');
const CollectionsParty = require('../models/CollectionsParty');
const { fold } = require('../models/CollectionsParty');

const DRY = process.argv.includes('--dry');

const s = (v) => String(v == null ? '' : v).trim();

// Auto-generated email is not an email: addresses like `driver_...@temp.local` and `user_350@migrated.upl.com` were invented by the platform to pass validation and nobody reads them. Storing them in a collections record could send a payment request there. A missing value is not a value.
const PLACEHOLDER_EMAIL = /@(temp\.local|migrated\.upl\.com|example\.com|test\.com)$/i;
const cleanEmail = (v) => {
  const e = s(v).toLowerCase();
  return !e || PLACEHOLDER_EMAIL.test(e) ? '' : e;
};

// A name that does not distinguish a party does not become a record: placeholders such as '-', 'unknown', 'null' and test rows. Under three characters is too short to build a customer file on.
const JUNK = new Set(['-', '—', 'na', 'n/a', 'null', 'undefined', 'غير معروف', 'بدون', 'test', 'لا يوجد']);
const usableName = (v) => {
  const n = s(v);
  if (!n || n.length < 3) return false;
  if (JUNK.has(n.toLowerCase())) return false;
  if (/^__.*__/.test(n)) return false; // CRUD test rows
  return true;
};

/** One record in the map: blanks are filled, existing values are never overwritten. */
function upsertLocal(map, name, patch, source) {
  if (!usableName(name)) return;
  const key = fold(name);
  if (!key) return;
  let e = map.get(key);
  if (!e) {
    e = { nameKey: key, names: new Map(), sources: new Set(), data: {} };
    map.set(key, e);
  }
  e.names.set(s(name), (e.names.get(s(name)) || 0) + (patch.__weight || 1));
  e.sources.add(source);
  for (const [k, v] of Object.entries(patch)) {
    if (k === '__weight') continue;
    const val = typeof v === 'number' ? v : s(v);
    if (val === '' || val === 0 || val == null) continue;
    if (e.data[k] === undefined || e.data[k] === '' ) e.data[k] = val;
  }
}

async function build(db) {
  const customers = new Map();
  const suppliers = new Map();
  const W = db.collection('operationsworkflows');

  // 1. Statements: who we actually deal with
  // The weight is the statement count, so the displayed name is the most frequent spelling, not the first by chance.
  const custRows = await W.aggregate([
    { $match: { username: { $nin: [null, ''] } } },
    { $group: { _id: '$username', n: { $sum: 1 }, phone: { $last: '$userPhone' } } },
  ]).toArray();
  for (const r of custRows) upsertLocal(customers, r._id, { phone: r.phone, __weight: r.n }, 'operations_workflow');

  const suppRows = await W.aggregate([
    { $match: { carOwner: { $nin: [null, ''] } } },
    { $group: { _id: '$carOwner', n: { $sum: 1 }, phone: { $last: '$ownerPhone' } } },
  ]).toArray();
  for (const r of suppRows) upsertLocal(suppliers, r._id, { phone: r.phone, __weight: r.n }, 'operations_workflow');

  // 2. Customers from shipment orders, fleet and CRM
  for (const r of await db.collection('shipmentordercustomers').find({}).toArray()) {
    upsertLocal(customers, r.name, { phone: r.phone, email: cleanEmail(r.email), partyType: r.customerType === 'individual' ? '' : '' }, 'shipment_orders');
  }
  for (const r of await db.collection('fleetcustomers').find({}).toArray()) {
    upsertLocal(customers, r.name, { phone: r.phone, email: cleanEmail(r.email), paymentTerms: '' }, 'fleet');
  }
  for (const r of await db.collection('crmcompanies').find({}).toArray()) {
    upsertLocal(customers, r.name, { phone: r.phone || r.whatsapp, email: cleanEmail(r.email) }, 'crm');
  }

  // 3. Vendors: the platform holds the commercial identity and bank account
  // These are what a payer needs: a transfer needs an IBAN, an invoice needs a tax number, and discussing a voucher needs the vendor's accountant, not its owner.
  for (const r of await db.collection('shipmentordersuppliers').find({}).toArray()) {
    upsertLocal(suppliers, r.name, {
      phone: r.phone || r.ownerPhone,
      email: cleanEmail(r.email),
      contactPerson: r.managerName || r.ownerName,
      contactPhone: r.managerPhone || r.ownerPhone,
      accountantName: r.accountantName,
      accountantPhone: r.accountantPhone,
      commercialRegister: r.commercialRegister,
      taxNumber: r.taxCard,
      iban: r.iban,
      bankName: r.bankName,
      address: r.nationalAddress,
      paymentTerms: r.paymentTerms,
    }, 'shipment_orders');
  }
  for (const r of await db.collection('contractvendors').find({}).toArray()) {
    upsertLocal(suppliers, r.name, {
      phone: r.phone,
      contactPerson: r.contactPerson,
      commercialRegister: r.crNumber,
      city: r.headquarters,
      paymentTerms: r.paymentTermDays ? `net_${r.paymentTermDays}` : '',
    }, 'contracts');
  }
  for (const r of await db.collection('crmvendors').find({}).toArray()) {
    upsertLocal(suppliers, r.name, {
      phone: r.mobile,
      contactPerson: r.representative,
      city: r.headOffice,
      partyType: r.vendorType,
    }, 'crm');
  }

  return { customers, suppliers };
}

/** Displayed name: the most frequent of the spellings. */
const bestName = (names) => [...names.entries()].sort((a, b) => b[1] - a[1])[0][0];

/**
 * Write in one round trip, not one per row.
 * Four thousand `findById` plus `save` calls are eight thousand round trips to a cluster with 90 ms latency, ten minutes of waiting for megabytes of work. Existing rows are read once, the diff is computed in the node, and only what changed is written, in one batch.
 */
async function writeKind(kind, map) {
  const existing = await CollectionsParty.find({ kind }).lean();
  const byKey = new Map(existing.map((e) => [e.nameKey, e]));

  let created = 0; let enriched = 0; let untouched = 0;
  const toInsert = [];
  const ops = [];

  for (const e of map.values()) {
    const name = bestName(e.names);
    const source = [...e.sources].join('+');
    const cur = byKey.get(e.nameKey);

    if (!cur) {
      toInsert.push({ kind, name, nameKey: e.nameKey, source, ...e.data });
      created += 1;
      continue;
    }
    // Only blanks are filled, so a hand-corrected value stays as it was.
    const $set = {};
    for (const [k, v] of Object.entries(e.data)) {
      if (cur[k] === undefined || cur[k] === '' || cur[k] === null) $set[k] = v;
    }
    if (!cur.source) $set.source = source;
    if (Object.keys($set).length) {
      ops.push({ updateOne: { filter: { _id: cur._id }, update: { $set } } });
      enriched += 1;
    } else untouched += 1;
  }

  if (!DRY) {
    if (toInsert.length) {
      // `insertMany` skips pre('save'), so the folded key is computed by hand above.
      for (let i = 0; i < toInsert.length; i += 500) {
        await CollectionsParty.insertMany(toInsert.slice(i, i + 500), { ordered: false });
      }
    }
    for (let i = 0; i < ops.length; i += 500) {
      await CollectionsParty.bulkWrite(ops.slice(i, i + 500), { ordered: false });
    }
  }
  return { created, enriched, untouched, total: map.size };
}

(async () => {
  await mongoose.connect(process.env.MONGODB_URI);
  const db = mongoose.connection.db;
  console.log(DRY ? '— تجربة، بلا كتابة —\n' : '');

  const { customers, suppliers } = await build(db);

  const c = await writeKind('customer', customers);
  const v = await writeKind('supplier', suppliers);

  const line = (label, r) =>
    `${label}: ${r.total} طرفًا بعد طيّ التكرار — أُنشئ ${r.created}، أُثري ${r.enriched}، بلا تغيير ${r.untouched}`;
  console.log(line('العملاء', c));
  console.log(line('الموردون', v));

  // How many have statements: tells whether the register is alive or just an address book.
  const W = db.collection('operationsworkflows');
  const withReports = async (field) => {
    const rows = await W.aggregate([{ $match: { [field]: { $nin: [null, ''] } } }, { $group: { _id: `$${field}` } }]).toArray();
    return new Set(rows.map((r) => fold(r._id)).filter(Boolean)).size;
  };
  console.log(`\nمنهم في الكشوف: ${await withReports('username')} عميلًا · ${await withReports('carOwner')} موردًا`);

  await mongoose.disconnect();
})().catch((e) => { console.error(e); process.exit(1); });
