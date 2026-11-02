/**
 * Seeds the ls2 fleet-asset registry (flatbeds, trailers, tires) from data/ls2Assets.json.
 * Idempotent upsert via the /api/ls2/assets/import logic; a tire seen on another truck is recorded as a TRANSFER.
 * Run: node src/seeds/seedLs2Assets.js
 */
require('dotenv').config({ path: require('path').join(__dirname, '../../.env') });
const mongoose = require('mongoose');
const data = require('./data/ls2Assets.json');
const assets = require('../controllers/ls2AssetsController');

(async () => {
  try {
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('Connected to MongoDB');

    const result = await new Promise((resolve, reject) => {
      assets.importAssets(
        { body: data, user: null },
        { json: resolve, status: () => ({ json: (o) => reject(new Error(o?.message || 'import failed')) }) }
      );
    });
    console.log('Seeded ls2 assets:', result.summary);
    process.exit(0);
  } catch (e) {
    console.error('Seed error:', e.message);
    process.exit(1);
  }
})();
