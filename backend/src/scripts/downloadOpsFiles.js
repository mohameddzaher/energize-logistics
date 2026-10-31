/* eslint-disable no-console */
// Downloads every file the platform archive points at into uploads/ops-archive and
// records url -> local path in `opsarchivefiles`. Resumable, deletes nothing.
//   node src/scripts/downloadOpsFiles.js [--list=/opt/energize/archive/platform/file-urls.json]
require('dotenv').config({ path: require('path').join(__dirname, '../../.env') });
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const mongoose = require('mongoose');

const argOf = (name, dflt) => (process.argv.find((a) => a.startsWith(`--${name}=`)) || '').split('=')[1] || dflt;
const LIST = argOf('list', '/opt/energize/archive/platform/file-urls.json');
const ROOT = path.join(__dirname, '../../uploads/ops-archive');
const ORIGIN = new URL(process.env.UPL_BASE_URL).origin;

async function main() {
  await mongoose.connect(process.env.MONGODB_URI || process.env.MONGO_URI);
  const store = mongoose.connection.db.collection('opsarchivefiles');
  await store.createIndex({ url: 1 }, { unique: true });
  fs.mkdirSync(ROOT, { recursive: true });
  const queue = JSON.parse(fs.readFileSync(LIST, 'utf8'));
  const have = new Set((await store.find({ ok: true }).project({ url: 1 }).toArray()).map((d) => d.url));
  let ok = 0; let failed = 0; let bytes = 0;
  const work = async () => {
    for (;;) {
      const url = queue.shift();
      if (url === undefined) return;
      if (have.has(url)) continue;
      try {
        const abs = url.startsWith('http') ? url : `${ORIGIN}${url}`;
        const res = await fetch(abs, { signal: AbortSignal.timeout(60000) });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const buf = Buffer.from(await res.arrayBuffer());
        const name = `${crypto.createHash('sha1').update(url).digest('hex')}${path.extname(new URL(abs).pathname).slice(0, 8)}`;
        const dir = path.join(ROOT, name.slice(0, 2));
        fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(path.join(dir, name), buf);
        await store.updateOne({ url }, { $set: { ok: true, file: `/api/uploads/ops-archive/${name.slice(0, 2)}/${name}`, size: buf.length } }, { upsert: true });
        ok += 1; bytes += buf.length;
      } catch (e) {
        failed += 1;
        await store.updateOne({ url }, { $set: { ok: false, error: e.message } }, { upsert: true });
      }
      if ((ok + failed) % 500 === 0) console.log(`${ok} ok, ${failed} failed, ${(bytes / 1e6).toFixed(0)} MB, ${queue.length} left`);
    }
  };
  await Promise.all([work(), work(), work(), work(), work(), work()]);
  console.log(`done: ${ok} ok, ${failed} failed, ${(bytes / 1e6).toFixed(0)} MB`);
  await mongoose.disconnect();
}
main().catch((e) => { console.error(e.message); process.exit(1); });
