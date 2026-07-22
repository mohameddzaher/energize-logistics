import JSZip from 'jszip';
import { PDFDocument } from 'pdf-lib';
import type { DispatchSheetRow } from './dispatchSheetExcelParser';
import { buildDispatchSheetHTML } from './dispatchSheetTemplate';

export interface GenerateProgress {
  current: number;
  total: number;
  currentFileName: string;
}

export interface GenerateOptions {
  rows: DispatchSheetRow[];
  onProgress?: (progress: GenerateProgress) => void;
  signal?: AbortSignal;
  // Per-row file naming. The bulk-download flows name each بوليصة with the
  // waybill number + customer + date; the dispatch page keeps the default.
  fileNameOf?: (row: DispatchSheetRow) => string;
}

const LETTERHEAD_URL = '/images/energize%20LH.pdf';

const pdfFileName = (row: DispatchSheetRow): string => {
  const num = (row.dispatchNumber || `row-${row.rowIndex}`).replace(/[\/\\?%*:|"<>]/g, '-');
  return `كشف-تخريج-${num}.pdf`;
};

const todayStamp = (): string => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

// html2canvas is bundled by html2pdf.js; we import it directly so we can
// render to a canvas (pdf-lib will then embed that canvas as an image on
// top of the vector letterhead).
const loadHtml2Canvas = async (): Promise<any> => {
  const mod = await import('html2canvas');
  return (mod as any).default || mod;
};

// Tajawal must be present in document.fonts BEFORE html2canvas captures, or
// the snapshot falls back to a font without Arabic shaping (broken letters).
let fontsReadyPromise: Promise<void> | null = null;
async function ensureFontsLoaded(): Promise<void> {
  if (fontsReadyPromise) return fontsReadyPromise;
  fontsReadyPromise = (async () => {
    if (!document.querySelector('link[data-dispatch-sheet-fonts]')) {
      const link = document.createElement('link');
      link.rel = 'stylesheet';
      link.href = 'https://fonts.googleapis.com/css2?family=Tajawal:wght@400;500;700;800&display=swap';
      link.setAttribute('data-dispatch-sheet-fonts', '1');
      document.head.appendChild(link);
    }
    if (document.fonts) {
      try {
        await Promise.all([
          document.fonts.load('400 14px "Tajawal"'),
          document.fonts.load('500 14px "Tajawal"'),
          document.fonts.load('700 16px "Tajawal"'),
          document.fonts.load('800 22px "Tajawal"'),
        ]);
        await document.fonts.ready;
      } catch {
        // fall through — better to render with fallback than to crash.
      }
    }
  })();
  return fontsReadyPromise;
}

const waitForImages = (root: HTMLElement): Promise<void> => {
  const imgs = Array.from(root.querySelectorAll('img'));
  return Promise.all(
    imgs.map(
      (img) =>
        new Promise<void>((resolve) => {
          if (img.complete && img.naturalWidth > 0) return resolve();
          img.addEventListener('load', () => resolve(), { once: true });
          img.addEventListener('error', () => resolve(), { once: true });
          setTimeout(() => resolve(), 5000);
        })
    )
  ).then(() => undefined);
};

// Letterhead PDF is shared across all rows — fetch once and reuse the bytes.
let letterheadCache: ArrayBuffer | null = null;
async function getLetterheadBytes(): Promise<ArrayBuffer> {
  if (letterheadCache) return letterheadCache;
  const res = await fetch(LETTERHEAD_URL);
  if (!res.ok) throw new Error(`تعذّر تحميل قالب الـ PDF: ${res.status}`);
  letterheadCache = await res.arrayBuffer();
  return letterheadCache;
}

// Render the overlay HTML to a transparent canvas at high DPI. The canvas is
// later embedded as a PNG on top of the vector letterhead, so the letterhead
// keeps its print quality; only the data layer is rasterized.
async function renderHTMLToCanvas(html: string, html2canvas: any): Promise<HTMLCanvasElement> {
  const container = document.createElement('div');
  container.style.position = 'fixed';
  container.style.top = '-10000px';
  container.style.left = '-10000px';
  container.style.width = '210mm';
  container.style.background = 'transparent';
  container.innerHTML = html;
  document.body.appendChild(container);

  const sheetEl = container.querySelector('.sheet') as HTMLElement | null;
  const target = sheetEl || container;

  try {
    await ensureFontsLoaded();
    await waitForImages(target);

    // scale=2 produces a ~1600×2244 canvas per sheet — gorgeous, but heavy
    // enough that the main thread freezes while it rasterizes. 1.5 is the
    // sweet spot: still crisp on print, much lighter on the UI.
    const canvas: HTMLCanvasElement = await html2canvas(target, {
      scale: 1.5,
      useCORS: true,
      allowTaint: true,
      backgroundColor: null, // transparent so letterhead shows through
      logging: false,
      windowWidth: target.offsetWidth,
      windowHeight: target.offsetHeight,
    });
    return canvas;
  } finally {
    document.body.removeChild(container);
  }
}

const canvasToPngBytes = (canvas: HTMLCanvasElement): Promise<Uint8Array> =>
  new Promise((resolve, reject) => {
    canvas.toBlob(async (blob) => {
      if (!blob) return reject(new Error('toBlob failed'));
      const buf = await blob.arrayBuffer();
      resolve(new Uint8Array(buf));
    }, 'image/png');
  });

/**
 * Render one row by stitching the html2canvas overlay on top of the vector
 * letterhead PDF. Result is a single-page PDF that preserves the letterhead's
 * print quality.
 */
async function renderRowToPdfBytes(row: DispatchSheetRow, html2canvas: any, letterheadBytes: ArrayBuffer): Promise<Uint8Array> {
  const html = buildDispatchSheetHTML(row);
  const canvas = await renderHTMLToCanvas(html, html2canvas);
  const overlayPng = await canvasToPngBytes(canvas);

  // pdf-lib mutates the PDFDocument it loads; pass a copy of the bytes each
  // time so we don't accumulate overlays across rows.
  const pdfDoc = await PDFDocument.load(letterheadBytes.slice(0));
  const page = pdfDoc.getPages()[0];
  if (!page) throw new Error('قالب الـ PDF لا يحتوي على صفحات.');
  const { width, height } = page.getSize();

  const png = await pdfDoc.embedPng(overlayPng);
  page.drawImage(png, { x: 0, y: 0, width, height });

  // Drop any extra pages just in case the source has more than one page.
  while (pdfDoc.getPageCount() > 1) {
    pdfDoc.removePage(pdfDoc.getPageCount() - 1);
  }

  return pdfDoc.save();
}

export async function generateDispatchSheetsZip(opts: GenerateOptions): Promise<{ blob: Blob; fileName: string }> {
  const { rows, onProgress, signal, fileNameOf } = opts;
  const html2canvas = await loadHtml2Canvas();
  const letterheadBytes = await getLetterheadBytes();
  const zip = new JSZip();

  // Disambiguate duplicate dispatch numbers so a sheet doesn't get silently
  // overwritten in the ZIP.
  const usedNames = new Map<string, number>();

  for (let i = 0; i < rows.length; i++) {
    if (signal?.aborted) throw new Error('Aborted');

    const row = rows[i];
    let name = (fileNameOf ? fileNameOf(row) : pdfFileName(row)).replace(/[\/\\?%*:|"<>]/g, '-');
    if (!name.endsWith('.pdf')) name += '.pdf';
    if (usedNames.has(name)) {
      const count = (usedNames.get(name) || 1) + 1;
      usedNames.set(name, count);
      name = name.replace(/\.pdf$/, `-(${count}).pdf`);
    } else {
      usedNames.set(name, 1);
    }

    onProgress?.({ current: i + 1, total: rows.length, currentFileName: name });

    const pdfBytes = await renderRowToPdfBytes(row, html2canvas, letterheadBytes);
    zip.file(name, pdfBytes);

    // Yield to the browser between rows. Without this the main thread stays
    // pegged across iterations and the progress bar appears frozen / the
    // page judders. setTimeout(0) is enough — it just lets one paint frame
    // through before we hit html2canvas again.
    await new Promise((resolve) => setTimeout(resolve, 0));
  }

  const blob = await zip.generateAsync({ type: 'blob', compression: 'DEFLATE' });
  return { blob, fileName: `كشوف-التخريج-${todayStamp()}.zip` };
}

// One shipment → one PDF, for the shipment-orders section where every order
// carries its own بوليصة and is downloaded alone — no ZIP ceremony for one file.
export async function generateSingleDispatchPdf(row: DispatchSheetRow): Promise<{ blob: Blob; fileName: string }> {
  const html2canvas = await loadHtml2Canvas();
  const letterheadBytes = await getLetterheadBytes();
  const pdfBytes = await renderRowToPdfBytes(row, html2canvas, letterheadBytes);
  return {
    blob: new Blob([pdfBytes as unknown as BlobPart], { type: 'application/pdf' }),
    fileName: pdfFileName(row).replace('كشف-تخريج-', 'بوليصة-'),
  };
}

export function triggerDownload(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
