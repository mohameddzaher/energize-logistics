/**
 * Builds the Excel file off the main thread.
 * Exporting all statements (about 36k rows by 43 columns) is pure computation that blocks the single thread for about 30 s, stalling every other request such as the health check. The workbook is built in a worker thread that returns its bytes; only the array building and copy to the worker stay on the main thread.
 * If the worker cannot be created, it is built in place: a slow export beats none.
 */
const path = require('path');
const { Worker } = require('worker_threads');

const WORKER = path.join(__dirname, 'xlsxWorker.js');

/**
 * @param {Array<Array<any>>} aoa workbook rows (the first row is the column headers).
 * @param {{ sheetName?: string, cols?: Array<{ wch: number }> }} opts
 * @returns {Promise<Buffer>}
 */
function runBuild(aoa, opts = {}) {
  return new Promise((resolve, reject) => {
    let worker;
    try {
      worker = new Worker(WORKER, { workerData: { aoa, sheetName: opts.sheetName || 'Sheet1', cols: opts.cols || null } });
    } catch (e) {
      // No worker available: build here (slows this request but does not crash it).
      try { return resolve(buildInline(aoa, opts)); } catch (e2) { return reject(e2); }
    }
    // Never leave the promise hanging.
    // The worker can die without an error event (out of memory, process killed on deploy), which would leave the request and export job pending forever. Every exit path is covered: message, error, exit or timeout.
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

// Only one workbook is built at a time per process.
// Building is pure computation that occupies a full core for about a minute and the server has two cores. The worker keeps the main thread responsive but cannot stop two concurrent exports from saturating both cores, which made a 200 ms call take over 16 s.
// Builds are queued so a second export waits for the first, not everyone else.
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

/** For inspection: how many are building and how many are waiting. */
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
