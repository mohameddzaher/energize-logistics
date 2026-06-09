// Backend mirror of frontend src/lib/b2cExcelParser.ts.
// Keep the two in sync: any logic change must be applied in both files.
// Used by the Google Sheet sync service to parse downloaded workbooks server-side.

const XLSX = require('xlsx');

const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];

const ARABIC_MONTHS = {
  'يناير': 0, 'جانيوري': 0, 'كانون الثاني': 0, 'كانون ثاني': 0,
  'فبراير': 1, 'فيبراير': 1, 'فبرواري': 1, 'شباط': 1,
  'مارس': 2, 'آذار': 2, 'اذار': 2,
  'ابريل': 3, 'أبريل': 3, 'إبريل': 3, 'نيسان': 3, 'إيبريل': 3,
  'مايو': 4, 'أيار': 4, 'ايار': 4,
  'يونيو': 5, 'يونية': 5, 'حزيران': 5, 'جون': 5,
  'يوليو': 6, 'يولية': 6, 'تموز': 6, 'جولاي': 6, 'يولاي': 6,
  'اغسطس': 7, 'أغسطس': 7, 'آب': 7, 'اب': 7, 'اوغست': 7,
  'سبتمبر': 8, 'أيلول': 8, 'ايلول': 8, 'سبتمبير': 8,
  'اكتوبر': 9, 'أكتوبر': 9, 'تشرين الأول': 9, 'تشرين اول': 9, 'اكتوبير': 9,
  'نوفمبر': 10, 'تشرين الثاني': 10, 'تشرين ثاني': 10, 'نوفمبير': 10,
  'ديسمبر': 11, 'كانون الأول': 11, 'كانون اول': 11, 'ديسمبير': 11,
};

const stripArabicDiacritics = (s) =>
  s.replace(/[ً-ٰٟـ]/g, '').replace(/[إأآا]/g, 'ا').replace(/[ىي]/g, 'ي').replace(/ة/g, 'ه');

const capitalize = (s) => s.charAt(0).toUpperCase() + s.slice(1);
const normalize = (s) => String(s == null ? '' : s).trim().toLowerCase();

const matchMonth = (sheetName) => {
  const raw = String(sheetName == null ? '' : sheetName).trim();
  if (!raw) return null;
  const norm = raw.toLowerCase();
  const lead = norm.match(/^[a-z]+/);
  if (lead) {
    const word = lead[0];
    for (let i = 0; i < MONTHS.length; i++) {
      const fullMonth = MONTHS[i];
      const prefix = fullMonth.slice(0, 3);
      if (word.startsWith(prefix) && word.length <= fullMonth.length + 2) {
        return { name: capitalize(fullMonth), index: i + 1 };
      }
    }
  }
  const arNorm = stripArabicDiacritics(raw);
  for (const [ar, idx] of Object.entries(ARABIC_MONTHS)) {
    const target = stripArabicDiacritics(ar);
    if (arNorm.startsWith(target)) {
      return { name: capitalize(MONTHS[idx]), index: idx + 1 };
    }
  }
  return null;
};

const cellValue = (sheet, row, col) => {
  const ref = XLSX.utils.encode_cell({ r: row - 1, c: col - 1 });
  const cell = sheet[ref];
  return cell ? cell.v : undefined;
};

const asDayNumber = (v) => {
  if (v === undefined || v === null || v === '') return null;
  if (typeof v === 'number' && Number.isFinite(v) && v >= 1 && v <= 31 && Number.isInteger(v)) {
    return v;
  }
  // Google Sheets auto-formats numbers like "10" inside a date-context column
  // into Date objects on xlsx export (cellDates:true). Without this branch,
  // a header cell that started life as "10" ends up as Date and the parser
  // silently drops the whole column — that's the "day 10 not syncing" bug.
  if (v instanceof Date && !isNaN(v.getTime())) {
    const d = v.getUTCDate();
    if (d >= 1 && d <= 31) return d;
  }
  // Reuse the same lenient numeric coercion the data cells use, then check
  // the result is a whole number in [1, 31].
  const n = coerceNumeric(v);
  if (n !== null && Number.isInteger(n) && n >= 1 && n <= 31) return n;
  return null;
};

