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
  // ── وتُنقَل الذاكرةُ نقلًا لا نسخًا — حقًّا هذه المرّة ────────────────────
  // كان السطرُ يستدعي `slice` **مرّتين**: واحدةً في الرسالة وأخرى في قائمة
  // النقل. و`slice` تُنشئ مخزنًا جديدًا في كلّ مرّة، فالمنقولُ ليس المُرسَل:
  // يُستنسَخ ما في الرسالة استنساخًا بنيويًّا كاملًا، ويُرمى المنقولُ بلا
  // فائدة. فكانت سبعةَ عشرَ ميجابايت تُخصَّص ثلاثَ مرّات وتُنسَخ مرّةً، على
  // تعليقٍ يقول إنّها لا تُنسَخ. والمخزنُ الآن واحدٌ يُشار إليه في الموضعين.
  const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
  parentPort.postMessage({ ok: true, buf: ab }, [ab]);
} catch (e) {
  parentPort.postMessage({ ok: false, error: e.message });
}
