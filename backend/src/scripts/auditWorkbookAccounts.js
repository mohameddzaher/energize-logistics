/** كلُّ حسابٍ في كلّ ورقةٍ مقابلَ سجلِّ الأطراف. لا يكتب شيئًا. */
require('dotenv').config();
const mongoose = require('mongoose');
const XLSX = require('xlsx');
const path = require('path');
const FILE = path.join(__dirname, '../../../collection files/Financial Collections    9-2026.xlsx');

const fold = (s) => String(s || '').toLowerCase()
  .replace(/[أإآٱ]/g, 'ا').replace(/[ىئ]/g, 'ي').replace(/[ةه]/g, 'ه').replace(/ؤ/g, 'و')
  .replace(/[ً-ْـ]/g, '').replace(/[()\-_.,]/g, ' ').replace(/\s+/g, ' ').trim();

// الورقة → [صفُّ الترويسة, عمودُ الكود, عمودُ الاسم, عمودُ المسؤول]
const SHEETS = [
  ['Aging', 4, 0, 1, 2],
  ['Aging Shipment', 4, 0, 1, 2],
  ['Daily Invoice Report', 5, 0, 1, null],
  ['Shipment Report', 4, 0, 2, null],
  ['JP', 6, 0, 1, 3],
];

(async () => {
  await mongoose.connect(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 30000 });
  const CollectionsParty = require('../models/CollectionsParty');
  const wb = XLSX.readFile(FILE);

  // كودٌ → { الأسماءُ التي ظهر بها, المسؤولون, الأوراق }
  const accounts = new Map();
  for (const [sheet, h, cCode, cName, cOff] of SHEETS) {
    const rows = XLSX.utils.sheet_to_json(wb.Sheets[sheet], { header: 1, defval: '', blankrows: false });
    let n = 0;
    for (let i = h + 1; i < rows.length; i += 1) {
      const r = rows[i]; if (!r) continue;
      const code = String(r[cCode] ?? '').trim();
      const name = String(r[cName] ?? '').trim();
      if (!code || !name) continue;
      if (!accounts.has(code)) accounts.set(code, { names: new Set(), officers: new Set(), sheets: new Set() });
      const a = accounts.get(code);
      a.names.add(name); a.sheets.add(sheet);
      if (cOff != null) { const o = String(r[cOff] ?? '').trim(); if (o) a.officers.add(o); }
      n += 1;
    }
    console.log(`«${sheet}» → ${n} صفًّا بكودٍ واسم`);
  }
  console.log(`\nحساباتٌ فريدةٌ في الملفّ كلِّه: ${accounts.size}`);

  const parties = await CollectionsParty.find({}).select('name nameKey code kind collectionOfficer aliases isActive').lean();
  const byCode = new Map(parties.filter((p) => p.code).map((p) => [String(p.code).trim(), p]));
  const byName = new Map();
  for (const p of parties) {
    for (const nm of [p.name, ...(p.aliases || [])]) {
      const k = fold(nm); if (k && !byName.has(k)) byName.set(k, p);
    }
  }

  const missing = [];      // لا كودَ ولا اسمَ عندنا
  const nameOnly = [];     // موجودٌ بالاسم بلا كود
  const nameDiff = [];     // الكودُ عندنا والاسمُ يختلف
  const noOfficer = [];    // الملفُّ يسمّي مسؤولًا ونحن لا
  const offDiff = [];

  for (const [code, a] of accounts) {
    const p = byCode.get(code);
    const sheetName = [...a.names][0];
    const wantOff = [...a.officers][0] || '';
    if (!p) {
      const hit = [...a.names].map((n) => byName.get(fold(n))).find(Boolean);
      if (hit) nameOnly.push({ code, sheetName, dbName: hit.name });
      else missing.push({ code, sheetName, officer: wantOff, sheets: [...a.sheets].join(',') });
      continue;
    }
    const known = new Set([fold(p.name), ...(p.aliases || []).map(fold)]);
    if (![...a.names].some((n) => known.has(fold(n)))) {
      nameDiff.push({ code, sheetName, dbName: p.name });
    }
    if (wantOff) {
      const cur = String(p.collectionOfficer || '').trim();
      if (!cur) noOfficer.push({ code, name: p.name, want: wantOff });
      else if (cur !== wantOff) offDiff.push({ code, name: p.name, cur, want: wantOff });
    }
  }

  const show = (label, arr, fmt) => {
    console.log(`\n── ${label}: ${arr.length}`);
    arr.slice(0, 12).forEach((x) => console.log('   ' + fmt(x)));
    if (arr.length > 12) console.log(`   … و${arr.length - 12} غيرها`);
  };
  show('حساباتٌ في الملفّ ولا سجلَّ لها عندنا', missing, (x) => `${x.code} ${x.sheetName.slice(0, 40)} → ${x.officer || '(بلا مسؤول)'} [${x.sheets}]`);
  show('موجودٌ بالاسم عندنا بلا كود', nameOnly, (x) => `${x.code} ورقة=${x.sheetName.slice(0, 34)} | قاعدة=${x.dbName}`);
  show('الكودُ عندنا والاسمُ لا يطابق ولا يُعرَف كلقب', nameDiff, (x) => `${x.code} ورقة=${x.sheetName.slice(0, 38)} | قاعدة=${x.dbName}`);
  show('الملفُّ يسمّي مسؤولًا ونحن لا', noOfficer, (x) => `${x.code} ${x.name.slice(0, 34)} → ${x.want}`);
  show('مسؤولٌ مختلف', offDiff, (x) => `${x.code} ${x.name.slice(0, 30)} قاعدة=${x.cur} ورقة=${x.want}`);
  await mongoose.disconnect();
})();
