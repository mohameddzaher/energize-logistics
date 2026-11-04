/**
 * Creates or updates the Atlas Search index of operations reports (config/workflowSearch).
 * Additive only: a search index is a separate structure, the reports are not touched. `--status` prints its state.
 */
require('dotenv').config({ quiet: true });
const mongoose = require('mongoose');
const { INDEX_NAME, definition } = require('../config/workflowSearch');

(async () => {
  await mongoose.connect(process.env.MONGODB_URI);
  const col = mongoose.connection.db.collection('operationsworkflows');
  const existing = (await col.listSearchIndexes(INDEX_NAME).toArray())[0];
  if (process.argv.includes('--status')) {
    console.log(existing ? `${INDEX_NAME}: ${existing.status} queryable=${existing.queryable}` : `${INDEX_NAME}: missing`);
  } else if (!existing) {
    await col.createSearchIndex({ name: INDEX_NAME, definition: definition() });
    console.log(`${INDEX_NAME}: created (builds in the background)`);
  } else if (JSON.stringify(existing.latestDefinition) !== JSON.stringify(definition())) {
    await col.updateSearchIndex(INDEX_NAME, definition());
    console.log(`${INDEX_NAME}: definition updated (rebuilds in the background)`);
  } else {
    console.log(`${INDEX_NAME}: up to date (${existing.status})`);
  }
  await mongoose.disconnect();
})().catch((e) => { console.error(e.message); process.exit(1); });
