/**
 * Server-side بوليصة (waybill) generator — produces the EXACT sheet the web
 * download makes, so web and mobile print the identical file.
 *
 * Pipeline mirrors frontend/src/lib/dispatchSheetGenerator.ts:
 *   1. build the transparent HTML overlay (ported verbatim from
 *      dispatchSheetTemplate.ts),
 *   2. render it to a transparent PNG with headless Chromium (replaces the
 *      browser-only html2canvas step),
 *   3. stitch it onto the vector letterhead PDF with pdf-lib (same code).
 */
const fs = require('fs');
const path = require('path');
const { PDFDocument } = require('pdf-lib');

const ASSETS = path.join(__dirname, '..', 'assets', 'waybill');
const LETTERHEAD = path.join(ASSETS, 'letterhead.pdf');
const STAMP = path.join(ASSETS, 'stamp.png');

let letterheadBytes = null;
const getLetterhead = () => (letterheadBytes ||= fs.readFileSync(LETTERHEAD));
let stampDataUri = null;
const getStampDataUri = () => (stampDataUri ||= `data:image/png;base64,${fs.readFileSync(STAMP).toString('base64')}`);

const esc = (s) => String(s ?? '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&#039;');
const valOrBlank = (v) => {
  const t = (v ?? '').toString().trim();
  return t ? esc(t) : '<span class="blank"></span>';
};

