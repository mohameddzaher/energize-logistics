/**
 * Prints a table to PDF with its chosen columns and selected rows.
 * A print window is used instead of a PDF library: browser PDF libraries break Arabic, splitting letters and flipping line direction when digits mix with text. The browser engine renders Arabic correctly, and Save as PDF in its dialog gives a clean file.
 * Official letterhead reports (customer statement) are built on the server (/api/reports) where letterhead and fonts are set. This is for printing the table as shown on screen, fast and with no server trip.
 */
export type PrintColumn = { header: string; key: string; transform?: (value: any, row: any) => any; align?: 'start' | 'end' | 'center' };

export function printTable({ title, subtitle, columns, rows, ar, meta }: {
  title: string;
  subtitle?: string;
  columns: PrintColumn[];
  rows: Record<string, any>[];
  ar: boolean;
  /** Lines printed under the title: applied filters, date range, row count. */
  meta?: string[];
}) {
  const esc = (v: any) => String(v ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

  const cell = (r: Record<string, any>, c: PrintColumn) => {
    const raw = r[c.key];
    return esc(c.transform ? c.transform(raw, r) : raw ?? '');
  };

  const head = columns.map((c) => `<th style="text-align:${c.align || 'start'}">${esc(c.header)}</th>`).join('');
  const body = rows.map((r) =>
    `<tr>${columns.map((c) => `<td style="text-align:${c.align || 'start'}">${cell(r, c)}</td>`).join('')}</tr>`).join('');

  const printed = new Date().toLocaleString(ar ? 'ar-EG-u-nu-latn' : 'en-GB');
  const html = `<!doctype html><html dir="${ar ? 'rtl' : 'ltr'}" lang="${ar ? 'ar' : 'en'}"><head>
<meta charset="utf-8"><title>${esc(title)}</title>
<style>
  @page { size: A4 landscape; margin: 12mm 10mm; }
  * { box-sizing: border-box; }
  body { font-family: "Segoe UI", Tahoma, "Noto Naskh Arabic", Arial, sans-serif; color: #0f172a; margin: 0; }
  header { border-bottom: 2px solid #f37121; padding-bottom: 8px; margin-bottom: 12px; }
  h1 { font-size: 16pt; margin: 0 0 2px; }
  .sub { font-size: 9pt; color: #475569; }
  .meta { font-size: 8.5pt; color: #64748b; margin-top: 4px; }
  table { width: 100%; border-collapse: collapse; font-size: 8.5pt; }
  thead { display: table-header-group; }            /* تتكرّر الترويسةُ في كلّ صفحة */
  tr { page-break-inside: avoid; }
  th { background: #f1f5f9; border: 1px solid #cbd5e1; padding: 5px 6px; font-weight: 700; }
  td { border: 1px solid #e2e8f0; padding: 4px 6px; }
  tbody tr:nth-child(even) td { background: #f8fafc; }
  footer { margin-top: 10px; font-size: 8pt; color: #94a3b8; display: flex; justify-content: space-between; }
</style></head><body>
<header>
  <h1>${esc(title)}</h1>
  ${subtitle ? `<div class="sub">${esc(subtitle)}</div>` : ''}
  ${meta?.length ? `<div class="meta">${meta.map(esc).join(' &nbsp;·&nbsp; ')}</div>` : ''}
</header>
<table><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>
<footer><span>${esc(ar ? 'إنرجايز للخدمات اللوجستية' : 'Energize Logistics')}</span><span>${esc(printed)}</span></footer>
</body></html>`;

  // Separate window: printing from the page itself carries all its styling and menus.
  const w = window.open('', '_blank', 'width=1100,height=800');
  if (!w) return false;                       // Popup blocker; the user is told.
  w.document.write(html);
  w.document.close();
  // Waits for rendering before opening the print dialog, otherwise a blank page prints. The wait has two paths, onload and a fallback timeout for browsers that do not fire it after document.write, so it is guarded to run once or the dialog would open twice.
  let done = false;
  const go = () => { if (done) return; done = true; try { w.focus(); w.print(); } catch { /* Window was closed. */ } };
  w.onload = go;
  setTimeout(go, 400);
  return true;
}
