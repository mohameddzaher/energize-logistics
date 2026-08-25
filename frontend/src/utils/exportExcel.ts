// Type-only import — erased at build time, so exceljs (~1MB) stays OUT of every
// page bundle and loads on demand the moment an export button is clicked.
import type * as ExcelJSNS from 'exceljs';
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
};

const HEADER_BG = 'FF0F172A';   // slate-900 — كحلي غامق
const HEADER_BORDER = 'FF334155';
const ROW_BORDER = 'FFE2E8F0';
const ZEBRA_BG = 'FFF8FAFC';

function addStyledSheet(
  wb: Workbook,
  name: string,
  data: Record<string, any>[],
  columns: ExportColumn[]
) {
  // Excel sheet names: ≤31 chars, no []:*?/\
  const safe = String(name).replace(/[[\]:*?/\\]/g, ' ').slice(0, 31) || 'Sheet';
  // `rightToLeft`: محتوى الشيتات عربيّ في معظمه، وبدونه يفتح العمود الأوّل على
  // اليسار فتُقرأ الأعمدة معكوسةً عن ترتيبها على الشاشة.
  const ws = wb.addWorksheet(safe, {
    views: [{ state: 'frozen', ySplit: 1, rightToLeft: true }],
  });

  // عرض العمود يُقاس على أطول قيمة فيه لا على ترويسته وحدها: عمودٌ ترويسته
  // «العميل» وقيمُه أسماء شركات كان يخرج بعرض ست خانات فتظهر كلّها مبتورة.
  const widthOf = (col: ExportColumn) => {
    if (col.width) return col.width;
    let longest = String(col.header).length;
    for (const row of data.slice(0, 400)) {
      const raw = col.key.split('.').reduce((obj: any, k) => obj?.[k], row);
      const v = col.transform ? col.transform(raw, row) : raw;
      const n = String(v ?? '').length;
      if (n > longest) longest = n;
    }
    return Math.min(Math.max(longest + 4, 12), 46);
  };
  ws.columns = columns.map((col) => ({ header: col.header, key: col.key, width: widthOf(col) }));

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
    row.height = 20;
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
      // كل خانةٍ في المتن موسَّطة أفقيًّا ورأسيًّا. الشيت الذي يخرج بأرقامٍ على
      // اليمين ونصوصٍ على اليسار وتواريخَ في الوسط يبدو مسوَّدةً لا مستندًا
      // يُرسَل — وهذه الشيتات تُرسَل خارج الشركة.
      cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
    }
  }

  if (data.length) {
    ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: columns.length } };
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
  sheets: { name: string; data: Record<string, any>[]; columns: ExportColumn[] }[],
  fileName: string
) {
  void (async () => {
    const ExcelJS: any = await loadExcelJS();
    const wb: Workbook = new ExcelJS.Workbook();
    for (const sheet of sheets) {
      addStyledSheet(wb, sheet.name, sheet.data || [], sheet.columns);
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
