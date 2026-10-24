/**
 * بريدُ العميل — أكثرُ من عنوان (صاحبُ الشركة، ٢٠٢٦/١٠/٢٤).
 *
 * `emails` قائمتُه، و`email` القديمُ يبقى أوّلَها فلا ينكسر ما يقرؤه. فكلُّ من
 * يريد «إلى من يُرسَل» يقرأ من هنا، وكلُّ حفظٍ يمرّ على `normalizeEmails`.
 */
const RX = /^[^\s@<>()[\],;:"]+@[^\s@<>()[\],;:"]+\.[^\s@<>()[\],;:"]{2,}$/;

/** قائمةٌ نظيفة: تُفصَل بالفاصلة أو السطر، تُصغَّر، يُحذف المكرَّرُ والتالف. */
function normalizeEmails(input) {
  const raw = Array.isArray(input) ? input : String(input || '').split(/[\s,;،]+/);
  const out = [];
  for (const x of raw) {
    const e = String(x || '').trim().toLowerCase();
    if (e && RX.test(e) && !out.includes(e)) out.push(e);
  }
  return out.slice(0, 10);
}

/** كلُّ بريدٍ معروفٍ للطرف — القائمةُ ثمّ القديم. */
const emailsOf = (p = {}) => normalizeEmails([...(p.emails || []), p.email || '']);

/** يضبط الحقلين معًا في جسم الحفظ إن أُرسل أحدُهما. */
function applyEmails(body) {
  if (body.emails === undefined && body.email === undefined) return body;
  const list = normalizeEmails(body.emails !== undefined ? body.emails : body.email);
  body.emails = list;
  body.email = list[0] || '';
  return body;
}

module.exports = { normalizeEmails, emailsOf, applyEmails, isEmail: (e) => RX.test(String(e || '').trim()) };