// Header tokens we recognize. Includes both the legacy schema ("ID #", "ID NAME")
// and the new Keeta dashboard schema ("Account ID", "Account user", "NAME").
const HEADER_TOKENS = new Set([
  // Legacy
  'id #', 'name', 'id name', 'total orders', 'total working days',
  'daily order rate', 'orders da performance %', 'short of target#',
  'short of target %', 'joining date',
  // New Keeta layout
  'account id', 'account user',
  'total order of month per rider', 'total orders of day',
]);

const findHeaderRow = (sheet, range) => {
  let bestRow = 10;
  let bestScore = -1;
  const maxRow = Math.min(20, range.e.r + 1);
  for (let r = 1; r <= maxRow; r++) {
    let score = 0;
    let dayCount = 0;
    for (let c = 1; c <= range.e.c + 1; c++) {
      const raw = cellValue(sheet, r, c);
      const v = normalize(raw);
      if (HEADER_TOKENS.has(v)) score += 3;
      if (asDayNumber(raw) !== null) dayCount += 1;
    }
    if (dayCount >= 20) score += dayCount;
    if (score > bestScore) { bestScore = score; bestRow = r; }
  }
  return bestRow;
};

const buildHeaderMap = (sheet, range, headerRow) => {
  const headers = new Map();
  const dayCols = new Map();
  for (let c = 1; c <= range.e.c + 1; c++) {
    const v = cellValue(sheet, headerRow, c);
    if (v === undefined || v === null || v === '') continue;
    const dayNum = asDayNumber(v);
    if (dayNum !== null) {
      dayCols.set(dayNum, c);
    } else {
      const key = normalize(v).replace(/\s+/g, ' ');
      headers.set(key, c);
    }
  }
  return { headers, dayCols };
};

// Sniff the first few data rows of a column and classify it. Used as a
// positional fallback when a sheet has lost its header labels. Returns one
// of: 'accountId' | 'arabicName' | 'englishName' | 'serial' | 'numeric' | 'empty' | 'mixed'.
const classifyColumnByContent = (sheet, range, headerRow, col, sampleSize = 5) => {
  const samples = [];
  for (let r = headerRow + 1; r <= Math.min(headerRow + sampleSize, range.e.r + 1); r++) {
    const v = cellValue(sheet, r, col);
    if (v == null || v === '') continue;
    samples.push(v);
  }
  if (samples.length === 0) return 'empty';

  let longInt = 0, smallInt = 0, arabic = 0, english = 0, otherNumeric = 0;
  for (const v of samples) {
    const s = String(v).trim();
    if (/^\d{12,}$/.test(s)) { longInt++; continue; }
    if (/^\d{1,2}$/.test(s)) { smallInt++; continue; }
    if (typeof v === 'number' || coerceNumeric(v) !== null) { otherNumeric++; continue; }
    if (/^[؀-ۿ\s\-_.]+$/.test(s)) { arabic++; continue; }
    if (/[A-Za-z]/.test(s)) { english++; continue; }
  }
  const total = samples.length;
  if (longInt / total >= 0.6) return 'accountId';
  if (arabic / total >= 0.6) return 'arabicName';
  if (english / total >= 0.4) return 'englishName';
  if (smallInt / total >= 0.6) return 'serial';
  if ((smallInt + otherNumeric) / total >= 0.6) return 'numeric';
  return 'mixed';
};

