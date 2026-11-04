/**
 * Creates the Atlas Search indexes (config/workflowSearch, config/orderSearch) if missing.
 * Additive only: a search index is a separate structure, documents are not touched. `--status` prints their state; `--update` pushes changed definitions (Atlas normalizes what it stores, so they are never compared byte for byte).
 */
require('dotenv').config({ quiet: true });
const mongoose = require('mongoose');

const INDEXES = [require('../config/workflowSearch'), require('../config/orderSearch')];

(async () => {
  await mongoose.connect(process.env.MONGODB_URI);
  for (const ix of INDEXES) {
    const col = mongoose.connection.db.collection(ix.collection);
    // eslint-disable-next-line no-await-in-loop
    const existing = (await col.listSearchIndexes(ix.INDEX_NAME).toArray())[0];
    if (process.argv.includes('--status')) {
      console.log(existing ? `${ix.INDEX_NAME}: ${existing.status} queryable=${existing.queryable}` : `${ix.INDEX_NAME}: missing`);
    } else if (!existing) {
      await col.createSearchIndex({ name: ix.INDEX_NAME, definition: ix.definition() }); // eslint-disable-line no-await-in-loop
      console.log(`${ix.INDEX_NAME}: created (builds in the background)`);
    } else if (process.argv.includes('--update')) {
      await col.updateSearchIndex(ix.INDEX_NAME, ix.definition()); // eslint-disable-line no-await-in-loop
      console.log(`${ix.INDEX_NAME}: updated (rebuilds in the background; the old version serves meanwhile)`);
    } else {
      console.log(`${ix.INDEX_NAME}: exists (${existing.status})`);
    }
  }
  await mongoose.disconnect();
})().catch((e) => { console.error(e.message); process.exit(1); });