// Ported verbatim from dispatchSheetTemplate.ts — with the Tajawal <link> added
// to the head (the web loaded it into the parent document separately).
function buildDispatchSheetHTML(row) {
  const stampSrc = getStampDataUri();
  return `
<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head>
<meta charset="UTF-8" />
<link href="https://fonts.googleapis.com/css2?family=Tajawal:wght@400;500;700;800&display=swap" rel="stylesheet" />
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  html, body { font-family: 'Tajawal', 'Noto Sans Arabic', system-ui, sans-serif; direction: rtl; color: #1a1a1a; background: transparent; -webkit-font-smoothing: antialiased; text-rendering: optimizeLegibility; }
  .sheet { width: 210mm; height: 297mm; position: relative; background: transparent; overflow: hidden; }
  .content { position: absolute; top: 40mm; bottom: 60mm; left: 16mm; right: 16mm; display: flex; flex-direction: column; }
  .title-block, .meta-row, .section, .stamp-wrap { flex-shrink: 0; }
  .title-block { text-align: center; margin-bottom: 12px; }
  .doc-title { font-size: 40px; font-weight: 800; color: #1a1a1a; line-height: 1.1; margin-bottom: 10px; }
  .doc-subtitle { font-size: 17px; font-weight: 700; color: #333; line-height: 1.25; }
  .doc-subtitle .en { color: #555; font-weight: 700; margin-right: 6px; }
  .title-accent { width: 90px; height: 3px; background: #F58220; margin: 10px auto 0; border-radius: 2px; }
  .meta-row { display: flex; gap: 4px; margin-bottom: 10px; background: rgba(253, 240, 224, 0.97); border: 1.5px solid #e8b585; border-radius: 6px; }
  .meta-box { flex: 1; padding: 10px 12px 12px; text-align: center; border-left: 1px solid #d9b388; line-height: 1.4; }
  .meta-box:last-child { border-left: none; }
  .meta-box .lbl-ar { display: block; font-size: 13px; font-weight: 700; color: #6e4f2e; line-height: 1.5; }
  .meta-box .lbl-en { display: block; font-size: 11px; font-weight: 700; color: #6e4f2e; direction: ltr; letter-spacing: 0.3px; line-height: 1.5; margin-bottom: 5px; }
  .meta-box .val { display: block; font-size: 16px; font-weight: 800; color: #1a1a1a; line-height: 1.5; padding-bottom: 2px; }
  .section { margin-bottom: 7px; padding: 5px 10px 6px; border-right: 3px solid #F58220; background: rgba(255, 255, 255, 0.86); border-radius: 0 4px 4px 0; }
  .section-head { display: flex; justify-content: space-between; align-items: baseline; border-bottom: 1px dashed #f0d8c0; padding-bottom: 3px; margin-bottom: 4px; }
  .section-head .ar { font-size: 14px; font-weight: 800; color: #F58220; }
  .section-head .en { font-size: 12px; font-weight: 800; color: #F58220; direction: ltr; letter-spacing: 0.4px; }
  .row { display: grid; grid-template-columns: 115px 1fr 125px; align-items: baseline; gap: 10px; padding: 5px 2px; border-bottom: 1px dashed #ececec; line-height: 1.45; }
  .row:last-child { border-bottom: none; }
  .row .ar-label { font-size: 13.5px; font-weight: 700; color: #2a2a2a; text-align: right; }
  .row .value { font-size: 14.5px; font-weight: 700; color: #1a1a1a; text-align: center; min-height: 20px; }
  .row .en-label { font-size: 12px; font-weight: 700; color: #2a2a2a; text-align: left; direction: ltr; letter-spacing: 0.3px; }
  .row .blank { display: inline-block; width: 60%; border-bottom: 1px dotted #bbb; height: 0.7em; vertical-align: middle; }
  .fare-section .fare-row { display: grid; grid-template-columns: 115px 1fr 125px; align-items: baseline; gap: 10px; padding: 5px 2px 2px; }
  .fare-section .fare-row .ar-label { font-size: 13.5px; font-weight: 700; color: #2a2a2a; text-align: right; }
  .fare-section .fare-row .value { font-size: 17px; font-weight: 800; color: #1a1a1a; text-align: center; }
  .fare-section .fare-row .en-label { font-size: 12px; font-weight: 700; color: #2a2a2a; text-align: left; direction: ltr; letter-spacing: 0.3px; }
  .stamp-wrap { margin-top: auto; padding-top: 10px; text-align: center; }
  .stamp-wrap img { width: 120px; height: auto; display: inline-block; }
</style>
</head>
<body>
<div class="sheet">
  <div class="content">
    <div class="title-block">
      <div class="doc-title">بوليصة شحن</div>
      <div class="doc-subtitle">نقل بري<span class="en">· Land Transport Waybill</span></div>
      <div class="title-accent"></div>
    </div>
    <div class="meta-row">
      <div class="meta-box"><span class="lbl-ar">الفرع</span><span class="lbl-en">Branch</span><span class="val">${valOrBlank(row.branch)}</span></div>
      <div class="meta-box"><span class="lbl-ar">التاريخ</span><span class="lbl-en">Date</span><span class="val">${valOrBlank(row.date)}</span></div>
      <div class="meta-box"><span class="lbl-ar">رقم البوليصة</span><span class="lbl-en">Bill No.</span><span class="val">${valOrBlank(row.dispatchNumber)}</span></div>
    </div>
    <div class="section">
      <div class="section-head"><span class="ar">بيانات الرحلة</span><span class="en">Trip Details</span></div>
      <div class="row"><span class="ar-label">العنوان من</span><span class="value">${valOrBlank(row.fromLocation)}</span><span class="en-label">From</span></div>
      <div class="row"><span class="ar-label">إلى</span><span class="value">${valOrBlank(row.toLocation)}</span><span class="en-label">To</span></div>
      <div class="row"><span class="ar-label">نوع السيارة</span><span class="value">${valOrBlank(row.carType)}</span><span class="en-label">Vehicle Type</span></div>
    </div>
    <div class="section">
      <div class="section-head"><span class="ar">بيانات السائق</span><span class="en">Driver Details</span></div>
      <div class="row"><span class="ar-label">اسم السائق</span><span class="value">${valOrBlank(row.driverName)}</span><span class="en-label">Driver Name</span></div>
      <div class="row"><span class="ar-label">الجنسية</span><span class="value">${valOrBlank(row.driverNationality)}</span><span class="en-label">Nationality</span></div>
      <div class="row"><span class="ar-label">رقم الإقامة</span><span class="value">${valOrBlank(row.driverIqama)}</span><span class="en-label">Iqama No.</span></div>
      <div class="row"><span class="ar-label">جوال السائق</span><span class="value">${valOrBlank(row.driverPhone)}</span><span class="en-label">Driver Phone</span></div>
      <div class="row"><span class="ar-label">مصروف السائق</span><span class="value">${valOrBlank(row.driverAdvance)}</span><span class="en-label">Driver Expense</span></div>
    </div>
    <div class="section">
      <div class="section-head"><span class="ar">بيانات السيارة</span><span class="en">Vehicle Details</span></div>
      <div class="row"><span class="ar-label">رقم السيارة</span><span class="value">${valOrBlank(row.plateNumber)}</span><span class="en-label">Plate No.</span></div>
      <div class="row"><span class="ar-label">الماركة</span><span class="value">${valOrBlank(row.carBrand)}</span><span class="en-label">Brand</span></div>
      <div class="row"><span class="ar-label">اللون</span><span class="value">${valOrBlank(row.carColor)}</span><span class="en-label">Color</span></div>
    </div>
    <div class="section fare-section">
      <div class="section-head"><span class="ar">الأجرة</span><span class="en">Fare</span></div>
      <div class="fare-row"><span class="ar-label">إيجار</span><span class="value">${valOrBlank(row.rentalType)}</span><span class="en-label">Rental</span></div>
    </div>
    <div class="stamp-wrap"><img src="${esc(stampSrc)}" alt="" /></div>
  </div>
</div>
</body>
</html>`;
}

