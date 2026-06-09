import * as XLSX from 'xlsx';

// Normalized month list for fuzzy matching
const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];
const MONTH_PREFIX = MONTHS.map((m) => m.slice(0, 3));

// Arabic month names → month index (0-11). Includes common spelling variants.
const ARABIC_MONTHS: Record<string, number> = {
  'يناير': 0, 'جانيوري': 0, 'كانون الثاني': 0, 'كانون ثاني': 0,
  'فبراير': 1, 'فيبراير': 1, 'فبرواري': 1, 'شباط': 1,
  'مارس': 2, 'آذار': 2, 'اذار': 2,
  'ابريل': 3, 'أبريل': 3, 'إبريل': 3, 'ابريِل': 3, 'نيسان': 3, 'إيبريل': 3,
  'مايو': 4, 'مايُو': 4, 'مَايو': 4, 'أيار': 4, 'ايار': 4,
  'يونيو': 5, 'يونية': 5, 'حزيران': 5, 'جون': 5,
  'يوليو': 6, 'يولية': 6, 'تموز': 6, 'جولاي': 6, 'يولاي': 6,
  'اغسطس': 7, 'أغسطس': 7, 'آب': 7, 'اب': 7, 'اوغست': 7,
  'سبتمبر': 8, 'أيلول': 8, 'ايلول': 8, 'سبتمبير': 8,
  'اكتوبر': 9, 'أكتوبر': 9, 'تشرين الأول': 9, 'تشرين اول': 9, 'اكتوبير': 9,
  'نوفمبر': 10, 'تشرين الثاني': 10, 'تشرين ثاني': 10, 'نوفمبير': 10,
  'ديسمبر': 11, 'كانون الأول': 11, 'كانون اول': 11, 'ديسمبير': 11,
};

export interface ParsedDailyEntry {
  repIdNumber: string | null; // App account ID from the "ID #" column (rep's login on the delivery app)
  arabicName: string | null;
  englishName: string | null;
  joiningDate: string | null;
  monthName: string;       // 'January', etc.
  monthIndex: number;      // 1-12
  year: number;
  daysInMonth: number;
  dailyOrders: Record<number, number | null>;
  totalOrders: number;
  totalWorkingDays: number;
  dailyOrderRate: number;
  performancePercent: number;
  shortOfTarget: number;
  shortOfTargetPercent: number;
  monthlyTarget: number;
  dailyTarget: number;
  rowIndex: number;
}

export interface MonthSummary {
  monthLabel: string;       // "January 2026"
  monthIndex: number;       // 1-12
  year: number;
  recordsCount: number;     // # of rep rows
  daysInMonth: number;
  totalOrders: number;      // sum of all daily orders for the month
  workingDays: number;      // count of (rep × day) cells with non-null values > 0
  uniqueReps: number;
  headerRow: number;        // for diagnostics
  duplicates: DuplicateInfo[]; // duplicate rep entries detected in this sheet
}

export interface DuplicateRowDetail {
  row: number;              // 1-based row index in the Excel sheet
  totalOrders: number;      // sum of daily values in that row
  dailyOrders: Record<number, number | null>; // raw per-day values
}

export interface DuplicateInfo {
  repKey: string;           // account ID or "name:..." fallback
  englishName: string | null;
  arabicName: string | null;
  sheetLabel?: string;      // e.g. "May 2026"
  rows: number[];           // 1-based row indices in the sheet
  totalOrdersAcrossRows: number;
  details: DuplicateRowDetail[]; // per-row daily values for full transparency
}

export type DuplicateMode = 'first_wins' | 'last_wins' | 'sum';

export interface SheetDiagnostic {
  sheetName: string;            // raw sheet name from the workbook
  matched: boolean;             // did we recognize it as a monthly sheet?
  monthLabel?: string;          // "May 2026" if matched
  monthIndex?: number;
  year?: number;
  headerRow?: number;
  dayColumns?: Record<number, number>;     // day number -> 1-based Excel column
  identityColumns?: { idCol?: number; arNameCol?: number; enNameCol?: number; joinCol?: number; totalCol?: number };
  rowsParsed?: number;
  totalOrders?: number;
  totalDaysOff?: number;        // count of cells = 0
  totalNullDays?: number;       // count of cells = null
  rows?: Array<{
    excelRow: number;
    accountId: string | null;
    arabicName: string | null;
    englishName: string | null;
    rowTotal: number;
    daysOff: number;
    nullDays: number;
    daily: Record<number, number | null>;
  }>;
  reason?: string;              // if not matched, why was it skipped
}

