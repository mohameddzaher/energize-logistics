/* eslint-disable no-console, no-await-in-loop */
/**
 * One-time import of the vendors team's sheets into the carrier register: the master profile of each carrier, the
 * active carriers still outside the master (with their follow-up priority), the other names each carrier is written
 * under in shipments, and the approved route price list. After this the team works on the system; the sheets are
 * not linked. Idempotent: matching is by folded name, an existing value the team edited is never overwritten, and
 * a second run changes nothing. Dry run unless --apply.
 *   node src/scripts/importVendorsMaster.js [--file=src/seeds/data/vendorsMaster.json] [--apply]
 */
require('dotenv').config();
const path = require('path');
const fs = require('fs');
const mongoose = require('mongoose');
require('../models/User');
const ShipmentOrderSupplier = require('../models/ShipmentOrderSupplier');
const { VendorFollowUp, VendorApprovedPrice } = require('../models/VendorsMgmt');

const fold = ShipmentOrderSupplier.foldName;
const apply = process.argv.includes('--apply');
const fileArg = (process.argv.find((a) => a.startsWith('--file=')) || '').slice(7);
const FILE = fileArg || path.join(__dirname, '../seeds/data/vendorsMaster.json');

const PROFILE = ['energizeRep', 'taxClass', 'representative', 'destinations', 'headOffice', 'vehicleTypes', 'fleetSize',
  'contractDate', 'contractStatus', 'paymentTermDays', 'financeCode', 'financeClass', 'previousName'];
const empty = (v) => v == null || (typeof v === 'string' && v.trim() === '') || (Array.isArray(v) && !v.length);

/** Parses the sheet's d/m/yyyy into a date (noon, Riyadh-safe). */
const dateOf = (s) => {
  const m = String(s || '').match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (m) return new Date(`${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}T12:00:00+03:00`);
  const iso = String(s || '').match(/^\d{4}-\d{2}-\d{2}$/);
  return iso ? new Date(`${s}T12:00:00+03:00`) : null;
};

