import * as XLSX from 'xlsx';

type ExportColumn = {
  header: string;
  key: string;
  transform?: (value: any, row: any) => any;
  width?: number;
};

/**
 * Build an AOA (array-of-arrays) worksheet from columns + data.
 * The first row contains the column headers, followed by data rows.
 * Column widths are set for readability.
 */
function buildSheet(
  data: Record<string, any>[],
  columns: ExportColumn[]
): XLSX.WorkSheet {
  // Header row
  const headers = columns.map((col) => col.header);

  // Data rows
  const dataRows = data.map((row) =>
    columns.map((col) => {
      const raw = col.key.split('.').reduce((obj: any, k) => obj?.[k], row);
      return col.transform ? col.transform(raw, row) : (raw ?? '');
    })
  );

  const aoa = [headers, ...dataRows];
  const ws = XLSX.utils.aoa_to_sheet(aoa);

  // Set column widths
  ws['!cols'] = columns.map((col) => ({
    wch: col.width || Math.max(col.header.length + 4, 15),
  }));

  // Set header row height for better readability
  ws['!rows'] = [{ hpt: 24 }];

  return ws;
}

export function exportToExcel(
  data: Record<string, any>[],
  columns: ExportColumn[],
  fileName: string,
  sheetName = 'Sheet1'
) {
  if (!data || data.length === 0) return;

  const ws = buildSheet(data, columns);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, sheetName);
  XLSX.writeFile(wb, `${fileName}.xlsx`);
}

export function exportMultiSheet(
  sheets: { name: string; data: Record<string, any>[]; columns: ExportColumn[] }[],
  fileName: string
) {
  const wb = XLSX.utils.book_new();

  for (const sheet of sheets) {
    const ws = buildSheet(sheet.data || [], sheet.columns);
    XLSX.utils.book_append_sheet(wb, ws, sheet.name);
  }

  if (wb.SheetNames.length > 0) {
    XLSX.writeFile(wb, `${fileName}.xlsx`);
  }
}

export const fmt = {
  date: (v: any) => (v ? new Date(v).toLocaleDateString('en-GB') : ''),
  datetime: (v: any) => (v ? new Date(v).toLocaleString('en-GB') : ''),
  money: (v: any) => (typeof v === 'number' ? v.toFixed(2) : v ?? ''),
  yesNo: (v: any) => (v ? 'Yes' : 'No'),
  status: (v: any) => (v ? String(v).charAt(0).toUpperCase() + String(v).slice(1) : ''),
};
