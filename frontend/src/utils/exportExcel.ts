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
const TITLE_FG = 'FF0F172A';

/**
 * كتلةٌ من الجدول: ترويسةٌ وصفوف. الشيتُ الواحد قد يحمل أكثر من كتلة — ملخّصٌ
 * فوق وتفصيلٌ تحته — فيخرج الملفُّ ورقةً واحدةً تُقرأ من أعلاها إلى أسفلها بدل
 * ورقتين يُنتقل بينهما. (راجع `above` في exportMultiSheet.)
 */
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
  // `rightToLeft`: محتوى الشيتات عربيّ في معظمه، وبدونه يفتح العمود الأوّل على
  // اليسار فتُقرأ الأعمدة معكوسةً عن ترتيبها على الشاشة.
  const ws = wb.addWorksheet(safe, { views: [{ state: 'frozen', ySplit: 1, rightToLeft: true }] });
  // كلُّ الكتل في هذا الشيت، آخرُها الجدولُ الرئيسيّ — هو وحده الذي يُجمَّد
  // ويُفلتَر، لأنّه هو الذي يُتصفَّح.
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

  // عرضُ العمود يُقاس على أطول قيمةٍ فيه لا على ترويسته وحدها: عمودٌ ترويسته
  // «العميل» وقيمُه أسماء شركات كان يخرج بعرض ست خانات فتظهر كلّها مبتورة.
  // ومع تعدُّد الكتل يُؤخذ أوسعُ ما تطلبه أيُّ كتلةٍ في العمود نفسه.
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
    header.height = 26;
    for (let c = 1; c <= count; c++) {
      const cell = header.getCell(c);
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: HEADER_BG } };
      cell.font = { color: { argb: 'FFFFFFFF' }, bold: true, size: 11 };
      cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
      cell.border = { bottom: { style: 'thin', color: { argb: HEADER_BORDER } } };
    }
  };

  let cursor = 0;          // آخرُ صفٍّ كُتب
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
        r.getCell(i + 1).value = (v ?? '') as any;
      });
      r.height = 20;
      // الحواف والتظليل المتناوب: النطاقُ بعدد أعمدة الكتلة كي تبقى الخانات
      // الفارغة محاطةً هي أيضًا (eachCell يتخطّاها).
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
        // كل خانةٍ في المتن موسَّطة أفقيًّا ورأسيًّا. الشيت الذي يخرج بأرقامٍ
        // على اليمين ونصوصٍ على اليسار وتواريخَ في الوسط يبدو مسوَّدةً لا
        // مستندًا يُرسَل — وهذه الشيتات تُرسَل خارج الشركة.
        cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
      }
    }

    if (!isMain) cursor += 1;   // سطرٌ فارغ يفصل الكتلة عمّا بعدها
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
