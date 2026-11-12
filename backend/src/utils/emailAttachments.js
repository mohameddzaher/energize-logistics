/**
 * Files the user attached to an outgoing email: [{ dataUrl, fileName }] from the screen, as nodemailer attachments.
 * Capped so a message stays deliverable (most mail servers refuse above ~25 MB once base64 grows it).
 */
const MAX_FILES = 20;
const MAX_TOTAL = 20 * 1024 * 1024;

function emailAttachments(list) {
  const items = Array.isArray(list) ? list.slice(0, MAX_FILES + 1) : [];
  if (items.length > MAX_FILES) {
    const e = new Error(`الحدّ الأقصى ${MAX_FILES} ملفًّا في الرسالة الواحدة.`); e.status = 400; throw e;
  }
  let total = 0;
  const out = [];
  for (const it of items) {
    const m = /^data:([^;,]+)?(;base64)?,(.*)$/s.exec(String((it && it.dataUrl) || ''));
    if (!m) continue;
    const content = m[2] ? Buffer.from(m[3], 'base64') : Buffer.from(decodeURIComponent(m[3]), 'utf8');
    total += content.length;
    const name = String((it && it.fileName) || 'attachment').replace(/[\\/:*?"<>|\r\n]/g, '').slice(0, 150) || 'attachment';
    out.push({ filename: name, content, contentType: m[1] || 'application/octet-stream' });
  }
  if (total > MAX_TOTAL) {
    const e = new Error('حجم المرفقات أكبر من 20 ميجابايت — قلّل الملفات أو اضغطها.'); e.status = 400; throw e;
  }
  return out;
}

module.exports = { emailAttachments, MAX_FILES, MAX_TOTAL };
