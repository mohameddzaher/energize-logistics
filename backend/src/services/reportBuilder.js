/**
 * reportBuilder — محرك التقارير: من مستند بلوكات إلى PDF احترافي على ورق الشركة.
 *
 * Every report in the system (vehicle, customer, employee, vendor, driver,
 * department) is described the same way: a list of BLOCKS. This module knows
 * nothing about what it is printing — it only knows how to lay blocks out on the
 * company letterhead, in Arabic RTL, across as many A4 pages as they need.
 *
 * Why server-side: the same rule as the بوليصة. A report generated in the
 * browser and one generated on a phone would drift apart; generating both here
 * means the file a customer receives is byte-identical whoever asked for it.
 *
 * Why real PDF text (page.pdf) instead of rasterising each page: the output is
 * searchable, selectable, copy-pasteable and ~10× smaller. Chromium repeats
 * `position: fixed` elements on every printed page, which is what puts the
 * letterhead behind page 7 as well as page 1.
 */
const fs = require('fs');
const path = require('path');

// The real, vector A4 letterhead — the same file the بوليصة is printed on, so a
// report and a waybill come off the printer looking like the same company.
const LETTERHEAD_PDF = path.join(__dirname, '..', 'assets', 'waybill', 'letterhead.pdf');

let letterheadBytes = null;
const getLetterheadPdf = () => (letterheadBytes ||= fs.readFileSync(LETTERHEAD_PDF));

// A4 in PostScript points, which is what pdf-lib measures in.
const A4_PT = { w: 595.276, h: 841.89 };

// One shared headless browser for the whole process (same instance the waybill
// generator uses — launching per request is what makes puppeteer feel heavy).
let browserPromise = null;
async function getBrowser() {
  const puppeteer = require('puppeteer');
  if (!browserPromise) {
    browserPromise = puppeteer.launch({
      headless: 'new',
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--font-render-hinting=none'],
    }).catch((e) => { browserPromise = null; throw e; });
  }
  return browserPromise;
}

/**
 * Page geometry, measured off `assets/reports/letterhead.png` — its printed
 * header ends at 30.7mm and its printed footer starts at 268.2mm. Declared ONCE
 * because three separate places consume it (the @page rule, the fixed
 * letterhead's negative offsets, and page.pdf's margin option) and a mismatch
 * between any two of them prints text on top of the artwork.
 */
const MARGIN = { top: '40mm', bottom: '44mm', side: '14mm' };

/**
 * Where the page-number strip sits, measured from the top of the bottom margin
 * band. It has to clear the last line of content ABOVE it and the letterhead's
 * printed address block BELOW it (which starts at 268.2mm) — the band runs
 * 253→297mm, so 4mm in puts the strip at ~257mm with 11mm to spare underneath.
 */
const FOOTER_OFFSET = '4mm';

const ORANGE = '#f37121';
const INK = '#0f172a';
const MUTED = '#64748b';
const LINE = '#e2e8f0';

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const val = (v) => (v === null || v === undefined || v === '' ? '—' : String(v));

/**
 * Split a mixed-script line on its separators and isolate each run.
 *
 * A plate ("1081 RXA") or a date range dropped into an Arabic paragraph gets
 * visually reordered by the bidi algorithm — "1081 RXA · 2026-01-01" printed as
 * "RXA · 2026-01-01 1081". Wrapping every run in its own isolate makes each read
 * in its own direction while the separators stay put.
 */
const isolate = (text) => String(text ?? '')
  .split(/(\s+·\s+)/)
  .map((part) => (/^\s+·\s+$/.test(part) ? esc(part) : `<span dir="auto" style="unicode-bidi:isolate">${esc(part)}</span>`))
  .join('');

/**
 * ── The block vocabulary ─────────────────────────────────────────────────────
 *   { kind: 'title',    text, sub }                         العنوان الرئيسي
 *   { kind: 'section',  text }                              ترويسة قسم
 *   { kind: 'kv',       items: [[label, value], …] }         جدول بيانات
 *   { kind: 'stats',    items: [{label, value, accent}] }    بطاقات أرقام
 *   { kind: 'table',    head, rows, align, widths }          جدول
 *   { kind: 'bars',     items: [{label, value, max, text}] } رسم أعمدة أفقي
 *   { kind: 'timeline', label, items: [{title, sub, at}] }   خط زمني
 *   { kind: 'note',     text, tone }                         ملاحظة
 *   { kind: 'signatures', items: [{name, title}] }           خانات التوقيع
 *   { kind: 'callout',  title, lines: [] }                   صندوق مميز
 *   { kind: 'pagebreak' }                                    صفحة جديدة
 *   { kind: 'spacer',   h }
 */
