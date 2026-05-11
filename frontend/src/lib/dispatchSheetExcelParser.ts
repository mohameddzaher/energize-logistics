import * as XLSX from 'xlsx';

export interface DispatchSheetRow {
  rowIndex: number;          // 1-based excel row number (data row, not header)
  rentalType: string;        // نوع الايجار
  carBrand: string;          // الماركه
  carColor: string;          // لون السياره
  carType: string;           // نوع السياره
  plateNumber: string;       // رقم السياره
  driverAdvance: string;     // سلفه السائق
  driverPhone: string;       // جوال السائق
  driverIqama: string;       // رقم الاقامه
  driverNationality: string; // جنسيه السائق
  driverName: string;        // اسم السائق
  customerName: string;      // اسم العميل
  branch: string;            // الفرع
  toLocation: string;        // الي
  fromLocation: string;      // من
  date: string;              // التاريخ (formatted d/m/yyyy)
  dispatchNumber: string;    // كشف التخريج
  missingRequired: string[]; // names of required fields that are empty/missing
}

export interface DispatchSheetParseResult {
  rows: DispatchSheetRow[];
  totalRows: number;
  rowsWithMissingFields: number;
  missingColumns: string[];   // header names that were not found in the file
  warnings: string[];
  fileName?: string;
}

// Required column headers (Arabic, exact spelling from spec)
const COLUMN_HEADERS = {
  rentalType: 'نوع الايجار',
  carBrand: 'الماركه',
  carColor: 'لون السياره',
  carType: 'نوع السياره',
  plateNumber: 'رقم السياره',
  driverAdvance: 'سلفه السائق',
  driverPhone: 'جوال السائق',
  driverIqama: 'رقم الاقامه',
  driverNationality: 'جنسيه السائق',
  driverName: 'اسم السائق',
  customerName: 'اسم العميل',
  branch: 'الفرع',
  toLocation: 'الي',
  fromLocation: 'من',
  date: 'التاريخ',
  dispatchNumber: 'كشف التخريج',
} as const;

type FieldKey = keyof typeof COLUMN_HEADERS;

// Fields that must not be empty for the row to be considered valid
const REQUIRED_FIELDS: FieldKey[] = ['date', 'dispatchNumber', 'driverName', 'plateNumber'];

// Strip diacritics, tatweel, normalize alef/ya variants — header matching needs to
// be lenient because Excel files often have invisible characters or slight variants.
const normalizeArabic = (s: string): string =>
  s
    .replace(/[ً-ٰٟـ]/g, '')
    .replace(/[إأآا]/g, 'ا')
    .replace(/[ىي]/g, 'ي')
    .replace(/ة/g, 'ه')
    .replace(/\s+/g, ' ')
    .trim();

const matchHeader = (cell: any, expected: string): boolean => {
  if (cell == null) return false;
  return normalizeArabic(String(cell)) === normalizeArabic(expected);
};

// Excel serial date → Date. xlsx returns either a string or a Date object
// depending on cellDates setting; handle both.
const excelDateToDisplay = (value: any): string => {
  if (value == null || value === '') return '';
  if (value instanceof Date) {
    if (isNaN(value.getTime())) return '';
    return formatDate(value);
  }
  if (typeof value === 'number') {
    // Excel serial date: days since 1899-12-30
    const d = new Date(Math.round((value - 25569) * 86400 * 1000));
    if (isNaN(d.getTime())) return String(value);
    return formatDate(d);
  }
  const s = String(value).trim();
  if (!s) return '';
  // Try parsing common formats
  const parsed = new Date(s);
  if (!isNaN(parsed.getTime())) return formatDate(parsed);
  return s;
};

const formatDate = (d: Date): string => {
  const day = d.getDate();
  const month = d.getMonth() + 1;
  const year = d.getFullYear();
  return `${day}/${month}/${year}`;
};

