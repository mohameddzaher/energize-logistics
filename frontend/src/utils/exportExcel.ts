import ExcelJS from 'exceljs';

// Every Excel the platform produces goes through here, so the look is decided
// ONCE: a real table — dark navy header with bold white text, thin row borders,
// zebra striping, frozen header row and an autofilter. Same public API as the
// old xlsx-based version, so no call site changes.

type ExportColumn = {
  header: string;
  key: string;
  transform?: (value: any, row: any) => any;
  width?: number;
};

const HEADER_BG = 'FF0F172A';   // slate-900 — كحلي غامق
const HEADER_BORDER = 'FF334155';
const ROW_BORDER = 'FFE2E8F0';
const ZEBRA_BG = 'FFF8FAFC';

function addStyledSheet(
  wb: ExcelJS.Workbook,
  name: string,
  data: Record<string, any>[],
  columns: ExportColumn[]
) {
  // Excel sheet names: ≤31 chars, no []:*?/\
  const safe = String(name).replace(/[[\]:*?/\\]/g, ' ').slice(0, 31) || 'Sheet';
  const ws = wb.addWorksheet(safe, { views: [{ state: 'frozen', ySplit: 1 }] });

  ws.columns = columns.map((col) => ({
    header: col.header,
    key: col.key,
    width: col.width || Math.max(col.header.length + 4, 15),
  }));

  for (const row of data) {
    ws.addRow(columns.map((col) => {
      const raw = col.key.split('.').reduce((obj: any, k) => obj?.[k], row);
      const v = col.transform ? col.transform(raw, row) : (raw ?? '');
      return v ?? '';
    }));
  }

  // Header: dark navy, bold white, centered.
  const header = ws.getRow(1);
  header.height = 26;
  for (let c = 1; c <= columns.length; c++) {
    const cell = header.getCell(c);
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: HEADER_BG } };
    cell.font = { color: { argb: 'FFFFFFFF' }, bold: true, size: 11 };
    cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
    cell.border = { bottom: { style: 'thin', color: { argb: HEADER_BORDER } } };
  }

  // Body: thin borders + zebra, iterating by column count so empty cells keep
  // their borders too (eachCell skips them).
  for (let r = 2; r <= data.length + 1; r++) {
    const row = ws.getRow(r);
    const zebra = r % 2 === 0;
    for (let c = 1; c <= columns.length; c++) {
      const cell = row.getCell(c);
      if (zebra) cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: ZEBRA_BG } };
      cell.border = {
        top: { style: 'thin', color: { argb: ROW_BORDER } },
        bottom: { style: 'thin', color: { argb: ROW_BORDER } },
        left: { style: 'thin', color: { argb: ROW_BORDER } },
        right: { style: 'thin', color: { argb: ROW_BORDER } },
      };
      cell.alignment = { vertical: 'middle' };
    }
  }

  if (data.length) {
    ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: columns.length } };
  }
  return ws;
}

async function download(wb: ExcelJS.Workbook, fileName: string) {
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
  const wb = new ExcelJS.Workbook();
  addStyledSheet(wb, sheetName, data, columns);
  void download(wb, fileName);
}

export function exportMultiSheet(
  sheets: { name: string; data: Record<string, any>[]; columns: ExportColumn[] }[],
  fileName: string
) {
  const wb = new ExcelJS.Workbook();
  for (const sheet of sheets) {
    addStyledSheet(wb, sheet.name, sheet.data || [], sheet.columns);
  }
  if (wb.worksheets.length > 0) void download(wb, fileName);
}

export const fmt = {
  date: (v: any) => (v ? new Date(v).toLocaleDateString('en-GB') : ''),
  datetime: (v: any) => (v ? new Date(v).toLocaleString('en-GB') : ''),
  money: (v: any) => (typeof v === 'number' ? v.toFixed(2) : v ?? ''),
  yesNo: (v: any) => (v ? 'Yes' : 'No'),
  status: (v: any) => (v ? String(v).charAt(0).toUpperCase() + String(v).slice(1) : ''),
};