// When a sheet's header labels are missing (e.g. someone wiped them by
// accident), fall back to inferring identity columns from the data itself.
// Only fills slots that aren't already detected — never overrides real
// headers. Returns { idCol, arNameCol, enNameCol } each either a 1-based
// column index or null.
const inferIdentityColumnsPositionally = (sheet, range, headerRow, dayCols, existing) => {
  if (dayCols.size === 0) return existing;
  const sortedDays = [...dayCols.keys()].sort((a, b) => a - b);
  const firstDayCol = dayCols.get(sortedDays[0]);
  const out = { ...existing };

  for (let c = 1; c < firstDayCol; c++) {
    if (out.idCol === c || out.arNameCol === c || out.enNameCol === c) continue;
    const cls = classifyColumnByContent(sheet, range, headerRow, c);
    if (cls === 'accountId' && !out.idCol) out.idCol = c;
    else if (cls === 'arabicName' && !out.arNameCol) out.arNameCol = c;
    else if (cls === 'englishName' && !out.enNameCol) out.enNameCol = c;
    // 'serial', 'empty', 'numeric', 'mixed' are ignored — they aren't identity columns.
  }
  return out;
};

// Some sheets only label a contiguous tail of day columns (e.g. days 8..31)
// because earlier days were filled in before the header row was completed.
// If the labelled day range starts above 1 AND the columns immediately to
// the left of the first labelled day contain numeric data, infer those as
// the missing earlier days. Validates with the data itself so we don't
// mis-classify an identity column as a day column.
const inferMissingLowDays = (sheet, range, headerRow, dayCols) => {
  if (dayCols.size === 0) return;
  const sortedDays = [...dayCols.keys()].sort((a, b) => a - b);
  const minDay = sortedDays[0];
  if (minDay <= 1) return;
  const minDayCol = dayCols.get(minDay);

  for (let d = minDay - 1; d >= 1; d--) {
    const col = minDayCol - (minDay - d);
    if (col < 1) break;

    // Verify the column looks like a day column — most cells should be
    // null or numeric in the [0, 1000] range. Stop the moment we see
    // non-numeric content (we've hit an identity column).
    let numeric = 0, nonNumeric = 0;
    for (let r = headerRow + 1; r <= Math.min(headerRow + 5, range.e.r + 1); r++) {
      const v = cellValue(sheet, r, col);
      if (v == null || v === '') continue;
      if (typeof v === 'number') { numeric++; continue; }
      const n = coerceNumeric(v);
      if (n !== null && n >= 0 && n <= 1000) numeric++; else nonNumeric++;
    }
    if (nonNumeric > 0) break;
    if (numeric > 0) dayCols.set(d, col);
  }
};

// Pull the year out of the tab name itself ("February 2025" → 2025). The tab
// name is the most reliable source — sheet bodies contain Account IDs and
// other long digit runs that can accidentally match a "20XX" substring.
const extractYearFromSheetName = (sheetName) => {
  const m = String(sheetName == null ? '' : sheetName).match(/(?<!\d)(20\d{2})(?!\d)/);
  return m ? parseInt(m[1], 10) : null;
};

const extractYearFromSheet = (sheet, fallback) => {
  const counts = new Map();
  for (let r = 1; r <= 8; r++) {
    for (let c = 1; c <= 60; c++) {
      const v = cellValue(sheet, r, c);
      if (v === undefined || v === null) continue;
      // Negative lookarounds keep us from matching "20XX" inside longer digit
      // runs like 16-digit Account IDs (e.g. "1234567890206612" contains
      // "2066" as a substring but isn't a year).
      const matches = String(v).match(/(?<!\d)20\d{2}(?!\d)/g);
      if (matches) {
        for (const m of matches) {
          const y = parseInt(m, 10);
          counts.set(y, (counts.get(y) || 0) + 1);
        }
      }
    }
  }
  if (counts.size === 0) return fallback;
  let bestYear = fallback, bestCount = -1;
  for (const [y, c] of counts) {
    if (c > bestCount || (c === bestCount && y > bestYear)) { bestCount = c; bestYear = y; }
  }
  return bestYear;
};