// One shared headless browser for the whole process — launching per request is
// what makes puppeteer feel heavy.
let browserPromise = null;
async function getBrowser() {
  const puppeteer = require('puppeteer');
  if (!browserPromise) {
    browserPromise = puppeteer.launch({
      headless: 'new',
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--font-render-hinting=none'],
    }).catch((e) => { browserPromise = null; throw e; });
  }
  return browserPromise;
}

// Map a FleetShipment doc → the DispatchSheetRow the template expects (same
// mapping as the web's toSheetRow).
function rowFromShipment(s) {
  const d = s.loadDate || s.createdAt || new Date();
  const dt = new Date(d);
  const date = `${dt.getDate()}/${dt.getMonth() + 1}/${dt.getFullYear()}`;
  const driverName = [s.driverName, s.secondDriverName].filter(Boolean).join(' + ');
  return {
    rentalType: s.rentType || '', carBrand: s.vehicleBrand || '', carColor: s.vehicleColor || '',
    carType: s.trailerType || '', plateNumber: s.vehiclePlate || '',
    // مصروف السائق: الحقل الجديد driverExpense وإلا القديم driverAdvance للبوليصات السابقة.
    driverAdvance: (s.driverExpense != null && s.driverExpense !== 0) ? String(s.driverExpense) : (s.driverAdvance || ''),
    driverPhone: s.driverPhone || '', driverIqama: s.driverIqama || '', driverNationality: s.driverNationality || '',
    driverName, customerName: s.customerName || '', branch: s.branch || '',
    toLocation: s.toCity || '', fromLocation: s.fromCity || '', date, dispatchNumber: String(s.waybillNumber || ''),
  };
}

async function renderWaybillPdf(row) {
  const browser = await getBrowser();
  const page = await browser.newPage();
  try {
    // 210mm × 297mm at 96dpi = 794 × 1123, ×1.5 device scale — matches the web's html2canvas scale.
    await page.setViewport({ width: 794, height: 1123, deviceScaleFactor: 1.5 });
    await page.setContent(buildDispatchSheetHTML(row), { waitUntil: 'networkidle0', timeout: 20000 });
    try { await page.evaluateHandle('document.fonts.ready'); } catch (e) { /* fallback font */ }
    const el = await page.$('.sheet');
    const overlayPng = await el.screenshot({ omitBackground: true, type: 'png' });

    const pdfDoc = await PDFDocument.load(getLetterhead());
    const p0 = pdfDoc.getPages()[0];
    const { width, height } = p0.getSize();
    const png = await pdfDoc.embedPng(overlayPng);
    p0.drawImage(png, { x: 0, y: 0, width, height });
    while (pdfDoc.getPageCount() > 1) pdfDoc.removePage(pdfDoc.getPageCount() - 1);
    return Buffer.from(await pdfDoc.save());
  } finally {
    await page.close();
  }
}

