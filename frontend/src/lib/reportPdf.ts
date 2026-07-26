// Generic professional PDF report engine.
//
// Builds a multi-page A4 report on the company letterhead (payroll.png): content
// is described as BLOCKS, which are measured and flowed into pages (never cutting
// a row in half), each page rasterised with html2canvas (so Arabic shapes and RTL
// lay out correctly) and placed on a pdf-lib A4 page.
//
// Used by the vehicle / driver / destination reports.

// pdf-lib + html2canvas load at click time — static imports put them in the
// page bundle of every screen that can print.


const LETTERHEAD = '/images/payroll.png';
// A4 at 96dpi.
const PAGE_W = 794;
const PAGE_H = 1123;
// Safe area measured against payroll.png itself: the printed logo block ends
// ~125px down, and the printed footer (orange rules + address) starts ~1014px
// down. Content must live strictly between them, and our page-number strip sits
// just ABOVE the printed footer — never on top of it.
const TOP = 150;          // clears the logo
const FOOTER_LINE = 150;  // page-number strip, measured from the bottom (y≈973)
const BOTTOM = 175;       // content stops here (y≈948) — well clear of the footer
const SIDE = 56;
const CONTENT_H = PAGE_H - TOP - BOTTOM;

const ORANGE = '#f37121';
const INK = '#0f172a';
const MUTED = '#64748b';

export type Block =
  | { kind: 'title'; text: string; sub?: string }
  | { kind: 'section'; text: string }
  | { kind: 'kv'; items: [string, string][] }
  | { kind: 'stats'; items: { label: string; value: string; accent?: boolean }[] }
  | { kind: 'table'; head: string[]; rows: (string | { t: string; color?: string })[][]; align?: ('start' | 'end' | 'center')[] }
  | { kind: 'note'; text: string }
  | { kind: 'spacer'; h?: number };

const esc = (s: any) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' } as any)[c]);

// ---- Block → HTML ---------------------------------------------------------
function blockHtml(b: Block, rtl: boolean): string {
  const startAlign = rtl ? 'right' : 'left';
  switch (b.kind) {
    case 'title':
      return `<div style="text-align:center;margin-bottom:14px">
        <div style="font-size:21px;font-weight:800;color:${INK}">${esc(b.text)}</div>
        ${b.sub ? `<div style="font-size:12px;color:${ORANGE};font-weight:700;margin-top:3px">${esc(b.sub)}</div>` : ''}
      </div>`;
    case 'section':
      return `<div style="margin:14px 0 8px;padding:6px 10px;background:${INK};color:#fff;border-radius:6px;
        font-size:13px;font-weight:700;text-align:${startAlign}">${esc(b.text)}</div>`;
    case 'kv':
      return `<table style="width:100%;border-collapse:collapse;font-size:12px;margin-bottom:6px">${b.items.map(([k, v], i) => `
        <tr style="background:${i % 2 ? '#f8fafc' : '#fff'}">
          <td style="padding:6px 10px;font-weight:700;color:#374151;width:36%;border:1px solid #e5e7eb;text-align:${startAlign}">${esc(k)}</td>
          <td style="padding:6px 10px;color:${INK};border:1px solid #e5e7eb;text-align:${startAlign}">${esc(v)}</td>
        </tr>`).join('')}</table>`;
    case 'stats':
      return `<div style="display:flex;gap:8px;margin-bottom:8px">${b.items.map((s) => `
        <div style="flex:1;border:1px solid #e5e7eb;border-radius:8px;padding:8px 10px;background:#f8fafc;text-align:center">
          <div style="font-size:10px;color:${MUTED}">${esc(s.label)}</div>
          <div style="font-size:15px;font-weight:800;color:${s.accent ? ORANGE : INK};margin-top:2px">${esc(s.value)}</div>
        </div>`).join('')}</div>`;
    case 'table': {
      const al = (i: number) => (b.align?.[i] === 'end' ? (rtl ? 'left' : 'right') : b.align?.[i] === 'center' ? 'center' : startAlign);
      return `<table style="width:100%;border-collapse:collapse;font-size:11px;margin-bottom:6px">
        <thead><tr>${b.head.map((h, i) => `<th style="padding:6px 8px;background:${INK};color:#cbd5e1;font-weight:700;text-align:${al(i)};border:1px solid ${INK}">${esc(h)}</th>`).join('')}</tr></thead>
        <tbody>${b.rows.map((r, ri) => `<tr style="background:${ri % 2 ? '#f8fafc' : '#fff'}">${r.map((c, i) => {
          const cell = typeof c === 'object' ? c : { t: c, color: undefined as string | undefined };
          return `<td style="padding:5px 8px;border:1px solid #e5e7eb;text-align:${al(i)};color:${cell.color || INK}">${esc(cell.t)}</td>`;
        }).join('')}</tr>`).join('')}</tbody>
      </table>`;
    }
    case 'note':
      return `<div style="font-size:11px;color:${MUTED};margin-bottom:6px;text-align:${startAlign}">${esc(b.text)}</div>`;
    case 'spacer':
      return `<div style="height:${b.h ?? 10}px"></div>`;
  }
}

