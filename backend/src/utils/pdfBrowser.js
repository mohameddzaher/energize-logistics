/**
 * pdfBrowser — المتصفّحُ الخفيُّ الواحدُ الذي تُرسَم به أوراقُ الـPDF كلُّها
 * (التقاريرُ وكشوفُ الحساب في services/reportBuilder، والبوالصُ في
 * utils/waybillPdf)، وخطوطُها المضمَّنة.
 *
 * ── لماذا ملفٌّ مستقلّ ──────────────────────────────────────────────────────
 * كان لكلٍّ من الاثنين متصفّحُه المحفوظُ في وعدٍ لا يُنسى: إن مات Chromium
 * (نفادُ ذاكرةٍ أثناء كشفٍ من مئة وخمسين صفحة، أو انهيارُه) بقي الوعدُ يردّ
 * المتصفّحَ الميّت، فكلُّ طلبٍ بعده يسقط بـ«ConnectionClosedError: Connection
 * closed» حتّى يُعاد تشغيلُ الخادم. هذا هو «زرُّ كشف الحساب بايظ».
 * فصار المتصفّحُ يُفحص قبل كلّ استعمال ويُعاد إطلاقُه إن انقطع، والطلبُ الذي
 * صادف الانقطاعَ يُعاد مرّةً واحدةً على متصفّحٍ جديد.
 */
const fs = require('fs');
const path = require('path');

const LAUNCH_ARGS = ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--font-render-hinting=none'];

let browserPromise = null;

async function launch() {
  const puppeteer = require('puppeteer');
  const browser = await puppeteer.launch({ headless: 'new', args: LAUNCH_ARGS });
  // انقطاعٌ لاحق يمحو المحفوظ، فالطلبُ التالي يطلق متصفّحًا جديدًا.
  browser.on('disconnected', () => {
    if (browserPromise && browserPromise.__browser === browser) browserPromise = null;
  });
  return browser;
}

async function getBrowser() {
  if (browserPromise) {
    const b = await browserPromise.catch(() => null);
    if (b && b.connected !== false && (typeof b.isConnected !== 'function' || b.isConnected())) return b;
    browserPromise = null;
  }
  const p = launch().then((b) => { p.__browser = b; return b; });
  p.catch(() => { if (browserPromise === p) browserPromise = null; });
  browserPromise = p;
  return p;
}

const DEAD = /Connection closed|Target closed|Session closed|Protocol error|browser has disconnected|Navigating frame was detached/i;

/**
 * يفتح صفحةً، ويمرّرها إلى `fn`، ويغلقها. وإن انقطع المتصفّحُ أثناءها أُعيد
 * إطلاقُه وأُعيدت المحاولةُ مرّةً واحدة.
 */
async function withPage(fn) {
  for (let attempt = 0; ; attempt++) {
    let page = null;
    try {
      const browser = await getBrowser();
      page = await browser.newPage();
      return await fn(page);
    } catch (e) {
      if (attempt === 0 && DEAD.test(String(e && e.message))) {
        console.warn('[pdf] browser lost, relaunching:', e.message);
        const b = await (browserPromise || Promise.resolve(null)).catch(() => null);
        browserPromise = null;
        if (b) b.close().catch(() => {});
        continue;
      }
      throw e;
    } finally {
      if (page) page.close().catch(() => {});
    }
  }
}

// ── الخطوطُ في الملفّ لا على الشبكة ─────────────────────────────────────────
// ملفّاتُ WOFF2 عندنا (assets/fonts، من Google Fonts بترخيص OFL) تُقرأ مرّةً
// وتُحقن نصًّا — فلا ينتظر ترسيمٌ خادمًا في الخارج. راجع utils/waybillPdf.
const FONTS_DIR = path.join(__dirname, '..', 'assets', 'fonts');
const FONT_FACES = [
  ['Tajawal', 400, ['tajawal-400-arabic.woff2', 'tajawal-400-latin.woff2']],
  ['Tajawal', 700, ['tajawal-700-arabic.woff2', 'tajawal-700-latin.woff2']],
  ['Tajawal', 800, ['tajawal-800-arabic.woff2', 'tajawal-800-latin.woff2']],
  ['Noto Naskh Arabic', 400, ['noto-naskh-arabic-400-arabic.woff2', 'noto-naskh-arabic-400-latin.woff2']],
  ['Noto Naskh Arabic', 600, ['noto-naskh-arabic-600-arabic.woff2', 'noto-naskh-arabic-600-latin.woff2']],
];

let fontCss = null;
function getFontCss() {
  if (fontCss !== null) return fontCss;
  const out = [];
  for (const [family, weight, files] of FONT_FACES) {
    for (const file of files) {
      try {
        const b64 = fs.readFileSync(path.join(FONTS_DIR, file)).toString('base64');
        out.push(`@font-face{font-family:'${family}';font-style:normal;font-weight:${weight};`
          + `font-display:block;src:url(data:font/woff2;base64,${b64}) format('woff2');}`);
      } catch (e) {
        // ملفُّ خطٍّ مفقود لا يمنع الورقة: تُرسَم بخطّ النظام وتُقرأ.
        console.error('[pdf] font missing:', file);
      }
    }
  }
  fontCss = out.join('\n');
  return fontCss;
}

module.exports = { getBrowser, withPage, getFontCss };
