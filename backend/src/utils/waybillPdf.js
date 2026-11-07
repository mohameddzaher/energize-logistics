/**
 * Server-side waybill generator: produces the exact sheet the web download makes, so web and mobile print the identical file.
 * Mirrors frontend/src/lib/dispatchSheetGenerator.ts: HTML overlay (ported from dispatchSheetTemplate.ts), printed to a transparent vector PDF with headless Chromium, laid over the letterhead PDF with pdf-lib.
 */
const fs = require('fs');
const path = require('path');
const { PDFDocument } = require('pdf-lib');
// The plate format is the same across the whole system; see `utils/plateKey`.
const { formatPlate } = require('./plateKey');

const ASSETS = path.join(__dirname, '..', 'assets', 'waybill');
const LETTERHEAD = path.join(ASSETS, 'letterhead.pdf');
const STAMP = path.join(ASSETS, 'stamp.png');

let letterheadBytes = null;
const getLetterhead = () => (letterheadBytes ||= fs.readFileSync(LETTERHEAD));
let stampDataUri = null;
const getStampDataUri = () => (stampDataUri ||= `data:image/png;base64,${fs.readFileSync(STAMP).toString('base64')}`);

/**
 * Fonts are loaded from local files, not the network.
 * A remote font stylesheet plus waiting for networkidle0 cost nearly all of the render time on every waybill.
 * The WOFF2 files in assets/fonts (OFL licence) are read once on first render and injected as text, so rendering never depends on an external server. Only the Arabic and Latin subsets are loaded.
 */
const { withPage, getFontCss } = require('./pdfBrowser');

/**
 * Contact numbers printed on the waybill.
 * Kept in code, not the database: they are company numbers on hand-delivered paper, rarely change and are reviewed before printing. If they become configurable they belong in `FleetConfig`.
 */
const CONTACT_PHONES = [
  '0544714240',
  '0540665851',
  '0566372891',
];

const esc = (s) => String(s ?? '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&#039;');
const valOrBlank = (v) => {
  const t = (v ?? '').toString().trim();
  return t ? esc(t) : '<span class="blank"></span>';
};

// Ported verbatim from dispatchSheetTemplate.ts — with the Tajawal <link> added
// to the head (the web loaded it into the parent document separately).
/**
 * Driver acknowledgement, in Arabic and Urdu.
 * It sits on the waybill itself so it is tied to a specific load and cannot be lost as a separate sheet.
 * Arabic is the legally binding text; the Urdu translation uses a Naskh font that covers Urdu letters, which Tajawal alone does not (it renders boxes).
 */
function pledgeHTML(row) {
  const line = (v, w) => (v ? `<span class="fill">${esc(v)}</span>` : `<span class="fill" style="padding:0 ${w}px">&nbsp;</span>`);
  const n = line(row.driverName || '', 42);
  const i = line(row.driverIqama || '', 26);
  return `<div class="pledge">
    <div class="head"><span>إقرار السائق</span><span class="ur-t">ڈرائیور کا اقرار نامہ</span></div>
    <div class="cols">
      <p>أقرّ أنا السائق/ ${n} هوية رقم (${i}) بأنني تسلّمت الحمولة الموضّحة بهذه أمر النقل بحالة سليمة، وأتحمّل المسؤولية الكاملة عنها من الاستلام وحتى التسليم. كما تمّ تفويضي من المالك قانونًا بالتوقيع على كافة المستندات التشغيلية، والاتفاق وإتمام التسويات المالية المتعلقة بالحمولة نيابةً عنه. وألتزم بكافة الأنظمة المرورية، وأتحمّل كامل المسؤولية عن أيّ أضرار أو مخالفات تترتّب على تقصيري أو مخالفتي لأنظمة المملكة العربية السعودية.</p>
      <p class="ur">میں ڈرائیور/ ${n} شناختی نمبر (${i}) اقرار کرتا ہوں کہ میں نے اس بلٹی میں درج مال درست حالت میں وصول کیا ہے، اور وصولی سے حوالگی تک اس کی مکمل ذمہ داری قبول کرتا ہوں۔ نیز مجھے مالک کی طرف سے قانونی طور پر اختیار حاصل ہے کہ میں تمام آپریشنل دستاویزات پر دستخط کروں اور مال سے متعلق معاہدہ اور مالی تصفیہ اُس کی جانب سے مکمل کروں۔ میں تمام ٹریفک قوانین کی پابندی کا عہد کرتا ہوں، اور اپنی کوتاہی یا مملکتِ سعودی عرب کے قوانین کی خلاف ورزی سے پیدا ہونے والے کسی بھی نقصان یا جرمانے کی مکمل ذمہ داری قبول کرتا ہوں۔</p>
    </div>
    <div class="sign">
      <div><div class="k">توقيع السائق<span class="ur-k">ڈرائیور کے دستخط</span></div><div class="l"></div></div>
      <div><div class="k">التاريخ<span class="ur-k">تاریخ</span></div><div class="l"></div></div>
    </div>
  </div>`;
}

