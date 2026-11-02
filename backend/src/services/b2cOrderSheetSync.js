/**
 * Order sheets to order entries, every minute.
 * Each project has a Google Sheet (models/B2COrderSheet) with a tab per month; only cells changed since the last read (snapshot B2COrderSheetCell) are written: a new or edited number is written, a cleared cell clears it, and an unchanged cell is untouched. The latest edit wins wherever made.
 * Clearing happens only for an empty cell in an existing row of a tab that was read; deleted or renamed tabs and deleted rep rows are never read as clearing.
 */
const XLSX = require('xlsx');
const mongoose = require('mongoose');
const cache = require('../utils/ttlCache');

const MONTHS_AR = ['يناير', 'فبراير', 'مارس', 'ابريل', 'مايو', 'يونيو', 'يوليو', 'اغسطس', 'سبتمبر', 'اكتوبر', 'نوفمبر', 'ديسمبر'];
const AR_DIGITS = /[٠-٩۰-۹]/g;
const toLatin = (s) => String(s ?? '').replace(AR_DIGITS, (c) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(c) >= 0 ? '٠١٢٣٤٥٦٧٨٩'.indexOf(c) : '۰۱۲۳۴۵۶۷۸۹'.indexOf(c)));
const foldAr = (s) => String(s || '').replace(/[أإآٱ]/g, 'ا').replace(/ة/g, 'ه').replace(/ى/g, 'ي').replace(/\s+/g, ' ').trim();
const idKey = (v) => toLatin(v).replace(/\s+/g, '').toUpperCase();
const pad = (n) => String(n).padStart(2, '0');
// Months that are read. Months before October 2026 are in the file for reference: they were moved from the old sheets under old rep names and accounts (mostly without a residence number), so reading them would write the same number on a second account and count it twice. The system takes entry from October.
const SYNC_FROM = '2026-10';
// Totals row at the bottom of each tab, not a rep.
const TOTAL_ROW = /اجمال|إجمال|total/i;
const riyadhToday = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Riyadh' }).format(new Date());

/** File id from its link, or as is. */
const sheetIdOf = (v) => {
  const s = String(v || '').trim();
  const m = s.match(/\/d\/([a-zA-Z0-9_-]{20,})/) || s.match(/[?&]id=([a-zA-Z0-9_-]{20,})/);
  if (m) return m[1];
  return /^[a-zA-Z0-9_-]{20,}$/.test(s) ? s : '';
};

/** Download the file: Google Sheet first, then an uploaded Excel file as is. */
async function download(sheetId) {
  const urls = [
    `https://docs.google.com/spreadsheets/d/${sheetId}/export?format=xlsx`,
    `https://drive.google.com/uc?export=download&id=${sheetId}`,
  ];
  let last = '';
  for (const u of urls) {
    try {
      const r = await fetch(u, { redirect: 'follow', signal: AbortSignal.timeout(30000) });
      if (!r.ok) { last = `HTTP ${r.status}`; continue; }
      const buf = Buffer.from(await r.arrayBuffer());
      if (buf.slice(0, 2).toString() === 'PK') return buf;
      last = 'الملف غير مشارَك بالرابط (اجعل «أيُّ شخصٍ لديه الرابط» يستطيع العرض)';
    } catch (e) { last = e.message; }
  }
  throw new Error(last || 'تعذّر تنزيل الملف');
}

/** Tab month from its name: a month name with year, 2026-10 or 10-2026. */
function monthOfTab(name) {
  const s = foldAr(toLatin(name));
  let m = s.match(/(\d{4})\s*[-/._]\s*(\d{1,2})/);
  if (m) return [Number(m[1]), Number(m[2])];
  m = s.match(/(\d{1,2})\s*[-/._]\s*(\d{4})/);
  if (m) return [Number(m[2]), Number(m[1])];
  const y = (s.match(/(20\d{2})/) || [])[1];
  const i = MONTHS_AR.findIndex((n) => s.includes(n));
  if (y && i >= 0) return [Number(y), i + 1];
  return null;
}

