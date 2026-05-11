import type { DispatchSheetRow } from './dispatchSheetExcelParser';

const esc = (s: string): string =>
  String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');

const valOrBlank = (v: string): string => {
  const trimmed = (v ?? '').trim();
  if (trimmed) return esc(trimmed);
  return `<span class="blank"></span>`;
};

/**
 * Returns a transparent A4 HTML overlay with the dispatch-sheet content. The
 * vector letterhead artwork comes from `energize LH.pdf` and is stitched
 * together with this overlay by the generator (via pdf-lib).
 *
 * Layout: bilingual rows — Arabic label on the right (RTL leading edge),
 * value in the centre, English label on the left. Section names are also
 * bilingual. Density is intentionally tight so the whole sheet fits comfortably
 * in the letterhead's middle band with the stamp at the bottom.
 *
 * IMPORTANT: never apply letter-spacing to Arabic text — it breaks the cursive
 * joining and renders each glyph in its isolated form.
 *
 * Tajawal is loaded into the parent document by the generator before
 * rasterizing — don't @import it here.
 */
export function buildDispatchSheetHTML(row: DispatchSheetRow, options?: {
  stampSrc?: string;
}): string {
  const stampSrc = options?.stampSrc || '/images/الختم.png';

  return `
<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head>
<meta charset="UTF-8" />
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  html, body {
    font-family: 'Tajawal', 'Noto Sans Arabic', system-ui, sans-serif;
    direction: rtl;
    color: #1a1a1a;
    background: transparent;
    -webkit-font-smoothing: antialiased;
    text-rendering: optimizeLegibility;
  }

  .sheet {
    width: 210mm;
    height: 297mm;
    position: relative;
    background: transparent;
    overflow: hidden;
  }

  /* Empty band of the letterhead — between logo header and orange footer
     line. Bottom is intentionally generous so the stamp doesn't touch the
     letterhead's orange footer line. */
  .content {
    position: absolute;
    top: 40mm;
    bottom: 60mm;
    left: 16mm;
    right: 16mm;
    display: flex;
    flex-direction: column;
  }
  /* Flexbox can shrink any auto-sized child when total content exceeds the
     fixed-height container — that's how a previous pass made the meta strip
     "disappear". Pin the top blocks so they always render at their full size. */
  .title-block, .meta-row, .section, .stamp-wrap { flex-shrink: 0; }

  /* ── Title ────────────────────────────────────────── */
  .title-block {
    text-align: center;
    margin-bottom: 12px;
  }
  .doc-title {
    font-size: 40px;
    font-weight: 800;
    color: #1a1a1a;
    line-height: 1.1;
    margin-bottom: 10px;
  }
  .doc-subtitle {
    font-size: 17px;
    font-weight: 700;
    color: #333;
    line-height: 1.25;
  }
  .doc-subtitle .en {
    color: #555;
    font-weight: 700;
    margin-right: 6px;
  }
  .title-accent {
    width: 90px;
    height: 3px;
    background: #F58220;
    margin: 10px auto 0;
    border-radius: 2px;
  }

  /* ── Meta strip ───────────────────────────────────── */
  .meta-row {
    display: flex;
    gap: 4px;
    margin-bottom: 10px;
    background: rgba(253, 240, 224, 0.97);
    border: 1.5px solid #e8b585;
    border-radius: 6px;
    /* No overflow:hidden here — combined with the row's border-radius, it
       was clipping the bottom of the value text inside each box. */
  }
  .meta-box {
    flex: 1;
    padding: 10px 12px 12px;
    text-align: center;
    border-left: 1px solid #d9b388;
    line-height: 1.4;
  }
  .meta-box:last-child { border-left: none; }
  .meta-box .lbl-ar {
    display: block;
    font-size: 13px;
    font-weight: 700;
    color: #6e4f2e;
    line-height: 1.5;
  }
  .meta-box .lbl-en {
    display: block;
    font-size: 11px;
    font-weight: 700;
    color: #6e4f2e;
    direction: ltr;
    letter-spacing: 0.3px; /* Latin only — Arabic stays untouched. */
    line-height: 1.5;
    margin-bottom: 5px;
  }
  .meta-box .val {
    display: block;
    font-size: 16px;
    font-weight: 800;
    color: #1a1a1a;
    line-height: 1.5;
    padding-bottom: 2px;
  }

  /* ── Sections ─────────────────────────────────────── */
  .section {
    margin-bottom: 7px;
    padding: 5px 10px 6px;
    border-right: 3px solid #F58220;
    background: rgba(255, 255, 255, 0.86);
    border-radius: 0 4px 4px 0;
  }
  .section-head {
    display: flex;
    justify-content: space-between;
    align-items: baseline;
    border-bottom: 1px dashed #f0d8c0;
    padding-bottom: 3px;
    margin-bottom: 4px;
  }
  .section-head .ar {
    font-size: 14px;
    font-weight: 800;
    color: #F58220;
  }
  .section-head .en {
    font-size: 12px;
    font-weight: 800;
    color: #F58220;
    direction: ltr;
    letter-spacing: 0.4px;
  }

  /* Bilingual row: ar label (right) | value (centre) | en label (left). */
  .row {
    display: grid;
    grid-template-columns: 115px 1fr 125px;
    align-items: baseline;
    gap: 10px;
    padding: 5px 2px;
    border-bottom: 1px dashed #ececec;
    line-height: 1.45;
  }
  .row:last-child { border-bottom: none; }
  .row .ar-label {
    font-size: 13.5px;
    font-weight: 700;
    color: #2a2a2a;
    text-align: right;
  }
  .row .value {
    font-size: 14.5px;
    font-weight: 700;
    color: #1a1a1a;
    text-align: center;
    min-height: 20px;
  }
  .row .en-label {
    font-size: 12px;
    font-weight: 700;
    color: #2a2a2a;
    text-align: left;
    direction: ltr;
    letter-spacing: 0.3px;
  }
  .row .blank {
    display: inline-block;
    width: 60%;
    border-bottom: 1px dotted #bbb;
    height: 0.7em;
    vertical-align: middle;
  }

  /* ── Fare highlight ───────────────────────────────── */
  .fare-section .fare-row {
    display: grid;
    grid-template-columns: 115px 1fr 125px;
    align-items: baseline;
    gap: 10px;
    padding: 5px 2px 2px;
  }
  .fare-section .fare-row .ar-label {
    font-size: 13.5px;
    font-weight: 700;
    color: #2a2a2a;
    text-align: right;
  }
  .fare-section .fare-row .value {
    font-size: 17px;
    font-weight: 800;
    color: #1a1a1a;
    text-align: center;
  }
  .fare-section .fare-row .en-label {
    font-size: 12px;
    font-weight: 700;
    color: #2a2a2a;
    text-align: left;
    direction: ltr;
    letter-spacing: 0.3px;
  }

  /* ── Stamp ────────────────────────────────────────── */
  .stamp-wrap {
    margin-top: auto;
    padding-top: 10px;
    text-align: center;
  }
  .stamp-wrap img {
    width: 120px;
    height: auto;
    display: inline-block;
  }
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
      <div class="meta-box">
        <span class="lbl-ar">الفرع</span>
        <span class="lbl-en">Branch</span>
        <span class="val">${valOrBlank(row.branch)}</span>
      </div>
      <div class="meta-box">
        <span class="lbl-ar">التاريخ</span>
        <span class="lbl-en">Date</span>
        <span class="val">${valOrBlank(row.date)}</span>
      </div>
      <div class="meta-box">
        <span class="lbl-ar">رقم البوليصة</span>
        <span class="lbl-en">Bill No.</span>
        <span class="val">${valOrBlank(row.dispatchNumber)}</span>
      </div>
    </div>

    <div class="section">
      <div class="section-head">
        <span class="ar">بيانات الرحلة</span>
        <span class="en">Trip Details</span>
      </div>
      <div class="row">
        <span class="ar-label">العنوان من</span>
        <span class="value">${valOrBlank(row.fromLocation)}</span>
        <span class="en-label">From</span>
      </div>
      <div class="row">
        <span class="ar-label">إلى</span>
        <span class="value">${valOrBlank(row.toLocation)}</span>
        <span class="en-label">To</span>
      </div>
      <div class="row">
        <span class="ar-label">نوع السيارة</span>
        <span class="value">${valOrBlank(row.carType)}</span>
        <span class="en-label">Vehicle Type</span>
      </div>
    </div>

    <div class="section">
      <div class="section-head">
        <span class="ar">بيانات السائق</span>
        <span class="en">Driver Details</span>
      </div>
      <div class="row">
        <span class="ar-label">اسم السائق</span>
        <span class="value">${valOrBlank(row.driverName)}</span>
        <span class="en-label">Driver Name</span>
      </div>
      <div class="row">
        <span class="ar-label">الجنسية</span>
        <span class="value">${valOrBlank(row.driverNationality)}</span>
        <span class="en-label">Nationality</span>
      </div>
      <div class="row">
        <span class="ar-label">رقم الإقامة</span>
        <span class="value">${valOrBlank(row.driverIqama)}</span>
        <span class="en-label">Iqama No.</span>
      </div>
      <div class="row">
        <span class="ar-label">جوال السائق</span>
        <span class="value">${valOrBlank(row.driverPhone)}</span>
        <span class="en-label">Driver Phone</span>
      </div>
      <div class="row">
        <span class="ar-label">سلفة للسائق</span>
        <span class="value">${valOrBlank(row.driverAdvance)}</span>
        <span class="en-label">Driver Advance</span>
      </div>
    </div>

    <div class="section">
      <div class="section-head">
        <span class="ar">بيانات السيارة</span>
        <span class="en">Vehicle Details</span>
      </div>
      <div class="row">
        <span class="ar-label">رقم السيارة</span>
        <span class="value">${valOrBlank(row.plateNumber)}</span>
        <span class="en-label">Plate No.</span>
      </div>
      <div class="row">
        <span class="ar-label">الماركة</span>
        <span class="value">${valOrBlank(row.carBrand)}</span>
        <span class="en-label">Brand</span>
      </div>
      <div class="row">
        <span class="ar-label">اللون</span>
        <span class="value">${valOrBlank(row.carColor)}</span>
        <span class="en-label">Color</span>
      </div>
    </div>

    <div class="section fare-section">
      <div class="section-head">
        <span class="ar">الأجرة</span>
        <span class="en">Fare</span>
      </div>
      <div class="fare-row">
        <span class="ar-label">إيجار</span>
        <span class="value">${valOrBlank(row.rentalType)}</span>
        <span class="en-label">Rental</span>
      </div>
    </div>

    <div class="stamp-wrap">
      <img src="${esc(stampSrc)}" alt="" crossorigin="anonymous" />
    </div>

  </div>
</div>
</body>
</html>
`;
}