function buildDispatchSheetHTML(row) {
  const stampSrc = getStampDataUri();
  return `
<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head>
<meta charset="UTF-8" />
<style>
${getFontCss()}
  * { box-sizing: border-box; margin: 0; padding: 0; }
  html, body { font-family: 'Tajawal', 'Noto Sans Arabic', system-ui, sans-serif; direction: rtl; color: #1a1a1a; background: transparent; -webkit-font-smoothing: antialiased; text-rendering: optimizeLegibility; }
  .sheet { width: 210mm; height: 297mm; position: relative; background: transparent; overflow: hidden; }
  /* ── الورقةُ واحدة، فالمقاساتُ محسوبة ────────────────────────────────────
     أمر النقل تُسلَّم بيدٍ وتُطبَع بالمئات، فصفحةٌ ثانيةٌ لها ثمنٌ يوميّ. وقد
     زادها الإقرار، فضُغط المستندُ كلُّه بدل أن يُقسَم: الخطوطُ أصغرُ بقدرٍ
     يبقى مقروءًا، والتذييلُ المطبوعُ في الورق يشغل نحوَ أربعةٍ وعشرين
     مليمترًا لا ستّين — فالصندوقُ يمتدّ إلى ٤٤مم من أسفلَ بأمان.
     وكلُّ تغييرٍ هنا يُعايَن بالعين: «overflow:hidden» يقصّ ما زاد صامتًا. */
  /* ── والمحتوى أُنزل قليلًا والخطُّ كُبّر قليلًا ─────────────────────────────
     كانت تبقى فجوةٌ بيضاء بين الختم وتذييلِ الورق المطبوع، والفراغُ المدفوعُ
     ثمنُه ورقًا أولى به السطورُ نفسُها. فنزل أعلى الصندوق ثلاثةَ مليمترات
     وارتفع أسفلُه ثلاثة، وكُبّرت الخطوطُ بنحو السُّدس — والقصُّ صامت
     («overflow:hidden») فكلُّ تغييرٍ هنا يُعايَن بالعين على صفحةٍ مرسومة. */
  .content { position: absolute; top: 30mm; bottom: 34mm; left: 15mm; right: 15mm; display: flex; flex-direction: column; }
  /* ── أرقامُ التواصل في الجهة المقابلة للّوجو ────────────────────────────────
     اللوجو مطبوعٌ في الورق أعلى اليسار، وتبقى الجهةُ المقابلةُ بياضًا. والسائقُ
     يحمل هذه الورقة وحدَها: فمن أراد أن يسأل عن حمولةٍ وجد الرقمَ في يده بدل
     أن يبحث. وهي خارجَ صندوق المحتوى حتّى لا تزاحم سطورَه. */
  .contacts { position: absolute; top: 14mm; right: 15mm; text-align: right; direction: ltr; }
  .contacts .k { font-size: 9px; font-weight: 800; color: #F58220; letter-spacing: 0.4px; margin-bottom: 1px; direction: rtl; text-align: right; }
  .contacts .n { font-size: 10.6px; font-weight: 700; color: #1a1a1a; line-height: 1.45; }
  .title-block, .meta-row, .section, .stamp-wrap { flex-shrink: 0; }
  .title-block { text-align: center; margin-bottom: 7px; }
  .doc-title { font-size: 30px; font-weight: 800; color: #1a1a1a; line-height: 1.05; margin-bottom: 4px; }
  .doc-subtitle { font-size: 14.3px; font-weight: 700; color: #333; line-height: 1.2; }
  .doc-subtitle .en { color: #555; font-weight: 700; margin-right: 6px; }
  .title-accent { width: 70px; height: 2.5px; background: #F58220; margin: 5px auto 0; border-radius: 2px; }
  .meta-row { display: flex; gap: 4px; margin-bottom: 7px; background: rgba(253, 240, 224, 0.97); border: 1.2px solid #e8b585; border-radius: 5px; }
  .meta-box { flex: 1; padding: 6px 9px 7px; text-align: center; border-left: 1px solid #d9b388; line-height: 1.25; }
  .meta-box:last-child { border-left: none; }
  .meta-box .lbl-ar { display: block; font-size: 11.6px; font-weight: 700; color: #6e4f2e; line-height: 1.3; }
  .meta-box .lbl-en { display: block; font-size: 10px; font-weight: 700; color: #6e4f2e; direction: ltr; letter-spacing: 0.3px; line-height: 1.3; margin-bottom: 2px; }
  .meta-box .val { display: block; font-size: 14.9px; font-weight: 800; color: #1a1a1a; line-height: 1.3; }
  .meta-box.customer .val { font-size: 12.4px; line-height: 1.25; }
  .section { margin-bottom: 4px; padding: 3px 9px 4px; border-right: 2.5px solid #F58220; background: rgba(255, 255, 255, 0.86); border-radius: 0 4px 4px 0; }
  .section-head { display: flex; justify-content: space-between; align-items: baseline; border-bottom: 1px dashed #f0d8c0; padding-bottom: 3px; margin-bottom: 3px; }
  .section-head .ar { font-size: 13.4px; font-weight: 800; color: #F58220; }
  .section-head .en { font-size: 10.6px; font-weight: 800; color: #F58220; direction: ltr; letter-spacing: 0.4px; }
  .row { display: grid; grid-template-columns: 105px 1fr 115px; align-items: baseline; gap: 12px; padding: 2.9px 2px; border-bottom: 1px dashed #ececec; line-height: 1.35; }
  .row:last-child { border-bottom: none; }
  .row .ar-label { font-size: 13px; font-weight: 700; color: #2a2a2a; text-align: right; }
  .row .value { font-size: 14.2px; font-weight: 700; color: #1a1a1a; text-align: center; min-height: 15px; }
  .row .en-label { font-size: 11px; font-weight: 700; color: #2a2a2a; text-align: left; direction: ltr; letter-spacing: 0.3px; }
  .row .blank { display: inline-block; width: 60%; border-bottom: 1px dotted #bbb; height: 0.7em; vertical-align: middle; }
  .fare-section .fare-row { display: grid; grid-template-columns: 105px 1fr 115px; align-items: baseline; gap: 12px; padding: 3.5px 2px 2px; }
  .fare-section .fare-row .ar-label { font-size: 13px; font-weight: 700; color: #2a2a2a; text-align: right; }
  .amount-words { font-size: 11.5px; font-weight: 700; }
  .fare-section .fare-row .value { font-size: 16.2px; font-weight: 800; color: #1a1a1a; text-align: center; }
  .fare-section .fare-row .en-label { font-size: 10.6px; font-weight: 700; color: #2a2a2a; text-align: left; direction: ltr; letter-spacing: 0.3px; }
  /* ── الإقرارُ في ذيل الورقة نفسِها ────────────────────────────────────────
     صفحةٌ ثانيةٌ لكلّ أمر نقل تعني ضعفَ الورق يوميًّا، فبقي في ورقته: عمودان
     متجاوران (العربيُّ والأرديّ) بخطٍّ صغيرٍ يبقى مقروءًا، وخانتا توقيعٍ
     وتاريخٍ تحتهما. */
  .pledge { margin-top: 4px; border: 1px solid #e0d2c2; border-radius: 4px; padding: 4px 7px 5px; }
  .pledge .head { display: flex; justify-content: space-between; align-items: baseline; font-size: 10.6px; font-weight: 800; color: #F58220; margin-bottom: 2px; }
  .pledge .head .ur-t { font-family: 'Noto Naskh Arabic', 'Tajawal', sans-serif; font-weight: 600; }
  .pledge .cols { display: grid; grid-template-columns: 1fr 1fr; gap: 7px; }
  .pledge p { font-size: 7.9px; line-height: 1.45; color: #2a2a2a; text-align: justify; }
  .pledge .ur { font-family: 'Noto Naskh Arabic', 'Tajawal', sans-serif; font-size: 7.7px; line-height: 1.52; border-inline-start: 1px dashed #ececec; padding-inline-start: 7px; }
  /* ── والاسمان يقفان معًا لا متقاطعَين ────────────────────────────────────
     كانت الخانةُ تُكتب «التاريخ · تاریخ» في سطرٍ واحد، والفقرةُ الأردية إلى
     يسارها — فيُقرأ الاسمُ العربيُّ عند العمود الأرديّ وبالعكس. فصارت كلُّ
     لغةٍ تحت أختها في الخانة نفسِها: لا يسارَ ولا يمينَ يُفهَم منه شيء.
     والسطرُ تحتهما يُترَك فارغًا — السائقُ يوقّع ويكتب التاريخ بيده. */
  .pledge .sign { display: grid; grid-template-columns: 1fr 1fr; gap: 26px; margin-top: 5px; padding-top: 5px; border-top: 1px dashed #ececec; }
  .pledge .sign .k { font-size: 9.6px; font-weight: 700; color: #2a2a2a; line-height: 1.35; }
  .pledge .sign .k .ur-k { display: block; font-family: 'Noto Naskh Arabic', 'Tajawal', sans-serif; font-size: 9px; font-weight: 400; color: #555; }
  .pledge .sign .l { margin-top: 12px; border-bottom: 1px solid #1a1a1a; }
  .fill { font-weight: 800; border-bottom: 1px solid #1a1a1a; padding: 0 7px; }
  /* ── والختمُ يتبع ما قبله ──────────────────────────────────────────────
     كان «margin-top:auto» يدفعه إلى قاع الصندوق، فتفتح بين الإقرار والختم
     فجوةٌ بيضاء ويبقى تحته فراغٌ ثانٍ إلى حافّة الورقة. والمساحةُ المتروكة
     أولى بها السطورُ نفسُها: فُردت أعلاه، والختمُ صار يجلس تحت الإقرار. */
  .stamp-wrap { padding-top: 3px; text-align: center; }
  .stamp-wrap img { width: 95px; height: auto; display: inline-block; }
</style>
</head>
<body>
<div class="sheet">
  <div class="contacts">
    <div class="k">للتواصل · Contact</div>
    ${CONTACT_PHONES.map((n) => `<div class="n">${esc(n)}</div>`).join('')}
  </div>
  <div class="content">
    <div class="title-block">
      <div class="doc-title">أمر نقل</div>
      <div class="doc-subtitle">نقل بري<span class="en">· Transport Order</span></div>
      <div class="title-accent"></div>
    </div>
    <div class="meta-row">
      <!-- العميلُ أوّلُ ما يُقرأ: الورقةُ تُسلَّم بيدٍ ولم تكن تقول لمن الحمولة،
           فيُسأل عنها السائقُ أو يُراجَع السجلُّ بالرقم. -->
      <div class="meta-box customer"><span class="lbl-ar">العميل</span><span class="lbl-en">Customer</span><span class="val">${valOrBlank(row.customerName)}</span></div>
      <div class="meta-box"><span class="lbl-ar">الفرع</span><span class="lbl-en">Branch</span><span class="val">${valOrBlank(row.branch)}</span></div>
      <div class="meta-box"><span class="lbl-ar">التاريخ</span><span class="lbl-en">Date</span><span class="val">${valOrBlank(row.date)}</span></div>
      <div class="meta-box"><span class="lbl-ar">رقم أمر النقل</span><span class="lbl-en">Order No.</span><span class="val">${valOrBlank(row.dispatchNumber)}</span></div>
    </div>
    <div class="section">
      <div class="section-head"><span class="ar">بيانات الرحلة</span><span class="en">Trip Details</span></div>
      <div class="row"><span class="ar-label">العنوان من</span><span class="value">${valOrBlank(row.fromLocation)}</span><span class="en-label">From</span></div>
      <div class="row"><span class="ar-label">إلى</span><span class="value">${valOrBlank(row.toLocation)}</span><span class="en-label">To</span></div>
      <div class="row"><span class="ar-label">نوع السيارة</span><span class="value">${valOrBlank(row.carType)}</span><span class="en-label">Vehicle Type</span></div>
      ${row.supplierName ? `<div class="row"><span class="ar-label">المورد</span><span class="value">${esc(row.supplierName)}</span><span class="en-label">Supplier</span></div>` : ''}
      ${row.ownerName ? `<div class="row"><span class="ar-label">مالك الشاحنة</span><span class="value">${esc(row.ownerName)}</span><span class="en-label">Truck Owner</span></div>` : ''}
      ${row.blNumber ? `<div class="row"><span class="ar-label">رقم البوليصة</span><span class="value">${esc(row.blNumber)}</span><span class="en-label">B/L No.</span></div>` : ''}
      ${row.containerNumber ? `<div class="row"><span class="ar-label">رقم الحاوية</span><span class="value">${esc(row.containerNumber)}</span><span class="en-label">Container No.</span></div>` : ''}
      ${row.agentName ? `<div class="row"><span class="ar-label">المندوب</span><span class="value">${esc(row.agentName)}</span><span class="en-label">Representative</span></div>` : ''}
    </div>
    <div class="section">
      <div class="section-head"><span class="ar">بيانات السائق</span><span class="en">Driver Details</span></div>
      <div class="row"><span class="ar-label">اسم السائق</span><span class="value">${valOrBlank(row.driverName)}</span><span class="en-label">Driver Name</span></div>
      <div class="row"><span class="ar-label">الجنسية</span><span class="value">${valOrBlank(row.driverNationality)}</span><span class="en-label">Nationality</span></div>
      <div class="row"><span class="ar-label">رقم الإقامة</span><span class="value">${valOrBlank(row.driverIqama)}</span><span class="en-label">Iqama No.</span></div>
      <div class="row"><span class="ar-label">جوال السائق</span><span class="value" dir="ltr">${valOrBlank(row.driverPhone)}</span><span class="en-label">Driver Phone</span></div>
    </div>
    <div class="section">
      <div class="section-head"><span class="ar">بيانات السيارة</span><span class="en">Vehicle Details</span></div>
      <div class="row"><span class="ar-label">رقم السيارة</span><span class="value">${valOrBlank(formatPlate(row.plateNumber))}</span><span class="en-label">Plate No.</span></div>
      <div class="row"><span class="ar-label">الماركة</span><span class="value">${valOrBlank(row.carBrand)}</span><span class="en-label">Brand</span></div>
      <div class="row"><span class="ar-label">اللون</span><span class="value">${valOrBlank(row.carColor)}</span><span class="en-label">Color</span></div>
    </div>
    <div class="section fare-section">
      <div class="section-head"><span class="ar">الأجرة</span><span class="en">Fare</span></div>
      ${row.paymentLabel ? `<div class="fare-row"><span class="ar-label">نوع الدفع</span><span class="value">${esc(row.paymentLabel)}</span><span class="en-label">Payment</span></div>` : ''}
      <div class="fare-row"><span class="ar-label">إيجار</span><span class="value">${valOrBlank(row.rentalType)}</span><span class="en-label">Rental</span></div>
      ${row.sellPrice ? `<div class="fare-row"><span class="ar-label">قيمة النقل</span><span class="value">${esc(row.sellPrice)}${row.sellPriceWords ? ` <span class="amount-words">(${esc(row.sellPriceWords)})</span>` : ''}</span><span class="en-label">Freight</span></div>` : ''}
    </div>
    ${row.notes ? `<div class="section">
      <div class="section-head"><span class="ar">ملاحظات</span><span class="en">Notes</span></div>
      <div class="row" style="grid-template-columns: 1fr;"><span class="value" style="text-align:start">${esc(row.notes)}</span></div>
    </div>` : ''}
    ${pledgeHTML(row)}
    <div class="stamp-wrap"><img src="${esc(stampSrc)}" alt="" /></div>
  </div>
</div>
</body>
</html>`;
}