(async () => {
  const data = JSON.parse(fs.readFileSync(FILE, 'utf8'));
  await mongoose.connect(process.env.MONGODB_URI || process.env.MONGO_URI);
  const all = await ShipmentOrderSupplier.find({ mergedInto: null }).lean();
  const byKey = new Map();
  for (const s of all) for (const k of [fold(s.name), ...(s.aliasKeys || [])]) if (k && !byKey.has(k)) byKey.set(k, s);
  const aliasGroupOf = new Map(Object.entries(data.aliases || {}).map(([g, names]) => [fold(g), names]));
  const stats = { matched: 0, created: 0, updatedFields: 0, aliasesAdded: 0, aliasConflicts: [], followUps: 0, leads: 0, leadsCreated: 0, prices: 0 };
  const touched = new Map();
  const seedNotes = new Map();

  const findFor = (names) => {
    for (const n of names) { const hit = byKey.get(fold(n)); if (hit) return hit; }
    return null;
  };
  /** Adds names as aliases unless another register row already answers to them. */
  const addAliases = (doc, names) => {
    for (const n of names) {
      const k = fold(n);
      if (!k || k === fold(doc.name)) continue;
      const owner = byKey.get(k);
      if (owner && String(owner._id) !== String(doc._id)) { stats.aliasConflicts.push({ name: n, carrier: doc.name, owner: owner.name }); continue; }
      if ((doc.aliases || []).some((a) => fold(a) === k)) continue;
      doc.aliases = [...(doc.aliases || []), n];
      byKey.set(k, doc);
      stats.aliasesAdded += 1;
    }
  };
  const docOf = async (lean) => {
    const id = String(lean._id);
    if (touched.has(id)) return touched.get(id);
    const d = await ShipmentOrderSupplier.findById(id);
    touched.set(id, d);
    return d;
  };

  // 1. The master sheet.
  for (const m of data.master) {
    const names = [m.name, m.previousName].filter(Boolean);
    const groupNames = aliasGroupOf.get(fold(m.name)) || (m.previousName ? aliasGroupOf.get(fold(m.previousName)) : null) || [];
    let hit = findFor([...names, ...groupNames]);
    let doc;
    if (hit) { doc = await docOf(hit); stats.matched += 1; }
    else {
      doc = new ShipmentOrderSupplier({ name: m.name, type: 'company' });
      stats.created += 1;
      byKey.set(fold(m.name), doc);
      touched.set(String(doc._id), doc);
    }
    doc.inMaster = true;
    if (doc.masterNo == null) doc.masterNo = m.no;
    if (m.isNew) doc.isNewVendor = true;
    if (empty(doc.followOwner) && m.team) doc.followOwner = m.team;
    if (empty(doc.phone) && m.phone) doc.phone = m.phone;
    for (const f of PROFILE) {
      if (m[f] == null || m[f] === '') continue;
      if (empty(doc[f])) { doc[f] = m[f]; stats.updatedFields += 1; }
    }
    if (m.hasPapers) doc.hasPapers = true;
    if (m.vendorSigned) doc.vendorSigned = true;
    if (m.ourSigned) doc.ourSigned = true;
    addAliases(doc, [...names, ...groupNames]);
    seedNotes.set(String(doc._id), { status: m.contractStatus, note: m.notes, at: dateOf(m.contractDate), team: m.team });
  }

  // 2. Active carriers outside the master: follow-up leads with their priority.
  for (const o of data.outside || []) {
    const groupNames = aliasGroupOf.get(fold(o.name)) || [];
    let hit = findFor([o.name, ...groupNames]);
    let doc;
    if (hit) doc = await docOf(hit);
    else {
      doc = new ShipmentOrderSupplier({ name: o.name, type: 'company' });
      stats.leadsCreated += 1;
      byKey.set(fold(o.name), doc);
      touched.set(String(doc._id), doc);
    }
    stats.leads += 1;
    if (!doc.inMaster && empty(doc.leadPriority) && o.priority) doc.leadPriority = o.priority;
    if (empty(doc.followOwner) && o.team) doc.followOwner = o.team;
    if (empty(doc.energizeRep) && o.energizeRep) doc.energizeRep = o.energizeRep;
    addAliases(doc, [o.name, ...groupNames]);
    if ((o.followStatus || o.note) && !seedNotes.has(String(doc._id))) seedNotes.set(String(doc._id), { status: '', note: [o.followStatus, o.note].filter(Boolean).join(' — '), at: null, team: o.team });
  }

  // 3. The other names of carriers already in the register (the team's name map), so their shipments join one row.
  for (const [g, names] of Object.entries(data.aliases || {})) {
    const hit = findFor([g]);
    if (!hit) continue;
    const doc = await docOf(hit);
    addAliases(doc, names);
  }

  // 4. Write, with one imported follow-up carrying the sheet's status and note.
  for (const doc of touched.values()) {
    const seed = seedNotes.get(String(doc._id));
    if (!apply) continue;
    await doc.save();
    if (seed && (seed.status || seed.note)) {
      const exists = await VendorFollowUp.exists({ supplier: doc._id, source: 'import' });
      if (!exists) {
        await VendorFollowUp.create({
          supplier: doc._id, at: seed.at || new Date(), channel: 'other', source: 'import',
          outcome: seed.status || '', note: seed.note || '', contractStatus: seed.status || '', byName: seed.team || 'استيراد الماستر شيت',
        });
        stats.followUps += 1;
        if (!doc.lastFollowUpAt) await ShipmentOrderSupplier.updateOne({ _id: doc._id }, { $set: { lastFollowUpAt: seed.at || new Date() } });
      }
    }
  }

  // 5. Approved prices.
  for (const a of data.approved || []) {
    stats.prices += 1;
    if (!apply) continue;
    const fromKey = fold(a.from); const toKey = fold(a.to);
    const cur = await VendorApprovedPrice.findOne({ fromKey, toKey, truckType: '' });
    if (cur) continue;
    await new VendorApprovedPrice({ fromCity: a.from, toCity: a.to, priceA: a.A, priceB: a.B, priceC: a.C, updatedByName: 'استيراد قائمة الأسعار' }).save();
  }

  try { require('../utils/ttlCache').clear('so:'); } catch (_) { /* */ }
  console.log(JSON.stringify({ ...stats, aliasConflicts: stats.aliasConflicts.length }, null, 1));
  if (stats.aliasConflicts.length) {
    console.log('\nNames claimed by two register rows (candidates for a merge):');
    for (const c of stats.aliasConflicts.slice(0, 60)) console.log(`  ${c.name}  →  ${c.carrier}  /  already: ${c.owner}`);
  }
  console.log(apply ? '\napplied' : '\ndry run — add --apply to write');
  await mongoose.disconnect();
})().catch((e) => { console.error(e); process.exit(1); });