const extractTargetsFromSheet = (sheet) => {
  for (let r = 6; r <= 10; r++) {
    for (let c = 1; c <= 60; c++) {
      const v = cellValue(sheet, r, c);
      if (v === undefined || v === null) continue;
      const m = String(v).match(/Monthly Target\s*=\s*(\d+).*?Daily Target\s*=\s*(\d+)/i);
      if (m) return { monthly: parseInt(m[1], 10), daily: parseInt(m[2], 10) };
    }
  }
  return { monthly: 400, daily: 15 };
};

// Lenient numeric parsing — Excel/Sheets cells can carry the value as a
// string with Arabic-Indic digits (٠-٩), Persian digits (۰-۹), thousands
// separators, decimal commas, or stray whitespace. Without this, any of
// those legitimate cells gets dropped to null/0 and the rep's total comes
// out short by exactly one (or more) order.
const coerceNumeric = (v) => {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  let s = String(v == null ? '' : v).trim();
  if (s === '') return null;
  // Arabic-Indic and Persian digit ranges
  s = s.replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 1632));
  s = s.replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 1776));
  // Thousands separators (regular comma + Arabic comma) and stray spaces
  s = s.replace(/[,،\s]/g, '');
  if (s === '') return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
};

const safeNumber = (v) => {
  if (v === undefined || v === null || v === '') return 0;
  const n = coerceNumeric(v);
  return n === null ? 0 : n;
};

const safeNullableNumber = (v) => {
  if (v === undefined || v === null || v === '') return null;
  // Recover from xlsx's cellDates:true mode silently turning small integers
  // (typed as plain numbers into a date-formatted column in Google Sheets)
  // into Date objects. For day cells the user typed N — Sheets stored serial
  // N — xlsx returned Date(1900-01-(N+offset)) whose getUTCDate() is N for
  // N ≤ 31. The year<1910 sentinel distinguishes these synthetic Excel-epoch
  // dates from a real date (which we'd want to ignore as a non-number).
  if (v instanceof Date && !isNaN(v.getTime())) {
    if (v.getUTCFullYear() < 1910) return v.getUTCDate();
    return null;
  }
  return coerceNumeric(v);
};

const isoDate = (v) => {
  if (!v) return null;
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (typeof v === 'number') {
    const d = XLSX.SSF.parse_date_code(v);
    if (d) return `${d.y}-${String(d.m).padStart(2, '0')}-${String(d.d).padStart(2, '0')}`;
  }
  if (typeof v === 'string') {
    const d = new Date(v);
    if (!isNaN(d.getTime())) return d.toISOString().slice(0, 10);
  }
  return null;
};