// Map a FleetShipment doc → the DispatchSheetRow the template expects (same
// mapping as the web's toSheetRow).
function rowFromShipment(s) {
  const d = s.loadDate || s.createdAt || new Date();
  const dt = new Date(d);
  const date = `${dt.getDate()}/${dt.getMonth() + 1}/${dt.getFullYear()}`;
  const driverName = [s.driverName, s.secondDriverName].filter(Boolean).join(' + ');
  return {
    // Loads now carry one of the four payment types instead of a rent type; older loads keep their rent type.
    rentalType: require('./shipmentOrderPayment').subtypeLabel(s.paymentSubtype) || s.rentType || '', carBrand: s.vehicleBrand || '', carColor: s.vehicleColor || '',
    carType: s.trailerType || '', plateNumber: s.vehiclePlate || '',
    driverPhone: s.driverPhone || '', driverIqama: s.driverIqama || '', driverNationality: s.driverNationality || '',
    driverName, customerName: s.customerName || '', branch: s.branch || '',
    blNumber: s.blNumber || '', containerNumber: s.containerNumber || '',
    toLocation: s.toCity || '', fromLocation: s.fromCity || '', date, dispatchNumber: String(s.waybillNumber || ''),
  };
}

// Fallback only: one waybill as a transparent screenshot over the letterhead. Used when the vector pass does not give one page per waybill.
async function renderWaybillImagePdf(row) {
  return withPage(async (page) => {
    // 210mm × 297mm at 96dpi = 794 × 1123, ×1.5 device scale — matches the web's html2canvas scale.
    await page.setViewport({ width: 794, height: 1123, deviceScaleFactor: 1.5 });
    await page.setContent(buildDispatchSheetHTML(row), { waitUntil: 'domcontentloaded', timeout: 20000 });
    try { await page.evaluateHandle('document.fonts.ready'); } catch (e) { /* fallback font */ }
    const el = await page.$('.sheet');
    const overlayPng = await el.screenshot({ omitBackground: true, type: 'png' });

    const pdfDoc = await PDFDocument.load(getLetterhead());
    const p0 = pdfDoc.getPages()[0];
    const { width, height } = p0.getSize();
    const png = await pdfDoc.embedPng(overlayPng);
    p0.drawImage(png, { x: 0, y: 0, width, height });
    while (pdfDoc.getPageCount() > 1) pdfDoc.removePage(pdfDoc.getPageCount() - 1);
    return Buffer.from(await pdfDoc.save({ useObjectStreams: false }));
  });
}