function blockHtml(b, rtl) {
  const startAlign = rtl ? 'right' : 'left';
  switch (b.kind) {
    case 'title':
      return `<div class="blk title-blk">
        <div class="doc-title">${esc(b.text)}</div>
        ${b.sub ? `<div class="doc-sub" dir="auto">${isolate(b.sub)}</div>` : ''}
        <div class="title-rule"></div>
      </div>`;

    case 'section':
      return `<div class="blk section-head" style="text-align:${startAlign}">${esc(b.text)}</div>`;

    case 'kv':
      if (!b.items?.length) return '';
      return `<table class="blk kv">${b.items.map(([k, v], i) => `
        <tr class="${i % 2 ? 'alt' : ''}">
          <td class="k" style="text-align:${startAlign}">${esc(k)}</td>
          <td class="v" style="text-align:${startAlign}">${esc(val(v))}</td>
        </tr>`).join('')}</table>`;

    case 'stats':
      if (!b.items?.length) return '';
      return `<div class="blk stats">${b.items.map((s) => `
        <div class="stat">
          <div class="stat-l">${esc(s.label)}</div>
          <div class="stat-v" style="color:${s.accent ? ORANGE : INK}">${esc(val(s.value))}</div>
          ${s.sub ? `<div class="stat-s">${esc(s.sub)}</div>` : ''}
        </div>`).join('')}</div>`;

    case 'table': {
      if (!b.rows?.length) return b.emptyText ? blockHtml({ kind: 'note', text: b.emptyText }, rtl) : '';
      const al = (i) => (b.align?.[i] === 'end' ? (rtl ? 'left' : 'right') : b.align?.[i] === 'center' ? 'center' : startAlign);
      const cols = b.widths ? `<colgroup>${b.widths.map((w) => `<col style="width:${w}">`).join('')}</colgroup>` : '';
      return `<table class="blk data">${cols}
        <thead><tr>${b.head.map((h, i) => `<th style="text-align:${al(i)}">${esc(h)}</th>`).join('')}</tr></thead>
        <tbody>${b.rows.map((r, ri) => `<tr class="${ri % 2 ? 'alt' : ''}">${r.map((c, i) => {
          const cell = (c && typeof c === 'object') ? c : { t: c };
          const style = `text-align:${al(i)};${cell.color ? `color:${cell.color};font-weight:600` : ''}`;
          return `<td style="${style}">${esc(val(cell.t))}</td>`;
        }).join('')}</tr>`).join('')}</tbody>
      </table>`;
    }

    case 'bars': {
      if (!b.items?.length) return '';
      const max = Math.max(1, ...b.items.map((i) => Number(i.max ?? i.value) || 0));
      return `<div class="blk bars">${b.items.map((i) => {
        const pct = Math.max(1, Math.min(100, ((Number(i.value) || 0) / max) * 100));
        return `<div class="bar-row">
          <div class="bar-l">${esc(i.label)}</div>
          <div class="bar-track"><div class="bar-fill" style="width:${pct}%;background:${i.color || ORANGE}"></div></div>
          <div class="bar-v">${esc(i.text ?? i.value)}</div>
        </div>`;
      }).join('')}</div>`;
    }

    case 'timeline':
      if (!b.items?.length) return '';
      // The caption travels WITH the rows (it is inside the same break-avoid
      // block), so a timeline pushed to the next page never arrives as a column
      // of bare dates with nothing saying what they are a history of.
      return `<div class="blk timeline">
        ${b.label ? `<div class="tl-cap" style="text-align:${startAlign}">${esc(b.label)}</div>` : ''}
        ${b.items.map((i) => `
        <div class="tl-row">
          <div class="tl-dot" style="background:${i.color || ORANGE}"></div>
          <div class="tl-body">
            <div class="tl-t">${esc(i.title)}</div>
            ${i.sub ? `<div class="tl-s">${esc(i.sub)}</div>` : ''}
          </div>
          <div class="tl-at">${esc(i.at || '')}</div>
        </div>`).join('')}</div>`;

    case 'note': {
      const tones = { info: '#f1f5f9', warn: '#fef3c7', danger: '#fee2e2', ok: '#dcfce7' };
      const inks = { info: MUTED, warn: '#92400e', danger: '#991b1b', ok: '#166534' };
      const tone = b.tone || 'info';
      return `<div class="blk note" style="background:${tones[tone]};color:${inks[tone]};text-align:${startAlign}">${esc(b.text)}</div>`;
    }

    case 'signatures': {
      if (!b.items?.length) return '';
      // A محضر اجتماع is signed. Printing it without somewhere to sign makes it
      // a printout rather than a record.
      return `<div class="blk sigs">${b.items.map((i) => `
        <div class="sig">
          <div class="sig-line"></div>
          <div class="sig-name">${esc(i.name || '')}</div>
          <div class="sig-title">${esc(i.title || '')}</div>
        </div>`).join('')}</div>`;
    }

    case 'callout': {
      if (!b.lines?.length && !b.title) return '';
      return `<div class="blk callout">
        ${b.title ? `<div class="callout-t">${esc(b.title)}</div>` : ''}
        ${(b.lines || []).map((l) => `<div class="callout-l"><span>${esc(l[0])}</span><b>${esc(val(l[1]))}</b></div>`).join('')}
      </div>`;
    }

    case 'pagebreak':
      return '<div class="pagebreak"></div>';

    case 'spacer':
      return `<div style="height:${b.h ?? 10}px"></div>`;

    default:
      return '';
  }
}

