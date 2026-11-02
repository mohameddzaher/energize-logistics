/**
 * Store issue request (طلب صرف) as a printable PDF on the company letterhead.
 * Rendered with page.pdf (real text) and composited onto the vector letterhead by reportBuilder.stampLetterhead, the same geometry as reports, so a long request flows onto further pages with the letterhead on each.
 */
const { withPage, getFontCss } = require('./pdfBrowser');
const { stampLetterhead, MARGIN, FOOTER_OFFSET } = require('../services/reportBuilder');
const { formatPlate } = require('./plateKey');

const ORANGE = '#f37121';
const INK = '#0f172a';
const LINE = '#cbd5e1';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' }[c]));
// Plates, codes and numbers keep their own direction inside Arabic cells.
const iso = (s) => `<span dir="auto" style="unicode-bidi:isolate">${esc(s)}</span>`;
const dash = (s) => (String(s ?? '').trim() ? iso(s) : '—');
const dmy = (ymd) => (/^\d{4}-\d{2}-\d{2}/.test(String(ymd || '')) ? String(ymd).slice(0, 10).split('-').reverse().join('/') : '—');
const qty = (n) => (Number(n) || 0).toLocaleString('en-US', { maximumFractionDigits: 3 });

function issueRequestHtml(r) {
  const cancelled = r.status === 'cancelled';
  const head = [
    ['رقم الطلب', 'Request No.', dash(r.number)],
    ['التاريخ', 'Date', iso(dmy(r.date))],
    ['المركبة / اللوحة', 'Vehicle / Plate', dash(formatPlate(r.vehiclePlate) || r.vehiclePlate)],
    ['المشروع', 'Project', dash(r.project)],
    ['الراكب', 'Rider', dash(r.rider)],
    ['سبب الصرف', 'Issue reason', dash(r.issueReasonAr)],
  ];
  const headRows = [];
  for (let i = 0; i < head.length; i += 2) {
    headRows.push(`<tr>${head.slice(i, i + 2).map(([ar, en, v]) => `<th><span class="ar">${ar}</span><span class="en">${en}</span></th><td>${v}</td>`).join('')}</tr>`);
  }
  const lines = (r.lines || []).map((l, i) => `<tr${i % 2 ? ' class="alt"' : ''}>
      <td class="c">${i + 1}</td>
      <td>${esc(l.itemName)}</td>
      <td class="c">${dash(l.itemCode)}</td>
      <td class="c">${esc(l.unit || '—')}</td>
      <td class="c b">${iso(qty(l.quantity))}</td>
      <td class="c">${iso(qty(l.balanceAfter))}</td>
    </tr>`).join('');
  const sigBox = (title) => `<div class="sig">
      <div class="sig-t">${title}</div>
      <div class="sig-r"><span>الاسم</span><i></i></div>
      <div class="sig-r"><span>التوقيع</span><i></i></div>
      <div class="sig-r"><span>التاريخ</span><i></i></div>
    </div>`;
  return `<!DOCTYPE html>
<html lang="ar" dir="rtl"><head><meta charset="UTF-8" /><title>${esc(r.number)}</title>
<style>
${getFontCss()}
  @page { size: A4; margin: ${MARGIN.top} ${MARGIN.side} ${MARGIN.bottom}; }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  html, body { font-family: 'Tajawal', 'Noto Sans Arabic', Arial, sans-serif; direction: rtl; color: ${INK}; -webkit-font-smoothing: antialiased; }
  .title { text-align: center; margin-bottom: 12px; break-after: avoid; }
  .title h1 { font-size: 24px; font-weight: 800; line-height: 1.2; }
  .title .en { font-size: 12px; font-weight: 700; color: ${ORANGE}; margin-top: 2px; }
  .title .rule { width: 80px; height: 3px; background: ${ORANGE}; margin: 7px auto 0; border-radius: 2px; }
  .void { margin: 0 auto 10px; width: fit-content; padding: 4px 14px; border: 2px solid #dc2626; color: #dc2626; border-radius: 6px; font-weight: 800; font-size: 13px; }
  .void small { display: block; font-size: 10px; font-weight: 700; text-align: center; }
  table.head { width: 100%; border-collapse: collapse; margin-bottom: 14px; font-size: 12px; }
  table.head th { width: 17%; background: #fff4ec; color: #7c3a10; text-align: start; padding: 6px 9px; border: 1px solid ${LINE}; font-weight: 800; }
  table.head th .ar { display: block; }
  table.head th .en { display: block; font-size: 8.5px; font-weight: 700; color: #a16207; direction: ltr; text-align: start; }
  table.head td { width: 33%; padding: 6px 9px; border: 1px solid ${LINE}; font-weight: 700; }
  .sec { margin: 4px 0 7px; padding: 6px 11px; background: ${INK}; color: #fff; border-radius: 6px; font-size: 13px; font-weight: 800; break-after: avoid; }
  table.lines { width: 100%; border-collapse: collapse; font-size: 11.5px; }
  table.lines thead { display: table-header-group; }
  table.lines tr { break-inside: avoid; }
  table.lines th { background: #334155; color: #fff; padding: 6px 7px; border: 1px solid #334155; font-weight: 700; }
  table.lines td { padding: 6px 7px; border: 1px solid ${LINE}; }
  table.lines tr.alt td { background: #f8fafc; }
  table.lines .c { text-align: center; }
  table.lines .b { font-weight: 800; }
  .note { margin-top: 9px; font-size: 11px; padding: 6px 10px; background: #f8fafc; border: 1px solid ${LINE}; border-radius: 6px; }
  .sigs { display: flex; justify-content: center; gap: 28px; margin-top: 22px; break-inside: avoid; }
  .sig { flex: 1; max-width: 250px; border: 1px solid #94a3b8; border-radius: 6px; padding: 7px 11px 9px; }
  .sig-t { text-align: center; font-size: 12.5px; font-weight: 800; padding-bottom: 5px; margin-bottom: 4px; border-bottom: 1px solid ${LINE}; }
  .sig-r { display: flex; align-items: flex-end; gap: 8px; font-size: 11px; font-weight: 700; height: 25px; }
  .sig-r span { width: 46px; flex-shrink: 0; }
  .sig-r i { flex: 1; border-bottom: 1px dotted #64748b; height: 1px; }
</style></head>
<body>
  <div class="title"><h1>طلب صرف</h1><div class="en">Store Issue Request · ${esc(r.number)}</div><div class="rule"></div></div>
  ${cancelled ? `<div class="void">ملغى<small>${esc(r.cancelReason || '')}</small></div>` : ''}
  <table class="head">${headRows.join('')}</table>
  <div class="sec">قطع الغيار المطلوبة</div>
  <table class="lines">
    <thead><tr><th style="width:6%">#</th><th>الصنف</th><th style="width:14%">الكود</th><th style="width:11%">الوحدة</th><th style="width:12%">الكمية</th><th style="width:16%">الرصيد بعد الصرف</th></tr></thead>
    <tbody>${lines}</tbody>
  </table>
  ${r.note ? `<div class="note"><b>ملاحظة:</b> ${esc(r.note)}</div>` : ''}
  <div class="sigs">${sigBox('توقيع أمين المخزن')}${sigBox('توقيع فني الورشة')}</div>
</body></html>`;
}