/**
 * بوليصاتٌ كثيرةٌ في ملفٍّ واحد.
 *
 * ── ولماذا في الخادم لا في المتصفّح ───────────────────────────────────────
 * كان التحميلُ الجماعيُّ يرسم كلَّ بوليصةٍ في المتصفّح بـ`html2canvas`: يُركَّب
 * الجدولُ في الصفحة، ويُرسَّم بمقياس ١٫٥ (نحو ١٦٠٠×٢٢٤٤)، ثمّ يُنزَع — مرّةً
 * لكلّ كشف. والترسيمُ يجري على الخيط الرئيسيّ، فالشاشةُ تتجمّد. ثلاثون كشفًا
 * تعني ثلاثين تجمّدًا متتاليةً تبدو كإعادة تحميلٍ متكرّرة.
 *
 * والخادمُ يرسمها أصلًا للبوليصة الواحدة (نفسُ الملفّ حرفًا بحرف — راجع
 * `renderWaybillPdf`). فالجماعيُّ نداءٌ واحدٌ يردّ ملفًّا واحدًا: لا تجمّدَ،
 * ولا ثلاثون تنزيلًا، وملفٌّ واحدٌ يُطبَع دفعةً واحدة.
 *
 * وصفحةُ المتصفّح تُفتَح مرّةً لكلّ الصفوف لا مرّةً لكلّ صفّ — وهو الفارقُ
 * الأكبرُ في الزمن.
 */
async function renderWaybillsPdf(rows) {
  const merged = await PDFDocument.create();
  // ── وكلُّ بوليصةٍ تُرسَم كما تُرسَم وحدَها ────────────────────────────────
  // صفحةٌ جديدةٌ لكلّ صفٍّ لا صفحةٌ واحدةٌ يُعاد ملؤها: `networkidle0` على
  // صفحةٍ مستعمَلةٍ قد لا يُطلَق ثانيةً — والشبكةُ ساكنةٌ أصلًا — فينتظر حتى
  // تنقضي المهلة. وهذا هو المسارُ نفسُه المجرَّبُ للبوليصة الواحدة، لا مسارٌ
  // ثانٍ يُخالفه في شيء.
  // ── وتُرسَم بالتوازي بقدرٍ محدود ──────────────────────────────────────
  // الواحدةُ نحوَ أربع ثوانٍ (صفحةٌ تُفتَح وخطٌّ يُحمَّل وترسيمٌ)، فثلاثون
  // واحدةً تباعًا دقيقتان — وnginx يقطع الطلبَ قبلها. وأربعُ صفحاتٍ معًا في
  // متصفّحٍ واحدٍ تختصر الزمنَ إلى الرُّبع دون أن تُثقل الخادم.
  //
  // والترتيبُ محفوظٌ رغم التوازي: النتائجُ تُوضَع في مواضعها بالفهرس ثمّ تُدمَج
  // بالترتيب — الملفُّ يُقرأ بالترتيب الذي عُلّم به.
  const CONCURRENCY = 4;
  const out = new Array(rows.length);
  let next = 0;
  const worker = async () => {
    for (;;) {
      const i = next; next += 1;
      if (i >= rows.length) return;
      // eslint-disable-next-line no-await-in-loop
      out[i] = await renderWaybillPdf(rows[i]);
    }
  };
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, rows.length) }, worker));

  for (const one of out) {
    if (!one) continue;
    // eslint-disable-next-line no-await-in-loop
    const doc = await PDFDocument.load(one);
    // eslint-disable-next-line no-await-in-loop
    const [copied] = await merged.copyPages(doc, [0]);
    merged.addPage(copied);
  }
  return Buffer.from(await merged.save());
}

/** صفُّ بوليصةٍ من طلب شحنة — نفسُ شكل `rowFromShipment`. */
function rowFromOrder(o) {
  const d = o.pickupTime || o.startTime || o.createdAt || new Date();
  const dt = new Date(d);
  return {
    rentalType: o.driverRentType || '', carBrand: '', carColor: '',
    carType: o.truckType || '', plateNumber: o.vehiclePlate || o.vehicleName || '',
    driverAdvance: o.driverRentPrice != null ? String(o.driverRentPrice) : '',
    driverPhone: o.driverPhone || '', driverIqama: '', driverNationality: '',
    driverName: o.driverName || '', customerName: o.customerName || '', branch: o.branch || '',
    toLocation: o.toCity || '', fromLocation: o.fromCity || '',
    date: `${dt.getDate()}/${dt.getMonth() + 1}/${dt.getFullYear()}`,
    dispatchNumber: String(o.reference || o.waybillNumber || ''),
  };
}

module.exports = { renderWaybillPdf, renderWaybillsPdf, rowFromShipment, rowFromOrder, buildDispatchSheetHTML };
