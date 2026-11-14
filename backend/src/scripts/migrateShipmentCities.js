/**
 * Moves the «From / To» cities into the shared reference list `shipment_city`, once.
 * Source: the two form fields' saved options (fromCity first, its order kept, then toCity's). A city of the old fixed
 * list (config/shipmentCities) missing from either saved field was deleted in the settings on purpose and is left out;
 * that deletion is what kept being undone. With no saved options at all (a fresh database) the fixed list is used.
 * Idempotent: a city already in the list is skipped. Dry run by default; --apply backs up the field options first.
 */
require('dotenv').config({ quiet: true });
const fs = require('fs');
const path = require('path');
const mongoose = require('mongoose');

(async () => {
  const apply = process.argv.includes('--apply');
  await mongoose.connect(process.env.MONGODB_URI || process.env.MONGO_URI);
  const Field = require('../models/ShipmentOrderField');
  const Lookup = require('../models/Lookup');
  const base = require('../config/shipmentCities');
  const S = (v) => String(v == null ? '' : v).trim();

  const fields = await Field.find({ key: { $in: ['fromCity', 'toCity'] } }).select('key options').lean();
  const byKey = Object.fromEntries(fields.map((f) => [f.key, (f.options || []).filter((o) => S(o && (o.ar || o.key)))]));
  const saved = ['fromCity', 'toCity'].filter((k) => (byKey[k] || []).length);
  const names = (k) => (byKey[k] || []).map((o) => S(o.ar || o.key));
  const deleted = new Set(base.filter((c) => saved.some((k) => !names(k).includes(c))));

  const list = []; const seen = new Set();
  const push = (ar, en) => { if (!ar || seen.has(ar) || deleted.has(ar)) return; seen.add(ar); list.push({ ar, en: S(en) || ar }); };
  if (saved.length) for (const k of saved) for (const o of byKey[k]) push(S(o.ar || o.key), o.en);
  else for (const c of base) push(c, c);

  const existing = new Set((await Lookup.find({ type: 'shipment_city' }).select('nameAr').lean()).map((r) => S(r.nameAr)));
  const toAdd = list.filter((c) => !existing.has(c.ar));
  console.log(`saved fields: ${saved.join(', ') || 'none'} · deleted on purpose: ${deleted.size} · list: ${list.length} · already there: ${list.length - toAdd.length} · to add: ${toAdd.length}`);
  if (deleted.size) console.log(`left out: ${[...deleted].join('، ')}`);
  if (!apply) { console.log('Dry run (pass --apply to write).'); process.exit(0); }

  const dir = fs.existsSync('/opt/energize/backups') ? '/opt/energize/backups' : path.join(process.cwd(), 'backups');
  fs.mkdirSync(dir, { recursive: true });
  const bk = path.join(dir, `shipment-cities-fields-before-${Date.now()}.json`);
  fs.writeFileSync(bk, JSON.stringify(fields));
  const last = await Lookup.findOne({ type: 'shipment_city' }).sort({ order: -1 }).select('order').lean();
  let order = (last && last.order) || 0;
  if (toAdd.length) {
    await Lookup.insertMany(toAdd.map((c) => ({ type: 'shipment_city', key: c.ar, nameAr: c.ar, nameEn: c.en, order: (order += 1), isActive: true })), { ordered: false });
  }
  await require('../utils/ttlCache').clearShared('so:').catch(() => {});
  console.log(`Added ${toAdd.length} · backup: ${bk}`);
  process.exit(0);
})().catch((e) => { console.error(e.message); process.exit(1); });
