/**
 * Seed / refresh company licenses & subscriptions (التراخيص والاشتراكات) from
 * backend/src/seeds/data/companyLicenses.json.
 *
 * Run:  node src/scripts/seedCompanyLicenses.js
 *
 * Idempotent: upserts by (category + name), so re-running updates in place
 * (e.g. a new expiry date) instead of duplicating rows.
 */
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const mongoose = require('mongoose');
const CompanyLicense = require('../models/CompanyLicense');

const DATA_FILE = path.join(__dirname, '..', 'seeds', 'data', 'companyLicenses.json');

(async () => {
  if (!fs.existsSync(DATA_FILE)) {
    console.error(`\n❌ Data file not found:\n   ${DATA_FILE}\n`);
    process.exit(1);
  }
  const records = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
  if (!Array.isArray(records) || !records.length) { console.error('No records found in the data file.'); process.exit(1); }

  await mongoose.connect(process.env.MONGODB_URI);

  const ops = records
    .filter((r) => r && r.name && r.category)
    .map((r) => ({
      updateOne: {
        filter: { category: r.category, name: r.name },
        update: { $set: { category: r.category, name: r.name, duration: r.duration || '', expiryDate: r.expiryDate || '', location: r.location || '' } },
        upsert: true,
      },
    }));

  const res = await CompanyLicense.bulkWrite(ops, { ordered: false });
  const total = await CompanyLicense.countDocuments();
  console.log(`✅ Seeded company licenses — created ${res.upsertedCount || 0}, updated ${res.modifiedCount || 0}. Total now: ${total}`);
  await mongoose.disconnect();
})().catch((e) => { console.error('Seed error:', e.message); process.exit(1); });
