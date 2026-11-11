/**
 * The company email signature (from the owner's «SIGN 2026» design), one per department.
 * The person's name in the original becomes the department's name; every department mailbox (customs, collections, …)
 * appends it to every message. Images are embedded (cid) so they show without loading external content.
 */
const path = require('path');

const DEPARTMENTS = {
  customs: { en: 'Customs Clearance Department', ar: 'إدارة التخليص الجمركي' },
  collections: { en: 'Collections Department', ar: 'إدارة التحصيل' },
};

const ASSET_DIR = path.join(__dirname, '..', 'assets', 'email');
const CIDS = { logo: 'logo@energize', mark: 'mark@energize', truck: 'truck@energize' };

const esc = (s) => String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** Inline image attachments the HTML signature references. */
function signatureAttachments() {
  return [
    { filename: 'energize-logo.png', path: path.join(ASSET_DIR, 'logo.png'), cid: CIDS.logo, contentDisposition: 'inline' },
    { filename: 'energize-mark.png', path: path.join(ASSET_DIR, 'mark.png'), cid: CIDS.mark, contentDisposition: 'inline' },
    { filename: 'energize-truck.gif', path: path.join(ASSET_DIR, 'truck.gif'), cid: CIDS.truck, contentDisposition: 'inline' },
  ];
}

/** HTML block appended under the message body. `note` is the department's own optional text from its settings. */
function signatureHtml(dept, note = '') {
  const d = DEPARTMENTS[dept] || DEPARTMENTS.customs;
  const line = 'margin:0;font-family:Calibri,Arial,sans-serif;font-size:14px;color:#000';
  return `<div dir="ltr" style="margin-top:22px;text-align:left">
${note ? `<p dir="auto" style="${line};margin-bottom:10px;white-space:pre-line">${esc(note)}</p>` : ''}
<p style="${line}">Best regards,</p>
<p style="${line};font-weight:bold">${esc(d.en)}</p>
<p style="margin:10px 0 4px"><img src="cid:${CIDS.logo}" alt="Energize Logistics" style="height:40px;vertical-align:middle">&nbsp;&nbsp;<img src="cid:${CIDS.mark}" alt="" style="height:40px;vertical-align:middle"></p>
<p style="${line};color:#f37121;font-style:italic">Your Logistics Partner…</p>
<p style="${line}">🌐 <a href="https://energize-logistics.com" style="color:#000;text-decoration:none">Energize-Logistics.com</a></p>
<p style="${line}">📲 Hotline: 920031911</p>
<p style="margin:8px 0 0"><img src="cid:${CIDS.truck}" alt="" style="width:540px;max-width:100%;height:18px"></p>
</div>`;
}

/** Plain-text twin for mail clients that show text only. */
function signatureText(dept, note = '') {
  const d = DEPARTMENTS[dept] || DEPARTMENTS.customs;
  return [note, 'Best regards,', d.en, 'Energize Logistics — Your Logistics Partner…', 'Energize-Logistics.com', 'Hotline: 920031911']
    .filter(Boolean).join('\n');
}

/** The same signature for on-screen preview: images inlined as data URLs instead of cid references (the GIF keeps its animation). */
let inlined = null;
function signaturePreviewHtml(dept, note = '', image = '') {
  const fs = require('fs');
  if (!inlined) {
    const read = (f, mime) => `data:${mime};base64,${fs.readFileSync(path.join(ASSET_DIR, f)).toString('base64')}`;
    inlined = { logo: read('logo.png', 'image/png'), mark: read('mark.png', 'image/png'), truck: read('truck.gif', 'image/gif') };
  }
  let html = signatureHtml(dept, note);
  for (const k of Object.keys(CIDS)) html = html.split(`cid:${CIDS[k]}`).join(inlined[k]);
  const img = /^data:image\//i.test(image || '') ? `<div style="margin-top:14px"><img src="${image}" alt="" style="max-width:320px;max-height:140px"></div>` : '';
  return img + html;
}

module.exports = { DEPARTMENTS, signatureHtml, signatureText, signatureAttachments, signaturePreviewHtml };