export interface ExcelParseResult {
  records: ParsedDailyEntry[];
  monthsDetected: string[];
  monthSummaries: MonthSummary[];
  uniqueReps: number;
  warnings: string[];
  ignoredSheets: string[];
  duplicates: DuplicateInfo[]; // flattened across all sheets
  diagnostics: SheetDiagnostic[]; // EVERY sheet with full per-row breakdown
  fileName?: string;
}

const normalize = (s: any): string => String(s ?? '').trim().toLowerCase();

// Strip diacritics and Arabic tatweel/kashida; normalize hamza/alef variations to a base form.
const stripArabicDiacritics = (s: string): string =>
  s
    .replace(/[ً-ٰٟـ]/g, '') // tashkeel + tatweel
    .replace(/[إأآا]/g, 'ا')
    .replace(/[ىي]/g, 'ي')
    .replace(/ة/g, 'ه');

// STRICT matcher — sheet must START with a month name (case-insensitive),
// optionally followed by year/space/punctuation. Anything else is rejected.
// Examples that MATCH: "May", "MAY", "may", "May 2026", "MAY-2026", "May2026",
//   "January", "JANURARY" (common typo), "March", "Mayo", "مايو", "ابريل 2026"
// Examples that DON'T MATCH: "Sheet1", "MAINTENANC", "Performance", "DA INFO",
//   "Motorcycle Info", "Marathon", "Mayonnaise", "Notes", "Summary"
const matchMonth = (sheetName: string): { name: string; index: number } | null => {
  const raw = String(sheetName ?? '').trim();
  if (!raw) return null;
  const norm = raw.toLowerCase();

  // 1) English: extract leading letter run, check it starts with a month prefix
  //    AND is no longer than the full month name + 2 (typo tolerance like "JANURARY")
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

  // 2) Arabic: trimmed name must START with an Arabic month name (after stripping diacritics)
  const arNorm = stripArabicDiacritics(raw);
  for (const [ar, idx] of Object.entries(ARABIC_MONTHS)) {
    const target = stripArabicDiacritics(ar);
    if (arNorm.startsWith(target)) {
      return { name: capitalize(MONTHS[idx]), index: idx + 1 };
    }
  }

  return null;
};

const capitalize = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1);

const cellValue = (sheet: XLSX.WorkSheet, row: number, col: number): any => {
  const ref = XLSX.utils.encode_cell({ r: row - 1, c: col - 1 });
  const cell = sheet[ref];
  return cell ? cell.v : undefined;
};

const findHeaderRow = (sheet: XLSX.WorkSheet, range: XLSX.Range): number => {
  // Headers are typically row 10 (1-based), but vary across templates.
  // Score each row by how many recognizable header tokens AND day numbers it has.
  // Pick the row with the highest score.
  let bestRow = 10;
  let bestScore = -1;
  const maxRow = Math.min(20, range.e.r + 1);
  for (let r = 1; r <= maxRow; r++) {
    let score = 0;
    let dayCount = 0;
    for (let c = 1; c <= range.e.c + 1; c++) {
      const raw = cellValue(sheet, r, c);
      const v = normalize(raw);
      // Recognized header tokens — legacy ("ID #", "ID NAME", …) and new
      // Keeta dashboard ("Account ID", "Account user", "NAME", …).
      if (v === 'id #' || v === 'name' || v === 'id name' || v === 'total orders'
          || v === 'total working days' || v === 'daily order rate'
          || v === 'orders da performance %' || v === 'short of target#'
          || v === 'short of target %' || v === 'joining date'
          || v === 'account id' || v === 'account user'
          || v === 'total order of month per rider' || v === 'total orders of day') {
        score += 3;
      }
      if (asDayNumber(raw) !== null) {
        dayCount += 1;
      }
    }
    // Day columns are very strong evidence (we expect 28-31 day numbers in a header row)
    if (dayCount >= 20) score += dayCount;
    if (score > bestScore) {
      bestScore = score;
      bestRow = r;
    }
  }
  return bestRow;
};

