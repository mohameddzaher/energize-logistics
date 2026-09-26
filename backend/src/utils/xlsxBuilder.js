/**
 * بناءُ ملفّ الإكسل خارجَ الخيط الرئيسيّ.
 *
 * ── العلّة ──────────────────────────────────────────────────────────────────
 * تصديرُ «كلّ الكشوف» ستّةٌ وثلاثون ألفَ صفٍّ في ثلاثةٍ وأربعين عمودًا، وكتابةُ
 * المصنَّف عملٌ حسابيٌّ خالص: يشغل الخيطَ الواحد ثلاثين ثانيةً لا يخدم فيها
 * ذلك العاملُ أحدًا. قيس على البرودكشن أثناء تصديرةٍ واحدة: طلبُ `/api/health`
 * — وهو لا يمسّ القاعدة — أخذ **أربعَ عشرةَ ثانية**. أي أنّ ضغطةَ «تصدير» من
 * موظّفٍ واحدٍ تُوقف الشاشاتِ عند البقيّة، فيُقال «النظامُ علّق» ولا عطلَ فيه.
 *
 * فالكتابةُ تُنقَل إلى خيطٍ عامل (worker thread): يبني المصنَّفَ ويعيد بايتاته،
 * والخيطُ الرئيسيُّ يظلّ يردّ على الجميع. ويبقى في الرئيسيّ بناءُ المصفوفة
 * وحدَه (ثانيتان ونصف لستّةٍ وثلاثين ألفًا) ونسخُها إلى العامل.
 *
 * وإن تعذّر إنشاءُ العامل لأيّ سبب، يُبنى في مكانه كما كان — تصديرةٌ بطيئةٌ
 * أهونُ من تصديرةٍ لا تخرج.
 */
const path = require('path');
const { Worker } = require('worker_threads');

const WORKER = path.join(__dirname, 'xlsxWorker.js');

/**
 * @param {Array<Array<any>>} aoa صفوفُ المصنَّف (الأوّلُ رؤوسُ الأعمدة).
 * @param {{ sheetName?: string, cols?: Array<{ wch: number }> }} opts
 * @returns {Promise<Buffer>}
 */
function buildXlsx(aoa, opts = {}) {
  return new Promise((resolve, reject) => {
    let worker;
    try {
      worker = new Worker(WORKER, { workerData: { aoa, sheetName: opts.sheetName || 'Sheet1', cols: opts.cols || null } });
    } catch (e) {
      // لا عاملَ: تُبنى هنا (تُبطئ هذا الطلبَ ولا تُسقطه).
      try { return resolve(buildInline(aoa, opts)); } catch (e2) { return reject(e2); }
    }
    // ── ولا يُترك الوعدُ معلَّقًا ──────────────────────────────────────────
    // العاملُ قد يموت بلا حدث `error` — نفادُ ذاكرةٍ أو إنهاءُ العمليّة عند
    // النشر — فيبقى الطلبُ ينتظر إلى الأبد وتبقى معه وظيفةُ التصدير «جارية»
    // ولا تنتهي. فكلُّ مخرجٍ مُغطًّى: رسالةٌ، أو خطأٌ، أو خروجٌ، أو مهلة.
    let settled = false;
    const finish = (fn, arg) => { if (settled) return; settled = true; clearTimeout(timer); fn(arg); };
    const fallback = (err) => {
      try { finish(resolve, buildInline(aoa, opts)); } catch (_) { finish(reject, err || new Error('xlsx build failed')); }
    };
    const timer = setTimeout(() => {
      try { worker.terminate(); } catch (_) { /* */ }
      fallback(new Error('xlsx worker timed out'));
    }, 10 * 60 * 1000);

    worker.once('message', (msg) => {
      if (msg && msg.ok) finish(resolve, Buffer.from(msg.buf));
      else fallback(new Error((msg && msg.error) || 'xlsx worker failed'));
    });
    worker.once('error', (err) => fallback(err));
    worker.once('exit', (code) => {
      if (!settled) fallback(new Error(`xlsx worker exited (${code})`));
    });
  });
}

function buildInline(aoa, opts = {}) {
  const XLSX = require('xlsx');
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  if (opts.cols) ws['!cols'] = opts.cols;
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, opts.sheetName || 'Sheet1');
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx', compression: true });
}

module.exports = { buildXlsx };
