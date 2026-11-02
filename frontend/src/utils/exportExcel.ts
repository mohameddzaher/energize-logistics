// Type-only import — erased at build time, so exceljs (~1MB) stays OUT of every
// page bundle and loads on demand the moment an export button is clicked.
import type * as ExcelJSNS from 'exceljs';
import { toHijri } from '@/lib/hijri';
type Workbook = ExcelJSNS.Workbook;

const loadExcelJS = async () => (await import('exceljs')).default ?? (await import('exceljs'));

// Every Excel the platform produces goes through here, so the look is decided
// ONCE: a real table — dark navy header with bold white text, thin row borders,
// zebra striping, frozen header row and an autofilter. Same public API as the
// old xlsx-based version, so no call site changes.

type ExportColumn = {
  header: string;
  key: string;
  transform?: (value: any, row: any) => any;
  width?: number;
  /**
   * Cell type in Excel itself, not its look on screen.
   * Dates were written as text ("05/09/2026"), so the file opened with General cells: no chronological sort, no date arithmetic, no pivot tables.
   * A column declaring type: 'date' is written as a real date object with display format dd/mm/yyyy, keeping a number Excel understands.
   */
  type?: 'text' | 'date' | 'number' | 'hijri';
};

// Hijri date: written as text in Umm al-Qura exactly as the screen computes it (lib/hijri), so the file matches the page. Details at type === 'hijri' in the cell writer below.

/**
 * Inserts a Hijri column after every Gregorian column.
 * Required next to every date in an export, automatically. Adding it column by column gets forgotten with the next new column, producing a file with half its dates in Hijri, which is worse than none.
 */
export const withHijri = (columns: ExportColumn[], suffixAr = ' (هجري)'): ExportColumn[] =>
  columns.flatMap((c, i) => {
    if (c.type !== 'date') return [c];
    // No computed Hijri is added where a Hijri exists.
    // Registration and inspection carry a Hijri date written on the paper itself, which the report shows as a column next to the Gregorian. A third computed column would give two Hijri columns that may differ by a day, and the paper is the authority.
    const near = [columns[i - 1], columns[i + 1]].some((n) => n && /هجري|hijri/i.test(n.header));
    if (near) return [c];
    return [c, {
      header: `${c.header}${suffixAr}`,
      key: c.key,
      width: c.width,
      // The value is the same; the calendar changes in display, not in content.
      type: 'hijri' as const,
      transform: (raw: any, row: any) => (c.transform ? c.transform(raw, row) : raw),
    }];
  });

const HEADER_BG = 'FF0F172A';   // slate-900, dark navy.
const HEADER_BORDER = 'FF334155';
const ROW_BORDER = 'FFE2E8F0';
const ZEBRA_BG = 'FFF8FAFC';
const TITLE_FG = 'FF0F172A';

/** A table block: header and rows. One sheet can hold several blocks (summary above, detail below) so the file reads as one sheet top to bottom instead of two sheets. See above in exportMultiSheet. */
export type ExportBlock = { title?: string; rows: Record<string, any>[]; columns: ExportColumn[] };

