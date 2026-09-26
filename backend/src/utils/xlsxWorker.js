/**
 * الخيطُ العامل: يبني المصنَّفَ ويعيد بايتاته. لا قاعدةَ بياناتٍ هنا ولا شبكة —
 * حسابٌ خالصٌ بعيدًا عن الخيط الذي يخدم الطلبات. راجع utils/xlsxBuilder.
 */
const { parentPort, workerData } = require('worker_threads');

try {
  const XLSX = require('xlsx');
  const { aoa, sheetName, cols } = workerData;
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  if (cols) ws['!cols'] = cols;
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, sheetName);
  const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx', compression: true });
  // تُنقَل الذاكرةُ نقلًا لا نسخًا — عشرون ميجابايت لا تُستنسخ.
  parentPort.postMessage({ ok: true, buf: buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) },
    [buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength)]);
} catch (e) {
  parentPort.postMessage({ ok: false, error: e.message });
}
