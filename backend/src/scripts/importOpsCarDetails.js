/* eslint-disable no-console */
// Fills truck brand and colour from each car's detail on the platform: the car list
// leaves them out, so 14,000 trucks printed blank waybills. Reads the platform whatever
// UPL_DISABLED says and only fills empty fields. Resumable. Dry run unless --apply.
//   node src/scripts/importOpsCarDetails.js [--apply]
require('dotenv').config({ path: require('path').join(__dirname, '../../.env') });
delete process.env.UPL_DISABLED;
const mongoose = require('mongoose');
const upl = require('../services/uplClient');

const ar = (v) => { const n = v?.name; return String((n && typeof n === 'object' ? n.ar || n.en : n) || '').trim(); };

async function main() {
  const apply = process.argv.includes('--apply');
  await mongoose.connect(process.env.MONGODB_URI || process.env.MONGO_URI);
  const { db } = mongoose.connection;
  const vehicles = db.collection('shipmentordervehicles');
  const cars = await db.collection('opsarchives').find({ resource: 'cars' }).project({ externalId: 1 }).toArray();
  const done = new Set((await db.collection('opsarchives').find({ resource: 'car-details' }).project({ externalId: 1 }).toArray()).map((d) => d.externalId));
  const queue = cars.map((c) => c.externalId).filter((id) => !done.has(id));
  let read = 0; let failed = 0; let filled = 0; let matched = 0;
  const work = async () => {
    for (;;) {
      const id = queue.shift();
      if (id === undefined) return;
      try {
        const o = await upl.get(`/admin/cars/${encodeURIComponent(id)}`);
        const c = o.data ?? o;
        read += 1;
        const brand = ar(c.car_brand); const color = ar(c.car_color);
        const rows = await vehicles.find({ externalId: String(id) }).project({ brand: 1, color: 1 }).toArray();
        matched += rows.length;
        if (apply) {
          await db.collection('opsarchives').updateOne({ resource: 'car-details', externalId: String(id) }, { $set: { data: c } }, { upsert: true });
          for (const v of rows) {
            const set = {};
            if (brand && !v.brand) set.brand = brand;
            if (color && !v.color) set.color = color;
            if (Object.keys(set).length) { await vehicles.updateOne({ _id: v._id }, { $set: set }); filled += 1; }
          }
        } else if (rows.some((v) => (brand && !v.brand) || (color && !v.color))) filled += 1;
      } catch (e) { failed += 1; }
      if ((read + failed) % 1000 === 0) console.log(`${read} read, ${failed} failed, ${filled} filled, ${queue.length} left`);
      if (!apply && read >= 300) { queue.length = 0; return; }
    }
  };
  await Promise.all([work(), work(), work(), work()]);
  console.log(`done: ${read} read, ${failed} failed, ${matched} matched, ${filled} ${apply ? 'filled' : 'would fill'}`);
  await mongoose.disconnect();
}
main().catch((e) => { console.error(e.message); process.exit(1); });