/** Date of a day column from its header: a date, 01/10/2026 or 1/10, otherwise its position. */
function dayOfHeader(v, y, m, col) {
  const days = new Date(Date.UTC(y, m, 0)).getUTCDate();
  if (typeof v === 'number' && v > 30000) {
    const p = XLSX.SSF.parse_date_code(v);
    if (p && p.y === y && p.m === m) return p.d;
  }
  const s = toLatin(v).trim();
  const t = s.match(/^(\d{1,2})[/.-](\d{1,2})(?:[/.-](\d{2,4}))?$/);
  if (t && Number(t[2]) === m && Number(t[1]) >= 1 && Number(t[1]) <= days) return Number(t[1]);
  const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso && Number(iso[1]) === y && Number(iso[2]) === m) return Number(iso[3]);
  if (/^\d{1,2}$/.test(s) && Number(s) >= 1 && Number(s) <= days) return Number(s);
  // Position as a fallback: the fourth column is day one.
  const d = col - 2;
  return d >= 1 && d <= days && !s ? d : null;
}

/** Cell value: an integer >= 0, null for empty, or undefined for text that cannot be parsed (left untouched). */
function cellValue(v) {
  if (v === null || v === undefined) return null;
  if (typeof v === 'number') return Number.isInteger(v) && v >= 0 && v <= 2000 ? v : undefined;
  const s = toLatin(v).trim();
  if (!s) return null;
  if (/^\d+$/.test(s)) { const n = Number(s); return n <= 2000 ? n : undefined; }
  return undefined;
}

/** Reads the file into cells: [{ id, month: 'YYYY-MM', dateKey, value }] plus the rows and months that were read. */
function parseWorkbook(buf, today) {
  const wb = XLSX.read(buf, { type: 'buffer', cellDates: false });
  const cells = []; const rowsSeen = new Set(); const monthsRead = new Set();
  const nowMonth = today.slice(0, 7);
  for (const name of wb.SheetNames) {
    const ym = monthOfTab(name);
    if (!ym) continue;
    const [y, m] = ym;
    const month = `${y}-${pad(m)}`;
    if (month > nowMonth) continue; // Month not yet arrived: nothing in it is read
    if (month < SYNC_FROM) continue; // Reference-only month; see SYNC_FROM
    const aoa = XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1, raw: true, defval: null, blankrows: false });
    if (aoa.length < 2) continue;
    const header = aoa[0] || [];
    const dayCols = [];
    for (let c = 3; c < header.length || c < 3 + 31; c++) {
      const d = dayOfHeader(header[c] ?? '', y, m, c);
      if (d) dayCols.push([c, d]);
    }
    let rows = 0;
    for (let r = 1; r < aoa.length; r++) {
      const id = idKey(aoa[r]?.[0]);
      if (!id || id === '—' || TOTAL_ROW.test(id) || TOTAL_ROW.test(String(aoa[r]?.[1] ?? ''))) continue;
      rows += 1;
      rowsSeen.add(`${id}|${month}`);
      for (const [c, d] of dayCols) {
        const value = cellValue(aoa[r][c]);
        if (value === undefined) continue;
        cells.push({ id, month, dateKey: `${month}-${pad(d)}`, value });
      }
    }
    if (rows) monthsRead.add(month);
  }
  return { cells, rowsSeen, monthsRead };
}

