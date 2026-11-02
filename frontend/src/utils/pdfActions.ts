/**
 * Opens a server PDF or prints it directly without the browser blocking it.
 * window.open after an await is blocked, since the browser no longer sees it as a response to a click, so the window is opened empty at click time and the file is written into it on arrival. If blocked anyway, the file downloads.
 * Printing skips the middle step: a print button loads the same file in a hidden frame and opens the print dialog on it. Phones cannot print a frame holding a PDF, so there the file opens in a tab and prints from its share button.
 */

const isMobile = () =>
  typeof navigator !== 'undefined' && /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent || '');

function download(url: string, fileName: string) {
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
}

/** An empty window opened now, before any waiting, so the browser does not block it. */
function preopen(ar: boolean): Window | null {
  const w = window.open('', '_blank');
  if (w) {
    try {
      w.document.write(`<p style="font-family:Tahoma,sans-serif;padding:24px;color:#475569">${ar ? 'جارٍ إعداد الملف…' : 'Preparing the file…'}</p>`);
    } catch { /* A window that rejects writes; harmless. */ }
  }
  return w;
}

/**
 * Opens the file in a new tab (or downloads it if the tab was blocked).
 * Called directly from the click with the promise itself, not after awaiting it.
 */
export async function openPdf(load: Promise<Blob>, fileName: string, ar: boolean) {
  const w = preopen(ar);
  try {
    const blob = await load;
    const url = URL.createObjectURL(blob);
    if (w && !w.closed) w.location.href = url;
    else download(url, fileName);
    setTimeout(() => URL.revokeObjectURL(url), 5 * 60 * 1000);
  } catch (e) {
    if (w && !w.closed) w.close();
    throw e;
  }
}

let frame: HTMLIFrameElement | null = null;

/** Opens the print dialog on the file directly; on a phone opens the file to print from there. */
export async function printPdf(load: Promise<Blob>, fileName: string, ar: boolean) {
  if (isMobile()) return openPdf(load, fileName, ar);

  const blob = await load;
  const url = URL.createObjectURL(blob);
  if (frame) { frame.remove(); frame = null; }
  const f = document.createElement('iframe');
  // Rendered, not hidden: Chrome's PDF viewer does not load in a display:none frame, so nothing would print. A zero-size frame in the corner is used.
  f.setAttribute('aria-hidden', 'true');
  f.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;opacity:0;pointer-events:none';
  f.src = url;
  frame = f;
  let done = false;
  const go = () => {
    if (done) return;
    done = true;
    try {
      f.contentWindow?.focus();
      f.contentWindow?.print();
    } catch {
      // A browser that refuses to print the frame: the file itself opens and prints from its viewer.
      window.open(url, '_blank') || download(url, fileName);
    }
  };
  // The PDF viewer keeps painting shortly after load; printing earlier yields a blank page.
  f.onload = () => setTimeout(go, 300);
  document.body.appendChild(f);
  setTimeout(() => { URL.revokeObjectURL(url); if (frame === f) { f.remove(); frame = null; } }, 10 * 60 * 1000);
}
