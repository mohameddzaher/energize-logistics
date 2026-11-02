/**
 * Collapses double spaces in customer names.
 * Two spaces hide a customer from anyone searching: our search folds spaces (utils/plateKey flexSpaceRegex) but the operations platform searches literally, so users get no results and think the customer was deleted. Only the extra space is removed, in the platform first (the source), then collections and statements via utils/renameOpsCustomer.
 * Preview by default; --apply writes to an external system.
 * Usage: node src/scripts/squeezeCustomerNameSpaces.js [--apply]
 */
require('dotenv').config({ quiet: true });
const mongoose = require('mongoose');
const upl = require('../services/uplClient');

const S = (v) => String(v ?? '');
const squeeze = (v) => S(v).replace(/\s+/g, ' ').trim();
const odd = (v) => S(v) !== squeeze(v);

(async () => {
  const apply = process.argv.includes('--apply');
  await mongoose.connect(process.env.MONGODB_URI);
  if (!upl.isConfigured()) { console.log('منصّة التشغيل غير مهيّأة'); process.exit(1); }

  const users = [];
  for (let page = 1; ; page += 1) {
    const out = await upl.get('/admin/users', { query: { limit: 100, page } });
    const d = out?.data ?? out;
    users.push(...(d?.items || d?.data || []));
    if (!d?.meta?.hasNextPage || page > 40) break;
  }

  const W = mongoose.connection.collection('operationsworkflows');
  const CollectionsParty = require('../models/CollectionsParty');

  // Names on the platform, plus names in our register that may no longer exist there (old customer removed from the platform).
  const targets = new Map();
  for (const u of users) if (odd(u.name)) targets.set(S(u.name), { id: u.id || u._id });
  const parties = await CollectionsParty.find({ kind: 'customer' }).select('name code').lean();
  for (const p of parties) if (odd(p.name)) if (!targets.has(p.name)) targets.set(p.name, { id: null });

  if (!targets.size) { console.log('لا اسمَ فيه مسافةٌ زائدة.'); process.exit(0); }
  console.log(`أسماءٌ فيها مسافةٌ زائدة: ${targets.size}`);
  for (const [name, t] of targets) {
    const sheets = await W.countDocuments({ username: name });
    console.log(`  «${name}» ← «${squeeze(name)}» · كشوف: ${sheets}${t.id ? '' : ' · ليس في المنصّة'}`);
  }

  if (!apply) { console.log('\n— تجربةٌ فقط —'); process.exit(0); }

  const { renameOpsCustomer } = require('../utils/renameOpsCustomer');
  let ok = 0;
  for (const [name, t] of targets) {
    const to = squeeze(name);
    try {
      if (t.id) await upl.patch(`/admin/users/${encodeURIComponent(t.id)}`, { body: { name: to } });
      const r = await renameOpsCustomer(name, to);
      ok += 1;
      console.log(`✓ «${name}» ← «${to}»${r ? ` · كشوف: ${r.sheets}` : ''}`);
    } catch (e) {
      console.log(`✗ «${name}»: ${e.message}`);
    }
  }
  console.log(`\nتمّ: ${ok} من ${targets.size}`);
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
