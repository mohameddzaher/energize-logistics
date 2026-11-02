/* eslint-disable no-console */
/**
 * Import of operations platform registers into shipment orders.
 * Usage: --dry, --yes, and --yes --only=suppliers,customers.
 * A copy, not a mirror: the operations platform section is a live mirror of an external system, read-only, and it stops when the platform does. Shipment orders is our own system (creates the load, prints the waybill, bills), so the registers are copied in: customers, suppliers and vehicles we work on without asking another system.
 * The external id is the key, since names repeat and phones change. It is stored as externalId and matched on, so re-running updates and never duplicates. What we wrote is not overwritten: empty fields are filled and populated ones stay unless --overwrite, so a supplier number corrected on our screen is not reverted.
 */
require('dotenv').config({ path: require('path').join(__dirname, '../../.env') });
const mongoose = require('mongoose');
const upl = require('../services/uplClient');

const DRY = !process.argv.includes('--yes');
const OVERWRITE = process.argv.includes('--overwrite');
const onlyArg = process.argv.find((a) => a.startsWith('--only='));
const ONLY = onlyArg ? onlyArg.slice(7).split(',').map((x) => x.trim()) : null;

const n = (v) => (v === null || v === undefined ? '' : String(v).trim());
/** A name that may be text or a translation object {ar,en}. */
const label = (v) => (v && typeof v === 'object' ? n(v.ar) || n(v.en) : n(v));

/** Pulls all pages. The platform caps a page at 100, so the limit is requested explicitly. */
async function fetchAll(path, onPage) {
  let page = 1; let total = null; const out = [];
  for (;;) {
    // eslint-disable-next-line no-await-in-loop
    const r = await upl.get(path, { query: { limit: 100, page } });
    const d = (r && r.data) || {};
    const items = d.items || [];
    total = d.meta ? d.meta.totalItems : total;
    out.push(...items);
    if (onPage) onPage(out.length, total);
    if (!d.meta || !d.meta.hasNextPage) break;
    page += 1;
  }
  return out;
}

/** Writes one record: fills empty fields and overwrites populated ones only on request. */
function merge(doc, src) {
  let changed = 0;
  for (const [k, v] of Object.entries(src)) {
    if (v === '' || v === null || v === undefined) continue;
    const now = doc[k];
    const blank = now === undefined || now === null || now === '';
    if (blank || (OVERWRITE && String(now) !== String(v))) { doc[k] = v; changed += 1; }
  }
  return changed;
}

const RESOURCES = {
  suppliers: {
    ar: 'الموردون', path: '/admin/car-owners',
    model: () => require('../models/ShipmentOrderSupplier'),
    map: (x) => ({
      externalId: n(x.id),
      name: n(x.owner_name) || n(x.owner && x.owner.name) || n(x.car_owner_number),
      phone: n(x.owner_phone) || n(x.car_owner_number),
      email: n(x.owner && x.owner.email),
      commercialRegister: n(x.commercial_register),
      taxCard: n(x.tax_card),
      nationalAddress: n(x.national_address),
      bankName: n(x.bank_name),
      iban: n(x.iban),
      ownerName: n(x.owner_name),
      ownerPhone: n(x.owner_phone),
      managerName: n(x.manager_name),
      managerPhone: n(x.manager_phone),
      accountantName: n(x.accountant_name),
      accountantPhone: n(x.accountant_phone),
      paymentTerms: n(x.payment_terms),
      agreedPriceStatement: n(x.agreed_price_statement),
      contractFile: n(x.contract_file),
    }),
  },
  customers: {
    ar: 'العملاء', path: '/admin/users',
    model: () => require('../models/ShipmentOrderCustomer'),
    map: (x) => ({
      externalId: n(x.id),
      name: n(x.name),
      phone: n(x.phone),
      email: n(x.email),
      customerType: n(x.user_type),
      address: n(x.address),
      city: label(x.city && x.city.name),
    }),
  },
  vehicles: {
    ar: 'المركبات', path: '/admin/cars',
    model: () => require('../models/ShipmentOrderVehicle'),
    map: (x) => ({
      externalId: n(x.id),
      plate: n(x.plate_number) || n(x.car_number) || n(x.name),
      name: n(x.name),
      modelYear: n(x.car_model_year),
      recordNumber: n(x.car_record_number),
      operationCardNumber: n(x.operation_card_number),
      operationCardExpiry: n(x.operation_card_expiry),
      insuranceDetails: typeof x.insurance_details === 'object' ? JSON.stringify(x.insurance_details) : n(x.insurance_details),
    }),
  },
};

