/**
 * Prints a ready PDF on the printer connected to the device, without downloading or opening a file.
 * The waybill is rendered on the server (Puppeteer) and returns as bytes in a Blob. The Blob gets a local blob: URL (same origin as the page, so no origin restriction blocks printing), is loaded in an invisible frame, and print() on its window opens the print dialog on the file alone, not the page.
 * A new window (window.open) was easier but the popup blocker silently blocks it after an await, and every print here follows a server round trip.
 * The frame stays mounted until the print dialog closes: removing it right after the call cancels the print in some browsers because the source disappears under the dialog. It is removed after a generous delay and the URL revoked with it so files do not pile up in memory.
 */
export function printPdfBlob(blob: Blob, { timeoutMs = 120000 }: { timeoutMs?: number } = {}): Promise<boolean> {
  return new Promise((resolve) => {
    let url = '';
    try { url = URL.createObjectURL(blob); } catch { resolve(false); return; }

    const frame = document.createElement('iframe');
    frame.setAttribute('aria-hidden', 'true');
    frame.style.cssText = 'position:fixed;inset-inline-end:0;bottom:0;width:0;height:0;border:0;visibility:hidden';
    let settled = false;
    const cleanup = () => {
      setTimeout(() => {
        try { frame.remove(); } catch { /* Already removed. */ }
        try { URL.revokeObjectURL(url); } catch { /* Already revoked. */ }
      }, timeoutMs);
    };

    frame.onload = () => {
      if (settled) return;
      settled = true;
      try {
        frame.contentWindow?.focus();
        frame.contentWindow?.print();
        cleanup();
        resolve(true);
      } catch {
        // A browser that cannot print from a frame: the file opens in a tab for the user to print.
        cleanup();
        try { window.open(url, '_blank'); resolve(true); } catch { resolve(false); }
      }
    };
    // If onload never fires (disabled PDF viewer), the call does not stay hanging.
    setTimeout(() => {
      if (settled) return;
      settled = true;
      cleanup();
      try { window.open(url, '_blank'); resolve(true); } catch { resolve(false); }
    }, 8000);

    frame.src = url;
    document.body.appendChild(frame);
  });
}