/** Returns the request as a PDF Buffer on the letterhead. */
async function renderIssueRequestPdf(r) {
  const html = issueRequestHtml(r);
  return withPage(async (page) => {
    await page.setContent(html, { waitUntil: 'domcontentloaded', timeout: 20000 });
    await Promise.race([
      page.evaluateHandle('document.fonts.ready').catch(() => {}),
      new Promise((ok) => setTimeout(ok, 4000)),
    ]);
    const content = Buffer.from(await page.pdf({
      format: 'A4',
      printBackground: true,
      displayHeaderFooter: true,
      headerTemplate: '<span></span>',
      // Pinned to the top of the bottom margin band, above the letterhead's printed footer (see reportBuilder).
      footerTemplate: `<div style="box-sizing:border-box;width:100%;height:${MARGIN.bottom};font-family:Tajawal,Arial,sans-serif;font-size:7.5px;
        color:#94a3b8;padding:${FOOTER_OFFSET} 16mm 0;display:flex;align-items:flex-start;justify-content:space-between;direction:rtl">
        <span>${esc(r.number)}${r.createdByName ? ` · ${esc(r.createdByName)}` : ''}</span>
        <span>صفحة <span class="pageNumber"></span> من <span class="totalPages"></span></span>
      </div>`,
      margin: { top: MARGIN.top, bottom: MARGIN.bottom, left: MARGIN.side, right: MARGIN.side },
      omitBackground: true,
    }));
    return stampLetterhead(content);
  });
}

module.exports = { renderIssueRequestPdf, issueRequestHtml };