// One sheet per printed page; the sheet is exactly A4, so the break never adds a blank page.
const PRINT_CSS = '<style>@page{size:210mm 297mm;margin:0}.sheet{break-after:page}.sheet:last-of-type{break-after:auto}</style>';

/**
 * Waybills as one vector PDF: all sheets go into a single HTML document, Chromium prints it once (text stays text), and each printed page is laid over the letterhead.
 * The old path took a 1.5x screenshot per waybill: ~4 s and ~440 KB each, so 25 waybills meant minutes on the VPS and an 11 MB file the print dialog choked on.
 * If the print does not come out as one page per waybill, the screenshot path is used so a sheet is never split or lost.
 */
async function renderWaybillsPdf(rows) {
  if (!rows.length) throw new Error('No waybills');
  const htmls = rows.map(buildDispatchSheetHTML);
  const head = htmls[0].slice(0, htmls[0].indexOf('<body>')).replace('</head>', `${PRINT_CSS}</head>`);
  const bodies = htmls.map((h) => h.slice(h.indexOf('<body>') + 6, h.lastIndexOf('</body>')));
  const overlayBytes = await withPage(async (page) => {
    await page.emulateMediaType('screen');
    await page.setContent(`${head}<body>${bodies.join('')}</body></html>`, { waitUntil: 'domcontentloaded', timeout: 60000 });
    try { await page.evaluateHandle('document.fonts.ready'); } catch (e) { /* fallback font */ }
    return page.pdf({ printBackground: true, omitBackground: true, preferCSSPageSize: true, margin: { top: 0, right: 0, bottom: 0, left: 0 }, timeout: 120000 });
  });

  const out = await PDFDocument.create();
  const overlay = await PDFDocument.load(overlayBytes);
  if (overlay.getPageCount() === rows.length) {
    const letterhead = await PDFDocument.load(getLetterhead());
    const { width, height } = letterhead.getPages()[0].getSize();
    // The letterhead is embedded once and drawn under every page.
    const [lh] = await out.embedPdf(letterhead, [0]);
    const sheets = await out.embedPdf(overlay, overlay.getPageIndices());
    for (const sheet of sheets) {
      const pg = out.addPage([width, height]);
      pg.drawPage(lh, { x: 0, y: 0, width, height });
      pg.drawPage(sheet, { x: 0, y: 0, width, height });
    }
    return Buffer.from(await out.save({ useObjectStreams: false }));
  }

  console.warn(`[waybill] vector print gave ${overlay.getPageCount()} pages for ${rows.length} waybills; using screenshots`);
  for (const row of rows) {
    // eslint-disable-next-line no-await-in-loop
    const doc = await PDFDocument.load(await renderWaybillImagePdf(row));
    // eslint-disable-next-line no-await-in-loop
    const copied = await out.copyPages(doc, doc.getPageIndices());
    copied.forEach((pg) => out.addPage(pg));
  }
  return Buffer.from(await out.save({ useObjectStreams: false }));
}

