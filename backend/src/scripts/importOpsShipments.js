/* eslint-disable no-console */
/**
 * Move operations platform shipments into shipment orders and keep them in sync.
 * Usage: --dry; --yes (new and modified); --yes --full (from the first page).
 * A copy, not a mirror: the operations platform section reads an external system live and stops when it does, and its data cannot be analyzed or filtered beyond what it allows. Shipments are copied so they can be analyzed, filtered and exported, and worked on if the platform stops.
 * The dispatch sheet number stays theirs, not renumbered, so the team can continue on it. Our own shipments are numbered from our counter with a letter prefix (E-500), so two numbers never clash even if the digits coincide. Sync updates changed rows and never duplicates: matching is by platform id. A normal run stops at the first page with nothing new (sorted by last modified), so the daily sync takes seconds; --full scans everything.
 */
require('dotenv').config({ path: require('path').join(__dirname, '../../.env') });
const mongoose = require('mongoose');
const upl = require('../services/uplClient');

const DRY = !process.argv.includes('--yes');
const FULL = process.argv.includes('--full');

const n = (v) => (v === null || v === undefined ? '' : String(v).trim());
const num = (v) => { const x = Number(v); return Number.isFinite(x) ? x : null; };
const date = (v) => { if (!v) return null; const d = new Date(v); return Number.isNaN(d.getTime()) ? null : d; };
const label = (v) => (v && typeof v === 'object' ? n(v.ar) || n(v.en) : n(v));

/** Platform statuses to ours; the keys are intentionally the same and anything odd is mapped to the closest. */
// One mapping. A second copy of mapShipment used to live here, so a field fixed in the sync service stayed wrong here and polling and the full transfer disagreed. The source is now single, with only the original creation date added, which the full transfer keeps and live polling does not need.
const { mapShipment: mapCore } = require('../services/shipmentOrderSyncService');
const mapShipment = (x) => ({ ...mapCore(x), createdAt: date(x.created_at) || new Date() });

(async () => {
  console.log('\n' + '='.repeat(74));
  console.log(DRY ? '  نقلُ شحنات المنصّة — تجربةٌ فقط' : `  نقلُ شحنات المنصّة — تنفيذ${FULL ? ' (كامل)' : ' (الجديد والمعدَّل)'}`);
  console.log('='.repeat(74));
  if (!upl.isConfigured()) { console.error('  ✗ اتّصالُ المنصّة غير مهيّأ'); process.exit(1); }

  await mongoose.connect(process.env.MONGODB_URI);
  const ShipmentOrder = require('../models/ShipmentOrder');

  const known = new Map();
  for (const d of await ShipmentOrder.find({ source: 'platform' }).select('externalId updatedAt status').lean()) {
    if (d.externalId) known.set(String(d.externalId), d);
  }
  console.log(`  عندنا الآن: ${known.size} شحنةً منقولة`);

  let page = 1; let seen = 0; let created = 0; let updated = 0; let total = null;
  let quietPages = 0;
  for (;;) {
    // eslint-disable-next-line no-await-in-loop
    // The platform ignores sort and always returns creation order; see jobs/opsPoll.
    const r = await upl.get('/admin/shipments', { query: { limit: 100, page } });
    const d = (r && r.data) || {};
    const items = d.items || [];
    total = d.meta ? d.meta.totalItems : total;
    if (!items.length) break;

    const ops = [];
    for (const x of items) {
      seen += 1;
      const mapped = mapShipment(x);
      if (!mapped.externalId) continue;
      const hit = known.get(mapped.externalId);
      if (hit) { updated += 1; ops.push({ updateOne: { filter: { externalId: mapped.externalId }, update: { $set: mapped } } }); }
      else { created += 1; ops.push({ insertOne: { document: { ...mapped, updatedAt: new Date() } } }); }
    }
    const newHere = ops.filter((o) => o.insertOne).length;
    quietPages = newHere ? 0 : quietPages + 1;

    if (!DRY && ops.length) {
      // eslint-disable-next-line no-await-in-loop
      try { await ShipmentOrder.bulkWrite(ops, { ordered: false }); }
      catch (e) { console.error(`\n     ! صفحة ${page}: ${e.message.split('\n')[0]}`); }
    }
    process.stdout.write(`\r  صفحة ${page} · مقروء ${seen}${total ? '/' + total : ''} · جديد ${created} · محدَّث ${updated}      `);

    // A normal run stops after two pages with nothing new: sorted by last modified, new items come first and the rest was already read.
    if (!FULL && quietPages >= 2) { console.log('\n  (وقفَ عند صفحتين بلا جديد — أضف --full لمسح الكلّ)'); break; }
    if (!d.meta || !d.meta.hasNextPage) break;
    page += 1;
  }

  console.log(`\n  ${DRY ? 'كان سيُنشأ' : 'أُنشئ'} ${created} · ${DRY ? 'كان سيُحدَّث' : 'حُدِّث'} ${updated}`);
  if (!DRY) {
    const byS = await ShipmentOrder.aggregate([{ $group: { _id: '$source', n: { $sum: 1 } } }]);
    console.log('\n  في القسم الآن:');
    byS.forEach((x) => console.log(`     ${x._id === 'platform' ? 'من المنصّة' : 'من نظامنا'}: ${x.n}`));
  } else console.log('\n  — تجربةٌ فقط.');
  console.log('');
  await mongoose.disconnect();
})().catch(async (e) => { console.error(e); try { await mongoose.disconnect(); } catch (_) {} process.exit(1); });