// Lenient numeric parsing — Excel/Sheets cells can carry the value as a
// string with Arabic-Indic digits (٠-٩), Persian digits (۰-۹), thousands
// separators, decimal commas, or stray whitespace. Without this, any of
// those legitimate cells gets dropped to null/0 and the rep's total comes
// out short by exactly one (or more) order.
const coerceNumeric = (v: any): number | null => {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  let s = String(v == null ? '' : v).trim();
  if (s === '') return null;
  s = s.replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 1632));
  s = s.replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 1776));
  s = s.replace(/[,،\s]/g, '');
  if (s === '') return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
};

// Try to interpret a cell value as a day-of-month integer (1-31).
const asDayNumber = (v: any): number | null => {
  if (v === undefined || v === null || v === '') return null;
  if (typeof v === 'number' && Number.isFinite(v) && v >= 1 && v <= 31 && Number.isInteger(v)) {
    return v;
  }
  // Google Sheets auto-formats a number typed into a date-formatted column
  // into a Date on xlsx export. Without this branch, a header cell that
  // started life as "10" silently disappears and the whole column drops.
  if (v instanceof Date && !isNaN(v.getTime())) {
    const d = v.getUTCDate();
    if (d >= 1 && d <= 31) return d;
  }
  const n = coerceNumeric(v);
  if (n !== null && Number.isInteger(n) && n >= 1 && n <= 31) return n;
  return null;
};

