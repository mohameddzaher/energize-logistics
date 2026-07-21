/**
 * Import + CLEAN the IT / Software custody register
 * (IT_Assets_Custody_Register.xlsx → JSON) into the shared `Asset` collection —
 * the same collection the HR custody page and the employee profile read, so an
 * imported laptop shows up on the employee's HR record automatically.
 *
 * Usage (from the backend folder):
 *   node src/scripts/importItCustody.js src/data/masters/it_assets_custodyyyy.json --dry
 *   node src/scripts/importItCustody.js src/data/masters/it_assets_custodyyyy.json
 *
 * The raw sheet is dirty — "ASSUS" and "ASUS", "سامسونج" and "Samsung", model
 * codes typed into the serial column, and the same device recorded on two rows.
 * This script is the single place that cleans it, in four passes:
 *
 *   1. NORMALIZE  category → type, brand/model split, serial hygiene, condition.
 *   2. DEDUPE     collapse rows that describe one physical item.
 *   3. SYNC       upsert by `importKey` (`it-custody:<row no>`), so re-running
 *                 updates rather than duplicates.
 *   4. PRUNE      delete previously-imported rows that the cleaned sheet no
 *                 longer produces, so the collection mirrors the sheet exactly.
 *
 * Because every rule is deterministic, running it twice gives the same result.
 * Rows whose employee cannot be matched are SKIPPED and listed at the end —
 * never imported holder-less, which would look like store stock.
 */
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const mongoose = require('mongoose');
const connectDB = require('../config/db');
const Employee = require('../models/Employee');
const Asset = require('../models/Asset');
const { ALL_TYPE_KEYS } = require('../config/assetDefaults');

const DRY = process.argv.includes('--dry');
const fileArg = process.argv.find((a, i) => i >= 2 && !a.startsWith('--')) || 'src/data/masters/it_assets_custodyyyy.json';

// ── cleaners ────────────────────────────────────────────────────────────────
const str = (v) => (v === null || v === undefined ? '' : String(v).replace(/\s+/g, ' ').trim());
const norm = (s) =>
  str(s)
    .replace(/[أإآ]/g, 'ا')
    .replace(/ى/g, 'ي')
    .replace(/ة/g, 'ه')
    .replace(/[ًٌٍَُِّْ]/g, '')
    .toLowerCase();

// ── 1. NORMALIZE ────────────────────────────────────────────────────────────

// The register's category column → the `asset_type` key.
const TYPE_BY_CATEGORY = {
  'laptop': 'laptop',
  'desktop': 'desktop',
  'mobile': 'phone',
  'phone': 'phone',
  'tablet': 'tablet',
  'sim card': 'sim',
  'sim': 'sim',
  'monitor': 'monitor',
  'mouse': 'mouse',
  'keyboard': 'keyboard',
  'keyboard & mouse': 'keyboard_mouse',
  'headset': 'headset',
  'charger': 'charger',
  'cable': 'cable',
  'printer': 'printer',
  'router': 'router',
  'access card': 'access_card',
  'laptop bag': 'laptop_bag',
  'accessory': 'accessory',
  'other': 'other',
  'vehicle': 'vehicle',
};

// The catch-all "Other" category hides real types in its model text; and a
// couple of rows are filed under the wrong category outright. Longest match
// wins, so "laptop charger" beats "laptop".
const TYPE_BY_MODEL_TEXT = [
  ['phone charger', 'charger'],
  ['laptop charger', 'charger'],
  ['ac adapter', 'charger'],
  ['laser pointer', 'accessory'],
  ['phone holder', 'accessory'],
  ['ethernet cable', 'cable'],
  ['router', 'router'],
  ['printer', 'printer'],
  ['desktop', 'desktop'],
];

// One canonical spelling per brand. Keys are matched case-insensitively against
// whole words, so "ASSUS"/"assus"/"Asus" all land on "ASUS".
const BRANDS = [
  { canonical: 'ASUS', match: ['asus', 'assus'] },
  { canonical: 'HP', match: ['hp'] },
  { canonical: 'Dell', match: ['dell'] },
  { canonical: 'Lenovo', match: ['lenovo'] },
  { canonical: 'Apple', match: ['apple', 'macbook'] },
  { canonical: 'Acer', match: ['acer'] },
  { canonical: 'Samsung', match: ['samsung', 'سامسونج'] },
  { canonical: 'Honor', match: ['honor'] },
  { canonical: 'Oppo', match: ['oppo', 'reno'] },
  { canonical: 'Mobily', match: ['mobily'] },
  { canonical: 'Logitech', match: ['logitech'] },
];