function parseRepsExcel(buffer) {
  const wb = XLSX.read(buffer, { type: 'buffer', cellDates: true });
  const records = [];
  const monthsDetected = [];
  const warnings = [];
  const ignoredSheets = [];
  const fallbackYear = new Date().getFullYear();
  const isBlank = (v) => v === undefined || v === null || v === '';

  for (const sheetName of wb.SheetNames) {
    const monthMatch = matchMonth(sheetName);
    if (!monthMatch) { ignoredSheets.push(sheetName); continue; }
    const sheet = wb.Sheets[sheetName];
    if (!sheet || !sheet['!ref']) continue;
    const range = XLSX.utils.decode_range(sheet['!ref']);
    const headerRow = findHeaderRow(sheet, range);
    const { headers, dayCols } = buildHeaderMap(sheet, range, headerRow);
    if (dayCols.size === 0) {
      warnings.push(`Sheet "${sheetName}" has no day columns — skipped`);
      continue;
    }

    // If the labelled day range starts above 1, fill in the missing low days
    // by inspecting the columns immediately to the left of the first labelled day.
    inferMissingLowDays(sheet, range, headerRow, dayCols);

    let idCol = headers.get('id #') || headers.get('account id');
    let arNameCol = headers.get('id name') || headers.get('account user');
    let enNameCol = headers.get('name');
    // Some sheets prefix the name header ("Raidar NAME", "Rider Name", "DA Name")
    // instead of the bare "NAME". Match any header ending in "name" so those
    // columns aren't missed — without this, a tab whose ONLY populated identity
    // column is "Raidar NAME" parses to zero rows (Account ID / Account user are
    // blank, so every row reads empty and the loop bails after 3 blanks).
    if (!enNameCol) {
      for (const [k, c] of headers) {
        if (k === 'id name') continue; // reserved for arNameCol (Account user / ID Name)
        if (/(?:^|\s)name$/.test(k)) { enNameCol = c; break; }
      }
    }
    const joinCol = headers.get('joining date');
    const totalCol = headers.get('total orders') || headers.get('total order of month per rider');
    const wdCol = headers.get('total working days');

    // If headers are damaged/missing, sniff column types from the data itself.
    // Only fills slots that aren't already detected via real headers.
    if (!enNameCol || !idCol || !arNameCol) {
      const inferred = inferIdentityColumnsPositionally(sheet, range, headerRow, dayCols, {
        idCol: idCol || null, arNameCol: arNameCol || null, enNameCol: enNameCol || null,
      });
      idCol = idCol || inferred.idCol;
      arNameCol = arNameCol || inferred.arNameCol;
      enNameCol = enNameCol || inferred.enNameCol;
    }

    if (!enNameCol && !idCol && !arNameCol) {
      warnings.push(`Sheet "${sheetName}" missing identity columns — skipped`);
      continue;
    }

    // Prefer the year baked into the tab name ("February 2025"); fall back to
    // scanning the sheet body only when the tab name doesn't carry a year.
    const year = extractYearFromSheetName(sheetName) || extractYearFromSheet(sheet, fallbackYear);
    const targets = extractTargetsFromSheet(sheet);
    const monthLabel = `${monthMatch.name} ${year}`;
    if (!monthsDetected.includes(monthLabel)) monthsDetected.push(monthLabel);
    const daysInMonth = Math.max(...dayCols.keys());

    let emptyStreak = 0;
    for (let r = headerRow + 1; r <= range.e.r + 1; r++) {
      const idVal = idCol ? cellValue(sheet, r, idCol) : undefined;
      const enName = enNameCol ? cellValue(sheet, r, enNameCol) : undefined;
      const arName = arNameCol ? cellValue(sheet, r, arNameCol) : undefined;

      // Hard stop on the totals row — the Keeta layout marks the end of the
      // agent list with a "Total orders of day" cell. Originally this lived
      // in column A, but sheets that prepend a serial-number column shift it
      // to col D (the NAME slot). Scan the first ~10 columns so we catch it
      // regardless of layout — without this, the totals row is read as a fake
      // rep and the dashboard double-counts every day.
      let isTotalsRow = false;
      const totalsScanCols = Math.min(10, range.e.c + 1);
      for (let cc = 1; cc <= totalsScanCols; cc++) {
        const v = cellValue(sheet, r, cc);
        if (typeof v === 'string' && v.toLowerCase().includes('total orders of day')) {
          isTotalsRow = true;
          break;
        }
      }
      if (isTotalsRow) break;

      if (isBlank(idVal) && isBlank(enName) && isBlank(arName)) {
        emptyStreak++;
        if (emptyStreak >= 3) break;
        continue;
      }
      emptyStreak = 0;

      const dailyOrders = {};
      for (const [day, col] of dayCols) {
        dailyOrders[day] = safeNullableNumber(cellValue(sheet, r, col));
      }

      const repIdNumber = !isBlank(idVal) ? String(idVal).trim() : null;
      if (!repIdNumber && isBlank(enName) && isBlank(arName)) continue;

      // The rep's name is just "the name" — language doesn't matter. Prefer
      // column C (NAME); if empty, fall back to column B (Account user). The
      // sheet's column B is sometimes the only place a rep's name shows up,
      // so without this fallback those reps would all collapse to "Unknown".
      const nameFromC = enName ? String(enName).trim() : '';
      const nameFromB = arName ? String(arName).trim() : '';
      const primaryName = nameFromC || nameFromB || null;
      // arabicName field is now display-only — keep column B's value when it
      // differs from the primary name; otherwise leave it null.
      const secondaryName = nameFromB && nameFromB !== primaryName ? nameFromB : null;

      records.push({
        repIdNumber,
        arabicName: secondaryName,
        englishName: primaryName,
        joiningDate: joinCol ? isoDate(cellValue(sheet, r, joinCol)) : null,
        monthName: monthMatch.name,
        monthIndex: monthMatch.index,
        year,
        daysInMonth,
        dailyOrders,
        totalOrders: totalCol ? safeNumber(cellValue(sheet, r, totalCol)) : Object.values(dailyOrders).reduce((s, v) => s + (v || 0), 0),
        totalWorkingDays: wdCol ? safeNumber(cellValue(sheet, r, wdCol)) : Object.values(dailyOrders).filter((v) => v !== null && v > 0).length,
        monthlyTarget: targets.monthly,
        dailyTarget: targets.daily,
        rowIndex: r,
      });
    }
  }

  return { records, monthsDetected, warnings, ignoredSheets };
}