// Convert Arabic-Indic digits (٠-٩) to Western (0-9). The spec wants Western
// digits in all output.
const toWesternDigits = (s: string): string =>
  s.replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660))
   .replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06F0));

const cellToString = (value: any): string => {
  if (value == null) return '';
  if (value instanceof Date) return formatDate(value);
  return toWesternDigits(String(value).trim());
};

export function parseDispatchSheetExcel(buffer: ArrayBuffer, fileName?: string): DispatchSheetParseResult {
  const workbook = XLSX.read(buffer, { type: 'array', cellDates: true });
  const sheetName = workbook.SheetNames[0];
  if (!sheetName) {
    return {
      rows: [],
      totalRows: 0,
      rowsWithMissingFields: 0,
      missingColumns: Object.values(COLUMN_HEADERS),
      warnings: ['الملف لا يحتوي على أي ورقة عمل (sheet).'],
      fileName,
    };
  }

  const sheet = workbook.Sheets[sheetName];
  const rawRows: any[][] = XLSX.utils.sheet_to_json(sheet, {
    header: 1,
    defval: '',
    blankrows: false,
    raw: true,
  });

  if (rawRows.length === 0) {
    return {
      rows: [],
      totalRows: 0,
      rowsWithMissingFields: 0,
      missingColumns: Object.values(COLUMN_HEADERS),
      warnings: ['الملف فارغ.'],
      fileName,
    };
  }

  const headerRow = rawRows[0];
  const colIndex: Partial<Record<FieldKey, number>> = {};
  for (const [key, header] of Object.entries(COLUMN_HEADERS) as [FieldKey, string][]) {
    const idx = headerRow.findIndex((cell) => matchHeader(cell, header));
    if (idx >= 0) colIndex[key] = idx;
  }

  const missingColumns: string[] = [];
  for (const [key, header] of Object.entries(COLUMN_HEADERS) as [FieldKey, string][]) {
    if (colIndex[key] === undefined) missingColumns.push(header);
  }

  if (missingColumns.length > 0) {
    return {
      rows: [],
      totalRows: 0,
      rowsWithMissingFields: 0,
      missingColumns,
      warnings: [`أعمدة ناقصة في ملف الإكسيل: ${missingColumns.join('، ')}`],
      fileName,
    };
  }

  const parsedRows: DispatchSheetRow[] = [];
  const warnings: string[] = [];

  for (let i = 1; i < rawRows.length; i++) {
    const row = rawRows[i];
    if (!row || row.every((c) => c == null || String(c).trim() === '')) continue;

    const get = (key: FieldKey): string => {
      const idx = colIndex[key]!;
      const raw = row[idx];
      if (key === 'date') return excelDateToDisplay(raw);
      return cellToString(raw);
    };

    const parsed: DispatchSheetRow = {
      rowIndex: i + 1, // 1-based excel row
      rentalType: get('rentalType'),
      carBrand: get('carBrand'),
      carColor: get('carColor'),
      carType: get('carType'),
      plateNumber: get('plateNumber'),
      driverAdvance: get('driverAdvance'),
      driverPhone: get('driverPhone'),
      driverIqama: get('driverIqama'),
      driverNationality: get('driverNationality'),
      driverName: get('driverName'),
      customerName: get('customerName'),
      branch: get('branch'),
      toLocation: get('toLocation'),
      fromLocation: get('fromLocation'),
      date: get('date'),
      dispatchNumber: get('dispatchNumber'),
      missingRequired: [],
    };

    parsed.missingRequired = REQUIRED_FIELDS.filter((f) => !parsed[f] || parsed[f].trim() === '')
      .map((f) => COLUMN_HEADERS[f]);

    parsedRows.push(parsed);
  }

  const rowsWithMissingFields = parsedRows.filter((r) => r.missingRequired.length > 0).length;

  return {
    rows: parsedRows,
    totalRows: parsedRows.length,
    rowsWithMissingFields,
    missingColumns: [],
    warnings,
    fileName,
  };
}