// A table that doesn't fit on one page is split into chunks that do.
function splitTable(b: Extract<Block, { kind: 'table' }>, rowsPerChunk: number): Block[] {
  if (b.rows.length <= rowsPerChunk) return [b];
  const out: Block[] = [];
  for (let i = 0; i < b.rows.length; i += rowsPerChunk) {
    out.push({ ...b, rows: b.rows.slice(i, i + rowsPerChunk) });
  }
  return out;
}

// ---- Public API -----------------------------------------------------------
export interface ReportOptions {
  fileName: string;
  lang: 'ar' | 'en';
  blocks: Block[];
  footerNote?: string;
}

export async function downloadReport({ fileName, lang, blocks, footerNote }: ReportOptions) {
  const rtl = lang === 'ar';
  const dir = rtl ? 'rtl' : 'ltr';

  // Pre-split oversized tables so no single block can exceed a page.
  const flat: Block[] = [];
  for (const b of blocks) {
    if (b.kind === 'table') flat.push(...splitTable(b, 26));
    else flat.push(b);
  }

  // 1) Measure every block off-screen at the real content width.
  const measure = document.createElement('div');
  measure.setAttribute('dir', dir);
  measure.style.cssText = `position:fixed;left:-99999px;top:0;width:${PAGE_W - SIDE * 2}px;font-family:'Segoe UI',Tahoma,Arial,sans-serif;`;
  document.body.appendChild(measure);
  const heights: number[] = [];
  for (const b of flat) {
    const el = document.createElement('div');
    el.innerHTML = blockHtml(b, rtl);
    measure.appendChild(el);
    heights.push(el.offsetHeight);
  }
  document.body.removeChild(measure);

  // 2) Flow blocks into pages.
  const pages: Block[][] = [];
  let cur: Block[] = [];
  let used = 0;
  flat.forEach((b, i) => {
    const h = heights[i];
    if (used + h > CONTENT_H && cur.length) { pages.push(cur); cur = []; used = 0; }
    cur.push(b);
    used += h;
  });
  if (cur.length) pages.push(cur);
  if (!pages.length) pages.push([]);

  // 3) Render each page and add it to the PDF.
  const { PDFDocument } = await import('pdf-lib');
  const pdf = await PDFDocument.create();
  for (let p = 0; p < pages.length; p++) {
    const pageEl = document.createElement('div');
    pageEl.setAttribute('dir', dir);
    pageEl.style.cssText = `position:fixed;left:-99999px;top:0;width:${PAGE_W}px;height:${PAGE_H}px;background:#fff;font-family:'Segoe UI',Tahoma,Arial,sans-serif;`;
    pageEl.innerHTML = `
      <img src="${LETTERHEAD}" style="position:absolute;inset:0;width:100%;height:100%;object-fit:fill" crossorigin="anonymous" />
      <div style="position:absolute;left:${SIDE}px;right:${SIDE}px;top:${TOP}px;height:${CONTENT_H}px;overflow:hidden">
        ${pages[p].map((b) => blockHtml(b, rtl)).join('')}
      </div>
      <div style="position:absolute;left:${SIDE}px;right:${SIDE}px;bottom:${FOOTER_LINE}px;display:flex;justify-content:space-between;
        font-size:10px;color:${MUTED};border-top:1px solid #e5e7eb;padding-top:5px">
        <span>${esc(footerNote || '')}</span>
        <span>${rtl ? `صفحة ${p + 1} من ${pages.length}` : `Page ${p + 1} of ${pages.length}`}</span>
      </div>`;
    document.body.appendChild(pageEl);
    try {
      await Promise.all(Array.from(pageEl.querySelectorAll('img')).map((img) =>
        img.complete && img.naturalWidth ? Promise.resolve() : new Promise<void>((r) => { img.onload = () => r(); img.onerror = () => r(); })
      ));
      const html2canvas = (await import('html2canvas')).default;
      const canvas = await html2canvas(pageEl, { scale: 2, useCORS: true, backgroundColor: '#ffffff' });
      const png = await pdf.embedPng(canvas.toDataURL('image/png'));
      const page = pdf.addPage([595.28, 841.89]); // A4 points
      page.drawImage(png, { x: 0, y: 0, width: 595.28, height: 841.89 });
    } finally {
      document.body.removeChild(pageEl);
    }
  }

  const bytes = await pdf.save();
  const blob = new Blob([bytes as BlobPart], { type: 'application/pdf' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName.endsWith('.pdf') ? fileName : `${fileName}.pdf`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}
