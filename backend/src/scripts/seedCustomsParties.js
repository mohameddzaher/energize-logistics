/**
 * seedCustomsParties: build customer and shipping-agent files from existing transactions.
 * Usage: node src/scripts/seedCustomsParties.js [--yes]
 * Names exist in transactions as text since the first import. They are read, a file is built for each, and transactions are linked to it. Nothing is invented: what is not in the transactions is not written.
 */
require('dotenv').config();
const mongoose = require('mongoose');
const CustomsClearance = require('../models/CustomsClearance');
const CustomsParty = require('../models/CustomsParty');
const { fold } = require('../models/CustomsParty');

const APPLY = process.argv.includes('--yes');

(async () => {
  console.log('\n' + '='.repeat(70));
  console.log(APPLY ? '  بناءُ ملفّات أطراف التخليص — تنفيذ' : '  بناءُ ملفّات أطراف التخليص — فحصٌ فقط');
  console.log('='.repeat(70));
  await mongoose.connect(process.env.MONGODB_URI);

  const rows = await CustomsClearance.find({}).select('customerName shippingAgent shippingAgentEmail').lean();
  const customers = new Map(); const agents = new Map();
  for (const r of rows) {
    const cn = String(r.customerName || '').trim();
    if (cn) { const k = fold(cn); if (!customers.has(k)) customers.set(k, { name: cn, n: 0 }); customers.get(k).n += 1; }
    const an = String(r.shippingAgent || '').trim();
    if (an) {
      const k = fold(an);
      if (!agents.has(k)) agents.set(k, { name: an, email: '', n: 0 });
      agents.get(k).n += 1;
      // The email is taken from the first transaction that has one; it used to be typed by hand each time.
      const em = String(r.shippingAgentEmail || '').trim();
      if (em && !agents.get(k).email) agents.get(k).email = em;
    }
  }

  console.log(`\n  عملاء: ${customers.size} · وكلاءُ شحن: ${agents.size}`);
  console.log(`    منهم بوكيلٍ له بريدٌ مسجَّل: ${[...agents.values()].filter((a) => a.email).length}`);
  console.log(`  أكبر العملاء: ${[...customers.values()].sort((a, b) => b.n - a.n).slice(0, 5).map((c) => `${c.name} (${c.n})`).join(' · ')}`);

  if (!APPLY) { console.log('\n  فحصٌ فقط — أضِف --yes للتنفيذ.\n'); await mongoose.disconnect(); return; }

  let made = 0;
  for (const [kind, src] of [['customer', customers], ['agent', agents]]) {
    for (const v of src.values()) {
      const key = fold(v.name);
      // `upsert`, not `create`: running twice does not create two copies.
      const r = await CustomsParty.updateOne(
        { kind, nameKey: key },
        { $setOnInsert: { kind, name: v.name, nameKey: key }, ...(v.email ? { $set: { email: v.email } } : {}) },
        { upsert: true },
      );
      if (r.upsertedCount) made += 1;
    }
  }
  console.log(`\n  أُنشئ: ${made} ملفًّا`);

  // Link transactions to their files, grouped by id and not by text match.
  const all = await CustomsParty.find({}).select('kind nameKey').lean();
  const byKey = new Map(all.map((p) => [`${p.kind}:${p.nameKey}`, p._id]));
  const ops = [];
  for (const r of rows) {
    const set = {};
    const c = byKey.get(`customer:${fold(r.customerName)}`);
    const a = byKey.get(`agent:${fold(r.shippingAgent)}`);
    if (c) set.customerParty = c;
    if (a) set.agentParty = a;
    if (Object.keys(set).length) ops.push({ updateOne: { filter: { _id: r._id }, update: { $set: set } } });
  }
  if (ops.length) {
    const w = await CustomsClearance.bulkWrite(ops, { ordered: false });
    console.log(`  رُبطت: ${w.modifiedCount} معاملة\n`);
  }
  await mongoose.disconnect();
})().catch(async (e) => { console.error(e); try { await mongoose.disconnect(); } catch (_) {} process.exit(1); });
