/**
 * Links every customer in every section to the parent relations company, once; later links are handled by services/customerHub.
 * Usage: node src/scripts/linkCustomerHub.js [--apply] (dry run by default).
 * Group = folded name plus collection aliases and the Arabic relations name. Parent = the relations company in the group, created if absent; a second same-name company is reported, not merged. Emails are unioned, other fields take the first existing value, existing values are never overwritten (differences reported as conflicts), and each parent gets a contracts row. Safe to rerun.
 */
require('dotenv').config();
const mongoose = require('mongoose');

const APPLY = process.argv.includes('--apply');
const S = (v) => String(v == null ? '' : v).trim();

(async () => {
  await mongoose.connect(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 60000 });
  const hub = require('../services/customerHub');
  const { REG, CARD } = hub;
  const { normalizeEmails } = require('../utils/partyEmails');
  const fold = require('../models/CollectionsParty').fold;
  const contractKey = require('../controllers/contractsController').nameKey;
  const ORDER = ['crm', 'collections', 'shipment', 'customs', 'fleet', 'contracts'];

  // Read phase.
  const rows = {};
  for (const reg of ORDER) {
    rows[reg] = await REG[reg].model().collection.find(REG[reg].base).toArray();
  }
  const groups = new Map();         // key → { recs: [{reg, doc}] }
  const keyOfDoc = new Map();
  const groupFor = (key) => { if (!groups.has(key)) groups.set(key, { key, recs: [] }); return groups.get(key); };
  for (const reg of ORDER) {
    for (const d of rows[reg]) {
      let key = fold(d.name || d.companyName || '');
      if (reg === 'crm' && !key && d.arabicName) key = fold(d.arabicName);
      if (!key) continue;
      groupFor(key).recs.push({ reg, doc: d });
      keyOfDoc.set(String(d._id), key);
    }
  }
  // Alternate collection spellings: the alias group joins the party's group.
  for (const d of rows.collections) {
    const main = keyOfDoc.get(String(d._id));
    for (const ak of d.aliasKeys || []) {
      if (!ak || ak === main || !groups.has(ak) || !groups.has(main)) continue;
      const from = groups.get(ak); const to = groups.get(main);
      if (from === to) continue;
      for (const r of from.recs) to.recs.push(r);
      for (const [k, g] of groups) if (g === from) groups.set(k, to);
    }
  }
  const uniq = [...new Set(groups.values())];

  // Plan phase.
  const stats = { groups: uniq.length, newCrm: 0, newContracts: 0, linked: {}, filled: {}, conflicts: 0, crmDupGroups: 0 };
  ORDER.forEach((r) => { stats.linked[r] = 0; stats.filled[r] = 0; });
  const conflicts = []; const crmDups = [];
  const empty = (v) => (Array.isArray(v) ? !v.length : !S(v));
  const crm = REG.crm.model().collection;

  for (const g of uniq) {
    const crms = g.recs.filter((r) => r.reg === 'crm');
    crms.sort((a, b) => (b.doc.externalSource === 'ops_upl') - (a.doc.externalSource === 'ops_upl')
      || CARD.filter((f) => !empty(REG.crm.read(b.doc)[f])).length - CARD.filter((f) => !empty(REG.crm.read(a.doc)[f])).length);
    if (crms.length > 1) { stats.crmDupGroups += 1; crmDups.push({ name: crms[0].doc.name, ids: crms.map((x) => String(x.doc._id)) }); }

    // Card: emails are unioned, other fields take the first existing value.
    const card = { emails: [] };
    for (const reg of ORDER) {
      for (const r of g.recs.filter((x) => x.reg === reg)) {
        const c = REG[reg].read(r.doc);
        card.emails = normalizeEmails([...card.emails, ...(c.emails || [])]);
        for (const f of CARD.filter((x) => x !== 'emails')) {
          if (c[f] === undefined || empty(c[f])) continue;
          if (empty(card[f])) card[f] = c[f];
          else if (S(card[f]) !== S(c[f]) && f !== 'address' && f !== 'city') {
            conflicts.push({ name: g.recs[0].doc.name, field: f, kept: card[f], other: c[f], where: REG[reg].ar });
          }
        }
      }
    }
    for (const f of CARD) if (card[f] === undefined) card[f] = f === 'emails' ? [] : '';

    let master = crms[0] ? crms[0].doc : null;
    if (!master) {
      stats.newCrm += 1;
      const first = g.recs[0].doc;
      master = { _id: new mongoose.Types.ObjectId(), name: S(first.name), nameKey: g.key };
      if (APPLY) {
        await crm.insertOne({
          ...master, status: 'active', type: 'customer', source: `hub:${g.recs[0].reg}`, tags: [], rating: 0, score: 0,
          ...REG.crm.write(card), createdAt: new Date(), updatedAt: new Date(),
        });
      }
    } else if (APPLY) {
      // Parent: name key, empty fields of its card, emails unioned.
      const mc = REG.crm.read(master); const set = { nameKey: g.key };
      for (const f of CARD) if (f === 'emails' ? card.emails.length > mc.emails.length : (empty(mc[f]) && !empty(card[f]))) Object.assign(set, f === 'emails' ? { emails: card.emails, email: mc.emails[0] || card.emails[0] || '' } : { [f]: card[f] });
      await crm.updateOne({ _id: master._id }, { $set: set });
    }

    // Every row in the group gets the link and whatever the card lacks.
    for (const { reg, doc } of g.recs) {
      if (reg === 'crm') continue;
      const R = REG[reg]; const cur = R.read(doc);
      const set = {};
      if (String(doc.crmCompany || '') !== String(master._id)) { set.crmCompany = master._id; stats.linked[reg] += 1; }
      const fill = {};
      for (const f of CARD) if (cur[f] !== undefined && empty(cur[f]) && !empty(card[f])) fill[f] = card[f];
      if (f_has(fill)) {
        const w = R.write({ ...cur, ...fill, emails: fill.emails || cur.emails || [] }, doc);
        for (const [k, v] of Object.entries(w)) {
          const base = k === 'email' ? 'emails' : k === 'crNumber' ? 'commercialRegister' : k === 'headquarters' ? 'address' : k.startsWith('contacts.') ? null : k;
          if (base && fill[base] !== undefined) set[k] = v;
        }
        stats.filled[reg] += 1;
      }
      if (APPLY && Object.keys(set).length) await R.model().collection.updateOne({ _id: doc._id }, { $set: set });
    }

    // The contracts section holds all customers.
    if (!g.recs.some((r) => r.reg === 'contracts')) {
      const ck = contractKey(master.name);
      const exists = ck ? await REG.contracts.model().collection.findOne({ nameKey: ck }) : true;
      if (!exists) {
        stats.newContracts += 1;
        if (APPLY) {
          await REG.contracts.model().collection.insertOne({
            name: S(master.name), nameKey: ck, crmCompany: master._id,
            ...REG.contracts.write(card), sector: '', customerType: '', energizeRep: '', customerSideContract: false, ourSideContract: false,
            documentsReceived: [], missingDocuments: [], attachments: [], createdByName: 'الربط الموحّد', createdAt: new Date(), updatedAt: new Date(),
          }).catch((e) => { if (e.code !== 11000) throw e; });
        }
      } else if (APPLY && exists && exists._id && !exists.crmCompany) {
        await REG.contracts.model().collection.updateOne({ _id: exists._id }, { $set: { crmCompany: master._id } });
      }
    }
  }
  function f_has(o) { return Object.keys(o).length > 0; }

  stats.conflicts = conflicts.length;
  console.log(APPLY ? '\n=== تمّ الربط ===' : '\n=== تجربة — بلا كتابة ===');
  console.log(JSON.stringify(stats, null, 1));
  console.log(`\nعملاءُ لهم أكثرُ من شركة علاقاتٍ بالاسم نفسِه (للمراجعة): ${crmDups.length}`);
  crmDups.slice(0, 15).forEach((d) => console.log('  ·', d.name, d.ids.join(', ')));
  console.log(`\nتعارضاتٌ لم يُكتب فوقها (للمراجعة): ${conflicts.length}`);
  const byField = {}; conflicts.forEach((c) => { byField[c.field] = (byField[c.field] || 0) + 1; });
  console.log('  حسب الحقل:', JSON.stringify(byField));
  conflicts.slice(0, 12).forEach((c) => console.log(`  · ${c.name} — ${c.field}: «${c.kept}» (أُبقي) ≠ «${c.other}» في ${c.where}`));
  if (process.argv.includes('--json')) require('fs').writeFileSync('/tmp/customer-hub-review.json', JSON.stringify({ crmDups, conflicts }, null, 1));
  await mongoose.disconnect();
})().catch((e) => { console.error(e); process.exit(1); });
