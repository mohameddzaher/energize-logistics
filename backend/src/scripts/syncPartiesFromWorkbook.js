/**
 * The workbook is the reference for accounts and their owners.
 * Usage: node src/scripts/syncPartiesFromWorkbook.js (preview) | --yes (apply)
 * Reads all five sheets (Aging, Aging Shipment, Daily Invoice Report, Shipment Report, JP) and fixes three things: 1) account in the file with no record here is created, 2) account here without a code gets its code, 3) collection officer is matched to the file. The official name in the file is kept as a permanent alias so search finds it.
 */
require('dotenv').config();
const mongoose = require('mongoose');
const XLSX = require('xlsx');
const path = require('path');

const YES = process.argv.includes('--yes');
const FILE = path.join(__dirname, '../../../collection files/Financial Collections    9-2026.xlsx');
const fold = (s) => String(s || '').toLowerCase()
  .replace(/[أإآٱ]/g, 'ا').replace(/[ىئ]/g, 'ي').replace(/[ةه]/g, 'ه').replace(/ؤ/g, 'و')
  .replace(/[ً-ْـ]/g, '').replace(/[()\-_.,]/g, ' ').replace(/\s+/g, ' ').trim();

// Identity sheets versus movement sheets.
// Aging, Aging Shipment and JP describe the account: code, name, owner. Daily Invoice Report and Shipment Report describe a movement and carry the name on each row, which is error-prone: some rows have one account's code with another account's name. Taking those as aliases would merge two different customers and shift debt between them. So identity comes only from the identity sheets; movement sheets are read but never name anyone.
const IDENTITY = [
  ['Aging', 4, 0, 1, 2],
  ['Aging Shipment', 4, 0, 1, 2],
  ['JP', 6, 0, 1, 3],
];
const SHEETS = IDENTITY;

// A name with a Latin word inside Arabic text is not a valid name.
// An Excel replacement corrupted a few names in the Aging sheet; the correct names are in the JP sheet. When two names differ for one code, the clean one wins.
const looksMangled = (s) => /[\u0600-\u06FF]/.test(s) && /[A-Za-z]{3,}/.test(s);

(async () => {
  await mongoose.connect(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 30000 });
  const CollectionsParty = require('../models/CollectionsParty');
  const wb = XLSX.readFile(FILE);

  const accounts = new Map();
  for (const [sheet, h, cCode, cName, cOff] of SHEETS) {
    const rows = XLSX.utils.sheet_to_json(wb.Sheets[sheet], { header: 1, defval: '', blankrows: false });
    for (let i = h + 1; i < rows.length; i += 1) {
      const r = rows[i]; if (!r) continue;
      const code = String(r[cCode] ?? '').trim();
      const name = String(r[cName] ?? '').trim();
      if (!code || !name) continue;
      if (!accounts.has(code)) accounts.set(code, { names: new Set(), officers: new Set() });
      accounts.get(code).names.add(name);
      if (cOff != null) { const o = String(r[cOff] ?? '').trim(); if (o) accounts.get(code).officers.add(o); }
    }
  }

  const parties = await CollectionsParty.find({}).select('name nameKey code kind collectionOfficer aliases aliasKeys').lean();
  const byCode = new Map(parties.filter((p) => p.code).map((p) => [String(p.code).trim(), p]));
  const byName = new Map();
  for (const p of parties) for (const nm of [p.name, ...(p.aliases || [])]) { const k = fold(nm); if (k && !byName.has(k)) byName.set(k, p); }

  const created = []; const coded = []; const officered = []; const aliased = []; const renamed = [];
  for (const [code, a] of accounts) {
    const all = [...a.names];
    const officialName = all.find((n) => !looksMangled(n)) || all[0];
    const want = [...a.officers][0] || '';
    let p = byCode.get(code);
    if (!p) p = [...a.names].map((n) => byName.get(fold(n))).find(Boolean);

    if (!p) { created.push({ code, name: officialName, officer: want }); continue; }
    if (looksMangled(p.name) && officialName && !looksMangled(officialName)) {
      renamed.push({ id: p._id, code, from: p.name, to: officialName });
    }
    if (!String(p.code || '').trim()) coded.push({ id: p._id, code, name: p.name });
    if (want && String(p.collectionOfficer || '').trim() !== want) {
      officered.push({ id: p._id, code, name: p.name, from: p.collectionOfficer || '(فارغ)', to: want });
    }
    // The official name is kept as an alias so search finds it.
    const known = new Set([fold(p.name), ...(p.aliases || []).map(fold)]);
    const add = all.filter((n) => !known.has(fold(n)) && !looksMangled(n));
    if (add.length) aliased.push({ id: p._id, name: p.name, add });
  }

  console.log(YES ? '── تنفيذ ──\n' : '── تجربة، بلا كتابة ──\n');
  console.log(`حساباتُ الملفّ: ${accounts.size}`);
  console.log(`\n١) تُنشأ: ${created.length}`);
  created.forEach((x) => console.log(`   ${x.code} ${x.name} → ${x.officer || '(بلا مسؤول)'}`));
  console.log(`\n٢) يُكتب كودُها: ${coded.length}`);
  coded.forEach((x) => console.log(`   ${x.code} ← ${x.name}`));
  console.log(`\n٣) مسؤولٌ يُصحَّح: ${officered.length}`);
  officered.forEach((x) => console.log(`   ${x.code} ${String(x.name).slice(0, 34).padEnd(34)} ${x.from} → ${x.to}`));
  console.log(`\n٤) أسماءٌ مشوَّهةٌ تُصحَّح (استبدالُ إكسل في ورقة Aging): ${renamed.length}`);
  renamed.forEach((x) => console.log(`   ${x.code} «${x.from}» → «${x.to}»`));
  console.log(`\n٥) ألقابٌ تُضاف: ${aliased.length}`);
  aliased.slice(0, 10).forEach((x) => console.log(`   ${String(x.name).slice(0, 30).padEnd(30)} + ${x.add.join(' | ').slice(0, 60)}`));
  if (aliased.length > 10) console.log(`   … و${aliased.length - 10} غيرها`);

  if (!YES) { console.log('\n— تجربةٌ فقط. أضف --yes للتنفيذ.\n'); await mongoose.disconnect(); return; }

  for (const x of created) {
    await CollectionsParty.create({
      kind: 'customer', name: x.name, nameKey: fold(x.name), code: x.code,
      collectionOfficer: x.officer, isActive: true, source: 'collections-workbook',
    });
  }
  for (const x of coded) await CollectionsParty.updateOne({ _id: x.id }, { $set: { code: x.code } });
  for (const x of renamed) {
    // The corrupted name stays as an alias so anyone searching it, or pasting it from the sheet, still finds the account.
    await CollectionsParty.updateOne({ _id: x.id }, {
      $set: { name: x.to, nameKey: fold(x.to) },
      $addToSet: { aliases: x.from, aliasKeys: fold(x.from) },
    });
  }
  for (const x of officered) await CollectionsParty.updateOne({ _id: x.id }, { $set: { collectionOfficer: x.to } });
  for (const x of aliased) {
    await CollectionsParty.updateOne({ _id: x.id }, {
      $addToSet: { aliases: { $each: x.add }, aliasKeys: { $each: x.add.map(fold) } },
    });
  }
  try { require('../controllers/collectionsLedgerController').invalidate(); } catch (_) {}
  console.log(`\n✓ أُنشئ ${created.length} · كودٌ ${coded.length} · مسؤولٌ ${officered.length} · اسمٌ ${renamed.length} · ألقابٌ ${aliased.length}`);
  await mongoose.disconnect();
})();
