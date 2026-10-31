/* eslint-disable no-console */
// Copies everything the operations platform holds into OpsArchive, plus a gz file
// per resource, and lists every file URL found. Only reads the platform, safe to
// re-run: records update in place and nothing is deleted. Stops short of nothing:
// a resource that fails is reported at the end and the rest still run.
//   node src/scripts/archiveOpsPlatform.js [--timelines] [--backup-dir=/opt/energize/archive/platform]
require('dotenv').config({ path: require('path').join(__dirname, '../../.env') });
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const mongoose = require('mongoose');
const upl = require('../services/uplClient');
const { OPS_RESOURCES } = require('../config/opsResources');
const OpsArchive = require('../models/OpsArchive');

const argOf = (name, dflt) => (process.argv.find((a) => a.startsWith(`--${name}=`)) || '').split('=')[1] || dflt;
const DIR = argOf('backup-dir', '/opt/energize/archive/platform');
const URL_RX = /https?:\/\/[^\s"'<>]+\.(?:pdf|jpe?g|png|webp|gif|docx?|xlsx?|heic)|\/uploads\/[^\s"'<>]+/gi;
const flat = (v) => JSON.stringify(v);

async function fetchAll(p) {
  const all = [];
  for (let page = 1; page < 5000; page += 1) {
    const out = await upl.get(p, { query: { page, limit: 100 } });
    const d = out.data ?? out;
    const items = Array.isArray(d) ? d : (d.items || []);
    all.push(...items);
    if (Array.isArray(d) || !items.length || !(d.meta?.hasNextPage ?? (page < (d.meta?.totalPages || 0)))) break;
  }
  return all;
}

async function save(resource, items) {
  const ops = items.map((x, i) => {
    const text = flat(x);
    const when = x.created_at ? new Date(x.created_at) : null;
    return {
      updateOne: {
        filter: { resource, externalId: String(x.id ?? x._id ?? x.key ?? i) },
        update: {
          $set: {
            data: x, searchText: text.slice(0, 4000), status: String(x.status ?? ''),
            externalCreatedAt: when && !Number.isNaN(when.getTime()) ? when : null,
          },
        },
        upsert: true,
      },
    };
  });
  for (let i = 0; i < ops.length; i += 1000) await OpsArchive.bulkWrite(ops.slice(i, i + 1000), { ordered: false });
}

async function timelines(ids) {
  let done = 0; let failed = 0; const queue = [...ids];
  const have = new Set((await OpsArchive.find({ resource: 'shipment-timelines' }).select('externalId').lean()).map((d) => d.externalId));
  const work = async () => {
    for (;;) {
      const id = queue.shift();
      if (id === undefined) return;
      if (have.has(String(id))) continue;
      try {
        const out = await upl.get(`/admin/shipments/timeline/${encodeURIComponent(id)}`);
        await OpsArchive.updateOne({ resource: 'shipment-timelines', externalId: String(id) }, { $set: { data: { id, timeline: out.data ?? out } } }, { upsert: true });
        done += 1;
      } catch (e) { failed += 1; }
      if ((done + failed) % 500 === 0) console.log(`timelines ${done} ok, ${failed} failed, ${queue.length} left`);
    }
  };
  await Promise.all([work(), work(), work(), work()]);
  console.log(`timelines done: ${done} new, ${failed} failed`);
}

async function main() {
  await mongoose.connect(process.env.MONGODB_URI || process.env.MONGO_URI);
  fs.mkdirSync(DIR, { recursive: true });
  const urls = new Set(); const errors = []; const counts = {}; let shipmentIds = [];
  for (const [resource, cfg] of Object.entries(OPS_RESOURCES)) {
    try {
      const items = await fetchAll(cfg.path);
      await save(resource, items);
      fs.writeFileSync(path.join(DIR, `${resource}.json.gz`), zlib.gzipSync(JSON.stringify(items)), { mode: 0o600 });
      for (const m of flat(items).match(URL_RX) || []) urls.add(m);
      counts[resource] = items.length;
      if (resource === 'shipments') shipmentIds = items.map((s) => s.id);
      console.log(`${resource}: ${items.length}`);
    } catch (e) { errors.push(`${resource}: ${e.message}`); console.log(`FAILED ${resource}: ${e.message}`); }
  }
  fs.writeFileSync(path.join(DIR, 'file-urls.json'), JSON.stringify([...urls], null, 0), { mode: 0o600 });
  console.log(JSON.stringify({ counts, fileUrls: urls.size, errors }));
  if (process.argv.includes('--timelines')) await timelines(shipmentIds);
  await mongoose.disconnect();
}
main().catch((e) => { console.error(e.message); process.exit(1); });
