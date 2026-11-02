/** Worker thread: builds the workbook and returns its bytes. No database or network here, only computation away from the request thread. See utils/xlsxBuilder. */
const { parentPort, workerData } = require('worker_threads');

try {
  const XLSX = require('xlsx');
  const { aoa, sheetName, cols } = workerData;
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  if (cols) ws['!cols'] = cols;
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, sheetName);
  const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx', compression: true });
  // Memory is transferred, not copied.
  // The previous code called `slice` twice, once for the message and once for the transfer list; each creates a new buffer, so the transferred one was not the one sent and the message was structurally cloned. Now one buffer is referenced in both places.
  const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
  parentPort.postMessage({ ok: true, buf: ab }, [ab]);
} catch (e) {
  parentPort.postMessage({ ok: false, error: e.message });
}