// Values in the model column that say nothing the `type` doesn't already say.
const NOISE_MODELS = new Set([
  'mouse', 'keyboard', 'sim', 'monitor', 'laptop', 'laptop bag', 'phone',
  'cable', 'charger', 'other', 'accessory', 'keyboard & mouse',
]);

// Manufacturer part numbers that were typed into the serial column. They are
// shared by every unit of that product, so treating them as serials makes
// distinct devices look like duplicates of each other.
const MODEL_CODES = new Set(['MK-307', 'MK270', 'SL711KBW', 'MK 307']);

const isLatin = (s) => /^[\x20-\x7E]+$/.test(s);

// Serial hygiene: uppercase Latin serials, strip the "C/N/" and "S/N" prefixes
// people type in, and drop anything too short to identify a device.
const cleanSerial = (raw) => {
  let s = str(raw).replace(/^(c[\/\\]n[\/\\]|s[\/\\]?n[:\/\\ ]?)/i, '').trim();
  if (!s) return { serial: '', modelCode: '' };
  if (isLatin(s)) s = s.toUpperCase();
  if (MODEL_CODES.has(s)) return { serial: '', modelCode: s };
  if (s.replace(/[^A-Z0-9]/gi, '').length < 4) return { serial: '', modelCode: '' };
  return { serial: s, modelCode: '' };
};

// "Wireless Keyboard & Mouse" on a keyboard_mouse row says "keyboard & mouse"
// twice — the type already carries that. Strip the echo, but only when what is
// left is a real qualifier, so "Laptop charger" is never reduced to "Laptop".
const TYPE_ECHO = {
  keyboard_mouse: ['keyboard & mouse', 'keyboard and mouse'],
  keyboard: ['keyboard'],
  mouse: ['mouse'],
  monitor: ['monitor'],
  cable: ['cable'],
  laptop_bag: ['laptop bag', 'bag'],
  headset: ['headset', 'headphone'],
  router: ['router'],
  printer: ['printer'],
  sim: ['sim'],
};
const QUALIFIERS = new Set(['wireless', 'ethernet', 'bluetooth', 'usb', 'external', 'portable', 'wired']);

const stripTypeEcho = (model, typeKey) => {
  const echoes = TYPE_ECHO[typeKey];
  if (!model || !echoes) return model;
  for (const echo of echoes) {
    const rest = str(model.replace(new RegExp(echo, 'i'), ' '));
    if (rest.toLowerCase() === model.toLowerCase()) continue;
    if (!rest) return '';
    if (rest.split(' ').every((w) => QUALIFIERS.has(w.toLowerCase()))) return rest;
  }
  return model;
};

// Split the register's single free-text "model" column into a canonical brand
// and the model that is left over.
const splitBrandModel = (raw, typeKey) => {
  let text = str(raw);
  if (!text) return { brand: '', model: '', extra: '' };

  // "Desktop+ Dell", "HONOR +Oppo", "Phone charger + Laptop charger" — a "+"
  // means two things were crammed into one cell. Keep the first as the model
  // and note the rest, but look for the brand across the WHOLE cell: in
  // "Desktop+ Dell" the brand sits on the far side of the plus.
  const whole = text;
  let extra = '';
  if (text.includes('+')) {
    const parts = text.split('+').map((p) => str(p)).filter(Boolean);
    text = parts.shift() || '';
    extra = parts.join(' + ');
  }
  // "Laptop charger (Dell)" — the brand is in the parentheses.
  const paren = text.match(/^(.*?)\s*\(([^)]+)\)\s*$/);
  let bracketed = '';
  if (paren) { text = str(paren[1]); bracketed = str(paren[2]); }

  const hay = `${whole} ${bracketed}`.toLowerCase();
  const found = BRANDS.find((b) => b.match.some((m) => new RegExp(`(^|[^a-z])${m}([^a-z]|$)`, 'i').test(hay)));
  const brand = found ? found.canonical : '';

  // Whatever is left after removing the brand word is the model.
  let model = text;
  if (found) {
    found.match.forEach((m) => { model = model.replace(new RegExp(`(^|[^a-z])${m}([^a-z]|$)`, 'ig'), ' '); });
    // "Reno" is an Oppo line, not a brand — keep it as the model.
    if (/reno/i.test(text)) model = 'Reno';
  }
  model = str(model).replace(/^[-–—,\s]+|[-–—,\s]+$/g, '');
  if (NOISE_MODELS.has(model.toLowerCase())) model = '';
  model = stripTypeEcho(model, typeKey);
  // Model numbers read better uppercase: "x9d" → "X9D".
  if (model && isLatin(model)) model = model.replace(/\b[a-z]?\d[a-z0-9]*\b/gi, (m) => m.toUpperCase());

  return { brand, model, extra };
};