function addStyledSheet(
  wb: Workbook,
  name: string,
  data: Record<string, any>[],
  columns: ExportColumn[],
  above: ExportBlock[] = [],
  title?: string
) {
  // Excel sheet names: ≤31 chars, no []:*?/\
  const safe = String(name).replace(/[[\]:*?/\\]/g, ' ').slice(0, 31) || 'Sheet';
  // rightToLeft: sheet content is mostly Arabic, and without it the first column opens on the left so columns read reversed from the screen order.
  const ws = wb.addWorksheet(safe, { views: [{ state: 'frozen', ySplit: 1, rightToLeft: true }] });
  // All blocks in this sheet, the last being the main table; only it is frozen and filtered, because it is the one browsed.
  const blocks: ExportBlock[] = [...above, { title, rows: data, columns }];
  const widthOf = (col: ExportColumn, rows: Record<string, any>[]) => {
    if (col.width) return col.width;
    let longest = String(col.header).length;
    for (const row of rows.slice(0, 400)) {
      const raw = col.key.split('.').reduce((obj: any, k) => obj?.[k], row);
      const v = col.transform ? col.transform(raw, row) : raw;
      const n = String(v ?? '').length;
      if (n > longest) longest = n;
    }
    return Math.min(Math.max(longest + 4, 12), 46);
  };

  // Column width is measured on the longest value, not the header alone: a column headed with the customer label holding company names came out six characters wide and truncated.
  // With multiple blocks, the widest need of any block in the same column is used.
  const widest: number[] = [];
  for (const b of blocks) {
    b.columns.forEach((col, i) => {
      const w = widthOf(col, b.rows || []);
      if (!widest[i] || w > widest[i]) widest[i] = w;
    });
  }
  const spanCols = Math.max(1, ...blocks.map((b) => b.columns.length));
  ws.columns = Array.from({ length: spanCols }, (_, i) => ({ width: widest[i] || 14 }));

  const styleHeader = (r: number, count: number) => {
    const header = ws.getRow(r);
    // Twenty-six characters fit one line and clip the second. Width also measures the header, so most fit on a line; whatever needs two lines is not clipped.
    header.height = 32;
    for (let c = 1; c <= count; c++) {
      const cell = header.getCell(c);
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: HEADER_BG } };
      cell.font = { color: { argb: 'FFFFFFFF' }, bold: true, size: 11 };
      cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
      cell.border = { bottom: { style: 'thin', color: { argb: HEADER_BORDER } } };
    }
  };

  let cursor = 0;          // Last row written.
  let mainHeaderRow = 1;
  blocks.forEach((block, bi) => {
    const rows = block.rows || [];
    const cols = block.columns;
    const isMain = bi === blocks.length - 1;

    if (block.title) {
      const titleRow = ws.getRow(++cursor);
      titleRow.getCell(1).value = block.title;
      titleRow.getCell(1).font = { bold: true, size: 12, color: { argb: TITLE_FG } };
      titleRow.getCell(1).alignment = { vertical: 'middle', horizontal: 'center' };
      titleRow.height = 22;
      if (cols.length > 1) ws.mergeCells(cursor, 1, cursor, cols.length);
    }

    const headerRow = ++cursor;
    if (isMain) mainHeaderRow = headerRow;
    const hr = ws.getRow(headerRow);
    cols.forEach((col, i) => { hr.getCell(i + 1).value = col.header; });
    styleHeader(headerRow, cols.length);

    for (const row of rows) {
      const r = ws.getRow(++cursor);
      cols.forEach((col, i) => {
        const raw = col.key.split('.').reduce((obj: any, k) => obj?.[k], row);
        const v = col.transform ? col.transform(raw, row) : (raw ?? '');
        const cell = r.getCell(i + 1);
        // Hijri is written as text, as the screen computes it (Umm al-Qura, lib/hijri).
        // A Gregorian cell with format [$-060401]B2dd/mm/yyyy overflowed the column (#####), used Excel's B2 calendar (not Umm al-Qura) and was dropped by Numbers, Google Sheets and LibreOffice.
        // Sorting stays correct since yyyy-mm-dd sorts alphabetically in time order.
        if (col.type === 'hijri' && v !== '' && v !== null && v !== undefined) {
          const d = v instanceof Date ? v : new Date(v);
          cell.value = (Number.isNaN(d.getTime()) ? String(v) : toHijri(d)) as any;
          return;
        }
        if (col.type === 'date' && v !== '' && v !== null && v !== undefined) {
          // A real date object with a display format, not text that looks like a date.
          const d = v instanceof Date ? v : new Date(v);
          if (!Number.isNaN(d.getTime())) {
            cell.value = d;
            cell.numFmt = 'dd/mm/yyyy';
            return;
          }
        }
        if (col.type === 'number' && v !== '' && v !== null && v !== undefined) {
          const n = typeof v === 'number' ? v : Number(v);
          if (Number.isFinite(n)) { cell.value = n; return; }
        }
        cell.value = (v ?? '') as any;
      });
      r.height = 20;
      // Borders and alternating shading: the range spans the block's column count so empty cells are also bordered (eachCell skips them).
      const zebra = (cursor - headerRow) % 2 === 1;
      for (let c = 1; c <= cols.length; c++) {
        const cell = r.getCell(c);
        if (zebra) cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: ZEBRA_BG } };
        cell.border = {
          top: { style: 'thin', color: { argb: ROW_BORDER } },
          bottom: { style: 'thin', color: { argb: ROW_BORDER } },
          left: { style: 'thin', color: { argb: ROW_BORDER } },
          right: { style: 'thin', color: { argb: ROW_BORDER } },
        };
        // Every body cell is centered horizontally and vertically. A sheet with numbers right, text left and dates centered looks like a draft, and these sheets go outside the company.
        // No wrapping: row height is fixed at twenty, so wrapping folds a name onto two lines and hides the second, which reads as half a name. Width is measured on the longest column value (see widthOf), so space is enough.
        cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: false };
      }
    }

    if (!isMain) cursor += 1;   // Blank row separating the block from the next one.
  });

  ws.views = [{ state: 'frozen', ySplit: mainHeaderRow, rightToLeft: true }];

  if (data.length) {
    ws.autoFilter = { from: { row: mainHeaderRow, column: 1 }, to: { row: mainHeaderRow, column: columns.length } };
  }
  return ws;
}

async function download(wb: Workbook, fileName: string) {
  const buf = await wb.xlsx.writeBuffer();
  const blob = new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${fileName}.xlsx`;
  a.click();
  URL.revokeObjectURL(url);
}

export function exportToExcel(
  data: Record<string, any>[],
  columns: ExportColumn[],
  fileName: string,
  sheetName = 'Sheet1'
) {
  if (!data || data.length === 0) return;
  void (async () => {
    const ExcelJS: any = await loadExcelJS();
    const wb: Workbook = new ExcelJS.Workbook();
    addStyledSheet(wb, sheetName, data, columns);
    await download(wb, fileName);
  })();
}

export function exportMultiSheet(
  sheets: { name: string; data: Record<string, any>[]; columns: ExportColumn[]; above?: ExportBlock[]; title?: string }[],
  fileName: string
) {
  void (async () => {
    const ExcelJS: any = await loadExcelJS();
    const wb: Workbook = new ExcelJS.Workbook();
    for (const sheet of sheets) {
      addStyledSheet(wb, sheet.name, sheet.data || [], sheet.columns, sheet.above || [], sheet.title);
    }
    if (wb.worksheets.length > 0) await download(wb, fileName);
  })();
}

export const fmt = {
  date: (v: any) => (v ? new Date(v).toLocaleDateString('en-GB') : ''),
  datetime: (v: any) => (v ? new Date(v).toLocaleString('en-GB') : ''),
  money: (v: any) => (typeof v === 'number' ? v.toFixed(2) : v ?? ''),
  yesNo: (v: any) => (v ? 'Yes' : 'No'),
  status: (v: any) => (v ? String(v).charAt(0).toUpperCase() + String(v).slice(1) : ''),
};