/** Syncs one sheet. Returns the number of changes made in the system. */
async function syncSheet(sheet) {
  const { B2COrderSheetCell } = require('../models/B2COrderSheet');
  const B2CDailyOrder = require('../models/B2CDailyOrder');
  const { LightTransportEmployee } = require('../models/LightTransport');
  const E = require('../utils/b2cEntry');
  const today = riyadhToday();

  const buf = await download(sheet.sheetId);
  const { cells, rowsSeen, monthsRead } = parseWorkbook(buf, today);

  // Rep by residence number: anyone in the light-transport register, whatever their project today.
  const lts = await LightTransportEmployee.find({ idNumber: { $nin: [null, ''] } })
    .select('idNumber name projectAr cityAr phone supervisorUser history').lean();
  const byId = new Map(lts.map((l) => [idKey(l.idNumber), l]));
  const unknown = new Set();

  const snaps = await B2COrderSheetCell.find({ sheet: sheet._id }).lean();
  const snapOf = new Map(snaps.map((s) => [`${s.lt}|${s.dateKey}`, s]));

  const changes = []; // { lt, dateKey, value }
  const seenKeys = new Set();
  for (const c of cells) {
    const lt = byId.get(c.id);
    if (!lt) { unknown.add(c.id); continue; }
    if (c.dateKey > today) continue;
    const key = `${lt._id}|${c.dateKey}`;
    seenKeys.add(key);
    const prev = snapOf.get(key);
    const prevVal = prev ? prev.value : null;
    if (prevVal === c.value) continue;           // Unchanged in the sheet
    if (!prev && c.value === null) continue;     // Was empty and still is
    changes.push({ lt, dateKey: c.dateKey, value: c.value });
  }
  // Snapshots of cells that became fully empty (the cell was deleted) in a row and tab that were read: clear.
  const ltById = new Map(lts.map((l) => [String(l._id), l]));
  for (const s of snaps) {
    const key = `${s.lt}|${s.dateKey}`;
    if (seenKeys.has(key) || s.value === null) continue;
    const lt = ltById.get(String(s.lt));
    const month = s.dateKey.slice(0, 7);
    if (!lt || !monthsRead.has(month) || !rowsSeen.has(`${idKey(lt.idNumber)}|${month}`)) continue;
    changes.push({ lt, dateKey: s.dateKey, value: null });
  }

  // Written exactly as the script does at edit time (b2cSheetAppController.edit): onto the sheet's project; a rep's day in another project is not written; and the day's number is single per rep (his other accounts are cleared for that day). This used to use the rep's current project with no check or clearing, so the two paths wrote different values for the same day.
  const P = await E.projects();
  const proj = P.of(sheet.projectAr);
  let written = 0;
  for (const ch of changes) {
    if (proj && E.fold(E.projectTimeline(ch.lt)(ch.dateKey)) !== E.fold(proj.nameAr)) continue;
    const rep = await E.ensureRep(ch.lt, null);
    const [y, m, d] = ch.dateKey.split('-').map(Number);
    const others = ch.value === null ? 0 : await E.clearOtherAccounts(ch.lt, rep._id, ch.dateKey);
    const cur = await B2CDailyOrder.findOne({ rep: rep._id, dateKey: ch.dateKey }).select('orders').lean();
    const curVal = cur ? (cur.orders ?? null) : null;
    if (others) written += others;
    if (curVal !== ch.value) {
      await B2CDailyOrder.findOneAndUpdate(
        { rep: rep._id, dateKey: ch.dateKey },
        {
          $set: { orders: ch.value, worked: ch.value !== null && ch.value > 0, source: 'sheet', enteredBy: null, project: proj?._id || rep.project, branch: rep.branch, sourceSheet: sheet.projectAr },
          $setOnInsert: { date: new Date(`${ch.dateKey}T00:00:00.000Z`), year: y, month: m, day: d },
        },
        { upsert: true },
      );
      written += 1;
    }
    if (ch.value === null) {
      await B2COrderSheetCell.deleteOne({ sheet: sheet._id, lt: ch.lt._id, dateKey: ch.dateKey });
    } else {
      await B2COrderSheetCell.updateOne({ sheet: sheet._id, lt: ch.lt._id, dateKey: ch.dateKey }, { $set: { value: ch.value } }, { upsert: true });
    }
  }

  sheet.lastSyncAt = new Date();
  sheet.lastOkAt = sheet.lastSyncAt;
  sheet.lastError = '';
  sheet.lastChanges = written;
  sheet.unknownIds = [...unknown].slice(0, 50);
  await sheet.save();
  return written;
}

let running = false;
async function syncAll() {
  if (running || mongoose.connection.readyState !== 1) return 0;
  running = true;
  let total = 0;
  try {
    const { B2COrderSheet } = require('../models/B2COrderSheet');
    const sheets = await B2COrderSheet.find({ enabled: true });
    for (const s of sheets) {
      try { total += await syncSheet(s); }
      catch (e) {
        s.lastSyncAt = new Date(); s.lastError = String(e.message || e).slice(0, 300);
        await s.save().catch(() => {});
      }
    }
    if (total) {
      cache.clear('b2c:');
      try { require('../websocket/socketManager').emitToAll('b2c:order:upserted', { bulk: true, source: 'sheet', count: total }); } catch (_) { /* */ }
      console.log(`[b2c-sheets] ${total} خانةً تغيّرت من شيتات الأوردرات`);
    }
  } finally { running = false; }
  return total;
}

function startB2cOrderSheetSync() {
  setTimeout(() => syncAll().catch((e) => console.error('[b2c-sheets]', e.message)), 20 * 1000);
  setInterval(() => syncAll().catch((e) => console.error('[b2c-sheets]', e.message)), 60 * 1000).unref();
}

module.exports = { startB2cOrderSheetSync, syncAll, syncSheet, sheetIdOf, parseWorkbook, monthOfTab };