/**
 * The page frame. Margins clear the letterhead's printed logo (top) and its
 * orange footer rules + address (bottom) — measured against payroll.png itself,
 * the same numbers the browser-side generator used.
 */
function documentHtml({ blocks, rtl, title, footerNote }) {
  const dir = rtl ? 'rtl' : 'ltr';
  return `<!DOCTYPE html>
<html lang="${rtl ? 'ar' : 'en'}" dir="${dir}">
<head>
<meta charset="UTF-8" />
<title>${esc(title || '')}</title>
<link href="https://fonts.googleapis.com/css2?family=Tajawal:wght@400;500;700;800&display=swap" rel="stylesheet" />
<style>
  /* Measured off letterhead.png: its printed header ends at 30.7mm and its
     printed footer starts at 268.2mm. Content lives strictly between, and the
     page-number strip sits in the 257–268mm gap ABOVE the printed footer. */
  @page { size: A4; margin: ${MARGIN.top} ${MARGIN.side} ${MARGIN.bottom}; }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  html, body {
    font-family: 'Tajawal', 'Noto Sans Arabic', 'Segoe UI', Tahoma, Arial, sans-serif;
    direction: ${dir}; color: ${INK}; -webkit-font-smoothing: antialiased;
  }
  /* No letterhead here on purpose — see stampLetterhead(). Chromium lays a
     position:fixed element out against the page CONTENT box in paged media, so
     a full-bleed background can't be expressed reliably from CSS; the artwork is
     composited underneath afterwards instead, where the geometry is exact. */
  .blk { break-inside: avoid; }
  .pagebreak { break-after: page; }

  .title-blk { text-align: center; margin-bottom: 16px; }
  .doc-title { font-size: 22px; font-weight: 800; color: ${INK}; line-height: 1.3; }
  .doc-sub { font-size: 12.5px; font-weight: 700; color: ${ORANGE}; margin-top: 4px; }
  .title-rule { width: 90px; height: 3px; background: ${ORANGE}; margin: 9px auto 0; border-radius: 2px; }

  .section-head {
    margin: 15px 0 8px; padding: 7px 11px; background: ${INK}; color: #fff;
    border-radius: 6px; font-size: 13px; font-weight: 800;
    /* A section title must never be the last thing on a page with its content
       overleaf — an orphan header reads like a section with nothing in it. */
    break-after: avoid; page-break-after: avoid;
  }
  .doc-title, .title-blk { break-after: avoid; page-break-after: avoid; }

  table.kv { width: 100%; border-collapse: collapse; font-size: 11.5px; margin-bottom: 7px; }
  table.kv td { padding: 6px 10px; border: 1px solid ${LINE}; }
  table.kv tr.alt { background: #f8fafc; }
  table.kv td.k { font-weight: 700; color: #374151; width: 34%; }
  table.kv td.v { color: ${INK}; }

  .stats { display: flex; gap: 7px; margin-bottom: 9px; flex-wrap: wrap; }
  .stat { flex: 1 1 0; min-width: 84px; border: 1px solid ${LINE}; border-radius: 8px; padding: 8px 6px; background: #f8fafc; text-align: center; }
  .stat-l { font-size: 9.5px; color: ${MUTED}; line-height: 1.35; }
  .stat-v { font-size: 15px; font-weight: 800; margin-top: 3px; }
  .stat-s { font-size: 9px; color: ${MUTED}; margin-top: 2px; }

  table.data { width: 100%; border-collapse: collapse; font-size: 10.5px; margin-bottom: 8px; }
  table.data th { padding: 6px 7px; background: ${INK}; color: #cbd5e1; font-weight: 700; border: 1px solid ${INK}; }
  table.data td { padding: 5px 7px; border: 1px solid ${LINE}; color: ${INK}; }
  table.data tr.alt { background: #f8fafc; }
  /* A long table SHOULD break across pages — but it must carry its header over. */
  table.data { break-inside: auto; }
  table.data thead { display: table-header-group; }
  table.data tr { break-inside: avoid; }

  .bars { margin-bottom: 8px; }
  .bar-row { display: flex; align-items: center; gap: 8px; margin-bottom: 5px; font-size: 10.5px; }
  .bar-l { width: 30%; color: #374151; font-weight: 600; }
  .bar-track { flex: 1; height: 8px; background: #eef2f7; border-radius: 4px; overflow: hidden; }
  .bar-fill { height: 100%; border-radius: 4px; }
  .bar-v { width: 74px; text-align: ${rtl ? 'left' : 'right'}; font-weight: 800; color: ${INK}; }

  .timeline { margin-bottom: 8px; }
  .tl-cap { font-size: 10.5px; font-weight: 800; color: ${MUTED}; padding: 2px 0 4px; }
  .tl-row { display: flex; align-items: flex-start; gap: 8px; padding: 5px 0; border-bottom: 1px dashed ${LINE}; font-size: 10.5px; }
  .tl-dot { width: 8px; height: 8px; border-radius: 50%; margin-top: 4px; flex-shrink: 0; }
  .tl-body { flex: 1; }
  .tl-t { font-weight: 700; color: ${INK}; }
  .tl-s { color: ${MUTED}; margin-top: 1px; }
  .tl-at { color: ${MUTED}; white-space: nowrap; }

  .note { font-size: 10.5px; padding: 7px 10px; border-radius: 6px; margin-bottom: 7px; line-height: 1.5; }

  .sigs { display: flex; gap: 26px; margin-top: 26px; padding-top: 6px; }
  .sig { flex: 1; text-align: center; }
  .sig-line { border-top: 1px solid #94a3b8; margin-bottom: 5px; height: 34px; }
  .sig-name { font-size: 11px; font-weight: 800; color: ${INK}; }
  .sig-title { font-size: 9.5px; color: ${MUTED}; margin-top: 1px; }

  .callout { border: 1px solid ${ORANGE}55; background: #fff7f0; border-radius: 8px; padding: 9px 12px; margin-bottom: 9px; }
  .callout-t { font-size: 11.5px; font-weight: 800; color: ${ORANGE}; margin-bottom: 5px; }
  .callout-l { display: flex; justify-content: space-between; gap: 12px; font-size: 10.5px; padding: 2px 0; }
  .callout-l span { color: ${MUTED}; }
  .callout-l b { color: ${INK}; }
</style>
</head>
<body>
${blocks.map((b) => blockHtml(b, rtl)).join('\n')}
</body>
</html>`;
}

