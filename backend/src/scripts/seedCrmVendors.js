/**
 * Seed / refresh CRM vendors from a JSON file.
 *
 * 1) Save the full vendor JSON the user provided to:
 *      backend/src/seeds/data/crmVendors.json
 *    (either the whole object with `vendors_master.records`, or a plain array of
 *     records — both are accepted.)
 * 2) Run:  node src/scripts/seedCrmVendors.js
 *
 * Idempotent: upserts by the source `id` (externalId), so re-running updates in
 * place instead of duplicating.
 */
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const mongoose = require('mongoose');
const CrmVendor = require('../models/CrmVendor');

// Accept either filename in the seeds/data folder.
const DATA_DIR = path.join(__dirname, '..', 'seeds', 'data');
const DATA_FILE = ['vendors_crm_data.json', 'crmVendors.json']
  .map((f) => path.join(DATA_DIR, f))
  .find((p) => fs.existsSync(p)) || path.join(DATA_DIR, 'crmVendors.json');

const mapRecord = (r) => ({
  externalId: typeof r.id === 'number' ? r.id : undefined,
  name: r.name,
  isNewVendor: !!r.is_new,
  energizeRep: r.energize_rep ?? undefined,
  vendorType: r.vendor_type ?? undefined,
  representative: r.vendor_representative ?? undefined,
  mobile: r.mobile != null ? String(r.mobile).trim() : undefined,
  destinations: r.destinations ?? undefined,
  headOffice: r.head_office ?? undefined,
  carsCount: typeof r.cars_count === 'number' ? r.cars_count : null,
  hasPapers: typeof r.has_papers === 'boolean' ? r.has_papers : null,
  vendorSideSigned: typeof r.vendor_side_contract_signed === 'boolean' ? r.vendor_side_contract_signed : null,
  ourSideSigned: typeof r.our_side_signed === 'boolean' ? r.our_side_signed : null,
  contractDate: r.contract_date != null ? String(r.contract_date) : undefined,
  followUpStatus: r.follow_up_status ?? undefined,
  notes: r.notes ?? undefined,
});

(async () => {
  if (!fs.existsSync(DATA_FILE)) {
    console.error(`\n❌ Data file not found:\n   ${DATA_FILE}\n\nSave the vendor JSON there first, then re-run.\n`);
    process.exit(1);
  }
  const raw = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
  const records = Array.isArray(raw) ? raw : (raw.vendors_master && raw.vendors_master.records) || raw.records || [];
  if (!records.length) { console.error('No records found in the data file.'); process.exit(1); }

  await mongoose.connect(process.env.MONGODB_URI);

  let created = 0; let updated = 0; let skipped = 0;
  const ops = [];
  for (const r of records) {
    if (!r || !r.name) { skipped += 1; continue; }
    const doc = mapRecord(r);
    if (typeof doc.externalId === 'number') {
      ops.push({ updateOne: { filter: { externalId: doc.externalId }, update: { $set: doc }, upsert: true } });
    } else {
      // No id → match by name to avoid dupes.
      ops.push({ updateOne: { filter: { name: doc.name }, update: { $set: doc }, upsert: true } });
    }
  }
  const CHUNK = 500;
  for (let i = 0; i < ops.length; i += CHUNK) {
    const res = await CrmVendor.bulkWrite(ops.slice(i, i + CHUNK), { ordered: false });
    created += res.upsertedCount || 0;
    updated += res.modifiedCount || 0;
  }
  const total = await CrmVendor.countDocuments();
  console.log(`✅ Seeded vendors — created ${created}, updated ${updated}, skipped ${skipped}. Total vendors now: ${total}`);
  await mongoose.disconnect();
})().catch((e) => { console.error('Seed error:', e.message); process.exit(1); });