// Group records into the resolver shape used by bulk-upsert. Identity is
// NAME first (the rep's actual person), Account ID only as a last-resort
// fallback for nameless rows. The Keeta sheet shares Account IDs across
// physical drivers, so keying by ID would collapse different people into
// one rep.
function buildResolverPayload(records) {
  const norm = (s) => String(s == null ? '' : s).trim().toLowerCase().replace(/\s+/g, ' ');
  const buildKey = (rec) => {
    const en = norm(rec.englishName);
    if (en) return `name:${en}`;
    if (rec.repIdNumber) return `id:${String(rec.repIdNumber).trim()}`;
    return '';
  };

  const reps = [];
  const seenForReps = new Set();
  for (const rec of records) {
    const key = buildKey(rec);
    if (!key) continue;
    reps.push({
      key,
      repId: rec.repIdNumber,
      englishName: rec.englishName,
      arabicName: rec.arabicName,
      joiningDate: rec.joiningDate,
      monthlyTarget: rec.monthlyTarget,
      dailyTarget: rec.dailyTarget,
    });
    seenForReps.add(key);
  }

  return { reps, buildKey };
}

// Build daily-order entries from records using a key→DBId resolver.
// Same (rep, dateKey) seen multiple times → first row wins (matches frontend default).
function buildDailyEntries(records, keyToDbId, buildKey) {
  const map = new Map();
  for (const rec of records) {
    const dbId = keyToDbId.get(buildKey(rec));
    if (!dbId) continue;
    for (const [dayStr, ordersRaw] of Object.entries(rec.dailyOrders)) {
      const day = Number(dayStr);
      const dateKey = `${rec.year}-${String(rec.monthIndex).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
      const k = `${dbId}:${dateKey}`;
      const value = ordersRaw === null ? null : Number(ordersRaw);
      const isWorking = value !== null && value > 0;
      if (!map.has(k)) {
        map.set(k, {
          rep: dbId,
          dateKey,
          year: rec.year,
          month: rec.monthIndex,
          day,
          orders: value,
          worked: isWorking,
          source: 'excel',
          sourceSheet: `${rec.monthName} ${rec.year}`,
          sourceRow: rec.rowIndex,
        });
      }
      // first-row-wins: ignore subsequent duplicates of same (rep, dateKey)
    }
  }
  return [...map.values()];
}

module.exports = { parseRepsExcel, buildResolverPayload, buildDailyEntries };