/**
 * Composite Chromium's text-only pages onto the company letterhead.
 *
 * Doing this in pdf-lib rather than in CSS is what makes the geometry exact: the
 * artwork is drawn at 0,0 across the full 210×297mm sheet and the text page is
 * laid over it at 1:1, so nothing depends on how Chromium chooses to resolve a
 * fixed element inside a paged, margined layout — which is what put the printed
 * logo on top of the first paragraph.
 *
 * `drawPage` embeds both as form XObjects, so the text stays real text
 * (searchable, selectable, copyable) and the letterhead stays vector — the file
 * is smaller than the rasterised version, not larger.
 */
async function stampLetterhead(contentPdf) {
  const { PDFDocument } = require('pdf-lib');
  const out = await PDFDocument.create();
  const [letterhead] = await out.embedPdf(getLetterheadPdf(), [0]);
  const content = await PDFDocument.load(contentPdf);
  const pages = await out.embedPages(content.getPages());
  for (const p of pages) {
    const page = out.addPage([A4_PT.w, A4_PT.h]);
    page.drawPage(letterhead, { x: 0, y: 0, width: A4_PT.w, height: A4_PT.h });
    page.drawPage(p, { x: 0, y: 0, width: A4_PT.w, height: A4_PT.h });
  }
  return Buffer.from(await out.save());
}

