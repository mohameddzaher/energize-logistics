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
function runBuild(aoa, opts = {}) {
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

// ── ولا يُبنى مصنَّفان في وقتٍ واحد ──────────────────────────────────────────
// بناءُ المصنَّف حسابٌ خالصٌ يشغل نواةً كاملةً دقيقةً تقريبًا، والخادمُ نواتان.
// والخيطُ العاملُ يحمي الخيطَ الرئيسيَّ من التعطّل — وهو يفعل: قِيس أثناء
// تصديرةٍ واحدةٍ فبقي `/api/auth/me` عند مئةٍ وخمسين جزءًا من الثانية — لكنّه
// لا يحمي النواتين من الامتلاء. ولمّا كُنست نقاطُ القراءة بأربعةِ طلباتٍ
// متوازية صادف أن جرت تصديرتان معًا، فامتلأت النواتان وصار نداءٌ يُنجَز في
// مئتي جزءٍ من الثانية يأخذ **ستَّ عشرةَ ثانيةً ونصفًا**. وليس في النقطتين
// عطبٌ: قيستا وحدَهما فكانتا 266ms و 220ms.
//
// فالبناءُ يُصطَفّ: واحدٌ في كلّ عمليّة. من ضغط «تصدير» ثانيًا ينتظر الأوّل —
// وهو ينتظره اليوم أيضًا، إذ يتسابقان على النواة نفسِها فيبطؤان معًا ويُبطئان
// الناسَ كلَّهم. والاصطفافُ يجعل الانتظارَ انتظارَ صاحبِه وحدَه.
const MAX = Math.max(1, Number(process.env.XLSX_MAX_CONCURRENT || 1));
let active = 0;
const waiting = [];

function buildXlsx(aoa, opts = {}) {
  if (active < MAX) {
    active++;
    return runBuild(aoa, opts).finally(release);
  }
  return new Promise((resolve, reject) => {
    waiting.push(() => { active++; runBuild(aoa, opts).finally(release).then(resolve, reject); });
  });
}

function release() {
  active--;
  const next = waiting.shift();
  if (next) next();
}

/** للفحص: كم يُبنى الآن وكم ينتظر. */
buildXlsx.stats = () => ({ active, waiting: waiting.length, max: MAX });

function buildInline(aoa, opts = {}) {
  const XLSX = require('xlsx');
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  if (opts.cols) ws['!cols'] = opts.cols;
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, opts.sheetName || 'Sheet1');
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx', compression: true });
}

module.exports = { buildXlsx };