const resolveType = (category, modelText) => {
  const byCat = TYPE_BY_CATEGORY[str(category).toLowerCase()];
  const text = str(modelText).toLowerCase();
  // A specific type spelled out in the model text beats a vague category.
  if (!byCat || byCat === 'other') {
    const hit = TYPE_BY_MODEL_TEXT.find(([needle]) => text.includes(needle));
    if (hit) return hit[1];
  }
  if (byCat === 'laptop' && text.includes('desktop')) return 'desktop';
  return byCat || 'other';
};

const CONDITION_WORDS = { new: 'new', used: 'good', working: 'good', good: 'good', fair: 'fair', damaged: 'damaged' };
const resolveCondition = (condition, notes) => {
  const s = `${str(condition)} ${str(notes)}`.toLowerCase();
  if (/not working|damaged|broken|عطل|تالف/.test(s)) return 'damaged';
  return CONDITION_WORDS[str(condition).toLowerCase()] || 'good';
};

const isReturned = (notes) => /returned/i.test(str(notes)) || /مسترجع|تم التسليم/.test(str(notes));

// Notes carry colour and missing-parts info that belongs on the record, but the
// "Returned by employee" marker is status, not a note — the status field says it.
const cleanNotes = (raw, extra) => {
  const parts = str(raw)
    .split(';')
    .map((p) => str(p))
    .filter((p) => p && !/^returned by employee$/i.test(p));
  if (extra) parts.unshift(`+ ${extra}`);
  return parts.join('؛ ');
};

const TYPE_LABEL_EN = require('../config/assetDefaults').TYPES
  .reduce((m, t) => { m[t.key] = t.nameEn; return m; }, {});

const normalizeRow = (item, employee, key) => {
  const type = resolveType(item.category, item.model);
  const { brand, model, extra } = splitBrandModel(item.model, type);
  const { serial, modelCode } = cleanSerial(item.serialNumber);
  const notes = cleanNotes(item.notes, extra);
  // A part number rescued from the serial column still belongs on the record.
  const finalModel = [model, modelCode].filter(Boolean).join(' ');

  if (!ALL_TYPE_KEYS.includes(type)) throw new Error(`Unmapped type "${type}" from category "${item.category}"`);

  return {
    importKey: key,
    row: Number(item.no) || 0,
    employee: employee ? employee._id : null,
    employeeName: employee ? `${employee.firstName || ''} ${employee.lastName || ''}`.trim() : '',
    // The sheet has no item-name column, so build a consistent one instead of
    // repeating the raw cell: "Dell Latitude", "Honor X9D", or just "Mouse".
    name: [brand, finalModel].filter(Boolean).join(' ') || TYPE_LABEL_EN[type] || 'Item',
    type,
    brand,
    model: finalModel,
    serialNumber: serial,
    condition: resolveCondition(item.condition, item.notes),
    status: employee ? (isReturned(item.notes) ? 'returned' : 'assigned') : 'in_stock',
    quantity: Number(item.quantity) > 0 ? Number(item.quantity) : 1,
    location: str(item.location),
    notes,
    category: 'IT',
    issuedBySection: 'it',
    specs: '',
  };
};

