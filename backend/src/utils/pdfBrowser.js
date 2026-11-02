/**
 * pdfBrowser: the single headless browser that renders every PDF (reports, account statements, waybills) and its embedded fonts.
 * The browser is health-checked before each use and relaunched if it dropped; a request that hit a disconnect is retried once on a fresh browser. A cached dead browser would otherwise fail every request with ConnectionClosedError until restart.
 */
const fs = require('fs');
const path = require('path');

const LAUNCH_ARGS = ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--font-render-hinting=none'];

let browserPromise = null;

async function launch() {
  const puppeteer = require('puppeteer');
  const browser = await puppeteer.launch({ headless: 'new', args: LAUNCH_ARGS });
  // A later disconnect clears the cached browser, so the next request launches a new one.
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

/** Opens a page, passes it to `fn`, and closes it. If the browser disconnects meanwhile, it is relaunched and the attempt retried once. */
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

// Fonts come from local files, not the network. The WOFF2 files in assets/fonts (Google Fonts, OFL) are read once and injected as text so rendering never waits on an external server. See utils/waybillPdf.
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
        // A missing font file does not block the sheet; it renders with the system font.
        console.error('[pdf] font missing:', file);
      }
    }
  }
  fontCss = out.join('\n');
  return fontCss;
}

module.exports = { getBrowser, withPage, getFontCss };