const buildHeaderMap = (sheet: XLSX.WorkSheet, range: XLSX.Range, headerRow: number) => {
  const headers = new Map<string, number>();
  const dayCols = new Map<number, number>();
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
// positional fallback when a sheet has lost its header labels.
type ColumnClass = 'accountId' | 'arabicName' | 'englishName' | 'serial' | 'numeric' | 'empty' | 'mixed';
const classifyColumnByContent = (sheet: XLSX.WorkSheet, range: XLSX.Range, headerRow: number, col: number, sampleSize = 5): ColumnClass => {
  const samples: any[] = [];
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
// Only fills slots that aren't already detected — never overrides real headers.
const inferIdentityColumnsPositionally = (
  sheet: XLSX.WorkSheet,
  range: XLSX.Range,
  headerRow: number,
  dayCols: Map<number, number>,
  existing: { idCol: number | null; arNameCol: number | null; enNameCol: number | null },
) => {
  if (dayCols.size === 0) return existing;
  const sortedDays = [...dayCols.keys()].sort((a, b) => a - b);
  const firstDayCol = dayCols.get(sortedDays[0])!;
  const out = { ...existing };
  if (out.idCol && out.arNameCol && out.enNameCol) return out;
  for (let c = 1; c < firstDayCol; c++) {
    if (out.idCol === c || out.arNameCol === c || out.enNameCol === c) continue;
    const cls = classifyColumnByContent(sheet, range, headerRow, c);
    if (cls === 'accountId' && !out.idCol) out.idCol = c;
    else if (cls === 'arabicName' && !out.arNameCol) out.arNameCol = c;
    else if (cls === 'englishName' && !out.enNameCol) out.enNameCol = c;
  }
  return out;
};

// Infer missing low-numbered day columns when the labelled day range starts
// above 1 (e.g. only days 8..31 are labelled, but 1..7 also have data).
const inferMissingLowDays = (sheet: XLSX.WorkSheet, range: XLSX.Range, headerRow: number, dayCols: Map<number, number>) => {
  if (dayCols.size === 0) return;
  const sortedDays = [...dayCols.keys()].sort((a, b) => a - b);
  const minDay = sortedDays[0];
  if (minDay <= 1) return;
  const minDayCol = dayCols.get(minDay)!;
  for (let d = minDay - 1; d >= 1; d--) {
    const col = minDayCol - (minDay - d);
    if (col < 1) break;
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

// Pull the year out of the tab name itself ("February 2025" → 2025). Most
// reliable source — sheet bodies contain Account IDs and other long digit
// runs that can accidentally match a "20XX" substring.
const extractYearFromSheetName = (sheetName: string): number | null => {
  const m = String(sheetName == null ? '' : sheetName).match(/(?<!\d)(20\d{2})(?!\d)/);
  return m ? parseInt(m[1], 10) : null;
};

const extractYearFromSheet = (sheet: XLSX.WorkSheet, fallback: number): number => {
  // Collect ALL years that appear in rows 1..8, then return the most-frequent one.
  // Falls back to the latest year if no clear winner. Negative lookarounds keep
  // us from matching "20XX" inside longer digit runs like 16-digit Account IDs.
  const counts = new Map<number, number>();
  for (let r = 1; r <= 8; r++) {
    for (let c = 1; c <= 60; c++) {
      const v = cellValue(sheet, r, c);
      if (v === undefined || v === null) continue;
      const s = String(v);
      const matches = s.match(/(?<!\d)20\d{2}(?!\d)/g);
      if (matches) {
        for (const m of matches) {
          const y = parseInt(m, 10);
          counts.set(y, (counts.get(y) || 0) + 1);
        }
      }
    }
  }
  if (counts.size === 0) return fallback;
  // Pick the year with highest count; ties broken by most recent
  let bestYear = fallback;
  let bestCount = -1;
  for (const [y, c] of counts) {
    if (c > bestCount || (c === bestCount && y > bestYear)) {
      bestCount = c;
      bestYear = y;
    }
  }
  return bestYear;
};

const extractTargetsFromSheet = (sheet: XLSX.WorkSheet): { monthly: number; daily: number } => {
  for (let r = 6; r <= 10; r++) {
    for (let c = 1; c <= 60; c++) {
      const v = cellValue(sheet, r, c);
      if (v === undefined || v === null) continue;
      const s = String(v);
      const m = s.match(/Monthly Target\s*=\s*(\d+).*?Daily Target\s*=\s*(\d+)/i);
      if (m) return { monthly: parseInt(m[1], 10), daily: parseInt(m[2], 10) };
    }
  }
  return { monthly: 400, daily: 15 };
};

const safeNumber = (v: any): number => {
  if (v === undefined || v === null || v === '') return 0;
  const n = coerceNumeric(v);
  return n === null ? 0 : n;
};

const safeNullableNumber = (v: any): number | null => {
  if (v === undefined || v === null || v === '') return null;
  // Recover from xlsx's cellDates:true mode silently turning small integers
  // typed into date-formatted columns into Date objects. For day cells the
  // user typed N → Sheets stored serial N → xlsx returned Date(1900-01-N)
  // whose getUTCDate() is N for N ≤ 31. The year<1910 sentinel keeps real
  // dates (which aren't order counts) from being misread as small ints.
  if (v instanceof Date && !isNaN(v.getTime())) {
    if (v.getUTCFullYear() < 1910) return v.getUTCDate();
    return null;
  }
  return coerceNumeric(v);
};

const isoDate = (v: any): string | null => {
  if (!v) return null;
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (typeof v === 'number') {
    // Excel serial date
    const d = XLSX.SSF.parse_date_code(v);
    if (d) return `${d.y}-${String(d.m).padStart(2, '0')}-${String(d.d).padStart(2, '0')}`;
  }
  if (typeof v === 'string') {
    const d = new Date(v);
    if (!isNaN(d.getTime())) return d.toISOString().slice(0, 10);
  }
  return null;
};

export function parseRepsExcel(arrayBuffer: ArrayBuffer): ExcelParseResult {
  const wb = XLSX.read(arrayBuffer, { type: 'array', cellDates: true });
  const records: ParsedDailyEntry[] = [];
  const monthsDetected: string[] = [];
  const monthSummaries: MonthSummary[] = [];
  const warnings: string[] = [];
  const allDuplicates: DuplicateInfo[] = [];
  const diagnostics: SheetDiagnostic[] = [];
  const uniqueRepIds = new Set<string>();
  const fallbackYear = new Date().getFullYear();

  // Track ignored sheets — informational only, not warnings.
  // The user explicitly wants ONLY month-named sheets to be parsed; everything else is skipped silently.
  const ignoredSheets: string[] = [];

  for (const sheetName of wb.SheetNames) {
    const monthMatch = matchMonth(sheetName);
    if (!monthMatch) {
      ignoredSheets.push(sheetName);
      diagnostics.push({ sheetName, matched: false, reason: 'Not a month-named sheet' });
      continue;
    }

    const sheet = wb.Sheets[sheetName];
    if (!sheet || !sheet['!ref']) {
      diagnostics.push({ sheetName, matched: true, reason: 'Empty sheet (no cell range)' });
      continue;
    }

    const range = XLSX.utils.decode_range(sheet['!ref']);
    const headerRow = findHeaderRow(sheet, range);
    const { headers, dayCols } = buildHeaderMap(sheet, range, headerRow);

    if (dayCols.size === 0) {
      warnings.push(`Sheet "${sheetName}" has no day columns — skipped (header row was detected at row ${headerRow})`);
      diagnostics.push({ sheetName, matched: true, headerRow, reason: 'No day columns found in detected header row' });
      continue;
    }

    // Fill in low-numbered day columns when only days 8..31 (etc.) are labelled.
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
    const rateCol = headers.get('daily order rate');
    const perfCol = headers.get('orders da performance %');
    const shortCol = headers.get('short of target#');
    const shortPctCol = headers.get('short of target %');

    // Positional fallback — sniff column types from data when header labels
    // are missing or damaged. Only fills slots not detected via real headers.
    if (!enNameCol || !idCol || !arNameCol) {
      const inferred = inferIdentityColumnsPositionally(sheet, range, headerRow, dayCols, {
        idCol: idCol || null, arNameCol: arNameCol || null, enNameCol: enNameCol || null,
      });
      idCol = idCol || (inferred.idCol ?? undefined);
      arNameCol = arNameCol || (inferred.arNameCol ?? undefined);
      enNameCol = enNameCol || (inferred.enNameCol ?? undefined);
    }

    if (!enNameCol && !idCol) {
      warnings.push(`Sheet "${sheetName}" missing NAME and ID# headers — skipped`);
      continue;
    }

    // Prefer the year baked into the tab name ("February 2025"); fall back to
    // scanning the sheet body only when the tab name doesn't carry a year.
    const year = extractYearFromSheetName(sheetName) || extractYearFromSheet(sheet, fallbackYear);
    const targets = extractTargetsFromSheet(sheet);
    const monthLabel = `${monthMatch.name} ${year}`;
    if (!monthsDetected.includes(monthLabel)) monthsDetected.push(monthLabel);

    const daysInMonth = Math.max(...dayCols.keys());

    // Per-month aggregator (built up as we walk the rows)
    let monthRowCount = 0;
    let monthOrderSum = 0;
    let monthWorkingCells = 0;
    let monthDaysOff = 0;
    let monthNullDays = 0;
    const monthRepIds = new Set<string>();
    // Track each rep's row occurrences within this sheet for duplicate detection
    const repOccurrences = new Map<string, {
      rows: number[];
      totals: number[];
      dailies: Record<number, number | null>[];
      en: string | null;
      ar: string | null;
    }>();
    // Per-row breakdown for full diagnostics
    const diagRows: NonNullable<SheetDiagnostic['rows']> = [];

    const isBlank = (v: any) => v === undefined || v === null || v === '';

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

      // Row is empty only when ALL THREE identity cells are blank.
      // Accept rows with just the Arabic username (no English operator name yet).
      if (isBlank(idVal) && isBlank(enName) && isBlank(arName)) {
        emptyStreak++;
        if (emptyStreak >= 3) break;
        continue;
      }
      emptyStreak = 0;

      const dailyOrders: Record<number, number | null> = {};
      for (const [day, col] of dayCols) {
        dailyOrders[day] = safeNullableNumber(cellValue(sheet, r, col));
      }

      const repIdNumber = !isBlank(idVal) ? String(idVal).trim() : null;
      // Need at least ONE identity field — accept account ID, NAME, OR
      // Account user (column B). When NAME (column C) is blank we treat
      // column B as the rep's name; some agents only have a name in B.
      if (!repIdNumber && isBlank(enName) && isBlank(arName)) {
        warnings.push(`Sheet "${sheetName}" row ${r}: missing all identity columns`);
        continue;
      }
      const nameFromC = String(enName || '').trim();
      const nameFromB = String(arName || '').trim();
      const primaryName = nameFromC || nameFromB || '';
      const secondaryName = nameFromB && nameFromB !== primaryName ? nameFromB : '';
      const enKey = primaryName.toLowerCase().replace(/\s+/g, ' ');
      const arKey = secondaryName.toLowerCase().replace(/\s+/g, ' ');
      const repKey = (enKey || arKey)
        ? `name:${enKey}|ar:${arKey}`
        : (repIdNumber ? `id:${repIdNumber}` : `row:${r}`);
      uniqueRepIds.add(repKey);
      monthRepIds.add(repKey);
      monthRowCount += 1;

      let rowOrderTotal = 0;
      let rowDaysOff = 0;
      let rowNullDays = 0;
      for (const v of Object.values(dailyOrders)) {
        if (v === null || v === undefined) {
          rowNullDays += 1;
          monthNullDays += 1;
          continue;
        }
        const n = Number(v) || 0;
        monthOrderSum += n;
        rowOrderTotal += n;
        if (n > 0) monthWorkingCells += 1;
        else if (n === 0) { rowDaysOff += 1; monthDaysOff += 1; }
      }

      // Track per-row diagnostic
      diagRows.push({
        excelRow: r,
        accountId: repIdNumber,
        arabicName: secondaryName || null,
        englishName: primaryName || null,
        rowTotal: rowOrderTotal,
        daysOff: rowDaysOff,
        nullDays: rowNullDays,
        daily: { ...dailyOrders },
      });

      // Track this row's occurrence for the rep — duplicates are detected after the loop
      if (!repOccurrences.has(repKey)) {
        repOccurrences.set(repKey, {
          rows: [],
          totals: [],
          dailies: [],
          en: primaryName || null,
          ar: secondaryName || null,
        });
      }
      const occ = repOccurrences.get(repKey)!;
      occ.rows.push(r);
      occ.totals.push(rowOrderTotal);
      occ.dailies.push({ ...dailyOrders });

      records.push({
        repIdNumber,
        arabicName: secondaryName || null,
        englishName: primaryName || null,
        joiningDate: joinCol ? isoDate(cellValue(sheet, r, joinCol)) : null,
        monthName: monthMatch.name,
        monthIndex: monthMatch.index,
        year,
        daysInMonth,
        dailyOrders,
        totalOrders: totalCol ? safeNumber(cellValue(sheet, r, totalCol)) : Object.values(dailyOrders).reduce((s: number, v) => s + (v || 0), 0),
        totalWorkingDays: wdCol ? safeNumber(cellValue(sheet, r, wdCol)) : Object.values(dailyOrders).filter((v) => v !== null && v !== 0).length,
        dailyOrderRate: rateCol ? safeNumber(cellValue(sheet, r, rateCol)) : 0,
        performancePercent: perfCol ? safeNumber(cellValue(sheet, r, perfCol)) : 0,
        shortOfTarget: shortCol ? safeNumber(cellValue(sheet, r, shortCol)) : 0,
        shortOfTargetPercent: shortPctCol ? safeNumber(cellValue(sheet, r, shortPctCol)) : 0,
        monthlyTarget: targets.monthly,
        dailyTarget: targets.daily,
        rowIndex: r,
      });
    }

    // Build per-sheet duplicates from repOccurrences
    const sheetDuplicates: DuplicateInfo[] = [];
    for (const [key, occ] of repOccurrences) {
      if (occ.rows.length > 1) {
        const details: DuplicateRowDetail[] = occ.rows.map((row, i) => ({
          row,
          totalOrders: occ.totals[i],
          dailyOrders: occ.dailies[i],
        }));
        const dup: DuplicateInfo = {
          repKey: key,
          englishName: occ.en,
          arabicName: occ.ar,
          sheetLabel: monthLabel,
          rows: occ.rows,
          totalOrdersAcrossRows: occ.totals.reduce((s, n) => s + n, 0),
          details,
        };
        sheetDuplicates.push(dup);
        allDuplicates.push(dup);
      }
    }

    monthSummaries.push({
      monthLabel,
      monthIndex: monthMatch.index,
      year,
      recordsCount: monthRowCount,
      daysInMonth,
      totalOrders: monthOrderSum,
      workingDays: monthWorkingCells,
      uniqueReps: monthRepIds.size,
      headerRow,
      duplicates: sheetDuplicates,
    });

    diagnostics.push({
      sheetName,
      matched: true,
      monthLabel,
      monthIndex: monthMatch.index,
      year,
      headerRow,
      dayColumns: Object.fromEntries(dayCols.entries()),
      identityColumns: {
        idCol, arNameCol, enNameCol, joinCol, totalCol,
      },
      rowsParsed: monthRowCount,
      totalOrders: monthOrderSum,
      totalDaysOff: monthDaysOff,
      totalNullDays: monthNullDays,
      rows: diagRows,
    });
  }

  monthSummaries.sort((a, b) => (a.year - b.year) || (a.monthIndex - b.monthIndex));

  return {
    records,
    monthsDetected,
    monthSummaries,
    uniqueReps: uniqueRepIds.size,
    warnings,
    ignoredSheets,
    duplicates: allDuplicates,
    diagnostics,
  };
}

// Build a human-readable diagnostic report (for console.log AND download).
// Lists every sheet with its column mapping and per-row daily breakdown so
// the user can verify exactly what the parser is reading from the file.
export function buildDiagnosticReport(result: ExcelParseResult): string {
  const lines: string[] = [];
  const w = (s = '') => lines.push(s);

  w('==================================================');
  w('  B2C Excel Parse Diagnostic');
  w('==================================================');
  if (result.fileName) w(`File: ${result.fileName}`);
  w(`Total records: ${result.records.length}`);
  w(`Unique accounts: ${result.uniqueReps}`);
  w(`Months detected: ${result.monthsDetected.join(', ') || '(none)'}`);
  w(`Ignored sheets: ${result.ignoredSheets.join(', ') || '(none)'}`);
  w(`Warnings: ${result.warnings.length}`);
  w(`Duplicates: ${result.duplicates.length}`);
  w('');

  // Per-month summary
  w('--- PER-MONTH SUMMARY ---');
  for (const m of result.monthSummaries) {
    w(`  ${m.monthLabel}: rows=${m.recordsCount}, reps=${m.uniqueReps}, total=${m.totalOrders}, working=${m.workingDays}, headerRow=${m.headerRow}, dupes=${m.duplicates.length}`);
  }
  w('');

  // Detailed per-sheet
  for (const d of result.diagnostics) {
    w('--------------------------------------------------');
    w(`SHEET: "${d.sheetName}"`);
    if (!d.matched) {
      w(`  ❌ Skipped — ${d.reason || 'unknown'}`);
      continue;
    }
    if (!d.rows) {
      w(`  ⚠️ Matched but no rows — ${d.reason || 'unknown'}`);
      continue;
    }
    w(`  ✓ Matched as: ${d.monthLabel}`);
    w(`  Header row: ${d.headerRow}`);
    w(`  Identity columns: ID#=col${d.identityColumns?.idCol}, ID Name=col${d.identityColumns?.arNameCol}, NAME=col${d.identityColumns?.enNameCol}, Join=col${d.identityColumns?.joinCol ?? '(missing)'}, TotalOrders=col${d.identityColumns?.totalCol ?? '(missing)'}`);
    if (d.dayColumns) {
      const dayMap = Object.entries(d.dayColumns).map(([day, col]) => `d${day}=c${col}`).join(', ');
      w(`  Day columns (${Object.keys(d.dayColumns).length}): ${dayMap}`);
    }
    w(`  Total: orders=${d.totalOrders}, off=${d.totalDaysOff}, null=${d.totalNullDays}, rows=${d.rowsParsed}`);
    w('');
    w('  --- ROWS ---');
    for (const row of d.rows) {
      w(`  Excel row ${row.excelRow}: id="${row.accountId ?? '(empty)'}", AR="${row.arabicName ?? ''}", EN="${row.englishName ?? ''}"`);
      w(`    rowTotal=${row.rowTotal}, daysOff=${row.daysOff}, nulls=${row.nullDays}`);
      // Print daily values inline, omitting null days for readability
      const filled = Object.entries(row.daily)
        .map(([day, v]) => [Number(day), v] as [number, number | null])
        .sort((a, b) => a[0] - b[0]);
      const filledStr = filled.map(([day, v]) => v === null ? `d${day}=∅` : `d${day}=${v}`).join('  ');
      w(`    ${filledStr}`);
      w('');
    }
  }

  // Duplicates section — the most actionable info
  if (result.duplicates.length > 0) {
    w('==================================================');
    w('  DUPLICATE ACCOUNTS (same ID# in same sheet)');
    w('==================================================');
    for (const dup of result.duplicates) {
      w(`Account "${dup.repKey}" (${dup.englishName ?? ''} / ${dup.arabicName ?? ''}) in ${dup.sheetLabel}:`);
      for (const det of dup.details) {
        const filled = Object.entries(det.dailyOrders)
          .filter(([, v]) => v !== null)
          .map(([day, v]) => `d${day}=${v}`)
          .join('  ');
        w(`  Row ${det.row}: total=${det.totalOrders}  |  ${filled}`);
      }
      w('');
    }
  }

  if (result.warnings.length > 0) {
    w('==================================================');
    w('  WARNINGS');
    w('==================================================');
    result.warnings.forEach((warning) => w(`  ⚠️ ${warning}`));
  }

  return lines.join('\n');
}

// Convert parsed records into bulk-upsert payload. Requires a rep-id-to-DB-id resolver.
//
// Duplicate handling: when the SAME (rep, dateKey) appears multiple times because a sheet
// lists the same account on two rows, the user picks how to resolve the conflict:
//   - 'first_wins' (default): keep the first row's value, ignore later occurrences
//   - 'last_wins':  keep the last row's value
//   - 'sum':        add all values together (matches per-month totals from the parser)
//
// Semantic: 0 = "didn't work that day" (rep was off). Only positive orders mean active.
// null = no data entered yet (different from a real zero).
export function buildBulkPayload(
  records: ParsedDailyEntry[],
  resolveRepId: (record: ParsedDailyEntry) => string | null,
  duplicateMode: DuplicateMode = 'first_wins'
) {
  type Entry = {
    rep: string;
    dateKey: string;
    year: number;
    month: number;
    day: number;
    orders: number | null;
    worked: boolean;
    source: 'excel';
    sourceSheet?: string;
    sourceRow?: number;
  };

  const map = new Map<string, Entry>();

  for (const rec of records) {
    const repDbId = resolveRepId(rec);
    if (!repDbId) continue;
    for (const [dayStr, ordersRaw] of Object.entries(rec.dailyOrders)) {
      const day = Number(dayStr);
      const dateKey = `${rec.year}-${String(rec.monthIndex).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
      const k = `${repDbId}:${dateKey}`;

      const value = ordersRaw === null ? null : Number(ordersRaw);
      const isWorking = value !== null && value > 0;
      const existing = map.get(k);
      if (!existing) {
        map.set(k, {
          rep: repDbId,
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
      } else if (value !== null) {
        if (duplicateMode === 'sum') {
          existing.orders = (existing.orders ?? 0) + value;
          existing.worked = (existing.orders ?? 0) > 0;
          existing.sourceRow = rec.rowIndex; // last row to contribute
        } else if (duplicateMode === 'last_wins') {
          existing.orders = value;
          existing.worked = isWorking;
          existing.sourceRow = rec.rowIndex;
        }
        // first_wins: do nothing — keep the first value already in `existing`
      }
    }
  }

  return [...map.values()];
}