(async () => {
  console.log('\n' + '='.repeat(74));
  console.log(DRY ? '  استيراد سجلّات منصّة الأوبريشن — تجربةٌ فقط' : '  استيراد سجلّات منصّة الأوبريشن — تنفيذ');
  console.log('='.repeat(74));
  if (!upl.isConfigured()) { console.error('  ✗ اتّصالُ المنصّة غير مهيّأ'); process.exit(1); }

  await mongoose.connect(process.env.MONGODB_URI);

  for (const [key, res] of Object.entries(RESOURCES)) {
    if (ONLY && !ONLY.includes(key)) continue;
    process.stdout.write(`\n  ${res.ar}: جارٍ السحب…`);
    let rows;
    try {
      rows = await fetchAll(res.path, (got, total) => {
        process.stdout.write(`\r  ${res.ar}: ${got}${total ? '/' + total : ''}      `);
      });
    } catch (e) { console.log(`\r  ✗ ${res.ar}: ${e.message}`); continue; }
    console.log(`\r  ${res.ar}: ${rows.length} سجلًّا من المنصّة      `);

    const Model = res.model();
    const mapped = rows.map(res.map).filter((r) => r.externalId && (r.name || r.plate));
    const skipped = rows.length - mapped.length;

    // Merged records (mergedInto) are not matched; the surviving record holds their id in externalIds.
    const existing = (await Model.find({}).lean()).filter((e) => !e.mergedInto);
    const byExt = new Map(existing.filter((e) => e.externalId).map((e) => [String(e.externalId), e]));
    const byAlias = new Map();
    existing.forEach((e) => (e.externalIds || []).forEach((x) => byAlias.set(String(x), e)));
    // Records created by hand before the import are matched by name so they are not duplicated.
    const byName = new Map(existing.filter((e) => !e.externalId).map((e) => [n(e.name).toLowerCase(), e]));

    let create = 0; let update = 0;
    const plan = [];
    for (const m of mapped) {
      const alias = !byExt.get(m.externalId) && byAlias.get(m.externalId);
      const hit = byExt.get(m.externalId) || alias || byName.get(n(m.name).toLowerCase());
      if (!hit) { create += 1; plan.push({ create: true, data: m }); continue; }
      const copy = { ...hit };
      // A second platform record for a merged supplier: completes its data without changing the primary id.
      const changed = merge(copy, alias ? { ...m, externalId: undefined } : m);
      if (changed) { update += 1; plan.push({ _id: hit._id, data: copy }); }
    }
    console.log(`     يُنشأ ${create} · يُحدَّث ${update} · بلا معرّفٍ أو اسم ${skipped} · موجودٌ عندنا ${existing.length}`);

    if (DRY) continue;
    let done = 0; let failed = 0;
    for (let i = 0; i < plan.length; i += 200) {
      const chunk = plan.slice(i, i + 200);
      const ops = chunk.map((p) => (p.create
        ? { insertOne: { document: { ...p.data, isActive: true, createdAt: new Date(), updatedAt: new Date() } } }
        : { updateOne: { filter: { _id: p._id }, update: { $set: p.data } } }));
      try {
        // eslint-disable-next-line no-await-in-loop
        const r = await Model.bulkWrite(ops, { ordered: false });
        done += (r.insertedCount || 0) + (r.modifiedCount || 0);
      } catch (e) { failed += chunk.length; console.error(`     ! ${e.message.split('\n')[0]}`); }
      process.stdout.write(`\r     كُتب ${done}/${plan.length}      `);
    }
    console.log(`\r     ✓ كُتب ${done}${failed ? ` · فشل ${failed}` : ''}                `);
  }

  console.log('\n  الحصيلة:');
  for (const [key, res] of Object.entries(RESOURCES)) {
    if (ONLY && !ONLY.includes(key)) continue;
    // eslint-disable-next-line no-await-in-loop
    console.log(`     ${res.ar.padEnd(12)} ${await res.model().countDocuments()}`);
  }
  if (DRY) console.log('\n  — تجربةٌ فقط. أضف --yes للتنفيذ.');
  console.log('');
  await mongoose.disconnect();
})().catch(async (e) => { console.error(e); try { await mongoose.disconnect(); } catch (_) {} process.exit(1); });