// ── 2. DEDUPE ───────────────────────────────────────────────────────────────
// A serial identifies one physical device, so two rows sharing one are either a
// duplicated entry or a device that moved between people without the old row
// being closed. Both are resolved here, and every decision is reported.

const dedupe = (rows, report) => {
  const groups = new Map();
  rows.filter((r) => r.serialNumber).forEach((r) => {
    if (!groups.has(r.serialNumber)) groups.set(r.serialNumber, []);
    groups.get(r.serialNumber).push(r);
  });

  const dropped = new Set();

  for (const [serial, group] of groups) {
    if (group.length < 2) continue;
    const ordered = [...group].sort((a, b) => a.row - b.row);

    // (a) Same holder and same type twice → one device entered twice. Keep the
    // first row; the later one is pure duplication.
    const seen = new Map();
    for (const r of ordered) {
      const k = `${r.employee || 'stock'}|${r.type}`;
      if (seen.has(k)) {
        dropped.add(r.importKey);
        report.duplicates.push(`${serial}: row ${r.row} duplicates row ${seen.get(k).row} (${r.employeeName || 'stock'})`);
      } else {
        seen.set(k, r);
      }
    }

    const live = ordered.filter((r) => !dropped.has(r.importKey));
    if (live.length < 2) continue;

    // (b) A device cannot be on the shelf and in someone's hands at once — the
    // holder wins, the store row is the stale one.
    const held = live.filter((r) => r.status !== 'in_stock');
    if (held.length && live.some((r) => r.status === 'in_stock')) {
      live.filter((r) => r.status === 'in_stock').forEach((r) => {
        dropped.add(r.importKey);
        report.stockConflicts.push(`${serial}: store row ${r.row} dropped — the device is held by ${held[0].employeeName}`);
      });
    }

    // (c) Still assigned to two different people → the sheet was updated for the
    // new holder without closing the old row. The later row is the current
    // truth; earlier ones become history rather than being deleted.
    const stillAssigned = live.filter((r) => !dropped.has(r.importKey) && r.status === 'assigned');
    if (stillAssigned.length > 1) {
      const current = stillAssigned[stillAssigned.length - 1];
      stillAssigned.slice(0, -1).forEach((r) => {
        r.status = 'returned';
        r.notes = [r.notes, `سُجّل لاحقاً بعهدة ${current.employeeName}`].filter(Boolean).join('؛ ');
        report.transfers.push(`${serial}: row ${r.row} (${r.employeeName}) closed — now held by ${current.employeeName} (row ${current.row})`);
      });
    }
  }

  return rows.filter((r) => !dropped.has(r.importKey));
};

// ── employee matching ───────────────────────────────────────────────────────
function buildEmployeeIndex(employees) {
  const byId = new Map();
  const byNumber = new Map();
  const byName = new Map();
  for (const e of employees) {
    if (e.iqamaNumber) byId.set(str(e.iqamaNumber), e);
    if (e.nationalId) byId.set(str(e.nationalId), e);
    if (e.employeeNumber) byNumber.set(str(e.employeeNumber), e);
    const names = [e.arabicName, `${e.firstName || ''} ${e.lastName || ''}`].map(norm).filter(Boolean);
    // First writer wins — a duplicate name must not silently reassign custody.
    for (const n of names) if (!byName.has(n)) byName.set(n, e);
  }
  return { byId, byNumber, byName };
}

const findEmployee = (idx, row) => {
  // Some rows carry free text instead of an ID ("زيارة عائلية") — that just
  // misses every index and falls through to the name match.
  const id = str(row.idNumber);
  return (id && idx.byId.get(id)) || (id && idx.byNumber.get(id)) || idx.byName.get(norm(row.employeeName)) || null;
};