/**
 * Render a report document to a PDF Buffer.
 *
 * @param {object} doc { title, subtitle, blocks, lang, footerNote }
 */
async function renderReportPdf(doc) {
  const rtl = doc.lang !== 'en';
  const blocks = [
    { kind: 'title', text: doc.title, sub: doc.subtitle },
    ...(doc.blocks || []),
  ];
  const html = documentHtml({ blocks, rtl, title: doc.title, footerNote: doc.footerNote });

  const browser = await getBrowser();
  const page = await browser.newPage();
  try {
    // The webfont comes from a CDN. Waiting for network-idle would let a blocked
    // or slow CDN stall a report indefinitely, so the font wait is BOUNDED: four
    // seconds, then print with whatever is loaded. A report in a fallback font
    // is a far better outcome than a request that never returns.
    await page.setContent(html, { waitUntil: 'domcontentloaded', timeout: 20000 });
    await Promise.race([
      page.evaluateHandle('document.fonts.ready').catch(() => {}),
      new Promise((r) => setTimeout(r, 4000)),
    ]);
    const foot = esc(doc.footerNote || '');
    const content = Buffer.from(await page.pdf({
      format: 'A4',
      printBackground: true,
      displayHeaderFooter: true,
      headerTemplate: '<span></span>',
      // Sits inside the bottom margin, above the letterhead's printed footer.
      // Chromium hands the footer the WHOLE bottom margin band (257–297mm) and
      // bottom-aligns nothing for us, so the strip is pinned to the TOP of that
      // band — otherwise it prints straight on top of the letterhead's own
      // address block.
      footerTemplate: `<div style="width:100%;height:${MARGIN.bottom};font-family:Tajawal,Arial,sans-serif;font-size:7.5px;
        color:#94a3b8;padding:${FOOTER_OFFSET} 16mm 0;display:flex;align-items:flex-start;justify-content:space-between;
        direction:${rtl ? 'rtl' : 'ltr'}">
        <span>${foot}</span>
        <span>${rtl ? 'صفحة' : 'Page'} <span class="pageNumber"></span> ${rtl ? 'من' : 'of'} <span class="totalPages"></span></span>
      </div>`,
      margin: { top: MARGIN.top, bottom: MARGIN.bottom, left: MARGIN.side, right: MARGIN.side },
      // No page background: the letterhead goes UNDER these pages, and an opaque
      // white page would hide it. Element backgrounds still print.
      omitBackground: true,
    }));
    return stampLetterhead(content);
  } finally {
    await page.close();
  }
}

// ── Small helpers every report source shares ────────────────────────────────
const money = (n) => (Math.round(Number(n) || 0)).toLocaleString('en-US');
const num = (n, d = 0) => {
  const p = 10 ** d;
  return (Math.round((Number(n) || 0) * p) / p).toLocaleString('en-US');
};
const dt = (v) => (v ? new Date(v).toLocaleDateString('en-GB') : '—');
const dtm = (v) => (v ? new Date(v).toLocaleString('en-GB', { dateStyle: 'short', timeStyle: 'short' }) : '—');
const pct = (n) => (n === null || n === undefined ? '—' : `${Math.round(Number(n))}%`);

module.exports = { renderReportPdf, documentHtml, blockHtml, money, num, dt, dtm, pct, esc };
