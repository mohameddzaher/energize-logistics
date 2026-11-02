/**
 * Link existing operations manifests to customs transactions, once, using strong evidence only (same as services/customsOpsLink): manifest number in a company-car move field, document number equal to one transaction's bill of lading, or to one container.
 * No guessing: ambiguous matches are not linked and links set or cleared by a person are not touched.
 * node src/scripts/backfillCustomsOpsLinks.js [--apply] [--list]; ENV_FILE=/path/to/.env targets another database.
 */
const path = require('path');
require('dotenv').config({ path: process.env.ENV_FILE || path.join(__dirname, '../../.env'), quiet: true });
const mongoose = require('mongoose');

(async () => {
  const apply = process.argv.includes('--apply');
  const list = process.argv.includes('--list');
  // The dry run writes nothing, not even an index: the model carries a new index that is built at startup.
  if (!apply) mongoose.set('autoIndex', false);
  await mongoose.connect(process.env.MONGODB_URI, apply ? {} : { autoIndex: false, autoCreate: false });
  const link = require('../services/customsOpsLink');
  const idx = await link.loadIndex();

  // Candidates: manifests cited by a transaction by number, those with a document number, and those currently linked.
  const filter = {
    $or: [
      { reportNumber: { $in: [...idx.byReport.keys()] } },
      { documentNumber: { $nin: ['', null] } },
      { customsLink: { $exists: true } },
    ],
  };
  // Shipments first: their fill reaches the rows, and resolveShipments has no dry run.
  if (apply) {
    const shipments = await link.resolveShipments({ $or: [{ blNumber: { $nin: ['', null] } }, { containerNumber: { $nin: ['', null] } }, { customsLink: { $exists: true } }] }, { emit: false });
    console.log(`shipments changed: ${shipments.changed}`);
  }
  filter.$or.push({ shipmentOrder: { $type: 'objectId' } });
  const res = await link.resolveReports(filter, { dryRun: !apply, emit: false });

  const byVia = {}; const clearances = new Set(); let unlink = 0;
  for (const c of res.changes) {
    if (!c.to) { unlink += 1; continue; }
    byVia[c.to.via] = (byVia[c.to.via] || 0) + 1;
    clearances.add(String(c.to.clearance));
  }
  console.log(apply ? '── كُتب ──' : '── تجربة (لم يُكتب شيء) ──');
  console.log({ candidates: 'reports with a move ref, a documentNumber, or an existing link', changes: res.changed, byVia, unlink, clearances: clearances.size });
  if (list) {
    for (const c of res.changes) {
      console.log(c.reportNumber, '→', c.to ? `${c.to.refNumber} (${c.to.via}) BL ${c.to.blNumber} ${c.to.containers.join(',')}` : 'unlink');
    }
  }
  if (apply && res.changed) {
    // Screens in both workers read from their cache, so clear what reads the link before closing.
    const cache = require('../utils/ttlCache');
    for (const p of ['wf:', 'collections-dept:', 'cdr:', 'colledger:', 'customslink:']) await cache.clearShared(p).catch(() => {});
  }
  await mongoose.disconnect();
})().catch((e) => { console.error(e); process.exit(1); });