// ── run ─────────────────────────────────────────────────────────────────────
async function run() {
  const file = path.isAbsolute(fileArg) ? fileArg : path.join(process.cwd(), fileArg);
  if (!fs.existsSync(file)) {
    console.error(`File not found: ${file}`);
    process.exit(1);
  }
  const data = JSON.parse(fs.readFileSync(file, 'utf8'));
  const employeeRows = data.employees || [];
  const stockRows = data.stock || data.inStock || data.warehouse || [];

  await connectDB();
  const employees = await Employee.find({}).select('firstName lastName arabicName iqamaNumber nationalId employeeNumber').lean();
  const idx = buildEmployeeIndex(employees);
  console.log(`Loaded ${employees.length} employees from the database.`);

  const report = { duplicates: [], transfers: [], stockConflicts: [] };
  const raw = [];
  const unmatched = [];

  for (const row of employeeRows) {
    const emp = findEmployee(idx, row);
    if (!emp) {
      unmatched.push({ name: row.employeeName, id: row.idNumber, items: (row.items || []).length });
      continue;
    }
    for (const item of row.items || []) raw.push(normalizeRow(item, emp, `it-custody:${item.no}`));
  }
  stockRows.forEach((item, i) => raw.push(normalizeRow(item, null, item.no ? `it-custody:${item.no}` : `it-stock:${i + 1}`)));

  const docs = dedupe(raw, report);

  // ── report ────────────────────────────────────────────────────────────────
  const skippedItems = unmatched.reduce((n, u) => n + u.items, 0);
  console.log(`\nRaw rows: ${raw.length}  →  after cleaning: ${docs.length}`);
  console.log(`   custody ${docs.filter((d) => d.employee).length} | store ${docs.filter((d) => !d.employee).length}`);

  if (report.duplicates.length) {
    console.log(`\nDuplicate rows removed (${report.duplicates.length}):`);
    report.duplicates.forEach((l) => console.log(`  · ${l}`));
  }
  if (report.stockConflicts.length) {
    console.log(`\nStore rows dropped — device is actually held (${report.stockConflicts.length}):`);
    report.stockConflicts.forEach((l) => console.log(`  · ${l}`));
  }
  if (report.transfers.length) {
    console.log(`\nUnclosed transfers — earlier holder closed (${report.transfers.length}):`);
    report.transfers.forEach((l) => console.log(`  · ${l}`));
  }
  if (unmatched.length) {
    console.warn(`\n${unmatched.length} employees in the register are not in the database — their ${skippedItems} items were skipped:`);
    unmatched.forEach((u) => console.warn(`  · ${u.name} (${u.id}) — ${u.items} items`));
    console.warn('Add them in HR (or fix the ID number) and re-run; the import is idempotent.');
  }

  if (DRY) {
    const limit = Number((process.argv.find((a) => a.startsWith('--sample=')) || '').split('=')[1]) || 8;
    console.log(`\nSample of ${Math.min(limit, docs.length)} cleaned documents (--sample=N for more):`);
    console.log(docs.slice(0, limit).map((d) => [
      ` ${d.importKey.padEnd(17)}`,
      d.type.padEnd(15),
      `brand=${(d.brand || '—').padEnd(9)}`,
      `model=${(d.model || '—').padEnd(16)}`,
      `sn=${(d.serialNumber || '—').padEnd(22)}`,
      d.condition.padEnd(8),
      d.status.padEnd(9),
      d.notes || '',
    ].join(' ')).join('\n'));
    console.log('\nDRY RUN — nothing written.');
    await mongoose.connection.close();
    process.exit(0);
  }

  // ── 3. SYNC ───────────────────────────────────────────────────────────────
  let created = 0;
  let updated = 0;
  for (const doc of docs) {
    const { row, employeeName, ...fields } = doc;
    const existing = await Asset.findOne({ importKey: doc.importKey });
    if (existing) {
      Object.assign(existing, fields);
      await existing.save();
      updated++;
    } else {
      await Asset.create(fields);
      created++;
    }
  }

  // ── 4. PRUNE ──────────────────────────────────────────────────────────────
  // Rows a previous run created that the cleaned sheet no longer produces —
  // the duplicates resolved above. Scoped to imported documents only, so
  // anything a user entered by hand is untouchable.
  const keep = docs.map((d) => d.importKey);
  const stale = await Asset.deleteMany({ importKey: { $regex: '^it-', $nin: keep } });

  console.log(`\nDone. created=${created} updated=${updated} pruned=${stale.deletedCount} skipped(unmatched employee)=${skippedItems}`);
  await mongoose.connection.close();
  process.exit(0);
}

run().catch((e) => { console.error('Import failed:', e); process.exit(1); });