// A single waybill is the same file as a bulk one with one row, so the row button, the portal and mobile print exactly what bulk prints.
const renderWaybillPdf = (row) => renderWaybillsPdf([row]);

/**
 * A waybill row built from a shipment order, same shape as `rowFromShipment`.
 * The selling price is printed for cash orders only: when the driver collects on delivery the sheet shows the freight value; on credit the account is settled later, so no sale or purchase price leaves with the driver.
 * The rule is read from the driver hire type option's paymentMethod, not from a hard-coded word, so new types work without code changes.
 */
/** Payment type as printed: the chosen type, else what the shipment's terms say. */
function paymentLabelOf(o) {
  const { subtypeLabel } = require('./shipmentOrderPayment');
  const method = String(o.paymentMethod || '').trim();
  return subtypeLabel(o.paymentSubtype) || ({ cash: 'نقدي', late: 'آجل' }[method] || method);
}

function rowFromOrder(o, opts = {}) {
  const d = o.pickupTime || o.startTime || o.createdAt || new Date();
  const dt = new Date(d);
  // Cash is detected from the payment method or the hire type; the two sources store different keys (platform in English, our screen in Arabic).
  const CASH = ['cash', 'نقدي', 'كاش'];
  const FRONT = ['front', 'ذهاب فقط', 'قدام'];
  // The order's payment type takes precedence when present.
  // It replaced the hire type in the create form: cash means the driver collects on delivery, credit means a later account. Older orders have no payment type and keep the previous rule.
  const bySubtype = require('./shipmentOrderPayment').collectsOnDelivery(o.paymentSubtype);
  const cash = opts.cashRental !== undefined
    ? !!opts.cashRental
    : bySubtype !== null
      ? bySubtype
      : CASH.includes(String(o.paymentMethod || '').trim()) || FRONT.includes(String(o.driverRentType || '').trim());
  // A chosen payment type decides the fare box: only cash 3PL prints the price, in
  // figures and in words. Shipments with no type keep the older rule.
  const { subtypeLabel } = require('./shipmentOrderPayment');
  const { amountInArabic } = require('./arabicAmount');
  const chosen = !!subtypeLabel(o.paymentSubtype);
  const is3pl = o.paymentSubtype === 'cash_3pl';
  const showPrice = chosen ? is3pl : cash;
  return {
    notes: o.notes || '',
    sellPrice: showPrice && o.sellPrice != null && o.sellPrice !== '' ? Number(o.sellPrice).toLocaleString('en-US') : '',
    paymentLabel: chosen ? '' : paymentLabelOf(o),
    rentalType: chosen ? (is3pl ? 'نقدي 3PL (إيجار قدام)' : subtypeLabel(o.paymentSubtype)) : (o.driverRentType || ''),
    sellPriceWords: is3pl ? amountInArabic(o.sellPrice) : '',
    carBrand: '', carColor: '',
    blNumber: o.blNumber || '', containerNumber: o.containerNumber || '',
    carType: o.truckType || '', plateNumber: o.vehiclePlate || o.vehicleName || '',
    driverAdvance: o.driverRentPrice != null ? String(o.driverRentPrice) : '',
    driverPhone: o.driverPhone || '', driverIqama: o.driverIqama || '', driverNationality: o.driverNationality || '',
    driverName: o.driverName || '', customerName: o.customerName || '', branch: o.branch || '',
    toLocation: o.toCity || '', fromLocation: o.fromCity || '',
    date: `${dt.getDate()}/${dt.getMonth() + 1}/${dt.getFullYear()}`,
    dispatchNumber: String(o.reference || o.waybillNumber || ''),
  };
}

module.exports = { renderWaybillPdf, renderWaybillsPdf, rowFromShipment, rowFromOrder, buildDispatchSheetHTML };
